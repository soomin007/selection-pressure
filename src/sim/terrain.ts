// 지형 (Terrain) — 스포어식 이질적 세계의 첫 기둥(Phase 1).
// 시드 결정론으로 타일 격자에 표고(elevation)를 만들고 바다·육지·산으로 분류한다.
//
// ⚠️ 지금은 "순수 시각 레이어"다 — 이동/먹이/시야와 아직 결합하지 않는다(다음 슬라이스에서 결합,
//    밸런스 프로브 동반). 그래서 World 의 메인 rng 와 "독립된 rng"로 생성해 기존 sim 동역학
//    (결정론 스냅샷·보스/대멸종 밸런스)을 1비트도 건드리지 않는다.
//
// 순수 TS. Pixi import 금지. (게놈/환경 시드) → 항상 같은 지형.

import type { Rng } from "@/sim/rng";

/** 타일 종류. 0 바다 · 1 육지 · 2 산. (숫자라 Uint 배열로도 가볍게 다룰 수 있다.) */
export type TileKind = 0 | 1 | 2;
export const TILE = { water: 0, land: 1, mountain: 2 } as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface TerrainOptions {
  /** 표고가 이보다 낮으면 바다. (정규화된 표고 기준) */
  waterLevel: number;
  /** 표고가 이보다 높으면 산. */
  mountainLevel: number;
  /** 표고 노이즈 블러 횟수 — 많을수록 큰 대륙/바다 덩어리. */
  blurPasses: number;
}

const DEFAULTS: TerrainOptions = { waterLevel: 0.32, mountainLevel: 0.76, blurPasses: 4 };

export class Terrain {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  /** 정규화된 표고 [0,1] (렌더 음영·향후 이동 비용에). */
  readonly elevation: readonly number[];
  /** 타일 종류(바다/육지/산). */
  readonly tiles: readonly TileKind[];

  constructor(
    cols: number,
    rows: number,
    cellSize: number,
    elevation: number[],
    tiles: TileKind[],
  ) {
    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
    this.elevation = elevation;
    this.tiles = tiles;
  }

  static generate(
    rng: Rng,
    width: number,
    height: number,
    cellSize: number,
    options?: Partial<TerrainOptions>,
  ): Terrain {
    const opt: TerrainOptions = { ...DEFAULTS, ...options };
    const cols = Math.max(1, Math.ceil(width / cellSize));
    const rows = Math.max(1, Math.ceil(height / cellSize));

    // 표고: 무작위 → 여러 번 블러(부드러운 덩어리) → 전 범위로 정규화(바다·산이 확실히 생기게).
    let f: number[] = new Array<number>(cols * rows);
    for (let i = 0; i < f.length; i++) f[i] = rng.unit();
    for (let p = 0; p < opt.blurPasses; p++) f = blur(f, cols, rows);

    let lo = Infinity;
    let hi = -Infinity;
    for (const v of f) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = hi - lo || 1;

    const elevation = new Array<number>(cols * rows);
    const tiles = new Array<TileKind>(cols * rows);
    for (let i = 0; i < f.length; i++) {
      const e = clamp01(((f[i] ?? 0.5) - lo) / span);
      elevation[i] = e;
      tiles[i] = e < opt.waterLevel ? TILE.water : e > opt.mountainLevel ? TILE.mountain : TILE.land;
    }
    return new Terrain(cols, rows, cellSize, elevation, tiles);
  }

  private indexAt(x: number, y: number): number {
    const cx = clampIndex(Math.floor(x / this.cellSize), this.cols);
    const cy = clampIndex(Math.floor(y / this.cellSize), this.rows);
    return cy * this.cols + cx;
  }

  kindAt(x: number, y: number): TileKind {
    return this.tiles[this.indexAt(x, y)] ?? TILE.land;
  }

  elevationAt(x: number, y: number): number {
    return this.elevation[this.indexAt(x, y)] ?? 0.5;
  }

  isWater(x: number, y: number): boolean {
    return this.kindAt(x, y) === TILE.water;
  }

  isMountain(x: number, y: number): boolean {
    return this.kindAt(x, y) === TILE.mountain;
  }
}

function clampIndex(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/** 3×3 평균 블러 한 번. (환경 필드와 같은 기법 — 부드러운 구역을 만든다.) */
function blur(src: number[], cols: number, rows: number): number[] {
  const out = new Array<number>(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          sum += src[ny * cols + nx] ?? 0;
          count += 1;
        }
      }
      out[y * cols + x] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}
