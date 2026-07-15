// 카드 = 종 게놈에 누적 적용되는 형질 변화. 런 내 영구, 런 종료 시 리셋(로그라이크).
// 매 라운드 풀에서 무작위 3장 후보(운 요소). 트레이드오프 카드로 "특화 vs 헷지" 결정을 만든다.
// 문구는 쉬운 말로 (UI 규칙).
//
// effects = 누적 가감. set = 절대값 지정(시작 식성 선택용). 값은 형질과 같은 0~100 자연수 스케일.
// 둘 다 적용 후 0~100 으로 클램프.

import type { Rng } from "@/sim/rng";
import type { Genome, Traits } from "@/sim/genome";
import { clampTraitValue, isApexTrait, TRAIT_CEILING } from "@/sim/genome";
import { SIM } from "@/sim/params";

// 값형질(속도·시야·공격·번식·무리)의 카드 증가폭을 이만큼으로 줄인다 — 한 판 동안 여러 장을 쌓아야 상한
// (100)에 닿게 해 성장을 천천히 느끼게 한다(카드 +15 → 실제 +9 적용, 50→100 에 ~6픽). 상한을 200→100 으로
// 내려도 이 스케일을 유지해 실제 증가폭이 안 바뀌므로 밸런스는 불변(바뀌는 건 최대 도달값뿐). 대사·식성·
// 능력형은 안 줄인다(성격이 다름). set(프리셋 정체성 값)도 안 줄인다(증분만).
// 0.6 → 0.75: 상한 근접 감쇠(growthFalloff)가 들어오면서 후반 성장이 느려졌는데 난이도는 그대로라
// 프리셋이 전반적으로 약해졌다(균형 잡식 도달 5.0 → 4.2). 초반(50 근처) 증가폭을 키워 총량을 되살린다.
// 곡선이 바뀐 것이다: **초반엔 쑥쑥, 상한 근처에선 더디게.** 총 성장은 비슷하되 "100 을 금방 찍는" 일은 없다.
const CARD_GROWTH_SCALE = 0.75;
// 성장 스케일을 받는 값형질(연속·많을수록 강함). 상한이 전부 100 이라 TRAIT_CEILING 으로는 못 가려 명시한다.
// v7: herding 이 능력 형질로 강등돼 빠졌다(능력형은 스케일을 안 받는다 — 문턱을 넘겨야 켜지므로 값을
// 깎으면 관문 카드가 관문 구실을 못 한다).
// ⚠ **size(몸집)도 여기 넣으면 안 된다.** 넣었더니 「커다란 몸」(+24)이 실제로는 +14 만 들어가 몸집
// 50 → 64, 스프라이트가 겨우 11% 커졌다 — **눈으로 구분이 안 됐다**(사용자: "몸집 차이가 나는 애들이
// 없어서 잘 모르겠는데?"). 몸집은 50 을 중심으로 **양방향**인 축이라, 다른 값형질처럼 "천천히 자라는"
// 스케일을 씌우면 한 장으로는 아무것도 안 보인다. 카드 값이 그대로 들어가야 한 장에 체감된다.
const GROWTH_TRAITS = new Set<keyof Traits>(["speed", "vision", "attack", "fertility"]);

/**
 * 카드 희귀도 5단계 (핸드오프 §2). 색·등장 뜸·연출은 UI(`@/ui/rarity`)가 정하고, 여기서는 "얼마나 드물게
 * 뽑히는가"만 정한다 — 배지에 "전설"이라 써 놓고 흔하게 뽑히면 표시가 거짓말이 되므로, 희귀도는 반드시
 * 뽑기 확률과 묶여 있어야 한다.
 */
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/**
 * 뽑기 가중치의 **기준값(레벨 1)**. 카드 한 장이 후보로 뽑힐 상대 확률이다.
 * 레벨이 오르면 `rarityWeightsAtLevel` 이 높은 등급 쪽을 키운다(아래 참고).
 */
export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 100,
  uncommon: 65,
  rare: 38,
  epic: 20,
  legendary: 10,
};

/**
 * 레벨 보정이 최대에 이르는 런 레벨(세대). 한 판은 보통 레벨 5~7에서 끝나므로 그 안에서 체감되게 잡는다.
 * 이 레벨 이상은 전부 최대 보정.
 */
export const RARITY_BOOST_FULL_LEVEL = 7;

/**
 * 최대 보정에서 각 등급의 가중치가 기준값의 몇 배가 되는가. 흔함은 1배(그대로)이고, 높은 등급만 커진다
 * → 흔함의 **몫**이 자연히 줄어든다. "무리가 자라면 더 큰 변화가 찾아온다"를 확률로 표현한 것.
 * 레벨 1 에서는 전부 1배(보정 없음)이고, RARITY_BOOST_FULL_LEVEL 까지 선형으로 커진다.
 */
export const RARITY_BOOST_MAX: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.5,
  rare: 2.4,
  epic: 3.6,
  legendary: 5.5,
};

/**
 * 런 레벨(세대)에 따른 뽑기 가중치. 레벨 1 = `RARITY_WEIGHT` 그대로,
 * `RARITY_BOOST_FULL_LEVEL` 이상 = `RARITY_WEIGHT × RARITY_BOOST_MAX`. 사이는 선형 보간.
 * 결정론: 레벨은 시드와 무관하게 정해지는 값이라 같은 시드 + 같은 진행이면 같은 후보가 나온다.
 */
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
 * 갈래(계통) — 시작 프리셋이 정하는 "직업". 슬레이 더 스파이어/하스스톤처럼 카드가 두 풀로 나뉜다.
 *   · **공통 풀**  — lineage 가 없는 카드. 어느 종이든 뽑는다(속도·시야·번식 같은 기본기 + 능력 관문).
 *   · **전용 풀**  — lineage 가 붙은 카드. **그 갈래로 시작한 종에게만** 나온다(그 종의 정체성 심화).
 *
 * 능력 관문 카드(지느러미·날개·초음파·독 살갗·가시 쏘기)는 일부러 **공통**으로 뒀다 — 걷던 종이 날개를
 * 얻는 진화가 이 게임의 핵심 재미인데, 그걸 갈래로 잠그면 "하늘 개척자로 시작해야만 난다"가 된다.
 * 전용 풀은 "그 갈래만 갈 수 있는 더 깊은 곳"이지 "그 갈래만 할 수 있는 일"이 아니다.
 */
export type Lineage = "omni" | "herd" | "scout" | "hunter" | "ranged" | "sea" | "sky" | "venom";

/** 시작 프리셋 id → 갈래. 프리셋을 고르는 순간 이 런의 갈래가 정해진다. */
export const PRESET_LINEAGE: Record<string, Lineage> = {
  preset_omni: "omni",
  preset_herd: "herd",
  preset_scout: "scout",
  preset_hunter: "hunter",
  preset_ranged: "ranged",
  preset_sea: "sea",
  preset_sky: "sky",
  preset_venom: "venom",
};

/** 갈래 이름(화면 표시) — 드래프트에서 "내 갈래 카드"임을 배지로 보여준다. */
export const LINEAGE_NAME: Record<Lineage, string> = {
  omni: "균형 잡식",
  herd: "다산 초식 무리",
  scout: "느긋한 정찰자",
  hunter: "날쌘 육식 사냥꾼",
  ranged: "원거리 사냥꾼",
  sea: "바다 개척자",
  sky: "하늘 개척자",
  venom: "독 살갗",
};

export interface Card {
  id: string;
  name: string;
  desc: string;
  effects: Partial<Record<keyof Traits, number>>;
  set?: Partial<Record<keyof Traits, number>>;
  /**
   * 이 카드가 속한 갈래. 있으면 **그 갈래로 시작한 종에게만** 후보로 나온다(전용 카드).
   * 없으면 공통 카드 — 누구나 뽑는다.
   */
  lineage?: Lineage;
  /** 시작 프리셋의 내 종 시작 색(프리셋 전용) — 종마다 뚜렷이 달라 외형만으로 구분된다. */
  color?: number;
  /**
   * 전제 조건 — 이 형질이 min 이상인 종에게만 후보로 나온다. **강화 카드 전용**.
   * 예: 「튼튼한 날개」는 이미 나는 종(날개 ≥ flyThreshold)에게만. 없으면 아무 종에게나 나온다.
   * 이게 없으면 못 나는 종이 "튼튼한 날개"를 골라 아무 일도 안 일어나는 손해 카드가 된다.
   */
  requiresTrait?: { key: keyof Traits; min: number };
  /**
   * **의도적으로 버리는 형질** — 값이 **0 이 된다**(얼마였든 상관없이). 관문 카드의 정체성이다.
   * 「초음파」가 눈을 버리듯 — 이건 부수적 대가(effects 의 작은 음수)와 성격이 다르다:
   *
   * - **정점 고정(만렙)을 뚫는다.** 눈이 아무리 좋아도(시야 100) 박쥐가 되기로 했으면 눈은 먼다.
   * - **성장 스케일·감쇠를 안 거친다.** effects 로 `vision: -100` 을 주면 ×0.75 가 걸려 -75 만 빠지는데,
   *   그러면 시야 90 짜리 정찰자는 "눈이 먼다"는 설명과 달리 시야 15 로 **반쯤 보인다** — 카드가 거짓말을
   *   한다. 희생은 얼마를 빼느냐가 아니라 **그 감각을 버리느냐**의 문제라 절대값(0)으로 다뤄야 한다.
   */
  sacrifice?: (keyof Traits)[];
}

/** 이 카드의 전제 조건을 이 종이 갖췄는가(전제가 없으면 항상 true). */
export function cardPrereqMet(card: Card, traits: Traits): boolean {
  if (!card.requiresTrait) return true;
  return traits[card.requiresTrait.key] >= card.requiresTrait.min;
}

