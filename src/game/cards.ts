// 카드 = 종 게놈에 누적 적용되는 형질 변화. 런 내 영구, 런 종료 시 리셋(로그라이크).
// 매 라운드 풀에서 무작위 3장 후보(운 요소). 트레이드오프 카드로 "특화 vs 헷지" 결정을 만든다.
// 문구는 쉬운 말로 (UI 규칙).
//
// effects = 누적 가감. set = 절대값 지정(시작 식성 선택용). 둘 다 적용 후 [0,1] 클램프.

import type { Rng } from "@/sim/rng";
import type { Genome, Traits } from "@/sim/genome";

export interface Card {
  id: string;
  name: string;
  desc: string;
  effects: Partial<Record<keyof Traits, number>>;
  set?: Partial<Record<keyof Traits, number>>;
}

// 런 첫 드래프트 — 시작 식성을 정한다. (반대 형질을 나중에 얻으면 잡식이 된다)
export const DIET_CHOICE_CARDS: readonly Card[] = [
  {
    id: "start_herb",
    name: "초식 동물",
    desc: "식물을 먹습니다. 다툼을 피하고 수로 버팁니다.",
    set: { diet: 0.2 },
    effects: { fertility: 0.06 },
  },
  {
    id: "start_omni",
    name: "잡식 동물",
    desc: "식물도 먹고 사냥도 합니다. 균형 잡힌 시작.",
    set: { diet: 0.5 },
    effects: { vision: 0.07 },
  },
  {
    id: "start_carn",
    name: "육식 동물",
    desc: "주로 사냥합니다. 모자라면 식물도 먹습니다.",
    set: { diet: 0.65 },
    effects: { attack: 0.12 },
  },
];

