// 카드 = 종 게놈에 누적 적용되는 형질 변화. 런 내 영구, 런 종료 시 리셋(로그라이크).
// 매 라운드 풀에서 무작위 3장 후보(운 요소). 트레이드오프 카드로 "특화 vs 헷지" 결정을 만든다.
// 문구는 쉬운 말로 (UI 규칙).
//
// effects = 누적 가감. set = 절대값 지정(시작 식성 선택용). 값은 형질과 같은 0~100 자연수 스케일.
// 둘 다 적용 후 0~100 으로 클램프.

import type { Rng } from "@/sim/rng";
import type { Genome, Traits } from "@/sim/genome";
import { clampTraitValue, TRAIT_CEILING } from "@/sim/genome";

// 상한 200 연속 형질(속도·시야·공격·번식·무리)의 카드 증가폭을 이만큼으로 줄인다 — 극단(200)까지 여러 장을
// 쌓아야 도달(폰 피드백: 100 에 너무 쉽게 붙어 잘림). 100 이하 구간이 예전보다 천천히 오르되, 100~200 이 열려
// 잘림이 사라진다. set(프리셋 정체성 값)은 안 줄인다(증분만).
const CARD_GROWTH_SCALE = 0.6;

export interface Card {
  id: string;
  name: string;
  desc: string;
  effects: Partial<Record<keyof Traits, number>>;
  set?: Partial<Record<keyof Traits, number>>;
  /** 시작 프리셋의 내 종 시작 색(프리셋 전용) — 종마다 뚜렷이 달라 외형만으로 구분된다. */
  color?: number;
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
    desc: "식물도 먹고 사냥도 합니다. 시야가 조금 넓은 무난한 시작.",
    set: { diet: 50 },
    effects: { vision: 8 },
    color: 0x6cc24a, // 초록
  },
  {
    id: "preset_herd",
    name: "다산 초식 무리",
    desc: "식물을 먹습니다. 함께 뭉쳐 다니며 아주 빠르게 새끼를 쳐 수로 버팁니다. 대신 한 마리는 느립니다.",
    set: { diet: 16, fertility: 78, herding: 76, speed: 40 },
    effects: {},
    color: 0xb4e04a, // 라임(밝은 연두)
  },
  {
    id: "preset_hunter",
    name: "날쌘 육식 사냥꾼",
    desc: "주로 사냥합니다. 아주 빠르고 사나워 먹잇감을 잘 잡습니다. 대신 번식이 더딥니다.",
    set: { diet: 68, speed: 80, attack: 74, fertility: 34 },
    effects: {},
    color: 0xff7a3a, // 주황
  },
  {
    id: "preset_scout",
    name: "느긋한 정찰자",
    desc: "식물과 사냥을 겸합니다. 아주 멀리 보고 에너지를 크게 아껴 오래 버팁니다. 대신 느립니다.",
    set: { diet: 40, vision: 82, metabolism: 28, speed: 42 },
    effects: {},
    color: 0x3fc9c0, // 청록
  },
  {
    id: "preset_sea",
    name: "바다 개척자",
    desc: "능숙하게 헤엄쳐 바다 먹이를 먹으면서 뭍도 오갑니다. 바다는 다투는 경쟁자가 적습니다.",
    // 수영 88 = 수륙양용(뭍 O). 90(aquaticOnlyThreshold) 이상이면 물 전용이 돼 땅에 소환되면 못 움직이고
    // 죽는다(버그). 설명대로 "뭍도 오가는" 종이라 90 미만으로 둔다.
    set: { diet: 40, swimming: 88, speed: 62 },
    effects: {},
    color: 0x5aa0f0, // 하늘 파랑
  },
  {
    id: "preset_sky",
    name: "하늘 개척자",
    desc: "날아서 산과 바다를 넘나들고 산 위의 먹이를 먹습니다. 높이 날아 아주 멀리 봅니다. 대신 배가 빨리 고픕니다.",
    set: { diet: 40, wings: 80, vision: 70, metabolism: 66 },
    effects: {},
    color: 0xf0c840, // 황금빛(하늘·맹금) — 기존 프리셋 색과 구분
  },
  {
    id: "preset_venom",
    name: "독 살갗",
    desc: "몸에 강한 독이 있어 잡아먹으려는 포식자가 중독됩니다. 함께 뭉쳐 다니는 잘 안 잡아먹히는 초식 종입니다.",
    set: { diet: 26, venom: 84, herding: 66, fertility: 62 },
    effects: {},
    color: 0x9c27b0, // 독 보라 — 기존 프리셋 색과 구분
  },
  {
    id: "preset_ranged",
    name: "원거리 사냥꾼",
    desc: "먹잇감에 다가가지 않고 멀리서 가시를 쏩니다. 넓은 시야로 반격·도망 전에 안전하게 사냥합니다.",
    set: { diet: 60, ranged: 82, vision: 72, speed: 46 },
    effects: {},
    color: 0x4aa0a0, // 청록빛 — 기존 프리셋 색과 구분
  },
];

