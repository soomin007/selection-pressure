// 런/라운드 구조 상수 (Phase 4~5). 한 라운드 길이·런당 라운드 수.
// (참고: Everything is Crab ≈ 20분/보스3 → 모바일 호흡에 맞게 축소)

export const GAME = {
  roundSeconds: 16, // 채집 라운드 길이(초) — 통과 기준 없어 짧혀도 밸런스 영향 없음
  bossSeconds: 20, // 보스 게이트 관전 길이(초) — 통과 기준이 이 길이에 맞춰져 있음
  extinctionSeconds: 24, // 대멸종 피날레 길이(초) — 통과 기준이 이 길이에 맞춰져 있음
  bossPassThreshold: 3, // 보스 끝까지 내 종이 이 수 이상 생존하면 통과 (소수 개체 게임에 맞춰 낮춤)
  extinctionPassThreshold: 3, // 대멸종 끝까지 내 종이 이 수 이상 생존하면 통과(승리, 클라이맥스 필터)

  // --- 레벨업(형질 성장) — 시간이 아니라 경험치로 형질을 얻는다(먹이 섭취 = 경험치). ---
  xpBase: 24, // 레벨 1→2 에 필요한 경험치(내 종이 먹은 먹이 수)
  xpPerLevel: 14, // 레벨이 오를수록 필요 경험치가 이만큼씩 늘어난다(뒤로 갈수록 느긋)

  // --- 위협 예고 — 보스/대멸종 단계 시작 이 초 전에 전광판으로 미리 알린다(마음의 준비). ---
  threatPreviewLead: 4,
} as const;

// 한 런의 라운드 계획. 각 단계 앞에는 드래프트가 붙는다.
//   forage = 채집 라운드, boss = 보스 게이트, extinction = 대멸종 피날레
export const SCHEDULE = ["forage", "forage", "boss", "forage", "boss", "extinction"] as const;
export type StageKind = (typeof SCHEDULE)[number];
