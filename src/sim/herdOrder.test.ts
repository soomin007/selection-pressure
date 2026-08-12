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
import { ORDER_SPECS, orderUnlocked, vacuumTicks, voiceRadius, type HerdOrder } from "@/sim/herdOrder";
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

function run(seed: string, genome: Genome, steps: number, order: HerdOrder | null): World {
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

/** 내 종 개체들이 한 점에서 평균 얼마나 떨어져 있나. 흩어지는 명령은 무게중심이 안 움직여도 이게 는다. */
function meanDistTo(w: World, p: { x: number; y: number }): number {
  let sum = 0;
  let n = 0;
  for (const e of w.entities) {
    if (!e.alive || !e.species.isPlayer) continue;
    sum += Math.hypot(e.x - p.x, e.y - p.y);
    n += 1;
  }
  return n > 0 ? sum / n : 0;
}

// ---------------------------------------------------------------------------
// 「피해라」: 2026-08-09 이전에는 **정반대로 작동했다**
//
// 휠에는 "반대 방향으로 흩어져 달아납니다"라 써 놓고, sim 에는 `order.kind` 를 읽는 분기가 한 줄도
// 없어서 「가라」와 완전히 같은 코드를 밟았다(같은 시드에서 두 명령의 개체 좌표가 비트 단위로 같았다).
// 더블탭은 기본 조작이라, 위험을 보고 누르면 무리가 **그리로** 갔다.
// 아래 둘은 그 회귀의 감지기다. 빨간불이면 kind 분기가 다시 사라진 것이다.
// ---------------------------------------------------------------------------
describe("「피해라」 · 탭한 자리에서 멀어진다", () => {
  const at = (kind: "move" | "evade", spot: { x: number; y: number }, steps: number): World =>
    run("order-evade", tune({ herding: 40 }), steps, { x: spot.x, y: spot.y, kind });

  it("「가라」는 그 자리로 모으고, 「피해라」는 그 자리에서 멀어진다", () => {
    // 탭 지점을 무리 한복판으로 잡는다. 무게중심은 흩어져도 잘 안 움직이므로 **평균 거리**로 잰다.
    const c0 = playerCentroid(run("order-evade", tune({ herding: 40 }), 1, null));
    const spot = { x: c0.x, y: c0.y };
    const idle = meanDistTo(run("order-evade", tune({ herding: 40 }), 200, null), spot);
    const moved = meanDistTo(at("move", spot, 200), spot);
    const fled = meanDistTo(at("evade", spot, 200), spot);
    expect(fled).toBeGreaterThan(idle); // 지시 없는 세계보다 멀어졌다
    expect(fled).toBeGreaterThan(moved); // 그리고 「가라」와 정반대 방향이다
  });

  it("「가라」와 「피해라」는 같은 시드에서 다른 세계를 만든다(옛 결함의 직접 감지기)", () => {
    const spot = { x: 270, y: 480 };
    expect(snapshot(at("evade", spot, 120))).not.toBe(snapshot(at("move", spot, 120)));
  });

  it("「피해라」도 목소리 밖에는 안 간다 · 집계는 들은 개체만 센다", () => {
    const w = new World("order-evade-voice", W, H, tune({ herding: 40 }));
    w.voiceR = 0; // game 이 목소리를 안 넣어 준 상태
    for (let i = 0; i < 60; i++) {
      w.armLead();
      w.herdOrder = { x: 270, y: 480, kind: "evade" };
      w.step();
    }
    expect(w.orderPending).toBe(0);
    expect(w.orderFollowers).toBe(0);
  });
});

describe("명령 휠 · 구현 안 된 칸은 화면에서 약속하지 않는다", () => {
  it("`ready: false` 인 칸은 어떤 도장으로도 안 열린다(게이트가 하나뿐이다)", () => {
    const maxed = {
      fang: TIER_STEPS[3] as number,
      eye: TIER_STEPS[3] as number,
      leg: TIER_STEPS[3] as number,
      hide: TIER_STEPS[3] as number,
      herd: TIER_STEPS[3] as number,
    };
    for (const s of ORDER_SPECS) {
      if (!s.ready) expect(orderUnlocked(s, maxed), s.label).toBe(false);
    }
  });

  it("구현 안 된 칸은 「무엇을 한다」고 말하지 않는다(잠긴 이유와 설명이 같은 한 줄)", () => {
    // 2026-08-09 이전엔 여섯 칸이 "둥글게 서서 안쪽을 지킵니다" 같은 약속을 하면서 실제로는
    // 「가라」와 똑같이 굴었고, 그 위에 쿨타임·기력까지 물렸다(= 벌칙만 붙은 「가라」).
    for (const s of ORDER_SPECS) {
      if (s.ready) continue;
      expect(s.desc, s.label).toBe(s.hint);
      expect(s.desc.length, s.label).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 방울 우선 · **[사용자 2026-08-09]** "가라 명령 때 방울을 우선시해서 알아서 먹는다"
// ---------------------------------------------------------------------------
describe("방울 우선 · 지시가 걸린 동안에만 새어 줍는다", () => {
  /** 개체 하나만 남긴 세계 · 방울을 (dx,dy) 만큼 옆에 놓고 지시는 정반대(동쪽 끝)로 준다. */
  function oneWithDrop(seed: string, order: HerdOrder | null, steps: number): { taken: boolean; snap: string } {
    const w = new World(seed, W, H, tune({ herding: 40 }));
    w.voiceR = 4000;
    let kept = false;
    for (let i = w.entities.length - 1; i >= 0; i--) {
      const e = w.entities[i];
      if (e === undefined) continue;
      if (e.species.isPlayer && !kept) {
        kept = true;
        e.x = 100;
        e.y = 480;
        e.prevX = e.x;
        e.prevY = e.y;
        e.vx = 0;
        e.vy = 0;
        continue;
      }
      w.entities.splice(i, 1); // 야생·나머지 무리는 뺀다 · 도망·뭉침이 계측을 흐리지 않게
    }
    // 지시는 **북쪽**(멀리) · 방울은 **남쪽 130px**(반경 160 안이지만 지시 방향과 반대).
    w.spawnGeneDrop(100, 610, 3, "boss");
    for (let i = 0; i < steps; i++) {
      w.armLead();
      w.herdOrder = order;
      w.step();
    }
    return { taken: w.geneDrops[0]?.taken === true, snap: snapshot(w) };
  }

  it("지시를 따르는 개체는 가는 길과 반대쪽 방울도 들러서 줍는다", () => {
    const r = oneWithDrop("gene-order", { x: 100, y: 60, kind: "move" }, 260);
    expect(r.taken).toBe(true);
  });

  it("지시가 없으면 아무도 방울을 목표로 삼지 않는다(예전 그대로)", () => {
    const r = oneWithDrop("gene-order", null, 260);
    expect(r.taken).toBe(false);
  });

  it("방울이 필드에 있어도 지시가 없으면 세계는 1비트도 안 바뀐다", () => {
    // 방울은 sim 의 이동에 **지시 블록 안에서만** 닿는다 · 그 밖에서는 존재조차 안 읽힌다.
    // 이 단언이 깨지면 방울 우선이 지시 블록 밖으로 새어 나간 것이다(= 밸런스 기준선 이동).
    const withDrop = oneWithDrop("gene-idle", null, 200).snap;
    const w = new World("gene-idle", W, H, tune({ herding: 40 }));
    w.voiceR = 4000;
    let kept = false;
    for (let i = w.entities.length - 1; i >= 0; i--) {
      const e = w.entities[i];
      if (e === undefined) continue;
      if (e.species.isPlayer && !kept) {
        kept = true;
        e.x = 100;
        e.y = 480;
        e.prevX = e.x;
        e.prevY = e.y;
        e.vx = 0;
        e.vy = 0;
        continue;
      }
      w.entities.splice(i, 1);
    }
    for (let i = 0; i < 200; i++) {
      w.armLead();
      w.step();
    }
    expect(withDrop).toBe(snapshot(w));
  });

  it("야생은 방울을 못 줍는다(내 종 전용 계약을 지시가 깨지 않는다)", () => {
    const w = new World("gene-wild", W, H, tune({ herding: 40 }));
    w.voiceR = 4000;
    // 내 종을 전부 없애고 야생만 남긴 뒤, 야생 한 마리 발밑에 방울을 놓는다.
    for (let i = w.entities.length - 1; i >= 0; i--) {
      const e = w.entities[i];
      if (e !== undefined && e.species.isPlayer) w.entities.splice(i, 1);
    }
    const wild = w.entities[0];
    expect(wild).toBeDefined();
    if (wild === undefined) return;
    w.spawnGeneDrop(wild.x, wild.y, 3, "boss");
    for (let i = 0; i < 30; i++) {
      w.herdOrder = { x: wild.x, y: wild.y, kind: "move" };
      w.step();
    }
    expect(w.geneDrops[0]?.taken).toBe(false);
    expect(w.geneCollected).toBe(0);
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
    // ⚠ 2026-08-12 순종 처방 ①(티어 0 목소리 260 → 520)로 이 시험의 무대를 옮겼다. 폰 한 화면
    // 크기(540x960 · 대각 1100px)에서는 520 이 6배로 흩뜨린 무리까지 다 덮어 근/원 차이가 안
    // 드러난다. **그게 처방의 의도다**(첫 시대 = 한 화면 세계에서는 티어 0 도 거의 다 듣는다).
    // 반경이 게이트로 읽히는 것은 **세계가 커진 뒤**이므로, 여기서는 두 배 세계(1080x1920 ·
    // 실제 후기 시대 치수)에서 무리를 열두 배로 벌려 잰다.
    const W2 = W * 2;
    const H2 = H * 2;
    const target = { x: 60, y: 900 };
    const heardWith = (voice: number): number => {
      const w = new World("order-reach", W2, H2, tune({ herding: 40 }));
      w.voiceR = voice;
      w.armLead();
      // 알파를 축으로 무리를 벌린다(같은 시드 = 두 판의 배치가 완전히 같다).
      const ax = w.lead.x;
      const ay = w.lead.y;
      for (const e of w.entities) {
        if (!e.species.isPlayer || e.id === w.lead.leaderId) continue;
        e.x = Math.max(2, Math.min(W2 - 2, ax + (e.x - ax) * 12));
        e.y = Math.max(2, Math.min(H2 - 2, ay + (e.y - ay) * 12));
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

  // ⚠⚠ **2026-08-10 에 계약이 뒤집혔다.** **[사용자]** "지금도 여전히 이끌던 개체 어쩌고가
  //   남아있는데, **이거 그냥 아예 없애줘**." → 지휘 공백을 **명령 경로에서 통째로 걷어냈다**
  //   (`world.hearsOrder` · `game.setHerdOrder`). 알파가 쓰러져도 명령은 계속 통한다.
  //   `leadVacuum` 값 자체는 아직 세지만 **아무도 그것으로 판정하지 않는다**(world.ts 필드 주석).
  //   이 테스트는 그 사실을 **거꾸로** 못 박는다 — 옛 계약이 되살아나면 여기서 걸린다.
  it("알파가 죽어도 명령이 계속 통한다 — 공백은 더 이상 명령을 안 막는다", () => {
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

    // **공백 동안에도 통한다** — 다시 찍으면 그 자리에서 무리가 따른다.
    let during = 0;
    for (let i = 0; i < 20; i++) {
      w.armLead();
      w.herdOrder = { x: 60, y: 900 };
      w.step();
      during = Math.max(during, w.orderFollowers);
    }
    expect(during, "공백 중인데 아무도 안 따랐다 — 게이트가 되살아났는지 보라").toBeGreaterThan(0);
    expect(w.leadVacuum, "전제: 이 구간이 실제로 공백이었다").toBeGreaterThan(0);
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
function worldOn(terrain: Terrain, seed: string, over: Partial<Traits> = {}): World {
  const w = new World(seed, W, H, tune({ herding: 40, ...over }));
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
      // 만 어귀는 물 건너 50~60px 다. 고치기 전에는 이 네 시드가 **전부 57~60 에서 멈췄다**
      // (300틱 내내 주머니 진입 0). 고친 뒤에는 1~24 까지 들어갔다.
      //
      // ⚠ **기준을 40 → 45 로 무르게 했다**(2026-08-10 · 전투 재설계의 파장). 실측: 시드 bay-d
      //   하나가 24 → **41.3** 으로 물러났고 420틱까지 늘려도 더 안 들어간다(거기서 멈춘다).
      //   나머지 셋은 그대로다. 원래 잡으려던 병(어귀 57~60 에서 **완전 정지**)은 재발하지 않았지만
      //   **이 시드가 조금 나빠진 것은 사실이다** — 무르게 한 것을 숨기지 않고 여기 적어 둔다.
      //   ⚠ 45 를 또 넘기면 그때는 기준을 더 늘리지 말고 **원인을 찾아라**(그 시드의 무리가 어귀에서
      //     무엇에 붙들리는지). 물 팔이 해제 반경보다 얇은 지형은 이 저장소가 두 번 데인 자리다.
      expect(best, `시드 ${seed}`).toBeLessThan(45);
    }
  });
});

// ---------------------------------------------------------------------------
// 방울 우선 · **닿을 수 없는 방울은 아예 안 고른다** (2026-08-09 실측)
//
// 무엇이 문제였나: `nearestFreeDrop` 이 `taken` 과 **직선거리**만 봤다. 통행 가능성도 경로 존재도
// 안 봤다. 물 건너 방울이 뽑히면 그것이 navTo 로 들어가는데, findPath 가 빈 배열을 돌려주면 navTo 는
// **목표로 직진**(final=true)을 반환한다. 그 벡터가 ORDER.pull(0.9)로 섞여 개체의 천성(먹이 찾기)이
// 10%만 남고, 개체는 물가에 머리를 박은 채 선다. 그리고 안 풀린다:
//   (a) 방울 추적에는 끼임 카운터가 없다(끼임 감지는 targetFood/targetPrey 가 있을 때만 돈다)
//   (b) 「가라」는 무기한이라 사람이 철회할 때까지 유지된다
//   (c) 도착(reached) 뒤에도 이 분기가 돈다
// 실측(아래 판 그대로 · 고치기 전 → 고친 뒤):
//   · 개체 하나 600틱 · 6시드: 정지 179~322틱 → **0~14틱** · 죽은 시각 232~423틱 → 6시드 중 5시드 생존
//     (남은 한 시드 wall-c 는 방울이 없어도 471틱에 굶는다 · 혼자 390px 를 행군하는 판이라 그렇다).
//     고치기 전에는 여섯 시드 전부 y=480(물벽 북쪽 면)에 얼어붙은 채 죽었다.
//   · 무리 12마리 900틱 · 4시드: 생존 0/1/0/0 → **3/10/3/0** · 정지(개체틱 합) 1058~4745 → 4~106.
//
// 지금은 **건너편 방울이 있는 판과 없는 판이 비트 단위로 같다** · 못 가는 방울은 아무 힘도 안 쓴다.
// 그것이 아래 A/B 단언들이 재는 것이고, 옛 결함의 가장 정확한 감지기다.
//
// ⚠ 「가라」의 **목표 자체**에 길이 없을 때의 직진 폴백은 여기서 안 다룬다(그건 이 기능보다 오래된
//   더 큰 구멍이고, 손대면 밸런스 기준선이 통째로 이동한다 · backlog).
// ---------------------------------------------------------------------------

/**
 * 판을 남북으로 가르는 **폭 1타일 물벽**. gapX 를 주면 그 칸만 육지로 남겨 **돌아가는 길**을 낸다
 * (= 직선은 막혔는데 길은 있는 자리 · 싼 직선 판정만으로 거르면 이 방울을 잃는다).
 * 생성기에 안 기댄다 · 시드마다 지형이 달라지면 재현이 안 된다(만 테스트와 같은 결).
 */
const WALL_TY = 24;
function wallTerrain(gapX: number | null): Terrain {
  const tiles: TileKind[] = new Array<TileKind>(COLS * ROWS).fill(TILE.land);
  const elev: number[] = new Array<number>(COLS * ROWS).fill(0.5);
  for (let x = 0; x < COLS; x++) {
    if (gapX !== null && x === gapX) continue;
    tiles[WALL_TY * COLS + x] = TILE.water;
  }
  return new Terrain(COLS, ROWS, CS, elev, tiles);
}

/** 벽 북쪽에 개체 하나 · 벽 남쪽에 방울 하나 · 지시는 북쪽 끝. 방울은 `drop` 이 true 일 때만 놓는다. */
function wallRun(
  seed: string,
  terrain: Terrain,
  drop: boolean,
  order: HerdOrder | null,
  steps: number,
): { taken: boolean; stalled: number; alive: boolean; toTarget: number; snap: string } {
  // 사냥 성향 0 — 이 블록이 재는 것은 **지시 순종**이지 사냥이 아니다. 사냥감은 지시보다 위라는
  // 우선순위(아래 order 블록의 `hunting`)가 설계라서, 잡식 게놈으로 재면 이주해 온 야생을 쫓는
  // 틱이 순종 계측을 흐린다(실측 2026-08-11: 행동 분화 배치 뒤 wall-a 세계가 바뀌며 플레이어가
  // 600틱 중 146틱을 사냥에 써 도달 거리가 160 → 263 으로 물러났다 · 잠행·TTK·지그재그 상수는
  // 전부 무관함을 갈라 쟀다). 헬퍼의 취지 그대로다: "야생이 계측을 흐리지 않게".
  const w = worldOn(terrain, seed, { hunt: 0 });
  const start = { x: 270, y: 450 }; // 타일 (13,22) 중심 · 벽(24행)에서 두 칸 북쪽
  let kept = false;
  for (let i = w.entities.length - 1; i >= 0; i--) {
    const e = w.entities[i];
    if (e === undefined) continue;
    if (e.species.isPlayer && !kept) {
      kept = true;
      e.x = start.x;
      e.y = start.y;
      e.prevX = e.x;
      e.prevY = e.y;
      e.vx = 0;
      e.vy = 0;
      continue;
    }
    w.entities.splice(i, 1); // 한 마리만 · 뭉침·도망·야생이 계측을 흐리지 않게
  }
  // 방울은 벽 **남쪽** 30px(반경 160 안이지만 벽 건너) · 지시는 정반대인 북쪽 끝.
  if (drop) w.spawnGeneDrop(270, 530, 3, "boss");
  const target = order === null ? start : { x: order.x, y: order.y };
  let stalled = 0;
  let px = start.x;
  let py = start.y;
  for (let i = 0; i < steps; i++) {
    w.armLead();
    w.herdOrder = order;
    w.step();
    const me = w.entities.find((e) => e.alive && e.species.isPlayer);
    if (me === undefined) break;
    // 이번 틱에 사실상 안 움직였나(벽에 머리를 박고 선 상태). 속도 상한이 1px/틱 언저리라 0.05 면 정지다.
    if (Math.hypot(me.x - px, me.y - py) < 0.05) stalled += 1;
    px = me.x;
    py = me.y;
  }
  const me = w.entities.find((e) => e.alive && e.species.isPlayer);
  return {
    taken: w.geneDrops[0]?.taken === true,
    stalled,
    alive: me !== undefined,
    toTarget: me === undefined ? Infinity : Math.hypot(me.x - target.x, me.y - target.y),
    snap: snapshot(w),
  };
}

/** 벽 북쪽에 무리 n 마리 · 벽 남쪽에 방울 하나 · 지시는 북쪽 끝. 굶주림은 무리 단위로만 읽힌다. */
function wallHerdRun(
  seed: string,
  drop: boolean,
  steps: number,
  n: number,
): { alive: number; stalled: number; taken: boolean } {
  const w = worldOn(wallTerrain(null), seed);
  let kept = 0;
  for (let i = w.entities.length - 1; i >= 0; i--) {
    const e = w.entities[i];
    if (e === undefined) continue;
    if (e.species.isPlayer && kept < n) {
      e.x = 270 + ((kept % 4) - 1.5) * 16;
      e.y = 450 - Math.floor(kept / 4) * 16; // 벽(24행 = y 480~500) 북쪽에 뭉쳐 세운다
      e.prevX = e.x;
      e.prevY = e.y;
      e.vx = 0;
      e.vy = 0;
      kept += 1;
      continue;
    }
    w.entities.splice(i, 1); // 야생은 뺀다 · 도망이 굶주림 계측을 흐리지 않게
  }
  if (drop) w.spawnGeneDrop(270, 530, 3, "boss");
  let stalled = 0;
  const prev = new Map<number, { x: number; y: number }>();
  for (const e of w.entities) prev.set(e.id, { x: e.x, y: e.y });
  for (let i = 0; i < steps; i++) {
    w.armLead();
    w.herdOrder = { x: 270, y: 60, kind: "move" };
    w.step();
    for (const e of w.entities) {
      if (!e.alive || !e.species.isPlayer) continue;
      const p = prev.get(e.id);
      if (p !== undefined && Math.hypot(e.x - p.x, e.y - p.y) < 0.05) stalled += 1;
      prev.set(e.id, { x: e.x, y: e.y });
    }
  }
  let alive = 0;
  for (const e of w.entities) if (e.alive && e.species.isPlayer) alive += 1;
  return { alive, stalled, taken: w.geneDrops[0]?.taken === true };
}

describe("방울 우선 · 닿을 수 없는 방울은 안 고른다", () => {
  const north: HerdOrder = { x: 270, y: 60, kind: "move" };

  it("물로 갈린 판에서 건너편 방울을 안 고른다(있는 판과 없는 판이 비트 단위로 같다)", () => {
    for (const seed of ["wall-a", "wall-b", "wall-c"]) {
      const withDrop = wallRun(seed, wallTerrain(null), true, north, 600);
      const without = wallRun(seed, wallTerrain(null), false, north, 600);
      expect(withDrop.taken, `시드 ${seed}`).toBe(false); // 애초에 못 가는 방울이다
      // 건너편 방울이 이동에 **한 번도 안 닿았다**는 가장 강한 진술. 고치기 전에는 이 판이
      // 통째로 다른 세계였다(개체가 물벽에 붙어 굶어 죽었다).
      expect(withDrop.snap, `시드 ${seed}`).toBe(without.snap);
    }
  });

  it("벽에 안 박히고 지시를 계속 따른다 · 정지 틱이 안 는다", () => {
    for (const seed of ["wall-a", "wall-b", "wall-follow"]) {
      const r = wallRun(seed, wallTerrain(null), true, north, 600);
      // 고치기 전: 이 시드들이 정지 179~322틱이었고 y=480(물벽 면)에 얼어붙었다.
      expect(r.stalled, `시드 ${seed}`).toBeLessThan(60);
      expect(r.alive, `시드 ${seed}`).toBe(true);
      expect(r.toTarget, `시드 ${seed}`).toBeLessThan(160); // 북쪽 지시점 근처까지 실제로 갔다
    }
  });

  it("무리가 건너편 방울 앞에서 굶어 죽지 않는다(12마리 900틱)", () => {
    // 이 게임에서 굶주림은 개체 하나가 아니라 무리 단위로 읽힌다 · 혼자 행군하는 판은 방울과
    // 무관하게도 굶는 시드가 있어(위 wall-c) 생존을 홀로 재면 잡음이 크다.
    let aliveWith = 0;
    let stalledWith = 0;
    for (const seed of ["herd-a", "herd-b", "herd-c", "herd-d"]) {
      const withDrop = wallHerdRun(seed, true, 900, 12);
      const without = wallHerdRun(seed, false, 900, 12);
      expect(withDrop.taken, `시드 ${seed}`).toBe(false);
      expect(withDrop.alive, `시드 ${seed}`).toBe(without.alive); // 방울이 죽음을 안 만든다
      expect(withDrop.stalled, `시드 ${seed}`).toBe(without.stalled);
      aliveWith += withDrop.alive;
      stalledWith += withDrop.stalled;
    }
    // 고치기 전 실측: 생존 합 1(0/1/0/0) · 정지 합 10169. 고친 뒤: 16(3/10/3/0) · 227.
    // (재기준선 이력) 2026-08-12 순종 처방 셋(목소리 520 · 「가는 길 먹이」 예외 제거 · 스침 채집
    // 30px) 뒤 정지 합 1401. 옛 세계는 행군이 먹이로 늘 새서 다들 걸어 다녔고, 지금은 도착한
    // 무리가 감속 링 안에서 실제로 **자리를 지키고 선다**(순종 17 → 72%의 자연스러운 뒷면).
    // 벽 박힘 병리(10169)와는 자릿수가 다르다 · 문턱은 그 병리만 다시 잡게 3000 으로 올렸다.
    expect(aliveWith).toBeGreaterThan(8);
    expect(stalledWith).toBeLessThan(3000);
  });

  it("길이 있는 방울은 여전히 고른다 · 직선(같은 판·벽 없음)", () => {
    // 이 케이스가 빨간불이면 「기능을 통째로 끈 것」과 구별이 안 된다.
    const r = wallRun("wall-flat", flatTerrain(), true, north, 600);
    expect(r.taken).toBe(true);
  });

  it("길이 있는 방울은 여전히 고른다 · 돌아가는 길(직선은 물에 막혔다)", () => {
    // 벽에 구멍 하나(타일 x=10) · 개체(x=13)와 방울(x=13) 사이 직선은 물이지만 돌아가면 닿는다.
    // 싼 직선 판정(walkableLine)만으로 걸렀다면 이 방울은 영영 안 주워진다.
    const terrain = wallTerrain(10);
    expect(terrain.walkableLine(270, 450, 270, 530, false, true, false)).toBe(false); // 전제: 직선은 막혔다
    expect(terrain.findPath(270, 450, 270, 530, false, true, false).length).toBeGreaterThan(0); // 전제: 길은 있다
    const r = wallRun("wall-gap", terrain, true, north, 600);
    expect(r.taken).toBe(true);
  });

  it("지시가 null 이면 방울이 있든 없든 세계가 1비트도 안 달라진다", () => {
    // 도달 판정을 넣으면서 지형 훑기가 지시 밖으로 새면 여기서 잡힌다.
    const withDrop = wallRun("wall-idle", wallTerrain(null), true, null, 300);
    const without = wallRun("wall-idle", wallTerrain(null), false, null, 300);
    expect(withDrop.snap).toBe(without.snap);
  });
});
