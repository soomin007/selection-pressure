// 개체 공간 격자. 다종 생태계의 이웃 질의(가까운 먹잇감/포식자, 무리 무게중심)를
// O(개체수²) 대신 지역적으로 처리한다. 매 틱 다시 채운다. 순수 TS, 결정론.

import type { Entity } from "@/sim/entity";

export class SpatialGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellSize: number;
  private readonly cells: Entity[][];

  constructor(width: number, height: number, cellSize: number) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.cells = [];
    for (let i = 0; i < this.cols * this.rows; i++) this.cells.push([]);
  }

  rebuild(entities: readonly Entity[]): void {
    for (const cell of this.cells) cell.length = 0;
    for (const e of entities) {
      if (!e.alive) continue;
      const cell = this.cells[this.cellIndex(e.x, e.y)];
      if (cell) cell.push(e);
    }
  }

  /** 반경 maxR 안에서 pred 를 만족하는 가장 가까운 개체. */
  nearestMatching(
    x: number,
    y: number,
    maxR: number,
    pred: (e: Entity) => boolean,
  ): Entity | null {
    const cr = Math.ceil(maxR / this.cellSize);
    const cx = this.clamp(Math.floor(x / this.cellSize), this.cols);
    const cy = this.clamp(Math.floor(y / this.cellSize), this.rows);
    let best = maxR * maxR;
    let found: Entity | null = null;
    for (let gy = cy - cr; gy <= cy + cr; gy++) {
      if (gy < 0 || gy >= this.rows) continue;
      for (let gx = cx - cr; gx <= cx + cr; gx++) {
        if (gx < 0 || gx >= this.cols) continue;
        const cell = this.cells[gy * this.cols + gx];
        if (!cell) continue;
        for (const e of cell) {
          if (!pred(e)) continue;
          const dx = e.x - x;
          const dy = e.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) {
            best = d2;
            found = e;
          }
        }
      }
    }
    return found;
  }

  /** 주변 3×3 칸의 개체 수와 무게중심 (무리 cohesion/huddle 용). 자기 자신 포함. */
  neighborhood(x: number, y: number): { count: number; comX: number; comY: number } {
    const cx = this.clamp(Math.floor(x / this.cellSize), this.cols);
    const cy = this.clamp(Math.floor(y / this.cellSize), this.rows);
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      if (gy < 0 || gy >= this.rows) continue;
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        if (gx < 0 || gx >= this.cols) continue;
        const cell = this.cells[gy * this.cols + gx];
        if (!cell) continue;
        for (const e of cell) {
          count += 1;
          sumX += e.x;
          sumY += e.y;
        }
      }
    }
    if (count === 0) return { count: 0, comX: x, comY: y };
    return { count, comX: sumX / count, comY: sumY / count };
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
