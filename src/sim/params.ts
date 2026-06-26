// 시뮬 튜닝 상수. 한곳에 모아 Phase 2(게놈 변화)에서 균형을 잡기 쉽게 한다.
// 모든 값은 "1 틱" 기준. 시간은 stepsPerSecond 로 환산.

export const SIM = {
  /** 1초당 시뮬 스텝 수 (고정 타임스텝 → 결정론). */
  stepsPerSecond: 30,

  // --- 초기 배치 ---
  initialEntities: 36,
  foodPatches: 192, // 여러 초식종이 나눠 먹어도 공존하도록 넉넉히 (먹이 종류로 분할되므로 종류당 ~64)
  foodKindCount: 3, // 먹이 종류 수 — 종마다 먹는 종류가 달라 경쟁을 분할(공존)

  // --- 야생 이주(immigration) — 다양성 바닥. 멸종한/적은 야생종을 주기적으로 소수 보충 ---
  immigrationInterval: 300, // 약 10초마다 점검
  immigrationFloor: 4, // 야생종이 이 수 미만이면
  immigrationBatch: 3, // 이만큼 맵 밖에서 들어온다(이주)

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
  globalColdLethality: 1.7, // 대멸종 한파(globalCold)는 평상시 추위보다 이만큼 더 매섭다(클라이맥스 필터)

  // --- 보스/대멸종 (Phase 5) ---
  fleeRadiusPad: 46, // 즉사 반경 + 이만큼 안에 들면 보스에서 도망친다
  heatPenalty: 0.46, // 폭염 시 추가 소모 (틱당, ×heat×metabolism) — 폭염=저대사 유리. 폭염은 대멸종 때만이라 평상시 영향 없음. 고대사를 확실히 솎는 필터

  // --- 무리 성향 herding ---
  herdCohesion: 0.35, // 무게중심으로 끌리는 비율 (×herding)
  // 무리 안(무게중심에서 가까움)에선 cohesion 을 끈다 — COM 이 격자 양자화로 매 틱 튀어, 늘 적용하면
  // 무리 종이 제자리에서 떤다. 충분히 벗어난 낙오자만 서서히(램프) 끌어당겨 경계 떨림도 없앤다.
  herdComfortRadius: 20, // 무게중심에서 이 거리 안이면 cohesion 0
  herdComfortRamp: 26, // comfortRadius ~ +ramp 사이에서 cohesion 0→최대
  huddleFull: 5, // 이웃이 이만큼이면 보온 효과 최대
  huddleWarmth: 0.55, // 보온 시 추위 소모 최대 감소율 (×herding×이웃비율)

  // --- 다종/포식 (Phase: 야생종) ---
  dietHuntMin: 0.35, // diet 가 이보다 크면 사냥 가능(잡식/육식)
  dietGrazeMax: 0.7, // diet 가 이보다 작으면 식물 섭취 가능(초식/잡식)
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
  wanderTurn: 0.15, // 먹이가 안 보일 때 헤딩을 매 틱 흔드는 폭(라디안). 크면 제자리 떨림 → 작게 누적
  baseMaxAge: 1700, // 수명 (×(1.2-0.5*metabolism)) → 대사 높으면 단명

  // --- 이동/조향 (자연스러운 움직임) ---
  // 속도 벡터를 목표 방향으로 "한 번에" 꺾지 않고 매 틱 이 비율만큼만 보간한다(관성).
  // 낮을수록 부드러운 곡선·관성이 크다. 높을수록 민첩하지만 떨림에 가깝다.
  steerTurn: 0.18, // 평상시 조향 민감도
  fleeTurn: 0.55, // 도망칠 땐 빠르게 방향 전환(생존)
  cruiseFactor: 0.6, // 목표 없을 때 순항 속도 비율 (×maxSpeed) — 멈추지 않고 떠돈다
  arriveRadius: 18, // 목표 이 거리 안에서 선형 감속(도착) — 지나쳐 진동하는 오버슈트(제자리 떨림) 방지
  targetKeepFactor: 1.2, // 쫓던 목표를 유지하는 시야 배수(약간 더 멀어져도 commit) — 목표 진동 방지
} as const;