/**
 * 이 카드가 지금 종에게 무의미한가(드래프트에서 뺄지) — 가장 크게 올리는 형질(주 효과)이 이미 "쓸모의
 * 상한"에 닿아 더 골라도 이득이 없으면 true. 손해/헛 카드가 드래프트에 반복해 뜨는 걸 막는다.
 *
 * 관문형(문턱만 넘으면 되는 능력)은 **문턱을 넘는 순간** 무의미해진다 — 값이 더 올라도 하는 일이 같다.
 * 날개=비행 문턱, 수영=바다 먹이 문턱(swimThreshold). ⚠ 수영은 예전에 물전용 문턱(90)을 봤는데, 카드로
 * 수영은 89 까지만 오르게 막혀 있어(applyCard) 90 에 영영 못 닿아 필터가 안 걸렸다 — 게다가 수영값은
 * swimThreshold(65) 위에선 크기가 아무 효과도 없다(전부 임계 비교뿐). 그래서 날개와 똑같이 "문턱 넘으면
 * 그만"으로 고친다(물갈퀴·지느러미가 이미 헤엄치는 종에게 또 뜨던 버그).
 * 능력형(초음파·독·원거리)은 상한 100, 연속형은 상한(200). diet·대사는 방향/절충이라 늘 유효(제외 안 함).
 * (전제 미달 강화 카드는 cardPrereqMet 이 걸러 낸다.)
 */
export function cardRedundant(card: Card, t: Traits): boolean {
  // 강화 카드(전제 조건이 붙은 카드)는 그 능력이 **상한에 닿았을 때만** 무의미하다.
  if (card.requiresTrait) {
    const key = card.requiresTrait.key;
    return t[key] >= TRAIT_CEILING[key];
  }
  let primary: keyof Traits | null = null;
  let best = 0;
  for (const key of Object.keys(card.effects) as (keyof Traits)[]) {
    const v = card.effects[key] ?? 0;
    if (v > best) {
      best = v;
      primary = key;
    }
  }
  if (!primary) return false;
  const cur = t[primary];
  if (primary === "wings") return cur >= SIM.flyThreshold; // 관문: 이미 날면 무의미
  if (primary === "swimming") return cur >= SIM.swimThreshold; // 관문: 이미 헤엄치면 무의미(값은 문턱 위서 무효)
  if (primary === "echo" || primary === "venom" || primary === "ranged") return cur >= 100;
  if (GROWTH_TRAITS.has(primary)) return cur >= TRAIT_CEILING[primary]; // 값형질 상한(100)에 닿으면 무의미
  return false;
}

// 런 첫 드래프트 — 시작 프리셋(빌드 방향)을 정한다. 식성(set diet) + 특화 형질 두엇.
// 식성만 고르던 것을 "어떤 종으로 시작할지"로 넓혀 첫 판의 방향을 또렷하게 한다(드래프트로 계속 발전).
// 시작 프리셋 — 정체성 형질을 크게 벌려 "이 종이 뭘 잘하는지"가 수치·외형에서 뚜렷이 드러난다.
// (전엔 대부분 형질이 기본 50이라 프리셋 차이가 밋밋했다 → 강점은 크게·약점은 낮게 벌린다.)
// 단 preset_omni(index 0)는 통과기준 테스트가 쓰는 기준선이라 무난한 균형으로 보존한다.
export const PRESET_CARDS: readonly Card[] = [
  {
    id: "preset_omni",
    name: "균형 잡식",
    desc: "풀도 뜯고 사냥도 한다. 뛰어난 재주는 없지만 발도 눈도 새끼도 모자라지 않아, 어느 환경에서든 무난하게 자리 잡는다.",
    // 예전엔 식성만 정하고 나머지를 전부 기본값(50)으로 뒀다 — 그래서 **기본 프리셋이 가장 약했다**
    // (프로브: 대륙 도달 1.3/6. 사냥꾼은 5.9). "무난함"은 아무것도 안 올린다는 뜻이 아니라 두루
    // 모자람이 없다는 뜻이다. 특기가 없는 대신 약점도 없게 고루 올린다.
    set: { diet: 50, speed: 66, vision: 66, attack: 64, fertility: 62, herding: 58 },
    effects: {},
    color: 0x6cc24a, // 초록
  },
  {
    id: "preset_herd",
    name: "다산 초식 무리",
    desc: "풀을 뜯는다. 무리로 뭉쳐 다니며 빠르게 새끼를 쳐, 하나가 스러져도 수로 메운다. 대신 힘은 약하다.",
    // 여덟 프리셋 중 꼴찌였고(도달 1.0/6) **수치로는 안 고쳐졌다** — 걸음·번식·대사·공격력·무리 성향을
    // 차례로 올려 봐도 전부 1.0~1.3 에서 안 움직였다. 원인은 수치가 아니라 메커니즘의 부재였다: 사냥
    // 수입도(식성 16 < 문턱 35) 독도 도망칠 속도도 없는, 아무 방어 수단이 없는 유일한 프리셋이었다.
    // 이제 **무리 방어**(SIM.herdShield*)가 그 자리를 메운다 — 뭉쳐 있으면 포식자가 아예 안 건드린다.
    // ⚠ herding 92 는 방패 임계(herdShieldThreshold 85)를 **넘기려고** 잡은 값이다. 이 아래로 내리면
    // 방패가 통째로 꺼져 프리셋이 다시 꼴찌로 돌아간다(둘은 한 쌍이다 — 한쪽만 바꾸지 말 것).
    set: { diet: 16, fertility: 88, herding: 92, speed: 62, vision: 62, attack: 44, metabolism: 32 },
    effects: {},
    color: 0xb4e04a, // 라임(밝은 연두)
  },
  {
    id: "preset_hunter",
    name: "날쌘 육식 사냥꾼",
    desc: "사냥으로 산다. 빠르고 사나워 먹잇감을 좀처럼 놓치지 않는다. 대신 새끼는 더디게 친다.",
    // 네 세계 모두에서 1~2위였다(도달 4.6~5.9). 사냥은 먹잇감이 야생 100마리라 사실상 무한한데,
    // 채집은 먹이가 유한하고 경쟁자가 넷이다 — 그 구조 위에서 속도 80·공격 74 는 과했다. 온건히 깎는다.
    set: { diet: 68, speed: 68, attack: 64, fertility: 36 },
    effects: {},
    color: 0xff7a3a, // 주황
  },
  {
    id: "preset_scout",
    name: "느긋한 정찰자",
    desc: "풀과 사냥을 겸한다. 멀리 내다보고 기운을 아껴 척박한 땅에서도 오래 버틴다. 대신 힘이 약하고 새끼는 드물다.",
    // 시야 82(최고)인데도 도달 1.1 — 걸음 42 라 멀리 본 먹이에 닿기 전에 남이 먼저 먹었다.
    set: { diet: 40, vision: 84, metabolism: 30, speed: 62, attack: 56, fertility: 48 },
    effects: {},
    color: 0x3fc9c0, // 청록
  },
  {
    id: "preset_sea",
    name: "바다 개척자",
    desc: "능숙하게 헤엄쳐 바다의 먹이를 취하고 뭍도 오간다. 바다에는 다투는 경쟁자가 드물다.",
    // 수영 88 = 수륙양용(뭍 O). 90(aquaticOnlyThreshold) 이상이면 물 전용이 돼 땅에 소환되면 못 움직이고
    // 죽는다(버그). 설명대로 "뭍도 오가는" 종이라 90 미만으로 둔다.
    set: { diet: 40, swimming: 88, speed: 62 },
    effects: {},
    color: 0x5aa0f0, // 하늘 파랑
  },
  {
    id: "preset_sky",
    name: "하늘 개척자",
    desc: "산과 바다 위를 날아 넘어 산 위의 먹이에 닿는다. 바다의 먹이는 헤엄치는 종만 먹는다. 높이 날아 멀리 보지만, 쉼 없는 날갯짓에 배가 빨리 곯는다.",
    set: { diet: 40, wings: 80, vision: 70, metabolism: 66 },
    effects: {},
    color: 0xf0c840, // 황금빛(하늘·맹금) — 기존 프리셋 색과 구분
  },
  {
    id: "preset_venom",
    name: "독 살갗",
    desc: "살갗에 독을 품어, 삼킨 포식자를 중독시킨다. 무리로 뭉쳐 다니는, 좀처럼 잡아먹히지 않는 초식 종.",
    // 독으로 안 잡아먹히기는 하는데, 스스로 먹고 사는 힘(발·눈)이 없어 굶었다(도달 1.8).
    set: { diet: 26, venom: 84, herding: 68, fertility: 70, speed: 60, vision: 60, metabolism: 40 },
    effects: {},
    color: 0x9c27b0, // 독 보라 — 기존 프리셋 색과 구분
  },
  {
    id: "preset_ranged",
    name: "원거리 사냥꾼",
    desc: "다가서지 않고 멀리서 가시를 쏜다. 넓은 시야로, 상대가 반격하거나 달아나기 전에 먼저 맞힌다.",
    // 사거리 82 인데 걸음 46 이라 먹잇감을 사거리 안에 넣기도 전에 굶었다(도달 1.5).
    set: { diet: 60, ranged: 82, vision: 74, speed: 62, attack: 62 },
    effects: {},
    color: 0x4aa0a0, // 청록빛 — 기존 프리셋 색과 구분
  },
];

