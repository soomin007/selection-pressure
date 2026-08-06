// 카드 = 종에 찍히는 **도장(pip)**. 런 내 영구, 런 종료 시 리셋(로그라이크).
// 매 드래프트에 풀에서 3장 후보(운 요소)를 뽑고 하나를 고른다.
//
// **v8 에서 카드의 정체가 바뀌었다** (2026-08-06 회의 · **[사용자]** 확정).
//   예전: 카드가 형질 숫자를 직접 올렸다(속도 +15). 그런데 그 +15 가 실제로 무슨 일을 하는지는
//         지금 값이 얼마냐에 따라 달랐고(상한 근접 감쇠), 효과도 시드 노이즈에 묻혔다.
//   지금: 카드는 **범주에 도장을 찍을 뿐**이고, 세계는 **문턱을 넘었는가**만 본다.
//
// 이 구조의 값어치는 **거짓말이 원리적으로 불가능해진 것**이다. 카드에 「이빨 +2」라 적히면 정확히
// 도장 두 개가 찍히고, 그 두 개가 문턱을 넘기면 티어 효과가 통째로 켜지며, 못 넘기면 아무 일도
// 안 일어난다 — 그리고 **넘기는지 못 넘기는지가 카드에 그대로 적혀 있다**(`draftPanel` 의 티어 칩).
//
// ⚠ 성장 스케일(CARD_GROWTH_SCALE) · 상한 근접 감쇠(growthFalloff) · 정점 고정 · 갈래 전용 40장은
//   **전부 폐기했다.** 셋은 서로 물려 있어 한 묶음으로만 버릴 수 있었다.

import type { Rng } from "@/sim/rng";
import type { Genome } from "@/sim/genome";
import { refreshDerived } from "@/sim/genome";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  KEY_LABELS,
  KEY_PARENT,
  MAX_KEYS,
  MAX_TIER,
  keyCount,
  pipsToNext,
  tierOf,
  type Category,
  type KeyName,
  type Pips,
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

/** 레벨 보정이 최대에 이르는 런 레벨. 한 판은 보통 레벨 12~22 에서 끝나므로 그 앞쪽에서 체감되게 잡는다. */
export const RARITY_BOOST_FULL_LEVEL = 10;

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
 * 다르게 하고, 카드는 75장 전부가 누구에게나 나온다. 대신 **[사용자 2026-08-06]** 내가 판 방향의
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

/** 카드 한 장. **도장과 열쇠 말고는 아무것도 안 준다** — 그래서 표시와 실제가 갈릴 수 없다. */
export interface Card {
  id: string;
  name: string;
  /** 플레이버 한 줄. **효과를 여기 적지 않는다** — 효과는 티어 칩이 말한다(두 곳에 적으면 어긋난다). */
  desc: string;
  /** 이 카드가 찍는 도장. 음수는 「맞바꿈」 카드의 대가다(티어가 내려갈 수 있다). */
  pips?: Partial<Record<Category, number>>;
  /** 이 카드가 여는 열쇠(능력). 세기는 모 범주의 티어가 정한다. */
  key?: KeyName;
  rarity: Rarity;
  /** 시작 프리셋의 내 종 시작 색(프리셋 전용). */
  color?: number;
  /**
   * **불씨 회복 카드** — 도장은 0 이고 꺼진 불씨를 이만큼 되살린다.
   * **[사용자 2026-08-06]** 불씨가 정확히 하나 남았을 때만 뜨고, **첫 한 번은 확정 · 그 뒤로는 확률**이다.
   */
  ember?: number;
}

/** 이 카드가 실제로 찍는 도장 수(없는 범주는 0). */
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
 * 이 카드를 고르면 이 범주가 **어느 티어에서 어느 티어로** 가는가.
 * 카드 칩 · 내 종 패널 · 대백과가 전부 이 하나를 부른다(UI 에서 문턱을 다시 유도하면 조용히 어긋난다).
 */
export interface TierMove {
  cat: Category;
  from: number;
  to: number;
  /** 이 카드를 고른 뒤 다음 문턱까지 남는 도장. 최고 티어면 0. */
  remain: number;
  /** 도장 변화량(음수 가능). */
  delta: number;
}

export function tierMove(card: Card, pips: Pips, cat: Category): TierMove {
  const d = cardPips(card, cat);
  const before = pips[cat];
  const after = Math.max(0, before + d);
  return { cat, from: tierOf(before), to: tierOf(after), remain: pipsToNext(after), delta: d };
}

