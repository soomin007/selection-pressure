// 보스 (Phase 5). 기획서 §4: "정해진 관문 통과 여부로 판정" → 버티기(endure) 게이트.
// 핵심 1: 보스마다 치명도를 "의도한 카운터 형질"로 게이팅해, 그 형질을 키운 종만 버틴다.
// 핵심 2: **보스는 사냥터(층위)를 갖는다** — 하늘·땅·물. 그 층에 없는 개체는 못 잡는다.
//   땅 보스는 나는 개체를 못 잡고(하늘로 피한다), 물속 개체도 못 잡는다(물이 피난처).
//   하늘 보스는 하늘·땅을 덮치되 물속은 못 건드린다. 물 보스는 물속만 잡는다.
//   덕분에 이동 형질(날개·수영)이 "어디로 도망칠 수 있는가"로 보스전에 직접 걸린다.
//
//   땅  chaser    질주하는 추격자(치타)   → 속도(도망)      : 닿으면 즉사, 빠르면 도망
//   땅  swarm     사나운 무리(벌레 떼)    → 번식력(소모전)   : 떼가 물어 솎되 번식으로 메운다
//   땅  raider    들이받는 뿔짐승 무리    → 공격력(반격)     : 근접 시 공격력으로 맞선다
//   땅  isolation 외톨이 사냥꾼(늑대)     → 무리 성향(뭉침)  : 무리에서 떨어진 개체를 노린다
//   땅  stalker   그림자 매복자(표범)     → 시야(미리 발견)  : 수풀에 숨어 덮친다(수풀이 사냥터)
//   하늘 raptor   하늘의 사냥꾼(큰수리)   → 시야 + 수풀 엄폐 : 내리꽂혀 낚아챈다. 수풀에 들면 못 본다
//   하늘 hornet   성난 말벌 떼            → 속도(벗어남)     : 하늘에서 몰려와 쏜다
//   물   shark    굶주린 상어             → 속도(헤엄쳐 도망): 물속만 사냥한다(뭍은 안전)
//   전역 poison   독 안개                 → 낮은 대사        : 층위 무관, 매 틱 에너지 흡수
//
// 통과 = 관전 끝까지 개체 수가 기준 이상 생존. 순수 TS, 결정론(무작위는 world.rng).

import type { World } from "@/sim/world";
import type { Entity } from "@/sim/entity";
import type { Terrain } from "@/sim/terrain";
import type { Rng } from "@/sim/rng";
import type { Traits } from "@/sim/genome";
import { TRAIT_MAX } from "@/sim/genome";
import { SIM } from "@/sim/params";
// 무리 방어 판정을 render(worldView)·boss 격퇴가 같은 소스로 읽는다(시각=로직 1:1). behavior 도 boss 를
// import 하지만 둘 다 함수 안에서만 쓰므로 순환 import 가 안전하다(모듈 로드 시점엔 서로를 안 부른다).
import { herdShielded } from "@/sim/behavior";

export type BossType =
  | "chaser"
  | "swarm"
  | "poison"
  | "titan"
  | "raider"
  | "isolation"
  | "stalker"
  | "raptor"
  | "hornet"
  | "shark";

/**
 * 층위 — 생물이 지금 "어디에" 있는가. 보스의 사냥터이자 생물의 피난처다.
 * 나는 종(날개≥flyThreshold)은 늘 하늘에 떠 있고, 물 타일 위의 종은 물속에, 나머지는 땅에 있다.
 */
export type Layer = "air" | "land" | "water";

/**
 * 레이드 카운터 형질 — 이 보스를 격퇴하는 무리 형질. 형질마다 잘 잡는 보스가 달라 빌드 선택이 깊어진다.
 *   attack   = 강한 개체(전사)가 맞서 반격(약탈자). **1단계**: behavior.memberKills 에서 hp 를 깎는다.
 *   speed    = 빠른 무리가 안 잡히고 따돌린다(추격자·말벌·상어). **2단계**: stepBoss 매 틱 집계.
 *   group    = 뭉친 무리(herdShielded)라 외톨이를 못 노린다(외톨이 사냥꾼). **2단계**.
 *   vision   = 무리 시야가 넓어 매복을 미리 본다(그림자 매복자·하늘의 사냥꾼). **2단계**.
 *   fertility= 수·번식으로 압도한다(사나운 무리). **2단계**.
 *   null     = 격퇴 없음(독 안개=전역이라 못 때린다 → 저대사 버티기 유지).
 */
export type RaidCounter = "attack" | "speed" | "group" | "vision" | "fertility" | null;

/** 개체가 지금 있는 층. 나는 종은 지형과 무관하게 늘 하늘(공중에 떠 있다). */
export function entityLayer(traits: Traits, terrain: Terrain, x: number, y: number): Layer {
  if (traits.wings >= SIM.flyThreshold) return "air";
  if (terrain.isWater(x, y)) return "water";
  return "land";
}

/**
 * 이 게놈의 종이 살아가며 **머물 수 있는 층들**. 보스 풀 필터(무의미 보스 방지)에 쓴다 —
 * 내 종이 발 들일 수 없는 층만 사냥하는 보스는 아예 안 뽑는다(나는 종에게 치타를 붙여봐야
 * 아무 일도 안 일어난다). 나는 종은 하늘만, 물 전용(수영≥aquaticOnly)은 물만, 수륙양용은 땅+물.
 */
export function speciesLayers(traits: Traits): readonly Layer[] {
  if (traits.wings >= SIM.flyThreshold) return ["air"];
  const canSwim = traits.swimming >= SIM.swimThreshold;
  const canLand = traits.swimming < SIM.aquaticOnlyThreshold;
  const out: Layer[] = [];
  if (canLand) out.push("land");
  if (canSwim) out.push("water");
  return out.length > 0 ? out : ["land"];
}

/**
 * 지형을 헤쳐 목표로 가는 것(보스 본체 또는 떼 개체 하나). 땅·물 보스는 지형에 막히므로 개체와 똑같이
 * 격자 길찾기 경로를 캐시한다 — 반응형 조향만 쓰면 물가·산자락에서 좌우로 미끄러지다 갇힌다(known_issues).
 */
interface Mover {
  x: number;
  y: number;
  path: number[]; // 격자 BFS 경로(타일 인덱스). 비어 있으면 직진.
  pathGoalTile: number; // 그 경로가 향하던 목표 타일(바뀌면 재계산)
}

