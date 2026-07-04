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
import { TRAIT_MAX } from "@/sim/genome";
import { createEntity } from "@/sim/entity";
import { areFriends } from "@/sim/species";
import { SIM } from "@/sim/params";

interface Vec {
  x: number;
  y: number;
}

export function stepEntity(e: Entity, world: World, newborns: Entity[]): void {
  const t = e.genome.traits;
  // 형질은 0~100 자연수 저장 → 계수 계산은 0~1 로 정규화(÷TRAIT_MAX)해 해석한다(임계 비교는 0~100 그대로).
  const speed01 = t.speed / TRAIT_MAX;
  const vision01 = t.vision / TRAIT_MAX;
  const metabolism01 = t.metabolism / TRAIT_MAX;
  const herding01 = t.herding / TRAIT_MAX;
  const fertility01 = t.fertility / TRAIT_MAX;
  // 날개≥flyThreshold 면 비행 — 산·물을 날아 넘고, 험지 감속을 무시하며, 높이 날아 시야가 넓다.
  // 대신 계속 날갯짓이라 대사가 더 든다(비행의 대가). 날개 0 인 종은 canFly=false → 전부 영향 0(밸런스 보존).
  const canFly = t.wings >= SIM.flyThreshold;
  // 원거리(ranged) 사거리 — 사냥 사정거리이자, 원거리 종이 먹잇감에 붙지 않고 멈춰 쏘는 거리(kiting).
  const atkRange = SIM.attackRange + (t.ranged / TRAIT_MAX) * SIM.rangedBonus;
  // 험지(거친 땅)에선 이동이 느려진다 — speed 형질이 높을수록 덜 느려진다(속도가 지형에서 가치). 비행은 무시.
  const maxSpeed =
    SIM.maxSpeedBase * (0.4 + speed01) * (canFly ? 1 : roughSpeedFactor(world, e.x, e.y, speed01));
  // 밤엔 시야가 준다(낮=영향 없음). vision 형질이 높을수록 밤에도 잘 본다 → 야행성 틈새(큰 눈).
  // 시야 반경 = visionBase × (시야/100). 하한이 없어 시야 0 이면 아무것도 못 본다(감각 형질의 대가).
  // 비행 종은 높이 날아 시야가 넓다(× (1+flyVisionBonus)).
  const vision =
    SIM.visionBase *
    vision01 *
    nightVisionFactor(world.daylight, vision01) *
    grassVisionFactor(world, e.x, e.y, vision01) *
    (canFly ? 1 + SIM.flyVisionBonus : 1);
  const drain = SIM.metabolismDrain * (0.5 + metabolism01) * (canFly ? 1 + SIM.flyMetabolismCost : 1);
  const maxAge = SIM.baseMaxAge;
  // 식성 구간: 초식(<35) 식물만 / 잡식(35~70) 둘 다 / 육식(>70) 사냥만.
  const canHunt = t.diet > SIM.dietHuntMin;
  const canGraze = t.diet < SIM.dietGrazeMax;
  // 수영 종만 물에 들어가고(산은 못 넘되 비행은 예외), 물 전용(수영 아주 높음)은 육지에 못 올라온다.
  const canSwim = t.swimming >= SIM.swimThreshold;
  const canLand = t.swimming < SIM.aquaticOnlyThreshold;

  // 무리 이웃(3×3 칸) — cohesion(이동)과 huddle(보온)에 함께 쓴다.
  const nb = t.herding > 0 ? world.grid.neighborhood(e.x, e.y) : null;

  // --- 원하는 속도(desired) 계산 ---
  let desired: Vec;
  let turn: number = SIM.steerTurn;

  const flee = computeFlee(e, world, t, maxSpeed, canSwim, canLand, canFly);
  const fleeing = flee !== null;
  if (flee) {
    desired = flee;
    turn = SIM.fleeTurn; // 도망은 빠르게 반응(생존)
  } else {
    const goal = chooseGoal(e, world, vision, SIM.echoBase * (t.echo / TRAIT_MAX), canHunt, canGraze);
    if (goal) {
      // 지형 길찾기: 목표가 직선으로 보이면 직진, 막혀 있으면 격자 BFS 경로를 따라 우회한다.
      const nav = navTo(e, world, goal, canSwim, canLand, canFly);
      // 최종 목표가 직선으로 보일 때만 도착 감속(arrive) — 가까울수록 줄여 오버슈트(와리가리)를 없앤다.
      // 사냥: 원거리 종은 사거리에서 멈춰 쏜다(붙지 않음 — kiting). 근접 종은 사정거리(공격 사거리)까지 바짝.
      const huntR = Math.max(SIM.huntArriveRadius, atkRange * 0.85);
      const r = nav.final ? (e.targetPrey !== null ? huntR : SIM.arriveRadius) : 0;
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
        const w = SIM.herdCohesion * herding01 * pull;
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
  if (world.terrain.isPassable(nx, e.y, canSwim, canLand, canFly)) e.x = nx;
  else e.vx = 0;
  if (world.terrain.isPassable(e.x, ny, canSwim, canLand, canFly)) e.y = ny;
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

  // --- 끼임 감지: 목표가 있는데 이번 스텝 거의 못 움직였으면(물벽 등에 막힘) 카운트. 오래 막히면 도달
  // 불가로 보고 목표를 버려 다른 먹이를 찾게 한다 — 물가 먹이에 억지로 들이대다 갇히는 것을 푼다. ---
  if ((e.targetFood || e.targetPrey) && !fleeing) {
    const dxm = e.x - e.prevX;
    const dym = e.y - e.prevY;
    if (dxm * dxm + dym * dym < SIM.stuckMinMove * SIM.stuckMinMove) {
      e.stuckTicks += 1;
      if (e.stuckTicks >= SIM.stuckLimit) {
        e.targetFood = null;
        e.targetPrey = null;
        e.path.length = 0;
        e.pathGoalTile = -1;
        e.stuckTicks = 0;
      }
    } else {
      e.stuckTicks = 0;
    }
  } else {
    e.stuckTicks = 0;
  }

  // --- 섭취 / 사냥 (쫓던 목표가 사정거리면) ---
  if (!fleeing && e.targetPrey && e.targetPrey.alive) {
    const prey = e.targetPrey;
    const dx = prey.x - e.x;
    const dy = prey.y - e.y;
    // 원거리 종은 이 넓은 사거리(atkRange, 상단 계산)에서 쏜다 — 붙지 않고 멀리서 명중.
    if (dx * dx + dy * dy <= atkRange * atkRange) {
      // 즉사 확률 — 공격력 기반(독은 방어라 사냥 성공과 무관).
      const preyVenom = prey.genome.traits.venom;
      const chance = clamp(
        SIM.killChanceBias + ((t.attack - prey.genome.traits.attack) / TRAIT_MAX) * SIM.killChanceScale,
        0.05,
        0.95,
      );
      if (world.rng.chance(chance)) {
        prey.alive = false;
        world.recordDeath(prey.species, "predation");
        world.emit("kill", prey.x, prey.y); // 연출: 잡아먹힘(빨강 터짐)
        // 방어 독(venom): 독먹이를 삼키면(잡으면) 포식자가 중독되고 영양도 못 얻는다 — 독개구리·독뱀을
        // 삼킨 대가. venom 이 강할수록 독은 크게 옮고 사냥 이득은 준다("잡아먹으면 손해"의 포식 방어).
        if (preyVenom > 0) e.poison += SIM.venomOnHit * (preyVenom / TRAIT_MAX);
        e.energy = Math.min(SIM.maxEnergy, e.energy + SIM.predationEnergy * (1 - preyVenom / TRAIT_MAX));
        e.targetPrey = null;
      }
    }
  } else if (!fleeing && e.targetFood && e.targetFood.available) {
    const food = e.targetFood;
    const dx = food.x - e.x;
    const dy = food.y - e.y;
    if (dx * dx + dy * dy <= SIM.eatRadius * SIM.eatRadius) {
      if (food.mountainous) {
        // 산 보물 — 에너지 만땅 + 동족 여럿 즉시 태어남(무리가 확 불어나는 대박). 희소한 보상(날개 종만).
        e.energy = SIM.maxEnergy;
        for (let k = 0; k < SIM.mountainTreasureSpawn; k++) {
          if (world.entities.length + newborns.length >= world.cap) break;
          const bx = e.x + world.rng.range(-12, 12);
          const by = e.y + world.rng.range(-12, 12);
          const spot = world.terrain.nearestPassable(bx, by, canSwim, canLand, canFly);
          newborns.push(createEntity(world.nextId(), spot.x, spot.y, e.species, SIM.startEnergy));
          world.emit("birth", spot.x, spot.y); // 연출: 대박 탄생(초록 반짝 여럿)
        }
        food.regrowTimer = Math.round(
          SIM.foodRegrowTicks * world.foodRegrowMultiplier * SIM.mountainTreasureRegrow,
        );
      } else {
        e.energy = Math.min(SIM.maxEnergy, e.energy + SIM.foodEnergy);
        food.regrowTimer = Math.round(SIM.foodRegrowTicks * world.foodRegrowMultiplier);
      }
      food.available = false;
      e.targetFood = null;
      // 레벨업 경험치 소스(내 종 섭취만) — 보물은 크게(즉시 레벨업 쪽으로).
      if (e.species.isPlayer) world.playerFoodEaten += food.mountainous ? SIM.mountainTreasureSpawn : 1;
    }
  }

  // --- 허기 + 노화. 추위(저대사 불리, 무리 보온으로 완화) + 폭염(고대사 불리). ---
  const env = world.environment.sampleAt(e.x, e.y);
  const huddle = nb ? Math.min(1, (nb.count - 1) / SIM.huddleFull) * herding01 : 0;
  const warmthFactor = 1 - SIM.huddleWarmth * huddle;
  // 평상시 추위(env.coldness)는 그대로, 대멸종 한파(globalCold)만 더 매섭게(클라이맥스 필터).
  const coldField = env.coldness + world.globalCold * SIM.globalColdLethality;
  const coldDrain = SIM.coldPenalty * coldField * (1 - metabolism01) * warmthFactor;
  const heatDrain = SIM.heatPenalty * world.heat * metabolism01;
  // 독(중독) — 누적 독이 있으면 매 틱 에너지를 깎는다(지속 피해). poison 풀이 소진될 때까지.
  const poisonDmg = e.poison > 0 ? Math.min(e.poison, SIM.venomTickDamage) : 0;
  if (poisonDmg > 0) e.poison -= poisonDmg;
  e.energy -= drain + coldDrain + heatDrain + poisonDmg;
  e.age += 1;

  // --- 죽음 (사망 원인 집계, §7). 이번 틱 가장 큰 소모로 귀속(독>추위/폭염>기본 대사). ---
  if (e.energy <= 0) {
    let cause: DeathCause = "starve";
    if (poisonDmg > 0 && poisonDmg >= coldDrain && poisonDmg >= heatDrain && poisonDmg >= drain) {
      cause = "venom"; // 방어 독으로 중독사 — 독먹이를 삼킨 포식자가 되갚음당해 죽는다
    } else if (coldDrain >= heatDrain && coldDrain > drain) cause = "cold";
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
    world.rng.chance(SIM.reproduceRate * (0.3 + fertility01))
  ) {
    const childEnergy = e.energy * 0.5;
    e.energy -= childEnergy;
    const cx = e.x + world.rng.range(-6, 6);
    const cy = e.y + world.rng.range(-6, 6);
    // 막힌 타일에 태어나면 갇히므로 가장 가까운 통행 타일로 스냅(rng 미사용 → 결정론·밸런스 보존).
    const spot = world.terrain.nearestPassable(cx, cy, canSwim, canLand, canFly);
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
  canFly: boolean,
): Vec | null {
  const boss = world.boss;
  if (boss && boss.members.length > 0) {
    // 개체형 떼 시련 — 가장 가까운 떼 개체로부터 도망친다(사방에서 오니 완전 회피는 어렵다).
    // 그림자 매복자(cullVisionResist>0)는 시야가 넓을수록 더 멀리서 알아채 미리 피한다(시야 카운터).
    let best2 = Infinity;
    let bx = 0;
    let by = 0;
    for (const m of boss.members) {
      const dx = e.x - m.x;
      const dy = e.y - m.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best2) {
        best2 = d2;
        bx = dx;
        by = dy;
      }
    }
    const visionPad = boss.cullVisionResist > 0 ? SIM.stalkerVisionFlee * (t.vision / TRAIT_MAX) : 0;
    const fr = boss.killRadius + SIM.fleeRadiusPad + visionPad;
    if (best2 < fr * fr) return clearFleeDir(e, world, bx, by, maxSpeed, canSwim, canLand, canFly);
  } else if (boss && boss.killRadius > 0) {
    const bdx = e.x - boss.x;
    const bdy = e.y - boss.y;
    const bd2 = bdx * bdx + bdy * bdy;
    const fr = boss.killRadius + SIM.fleeRadiusPad + boss.visionFlee * (t.vision / TRAIT_MAX);
    if (bd2 < fr * fr) return clearFleeDir(e, world, bdx, bdy, maxSpeed, canSwim, canLand, canFly);
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
    return clearFleeDir(e, world, e.x - predator.x, e.y - predator.y, maxSpeed, canSwim, canLand, canFly);
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
  canFly: boolean,
): Vec {
  const d = Math.hypot(awayX, awayY);
  if (d < 1e-6) return { x: 0, y: 0 };
  const base = Math.atan2(awayY, awayX);
  const probe = world.terrain.cellSize * SIM.fleeProbeTiles;
  // 도망 방향이 probe 거리까지 트였으면 그대로(대부분). 비행 종은 지형에 안 막혀 항상 트임.
  if (fleeClear(world, e.x, e.y, base, probe, canSwim, canLand, canFly)) {
    return { x: Math.cos(base) * maxSpeed, y: Math.sin(base) * maxSpeed };
  }
  // 막힘 — away 유지 + 헤딩 일관성으로 통행 가능한 최선 방향을 고른다.
  const heading = Math.atan2(e.vy, e.vx);
  let bestAng = base;
  let bestScore = -Infinity;
  for (const off of FLEE_OFFSETS) {
    const a = base + off;
    if (!fleeClear(world, e.x, e.y, a, probe, canSwim, canLand, canFly)) continue;
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
  canFly: boolean,
): boolean {
  return world.terrain.lineOfSight(
    x, y, x + Math.cos(ang) * probe, y + Math.sin(ang) * probe, canSwim, canLand, canFly,
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
  echoRange: number,
  canHunt: boolean,
  canGraze: boolean,
): Vec | null {
  // 감지 범위 = 시야(전방·원거리)와 초음파(전방위·근거리) 중 넓은 쪽. 목표 유지도 이 기준.
  const senseRange = Math.max(vision, echoRange);
  const keep2 = (senseRange * SIM.targetKeepFactor) ** 2;

  // 식성으로 못 먹게 된 목표는 버린다(예: 드래프트로 육식이 되면 식물 목표 해제).
  if (!canHunt) e.targetPrey = null;
  if (!canGraze) e.targetFood = null;

  // 1) 눈앞의 가장 가까운 새 후보(먹이·먹잇감)를 매 틱 살핀다 — 더 쉬운(가까운) 먹이가 나타나면 갈아타려고.
  //    감지 = 시야(전방 부채꼴·vision 반경) 또는 초음파(전방위·echoRange). 초음파로 사는 종은 시야가
  //    좁아도(또는 없어도) 사방을 짧게 듣는다. 정지·저속이면 시야도 전방위(두리번).
  const vision2 = vision * vision;
  const echo2 = echoRange * echoRange;
  const inFov = makeFovTest(e);
  const canSense = (x: number, y: number): boolean => {
    const dx = x - e.x;
    const dy = y - e.y;
    const d2 = dx * dx + dy * dy;
    return (d2 < vision2 && inFov(x, y)) || d2 < echo2;
  };
  let prey: Entity | null = null;
  let food: Food | null = null;
  if (canHunt) {
    prey = world.grid.nearestMatching(
      e.x,
      e.y,
      senseRange,
      (p) =>
        p.alive && p !== e && p.species.id !== e.species.id &&
        !areFriends(e.species, p.species) && canSense(p.x, p.y),
    );
  }
  if (canGraze) food = nearestFood(e, world, senseRange, canSense);
  if (prey && food) {
    if (dist2(e, prey) <= dist2(e, food)) food = null;
    else prey = null;
  }
  const cand2 = prey ? dist2(e, prey) : food ? dist2(e, food) : Infinity;

  // 2) 기존 목표 유지 — 단 "히스테리시스": 새 후보가 확실히 더 가까울 때만(cand2 < cur2 × switchGain) 갈아탄다.
  //    조금 더 가까운 정도로는 안 바꿔 목표 진동(떨림)을 막고, 눈앞의 훨씬 쉬운 먹이면 바꿔 불합리한 고집을
  //    없앤다. 목표에 다가갈수록 cur2 가 줄어 더 끈질겨진다(합리적 — 거의 다 온 먹이는 안 놓는다).
  if (e.targetPrey) {
    const p = e.targetPrey;
    if (p.alive && p.species.id !== e.species.id) {
      const cur2 = dist2(e, p);
      if (cur2 <= keep2 && cand2 >= cur2 * SIM.targetSwitchGain) return { x: p.x, y: p.y };
    }
    e.targetPrey = null;
  }
  if (e.targetFood) {
    const f = e.targetFood;
    if (f.available) {
      const cur2 = dist2(e, f);
      if (cur2 <= keep2 && cand2 >= cur2 * SIM.targetSwitchGain) return { x: f.x, y: f.y };
    }
    e.targetFood = null;
  }

  // 3) 새 후보 채택
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
  canFly: boolean,
): { x: number; y: number; final: boolean } {
  const terr = world.terrain;
  // 1) 직선으로 보이면 직진 — 경로 버림. 비행 종은 지형에 안 막혀 늘 직진(BFS 안 탐).
  if (terr.lineOfSight(e.x, e.y, goal.x, goal.y, canSwim, canLand, canFly)) {
    if (e.path.length > 0) {
      e.path.length = 0;
      e.pathGoalTile = -1;
    }
    return { x: goal.x, y: goal.y, final: true };
  }
  // 2) 막힘 — 목표 타일이 바뀌었거나 경로가 없으면 BFS 재계산(그 외엔 캐시 재사용).
  const goalTile = terr.tileIndex(goal.x, goal.y);
  if (e.pathGoalTile !== goalTile || e.path.length === 0) {
    e.path = terr.findPath(e.x, e.y, goal.x, goal.y, canSwim, canLand, canFly);
    e.pathGoalTile = goalTile;
  }
  // 3) 경로 단축(funnel): 다음 웨이포인트가 보이면 현재 것을 건너뛴다.
  while (e.path.length >= 2) {
    const w1 = e.path[1] as number;
    if (terr.lineOfSight(e.x, e.y, terr.tileCenterX(w1), terr.tileCenterY(w1), canSwim, canLand, canFly)) {
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
  senseRange: number,
  canSense: (tx: number, ty: number) => boolean,
): Food | null {
  const kinds = e.species.foodKinds;
  const canSwim = e.genome.traits.swimming >= SIM.swimThreshold;
  const aquaticOnly = e.genome.traits.swimming >= SIM.aquaticOnlyThreshold; // 물 전용(진짜 물고기)
  const canFly = e.genome.traits.wings >= SIM.flyThreshold;
  // 먹이 공간 격자로 감지 반경 안만 검사(완전탐색 대신 — 큰 맵 성능). available·종류·감지는 pred 로.
  return world.foodGrid.nearest(e.x, e.y, senseRange, (f) => {
    if (!f.available) return false;
    if (f.deep) {
      if (!aquaticOnly) return false; // 깊은 바다 먹이는 물 전용 종(물고기)만 — 양용 종(바다 풀뜯이) 배제
    } else if (f.aquatic) {
      if (!canSwim) return false; // 바다 먹이는 수영 형질이 충분한 종만 먹는다(육상 종엔 무경쟁 틈새)
    } else if (f.mountainous) {
      if (!canFly) return false; // 고산 먹이는 날개 형질이 충분한 종만 먹는다(비행 종의 무경쟁 틈새 — 바다 대칭)
    } else if (!kinds.includes(f.kind)) {
      return false; // 이 종이 못 먹는 먹이 종류는 건너뛴다(먹이 분할)
    }
    return canSense(f.x, f.y); // 시야(전방 부채꼴) 또는 초음파(전방위)로 감지되는 먹이만
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

/**
 * 수풀 시야 배율 — 수풀 안이면 시야가 준다(vision 0 → grassVisionFloor 배). vision 형질이 높을수록
 * 감쇠가 사라진다(vision 1 이면 거의 1.0). 수풀 밖이면 1.0. 시야가 지형에서 가치를 갖게 하는 지점.
 */
export function grassVisionFactor(world: World, x: number, y: number, vision: number): number {
  if (!world.terrain.isGrass(x, y)) return 1;
  return Math.min(1, SIM.grassVisionFloor + SIM.grassVisionBonus * vision);
}

/**
 * 험지 이동 배율 — 험지 안이면 속도가 준다(speed 0 → roughSpeedFloor 배). speed 형질이 높을수록
 * 감속이 사라진다(speed 1 이면 거의 1.0). 험지 밖이면 1.0. 속도가 지형에서 가치를 갖게 하는 지점.
 * 인자 speed 는 0~1 정규화 값. (수풀 시야 grassVisionFactor 와 대칭.)
 */
export function roughSpeedFactor(world: World, x: number, y: number, speed: number): number {
  if (!world.terrain.isRough(x, y)) return 1;
  return Math.min(1, SIM.roughSpeedFloor + SIM.roughSpeedBonus * speed);
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
