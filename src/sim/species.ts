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
  /** 먹을 수 있는 먹이 종류(0..K-1). 종마다 달라 경쟁을 분할한다. 빈 배열 = 식물 안 먹음(순수 육식). */
  foodKinds: number[];
}

export function isCarnivore(genome: Genome): boolean {
  return genome.traits.diet > 0.5;
}

export function makePlayerSpecies(genome: Genome, initialCount: number): Species {
  // 내 종(잡식)은 일반종 — 모든 먹이 종류를 먹는다(전문 야생종 사이의 틈새).
  return { id: 0, name: "내 종", genome, isPlayer: true, color: 0x6cc24a, initialCount, foodKinds: [0, 1, 2] };
}

interface Archetype {
  name: string;
  color: number;
  initialCount: number;
  traits: Partial<Traits>;
  foodKinds: number[];
}

// 야생 아키타입 6종. 같은 먹이를 두고 똑같이 경쟁하면 한둘만 남으므로(경쟁 배제),
// "생존 전략"을 서로 다르게 둔다 — 다산형 / 저대사 장수형 / 잡식 / 포식자 등.
const WILD_ARCHETYPES: readonly Archetype[] = [
  {
    // 초식 경쟁자 — 0번 먹이 전문.
    name: "초식 경쟁자",
    color: 0x46a6c8,
    initialCount: 12,
    foodKinds: [0],
    traits: { diet: 0.15, fertility: 0.5, speed: 0.4, vision: 0.4, metabolism: 0.45, attack: 0.3, herding: 0.6 },
  },
  {
    // 들풀 무리 — 1번 먹이 전문. 약간 빠르고 큰 무리.
    name: "들풀 무리",
    color: 0x9a7ad6,
    initialCount: 12,
    foodKinds: [1],
    traits: { diet: 0.22, fertility: 0.48, speed: 0.46, vision: 0.45, metabolism: 0.5, attack: 0.28, herding: 0.6 },
  },
  {
    // 작은 풀벌레 — 2번 먹이 전문. 다산형(r전략): 약하지만 빨리 불어나 잡아먹혀도 버틴다.
    name: "작은 풀벌레",
    color: 0xd6c24a,
    initialCount: 16,
    foodKinds: [2],
    traits: { diet: 0.12, fertility: 0.78, speed: 0.32, vision: 0.3, metabolism: 0.42, attack: 0.12, herding: 0.72 },
  },
  {
    // 느린 거북 — 0·2번 먹이. 저대사 장수형(K전략): 느리고 적게 낳지만 에너지를 거의 안 써 오래 버틴다.
    name: "느린 거북",
    color: 0x5fae6a,
    initialCount: 9,
    foodKinds: [0, 2],
    traits: { diet: 0.26, fertility: 0.36, speed: 0.22, vision: 0.34, metabolism: 0.28, attack: 0.52, herding: 0.3 },
  },
  {
    // 잡식 청소부 — 모든 먹이 + 약한 사냥. 먹이 유연성으로 틈새 생존.
    name: "잡식 청소부",
    color: 0xc88a4a,
    initialCount: 8,
    foodKinds: [0, 1, 2],
    traits: { diet: 0.5, fertility: 0.46, speed: 0.5, vision: 0.5, metabolism: 0.5, attack: 0.4, herding: 0.32 },
  },
  {
    // 포식자 — 식물 안 먹음(육식). 먹잇감이 많아야 유지된다(붐버스트).
    name: "포식자",
    color: 0xe0653a,
    initialCount: 4,
    foodKinds: [],
    traits: { diet: 0.85, fertility: 0.3, speed: 0.66, vision: 0.6, metabolism: 0.5, attack: 0.7, herding: 0.4 },
  },
  {
    // 바다 풀뜯이 — 수영 형질로 바다 먹이(무경쟁 틈새)를 전문으로 먹는다. 육지 식물(foodKinds=[])은
    // 안 먹어 다른 초식종과 경쟁하지 않고, 바다라는 별도 무대에서 산다(이동 차단으로 비수영 종이 못
    // 따라오는 피난처). 플레이어가 수영을 찍으면 그제야 이 바다 자원을 두고 경쟁이 시작된다.
    name: "바다 풀뜯이",
    color: 0xff7eb0, // 청록 바다 배경 위에서 잘 보이게 보색(밝은 산호 분홍) — 기존 종색과도 구분
    initialCount: 10,
    foodKinds: [],
    traits: { diet: 0.18, fertility: 0.55, speed: 0.5, vision: 0.5, metabolism: 0.42, attack: 0.2, herding: 0.45, swimming: 0.75 },
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
      // swimming 은 아직 야생종에 안 쓰므로 rng 없이 기본값 유지 — 기존 rng 스트림 보존(밸런스 불변).
      // (나중에 수생 야생종을 넣을 때 아키타입에 swimming 을 주면 된다.)
      if (key === "swimming") {
        g.traits.swimming = arch.traits.swimming ?? 0.5;
        continue;
      }
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
      foodKinds: arch.foodKinds.slice(),
    });
  }
  return out;
}
