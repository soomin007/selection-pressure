// 지형 (Terrain) — 스포어식 이질적 세계의 첫 기둥(Phase 1).
// 시드 결정론으로 타일 격자에 표고(elevation)를 만들고 바다·육지·산으로 분류한다.
//
// ⚠️ 지금은 "순수 시각 레이어"다 — 이동/먹이/시야와 아직 결합하지 않는다(다음 슬라이스에서 결합,
//    밸런스 프로브 동반). 그래서 World 의 메인 rng 와 "독립된 rng"로 생성해 기존 sim 동역학
//    (결정론 스냅샷·보스/대멸종 밸런스)을 1비트도 건드리지 않는다.
//
// 순수 TS. Pixi import 금지. (게놈/환경 시드) → 항상 같은 지형.

import type { Rng } from "@/sim/rng";

/**
 * 타일 종류. 0 바다 · 1 육지 · 2 산 · 3 수풀 · 4 험지.
 * 수풀·험지는 통행은 육지와 같되 형질을 요구한다 — 수풀은 시야를 가리고, 험지는 이동을 늦춘다.
 */
export type TileKind = 0 | 1 | 2 | 3 | 4;
export const TILE = { water: 0, land: 1, mountain: 2, grass: 3, rough: 4 } as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface TerrainOptions {
  /** 표고가 이보다 낮으면 바다. (정규화된 표고 기준) */
  waterLevel: number;
  /** 표고가 waterLevel~이 사이(물가 저지대)면 수풀. 이보다 높으면 트인 육지. */
  grassLevel: number;
  /** 표고가 roughLevel~mountainLevel 사이(산 아래 고지대)면 험지. 그 아래는 트인 육지. */
  roughLevel: number;
  /** 표고가 이보다 높으면 산. */
  mountainLevel: number;
  /** 표고 노이즈 블러 횟수 — 많을수록 큰 대륙/바다 덩어리. */
  blurPasses: number;
  /**
   * 가장자리 침강 — 0이면 없음(맵 전체가 고르게 무작위). 0보다 크면 맵 테두리로 갈수록 표고를 낮춰
   * **바깥이 바다로 둘러싸인 하나의 큰 땅덩어리**가 된다(판게아). 1에 가까울수록 육지가 가운데로 뭉친다.
   */
  edgeFalloff: number;
  /**
   * 지형 **목표 비율**(합이 1 미만이면 나머지가 트인 육지). 주면 위의 표고 임계값(waterLevel 등)을 무시하고,
   * 이 비율이 정확히 나오도록 임계값을 표고 분포에서 역산한다(분위수).
   *
   * 왜 필요한가: 임계값(예: "표고 0.32 아래는 바다")을 고정하면 **시드마다 바다가 4%~38% 로 널뛴다** —
   * 표고 분포 모양이 시드마다 달라서다. 그러면 "대륙"이라는 종류가 아무 뜻이 없다(같은 이름인데 어떤
   * 판은 호수뿐이고 어떤 판은 반쯤 물바다). 비율로 지정하면 판마다 "군도는 늘 바다 절반"이 보장된다.
   *
   * 안 주면 기존 임계값 방식 그대로 — 대륙(기본 맵)은 밸런스 기준선이라 이 값을 안 준다.
   */
  fractions?: {
    sea: number;
    grass: number;
    rough: number;
    mountain: number;
  };
}

