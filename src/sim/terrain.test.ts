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

describe("지형 통행(이동 차단)", () => {
  const tileCenter = (t: Terrain, i: number): [number, number] => [
    ((i % t.cols) + 0.5) * t.cellSize,
    (Math.floor(i / t.cols) + 0.5) * t.cellSize,
  ];

  it("isPassable: 육지는 누구나·물은 수영 종만·산은 누구도 못 넘는다", () => {
    const t = gen("t-1");
    const [lx, ly] = tileCenter(t, t.tiles.findIndex((k) => k === TILE.land));
    const [wx, wy] = tileCenter(t, t.tiles.findIndex((k) => k === TILE.water));
    const [mx, my] = tileCenter(t, t.tiles.findIndex((k) => k === TILE.mountain));
    // 육지: 수영 여부와 무관하게 통행
    expect(t.isPassable(lx, ly, false)).toBe(true);
    expect(t.isPassable(lx, ly, true)).toBe(true);
    // 물: 수영 종만
    expect(t.isPassable(wx, wy, false)).toBe(false);
    expect(t.isPassable(wx, wy, true)).toBe(true);
    // 산: 수영 종도 못 넘는다
    expect(t.isPassable(mx, my, false)).toBe(false);
    expect(t.isPassable(mx, my, true)).toBe(false);
  });

  it("nearestPassable: 통행 좌표는 그대로, 막힌 좌표는 통행 가능 타일로 스냅", () => {
    const t = gen("t-1");
    const [lx, ly] = tileCenter(t, t.tiles.findIndex((k) => k === TILE.land));
    // 통행 가능하면 입력 그대로(위치 안 옮김)
    const same = t.nearestPassable(lx, ly, false);
    expect(same.x).toBe(lx);
    expect(same.y).toBe(ly);
    // 막힌 산 좌표 → 비수영 종은 통행 가능한 곳으로 스냅(결과가 실제 통행 가능)
    const [mx, my] = tileCenter(t, t.tiles.findIndex((k) => k === TILE.mountain));
    const snapped = t.nearestPassable(mx, my, false);
    expect(t.isPassable(snapped.x, snapped.y, false)).toBe(true);
  });
});
