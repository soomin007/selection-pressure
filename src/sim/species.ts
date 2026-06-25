// 종(Species) — 한 무리의 정체성. 내 종 1개 + 야생종 여러 개가 한 세계에 산다.
// 야생종은 환경 시드로 생성(아키타입 + 약간의 흔들림)되어 매 런 다르되 균형은 유지.
// 식성(diet): 0=초식(식물 섭취), 1=육식(다른 종 사냥). 0.5 초과면 육식.

import type { Rng } from "@/sim/rng";
import { defaultGenome, clampGenome, TRAIT_KEYS, type Genome, type Traits } from "@/sim/genome";

export interface Species {
  id: number;
  name: string;
  genome: Genome;
  isPlayer: boolean;
  color: number;
  initialCount: number;
}

export function isCarnivore(genome: Genome): boolean {
  return genome.traits.diet > 0.5;
}

export function makePlayerSpecies(genome: Genome, initialCount: number): Species {
  return { id: 0, name: "내 종", genome, isPlayer: true, color: 0x6cc24a, initialCount };
}

interface Archetype {
  name: string;
  color: number;
  initialCount: number;
  traits: Partial<Traits>;
}

// 야생 아키타입 6종. 같은 먹이를 두고 똑같이 경쟁하면 한둘만 남으므로(경쟁 배제),
// "생존 전략"을 서로 다르게 둔다 — 다산형 / 저대사 장수형 / 잡식 / 포식자 등.
const WILD_ARCHETYPES: readonly Archetype[] = [
  {
    // 초식 경쟁자 — 무난한 초식, 무리 지음.
    name: "초식 경쟁자",
    color: 0x46a6c8,
    initialCount: 12,
    traits: { diet: 0.15, fertility: 0.5, speed: 0.4, vision: 0.4, metabolism: 0.45, attack: 0.3, herding: 0.6 },
  },
  {
    // 들풀 무리 — 약간 빠르고 큰 무리.
    name: "들풀 무리",
    color: 0x9a7ad6,
    initialCount: 12,
    traits: { diet: 0.22, fertility: 0.48, speed: 0.46, vision: 0.45, metabolism: 0.5, attack: 0.28, herding: 0.6 },
  },
  {
    // 작은 풀벌레 — 다산형(r전략): 약하지만 빨리 불어나 잡아먹혀도 버틴다(먹이사슬 바닥).
    name: "작은 풀벌레",
    color: 0xd6c24a,
    initialCount: 16,
    traits: { diet: 0.12, fertility: 0.78, speed: 0.32, vision: 0.3, metabolism: 0.42, attack: 0.12, herding: 0.72 },
  },
  {
    // 느린 거북 — 저대사 장수형(K전략): 느리고 적게 낳지만 에너지를 거의 안 써 오래 버틴다.
    name: "느린 거북",
    color: 0x5fae6a,
    initialCount: 9,
    traits: { diet: 0.26, fertility: 0.36, speed: 0.22, vision: 0.34, metabolism: 0.28, attack: 0.52, herding: 0.3 },
  },
  {
    // 잡식 청소부 — 식물도 먹고 약한 사냥도 한다. 먹이 유연성으로 틈새 생존.
    name: "잡식 청소부",
    color: 0xc88a4a,
    initialCount: 8,
    traits: { diet: 0.5, fertility: 0.46, speed: 0.5, vision: 0.5, metabolism: 0.5, attack: 0.4, herding: 0.32 },
  },
  {
    // 포식자 — 빠르고 사납다(육식). 먹잇감이 많아야 유지된다(붐버스트).
    name: "포식자",
    color: 0xe0653a,
    initialCount: 4,
    traits: { diet: 0.85, fertility: 0.3, speed: 0.66, vision: 0.6, metabolism: 0.5, attack: 0.7, herding: 0.4 },
  },
];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 야생종 목록 생성 (시드로 약간씩 흔들어 매 런 다르게). */
export function generateWildSpecies(rng: Rng): Species[] {
  const out: Species[] = [];
  let id = 1;
  for (const arch of WILD_ARCHETYPES) {
    const g = defaultGenome();
    for (const key of TRAIT_KEYS) {
      const base = arch.traits[key] ?? 0.5;
      g.traits[key] = clamp01(base + rng.range(-0.07, 0.07));
    }
    out.push({
      id: id++,
      name: arch.name,
      genome: clampGenome(g),
      isPlayer: false,
      color: arch.color,
      initialCount: arch.initialCount,
    });
  }
  return out;
}
