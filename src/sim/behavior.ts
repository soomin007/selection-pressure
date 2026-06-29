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
import { SIM } from "@/sim/params";

interface Vec {
  x: number;
  y: number;
}

export function stepEntity(e: Entity, world: World, newborns: Entity[]): void {
  const t = e.genome.traits;
  const maxSpeed = SIM.maxSpeedBase * (0.4 + t.speed);
  const vision = SIM.visionBase * (0.4 + t.vision);
  const drain = SIM.metabolismDrain * (0.5 + t.metabolism);
  const maxAge = SIM.baseMaxAge;
  // 식성 구간: 초식(<0.35) 식물만 / 잡식(0.35~0.7) 둘 다 / 육식(>0.7) 사냥만.
  const canHunt = t.diet > SIM.dietHuntMin;
  const canGraze = t.diet < SIM.dietGrazeMax;
  // 수영 종만 물에 들어갈 수 있다(산은 누구도 못 넘는다) — 이동 차단·번식 스폰에 함께 쓴다.
  const canSwim = t.swimming >= SIM.swimThreshold;

  // 무리 이웃(3×3 칸) — cohesion(이동)과 huddle(보온)에 함께 쓴다.
  const nb = t.herding > 0.01 ? world.grid.neighborhood(e.x, e.y) : null;

  // --- 원하는 속도(desired) 계산 ---
  let desired: Vec;
  let turn: number = SIM.steerTurn;

  const flee = computeFlee(e, world, t, maxSpeed);
  const fleeing = flee !== null;
  if (flee) {
    desired = flee;
    turn = SIM.fleeTurn; // 도망은 빠르게 반응(생존)
  } else {
    const goal = chooseGoal(e, world, vision, canHunt, canGraze);
    if (goal) {
      // 먹이/먹잇감 모두 도착 감속(arrive) — 가까울수록 속도를 줄여 목표를 지나쳐 되돌아가는
      // 오버슈트(와리가리)를 없앤다. 사냥은 표적이 움직이므로 더 짧은 반경(공격 사거리 부근에서만
      // 감속)이라 추격력은 보존된다.
      const r = e.targetPrey !== null ? SIM.huntArriveRadius : SIM.arriveRadius;
      desired = toward(goal.x - e.x, goal.y - e.y, maxSpeed, r);
    } else {
      desired = wanderDesired(e, world, maxSpeed);
    }
    // 무리 cohesion: 무리에서 충분히 벗어났을 때만 무게중심으로 끌어당긴다.
    // 무리 안(comfort)에선 cohesion 0 — COM 이 격자 양자화로 매 틱 튀어, 늘 적용하면 무리 종이
    // 제자리에서 떤다. 벗어난 정도에 비례해 서서히 세져(램프) 경계에서의 떨림도 없앤다.
    if (nb && nb.count > 1) {
      const hdx = nb.comX - e.x;
      const hdy = nb.comY - e.y;
      const hd = Math.hypot(hdx, hdy);
      if (hd > SIM.herdComfortRadius) {
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

  // --- 벽 회피: 가려는 방향 앞이 막혔으면 목표에 가장 가까운 통행 가능 방향으로 desired 를 돌린다.
  // 벽에 정면으로 박혀 멈추는 대신 벽을 따라 비스듬히 흐르며 우회한다(목표가 벽 너머여도 돌아간다). ---
  desired = avoidWalls(world, e.x, e.y, desired, canSwim);

  // --- 관성: 현재 속도를 desired 로 부드럽게 (홱 꺾임/제자리 떨림 제거) ---
  e.vx += (desired.x - e.vx) * turn;
  e.vy += (desired.y - e.vy) * turn;

  // --- 위치 갱신: 지형 차단(축 분리) → 월드 경계 반사 ---
  // 다음 위치가 막힌 타일(산 / 수영 못 하면 물)이면 그 축 이동만 취소해 벽을 따라 미끄러진다
  // (완전 반사보다 스티킹·떨림이 적다). maxSpeed < 타일폭이라 한 틱에 타일을 건너뛰지 않는다.
  const nx = e.x + e.vx;
  const ny = e.y + e.vy;
  if (world.terrain.isPassable(nx, e.y, canSwim)) e.x = nx;
  else e.vx = 0;
  if (world.terrain.isPassable(e.x, ny, canSwim)) e.y = ny;
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
    world.entities.length + newborns.length < SIM.populationCap &&
    e.energy >= SIM.reproduceThreshold &&
    world.rng.chance(SIM.reproduceRate * (0.3 + t.fertility))
  ) {
    const childEnergy = e.energy * 0.5;
    e.energy -= childEnergy;
    const cx = e.x + world.rng.range(-6, 6);
    const cy = e.y + world.rng.range(-6, 6);
    // 막힌 타일에 태어나면 갇히므로 가장 가까운 통행 타일로 스냅(rng 미사용 → 결정론·밸런스 보존).
    const spot = world.terrain.nearestPassable(cx, cy, canSwim);
    newborns.push(createEntity(world.nextId(), spot.x, spot.y, e.species, childEnergy));
    world.emit("birth", spot.x, spot.y); // 연출: 탄생(초록 반짝)
  }
}

/** 보스/포식자가 도망 범위 안이면 도망 속도(단위×maxSpeed), 아니면 null. */
function computeFlee(e: Entity, world: World, t: Traits, maxSpeed: number): Vec | null {
  const boss = world.boss;
  if (boss && boss.killRadius > 0) {
    const bdx = e.x - boss.x;
    const bdy = e.y - boss.y;
    const bd2 = bdx * bdx + bdy * bdy;
    const fr = boss.killRadius + SIM.fleeRadiusPad + boss.visionFlee * t.vision;
    if (bd2 < fr * fr) return scaleTo(bdx, bdy, maxSpeed);
  }
  const predator = world.grid.nearestMatching(
    e.x,
    e.y,
    SIM.predatorSenseRange,
    (p) =>
      p.alive && p !== e && p.species.id !== e.species.id &&
      p.genome.traits.diet > SIM.dietHuntMin && p.genome.traits.attack >= t.attack,
  );
  if (predator) return scaleTo(e.x - predator.x, e.y - predator.y, maxSpeed);
  return null;
}

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

  // 2) 새 목표 탐색
  let prey: Entity | null = null;
  let food: Food | null = null;
  if (canHunt) {
    prey = world.grid.nearestMatching(
      e.x,
      e.y,
      vision,
      (p) => p.alive && p !== e && p.species.id !== e.species.id,
    );
  }
  if (canGraze) food = nearestFood(e, world, vision * vision);
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
 * 가려는 방향(desired) 앞이 막혔으면, 목표에 가장 가까운(작은 회피각) 통행 가능 방향으로 desired 를
 * 회전시킨다. 좌우로 번갈아 각을 벌려가며 한 타일 앞이 트인 첫 방향을 고른다 — 벽에 정면으로 박혀
 * 멈추는 대신 벽을 따라 우회하게 한다(목표가 벽 너머여도 돌아간다). 속도 크기(speed)는 보존.
 * 목표 추적·배회·도망 desired 모두에 적용되므로 "막히면 못 돌아간다"를 근본적으로 푼다.
 */
function avoidWalls(world: World, x: number, y: number, desired: Vec, canSwim: boolean): Vec {
  const speed = Math.hypot(desired.x, desired.y);
  if (speed < 1e-6) return desired;
  const probe = world.terrain.cellSize; // 한 타일 앞을 보고 미리 우회
  const base = Math.atan2(desired.y, desired.x);
  if (world.terrain.isPassable(x + Math.cos(base) * probe, y + Math.sin(base) * probe, canSwim)) {
    return desired; // 앞이 트였으면 그대로
  }
  for (const off of WALL_AVOID_OFFSETS) {
    const a = base + off;
    if (world.terrain.isPassable(x + Math.cos(a) * probe, y + Math.sin(a) * probe, canSwim)) {
      return { x: Math.cos(a) * speed, y: Math.sin(a) * speed };
    }
  }
  return desired; // 사방이 막힌 극단(거의 없음) — axis sliding + 배회가 결국 빼낸다
}

// 회피 탐색 각(라디안). 0.35rad(~20°)씩 좌우 번갈아 점점 크게 — 가장 작은 우회각을 먼저 고른다.
const WALL_AVOID_OFFSETS: readonly number[] = [
  0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4,
  1.75, -1.75, 2.1, -2.1, 2.45, -2.45, 2.8, -2.8,
];

/** 목표가 없을 때: 보존된 헤딩을 조금씩 흔들며 순항(멈추지 않고 부드럽게 떠돈다). */
function wanderDesired(e: Entity, world: World, maxSpeed: number): Vec {
  const cruise = maxSpeed * SIM.cruiseFactor;
  // 헤딩을 개체에 보존해 조금씩만 흔든다 — 매 틱 큰 난수로 재추첨하거나 노이즈 큰 속도 방향에
  // 기대면 느린 종이 제자리에서 떤다(부들거림). 작은 누적 흔들림이라야 부드러운 떠돌기가 된다.
  e.wanderAngle += world.rng.range(-SIM.wanderTurn, SIM.wanderTurn);
  return { x: Math.cos(e.wanderAngle) * cruise, y: Math.sin(e.wanderAngle) * cruise };
}

function nearestFood(e: Entity, world: World, maxDist2: number): Food | null {
  let best = maxDist2;
  let found: Food | null = null;
  const kinds = e.species.foodKinds;
  const canSwim = e.genome.traits.swimming >= SIM.swimThreshold;
  for (const f of world.food) {
    if (!f.available) continue;
    if (f.aquatic) {
      if (!canSwim) continue; // 바다 먹이는 수영 형질이 충분한 종만 먹는다(육상 종엔 무경쟁 틈새)
    } else if (!kinds.includes(f.kind)) {
      continue; // 이 종이 못 먹는 먹이 종류는 건너뛴다(먹이 분할)
    }
    const dx = f.x - e.x;
    const dy = f.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      found = f;
    }
  }
  return found;
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
