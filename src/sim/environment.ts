// 절차 환경 — 바이옴(기획서 §3.2 확장). 환경 시드로 두 원천 필드를 만든다:
//   temperature 온도 [0,1] — 낮으면 한랭, 높으면 혹서
//   moisture    습도 [0,1] — 낮으면 건조, 높으면 습윤
// 이 둘의 조합으로 칸마다 바이옴을 분류하고(사막·빙하·열대우림·초원·습지), 바이옴이 실제 체감 값을 정한다:
//   coldness  추위 [0,1] — 추운 칸은 저대사 개체에 추가 소모(보온 실패). 빙하에서 큼.
//   heat      열기 [0,1] — 더운 칸은 고대사 개체에 추가 소모(과열). 사막·열대우림에서 큼.
//   fertility 비옥도 [0,1] — 먹이가 놓이는 정도. 열대우림·습지 높고 사막·빙하 낮다.
// → 한 맵 안에 이질적 구역이 공존해 "형질이 조건부로 빛난다"(사막=저대사, 빙하=고대사, 우림=다산 경쟁).
// 순수 TS, 결정론. 메인 rng 와 독립된 rng 로 생성(지형처럼) → 환경을 손봐도 sim 동역학 스트림 무관.

import type { Rng } from "@/sim/rng";

/** 바이옴 종류 — 온도×습도로 분류(각 온도대를 건조/습윤으로 나눔). 렌더 색·UI 라벨·비옥도의 단일 기준. */
export type Biome = "glacier" | "taiga" | "desert" | "rainforest" | "grassland" | "wetland";

export interface EnvSample {
  coldness: number;
  heat: number;
  fertility: number;
  biome: Biome;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// 바이옴별 기준 비옥도 — 열대우림 가장 풍부, 사막·빙하 척박. (습도로 약간 가감)
const BIOME_FERTILITY: Record<Biome, number> = {
  glacier: 0.1, // 얼음 벌판 — 거의 아무것도 안 자람
  taiga: 0.32, // 침엽수림 — 추워도 숲이라 먹이가 좀 있음
  desert: 0.1, // 사막 — 척박
  grassland: 0.45,
  wetland: 0.62,
  rainforest: 0.85,
};

/**
 * 온도·습도로 바이옴을 정한다. 각 온도대(한랭/온대/혹서)를 다시 건조/습윤으로 나눠 6바이옴 — 한 바이옴이
 * 온도대 전체를 독차지하지 않게(빙하가 추운 곳을 통째로 먹어 유독 넓어 보이던 문제 해결). 임계는 "한 맵에
 * 여러 바이옴이 섞이게" 잡았다.
 */
export function classifyBiome(temperature: number, moisture: number): Biome {
  const wet = moisture >= 0.45;
  if (temperature < 0.34) return wet ? "taiga" : "glacier"; // 한랭: 습윤=침엽수림 / 건조=빙하
  if (temperature > 0.66) return wet ? "rainforest" : "desert"; // 혹서: 습윤=우림 / 건조=사막
  return wet ? "wetland" : "grassland"; // 온대: 습윤=습지 / 건조=초원
}

export class Environment {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly coldness: readonly number[];
  readonly heat: readonly number[];
  readonly fertility: readonly number[];
  readonly biome: readonly Biome[];

  constructor(
    cols: number,
    rows: number,
    cellSize: number,
    coldness: number[],
    heat: number[],
    fertility: number[],
    biome: Biome[],
  ) {
    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
    this.coldness = coldness;
    this.heat = heat;
    this.fertility = fertility;
    this.biome = biome;
  }

  static generate(rng: Rng, width: number, height: number, cellSize: number): Environment {
    const cols = Math.max(1, Math.ceil(width / cellSize));
    const rows = Math.max(1, Math.ceil(height / cellSize));
    // 맵마다 전체 기후 성향(추운 맵/더운 맵, 습한 맵/건조한 맵)을 넓게 주되, 공간 변동도 커 한 맵에 여러
    // 바이옴이 공존한다. base 를 넓히면 어떤 맵은 빙하가 넓고 어떤 맵은 사막이 넓다(맵 정체성).
    const tempBase = rng.range(0.3, 0.7);
    const moistBase = rng.range(0.32, 0.68);
    const temperature = smoothField(rng, cols, rows, tempBase, 1.15);
    const moisture = smoothField(rng, cols, rows, moistBase, 1.15);

    const n = cols * rows;
    const coldness = new Array<number>(n);
    const heat = new Array<number>(n);
    const fertility = new Array<number>(n);
    const biome = new Array<Biome>(n);
    for (let i = 0; i < n; i++) {
      const temp = temperature[i] ?? 0.5;
      const moist = moisture[i] ?? 0.5;
      const b = classifyBiome(temp, moist);
      biome[i] = b;
      // 추위는 낮은 온도에서, 열기는 높은 온도에서 연속적으로(부드러운 체감). 중온대는 둘 다 0.
      coldness[i] = clamp01((0.42 - temp) / 0.42);
      heat[i] = clamp01((temp - 0.58) / 0.42);
      // 비옥도 = 바이옴 기준값 + 습도 약간(같은 바이옴 안에서도 미세 변동).
      fertility[i] = clamp01(BIOME_FERTILITY[b] + (moist - 0.5) * 0.18);
    }
    return new Environment(cols, rows, cellSize, coldness, heat, fertility, biome);
  }

  private indexAt(x: number, y: number): number {
    const cx = clampIndex(Math.floor(x / this.cellSize), this.cols);
    const cy = clampIndex(Math.floor(y / this.cellSize), this.rows);
    return cy * this.cols + cx;
  }

  sampleAt(x: number, y: number): EnvSample {
    const i = this.indexAt(x, y);
    return {
      coldness: this.coldness[i] ?? 0,
      heat: this.heat[i] ?? 0,
      fertility: this.fertility[i] ?? 0,
      biome: this.biome[i] ?? "grassland",
    };
  }

  biomeAt(x: number, y: number): Biome {
    return this.biome[this.indexAt(x, y)] ?? "grassland";
  }
}

function clampIndex(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/** 무작위 격자를 두 번 흐리게 한 뒤 base 주변으로 펼친다 → 부드러운 구역(블롭). spread 클수록 변동 크다. */
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
