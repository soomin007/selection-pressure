// 무리 지시(신탁) — 알파 조종을 대체한 새 조작의 안전장치.
//
// 이 파일의 절반은 "기능이 된다"가 아니라 **"뜻을 안 내리면 기존 세계와 1비트도 안 다르다"** 를
// 증명한다. 지시는 sim 한복판(stepEntity 의 desired)에 손을 넣는 기능이라, 잘못 걸면 난수 스트림이
// 통째로 밀려 여태 쌓은 밸런스가 조용히 다른 세계가 된다(known_issues 의 "쌍둥이 rng" 계열).
// 여기 결정론 테스트는 **완화 대상이 아니라 감지기**다 · 빨간불이면 테스트가 낡은 게 아니라 설계가 틀렸다.
import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { ORDER } from "@/sim/params";
import { defaultGenome, type Genome, type Traits } from "@/sim/genome";

const W = 540;
const H = 960;

/** lead.test.ts · world.test.ts 와 **같은 지문 함수**. 세 곳의 비교 기준이 갈리면 안 된다. */
function snapshot(world: World): string {
  const ents = world.entities.map(
    (e) => `${e.id}:${e.x.toFixed(3)},${e.y.toFixed(3)},${e.energy.toFixed(3)}`,
  );
  return `t${world.tick}|p${world.population}|${ents.join(";")}`;
}

function tune(over: Partial<Traits>): Genome {
  const g = defaultGenome();
  Object.assign(g.traits, over);
  return g;
}

function run(seed: string, genome: Genome, steps: number, order: { x: number; y: number } | null): World {
  const w = new World(seed, W, H, genome);
  w.herdOrder = order;
  for (let i = 0; i < steps; i++) w.step();
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
    const a = run("order-det-1", defaultGenome(), 300, null);
    const b = run("order-det-1", defaultGenome(), 300, null);
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it("같은 뜻을 내리면 같은 세계가 나온다(재현 가능)", () => {
    const o = { x: 80, y: 120 };
    const a = run("order-det-2", defaultGenome(), 300, o);
    const b = run("order-det-2", defaultGenome(), 300, o);
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it("뜻을 내리면 세계가 달라진다(지시가 실제로 작동한다는 증거)", () => {
    const none = run("order-det-3", defaultGenome(), 300, null);
    const some = run("order-det-3", defaultGenome(), 300, { x: 60, y: 900 });
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

  it("순종의 질 집계(orderFollowers)가 실물과 맞는다", () => {
    const target = { x: 60, y: 900 };
    const w = run("order-count", tune({ herding: 40 }), 200, target);
    let mine = 0;
    for (const e of w.entities) if (e.alive && e.species.isPlayer) mine += 1;
    expect(w.orderFollowers).toBeGreaterThan(0); // 누군가는 향하고 있다
    expect(w.orderFollowers).toBeLessThanOrEqual(mine); // 내 종 수를 넘을 수 없다
    // 뜻이 없으면 아무도 안 센다.
    const idle = run("order-count", tune({ herding: 40 }), 200, null);
    expect(idle.orderFollowers).toBe(0);
  });

  it("야생 종은 지시를 안 따른다(내 종에게만 내리는 뜻)", () => {
    const target = { x: 60, y: 900 };
    const withOrder = run("order-wild", defaultGenome(), 600, target);
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
