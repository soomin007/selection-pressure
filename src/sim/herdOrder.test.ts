// 무리 지시(신탁) — 알파 조종을 대체한 새 조작의 안전장치.
//
// 이 파일의 절반은 "기능이 된다"가 아니라 **"뜻을 안 내리면 기존 세계와 1비트도 안 다르다"** 를
// 증명한다. 지시는 sim 한복판(stepEntity 의 desired)에 손을 넣는 기능이라, 잘못 걸면 난수 스트림이
// 통째로 밀려 여태 쌓은 밸런스가 조용히 다른 세계가 된다(known_issues 의 "쌍둥이 rng" 계열).
// 여기 결정론 테스트는 **완화 대상이 아니라 감지기**다 · 빨간불이면 테스트가 낡은 게 아니라 설계가 틀렸다.
//
// v8 추가 — **명령은 목소리가 닿는 데까지만 간다**(`herdOrder.voiceRadius`). 그래서 이 파일의 헬퍼는
// `world.voiceR` 을 반드시 세워야 한다. 안 세우면(0) 명령이 아무에게도 안 가고, 그건 "지시가 고장 났다"가
// 아니라 "game 이 아직 목소리를 안 넣어 줬다"는 뜻이다 · game 은 매 단계 무리 티어에서 계산해 넣는다.
import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { ORDER, SIM } from "@/sim/params";
import { Terrain, TILE, type TileKind } from "@/sim/terrain";
import { genomeFromPips, genomeFromTraits, type Genome, type Traits } from "@/sim/genome";
import { vacuumTicks, voiceRadius } from "@/sim/herdOrder";
import { HERD_VOICE, TIER_STEPS, emptyKeys, emptyPips, tierOf } from "@/sim/tiers";

const W = 540;
const H = 960;

/** lead.test.ts · world.test.ts 와 **같은 지문 함수**. 세 곳의 비교 기준이 갈리면 안 된다. */
function snapshot(world: World): string {
  const ents = world.entities.map(
    (e) => `${e.id}:${e.x.toFixed(3)},${e.y.toFixed(3)},${e.energy.toFixed(3)}`,
  );
  return `t${world.tick}|p${world.population}|${ents.join(";")}`;
}

/**
 * 능치를 직접 정한 종. v8 에서 능치는 도장에서 파생되지만, 여기서 재는 것은 **지시 규칙**이지
 * 성장 규칙이 아니다 — 야생과 같은 길(`genomeFromTraits`)로 만들어 v7 과 같은 세계 위에서 잰다.
 */
function tune(over: Partial<Traits>): Genome {
  return genomeFromTraits(over);
}

/** 이 게놈으로 명령이 닿는 거리. game 이 매 단계 넣어 주는 그 값과 같은 함수에서 나온다. */
function voiceOf(genome: Genome): number {
  return voiceRadius(genome.pips, genome.keys);
}

function run(seed: string, genome: Genome, steps: number, order: { x: number; y: number } | null): World {
  const w = new World(seed, W, H, genome);
  w.voiceR = voiceOf(genome);
  for (let i = 0; i < steps; i++) {
    // game 이 매 프레임 하는 것과 같다(멱등 · rng 미소비). 목소리는 알파에서부터 재므로 알파가 있어야 한다.
    w.armLead();
    // 알파가 쓰러지면 걸려 있던 명령이 풀리는 것이 v8 규칙이라, **사람이 그 점을 계속 찍고 있는 상태**를
    // 흉내 낸다(안 그러면 알파가 죽는 시드에서만 조용히 다른 것을 재게 된다).
    w.herdOrder = order;
    w.step();
  }
  return w;
}

/** 내 종 개체들의 무게중심. "무리가 어디로 갔나"를 재는 데 쓴다. */
function playerCentroid(w: World): { x: number; y: number; n: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const e of w.entities) {
    if (!e.alive || !e.species.isPlayer) continue;
    sx += e.x;
    sy += e.y;
    n += 1;
  }
  return n > 0 ? { x: sx / n, y: sy / n, n } : { x: 0, y: 0, n: 0 };
}

