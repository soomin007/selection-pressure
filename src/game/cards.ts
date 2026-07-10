// 카드 = 종 게놈에 누적 적용되는 형질 변화. 런 내 영구, 런 종료 시 리셋(로그라이크).
// 매 라운드 풀에서 무작위 3장 후보(운 요소). 트레이드오프 카드로 "특화 vs 헷지" 결정을 만든다.
// 문구는 쉬운 말로 (UI 규칙).
//
// effects = 누적 가감. set = 절대값 지정(시작 식성 선택용). 값은 형질과 같은 0~100 자연수 스케일.
// 둘 다 적용 후 0~100 으로 클램프.

import type { Rng } from "@/sim/rng";
import type { Genome, Traits } from "@/sim/genome";
import { clampTraitValue, TRAIT_CEILING } from "@/sim/genome";
import { SIM } from "@/sim/params";

// 상한 200 연속 형질(속도·시야·공격·번식·무리)의 카드 증가폭을 이만큼으로 줄인다 — 극단(200)까지 여러 장을
// 쌓아야 도달(폰 피드백: 100 에 너무 쉽게 붙어 잘림). 100 이하 구간이 예전보다 천천히 오르되, 100~200 이 열려
// 잘림이 사라진다. set(프리셋 정체성 값)은 안 줄인다(증분만).
const CARD_GROWTH_SCALE = 0.6;

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

export interface Card {
  id: string;
  name: string;
  desc: string;
  effects: Partial<Record<keyof Traits, number>>;
  set?: Partial<Record<keyof Traits, number>>;
  /** 시작 프리셋의 내 종 시작 색(프리셋 전용) — 종마다 뚜렷이 달라 외형만으로 구분된다. */
  color?: number;
  /**
   * 전제 조건 — 이 형질이 min 이상인 종에게만 후보로 나온다. **강화 카드 전용**.
   * 예: 「튼튼한 날개」는 이미 나는 종(날개 ≥ flyThreshold)에게만. 없으면 아무 종에게나 나온다.
   * 이게 없으면 못 나는 종이 "튼튼한 날개"를 골라 아무 일도 안 일어나는 손해 카드가 된다.
   */
  requiresTrait?: { key: keyof Traits; min: number };
}

