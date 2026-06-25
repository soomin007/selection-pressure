// 런/라운드 구조 상수 (Phase 4~5). 한 라운드 길이·런당 라운드 수.
// (참고: Everything is Crab ≈ 20분/보스3 → 모바일 호흡에 맞게 축소)

export const GAME = {
  roundSeconds: 25, // 채집 라운드 길이(초)
  bossSeconds: 20, // 보스 게이트 관전 길이(초)
  extinctionSeconds: 24, // 대멸종 피날레 길이(초)
  bossPassThreshold: 6, // 보스 끝까지 내 종이 이 수 이상 생존하면 통과
  extinctionPassThreshold: 10, // 대멸종 끝까지 내 종이 이 수 이상 생존하면 통과(승리, 클라이맥스 필터)
} as const;

// 한 런의 라운드 계획. 각 단계 앞에는 드래프트가 붙는다.
//   forage = 채집 라운드, boss = 보스 게이트, extinction = 대멸종 피날레
export const SCHEDULE = ["forage", "forage", "boss", "forage", "boss", "extinction"] as const;
export type StageKind = (typeof SCHEDULE)[number];