export const CARD_POOL: readonly Card[] = [
  // 단일 형질
  { id: "swift", name: "날쌘 다리", desc: "더 빠르게 내닫는다.", effects: { speed: 15 } },
  { id: "keen", name: "넓은 시야", desc: "먹이를 더 멀리서 알아본다.", effects: { vision: 15 } },
  {
    id: "thrifty",
    name: "느린 대사",
    desc: "기운을 적게 쓴다. 따뜻한 땅과 폭염, 대가뭄에서 오래 버틴다.",
    effects: { metabolism: -14 },
  },
  {
    id: "hotblood",
    name: "뜨거운 피",
    desc: "추위를 잘 견딘다. 대신 기운을 더 쓴다. 추운 땅과 한파에서 강하다.",
    effects: { metabolism: 14 },
  },
  { id: "fertile", name: "다산", desc: "더 자주 새끼를 친다.", effects: { fertility: 16 } },
  // 무리 — **관문 카드**다. 한 장으로 무리 방어 문턱(SIM.herdShieldThreshold)을 넘긴다.
  // 「날개」와 같은 원칙: 관문 카드는 그 능력을 **실제로 열어야 한다**. 예전엔 +18 이라 여러 장을 모아야
  // 겨우 켜졌는데 설명은 "무리로 뭉친다"였다 — 거짓말이었다(날개가 +42 로 아무 일도 안 하던 것과 같은 함정).
  {
    id: "herd",
    name: "무리 본능",
    desc: "빽빽이 뭉쳐 다닌다. 무리 한가운데 있으면 포식자가 아예 덤비지 못한다(가장자리와 낙오자만 노린다). 대신 뭉쳐 다니느라 먹이를 늦게 찾는다.",
    effects: { herding: SIM.herdShieldThreshold + 3 },
  },
  {
    id: "pack_hunt",
    name: "무리 사냥",
    desc: "이미 뭉쳐 다니는 무리가 함께 사냥한다. 결속과 걸음이 함께 는다.",
    effects: { herding: 12, speed: 8 },
    requiresTrait: { key: "herding", min: 1 }, // 무리 짓는 종에게만 — 안 뭉치는 종엔 +12 가 아무 일도 안 한다
  },
  {
    id: "warm_pack",
    name: "옹기종기",
    desc: "무리의 온기가 짙어지고 추위에 강해진다.",
    effects: { herding: 14, metabolism: 6 },
    requiresTrait: { key: "herding", min: 1 },
  },

  // 조합 (작은 상승 두 개)
  {
    id: "eagle_eye",
    name: "매의 눈",
    desc: "멀리 보며 조금 빨라진다.",
    effects: { vision: 20, speed: 5 },
  },

  // 몸집 — v7. 대가를 카드에 적을 필요가 없다: 큰 몸은 **시뮬이 알아서** 느려지고 많이 먹고 새끼를
  // 적게 친다(sizeSpeedFactor·sizeDrainFactor·sizeFertilityFactor). 형질 하나가 트레이드오프를 통째로 안는다.
  {
    id: "bulk",
    name: "커다란 몸",
    desc: "몸이 커진다. 큰 짐승은 좀처럼 잡아먹히지 않는다. 대신 걸음이 무겁고, 큰 몸을 건사하느라 많이 먹으며, 새끼를 적게 친다.",
    effects: { size: 24 },
  },
  {
    id: "small_swift",
    name: "작고 날쌘 몸",
    desc: "몸이 작아진다. 재빠르고 적게 먹으며 새끼를 자주 치지만, 그만큼 쉽게 잡아먹힌다.",
    effects: { size: -22, speed: 8 },
  },
  // 몸집 조합 — v7 축을 받쳐 주는 카드가 없었다(bulk·small_swift·giant·titan 넷뿐). 몸집을 다른
  // 형질과 엮어 "큰데 추위에 강한 곰" "작고 많이 낳는 설치류" "키 커서 멀리 보는 기린" 같은 결을 만든다.
  {
    id: "stout",
    name: "곰의 체구",
    desc: "몸이 크고 추위에 강해진다. 큰 덩치는 좀처럼 잡아먹히지 않고, 두꺼운 몸이 추위를 견딘다. 대신 큰 몸을 건사하느라 많이 먹는다.",
    effects: { size: 16, metabolism: 10 },
  },
  {
    id: "runt",
    name: "작고 많은 것들",
    desc: "몸이 작아지고 새끼가 는다. 적게 먹으며 부지런히 새끼를 치지만, 작은 몸은 쉽게 잡아먹힌다.",
    effects: { size: -16, fertility: 12 },
  },
  {
    id: "looming",
    name: "우뚝한 몸집",
    desc: "키가 커져 멀리 내다본다. 높은 데서 먹이와 위협을 먼저 알아채고, 큰 덩치로 덜 잡아먹힌다.",
    effects: { size: 14, vision: 8 },
  },

  // 트레이드오프 (큰 상승 + 작은 대가)
  {
    id: "sprint",
    name: "질주 본능",
    desc: "훨씬 빠르게 내닫지만 기운을 더 쓴다.",
    effects: { speed: 22, metabolism: 7 },
  },
  {
    id: "hunter_eye",
    name: "사냥꾼의 눈",
    desc: "시야가 크게 트이지만 새끼는 덜 친다.",
    effects: { vision: 24, fertility: -6 },
  },
  {
    id: "brood",
    name: "둥지 본능",
    desc: "새끼를 많이 치지만 걸음이 느려진다.",
    effects: { fertility: 22, speed: -7 },
  },
  {
    id: "loner",
    name: "외톨이",
    desc: "무리를 떠나 홀로 내닫는다. 무리 성향을 크게 잃는 대신 발이 몹시 빨라진다.",
    effects: { speed: 20, herding: -18 },
  },
  {
    // ⚠ v6 까지 이 카드는 **몸집이 안 커졌다**(대사·걸음만 바뀜) — 이름이 거짓말이었다(사용자 지적:
    // "'느긋한 거인'은 크기 형질도 없는데 왜 거인이야?"). v7 에 몸집 축이 생겼으니 실제로 커진다.
    // 「커다란 몸」과의 차이: 이쪽은 **크면서도 기운을 아끼는** 몸이다(코끼리·거북). 큰 몸은 원래
    // 많이 먹는데(sizeDrainFactor) 저대사가 그걸 상쇄해, 느리지만 오래 버티는 종이 된다.
    id: "giant",
    name: "느긋한 거인",
    desc: "몸이 커지는데도 기운은 거의 쓰지 않는다. 크고 느긋해 좀처럼 잡아먹히지 않지만, 걸음이 굼뜨다.",
    effects: { size: 20, metabolism: -16, speed: -8 },
  },
  {
    id: "furnace",
    name: "왕성한 대사",
    desc: "추위에 몹시 강하고 새끼도 늘지만 기운을 많이 쓴다.",
    effects: { metabolism: 20, fertility: 5 },
  },

  // 공격성·식성 (다종 생태계)
  {
    id: "fangs",
    name: "송곳니",
    desc: "공격력이 는다. 사냥에 능하고, 더 센 포식자에게 덜 쫓긴다.",
    effects: { attack: 18 },
  },
  {
    id: "savage",
    name: "사나운 이빨",
    desc: "공격력이 크게 늘고 조금 빨라지지만, 사냥에 몰두해 새끼는 덜 친다.",
    effects: { attack: 24, speed: 5, fertility: -6 },
  },
  {
    id: "predator",
    name: "포식 본능",
    desc: "육식으로 기운다. 다른 종을 사냥해 먹는다.",
    effects: { diet: 22, attack: 6 },
  },
  {
    id: "grazer",
    name: "초식 본능",
    desc: "초식으로 기운다. 풀을 뜯으며 다툼을 피한다.",
    effects: { diet: -22, fertility: 5 },
  },

  // 특화 진화 — 큰 변화 + 뚜렷한 대가. 빌드 정체성을 만든다(드래프트가 매번 다르게).
  {
    id: "cheetah",
    name: "치타의 다리",
    desc: "쏜살같이 내닫지만 새끼는 덜 친다.",
    effects: { speed: 28, fertility: -10 },
  },
  {
    id: "great_fangs",
    name: "거대 송곳니",
    desc: "공격력이 크게 늘지만 걸음이 굼떠진다.",
    effects: { attack: 26, speed: -8 },
  },
  {
    id: "ambush",
    name: "매복 사냥꾼",
    desc: "멀찍이서 노리다 덮친다. 시야와 공격력이 함께 는다.",
    effects: { vision: 14, attack: 14 },
  },
  {
    id: "locust",
    name: "메뚜기 떼",
    desc: "떼로 불어난다. 대신 한 마리는 약하다.",
    effects: { fertility: 28, attack: -6 },
  },
  {
    id: "thick_fur",
    name: "두꺼운 털가죽",
    desc: "추위에 몹시 강하고 함께 모인다.",
    effects: { metabolism: 16, herding: 12 },
  },
  {
    id: "all_rounder",
    name: "균형 진화",
    desc: "걸음과 시야, 번식이 고루 조금씩 는다.",
    effects: { speed: 8, vision: 8, fertility: 8 },
  },
  {
    id: "ascetic",
    name: "고행자",
    desc: "기운을 거의 쓰지 않고 멀리 본다. 대신 걸음이 느리다.",
    effects: { metabolism: -20, vision: 10, speed: -6 },
  },
  {
    id: "phalanx",
    name: "철벽 대형",
    desc: "함께 뭉쳐 맞선다. 무리 성향과 공격력이 크게 늘지만, 싸움에 힘써 새끼는 덜 친다.",
    effects: { herding: 22, attack: 12, fertility: -6 },
  },
  {
    id: "lone_warrior",
    name: "독불장군",
    desc: "홀로 사납게 싸운다. 공격력이 크게 늘지만 무리에서 떨어져 나온다.",
    effects: { attack: 22, speed: 6, herding: -16 },
  },

  // 추가 조합·정체성. 빈 형질 조합을 메워 드래프트 변주를 넓힌다(기존 형질만).
  {
    id: "scout_pack",
    name: "파수 무리",
    desc: "함께 다니며 멀리까지 살핀다. 시야와 무리 성향이 는다.",
    effects: { vision: 14, herding: 12 },
  },
  {
    id: "owl_eye",
    name: "올빼미 눈",
    desc: "멀리 보면서도 기운을 아낀다. 시야가 늘고 대사가 준다.",
    effects: { vision: 16, metabolism: -8 },
  },
  {
    id: "nest_herd",
    name: "둥지 무리",
    desc: "무리 속에서 안전하게 새끼를 친다. 번식과 무리 성향이 늘지만, 둥지를 지키느라 걸음이 느려진다.",
    effects: { fertility: 16, herding: 10, speed: -6 },
  },
  {
    id: "farsight",
    name: "천리안",
    desc: "아주 멀리까지 내다본다. 대신 걸음이 조금 느려진다.",
    effects: { vision: 26, speed: -6 },
  },
  {
    id: "evasive",
    name: "민첩한 회피",
    desc: "재빠르게 움직이며 위험을 멀리서 알아챈다. 걸음과 시야가 함께 는다.",
    effects: { speed: 12, vision: 12 },
  },
  {
    id: "beast_metab",
    name: "맹수의 대사",
    desc: "사냥을 위해 힘이 세지만 기운을 많이 쓴다.",
    effects: { attack: 16, metabolism: 8 },
  },
  {
    id: "glass_cannon",
    name: "유리 대포",
    desc: "공격력은 무섭지만 몸이 약해 새끼는 덜 친다.",
    effects: { attack: 28, fertility: -10 },
  },
  {
    id: "swift_breeder",
    name: "잰걸음 번식",
    desc: "재빠르게 불어난다. 걸음과 번식이 함께 조금 는다.",
    effects: { speed: 8, fertility: 10 },
  },
  {
    id: "stoic",
    name: "굳건한 체질",
    desc: "기운을 아끼며 함께 버틴다. 느린 대사와 무리의 온기.",
    effects: { metabolism: -12, herding: 10 },
  },
  {
    id: "apex_scout",
    name: "정점의 사냥꾼",
    desc: "넓은 시야로 먹이를 찾아 사납게 사냥한다. 대신 걸음이 굼떠진다.",
    effects: { vision: 16, attack: 16, speed: -7 },
  },

  // 은신 — v7. 시야의 대칭축: 포식자가 나를 늦게 발견한다. **초음파는 못 속인다**(눈을 속이는 것이지
  // 소리를 지우는 게 아니다). 그리고 큰 몸은 잘 못 숨는다 — 몸집과 은신은 한 축의 양끝이다.
  {
    id: "camo",
    name: "보호색",
    desc: "몸빛이 둘레를 닮아 간다. 포식자가 코앞에 와서야 알아챈다. 다만 소리로 찾는 짐승(초음파)은 속지 않고, 몸이 크면 숨을 수 없다.",
    effects: { camouflage: 46 },
  },
  {
    id: "shadow_hide",
    name: "그림자 무늬",
    desc: "숨는 재주가 깊어진다. 몸을 낮추고 그늘에 녹아든다.",
    effects: { camouflage: 28, size: -8 },
    requiresTrait: { key: "camouflage", min: 1 }, // 이미 숨을 줄 아는 종에게만
  },
  // 은신 강화 두 갈래 — 숨는 종의 방향을 가른다. 「살금살금」은 숨어서 다가가는 발, 「숨은 이빨」은
  // 매복해 덮치는 이빨. 둘 다 이미 숨을 줄 아는 종(camo 관문을 뽑은 종)에게만 나온다(requiresTrait).
  // 은신 종은 시야도 그대로라 시야 카드가 안 죽는다 — 초음파와 달리 자기 계열이 넉넉하다.
  {
    id: "camo_creep",
    name: "살금살금",
    desc: "둘레에 녹아든 채 소리 없이 다가간다. 상대가 알아채기 전에 코앞에 선다. 이미 숨을 줄 아는 종만 얻는다.",
    effects: { camouflage: 24, speed: 8 },
    requiresTrait: { key: "camouflage", min: 1 },
  },
  {
    id: "camo_fang",
    name: "숨은 이빨",
    desc: "숨어 기다리다 덮친다. 보이지 않는 곳에서 급소를 문다. 이미 숨을 줄 아는 종만 얻는다.",
    effects: { camouflage: 20, attack: 16 },
    requiresTrait: { key: "camouflage", min: 1 },
  },

  // 바다 적응 — 수영을 키우면 바다 먹이를 먹는다(육상 종은 못 먹는 무경쟁 틈새).
  {
    id: "fins",
    name: "지느러미",
    desc: "헤엄쳐 바다의 먹이를 취한다. 바다에는 다투는 경쟁자가 없다.",
    effects: { swimming: 22 },
  },
  {
    id: "webbed",
    name: "물갈퀴 발",
    desc: "물에서 잘 움직인다. 수영과 걸음이 함께 조금 는다.",
    effects: { swimming: 16, speed: 6 },
  },

  // 날개 비행 — 산·물을 날아 넘고 산 위 고산 먹이를 먹는다(지상 종은 못 넘는 무경쟁 틈새).
  // 「날개」는 **한 장으로 비행 문턱(SIM.flyThreshold)을 넘긴다** — 관문 카드는 그 능력을 실제로 열어야 한다.
  // (예전엔 +42 라 혼자서는 아무 일도 안 일어났는데 설명은 "날아 넘는다"였다 — 거짓말이었다.)
  // 「튼튼한 날개」는 이미 나는 종에게만 나오는 강화다(requiresTrait). 날개를 100 까지 채워 비행 대사를 덜어낸다.
  {
    id: "wings",
    name: "날개",
    desc: "날개가 돋는다. 산과 바다 위를 날아 넘고 산 위의 먹이를 먹는다. 바다의 먹이는 헤엄치는 종의 몫이다. 대신 쉼 없는 날갯짓에 배가 빨리 곯는다.",
    effects: { wings: SIM.flyThreshold + 3 },
  },
  {
    id: "strong_wings",
    name: "튼튼한 날개",
    desc: "날개가 크고 튼튼해진다. 같은 거리를 날아도 덜 지치고, 걸음도 조금 는다. 이미 나는 종만 얻을 수 있다.",
    effects: { wings: 32, speed: 6 },
    requiresTrait: { key: "wings", min: SIM.flyThreshold },
  },

  // 초음파 감각 — **눈을 통째로 버리고** 귀를 얻는다.
  // ⚠ 예전엔 vision -24 만 깎아서, 초음파를 켜도 눈이 그대로 남았다. 그런데 초음파는 전방위 + 어둠·수풀
  // 무시라 시야보다 **순수하게 우월**하다 — 둘 다 가지면 시야 형질이 무의미해진다(사용자 지적:
  // "초음파가 있으면 시야가 아예 필요 없는 거 아닌가?"). 그래서 관문 카드가 눈을 **0 으로** 만든다.
  // 이제 진짜 트레이드오프다: 박쥐는 눈이 퇴화했다. 대신 어둠·수풀·등 뒤가 전부 무의미해진다.
  // 대가는 분명하다 — 시야를 카운터로 쓰는 위협(그림자 매복자·큰수리)에 맨몸이 된다.
  //
  // ⚠ `effects: { vision: -100 }` 이 아니라 **`sacrifice: ["vision"]`** 인 이유(2026-07-15):
  // effects 의 음수는 성장 스케일(×0.75)을 거쳐 실제론 -75 만 빠졌다 → 시야 90 짜리 정찰자가 이 카드를
  // 뽑아도 **시야 15 로 반쯤 보였다**("눈이 멀고"가 거짓말). 게다가 정점 고정이 들어오면서, 시야 100 을
  // 찍은 종에겐 -75 가 **아예 막혀** 초음파가 눈을 못 지우게 된다. 희생은 "얼마를 빼느냐"가 아니라
  // "그 감각을 버리느냐"라서 절대값(0)으로 다뤄야 옳다 — 그게 sacrifice 다.
  {
    id: "echo",
    name: "초음파",
    desc: "눈이 멀고 귀가 열린다. 앞을 보는 대신 사방을 듣는다. 어둠도 수풀도 등 뒤도 막지 못하지만, 눈으로 미리 알아채야 하는 위협 앞에서는 무력하다.",
    effects: { echo: 70 },
    sacrifice: ["vision"], // 눈을 버린다 — 시야가 100(정점)이어도 0 이 된다
  },
  {
    id: "bat_ear",
    name: "박쥐의 귀",
    desc: "귀가 극에 달한다. 사방을 아주 멀리까지 훤히 듣는다. 이미 초음파로 사는 종만 얻을 수 있다.",
    effects: { echo: 30 },
    requiresTrait: { key: "echo", min: 1 }, // 이미 귀로 사는 종의 강화(관문이 아니다)
  },
  // 초음파 강화 두 갈래 — 눈이 먼 종이 뽑을 자기 계열 카드다. 초음파를 켜면 시야가 0 이 돼 시야 조합
  // 카드가 통째로 죽는데(known_issues "초음파 시야 낚시"), 그 자리를 이 카드들이 메운다. 「메아리 걸음」은
  // 소리로 길을 읽는 발, 「음파 사냥」은 반향으로 급소를 그리는 이빨. 둘 다 시야를 안 건드린다(귀로 산다).
  {
    id: "echo_step",
    name: "메아리 걸음",
    desc: "소리로 앞을 읽어 거침없이 내닫는다. 어둠 속에서도 부딪히지 않는다. 이미 초음파로 사는 종만 얻는다.",
    effects: { echo: 22, speed: 10 },
    requiresTrait: { key: "echo", min: 1 },
  },
  {
    id: "echo_maw",
    name: "음파 사냥",
    desc: "반향으로 먹잇감의 급소를 그려내 문다. 눈으로 사냥하지 않는 종의 방식이다. 이미 초음파로 사는 종만 얻는다.",
    effects: { echo: 20, attack: 16 },
    requiresTrait: { key: "echo", min: 1 },
  },

  // 전투 형질 (P5) — 독침(방어 독: 잡아먹으면 포식자 중독)·원거리(사거리). 기본 0 이라 큰 값(카드로 켜야 바뀐다).
  {
    id: "venom_fang",
    name: "독 살갗",
    desc: "살갗에 독이 돌아, 삼킨 포식자를 중독시킨다. 함부로 잡아먹기 꺼려지는 먹이가 된다.",
    effects: { venom: 42 },
  },
  {
    id: "venom_gland",
    name: "독샘",
    desc: "독이 훨씬 짙어진다. 삼킨 포식자는 치명적으로 중독되지만, 독을 벼리느라 몸이 약해 새끼는 덜 친다.",
    effects: { venom: 48, fertility: -6 },
  },
  {
    id: "long_horn",
    name: "가시 쏘기",
    desc: "날카로운 가시를 멀리 쏜다. 다가서지 않고 먼발치에서 맞혀, 먹잇감이 달아나거나 반격하기 전에 쓰러뜨린다.",
    effects: { ranged: 42 },
  },
  {
    id: "spit",
    name: "독 가시",
    desc: "가시를 멀리 쏘고, 살갗의 독으로 삼키려는 포식자도 막는다. 사거리와 방어 독이 함께 는다.",
    effects: { ranged: 26, venom: 22 },
  },

  // 도전 과제로만 열리는 특별 형질. 레벨로는 절대 안 열린다(achievements.ts 가 문지기).
  // v7: 예전엔 몸집 축이 없어서 **외형만 키우는 별도 배율**(CARD_BODY_SCALE 1.42)로 흉내 냈다.
  // 이제 진짜 몸집 형질이 있으니 그것으로 통합한다 — 외형·시뮬이 한 값에서 나온다(중복 제거).
  // 대가도 몸집이 알아서 준다(느림·대식·저번식) → 카드에 적던 speed/fertility 페널티를 덜어냈다.
  // herding +10 도 뺐다: v7 에서 무리 성향은 능력 형질이라 10 으로는 아무 일도 안 일어난다(문턱 85).
  {
    id: "titan",
    name: "거인",
    desc: "몸이 통째로 커진다. 어지간한 이빨은 박히지도 않는다. 다만 걸음이 굼뜨고, 큰 몸을 건사하느라 많이 먹으며 새끼는 드물게 친다.",
    effects: { size: 42, attack: 24, speed: -8, metabolism: 4 },
  },

  // ────────────────────────── 갈래 전용 카드 (lineage) ──────────────────────────
  // 시작 프리셋이 정한 갈래로만 나온다. 드래프트 3장 중 1장은 늘 여기서 뽑히므로(drawCards),
  // "내 종만의 길"이 매 판 또렷하게 이어진다. 공통 카드보다 값이 커도 되는 이유는 갈래를 고른
  // 대가(다른 갈래의 전용 카드를 영영 못 본다)를 이미 치렀기 때문이다.

  // ── 균형 잡식: 치우치지 않아 무엇에든 견딘다. 기본기가 고르게 오른다(가장 약한 프리셋이라 넉넉히).
  { id: "omni_gut", name: "무엇이든 먹는다", desc: "가리지 않고 먹어 새끼를 더 치고, 먹이도 더 잘 찾는다.", effects: { fertility: 16, vision: 12 }, lineage: "omni" },
  { id: "omni_hardy", name: "끈질긴 혈통", desc: "어떤 땅에서도 버틴다. 새끼가 늘고 몸도 단단해지지만, 몸이 무거워 걸음이 느려진다.", effects: { fertility: 20, attack: 12, metabolism: 6, speed: -8 }, lineage: "omni" },
  { id: "omni_anywhere", name: "어디서나 산다", desc: "기본기가 두루 오른다. 뛰어난 것은 없지만 모자란 것도 없다. 다만 싸움에는 약해진다.", effects: { speed: 14, vision: 14, herding: 12, fertility: 10, attack: -10 }, lineage: "omni" },
  { id: "omni_apex", name: "만능의 정점", desc: "무엇 하나 빠지지 않는 종이 된다. 힘도 눈도 발도 오르지만, 큰 몸을 건사하느라 새끼는 드물게 친다.", effects: { speed: 16, vision: 18, attack: 16, herding: 12, fertility: -12, metabolism: 8 }, lineage: "omni" },

  // ── 다산 초식 무리: 수로 밀어붙인다. 번식·무리가 정체성.
  { id: "herd_boom", name: "폭발적 번식", desc: "새끼를 쉴 새 없이 친다. 그만큼 기운을 많이 쓴다.", effects: { fertility: 26, metabolism: 8, attack: -6 }, lineage: "herd" },
  { id: "herd_wall", name: "촘촘한 대열", desc: "빈틈없이 붙어 다녀 외톨이가 생기지 않는다. 대신 굼뜨다.", effects: { herding: 22, vision: 8, speed: -5 }, lineage: "herd" },
  { id: "herd_nursery", name: "젖먹이 무리", desc: "무리가 새끼를 함께 돌본다. 수가 불어나며 결속도 단단해진다.", effects: { fertility: 18, herding: 18, speed: -6 }, lineage: "herd" },
  { id: "herd_swarm", name: "밀물 같은 무리", desc: "솎여도 메우고 또 메운다. 수가 곧 방패다.", effects: { fertility: 24, herding: 16, vision: 8, attack: -8 }, lineage: "herd" },

  // ── 느긋한 정찰자: 멀리 보고 아껴 쓴다. 시야·저대사가 정체성.
  { id: "scout_far", name: "멀리 보는 눈", desc: "누구보다 멀리 본다. 위협도 먹이도 먼저 알아채지만, 멀리 살피느라 무리에서 떨어져 다닌다.", effects: { vision: 26, metabolism: -6, herding: -10 }, lineage: "scout" },
  { id: "scout_thrift", name: "아끼는 몸", desc: "기운을 거의 쓰지 않아 굶주림에 오래 버틴다.", effects: { metabolism: -18, fertility: 8 }, lineage: "scout" },
  { id: "scout_watch", name: "지평선의 감시자", desc: "무리 전체가 사방을 살핀다. 아무도 몰래 다가오지 못하지만, 살피느라 걸음이 더뎌진다.", effects: { vision: 22, herding: 14, speed: -8 }, lineage: "scout" },
  { id: "scout_sage", name: "오래 사는 현자", desc: "느리게 살아 오래 버틴다. 눈은 더없이 밝아진다.", effects: { vision: 26, metabolism: -14, fertility: 10, speed: -6 }, lineage: "scout" },

  // ── 날쌘 육식 사냥꾼: 잡아야 산다. 속도·공격이 정체성.
  { id: "hunter_throat", name: "목을 무는 법", desc: "급소를 문다. 한 번의 사냥이 훨씬 잘 먹힌다.", effects: { attack: 22, speed: 8, fertility: -6 }, lineage: "hunter" },
  { id: "hunter_relent", name: "지치지 않는 추격", desc: "끝까지 쫓는다. 대신 늘 배가 고프다.", effects: { speed: 18, metabolism: 10 }, lineage: "hunter" },
  { id: "hunter_lone", name: "단독 사냥꾼", desc: "혼자 사냥한다. 무리를 버린 대신 발과 이빨을 얻는다.", effects: { attack: 18, speed: 14, herding: -16 }, lineage: "hunter" },
  { id: "hunter_apex", name: "정점의 포식자", desc: "이 땅에서 가장 무서운 것이 된다. 쫓기던 것들이 이제 쫓긴다.", effects: { attack: 26, speed: 16, vision: 12, fertility: -10 }, lineage: "hunter" },

  // ── 원거리 사냥꾼: 다가서지 않고 친다. 사거리·시야가 정체성.
  { id: "ranged_reach", name: "더 멀리 쏘기", desc: "더 먼 곳까지 닿는다. 다가설 필요가 없다.", effects: { ranged: 18, vision: 10 }, lineage: "ranged" },
  { id: "ranged_aim", name: "조준하는 눈", desc: "겨눈 것을 놓치지 않는다. 멀리 보고 정확히 친다.", effects: { vision: 20, ranged: 12, speed: -4 }, lineage: "ranged" },
  { id: "ranged_volley", name: "연달아 쏘기", desc: "쉼 없이 쏘아댄다. 가까이 붙기 전에 쓰러뜨린다.", effects: { ranged: 22, attack: 10, herding: -6 }, lineage: "ranged" },
  { id: "ranged_sniper", name: "보이지 않는 사수", desc: "상대가 알아채기도 전에 끝낸다. 사거리와 눈이 함께 극에 달한다.", effects: { ranged: 24, vision: 22, attack: 8, fertility: -8 }, lineage: "ranged" },

  // ── 바다 개척자: 물이 삶터다. 헤엄과 바다 사냥이 정체성(수영값은 문턱 위에선 안 오르므로 다른 형질로).
  { id: "sea_current", name: "해류를 타다", desc: "물살을 읽어 힘 안 들이고 나아간다.", effects: { speed: 18, metabolism: -8 }, lineage: "sea" },
  { id: "sea_hunt", name: "먼바다 사냥", desc: "탁 트인 바다에서 사냥한다. 눈과 이빨이 함께 자란다.", effects: { attack: 16, vision: 14, herding: -6 }, lineage: "sea" },
  { id: "sea_school", name: "물고기 떼처럼", desc: "한 덩어리로 헤엄쳐 포식자를 혼란시킨다. 뭉쳐 도망칠 뿐 맞서 싸우지는 않는다.", effects: { herding: 22, speed: 12, fertility: 10, attack: -12 }, lineage: "sea" },
  { id: "sea_leviathan", name: "바다의 주인", desc: "이 바다에 맞설 것이 없다. 몸도 힘도 바다에 맞게 커진다.", effects: { attack: 22, speed: 16, vision: 14, metabolism: -6, fertility: -8 }, lineage: "sea" },

  // ── 하늘 개척자: 하늘이 삶터다. 날개·시야가 정체성.
  { id: "sky_updraft", name: "상승 기류", desc: "바람을 타 힘 안 들이고 오래 난다.", effects: { wings: 12, metabolism: -10 }, lineage: "sky" },
  { id: "sky_stoop", name: "매의 강하", desc: "하늘에서 내리꽂아 덮친다.", effects: { speed: 16, attack: 14, fertility: -6 }, lineage: "sky" },
  { id: "sky_soar", name: "높이 나는 눈", desc: "더 높이 날아 온 땅을 굽어본다.", effects: { wings: 10, vision: 22 }, lineage: "sky" },
  { id: "sky_lord", name: "하늘의 지배자", desc: "하늘에 맞설 것이 없다. 날개도 눈도 극에 달한다.", effects: { wings: 16, vision: 20, speed: 12, metabolism: -8 }, lineage: "sky" },

  // ── 독 살갗: 삼킨 자가 죽는다. 독이 정체성.
  { id: "venom_thick", name: "짙은 독", desc: "독이 더 독해진다. 무는 자가 먼저 쓰러진다.", effects: { venom: 20 }, lineage: "venom" },
  { id: "venom_armor", name: "독가시 갑옷", desc: "온몸이 독가시다. 건드리는 것마다 중독된다.", effects: { venom: 14, attack: 12, speed: -6 }, lineage: "venom" },
  { id: "venom_bright", name: "경고하는 빛깔", desc: "화려한 빛깔이 \"먹으면 죽는다\"고 알린다. 아무도 다가오지 않는다.", effects: { venom: 16, herding: 12, fertility: 10 }, lineage: "venom" },
  { id: "venom_untouchable", name: "누구도 삼키지 못한다", desc: "이 종을 먹고 살아남은 것은 없다. 독이 극에 달한다.", effects: { venom: 26, attack: 14, herding: 10, speed: -8 }, lineage: "venom" },
];

