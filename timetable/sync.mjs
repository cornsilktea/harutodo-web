import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Clock } from "./clock.mjs";
import { ComciClient } from "./comci-client.mjs";
import { WeekTimetable } from "./week-timetable.mjs";
import { LessonPlanner } from "./lesson-planner.mjs";
import { TodoStore } from "./todo-store.mjs";

/// 웹 쪽 holidays.js / firebase-config.js 를 그대로 읽어 쓴다(같은 값을 두 번 적지 않으려고).
class SiteScripts {
  static ROOT = new URL("../", import.meta.url);

  static holidayCalendar() {
    const source = readFileSync(new URL("holidays.js", SiteScripts.ROOT), "utf8");
    return vm.runInNewContext(`${source}\n;KoreanHolidays`);
  }

  static firebaseConfig() {
    const context = { window: {} };
    vm.runInNewContext(readFileSync(new URL("firebase-config.js", SiteScripts.ROOT), "utf8"), context);
    return context.window.HARU_FIREBASE;
  }
}

/// 사용법: node sync.mjs <daily|semester> [--dry-run] [--today=yyyy-MM-dd]
///   semester : 학기 초에 한 번. 시작일부터 학기 끝까지 넣고, 카테고리의 옛 반복 일정을 시작일 전날로 끝맺는다.
///   daily    : 매일 아침. 오늘부터 2주 안의 실제 시간표(대체·교환 포함)로 고친다.
///   --dry-run: 계획만 출력하고 아무것도 쓰지 않는다(서비스 계정 키 없이도 된다).
class TimetableSyncApp {
  static CONFIG = new URL("config.json", import.meta.url);

  #mode;
  #dryRun;
  #today;
  #config = JSON.parse(readFileSync(TimetableSyncApp.CONFIG, "utf8"));

  constructor(args) {
    this.#mode = args.find(a => a === "daily" || a === "semester") ?? "daily";
    this.#dryRun = args.includes("--dry-run");
    this.#today = args.find(a => a.startsWith("--today="))?.slice(8) ?? Clock.todayKey();
  }

  async run() {
    const weeks = await this.#fetchWeeks();
    const holidays = SiteScripts.holidayCalendar();
    const planner = new LessonPlanner({
      teacherMask: this.#config.teacher,
      isHoliday: key => holidays.isRedDay(Clock.localDate(key))
    });
    const plan = planner.plan({
      weeks, mode: this.#mode, today: this.#today,
      startDate: this.#config.startDate, semesterEnd: this.#config.semesterEnd
    });
    console.log(`${this.#mode} · ${plan.from} ~ ${plan.to} · 수업 ${plan.lessons.length}개`);
    if (this.#dryRun && !process.env.HARU_UID) return this.#printPlan(plan);

    const store = new TodoStore({
      uid: process.env.HARU_UID ?? this.#fail("HARU_UID 가 없습니다."),
      categoryName: this.#config.categoryName,
      databaseURL: SiteScripts.firebaseConfig().databaseURL
    });
    const report = await store.sync(plan, {
      dryRun: this.#dryRun,
      retireRecurringFrom: this.#mode === "semester" ? this.#config.startDate : null
    });
    console.log(`${this.#dryRun ? "(미리보기) " : ""}새로 ${report.created} · 고침 ${report.updated} · 되살림 ${report.restored} · 뺌 ${report.removed} · 옛 반복 정리 ${report.retired}`);
  }

  async #fetchWeeks() {
    const client = new ComciClient();
    await client.discoverRoute();
    const weeks = [];
    for (const week of [1, 2]) {
      const raw = await client.weekData(this.#config.schoolCode, week);
      if (raw) weeks.push(new WeekTimetable(raw));
    }
    if (weeks.length === 0) this.#fail("컴시간에 시간표가 올라와 있지 않습니다.");
    return weeks;
  }

  #printPlan(plan) {
    for (const lesson of plan.lessons) console.log(`  ${lesson.date}  ${lesson.title}`);
  }

  #fail(message) {
    throw new Error(message);
  }
}

await new TimetableSyncApp(process.argv.slice(2)).run();