export function cardTierMoves(card: Card, pips: Pips): TierMove[] {
  return cardCategories(card).map((c) => tierMove(card, pips, c));
}

/** 이 카드가 **어떤 범주의 문턱이든 넘기는가.** 드래프트의 「죽은 카드」 규칙이 이걸 본다. */
export function cardCrossesThreshold(card: Card, pips: Pips): boolean {
  if (card.key !== undefined) return true; // 열쇠는 그 자체로 새 능력이다
  if (card.ember) return true;
  return cardTierMoves(card, pips).some((m) => m.to > m.from);
}

/**
 * 이 카드가 후보로 나올 수 있는가.
 * · 열쇠 카드는 **이미 가진 열쇠**이거나 **상한(3개)에 닿았으면** 안 나온다.
 * · 도장이 **전부 최고 티어인 범주로만** 가는 카드는 안 나온다(죽은 카드 규칙 (가)).
 */
export function cardPrereqMet(card: Card, genome: Genome): boolean {
  if (card.key !== undefined) {
    if (genome.keys[card.key]) return false;
    if (keyCount(genome.keys) >= MAX_KEYS) return false;
    return true;
  }
  if (card.ember) return false; // 불씨 카드는 game 이 따로 끼워 넣는다(일반 뽑기에 안 섞인다)
  const cats = cardCategories(card);
  if (cats.length === 0) return true;
  // 주는 쪽(양수)이 전부 이미 최고 티어면 이 카드는 아무 일도 못 한다.
  const gains = cats.filter((c) => cardPips(card, c) > 0);
  if (gains.length > 0 && gains.every((c) => tierOf(genome.pips[c]) >= MAX_TIER)) return false;
  return true;
}

/**
 * 이 카드가 **이 종에게 아무 일도 안 하는가**(죽은 카드).
 * 도장은 오르는데 문턱을 하나도 안 넘고, 그러면서 잃는 것만 있는 경우가 여기 걸린다.
 * ⚠ 문턱을 안 넘는 것 자체는 죽은 게 아니다(다음 장을 위한 저축이다) — 그래서 여기서는
 *   **주는 도장이 하나도 없는 경우**만 잡고, "이번에 문턱을 넘기는 장이 3장 중 하나는 있어야 한다"는
 *   보장은 `drawCards` 가 맡는다. 둘을 섞으면 저축 카드가 통째로 사라져 사다리가 안 올라간다.
 */
