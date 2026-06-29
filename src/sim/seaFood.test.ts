import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { TILE } from "@/sim/terrain";
import { defaultGenome } from "@/sim/genome";

const W = 540;
const H = 960;

function seaPositions(seed: string): string[] {
  return new World(seed, W, H, defaultGenome()).food
    .filter((f) => f.aquatic)
    .map((f) => `${f.x.toFixed(2)},${f.y.toFixed(2)}`);
}

describe("바다 먹이 틈새 (지형 결합)", () => {
  it("바다 먹이는 물 타일에만 생긴다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const sea = w.food.filter((f) => f.aquatic);
    expect(sea.length).toBeGreaterThan(0);
    for (const f of sea) expect(w.terrain.kindAt(f.x, f.y)).toBe(TILE.water);
  });

  it("육지 먹이는 육지 타일에만 생긴다 (물 위에 안 생김)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const land = w.food.filter((f) => !f.aquatic);
    expect(land.length).toBeGreaterThan(0);
    for (const f of land) expect(w.terrain.kindAt(f.x, f.y)).toBe(TILE.land);
  });

  it("같은 시드 → 같은 바다 먹이 배치(결정론)", () => {
    expect(seaPositions("env-1")).toEqual(seaPositions("env-1"));
  });
});
