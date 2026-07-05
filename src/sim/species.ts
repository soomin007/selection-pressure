// 종(Species) — 한 무리의 정체성. 내 종 1개 + 야생종 여러 개가 한 세계에 산다.
// 야생종은 환경 시드로 생성(아키타입 + 약간의 흔들림)되어 매 런 다르되 균형은 유지.
// 식성(diet): 0=초식(식물 섭취), 1=육식(다른 종 사냥). 0.5 초과면 육식.

import type { Rng } from "@/sim/rng";
import { defaultGenome, clampGenome, TRAIT_KEYS, type Genome, type Traits } from "@/sim/genome";
import { SIM } from "@/sim/params";
import type { Biome } from "@/sim/environment";

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
  /** 바이옴 특화종의 고향 바이옴(있으면). 이 바이옴 구역에만 스폰된다(사막 도마뱀=사막 등). 없으면 어디든. */
  homeBiome?: Biome;
  /** 비동기 생물(S2) — 지난 런의 내 종("예전의 나")이 이 세계에 다시 나타난 것. 렌더에서 왕관으로 표시. */
  champion?: boolean;
}

export function isCarnivore(genome: Genome): boolean {
  return genome.traits.diet > 50;
}

/** 챔피언(비동기 생물) 스폰에 필요한 최소 데이터 — sim 이 game/meta 에 의존하지 않도록 sim 계층에 둔다. */
export interface ChampionSeed {
  genome: Genome;
  name: string;
  color: number;
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
 * 비동기 생물(S2) — 지난 런의 내 종("예전의 나")이 다시 등장. 밸런스 안전을 위해 친척(kin)과 똑같은
 * 취급을 받는다: friendly + faction 1(내 편이라 서로 사냥·도망 안 함) + champion 표식. 독립 rng 로 소수만
 * 스폰(spawnChampions)하고, friendly 라 야생 보강·이주·진화 루프가 건드리지 않아(기존 친척과 동일) 메인
 * 밸런스에 안 걸린다. 게놈은 저장본(마이그레이션된) 그대로 — 예전 그 모습으로 살아난다.
 */
export function makeChampionSpecies(id: number, genome: Genome, name: string, color: number): Species {
  return {
    id,
    name,
    genome: clampGenome(genome),
    isPlayer: false,
    color,
    initialCount: SIM.championInitialCount,
    foodKinds: [0, 1, 2],
    friendly: true,
    faction: 1,
    champion: true,
  };
}

/**
 * 우호적 친척 종 — 내 종과 같은 곳에서 갈라진 듯한 온건한 잡식 무리(균형 잡힌 원형에서 조금 흔든다).
 * 내 종의 극단 형질을 물려받지 않는다 — 갈라진 친척은 제 갈 길을 가고(스포어식), 그래야 내 종과
 * 과경쟁하지 않는다. 서로 사냥하지 않고(friendly) 비슷한 초록색으로 "같은 편"임을 보인다. 초식쪽
 * 잡식이라 내 종(전 종류 잡식)보다 사냥을 안 하고, 위치는 내 종 보금자리 근처에 함께 태어난다.
 * 게놈은 독립 rng 로 만들어 메인 스트림(기존 밸런스)을 건드리지 않는다.
 */
// 친척이 플레이어(같은 데서 갈라진 무리)를 얼마나 닮는가.
const KIN_MOVE_FOLLOW = 0.9; // 이동/감각 특화(수영·날개·초음파): "나는 무리/헤엄치는 무리" 정체성이라 거의 그대로
const KIN_DIET_FOLLOW = 0.3; // 식성: 플레이어 방향을 약하게만 따른다(초식 우세 유지 — 내 종과 사냥 경쟁 완화)

/**
 * 우호적 친척 종 — 내 종과 "같은 데서 갈라진" 무리라, 시작 프리셋의 이동 방식을 닮는다(비행 프리셋이면
 * 친척도 날고, 바다면 헤엄치고, 초음파면 초음파). 반면 **능력치(속도·공격·시야·무리·대사·번식)는 플레이어와
 * 독립(균형 원형 50±10)** — 능력치까지 닮으면 같은 환경 압력을 함께 버텨 과경쟁하고, 극단 게놈에서 통과기준
 * 밸런스가 흔들린다(그래서 이동/감각/식성만 반영). 식성은 방향을 약하게 따르되 초식 우세로 당겨 사냥 경쟁을
 * 줄인다. 게놈은 독립 rng(-kin)로 만들고 rng 호출 횟수를 기존과 동일하게 유지해 스트림을 보존한다.
 */
export function makeKinSpecies(id: number, rng: Rng, playerGenome: Genome): Species {
  const p = playerGenome.traits;
  const g = defaultGenome();
  const blend = (v: number, follow: number): number => 50 + (v - 50) * follow;
  for (const key of TRAIT_KEYS) {
    if (key === "swimming" || key === "wings") {
      g.traits[key] = clampTrait(blend(p[key], KIN_MOVE_FOLLOW)); // 이동 정체성(50 기준). rng 없이 → 스트림 보존
      continue;
    }
    if (key === "echo" || key === "venom" || key === "ranged") {
      g.traits[key] = clampTrait(p[key] * KIN_MOVE_FOLLOW); // 감각·전투는 0 기준 특화. rng 없이 → 스트림 보존
      continue;
    }
    if (key === "diet") continue; // 아래서 따로
    // 능력치는 플레이어와 독립(기존과 동일 50±10) → 극단 게놈에서도 밸런스 이동 없음.
    g.traits[key] = clampTrait(50 + rng.range(-10, 10));
  }
  // 식성: 플레이어 방향을 약하게 따르되 초식 우세로 당긴다. 기본 플레이어(diet 50)면 30 = 기존 친척과
  // 동일 → 기본 밸런스 보존. 육식 프리셋이면 살짝 잡식쪽(친척다움)이되 사냥 경쟁은 억제.
  g.traits.diet = clampTrait(blend(p.diet, KIN_DIET_FOLLOW) - 20 + rng.range(-5, 5));
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
    traits: { diet: 15, fertility: 50, speed: 40, vision: 40, metabolism: 45, attack: 30, herding: 60 },
    faction: 2, // 초원 연합(들풀 무리·잡식 청소부와 같은 편 — 서로 안 싸움)
  },
  {
    // 들풀 무리 — 1번 먹이 전문. 약간 빠르고 큰 무리.
    name: "들풀 무리",
    color: 0x9a7ad6,
    initialCount: 12,
    foodKinds: [1],
    traits: { diet: 22, fertility: 48, speed: 46, vision: 45, metabolism: 50, attack: 28, herding: 60 },
    faction: 2, // 초원 연합
  },
  {
    // 작은 풀벌레 — 2번 먹이 전문. 다산형(r전략): 약하지만 빨리 불어나 잡아먹혀도 버틴다.
    name: "작은 풀벌레",
    color: 0xd6c24a,
    initialCount: 16,
    foodKinds: [2],
    traits: { diet: 12, fertility: 78, speed: 32, vision: 30, metabolism: 42, attack: 12, herding: 72 },
  },
  {
    // 느린 거북 — 0·2번 먹이. 저대사 장수형(K전략): 느리고 적게 낳지만 에너지를 거의 안 써 오래 버틴다.
    name: "느린 거북",
    color: 0x9aa0ab, // 돌회색(초록 계열 내 종·친척과 확실히 구분 — 등딱지 느낌)
    initialCount: 9,
    foodKinds: [0, 2],
    traits: { diet: 26, fertility: 36, speed: 22, vision: 34, metabolism: 28, attack: 52, herding: 30 },
  },
  {
    // 잡식 청소부 — 모든 먹이 + 약한 사냥. 먹이 유연성으로 틈새 생존.
    name: "잡식 청소부",
    color: 0xc88a4a,
    initialCount: 8,
    foodKinds: [0, 1, 2],
    traits: { diet: 50, fertility: 46, speed: 50, vision: 50, metabolism: 50, attack: 40, herding: 32 },
    faction: 2, // 초원 연합(사냥 성향이 있어 동맹 초식을 안 잡는 게 눈에 띈다)
  },
  {
    // 포식자 — 식물 안 먹음(육식). 먹잇감이 많아야 유지된다(붐버스트).
    name: "포식자",
    color: 0xe23b2e, // 선명한 빨강(위험 강조 + 잡식 청소부 주황과 구분)
    initialCount: 4,
    foodKinds: [],
    traits: { diet: 85, fertility: 30, speed: 66, vision: 60, metabolism: 50, attack: 70, herding: 40 },
  },
  {
    // 바다 풀뜯이 — 수륙양용(수영 0.75: 물+육지 다 다님). 바다 먹이를 전문으로 먹되 육지도 오간다.
    // 이동 차단으로 비수영 종이 못 따라오는 바다가 피난처. 플레이어가 수영을 찍으면 바다 자원 경쟁 시작.
    name: "바다 풀뜯이",
    color: 0xff7eb0, // 청록 바다 배경 위에서 잘 보이게 보색(밝은 산호 분홍) — 기존 종색과도 구분
    initialCount: 10,
    foodKinds: [],
    traits: { diet: 18, fertility: 55, speed: 50, vision: 50, metabolism: 42, attack: 20, herding: 45, swimming: 75 },
  },
  {
    // 물고기 떼 — 물 전용(수영 0.95 ≥ 0.9: 육지에 못 올라옴). 바다 먹이만 먹고 바다에서만 산다.
    // 다산형(물고기답게 알 많이). 바다 풀뜯이(양용)와 바다 먹이를 두고 경쟁하는 진짜 수생 거주자.
    name: "물고기 떼",
    color: 0x7fc0e8, // 밝은 물빛 파랑 — 청록 바다 배경에서 뜨고, 바다 풀뜯이(분홍)와 구분
    initialCount: 10,
    foodKinds: [],
    traits: { diet: 20, fertility: 70, speed: 45, vision: 40, metabolism: 45, attack: 15, herding: 60, swimming: 95 },
  },
];

