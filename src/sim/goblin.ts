// 황금 고블린 — 시험 「금빛 짐승 잡기」의 목표 개체.
//
// **[사용자 2026-08-07]** 확정 (합의 없이 바꾸지 않는다):
//   "아예 특별 개체로. 다른 종들은 상호작용하지 못하고 내 종에게만 보이는 개체로 해서, 좀 눈에
//    띄게 금색으로 번쩍번쩍하게 만들어서 돌아다니는 황금고블린같은 느낌으로."
//   + "당연히 도망다녀야지. 시험이 끝나면 사라져버려야 하고."
//
// 왜 생태 밖인가: 옛 방식(이미 있는 야생에 표식)은 목표가 스스로 도망다니다 죽어 시험이 운이 됐다
// (2026-08-12 판 코드 실측: 4회 등장 1회 합격). 생태에 안 들어가면 원리적으로 안 죽고, 포식 판정에
// 예외를 심을 필요도 없다(예외가 없는 쪽이 항상 덜 망가진다).
//
// **생태 격리 계약 — 이 파일의 가장 중요한 규칙:**
//   · 고블린은 `world.entities` 에 없다. **야생은 그를 감지·추적·공격하지 않는다.** 내 종만이
//     근처에서 스스로 쫓는다(behavior 의 goblinChase · **[사용자 2026-08-12]** "내 종조차도 잡으려
//     하질 않는데" — 처음엔 이 쫓기가 없어서 방울은 줍는 무리가 금빛은 쳐다도 안 봤다).
//   · 무작위는 전용 `world.goblinRng` 만 쓴다(geneRng 와 같은 결) · 메인 rng 를 쓰면 야생 스폰·진화가
//     통째로 이동한다. 쫓기도 순수 기하다(rng 0) — 같은 시드 = 같은 판(결정론 보존).
//   · **시련이 안 걸린 세계(goblinQuota 0)에서는 이 파일도 goblinChase 도 한 줄도 안 돈다** —
//     기존 세계는 1비트도 안 바뀐다. (시련이 걸린 세계는 내 종이 쫓느라 움직임이 바뀐다 · 의도다.)
//
// 내 판단 (사용자: "나머지는 네 판단에 맡길게" · 언제든 다시 따져도 됨):
//   · 한 마리씩 차례로(quota 가 남으면 잡히는 즉시 다음이 뜬다) — 매번 작은 클라이맥스.
//   · 잡기 = 접촉(내 종 개체가 catchRadius 안). 물기가 아니라서 **이빨 0단(초식)도 할 수 있다** ·
//     옛 표식 사냥의 이빨 게이트가 필요 없어졌다.
//   · 위험은 「본진이 비는 것」 — 무리에서 떨어진 곳에 나타나므로 쫓으면 목소리·알파가 끌려간다.
//   · 도망 속도 = 내 종 최고 속도의 비율 — 어느 빌드에서도 「몰아야 잡힌다」가 성립한다.

import type { World } from "@/sim/world";
import type { Entity } from "@/sim/entity";
import { SIM } from "@/sim/params";

export interface Goblin {
  x: number;
  y: number;
  /** 배회 방향(라디안). 도망 중이 아닐 때만 쓴다. */
  wanderAngle: number;
  /** 마지막으로 실제로 움직인 방향(라디안) · 렌더가 몸을 이쪽으로 눕힌다("짐승"으로 읽히려면 방향이 있어야 한다). */
  heading: number;
}

export const GOBLIN = {
  /**
   * 도망 속도 = 내 종 최고 속도 × 이 비율. 1 보다 작아야 잡을 수 있고, 너무 작으면 그냥 잡힌다.
   * ⚠ **이 값은 폰 실기로만 정해진다**(0.8 은 출발값 · 내 판단) — 「몰아야 잡힌다」의 손맛이 전부다.
   * 0.88 → 0.8 (실측): 쫓는 개체는 지시 혼합(0.9)·관성·험지 감속을 다 먹는데 고블린은 비율을
   * 그대로 내서, 0.88 이면 일대일 직선 추격이 **영영 안 좁혀졌다**(goblin.test 의 쫓기 감지기).
   */
  speedRatio: 0.8,
  /** 이 안에 내 종이 들어오면 달아난다(px). 내 종 티어 0 시야(120px)보다 넉넉히 크다 — 먼저 눈치챈다. */
  senseRadius: 200,
  /**
   * 이 안의 내 종은 **스스로 금빛 짐승을 쫓는다**(px · behavior 의 goblinChase). senseRadius 보다
   * 넉넉히 커야 달아나기 시작한 것을 놓치지 않는다. **[사용자 2026-08-12]** "내 종조차도 잡으려
   * 하질 않는데" 의 답 — 지시로 근처까지 몰면 그다음은 무리가 알아서 에워싼다.
   */
  chaseRadius: 260,
  /** 내 종 개체가 이 안에 들면 잡힌다(px). 방울 줍기(GENE_PICK_RADIUS 16)와 같은 「밟으면 된다」 결. */
  catchRadius: 14,
  /** 무리 무게중심에서 이만큼 떨어져 나타난다(px). 본진이 비는 위험이 이 시험의 대가다. */
  spawnMin: 240,
  spawnMax: 400,
  /** 배회 걸음 배수(도망이 아닐 때는 어슬렁거린다 · 반짝임이 눈에 띄는 시간을 준다). */
  idleFactor: 0.45,
  /** 배회 방향이 틱마다 흔들리는 폭(라디안). */
  wanderTurn: 0.25,
} as const;

/** 내 종의 최고 속도(형질 기준 · 지형/질주 보정 전). behavior 의 maxSpeed 첫 항과 같은 식. */
function playerTopSpeed(world: World): number {
  return SIM.maxSpeedBase * (0.4 + world.playerSpecies.genome.traits.speed / 100);
}