describe("무리 지시 — 결정론 (뜻을 안 내리면 기존과 동일)", () => {
  it("herdOrder 가 null 이면 지문이 완전히 같다(부동소수점까지)", () => {
    const a = run("order-det-1", tune({}), 300, null);
    const b = run("order-det-1", tune({}), 300, null);
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it("같은 뜻을 내리면 같은 세계가 나온다(재현 가능)", () => {
    const o = { x: 80, y: 120 };
    const a = run("order-det-2", tune({}), 300, o);
    const b = run("order-det-2", tune({}), 300, o);
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it("뜻을 내리면 세계가 달라진다(지시가 실제로 작동한다는 증거)", () => {
    const none = run("order-det-3", tune({}), 300, null);
    const some = run("order-det-3", tune({}), 300, { x: 60, y: 900 });
    expect(snapshot(some)).not.toBe(snapshot(none));
  });
});

describe("무리 지시 — 뜻은 분명하다 (방향은 반드시 따른다)", () => {
  it("무리 성향 0 인 종도 지시를 따른다(무리 성향은 게이트가 아니다)", () => {
    // 시작 프리셋 8개 중 5개가 무리 성향 0 이라, 여기에 게이트를 걸면 그 종들은 조작이 아예 안 먹힌다.
    const solo = tune({ herding: 0 });
    const target = { x: 60, y: 900 };
    const before = playerCentroid(run("order-solo", solo, 1, target));
    const after = playerCentroid(run("order-solo", solo, 600, target));
    const d0 = Math.hypot(before.x - target.x, before.y - target.y);
    const d1 = Math.hypot(after.x - target.x, after.y - target.y);
    expect(after.n).toBeGreaterThan(0);
    expect(d1).toBeLessThan(d0); // 목표에 **가까워졌다**
  });

  it("무리 성향이 높은 종도 당연히 따른다", () => {
    const herd = tune({ herding: 92 });
    const target = { x: 480, y: 80 };
    const before = playerCentroid(run("order-herd", herd, 1, target));
    const after = playerCentroid(run("order-herd", herd, 600, target));
    expect(Math.hypot(after.x - target.x, after.y - target.y)).toBeLessThan(
      Math.hypot(before.x - target.x, before.y - target.y),
    );
  });

  it("도착하면 그 근방에 머문다(지시가 한 점으로 빨아들이지 않는다)", () => {
    const target = { x: 270, y: 480 }; // 맵 한복판
    const w = run("order-stay", tune({ herding: 60 }), 900, target);
    const c = playerCentroid(w);
    expect(c.n).toBeGreaterThan(0);
    // 무게중심이 도착 반경 근처에 있고, 개체들이 한 점에 겹쳐 있지 않다.
    expect(Math.hypot(c.x - target.x, c.y - target.y)).toBeLessThan(ORDER.arriveRadius * 3);
    let spread = 0;
    let n = 0;
    for (const e of w.entities) {
      if (!e.alive || !e.species.isPlayer) continue;
      spread += Math.hypot(e.x - c.x, e.y - c.y);
      n += 1;
    }
    expect(n > 0 ? spread / n : 0).toBeGreaterThan(1); // 겹쳐 있지 않다
  });

  it("순종의 질 집계(orderFollowers·orderPending)가 실물과 맞는다", () => {
    const target = { x: 60, y: 900 };
    const w = run("order-count", tune({ herding: 40 }), 200, target);
    let mine = 0;
    for (const e of w.entities) if (e.alive && e.species.isPlayer) mine += 1;
    expect(w.orderFollowers).toBeGreaterThan(0); // 누군가는 향하고 있다
    expect(w.orderFollowers).toBeLessThanOrEqual(mine); // 내 종 수를 넘을 수 없다
    // 화면 "따르는 중 N/M" 의 계약: 분모(orderPending · 아직 못 닿은 수)는 분자 이상, 내 종 수 이하.
    // 도망 중인 개체는 분모에만 들 수 있으므로 N < M 이 정상 상태다.
    expect(w.orderPending).toBeGreaterThanOrEqual(w.orderFollowers);
    expect(w.orderPending).toBeLessThanOrEqual(mine);
    // 뜻이 없으면 아무도 안 센다(분자·분모 모두).
    const idle = run("order-count", tune({ herding: 40 }), 200, null);
    expect(idle.orderFollowers).toBe(0);
    expect(idle.orderPending).toBe(0);
  });

  it("무리 코앞(해제 반경 밖 · 무리 도착 반경 안)을 탭해도 지시가 걸린다", () => {
    // 2026-08-05 결함의 재발 방지: 개체 게이트가 arriveRadius(200)와 겸직이라, 무리 근처
    // (무게중심에서 150px)를 탭하면 개체 대부분이 게이트 안 = 아무도 안 움직였다.
    // 게이트는 releaseRadius(64) · 개체 단위여야 한다. 값을 하드코딩하지 않고 상수 관계로 잰다.
    expect(ORDER.releaseRadius).toBeLessThan(ORDER.arriveRadius); // 전제: 해제 < 도착 표시
    const g = tune({ herding: 40 });
    const c0 = playerCentroid(run("order-near", g, 1, null));
    const off = (ORDER.releaseRadius + ORDER.arriveRadius) / 2; // 해제 밖 · 옛 게이트(200) 안
    const target = {
      x: Math.max(40, Math.min(W - 40, c0.x + off)),
      y: Math.max(40, Math.min(H - 40, c0.y)),
    };
    const w = run("order-near", g, 10, target); // 같은 시드 = 같은 초기 배치
    expect(w.orderPending).toBeGreaterThan(0); // 아직 못 닿은 개체가 있고
    expect(w.orderFollowers).toBeGreaterThan(0); // 그중 누군가는 실제로 움직인다
  });

  it("야생 종은 지시를 안 따른다(내 종에게만 내리는 뜻)", () => {
    const target = { x: 60, y: 900 };
    const withOrder = run("order-wild", tune({}), 600, target);
    let wildNear = 0;
    let wildTotal = 0;
    for (const e of withOrder.entities) {
      if (!e.alive || e.species.isPlayer) continue;
      wildTotal += 1;
      if (Math.hypot(e.x - target.x, e.y - target.y) < ORDER.arriveRadius) wildNear += 1;
    }
    // 야생이 우연히 근처에 있을 수는 있지만, 무리 전체가 몰려 있으면 안 된다.
    if (wildTotal > 0) expect(wildNear / wildTotal).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// v8 — 목소리가 닿는 데까지만 간다 (**[사용자 2026-08-06]** 확정)
//
// 이 규칙 하나가 조작 감각을 둘로 가른다: 무리를 안 판 종은 소수를 직접 데리고 다니는 손맛,
// 무리를 판 종은 대군을 한 번에 움직이는 맛. 그래서 여기 테스트는 "기능이 된다"가 아니라
// **"티어가 손끝에서 읽힌다"** 를 못 박는다.
// ---------------------------------------------------------------------------
describe("명령이 닿는 거리 — 무리 티어가 넓힌다", () => {
  it("무리 티어가 오를수록 목소리가 멀리 간다(3단부터는 사실상 종 전체)", () => {
    const at = (pips: number): number =>
      voiceRadius({ ...emptyPips(), herd: pips }, emptyKeys());
    expect(at(0)).toBe(HERD_VOICE[0]);
    expect(at(TIER_STEPS[0])).toBeGreaterThan(at(0));
    expect(at(TIER_STEPS[1])).toBeGreaterThan(at(TIER_STEPS[0]));
    // 폰 논리 해상도(540x960)의 화면 대각(약 1100px)을 3단에서 넘어선다 = 종 전체가 듣는다.
    expect(at(TIER_STEPS[2])).toBeGreaterThan(Math.hypot(W, H));
  });

  it("열쇠 「부름」은 그 거리를 더 넓힌다(대신 포식자도 듣는다)", () => {
    const pips = { ...emptyPips(), herd: TIER_STEPS[0] };
    expect(voiceRadius(pips, { ...emptyKeys(), call: true })).toBeGreaterThan(
      voiceRadius(pips, emptyKeys()),
    );
  });

  it("목소리가 0 이면 명령이 아무에게도 안 간다 — 세계가 자율로 굴러간 것과 같다", () => {
    const target = { x: 60, y: 900 };
    const silent = (): World => {
      const w = new World("order-mute", W, H, tune({ herding: 40 }));
      w.voiceR = 0; // game 이 목소리를 안 넣어 준 상태
      for (let i = 0; i < 300; i++) {
        w.armLead();
        w.herdOrder = target;
        w.step();
      }
      return w;
    };
    const w = silent();
    expect(w.orderFollowers).toBe(0);
    expect(w.orderPending).toBe(0);
    // 뜻을 아예 안 내린 세계와 부동소수점까지 같다(안 닿는 명령은 세계를 1비트도 안 건드린다).
    const idle = run("order-mute", tune({ herding: 40 }), 300, null);
    expect(snapshot(w)).toBe(snapshot(idle));
  });

  it("흩어진 무리에서는 목소리가 좁을수록 듣는 개체가 적다(반경이 실제 게이트다)", () => {
    // 시작 무리는 한 덩어리라 260px 안에 다 들어간다 — 그 상태로 재면 반경 차이가 안 드러난다.
    // 그래서 **무리를 실제로 흩뜨린 뒤** 잰다. 이게 무리가 커졌을 때의 실제 모습이기도 하다.
    const target = { x: 60, y: 900 };
    const heardWith = (voice: number): number => {
      const w = new World("order-reach", W, H, tune({ herding: 40 }));
      w.voiceR = voice;
      w.armLead();
      // 알파를 축으로 무리를 여섯 배로 벌린다(같은 시드 = 두 판의 배치가 완전히 같다).
      const ax = w.lead.x;
      const ay = w.lead.y;
      for (const e of w.entities) {
        if (!e.species.isPlayer || e.id === w.lead.leaderId) continue;
        e.x = Math.max(2, Math.min(W - 2, ax + (e.x - ax) * 6));
        e.y = Math.max(2, Math.min(H - 2, ay + (e.y - ay) * 6));
      }
      w.herdOrder = target;
      w.step();
      return w.orderPending;
    };
    const near = heardWith(HERD_VOICE[0]);
    const far = heardWith(HERD_VOICE[3]);
    expect(near).toBeGreaterThan(0); // 코앞의 몇은 여전히 듣는다
    expect(far).toBeGreaterThan(near); // 멀리 가는 목소리는 흩어진 무리까지 닿는다
  });

  it("무리 도장을 찍으면 그 종의 목소리 자체가 넓어진다(게놈 → 조작)", () => {
    const solo = genomeFromPips(emptyPips(), emptyKeys());
    const crowd = genomeFromPips({ ...emptyPips(), herd: TIER_STEPS[2] }, emptyKeys());
    expect(tierOf(crowd.pips.herd)).toBe(3);
    expect(voiceOf(crowd)).toBeGreaterThan(voiceOf(solo));
  });
});

describe("지휘 공백 — 알파가 쓰러지면 잠시 명령이 안 통한다", () => {
  it("무리 티어가 오를수록 공백이 짧아진다(조직이 있으면 곧바로 이어받는다)", () => {
    const at = (pips: number): number => vacuumTicks({ ...emptyPips(), herd: pips });
    expect(at(TIER_STEPS[0])).toBeLessThan(at(0));
    expect(at(TIER_STEPS[1])).toBeLessThan(at(TIER_STEPS[0]));
    expect(at(TIER_STEPS[3])).toBeLessThan(at(TIER_STEPS[2]));
    expect(at(TIER_STEPS[3])).toBeGreaterThan(0); // 그래도 공짜는 아니다
  });

  it("알파가 죽으면 공백이 걸리고, 그동안 명령이 아무에게도 안 간다", () => {
    const w = new World("order-vacuum", W, H, tune({ herding: 40 }));
    w.voiceR = 4000; // 목소리는 넉넉하다 — 막는 것이 거리가 아님을 분명히 한다
    w.vacuumOnLeadDeath = 90;
    for (let i = 0; i < 120; i++) {
      w.armLead();
      w.herdOrder = { x: 60, y: 900 };
      w.step();
    }
    expect(w.orderFollowers).toBeGreaterThan(0); // 전제: 공백 전에는 실제로 따르고 있었다

    // 알파를 쓰러뜨린다 — 그 틱 끝의 승계가 공백을 건다.
    const alphaId = w.lead.leaderId;
    for (const e of w.entities) if (e.id === alphaId) e.alive = false;
    w.step();
    expect(w.leadVacuum).toBeGreaterThan(0);
    expect(w.herdOrder).toBeNull(); // 걸려 있던 명령도 함께 풀린다(누가 시켰는지가 없어졌다)

    // 공백 동안에는 다시 찍어도 안 통한다.
    for (let i = 0; i < 20; i++) {
      w.armLead();
      w.herdOrder = { x: 60, y: 900 };
      w.step();
      expect(w.orderFollowers).toBe(0);
    }
    // 공백이 다 지나면 다시 통한다.
    while (w.leadVacuum > 0) {
      w.armLead();
      w.herdOrder = { x: 60, y: 900 };
      w.step();
    }
    let after = 0;
    for (let i = 0; i < 30; i++) {
      w.armLead();
      w.herdOrder = { x: 60, y: 900 };
      w.step();
      after = Math.max(after, w.orderFollowers);
    }
    expect(after).toBeGreaterThan(0);
  });

  it("공백은 불씨를 안 깎는다 — 대가는 손끝이 치른다(sim 은 불씨를 아예 모른다)", () => {
    // sim 에는 불씨라는 개념이 없다. 이 단언은 "알파 죽음의 대가가 sim 밖으로 새지 않는다"를 못 박는다.
    const w = new World("order-vacuum-2", W, H, tune({}));
    w.voiceR = 4000;
    w.vacuumOnLeadDeath = vacuumTicks(emptyPips());
    for (let i = 0; i < 60; i++) {
      w.armLead();
      w.step();
    }
    const alphaId = w.lead.leaderId;
    for (const e of w.entities) if (e.id === alphaId) e.alive = false;
    w.step();
    expect(w.leadVacuum).toBe(vacuumTicks(emptyPips()));
    expect(w.lead.leaderId).not.toBe(alphaId); // 다음 개체가 지휘봉을 이어받았다
  });
});

// ---------------------------------------------------------------------------
// 오목한 만 · **물 건너 코앞에서 지시를 놓지 않는다** (2026-08-08 사용자 제보)
//
// 원문: "호수 등으로 오목하게 둘러싸여 있는 곳은 「가라」 명령을 내려도 개체들이 들어가질 못한다."
// 그리고 그때 화면은 「무리 도착」이라고 말한다.
//
// 무엇이 문제였나: 해제 게이트가 **직선거리**만 쟀다. 목표를 감싼 물 팔이 해제 반경(64px)보다
// 얇으면, 무리가 맞은편 물가에 닿는 순간 이미 반경 안이라 지시 블록이 통째로 스킵되고 우회
// 길찾기(navTo)가 호출조차 안 된다. orderPending 이 0 이 되니 화면은 「무리 도착」이라 말한다.
// → 게이트를 **지형 인지형**으로 바꿨다(`walkableLine`). 지형이 사이를 막고 있으면 아직 못 닿은 것이다.
//
// ⚠ `lineOfSight`(8연결)가 아니라 `walkableLine`(대각 모서리를 안 뚫음)을 써야 한다 · 실측으로
//   물 모서리 위에서 lineOfSight 가 소수점 이동마다 뒤집혀 무리가 275틱 동안 굳었다.
// ---------------------------------------------------------------------------

const CS = SIM.terrainCellSize;
const COLS = Math.ceil(W / CS);
const ROWS = Math.ceil(H / CS);
/** 만의 안쪽 육지 주머니(목표가 있는 곳) 중심 타일과 반경. */
const BAY_TX = 13;
const BAY_TY = 30;
const BAY_R = 1;

/**
 * 전부 육지인 판에, 목표 타일 둘레 BAY_R 만큼을 육지 주머니로 남기고 **폭 arm 타일의 물 U** 를
 * 두른다(위·왼·오른쪽이 물 · 아래가 열린 만). 생성기에 기대지 않는다 · 시드마다 지형이 달라지면
 * 재현이 안 된다. 아래가 열려 있으므로 **길은 반드시 있다**(돌아 들어가면 된다).
 */
function bayTerrain(arm: number): Terrain {
  const tiles: TileKind[] = new Array<TileKind>(COLS * ROWS).fill(TILE.land);
  const elev: number[] = new Array<number>(COLS * ROWS).fill(0.5);
  const water = (x: number, y: number): void => {
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) tiles[y * COLS + x] = TILE.water;
  };
  for (let x = BAY_TX - BAY_R - arm; x <= BAY_TX + BAY_R + arm; x++)
    for (let y = BAY_TY - BAY_R - arm; y <= BAY_TY - BAY_R - 1; y++) water(x, y);
  for (let y = BAY_TY - BAY_R - arm; y <= BAY_TY + BAY_R; y++)
    for (let x = BAY_TX - BAY_R - arm; x <= BAY_TX - BAY_R - 1; x++) water(x, y);
  for (let y = BAY_TY - BAY_R - arm; y <= BAY_TY + BAY_R; y++)
    for (let x = BAY_TX + BAY_R + 1; x <= BAY_TX + BAY_R + arm; x++) water(x, y);
  return new Terrain(COLS, ROWS, CS, elev, tiles);
}

/** 온 판이 육지인 대조군(같은 치수 · 같은 좌표계). */
function flatTerrain(): Terrain {
  return new Terrain(COLS, ROWS, CS, new Array<number>(COLS * ROWS).fill(0.5), new Array<TileKind>(COLS * ROWS).fill(TILE.land));
}

/**
 * 지형을 갈아 끼운 세계. 먹이는 새 지형에 맞춰 정리한다 · 진짜 게임에서 뭍 먹이는 물 타일에 절대
 * 안 놓이므로(world 의 spawnFoodOnTiles), 안 맞추면 "물 건너 먹이에 머리를 박는" 인공 결함이 계측을 덮는다.
 */
function worldOn(terrain: Terrain, seed: string): World {
  const w = new World(seed, W, H, tune({ herding: 40 }));
  (w as unknown as { terrain: Terrain }).terrain = terrain;
  for (let i = w.food.length - 1; i >= 0; i--) {
    const f = w.food[i];
    if (f === undefined) continue;
    if (f.aquatic !== (terrain.kindAt(f.x, f.y) === TILE.water)) w.food.splice(i, 1);
  }
  w.foodGrid.build(w.food);
  w.voiceR = 4000; // 목소리가 막는 것이 아님을 분명히 한다
  return w;
}

describe("오목한 만 · 지형에 막힌 코앞은 「도착」이 아니다", () => {
  const target = { x: (BAY_TX + 0.5) * CS, y: (BAY_TY + 0.5) * CS };

  /** 개체 하나를 (tx,ty) 타일 중심에 세우고 한 틱 굴린 뒤 지시 집계를 돌려준다. */
  function oneStep(terrain: Terrain, tx: number, ty: number): { pending: number; followers: number; dist: number } {
    const w = worldOn(terrain, "bay-gate");
    let kept = false;
    for (let i = w.entities.length - 1; i >= 0; i--) {
      const e = w.entities[i];
      if (e === undefined) continue;
      if (e.species.isPlayer && !kept) {
        kept = true;
        e.x = (tx + 0.5) * CS;
        e.y = (ty + 0.5) * CS;
        e.prevX = e.x;
        e.prevY = e.y;
        e.vx = 0;
        e.vy = 0;
        continue;
      }
      w.entities.splice(i, 1); // 한 마리만 남긴다 · 뭉침·도망이 게이트 판정을 흐리지 않게
    }
    w.armLead();
    w.herdOrder = target;
    const e0 = w.entities[0];
    const dist = e0 === undefined ? Infinity : Math.hypot(e0.x - target.x, e0.y - target.y);
    w.step();
    return { pending: w.orderPending, followers: w.orderFollowers, dist };
  }

  it("물 팔 하나(20px) 건너 50px 앞에 선 개체는 여전히 「따라야 할」 수에 든다", () => {
    // 만의 닫힌 끝 바로 위 = 목표에서 직선으로 50px(해제 반경 64보다 가깝다) · 그런데 사이가 물이다.
    const r = oneStep(bayTerrain(1), BAY_TX, BAY_TY - BAY_R - 2);
    expect(r.dist).toBeLessThan(ORDER.releaseRadius); // 전제: 직선거리로는 이미 "코앞"이다
    expect(r.pending).toBe(1); // 그래도 아직 못 닿았다 → 화면은 「무리 도착」이라 말하지 않는다
    expect(r.followers).toBe(1); // 그리고 실제로 돌아가려 움직인다(navTo 가 걸린다)
  });

  it("같은 거리라도 길이 트여 있으면 예전 그대로 놓아 준다(해제 반경은 살아 있다)", () => {
    // 물만 없앤 같은 좌표 · 이 케이스가 깨지면 "가까이 가면 자율로 산다"는 계약이 무너진 것이다.
    const r = oneStep(flatTerrain(), BAY_TX, BAY_TY - BAY_R - 2);
    expect(r.dist).toBeLessThan(ORDER.releaseRadius);
    expect(r.pending).toBe(0);
    expect(r.followers).toBe(0);
  });

  it("무리가 만 안으로 실제로 들어간다(여러 시드)", () => {
    // 물 팔이 해제 반경보다 얇은(20px) 만 = 예전에 무리가 통째로 갇히던 모양.
    // 실측(고치기 전): 이 네 시드 전부 목표 57~60px 앞에서 300틱 내내 멈춰 있었다(주머니 진입 0).
    for (const seed of ["bay-c", "bay-d", "bay-e", "bay-f"]) {
      const terrain = bayTerrain(1);
      const w = worldOn(terrain, seed);
      // 무리를 만의 **닫힌 끝 바깥**(물 건너)에 세운다 · 돌아 들어가야만 닿는 자리.
      const startY = (BAY_TY - BAY_R - 2 + 0.5) * CS;
      let i = 0;
      for (const e of w.entities) {
        if (!e.species.isPlayer) {
          e.x = 20; // 야생은 멀리 · 도망이 계측을 흐리지 않게
          e.y = H - 20;
          continue;
        }
        e.x = (BAY_TX + 0.5) * CS + ((i % 5) - 2) * 12;
        e.y = startY - Math.floor(i / 5) * 12;
        e.prevX = e.x;
        e.prevY = e.y;
        e.vx = 0;
        e.vy = 0;
        i += 1;
      }
      let best = Infinity;
      for (let s = 0; s < 300; s++) {
        w.armLead();
        w.herdOrder = target; // 사람이 그 점을 계속 찍고 있는 상태(알파가 죽으면 명령이 풀리므로)
        w.step();
        for (const e of w.entities) {
          if (!e.alive || !e.species.isPlayer) continue;
          best = Math.min(best, Math.hypot(e.x - target.x, e.y - target.y));
        }
      }
      // 40px = 만 어귀(물 건너 50~60px)와 주머니 안쪽을 가르는 선. 고치기 전에는 이 네 시드가
      // 전부 57~60 에서 멈췄고, 고친 뒤에는 1~24 까지 들어간다.
      expect(best, `시드 ${seed}`).toBeLessThan(40);
    }
  });
});
