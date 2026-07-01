// 규칙기반 개체 행동 (기획서 §3.3). ML 아님 — 게놈 × 단순 규칙 × 환경.
// 다종 생태계: 초식은 식물을, 육식은 다른 종을 먹는다. 포식자는 피하고(속도), 사냥은 공격력으로.
// 무리 성향은 모임(cohesion) + 보온(huddle).
//
// 이동 = "관성 기반 조향". 매 틱 속도를 목표 방향으로 한 번에 꺾지 않고(드득드득/홱 꺾임의 원인),
// 원하는 속도(desired)로 일부만 보간한다. 목표(먹이/먹잇감)는 한 번 정하면 유효한 동안 유지해
// (hysteresis) 매 틱 재탐색이 만드는 목표 진동(제자리 떨림)을 없앤다.
// 결정론: 무작위는 world.rng 만(배회·번식·사냥 확률), 처리 순서 고정.

import type { World, DeathCause } from "@/sim/world";
import type { Entity } from "@/sim/entity";
import type { Food } from "@/sim/food";
import type { Traits } from "@/sim/genome";
import { createEntity } from "@/sim/entity";
import { areFriends } from "@/sim/species";
import { SIM } from "@/sim/params";

interface Vec {
  x: number;
  y: number;
}

export function stepEntity(e: Entity, world: World, newborns: Entity[]): void {
  const t = e.genome.traits;
  const maxSpeed = SIM.maxSpeedBase * (0.4 + t.speed);
  // 밤엔 시야가 준다(낮=영향 없음). vision 형질이 높을수록 밤에도 잘 본다 → 야행성 틈새(큰 눈).
  const vision = SIM.visionBase * (0.4 + t.vision) * nightVisionFactor(world.daylight, t.vision);
  const drain = SIM.metabolismDrain * (0.5 + t.metabolism);
  const maxAge = SIM.baseMaxAge;
  // 식성 구간: 초식(<0.35) 식물만 / 잡식(0.35~0.7) 둘 다 / 육식(>0.7) 사냥만.
  const canHunt = t.diet > SIM.dietHuntMin;
  const canGraze = t.diet < SIM.dietGrazeMax;
  // 수영 종만 물에 들어가고(산은 누구도 못 넘는다), 물 전용(수영 아주 높음)은 육지에 못 올라온다.
  const canSwim = t.swimming >= SIM.swimThreshold;
  const canLand = t.swimming < SIM.aquaticOnlyThreshold;

  // 무리 이웃(3×3 칸) — cohesion(이동)과 huddle(보온)에 함께 쓴다.
  const nb = t.herding > 0.01 ? world.grid.neighborhood(e.x, e.y) : null;

  // --- 원하는 속도(desired) 계산 ---
  let desired: Vec;
  let turn: number = SIM.steerTurn;

  const flee = computeFlee(e, world, t, maxSpeed, canSwim, canLand);
  const fleeing = flee !== null;
  if (flee) {
    desired = flee;
    turn = SIM.fleeTurn; // 도망은 빠르게 반응(생존)
  } else {
    const goal = chooseGoal(e, world, vision, canHunt, canGraze);
    if (goal) {
      // 지형 길찾기: 목표가 직선으로 보이면 직진, 막혀 있으면 격자 BFS 경로를 따라 우회한다.
      const nav = navTo(e, world, goal, canSwim, canLand);
      // 최종 목표가 직선으로 보일 때만 도착 감속(arrive) — 가까울수록 줄여 오버슈트(와리가리)를 없앤다.
      // 사냥은 표적이 움직이므로 더 짧게(추격력 보존). 경유 웨이포인트는 감속 없이 전속 통과.
      const r = nav.final ? (e.targetPrey !== null ? SIM.huntArriveRadius : SIM.arriveRadius) : 0;
      desired = toward(nav.x - e.x, nav.y - e.y, maxSpeed, r);
    } else {
      e.path.length = 0; // 목표가 없으면 경로 버림(배회로 전환)
      e.pathGoalTile = -1;
      desired = wanderDesired(e, world, maxSpeed);
    }
    // 무리 cohesion: 무리에서 충분히 벗어났을 때만 무게중심으로 끌어당긴다.
    // 무리 안(comfort)에선 cohesion 0 — COM 이 격자 양자화로 매 틱 튀어, 늘 적용하면 무리 종이
    // 제자리에서 떤다. 벗어난 정도에 비례해 서서히 세져(램프) 경계에서의 떨림도 없앤다.
    if (nb && nb.count > 1) {
      const hdx = nb.comX - e.x;
      const hdy = nb.comY - e.y;
      const hd = Math.hypot(hdx, hdy);
      // 무게중심이 벽 너머(직선으로 안 보임)면 cohesion 을 끈다 — 못 가는 무리를 쫓아 벽에 정지하지
      // 않게(길찾기는 먹이 목표에만 적용되므로 cohesion 발 끼임은 여기서 막는다).
      if (hd > SIM.herdComfortRadius && world.terrain.lineOfSight(e.x, e.y, nb.comX, nb.comY, canSwim)) {
        const pull = Math.min(1, (hd - SIM.herdComfortRadius) / SIM.herdComfortRamp);
        const w = SIM.herdCohesion * t.herding * pull;
        const herd = scaleTo(hdx, hdy, maxSpeed);
        desired = {
          x: desired.x * (1 - w) + herd.x * w,
          y: desired.y * (1 - w) + herd.y * w,
        };
      }
    }
  }

  // --- 관성: 현재 속도를 desired 로 부드럽게 (홱 꺾임/제자리 떨림 제거) ---
  e.vx += (desired.x - e.vx) * turn;
  e.vy += (desired.y - e.vy) * turn;

  // --- 위치 갱신: 지형 차단(축 분리) → 월드 경계 반사 ---
  // 다음 위치가 막힌 타일(산 / 수영 못 하면 물)이면 그 축 이동만 취소해 벽을 따라 미끄러진다
  // (완전 반사보다 스티킹·떨림이 적다). maxSpeed < 타일폭이라 한 틱에 타일을 건너뛰지 않는다.
  const nx = e.x + e.vx;
  const ny = e.y + e.vy;
  if (world.terrain.isPassable(nx, e.y, canSwim, canLand)) e.x = nx;
  else e.vx = 0;
  if (world.terrain.isPassable(e.x, ny, canSwim, canLand)) e.y = ny;
  else e.vy = 0;
  if (e.x < 0) {
    e.x = 0;
    e.vx = -e.vx;
  } else if (e.x > world.width) {
    e.x = world.width;
    e.vx = -e.vx;
  }
  if (e.y < 0) {
    e.y = 0;
    e.vy = -e.vy;
  } else if (e.y > world.height) {
    e.y = world.height;
    e.vy = -e.vy;
  }

  // --- 섭취 / 사냥 (쫓던 목표가 사정거리면) ---
  if (!fleeing && e.targetPrey && e.targetPrey.alive) {
    const prey = e.targetPrey;
    const dx = prey.x - e.x;
    const dy = prey.y - e.y;
    if (dx * dx + dy * dy <= SIM.attackRange * SIM.attackRange) {
      const chance = clamp(
        SIM.killChanceBias + (t.attack - prey.genome.traits.attack) * SIM.killChanceScale,
        0.05,
        0.95,
      );
      if (world.rng.chance(chance)) {
        prey.alive = false;
        world.recordDeath(prey.species, "predation");
        world.emit("kill", prey.x, prey.y); // 연출: 잡아먹힘(빨강 터짐)
        e.energy = Math.min(SIM.maxEnergy, e.energy + SIM.predationEnergy);
        e.targetPrey = null;
      }
    }
  } else if (!fleeing && e.targetFood && e.targetFood.available) {
    const food = e.targetFood;
    const dx = food.x - e.x;
    const dy = food.y - e.y;
    if (dx * dx + dy * dy <= SIM.eatRadius * SIM.eatRadius) {
      e.energy = Math.min(SIM.maxEnergy, e.energy + SIM.foodEnergy);
      food.available = false;
      food.regrowTimer = Math.round(SIM.foodRegrowTicks * world.foodRegrowMultiplier);
      e.targetFood = null;
      if (e.species.isPlayer) world.playerFoodEaten += 1; // 레벨업 경험치 소스(내 종 섭취만)
    }
  }

  // --- 허기 + 노화. 추위(저대사 불리, 무리 보온으로 완화) + 폭염(고대사 불리). ---
  const env = world.environment.sampleAt(e.x, e.y);
  const huddle = nb ? Math.min(1, (nb.count - 1) / SIM.huddleFull) * t.herding : 0;
  const warmthFactor = 1 - SIM.huddleWarmth * huddle;
  // 평상시 추위(env.coldness)는 그대로, 대멸종 한파(globalCold)만 더 매섭게(클라이맥스 필터).
  const coldField = env.coldness + world.globalCold * SIM.globalColdLethality;
  const coldDrain = SIM.coldPenalty * coldField * (1 - t.metabolism) * warmthFactor;
  const heatDrain = SIM.heatPenalty * world.heat * t.metabolism;
  e.energy -= drain + coldDrain + heatDrain;
  e.age += 1;

  // --- 죽음 (사망 원인 집계, §7). 추위/폭염 소모가 기본 대사 소모보다 크면 그쪽으로 귀속. ---
  if (e.energy <= 0) {
    let cause: DeathCause = "starve";
    if (coldDrain >= heatDrain && coldDrain > drain) cause = "cold";
    else if (heatDrain > coldDrain && heatDrain > drain) cause = "heat";
    e.alive = false;
    world.recordDeath(e.species, cause);
    world.emit("death", e.x, e.y); // 연출: 자연사(회색 흩어짐)
    return;
  }
  if (e.age >= maxAge) {
    e.alive = false;
    world.recordDeath(e.species, "age");
    world.emit("death", e.x, e.y);
    return;
  }

  // --- 번식 (에너지 충분 + 확률, 상한 미만). 자식은 같은 종. ---
  if (
    world.entities.length + newborns.length < world.cap &&
    e.energy >= SIM.reproduceThreshold &&
    world.rng.chance(SIM.reproduceRate * (0.3 + t.fertility))
  ) {
    const childEnergy = e.energy * 0.5;
    e.energy -= childEnergy;
    const cx = e.x + world.rng.range(-6, 6);
    const cy = e.y + world.rng.range(-6, 6);
    // 막힌 타일에 태어나면 갇히므로 가장 가까운 통행 타일로 스냅(rng 미사용 → 결정론·밸런스 보존).
    const spot = world.terrain.nearestPassable(cx, cy, canSwim, canLand);
    newborns.push(createEntity(world.nextId(), spot.x, spot.y, e.species, childEnergy));
    world.emit("birth", spot.x, spot.y); // 연출: 탄생(초록 반짝)
  }
}

