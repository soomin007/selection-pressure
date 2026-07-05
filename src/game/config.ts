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

  // --- 난이도 루프(승리 후 진행) — 승리하면 "다음 시대"로 이어가며 위협이 점점 세진다(brotato식). ---
  // era 0 = 첫 시대(배율 1.0 = 기존과 완전 동일 → 통과기준 테스트 보존). 승리마다 era +1.
  // 통과기준(생존 수)은 그대로 두고, 위협 강도(보스·대멸종)만 이 계단으로 키운다(소수 개체라 안전).
  eraDifficultyStep: 0.22, // 시대마다 위협 강도 배율 +22% (era 1 → ×1.22, era 2 → ×1.44 …)
  eraCap: 5, // 시대 상한 — 이 시대(=시대 5)의 대멸종까지 넘으면 "정복"(최종 승리). 그 전까지는 "다음 시대로".
} as const;

/** 시대(era)별 위협 강도 배율. era 0 = 1.0(기존과 동일). 보스·대멸종 강도에 곱한다. */
export function eraDifficulty(era: number): number {
  return 1 + Math.max(0, era) * GAME.eraDifficultyStep;
}

// 한 런의 라운드 계획. 각 단계 앞에는 드래프트가 붙는다.
//   forage = 채집 라운드, boss = 보스 게이트, extinction = 대멸종 피날레
export const SCHEDULE = ["forage", "forage", "boss", "forage", "boss", "extinction"] as const;
export type StageKind = (typeof SCHEDULE)[number];
