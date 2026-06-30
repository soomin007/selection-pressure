// 개체 이름 — 개체 id 로 결정론적으로 짧고 친근한 이름을 만든다(같은 개체는 늘 같은 이름).
// 소수 개체 게임의 핵심은 "내 애들"에 대한 애착 — 이름이 있어야 한 마리 한 마리가 기억에 남는다.
// 순수 TS(Pixi/sim 의존 없음) → 단위 테스트로 결정론·범위를 확인한다.

// 두 음절을 조합해 부르기 쉬운 애칭을 만든다. 20×20 = 400가지라 한 무리(수십 마리)에선 거의 안 겹친다.
const FIRST: readonly string[] = [
  "보", "토", "루", "미", "코", "나", "삐", "쿠", "포", "리",
  "두", "바", "치", "호", "뽀", "구", "단", "모", "주", "앙",
];
const SECOND: readonly string[] = [
  "리", "미", "루", "꼬", "삐", "비", "나", "또", "롱", "순",
  "둥", "박", "송", "찌", "끼", "별", "콩", "담", "울", "총",
];

/** 개체 id → 애칭. 결정론적(같은 id = 같은 이름). */
export function creatureName(id: number): string {
  const i = Math.abs(Math.trunc(id));
  const a = FIRST[i % FIRST.length] ?? "보";
  const b = SECOND[Math.floor(i / FIRST.length) % SECOND.length] ?? "리";
  return a + b;
}
