// 종(Species) — 한 무리의 정체성. 내 종 1개 + 야생종 여러 개가 한 세계에 산다.
// 야생종은 환경 시드로 생성(아키타입 + 약간의 흔들림)되어 매 런 다르되 균형은 유지.
// 식성(diet): 0=초식(식물 섭취), 1=육식(다른 종 사냥). 0.5 초과면 육식.

import type { Rng } from "@/sim/rng";
import { defaultGenome, clampGenome, TRAIT_KEYS, type Genome, type Traits } from "@/sim/genome";
import { SIM } from "@/sim/params";

export interface Species {
  id: number;
  name: string;
  genome: Genome;
  isPlayer: boolean;
  color: number;
  initialCount: number;
  /** 먹을 수 있는 먹이 종류(0..K-1). 종마다 달라 경쟁을 분할한다. 빈 배열 = 식물 안 먹음(순수 육식). */
  foodKinds: number[];
  /** 우호 종(내 종에서 갈라진 친척) — 렌더에서 내 편임을 청록 고리로 표시하는 데 쓴다. */
  friendly: boolean;
  /**
   * 편(우호 그룹). 0 = 무소속(중립). 같은 편(faction ≠ 0 이고 값이 같음)끼리는 서로 사냥·도망하지
   * 않는다(스포어식 동맹). 내 종 + 친척 = 1편, 야생 동맹 = 2편. 야생끼리 편을 맺어도 내 종 무리
   * (cohesion·통과기준)를 안 건드려 밸런스가 안전하다.
   */
  faction: number;
}

export function isCarnivore(genome: Genome): boolean {
  return genome.traits.diet > 0.5;
}

/** 두 종이 같은 편(서로 사냥/도망 대상에서 제외)인지 — 내 종↔친척, 야생 동맹끼리 모두 이 하나로 판정. */
export function areFriends(a: Species, b: Species): boolean {
  return a.faction !== 0 && a.faction === b.faction;
}

export function makePlayerSpecies(genome: Genome, initialCount: number): Species {
  // 내 종(잡식)은 일반종 — 모든 먹이 종류를 먹는다(전문 야생종 사이의 틈새). 친척과 같은 1편.
  return { id: 0, name: "내 종", genome, isPlayer: true, color: 0x6cc24a, initialCount, foodKinds: [0, 1, 2], friendly: false, faction: 1 };
}

/**
 * 우호적 친척 종 — 내 종과 같은 곳에서 갈라진 듯한 온건한 잡식 무리(균형 잡힌 원형에서 조금 흔든다).
 * 내 종의 극단 형질을 물려받지 않는다 — 갈라진 친척은 제 갈 길을 가고(스포어식), 그래야 내 종과
 * 과경쟁하지 않는다. 서로 사냥하지 않고(friendly) 비슷한 초록색으로 "같은 편"임을 보인다. 초식쪽
 * 잡식이라 내 종(전 종류 잡식)보다 사냥을 안 하고, 위치는 내 종 보금자리 근처에 함께 태어난다.
 * 게놈은 독립 rng 로 만들어 메인 스트림(기존 밸런스)을 건드리지 않는다.
 */
export function makeKinSpecies(id: number, rng: Rng): Species {
  const g = defaultGenome();
  for (const key of TRAIT_KEYS) {
    if (key === "swimming") {
      g.traits.swimming = 0.5; // 친척은 육상(내 종 옆에서 함께)
      continue;
    }
    g.traits[key] = clamp01(0.5 + rng.range(-0.1, 0.1)); // 균형 원형에서 미세하게만 흔든다
  }
  g.traits.diet = clamp01(0.3 + rng.range(-0.05, 0.05)); // 초식쪽(내 종과 먹이 경쟁·사냥 완화)
  return {
    id,
    name: "친척 무리",
    genome: clampGenome(g),
    isPlayer: false,
    friendly: true,
    color: 0x3fbf8f, // 내 종 초록과 같은 계열의 민트 초록(같은 편 느낌 + 구분)
    initialCount: SIM.kinInitialCount,
    foodKinds: [0, 1],
    faction: 1, // 내 종과 같은 편(서로 안 싸움)
  };
}

