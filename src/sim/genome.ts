// 게놈 (Genome) — 가장 중요한 데이터 구조 (기획서 §3.1).
//
// **v8 에서 게놈의 정체가 바뀌었다** (2026-08-06 회의 · **[사용자]** 확정).
//   예전: 형질 열넷이 각각 0~100 자연수. 카드가 그 숫자를 직접 올렸다.
//   지금: 진짜 게놈은 **범주 다섯의 도장(pips) + 열쇠(keys)** 뿐이고, 세계가 읽는 능치(traits)는
//         거기서 **파생**된다(`sim/tiers.ts`).
//
// 왜 바꿨나: 0~100 자연수를 보여 주는 것은 "이 척도는 일정하다"는 약속인데 실제로는 아니었다.
// 카드 비용도 효과도 구간마다 달랐고(50→60 은 한 장, 90→100 은 여섯 장 · 속도 60→61 은 효과가
// 시드 노이즈에 묻힌다), 결국 **숫자 하나가 「얼마나 강한가 · 얼마나 투자했는가 · 얼마나 남았는가」
// 셋을 동시에 뜻하려다 셋 다 못 하고 있었다.** 도장은 투자만 세고, 티어는 세기만 말한다.
//
// ⚠ **`traits` 는 여전히 sim 이 읽는 유일한 창구다.** 야생종은 손으로 정한 능치를 그대로 쓰고
//   (생태 밸런스 보존), 플레이어 종만 `deriveTraits` 로 채워진다. 두 세계가 같은 축 위에 있다.
//
// 처음부터 "직렬화 가능 + 버전 붙은" 구조인 이유는 그대로다: 비동기 생물(§6)이 게놈을 네트워크에
// 실을 때 forward-compatibility 가 필요하다.

import type { Rng } from "@/sim/rng";
import { carnivory01, grazeEfficiency, huntEfficiency } from "@/sim/diet";
import { SIM } from "@/sim/params";
import {
  CATEGORIES,
  deriveTraits,
  emptyKeys,
  emptyPips,
  KEY_NAMES,
  MAX_TIER,
  pipsForTier,
  pipsFromTraits,
  TIER_STEPS,
  type Keys,
  type Pips,
} from "@/sim/tiers";

/** 현재 게놈 스키마 버전. 형질을 추가/변경하면 올리고 migrate 에 단계를 더한다. */
export const GENOME_VERSION = 8 as const;

/** 능치 정규화의 분모. 시뮬 공식은 값을 이걸로 나눠 0~1 로 해석한다(파생값은 100 을 넘을 수 있다). */
export const TRAIT_MAX = 100 as const;

/** 파생 능치가 물리적으로 가질 수 있는 상한 — 안전망일 뿐, 실제 플레이에서 안 닿는다. */
export const TRAIT_HARD_MAX = 130 as const;

/**
 * **세계가 읽는 능치 한 벌.** 이건 이제 "플레이어가 고르는 것"이 아니라 도장에서 나오는 결과다.
 * 야생종만 이 값을 손으로 정한다(`sim/species.ts`).
 */
