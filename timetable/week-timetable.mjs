import { Clock } from "./clock.mjs";

/// 컴시간이 주는 한 주치 자료(학교 전체 학급 시간표)에서 교사 한 명의 수업만 뽑는다.
/// 칸 값은 숫자(또는 변경 표시 ">" 가 앞에 붙은 문자열)이고, 끝 세 자리가 교사 번호, 그 앞이 과목 번호다.
export class WeekTimetable {
  static BASE = "자료481";   // 원래 시간표
  static DAILY = "자료147";  // 대체·교환이 반영된 이번 주 시간표
  static MAX_PERIOD = 8;

  #raw;

  constructor(raw) {
    this.#raw = raw;
  }

  get mondayKey() {
    return this.#raw.시작일;
  }

  get fridayKey() {
    return Clock.addDays(this.mondayKey, 4);
  }

  dateKeyOf(weekday) {
    return Clock.addDays(this.mondayKey, weekday - 1);
  }

  teacherNames() {
    return this.#raw.자료446;
  }

  /// 컴시간 학생 화면은 이름 끝 글자를 가려 보여 주므로 "정일*" 처럼 가려진 이름으로 찾는다.
  findTeacher(maskedName) {
    const matches = this.teacherNames()
      .map((name, index) => ({ name, index }))
      .filter(entry => index0(entry) && entry.name === maskedName);
    if (matches.length === 0) throw new Error(`교사 "${maskedName}" 을(를) 찾지 못했습니다.\n목록: ${this.teacherNames().filter(Boolean).join(", ")}`);
    if (matches.length > 1) throw new Error(`교사 "${maskedName}" 이(가) ${matches.length}명입니다. 이름이 가려져 구별할 수 없습니다.`);
    return matches[0].index;
  }

  /// source: WeekTimetable.BASE | WeekTimetable.DAILY
  lessonsOf(teacherIndex, source) {
    const table = this.#raw[source];
    const lessons = [];
    for (let grade = 1; grade < this.#raw.학급수.length; grade++) {
      for (let cls = 1; cls <= this.#raw.학급수[grade]; cls++) {
        for (let weekday = 1; weekday <= 5; weekday++) {
          for (let period = 1; period <= WeekTimetable.MAX_PERIOD; period++) {
            const cell = this.#decode(table?.[grade]?.[cls]?.[weekday]?.[period]);
            if (!cell || cell.teacher !== teacherIndex) continue;
            lessons.push({
              date: this.dateKeyOf(weekday), weekday, period, grade, cls,
              subject: this.#raw.자료492[cell.subject] || "수업",
              changed: cell.changed
            });
          }
        }
      }
    }
    return lessons;
  }

  #decode(cell) {
    if (cell === undefined || cell === null) return null;
    const text = String(cell);
    const changed = text.startsWith(">");
    const number = Number(changed ? text.slice(1) : text);
    if (!number) return null;
    const split = this.#raw.분리 ?? 100;
    if (split === 100) return { teacher: Math.floor(number / 100), subject: number % 100, changed };
    return { teacher: number % split, subject: Math.floor(number / split) % split, changed };
  }
}

/// 0번 칸은 비어 있는 자리라 교사로 치지 않는다.
function index0(entry) {
  return entry.index > 0;
}