interface Archetype {
  name: string;
  color: number;
  initialCount: number;
  traits: Partial<Traits>;
  foodKinds: number[];
  faction?: number; // 편(우호 그룹). 생략=0(중립). 같은 값 야생끼리 동맹(서로 안 싸움).
}

// 야생 아키타입 6종. 같은 먹이를 두고 똑같이 경쟁하면 한둘만 남으므로(경쟁 배제),
// "생존 전략"을 서로 다르게 둔다 — 다산형 / 저대사 장수형 / 잡식 / 포식자 등.
const WILD_ARCHETYPES: readonly Archetype[] = [
  {
    // 초식 경쟁자 — 0번 먹이 전문.
    name: "초식 경쟁자",
    color: 0x4a86e0, // 선명한 파랑(물고기떼 하늘색과 구분)
    initialCount: 12,
    foodKinds: [0],
    traits: { diet: 0.15, fertility: 0.5, speed: 0.4, vision: 0.4, metabolism: 0.45, attack: 0.3, herding: 0.6 },
    faction: 2, // 초원 연합(들풀 무리·잡식 청소부와 같은 편 — 서로 안 싸움)
  },
  {
    // 들풀 무리 — 1번 먹이 전문. 약간 빠르고 큰 무리.
    name: "들풀 무리",
    color: 0x9a7ad6,
    initialCount: 12,
    foodKinds: [1],
    traits: { diet: 0.22, fertility: 0.48, speed: 0.46, vision: 0.45, metabolism: 0.5, attack: 0.28, herding: 0.6 },
    faction: 2, // 초원 연합
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
    color: 0x9aa0ab, // 돌회색(초록 계열 내 종·친척과 확실히 구분 — 등딱지 느낌)
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
    faction: 2, // 초원 연합(사냥 성향이 있어 동맹 초식을 안 잡는 게 눈에 띈다)
  },
  {
    // 포식자 — 식물 안 먹음(육식). 먹잇감이 많아야 유지된다(붐버스트).
    name: "포식자",
    color: 0xe23b2e, // 선명한 빨강(위험 강조 + 잡식 청소부 주황과 구분)
    initialCount: 4,
    foodKinds: [],
    traits: { diet: 0.85, fertility: 0.3, speed: 0.66, vision: 0.6, metabolism: 0.5, attack: 0.7, herding: 0.4 },
  },
  {
    // 바다 풀뜯이 — 수륙양용(수영 0.75: 물+육지 다 다님). 바다 먹이를 전문으로 먹되 육지도 오간다.
    // 이동 차단으로 비수영 종이 못 따라오는 바다가 피난처. 플레이어가 수영을 찍으면 바다 자원 경쟁 시작.
    name: "바다 풀뜯이",
    color: 0xff7eb0, // 청록 바다 배경 위에서 잘 보이게 보색(밝은 산호 분홍) — 기존 종색과도 구분
    initialCount: 10,
    foodKinds: [],
    traits: { diet: 0.18, fertility: 0.55, speed: 0.5, vision: 0.5, metabolism: 0.42, attack: 0.2, herding: 0.45, swimming: 0.75 },
  },
  {
    // 물고기 떼 — 물 전용(수영 0.95 ≥ 0.9: 육지에 못 올라옴). 바다 먹이만 먹고 바다에서만 산다.
    // 다산형(물고기답게 알 많이). 바다 풀뜯이(양용)와 바다 먹이를 두고 경쟁하는 진짜 수생 거주자.
    name: "물고기 떼",
    color: 0x7fc0e8, // 밝은 물빛 파랑 — 청록 바다 배경에서 뜨고, 바다 풀뜯이(분홍)와 구분
    initialCount: 10,
    foodKinds: [],
    traits: { diet: 0.2, fertility: 0.7, speed: 0.45, vision: 0.4, metabolism: 0.45, attack: 0.15, herding: 0.6, swimming: 0.95 },
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
      friendly: false,
      faction: arch.faction ?? 0, // 동맹 아키타입만 편(faction)을 갖고, 나머지는 중립(0)
    });
  }
  return out;
}