/** 형질 값을 0~100 자연수로 강제(반올림 + 범위 클램프). */
const clampTrait = (v: number): number => {
  const n = Math.round(v);
  return n < 0 ? 0 : n > 100 ? 100 : n;
};

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
        g.traits.swimming = arch.traits.swimming ?? 50;
        continue;
      }
      if (key === "echo") {
        g.traits.echo = arch.traits.echo ?? 0; // 야생종 초음파 기본 없음. rng 없이 → rng 스트림 보존
        continue;
      }
      if (key === "wings") {
        g.traits.wings = arch.traits.wings ?? 0; // 야생종 날개 기본 없음(고산 종만 값). rng 없이 → rng 스트림 보존
        continue;
      }
      if (key === "venom" || key === "ranged") {
        g.traits[key] = arch.traits[key] ?? 0; // 야생종 전투 형질 기본 없음. rng 없이 → rng 스트림 보존
        continue;
      }
      const base = arch.traits[key] ?? 50;
      g.traits[key] = clampTrait(base + rng.range(-7, 7));
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

// 바이옴 특화 야생종 — 각자 고향 바이옴에만 산다(그 지형에 사는 특화 종이 보이면 "바이옴이 생물에 영향
// 준다"가 눈에 띈다). 대사가 정반대로 갈려(사막=저대사 더위 견딤, 빙하=고대사 추위 견딤) 엉뚱한 바이옴에
// 가면 힘들어한다. WILD_ARCHETYPES 와 별개로 두고 "독립 rng"로 생성·스폰 → 메인 스트림(밸런스) 보존.
interface BiomeArchetype extends Archetype {
  homeBiome: Biome;
}
// 바이옴 특화종은 "바이옴 전용 먹이"(먹이 종류 BIOME_FOOD_KIND)만 먹는 초식이다 — 내 종·야생과 먹이를 안
// 나눠(물고기의 깊은 바다 먹이처럼 격리) 육지 생태·통과기준을 안 건드리고, 제 바이옴에서 자생한다. 모두
// 초식(diet<사냥임계)이라 사냥으로 남을 건드리지도 않는다. 대사만 정반대로 갈려(사막=저대사·설원=고대사)
// 엉뚱한 바이옴에 가면 힘들어한다(빛나는 조건부 형질).
export const BIOME_FOOD_KIND = 3; // 0~2 는 일반 먹이(내 종·야생), 3 은 바이옴 전용(특화종만)
const BIOME_ARCHETYPES: readonly BiomeArchetype[] = [
  {
    // 사막 도마뱀 — 저대사(더위에 강함)로 뜨거운 사막에서 산다. 먹이 귀한 사막이라 멀리 보고 아껴 먹는다.
    name: "사막 도마뱀",
    homeBiome: "desert",
    color: 0xc85028, // 녹슨 주황빛 — 모래빛 사막 바탕에서 도드라진다
    initialCount: 8,
    foodKinds: [BIOME_FOOD_KIND],
    traits: { diet: 16, metabolism: 20, vision: 62, speed: 52, fertility: 46, attack: 26, herding: 24 },
  },
  {
    // 설원 큰곰 — 고대사(추위에 강함)로 추운 침엽수림에 산다(먹이 없는 빙하가 아니라 숲). 크고 드문 초식.
    name: "설원 큰곰",
    homeBiome: "taiga",
    color: 0x5a4634, // 짙은 갈색 — 서늘한 침엽수림 위에서 크게 대비
    initialCount: 6,
    foodKinds: [BIOME_FOOD_KIND],
    traits: { diet: 30, metabolism: 80, vision: 46, speed: 40, fertility: 40, attack: 34, herding: 34 },
  },
  {
    // 우림 새떼 — 먹이 넘치는 열대우림에서 빠르게 번식한다(다산). 무리 지어 다니는 화려한 새.
    name: "우림 새떼",
    homeBiome: "rainforest",
    color: 0xffcc40, // 밝은 열대 노랑 — 짙은 밀림 초록에서 확 튄다
    initialCount: 9,
    foodKinds: [BIOME_FOOD_KIND],
    traits: { diet: 18, metabolism: 46, vision: 46, speed: 52, fertility: 76, attack: 18, herding: 66 },
  },
];

/**
 * 바이옴 특화종들을 만든다(독립 rng 로 약간 흔들되 스트림은 호출부와 무관). id 는 기존 종들 뒤 고유값.
 * 실제 스폰(고향 바이옴 위치)은 world 가 맡는다 — 그 바이옴이 맵에 없으면 그 종은 이번 맵에 안 나온다.
 */
export function makeBiomeSpecies(startId: number, rng: Rng): Species[] {
  const out: Species[] = [];
  let id = startId;
  for (const arch of BIOME_ARCHETYPES) {
    const g = defaultGenome();
    for (const key of TRAIT_KEYS) {
      if (key === "swimming" || key === "echo" || key === "wings" || key === "venom" || key === "ranged") {
        g.traits[key] = arch.traits[key] ?? (key === "swimming" ? 50 : 0);
        continue;
      }
      g.traits[key] = clampTrait((arch.traits[key] ?? 50) + rng.range(-6, 6));
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
      faction: 0,
      homeBiome: arch.homeBiome,
    });
  }
  return out;
}
