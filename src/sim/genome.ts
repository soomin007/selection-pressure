// 게놈 (Genome) — 가장 중요한 데이터 구조 (기획서 §3.1).
//
// 처음부터 "직렬화 가능 + 버전 붙은" 구조로 설계한다. 이유:
//   나중에 비동기 생물(§6)을 붙일 때 게놈을 그대로 네트워크에 실으려면
//   forward-compatibility 가 필수다. Phase 1 에서 거의 공짜로 챙긴다.
//
// 형질값은 모두 [0, 1] 로 정규화한다. 환경마다 유리한 형질이 달라지도록
// 시뮬 쪽에서 이 값들을 해석한다 (예: 추운 환경 → metabolism 유리).

import type { Rng } from "@/sim/rng";

/** 현재 게놈 스키마 버전. 형질을 추가/변경하면 올리고 migrate 에 단계를 더한다. */
export const GENOME_VERSION = 2 as const;

/** v1 형질 묶음. */
export interface TraitsV1 {
  /** 이동 속도 */
  speed: number;
  /** 공격력 */
  attack: number;
  /** 시야 범위 */
  vision: number;
  /** 무리 성향 (boids 결속력) */
  herding: number;
  /** 대사율 (에너지 소모 / 내한성) */
  metabolism: number;
  /** 번식률 */
  fertility: number;
  /** 식성 (0 = 초식 ... 1 = 육식) */
  diet: number;
}

export interface GenomeV1 {
  genomeVersion: 1;
  traits: TraitsV1;
}

/** v2 — 수영(바다 적응)을 더했다. 임계값을 넘으면 바다 먹이를 먹을 수 있다(무경쟁 틈새 보상). */
export interface TraitsV2 extends TraitsV1 {
  /** 수영 (바다 적응). 높으면 바다 먹이를 먹는다. */
  swimming: number;
}

export interface GenomeV2 {
  genomeVersion: 2;
  traits: TraitsV2;
}

/** 항상 "현재 버전" 을 가리킨다. 코드 다른 곳은 이 별칭만 쓴다. */
export type Genome = GenomeV2;
export type Traits = TraitsV2;

/**
 * 형질 키 목록 (순회용). swimming 은 **맨 끝**에 둔다 — generateWildSpecies 가 이 순서로 rng 를
 * 뽑으므로, swimming 을 끝에 두고 그 항목만 rng 없이 설정하면 기존 rng 스트림이 보존된다(밸런스 불변).
 */
export const TRAIT_KEYS = [
  "speed",
  "attack",
  "vision",
  "herding",
  "metabolism",
  "fertility",
  "diet",
  "swimming",
] as const satisfies readonly (keyof Traits)[];

/**
 * 형질 한국어 라벨. 쉬운 말만 쓴다 (UI 문구 규칙).
 * 나중에 "게놈 → 위협 요약 텍스트" 생성기(§4.2)의 토대가 된다.
 */
export const TRAIT_LABELS: Record<keyof Traits, string> = {
  speed: "속도",
  attack: "공격력",
  vision: "시야",
  herding: "무리 성향",
  metabolism: "대사",
  fertility: "번식력",
  diet: "식성",
  swimming: "수영",
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 모든 형질 0.5 인 기본 게놈. */
export function defaultGenome(): Genome {
  return {
    genomeVersion: GENOME_VERSION,
    traits: {
      speed: 0.5,
      attack: 0.5,
      vision: 0.5,
      herding: 0.5,
      metabolism: 0.5,
      fertility: 0.5,
      diet: 0.5,
      swimming: 0.5,
    },
  };
}

/** 시드 RNG 로 무작위 게놈 생성 (결정론 유지). */
export function randomGenome(rng: Rng): Genome {
  const traits = {} as Traits;
  for (const key of TRAIT_KEYS) traits[key] = rng.unit();
  return { genomeVersion: GENOME_VERSION, traits };
}

/**
 * 게놈 깊은 복사 — 세대별 형질에 쓴다. 개체가 태어난 시점의 종 게놈을 스냅샷으로 떠, 이후 종 게놈이
 * 카드로 바뀌어도(레벨업) 기존 개체는 옛 형질을 유지한다(그때 태어난 세대만 새 형질).
 */
export function cloneGenome(genome: Genome): Genome {
  return { genomeVersion: genome.genomeVersion, traits: { ...genome.traits } };
}

/** 모든 형질을 [0, 1] 로 강제. (카드 효과 누적 후 호출) */
export function clampGenome(genome: Genome): Genome {
  const traits = {} as Traits;
  for (const key of TRAIT_KEYS) traits[key] = clamp01(genome.traits[key]);
  return { genomeVersion: GENOME_VERSION, traits };
}

/**
 * 임의 버전의 직렬화 데이터를 현재 Genome 으로 마이그레이션한다.
 * 비동기 생물(다른 클라이언트/버전이 만든 게놈)을 받아들이는 입구.
 */
export function migrateGenome(raw: unknown): Genome {
  if (raw === null || typeof raw !== "object") {
    throw new Error("게놈 데이터가 올바르지 않습니다.");
  }
  const version = (raw as { genomeVersion?: unknown }).genomeVersion;
  switch (version) {
    case 1: {
      // v1 → v2: 수영(swimming)을 0.5 기본으로 채운다(기존 게놈은 육상 기준).
      const v1 = raw as GenomeV1;
      return clampGenome({ genomeVersion: 2, traits: { ...v1.traits, swimming: 0.5 } });
    }
    case 2:
      // (실전에선 여기서 형질 키 존재/타입을 검증한다.)
      return clampGenome(raw as GenomeV2);
    default:
      throw new Error(`알 수 없는 게놈 버전입니다: ${String(version)}`);
  }
}

export function serializeGenome(genome: Genome): string {
  return JSON.stringify(genome);
}

export function deserializeGenome(json: string): Genome {
  return migrateGenome(JSON.parse(json));
}
