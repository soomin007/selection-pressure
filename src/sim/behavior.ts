// 규칙기반 개체 행동 (기획서 §3.3). ML 아님 — 게놈 × 단순 규칙 × 환경.
// 다종 생태계: 초식은 식물을, 육식은 다른 종을 먹는다. 포식자는 피하고(속도), 사냥은 공격력으로.
// 무리 성향은 모임(cohesion) + 보온(huddle). 결정론: 무작위는 world.rng 만, 처리 순서 고정.

import type { World } from "@/sim/world";
import type { Entity } from "@/sim/entity";
import type { Food } from "@/sim/food";
import { createEntity } from "@/sim/entity";
import { SIM } from "@/sim/params";

export function stepEntity(e: Entity, world: World, newborns: Entity[]): void {
  const t = e.genome.traits;
  const maxSpeed = SIM.maxSpeedBase * (0.4 + t.speed);
  const vision = SIM.visionBase * (0.4 + t.vision);
  const drain = SIM.metabolismDrain * (0.5 + t.metabolism);
  const maxAge = SIM.baseMaxAge;
  const carnivore = t.diet > 0.5;

  // 0) 위협 회피: 즉사 보스 또는 (나보다 센) 포식자가 가까우면 도망(속도가 생명).
  let fleeing = false;
  const boss = world.boss;
  if (boss && boss.killRadius > 0) {
    const bdx = e.x - boss.x;
    const bdy = e.y - boss.y;
    const bd2 = bdx * bdx + bdy * bdy;
    const fr = boss.killRadius + SIM.fleeRadiusPad + boss.visionFlee * t.vision;
    if (bd2 < fr * fr) {
      const bd = Math.sqrt(bd2) || 1;
      e.vx = (bdx / bd) * maxSpeed;
      e.vy = (bdy / bd) * maxSpeed;
      fleeing = true;
    }
  }
  if (!fleeing) {
    const predator = world.grid.nearestMatching(
      e.x,
      e.y,
      SIM.predatorSenseRange,
      (p) =>
        p.alive && p !== e && p.species.id !== e.species.id && p.genome.traits.diet > 0.5 &&
        p.genome.traits.attack >= t.attack,
    );
    if (predator) {
      const dx = e.x - predator.x;
      const dy = e.y - predator.y;
      const d = Math.hypot(dx, dy) || 1;
      e.vx = (dx / d) * maxSpeed;
      e.vy = (dy / d) * maxSpeed;
      fleeing = true;
    }
  }

  // 1) 목표 선택 + 이동 (도망 중이 아니면)
  let food: Food | null = null;
  let prey: Entity | null = null;
  if (!fleeing) {
    if (carnivore) {
      prey = world.grid.nearestMatching(
        e.x,
        e.y,
        vision,
        (p) => p.alive && p !== e && p.species.id !== e.species.id,
      );
      steerOrWander(e, world, maxSpeed, prey ? prey.x : null, prey ? prey.y : null);
    } else {
      food = nearestFood(e, world, vision * vision);
      steerOrWander(e, world, maxSpeed, food ? food.x : null, food ? food.y : null);
    }
  }

  // 1b) 무리 이동(cohesion): 도망 중이 아니고 무리 성향이 있으면 무게중심으로 끌린다.
  const nb = t.herding > 0.01 ? world.grid.neighborhood(e.x, e.y) : null;
  if (!fleeing && nb && nb.count > 1) {
    const hdx = nb.comX - e.x;
    const hdy = nb.comY - e.y;
    const hd = Math.hypot(hdx, hdy);
    if (hd > 1) {
      const w = SIM.herdCohesion * t.herding;
      e.vx = e.vx * (1 - w) + (hdx / hd) * maxSpeed * w;
      e.vy = e.vy * (1 - w) + (hdy / hd) * maxSpeed * w;
    }
  }

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

  // 2) 섭취 / 사냥
  if (!fleeing && carnivore && prey && prey.alive) {
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
        e.energy = Math.min(SIM.maxEnergy, e.energy + SIM.predationEnergy);
      }
    }
  } else if (!fleeing && !carnivore && food && food.available) {
    const dx = food.x - e.x;
    const dy = food.y - e.y;
    if (dx * dx + dy * dy <= SIM.eatRadius * SIM.eatRadius) {
      e.energy = Math.min(SIM.maxEnergy, e.energy + SIM.foodEnergy);
      food.available = false;
      food.regrowTimer = Math.round(SIM.foodRegrowTicks * world.foodRegrowMultiplier);
    }
  }

  // 3) 허기 + 노화. 추위(저대사 불리, 무리 보온으로 완화) + 폭염(고대사 불리).
  const env = world.environment.sampleAt(e.x, e.y);
  const huddle = nb ? Math.min(1, (nb.count - 1) / SIM.huddleFull) * t.herding : 0;
  const warmthFactor = 1 - SIM.huddleWarmth * huddle;
  const coldDrain =
    SIM.coldPenalty * (env.coldness + world.globalCold) * (1 - t.metabolism) * warmthFactor;
  const heatDrain = SIM.heatPenalty * world.heat * t.metabolism;
  e.energy -= drain + coldDrain + heatDrain;
  e.age += 1;

  // 4) 죽음
  if (e.energy <= 0 || e.age >= maxAge) {
    e.alive = false;
    return;
  }

  // 5) 번식 (에너지 충분 + 확률, 상한 미만). 자식은 같은 종.
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

/** 목표가 있으면 그쪽으로 최대 속도, 없으면 배회. */
function steerOrWander(
  e: Entity,
  world: World,
  maxSpeed: number,
  tx: number | null,
  ty: number | null,
): void {
  if (tx !== null && ty !== null) {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.vx = (dx / d) * maxSpeed;
    e.vy = (dy / d) * maxSpeed;
    return;
  }
  const speed = Math.hypot(e.vx, e.vy);
  const cruise = maxSpeed * 0.5;
  if (speed < 0.001) {
    const a = world.rng.range(0, Math.PI * 2);
    e.vx = Math.cos(a) * cruise;
    e.vy = Math.sin(a) * cruise;
  } else {
    const a = Math.atan2(e.vy, e.vx) + world.rng.range(-SIM.wanderTurn, SIM.wanderTurn);
    e.vx = Math.cos(a) * cruise;
    e.vy = Math.sin(a) * cruise;
  }
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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
