// 시뮬 튜닝 상수. 한곳에 모아 Phase 2(게놈 변화)에서 균형을 잡기 쉽게 한다.
// 모든 값은 "1 틱" 기준. 시간은 stepsPerSecond 로 환산.

export const SIM = {
  /** 1초당 시뮬 스텝 수 (고정 타임스텝 → 결정론). */
  stepsPerSecond: 30,

  // --- 초기 배치 ---
  initialEntities: 36,
  foodPatches: 160, // 여러 초식종이 나눠 먹어도 공존하도록 넉넉히

  // --- 에너지 ---
  startEnergy: 55,
  maxEnergy: 100,
  foodEnergy: 33, // 먹이 하나를 먹을 때 얻는 에너지
  foodRegrowTicks: 240, // 먹힌 먹이가 다시 자라기까지 (약 8초)

  // --- 번식 ---
  reproduceThreshold: 78, // 이 에너지 이상이어야 번식
  reproduceRate: 0.01, // 틱당 기본 번식 확률 (×(0.3+fertility))
  populationCap: 600, // 폭주 방지 안전 상한 (도달 시 번식 중단)

  // --- 환경 (Phase 3) ---
  cellSize: 60, // 환경 격자 한 칸 픽셀 (540×960 → 9×16칸)
  coldPenalty: 0.3, // 추운 칸 추가 소모 (틱당, ×coldness×(1-metabolism)) — 추운 맵=고대사 유리

  // --- 보스/대멸종 (Phase 5) ---
  fleeRadiusPad: 46, // 즉사 반경 + 이만큼 안에 들면 보스에서 도망친다
  heatPenalty: 0.34, // 폭염 시 추가 소모 (틱당, ×heat×metabolism) — 폭염=저대사 유리

  // --- 무리 성향 herding ---
  herdCohesion: 0.35, // 무게중심으로 끌리는 비율 (×herding)
  huddleFull: 5, // 이웃이 이만큼이면 보온 효과 최대
  huddleWarmth: 0.55, // 보온 시 추위 소모 최대 감소율 (×herding×이웃비율)

  // --- 다종/포식 (Phase: 야생종) ---
  gridCellSize: 80, // 개체 공간 격자 한 칸(이웃 질의)
  predatorSenseRange: 78, // 이 안에 (나보다 센) 포식자가 있으면 도망친다
  attackRange: 12, // 사냥 시 닿았다고 보는 거리
  predationEnergy: 36, // 사냥 성공 시 얻는 에너지 (너무 높으면 포식자가 생태계를 붕괴)
  killChanceBias: 0.5, // 기본 사냥 성공 확률
  killChanceScale: 1.3, // (내 공격력 - 상대 공격력) 당 확률 가감

  // --- 행동/형질 스케일 ---
  eatRadius: 9,
  metabolismDrain: 0.13, // 틱당 에너지 소모 (×(0.5+metabolism))
  maxSpeedBase: 1.7, // 최대 속도 (×(0.4+speed))
  visionBase: 130, // 시야 반경 (×(0.4+vision))
  wanderTurn: 0.5, // 먹이가 안 보일 때 헤딩 흔들림(라디안)
  baseMaxAge: 1700, // 수명 (×(1.2-0.5*metabolism)) → 대사 높으면 단명
} as const;