export function cardRedundant(card: Card, genome: Genome): boolean {
  if (card.key !== undefined) return genome.keys[card.key] || keyCount(genome.keys) >= MAX_KEYS;
  const gains = CATEGORIES.filter((c) => cardPips(card, c) > 0);
  if (gains.length === 0) return false;
  return gains.every((c) => tierOf(genome.pips[c]) >= MAX_TIER);
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
    desc: "풀만 뜯는다. 뭉쳐 다니며 빠르게 새끼를 쳐, 하나가 스러져도 수로 메운다.",
    pips: { herd: 4, hide: 3 },
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

// ─────────────────────────────── 카드 풀 75장 ───────────────────────────────
//
// | 패턴 | 장수 | 주는 도장 |
// |---|---|---|
// | 패턴 | 장수 | 주는 도장 | 등급 |
// |---|---|---|---|
// | 한 우물 | 30 (5범주 × 6) | 한 범주 +2 | 흔함 20 · 드묾 10 |
// | 큰 도약 | 10 (5범주 × 2) | 한 범주 +3 | 귀함 10 |
// | 두 갈래 | 10 (10쌍 × 1) | 두 범주 각 +1 | 흔함 6 · 드묾 4 |
// | 치우침 | 10 | 주 +2 · 부 +1 | 드묾 10 |
// | 맞바꿈 |  8 | 한 범주 +3 · 다른 범주 −1 | 아주 귀함 8 |
// | 열쇠   |  7 | 능력 하나 + 모 범주 +1 | 전설 7 |
//
// ⚠ **등급별 「종류 수」가 서열을 뒤집을 수 있다.** 한 등급이 뜰 확률은 `종류 수 × 가중치` 라,
//   윗 등급의 카드 종류가 많으면 아랫 등급보다 자주 뜬다 — 그 순간 배지가 거짓말이 된다.
//   ⚠ 레벨이 오르면 윗 등급에 배수가 붙으므로(RARITY_BOOST_MAX) **레벨 7·30 에서도** 서열을 봐야 한다.
//   지금 구성(총 75장): 흔함 26 · 드묾 24 · 귀함 10 · 아주 귀함 8 · 전설 7.
//   레벨 30 기준 26×100 > 24×97.5 > 10×91.2 > 8×72 > 7×55 로 서열이 지켜진다.
//   **장수를 바꾸면 이 산수를 다시 하라**(cards.test 가 레벨 1·3·5·7·30 에서 잡는다).
//
// 문구 규칙: **desc 에 효과를 적지 않는다.** 「이빨 +2」는 칩이 말하고, 「무는 힘 ×1.7 이 켜집니다」는
// 티어 줄(`tiers.tierLine`)이 말한다. 여기 또 적으면 언젠가 한쪽만 바뀌어 화면이 거짓말을 한다.

const ONE_WELL: readonly [Category, string, string, Rarity][] = [
  ["fang", "wc_fang1", "날카로운 앞니|물면 살점이 뜯깁니다", "common"],
  ["fang", "wc_fang2", "굽은 송곳니|한 번 박히면 잘 안 빠집니다", "common"],
  ["fang", "wc_fang3", "벌어지는 턱|입이 더 크게 벌어집니다", "common"],
  ["fang", "wc_fang4", "물어뜯는 버릇|물고 흔드는 법을 익힙니다", "common"],
  ["fang", "wc_fang5", "갈아 붙인 어금니|씹는 자리가 단단해집니다", "uncommon"],
  ["fang", "wc_fang6", "핏내를 아는 코|다친 것을 멀리서 알아챕니다", "uncommon"],
  ["leg", "wc_leg1", "긴 정강이|한 걸음이 멀어집니다", "common"],
  ["leg", "wc_leg2", "단단한 발굽|땅을 차는 소리가 달라집니다", "common"],
  ["leg", "wc_leg3", "마른 몸통|군더더기가 빠집니다", "common"],
  ["leg", "wc_leg4", "튼튼한 뒷다리|밀어내는 힘이 붙습니다", "common"],
  ["leg", "wc_leg5", "가벼운 뼈|뼛속이 비어 갑니다", "uncommon"],
  ["leg", "wc_leg6", "지치지 않는 걸음|오래 달려도 숨이 덜 찹니다", "uncommon"],
  ["eye", "wc_eye1", "커다란 눈망울|더 많은 빛이 들어옵니다", "common"],
  ["eye", "wc_eye2", "밤에 뜨는 눈|어두운 것이 덜 어두워집니다", "common"],
  ["eye", "wc_eye3", "높이 달린 눈|풀 너머가 보입니다", "common"],
  ["eye", "wc_eye4", "맑은 수정체|멀리 있는 것이 또렷해집니다", "common"],
  ["eye", "wc_eye5", "두 겹 눈꺼풀|모래바람에도 눈을 뜹니다", "uncommon"],
  ["eye", "wc_eye6", "먼 데를 보는 버릇|고개를 들고 오래 봅니다", "uncommon"],
  ["hide", "wc_hide1", "굳은 살가죽|부딪힌 자리가 굳어 두꺼워집니다", "common"],
  ["hide", "wc_hide2", "두꺼운 지방층|추운 밤이 견딜 만해집니다", "common"],
  ["hide", "wc_hide3", "겹친 비늘|이빨이 미끄러집니다", "common"],
  ["hide", "wc_hide4", "뭉친 근육|맞아도 덜 밀립니다", "common"],
  ["hide", "wc_hide5", "촘촘한 털|살갗에 바람이 안 닿습니다", "uncommon"],
  ["hide", "wc_hide6", "단단한 등뼈|무거운 것을 지고도 섭니다", "uncommon"],
  ["herd", "wc_herd1", "서로 부르는 소리|멀리 떨어진 동료가 대답합니다", "common"],
  ["herd", "wc_herd2", "잦은 출산|새끼 보는 날이 잦아집니다", "common"],
  ["herd", "wc_herd3", "함께 자는 밤|붙어 자면 덜 춥습니다", "common"],
  ["herd", "wc_herd4", "새끼를 돌보는 버릇|어린 것이 덜 죽습니다", "common"],
  ["herd", "wc_herd5", "넓어진 목청|목소리가 골짜기를 넘습니다", "uncommon"],
  ["herd", "wc_herd6", "큰 배|한 배에 여럿을 품습니다", "uncommon"],
];

// ⚠ **열 장 전부 「귀함」이다. 등급을 섞지 말 것.**
//   처음엔 절반을 「아주 귀함」으로 뒀는데, 그러면 풀 구성이 귀함 5 · 아주 귀함 10 이 되어
//   **아주 귀함이 귀함보다 자주 뜬다**(등급 확률 = 종류 수 × 가중치 · 5×38=190 vs 10×20=200).
//   그 순간 배지가 거짓말을 한다 — 이 저장소에서 희귀도는 반드시 뽑기 확률과 묶여 있어야 한다.
//   「아주 귀함」은 맞바꿈 다섯 장이 맡는다(대가가 있는 대신 보상이 크다).
const BIG_LEAP: readonly [Category, string, string, Rarity][] = [
  ["fang", "lp_fang1", "톱니 어금니|뼈까지 갈아 넘깁니다", "rare"],
  ["fang", "lp_fang2", "뼈를 부수는 턱|한 번에 끝냅니다", "rare"],
  ["leg", "lp_leg1", "폭발하는 뒷다리|첫 세 걸음이 다릅니다", "rare"],
  ["leg", "lp_leg2", "바람을 가르는 몸|달리는 소리가 사라집니다", "rare"],
  ["eye", "lp_eye1", "매의 눈|점 하나가 짐승으로 보입니다", "rare"],
  ["eye", "lp_eye2", "밤을 꿰뚫는 눈|한밤이 저녁처럼 보입니다", "rare"],
  ["hide", "lp_hide1", "네 칸짜리 위|풀만 먹고도 산이 됩니다", "rare"],
  ["hide", "lp_hide2", "바위 같은 등|위에서 떨어지는 것을 그냥 받습니다", "rare"],
  ["herd", "lp_herd1", "한배에 여럿|한 번에 여러 마리가 태어납니다", "rare"],
  ["herd", "lp_herd2", "사방으로 퍼지는 목소리|골짜기 건너까지 명령이 갑니다", "rare"],
];

const TWO_WAY: readonly [Category, Category, string, string, Rarity][] = [
  ["fang", "leg", "tw_fl", "몰이꾼의 다리|쫓아가서 뭅니다", "common"],
  ["fang", "eye", "tw_fe", "매복꾼의 자세|먼저 보고 기다렸다가 뭅니다", "common"],
  ["fang", "hide", "tw_fh", "맞물리는 몸|밀면서 뭅니다", "common"],
  ["fang", "herd", "tw_fd", "함께 무는 법|하나가 물면 둘이 붙습니다", "uncommon"],
  ["leg", "eye", "tw_le", "앞서 보는 걸음|보면서 달립니다", "common"],
  ["leg", "hide", "tw_lh", "지구력|오래 걷고 잘 안 지칩니다", "common"],
  ["leg", "herd", "tw_ld", "같이 달리는 무리|한 무리가 한 방향으로 뜁니다", "uncommon"],
  ["eye", "hide", "tw_eh", "참는 눈|가만히 오래 지켜봅니다", "common"],
  ["eye", "herd", "tw_ed", "파수 서기|누군가는 늘 깨어 있습니다", "uncommon"],
  ["hide", "herd", "tw_hd", "서로 기대기|붙어 서면 벽이 됩니다", "uncommon"],
];

const LEAN: readonly [Category, Category, string, string][] = [
  ["fang", "leg", "ln_fl", "쫓아가 무는 법|따라잡는 것까지가 사냥입니다"],
  ["fang", "herd", "ln_fd", "나눠 먹는 사냥|잡은 것을 함께 뜯습니다"],
  ["leg", "eye", "ln_le", "달리며 보기|속도를 안 줄이고 살핍니다"],
  ["leg", "hide", "ln_lh", "버티는 걸음|넘어져도 다시 뜁니다"],
  ["eye", "fang", "ln_ef", "먼저 보고 무는 법|보이면 이미 늦은 쪽은 상대입니다"],
  ["eye", "herd", "ln_ed", "망보는 자리|높은 데 하나가 섭니다"],
  ["hide", "fang", "ln_hf", "밀어붙이는 몸|몸으로 밀고 이빨로 끝냅니다"],
  ["hide", "herd", "ln_hd", "울타리가 되는 몸|바깥에 서서 막습니다"],
  ["herd", "leg", "ln_dl", "함께 옮겨 다니기|먹을 것을 따라 무리째 움직입니다"],
  ["herd", "eye", "ln_de", "서로 알리는 무리|본 것을 곧바로 전합니다"],
];

// ⚠ **여덟 장이다. 다섯으로 줄이지 말 것.** 다섯이면 「아주 귀함」의 종류 수가 전설(열쇠 7종)보다
//   적어져, 레벨 보정이 붙는 후반에 **전설이 아주 귀함보다 자주 뜬다**(레벨 7에서 실측으로 뒤집혔다).
//   등급 확률은 `종류 수 × 가중치` 이므로 종류 수가 서열을 뒤집을 수 있다.
const TRADE: readonly [Category, Category, string, string][] = [
  ["hide", "leg", "td_hl", "등에 진 껍질|무거운 것을 지고 다니기로 합니다"],
  ["fang", "hide", "td_fh", "전부 이빨로|살을 덜어 이빨에 몰아줍니다"],
  ["leg", "herd", "td_ld", "홀로 달리기|무리를 두고 앞서 나갑니다"],
  ["eye", "hide", "td_eh", "눈만 남기고|보는 데 모든 것을 겁니다"],
  ["herd", "fang", "td_df", "수로 밀어붙이기|이빨 대신 머릿수로 갚습니다"],
  ["fang", "leg", "td_fl", "자리를 지키는 턱|쫓기를 포기하고 무는 데 겁니다"],
  ["eye", "herd", "td_ed", "혼자 보는 눈|무리를 흩고 스스로 살핍니다"],
  ["herd", "hide", "td_dh", "얇고 많이|한 마리를 두껍게 하느니 여럿을 낳습니다"],
];

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
  for (const [cat, id, text, rarity] of ONE_WELL) {
    const [name, desc] = split(text);
    out.push({ id, name, desc, pips: { [cat]: 2 }, rarity });
  }
  for (const [cat, id, text, rarity] of BIG_LEAP) {
    const [name, desc] = split(text);
    out.push({ id, name, desc, pips: { [cat]: 3 }, rarity });
  }
  for (const [a, b, id, text, rarity] of TWO_WAY) {
    const [name, desc] = split(text);
    out.push({ id, name, desc, pips: { [a]: 1, [b]: 1 }, rarity });
  }
  for (const [main, sub, id, text] of LEAN) {
    const [name, desc] = split(text);
    out.push({ id, name, desc, pips: { [main]: 2, [sub]: 1 }, rarity: "uncommon" });
  }
  for (const [gain, loss, id, text] of TRADE) {
    const [name, desc] = split(text);
    // **[사용자 2026-08-06]** 맞바꿈이 티어를 **강등**시켜도 된다. 조건: "다른 칸 수를 줄이는 거라면
    // 그만큼 보상이 더욱 획기적이어야 할 거야." → 주는 쪽이 +3(큰 도약과 같은 값)인데 등급은 한 단계
    // 위이고 대가가 있다. 강등은 카드에 붉은 칩(`다리 II ▾ I`)으로 그 자리에서 보인다.
    out.push({ id, name, desc, pips: { [gain]: 3, [loss]: -1 }, rarity: "epic" });
  }
  for (const [key, id, text] of KEY_CARDS) {
    const [name, desc] = split(text);
    out.push({ id, name, desc, pips: { [KEY_PARENT[key]]: 1 }, key, rarity: "legendary" });
  }
  return out;
}

