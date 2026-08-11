// 카드 = 종이 얻는 **열쇠**(없던 능력)와 **조건부 특성**(이미 있는 것이 특정 맥락에서 세진다).
// 런 내 영구, 런 종료 시 리셋(로그라이크). 매 드래프트에 풀에서 3장 후보(운 요소)를 뽑고 하나를 고른다.
//
// **v9 에서 카드가 도장을 그만 준다** (**[사용자 2026-08-07]** "카드에서 도장을 완전히 뺀다" ·
// **[사용자 2026-08-08]** "카드는 유지하고 도장만 뺀다").
//   v8: 카드가 범주에 도장을 찍었다. 그런데 성장 그릇이 「도장 100 + 열쇠 3」뿐이라 5시대짜리 런이
//       **시대 3에 그릇을 채웠고**, 채운 뒤로는 카드 100장이 전부 죽은 카드가 되어 드래프트가
//       통째로 비었다(2026-08-09 판 분석 · 사용자 눈에는 화면이 고장난 것으로 보였다).
//       「성장이 빠르다」·「만렙 뒤 빈 드래프트」·「아주 귀함이 흔하다」가 전부 같은 뿌리였다.
//   v9: **도장은 오직 방울로만 오른다**(`Game.buyTier`). 카드는 성장의 축이 아니라 **판의 색**을
//       담당한다 — 같은 티어라도 어떤 특성을 모았느냐로 판이 갈린다.
//
// 그래서 조절 손잡이가 하나가 됐다. v8 에서는 카드와 방울이 각자 성장을 밀어서 **어느 쪽을 조여도
// 다른 쪽이 메웠다.**
//
// 거짓말이 원리적으로 불가능한 구조는 그대로다: 카드에 적히는 한 줄을 `sim/perks.ts` 가 만들고,
// sim 이 곱하는 배수도 같은 표에서 나온다. 두 곳에 적힌 규칙은 반드시 조용히 어긋난다.
//
// ⚠ **프리셋(시작 갈래)만 아직 도장을 준다.** 그건 카드가 아니라 「어떤 종으로 시작하는가」이고,
//   드래프트 풀에 안 들어간다(`CARD_POOL` 과 `PRESET_CARDS` 는 다른 배열이다).

import type { Rng } from "@/sim/rng";
import type { Genome } from "@/sim/genome";
import { refreshDerived } from "@/sim/genome";
import {
  CATEGORY_AXES,
  PERKS,
  PERK_BY_NAME,
  gateOpen,
  perkGate,
  perkLine,
  perkRarity,
  type PerkName,
} from "@/sim/perks";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  KEY_LABELS,
  KEY_PARENT,
  MAX_KEYS,
  keyCount,
  tierOf,
  type Category,
  type KeyName,
} from "@/sim/tiers";

/**
 * 카드 희귀도 5단계. 색·연출은 UI(`@/ui/rarity`)가 정하고, 여기서는 "얼마나 드물게 뽑히는가"만 정한다 —
 * 배지에 "전설"이라 써 놓고 흔하게 뽑히면 표시가 거짓말이 되므로, 희귀도는 반드시 뽑기 확률과 묶여 있어야 한다.
 */
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/** 뽑기 가중치의 **기준값(레벨 1)**. 카드 한 장이 후보로 뽑힐 상대 확률이다. */
export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 100,
  uncommon: 65,
  rare: 38,
  epic: 20,
  legendary: 10,
};

/**
 * 레벨 보정이 최대에 이르는 런 레벨.
 *
 * **[사용자 2026-08-06]** "시대가 높아질수록 높은 희귀도의 카드 확률이 높아지게."
 * 한 판은 보통 레벨 12~22 에서 끝나므로 18 로 잡으면 **런 내내 계속 오른다** — 초반엔 흔함이
 * 대부분이고 후반에 가서야 큰 카드를 만난다. 10 이면 한 판의 절반에서 보정이 멈춰, 뒤 절반이
 * 앞과 똑같아진다(성장의 질감이 안 갈린다).
 */
export const RARITY_BOOST_FULL_LEVEL = 18;

/**
 * 최대 보정에서 각 등급의 가중치가 기준값의 몇 배가 되는가. 흔함은 1배(그대로)이고 높은 등급만 커진다
 * → 흔함의 **몫**이 자연히 줄어든다. "무리가 자라면 더 큰 변화가 찾아온다"를 확률로 표현한 것.
 */