/** 사나운 무리의 추격 개체 하나(떼의 한 마리). 각자 가장 가까운 개체로 이동해 killRadius 로 물어뜯는다. */
export interface BossMember extends Mover {
  x: number;
  y: number;
  prevX: number; // 직전 스텝 위치 (렌더 보간용)
  prevY: number;
}

export interface Boss extends Mover {
  type: BossType;
  name: string;
  x: number;
  y: number;
  prevX: number; // 직전 스텝 위치 (렌더 보간용)
  prevY: number;
  speed: number;
  killRadius: number; // 닿으면 즉사하는 반경 (0 = 없음)
  visionFlee: number; // 도망 반경에 시야를 곱해 더하는 정도(시야가 카운터인 보스: 일찍 보고 피한다)
  auraRadius: number; // 시각용 위험 반경(독 안개)
  globalKillRate: number; // 매 틱 개체가 솎일 확률(현재 미사용 — 떼로 실재화됨)
  globalDrain: number; // 매 틱 전역 에너지 흡수 (×(0.3+metabolism)) (poison)
  cullAttackResist: number; // 솎기를 공격력으로 저항(raider): kill = rng >= this×attack
  cullGroupResist: number; // 솎기를 무리 성향으로 저항(isolation)
  cullVisionResist: number; // 솎기를 시야로 저항(stalker)
  cullSpeedResist: number; // 솎기를 속도로 저항(hornet): 빠르면 쏘이기 전에 벗어난다
  /** 이 층에 있는 개체만 잡는다. 나머지 층은 손도 못 댄다(날면 땅 보스를 회피). */
  huntLayers: readonly Layer[];
  /** 보스 자신이 다니는 곳 — 땅 보스는 물·산에 못 들어가고, 물 보스는 물에서만, 하늘 보스는 어디든. */
  roam: Layer;
  /** 하늘에서 내려다보는 보스는 수풀에 든 땅 개체를 못 본다(엄폐). stalker(수풀=사냥터)와 정반대. */
  grassCover: boolean;
  // 다수 추격 개체(떼). 비어있으면 단일 개체(x,y) 모드. 각 멤버가 killRadius 로 즉사시킨다.
  members: BossMember[];
  /**
   * 레이드 격퇴 체력 — 무리가 이 보스의 카운터 형질을 충족하면 깎여, 0 이 되면 격퇴(즉시 통과).
   * **maxHp 0 = 레이드 없음**(기존 버티기 게이트 그대로): 첫 시대(era 0)·전역 시련(독 안개, raidCounter null)이
   * 여기 해당. hp 를 깎는 방식은 카운터별로 다르다 — 공격(약탈자)은 전사가 물린 순간 반격하고
   * (behavior→memberKills), 나머지 초식 카운터(속도·무리·시야·번식)는 매 틱 무리 형질 충족도 집계(stepBoss).
   */
  hp: number;
  maxHp: number;
  /** 이 보스를 격퇴하는 카운터 형질(위 RaidCounter). null=격퇴 없음(독 안개). */
  raidCounter: RaidCounter;
}

interface Preset
  extends Omit<
    Boss,
    "type" | "name" | "x" | "y" | "prevX" | "prevY" | "members" | "path" | "pathGoalTile" | "hp" | "maxHp"
  > {
  name: string;
  threat: string;
  counter: string;
  memberCount?: number; // 다수 추격 개체 떼의 수(swarm). 없으면 단일 개체.
}

/** 층위 기본값 — 대부분의 보스는 땅에서 땅을 사냥한다(기존 5종). 새 보스만 덮어쓴다. */
const LAND_ONLY: Pick<Preset, "huntLayers" | "roam" | "grassCover" | "cullSpeedResist"> = {
  huntLayers: ["land"],
  roam: "land",
  grassCover: false,
  cullSpeedResist: 0,
};

