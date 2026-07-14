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
  // (v7: 종 단위 `bodyScale`(렌더 전용 몸 크기 배율)은 제거됐다 — 몸집(size) **형질**이 그 일을 하고,
  //  개체별 게놈 값이라 같은 종 안에서도 큰 놈·작은 놈이 갈린다. 외형과 시뮬이 한 값에서 나온다.)
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
    if (key === "echo" || key === "venom" || key === "ranged" || key === "camouflage") {
      g.traits[key] = clampTrait(p[key] * KIN_MOVE_FOLLOW); // 감각·전투는 0 기준 특화. rng 없이 → 스트림 보존
      continue;
    }
    if (key === "size") {
      // 몸집은 50(중립) 기준으로 플레이어를 약하게 따른다 — 친척이니 체격이 닮는다. rng 없이 → 스트림 보존.
      g.traits[key] = clampTrait(blend(p[key], KIN_MOVE_FOLLOW));
      continue;
    }
    if (key === "diet") continue; // 아래서 따로
    // 능력치는 플레이어와 독립(기존과 동일 50±10) → 극단 게놈에서도 밸런스 이동 없음.
    // ⚠ herding 은 v7 에서 능력 형질이 됐지만 **여기서는 계속 rng 로 뽑는다**(50±10). 두 가지 이유:
    //   ① 친척 무리는 "뭉쳐 다니는 종"이라는 성격을 유지해야 한다(뭉침·보온은 종 성격이지 플레이어 빌드가 아니다).
    //   ② 여기서 herding 을 rng 없이 설정하면 **rng 소비가 한 칸 줄어 스트림이 밀린다** — 밸런스가 통째로 이동한다.
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
    traits: { diet: 15, fertility: 50, speed: 40, vision: 40, metabolism: 45, attack: 30, herding: 60, size: 50 },
    faction: 2, // 초원 연합(들풀 무리·잡식 청소부와 같은 편 — 서로 안 싸움)
  },
  {
    // 들풀 무리 — 1번 먹이 전문. 약간 빠르고 큰 무리.
    name: "들풀 무리",
    color: 0x9a7ad6,
    initialCount: 12,
    foodKinds: [1],
    traits: { diet: 22, fertility: 48, speed: 46, vision: 45, metabolism: 50, attack: 28, herding: 60, size: 46 },
    faction: 2, // 초원 연합
  },
  {
    // 작은 풀벌레 — 2번 먹이 전문. 다산형(r전략): 약하지만 빨리 불어나 잡아먹혀도 버틴다.
    name: "작은 풀벌레",
    color: 0xd6c24a,
    initialCount: 16,
    foodKinds: [2],
    traits: { diet: 12, fertility: 78, speed: 32, vision: 30, metabolism: 42, attack: 12, herding: 72, size: 30 },
  },
  {
    // 느린 거북 — 0·2번 먹이. 저대사 장수형(K전략): 느리고 적게 낳지만 에너지를 거의 안 써 오래 버틴다.
    name: "느린 거북",
    color: 0x9aa0ab, // 돌회색(초록 계열 내 종·친척과 확실히 구분 — 등딱지 느낌)
    initialCount: 9,
    foodKinds: [0, 2],
    traits: { diet: 26, fertility: 36, speed: 22, vision: 34, metabolism: 28, attack: 52, herding: 30, size: 68 },
  },
  {
    // 잡식 청소부 — 모든 먹이 + 약한 사냥. 먹이 유연성으로 틈새 생존.
    name: "잡식 청소부",
    color: 0xc88a4a,
    initialCount: 8,
    foodKinds: [0, 1, 2],
    traits: { diet: 50, fertility: 46, speed: 50, vision: 50, metabolism: 50, attack: 40, herding: 32, size: 50 },
    faction: 2, // 초원 연합(사냥 성향이 있어 동맹 초식을 안 잡는 게 눈에 띈다)
  },
  {
    // 포식자 — 식물 안 먹음(육식). 먹잇감이 많아야 유지된다(붐버스트).
    name: "포식자",
    color: 0xe23b2e, // 선명한 빨강(위험 강조 + 잡식 청소부 주황과 구분)
    initialCount: 4,
    foodKinds: [],
    // ⚠ 몸집은 **기준선 50 을 유지한다.** 64 로 키웠더니 sizeBiteWeight(1.4) 때문에 내 종을 무는
    // 즉사 확률이 0.64 → 0.93 으로 뛰어 대멸종 필터·개체 진화 테스트가 통째로 깨졌다(내 종 몰살).
    // "큰 맹수"는 그럴듯하지만 포식자의 체급은 이 게임 밸런스의 기준점이다 — 여기만은 건드리지 않는다.
    traits: { diet: 85, fertility: 30, speed: 66, vision: 60, metabolism: 50, attack: 70, herding: 40, size: 50 },
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
      if (key === "size" || key === "camouflage") {
        // v7 형질. 몸집은 중립 50, 은신은 없음 0 이 기본 — 아키타입이 값을 주면 그것을 쓴다.
        // **rng 없이** 설정하는 게 핵심이다. 여기서 rng 를 뽑으면 스트림이 두 칸 밀려 야생 생태가
        // 통째로 이동한다(known_issues: rng 스트림을 늘리면 분포가 통째로 이동).
        g.traits[key] = arch.traits[key] ?? (key === "size" ? 50 : 0);
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

// ───────────────────────────── 맵 종류별 야생종 ─────────────────────────────
//
// 세계마다 사는 것이 달라야 세계가 다르다. 그리고 더 중요한 이유가 있다 — **지금 바다에는 포식자가
// 하나도 없다.** 야생 포식자(diet 85)는 수영이 기본 50 이라 물에 못 들어가고, 바다에 사는 둘(바다
// 풀뜯이·물고기 떼)은 초식이다. 그래서 바다는 "먹이만 있고 위험이 전혀 없는 곳"이었고, 그게 바다
// 개척자가 어느 맵에서든 압도적이던 진짜 이유다(프로브: 군도에서 도달 5.8/6).
//
// 그래서 물이 많은 세계에는 **바다 포식자**를 넣는다. 물 전용(수영 ≥ aquaticOnlyThreshold)이라 뭍에는
// 못 올라온다 — 헤엄치는 종은 물에서 쫓기되 뭍으로 도망칠 수 있다(읽히는 규칙).
//
// ⚠ WILD_ARCHETYPES 에 직접 넣으면 generateWildSpecies 의 rng 스트림이 늘어 기존 밸런스가 통째로
// 이동한다(known_issues). 그래서 바이옴 특화종과 똑같이 **독립 rng**로 만들고 스폰한다.
interface MapArchetype extends Archetype {
  /** 물에 사는 종인가 — true 면 큰 바다에 스폰한다(육지 스폰이면 물 전용 종이 갇혀 죽는다). */
  aquatic?: boolean;
  /** 산 위에 사는 종인가(비행) — true 면 산 근처에 스폰한다. */
  mountainous?: boolean;
}

export const MAP_ARCHETYPES: Record<string, readonly MapArchetype[]> = {
  // 대륙에는 아직 맵 전용 종을 안 둔다 — 여긴 **밸런스 기준선**이고 이미 야생 6종 + 바이옴 특화 3종이
  // 산다(네 세계 중 가장 붐빈다). 들소 무리를 넣어 봤더니 육지 먹이를 나눠 먹어 대륙이 실제로 빡빡해졌고,
  // **보스 통과기준 테스트가 깨졌다**(잘 성장한 무리가 사나운 무리를 못 넘김). 시작 프리셋이 이미 약한
  // 상태라 대륙을 더 조이는 건 방향이 반대다. 프리셋 밸런스를 잡은 뒤에 대륙 고유종을 넣는다.
  continent: [],
  pangaea: [
    {
      // 고산 독수리 — 산맥 위를 도는 큰 새. 고산 먹이를 두고 날개 종과 다툰다(판게아는 산맥의 세계).
      name: "고산 독수리",
      color: 0xe8d8b0, // 눈 덮인 산 위에서 도드라지는 밝은 상아빛
      // 셋이면 충분하다 — 다섯이면 산 위 먹이를 거의 다 먹어치워 날개 종이 되레 못 산다(프로브: 4.3→2.1).
      // 경쟁자는 "몫을 나누는" 정도여야지 "틈새를 없애는" 정도면 그 갈래가 죽는다.
      initialCount: 3,
      foodKinds: [],
      traits: { diet: 22, fertility: 30, speed: 62, vision: 76, metabolism: 55, attack: 40, herding: 20, wings: 74 },
      mountainous: true,
    },
    // (늑대 무리는 뺐다 — 육지 포식 압력을 더하니 판게아가 "육식만 사는 맵"이 됐다. 프로브: 다산 초식 0.0)
  ],
  archipelago: [
    {
      // 바다뱀 — 섬 사이 얕은 바다의 포식자. 물 전용이라 뭍에는 못 올라온다(물에서만 무섭다).
      name: "바다뱀",
      color: 0x2fbf6a, // 독오른 초록 — 청록 바다에서 확 튄다
      // 둘이면 충분하다. 셋·다섯이면 바다가 되레 육지보다 험해져 **바다 종이 바다 세계에서 제일 못 사는**
      // 뒤집힌 결과가 나온다(프로브: 군도 도달 5.8 → 2.8). 바다는 "위험하지만 그래도 헤엄치는 자의 땅"
      // 이어야 한다 — 포식자는 공짜 밥상을 없애는 정도지, 삶터를 빼앗는 정도면 안 된다.
      initialCount: 2,
      foodKinds: [],
      traits: { diet: 88, fertility: 26, speed: 66, vision: 58, metabolism: 50, attack: 58, herding: 20, swimming: 94 },
      aquatic: true,
    },
    {
      // 바다거북 무리 — 느리고 오래 사는 바다 초식. 수륙양용(수영 80)이라 **얕은 바다 먹이만** 먹고 뭍에도
      // 오른다(진짜 바다거북처럼). 수영 92(물 전용)로 뒀더니 얕은 바다 + 깊은 바다를 **둘 다** 먹어,
      // 얕은 것만 먹는 바다 개척자(수영 88)를 일방적으로 눌렀다 — 바다 종이 바다 세계에서 제일 못 사는
      // 뒤집힌 결과의 진범이었다(프로브: 포식자를 약화해도 안 풀렸다).
      name: "바다거북 무리",
      color: 0xd8a860, // 등딱지 황갈색
      initialCount: 5,
      foodKinds: [],
      traits: { diet: 14, fertility: 36, speed: 28, vision: 44, metabolism: 38, attack: 48, herding: 38, swimming: 80 },
      aquatic: true,
    },
  ],
  ocean: [
    {
      // 범고래 무리 — 대양의 정점. 떼로 사냥한다. 물 전용이라 뭍은 안전하다.
      name: "범고래 무리",
      color: 0x1a2430, // 검푸른 등 — 깊은 바다에서도 실루엣이 선다
      // 한 무리면 충분하다. 둘이면 물이 72% 인 세계에서 헤엄치는 종이 도망칠 뭍이 없어 내내 쫓기다
      // 못 먹고 굶는다(공황 아사 — 큰수리 도망 반경 때와 같은 패턴. 프로브: 대양 도달 6.4 → 2.3).
      // 대양은 "바다 종의 삶터"여야 한다. 범고래는 공짜 밥상을 없애는 정도까지만.
      initialCount: 1,
      foodKinds: [],
      traits: { diet: 92, fertility: 20, speed: 68, vision: 68, metabolism: 55, attack: 56, herding: 50, swimming: 94 },
      aquatic: true,
    },
    {
      // 바다거북 무리 — 대양에도 산다(군도와 같은 종). 수륙양용이라 얕은 바다 먹이만 먹는다.
      name: "바다거북 무리",
      color: 0xd8a860,
      initialCount: 5,
      foodKinds: [],
      traits: { diet: 14, fertility: 36, speed: 28, vision: 44, metabolism: 38, attack: 48, herding: 38, swimming: 80 },
      aquatic: true,
    },
    {
      // 크릴 떼 — 대양 먹이사슬의 바닥. 다산으로 불어나 범고래를 먹여 살린다(포식자만 넣으면 굶어 죽는다).
      name: "크릴 떼",
      // 크릴이 있어야 범고래가 크릴을 먹는다 — 없으면 내 종만 노린다(포식자만 넣으면 학살이 된다).
      // 다만 물 전용(수영 95)이라 얕은·깊은 바다 먹이를 **둘 다** 먹는다. 번식 88 · 16마리로 뒀더니
      // 폭증해 바다 먹이를 쓸어 담아, 얕은 것만 먹는 바다 개척자가 굶었다(프로브: 대양 도달 2.3).
      // 범고래의 밥이 될 만큼만 두고 번식을 낮춘다.
      color: 0xff9ec8, // 연분홍 — 깊은 남청 바다에서 무리가 반짝인다
      initialCount: 9,
      foodKinds: [],
      traits: { diet: 12, fertility: 58, speed: 26, vision: 26, metabolism: 44, attack: 6, herding: 74, swimming: 95 },
      aquatic: true,
    },
  ],
};

/**
 * 이 세계에 사는 맵 전용 야생종들. **독립 rng**로 만든다 → 메인 스트림(기존 밸런스) 불변.
 * id 는 다른 종들과 안 겹치게 높은 대역(700+)을 쓴다.
 */
export function makeMapSpecies(rng: Rng, mapType: string): Species[] {
  const arch = MAP_ARCHETYPES[mapType] ?? [];
  const out: Species[] = [];
  let id = 700;
  for (const a of arch) {
    const g = defaultGenome();
    for (const key of TRAIT_KEYS) {
      if (
        key === "swimming" || key === "wings" || key === "echo" || key === "venom" ||
        key === "ranged" || key === "size" || key === "camouflage" // v7 — rng 없이(스트림 보존)
      ) {
        g.traits[key] = a.traits[key] ?? (key === "swimming" || key === "size" ? 50 : 0);
        continue;
      }
      g.traits[key] = clampTrait((a.traits[key] ?? 50) + rng.range(-6, 6));
    }
    out.push({
      id: id++,
      name: a.name,
      genome: clampGenome(g),
      isPlayer: false,
      color: a.color,
      initialCount: a.initialCount,
      foodKinds: a.foodKinds.slice(),
      friendly: false,
      faction: a.faction ?? 0,
    });
  }
  return out;
}

/** 이 맵 전용 종이 물에 사는가 / 산에 사는가 — world 가 스폰 자리를 정하는 데 쓴다(이름으로 조회). */
export function mapSpeciesHabitat(mapType: string, name: string): "sea" | "mountain" | "land" {
  const a = (MAP_ARCHETYPES[mapType] ?? []).find((x) => x.name === name);
  if (a?.aquatic) return "sea";
  if (a?.mountainous) return "mountain";
  return "land";
}

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
      if (
        key === "swimming" || key === "echo" || key === "wings" || key === "venom" ||
        key === "ranged" || key === "size" || key === "camouflage" // v7 — rng 없이(스트림 보존)
      ) {
        g.traits[key] = arch.traits[key] ?? (key === "swimming" || key === "size" ? 50 : 0);
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