// (v7: CARD_BODY_SCALE 제거 — "외형만 키우는 별도 배율"은 몸집(size) 형질이 생기기 전의 임시방편이었다.
//  이제 몸집 하나에서 외형과 시뮬이 함께 나온다. 두 축을 따로 두면 언젠가 어긋난다.)

/**
 * 카드 id → 희귀도. 카드 리터럴에 흩어 두지 않고 한곳에 모아, 풀 전체의 분포를 한눈에 보며 튜닝한다.
 * 여기 없는 카드는 흔함으로 떨어진다 — 새 카드를 넣으면 여기에도 반드시 추가할 것(cards.test.ts 가 강제).
 *
 * ## 등급 기준 — "수치 총량"이 아니라 "종을 얼마나 바꾸는가"
 * 숫자가 큰 카드가 곧 높은 등급은 아니다. 능력형(날개·초음파·독·원거리)은 0에서 시작하는 스위치라
 * 값이 42~48 로 크지만, 그건 "켜는 데 필요한 값"이지 강함의 척도가 아니다. 실제로 `치타의 다리`(총량 23)가
 * 전설이고 `고행자`(총량 30)가 귀함이다. 기준은 다음 네 가지를 순서대로 본다:
 *
 *  1. **대가가 있는가.** 없으면 흔함 쪽. 귀함은 전부 뚜렷한 대가를 치른다.
 *  2. **판단을 요구하는가.** 무조건 좋으면 흔함, 무엇을 포기할지 골라야 하면 귀함 이상.
 *  3. **빌드를 기울이는가.** 이 카드 한 장으로 종의 방향(사냥꾼/번식형/무리형)이 정해지면 아주 귀함.
 *  4. **못 하던 걸 하게 되는가.** 새 지형·새 감각·새 전투 수단이 열리면 전설. 그래서 전설은 정확히
 *     **다섯 능력 계열의 관문 카드**다(지느러미=바다, 날개=하늘, 초음파=청각, 독 살갗=반격, 가시 쏘기=원거리).
 *     같은 계열의 두 번째 카드(물갈퀴·튼튼한 날개·박쥐의 귀·독샘·독 가시)는 "강화"라 전설이 아니다.
 *     예외는 「거인」 — 몸 자체가 달라지는 도전 과제 전용 카드다.
 *
 * 이 규칙은 `cards.test.ts` 가 강제한다(전설 = 관문 5장 + titan).
 *
 * ## 알려진 예외 둘
 * - **능력형 카드는 대가가 카드에 안 적혀 있다.** 1번 기준(대가 유무)을 카드 수치로만 보면 `strong_wings`
 *   (날개 +30, 걸음 +6)는 공짜로 보인다. 실제 대가는 sim 이 받는다 — 비행은 대사가 더 들고, 물전용(수영 90+)은
 *   뭍에 못 오른다. 그래서 등급 판정에서 능력형은 1번을 건너뛰고 4번(못 하던 걸 하는가)으로 곧장 간다.
 * - `webbed`(드묾)도 수영 50→66 으로 문턱(65)을 혼자 넘는다. 즉 관문이 둘이다. 카드 설계의 흠이지만
 *   `fins`(+22) 가 대표 관문이고 `webbed` 는 보조(+16, 걸음도 조금)라 등급을 나눴다.
 */
