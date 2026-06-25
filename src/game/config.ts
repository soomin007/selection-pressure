// 런/라운드 구조 상수 (Phase 4~5). 한 라운드 길이·런당 라운드 수.
// (참고: Everything is Crab ≈ 20분/보스3 → 모바일 호흡에 맞게 축소)

export const GAME = {
  roundSeconds: 25, // 한 관전 라운드 길이(초)
  roundsPerRun: 6, // 보스 전까지 드래프트 라운드 수
} as const;
