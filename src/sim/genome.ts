// 게놈 (Genome) — 가장 중요한 데이터 구조 (기획서 §3.1).
//
// 처음부터 "직렬화 가능 + 버전 붙은" 구조로 설계한다. 이유:
//   나중에 비동기 생물(§6)을 붙일 때 게놈을 그대로 네트워크에 실으려면
//   forward-compatibility 가 필수다. Phase 1 에서 거의 공짜로 챙긴다.
//
// 형질값은 모두 [0, 100] 자연수다(0.01 단위 소수 대신 사람이 읽고 조절하기 쉬운 정수 스케일).
// 시뮬 계산은 이 값을 0~1 로 정규화(÷100)해 해석한다 — 환경마다 유리한 형질이 달라진다.

import type { Rng } from "@/sim/rng";

/** 현재 게놈 스키마 버전. 형질을 추가/변경하면 올리고 migrate 에 단계를 더한다. */
export const GENOME_VERSION = 6 as const;

/** 형질 값 범위 — 0~100 자연수. 시뮬은 TRAIT_MAX 로 나눠 0~1 로 해석한다. */
export const TRAIT_MAX = 100 as const;

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

/** v3 — 형질 스케일을 0~1 소수에서 0~100 자연수로. 형질 종류는 v2 와 같고 값 범위만 바뀐다. */
export interface GenomeV3 {
  genomeVersion: 3;
  traits: TraitsV2;
}

/** v4 — 초음파(반향정위) 감각을 더했다. 켜면 시야 대신 전방위(빛·각도·밤·수풀 무시)로 근처를 탐지한다. */
export interface TraitsV4 extends TraitsV2 {
  /** 초음파 (전방위 근거리 탐지). 높이면 시야가 약해도 사방을 "듣는다" — 시야와 트레이드오프. */
  echo: number;
}

export interface GenomeV4 {
  genomeVersion: 4;
  traits: TraitsV4;
}

/** v5 — 날개(비행) 이동을 더했다. 켜면 산·물을 날아 넘고(모든 지형 통행) 산 위 고산 먹이를 먹는다. */
export interface TraitsV5 extends TraitsV4 {
  /** 날개 (비행 이동). 높이면 산·물을 날아 넘고 고산 먹이를 먹는다 — 수영(swimming)의 하늘 대칭. */
  wings: number;
}

export interface GenomeV5 {
  genomeVersion: 5;
  traits: TraitsV5;
}

/** v6 — 전투 형질(독침·원거리)을 더했다. 독침은 지속 피해, 원거리는 사거리 확장. */
export interface TraitsV6 extends TraitsV5 {
  /** 독침 (지속 피해). 물면 상대에게 독이 걸려 시간에 걸쳐 에너지가 깎인다 — 약공격도 누적으로 잡는다. */
  venom: number;
  /** 원거리 (사거리 확장). 멀리서 먼저 친다 — 먹잇감이 도망·반격하기 전에 타격(선제 사냥). */
  ranged: number;
}

export interface GenomeV6 {
  genomeVersion: 6;
  traits: TraitsV6;
}

/** 항상 "현재 버전" 을 가리킨다. 코드 다른 곳은 이 별칭만 쓴다. */
export type Genome = GenomeV6;
export type Traits = TraitsV6;

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
  "echo", // swimming 과 함께 맨 끝 — 야생종 생성이 rng 없이 기본값만 설정해 기존 rng 스트림 보존
  "wings", // echo·swimming 과 함께 맨 끝(특화 이동) — 야생종 생성이 rng 없이 기본값만 설정해 rng 스트림 보존
  "venom", // 특화 전투 — 맨 끝, 야생종 생성이 rng 없이 기본값만 설정해 rng 스트림 보존
  "ranged", // 특화 전투 — 맨 끝, 야생종 생성이 rng 없이 기본값만 설정해 rng 스트림 보존
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
  echo: "초음파",
  wings: "날개",
  venom: "독침",
  ranged: "원거리",
};

/** 형질 값을 0~100 자연수로 강제(반올림 + 범위 클램프). 야생·기본 게놈용(0~100 유지). */
const clampTrait = (v: number): number => {
  const n = Math.round(v);
  return n < 0 ? 0 : n > TRAIT_MAX ? TRAIT_MAX : n;
};

// 형질별 상한 — "많을수록 좋은" 연속 형질만 200(극단은 정규화 ÷100 이라 2배 효과, 카드를 여러 장 쌓아야 도달).
// 100 이하 구간은 기존과 완전히 동일하고 100~200 만 새로 열린다 → "형질이 100에 너무 쉽게 붙어 잘리던" 문제
// 해소 + 극단이 귀해진다. 대사(양방향 절충 — cold 공식이 1-대사라 100 초과 시 뒤집힘)·식성(스펙트럼)·능력형
// (임계/3단계)은 0~100 유지. 야생종은 카드가 없어 항상 0~100 이라 밸런스(통과기준)에 무관.
export const TRAIT_CEILING: Record<keyof Traits, number> = {
  speed: 200,
  vision: 200,
  attack: 200,
  fertility: 200,
  herding: 200,
  metabolism: 100,
  diet: 100,
  swimming: 100,
  echo: 100,
  wings: 100,
  venom: 100,
  ranged: 100,
};