export const CARD_RARITY: Record<string, Rarity> = {
  // ── 흔함 (19장) — 대가가 없다. 무조건 좋으니 고민할 게 없다.
  swift: "common",
  keen: "common",
  thrifty: "common", // 대사 -14 = 기운 아낌(이득)
  hotblood: "common", // 대사 +14 = 추위 강함(이득)
  fertile: "common",
  pack_hunt: "common", // 무리 강화(무리 짓는 종에게만)
  warm_pack: "common", // 무리 강화(무리 짓는 종에게만)
  bulk: "common", // 몸집 +24 — 대가(느림·대식·저번식)는 시뮬이 준다
  fangs: "common",
  all_rounder: "common",
  scout_pack: "common",
  owl_eye: "common",
  evasive: "common",
  beast_metab: "common",
  swift_breeder: "common",
  stoic: "common",
  stout: "common", // 몸집 +16 / 대사 +10 — 대가는 시뮬이 준다(큰 몸=대식). 대사는 절충(추위 강·더위 약)
  runt: "common", // 몸집 -16 / 번식 +12 — 작아지는 건 특성(적게 먹고 자주 낳되 쉽게 잡아먹힘)
  looming: "common", // 몸집 +14 / 시야 +8 — 둘 다 이득 방향(대가는 큰 몸의 대식으로 시뮬이 준다)

  // ── 드묾 (13장) — 작은 대가를 치르거나, 방향을 살짝 틀거나, 능력을 보조한다.
  eagle_eye: "uncommon", // 시야 +20 / 걸음 +5
  small_swift: "uncommon", // 몸집 -22 / 걸음 +8 — 빠르고 많이 낳지만 쉽게 잡아먹힌다
  sprint: "uncommon", // 대사 +7
  giant: "uncommon", // 걸음 -6
  furnace: "uncommon", // 대사 +20(더위에 취약)
  predator: "uncommon", // 식성 전환
  grazer: "uncommon", // 식성 전환
  ambush: "uncommon", // 중간 조합
  thick_fur: "uncommon",
  nest_herd: "uncommon", // 걸음 -6
  webbed: "uncommon", // 수영 보조
  echo_step: "uncommon", // 초음파 강화 + 걸음(귀로 사는 종 전용 — requiresTrait echo)
  camo_creep: "uncommon", // 은신 강화 + 걸음(숨는 종 전용 — requiresTrait camouflage)

  // ── 귀함 (11장) — 크게 얻고 뚜렷이 잃는다. 무엇을 포기할지 고르게 만든다.
  //    (초음파·은신 강화 둘은 카드엔 대가가 안 적혀 있다 — 능력형이라 대가는 sim 이 준다: 눈 먼 종은
  //     시야 카운터에 무력하고, 숨는 종은 큰 몸이면 못 숨는다. 그래서 등급 규칙에서 능력형 예외.)
  hunter_eye: "rare", // 시야 +24 / 번식 -6
  brood: "rare", // 번식 +22 / 걸음 -7
  loner: "rare", // 걸음 +20 / 무리 -18
  savage: "rare", // 공격 +24 / 번식 -6
  ascetic: "rare", // 대사 -20 / 걸음 -6
  farsight: "rare", // 시야 +26 / 걸음 -6
  apex_scout: "rare", // 시야·공격 +16 / 걸음 -7
  locust: "rare", // 번식 +28 / 공격 -6
  great_fangs: "rare", // 공격 +26 / 걸음 -8
  echo_maw: "rare", // 초음파 강화 + 공격(귀로 사냥 — 대가는 sim: 눈이 멀어 시야 카운터에 무력)
  camo_fang: "rare", // 은신 강화 + 공격(매복 포식 — 대가는 sim: 큰 몸은 못 숨는다)

  // ── 아주 귀함 (8장) — 이 한 장으로 종의 방향이 정해진다. 능력형은 그 능력을 극단까지 민다.
  cheetah: "epic", // 극단 속도
  glass_cannon: "epic", // 극단 공격
  lone_warrior: "epic", // 홀로 싸우는 종으로 굳는다
  phalanx: "epic", // 뭉쳐 맞서는 종으로 굳는다
  strong_wings: "epic", // 비행을 완성한다
  bat_ear: "epic", // 눈을 버리고 귀에 온전히 기댄다
  venom_gland: "epic", // 독을 치명적으로
  spit: "epic", // 원거리 + 방어독 동시
  shadow_hide: "epic", // 은신을 완성한다(숨을 줄 아는 종에게만)

  // ── 전설 (7장) — 못 하던 걸 하게 된다. 능력 계열의 **관문** 카드. 한 장으로 그 능력을 실제로 연다
  // (문턱을 못 넘기는 관문 카드는 설명이 거짓말이 된다 — 날개가 +42 라 아무 일도 안 하던 함정).
  fins: "legendary", // 바다: 아무도 안 먹는 먹이터가 열린다
  wings: "legendary", // 하늘: 산·바다를 넘고 고산 먹이에 닿는다
  echo: "legendary", // 초음파: 눈 대신 귀. 어둠·수풀이 무의미해진다
  venom_fang: "legendary", // 방어독: 피식자에서 "삼키면 안 되는 것"으로
  long_horn: "legendary", // 원거리: 근접 사냥에서 벗어난다
  herd: "legendary", // v7 무리: 뭉치면 포식자가 아예 안 덤빈다(무리 방어 문턱을 한 장으로 넘긴다)
  camo: "legendary", // v7 은신: 포식자의 눈에서 사라진다(초음파에는 안 통한다)

  // ── 도전 과제 전용 (등급은 전설) — 몸 자체가 달라진다.
  titan: "legendary",

  // ── 갈래 전용 (32장) — 그 갈래로 시작한 종에게만 나온다. 갈래마다 **드묾 2 · 귀함 1 · 아주 귀함 1**:
  // "기본기 → 정체성 심화 → 그 길의 정점" 순으로 한 판의 성장 곡선이 된다. 이 분포여야 갈래 풀
  // (공통 + 전용)도 피라미드를 지킨다(cards.test 가 갈래별로 검사한다). 전설은 없다 — 전설은
  // "못 하던 걸 하게 되는" 공통 관문의 자리라, 갈래 전용이 그 자리를 뺏으면 안 된다.
  omni_gut: "uncommon",
  omni_hardy: "uncommon",
  omni_anywhere: "rare",
  omni_apex: "epic",
  herd_boom: "rare",
  herd_wall: "uncommon",
  herd_nursery: "uncommon",
  herd_swarm: "epic",
  scout_far: "rare",
  scout_thrift: "uncommon",
  scout_watch: "uncommon",
  scout_sage: "epic",
  hunter_throat: "uncommon",
  hunter_relent: "uncommon",
  hunter_lone: "rare",
  hunter_apex: "epic",
  ranged_reach: "uncommon",
  ranged_aim: "uncommon",
  ranged_volley: "rare",
  ranged_sniper: "epic",
  sea_current: "uncommon",
  sea_hunt: "uncommon",
  sea_school: "rare",
  sea_leviathan: "epic",
  sky_updraft: "uncommon",
  sky_stoop: "uncommon",
  sky_soar: "rare",
  sky_lord: "epic",
  venom_thick: "uncommon",
  venom_armor: "uncommon",
  venom_bright: "rare",
  venom_untouchable: "epic",
};

