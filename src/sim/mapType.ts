// 맵 종류 (문명식 지도 유형) — 세계가 판마다 "종류"째로 달라진다.
//
// 왜: 지금까지 맵은 시드만 다를 뿐 전부 같은 종류(바다 15%의 대륙)라, 판이 바뀌어도 유리한 형질이
// 안 바뀌었다. 맵 종류가 있으면 "이번 판은 군도라 헤엄이 왕이다"가 생긴다 — 형질을 **조건부로** 빛나게
// 하는 환경×형질 축의 가장 싼 레버다(지형 생성기가 이미 파라미터화돼 있어 값 프리셋일 뿐이다).
//
// 맵 종류는 **판마다 무작위로 주어진다**(플레이어가 고르지 않는다). 세계가 먼저 정해지고, 플레이어는
// 그걸 보고 거기 맞는 시작 종을 고른다 — "환경이 형질을 시험한다"는 이 게임의 정체성. 그래서 로비에서
// 시작 종을 고르기 **전에** 이번 세계가 무엇인지 반드시 보여줘야 한다(안 그러면 그냥 운이 된다).
//
// 순수 TS. 먹이 배수는 "고정 개수"인 먹이(SIM.foodPatches·seaFoodPatches)를 그 맵의 땅·바다 넓이에
// 맞춰 늘리고 줄인다 — 안 그러면 바다를 넓혀도 바다 먹이는 그대로라 넓어진 바다가 텅 빈다.

import type { Rng } from "@/sim/rng";
import type { TerrainOptions } from "@/sim/terrain";

export type MapType = "continent" | "pangaea" | "archipelago" | "ocean";

export interface MapKind {
  id: MapType;
  /** 화면에 뜨는 이름. */
  name: string;
  /** 로비 한 줄 설명(쉬운 말) — 무엇이 유리한 세계인지. */
  desc: string;
  /** 지형 생성 파라미터(기본값에 덮어쓴다). */
  terrain: Partial<TerrainOptions>;
  /** 육지 먹이 배수 — 땅이 좁아지면 함께 줄어 밀도가 유지된다. */
  landFoodScale: number;
  /** 바다 먹이 배수(얕은·깊은 바다 공통) — 바다가 넓어지면 함께 는다. */
  seaFoodScale: number;
  /**
   * 고산 먹이(산 보물) 배수 — 산이 많은 세계는 산 위 먹이도 많아야 날개가 값을 한다. 이게 없으면
   * 산맥이 늘어도 보물은 고정 10개라, 날개 종에겐 "넘을 산만 늘고 얻을 건 그대로"가 된다(프로브 확인).
   */
  mountainFoodScale: number;
  /**
   * 이 세계가 나오기 시작하는 플레이어 레벨. 물이 많은 세계는 **헤엄칠 줄 아는 갈래를 연 뒤**에 나와야
   * 한다 — 안 그러면 바다 갈래가 잠긴 초보에게 대양이 떠서 손쓸 방법 없이 진다(그건 난이도가 아니라 운).
   * 바다 개척자 해금이 레벨 4 라, 군도는 4·대양은 6 부터. (게임 층이 이 값으로 뽑기 풀을 거른다.)
   */
  unlockLevel: number;
}

