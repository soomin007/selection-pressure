import { describe, it, expect } from "vitest";
import { Rng } from "@/sim/rng";
import { Terrain, TILE } from "@/sim/terrain";

const W = 540;
const H = 960;
const CS = 20;

function gen(seed: string): Terrain {
  return Terrain.generate(new Rng(seed), W, H, CS);
}

describe("지형(Terrain)", () => {
  it("같은 시드 → 완전히 같은 지형(결정론)", () => {
    const a = gen("t-1");
    const b = gen("t-1");
    expect(a.tiles).toEqual(b.tiles);
    expect(a.elevation).toEqual(b.elevation);
  });

  it("다른 시드 → 다른 지형", () => {
    const a = gen("t-1").tiles.join("");
    const b = gen("t-2").tiles.join("");
    expect(a).not.toEqual(b);
  });

  it("바다·육지·산이 모두 생기고, 육지가 가장 넓다", () => {
    const t = gen("t-1");
    let water = 0;
    let land = 0;
    let mountain = 0;
    for (const k of t.tiles) {
      if (k === TILE.water) water++;
      else if (k === TILE.mountain) mountain++;
      else land++;
    }
    expect(water).toBeGreaterThan(0);
    expect(mountain).toBeGreaterThan(0);
    expect(land).toBeGreaterThan(water);
    expect(land).toBeGreaterThan(mountain);
  });

  it("kindAt/elevationAt 가 격자와 일치", () => {
    const t = gen("t-1");
    expect(t.kindAt(0, 0)).toBe(t.tiles[0]);
    expect(t.elevationAt(0, 0)).toBeCloseTo(t.elevation[0] ?? -1, 10);
    // 경계 밖 좌표도 클램프되어 안전.
    expect(() => t.kindAt(W + 999, H + 999)).not.toThrow();
  });
});
