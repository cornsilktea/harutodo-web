/// 학기 달력. 월-일만 적어 두면 해마다 같은 날짜로 반복된다.
/// 끝 날짜가 시작보다 앞이면(2학기: 08-14 ~ 01-15) 다음 해로 넘어가는 학기로 본다.
export class AcademicCalendar {
  #terms;

  /// terms: [{ name, start: "MM-DD", end: "MM-DD" }]
  constructor(terms) {
    this.#terms = terms;
  }

  /// 그 날짜가 속한 학기의 { name, start, end }(yyyy-MM-dd). 방학이면 null.
  termAt(dateKey) {
    const year = Number(dateKey.slice(0, 4));
    for (const startYear of [year - 1, year]) {
      for (const term of this.#terms) {
        const start = `${startYear}-${term.start}`;
        const endYear = term.end < term.start ? startYear + 1 : startYear;
        const end = `${endYear}-${term.end}`;
        if (start <= dateKey && dateKey <= end) return { name: term.name, start, end };
      }
    }
    return null;
  }
}
