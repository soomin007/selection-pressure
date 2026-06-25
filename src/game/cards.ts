// 카드 = 종 게놈에 누적 적용되는 형질 변화. 런 내 영구, 런 종료 시 리셋(로그라이크).
// 매 라운드 풀에서 무작위 3장 후보(운 요소). 트레이드오프 카드로 "특화 vs 헷지" 결정을 만든다.
// 문구는 쉬운 말로 (UI 규칙). 현재 행동에 연결된 형질(속도/시야/대사/번식력)만 다룬다.
// 공격력/무리/식성 카드는 그 행동이 붙는 Phase 5 에서 추가.

import type { Rng } from "@/sim/rng";
import type { Genome, Traits } from "@/sim/genome";

export interface Card {
  id: string;
  name: string;
  desc: string;
  effects: Partial<Record<keyof Traits, number>>;
}

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

/** 카드 효과를 게놈에 그 자리에서 누적 적용 + [0,1] 클램프. (공유 게놈이라 즉시 반영) */
export function applyCard(genome: Genome, card: Card): void {
  for (const key of Object.keys(card.effects) as (keyof Traits)[]) {
    const delta = card.effects[key] ?? 0;
    genome.traits[key] = clamp01(genome.traits[key] + delta);
  }
}
