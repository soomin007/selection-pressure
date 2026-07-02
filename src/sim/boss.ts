// 보스 (Phase 5). 기획서 §4: "정해진 관문 통과 여부로 판정" → 버티기(endure) 게이트.
// 핵심: 보스마다 치명도를 "의도한 카운터 형질"로 게이팅해, 그 형질을 키운 종만 버틴다.
//   chaser  빠른 추격자  → 속도(도망)        : 닿으면 즉사, 빠르면 도망
//   titan   거대 포식자  → 시야(일찍 발견)    : 즉사 반경 크지만, 시야 높으면 일찍 도망(느려서 비활성)
//   swarm   사나운 무리  → 번식력(소모전)     : 매 틱 일부를 솎아냄, 번식으로 메워야 함
//   poison  독 안개      → 낮은 대사(흡수 저항): 매 틱 에너지 흡수, 대사 높을수록 더 많이 빨림
//   stalker 그림자 매복자 → 시야(미리 발견)    : 숨어 덮쳐 솎되, 시야 높을수록 미리 보고 피함
// 통과 = 관전 끝까지 개체 수가 기준 이상 생존. 순수 TS, 결정론(무작위는 world.rng).

import type { World } from "@/sim/world";
import type { Rng } from "@/sim/rng";

export type BossType = "chaser" | "swarm" | "poison" | "titan" | "raider" | "isolation" | "stalker";

/** 사나운 무리의 추격 개체 하나(떼의 한 마리). 각자 가장 가까운 개체로 이동해 killRadius 로 물어뜯는다. */
export interface BossMember {
  x: number;
  y: number;
  prevX: number; // 직전 스텝 위치 (렌더 보간용)
  prevY: number;
}

export interface Boss {
  type: BossType;
  name: string;
  x: number;
  y: number;
  prevX: number; // 직전 스텝 위치 (렌더 보간용)
  prevY: number;
  speed: number;
  killRadius: number; // 닿으면 즉사하는 반경 (0 = 없음)
  visionFlee: number; // 도망 반경에 시야를 곱해 더하는 정도(titan: 시야가 카운터)
  auraRadius: number; // 시각용 위험 반경(독 안개)
  globalKillRate: number; // 매 틱 개체가 솎일 확률(raider/isolation/stalker 의 기본값)
  globalDrain: number; // 매 틱 전역 에너지 흡수 (×(0.3+metabolism)) (poison)
  cullAttackResist: number; // 솎기를 공격력으로 저항(raider): rate ×= 1 - this×attack
  cullGroupResist: number; // 솎기를 무리 성향으로 저항(isolation): rate ×= 1 - this×herding
  cullVisionResist: number; // 솎기를 시야로 저항(stalker): rate ×= 1 - this×vision
  // 다수 추격 개체(사나운 무리). 비어있으면 단일 개체(x,y) 모드. 각 멤버가 killRadius 로 즉사시킨다.
  members: BossMember[];
}

