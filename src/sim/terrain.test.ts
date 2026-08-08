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

  it("nearestLargePassable: 물 전용 종을 작은 웅덩이 대신 큰 바다에 놓는다", () => {
    const Wt = TILE.water;
    // 10×1: [웅덩이 물3 | 육지1 | 바다 물6]. 웅덩이=연결 3칸, 바다=연결 6칸.
    const tiles = [Wt, Wt, Wt, L, Wt, Wt, Wt, Wt, Wt, Wt] as TileKind[];
    const t = new Terrain(10, 1, 20, elev(10), tiles);
    // 웅덩이 한가운데(idx1, x≈30)에서 물 전용(canSwim·!canLand), 큰 영역 기준 4칸 이상
    const spot = t.nearestLargePassable(30, 10, true, false, false, 4);
    expect(t.tileIndex(spot.x, spot.y)).toBeGreaterThanOrEqual(4); // 큰 바다(idx4~9)로 간다
    // 반면 nearestPassable 은 그냥 가장 가까운 물(웅덩이)로 간다
    expect(t.tileIndex(t.nearestPassable(30, 10, true, false, false).x, 10)).toBeLessThanOrEqual(2);
    // 큰 영역이 아예 없으면(웅덩이만) 폴백으로 통행 가능한 웅덩이라도 준다(갇혀도 스폰은 됨)
    const onlyPond = new Terrain(4, 1, 20, elev(4), [Wt, Wt, L, L] as TileKind[]);
    const fb = onlyPond.nearestLargePassable(10, 10, true, false, false, 8);
    expect(onlyPond.tileIndex(fb.x, fb.y)).toBeLessThanOrEqual(1); // 물칸(0~1)로 폴백
  });
});

// ---------------------------------------------------------------------------
// walkableLine · **직선으로 보이는 것과 직진으로 갈 수 있는 것은 다르다**
//
// 개체의 이동은 축 분리(x 따로 · y 따로 막힘)라 사실상 4연결이고 findPath 도 4연결인데,
// lineOfSight 는 Bresenham 8연결이라 대각 모서리를 뚫고 지나간다. 그 어긋남 위에서 「가라」
// 해제 게이트가 매 틱 뒤집혀 무리가 목표 코앞에서 굳었다(2026-08-08).
// walkableLine 은 그 어긋남을 없앤 판정이다 · lineOfSight 는 손대지 않는다(먹이 길찾기·뭉침·
// 보스가 함께 보는 판정이라 바꾸면 rng 소비 분기가 밀린다).
// ---------------------------------------------------------------------------
describe("walkableLine · 대각 모서리를 안 뚫는다", () => {
  /** 두 육지 덩어리가 **모서리로만** 맞닿은 4x4 판. 나머지는 물. */
  function cornerOnly(): Terrain {
    const Wt = TILE.water;
    const L = TILE.land;
    // (0,0)(1,0) 육지 / (2,1)(3,1) 육지 · (1,0) 과 (2,1) 이 대각으로만 맞닿는다.
    const tiles: TileKind[] = [L, L, Wt, Wt, Wt, Wt, L, L];
    return new Terrain(4, 2, 20, new Array<number>(8).fill(0.5), tiles);
  }

  it("모서리로만 이어진 두 땅: 직선은 뚫리는데 걸어서는 못 간다(4연결과 같은 답)", () => {
    const t = cornerOnly();
    const from = { x: 30, y: 10 }; // 타일 (1,0)
    const to = { x: 50, y: 30 }; // 타일 (2,1)
    expect(t.lineOfSight(from.x, from.y, to.x, to.y, false)).toBe(true); // 8연결이라 뚫린다
    expect(t.walkableLine(from.x, from.y, to.x, to.y, false)).toBe(false); // 걸어서는 못 간다
    expect(t.findPath(from.x, from.y, to.x, to.y, false).length).toBe(0); // 실제 길도 없다
  });

  it("트인 땅에서는 lineOfSight 와 같은 답을 준다(멀쩡한 길을 막지 않는다)", () => {
    const t = new Terrain(4, 2, 20, new Array<number>(8).fill(0.5), new Array<TileKind>(8).fill(TILE.land));
    expect(t.walkableLine(10, 10, 70, 30, false)).toBe(true);
    expect(t.walkableLine(70, 30, 10, 10, false)).toBe(true);
    expect(t.walkableLine(10, 10, 10, 10, false)).toBe(true); // 제자리
  });

  it("대각 한 걸음이라도 끼고 도는 칸 하나가 트여 있으면 통과로 본다면 안 된다(양쪽 다 봐야 한다)", () => {
    // (1,0) → (2,1) 로 갈 때 끼고 도는 칸은 (2,0) 과 (1,1). 하나만 트여 있어도 **직진으로는**
    // 모서리에 눌려 미끄러지므로 walkableLine 은 거짓이어야 한다(그게 이 판정의 존재 이유다).
    const Wt = TILE.water;
    const L = TILE.land;
    const tiles: TileKind[] = [L, L, L, Wt, Wt, Wt, L, L]; // (2,0) 만 육지
    const t = new Terrain(4, 2, 20, new Array<number>(8).fill(0.5), tiles);
    expect(t.walkableLine(30, 10, 50, 30, false)).toBe(false);
    expect(t.findPath(30, 10, 50, 30, false).length).toBeGreaterThan(0); // 돌아가는 길은 있다
  });

  it("물을 건널 수 있는 종(canSwim)에게는 물이 벽이 아니다", () => {
    const t = cornerOnly();
    expect(t.walkableLine(30, 10, 50, 30, true)).toBe(true);
  });

  it("나는 종은 어디든 직진한다", () => {
    const t = cornerOnly();
    expect(t.walkableLine(30, 10, 50, 30, false, true, true)).toBe(true);
  });
});
