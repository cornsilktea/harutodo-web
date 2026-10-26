/// 컴시간 학생(comci.net)의 비공식 주소로 학교 시간표 자료를 받는다.
/// 공식 API 가 아니라서 주소 조각(길 번호·접두어)이 바뀔 수 있다 — 접속할 때마다 /st 화면 스크립트에서 다시 읽고,
/// 못 읽으면 마지막으로 확인한 값(2026-10-26)을 쓴다.
export class ComciClient {
  static ORIGIN = "http://comci.net:4082";
  static FALLBACK_ROUTE = "36179";
  static FALLBACK_PREFIX = "73629_";
  static ATTEMPTS = 3;
  static TIMEOUT_MS = 20000;

  #route = ComciClient.FALLBACK_ROUTE;
  #prefix = ComciClient.FALLBACK_PREFIX;

  async discoverRoute() {
    const page = new TextDecoder("euc-kr").decode(await this.#download("/st"));
    this.#route = /'\.\/(\d+)\?'\s*\+\s*btoa/.exec(page)?.[1] ?? ComciClient.FALLBACK_ROUTE;
    this.#prefix = /sc_data\('(\d+_)'/.exec(page)?.[1] ?? ComciClient.FALLBACK_PREFIX;
  }

  /// week: 1 = 이번 주, 2 = 다음 주. 아직 올라오지 않은 주는 null.
  async weekData(schoolCode, week) {
    const key = Buffer.from(`${this.#prefix}${schoolCode}_0_${week}`).toString("base64");
    const text = new TextDecoder("utf-8").decode(await this.#download(`/${this.#route}?${key}`));
    if (text.length < 18) return null;
    return JSON.parse(text.slice(0, text.lastIndexOf("}") + 1));
  }

  async #download(path) {
    let lastError;
    for (let attempt = 1; attempt <= ComciClient.ATTEMPTS; attempt++) {
      try {
        const response = await fetch(ComciClient.ORIGIN + path, {
          signal: AbortSignal.timeout(ComciClient.TIMEOUT_MS)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, attempt * 1500));
      }
    }
    throw new Error(`컴시간 서버에서 받지 못했습니다(${path}): ${lastError?.message}`);
  }
}