interface Preset extends Omit<Boss, "type" | "name" | "x" | "y" | "prevX" | "prevY" | "members"> {
  name: string;
  threat: string;
  counter: string;
  memberCount?: number; // 다수 추격 개체 떼의 수(swarm). 없으면 단일 개체.
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
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0,
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
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0,
    threat: "느리지만 거대해 가까이 가면 잡아먹습니다.",
    counter: "시야가 넓어야 일찍 보고 피합니다.",
  },
  swarm: {
    name: "사나운 무리",
    speed: 2.5, // 내 종 최고속(~2.38)보다 빨라 순수 도망은 무의미 → chaser(단일 초고속)와 달리 다수
    // 포위 소모전. 잘 성장한 큰 무리(빠르고 잘 먹어 수가 많은 종)는 흩어져 버티고, 부진한 작은 무리는
    // 따라잡혀 전멸(프로브: 기본 40%·부진형 0% 통과). speed 는 성장(채집)으로 개체수에 기여.
    killRadius: 4, // 각 떼 개체의 즉사 반경(무리 대형으로 겹쳐 다녀 작게 — 총 위협은 수·응집으로)
    visionFlee: 0,
    auraRadius: 0,
    globalKillRate: 0, // 전역 솎기 제거 — 이제 실제 떼 개체(members)가 쫓아와 문다(시각=로직 1:1)
    globalDrain: 0,
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0,
    memberCount: 6, // 떼답게 여럿(응집+분리로 무리 대형을 이뤄 몰려온다). 건강한 큰 무리만 버틴다.
    threat: "사나운 무리가 사방에서 몰려들어 닿는 개체를 물어뜯습니다.",
    counter: "수가 많고 빠르게 번식해야 솎여도 메우며 버팁니다.",
  },
  poison: {
    name: "독 안개",
    speed: 0.9,
    killRadius: 0,
    visionFlee: 0,
    auraRadius: 0, // 독은 전역(위치 없음) — 국소 원 대신 화면 전체 안개로 표현(worldView). 보스 점도 안 그린다.
    globalKillRate: 0,
    globalDrain: 0.5, // ×(0.3+metabolism): 대사 높을수록 더 빨림. 길찾기로 채집·개체수↑ 만큼 압박도 키워 저대사 우위를 드러냄(0.3→0.5, 프로브: 저대사15통과·기본5탈락)
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0,
    threat: "온 땅의 에너지를 계속 빨아들입니다.",
    counter: "대사가 낮아야 덜 빨리고 견딥니다.",
  },
  raider: {
    name: "약탈자 무리",
    speed: 2.2,
    killRadius: 0,
    visionFlee: 0,
    auraRadius: 0,
    globalKillRate: 0.006, // 기본 솎임이 매섭되, 공격력으로 맞서 싸워 줄인다
    globalDrain: 0,
    cullAttackResist: 0.92, // 공격력 높을수록 거의 안 솎임
    cullGroupResist: 0,
    cullVisionResist: 0,
    threat: "사방에서 약탈자가 달려들어 약한 개체부터 쓰러뜨립니다.",
    counter: "공격력(이빨·뿔)이 높아야 맞서 싸워 버팁니다.",
  },
  isolation: {
    name: "외톨이 사냥꾼",
    speed: 2.4,
    killRadius: 0,
    visionFlee: 0,
    auraRadius: 0,
    globalKillRate: 0.008, // 외톨이는 매섭게 솎이되, 무리에 섞이면 안전. 시야각 도입으로 개체수↑ 만큼 재튠(0.006→0.008, 프로브: 무리33통과·외톨이1탈락)
    globalDrain: 0,
    cullAttackResist: 0,
    cullGroupResist: 0.9, // 이웃이 많을수록 거의 안 솎임
    cullVisionResist: 0,
    threat: "무리에서 떨어진 외톨이부터 노려 하나씩 잡아갑니다.",
    counter: "무리 성향이 높아 함께 뭉쳐 다녀야 안전합니다.",
  },
  stalker: {
    name: "그림자 매복자",
    speed: 2.2,
    killRadius: 0,
    visionFlee: 0,
    auraRadius: 0,
    globalKillRate: 0.011, // 프로브 재튠(먹이 육지화 후): 시야0.9통과(여유)·기본0.5통과·시야0.1탈락(시야 게이트)
    globalDrain: 0,
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0.9, // 시야 높을수록 거의 안 솎임
    threat: "수풀에 숨어 있다 덮칩니다. 미리 알아채지 못한 개체부터 당합니다.",
    counter: "시야가 넓어야 일찍 보고 피합니다.",
  },
};

// titan(거대 포식자)은 느려서 누구나 쉽게 도망 → 위협이 안 됨. 풀에서 제외(프리셋은 보존).
// 시야 카운터는 titan 대신 stalker(그림자 매복자)로. 즉사 추격이 아니라 솎기+시야 저항이라 깔끔하다.
export const BOSS_TYPES: readonly BossType[] = [
  "chaser",
  "swarm",
  "poison",
  "raider",
  "isolation",
  "stalker",
];

