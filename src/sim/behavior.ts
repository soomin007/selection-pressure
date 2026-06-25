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
    desired = goal
      ? scaleTo(goal.x - e.x, goal.y - e.y, maxSpeed)
      : wanderDesired(e, world, maxSpeed);
    // 무리 cohesion: 무게중심 방향을 desired 에 섞는다(분리된 블렌드 대신).
    if (nb && nb.count > 1) {
      const hdx = nb.comX - e.x;
      const hdy = nb.comY - e.y;
      if (Math.hypot(hdx, hdy) > 1) {
        const w = SIM.herdCohesion * t.herding;
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

  // --- 위치 갱신 + 벽 반사 ---
  e.x += e.vx;
  e.y += e.vy;
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
    return;
  }
  if (e.age >= maxAge) {
    e.alive = false;
    world.recordDeath(e.species, "age");
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
    newborns.push(
      createEntity(
        world.nextId(),
        e.x + world.rng.range(-6, 6),
        e.y + world.rng.range(-6, 6),
        e.species,
        childEnergy,
      ),
    );
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

/** 목표가 없을 때: 진행 방향을 조금씩 틀며 순항(멈추지 않고 자연스럽게 떠돈다). */
function wanderDesired(e: Entity, world: World, maxSpeed: number): Vec {
  const cruise = maxSpeed * SIM.cruiseFactor;
  const speed = Math.hypot(e.vx, e.vy);
  const heading =
    speed < 0.001
      ? world.rng.range(0, Math.PI * 2)
      : Math.atan2(e.vy, e.vx) + world.rng.range(-SIM.wanderTurn, SIM.wanderTurn);
  return { x: Math.cos(heading) * cruise, y: Math.sin(heading) * cruise };
}

function nearestFood(e: Entity, world: World, maxDist2: number): Food | null {
  let best = maxDist2;
  let found: Food | null = null;
  for (const f of world.food) {
    if (!f.available) continue;
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

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