export const CARD_POOL: readonly Card[] = buildPool();

/**
 * 불씨 회복 카드 — **[사용자 2026-08-06]** 불씨가 **정확히 하나** 남았을 때만 뜬다(미리 쟁여 두기 방지).
 * **첫 한 번은 확정, 그 뒤로는 확률.** 첫 한 번이 "이 규칙이 존재한다"를 가르치고(화면 안에서 알아채게),
 * 그 뒤로는 긴장이 남는다. 도장은 0 이라 **고르는 순간 이번 성장은 없다** — 그 사실을 카드에 그대로 적는다.
 */
export const EMBER_CARD: Card = {
  id: "ember_relight",
  name: "꺼지지 않은 자리",
  desc: "불씨 하나가 되살아납니다. 대신 이번엔 자라지 않습니다.",
  ember: 1,
  rarity: "epic",
};

export function cardRarity(card: Card): Rarity {
  return card.rarity;
}

/**
 * 시대 보상 카드 — **효과 배수가 아니라 도장을 곱한다.**
 * 표시값과 적용값이 갈릴 수 없는 구조가 그대로 보존된다(사본을 만들어 그 사본의 도장을 곱하므로,
 * 화면이 읽는 카드와 적용되는 카드가 **같은 객체**다).
 */
export function boostCard(card: Card, boost: number): Card {
  const mul = Math.max(1, Math.round(boost));
  if (card.pips === undefined) return { ...card, id: `${card.id}_x${mul}` };
  const pips: Partial<Record<Category, number>> = {};
  for (const c of CATEGORIES) {
    const v = cardPips(card, c);
    if (v !== 0) pips[c] = v > 0 ? v * mul : v; // 대가(음수)는 안 키운다 — 보상 카드가 벌이 되면 안 된다
  }
  return { ...card, id: `${card.id}_x${mul}`, name: `${card.name} (강화 ×${mul})`, pips };
}

