// 황금 고블린 — 격리·결정론 계약과 쫓기·잡기의 감지기 (설계는 sim/goblin.ts 머리 주석).
//
// 계약(2026-08-12 개정): 시련이 안 걸린 세계(quota 0)는 고블린 코드가 한 줄도 안 돌아 기존과
// 같고, 시련이 걸린 세계는 **내 종이 금빛 짐승을 스스로 쫓느라** 움직임이 바뀐다(의도 ·
// **[사용자 2026-08-12]** "내 종조차도 잡으려 하질 않는데"). 대신 결정론은 그대로여야 한다:
// 전용 rng + 순수 기하라 같은 시드는 언제나 같은 판이다.
import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { genomeFromTraits, type Genome, type Traits } from "@/sim/genome";
import { GOBLIN } from "@/sim/goblin";

const W = 540;
const H = 960;

/** lead.test 와 같은 지문 함수(위치·에너지까지). */
function snapshot(world: World): string {
  const ents = world.entities.map(
    (e) => `${e.id}:${e.x.toFixed(3)},${e.y.toFixed(3)},${e.energy.toFixed(3)}`,
  );
  return `t${world.tick}|p${world.population}|${ents.join(";")}`;
}

function tune(over: Partial<Traits>): Genome {
  return genomeFromTraits(over);
}

function run(seed: string, quota: number, steps: number): World {
  const w = new World(seed, W, H, tune({}));
  w.goblinQuota = quota;
  for (let i = 0; i < steps; i++) w.step();
  return w;
}

describe("황금 고블린 · 격리와 결정론", () => {
  it("quota 0 이면 고블린도 쫓기도 없다 — 세계가 시련 없는 판과 완전히 같다", () => {
    const a = run("goblin-off-det", 0, 200);
    const b = run("goblin-off-det", 0, 200);
    expect(a.goblin).toBeNull();
    expect(snapshot(a)).toBe(snapshot(b));
    expect(a.rng.getState()).toBe(b.rng.getState());
  });

  it("시련이 걸린 세계도 결정론이다 — 같은 시드면 개체·고블린·rng 가 비트 단위로 같다", () => {
    const a = run("goblin-det-1", 3, 200);
    const b = run("goblin-det-1", 3, 200);
    expect(a.goblin).not.toBeNull();
    expect(snapshot(a)).toBe(snapshot(b));
    expect(a.rng.getState()).toBe(b.rng.getState());
    expect(a.goblin?.x).toBe(b.goblin?.x);
    expect(a.goblin?.y).toBe(b.goblin?.y);
  });

  it("quota 0 이 되면 고블린이 사라진다(시련이 끝나면 사라져야 한다 · [사용자 2026-08-07])", () => {
    const w = run("goblin-off-1", 3, 60);
    expect(w.goblin).not.toBeNull();
    w.goblinQuota = 0; // game.armTrial(null) 이 하는 일
    w.step();
    expect(w.goblin).toBeNull();
  });
});

/** 내 종 하나만 남기고 goblin 곁 dist px 에 세운다(계측을 깨끗이). */
function soloAt(w: World, dist: number): { x: number; y: number; id: number } {
  const g = w.goblin;
  if (!g) throw new Error("고블린이 없다");
  let kept = false;
  for (let i = w.entities.length - 1; i >= 0; i--) {
    const e = w.entities[i];
    if (e === undefined) continue;
    if (e.species.isPlayer && !kept) {
      kept = true;
      e.x = Math.max(4, g.x - dist);
      e.y = g.y;
      e.prevX = e.x;
      e.prevY = e.y;
      e.vx = 0;
      e.vy = 0;
      continue;
    }
    w.entities.splice(i, 1);
  }
  const chaser = w.entities.find((e) => e.species.isPlayer);
  if (!chaser) throw new Error("내 종이 없다");
  return chaser;
}

describe("황금 고블린 · 도망과 쫓기와 잡기", () => {
  it("금빛 짐승은 다가오는 내 종의 반대쪽으로 달아난다(도망다녀야 한다 · [사용자 2026-08-07])", () => {
    const w = run("goblin-flee-1", 3, 30);
    const g = w.goblin;
    if (!g) throw new Error("고블린이 없다");
    const chaser = soloAt(w, GOBLIN.senseRadius * 0.4);
    const awayX = g.x - chaser.x; // 쫓는 쪽에서 고블린 쪽 = 달아나야 할 방향
    const x0 = g.x;
    const y0 = g.y;
    for (let i = 0; i < 20; i++) w.step();
    const g2 = w.goblin;
    if (!g2) throw new Error("고블린이 도망 중에 사라졌다");
    const moved = Math.hypot(g2.x - x0, g2.y - y0);
    expect(moved).toBeGreaterThan(5); // 실제로 뛰었다
    expect((g2.x - x0) * awayX).toBeGreaterThan(0); // 쫓는 쪽 반대 방향으로
  });

  it("내 종은 근처의 금빛 짐승을 **스스로** 쫓는다 · 지시 없이도 거리가 좁혀진다", () => {
    // **[사용자 2026-08-12]** "금빛 짐승을 내 종조차도 잡으려 하질 않는데" 의 감지기.
    // 내 종 걸음(1.0배)이 고블린(0.88배)보다 빨라, 쫓기만 하면 열린 땅에서도 거리가 준다.
    const w = run("goblin-chase-1", 3, 30);
    const chaser = soloAt(w, GOBLIN.chaseRadius * 0.6);
    const g0 = w.goblin;
    if (!g0) throw new Error("고블린이 없다");
    const d0 = Math.hypot(g0.x - chaser.x, g0.y - chaser.y);
    for (let i = 0; i < 90; i++) w.step();
    const g2 = w.goblin;
    if (g2 === null) return; // 이미 잡았다 — 그 자체가 통과다
    const d2 = Math.hypot(g2.x - chaser.x, g2.y - chaser.y);
    expect(d2).toBeLessThan(d0 - 3);
  });

  it("접촉하면 잡힌다 · marked 계수가 오르고 quota 가 줄고, 남았으면 다음 마리가 뜬다", () => {
    const w = run("goblin-catch-1", 2, 30);
    const g = w.goblin;
    const catcher = w.entities.find((e) => e.alive && e.species.isPlayer);
    if (!g || !catcher) throw new Error("고블린이나 내 종이 없다");
    catcher.x = g.x;
    catcher.y = g.y;
    const before = w.roundCounts.marked;
    w.step();
    expect(w.roundCounts.marked).toBe(before + 1);
    expect(w.goblinQuota).toBe(1);
    expect(w.goblin).toBeNull(); // 잡힌 틱에는 비고
    w.step();
    expect(w.goblin, "quota 가 남았는데 다음 마리가 안 떴다").not.toBeNull(); // 다음 틱에 다음 마리
  });
});