const PRESETS: Record<BossType, Preset> = {
  chaser: {
    ...LAND_ONLY,
    name: "질주하는 추격자",
    speed: 2.9,
    killRadius: 16,
    visionFlee: 0,
    auraRadius: 0,
    globalKillRate: 0,
    globalDrain: 0,
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0,
    raidCounter: "speed", // 빠른 무리가 따돌리면 지쳐 물러난다
    threat: "아주 빠르게 쫓아와 닿으면 잡아먹습니다. 땅 위만 달립니다.",
    counter: "속도가 높아야 도망칠 수 있습니다. 날거나 물에 들면 닿지 않습니다.",
  },
  titan: {
    ...LAND_ONLY,
    name: "거대 포식자",
    speed: 1.2,
    killRadius: 68,
    visionFlee: 150, // 시야가 높으면 훨씬 일찍 도망친다
    auraRadius: 0,
    globalKillRate: 0,
    globalDrain: 0,
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0,
    raidCounter: null, // 풀에서 제외된 보스(BOSS_TYPES 에 없음) — 격퇴 대상 아님
    threat: "느리지만 거대해 가까이 가면 잡아먹습니다.",
    counter: "시야가 넓어야 일찍 보고 피합니다.",
  },
  swarm: {
    ...LAND_ONLY,
    name: "사나운 무리",
    speed: 2.5, // 내 종 최고속(~2.38)보다 빨라 순수 도망은 무의미 → chaser(단일 초고속)와 달리 다수
    // 포위 소모전. 잘 성장한 큰 무리(빠르고 잘 먹어 수가 많은 종)는 흩어져 버티고, 부진한 작은 무리는
    // 따라잡혀 전멸(프로브: 기본 40%·부진형 0% 통과). speed 는 성장(채집)으로 개체수에 기여.
    killRadius: 4, // 각 떼 개체의 즉사 반경(무리 대형으로 겹쳐 다녀 작게 — 총 위협은 수·응집으로)
    visionFlee: 0,
    auraRadius: 0,
    globalKillRate: 0, // 전역 솎기 제거 — 이제 실제 떼 개체(members)가 쫓아와 문다(시각=로직 1:1)
    globalDrain: 0,
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0,
    raidCounter: "fertility", // 수·번식으로 압도하면 물러난다
    memberCount: 6, // 떼답게 여럿(응집+분리로 무리 대형을 이뤄 몰려온다). 건강한 큰 무리만 버틴다.
    threat: "사나운 무리가 사방에서 몰려들어 닿는 개체를 물어뜯습니다. 땅 위만 기어옵니다.",
    counter: "수가 많고 빠르게 번식해야 솎여도 메우며 버팁니다.",
  },
  poison: {
    ...LAND_ONLY,
    name: "독 안개",
    speed: 0.9,
    killRadius: 0,
    visionFlee: 0,
    auraRadius: 0, // 독은 전역(위치 없음) — 국소 원 대신 화면 전체 안개로 표현(worldView). 보스 점도 안 그린다.
    globalKillRate: 0,
    globalDrain: 0.5, // ×(0.3+metabolism): 대사 높을수록 더 빨림. 길찾기로 채집·개체수↑ 만큼 압박도 키워 저대사 우위를 드러냄(0.3→0.5, 프로브: 저대사15통과·기본5탈락)
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0,
    raidCounter: null, // 전역 재난이라 때릴 대상이 없다 → 저대사 버티기(격퇴 없음)
    // 독 안개는 **전역 재난**이라 층위가 없다 — 하늘로도 물로도 못 피한다(온 땅을 덮는다).
    huntLayers: ["air", "land", "water"],
    roam: "air", // 위치가 무의미(전역). 지형에 안 걸리게 하늘로 둔다.
    threat: "온 땅의 에너지를 계속 빨아들입니다. 하늘로도 물로도 피할 수 없습니다.",
    counter: "대사가 낮아야 덜 빨리고 견딥니다.",
  },
  raider: {
    ...LAND_ONLY,
    name: "약탈자 무리",
    speed: 2.5, // 도망 차단(swarm 과 동일). 카운터는 공격력(근접 시 반격).
    killRadius: 8,
    visionFlee: 0,
    auraRadius: 0,
    globalKillRate: 0,
    globalDrain: 0,
    cullAttackResist: 0.9, // 근접 시 공격력 높으면 반격해 생존(확률: kill = rng < 1 - this×attack)
    cullGroupResist: 0,
    cullVisionResist: 0,
    raidCounter: "attack", // 전사(공격력≥문턱)가 물린 순간 반격해 격퇴(1단계, memberKills)
    memberCount: 5, // 떼로 달려든다
    threat: "뿔 달린 짐승 떼가 달려들어 약한 개체부터 들이받습니다. 땅 위만 달립니다.",
    counter: "공격력(이빨·뿔)이 높아야 맞서 싸워 버팁니다.",
  },
  isolation: {
    ...LAND_ONLY,
    name: "외톨이 사냥꾼",
    speed: 2.5,
    killRadius: 8,
    visionFlee: 0,
    auraRadius: 0,
    globalKillRate: 0,
    globalDrain: 0,
    cullAttackResist: 0,
    cullGroupResist: 0.9, // 근접 시 무리 성향 높으면 함께 뭉쳐 생존(확률: kill = rng < 1 - this×herding)
    cullVisionResist: 0,
    raidCounter: "group", // 뭉친 무리(herdShielded)면 외톨이를 못 노려 물러난다
    memberCount: 3, // 무리 사이를 헤집는 소수 사냥꾼
    threat: "늑대가 무리에서 떨어진 외톨이를 노려 잡아갑니다. 땅 위만 달립니다.",
    counter: "무리 성향이 높아 함께 뭉쳐 다녀야 안전합니다.",
  },
  stalker: {
    ...LAND_ONLY,
    name: "그림자 매복자",
    speed: 2.5,
    killRadius: 10,
    visionFlee: 0,
    auraRadius: 0,
    globalKillRate: 0,
    globalDrain: 0,
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0.9, // 근접해도 시야 높으면 미리 보고 피한다(수풀 밖). 수풀 안에선 저항 감소(memberKills)
    raidCounter: "vision", // 무리 시야가 넓어 매복을 미리 보면 사냥을 접고 물러난다
    memberCount: 4, // 수풀에 숨어 덮치는 매복자들(수풀 스폰이라 위협이 분산돼 수를 늘림)
    threat: "표범이 수풀에 숨어 있다 다가온 개체를 덮칩니다. 땅 위만 노립니다.",
    counter: "시야가 넓어야 일찍 보고 피합니다. 수풀 안에선 시야가 안 통합니다.",
  },
  raptor: {
    // 하늘의 사냥꾼(큰수리) — 하늘을 도는 단독 맹금. 하늘의 종도, 땅의 종도 내리꽂혀 낚아챈다.
    // 물속은 못 건드린다(물이 피난처). 카운터는 두 갈래로 갈린다(층위별로 다른 대응):
    //   · 땅 개체 — **수풀에 들면 하늘에서 안 보인다**(grassCover). 트인 곳이 위험(stalker 와 정반대).
    //   · 나는 개체 — 공중엔 숨을 데가 없다. 오직 시야(visionFlee)로 일찍 보고 달아나야 한다.
    // 즉 나는 빌드에게 이 보스가 진짜 시험이다(땅 보스를 다 회피하는 대신 하늘에서 쫓긴다).
    ...LAND_ONLY,
    name: "하늘의 사냥꾼",
    speed: 2.7,
    killRadius: 14,
    // 시야가 넓으면 일찍 알아채고 달아난다(하늘·땅 공통 카운터). 60 이 최적 — 프로브에서 시야90 이
    // 시야50 보다 확실히 덜 죽는다(솎임 22 vs 29, 개체수 손실 -1.6 vs -5.3). 90 까지 올리면 오히려
    // 뒤집힌다: 도망 반경이 너무 넓어 시야 큰 종이 내내 달아나느라 못 먹고 굶는다(공황 아사).
    visionFlee: 60,
    auraRadius: 0,
    globalKillRate: 0,
    globalDrain: 0,
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0,
    raidCounter: "vision", // 무리 시야가 넓어 미리 알아채면 헛되이 맴돌다 물러난다
    huntLayers: ["air", "land"],
    roam: "air",
    grassCover: true, // 수풀에 든 땅 개체는 못 본다(엄폐)
    threat: "하늘 높이 돌다 내리꽂혀 낚아챕니다. 물속만은 못 건드립니다.",
    counter: "시야가 넓어야 일찍 보고 피합니다. 땅에선 수풀에 숨으면 안 보입니다.",
  },
  hornet: {
    // 성난 말벌 떼 — 하늘에서 몰려와 쏜다. 하늘·땅 모두 덮치되 물속은 못 쏜다.
    // 카운터=속도: 맞서 싸울 수 없고(벌은 잡아도 계속 온다) 빠르게 벗어나야 한다.
    // 나는 종 입장에선 chaser(땅) 대신 만나는 "속도 시험"이라 카운터가 안 겹친다.
    ...LAND_ONLY,
    name: "성난 말벌 떼",
    speed: 2.6,
    killRadius: 7,
    visionFlee: 0,
    auraRadius: 0,
    globalKillRate: 0,
    globalDrain: 0,
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0,
    cullSpeedResist: 0.9, // 빠르면 쏘이기 전에 벗어난다(확률: kill = rng >= this×speed)
    raidCounter: "speed", // 빠른 무리가 계속 벗어나면 떼가 지쳐 흩어진다
    huntLayers: ["air", "land"],
    roam: "air",
    memberCount: 6,
    threat: "말벌 떼가 하늘에서 몰려와 쏘아댑니다. 물속으로 들면 못 쫓아옵니다.",
    counter: "속도가 높아야 쏘이기 전에 벗어납니다.",
  },
  shark: {
    // 굶주린 상어 — 물속만 사냥한다. 뭍에 오른 개체는 손도 못 댄다("물 밖으로 나가면 산다").
    // 물이 땅 보스의 피난처인 만큼, 물에 사는 대가로 이 보스를 만난다(수영 빌드 전용 시험).
    ...LAND_ONLY,
    name: "굶주린 상어",
    speed: 3.2, // 물에선 그 무엇보다 빠르다
    killRadius: 18,
    visionFlee: 70, // 시야가 넓으면 일찍 보고 물 밖으로 달아난다
    auraRadius: 0,
    globalKillRate: 0,
    globalDrain: 0,
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0,
    raidCounter: "speed", // 빠른 무리가 헤엄쳐 따돌리면 지쳐 물러난다
    huntLayers: ["water"],
    roam: "water",
    threat: "물속을 도는 상어가 헤엄치는 개체를 통째로 삼킵니다. 뭍은 건드리지 못합니다.",
    counter: "물 밖으로 나가면 안전합니다. 시야가 넓어야 일찍 보고 뭍으로 달아납니다.",
  },
};