export interface Traits {
  /** 이동 속도. 다리 티어에서 나온다. */
  speed: number;
  /** **무는 힘**(무기). 이빨 티어에서 나온다. v8 에서 방어와 분리됐다. */
  attack: number;
  /**
   * **버티는 힘**(방어). 가죽 티어에서 나온다. v8 신설.
   *
   * ⚠ 야생종은 `defense = attack` 으로 채운다 — 그러면 `biteOutcome` 이 v7 과 **비트 단위로 같아져**
   *   손으로 오래 튜닝한 야생 생태가 1도 안 흔들린다. 쪼갠 것은 플레이어 쪽 선택지이지
   *   세계의 물리를 바꾸는 일이 아니다.
   */
  defense: number;
  /** 시야 반경 계수. 눈 티어에서 나온다. */
  vision: number;
  /** 무리 성향(뭉침·무리 방어). 무리 티어에서 나온다. */
  herding: number;
  /** 번식률. 무리 티어에서 나온다. */
  fertility: number;
  /**
   * 추위·더위 저항 축. 가죽 티어에서 나온다(두꺼운 몸 = 추위에 강하고 더위에 약하다).
   * v8 에서 **소모(유지비)와 분리됐다** — 예전엔 한 숫자가 저항과 소모를 겸해, 유지비를 올리면
   * 의도치 않게 추위에 강해지는 부작용이 있었다.
   */
  metabolism: number;
  /**
   * **공통 유지비 배수.** v8 신설 · 「티어가 오르면 청구서가 커진다」의 구현.
   * 야생종은 `0.5 + 대사/100` 으로 채워 v7 과 완전히 같다.
   */
  upkeep: number;
  /** 몸집. **[사용자]** 고르는 축이 아니라 다른 데 안 쓴 것의 잔액(파생). 50 이 완전 중립이다. */
  size: number;
  /** 식성 눈금(0 = 초식 … 100 = 육식). 화면 표시와 야생 비교용 · 실제 판정은 아래 셋이 한다. */
  diet: number;
  /** 풀에서 얻는 효율. 야생종은 `grazeEfficiency(diet)` 로 채워 v7 과 같다. */
  graze: number;
  /** 사냥으로 얻는 효율. **0 이면 사냥 자체를 못 한다.** 야생종은 식성에서 파생. */
  hunt: number;
  /** 육식성 세기(0~1) — 사냥 질주·큰 사냥·긴 포만·무리 나눔이 이 값으로 스케일된다. */
  carnivory: number;
  /** 시야각(부채꼴)의 cos. **클수록 좁다.** 눈 티어의 고유 대가. */
  fovCos: number;
  /** 최고 속도로 달릴 때 유지비에 얹히는 몫. 다리 티어의 고유 대가. */
  sprintCost: number;
  /** 대멸종 「대역병」 솎임 배수. 무리 티어의 고유 대가(붙어 살면 병이 돈다). */
  plague: number;

  // --- 열쇠(능력)의 세기. 열쇠가 없으면 0 이라 그 능력이 세계에 없는 것과 같다. ---
  /** 수영 — 문턱을 넘으면 물에 들어가고 바다 먹이를 먹는다. */
  swimming: number;
  /** 초음파 — 전방위 근거리 탐지(밤·수풀·은신을 무시). */
  echo: number;
  /** 날개 — 산·물을 날아 넘고 고산 먹이를 먹는다. */
  wings: number;
  /** 독니 — 문 상대에게 지속 피해. */
  venom: number;
  /** 뿔·뱉기 — 사거리 확장(멀리서 먼저 친다). */
  ranged: number;
  /** 숨기 — 포식자가 나를 늦게 발견한다. 큰 몸은 잘 못 숨는다. */
  camouflage: number;
}

/** 현재 게놈. **[사용자]** 도장과 열쇠가 진짜 게놈이고 traits 는 거기서 나온 결과다. */
export interface GenomeV8 {
  genomeVersion: 8;
  /** 범주별 누적 도장. 카드가 여기에만 손댄다. */
  pips: Pips;
  /** 가진 열쇠. 세기는 모 범주의 티어가 정한다. */
  keys: Keys;
  /** 세계가 읽는 파생 능치. 야생종만 손으로 정한다. */
  traits: Traits;
}

export type Genome = GenomeV8;

/**
 * 능치 키 목록(순회용). 화면 표시·직렬화가 쓴다.
 * ⚠ 여기 순서가 `mutateGenome` 의 rng 소비 순서를 정하지 **않는다**(그건 `MUTABLE_TRAITS` 다).
 */
export const TRAIT_KEYS = [
  "speed",
  "attack",
  "defense",
  "vision",
  "herding",
  "fertility",
  "metabolism",
  "upkeep",
  "size",
  "diet",
  "graze",
  "hunt",
  "carnivory",
  "fovCos",
  "sprintCost",
  "plague",
  "swimming",
  "echo",
  "wings",
  "venom",
  "ranged",
  "camouflage",
] as const satisfies readonly (keyof Traits)[];