const DEFAULTS: TerrainOptions = {
  waterLevel: 0.32,
  grassLevel: 0.46,
  roughLevel: 0.7,
  mountainLevel: 0.76,
  blurPasses: 4,
  edgeFalloff: 0,
};

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

    // 가장자리 침강(판게아) — 테두리로 갈수록 표고를 낮춰 "바다에 둘러싸인 하나의 큰 땅"을 만든다.
    // 정규화 전에 곱해야 한다(정규화가 뒤에서 다시 0~1 로 펴므로, 여기서 눌린 테두리가 최저=바다가 된다).
    if (opt.edgeFalloff > 0) {
      for (let i = 0; i < f.length; i++) {
        const cx = i % cols;
        const cy = Math.floor(i / cols);
        // 중심 0, 테두리 1 (정사각 거리 — 네 변이 고르게 잠긴다. 유클리드면 모서리만 깊게 파인다).
        const nx = Math.abs((cx + 0.5) / cols - 0.5) * 2;
        const ny = Math.abs((cy + 0.5) / rows - 0.5) * 2;
        const d = Math.max(nx, ny);
        f[i] = (f[i] ?? 0.5) * (1 - opt.edgeFalloff * d * d);
      }
    }

    let lo = Infinity;
    let hi = -Infinity;
    for (const v of f) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = hi - lo || 1;

    const elevation = new Array<number>(cols * rows);
    for (let i = 0; i < f.length; i++) elevation[i] = clamp01(((f[i] ?? 0.5) - lo) / span);

    // 목표 비율이 주어지면 임계값을 표고 분포에서 역산한다(분위수) → 시드가 달라도 비율이 일정.
    let waterLevel = opt.waterLevel;
    let grassLevel = opt.grassLevel;
    let roughLevel = opt.roughLevel;
    let mountainLevel = opt.mountainLevel;
    const fr = opt.fractions;
    if (fr) {
      const sorted = elevation.slice().sort((a, b) => a - b);
      const q = (p: number): number => {
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
        return sorted[idx] ?? 0.5;
      };
      // 낮은 쪽부터: 바다 → 수풀 → 트인 육지 → 험지 → 산.
      waterLevel = q(fr.sea);
      grassLevel = q(fr.sea + fr.grass);
      roughLevel = q(1 - fr.rough - fr.mountain);
      mountainLevel = q(1 - fr.mountain);
    }

    const tiles = new Array<TileKind>(cols * rows);
    for (let i = 0; i < elevation.length; i++) {
      const e = elevation[i] ?? 0.5;
      // 낮을수록 바다 → 물가 저지대 수풀 → 트인 육지 → 산 아래 험지 → 높으면 산.
      tiles[i] =
        e < waterLevel
          ? TILE.water
          : e > mountainLevel
            ? TILE.mountain
            : e < grassLevel
              ? TILE.grass
              : e > roughLevel
                ? TILE.rough
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

  /** 이 좌표가 험지인가 — 험지에선 이동이 느려진다(속도 형질이 완화. behavior 의 속도 계산에서 참조). */
  isRough(x: number, y: number): boolean {
    return this.kindAt(x, y) === TILE.rough;
  }

  /**
   * 수풀 타일 중심 좌표를 최대 n개 균등 샘플한다(결정론, rng 무사용 — 인덱스 기반). 수풀이 없으면
   * 빈 배열. 그림자 매복자를 수풀에 숨겨 스폰하는 데 쓴다(수풀이 매복자의 사냥터).
   */
  grassSpots(n: number): { x: number; y: number }[] {
    const grass: number[] = [];
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] === TILE.grass) grass.push(i);
    if (grass.length === 0) return [];
    const out: { x: number; y: number }[] = [];
    for (let k = 0; k < n; k++) {
      const idx = grass[Math.floor((k / Math.max(1, n)) * grass.length)] ?? grass[0] ?? 0;
      out.push({ x: this.tileCenterX(idx), y: this.tileCenterY(idx) });
    }
    return out;
  }

  /**
   * 이 좌표를 (canSwim·canLand·canFly 인 종이) 지나갈 수 있는가.
   * 비행(canFly)은 산·물·육지 어디든 날아 넘는다. 그 외엔 산은 누구도 못 넘고, 물은 수영 형질이
   * 충분한 종(canSwim)만, 육지는 canLand 인 종만 통행한다.
   * canLand=false 는 물 전용(진짜 물고기) — 육지에 못 올라온다. rng 미사용 → 결정론.
   */
  isPassable(x: number, y: number, canSwim: boolean, canLand = true, canFly = false): boolean {
    if (canFly) return true; // 비행 종은 모든 지형을 날아 넘는다(산·물 무관)
    const k = this.kindAt(x, y);
    if (k === TILE.mountain) return false;
    if (k === TILE.water) return canSwim;
    return canLand;
  }

  private passableTile(cx: number, cy: number, canSwim: boolean, canLand: boolean, canFly: boolean): boolean {
    if (canFly) return true;
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

  private passableIndex(idx: number, canSwim: boolean, canLand: boolean, canFly: boolean): boolean {
    if (canFly) return true;
    const k = this.tiles[idx] ?? TILE.land;
    if (k === TILE.mountain) return false;
    if (k === TILE.water) return canSwim;
    return canLand;
  }

  /**
   * (x0,y0)→(x1,y1) 직선이 지나는 타일에 (canSwim 기준) 막힌 칸이 없으면 true. Bresenham 격자 순회.
   * 길찾기의 1차 판정 — 목표가 직선으로 보이면 BFS 없이 바로 직진한다(대부분의 경우, 가볍다).
   */
  lineOfSight(x0: number, y0: number, x1: number, y1: number, canSwim: boolean, canLand = true, canFly = false): boolean {
    if (canFly) return true; // 비행 종은 어느 두 점 사이든 지형에 안 막힌다(직진)
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
      if (!this.passableIndex(cy * this.cols + cx, canSwim, canLand, false)) return false;
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
  findPath(x0: number, y0: number, x1: number, y1: number, canSwim: boolean, canLand = true, canFly = false): number[] {
    const n = this.cols * this.rows;
    const start = this.indexAt(x0, y0);
    const goal = this.indexAt(x1, y1);
    if (start === goal) return [];
    if (!this.passableIndex(goal, canSwim, canLand, canFly)) return []; // 목표 칸이 막힘(보통 먹이는 통행 칸)
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
      if (cx + 1 < this.cols) this.visit(cur + 1, cur, canSwim, canLand, canFly, seen, prev, queue);
      if (cx - 1 >= 0) this.visit(cur - 1, cur, canSwim, canLand, canFly, seen, prev, queue);
      if (cy + 1 < this.rows) this.visit(cur + this.cols, cur, canSwim, canLand, canFly, seen, prev, queue);
      if (cy - 1 >= 0) this.visit(cur - this.cols, cur, canSwim, canLand, canFly, seen, prev, queue);
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
    canFly: boolean,
    seen: Uint8Array,
    prev: Int32Array,
    queue: number[],
  ): void {
    if (seen[next] || !this.passableIndex(next, canSwim, canLand, canFly)) return;
    seen[next] = 1;
    prev[next] = cur;
    queue.push(next);
  }

  nearestPassable(x: number, y: number, canSwim: boolean, canLand = true, canFly = false): { x: number; y: number } {
    if (this.isPassable(x, y, canSwim, canLand, canFly)) return { x, y };
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
          if (!this.passableTile(cx, cy, canSwim, canLand, canFly)) continue;
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

  /**
   * (x,y) 근처에서, 통행 가능하고 그 통행 영역(연결된 통행 타일 덩어리)이 minRegion 타일 이상인 곳의
   * 중심을 돌려준다. 물 전용 종(진짜 물고기)을 작은 웅덩이(연결 물 타일 몇 개)에 스폰해 갇혀 뱅뱅 돌다
   * 폐사시키지 않으려는 것 — "충분히 큰 바다"에만 넣는다. 그런 큰 영역이 하나도 없으면 nearestPassable
   * 로 대체(자투리라도 통행 가능한 곳). rng 미사용 → 결정론(스폰 rng 소비 순서·밸런스 무관).
   */
  nearestLargePassable(
    x: number,
    y: number,
    canSwim: boolean,
    canLand = true,
    canFly = false,
    minRegion = 1,
  ): { x: number; y: number } {
    if (canFly || minRegion <= 1) return this.nearestPassable(x, y, canSwim, canLand, canFly);
    const { label, size } = this.regionLabels(canSwim, canLand, canFly);
    const big = (idx: number): boolean => {
      const l = label[idx] ?? -1;
      return l >= 0 && (size[l] ?? 0) >= minRegion;
    };
    const cs = this.cellSize;
    const sx = clampIndex(Math.floor(x / cs), this.cols);
    const sy = clampIndex(Math.floor(y / cs), this.rows);
    // 시작 타일이 이미 큰 영역이면 그대로.
    const startIdx = sy * this.cols + sx;
    if (this.passableTile(sx, sy, canSwim, canLand, canFly) && big(startIdx)) {
      return { x: (sx + 0.5) * cs, y: (sy + 0.5) * cs };
    }
    const maxR = Math.max(this.cols, this.rows);
    for (let r = 1; r <= maxR; r++) {
      let bestX = -1;
      let bestY = -1;
      let bestD2 = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const cx = sx + dx;
          const cy = sy + dy;
          if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) continue;
          const idx = cy * this.cols + cx;
          if (!this.passableTile(cx, cy, canSwim, canLand, canFly) || !big(idx)) continue;
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
    // 큰 영역이 없으면(작은 맵 등) 통행 가능한 아무 곳이라도.
    return this.nearestPassable(x, y, canSwim, canLand, canFly);
  }

  /**
   * 통행 특성(canSwim·canLand·canFly)에 따른 연결 통행 영역을 4방향 flood fill 로 라벨링한다.
   * label[i] = 그 타일이 속한 영역 번호(막힘 = -1), size[label] = 그 영역의 타일 수. 큰 바다/큰 대륙을
   * 골라 스폰하는 데 쓴다. rng 미사용 → 결정론. 스폰 때만(드물게) 호출되고 순회 순서 고정.
   */
  private regionLabels(
    canSwim: boolean,
    canLand: boolean,
    canFly: boolean,
  ): { label: Int32Array; size: number[] } {
    const n = this.cols * this.rows;
    const label = new Int32Array(n).fill(-1);
    const size: number[] = [];
    for (let start = 0; start < n; start++) {
      if (label[start] !== -1 || !this.passableIndex(start, canSwim, canLand, canFly)) continue;
      const id = size.length;
      const queue: number[] = [start];
      label[start] = id;
      let head = 0;
      let count = 0;
      while (head < queue.length) {
        const cur = queue[head++] ?? 0;
        count += 1;
        const cx = cur % this.cols;
        const cy = (cur - cx) / this.cols;
        if (cx + 1 < this.cols) this.labelVisit(cur + 1, id, canSwim, canLand, canFly, label, queue);
        if (cx - 1 >= 0) this.labelVisit(cur - 1, id, canSwim, canLand, canFly, label, queue);
        if (cy + 1 < this.rows) this.labelVisit(cur + this.cols, id, canSwim, canLand, canFly, label, queue);
        if (cy - 1 >= 0) this.labelVisit(cur - this.cols, id, canSwim, canLand, canFly, label, queue);
      }
      size.push(count);
    }
    return { label, size };
  }

  private labelVisit(
    next: number,
    id: number,
    canSwim: boolean,
    canLand: boolean,
    canFly: boolean,
    label: Int32Array,
    queue: number[],
  ): void {
    if (label[next] !== -1 || !this.passableIndex(next, canSwim, canLand, canFly)) return;
    label[next] = id;
    queue.push(next);
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