/** 보스/포식자가 도망 범위 안이면 도망 속도(단위×maxSpeed), 아니면 null. 도망 방향은 지형 회피로 보정. */
function computeFlee(
  e: Entity,
  world: World,
  t: Traits,
  maxSpeed: number,
  canSwim: boolean,
  canLand: boolean,
): Vec | null {
  const boss = world.boss;
  if (boss && boss.killRadius > 0) {
    const bdx = e.x - boss.x;
    const bdy = e.y - boss.y;
    const bd2 = bdx * bdx + bdy * bdy;
    const fr = boss.killRadius + SIM.fleeRadiusPad + boss.visionFlee * t.vision;
    if (bd2 < fr * fr) return clearFleeDir(e, world, bdx, bdy, maxSpeed, canSwim, canLand);
  }
  const predator = world.grid.nearestMatching(
    e.x,
    e.y,
    SIM.predatorSenseRange,
    (p) =>
      p.alive && p !== e && p.species.id !== e.species.id && !areFriends(e.species, p.species) &&
      p.genome.traits.diet > SIM.dietHuntMin && p.genome.traits.attack >= t.attack,
  );
  if (predator) {
    return clearFleeDir(e, world, e.x - predator.x, e.y - predator.y, maxSpeed, canSwim, canLand);
  }
  return null;
}