/** 카드의 희귀도(미등록 카드는 흔함). 표시(배지·색·연출)와 뽑기 가중치가 같은 값을 쓴다. */
export function cardRarity(card: Card): Rarity {
  return CARD_RARITY[card.id] ?? "common";
}

/**
 * 상한 근접 감쇠 — **형질이 높을수록 카드로 올리기 어렵다**(수확 체감).
 *
 * 왜: 형질이 금방 100 을 찍어 성장이 끝나 버렸다(사용자: "또 다시 형질이 100을 너무 금방 찍는데?").
 * 카드 몇 장이면 상한이라 뒤쪽 드래프트가 시시해진다.
 *
 * **50 이하에선 감쇠가 정확히 1(없음)** 이다 — 모든 종이 50 에서 시작하므로 초반 성장·기존 밸런스가
 * 그대로 보존된다. 50 위에서만 남은 여유에 비례해 증가폭이 준다:
 *   현재 50 → ×1.00 · 65 → ×0.84 · 80 → ×0.63 · 90 → ×0.45 · 97 → ×0.24
 * 100 에 점근하되 닿기는 어렵다 — "극단은 값비싸다"가 성장 곡선이 된다.
 * 값을 **내리는**(음수) 효과에는 안 걸린다(내리는 건 원래대로).
 */
