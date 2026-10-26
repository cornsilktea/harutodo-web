/// 날짜 문자열("yyyy-MM-dd") 계산. 시간대 때문에 하루가 밀리지 않도록 UTC 정오 기준으로만 더하고 뺀다.
export class Clock {
  static todayKey(timeZone = "Asia/Seoul") {
    return new Intl.DateTimeFormat("sv-SE", { timeZone }).format(new Date());
  }

  static addDays(key, days) {
    const date = Clock.#utcNoon(key);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  /// 월요일 1 … 일요일 7
  static weekdayOf(key) {
    return ((Clock.#utcNoon(key).getUTCDay() + 6) % 7) + 1;
  }

  static localDate(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  static eachDay(fromKey, toKey) {
    const keys = [];
    for (let key = fromKey; key <= toKey; key = Clock.addDays(key, 1)) keys.push(key);
    return keys;
  }

  static #utcNoon(key) {
    return new Date(`${key}T12:00:00Z`);
  }
}