export const RARITY_BOOST_MAX: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.5,
  rare: 2.4,
  epic: 3.6,
  legendary: 5.5,
};

export function rarityWeightsAtLevel(level: number): Record<Rarity, number> {
  const span = Math.max(1, RARITY_BOOST_FULL_LEVEL - 1);
  const t = Math.max(0, Math.min(1, (level - 1) / span));
  const out = {} as Record<Rarity, number>;
  for (const r of Object.keys(RARITY_WEIGHT) as Rarity[]) {
    out[r] = RARITY_WEIGHT[r] * (1 + (RARITY_BOOST_MAX[r] - 1) * t);
  }
  return out;
}

/**
 * 갈래(계통) — 시작 프리셋이 정하는 "어떤 종으로 시작하는가".
 *
 * ⚠ **갈래 전용 카드 풀은 폐기했다.** 티어 구조에서 "3장 중 1장은 반드시 내 갈래"를 보장하면
 * "내 범주만 계속 쌓인다"로 굳어 고르는 일이 사라진다. 갈래는 이제 **시작 도장의 배분과 시작 열쇠**만
 * 다르게 하고, 카드는 풀 전체가 누구에게나 나온다. 대신 **[사용자 2026-08-06]** 내가 판 방향의
 * 카드가 조금 더 자주 뜬다(보장이 아니라 확률 가중 · `drawCards` 의 `bias`).
 */
export type Lineage = "omni" | "herd" | "scout" | "hunter" | "giant" | "ranged" | "sea" | "sky" | "venom";

export const PRESET_LINEAGE: Record<string, Lineage> = {
  preset_omni: "omni",
  preset_herd: "herd",
  preset_scout: "scout",
  preset_hunter: "hunter",
  preset_giant: "giant",
  preset_ranged: "ranged",
  preset_sea: "sea",
  preset_sky: "sky",
  preset_venom: "venom",
};

export const LINEAGE_NAME: Record<Lineage, string> = {
  omni: "균형 잡식",
  herd: "다산 초식 무리",
  scout: "느긋한 정찰자",
  hunter: "날쌘 육식 사냥꾼",
  giant: "느린 거인",
  ranged: "원거리 사냥꾼",
  sea: "바다 개척자",
  sky: "하늘 개척자",
  venom: "독 살갗",
};

/** 카드 한 장. **열쇠와 특성 말고는 아무것도 안 준다** — 그래서 표시와 실제가 갈릴 수 없다. */
export interface Card {
  id: string;
  name: string;
  /** 플레이버 한 줄. **효과를 여기 적지 않는다** — 효과는 특성 줄이 말한다(두 곳에 적으면 어긋난다). */
  desc: string;
  /**
   * 이 카드가 찍는 도장 — **프리셋(시작 갈래) 전용이다.**
   * v9 부터 드래프트 카드는 도장을 안 준다(파일 머리 주석 참조). 도장은 방울로만 오른다.
   */
  pips?: Partial<Record<Category, number>>;
  /** 이 카드가 여는 열쇠(능력). 세기는 모 범주의 티어가 정한다. */
  key?: KeyName;
  /** 이 카드가 주는 **조건부 특성**(`sim/perks.ts`). 이름·설명·효과 한 줄이 전부 거기서 온다. */
  perk?: PerkName;
  rarity: Rarity;
  /** 시작 프리셋의 내 종 시작 색(프리셋 전용). */
  color?: number;
  /**
   * **불씨 회복 카드** — 도장은 0 이고 꺼진 불씨를 이만큼 되살린다.
   * **[사용자 2026-08-06]** 불씨가 정확히 하나 남았을 때만 뜨고, **첫 한 번은 확정 · 그 뒤로는 확률**이다.
   */
  ember?: number;
}

/** 이 카드가 실제로 찍는 도장 수(없는 범주는 0). **프리셋 전용** — 드래프트 카드는 늘 0 이다. */
export function cardPips(card: Card, cat: Category): number {
  return card.pips?.[cat] ?? 0;
}

/** 이 카드가 건드리는 범주들(도장 수가 0 이 아닌 것). 표시 순서는 도장이 큰 것부터. */
export function cardCategories(card: Card): Category[] {
  return CATEGORIES.filter((c) => cardPips(card, c) !== 0).sort(
    (a, b) => Math.abs(cardPips(card, b)) - Math.abs(cardPips(card, a)),
  );
}

