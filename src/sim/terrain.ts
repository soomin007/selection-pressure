// 지형 (Terrain) — 스포어식 이질적 세계의 첫 기둥(Phase 1).
// 시드 결정론으로 타일 격자에 표고(elevation)를 만들고 바다·육지·산으로 분류한다.
//
// ⚠️ 지금은 "순수 시각 레이어"다 — 이동/먹이/시야와 아직 결합하지 않는다(다음 슬라이스에서 결합,
//    밸런스 프로브 동반). 그래서 World 의 메인 rng 와 "독립된 rng"로 생성해 기존 sim 동역학
//    (결정론 스냅샷·보스/대멸종 밸런스)을 1비트도 건드리지 않는다.
//
// 순수 TS. Pixi import 금지. (게놈/환경 시드) → 항상 같은 지형.

import type { Rng } from "@/sim/rng";

/** 타일 종류. 0 바다 · 1 육지 · 2 산 · 3 수풀. (수풀은 통행은 육지와 같되 시야를 가린다.) */
export type TileKind = 0 | 1 | 2 | 3;
export const TILE = { water: 0, land: 1, mountain: 2, grass: 3 } as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface TerrainOptions {
  /** 표고가 이보다 낮으면 바다. (정규화된 표고 기준) */
  waterLevel: number;
  /** 표고가 waterLevel~이 사이(물가 저지대)면 수풀. 이보다 높으면 트인 육지. */
  grassLevel: number;
  /** 표고가 이보다 높으면 산. */
  mountainLevel: number;
  /** 표고 노이즈 블러 횟수 — 많을수록 큰 대륙/바다 덩어리. */
  blurPasses: number;
}

