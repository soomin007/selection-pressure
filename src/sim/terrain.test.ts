import { describe, it, expect } from "vitest";
import { Rng } from "@/sim/rng";
import { Terrain, TILE, type TileKind } from "@/sim/terrain";

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

  it("isPassable: 물 전용(canLand=false)은 물만 통행하고 육지엔 못 오른다", () => {
    const t = gen("t-1");
    const [lx, ly] = tileCenter(t, t.tiles.findIndex((k) => k === TILE.land));
    const [wx, wy] = tileCenter(t, t.tiles.findIndex((k) => k === TILE.water));
    // 물 전용: 물은 통행, 육지는 차단(진짜 물고기)
    expect(t.isPassable(wx, wy, true, false)).toBe(true);
    expect(t.isPassable(lx, ly, true, false)).toBe(false);
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

describe("길찾기(lineOfSight / findPath)", () => {
  // 합성 지형으로 결정론 검증. cellSize 20, 타일 중심 = (col+0.5)·20, (row+0.5)·20.
  const L = TILE.land;
  const M = TILE.mountain;
  const elev = (n: number): number[] => new Array<number>(n).fill(0.5);

  it("lineOfSight: 같은 칸·트인 직선은 true, 막힌 칸을 가로지르면 false", () => {
    // 3×1: [육지, 산, 육지]. 중심 x = 10 / 30 / 50, y = 10.
    const t = new Terrain(3, 1, 20, elev(3), [L, M, L] as TileKind[]);
    expect(t.lineOfSight(10, 10, 10, 10, false)).toBe(true); // 같은 칸
    expect(t.lineOfSight(10, 10, 30, 10, false)).toBe(false); // 산 칸으로 들어감
    expect(t.lineOfSight(10, 10, 50, 10, false)).toBe(false); // 산을 가로질러 건너편으로
  });

  it("findPath: 막힌 직선을 우회하는 경로를 찾고, 막힌 칸을 지나지 않는다", () => {
    // 3×2 (cols=3): 윗줄 [육지, 산, 육지] / 아랫줄 [육지, 육지, 육지].
    // idx: 0 1 2 / 3 4 5. (0,0)→(2,0) 직선은 산(idx1)에 막혀 아랫줄로 우회해야 한다.
    const tiles = [L, M, L, L, L, L] as TileKind[];
    const t = new Terrain(3, 2, 20, elev(6), tiles);
    const path = t.findPath(10, 10, 50, 10, false); // idx0 중심 → idx2 중심
    expect(path.length).toBeGreaterThan(0); // 경로 존재
    expect(path[path.length - 1]).toBe(2); // 끝은 목표 칸
    expect(path).not.toContain(1); // 산 칸은 지나지 않음
  });

  it("findPath: 도달 불가(완전히 막힘)면 빈 배열", () => {
    // 3×1: [육지, 산, 육지]. 우회로가 없어 건너편 육지에 못 간다.
    const t = new Terrain(3, 1, 20, elev(3), [L, M, L] as TileKind[]);
    expect(t.findPath(10, 10, 50, 10, false)).toEqual([]);
  });
});