/**
 * 이 카드가 후보로 나올 수 있는가 · 그리고 **이 종에게 아무 일도 안 하는가**(죽은 카드).
 *
 * v9 에서 이 판정이 단순해졌다. v8 에서는 「도장은 오르는데 문턱을 안 넘는 저축 카드」와 「이미 최고
 * 티어라 아무 일도 안 하는 카드」를 갈라야 해서 규칙이 셋이었고(`cardCrossesThreshold` 의 문턱 넘김
 * 보장까지 넷), 그 셋이 서로 물려 **만렙 뒤에 후보가 0장이 되는 사고**를 냈다.
 * 지금은 **이미 가졌는가** 하나뿐이다 — 특성은 있거나 없거나이고, 열쇠도 그렇다.
 *
 * ⚠ 그래서 `cardCrossesThreshold`(문턱 넘김 보장)는 **걷어냈다.** 도장이 없으면 문턱이라는 개념
 *   자체가 없다. 억지로 남기면 판정만 뒤처지는 축약본이 된다(known_issues 「규칙이 여럿인 판정을
 *   주효과 하나로 줄여 재면 샌다」).
 */
export function cardPrereqMet(card: Card, genome: Genome): boolean {
  if (card.ember) return false; // 불씨 카드는 game 이 따로 끼워 넣는다(일반 뽑기에 안 섞인다)
  if (!cardGateOpen(card, genome)) return false;
  return !cardRedundant(card, genome);
}

/**
 * **이 카드가 아직 잠겨 있는가** — 티어가 카드를 여는 자리(**[사용자 2026-08-10]**).
 *
 * 이것이 「티어를 올릴 이유」다. 티어 자체의 파생 능치보다 **새로 열리는 카드**가 더 큰 보상이어야
 * 한다는 것이 사용자 설계이고, 그 약속을 지키는 유일한 판정이 여기다.
 *
 * ⚠ 드래프트 필터와 **화면의 해금 예고가 같은 함수를 부른다**(`sim/perks.gateOpen`).
 *   두 곳에 조건을 적으면 「열린다고 적어 놓고 안 뜨는」 카드가 생긴다.
 * ⚠ 열쇠 카드는 **모 범주 1단**에서 열린다(`KEY_PARENT`). 세게 잠그지 않는 이유: 프리셋이 두 범주를
 *   1단으로 켜고 시작하므로 이 규칙이면 **첫 판에도 전설이 후보에 든다** — 그게 없으면 첫 판에
 *   전설 등급을 볼 길이 아예 없다(meta.ts UNLOCK_TIERS 주석의 같은 근거).
 */
export function cardGateOpen(card: Card, genome: Genome): boolean {
  if (card.key !== undefined) return tierOf(genome.pips[KEY_PARENT[card.key]]) >= 1;
  if (card.perk !== undefined) return gateOpen(perkGate(card.perk), genome.pips, genome.keys);
  return true;
}

export function cardRedundant(card: Card, genome: Genome): boolean {
  if (card.key !== undefined) return genome.keys[card.key] || keyCount(genome.keys) >= MAX_KEYS;
  // **같은 특성은 한 번만.** 중복을 허용하면 배수가 곱해져 다시 「카드 운의 곱」이 되고,
  // 그러면 도장을 뺀 이유(성장 손잡이를 하나로)가 통째로 사라진다.
  if (card.perk !== undefined) return genome.perks.includes(card.perk);
  return false;
}

// ─────────────────────────────── 시작 갈래(프리셋) ───────────────────────────────
//
// **프리셋 = 시작 도장 일곱(주 범주 4 + 부 범주 3) + 시작 열쇠 하나(있는 갈래만) = 1단 둘.**
//
// ⚠ 처음엔 「1단 하나」로 잡았다가 **실측으로 무너졌다**: 옛 프리셋은 여섯 축을 60~66 으로 한꺼번에
//   올려 줬는데 1단 하나면 축 하나만 오른다 → 탐색 반경과 걸음이 함께 줄어 단위 시간에 훑는 면적이
//   무너지고, 사망 원인의 60% 이상이 굶주림이 됐다(도달 시대 3.8 → 2.0 · 정복 0/30).
//   두 범주를 켜야 「멀리 보고 + 무엇을 한다」가 함께 성립한다. 갈래는 **어느 둘인가**로 갈린다.
//
// ⚠ 시작 도장 수는 **사다리와 한 쌍이다**(tiers.ts TIER_STEPS 주석의 실측표). 5 로 두면 한 우물
//   17장 판이 최고 티어에 못 닿았다(실측 19.4 vs 문턱 20) · 6 이라야 닿는다. 만지면 프로브를 다시 돌려라.
//
// **[사용자 2026-08-06]** 시작 갈래는 다섯만 기본으로 열고 나머지는 순차 해금한다(`game/meta.ts`).