/**
 * 도망 방향(awayX,awayY)을 지형에 맞게 보정한다. 그 방향이 막혀(또는 막다른 곳이라) 있으면, 포식자
 * 에서 멀어지는 성분(cos off)과 현재 헤딩 일관성(진동 억제)을 함께 점수화해 통행 가능한 최선 방향으로
 * 튼다. 도망이 벽(물/산)으로 가 코너에 고립·잡히는 것을 줄인다. 헤딩 가중 덕에 avoidWalls 같은
 * 좌우 진동이 없고, probe 를 한 칸보다 멀리 봐서 막다른 반도·만으로 도망치는 것을 미리 피한다.
 */
function clearFleeDir(
  e: Entity,
  world: World,
  awayX: number,
  awayY: number,
  maxSpeed: number,
  canSwim: boolean,
  canLand: boolean,
): Vec {
  const d = Math.hypot(awayX, awayY);
  if (d < 1e-6) return { x: 0, y: 0 };
  const base = Math.atan2(awayY, awayX);
  const probe = world.terrain.cellSize * SIM.fleeProbeTiles;
  // 도망 방향이 probe 거리까지 트였으면 그대로(대부분).
  if (fleeClear(world, e.x, e.y, base, probe, canSwim, canLand)) {
    return { x: Math.cos(base) * maxSpeed, y: Math.sin(base) * maxSpeed };
  }
  // 막힘 — away 유지 + 헤딩 일관성으로 통행 가능한 최선 방향을 고른다.
  const heading = Math.atan2(e.vy, e.vx);
  let bestAng = base;
  let bestScore = -Infinity;
  for (const off of FLEE_OFFSETS) {
    const a = base + off;
    if (!fleeClear(world, e.x, e.y, a, probe, canSwim, canLand)) continue;
    const score = Math.cos(off) + SIM.fleeHeadingWeight * Math.cos(a - heading);
    if (score > bestScore) {
      bestScore = score;
      bestAng = a;
    }
  }
  return { x: Math.cos(bestAng) * maxSpeed, y: Math.sin(bestAng) * maxSpeed };
}

