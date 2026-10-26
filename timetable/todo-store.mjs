import { readFileSync } from "node:fs";
import { initializeApp, cert, getApp, deleteApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { Clock } from "./clock.mjs";

/// 하루투두의 Realtime Database(users/<uid>)에 수업을 넣고 고친다.
/// 수업 하나 = 할 일 하나 + 그날 기록 하나, 둘 다 같은 번호("tt-날짜-교시-학급")라서 몇 번을 돌려도 같은 결과가 된다.
/// 사용자가 이미 체크한 완료 표시는 건드리지 않고, 사용자가 직접 지운 수업은 되살리지 않는다.
export class TodoStore {
  static ID_PREFIX = "tt-";
  static WRITE_CHUNK = 200;

  #uid;
  #categoryName;
  #root;

  constructor({ uid, categoryName, databaseURL }) {
    this.#uid = uid;
    this.#categoryName = categoryName;
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
  async sync(plan, { retireRecurringFrom = null, dryRun = false } = {}) {
    const now = Date.now();
    const category = await this.#findCategory();
    const [tasks, instances] = await Promise.all([
      this.#read("tasks", this.#root.child("tasks").orderByKey().startAt(TodoStore.ID_PREFIX).endAt(`${TodoStore.ID_PREFIX}`)),
      this.#read("instances", this.#root.child("instances").orderByChild("date").startAt(plan.from))
    ]);

    const writes = {};
    const report = { created: 0, updated: 0, removed: 0, restored: 0, retired: 0 };
    const desired = new Map(plan.lessons.map(lesson => [lesson.id, lesson]));

    for (const lesson of desired.values()) this.#upsert(lesson, category, tasks[lesson.id], instances[lesson.id], now, writes, report);
    for (const [id, instance] of Object.entries(instances)) {
      if (id.startsWith(TodoStore.ID_PREFIX) && instance.date <= plan.to && !instance.deletedAt && !desired.has(id)) {
        this.#remove(id, now, writes);
        report.removed++;
      }
    }
    if (retireRecurringFrom) await this.#retireRecurring(category.id, retireRecurringFrom, now, writes, report, instances);
    if (category.isNew) writes[`categories/${category.id}`] = category.record;

    if (!dryRun) await this.#commit(writes);
    return report;
  }

  #upsert(lesson, category, task, instance, now, writes, report) {
    const userDeleted = task?.deletedAt && !task.timetableRemoved;
    if (userDeleted) return;
    if (!task) {
      writes[`tasks/${lesson.id}`] = {
        title: lesson.title, note: "", categoryId: category.id,
        recurrence: "none", weekdayMask: 0, monthDay: 0,
        startDate: lesson.date, endDate: null,
        sortOrder: lesson.sortOrder, isArchived: false, updatedAt: now, deletedAt: null
      };
      writes[`instances/${lesson.id}`] = {
        taskId: lesson.id, date: lesson.date, isDone: false, photoCount: 0,
        updatedAt: now, deletedAt: null
      };
      report.created++;
      return;
    }
    if (task.deletedAt || instance?.deletedAt) {
      writes[`tasks/${lesson.id}/deletedAt`] = null;
      writes[`tasks/${lesson.id}/timetableRemoved`] = null;
      writes[`tasks/${lesson.id}/updatedAt`] = now;
      writes[`instances/${lesson.id}`] = {
        taskId: lesson.id, date: lesson.date, isDone: instance?.isDone ?? false, photoCount: instance?.photoCount ?? 0,
        updatedAt: now, deletedAt: null
      };
      report.restored++;
    }
    if (task.title !== lesson.title || task.categoryId !== category.id) {
      writes[`tasks/${lesson.id}/title`] = lesson.title;
      writes[`tasks/${lesson.id}/categoryId`] = category.id;
      writes[`tasks/${lesson.id}/updatedAt`] = now;
      report.updated++;
    }
  }

  #remove(id, now, writes) {
    writes[`tasks/${id}/deletedAt`] = now;
    writes[`tasks/${id}/timetableRemoved`] = true;
    writes[`tasks/${id}/updatedAt`] = now;
    writes[`instances/${id}/deletedAt`] = now;
    writes[`instances/${id}/updatedAt`] = now;
  }

  /// 옛 반복 일정은 지우지 않고 "어제까지"로 끝맺고, 그 날짜 이후 기록만 지운다(되돌리기 쉽다).
  async #retireRecurring(categoryId, fromKey, now, writes, report, futureInstances) {
    const lastKey = Clock.addDays(fromKey, -1);
    const all = await this.#read("tasks", this.#root.child("tasks").orderByChild("categoryId").equalTo(categoryId));
    for (const [id, task] of Object.entries(all)) {
      const recurring = task.recurrence && task.recurrence !== "none";
      if (id.startsWith(TodoStore.ID_PREFIX) || task.deletedAt || !recurring) continue;
      if (task.endDate && task.endDate < fromKey) continue;
      if (task.startDate >= fromKey) {
        writes[`tasks/${id}/deletedAt`] = now;
      } else {
        writes[`tasks/${id}/endDate`] = lastKey;
      }
      writes[`tasks/${id}/updatedAt`] = now;
      for (const [instanceId, instance] of Object.entries(futureInstances)) {
        if (instance.taskId === id && instance.date >= fromKey && !instance.deletedAt) {
          writes[`instances/${instanceId}/deletedAt`] = now;
          writes[`instances/${instanceId}/updatedAt`] = now;
        }
      }
      report.retired++;
      console.log(`  옛 반복 일정 정리: ${task.title} (${task.recurrence})`);
    }
  }

  async #findCategory() {
    const categories = await this.#read("categories", this.#root.child("categories"));
    const found = Object.entries(categories)
      .find(([, c]) => !c.deletedAt && (c.name || "").trim() === this.#categoryName);
    if (found) return { id: found[0], isNew: false };
    const sortOrder = Object.values(categories).reduce((max, c) => Math.max(max, (c.sortOrder ?? 0) + 1), 0);
    return {
      id: "timetable-category", isNew: true,
      record: { name: this.#categoryName, colorHex: "#4C8DF6", symbolName: "book", sortOrder, endDate: null, updatedAt: Date.now(), deletedAt: null }
    };
  }

  async #read(label, query) {
    return (await query.get()).val() ?? {};
  }

  async #commit(writes) {
    const entries = Object.entries(writes);
    for (let i = 0; i < entries.length; i += TodoStore.WRITE_CHUNK) {
      await this.#root.update(Object.fromEntries(entries.slice(i, i + TodoStore.WRITE_CHUNK)));
    }
  }
}