// titan(거대 포식자)은 느려서 누구나 쉽게 도망 → 위협이 안 됨. 풀에서 제외(프리셋은 보존).
// 시야 카운터는 titan 대신 stalker(그림자 매복자)로. 즉사 추격이 아니라 솎기+시야 저항이라 깔끔하다.
export const BOSS_TYPES: readonly BossType[] = [
  "chaser",
  "swarm",
  "poison",
  "raider",
  "isolation",
  "stalker",
  "raptor",
  "hornet",
  "shark",
];

/** 이 보스가 사냥하는 층들. */
export function bossHuntLayers(type: BossType): readonly Layer[] {
  return PRESETS[type].huntLayers;
}

/**
 * 이 맵에 "충분히 큰 바다"가 있는가 — 물 보스(상어)를 띄울 수 있는지 판정. 웅덩이뿐인 맵에
 * 상어를 넣으면 갇혀서 아무 일도 안 일어난다. rng 미사용 → 결정론.
 */
function mapHasSea(terrain: Terrain, width: number, height: number): boolean {
  const spot = terrain.nearestLargePassable(width * 0.5, height * 0.5, true, false, false, SIM.minWaterRegion);
  return terrain.isWater(spot.x, spot.y);
}

/**
 * 내 종이 이 보스에게 **실제로 사냥당할 수 있는가** — 아니면 그 보스는 뽑아봐야 아무 일도 안 일어난다
 * (나는 종에게 치타, 육상 종에게 상어). 무의미한 보스가 관문에 나와 "그냥 통과"가 되지 않게 거른다.
 * 종의 층위(speciesLayers)와 보스의 사냥 층위가 겹쳐야 걸린다. 물 보스는 맵에 바다가 있어야 성립.
 */
export function bossEligible(
  type: BossType,
  traits: Traits,
  terrain: Terrain,
  width: number,
  height: number,
): boolean {
  const p = PRESETS[type];
  const mine = speciesLayers(traits);
  if (!p.huntLayers.some((l) => mine.includes(l))) return false;
  if (p.roam === "water" && !mapHasSea(terrain, width, height)) return false;
  return true;
}

/** 이번 런에서 내 종에게 실제로 위협이 되는 보스들(무의미 보스 제외). 항상 최소 1종(독 안개)은 남는다. */
export function eligibleBossTypes(
  traits: Traits,
  terrain: Terrain,
  width: number,
  height: number,
): BossType[] {
  const out = BOSS_TYPES.filter((t) => bossEligible(t, traits, terrain, width, height));
  return out.length > 0 ? out : ["poison"];
}

