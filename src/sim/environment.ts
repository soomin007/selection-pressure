// 절차 환경 (기획서 §3.2). 환경 시드로 칸 격자에 두 필드를 만든다:
//   coldness  추위 [0,1] — 추운 칸은 저대사 개체에 추가 에너지 소모(보온 실패)
//   fertility 비옥도 [0,1] — 먹이가 더 많이 놓이는 정도
// 맵마다 전체 한온 성향(coldBase)이 달라, "추운 맵 / 따뜻한 맵"이 갈린다.
// → 환경마다 유리한 게놈이 달라진다. 순수 TS, 결정론.

import type { Rng } from "@/sim/rng";

export interface EnvSample {
  coldness: number;
  fertility: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Environment {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly coldness: readonly number[];
  readonly fertility: readonly number[];

  constructor(
    cols: number,
    rows: number,
    cellSize: number,
    coldness: number[],
    fertility: number[],
  ) {
    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
    this.coldness = coldness;
    this.fertility = fertility;
  }

  static generate(rng: Rng, width: number, height: number, cellSize: number): Environment {
    const cols = Math.max(1, Math.ceil(width / cellSize));
    const rows = Math.max(1, Math.ceil(height / cellSize));
    const coldBase = rng.range(0.15, 0.85); // 맵 전체 한온 성향 → 맵마다 다름(추운 맵/따뜻한 맵)
    const coldness = smoothField(rng, cols, rows, coldBase, 0.6);
    const fertility = smoothField(rng, cols, rows, 0.5, 0.75);
    return new Environment(cols, rows, cellSize, coldness, fertility);
  }

  sampleAt(x: number, y: number): EnvSample {
    const cx = clampIndex(Math.floor(x / this.cellSize), this.cols);
    const cy = clampIndex(Math.floor(y / this.cellSize), this.rows);
    const i = cy * this.cols + cx;
    return { coldness: this.coldness[i] ?? 0, fertility: this.fertility[i] ?? 0 };
  }
}

function clampIndex(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/** 무작위 격자를 두 번 흐리게 한 뒤 base 주변으로 펼친다 → 부드러운 구역(블롭). */
function smoothField(rng: Rng, cols: number, rows: number, base: number, spread: number): number[] {
  let f: number[] = new Array<number>(cols * rows);
  for (let i = 0; i < f.length; i++) f[i] = rng.unit();
  f = blur(f, cols, rows);
  f = blur(f, cols, rows);
  const out = new Array<number>(cols * rows);
  for (let i = 0; i < f.length; i++) out[i] = clamp01(base + ((f[i] ?? 0.5) - 0.5) * spread * 2);
  return out;
}

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