/** 능치 한국어 라벨. 쉬운 말만 쓴다 (UI 문구 규칙). */
export const TRAIT_LABELS: Record<keyof Traits, string> = {
  speed: "빠르기",
  attack: "무는 힘",
  defense: "버티는 힘",
  vision: "보는 거리",
  herding: "무리",
  fertility: "번식",
  metabolism: "추위 견딤",
  upkeep: "유지비",
  size: "몸집",
  diet: "식성",
  graze: "풀 효율",
  hunt: "사냥 효율",
  carnivory: "육식성",
  fovCos: "시야각",
  sprintCost: "질주 소모",
  plague: "역병 취약",
  swimming: "수영",
  echo: "초음파",
  wings: "날개",
  venom: "독니",
  ranged: "뿔",
  camouflage: "숨기",
};

/** 도장 축(화면에 보이는 다섯)만 순회할 때 쓴다. */
export { CATEGORIES, KEY_NAMES, MAX_TIER, TIER_STEPS, pipsForTier };

const clampVal = (v: number): number => (v < 0 ? 0 : v > TRAIT_HARD_MAX ? TRAIT_HARD_MAX : v);

/**
 * **야생종·옛 게놈용** — 손으로 정한 능치 일부에서 온전한 게놈을 만든다.
 *
 * ⚠ **여기가 「야생 생태 불변」의 열쇠다.** v8 이 새로 만든 축(방어·유지비·풀 효율·사냥 효율·육식성)을
 * v7 이 그 자리에서 쓰던 공식으로 정확히 채운다:
 *   · `defense = attack`  → `biteOutcome` 이 v7 과 같은 수를 낸다
 *   · `upkeep = 0.5 + 대사/100` → 소모 공식이 v7 과 같은 수를 낸다
 *   · `graze/hunt/carnivory = 식성 곡선` → 채집·사냥 효율이 v7 과 같은 수를 낸다
 * 그래서 야생 아키타입 숫자를 한 개도 안 고치고 v8 로 넘어올 수 있다.
 */
export function genomeFromTraits(partial: Partial<Traits>): Genome {
  const base: Traits = {
    speed: 50,
    attack: 50,
    defense: 50,
    vision: 50,
    herding: 0,
    fertility: 50,
    metabolism: 50,
    upkeep: 1,
    size: 50,
    diet: 50,
    graze: 1,
    hunt: 1,
    carnivory: 0,
    fovCos: SIM.fovHalfCos,
    sprintCost: 0,
    plague: 1,
    swimming: 50,
    echo: 0,
    wings: 0,
    venom: 0,
    ranged: 0,
    camouflage: 0,
  };
  const traits: Traits = { ...base, ...partial };
  // 안 넘겨 준 파생 축은 v7 공식으로 채운다(넘겨줬으면 그 값을 존중한다).
  if (partial.defense === undefined) traits.defense = traits.attack;
  if (partial.upkeep === undefined) traits.upkeep = 0.5 + traits.metabolism / TRAIT_MAX;
  if (partial.graze === undefined) traits.graze = grazeEfficiency(traits.diet);
  if (partial.hunt === undefined) {
    traits.hunt = traits.diet > SIM.dietHuntMin ? huntEfficiency(traits.diet) : 0;
  }
  if (partial.carnivory === undefined) traits.carnivory = carnivory01(traits.diet);
  return { genomeVersion: GENOME_VERSION, pips: pipsFromTraits(traits), keys: emptyKeys(), traits };
}

/**
 * **플레이어 종의 게놈** — 도장과 열쇠에서 능치를 파생시킨다. 카드가 도장을 바꿀 때마다 다시 부른다.
 */
export function genomeFromPips(pips: Pips, keys: Keys): Genome {
  return {
    genomeVersion: GENOME_VERSION,
    pips: { ...pips },
    keys: { ...keys },
    traits: deriveTraits(pips, keys),
  };
}

