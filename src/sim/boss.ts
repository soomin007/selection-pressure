// 보스 (Phase 5). 기획서 §4: "정해진 관문 통과 여부로 판정" → 버티기(endure) 게이트.
// 핵심: 보스마다 치명도를 "의도한 카운터 형질"로 게이팅해, 그 형질을 키운 종만 버틴다.
//   chaser 빠른 추격자  → 속도(도망)        : 닿으면 즉사, 빠르면 도망
//   titan  거대 포식자  → 시야(일찍 발견)    : 즉사 반경 크지만, 시야 높으면 일찍 도망
//   swarm  사나운 무리  → 번식력(소모전)     : 매 틱 일부를 솎아냄, 번식으로 메워야 함
//   poison 독 안개      → 낮은 대사(흡수 저항): 매 틱 에너지 흡수, 대사 높을수록 더 많이 빨림
// 통과 = 관전 끝까지 개체 수가 기준 이상 생존. 순수 TS, 결정론(무작위는 world.rng).

import type { World } from "@/sim/world";
import type { Rng } from "@/sim/rng";

export type BossType = "chaser" | "swarm" | "poison" | "titan";

export interface Boss {
  type: BossType;
  name: string;
  x: number;
  y: number;
  speed: number;
  killRadius: number; // 닿으면 즉사하는 반경 (0 = 없음)
  visionFlee: number; // 도망 반경에 시야를 곱해 더하는 정도(titan: 시야가 카운터)
  auraRadius: number; // 시각용 위험 반경(독 안개)
  globalKillRate: number; // 매 틱 개체가 솎일 확률(swarm)
  globalDrain: number; // 매 틱 전역 에너지 흡수 (×(0.3+metabolism)) (poison)
}

interface Preset extends Omit<Boss, "type" | "name" | "x" | "y"> {
  name: string;
  threat: string;
  counter: string;
}

const PRESETS: Record<BossType, Preset> = {
  chaser: {
    name: "빠른 추격자",
    speed: 2.9,
    killRadius: 16,
    visionFlee: 0,
    auraRadius: 0,
    globalKillRate: 0,
    globalDrain: 0,
    threat: "아주 빠르게 쫓아와 닿으면 잡아먹습니다.",
    counter: "속도가 높아야 도망칠 수 있습니다.",
  },
  titan: {
    name: "거대 포식자",
    speed: 1.2,
    killRadius: 68,
    visionFlee: 150, // 시야가 높으면 훨씬 일찍 도망친다
    auraRadius: 0,
    globalKillRate: 0,
    globalDrain: 0,
    threat: "느리지만 거대해 가까이 가면 잡아먹습니다.",
    counter: "시야가 넓어야 일찍 보고 피합니다.",
  },
  swarm: {
    name: "사나운 무리",
    speed: 2.0,
    killRadius: 0,
    visionFlee: 0,
    auraRadius: 0,
    globalKillRate: 0.0024, // 매 틱 약 0.24% 솎임 (건강한 큰 무리만 버틴다)
    globalDrain: 0,
    threat: "쉴 새 없이 개체를 하나씩 솎아냅니다.",
    counter: "개체 수가 많고 건강해야 버팁니다.",
  },
  poison: {
    name: "독 안개",
    speed: 0.9,
    killRadius: 0,
    visionFlee: 0,
    auraRadius: 230,
    globalKillRate: 0,
    globalDrain: 0.3, // ×(0.3+metabolism): 대사 높을수록 더 빨림 (건강한 무리는 카운터 없이도 버티게)
    threat: "온 땅의 에너지를 계속 빨아들입니다.",
    counter: "대사가 낮아야 덜 빨리고 견딥니다.",
  },
};

// titan(거대 포식자)은 느려서 누구나 쉽게 도망 → 위협이 안 됨. 풀에서 제외(프리셋은 보존).
export const BOSS_TYPES: readonly BossType[] = ["chaser", "swarm", "poison"];

export function createBoss(type: BossType, width: number, height: number): Boss {
  const p = PRESETS[type];
  return {
    type,
    name: p.name,
    x: width * 0.5,
    y: height * 0.22,
    speed: p.speed,
    killRadius: p.killRadius,
    visionFlee: p.visionFlee,
    auraRadius: p.auraRadius,
    globalKillRate: p.globalKillRate,
    globalDrain: p.globalDrain,
  };
}

/** 전투 전 위협 예고 문구 (쉬운 말). */
export function bossPreview(type: BossType): string {
  const p = PRESETS[type];
  return `${p.name} — ${p.threat} ${p.counter}`;
}

export function bossName(type: BossType): string {
  return PRESETS[type].name;
}

export function pickBossType(rng: Rng): BossType {
  return rng.pick(BOSS_TYPES);
}

/** 보스 한 틱. 타입별로 다른 압박을 가한다. */
export function stepBoss(boss: Boss, world: World): void {
  moveTowardNearest(boss, world);

  if (boss.killRadius > 0) {
    const killR2 = boss.killRadius * boss.killRadius;
    for (const e of world.entities) {
      if (!e.alive) continue;
      const dx = e.x - boss.x;
      const dy = e.y - boss.y;
      if (dx * dx + dy * dy < killR2) {
        e.alive = false;
        world.recordDeath(e.species, "boss");
      }
    }
  }

  if (boss.globalKillRate > 0) {
    for (const e of world.entities) {
      if (!e.alive) continue;
      if (world.rng.unit() < boss.globalKillRate) {
        e.alive = false;
        world.recordDeath(e.species, "boss");
      }
    }
  }

  if (boss.globalDrain > 0) {
    for (const e of world.entities) {
      if (!e.alive) continue;
      e.energy -= boss.globalDrain * (0.3 + e.genome.traits.metabolism);
      if (e.energy <= 0) {
        e.alive = false;
        world.recordDeath(e.species, "boss");
      }
    }
  }
}

function moveTowardNearest(boss: Boss, world: World): void {
  if (boss.speed <= 0) return;
  let best = Infinity;
  let tx = 0;
  let ty = 0;
  let found = false;
  for (const e of world.entities) {
    if (!e.alive) continue;
    const dx = e.x - boss.x;
    const dy = e.y - boss.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      tx = e.x;
      ty = e.y;
      found = true;
    }
  }
  if (!found) return;
  const d = Math.sqrt(best) || 1;
  boss.x += ((tx - boss.x) / d) * boss.speed;
  boss.y += ((ty - boss.y) / d) * boss.speed;
}
