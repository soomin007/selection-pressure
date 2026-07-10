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

// 「전설의 이름」 꾸밈(도전 과제 「대군」 보상)이 열리면 이 목록에서 이름이 나온다. 효과는 없다.
// 애칭보다 길고 예스러운 울림 — "오래된 이름을 물려받는다".
const MYTHIC_FIRST: readonly string[] = [
  "아라", "누리", "가람", "하늘", "미르", "다솜", "여울", "노을",
  "새벽", "바람", "이슬", "구름", "달빛", "별하", "온새", "한별",
];
const MYTHIC_SECOND: readonly string[] = [
  "솔", "결", "빛", "샘", "뫼", "누", "람", "달",
  "별", "온", "휘", "슬", "찬", "람", "터", "울",
];

/** 「전설의 이름」이 열렸는가. main 이 런 시작 때 한 번 정해 넣는다(렌더마다 localStorage 를 읽지 않게). */
let mythic = false;
export function setMythicNames(on: boolean): void {
  mythic = on;
}

/** 개체 id → 애칭. 결정론적(같은 id = 같은 이름). 「전설의 이름」이 열려 있으면 다른 목록에서 고른다. */
export function creatureName(id: number): string {
  const i = Math.abs(Math.trunc(id));
  const first = mythic ? MYTHIC_FIRST : FIRST;
  const second = mythic ? MYTHIC_SECOND : SECOND;
  const a = first[i % first.length] ?? "보";
  const b = second[Math.floor(i / first.length) % second.length] ?? "리";
  return a + b;
}