/** 내 종의 통행 능력 — 고블린은 **내 종이 갈 수 있는 곳으로만** 다닌다(못 가는 곳으로 달아나면 못 하는 시험이 된다). */
function playerCaps(world: World): { swim: boolean; land: boolean; fly: boolean } {
  const t = world.playerSpecies.genome.traits;
  return {
    swim: t.swimming >= SIM.swimThreshold,
    land: t.swimming < SIM.aquaticOnlyThreshold,
    fly: t.wings >= SIM.flyThreshold,
  };
}

/**
 * 매 틱 한 번 — 시험이 걸려 있으면(quota > 0) 고블린을 낳고 · 도망치게 하고 · 잡혔는지 본다.
 * `world.step()` 이 방울 줍기 곁에서 부른다. quota 0 이면 즉시 돌아간다(기존 세계 불변).
 */
export function stepGoblin(world: World): void {
  if (world.goblinQuota <= 0) {
    world.goblin = null;
    return;
  }

  if (world.goblin === null) {
    world.goblin = spawnGoblin(world);
    return; // 태어난 틱에는 서 있는다(나타나는 연출이 읽힐 틈)
  }

  const g = world.goblin;
  const caps = playerCaps(world);

  // ── 가장 가까운 내 종(감지 반경 안) — 그리드 질의라 순회 순서 고정 · 결정론 안전 ──
  let nearest: Entity | null = null;
  let nearestD2 = GOBLIN.senseRadius * GOBLIN.senseRadius;
  world.grid.forEachMatching(g.x, g.y, GOBLIN.senseRadius, (e) => {
    if (!e.alive || !e.species.isPlayer) return;
    const d2 = (e.x - g.x) * (e.x - g.x) + (e.y - g.y) * (e.y - g.y);
    if (d2 < nearestD2 || (d2 === nearestD2 && nearest !== null && e.id < nearest.id)) {
      nearestD2 = d2;
      nearest = e as Entity;
    }
  });

  // ── 잡혔는가 — 접촉이면 끝. 계수는 옛 표식 사냥과 같은 `marked` 라 판정·화면 배선이 그대로 산다 ──
  const caught: Entity | null = nearest;
  if (caught !== null && nearestD2 <= GOBLIN.catchRadius * GOBLIN.catchRadius) {
    world.roundCounts.marked += 1;
    world.goblinQuota -= 1;
    world.emit("goblin", g.x, g.y, true); // 금빛 터짐(render/effects.ts)
    world.goblin = null; // quota 가 남았으면 다음 틱에 다음 마리가 뜬다(한 마리씩 차례로)
    return;
  }

  // ── 이동: 쫓기면 반대로 전속, 아니면 어슬렁 ──
  const top = playerTopSpeed(world) * GOBLIN.speedRatio;
  let dx: number;
  let dy: number;
  if (nearest !== null) {
    const away = Math.atan2(g.y - (nearest as Entity).y, g.x - (nearest as Entity).x);
    dx = Math.cos(away) * top;
    dy = Math.sin(away) * top;
  } else {
    g.wanderAngle += world.goblinRng.range(-GOBLIN.wanderTurn, GOBLIN.wanderTurn);
    dx = Math.cos(g.wanderAngle) * top * GOBLIN.idleFactor;
    dy = Math.sin(g.wanderAngle) * top * GOBLIN.idleFactor;
  }

  // 축 분리 통행(개체 이동과 같은 규칙) + 세계 경계. 도망 방향이 막히면 그 축만 죽어 벽을 따라
  // 미끄러진다 — 구석에 몰리는 것은 결함이 아니라 **몰이의 보상**이다.
  const ox = g.x;
  const oy = g.y;
  const nx = g.x + dx;
  const ny = g.y + dy;
  if (nx >= 4 && nx <= world.width - 4 && world.terrain.isPassable(nx, g.y, caps.swim, caps.land, caps.fly)) {
    g.x = nx;
  }
  if (ny >= 4 && ny <= world.height - 4 && world.terrain.isPassable(g.x, ny, caps.swim, caps.land, caps.fly)) {
    g.y = ny;
  }
  // 실제로 움직인 방향으로 몸을 눕힌다(막혀서 안 움직인 틱은 이전 방향 유지 · 떨림 방지).
  const mdx = g.x - ox;
  const mdy = g.y - oy;
  if (mdx * mdx + mdy * mdy > 1e-6) g.heading = Math.atan2(mdy, mdx);
}

/** 무리에서 떨어진, 내 종이 갈 수 있는 자리에 낳는다. 마흔 번 다 실패하면 무리 곁(시험이 쉬워질지언정 불가능하진 않게). */
function spawnGoblin(world: World): Goblin {
  const c = world.playerCentroid();
  const caps = playerCaps(world);
  for (let tryN = 0; tryN < 40; tryN += 1) {
    const ang = world.goblinRng.range(0, Math.PI * 2);
    const dist = world.goblinRng.range(GOBLIN.spawnMin, GOBLIN.spawnMax);
    const x = Math.max(8, Math.min(world.width - 8, c.x + Math.cos(ang) * dist));
    const y = Math.max(8, Math.min(world.height - 8, c.y + Math.sin(ang) * dist));
    if (!world.terrain.isPassable(x, y, caps.swim, caps.land, caps.fly)) continue;
    return { x, y, wanderAngle: ang, heading: ang };
  }
  const spot = world.terrain.nearestPassable(c.x, c.y, caps.swim, caps.land, caps.fly);
  return { x: spot.x, y: spot.y, wanderAngle: 0, heading: 0 };
}
