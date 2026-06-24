// 시뮬 튜닝 상수. 한곳에 모아 Phase 2(게놈 변화)에서 균형을 잡기 쉽게 한다.
// 모든 값은 "1 틱" 기준. 시간은 stepsPerSecond 로 환산.

export const SIM = {
  /** 1초당 시뮬 스텝 수 (고정 타임스텝 → 결정론). */
  stepsPerSecond: 30,

  // --- 초기 배치 ---
  initialEntities: 40,
  foodPatches: 90,

  // --- 에너지 ---
  startEnergy: 55,
  maxEnergy: 100,
  foodEnergy: 30, // 먹이 하나를 먹을 때 얻는 에너지
  foodRegrowTicks: 260, // 먹힌 먹이가 다시 자라기까지 (약 8.7초)

  // --- 번식 ---
  reproduceThreshold: 78, // 이 에너지 이상이어야 번식
  reproduceRate: 0.01, // 틱당 기본 번식 확률 (×(0.3+fertility))
  populationCap: 600, // 폭주 방지 안전 상한 (도달 시 번식 중단)

  // --- 행동/형질 스케일 ---
  eatRadius: 9,
  metabolismDrain: 0.13, // 틱당 에너지 소모 (×(0.5+metabolism))
  maxSpeedBase: 1.7, // 최대 속도 (×(0.4+speed))
  visionBase: 130, // 시야 반경 (×(0.4+vision))
  wanderTurn: 0.5, // 먹이가 안 보일 때 헤딩 흔들림(라디안)
  baseMaxAge: 1700, // 수명 (×(1.2-0.5*metabolism)) → 대사 높으면 단명
} as const;