export const PRESET_CARDS: readonly Card[] = [
  {
    id: "preset_omni",
    name: "균형 잡식",
    desc: "풀도 뜯고 사냥도 한다. 뛰어난 재주는 없지만 어느 환경에서든 자리를 잡는다.",
    pips: { fang: 4, eye: 3 },
    rarity: "common",
    color: 0x6cc24a, // 초록
  },
  {
    id: "preset_herd",
    name: "다산 초식 무리",
    desc: "풀만 뜯는다. 뭉쳐 다니며 빠르게 새끼를 치고, 멀리서 먼저 알아채 함께 달아난다.",
    // 부 범주를 가죽 → 눈으로 옮겼다(2026-08-07 · 48시드 실측).
    // 왜: 이 갈래는 다섯 중 가장 약했는데(도달 2.4 · 카드 8.8 vs 사냥꾼 2.7 · 11.1), 사망 원인 1위가
    //   시대 2 부터 줄곧 **굶주림**이었다. 가죽 1단이 주는 것은 버티는 힘인데 정작 굶어 죽고 있었고,
    //   무리 1단은 개체당 채집 수입까지 −6% 로 깎는다(HERD_GRAZE_SHARE). 눈 1단(보는 거리 60→72)은
    //   그 병목을 정면으로 푼다. 실측: 도달 2.4 → 2.7 · 카드 8.8 → 11.6 · 시대 1 에서 전멸하는 런
    //   53 → 43(240런 중). 다른 네 갈래 수치는 소수점까지 그대로다(이 갈래만 건드리는 변경).
    // 대가: 방어 68→56 · 몸집 56→48 로 맞으면 더 아프고, 시야각도 160° → 150° 로 좁아진다.
    //   그런데도 잡아먹힘 비중은 안 늘었다 — 굶주림이 줄어 개체 수 자체가 커진 것이 상쇄한다.
    // ⚠ 이름·색(라임)·주 범주(무리 4)는 그대로다. 「다산 초식 무리」라는 정체성은 무리가 지고,
    //   눈은 그 무리가 살아남는 수단이다. 시작 도장 총합 7(주 4 + 부 3)도 그대로라 사다리표 전제 불변.
    pips: { herd: 4, eye: 3 },
    rarity: "common",
    color: 0xb4e04a, // 라임
  },
  {
    id: "preset_hunter",
    name: "날쌘 육식 사냥꾼",
    desc: "사냥으로 산다. 빠르고 사나워 먹잇감을 좀처럼 놓치지 않는다.",
    pips: { fang: 4, leg: 3 },
    rarity: "common",
    color: 0xff7a3a, // 주황
  },
  {
    id: "preset_scout",
    name: "느긋한 정찰자",
    desc: "멀리 내다보고 기운을 아낀다. 남이 못 본 것을 먼저 본다.",
    pips: { eye: 4, hide: 3 },
    rarity: "common",
    color: 0x3fc9c0, // 청록
  },
  {
    id: "preset_giant",
    name: "느린 거인",
    desc: "풀만 먹고도 산처럼 자란다. 느리지만 좀처럼 쓰러지지 않는다.",
    // **[사용자 2026-08-06]** 「초식 거인 경로는 반드시 만든다」의 출발점.
    // 이빨에 도장이 하나도 없다 = 풀 효율이 온전한 1.0 이고, 사냥은 영영 못 한다.
    pips: { hide: 4, herd: 3 },
    rarity: "common",
    color: 0xc9a227, // 황토
  },
  {
    id: "preset_sea",
    name: "바다 개척자",
    desc: "능숙하게 헤엄쳐 바다의 먹이를 취하고 뭍도 오간다. 바다에는 다투는 경쟁자가 드물다.",
    pips: { leg: 4, eye: 3 },
    key: "fin",
    rarity: "common",
    color: 0x5aa0f0,
  },
  {
    id: "preset_sky",
    name: "하늘 개척자",
    desc: "산과 바다 위를 날아 넘어 산 위의 먹이에 닿는다. 대신 쉼 없는 날갯짓에 배가 빨리 곯는다.",
    pips: { leg: 4, hide: 3 },
    key: "wing",
    rarity: "common",
    color: 0xf0c840,
  },
  {
    id: "preset_ranged",
    name: "원거리 사냥꾼",
    desc: "다가서지 않고 멀리서 가시를 쏜다. 상대가 반격하거나 달아나기 전에 먼저 맞힌다.",
    pips: { fang: 4, eye: 3 },
    key: "barb",
    rarity: "common",
    color: 0x4aa0a0,
  },
  {
    id: "preset_venom",
    name: "독 살갗",
    desc: "이빨에 독을 품어, 문 상대가 서서히 스러진다. 무리로 뭉쳐 다닌다.",
    pips: { fang: 4, herd: 3 },
    key: "venom",
    rarity: "common",
    color: 0x9c27b0,
  },
];

