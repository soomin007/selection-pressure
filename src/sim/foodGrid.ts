// 먹이 공간 격자 — 가까운 먹이 질의를 O(먹이수) 완전탐색 대신 지역적으로 처리한다(큰 맵 성능).
// 먹이는 위치가 고정이라 한 번만 빌드하면 된다(available 토글은 탐색 시 pred 로 거른다). 순수 TS, 결정론.

import type { Food } from "@/sim/food";

export class FoodGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellSize: number;
  private readonly cells: Food[][];

  constructor(width: number, height: number, cellSize: number) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.cells = [];
    for (let i = 0; i < this.cols * this.rows; i++) this.cells.push([]);
  }

  /** 먹이 위치는 불변이라 생성 시 한 번만 채운다(available 은 nearest 의 pred 로 거른다). */
  build(food: readonly Food[]): void {
    for (const cell of this.cells) cell.length = 0;
    for (const f of food) {
      const cell = this.cells[this.cellIndex(f.x, f.y)];
      if (cell) cell.push(f);
    }
  }

  /** 반경 maxR 안에서 pred 를 만족하는 가장 가까운 먹이. (available·종류·시야각 등은 pred 가 판단) */
  nearest(x: number, y: number, maxR: number, pred: (f: Food) => boolean): Food | null {
    const cr = Math.ceil(maxR / this.cellSize);
    const cx = this.clamp(Math.floor(x / this.cellSize), this.cols);
    const cy = this.clamp(Math.floor(y / this.cellSize), this.rows);
    let best = maxR * maxR;
    let found: Food | null = null;
    for (let gy = cy - cr; gy <= cy + cr; gy++) {
      if (gy < 0 || gy >= this.rows) continue;
      for (let gx = cx - cr; gx <= cx + cr; gx++) {
        if (gx < 0 || gx >= this.cols) continue;
        const cell = this.cells[gy * this.cols + gx];
        if (!cell) continue;
        for (const f of cell) {
          if (!pred(f)) continue;
          const dx = f.x - x;
          const dy = f.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) {
            best = d2;
            found = f;
          }
        }
      }
    }
    return found;
  }

  private cellIndex(x: number, y: number): number {
    const cx = this.clamp(Math.floor(x / this.cellSize), this.cols);
    const cy = this.clamp(Math.floor(y / this.cellSize), this.rows);
    return cy * this.cols + cx;
  }

  private clamp(i: number, n: number): number {
    return i < 0 ? 0 : i >= n ? n - 1 : i;
  }
}