/** 파생 능치를 지금 도장·열쇠에 맞춰 다시 계산한다(카드 적용 뒤 반드시 부른다). */
export function refreshDerived(genome: Genome): Genome {
  genome.traits = deriveTraits(genome.pips, genome.keys);
  return genome;
}

/**
 * 도장 하나 없는 기본 게놈. 프리셋이 여기에 시작 도장 3개와 시작 열쇠를 얹는다.
 *
 * ⚠ 야생·친척 종은 이 게놈이 아니라 `genomeFromTraits` 로 만든다(species.ts) — 여기를 바꿔도
 *   야생 생태는 안 흔들린다. 흔들리는 건 **플레이어 종**이다.
 */
export function defaultGenome(): Genome {
  return genomeFromPips(emptyPips(), emptyKeys());
}

/** 시드 RNG 로 무작위 게놈 생성 (결정론 유지). 도장을 무작위로 뿌린다. */
export function randomGenome(rng: Rng): Genome {
  const pips = emptyPips();
  for (const c of CATEGORIES) pips[c] = Math.round(rng.unit() * 12);
  return genomeFromPips(pips, emptyKeys());
}

/**
 * 게놈 깊은 복사 — 세대별 형질에 쓴다. 개체가 태어난 시점의 종 게놈을 스냅샷으로 떠, 이후 종 게놈이
 * 카드로 바뀌어도(레벨업) 기존 개체는 옛 능치를 유지한다(그때 태어난 세대만 새 능치).
 */
export function cloneGenome(genome: Genome): Genome {
  return {
    genomeVersion: genome.genomeVersion,
    pips: { ...genome.pips },
    keys: { ...genome.keys },
    traits: { ...genome.traits },
  };
}

/**
 * 개체별 변이(자연선택)로 흔들 축 여섯.
 *
 * ⚠ **개수 6 은 절대 바꾸지 말 것.** `mutRng` 소비 횟수가 바뀌면 개체 변이가 통째로 다른 세계가 된다
 *   (known_issues: 쌍둥이 rng 함정과 같은 계열). v8 에서 `metabolism` 이 빠지고 `defense` 가 들어와
 *   **개수가 6 으로 같다.**
 *
 * ⚠ **티어는 안 흔든다.** 티어가 개체마다 다르면 문턱 효과가 개체마다 달라져 화면에서 안 읽힌다
 *   (「무리 방어가 켜졌다」가 반만 켜진다는 게 무슨 뜻인가). 티어는 종 단위 성취이고, 개체차는
 *   그 티어 안에서의 파생 능치 흔들림이다.
 */
export const MUTABLE_TRAITS = ["speed", "vision", "attack", "defense", "size", "fertility"] as const;
export type MutableTrait = (typeof MUTABLE_TRAITS)[number];

/**
 * 새끼 게놈을 부모에서 조금 변이시킨다(개체별 진화의 핵심 — "부모 닮되 조금 다름").
 * **rng 는 반드시 독립 스트림(world.mutRng)을 넘긴다** — 메인 rng 소비 순서를 안 건드려 기존 밸런스를
 * 보존한다. in-place 변이 후 반환.
 */
export function mutateGenome(genome: Genome, rng: Rng, strength: number): Genome {
  if (strength <= 0) return genome;
  for (const key of MUTABLE_TRAITS) {
    // ⚠ rng 는 **안 쓸 때도 반드시 뽑는다**(소비 횟수 고정). 건너뛰면 mutRng 스트림이 밀린다.
    const delta = rng.range(-strength, strength);
    const cur = genome.traits[key];
    // **규칙 면제(파생 100 이상)는 변이가 갉지 않는다.** 안 그러면 애써 켠 최고 티어의 규칙 면제가
    // 세대마다 ±1.5 씩 새어 나가 곧 사라진다(변이 폭이 위로는 막혀 아래로만 열려 있다).
    if (cur >= TRAIT_MAX) continue;
    // **규칙 면제를 변이가 만들지도 않는다.** 위 고정과 맞물리면 래칫이 되어, 기준선 99 인 종의 무리가
    // 세대를 거듭할수록 슬금슬금 100 으로 수렴한다 — 화면엔 99 라 써 있는데 실제로는 면제를 누리는 셈이다.
    genome.traits[key] = Math.min(clampVal(cur + delta), TRAIT_MAX - 1);
  }
  return genome;
}