// ─────────────────────────────── 카드 풀 ───────────────────────────────
//
// **카드 하나 = 특성 하나**(1:1). 이름·설명·효과 한 줄이 전부 `sim/perks.ts` 에서 온다.
// 여기에 다시 적지 않는 이유는 늘 같다 — 두 곳에 적힌 규칙은 반드시 조용히 어긋난다.
// 장수는 `PERKS.length + KEY_NAMES.length` 라 여기 숫자로 안 적는다(적으면 늘 낡는다).
//
// | 등급 | 무엇인가 |
// |---|---|
// | 흔함      | 조건이 넓고 배수가 작다(늘 · 낮에 · 배가 절반 아래일 때) |
// | 드묾      | 조건이 좁아지고 배수가 커진다 |
// | 귀함      | |
// | 아주 귀함 | 조건이 아주 좁고 배수가 크거나(달아나는 동안 ×3.5) 늘 켜지며 크다 · **듀오 열 장이 여기 있다** |
// | 전설      | **열쇠** · 배수가 아니라 없던 규칙을 연다 |
//
// ★ **등급을 손으로 안 적는다.** `perkRarity` 가 「조건 성립 빈도 × 효과 크기」로 계산한다
//   (규칙 특성 = 듀오만 예외 · 곱해지는 축이 없어 그 자로 못 재므로 `RULE_PERK_RARITY` 로 고정한다).
//   손으로 적으면 배수를 튜닝할 때마다 등급이 조용히 거짓이 되고, 그 순간 배지가 거짓말을 한다.
//   (v8 에서는 「등급 = 도장 크기」였는데, 도장이 사라지면서 그 척도 자체가 없어졌다.)
//
// ⚠ **등급별 「종류 수」가 서열을 뒤집을 수 있다.** 한 등급이 뜰 확률은 `종류 수 × 가중치` 라,
//   윗 등급의 종류가 많으면 아랫 등급보다 자주 뜬다 — 그 순간 배지가 거짓말이 된다.
//   레벨이 오르면 윗 등급에 배수가 붙으므로(RARITY_BOOST_MAX) **레벨 1 과 최대 레벨 양쪽에서** 봐야 한다.
// ⚠ **듀오 열 장은 이 산수에서 따로 봐야 한다**(2026-08-10). 풀 전체로 세면 「아주 귀함」의 종류가
//   갑절이 되지만, 듀오는 두 범주를 함께 3단으로 올려야(도장 28개) 후보에 뜨므로 **한 종이 동시에
//   보는 듀오 카드는 사실상 한둘**이다. 그래서 서열 검사는 ① 듀오를 뺀 풀 ② 한 종이 실제로 보는
//   후보 풀, 두 자리에서 한다(`cards.test.ts`). **장수를 바꾸면 그 두 테스트를 다시 보라.**