/** 갈래 전용 풀은 폐기됐다 — 75장 전부가 누구에게나 나온다. (대백과 호환용으로 남긴다.) */
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

export function drawCards(
  rng: Rng,
  n: number,
  allow?: (c: Card) => boolean,
  level = 1,
  pickedCounts?: ReadonlyMap<string, number>,
  bias?: DraftBias,
  /** 지금 도장 상황 — 「3장 중 최소 한 장은 문턱을 넘긴다」 보장에 쓴다. 없으면 보장을 안 건다. */
  pips?: Pips,
): Card[] {
  const eligible = CARD_POOL.filter((c) => (allow ? allow(c) : true));
  const weights = rarityWeightsAtLevel(level);
  const biasOf = (c: Card): number => {
    if (!bias || bias.weight === 1) return 1;
    return bias.cats.some((cat) => cardPips(c, cat) > 0) ? bias.weight : 1;
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

  // **죽은 카드 규칙 (나) — 3장 중 최소 한 장은 지금 어느 범주의 문턱을 넘길 수 있어야 한다**
  // (그런 카드가 풀에 남아 있는 한). 이게 없으면 "도장은 오르는데 아무 일도 안 일어나는 픽"이 쌓이고,
  // 새끼를 확정으로 주는 스킵이 늘 정답이 된다.
  if (pips) {
    const crossing = rest.filter((c) => cardCrossesThreshold(c, pips));
    const first = take(crossing);
    if (first) {
      out.push(first);
      const i = rest.indexOf(first);
      if (i >= 0) rest.splice(i, 1);
    }
  }

  while (out.length < n) {
    const c = take(rest);
    if (!c) break;
    out.push(c);
  }

  // 자리를 섞는다 — 안 섞으면 「문턱을 넘기는 장」이 늘 첫 자리라 위치만 보고 알아버린다.
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
 * 카드를 종에 적용한다 — **도장을 찍고, 열쇠를 열고, 파생 능치를 다시 낸다.**
 *
 * 이 세 줄이 성장의 전부다. 예전에는 여기에 성장 스케일 · 상한 근접 감쇠 · 정점 고정 · 수영 뚜껑이
 * 겹겹이 얹혀 있었고, 그래서 "카드에 적힌 값"과 "실제로 붙는 값"이 달랐다.
 */
export function applyCard(genome: Genome, card: Card): void {
  if (card.pips) {
    for (const c of CATEGORIES) {
      const d = cardPips(card, c);
      if (d !== 0) genome.pips[c] = Math.max(0, genome.pips[c] + d);
    }
  }
  if (card.key !== undefined && keyCount(genome.keys) < MAX_KEYS) genome.keys[card.key] = true;
  refreshDerived(genome);
}

/** 카드 한 장을 한 줄로 요약 — 대백과·런 보고서가 쓴다. 예: 「이빨 +2」 · 「가죽 +3 · 다리 −1」 */
export function cardSummary(card: Card): string {
  const parts: string[] = [];
  for (const c of cardCategories(card)) {
    const v = cardPips(card, c);
    parts.push(`${CATEGORY_LABELS[c]} ${v > 0 ? "+" : "−"}${Math.abs(v)}`);
  }
  if (card.key !== undefined) parts.push(`열쇠 「${KEY_LABELS[card.key]}」`);
  if (card.ember) parts.push(`불씨 +${card.ember}`);
  return parts.join(" · ");
}
