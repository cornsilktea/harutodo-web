import { Clock } from "./clock.mjs";
import { WeekTimetable } from "./week-timetable.mjs";

/// 받아 온 주별 시간표에서 "넣어야 할 수업 목록"을 만든다.
///   daily    : 오늘부터 2주 안(자료가 있는 날까지)의 실제 시간표(대체·교환 반영)
///   semester : 시작일부터 학기 끝까지. 이번·다음 주는 실제 시간표, 그 뒤는 원래 시간표를 요일마다 반복
export class LessonPlanner {
  static DAILY_DAYS = 14;

  #teacherMask;
  #isHoliday;

  constructor({ teacherMask, isHoliday }) {
    this.#teacherMask = teacherMask;
    this.#isHoliday = isHoliday;
  }

  plan({ weeks, mode, today, startDate, semesterEnd }) {
    if (weeks.length === 0) throw new Error("받아 온 시간표가 없습니다.");
    const from = today > startDate ? today : startDate;
    const coveredEnd = weeks[weeks.length - 1].fridayKey;
    const to = mode === "semester"
      ? semesterEnd
      : this.#earlier(Clock.addDays(today, LessonPlanner.DAILY_DAYS - 1), coveredEnd);
    if (to < from) return { from, to, lessons: [] };

    const actualByDate = this.#groupByDate(weeks.flatMap(week =>
      week.lessonsOf(week.findTeacher(this.#teacherMask), WeekTimetable.DAILY)));
    const coveredDates = new Set(weeks.flatMap(week => Clock.eachDay(week.mondayKey, week.fridayKey)));
    const baseWeek = weeks[0];
    const baseByWeekday = this.#groupByWeekday(
      baseWeek.lessonsOf(baseWeek.findTeacher(this.#teacherMask), WeekTimetable.BASE));

    const lessons = [];
    for (const date of Clock.eachDay(from, to)) {
      const weekday = Clock.weekdayOf(date);
      if (weekday > 5) continue;
      if (coveredDates.has(date)) {
        lessons.push(...(actualByDate.get(date) ?? []));
      } else if (mode === "semester" && !this.#isHoliday(date)) {
        lessons.push(...(baseByWeekday.get(weekday) ?? []).map(lesson => ({ ...lesson, date })));
      }
    }
    return { from, to, lessons: lessons.map(lesson => this.#withIdentity(lesson)) };
  }

  #withIdentity(lesson) {
    const label = `${lesson.grade}-${lesson.cls}`;
    return {
      ...lesson,
      id: `tt-${lesson.date}-${lesson.period}-${label}`,
      title: `${lesson.period}교시 ${label} ${lesson.subject}${lesson.changed ? " (변경)" : ""}`,
      sortOrder: lesson.period * 100 + lesson.grade * 10 + lesson.cls
    };
  }

  #groupByDate(lessons) {
    return this.#group(lessons, lesson => lesson.date);
  }

  #groupByWeekday(lessons) {
    return this.#group(lessons, lesson => lesson.weekday);
  }

  #group(lessons, keyOf) {
    const groups = new Map();
    for (const lesson of lessons) {
      const key = keyOf(lesson);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(lesson);
    }
    return groups;
  }

  #earlier(a, b) {
    return a < b ? a : b;
  }
}