const FALLOFF_FROM = 50; // 이 값 이하에선 감쇠 없음
const FALLOFF_POWER = 0.5;

/** 감쇠가 걸리는 값 형질(많을수록 강함). 능력형(문턱을 넘겨야 켜짐)·대사·식성(중립/스펙트럼)은 제외. */
const FALLOFF_TRAITS = new Set<keyof Traits>(["speed", "vision", "attack", "fertility", "size"]);

export function growthFalloff(key: keyof Traits, current: number): number {
  if (!FALLOFF_TRAITS.has(key)) return 1;
  const ceiling = TRAIT_CEILING[key];
  if (current <= FALLOFF_FROM) return 1;
  const room = Math.max(0, (ceiling - current) / (ceiling - FALLOFF_FROM));
  return Math.pow(room, FALLOFF_POWER);
}

/** 카드가 게놈에 실제로 더하는 값(표시용) — 카드에 적힌 값과 실제 적용값이 다르다(전엔 원값 +15 를
 * 보여줬으나 실제론 +9 만 붙었다 — 폰 피드백).
 * `current`(그 형질의 현재 값)를 주면 **상한 근접 감쇠까지 반영**한 진짜 값이 나온다. 드래프트는 내 종
 * 게놈을 아니 반드시 넘긴다 — 안 넘기면 "+12" 라 써 놓고 +5 만 오르는 거짓말이 된다. 카드 도감처럼
 * 종이 특정되지 않는 화면은 생략하고 기준값(감쇠 없음)으로 보여준다.
 *
 * ⚠ 카드가 있는 화면(드래프트)은 이걸 직접 부르지 말고 **`cardDelta`** 를 쓴다 — 정점 고정·희생까지
 * 봐야 표시가 실제와 어긋나지 않는다. 이 함수는 그 안쪽 계단(스케일·감쇠)만 담당한다. */
export function effectiveDelta(key: keyof Traits, raw: number, current?: number): number {
  let d = GROWTH_TRAITS.has(key) ? raw * CARD_GROWTH_SCALE : raw;
  if (d > 0 && current !== undefined) d *= growthFalloff(key, current);
  return Math.round(d);
}

/**
 * **이 카드가 이 형질에 실제로 일으키는 변화 — 표시와 적용의 단일 진실.**
 * `applyCard`(실제 적용)와 드래프트 칩·스탯바(화면 표시)가 **같은 이 함수**를 부른다. 둘이 갈라지면
 * 카드에 "+12" 라 써 놓고 +5 가 붙는 거짓말이 생긴다(CLAUDE.md 전달 규칙).
 *
 * 다섯 계단을 순서대로 밟는다:
 *   1. **희생**(sacrifice) — 그 형질을 통째로 버리는 카드면 현재값만큼 통으로 뺀다(→ 0). 정점도 뚫는다.
 *   2. **정점 고정** — 100 을 찍은 형질은 카드의 **부수적 대가**로는 안 내려간다(변화 0).
 *   3. **성장 스케일**(×0.75, 값형질만) — 한 장에 쑥 오르지 않게.
 *   4. **상한 근접 감쇠** — 높을수록 덜 오른다(내리는 효과엔 안 걸린다).
 *   5. **0~상한 클램프** — 게놈은 잘린다. 번식력 5 인 종에게 "-12"라 써 놓고 실제론 -5 만 빠지면
 *      그것도 똑같은 거짓말이다. 무리 성향 0 인 종의 "무리 -18"은 **아무 일도 안 일어난다**(0).
 *
 * `current` 를 모르면(카드 도감처럼 종이 특정 안 되는 화면) 정점·감쇠·클램프는 건너뛰고 기준값만 보여준다.
 */
export function cardDelta(card: Card, key: keyof Traits, current?: number): number {
  // 1. 희생 — "얼마를 빼느냐"가 아니라 "그 감각을 버리느냐". 현재값이 얼마든 0 이 된다.
  if (card.sacrifice?.includes(key)) return current === undefined ? -TRAIT_CEILING[key] : -current;
  const raw = card.effects[key] ?? 0;
  // 2. 정점 고정 — 한 번 100 을 찍었으면 카드의 곁가지 대가로는 안 내려간다(만렙).
  if (raw < 0 && current !== undefined && isApexTrait(key, current)) return 0;
  // 3·4. 성장 스케일 + 상한 근접 감쇠.
  const d = effectiveDelta(key, raw, current);
  if (current === undefined) return d;
  // 5. 게놈이 실제로 잘리는 만큼만 움직인다 — 여기까지 봐야 표시가 적용과 **정확히** 같아진다.
  return clampTraitValue(key, current + d) - current;
}