export const CARD_POOL: readonly Card[] = [
  // 단일 형질
  { id: "swift", name: "날쌘 다리", desc: "더 빨리 움직입니다.", effects: { speed: 0.15 } },
  { id: "keen", name: "넓은 시야", desc: "먹이를 더 멀리서 봅니다.", effects: { vision: 0.15 } },
  {
    id: "thrifty",
    name: "느린 대사",
    desc: "에너지를 적게 씁니다. 따뜻한 땅·폭염·대가뭄에 유리합니다.",
    effects: { metabolism: -0.14 },
  },
  {
    id: "hotblood",
    name: "뜨거운 피",
    desc: "추위를 잘 견딥니다. 대신 에너지를 더 씁니다. 추운 땅·한파에 유리합니다.",
    effects: { metabolism: 0.14 },
  },
  { id: "fertile", name: "다산", desc: "더 자주 새끼를 칩니다.", effects: { fertility: 0.16 } },
  {
    id: "herd",
    name: "무리 본능",
    desc: "함께 모여 다니고, 모이면 서로 보온합니다(추위에 유리).",
    effects: { herding: 0.18 },
  },

  // 조합 (작은 상승 두 개)
  {
    id: "adapt",
    name: "적응",
    desc: "속도와 시야가 조금씩 늡니다.",
    effects: { speed: 0.08, vision: 0.08 },
  },
  {
    id: "eagle_eye",
    name: "매의 눈",
    desc: "시야가 넓어지고 조금 빨라집니다.",
    effects: { vision: 0.2, speed: 0.05 },
  },
  {
    id: "pack_hunt",
    name: "무리 사냥",
    desc: "무리 성향과 속도가 함께 늡니다.",
    effects: { herding: 0.12, speed: 0.08 },
  },
  {
    id: "warm_pack",
    name: "옹기종기",
    desc: "무리 보온이 강해지고 추위에 강해집니다.",
    effects: { herding: 0.14, metabolism: 0.06 },
  },

  // 트레이드오프 (큰 상승 + 작은 대가)
  {
    id: "sprint",
    name: "질주 본능",
    desc: "훨씬 빨라지지만 에너지를 더 씁니다.",
    effects: { speed: 0.22, metabolism: 0.07 },
  },
  {
    id: "hunter_eye",
    name: "사냥꾼의 눈",
    desc: "시야가 크게 넓어지지만 번식이 줍니다.",
    effects: { vision: 0.24, fertility: -0.06 },
  },
  {
    id: "brood",
    name: "둥지 본능",
    desc: "번식이 크게 늘지만 느려집니다.",
    effects: { fertility: 0.22, speed: -0.07 },
  },
  {
    id: "loner",
    name: "외톨이",
    desc: "흩어져 빠르게 움직입니다. 무리 성향은 줄어듭니다.",
    effects: { speed: 0.13, herding: -0.18 },
  },
  {
    id: "giant",
    name: "느긋한 거인",
    desc: "에너지를 아주 적게 쓰지만 느려집니다.",
    effects: { metabolism: -0.18, speed: -0.06 },
  },
  {
    id: "furnace",
    name: "왕성한 대사",
    desc: "추위에 아주 강하고 번식도 늘지만 에너지를 많이 씁니다.",
    effects: { metabolism: 0.2, fertility: 0.05 },
  },

  // 공격성·식성 (다종 생태계)
  {
    id: "fangs",
    name: "송곳니",
    desc: "공격력이 늡니다. 사냥에 강하고 포식자에 덜 쫓깁니다.",
    effects: { attack: 0.18 },
  },
  {
    id: "savage",
    name: "사나운 이빨",
    desc: "공격력이 크게 늘고 조금 빨라집니다.",
    effects: { attack: 0.24, speed: 0.05 },
  },
  {
    id: "predator",
    name: "포식 본능",
    desc: "육식으로 기웁니다. 다른 종을 사냥해 먹습니다.",
    effects: { diet: 0.22, attack: 0.06 },
  },
  {
    id: "grazer",
    name: "초식 본능",
    desc: "초식으로 기웁니다. 식물을 먹고 다툼을 피합니다.",
    effects: { diet: -0.22, fertility: 0.05 },
  },

  // 특화 진화 — 큰 변화 + 뚜렷한 대가. 빌드 정체성을 만든다(드래프트가 매번 다르게).
  {
    id: "cheetah",
    name: "치타의 다리",
    desc: "엄청나게 빨라지지만 번식이 줍니다.",
    effects: { speed: 0.28, fertility: -0.1 },
  },
  {
    id: "great_fangs",
    name: "거대 송곳니",
    desc: "공격력이 크게 늘지만 굼떠집니다.",
    effects: { attack: 0.26, speed: -0.08 },
  },
  {
    id: "ambush",
    name: "매복 사냥꾼",
    desc: "멀리서 보고 덮칩니다. 시야와 공격력이 함께 늡니다.",
    effects: { vision: 0.14, attack: 0.14 },
  },
  {
    id: "locust",
    name: "메뚜기 떼",
    desc: "폭발적으로 불어납니다. 대신 한 마리는 약해집니다.",
    effects: { fertility: 0.28, attack: -0.06 },
  },
  {
    id: "thick_fur",
    name: "두꺼운 털가죽",
    desc: "추위에 아주 강하고 함께 모입니다.",
    effects: { metabolism: 0.16, herding: 0.12 },
  },
  {
    id: "all_rounder",
    name: "균형 진화",
    desc: "속도·시야·번식이 고루 조금씩 늡니다.",
    effects: { speed: 0.08, vision: 0.08, fertility: 0.08 },
  },
  {
    id: "ascetic",
    name: "고행자",
    desc: "에너지를 거의 안 쓰고 멀리 봅니다. 대신 느립니다.",
    effects: { metabolism: -0.2, vision: 0.1, speed: -0.06 },
  },
];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 풀에서 중복 없이 n장 뽑는다 (시드 RNG → 런마다 재현 가능). */
export function drawCards(rng: Rng, n: number): Card[] {
  const pool = CARD_POOL.slice();
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

/** 카드 효과를 게놈에 그 자리에서 적용 + [0,1] 클램프. (공유 게놈이라 즉시 반영) */
export function applyCard(genome: Genome, card: Card): void {
  if (card.set) {
    for (const key of Object.keys(card.set) as (keyof Traits)[]) {
      genome.traits[key] = clamp01(card.set[key] ?? genome.traits[key]);
    }
  }
  for (const key of Object.keys(card.effects) as (keyof Traits)[]) {
    const delta = card.effects[key] ?? 0;
    genome.traits[key] = clamp01(genome.traits[key] + delta);
  }
}