/** 이 카드의 전제 조건을 이 종이 갖췄는가(전제가 없으면 항상 true). */
export function cardPrereqMet(card: Card, traits: Traits): boolean {
  if (!card.requiresTrait) return true;
  return traits[card.requiresTrait.key] >= card.requiresTrait.min;
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
    desc: "풀도 뜯고 사냥도 한다. 시야가 조금 넓어 어느 환경에서든 무난하게 자리 잡는다.",
    set: { diet: 50 },
    effects: { vision: 8 },
    color: 0x6cc24a, // 초록
  },
  {
    id: "preset_herd",
    name: "다산 초식 무리",
    desc: "풀을 뜯는다. 무리로 뭉쳐 다니며 빠르게 새끼를 쳐, 하나가 스러져도 수로 메운다. 대신 걸음은 느리다.",
    set: { diet: 16, fertility: 78, herding: 76, speed: 40 },
    effects: {},
    color: 0xb4e04a, // 라임(밝은 연두)
  },
  {
    id: "preset_hunter",
    name: "날쌘 육식 사냥꾼",
    desc: "사냥으로 산다. 빠르고 사나워 먹잇감을 좀처럼 놓치지 않는다. 대신 새끼는 더디게 친다.",
    set: { diet: 68, speed: 80, attack: 74, fertility: 34 },
    effects: {},
    color: 0xff7a3a, // 주황
  },
  {
    id: "preset_scout",
    name: "느긋한 정찰자",
    desc: "풀과 사냥을 겸한다. 멀리 내다보고 기운을 아껴 척박한 땅에서도 오래 버틴다. 대신 걸음은 느리다.",
    set: { diet: 40, vision: 82, metabolism: 28, speed: 42 },
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
    set: { diet: 26, venom: 84, herding: 66, fertility: 62 },
    effects: {},
    color: 0x9c27b0, // 독 보라 — 기존 프리셋 색과 구분
  },
  {
    id: "preset_ranged",
    name: "원거리 사냥꾼",
    desc: "다가서지 않고 멀리서 가시를 쏜다. 넓은 시야로, 상대가 반격하거나 달아나기 전에 먼저 맞힌다.",
    set: { diet: 60, ranged: 82, vision: 72, speed: 46 },
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
  {
    id: "herd",
    name: "무리 본능",
    desc: "함께 모여 다니고, 모이면 서로 온기를 나눈다(추위에 강하다).",
    effects: { herding: 18 },
  },

  // 조합 (작은 상승 두 개)
  {
    id: "eagle_eye",
    name: "매의 눈",
    desc: "멀리 보며 조금 빨라지지만, 멀리 살피느라 무리에서 떨어진다.",
    effects: { vision: 20, speed: 5, herding: -6 },
  },
  {
    id: "pack_hunt",
    name: "무리 사냥",
    desc: "무리 성향과 걸음이 함께 는다.",
    effects: { herding: 12, speed: 8 },
  },
  {
    id: "warm_pack",
    name: "옹기종기",
    desc: "무리의 온기가 짙어지고 추위에 강해진다.",
    effects: { herding: 14, metabolism: 6 },
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
    id: "giant",
    name: "느긋한 거인",
    desc: "기운을 거의 쓰지 않지만 걸음이 굼뜨다.",
    effects: { metabolism: -18, speed: -6 },
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

  // 초음파 감각 — 눈 대신 귀. 시야를 잃는 대신 전방위(어둠·수풀 무관) 근거리 탐지(눈 vs 귀 트레이드오프).
  {
    id: "echo",
    name: "초음파",
    desc: "눈 대신 귀로 사방을 더듬는다. 시야가 줄지만 어둠과 수풀에서도 가까운 것을 알아챈다.",
    effects: { echo: 42, vision: -24 },
  },
  {
    id: "bat_ear",
    name: "박쥐의 귀",
    desc: "온전히 귀에 기댄다. 눈은 거의 멀지만, 그만큼 사방을 아주 멀리까지 훤히 듣는다.",
    effects: { echo: 48, vision: -30 },
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
  // 「거인」은 몸이 실제로 커진다 — 스탯(힘↑ 걸음↓ 새끼↓)과 외형(bodyScale)이 함께 바뀐다.
  // 외형만 커지고 스탯은 그대로면 "세 보이는데 안 센" 거짓말이 되므로, 둘을 반드시 같이 움직인다.
  {
    id: "titan",
    name: "거인",
    desc: "몸이 통째로 커진다. 힘은 압도적이지만 걸음이 굼뜨고, 큰 몸을 건사하느라 새끼는 드물게 친다.",
    effects: { attack: 34, herding: 10, speed: -18, fertility: -14, metabolism: 8 },
  },
];

/** 이 카드를 고르면 내 종의 몸이 이 배율로 커진다(렌더 전용 — sim 은 개체 크기를 안 쓴다). */
export const CARD_BODY_SCALE: Record<string, number> = {
  titan: 1.42,
};

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
  // ── 흔함 (16장) — 대가가 없다. 무조건 좋으니 고민할 게 없다.
  swift: "common",
  keen: "common",
  thrifty: "common", // 대사 -14 = 기운 아낌(이득)
  hotblood: "common", // 대사 +14 = 추위 강함(이득)
  fertile: "common",
  herd: "common",
  pack_hunt: "common",
  warm_pack: "common",
  fangs: "common",
  all_rounder: "common",
  scout_pack: "common",
  owl_eye: "common",
  evasive: "common",
  beast_metab: "common",
  swift_breeder: "common",
  stoic: "common",

  // ── 드묾 (10장) — 작은 대가를 치르거나, 방향을 살짝 틀거나, 능력을 보조한다.
  eagle_eye: "uncommon", // 무리 -6
  sprint: "uncommon", // 대사 +7
  giant: "uncommon", // 걸음 -6
  furnace: "uncommon", // 대사 +20(더위에 취약)
  predator: "uncommon", // 식성 전환
  grazer: "uncommon", // 식성 전환
  ambush: "uncommon", // 중간 조합
  thick_fur: "uncommon",
  nest_herd: "uncommon", // 걸음 -6
  webbed: "uncommon", // 수영 보조

  // ── 귀함 (9장) — 크게 얻고 뚜렷이 잃는다. 무엇을 포기할지 고르게 만든다.
  hunter_eye: "rare", // 시야 +24 / 번식 -6
  brood: "rare", // 번식 +22 / 걸음 -7
  loner: "rare", // 걸음 +20 / 무리 -18
  savage: "rare", // 공격 +24 / 번식 -6
  ascetic: "rare", // 대사 -20 / 걸음 -6
  farsight: "rare", // 시야 +26 / 걸음 -6
  apex_scout: "rare", // 시야·공격 +16 / 걸음 -7
  locust: "rare", // 번식 +28 / 공격 -6
  great_fangs: "rare", // 공격 +26 / 걸음 -8

  // ── 아주 귀함 (8장) — 이 한 장으로 종의 방향이 정해진다. 능력형은 그 능력을 극단까지 민다.
  cheetah: "epic", // 극단 속도
  glass_cannon: "epic", // 극단 공격
  lone_warrior: "epic", // 홀로 싸우는 종으로 굳는다
  phalanx: "epic", // 뭉쳐 맞서는 종으로 굳는다
  strong_wings: "epic", // 비행을 완성한다
  bat_ear: "epic", // 눈을 버리고 귀에 온전히 기댄다
  venom_gland: "epic", // 독을 치명적으로
  spit: "epic", // 원거리 + 방어독 동시

  // ── 전설 (5장) — 못 하던 걸 하게 된다. 다섯 능력 계열의 **관문** 카드.
  fins: "legendary", // 바다: 아무도 안 먹는 먹이터가 열린다
  wings: "legendary", // 하늘: 산·바다를 넘고 고산 먹이에 닿는다
  echo: "legendary", // 초음파: 눈 대신 귀. 어둠·수풀이 무의미해진다
  venom_fang: "legendary", // 방어독: 피식자에서 "삼키면 안 되는 것"으로
  long_horn: "legendary", // 원거리: 근접 사냥에서 벗어난다

  // ── 도전 과제 전용 (등급은 전설) — 몸 자체가 달라진다.
  titan: "legendary",
};

/** 카드의 희귀도(미등록 카드는 흔함). 표시(배지·색·연출)와 뽑기 가중치가 같은 값을 쓴다. */
export function cardRarity(card: Card): Rarity {
  return CARD_RARITY[card.id] ?? "common";
}

/** 카드가 게놈에 실제로 더하는 값(표시용) — 상한 200 연속 형질은 CARD_GROWTH_SCALE 로 줄어드므로, 카드에
 * 뜨는 수치를 실제 적용값과 맞추려면 이걸 쓴다(전엔 원값 +15 를 보여줬으나 실제론 +9 만 붙었다 — 폰 피드백). */
export function effectiveDelta(key: keyof Traits, raw: number): number {
  return Math.round(TRAIT_CEILING[key] > 100 ? raw * CARD_GROWTH_SCALE : raw);
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

/**
 * 풀에서 중복 없이 n장 뽑는다 (시드 RNG → 런마다 재현 가능). allow 로 카드(메타 언락·프리셋 적합)를 걸러낸다.
 * 희귀도 가중치를 반영한 비복원 추출 — 흔한 카드가 자주, 전설이 드물게 뜬다. 카드에 붙는 희귀도 배지가
 * 실제 등장 빈도와 일치한다. `level`(런 레벨=세대)이 오르면 높은 등급이 더 자주 나온다.
 */
export function drawCards(rng: Rng, n: number, allow?: (c: Card) => boolean, level = 1): Card[] {
  const pool = (allow ? CARD_POOL.filter(allow) : CARD_POOL).slice();
  const weights = rarityWeightsAtLevel(level);
  const count = Math.min(n, pool.length);
  const out: Card[] = [];
  for (let k = 0; k < count; k++) {
    let total = 0;
    for (const c of pool) total += weights[cardRarity(c)];
    // 룰렛 휠 — rng.unit() 한 번으로 한 장. 부동소수 오차로 끝까지 못 고르면 마지막 장을 집는다.
    let r = rng.unit() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[cardRarity(pool[i] as Card)];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    out.push(pool[idx] as Card);
    pool.splice(idx, 1);
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
 * 증분(effects)은 상한 200 연속 형질이면 CARD_GROWTH_SCALE 로 줄인다(극단까지 천천히). set(프리셋 정체성)은 안 줄임. */
export function applyCard(genome: Genome, card: Card): void {
  if (card.set) {
    for (const key of Object.keys(card.set) as (keyof Traits)[]) {
      genome.traits[key] = clampTraitValue(key, card.set[key] ?? genome.traits[key]);
    }
  }
  for (const key of Object.keys(card.effects) as (keyof Traits)[]) {
    let delta = card.effects[key] ?? 0;
    if (TRAIT_CEILING[key] > 100) delta *= CARD_GROWTH_SCALE; // 상한 200 형질만 증가폭 축소
    genome.traits[key] = clampTraitValue(key, genome.traits[key] + delta);
  }
}