export const MAP_KINDS: Record<MapType, MapKind> = {
  continent: {
    id: "continent",
    name: "대륙",
    desc: "땅이 넓고 바다는 호수처럼 흩어져 있습니다. 걷는 종이 살기 좋습니다.",
    // 옛 임계값 방식은 시드마다 바다가 5%~48% 로 널뛰었다 — 같은 "대륙"인데 어떤 판은 반쯤 물바다라
    // 종류라는 말이 무의미했다. 지금까지의 평균(바다 15%)을 비율로 못박아 대륙을 대륙답게 고정한다.
    terrain: { fractions: { sea: 0.15, grass: 0.24, rough: 0.06, mountain: 0.08 } },
    landFoodScale: 1,
    seaFoodScale: 1,
    mountainFoodScale: 1,
    unlockLevel: 1, // 늘 나온다(밸런스 기준선)
  },
  pangaea: {
    id: "pangaea",
    name: "판게아",
    desc: "하나로 이어진 넓은 땅을 바다가 둘러쌉니다. 가운데를 가르는 산맥 위에 먹이가 많습니다.",
    terrain: {
      // 비율로 못박는다 — 트인 땅이 절반, 산맥 16%("걷기 좋은 넓은 땅 + 가운데를 가르는 산맥").
      // 험지를 12% 두면 걷는 종이 느려져 대양보다도 못 산다(프로브) → 8% 로 억제.
      fractions: { sea: 0.18, grass: 0.10, rough: 0.08, mountain: 0.16 },
      // 블러를 세게(7) + 침강을 세게(0.55) 두면 맵이 통째로 "돔"이 된다 — 한가운데가 최고봉이라 산이
      // 중앙에 뭉치고 땅은 그걸 두른 고리가 된다(화산섬이지 판게아가 아니다. 프로브: 걷는 종 도달 0.8단계).
      // 내부 기복을 살리고(블러 5) 침강을 낮춰(0.4) "가장자리만 바다인 넓고 울퉁불퉁한 대륙"으로.
      blurPasses: 5,
      edgeFalloff: 0.4,
    },
    landFoodScale: 1,
    seaFoodScale: 1,
    mountainFoodScale: 2.8, // 산맥의 세계 — 고산 독수리와 나눠 먹고도 날개가 값을 하려면 넉넉해야 한다
    unlockLevel: 3, // 육지 위주라 헤엄 없이도 살 만하다
  },
  archipelago: {
    id: "archipelago",
    name: "군도",
    desc: "잘게 쪼개진 섬과 얕은 바다입니다. 헤엄치거나 날지 못하면 한 섬에 갇힙니다.",
    terrain: {
      fractions: { sea: 0.5, grass: 0.14, rough: 0.03, mountain: 0.03 }, // 바다 절반, 산은 거의 없다(섬)
      blurPasses: 2, // 잘게 흩어진 섬(블러가 적어야 덩어리가 안 커진다)
    },
    landFoodScale: 0.8,
    seaFoodScale: 2.2, // 바다뱀·거북이 몫을 나누므로 파이도 키운다(안 그러면 틈새가 사라진다)
    mountainFoodScale: 0.3, // 섬이라 산이 거의 없다
    unlockLevel: 4, // 바다 개척자 해금(레벨 4)과 함께 — 헤엄칠 갈래가 있어야 공정하다
  },
  ocean: {
    id: "ocean",
    name: "대양",
    desc: "지구처럼 바다가 대부분입니다. 뭍은 좁아 붐비고, 바다가 진짜 삶터입니다.",
    terrain: {
      fractions: { sea: 0.72, grass: 0.10, rough: 0.02, mountain: 0.02 }, // 지구(71%)와 비슷한 물바다
      blurPasses: 5, // 큰 대양 + 드문드문 큰 섬
    },
    // 땅이 좁아도 해안은 비옥하다 — 밀도(0.45)보다 넉넉히 줘야 육상 갈래가 "좁지만 살 수는 있는" 선에
    // 남는다. 0.4 로 밀도만 맞추면 캐리 용량이 통과기준(3마리) 아래로 떨어져 사실상 즉사 맵이 된다.
    landFoodScale: 0.75,
    seaFoodScale: 4.2, // 범고래·거북·크릴·물고기가 함께 사니 파이도 크게(바다가 이 세계의 삶터다)
    mountainFoodScale: 0.2, // 산이 거의 없다
    unlockLevel: 6, // 가장 극단이라 가장 늦게
  },
};

export const MAP_TYPES: readonly MapType[] = ["continent", "pangaea", "archipelago", "ocean"];

export function mapKind(type: MapType): MapKind {
  return MAP_KINDS[type];
}

export function mapName(type: MapType): string {
  return MAP_KINDS[type].name;
}

/**
 * 이번 판의 세계를 뽑는다(판마다 무작위). 전용 rng 로 뽑아 메인 동역학 스트림을 안 건드린다.
 * 아직 안 열린 세계(unlockLevel > 지금 레벨)는 후보에서 뺀다 — 헤엄칠 갈래도 없는데 대양이 뜨면
 * 손쓸 방법 없이 진다. 레벨 1 이면 후보가 "대륙" 하나뿐이라 기존과 완전히 같은 세계가 나온다.
 */
export function pickMapType(rng: Rng, playerLevel = 99): MapType {
  const pool = MAP_TYPES.filter((t) => MAP_KINDS[t].unlockLevel <= playerLevel);
  return rng.pick(pool.length > 0 ? pool : ["continent"]);
}

/** 이 레벨에서 나올 수 있는 세계들(진화 갈래 화면에 "무엇이 열렸는지" 보여주는 데도 쓴다). */
export function unlockedMapTypes(playerLevel: number): MapType[] {
  return MAP_TYPES.filter((t) => MAP_KINDS[t].unlockLevel <= playerLevel);
}
