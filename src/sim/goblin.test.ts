// 황금 고블린 — 생태 격리 계약의 감지기 (설계는 sim/goblin.ts 머리 주석).
//
// 이 파일의 절반은 "기능이 된다"가 아니라 **"기존 세계를 1비트도 안 건드렸다"** 를 증명한다.
// 고블린은 시험이 걸린 라운드마다 세계에 들어오는 존재라, 생태·rng 에 새는 순간 그 라운드의
// 밸런스가 조용히 다른 세계가 된다(방울 · 알파 조종과 같은 격리 계열).
import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { genomeFromTraits, type Genome, type Traits } from "@/sim/genome";
import { GOBLIN } from "@/sim/goblin";

const W = 540;
const H = 960;

/** lead.test 와 같은 지문 함수(위치·에너지까지). 고블린은 entities 에 없으므로 지문에 안 잡힌다 —
 *  그래서 「지문이 같다」 = 「생태가 안 흔들렸다」가 된다. */
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

describe("황금 고블린 · 생태 격리(기존 세계 불변)", () => {
  it("시험이 걸린 세계와 안 걸린 세계의 개체·rng 가 비트 단위로 같다", () => {
    const idle = run("goblin-iso-1", 0, 300);
    const armed = run("goblin-iso-1", 3, 300);
    expect(armed.goblin, "quota 를 줬는데 고블린이 없다").not.toBeNull();
    expect(snapshot(armed)).toBe(snapshot(idle));
    expect(armed.rng.getState()).toBe(idle.rng.getState());
  });

  it("같은 시드면 고블린의 자리도 같다(전용 rng · 재현 가능)", () => {
    const a = run("goblin-det-1", 3, 200).goblin;
    const b = run("goblin-det-1", 3, 200).goblin;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (!a || !b) return;
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
  });

  it("quota 0 이면 고블린이 사라진다(시험이 끝나면 사라져야 한다 · [사용자 2026-08-07])", () => {
    const w = run("goblin-off-1", 3, 60);
    expect(w.goblin).not.toBeNull();
    w.goblinQuota = 0; // game.armTrial(null) 이 하는 일
    w.step();
    expect(w.goblin).toBeNull();
  });
});

describe("황금 고블린 · 도망과 잡기", () => {
  it("내 종이 다가가면 멀어진다(도망다녀야 한다 · [사용자 2026-08-07])", () => {
    const w = run("goblin-flee-1", 3, 30);
    const g = w.goblin;
    if (!g) throw new Error("고블린이 없다");
    // 내 종 하나를 감지 반경 안, 접촉 밖에 세운다(나머지는 치워 계측을 깨끗이).
    let kept = false;
    for (let i = w.entities.length - 1; i >= 0; i--) {
      const e = w.entities[i];
      if (e === undefined) continue;
      if (e.species.isPlayer && !kept) {
        kept = true;
        e.x = Math.max(4, g.x - GOBLIN.senseRadius * 0.4);
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
    const d0 = Math.hypot(g.x - chaser.x, g.y - chaser.y);
    for (let i = 0; i < 20; i++) w.step();
    const g2 = w.goblin;
    if (!g2) throw new Error("고블린이 도망 중에 사라졌다");
    expect(Math.hypot(g2.x - chaser.x, g2.y - chaser.y)).toBeGreaterThan(d0);
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