export function createBoss(
  type: BossType,
  width: number,
  height: number,
  terrain?: Terrain,
  diffMul = 1,
  raidEnabled = false, // era 1+ 에서만 true — 첫 시대는 레이드 없이 기존 버티기(era 0 밸런스 보존)
): Boss {
  const p = PRESETS[type];
  // 보스는 자기 사냥터(roam)에 태어난다 — 땅 보스가 물에, 상어가 뭍에 나면 갇혀 아무 일도 안 난다.
  const spawn = bossSpawn(p, width, height, terrain);
  const x = spawn.x;
  const y = spawn.y;
  const members: BossMember[] = [];
  // 난이도 배율(diffMul, era 기반) — 위협 강도만 키운다. 즉사 반경·에너지 흡수·떼 수를 스케일하되
  // 도망 속도·형질 저항(cull*)은 안 건드려(즉사 도미노·형질 게이트가 민감) 카운터 형질이 여전히 통한다.
  // diffMul=1(첫 시대)이면 기존과 완전 동일 → 통과기준 테스트 보존.
  const count = Math.round((p.memberCount ?? 0) * diffMul);
  if (count > 0) {
    // 그림자 매복자는 수풀에 숨어 스폰한다(수풀이 매복자의 사냥터). 수풀이 충분치 않으면 아래 기본으로.
    const grassSpots = type === "stalker" && terrain ? terrain.grassSpots(count) : [];
    if (grassSpots.length === count) {
      for (const s of grassSpots)
        members.push({ x: s.x, y: s.y, prevX: s.x, prevY: s.y, path: [], pathGoalTile: -1 });
    } else {
      // 무리로 뭉쳐 한쪽(위 가장자리)에서 몰려온다 — 작은 원으로 모아 스폰(사방 분산은 "무리"로 안
      // 보이고 따로 논다). rng 무사용 → 결정론.
      const ox = width * 0.5;
      const oy = height * 0.08;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        let mx = clampTo(ox + Math.cos(ang) * 26, 0, width);
        let my = clampTo(oy + Math.sin(ang) * 26, 0, height);
        // 떼도 자기 사냥터에서 시작해야 한다(땅 떼가 물에 나면 못 움직인다).
        if (terrain) {
          const s = snapToRoam(p.roam, terrain, mx, my);
          mx = s.x;
          my = s.y;
        }
        members.push({ x: mx, y: my, prevX: mx, prevY: my, path: [], pathGoalTile: -1 });
      }
    }
  }
  return {
    type,
    name: p.name,
    x,
    y,
    prevX: x,
    prevY: y,
    speed: p.speed,
    killRadius: p.killRadius * diffMul, // 즉사 반경 — 시대가 오를수록 넓어진다
    visionFlee: p.visionFlee,
    auraRadius: p.auraRadius,
    globalKillRate: p.globalKillRate,
    globalDrain: p.globalDrain * diffMul, // 에너지 흡수(독 안개) — 시대가 오를수록 세진다
    cullAttackResist: p.cullAttackResist,
    cullGroupResist: p.cullGroupResist,
    cullVisionResist: p.cullVisionResist,
    cullSpeedResist: p.cullSpeedResist,
    huntLayers: p.huntLayers,
    roam: p.roam,
    grassCover: p.grassCover,
    path: [],
    pathGoalTile: -1,
    members,
    raidCounter: p.raidCounter,
    // 레이드 격퇴 체력 — **era 1+ 이고 카운터가 있는 보스(raidCounter != null)** 에 준다. 공격(약탈자)은
    // 전사 반격(memberKills)으로, 초식 카운터(속도·무리·시야·번식)는 매 틱 무리 충족도 집계(stepBoss)로 깎인다.
    // era 0(raidEnabled=false)·독 안개(raidCounter null)는 0 → 기존 버티기 게이트 유지(era 0 밸런스 보존).
    ...(raidEnabled && p.raidCounter !== null
      ? { maxHp: SIM.bossMaxHp * diffMul, hp: SIM.bossMaxHp * diffMul }
      : { maxHp: 0, hp: 0 }),
  };
}

/** 보스 스폰 위치 — 기본 자리(위쪽 가운데)를 자기 사냥터(roam)로 스냅한다. */
function bossSpawn(p: Preset, width: number, height: number, terrain?: Terrain): { x: number; y: number } {
  const x = width * 0.5;
  const y = height * 0.22;
  if (!terrain) return { x, y };
  // 상어는 "충분히 큰 바다"에 넣는다(웅덩이에 갇히면 무의미) — 물고기 스폰과 같은 규칙.
  if (p.roam === "water") {
    return terrain.nearestLargePassable(x, y, true, false, false, SIM.minWaterRegion);
  }
  return snapToRoam(p.roam, terrain, x, y);
}

/** (x,y) 를 이 층위에서 통행 가능한 가장 가까운 곳으로 옮긴다. */
function snapToRoam(roam: Layer, terrain: Terrain, x: number, y: number): { x: number; y: number } {
  if (roam === "air") return { x, y }; // 하늘은 어디든 통행
  if (roam === "water") return terrain.nearestPassable(x, y, true, false, false);
  return terrain.nearestPassable(x, y, false, true, false); // 땅 — 물·산 제외
}

