import { readFileSync } from "node:fs";
import { initializeApp, cert, getApp, deleteApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { Clock } from "./clock.mjs";
import { StableId } from "../stable-id.mjs";

/// 하루투두의 Realtime Database(users/<uid>)에 수업을 넣고 고친다.
/// 수업 하나 = 할 일 하나 + 그날 기록 하나. 번호는 수업 이름표("tt-날짜-교시-학급")에서 계산한 UUID 라
/// 몇 번을 돌려도 같은 결과가 되고, 아이폰 앱도 받아들인다(앱은 UUID 번호만 읽는다).
/// 사용자가 체크한 완료 표시·직접 지운 수업·직접 고친 이름은 건드리지 않는다.
export class TodoStore {
  static SOURCE = "timetable";
  static LEGACY_PREFIX = "tt-";
  static WRITE_CHUNK = 200;

  #root;

  constructor({ uid, databaseURL }) {
    initializeApp({ credential: cert(TodoStore.#serviceAccount()), databaseURL });
    this.#root = getDatabase().ref(`users/${uid}`);
  }

  /// 열어 둔 DB 연결을 닫는다. 안 닫으면 일이 끝나도 프로그램이 종료되지 않는다.
  async close() {
    await deleteApp(getApp());
  }

  static #serviceAccount() {
    const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (inline) return JSON.parse(inline);
    const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (path) return JSON.parse(readFileSync(path, "utf8"));
    throw new Error("서비스 계정 키가 없습니다. FIREBASE_SERVICE_ACCOUNT 또는 GOOGLE_APPLICATION_CREDENTIALS 를 설정하세요.");
  }

  /// plan: LessonPlanner.plan 의 결과. retireRecurringFrom: 이 날짜부터는 카테고리의 옛 반복 일정을 없앤다(없으면 안 함).
  async sync(plan, { categoryName, retireRecurringFrom = null, dryRun = false }) {
    const now = Date.now();
    const [categories, tasks, instances] = await Promise.all([
      this.#read(this.#root.child("categories")),
      this.#read(this.#root.child("tasks")),
      this.#read(this.#root.child("instances").orderByChild("date").startAt(plan.from))
    ]);
    const category = await TimetableCategory.find(categories, categoryName);
    const batch = new WriteBatch(now);
    const report = { created: 0, updated: 0, removed: 0, restored: 0, retired: 0, legacy: 0 };

    const legacyDone = LegacyLessons.retire(tasks, instances, batch, report);
    const wanted = new Set();
    for (const lesson of plan.lessons) {
      const ids = await LessonIds.of(lesson);
      wanted.add(ids.taskId);
      new LessonWriter(lesson, ids, category.id, batch, report)
        .apply(tasks[ids.taskId], instances[ids.instanceId], legacyDone.has(lesson.key));
    }
    this.#removeCancelled(plan, tasks, instances, wanted, batch, report);
    if (retireRecurringFrom) this.#retireRecurring(category.id, retireRecurringFrom, tasks, instances, batch, report);
    if (category.isNew) batch.set(`categories/${category.id}`, category.record);

    if (!dryRun) await this.#commit(batch.paths);
    return report;
  }

  /// 시간표에서 빠진 수업(취소·교환)은 지운다. 이미 끝낸 기록과 이번 범위 밖은 그대로 둔다.
  #removeCancelled(plan, tasks, instances, wanted, batch, report) {
    for (const [instanceId, instance] of Object.entries(instances)) {
      const task = tasks[instance.taskId];
      if (!task || task.source !== TodoStore.SOURCE || task.deletedAt) continue;
      if (instance.deletedAt || instance.isDone || instance.date > plan.to || wanted.has(instance.taskId)) continue;
      batch.markDeleted(`tasks/${instance.taskId}`, { timetableRemoved: true });
      batch.markDeleted(`instances/${instanceId}`);
      report.removed++;
    }
  }

  /// 옛 반복 일정은 지우지 않고 "어제까지"로 끝맺고, 그 날짜 이후 기록만 지운다(되돌리기 쉽다).
  #retireRecurring(categoryId, fromKey, tasks, futureInstances, batch, report) {
    const lastKey = Clock.addDays(fromKey, -1);
    for (const [id, task] of Object.entries(tasks)) {
      const recurring = task.recurrence && task.recurrence !== "none";
      if (task.categoryId !== categoryId || task.source === TodoStore.SOURCE || task.deletedAt || !recurring) continue;
      if (task.endDate && task.endDate < fromKey) continue;
      if (task.startDate >= fromKey) {
        batch.markDeleted(`tasks/${id}`);
      } else {
        batch.touch(`tasks/${id}`, { endDate: lastKey });
      }
      for (const [instanceId, instance] of Object.entries(futureInstances)) {
        if (instance.taskId === id && instance.date >= fromKey && !instance.deletedAt) {
          batch.markDeleted(`instances/${instanceId}`);
        }
      }
      report.retired++;
      console.log(`  옛 반복 일정 정리: ${task.title} (${task.recurrence})`);
    }
  }

  async #read(query) {
    return (await query.get()).val() ?? {};
  }

  async #commit(paths) {
    const entries = Object.entries(paths);
    for (let i = 0; i < entries.length; i += TodoStore.WRITE_CHUNK) {
      await this.#root.update(Object.fromEntries(entries.slice(i, i + TodoStore.WRITE_CHUNK)));
    }
  }
}

