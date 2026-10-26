/// 같은 이름이면 어디서 만들어도 같은 번호(UUID v5)가 나오게 한다.
/// 웹(브라우저)·시간표 스크립트(Node)가 함께 쓰고, 아이폰 앱의 StableID.swift 도 같은 계산을 한다.
/// 같은 할 일의 같은 날 기록을 웹과 앱이 따로 만들어도 번호가 같아 하나로 합쳐진다(중복 기록 방지).
export class StableId {
  static NAMESPACE = "8c1f5a3e-2b7d-4e9a-9f60-3d2c71b4a5e8";

  /// 반복 할 일 하루치 기록의 번호. taskId 는 소문자, dateKey 는 "yyyy-MM-dd".
  static instance(taskId, dateKey) {
    return StableId.of(`instance|${String(taskId).toLowerCase()}|${dateKey}`);
  }

  static async of(name) {
    const namespace = StableId.#bytesOf(StableId.NAMESPACE);
    const text = new TextEncoder().encode(name);
    const input = new Uint8Array(namespace.length + text.length);
    input.set(namespace);
    input.set(text, namespace.length);
    const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-1", input)).slice(0, 16);
    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = [...hash].map(b => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  static #bytesOf(uuid) {
    const hex = uuid.replace(/-/g, "");
    return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  }
}