export function createBoss(type: BossType, width: number, height: number): Boss {
  const p = PRESETS[type];
  const x = width * 0.5;
  const y = height * 0.22;
  const members: BossMember[] = [];
  const count = p.memberCount ?? 0;
  if (count > 0) {
    // 무리로 뭉쳐 한쪽(위 가장자리)에서 몰려온다 — 작은 원으로 모아 스폰한다(사방 분산은 "무리"로
    // 안 보이고 따로 논다). rng 무사용 → 결정론.
    const ox = width * 0.5;
    const oy = height * 0.08;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const mx = clampTo(ox + Math.cos(ang) * 26, 0, width);
      const my = clampTo(oy + Math.sin(ang) * 26, 0, height);
      members.push({ x: mx, y: my, prevX: mx, prevY: my });
    }
  }
  return {
    type,
    name: p.name,
    x,
    y,
    prevX: x,
    prevY: y,
    speed: p.speed,
    killRadius: p.killRadius,
    visionFlee: p.visionFlee,
    auraRadius: p.auraRadius,
    globalKillRate: p.globalKillRate,
    globalDrain: p.globalDrain,
    cullAttackResist: p.cullAttackResist,
    cullGroupResist: p.cullGroupResist,
    cullVisionResist: p.cullVisionResist,
    members,
  };
}

function clampTo(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 전투 전 위협 예고 문구 (쉬운 말). */
export function bossPreview(type: BossType): string {
  const p = PRESETS[type];
  return `${p.name} — ${p.threat} ${p.counter}`;
}

export function bossName(type: BossType): string {
  return PRESETS[type].name;
}

/**
 * 개체형 보스(실제로 쫓아와 즉사시키는 개체)인가 — 아니면 전역 시련(위치 무관하게 사방에서 솎기/흡수,
 * 못 피하고 형질로 버틴다). killRadius(즉사 반경)가 있으면 개체형. 시각·용어·도망 여부를 이걸로 가른다.
 */
export function isPredatorBoss(type: BossType): boolean {
  return PRESETS[type].killRadius > 0;
}

/** 위협 대응 힌트(예고 부제) — 이 형질을 키우면 버틴다. */
export function bossCounter(type: BossType): string {
  return PRESETS[type].counter;
}

export function pickBossType(rng: Rng): BossType {
  return rng.pick(BOSS_TYPES);
}

/** 보스 한 틱. 타입별로 다른 압박을 가한다. */
export function stepBoss(boss: Boss, world: World): void {
  // 사나운 무리 — 각 떼 개체가 가장 가까운 개체로 몰려와 닿으면 물어뜯는다(전역 솎기가 아니라 실재 개체).
  if (boss.members.length > 0) {
    stepSwarm(boss, world);
    return;
  }

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
        world.emit("kill", e.x, e.y); // 연출: 보스 즉사 반경
      }
    }
  }

  if (boss.globalKillRate > 0) {
    for (const e of world.entities) {
      if (!e.alive) continue;
      let rate = boss.globalKillRate;
      // 약탈자: 공격력이 높으면 맞서 싸워 덜 솎인다.
      if (boss.cullAttackResist > 0) rate *= 1 - boss.cullAttackResist * e.genome.traits.attack;
      // 외톨이 사냥꾼: 무리 성향이 높을수록(함께 뭉쳐 다녀) 덜 솎인다.
      if (boss.cullGroupResist > 0) rate *= 1 - boss.cullGroupResist * e.genome.traits.herding;
      // 그림자 매복자: 시야가 높을수록(미리 보고 피해) 덜 솎인다.
      if (boss.cullVisionResist > 0) rate *= 1 - boss.cullVisionResist * e.genome.traits.vision;
      if (rate > 0 && world.rng.unit() < rate) {
        e.alive = false;
        world.recordDeath(e.species, "boss");
        world.emit("kill", e.x, e.y);
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
        world.emit("death", e.x, e.y); // 보스 기력 고갈 = 자연사 톤
      }
    }
  }
}