/** 파생 능치를 안전 범위로 강제. */
export function clampGenome(genome: Genome): Genome {
  for (const key of TRAIT_KEYS) {
    if (key === "upkeep" || key === "graze" || key === "hunt" || key === "carnivory") continue;
    if (key === "fovCos" || key === "sprintCost" || key === "plague") continue;
    genome.traits[key] = clampVal(genome.traits[key]);
  }
  return genome;
}

/**
 * 임의 버전의 직렬화 데이터를 현재 Genome 으로 마이그레이션한다.
 * 비동기 생물(다른 클라이언트/버전이 만든 게놈)을 받아들이는 입구.
 *
 * v1~v7 은 전부 **형질 열넷의 0~100 자연수** 세계였다. v8 은 도장 세계라 값 대 값 매핑이 없으므로,
 * 옛 능치를 그대로 살려 쓰되(`genomeFromTraits`) 도장은 능치에서 역산한다. 지난 런의 챔피언이
 * 옛 모습 그대로 세계에 돌아온다 — 그게 챔피언의 뜻이다.
 */
export function migrateGenome(raw: unknown): Genome {
  if (raw === null || typeof raw !== "object") {
    throw new Error("게놈 데이터가 올바르지 않습니다.");
  }
  const obj = raw as { genomeVersion?: unknown; traits?: unknown; pips?: unknown; keys?: unknown };
  const version = obj.genomeVersion;
  if (version === 8) {
    const pips = { ...emptyPips(), ...((obj.pips ?? {}) as Partial<Pips>) };
    const keys = { ...emptyKeys(), ...((obj.keys ?? {}) as Partial<Keys>) };
    // 능치는 항상 도장에서 다시 낸다 — 저장된 값이 낡았어도 규칙이 이긴다.
    const g = genomeFromPips(pips, keys);
    // 야생 게놈(도장 밖 능치를 가진 종)은 저장된 능치를 존중한다.
    const t = obj.traits as Partial<Traits> | undefined;
    if (t && (t.diet !== undefined || t.graze !== undefined)) {
      const hasPips = CATEGORIES.some((c) => pips[c] > 0);
      if (!hasPips) return clampGenome(genomeFromTraits(t));
    }
    return clampGenome(g);
  }
  if (typeof version === "number" && version >= 1 && version <= 7) {
    const legacy = (obj.traits ?? {}) as Record<string, number>;
    const scale = version <= 2 ? TRAIT_MAX : 1; // v1·v2 는 0~1 스케일이었다
    const get = (k: string, dflt: number): number => {
      const v = legacy[k];
      return typeof v === "number" ? v * scale : dflt;
    };
    return clampGenome(
      genomeFromTraits({
        speed: get("speed", 50),
        attack: get("attack", 50),
        vision: get("vision", 50),
        herding: get("herding", 0),
        metabolism: get("metabolism", 50),
        fertility: get("fertility", 50),
        diet: get("diet", 50),
        size: get("size", 50),
        swimming: get("swimming", 50),
        echo: get("echo", 0),
        wings: get("wings", 0),
        venom: get("venom", 0),
        ranged: get("ranged", 0),
        camouflage: get("camouflage", 0),
      }),
    );
  }
  throw new Error(`알 수 없는 게놈 버전입니다: ${String(version)}`);
}

export function serializeGenome(genome: Genome): string {
  return JSON.stringify(genome);
}

export function deserializeGenome(json: string): Genome {
  return migrateGenome(JSON.parse(json));
}
