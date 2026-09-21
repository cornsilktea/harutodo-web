/* 대한민국 공휴일. 앱의 KoreanHolidays 와 같은 규칙.
   고정 공휴일 + 음력 명절(설·추석·부처님오신날) + 대체공휴일을 계산하고,
   미리 알 수 있는 임시공휴일·선거일은 EXTRAS 표에 둔다. */
const KoreanHolidays = (() => {
  const cache = {};
  const EXTRAS = {
    2024: [[4, 10, "국회의원 선거"], [10, 1, "국군의 날"]],
    2025: [[1, 27, "임시공휴일"], [6, 3, "대통령 선거"], [10, 10, "임시공휴일"]],
    2026: [[6, 3, "지방선거"]],
  };
  const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

  // 음력 월·일 → 그 해의 양력 날짜. 브라우저의 중국력(chinese)으로 하루씩 훑는다. 윤달은 건너뛴다.
  const lunarFmt = new Intl.DateTimeFormat("en-u-ca-chinese", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });
  function lunarToSolar(month, day, year) {
    for (let d = new Date(year, 0, 1); d.getFullYear() === year; d = addDays(d, 1)) {
      const parts = Object.fromEntries(lunarFmt.formatToParts(d).map(p => [p.type, p.value]));
      // 윤달은 "5bis" 처럼 숫자 뒤에 글자가 붙는다.
      if (parts.month === String(month) && Number(parts.day) === day) return d;
    }
    return null;
  }

  function compute(year) {
    const entries = []; // { date, name, sub: "none" | "weekend" | "sundayOnly" }
    const add = (date, name, sub) => { if (date) entries.push({ date, name, sub }); };
    const solar = (m, d) => new Date(year, m - 1, d);
    add(solar(1, 1), "신정", "none");
    add(solar(3, 1), "삼일절", "weekend");
    add(solar(5, 5), "어린이날", "weekend");
    add(solar(6, 6), "현충일", "none");
    add(solar(8, 15), "광복절", "weekend");
    add(solar(10, 3), "개천절", "weekend");
    add(solar(10, 9), "한글날", "weekend");
    add(solar(12, 25), "성탄절", "weekend");
    const seollal = lunarToSolar(1, 1, year);
    if (seollal) {
      add(addDays(seollal, -1), "설날 연휴", "sundayOnly");
      add(seollal, "설날", "sundayOnly");
      add(addDays(seollal, 1), "설날 연휴", "sundayOnly");
    }
    add(lunarToSolar(4, 8, year), "부처님오신날", "weekend");
    const chuseok = lunarToSolar(8, 15, year);
    if (chuseok) {
      add(addDays(chuseok, -1), "추석 연휴", "sundayOnly");
      add(chuseok, "추석", "sundayOnly");
      add(addDays(chuseok, 1), "추석 연휴", "sundayOnly");
    }

    const result = {};
    for (const e of entries) if (!result[key(e.date)]) result[key(e.date)] = e.name;
    const extraKeys = new Set();
    for (const [m, d, name] of EXTRAS[year] || []) {
      const k = key(solar(m, d)); result[k] = name; extraKeys.add(k);
    }

    // 대체공휴일: 겹친 날의 다음 평일(공휴일 아닌 날)에 하루 더 쉰다.
    // 설·추석은 연휴 사흘을 한 덩어리로 보고 덩어리 끝 다음 날부터 찾는다.
    // 같은 날에 공휴일 둘이 겹쳐도 대체휴일은 하루만 생긴다.
    const needed = [];
    const clashed = new Set();
    for (const e of [...entries].sort((a, b) => a.date - b.date)) {
      const k = key(e.date);
      if (clashed.has(k)) continue;
      const wd = e.date.getDay();
      const overlaps = entries.some(o => key(o.date) === k && o.name !== e.name) || extraKeys.has(k);
      let clash = false;
      if (e.sub === "weekend") clash = wd === 0 || wd === 6 || overlaps;
      else if (e.sub === "sundayOnly") clash = wd === 0 || overlaps;
      if (!clash) continue;
      clashed.add(k);
      let after = e.date;
      if (e.sub === "sundayOnly") {
        while (entries.some(o => o.sub === "sundayOnly" && key(o.date) === key(addDays(after, 1)))) after = addDays(after, 1);
      }
      needed.push(after);
    }
    for (const after of needed) {
      for (let c = addDays(after, 1); ; c = addDays(c, 1)) {
        const wd = c.getDay();
        if (wd === 0 || wd === 6 || result[key(c)]) continue;
        result[key(c)] = "대체공휴일";
        break;
      }
    }
    return result;
  }

  function holidays(year) { return cache[year] || (cache[year] = compute(year)); }
  function name(d) { return holidays(d.getFullYear())[key(d)] || null; }
  const isHoliday = d => name(d) !== null;
  const isRedDay = d => d.getDay() === 0 || isHoliday(d);
  const isSaturday = d => d.getDay() === 6;
  return { holidays, name, isHoliday, isRedDay, isSaturday };
})();