/**
 * **전설 — 열쇠.** 없던 규칙 하나를 연다(물에 들어간다 · 산을 날아 넘는다 · 어둠 속에서 소리로 본다).
 * 배수 카드와 값어치를 견줄 수 없어서 `perkRarity` 의 띠 밖에 있고, 등급이 여기 고정으로 적힌다.
 *
 * ⚠ v8 에서는 열쇠 카드가 **모 범주에 도장 +2** 도 함께 줬다. v9 에서 그 도장은 사라졌다.
 *   열쇠의 세기는 여전히 모 범주의 티어가 정하므로(`KEY_PARENT`), 열쇠를 살린 뒤 그 범주를
 *   **방울로 키우는 것**이 자연스러운 다음 수가 된다.
 */
const KEY_CARDS: readonly [KeyName, string, string][] = [
  ["fin", "ky_fin", "물갈퀴|물이 더는 벽이 아닙니다"],
  ["wing", "ky_wing", "넓은 날개|산도 바다도 밑으로 지나갑니다"],
  ["echo", "ky_echo", "박쥐의 귀|어둠 속에서 소리로 봅니다"],
  ["camo", "ky_camo", "흐린 무늬|풀빛에 몸이 녹아듭니다"],
  ["venom", "ky_venom", "독을 품은 이빨|한 번 물면 놓아도 됩니다"],
  ["barb", "ky_barb", "뻗는 뿔|닿지 않는 데서 칩니다"],
  ["call", "ky_call", "멀리 가는 울음|무리 전체가 한 번에 듣습니다"],
];

const split = (s: string): [string, string] => {
  const i = s.indexOf("|");
  return [s.slice(0, i), s.slice(i + 1)];
};

function buildPool(): Card[] {
  const out: Card[] = [];
  // 특성 카드 — 카드가 이름을 따로 안 갖는다. 특성이 곧 카드다.
  // **듀오 열 장도 여기 섞여 들어온다**(`PERKS` 가 이미 품고 있다 · `perks.DUO_PERK_DEFS`).
  // 게이트(두 범주 3단)는 `cardGateOpen` 이 다른 특성과 **똑같은 함수**로 판정하므로 예외가 없다.
  for (const p of PERKS) {
    out.push({ id: `pk_${p.id}`, name: p.name, desc: p.flavor, perk: p.id, rarity: perkRarity(p) });
  }
  // 열쇠 카드 일곱.
  for (const [key, id, text] of KEY_CARDS) {
    const [name, desc] = split(text);
    out.push({ id, name, desc, key, rarity: "legendary" });
  }
  return out;
}


export const CARD_POOL: readonly Card[] = buildPool();

/**
 * 불씨 회복 카드 — **[사용자 2026-08-06]** 불씨가 **정확히 하나** 남았을 때만 뜬다(미리 쟁여 두기 방지).
 * **첫 한 번은 확정, 그 뒤로는 확률.** 첫 한 번이 "이 규칙이 존재한다"를 가르치고(화면 안에서 알아채게),
 * 그 뒤로는 긴장이 남는다.
 *
 * ⚠ **대가의 정체가 v9 에서 바뀌었다.** v8 에서는 「도장이 0 이라 이번 성장이 없다」였는데, 이제는
 *   어떤 카드도 도장을 안 주므로 그 대비가 성립하지 않는다. 지금의 대가는 **이번 드래프트의 특성이나
 *   열쇠를 못 받는 것**이다 — 이 카드를 고르면 그 자리에서 고를 수 있었던 한 장이 사라진다.
 *   문구도 그에 맞춰 고쳤다(「자라지 않습니다」는 도장 시절의 말이었다).
 */
export const EMBER_CARD: Card = {
  id: "ember_relight",
  name: "꺼지지 않은 자리",
  desc: "불씨 하나가 되살아납니다. 대신 이번엔 아무것도 못 얻습니다.",
  ember: 1,
  rarity: "epic",
};

export function cardRarity(card: Card): Rarity {
  return card.rarity;
}

/** 갈래 전용 풀은 폐기됐다 — 풀 전체가 누구에게나 나온다(장수는 `CARD_POOL.length` 가 진실). */
export function cardPoolFor(): Card[] {
  return CARD_POOL.slice();
}

/**
 * 같은 카드를 거듭 고를수록 가중치가 이만큼씩 준다(소프트 디듑).
 * 완전 제외가 아니라 감쇠인 이유: 한 우물 빌드가 같은 카드를 두 번 고르는 것 자체는 정당한 선택이라
 * 막으면 안 되고, 다만 세 번째부터는 다른 길도 보여야 한다.
 */
const PICK_DECAY = 0.5;