/** (x,y)에서 각도 ang 로 probe 거리까지 통행 가능한가(LOS). 끝점까지 보므로 막다른 곳을 미리 안다. */
function fleeClear(
  world: World,
  x: number,
  y: number,
  ang: number,
  probe: number,
  canSwim: boolean,
  canLand: boolean,
): boolean {
  return world.terrain.lineOfSight(
    x, y, x + Math.cos(ang) * probe, y + Math.sin(ang) * probe, canSwim, canLand,
  );
}

// 도망 회피 탐색 각(라디안). 0.4rad 씩 좌우로 점점 크게 — away 에 가까운(작은 편차) 통행 방향 우선.
const FLEE_OFFSETS: readonly number[] = [
  0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.0, -2.0, 2.4, -2.4, 2.8, -2.8,
];

/**
 * 쫓을 목표 좌표를 고른다. 기존 목표가 유효(존재·시야 안)하면 유지(hysteresis)해 목표 진동을 막고,
 * 무효일 때만 새로 가까운 것을 찾는다. 잡식은 먹잇감/식물 중 가까운 쪽에 commit.
 */
function chooseGoal(
  e: Entity,
  world: World,
  vision: number,
  canHunt: boolean,
  canGraze: boolean,
): Vec | null {
  const keep2 = (vision * SIM.targetKeepFactor) ** 2;

  // 식성으로 못 먹게 된 목표는 버린다(예: 드래프트로 육식이 되면 식물 목표 해제).
  if (!canHunt) e.targetPrey = null;
  if (!canGraze) e.targetFood = null;

  // 1) 기존 목표 유지 (조금 더 멀어져도 commit — 진동 방지)
  if (e.targetPrey) {
    const p = e.targetPrey;
    if (p.alive && p.species.id !== e.species.id && dist2(e, p) <= keep2) return { x: p.x, y: p.y };
    e.targetPrey = null;
  }
  if (e.targetFood) {
    const f = e.targetFood;
    if (f.available && dist2(e, f) <= keep2) return { x: f.x, y: f.y };
    e.targetFood = null;
  }

  // 2) 새 목표 탐색 — 시야각(부채꼴): 움직일 때는 보는 방향(=이동 방향) 기준 FOV 안만 새로 발견한다.
  //    (이미 쫓던 목표는 1)에서 유지 — 인지한 건 시야각 밖이라도 계속 본다. 정지·저속이면 전방위로 두리번.)
  const inFov = makeFovTest(e);
  let prey: Entity | null = null;
  let food: Food | null = null;
  if (canHunt) {
    prey = world.grid.nearestMatching(
      e.x,
      e.y,
      vision,
      (p) =>
        p.alive && p !== e && p.species.id !== e.species.id &&
        !areFriends(e.species, p.species) && inFov(p.x, p.y),
    );
  }
  if (canGraze) food = nearestFood(e, world, vision, inFov);
  if (prey && food) {
    if (dist2(e, prey) <= dist2(e, food)) food = null;
    else prey = null;
  }
  if (prey) {
    e.targetPrey = prey;
    return { x: prey.x, y: prey.y };
  }
  if (food) {
    e.targetFood = food;
    return { x: food.x, y: food.y };
  }
  return null;
}

