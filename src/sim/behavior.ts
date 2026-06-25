// 규칙기반 개체 행동 (기획서 §3.3). ML 아님 — 게놈 × 단순 규칙 × 환경.
// Phase 1 규칙: 채집(먹이로 이동) · 허기(에너지 소모) · 죽음 · 단순 번식.
// 무리짓기(boids)·도망·전투·식성(육식)은 Phase 1 후반/Phase 2.
//
// 결정론 유지: 모든 무작위는 world.rng 만 쓰고, 개체는 항상 같은 순서로 처리된다.

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
  // 수명은 대사와 분리(§3.1: 대사 = 소모/내한성). 고대사가 이중 페널티를 받지 않게.
  const maxAge = SIM.baseMaxAge;

  // 0) 보스 회피: 즉사형 보스가 가까우면 먹이를 무시하고 반대로 도망친다(속도가 생명).
  let fleeing = false;
  const boss = world.boss;
  if (boss && boss.killRadius > 0) {
    const bdx = e.x - boss.x;
    const bdy = e.y - boss.y;
    const bd2 = bdx * bdx + bdy * bdy;
    // titan 은 시야가 높을수록 도망 반경이 커진다(일찍 보고 피함).
    const fr = boss.killRadius + SIM.fleeRadiusPad + boss.visionFlee * t.vision;
    if (bd2 < fr * fr) {
      const bd = Math.sqrt(bd2) || 1;
      e.vx = (bdx / bd) * maxSpeed;
      e.vy = (bdy / bd) * maxSpeed;
      fleeing = true;
    }
  }

  // 1) 감지: 시야 안에서 가장 가까운 먹이 (도망 중엔 생략)
  const target = fleeing ? null : nearestFood(e, world, vision * vision);

  // 2) 이동: 도망 중이면 위에서 정함. 아니면 먹이로, 없으면 배회.
  if (fleeing) {
    // 속도 이미 설정됨
  } else if (target) {
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.vx = (dx / d) * maxSpeed;
    e.vy = (dy / d) * maxSpeed;
  } else {
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

  e.x += e.vx;
  e.y += e.vy;

  // 벽에서 반사
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

  // 3) 섭취: 먹이에 닿으면 먹는다
  if (target && target.available) {
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    if (dx * dx + dy * dy <= SIM.eatRadius * SIM.eatRadius) {
      e.energy = Math.min(SIM.maxEnergy, e.energy + SIM.foodEnergy);
      target.available = false;
      target.regrowTimer = Math.round(SIM.foodRegrowTicks * world.foodRegrowMultiplier);
    }
  }

  // 4) 허기 + 노화. 추위(저대사 불리) + 폭염(고대사 불리)은 추가 소모.
  const env = world.environment.sampleAt(e.x, e.y);
  // 맵 추위(coldness≤1) + 대멸종 한파(globalCold). 한파는 캡 없이 가중된다.
  const coldDrain = SIM.coldPenalty * (env.coldness + world.globalCold) * (1 - t.metabolism);
  const heatDrain = SIM.heatPenalty * world.heat * t.metabolism;
  e.energy -= drain + coldDrain + heatDrain;
  e.age += 1;

  // 5) 죽음
  if (e.energy <= 0 || e.age >= maxAge) {
    e.alive = false;
    return;
  }

  // 6) 번식 (에너지 충분 + 확률, 상한 미만)
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
        e.genome,
        childEnergy,
      ),
    );
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