/** 카드 효과를 boost 배로 키운 사본(시대 보상용). 표시값(effectiveDelta)과 실제 적용(applyCard)이 같은
 * 카드 객체를 쓰므로 수치가 어긋나지 않는다. 대가(음수 효과)도 함께 커져 카드 정체성을 유지한다.
 * set(프리셋 정체성 절대값)은 보상 풀(CARD_POOL)에 없어 그대로 둔다. */
export function boostCard(card: Card, boost: number): Card {
  const effects: Partial<Record<keyof Traits, number>> = {};
  for (const key of Object.keys(card.effects) as (keyof Traits)[]) {
    effects[key] = Math.round((card.effects[key] ?? 0) * boost);
  }
  return { ...card, effects };
}

// 이미 고른 카드의 등장 가중치를 한 번 고를 때마다 이 배수로 줄인다(소프트 디듑). 매번 "보던 것만" 뜨는
// 반복을 깨서 새 카드를 섞는다 — 스택은 여전히 가능하되(0 이 안 됨) 눈에 띄게 뜸해진다. count 번 고른 카드는
// PICK_DECAY^count 배. 결정론: pickedCounts 는 그동안의 선택에서 결정론적으로 나온다(시드 무관).
const PICK_DECAY = 0.5;

/**
 * 풀에서 중복 없이 n장 뽑는다 (시드 RNG → 런마다 재현 가능). allow 로 카드(메타 언락·프리셋 적합)를 걸러낸다.
 * 희귀도 가중치를 반영한 비복원 추출 — 흔한 카드가 자주, 전설이 드물게 뜬다. 카드에 붙는 희귀도 배지가
 * 실제 등장 빈도와 일치한다. `level`(런 레벨=세대)이 오르면 높은 등급이 더 자주 나온다.
 * `pickedCounts`(id→고른 횟수)를 주면 이미 고른 카드를 뜸하게 뽑는다(반복 완화, PICK_DECAY).
 */
/**
 * 지금 실제로 뽑힐 수 있는 카드들 — **공통 카드 + 내 갈래 전용 카드**. 남의 갈래 카드는 빠진다.
 * 등장 확률 표(대백과)도 반드시 이 풀로 계산해야 한다 — 안 뽑히는 카드까지 세면 표시가 거짓말이 된다.
 */
export function cardPoolFor(lineage?: Lineage): Card[] {
  return CARD_POOL.filter((c) => c.lineage === undefined || c.lineage === lineage);
}

/** 갈래 전용 카드(어느 갈래든) — 대백과에서 "이 카드는 그 갈래로 시작해야 나온다"를 알리는 데 쓴다. */
export function lineageCards(lineage: Lineage): Card[] {
  return CARD_POOL.filter((c) => c.lineage === lineage);
}

export function drawCards(
  rng: Rng,
  n: number,
  allow?: (c: Card) => boolean,
  level = 1,
  pickedCounts?: ReadonlyMap<string, number>,
  lineage?: Lineage,
): Card[] {
  // 후보 = 공통 카드 + **내 갈래** 전용 카드. 남의 갈래 전용 카드는 아예 안 보인다.
  const eligible = CARD_POOL.filter(
    (c) => (allow ? allow(c) : true) && (c.lineage === undefined || c.lineage === lineage),
  );
  const weights = rarityWeightsAtLevel(level);
  const weightOf = (c: Card): number =>
    weights[cardRarity(c)] * PICK_DECAY ** (pickedCounts?.get(c.id) ?? 0);

  /** 가중치 룰렛으로 pool 에서 한 장 뽑아 꺼낸다(뽑힌 카드는 pool 에서 빠진다). */
  const take = (pool: Card[]): Card | null => {
    if (pool.length === 0) return null;
    let total = 0;
    for (const c of pool) total += weightOf(c);
    // 룰렛 휠 — rng.unit() 한 번으로 한 장. 부동소수 오차로 끝까지 못 고르면 마지막 장을 집는다.
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

  // **3장 중 1장은 반드시 내 갈래 전용 카드.** 이게 없으면 전용 카드가 40장 넘는 공통 풀에 묻혀
  // 몇 판을 해도 구경조차 못 한다 — "내 종만의 길"이 매 판 이어지려면 자리를 보장해야 한다.
  // 갈래가 없거나(옛 세이브) 전용 카드가 다 떨어지면 그냥 공통에서 채운다.
  if (lineage) {
    const own = rest.filter((c) => c.lineage === lineage);
    const pickedOwn = take(own);
    if (pickedOwn) {
      out.push(pickedOwn);
      rest.splice(rest.indexOf(pickedOwn), 1);
    }
  }

  while (out.length < n) {
    const c = take(rest);
    if (!c) break;
    out.push(c);
  }

  // 자리를 섞는다 — 안 섞으면 갈래 전용 카드가 **늘 첫 장**이라 위치만 보고 알아버린다(고르는 재미가
  // 준다). 배지로 알리되 자리는 무작위여야 세 장을 실제로 견주게 된다. rng 는 같은 스트림(결정론 유지).
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
  /** 이 풀에 있는 이 등급의 카드 수 */
  count: number;
  /** 카드 한 장을 뽑을 때 이 등급이 나올 확률 (0~1) */
  perCard: number;
  /** 후보 n장(기본 3장) 중 한 장이라도 이 등급일 확률 (0~1) */
  inDraft: number;
}

const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** counts[skip] 등급을 한 장도 안 뽑고 draws 번 뽑을 확률. 같은 등급 카드는 가중치가 같아 묶어서 셀 수 있다. */
function probNone(counts: number[], weights: readonly number[], skip: number, draws: number): number {
  if (draws <= 0) return 1;
  let total = 0;
  for (let i = 0; i < counts.length; i++) total += (counts[i] ?? 0) * (weights[i] ?? 0);
  if (total <= 0) return 1;
  let p = 0;
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i] ?? 0;
    if (i === skip || n === 0) continue;
    const pick = (n * (weights[i] ?? 0)) / total;
    counts[i] = n - 1;
    p += pick * probNone(counts, weights, skip, draws - 1);
    counts[i] = n;
  }
  return p;
}

/**
 * 주어진 풀에서 등급별 등장 확률(정확값). `drawCards` 의 가중치 비복원 추출을 그대로 반영한다.
 * 풀은 호출자가 정한다 — 대백과는 "지금 열려 있는 카드"만 넘겨 실제 확률을 보여준다.
 * `level` 은 런 레벨(세대) — 같은 레벨의 `drawCards` 와 정확히 같은 가중치를 쓴다.
 */
export function rarityOdds(pool: readonly Card[], draws = 3, level = 1): Record<Rarity, RarityOdds> {
  const counts = RARITIES.map((r) => pool.filter((c) => cardRarity(c) === r).length);
  const levelWeights = rarityWeightsAtLevel(level);
  const weights = RARITIES.map((r) => levelWeights[r]);
  let total = 0;
  for (let i = 0; i < counts.length; i++) total += (counts[i] ?? 0) * (weights[i] ?? 0);
  const n = Math.min(draws, pool.length);

  const out = {} as Record<Rarity, RarityOdds>;
  RARITIES.forEach((r, i) => {
    const count = counts[i] ?? 0;
    const perCard = total > 0 ? (count * (weights[i] ?? 0)) / total : 0;
    const inDraft = count === 0 ? 0 : 1 - probNone(counts.slice(), weights, i, n);
    out[r] = { count, perCard, inDraft };
  });
  return out;
}

/** 카드 효과를 게놈에 그 자리에서 적용 + 형질별 상한 클램프. (공유 게놈이라 즉시 반영)
 * 실제 증가폭은 **`cardDelta` 하나가 정한다** — 드래프트 화면이 보여주는 수치와 같은 함수라 표시와
 * 적용이 어긋날 수 없다(성장 스케일·상한 근접 감쇠·정점 고정·희생을 전부 그 안에서 처리).
 * set(프리셋 정체성 절대값)만 여기서 따로 — 증분이 아니라 "이 값으로 시작한다"는 선언이다. */
export function applyCard(genome: Genome, card: Card): void {
  if (card.set) {
    for (const key of Object.keys(card.set) as (keyof Traits)[]) {
      genome.traits[key] = clampTraitValue(key, card.set[key] ?? genome.traits[key]);
    }
  }
  for (const key of Object.keys(card.effects) as (keyof Traits)[]) {
    genome.traits[key] = clampTraitValue(key, genome.traits[key] + cardDelta(card, key, genome.traits[key]));
  }
  // 희생(관문 카드가 내놓기로 선언한 형질) — 정점(100)이어도 뚫고 0 이 된다. 맨 마지막이라 같은 카드가
  // 그 형질을 만졌더라도 "버린다"가 최종 결론이다(박쥐가 되기로 했으면 눈은 먼다).
  for (const key of card.sacrifice ?? []) genome.traits[key] = 0;
  // 내 종은 물 전용(육지 통행 불가)이 되지 않게 수영 상한을 수륙양용 문턱 바로 아래로 막는다. 지느러미·물갈퀴를
  // 쌓아도 바다까지 헤엄치되 육지에서 안 죽는다(예전엔 90 을 넘으면 갑자기 물 전용이 돼 땅에 갇혀 굶어 죽었다).
  // 진짜 물 전용(바다 거주 물고기)은 야생 물고기 떼만 — 그들은 카드가 없어 이 상한을 안 거친다(swimming 95 유지).
  const swimCap = SIM.aquaticOnlyThreshold - 1;
  if (genome.traits.swimming > swimCap) genome.traits.swimming = swimCap;
}