function clampTo(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 전투 전 위협 예고 문구 (쉬운 말). */
export function bossPreview(type: BossType): string {
  const p = PRESETS[type];
  return `${p.name} — ${p.threat} ${p.counter}`;
}

export function bossName(type: BossType): string {
  return PRESETS[type].name;
}

/**
 * 개체형 보스(실제로 쫓아와 즉사시키는 개체)인가 — 아니면 전역 시련(위치 무관하게 사방에서 솎기/흡수,
 * 못 피하고 형질로 버틴다). killRadius(즉사 반경)가 있으면 개체형. 시각·용어·도망 여부를 이걸로 가른다.
 */
export function isPredatorBoss(type: BossType): boolean {
  return PRESETS[type].killRadius > 0;
}

/** 위협 대응 힌트(예고 부제) — 이 형질을 키우면 버틴다. */
export function bossCounter(type: BossType): string {
  return PRESETS[type].counter;
}

export function pickBossType(rng: Rng): BossType {
  return rng.pick(BOSS_TYPES);
}

/**
 * 이 보스가 이 개체를 **사냥할 수 있는가** — 층위(하늘/땅/물)와 엄폐(수풀)를 따진다.
 * 죽이기·목표 조준·도망 판정이 전부 이 하나를 본다(시각=로직 1:1: 화면에서 못 닿는 것은 실제로 못 닿는다).
 * 나는 개체는 땅 보스의 사냥 층(land)에 없으니 잡히지도, 무서워하지도 않는다(사용자 요청).
 */
export function bossCanHunt(boss: Boss, e: Entity, world: World): boolean {
  const layer = entityLayer(e.genome.traits, world.terrain, e.x, e.y);
  if (!boss.huntLayers.includes(layer)) return false;
  // 하늘에서 내려다보는 보스(큰수리)는 수풀에 든 땅 개체를 못 본다. 하늘의 개체는 숨을 데가 없다.
  if (boss.grassCover && layer === "land" && world.terrain.isGrass(e.x, e.y)) return false;
  return true;
}

/** roam 층위의 통행 규칙을 (canSwim, canLand, canFly) 로. 하늘=전부 통행, 물=물만, 땅=물·산 제외. */
function roamPass(roam: Layer): [boolean, boolean, boolean] {
  if (roam === "air") return [true, true, true];
  if (roam === "water") return [true, false, false];
  return [false, true, false];
}

/** 보스 자신이 이 자리를 지날 수 있는가(roam 층위의 통행 규칙). */
function bossPassable(boss: Boss, world: World, x: number, y: number): boolean {
  const [cs, cl, cf] = roamPass(boss.roam);
  return world.terrain.isPassable(x, y, cs, cl, cf);
}

/** 보스(또는 떼 개체)를 vx,vy 만큼 옮긴다 — 축을 나눠 시도해 벽을 따라 미끄러진다(개체 이동과 같은 방식). */
function moveWithin(boss: Boss, world: World, pos: { x: number; y: number }, vx: number, vy: number): void {
  // 지금 자리가 제 사냥터 밖이면(스폰이 어긋났거나 지형이 바뀐 경우) 갇히지 않게 자유롭게 빠져나온다.
  // 이게 없으면 호수 한가운데 떨어진 땅 보스는 사방이 다 막혀 영원히 못 움직인다(무해한 보스 = 그냥 통과).
  if (!bossPassable(boss, world, pos.x, pos.y)) {
    pos.x += vx;
    pos.y += vy;
    return;
  }
  const nx = pos.x + vx;
  if (bossPassable(boss, world, nx, pos.y)) pos.x = nx;
  const ny = pos.y + vy;
  if (bossPassable(boss, world, pos.x, ny)) pos.y = ny;
}

/**
 * 목표로 가는 다음 지점 — 직선으로 보이면 직진, 막혀 있으면 격자 BFS 경로를 따라 돌아간다.
 * 개체의 navTo 와 같은 방식이다. 이게 없으면 땅 보스가 물가·산자락에서 좌우로 미끄러지기만 하다
 * 먹잇감을 코앞(20~30px)에 두고도 영영 못 잡는다(반응형 조향의 local minima — known_issues).
 * 하늘 보스는 지형에 안 막히므로 늘 직진(BFS 안 탐).
 */
function bossNavTo(boss: Boss, world: World, m: Mover, gx: number, gy: number): { x: number; y: number } {
  if (boss.roam === "air") return { x: gx, y: gy };
  const terr = world.terrain;
  const [cs, cl, cf] = roamPass(boss.roam);
  // 1) 직선으로 보이면 직진 — 경로 버림.
  if (terr.lineOfSight(m.x, m.y, gx, gy, cs, cl, cf)) {
    if (m.path.length > 0) {
      m.path.length = 0;
      m.pathGoalTile = -1;
    }
    return { x: gx, y: gy };
  }
  // 2) 막힘 — 목표 타일이 바뀌었거나 경로가 없으면 BFS 재계산(그 외엔 캐시 재사용).
  const goalTile = terr.tileIndex(gx, gy);
  if (m.pathGoalTile !== goalTile || m.path.length === 0) {
    m.path = terr.findPath(m.x, m.y, gx, gy, cs, cl, cf);
    m.pathGoalTile = goalTile;
  }
  // 3) 경로 단축(funnel): 다음 웨이포인트가 보이면 현재 것을 건너뛴다.
  while (m.path.length >= 2) {
    const w1 = m.path[1] as number;
    if (terr.lineOfSight(m.x, m.y, terr.tileCenterX(w1), terr.tileCenterY(w1), cs, cl, cf)) m.path.shift();
    else break;
  }
  // 4) 현재 웨이포인트에 충분히 닿으면 소비.
  if (m.path.length > 0) {
    const w0 = m.path[0] as number;
    const wx = terr.tileCenterX(w0);
    const wy = terr.tileCenterY(w0);
    const reach = terr.cellSize * 0.6;
    if ((m.x - wx) ** 2 + (m.y - wy) ** 2 < reach * reach) m.path.shift();
  }
  // 경로 소진/못 찾음 → 목표로 직진 시도(축 분리 이동이 벽을 막아주니 파고들진 않는다).
  if (m.path.length === 0) return { x: gx, y: gy };
  const w = m.path[0] as number;
  return { x: terr.tileCenterX(w), y: terr.tileCenterY(w) };
}

/**
 * 레이드 타겟 위치 — (fx,fy)의 전사가 때릴 지점. **떼 보스는 그 전사에게 가장 가까운 개체**(가장자리)를,
 * 단일 보스는 본체를 돌려준다. 무게중심이 아닌 이유: 떼 한가운데로 돌진하면 여러 개체의 즉사 반경에 물려
 * 죽는다(프로브: 전멸). 가장자리 개체를 치면 격퇴 체력은 떼가 공유하므로 아무나 때려도 깎인다.
 */
export function bossRaidTargetFor(boss: Boss, fx: number, fy: number): { x: number; y: number } {
  if (boss.members.length === 0) return { x: boss.x, y: boss.y };
  let best = Infinity;
  let tx = boss.members[0]?.x ?? boss.x;
  let ty = boss.members[0]?.y ?? boss.y;
  for (const m of boss.members) {
    const d2 = (m.x - fx) ** 2 + (m.y - fy) ** 2;
    if (d2 < best) {
      best = d2;
      tx = m.x;
      ty = m.y;
    }
  }
  return { x: tx, y: ty };
}

/** 이 보스가 레이드로 잡을 수 있는 대상인가 — 격퇴 체력이 있고(레이드 켜짐) 아직 안 죽었는가. */
export function bossRaidable(boss: Boss): boolean {
  return boss.maxHp > 0 && boss.hp > 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 한 형질 값(0~100)을 floor~100 구간에서 0~1 충족도로. floor 이하는 0(야생·기본이 미미하게 걸린다). */
function traitFulfill(value: number, floor: number): number {
  return clamp01((value - floor) / (TRAIT_MAX - floor));
}

/**
 * 레이드 2단계 — 초식 카운터(속도·무리·시야·번식)가 매 틱 격퇴 체력을 깎는다. 무리가 자기 형질을
 * **시연하며 버티면**(빠르게 따돌리고·뭉치고·미리 보고·수로 메우면) 보스가 지쳐 물러난다. 공격(약탈자,
 * 전사 반격=memberKills)과 격퇴 없음(독 안개, raidCounter null)은 여기서 제외한다.
 */
function applyRaidWear(boss: Boss, world: World): void {
  if (!bossRaidable(boss)) return;
  const counter = boss.raidCounter;
  if (counter === null || counter === "attack") return;

  // huntable 한 내 종 개체의 카운터 충족도 합/수. 층위가 안 겹치면(하늘로 피한 종) 위협도 격퇴도 아니다.
  let sum = 0;
  let n = 0;
  for (const e of world.entities) {
    if (!e.alive || !e.species.isPlayer) continue;
    if (!bossCanHunt(boss, e, world)) continue;
    n += 1;
    const t = e.genome.traits;
    if (counter === "speed") sum += traitFulfill(t.speed, SIM.raidSpeedFloor);
    else if (counter === "vision") sum += traitFulfill(t.vision, SIM.raidVisionFloor);
    else if (counter === "fertility") sum += traitFulfill(t.fertility, SIM.raidFertFloor);
    else if (counter === "group") sum += herdShielded(e, world) ? 1 : 0;
  }
  if (n === 0) return; // 무리가 통째로 사냥 층 밖(피난) — 위협도 격퇴도 없다(버티기 타이머로).

  // 충족도(0~1). 대부분 평균(무리 크기 무관 — 큰 무리가 거저 이기지 않고, 형질이 높은 무리만 제 시간에 격퇴).
  let score: number;
  if (counter === "group") {
    // 무리 = 뭉친(방패) 비율. 목표 비율에 닿으면 완전 카운터(무리 전체가 방패는 cohesion 상 어렵다).
    score = clamp01(sum / n / SIM.raidShieldTarget);
  } else {
    // 속도·시야·번식 = 평균 형질 충족도. floor 이하 무리는 0 이라 격퇴가 안 일어난다(잘못된 빌드 배제).
    score = sum / n;
  }

  boss.hp -= SIM.raidWearRate * score;
  if (boss.hp < 0) boss.hp = 0;
}

/** 보스 한 틱. 타입별로 다른 압박을 가한다. */
export function stepBoss(boss: Boss, world: World): void {
  // 개체형 떼 시련(사나운 무리·약탈자·외톨이 사냥꾼·그림자 매복자·말벌 떼) — 실제 개체가 몰려와 문다.
  // 무엇이 죽느냐만 타입별로 다르다(memberKills): 무조건/공격력 반격/무리 이탈/시야 회피/속도 회피.
  if (boss.members.length > 0) {
    stepMemberHorde(boss, world);
  } else {
    stepSingleBoss(boss, world);
  }
  // 레이드 2단계 — 초식 카운터(속도·무리·시야·번식)는 매 틱 무리의 카운터 충족도만큼 격퇴 체력을 깎는다.
  // 공격(약탈자)은 전사 반격(memberKills)이 이미 깎으므로 여기선 제외한다.
  applyRaidWear(boss, world);
}

/** 단일 개체 보스(떼가 아닌 chaser·poison 등) 한 틱 — 이동 후 즉사/전역 솎기/에너지 흡수. */
function stepSingleBoss(boss: Boss, world: World): void {
  moveTowardNearest(boss, world);

  if (boss.killRadius > 0) {
    const killR2 = boss.killRadius * boss.killRadius;
    for (const e of world.entities) {
      if (!e.alive) continue;
      if (!bossCanHunt(boss, e, world)) continue; // 층위 밖(하늘로 피한 종·물속 종)은 못 잡는다
      const dx = e.x - boss.x;
      const dy = e.y - boss.y;
      if (dx * dx + dy * dy < killR2) {
        e.alive = false;
        world.recordDeath(e.species, "boss");
        world.emit("kill", e.x, e.y); // 연출: 보스 즉사 반경
      }
    }
  }

  if (boss.globalKillRate > 0) {
    for (const e of world.entities) {
      if (!e.alive) continue;
      if (!bossCanHunt(boss, e, world)) continue;
      let rate = boss.globalKillRate;
      // (전역 솎기 시련은 개체 떼로 실재화됨 — 이 분기는 globalKillRate>0 시련이 없어 현재 미사용.)
      if (boss.cullAttackResist > 0) rate *= 1 - boss.cullAttackResist * (e.genome.traits.attack / TRAIT_MAX);
      if (boss.cullGroupResist > 0) rate *= 1 - boss.cullGroupResist * (e.genome.traits.herding / TRAIT_MAX);
      if (boss.cullVisionResist > 0) rate *= 1 - boss.cullVisionResist * (e.genome.traits.vision / TRAIT_MAX);
      if (rate > 0 && world.rng.unit() < rate) {
        e.alive = false;
        world.recordDeath(e.species, "boss");
        world.emit("kill", e.x, e.y);
      }
    }
  }

  if (boss.globalDrain > 0) {
    for (const e of world.entities) {
      if (!e.alive) continue;
      if (!bossCanHunt(boss, e, world)) continue; // 독 안개는 전 층위 → 실질적으로 모두
      e.energy -= boss.globalDrain * (0.3 + e.genome.traits.metabolism / TRAIT_MAX);
      if (e.energy <= 0) {
        e.alive = false;
        world.recordDeath(e.species, "boss");
        world.emit("death", e.x, e.y); // 보스 기력 고갈 = 자연사 톤
      }
    }
  }
}

// 떼가 "무리"로 보이게 하는 boids 조향(사냥 방향이 주 1.0, 아래는 보조).
const SWARM_COHESION = 0.4; // 떼 무게중심으로 끌림 — 한 덩어리로 뭉쳐 몰려온다(뿔뿔이면 "무리"로 안 보임).
const SWARM_SEPARATION = 0.7; // 너무 가까운 동료에서 밀어냄 — 겹쳐 한 점에 집중(전멸)하지 않고 넓은 대형으로.
const SWARM_SEP_DIST = 34; // 이 거리보다 가까운 동료가 있으면 분리력이 작동(떼 대형의 개체 간격).

/**
 * 개체형 떼 시련 한 틱 — 떼 전체가 "하나의 목표"(무게중심에서 가장 가까운 **사냥 가능한** 개체)를 함께
 * 쫓아 무리 대형(응집으로 뭉치고 분리로 안 겹침)으로 몰려온다. 각자 다른 최근접을 쫓으면 따로 놀아
 * "무리"가 안 된다. 못 잡는 층의 개체(하늘로 피한 종)는 목표로 삼지도 않는다 — 쫓아가봐야 못 문다.
 */
function stepMemberHorde(boss: Boss, world: World): void {
  const killR2 = boss.killRadius * boss.killRadius;
  // 떼 무게중심(응집 기준).
  let cx = 0;
  let cy = 0;
  for (const m of boss.members) {
    cx += m.x;
    cy += m.y;
  }
  cx /= boss.members.length;
  cy /= boss.members.length;
  // 공통 목표 — 무게중심에서 가장 가까운 사냥 가능한 개체. 떼 전체가 이 한 무리를 향해 함께 몰려간다.
  let best = Infinity;
  let tx = 0;
  let ty = 0;
  let found = false;
  for (const e of world.entities) {
    if (!e.alive) continue;
    if (!bossCanHunt(boss, e, world)) continue;
    const dx = e.x - cx;
    const dy = e.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      tx = e.x;
      ty = e.y;
      found = true;
    }
  }
  for (const m of boss.members) {
    moveMember(boss, world, m, tx, ty, found, cx, cy);
    for (const e of world.entities) {
      if (!e.alive) continue;
      if (!bossCanHunt(boss, e, world)) continue; // 층위 밖은 물지 못한다
      const dx = e.x - m.x;
      const dy = e.y - m.y;
      if (dx * dx + dy * dy < killR2 && memberKills(e, boss, world)) {
        e.alive = false;
        world.recordDeath(e.species, "boss");
        world.emit("kill", e.x, e.y); // 연출: 떼 개체가 문 자리
      }
    }
  }
}

/**
 * 닿은 개체를 실제로 죽이는가 — 카운터 형질이 높으면 살아남는다(시각=로직: 화면의 떼가 무는 것과 일치).
 *   공격력 저항(약탈자): 공격력이 높으면 반격해 생존.
 *   무리 저항(외톨이):   무리 성향이 높으면(함께 뭉쳐) 생존.
 *   시야 저항(매복자):   시야가 높으면 미리 보고 피함.
 *   속도 저항(말벌 떼):  속도가 높으면 쏘이기 전에 벗어남.
 *   저항 없음(사나운 무리): 닿으면 무조건. (모두 kill = rng >= resist×형질)
 */
function memberKills(e: Entity, boss: Boss, world: World): boolean {
  const t = e.genome.traits;
  if (boss.cullAttackResist > 0) {
    // 약탈자 — 공격력으로 반격. **레이드가 켜진 시대(era 1+)엔 전사(공격력≥문턱)가 물린 순간 반격해
    // 격퇴 체력을 깎고 살아남는다.** 떼가 계속 몰려와 물수록 전사들의 반격이 쌓여 격퇴로 이어진다
    // (도망 못 하는 약탈자 상대라 "맞서 싸워 잡는다"가 자연스럽다 — kiting 이 안 통하는 걸 반격으로 푼다).
    // era 0·비전사(공격력<문턱)는 기존 확률 저항(공격력 높으면 생존, 낮으면 죽음).
    if (bossRaidable(boss) && t.attack >= SIM.raidWarriorAttack) {
      boss.hp -= SIM.raidDamagePerHit * (t.attack / TRAIT_MAX);
      world.emit("bite", e.x, e.y); // 연출: 전사가 반격한 자리
      return false; // 반격 성공 — 전사는 안 죽는다
    }
    return world.rng.unit() >= boss.cullAttackResist * (t.attack / TRAIT_MAX);
  }
  if (boss.cullGroupResist > 0) return world.rng.unit() >= boss.cullGroupResist * (t.herding / TRAIT_MAX);
  if (boss.cullSpeedResist > 0) return world.rng.unit() >= boss.cullSpeedResist * (t.speed / TRAIT_MAX);
  if (boss.cullVisionResist > 0) {
    // 그림자 매복자 — 수풀 안에선 시야가 안 통해 미리 못 알아챈다(저항 40%로 감소 → 수풀이 사냥터).
    // 트인 곳에선 시야로 멀찍이 알아채 피한다. 시야 형질은 수풀 밖에서 진가를 낸다(지형×형질).
    const resist = world.terrain.isGrass(e.x, e.y) ? boss.cullVisionResist * 0.4 : boss.cullVisionResist;
    return world.rng.unit() >= resist * (t.vision / TRAIT_MAX);
  }
  return true;
}

/** 떼 개체 하나 이동 — 공통 목표로 향하되(주), 무게중심으로 응집 + 가까운 동료에서 분리(무리 대형). */
function moveMember(
  boss: Boss,
  world: World,
  m: BossMember,
  tx: number,
  ty: number,
  hasTarget: boolean,
  herdCx: number,
  herdCy: number,
): void {
  const speed = boss.speed;
  if (speed <= 0) return;
  let vx = 0;
  let vy = 0;
  // 사냥: 공통 목표 방향(단위 벡터) — 무리 전체가 같은 곳으로 몰려간다. 지형에 막히면 돌아간다.
  if (hasTarget) {
    const nav = bossNavTo(boss, world, m, tx, ty);
    const hx = nav.x - m.x;
    const hy = nav.y - m.y;
    const hd = Math.sqrt(hx * hx + hy * hy) || 1;
    vx += hx / hd;
    vy += hy / hd;
  }
  // 응집: 떼 무게중심 방향(단위 벡터)을 SWARM_COHESION 만큼.
  const chx = herdCx - m.x;
  const chy = herdCy - m.y;
  const cd = Math.sqrt(chx * chx + chy * chy);
  if (cd > 1) {
    vx += (chx / cd) * SWARM_COHESION;
    vy += (chy / cd) * SWARM_COHESION;
  }
  // 분리: SWARM_SEP_DIST 안의 동료에서 밀어냄(겹쳐 한 점 집중 방지 → 넓은 무리 대형).
  const sep2 = SWARM_SEP_DIST * SWARM_SEP_DIST;
  for (const o of boss.members) {
    if (o === m) continue;
    const ox = m.x - o.x;
    const oy = m.y - o.y;
    const od2 = ox * ox + oy * oy;
    if (od2 > 0 && od2 < sep2) {
      const od = Math.sqrt(od2);
      vx += (ox / od) * SWARM_SEPARATION;
      vy += (oy / od) * SWARM_SEPARATION;
    }
  }
  const vl = Math.sqrt(vx * vx + vy * vy) || 1;
  moveWithin(boss, world, m, (vx / vl) * speed, (vy / vl) * speed);
}

function moveTowardNearest(boss: Boss, world: World): void {
  if (boss.speed <= 0) return;
  let best = Infinity;
  let tx = 0;
  let ty = 0;
  let found = false;
  for (const e of world.entities) {
    if (!e.alive) continue;
    if (!bossCanHunt(boss, e, world)) continue; // 못 잡는 층은 쫓지도 않는다
    const dx = e.x - boss.x;
    const dy = e.y - boss.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      tx = e.x;
      ty = e.y;
      found = true;
    }
  }
  if (!found) return;
  // 지형에 막히면 돌아간다(직진만 하면 물가에 붙어 미끄러지다 못 잡는다).
  const nav = bossNavTo(boss, world, boss, tx, ty);
  const dx = nav.x - boss.x;
  const dy = nav.y - boss.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  moveWithin(boss, world, boss, (dx / d) * boss.speed, (dy / d) * boss.speed);
}