/// 한 번에 보낼 경로 묶음. 고친 칸만 경로로 쓰므로 앱·웹이 붙인 다른 칸은 지워지지 않는다.
class WriteBatch {
  #now;
  paths = {};

  constructor(now) {
    this.#now = now;
  }

  get now() {
    return this.#now;
  }

  set(path, record) {
    this.paths[path] = record;
  }

  touch(path, fields) {
    for (const [name, value] of Object.entries(fields)) this.paths[`${path}/${name}`] = value;
    this.paths[`${path}/updatedAt`] = this.#now;
  }

  markDeleted(path, extra = {}) {
    this.touch(path, { deletedAt: this.#now, ...extra });
  }
}

class LessonIds {
  static async of(lesson) {
    const taskId = await StableId.of(`${TodoStore.SOURCE}|${lesson.key}`);
    return { taskId, instanceId: await StableId.instance(taskId, lesson.date) };
  }
}

/// 수업 하나를 할 일 + 그날 기록으로 맞춘다.
class LessonWriter {
  #lesson;
  #ids;
  #categoryId;
  #batch;
  #report;

  constructor(lesson, ids, categoryId, batch, report) {
    this.#lesson = lesson;
    this.#ids = ids;
    this.#categoryId = categoryId;
    this.#batch = batch;
    this.#report = report;
  }

  apply(task, instance, wasDone) {
    if (!task) return this.#create(wasDone);
    const userDeleted = task.deletedAt && !task.timetableRemoved;
    if (userDeleted) return;
    if (task.deletedAt) return this.#restore(instance);
    this.#refreshTitle(task);
  }

  #create(wasDone) {
    const { taskId, instanceId } = this.#ids;
    const lesson = this.#lesson;
    this.#batch.set(`tasks/${taskId}`, {
      title: lesson.title, note: "", categoryId: this.#categoryId,
      recurrence: "none", weekdayMask: 0, monthDay: 0,
      startDate: lesson.date, endDate: null,
      sortOrder: lesson.sortOrder, isArchived: false,
      source: TodoStore.SOURCE, lessonKey: lesson.key, lessonTitle: lesson.title,
      updatedAt: this.#batch.now, deletedAt: null
    });
    this.#batch.set(`instances/${instanceId}`, this.#instanceRecord(wasDone, 0));
    this.#report.created++;
  }

  #restore(instance) {
    const { taskId, instanceId } = this.#ids;
    this.#batch.touch(`tasks/${taskId}`, {
      deletedAt: null, timetableRemoved: null, title: this.#lesson.title, lessonTitle: this.#lesson.title
    });
    this.#batch.set(`instances/${instanceId}`,
      this.#instanceRecord(instance?.isDone ?? false, instance?.photoCount ?? 0));
    this.#report.restored++;
  }

  /// 사용자가 이름을 직접 고쳤으면(마지막으로 넣은 이름과 다르면) 그대로 둔다.
  #refreshTitle(task) {
    const userRenamed = task.lessonTitle && task.title !== task.lessonTitle;
    if (userRenamed || task.title === this.#lesson.title) return;
    this.#batch.touch(`tasks/${this.#ids.taskId}`, { title: this.#lesson.title, lessonTitle: this.#lesson.title });
    this.#report.updated++;
  }

  #instanceRecord(isDone, photoCount) {
    return {
      taskId: this.#ids.taskId, date: this.#lesson.date, isDone, photoCount,
      updatedAt: this.#batch.now, deletedAt: null
    };
  }
}

/// 처음 버전이 만든 "tt-…" 번호의 수업. 앱이 UUID 가 아닌 번호를 읽지 못해 아이폰에 보이지 않았다.
/// 지우고(새 UUID 번호로 다시 만든다), 체크해 둔 완료 표시는 새 기록으로 넘긴다.
class LegacyLessons {
  static retire(tasks, instances, batch, report) {
    const doneKeys = new Set();
    for (const [id, instance] of Object.entries(instances)) {
      if (!id.startsWith(TodoStore.LEGACY_PREFIX) || instance.deletedAt) continue;
      if (instance.isDone) doneKeys.add(id);
      batch.markDeleted(`instances/${id}`);
    }
    for (const [id, task] of Object.entries(tasks)) {
      if (!id.startsWith(TodoStore.LEGACY_PREFIX) || task.deletedAt) continue;
      batch.markDeleted(`tasks/${id}`, { timetableRemoved: true });
      report.legacy++;
    }
    return doneKeys;
  }
}

/// 수업을 넣을 카테고리. 이름은 띄어쓰기를 무시하고 찾는다("수업 준비" = "수업준비").
class TimetableCategory {
  static async find(categories, name) {
    const wanted = TimetableCategory.#normalize(name);
    const found = Object.entries(categories)
      .find(([, c]) => !c.deletedAt && TimetableCategory.#normalize(c.name) === wanted);
    if (found) return { id: found[0], isNew: false };
    const sortOrder = Object.values(categories).reduce((max, c) => Math.max(max, (c.sortOrder ?? 0) + 1), 0);
    return {
      id: await StableId.of(`${TodoStore.SOURCE}|category`), isNew: true,
      record: { name, colorHex: "#4C8DF6", symbolName: "book", sortOrder, endDate: null, updatedAt: Date.now(), deletedAt: null }
    };
  }

  static #normalize(text) {
    return String(text ?? "").replace(/\s/g, "");
  }
}
