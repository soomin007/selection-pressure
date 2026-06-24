import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { SIM } from "@/sim/params";

const W = 540;
const H = 960;

function snapshot(world: World): string {
  // 위치/에너지까지 포함한 전체 상태 지문 (결정론 검증용)
  const ents = world.entities.map((e) => `${e.id}:${e.x.toFixed(3)},${e.y.toFixed(3)},${e.energy.toFixed(3)}`);
  return `t${world.tick}|p${world.population}|${ents.join(";")}`;
}

describe("World 결정론", () => {
  it("같은 시드 + 같은 스텝 수 → 완전히 같은 상태", () => {
    const a = new World("run-1", W, H);
    const b = new World("run-1", W, H);
    for (let i = 0; i < 600; i++) {
      a.step();
      b.step();
    }
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it("다른 시드 → 다른 전개", () => {
    const a = new World("run-A", W, H);
    const b = new World("run-B", W, H);
    for (let i = 0; i < 300; i++) {
      a.step();
      b.step();
    }
    expect(snapshot(a)).not.toEqual(snapshot(b));
  });
});

describe("World 생존 sanity", () => {
  it("여러 시드에서 멸종하지도 폭발하지도 않는다", () => {
    for (const seed of ["s1", "s2", "s3", "s4"]) {
      const w = new World(seed, W, H);
      for (let i = 0; i < 2000; i++) w.step();
      expect(w.population).toBeGreaterThan(0);
      expect(w.population).toBeLessThan(SIM.populationCap);
    }
  });
});