/**
 * 목표(goal)로 향하는 다음 지점을 돌려준다(+ 그것이 최종 목표인지 final).
 *  1) 목표가 직선으로 보이면 그대로 직진(final=true) — 대부분의 경우, BFS 없이 가볍다.
 *  2) 막혀 있으면 격자 BFS 경로(캐시)를 따라 다음 웨이포인트로 향한다(final=false, 경유라 감속 안 함).
 *  3) 다음 웨이포인트가 보이면 현재 것을 건너뛰어(funnel) 계단형 경로를 부드럽게 단축한다.
 * 반응형 회피(avoidWalls)의 좌우 진동·local minima 없이 "막히면 못 돌아간다"를 근본 해결한다.
 */
function navTo(
  e: Entity,
  world: World,
  goal: Vec,
  canSwim: boolean,
  canLand: boolean,
): { x: number; y: number; final: boolean } {
  const terr = world.terrain;
  // 1) 직선으로 보이면 직진 — 경로 버림.
  if (terr.lineOfSight(e.x, e.y, goal.x, goal.y, canSwim, canLand)) {
    if (e.path.length > 0) {
      e.path.length = 0;
      e.pathGoalTile = -1;
    }
    return { x: goal.x, y: goal.y, final: true };
  }
  // 2) 막힘 — 목표 타일이 바뀌었거나 경로가 없으면 BFS 재계산(그 외엔 캐시 재사용).
  const goalTile = terr.tileIndex(goal.x, goal.y);
  if (e.pathGoalTile !== goalTile || e.path.length === 0) {
    e.path = terr.findPath(e.x, e.y, goal.x, goal.y, canSwim, canLand);
    e.pathGoalTile = goalTile;
  }
  // 3) 경로 단축(funnel): 다음 웨이포인트가 보이면 현재 것을 건너뛴다.
  while (e.path.length >= 2) {
    const w1 = e.path[1] as number;
    if (terr.lineOfSight(e.x, e.y, terr.tileCenterX(w1), terr.tileCenterY(w1), canSwim, canLand)) {
      e.path.shift();
    } else break;
  }
  // 4) 현재 웨이포인트에 충분히 닿으면 소비.
  if (e.path.length > 0) {
    const w0 = e.path[0] as number;
    const wx = terr.tileCenterX(w0);
    const wy = terr.tileCenterY(w0);
    const reach = terr.cellSize * 0.6;
    if ((e.x - wx) ** 2 + (e.y - wy) ** 2 < reach * reach) e.path.shift();
  }
  // 경로 소진/못 찾음 → 목표로 직진 시도(axis sliding 이 막아주니 갇히진 않는다).
  if (e.path.length === 0) return { x: goal.x, y: goal.y, final: true };
  const w = e.path[0] as number;
  return { x: terr.tileCenterX(w), y: terr.tileCenterY(w), final: false };
}