const DEFAULTS: TerrainOptions = { waterLevel: 0.32, grassLevel: 0.46, mountainLevel: 0.76, blurPasses: 4 };

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
      // 낮을수록 바다 → 물가 저지대 수풀 → 트인 육지 → 높으면 산.
      tiles[i] =
        e < opt.waterLevel
          ? TILE.water
          : e > opt.mountainLevel
            ? TILE.mountain
            : e < opt.grassLevel
              ? TILE.grass
              : TILE.land;
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

  /** 이 좌표가 수풀인가 — 수풀 안에선 시야가 가려진다(behavior 의 시야 계산에서 참조). */
  isGrass(x: number, y: number): boolean {
    return this.kindAt(x, y) === TILE.grass;
  }

  /**
   * 이 좌표를 (canSwim·canLand 인 종이) 지나갈 수 있는가.
   * 산은 누구도 못 넘고, 물은 수영 형질이 충분한 종(canSwim)만, 육지는 canLand 인 종만 통행한다.
   * canLand=false 는 물 전용(진짜 물고기) — 육지에 못 올라온다. rng 미사용 → 결정론.
   */
  isPassable(x: number, y: number, canSwim: boolean, canLand = true): boolean {
    const k = this.kindAt(x, y);
    if (k === TILE.mountain) return false;
    if (k === TILE.water) return canSwim;
    return canLand;
  }

  private passableTile(cx: number, cy: number, canSwim: boolean, canLand: boolean): boolean {
    const k = this.tiles[cy * this.cols + cx] ?? TILE.land;
    if (k === TILE.mountain) return false;
    if (k === TILE.water) return canSwim;
    return canLand;
  }

  /**
   * (x,y) 가 막힌 타일이면 가장 가까운 통행 가능 타일의 중심을 돌려준다(통행 가능하면 그대로).
   * 스폰(초기/이주/번식)이 물·산 한가운데 떨어져 갇히는 것을 막는다. **rng 미사용 = 결정론·밸런스 무관**
   * — 위치만 살짝 옮길 뿐 무작위 스트림을 안 건드린다(스폰 rng 소비 횟수 보존이 밸런스 보존의 열쇠).
   */
  /** 좌표가 속한 타일 인덱스(경계 밖은 클램프). 경로 추종에서 목표 타일 식별·웨이포인트 변환에 쓴다. */
  tileIndex(x: number, y: number): number {
    return this.indexAt(x, y);
  }

  tileCenterX(idx: number): number {
    return ((idx % this.cols) + 0.5) * this.cellSize;
  }

  tileCenterY(idx: number): number {
    return (Math.floor(idx / this.cols) + 0.5) * this.cellSize;
  }

  private passableIndex(idx: number, canSwim: boolean, canLand: boolean): boolean {
    const k = this.tiles[idx] ?? TILE.land;
    if (k === TILE.mountain) return false;
    if (k === TILE.water) return canSwim;
    return canLand;
  }

  /**
   * (x0,y0)→(x1,y1) 직선이 지나는 타일에 (canSwim 기준) 막힌 칸이 없으면 true. Bresenham 격자 순회.
   * 길찾기의 1차 판정 — 목표가 직선으로 보이면 BFS 없이 바로 직진한다(대부분의 경우, 가볍다).
   */
  lineOfSight(x0: number, y0: number, x1: number, y1: number, canSwim: boolean, canLand = true): boolean {
    let cx = clampIndex(Math.floor(x0 / this.cellSize), this.cols);
    let cy = clampIndex(Math.floor(y0 / this.cellSize), this.rows);
    const ex = clampIndex(Math.floor(x1 / this.cellSize), this.cols);
    const ey = clampIndex(Math.floor(y1 / this.cellSize), this.rows);
    const dx = Math.abs(ex - cx);
    const dy = Math.abs(ey - cy);
    const sx = cx < ex ? 1 : -1;
    const sy = cy < ey ? 1 : -1;
    let err = dx - dy;
    // 무한 루프 방지(격자 크기로 상한). 정상 경로는 dx+dy 안에 끝난다.
    for (let guard = 0; guard <= dx + dy + 1; guard++) {
      if (!this.passableIndex(cy * this.cols + cx, canSwim, canLand)) return false;
      if (cx === ex && cy === ey) return true;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }
    return true;
  }

  /**
   * start 타일 → goal 타일까지 통행 가능한 4방향 최단 경로(BFS)를 타일 인덱스 배열로 돌려준다
   * (start 다음 칸부터 goal 까지). 경로가 없으면 빈 배열. rng 미사용 → 결정론(이웃 순회 순서 고정).
   * 직선이 막혔을 때만 호출되고 목표 타일이 바뀔 때만 재계산되므로(behavior 가 캐시) 빈도가 낮다.
   */
  findPath(x0: number, y0: number, x1: number, y1: number, canSwim: boolean, canLand = true): number[] {
    const n = this.cols * this.rows;
    const start = this.indexAt(x0, y0);
    const goal = this.indexAt(x1, y1);
    if (start === goal) return [];
    if (!this.passableIndex(goal, canSwim, canLand)) return []; // 목표 칸이 막힘(보통 먹이는 통행 칸)
    const prev = new Int32Array(n).fill(-1);
    const seen = new Uint8Array(n);
    const queue: number[] = [start];
    seen[start] = 1;
    let head = 0;
    let reached = false;
    while (head < queue.length) {
      const cur = queue[head++] ?? 0;
      if (cur === goal) {
        reached = true;
        break;
      }
      const cx = cur % this.cols;
      const cy = (cur - cx) / this.cols;
      // 4방향(상하좌우). 순서 고정 → 결정론.
      if (cx + 1 < this.cols) this.visit(cur + 1, cur, canSwim, canLand, seen, prev, queue);
      if (cx - 1 >= 0) this.visit(cur - 1, cur, canSwim, canLand, seen, prev, queue);
      if (cy + 1 < this.rows) this.visit(cur + this.cols, cur, canSwim, canLand, seen, prev, queue);
      if (cy - 1 >= 0) this.visit(cur - this.cols, cur, canSwim, canLand, seen, prev, queue);
    }
    if (!reached) return [];
    // goal → start 역추적 후 뒤집어 start 다음..goal 순서로.
    const path: number[] = [];
    let c = goal;
    while (c !== start && c !== -1) {
      path.push(c);
      c = prev[c] ?? -1;
    }
    path.reverse();
    return path;
  }

  private visit(
    next: number,
    cur: number,
    canSwim: boolean,
    canLand: boolean,
    seen: Uint8Array,
    prev: Int32Array,
    queue: number[],
  ): void {
    if (seen[next] || !this.passableIndex(next, canSwim, canLand)) return;
    seen[next] = 1;
    prev[next] = cur;
    queue.push(next);
  }

  nearestPassable(x: number, y: number, canSwim: boolean, canLand = true): { x: number; y: number } {
    if (this.isPassable(x, y, canSwim, canLand)) return { x, y };
    const cs = this.cellSize;
    const sx = clampIndex(Math.floor(x / cs), this.cols);
    const sy = clampIndex(Math.floor(y / cs), this.rows);
    const maxR = Math.max(this.cols, this.rows);
    for (let r = 1; r <= maxR; r++) {
      let bestX = -1;
      let bestY = -1;
      let bestD2 = Infinity;
      // 반경 r 의 정사각 링만 검사(안쪽은 이미 본 거리).
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const cx = sx + dx;
          const cy = sy + dy;
          if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) continue;
          if (!this.passableTile(cx, cy, canSwim, canLand)) continue;
          const px = (cx + 0.5) * cs;
          const py = (cy + 0.5) * cs;
          const d2 = (px - x) * (px - x) + (py - y) * (py - y);
          if (d2 < bestD2) {
            bestD2 = d2;
            bestX = px;
            bestY = py;
          }
        }
      }
      if (bestX >= 0) return { x: bestX, y: bestY };
    }
    return { x, y }; // 통행 가능 타일이 하나도 없을 때(실제론 육지가 항상 있어 도달 안 함)
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