/**
 * 내가 판 방향의 카드가 **조금 더 자주** 뜬다 — **[사용자 2026-08-06]**.
 *
 * 원문: "카드와 시험이 플레이어가 이미 가던 방향으로 뜨는 것도 무조건 그런 게 아니라 그냥 그럴 확률이
 * 좀 더 높다는 정도로 하고. **애초에 로그라이크는 그 무작위성과 예측 불가능함 속 운적 요소가 핵심
 * 재미인 거잖아.**"
 *
 * ⚠ 그래서 이건 **보장이 아니라 가중치**다. 가끔 내 길이 하나도 안 나오는 드래프트가 생기고,
 *   그때 갈아탈지 버틸지가 진짜 질문이 된다. 지난 합의("3장 중 1장은 반드시 내 방향")는 무른 것이다.
 */
export interface DraftBias {
  /** 이 범주들의 카드 가중치를 올린다(보통 지금 도장이 가장 많은 한둘). */
  cats: readonly Category[];
  /** 곱해지는 배수. 1 이면 보정 없음. */
  weight: number;
}

/**
 * 「내가 판 방향」의 카드인가 — **v9 에서 판정 근거가 바뀌었다.**
 * v8 에서는 카드가 그 범주에 도장을 주는지 봤는데, 이제 카드는 도장을 안 준다. 대신 특성의 **축**이
 * 그 범주가 하는 일과 맞는지 본다(`CATEGORY_AXES` · 이빨을 판 사람에게 무는 카드가 더 자주 뜬다).
 * 열쇠 카드는 모 범주(`KEY_PARENT`)로 판정한다.
 */
export function cardFavorsCategory(card: Card, cat: Category): boolean {
  if (card.key !== undefined) return KEY_PARENT[card.key] === cat;
  if (card.perk !== undefined) {
    const p = PERK_BY_NAME.get(card.perk);
    return p !== undefined && CATEGORY_AXES[cat].includes(p.axis);
  }
  return cardPips(card, cat) > 0; // 프리셋(드래프트에는 안 나온다)
}

export function drawCards(
  rng: Rng,
  n: number,
  allow?: (c: Card) => boolean,
  level = 1,
  pickedCounts?: ReadonlyMap<string, number>,
  bias?: DraftBias,
): Card[] {
  const eligible = CARD_POOL.filter((c) => (allow ? allow(c) : true));
  const weights = rarityWeightsAtLevel(level);
  const biasOf = (c: Card): number => {
    if (!bias || bias.weight === 1) return 1;
    return bias.cats.some((cat) => cardFavorsCategory(c, cat)) ? bias.weight : 1;
  };
  const weightOf = (c: Card): number =>
    weights[cardRarity(c)] * PICK_DECAY ** (pickedCounts?.get(c.id) ?? 0) * biasOf(c);

  /** 가중치 룰렛으로 pool 에서 한 장 뽑아 꺼낸다(뽑힌 카드는 pool 에서 빠진다). */
  const take = (pool: Card[]): Card | null => {
    if (pool.length === 0) return null;
    let total = 0;
    for (const c of pool) total += weightOf(c);
    let r = rng.unit() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= weightOf(pool[i] as Card);
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    const picked = pool[idx] as Card;
    pool.splice(idx, 1);
    return picked;
  };

  const out: Card[] = [];
  const rest = eligible.slice();

  // ⚠ **「3장 중 한 장은 문턱을 넘긴다」 보장은 v9 에서 걷어냈다.** 도장이 없으면 문턱이라는 개념이
  //   없다. 그 보장은 원래 「도장은 오르는데 아무 일도 안 일어나는 픽」을 막으려던 것인데, 지금은
  //   **모든 카드가 고르는 즉시 무언가를 켠다** — 특성은 조건이 맞으면 그 순간부터 작동하고, 열쇠는
  //   없던 규칙을 연다. 막을 죽은 픽이 애초에 없다.
  //   (그 보장이 등급 필터로 변질돼 레벨업 드래프트의 59%에 아주 귀함·전설이 끼던 문제도 함께 사라진다.)
  while (out.length < n) {
    const c = take(rest);
    if (!c) break;
    out.push(c);
  }

  // 자리를 섞는다 — 뽑기 순서가 곧 자리가 되면 위치만 보고 무엇이 좋은 장인지 알아버린다.
  // ⚠ 섞기를 지우지 말 것: rng 소비 횟수가 바뀌어 그 뒤 모든 드래프트가 다른 세계가 된다.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.unit() * (i + 1));
    const a = out[i] as Card;
    out[i] = out[j] as Card;
    out[j] = a;
  }
  return out;
}