/** 목표가 없을 때: 보존된 헤딩을 조금씩 흔들며 순항(멈추지 않고 부드럽게 떠돈다). */
function wanderDesired(e: Entity, world: World, maxSpeed: number): Vec {
  const cruise = maxSpeed * SIM.cruiseFactor;
  // 헤딩을 개체에 보존해 조금씩만 흔든다 — 매 틱 큰 난수로 재추첨하거나 노이즈 큰 속도 방향에
  // 기대면 느린 종이 제자리에서 떤다(부들거림). 작은 누적 흔들림이라야 부드러운 떠돌기가 된다.
  e.wanderAngle += world.rng.range(-SIM.wanderTurn, SIM.wanderTurn);
  return { x: Math.cos(e.wanderAngle) * cruise, y: Math.sin(e.wanderAngle) * cruise };
}

function nearestFood(
  e: Entity,
  world: World,
  vision: number,
  inFov: (tx: number, ty: number) => boolean,
): Food | null {
  const kinds = e.species.foodKinds;
  const canSwim = e.genome.traits.swimming >= SIM.swimThreshold;
  // 먹이 공간 격자로 시야 반경 안만 검사(완전탐색 대신 — 큰 맵 성능). available·종류·시야각은 pred 로.
  return world.foodGrid.nearest(e.x, e.y, vision, (f) => {
    if (!f.available) return false;
    if (f.aquatic) {
      if (!canSwim) return false; // 바다 먹이는 수영 형질이 충분한 종만 먹는다(육상 종엔 무경쟁 틈새)
    } else if (!kinds.includes(f.kind)) {
      return false; // 이 종이 못 먹는 먹이 종류는 건너뛴다(먹이 분할)
    }
    return inFov(f.x, f.y); // 시야각(부채꼴) 밖 — 보는 방향에서 벗어난 먹이는 아직 못 본다
  });
}

/**
 * 개체가 보는 방향(=이동 방향) 기준 시야각 안인지 판정하는 함수를 만든다. 움직일 때만 부채꼴이고,
 * 정지·저속(fovMinSpeed 미만)이면 항상 true(전방위 — 멈춰선 두리번거린다). dot 곱으로 가볍게 판정.
 * (단위 테스트용 export.)
 */
export function makeFovTest(e: Entity): (tx: number, ty: number) => boolean {
  const speed = Math.hypot(e.vx, e.vy);
  if (speed <= SIM.fovMinSpeed) return () => true;
  const fvx = e.vx / speed;
  const fvy = e.vy / speed;
  return (tx: number, ty: number): boolean => {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const d = Math.hypot(dx, dy);
    return d < 1e-6 || (fvx * dx + fvy * dy) / d >= SIM.fovHalfCos;
  };
}

/**
 * 밤 시야 배율. daylight 1(정오)=1.0(영향 없음), 0(자정)=가장 어두움. vision 형질이 높을수록 밤
 * 하한이 올라간다(야행성 — 큰 눈은 밤에도 본다). 낮↔밤을 daylight 로 부드럽게 보간. (단위 테스트용 export)
 */
export function nightVisionFactor(daylight: number, vision: number): number {
  const nightMin = SIM.nightVisionFloor + SIM.nightVisionBonus * vision;
  return nightMin + (1 - nightMin) * daylight;
}

/** (dx,dy) 를 길이 len 으로 정규화. 0 벡터는 0 그대로. */
function scaleTo(dx: number, dy: number, len: number): Vec {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: 0, y: 0 };
  return { x: (dx / d) * len, y: (dy / d) * len };
}

/**
 * (dx,dy) 방향으로 향하는 desired 속도. arriveRadius>0 이면 그 거리 안에서 선형 감속(도착)해
 * 목표를 지나쳐 진동하는 오버슈트를 없앤다. arriveRadius=0 이면 전속(scaleTo 와 동일).
 */
function toward(dx: number, dy: number, maxSpeed: number, arriveRadius: number): Vec {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: 0, y: 0 };
  const speed = arriveRadius > 0 ? maxSpeed * Math.min(1, d / arriveRadius) : maxSpeed;
  return { x: (dx / d) * speed, y: (dy / d) * speed };
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