// 떼가 "무리"로 보이게 하는 boids 조향(사냥 방향이 주 1.0, 아래는 보조).
const SWARM_COHESION = 0.4; // 떼 무게중심으로 끌림 — 한 덩어리로 뭉쳐 몰려온다(뿔뿔이면 "무리"로 안 보임).
const SWARM_SEPARATION = 0.7; // 너무 가까운 동료에서 밀어냄 — 겹쳐 한 점에 집중(전멸)하지 않고 넓은 대형으로.
const SWARM_SEP_DIST = 34; // 이 거리보다 가까운 동료가 있으면 분리력이 작동(떼 대형의 개체 간격).

/**
 * 사나운 무리 한 틱 — 떼 전체가 "하나의 목표"(무게중심에서 가장 가까운 개체)를 함께 쫓아 무리 대형
 * (응집으로 뭉치고 분리로 안 겹침)으로 몰려온다. 각자 다른 최근접을 쫓으면 따로 놀아 "무리"가 안 된다.
 */
function stepSwarm(boss: Boss, world: World): void {
  const killR2 = boss.killRadius * boss.killRadius;
  // 떼 무게중심(응집 기준).
  let cx = 0;
  let cy = 0;
  for (const m of boss.members) {
    cx += m.x;
    cy += m.y;
  }
  cx /= boss.members.length;
  cy /= boss.members.length;
  // 공통 목표 — 무게중심에서 가장 가까운 산 개체. 무리 전체가 이 한 마리(무리)를 향해 함께 몰려간다.
  let best = Infinity;
  let tx = 0;
  let ty = 0;
  let found = false;
  for (const e of world.entities) {
    if (!e.alive) continue;
    const dx = e.x - cx;
    const dy = e.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      tx = e.x;
      ty = e.y;
      found = true;
    }
  }
  for (const m of boss.members) {
    moveMember(m, boss.speed, tx, ty, found, cx, cy, boss.members);
    for (const e of world.entities) {
      if (!e.alive) continue;
      const dx = e.x - m.x;
      const dy = e.y - m.y;
      if (dx * dx + dy * dy < killR2) {
        e.alive = false;
        world.recordDeath(e.species, "boss");
        world.emit("kill", e.x, e.y); // 연출: 떼 개체가 문 자리
      }
    }
  }
}

/** 떼 개체 하나 이동 — 공통 목표로 향하되(주), 무게중심으로 응집 + 가까운 동료에서 분리(무리 대형). */
function moveMember(
  m: BossMember,
  speed: number,
  tx: number,
  ty: number,
  hasTarget: boolean,
  herdCx: number,
  herdCy: number,
  members: readonly BossMember[],
): void {
  if (speed <= 0) return;
  let vx = 0;
  let vy = 0;
  // 사냥: 공통 목표 방향(단위 벡터) — 무리 전체가 같은 곳으로 몰려간다.
  if (hasTarget) {
    const hx = tx - m.x;
    const hy = ty - m.y;
    const hd = Math.sqrt(hx * hx + hy * hy) || 1;
    vx += hx / hd;
    vy += hy / hd;
  }
  // 응집: 떼 무게중심 방향(단위 벡터)을 SWARM_COHESION 만큼.
  const chx = herdCx - m.x;
  const chy = herdCy - m.y;
  const cd = Math.sqrt(chx * chx + chy * chy);
  if (cd > 1) {
    vx += (chx / cd) * SWARM_COHESION;
    vy += (chy / cd) * SWARM_COHESION;
  }
  // 분리: SWARM_SEP_DIST 안의 동료에서 밀어냄(겹쳐 한 점 집중 방지 → 넓은 무리 대형).
  const sep2 = SWARM_SEP_DIST * SWARM_SEP_DIST;
  for (const o of members) {
    if (o === m) continue;
    const ox = m.x - o.x;
    const oy = m.y - o.y;
    const od2 = ox * ox + oy * oy;
    if (od2 > 0 && od2 < sep2) {
      const od = Math.sqrt(od2);
      vx += (ox / od) * SWARM_SEPARATION;
      vy += (oy / od) * SWARM_SEPARATION;
    }
  }
  const vl = Math.sqrt(vx * vx + vy * vy) || 1;
  m.x += (vx / vl) * speed;
  m.y += (vy / vl) * speed;
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