/** 한 희귀도가 얼마나 자주 뜨는가(대백과 표시용). `drawCards` 와 같은 가중치를 써서 계산한다. */
export interface RarityOdds {
  count: number;
  perCard: number;
  inDraw: number;
}

export function rarityOdds(pool: readonly Card[], draws = 3, level = 1): Record<Rarity, RarityOdds> {
  const weights = rarityWeightsAtLevel(level);
  let total = 0;
  const byRarity = {} as Record<Rarity, { count: number; weight: number }>;
  for (const r of Object.keys(RARITY_WEIGHT) as Rarity[]) byRarity[r] = { count: 0, weight: 0 };
  for (const c of pool) {
    const r = cardRarity(c);
    const w = weights[r];
    byRarity[r].count += 1;
    byRarity[r].weight += w;
    total += w;
  }
  const out = {} as Record<Rarity, RarityOdds>;
  for (const r of Object.keys(RARITY_WEIGHT) as Rarity[]) {
    const per = total > 0 ? byRarity[r].weight / total : 0;
    out[r] = {
      count: byRarity[r].count,
      perCard: per,
      inDraw: 1 - (1 - per) ** draws,
    };
  }
  return out;
}

/**
 * 카드를 종에 적용한다 — **특성을 더하고, 열쇠를 열고, (프리셋이면) 도장을 찍고, 파생 능치를 다시 낸다.**
 *
 * 이 네 줄이 카드가 하는 전부다. 예전에는 여기에 성장 스케일 · 상한 근접 감쇠 · 정점 고정 · 수영
 * 뚜껑이 겹겹이 얹혀 있었고, 그래서 "카드에 적힌 값"과 "실제로 붙는 값"이 달랐다.
 *
 * ⚠ **같은 특성을 두 번 더하지 않는다.** 후보 필터(`cardRedundant`)가 이미 막지만, 여기서도 막는다 —
 *   중복이 들어가면 배수가 곱해져 카드 한 장의 값어치가 조용히 달라진다(화면은 한 줄만 보여 준다).
 * ⚠ **파생 능치(`refreshDerived`)는 특성과 무관하다.** 특성은 상황에 따라 켜졌다 꺼지는 것이라
 *   고정된 능치 표에 안 들어간다(`sim/perks.ts` 참조). 그래도 여기서 부르는 이유는 프리셋의 도장
 *   때문이다.
 */
export function applyCard(genome: Genome, card: Card): void {
  if (card.pips) {
    for (const c of CATEGORIES) {
      const d = cardPips(card, c);
      if (d !== 0) genome.pips[c] = Math.max(0, genome.pips[c] + d);
    }
  }
  if (card.key !== undefined && keyCount(genome.keys) < MAX_KEYS) genome.keys[card.key] = true;
  if (card.perk !== undefined && !genome.perks.includes(card.perk)) genome.perks.push(card.perk);
  refreshDerived(genome);
}

/**
 * 카드 한 장을 한 줄로 요약 — 대백과·런 보고서·드래프트 카드가 전부 이 하나를 쓴다.
 * 예: 「수풀에서 보는 거리 ×1.55」 · 「열쇠 「지느러미」」 · (프리셋) 「이빨 +4 · 눈 +3」
 *
 * ⚠ 특성 줄은 **`sim/perks.ts` 가 만든다.** 여기서 배수를 다시 적으면 언젠가 한쪽만 바뀐다.
 */
export function cardSummary(card: Card): string {
  const parts: string[] = [];
  for (const c of cardCategories(card)) {
    const v = cardPips(card, c);
    parts.push(`${CATEGORY_LABELS[c]} ${v > 0 ? "+" : "−"}${Math.abs(v)}`);
  }
  if (card.perk !== undefined) {
    const p = PERK_BY_NAME.get(card.perk);
    if (p !== undefined) parts.push(perkLine(p));
  }
  if (card.key !== undefined) parts.push(`열쇠 「${KEY_LABELS[card.key]}」`);
  if (card.ember) parts.push(`불씨 +${card.ember}`);
  return parts.join(" · ");
}