export const CARD_POOL: readonly Card[] = [
  // 단일 형질
  { id: "swift", name: "날쌘 다리", desc: "더 빨리 움직입니다.", effects: { speed: 15 } },
  { id: "keen", name: "넓은 시야", desc: "먹이를 더 멀리서 봅니다.", effects: { vision: 15 } },
  {
    id: "thrifty",
    name: "느린 대사",
    desc: "에너지를 적게 씁니다. 따뜻한 땅·폭염·대가뭄에 유리합니다.",
    effects: { metabolism: -14 },
  },
  {
    id: "hotblood",
    name: "뜨거운 피",
    desc: "추위를 잘 견딥니다. 대신 에너지를 더 씁니다. 추운 땅·한파에 유리합니다.",
    effects: { metabolism: 14 },
  },
  { id: "fertile", name: "다산", desc: "더 자주 새끼를 칩니다.", effects: { fertility: 16 } },
  {
    id: "herd",
    name: "무리 본능",
    desc: "함께 모여 다니고, 모이면 서로 보온합니다(추위에 유리).",
    effects: { herding: 18 },
  },

  // 조합 (작은 상승 두 개)
  {
    id: "eagle_eye",
    name: "매의 눈",
    desc: "멀리 보며 조금 빨라지지만, 시야에만 골몰해 홀로 다니게 됩니다.",
    effects: { vision: 20, speed: 5, herding: -6 },
  },
  {
    id: "pack_hunt",
    name: "무리 사냥",
    desc: "무리 성향과 속도가 함께 늡니다.",
    effects: { herding: 12, speed: 8 },
  },
  {
    id: "warm_pack",
    name: "옹기종기",
    desc: "무리 보온이 강해지고 추위에 강해집니다.",
    effects: { herding: 14, metabolism: 6 },
  },

  // 트레이드오프 (큰 상승 + 작은 대가)
  {
    id: "sprint",
    name: "질주 본능",
    desc: "훨씬 빨라지지만 에너지를 더 씁니다.",
    effects: { speed: 22, metabolism: 7 },
  },
  {
    id: "hunter_eye",
    name: "사냥꾼의 눈",
    desc: "시야가 크게 넓어지지만 번식이 줍니다.",
    effects: { vision: 24, fertility: -6 },
  },
  {
    id: "brood",
    name: "둥지 본능",
    desc: "번식이 크게 늘지만 느려집니다.",
    effects: { fertility: 22, speed: -7 },
  },
  {
    id: "loner",
    name: "외톨이",
    desc: "무리를 떠나 홀로 아주 빠르게 움직입니다. 무리 성향을 크게 잃는 대신 발이 매우 빨라집니다.",
    effects: { speed: 20, herding: -18 },
  },
  {
    id: "giant",
    name: "느긋한 거인",
    desc: "에너지를 아주 적게 쓰지만 느려집니다.",
    effects: { metabolism: -18, speed: -6 },
  },
  {
    id: "furnace",
    name: "왕성한 대사",
    desc: "추위에 아주 강하고 번식도 늘지만 에너지를 많이 씁니다.",
    effects: { metabolism: 20, fertility: 5 },
  },

  // 공격성·식성 (다종 생태계)
  {
    id: "fangs",
    name: "송곳니",
    desc: "공격력이 늡니다. 사냥에 강하고 포식자에 덜 쫓깁니다.",
    effects: { attack: 18 },
  },
  {
    id: "savage",
    name: "사나운 이빨",
    desc: "공격력이 크게 늘고 조금 빨라지지만, 사냥에 몰두해 번식이 줍니다.",
    effects: { attack: 24, speed: 5, fertility: -6 },
  },
  {
    id: "predator",
    name: "포식 본능",
    desc: "육식으로 기웁니다. 다른 종을 사냥해 먹습니다.",
    effects: { diet: 22, attack: 6 },
  },
  {
    id: "grazer",
    name: "초식 본능",
    desc: "초식으로 기웁니다. 식물을 먹고 다툼을 피합니다.",
    effects: { diet: -22, fertility: 5 },
  },

  // 특화 진화 — 큰 변화 + 뚜렷한 대가. 빌드 정체성을 만든다(드래프트가 매번 다르게).
  {
    id: "cheetah",
    name: "치타의 다리",
    desc: "엄청나게 빨라지지만 번식이 줍니다.",
    effects: { speed: 28, fertility: -10 },
  },
  {
    id: "great_fangs",
    name: "거대 송곳니",
    desc: "공격력이 크게 늘지만 굼떠집니다.",
    effects: { attack: 26, speed: -8 },
  },
  {
    id: "ambush",
    name: "매복 사냥꾼",
    desc: "멀리서 보고 덮칩니다. 시야와 공격력이 함께 늡니다.",
    effects: { vision: 14, attack: 14 },
  },
  {
    id: "locust",
    name: "메뚜기 떼",
    desc: "폭발적으로 불어납니다. 대신 한 마리는 약해집니다.",
    effects: { fertility: 28, attack: -6 },
  },
  {
    id: "thick_fur",
    name: "두꺼운 털가죽",
    desc: "추위에 아주 강하고 함께 모입니다.",
    effects: { metabolism: 16, herding: 12 },
  },
  {
    id: "all_rounder",
    name: "균형 진화",
    desc: "속도·시야·번식이 고루 조금씩 늡니다.",
    effects: { speed: 8, vision: 8, fertility: 8 },
  },
  {
    id: "ascetic",
    name: "고행자",
    desc: "에너지를 거의 안 쓰고 멀리 봅니다. 대신 느립니다.",
    effects: { metabolism: -20, vision: 10, speed: -6 },
  },
  {
    id: "phalanx",
    name: "철벽 대형",
    desc: "함께 뭉쳐 맞서 싸웁니다. 무리 성향과 공격력이 크게 늘지만, 싸움에 힘써 번식이 줍니다.",
    effects: { herding: 22, attack: 12, fertility: -6 },
  },
  {
    id: "lone_warrior",
    name: "독불장군",
    desc: "홀로 강하게 싸웁니다. 공격력이 크게 늘지만 무리에서 떨어집니다.",
    effects: { attack: 22, speed: 6, herding: -16 },
  },

  // 추가 조합·정체성. 빈 형질 조합을 메워 드래프트 변주를 넓힌다(기존 형질만).
  {
    id: "scout_pack",
    name: "파수 무리",
    desc: "함께 다니며 멀리까지 살핍니다. 시야와 무리 성향이 늡니다.",
    effects: { vision: 14, herding: 12 },
  },
  {
    id: "owl_eye",
    name: "올빼미 눈",
    desc: "멀리 보면서도 에너지를 아낍니다. 시야가 늘고 대사가 줍니다.",
    effects: { vision: 16, metabolism: -8 },
  },
  {
    id: "nest_herd",
    name: "둥지 무리",
    desc: "무리 속에서 안전하게 새끼를 칩니다. 번식과 무리 성향이 늘지만, 둥지를 지키느라 느려집니다.",
    effects: { fertility: 16, herding: 10, speed: -6 },
  },
  {
    id: "farsight",
    name: "천리안",
    desc: "아주 멀리까지 봅니다. 대신 조금 느려집니다.",
    effects: { vision: 26, speed: -6 },
  },
  {
    id: "evasive",
    name: "민첩한 회피",
    desc: "빠르게 움직이며 위험을 멀리서 알아챕니다. 속도와 시야가 함께 늡니다.",
    effects: { speed: 12, vision: 12 },
  },
  {
    id: "beast_metab",
    name: "맹수의 대사",
    desc: "사냥을 위해 힘이 세지만 에너지를 많이 씁니다.",
    effects: { attack: 16, metabolism: 8 },
  },
  {
    id: "glass_cannon",
    name: "유리 대포",
    desc: "공격력이 폭발하지만 몸이 약해 번식이 줍니다.",
    effects: { attack: 28, fertility: -10 },
  },
  {
    id: "swift_breeder",
    name: "잰걸음 번식",
    desc: "재빠르게 늘어납니다. 속도와 번식이 함께 조금 늡니다.",
    effects: { speed: 8, fertility: 10 },
  },
  {
    id: "stoic",
    name: "굳건한 체질",
    desc: "에너지를 아끼고 함께 버팁니다. 느린 대사와 무리 보온.",
    effects: { metabolism: -12, herding: 10 },
  },
  {
    id: "apex_scout",
    name: "정점의 사냥꾼",
    desc: "넓은 시야로 먹이를 찾고 강하게 사냥합니다. 대신 굼떠집니다.",
    effects: { vision: 16, attack: 16, speed: -7 },
  },

  // 바다 적응 — 수영을 키우면 바다 먹이를 먹는다(육상 종은 못 먹는 무경쟁 틈새).
  {
    id: "fins",
    name: "지느러미",
    desc: "헤엄쳐 바다의 먹이를 먹습니다. 바다는 다투는 경쟁자가 없습니다.",
    effects: { swimming: 22 },
  },
  {
    id: "webbed",
    name: "물갈퀴 발",
    desc: "물에서 잘 움직입니다. 수영과 속도가 함께 조금 늡니다.",
    effects: { swimming: 16, speed: 6 },
  },

  // 날개 비행 — 날개를 키우면 산·물을 날아 넘고 산 위 고산 먹이를 먹는다(지상 종은 못 넘는 무경쟁 틈새).
  // 대사 대가는 sim(비행 = 날갯짓)에서. 기본 날개 0 이라 큰 효과로(두 장 or 프리셋이면 비행 전환).
  {
    id: "wings",
    name: "날개",
    desc: "날아서 산과 바다를 넘고 산 위의 먹이를 먹습니다. 대신 나느라 배가 빨리 고픕니다.",
    effects: { wings: 42 },
  },
  {
    id: "strong_wings",
    name: "튼튼한 날개",
    desc: "더 멀리 잘 납니다. 날개가 커지고 조금 빨라집니다.",
    effects: { wings: 30, speed: 6 },
  },

  // 초음파 감각 — 눈 대신 귀. 시야를 잃는 대신 전방위(어둠·수풀 무관) 근거리 탐지(눈 vs 귀 트레이드오프).
  {
    id: "echo",
    name: "초음파",
    desc: "눈 대신 귀로 사방을 살핍니다. 시야가 줄지만 어둠·수풀에서도 사방의 가까운 것을 알아챕니다.",
    effects: { echo: 42, vision: -24 },
  },
  {
    id: "bat_ear",
    name: "박쥐의 귀",
    desc: "초음파에 완전히 의지합니다. 눈이 거의 멀지만 그만큼 사방을 아주 멀리까지 훤히 듣습니다.",
    effects: { echo: 48, vision: -30 },
  },

  // 전투 형질 (P5) — 독침(방어 독: 잡아먹으면 포식자 중독)·원거리(사거리). 기본 0 이라 큰 값(카드로 켜야 바뀐다).
  {
    id: "venom_fang",
    name: "독 살갗",
    desc: "몸에 독이 있어 잡아먹으려는 포식자가 중독됩니다. 잡아먹기 꺼려지는 먹이가 됩니다.",
    effects: { venom: 42 },
  },
  {
    id: "venom_gland",
    name: "독샘",
    desc: "독이 훨씬 강해집니다. 당신을 삼킨 포식자는 치명적으로 중독되지만, 독을 만드느라 몸이 약해 번식이 줍니다.",
    effects: { venom: 48, fertility: -6 },
  },
  {
    id: "long_horn",
    name: "가시 쏘기",
    desc: "날카로운 가시를 멀리 쏩니다. 붙지 않고 먼 거리에서 먹잇감을 맞혀 도망·반격 전에 잡습니다.",
    effects: { ranged: 42 },
  },
  {
    id: "spit",
    name: "독 가시",
    desc: "가시를 멀리 쏘고, 몸의 독으로 잡아먹는 포식자도 막습니다. 사거리와 방어 독이 함께 늡니다.",
    effects: { ranged: 26, venom: 22 },
  },
];

/** 풀에서 중복 없이 n장 뽑는다 (시드 RNG → 런마다 재현 가능). allow 로 잠긴 카드(메타 언락)를 걸러낸다. */
export function drawCards(rng: Rng, n: number, allow?: (id: string) => boolean): Card[] {
  const pool = (allow ? CARD_POOL.filter((c) => allow(c.id)) : CARD_POOL).slice();
  // Fisher-Yates 부분 셔플
  const count = Math.min(n, pool.length);
  for (let i = 0; i < count; i++) {
    const j = rng.int(i, pool.length - 1);
    const a = pool[i] as Card;
    const b = pool[j] as Card;
    pool[i] = b;
    pool[j] = a;
  }
  return pool.slice(0, count);
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