/** 형질값을 그 형질의 상한(TRAIT_CEILING)까지 자연수로 강제. 카드 누적·프리셋 적용에 쓴다(연속 형질만 200). */
export function clampTraitValue(key: keyof Traits, v: number): number {
  const n = Math.round(v);
  const hi = TRAIT_CEILING[key];
  return n < 0 ? 0 : n > hi ? hi : n;
}

/** 모든 형질 50(=중간) 인 기본 게놈. */
export function defaultGenome(): Genome {
  return {
    genomeVersion: GENOME_VERSION,
    traits: {
      speed: 50,
      attack: 50,
      vision: 50,
      herding: 50,
      metabolism: 50,
      fertility: 50,
      diet: 50,
      swimming: 50,
      echo: 0, // 초음파는 특화 감각 — 기본 종은 눈(시야)으로 본다. 카드로 켜면 시야 대신 전방위 탐지.
      wings: 0, // 날개는 특화 이동 — 기본 종은 땅을 걷는다. 카드로 켜면 산·물을 날아 넘고 고산 먹이를 먹는다.
      venom: 0, // 독침은 특화 전투 — 기본 종은 독이 없다. 카드로 켜면 물어 독(지속 피해)을 건다.
      ranged: 0, // 원거리는 특화 전투 — 기본 종은 근접만. 카드로 켜면 사거리가 늘어 멀리서 먼저 친다.
    },
  };
}

/** 시드 RNG 로 무작위 게놈 생성 (결정론 유지). 0~100 자연수. */
export function randomGenome(rng: Rng): Genome {
  const traits = {} as Traits;
  for (const key of TRAIT_KEYS) traits[key] = clampTrait(rng.unit() * TRAIT_MAX);
  return { genomeVersion: GENOME_VERSION, traits };
}

/**
 * 게놈 깊은 복사 — 세대별 형질에 쓴다. 개체가 태어난 시점의 종 게놈을 스냅샷으로 떠, 이후 종 게놈이
 * 카드로 바뀌어도(레벨업) 기존 개체는 옛 형질을 유지한다(그때 태어난 세대만 새 형질).
 */
export function cloneGenome(genome: Genome): Genome {
  return { genomeVersion: genome.genomeVersion, traits: { ...genome.traits } };
}

/** 모든 형질을 0~100 자연수로 강제. (카드 효과 누적 후 호출) */
export function clampGenome(genome: Genome): Genome {
  const traits = {} as Traits;
  for (const key of TRAIT_KEYS) traits[key] = clampTraitValue(key, genome.traits[key]);
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
      // v1(0~1) → v6: 수영을 채우고(육상 기준 중간) 0~100 스케일로. 초음파·날개·전투는 scaleUp 이 0 으로.
      const v1 = raw as GenomeV1;
      return clampGenome(scaleUp({ traits: { ...v1.traits, swimming: 0.5 } } as unknown as Genome));
    }
    case 2:
      // v2(0~1) → v6: 형질 값을 ×100 해 0~100 스케일로. 초음파·날개·전투는 scaleUp 이 0 으로.
      return clampGenome(scaleUp(raw as GenomeV2 as unknown as Genome));
    case 3: {
      // v3(0~100) → v6: 초음파·날개·전투(venom·ranged)를 0(없던 종)으로 채운다.
      const v3 = raw as GenomeV3;
      return clampGenome({ genomeVersion: 6, traits: { ...v3.traits, echo: 0, wings: 0, venom: 0, ranged: 0 } });
    }
    case 4: {
      // v4(echo 있음) → v6: 날개·전투를 0 으로 채운다.
      const v4 = raw as GenomeV4;
      return clampGenome({ genomeVersion: 6, traits: { ...v4.traits, wings: 0, venom: 0, ranged: 0 } });
    }
    case 5: {
      // v5(wings 있음) → v6: 전투(venom·ranged)를 0(전투 형질 없던 종)으로 채운다.
      const v5 = raw as GenomeV5;
      return clampGenome({ genomeVersion: 6, traits: { ...v5.traits, venom: 0, ranged: 0 } });
    }
    case 6:
      // (실전에선 여기서 형질 키 존재/타입을 검증한다.)
      return clampGenome(raw as Genome);
    default:
      throw new Error(`알 수 없는 게놈 버전입니다: ${String(version)}`);
  }
}

/** 0~1 스케일 게놈을 0~100 으로 올린다(v1/v2 마이그레이션용). echo·wings·전투는 구버전에 없으니 0. */
function scaleUp(genome: Genome): Genome {
  const traits = {} as Traits;
  for (const key of TRAIT_KEYS) {
    traits[key] =
      key === "echo" || key === "wings" || key === "venom" || key === "ranged"
        ? 0
        : clampTrait((genome.traits[key] ?? 0.5) * TRAIT_MAX);
  }
  return { genomeVersion: GENOME_VERSION, traits };
}

export function serializeGenome(genome: Genome): string {
  return JSON.stringify(genome);
}

export function deserializeGenome(json: string): Genome {
  return migrateGenome(JSON.parse(json));
}
