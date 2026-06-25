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

// 야생 아키타입: 초식 경쟁자 둘(먹이 경쟁) + 포식자 하나.
const WILD_ARCHETYPES: readonly Archetype[] = [
  {
    name: "초식 경쟁자",
    color: 0x46a6c8,
    initialCount: 14,
    traits: { diet: 0.15, fertility: 0.48, speed: 0.4, vision: 0.4, metabolism: 0.45, attack: 0.3, herding: 0.6 },
  },
  {
    name: "들풀 무리",
    color: 0x9a7ad6,
    initialCount: 12,
    traits: { diet: 0.2, fertility: 0.45, speed: 0.46, vision: 0.45, metabolism: 0.5, attack: 0.28, herding: 0.5 },
  },
  {
    name: "포식자",
    color: 0xe0653a,
    initialCount: 4,
    traits: { diet: 0.85, fertility: 0.28, speed: 0.66, vision: 0.6, metabolism: 0.5, attack: 0.7, herding: 0.4 },
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
