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
//   전역 poison   독 안개                 → 수풀로 피하기    : 층위 무관하게 매 틱 흡수. 수풀 안만 0
//
// 통과 = 관전 끝까지 개체 수가 기준 이상 생존. 순수 TS, 결정론(무작위는 world.rng).

import type { World } from "@/sim/world";
import type { Entity } from "@/sim/entity";
import type { Terrain } from "@/sim/terrain";
import type { Traits } from "@/sim/genome";
import { TRAIT_MAX } from "@/sim/genome";
import { SIM } from "@/sim/params";
import { hasRule } from "@/sim/perks";

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
  /**
   * 근접 전사가 **되받아치는** 반경(떼 시련 전용). 즉사 반경과 분리해 "붙으면 깎인다"를 손끝에서
   * 성립시킨다(SIM.raidCounterRadius 주석 참조).
   * ⚠ killRadius 와 **같이 diffMul 로 커진다.** 안 키우면 시대가 오를수록 요구량(maxHp)만 커지고
   *   반격 기회는 그대로라 후반 시대에 격퇴가 죽은 기능이 된다(known_issues 의 "wear 를 diffMul 로 안
   *   키우면 시대가 오를수록 어려워진다" 와 같은 함정). 실측: 안 키우면 diffMul 4 에서 사냥꾼 프리셋
   *   격퇴가 5/8 → 1/8 로 무너졌다.
   */
  counterRadius: number;
  visionFlee: number; // 도망 반경에 시야를 곱해 더하는 정도(시야가 카운터인 보스: 일찍 보고 피한다)
  auraRadius: number; // 시각용 위험 반경(독 안개)
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
  /**
   * **수풀이 피난처인가**(전역 흡수 전용). true 면 `globalDrain` 이 **수풀 타일 위의 개체에게는 0** 이다 ·
   * 잎 아래로 들어간 것은 안 빨린다.
   *
   * 왜 있나: 전역 흡수는 `bossCanHunt` 를 안 거친다 → 층위(하늘·물)도 엄폐도 흡수에는 **원리적으로**
   * 안 통한다. 그래서 흡수형 보스는 「피할 데가 없는 보스」가 되고, 실제로 독 안개는 시대 2 부터 전
   * 시드·전 갈래가 탈락했다(2026-08-08 실측 · 시대 4 는 32/32 완전 멸종). 이 필드가 그 하나뿐인
   * 숨 구멍이다.
   *
   * **수풀로 고른 이유**(내 판단): 형질 없이 누구나 밟는 지형이라 갈래 편향이 없다. 물속은 지느러미가,
   * 산은 날개가 있어야 가므로 그 형질이 없는 갈래는 여전히 죽는다. 그리고 이미 있는 판정
   * (`terrain.isGrass`)을 그대로 써서 새 지형 개념을 안 만든다.
   *
   * ⚠ **실측: 이건 「몰면 산다」가 아니다.** 넣을 때의 기대는 "안개가 오면 무리를 수풀로 몰아 살린다"
   *   였는데, 재 보니 그 반대였다(2026-08-08 · 시대 2 · 8~12시드 · 균형 잡식):
   *     · 지시를 안 준 판이 수풀 위에 있던 개체틱 23% · 35초 내내 몬 판이 27~31%. **몰아도 8pt 밖에
   *       안 오른다.** 지시점 64px 안에 든 개체틱은 몰아도 4~5% 뿐이었다(무리가 지시점 둘레
   *       150~250px 로 퍼져 있고, 이 맵의 수풀은 폭 1~2타일 띠라 그 퍼짐보다 좁다).
   *     · 그런데 지시를 받는 동안에는 먹이를 거의 못 먹는다(`ORDER.pull` 0.9) → 몬 판이 오히려
   *       개체 수가 낮다(안 몲 6.8 vs 몲 3.0). 목표를 고르는 법 4가지 · 목소리 반경 260/4000 ·
   *       흡수 0.15~1.0 어느 조합에서도 몰기가 이긴 적이 없다.
   *   그래서 피난처는 **지형 운(수풀이 많은 자리에 사는가)** 으로 먼저 작동한다. 그것만으로도 크다:
   *   흡수 0.3 · 시대 2 에서 피난처를 끄면 탈락 8/8 · 켜면 3/8 이었다.
   *   「몰면 산다」를 진짜로 만들려면 흡수가 아니라 **지시와 채집이 배타적인 것**을 먼저 풀어야 한다.
   *
   * ⚠ `grassCover`(시야 엄폐)와 헷갈리지 말 것. 그쪽은 「수풀에 들면 하늘에서 안 보인다」이고
   *   이쪽은 「수풀에 들면 안 빨린다」다. 판정하는 자리도 다르다(bossCanHunt vs 흡수 루프).
   */
  drainShelter: boolean;
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
    | "type"
    | "name"
    | "x"
    | "y"
    | "prevX"
    | "prevY"
    | "members"
    | "path"
    | "pathGoalTile"
    | "hp"
    | "maxHp"
    // 반격 반경은 프리셋마다 다른 값이 아니라 상수 × 시대 배율이라 createBoss 에서만 채운다.
    | "counterRadius"
  > {
  name: string;
  threat: string;
  counter: string;
  memberCount?: number; // 다수 추격 개체 떼의 수(swarm). 없으면 단일 개체.
}

/** 층위 기본값 — 대부분의 보스는 땅에서 땅을 사냥한다(기존 5종). 새 보스만 덮어쓴다. */
const LAND_ONLY: Pick<
  Preset,
  "huntLayers" | "roam" | "grassCover" | "cullSpeedResist" | "drainShelter"
> = {
  huntLayers: ["land"],
  roam: "land",
  grassCover: false,
  cullSpeedResist: 0,
  drainShelter: false, // 흡수가 없는 보스에겐 뜻이 없다. 흡수형(독 안개)만 덮어쓴다.
};

const PRESETS: Record<BossType, Preset> = {
  chaser: {
    ...LAND_ONLY,
    name: "질주하는 추격자",
    speed: 2.9,
    killRadius: 16,
    visionFlee: 0,
    auraRadius: 0,
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
    // 독은 전역(위치 없음)이라 국소 원이 없다 · 보스 점도 안 그린다. 화면에는 **흡수가 실제로 걸리는
    // 칸에만** 안개를 칠한다(worldView 의 fogG) · 수풀은 비워 두므로 안전한 자리가 눈에 보인다.
    auraRadius: 0,
    // ×(0.3+대사/100) 만큼 매 틱 빨린다 · createBoss 가 여기에 **시대 배율까지 곱한다**(피해가 시대로
    // 커지는 유일한 보스). 그래서 이 한 숫자가 아홉 보스 중 가장 예민하다.
    //
    // 옛 값 0.5 의 근거 주석("저대사15통과·기본5탈락")은 **대사를 카드로 내릴 수 있던 v7 시절 실측**이라
    // 지금은 전제가 없다 · v8 에서 대사는 가죽 티어의 파생값(HIDE_METAB)이고 **낮추는 카드가 하나도 없다.**
    // 즉 유일한 대응책이 고를 수 없는 축이었고, 실제로 시대 2 부터 전 시드·전 갈래가 탈락했다.
    // 지금 값은 **수풀 피난처(drainShelter)를 넣은 뒤 다시 잰 것**이다 (`npm run probe -- poison`).
    // 값 고르기 · 시대 2 · 12시드 × 프리셋 5 = 60판 · 「탈락/60」(몰기 없음):
    //   위협 없음(기준선)   9    0.10 → 22    0.15 → 28 ← 채택    0.20 → 30
    //   0.50(피난처 이전)  전 시드·전 갈래 탈락
    // 채택값으로 다시 잰 표 · 24시드 × 프리셋 5 = 120판 · 「탈락/120 · 완전멸종/120」:
    //   시대 0(초원 · 수풀 0칸)  기준선 8/8    안개 8/8      ← 첫 판은 사실상 무영향(통과기준 1마리)
    //   시대 2                기준선 25/11  안개 47/23
    //   시대 4                기준선 83/30  안개 120/82
    // 0.15 를 고른 이유: 잘 자란 갈래는 넘고(시대 2 · 균형 잡식 2/24 · 사냥꾼 2/24 · 둘 다 멸종 0)
    // 부진한 갈래는 못 넘는다(느린 거인 17/24). 더 낮추면 안개가 있으나 마나가 되고, 더 높이면
    // 격퇴도 대응책도 없는 위협이 판의 절반을 그냥 끝낸다.
    // ⚠ 시대 4 는 이 값으로 못 고친다 · **위협이 아예 없어도** 그 시대 기준선이 83/120 탈락이다.
    //   프로브가 카드를 한 장도 안 먹은 시작 게놈을 그 시대에 떨어뜨리기 때문이기도 하고
    //   (실제 플레이어는 그때 카드를 열댓 장 먹었다), 통과기준이 6마리인데 그 게놈의 시대 4 개체
    //   수가 1.6~7.0 이기 때문이기도 하다. 시대 4 를 보려면 흡수가 아니라 그 둘을 봐야 한다.
    globalDrain: 0.15,
    cullAttackResist: 0,
    cullGroupResist: 0,
    cullVisionResist: 0,
    raidCounter: null, // 전역 재난이라 때릴 대상이 없다 → 격퇴 없음(수풀로 피해 버틴다)
    // 독 안개는 **전역 재난**이라 층위가 없다 — 하늘로도 물로도 못 피한다(온 땅을 덮는다).
    huntLayers: ["air", "land", "water"],
    roam: "air", // 위치가 무의미(전역). 지형에 안 걸리게 하늘로 둔다.
    drainShelter: true, // 수풀 = 유일한 피난처(위 Boss.drainShelter 주석에 근거)
    threat: "온 땅의 에너지를 계속 빨아들입니다. 하늘로도 물로도 피할 수 없습니다.",
    // ⚠ 「무리를 수풀로 몰아넣으세요」라고 쓰지 않는다. 실측(위 Boss.drainShelter 주석)에서 35초 내내
    //   수풀에 세워 두는 것은 **손해**였다 · 먹이를 못 먹어 개체 수가 오히려 준다. 화면이 시키는
    //   대로 했는데 더 나빠지면 그건 「실행 불가능한 지시」의 다른 얼굴이다. 지금 참인 것만 말하고,
    //   나머지는 화면(걷힌 자리)이 보여 준다.
    counter: "수풀 아래에서는 안 빨립니다. 안개가 걷힌 밝은 자리가 수풀입니다.",
  },
  raider: {
    ...LAND_ONLY,
    name: "약탈자 무리",
    speed: 2.5, // 도망 차단(swarm 과 동일). 카운터는 공격력(근접 시 반격).
    killRadius: 8,
    visionFlee: 0,
    auraRadius: 0,
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
  raidEnabled = false, // 기본 false(테스트는 "레이드 없는 버티기" 경로를 봄). **게임은 첫 시대(era 0)부터
  // true 를 넘겨 켠다** — 격퇴 체력바=핵심 메커니즘이라 첫 판부터 보여야 한다(era 1+ 로 미뤘더니 안 보였다).
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
    counterRadius: SIM.raidCounterRadius * diffMul, // 반격 반경 · 즉사 반경과 같은 계단으로 함께 커진다
    visionFlee: p.visionFlee,
    auraRadius: p.auraRadius,
    globalDrain: p.globalDrain * diffMul, // 에너지 흡수(독 안개) — 시대가 오를수록 세진다
    cullAttackResist: p.cullAttackResist,
    cullGroupResist: p.cullGroupResist,
    cullVisionResist: p.cullVisionResist,
    cullSpeedResist: p.cullSpeedResist,
    huntLayers: p.huntLayers,
    roam: p.roam,
    grassCover: p.grassCover,
    drainShelter: p.drainShelter,
    path: [],
    pathGoalTile: -1,
    members,
    raidCounter: p.raidCounter,
    // 레이드 격퇴 체력 · **era 1+ 이고 카운터가 있는 보스(raidCounter != null)** 에 준다.
    // 떼 보스는 근접 반격(stepMeleeCounter)과 원거리 사격(behavior)이 깎고, 단일 보스는 닿은 틱마다
    // 반격(stepSingleBoss)이 깎는다. 어느 쪽이든 카운터 형질이나 공격력 문턱을 넘어야 0 이 아니다.
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
  return `${p.name}. ${p.threat} ${p.counter}`;
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

/**
 * 이 보스가 이 개체를 **사냥할 수 있는가** — 층위(하늘/땅/물)와 엄폐(수풀)를 따진다.
 * 죽이기·목표 조준·도망 판정이 전부 이 하나를 본다(시각=로직 1:1: 화면에서 못 닿는 것은 실제로 못 닿는다).
 * 나는 개체는 땅 보스의 사냥 층(land)에 없으니 잡히지도, 무서워하지도 않는다(사용자 요청).
 */
export function bossCanHunt(boss: Boss, e: Entity, world: World): boolean {
  const layer = entityLayer(e.genome.traits, world.terrain, e.x, e.y);
  if (!boss.huntLayers.includes(layer)) return false;
  // 하늘에서 내려다보는 보스(큰수리)는 수풀에 든 땅 개체를 못 본다. 하늘의 개체는 숨을 데가 없다.
  if (boss.grassCover && layer === "land" && world.terrain.isGrass(e.x, e.y)) {
    // ⚠ 사람이 한 번이라도 몬 세계에서는 **내 종에게 수풀 엄폐가 통하지 않는다.** 수풀은 형질 없이
    //   밟는 공짜 지형이라, 무리를 수풀에 세워 두면 이 보스의 카운터(시야 형질)를 통째로 무효화할
    //   수 있다("주차 악용"). 야생은 그대로다.
    //   게이트가 leaderId 가 아니라 commanded 인 이유가 핵심이다:
    //   ① 알파를 **지정만** 하고 명령을 안 준 세계까지 봉인하면 "지정만 하면 기존과 완전히 동일"이라는
    //      보장이 깨진다(실제로 큰수리 단계에서 개체 수·사망 수가 갈렸다).
    //   ② 반대로 followTicks(손 떼면 1.5초 뒤 0) 로 걸면 "몰아넣고 손 떼기"로 우회된다.
    //   commanded 는 끈끈해서(한 번 켜지면 안 꺼짐) 두 요구를 동시에 만족한다.
    if (!world.lead.commanded || !e.species.isPlayer) return false;
  }
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

/**
 * **이 종류의 보스를 애초에 때려서 격퇴할 수 있는가** · 보스가 아직 없는 시점(예고)에서 묻는 판정.
 *
 * `bossRaidable` 은 살아 있는 Boss 객체를 받으므로 예고에서는 못 쓴다. 그런데 예고는 보스가 나타나기
 * **전에** 무엇을 하라고 말해야 하므로, 타입만으로 답할 수 있어야 한다.
 * 근거는 `raidCounter` 하나다 · 그것이 null 이면 `createBoss` 가 `maxHp` 를 0 으로 두고,
 * 그러면 전사 태깅·원거리 사격·격퇴 체력 바가 전부 꺼진다(같은 파일의 raid 경로들).
 *
 * 왜 필요했나: 예고가 **없는 격퇴를 약속하고 있었다.** 독 안개(전역 재난)에도
 * 「공격력이나 원거리가 높으면 어떤 보스든 맞서 잡습니다」가 무조건 붙어, 공격력을 키운 사람이
 * 때릴 대상 없는 안개 앞에서 그대로 굶어 죽었다(2026-08-08 실측 · 원거리 갈래 시대 2 탈락 24/24).
 */
export function bossTypeRaidable(type: BossType): boolean {
  return PRESETS[type].raidCounter !== null;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 한 형질 값(0~100)을 floor~100 구간에서 0~1 충족도로. floor 이하는 0(야생·기본이 미미하게 걸린다). */
function traitFulfill(value: number, floor: number): number {
  return clamp01((value - floor) / (TRAIT_MAX - floor));
}

/**
 * 이 개체가 보스를 **근접에서 되받아치는 세기**(0~1). 두 갈래로 전사가 된다("모든 빌드가 싸우게"):
 *   · 보스 전용 카운터(속도·시야·무리·번식) — 그 형질이 강하면 자기 방식으로 되받아친다.
 *   · **공격력(만능 근접)** — 공격력이 높으면 **어떤 보스든** 이빨·뿔로 맞선다(카운터가 아니어도).
 * 0 이면 근접 전사가 아니다. (원거리는 raidRangedPower 로 따로 — 멀리서 안전하게 쏜다.)
 */
export function raidMeleePower(boss: Boss, t: Traits): number {
  let p = 0;
  const c = boss.raidCounter;
  if (c === "speed" && t.speed >= SIM.raidFighterThreshold) p = traitFulfill(t.speed, SIM.raidSpeedFloor);
  else if (c === "vision" && t.vision >= SIM.raidFighterThreshold) p = traitFulfill(t.vision, SIM.raidVisionFloor);
  else if (c === "group" && t.herding >= SIM.raidFighterThreshold) p = traitFulfill(t.herding, SIM.raidHerdFloor);
  else if (c === "fertility" && t.fertility >= SIM.raidFighterThreshold) p = traitFulfill(t.fertility, SIM.raidFertFloor);
  // 공격 = 만능 근접 카운터(어떤 보스든 맞선다). 카운터 충족도와 견줘 큰 쪽을 쓴다.
  if (c !== null && t.attack >= SIM.raidWarriorAttack) p = Math.max(p, traitFulfill(t.attack, SIM.raidAttackFloor));
  // 문턱을 넘었으면 **최소 몫**을 보장한다. 넘었다고 화면에 "전사"라 써 놓고 충족도 0.18 로 917번을
  // 물어야 이기게 두는 것은 표시와 실제의 불일치다(SIM.raidMeleeFloorPower 주석 참조).
  // 문턱을 못 넘으면 여기 안 온다 → 여전히 정확히 0(형질을 안 키우면 못 잡는다).
  return p > 0 ? SIM.raidMeleeFloorPower + (1 - SIM.raidMeleeFloorPower) * p : 0;
}

/**
 * 이 개체가 보스를 **멀리서 저격하는 세기**(0~1) — 원거리 형질이 문턱(rangedThreshold)을 넘으면. 원거리는
 * 즉사 반경 밖에서 안전하게 쏘므로 **어떤 보스든**(만능) 상대한다("원거리로 시작해도 보스를 잡는다").
 */
export function raidRangedPower(t: Traits): number {
  return t.ranged >= SIM.rangedThreshold ? traitFulfill(t.ranged, SIM.raidRangedFloor) : 0;
}

/**
 * 듀오 「돌진」(가죽 III + 다리 III 에서 열리는 카드) · **부딪혀 싸운다. 보스를 밀어내는 힘이 커진다.**
 *
 * ⚠ 이 수는 `tiers.DUOS` 의 「돌진」 설명(「1.6배」)과 **한 쌍**이다. 배수를 문장에서 없앨 수 없는
 *   자리라(규칙 특성은 축이 없어 `perkLine` 이 표에서 못 만든다) 두 곳에 적힌 유일한 수이고,
 *   그래서 `perks.test.ts` 가 「설명의 수 = 이 상수」를 못 박는다. 한쪽만 고치면 테스트가 깨진다.
 * ⚠ **근접에만 걸린다.** 「부딪혀 싸운다」이므로 원거리 사격(`raidRangedPower`)에는 안 붙는다.
 * ⚠ 전사 자격(`isRaidFighter`·`tagRaidFighters`)에는 안 걸린다 · 거기서는 0 보다 큰지만 보므로
 *   배수를 곱해도 판정이 안 바뀐다. 곱하는 자리를 「깎는 순간」 둘로 좁혀 둔다.
 */
export const CHARGE_RAID_MUL = 1.6;

function chargeMul(e: Entity): number {
  return hasRule(e.genome.perks, "charge") ? CHARGE_RAID_MUL : 1;
}

/**
 * power 만큼 격퇴 체력을 깎는다(**공격당** 이벤트 · 깎이는 양 = SIM.raidHitDamage × power).
 * 연출(근접 counter / 원거리 spit)은 방향이 달라 호출부에서 낸다.
 * ⚠ power 는 충족도(0~1)가 **아니다.** 호출부가 배율을 이미 곱해 넘긴다: 떼 근접 반격은 ×
 *   SIM.raidCounterMul(5), 원거리는 × SIM.raidRangedMul(2.2), 단일 보스는 배율 없음.
 * 깎인 사실은 여기 한 자리에서 world 의 관측값(raidHitTick·raidDamageWindow)에도 남긴다 · 사건 단위는
 * 바의 굵기보다 잘아서(체력 200 을 폭 72 월드px 로 그리면 1픽셀 ≈ 2.8 HP) 번쩍임·잔상이 있어야 읽힌다.
 * 관측값은 rng 를 안 쓰고 sim 판정에도 안 쓰인다 → 결정론·밸런스 무관.
 */
export function dealRaidHit(boss: Boss, power: number, world: World): void {
  if (power <= 0) return;
  const before = boss.hp;
  boss.hp -= SIM.raidHitDamage * power;
  if (boss.hp < 0) boss.hp = 0;
  world.recordRaidDamage(before - boss.hp);
}

/**
 * 이 개체가 지금 이 보스에 맞서는 전사인가(근접 또는 원거리). behavior 가 이걸 보고 전사는 도망을 스킵하게
 * 한다("강한 개체는 맞서고 약한 개체는 도망"). 전사만 맞서므로 전멸하지 않는다. 내 종만·사냥 가능 층만.
 */
export function isRaidFighter(boss: Boss, e: Entity, world: World): boolean {
  if (!e.species.isPlayer || !bossRaidable(boss) || !bossCanHunt(boss, e, world)) return false;
  return raidMeleePower(boss, e.genome.traits) > 0 || raidRangedPower(e.genome.traits) > 0;
}

/** 이 개체가 **원거리 전사**인가 — 멀리서 쏜다. behavior 가 접근·카이팅·사격에 쓴다(근접 전사는 그 자리에서 반격). */
export function isRaidRangedFighter(boss: Boss, e: Entity, world: World): boolean {
  return (
    e.species.isPlayer && bossRaidable(boss) && bossCanHunt(boss, e, world) && raidRangedPower(e.genome.traits) > 0
  );
}

/**
 * 화면이 읽을 관측값을 **판정이 일어나는 그 자리에서** 내보낸다(orderFollowers 와 같은 패턴).
 * 렌더가 매 프레임 전 개체를 돌며 isRaidFighter 를 다시 부르면 폰 프레임이 죽고, 조건을 밖에서
 * 다시 유도하면 화면과 실제가 갈린다(known_issues).
 * 근접·원거리를 겸하는 개체는 **근접으로만** 센다 → 두 수의 합이 raidFighter 플래그 수와 정확히 같다.
 * rng 미사용·단순 합계 → 결정론·밸런스 무관.
 */
function tagRaidFighters(boss: Boss, world: World): void {
  const raidable = bossRaidable(boss);
  let melee = 0;
  let ranged = 0;
  for (const e of world.entities) {
    if (!e.alive || !e.species.isPlayer) continue;
    if (!raidable || !bossCanHunt(boss, e, world)) continue;
    if (raidMeleePower(boss, e.genome.traits) > 0) {
      melee += 1;
      e.raidFighter = true;
    } else if (raidRangedPower(e.genome.traits) > 0) {
      ranged += 1;
      e.raidFighter = true;
    }
  }
  world.raidMeleeFighters = melee;
  world.raidRangedFighters = ranged;
}

/** 보스 한 틱. 타입별로 다른 압박을 가한다. */
export function stepBoss(boss: Boss, world: World): void {
  tagRaidFighters(boss, world);
  // 개체형 떼 시련(사나운 무리·약탈자·외톨이 사냥꾼·그림자 매복자·말벌 떼) — 실제 개체가 몰려와 문다.
  // 격퇴 체력은 즉사 판정과 **분리된 자리**에서 깎인다: 근접은 stepMeleeCounter(반격 반경 × 개체별
  // 쿨다운), 원거리는 behavior 의 사격. memberKills 는 이제 죽는가만 본다(그 함수 주석 참조).
  if (boss.members.length > 0) {
    stepMemberHorde(boss, world);
  } else {
    stepSingleBoss(boss, world);
  }
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
        // 전사(빠른 개체·만능 공격, 또는 원거리)는 격퇴 체력을 깎고 안 죽는다(추격자·상어).
        if (bossRaidable(boss) && e.species.isPlayer) {
          const melee = raidMeleePower(boss, e.genome.traits);
          if (melee > 0 || raidRangedPower(e.genome.traits) > 0) {
            // 단일 보스(추격자·큰수리·상어)는 즉사 반경이 넓어(14~68px) 접촉이 이미 충분하다 →
            // 떼처럼 반경·쿨다운을 따로 두지 않고 예전 구조(닿은 틱마다 반격)를 그대로 둔다.
            // 연출만 bite → counter 로 가른다(씹힌 것과 되받아친 것이 같은 그림이면 구별이 안 된다).
            if (melee > 0) {
              dealRaidHit(boss, melee * chargeMul(e), world); // 듀오 「돌진」이 밀어내는 힘을 키운다
              world.emit("counter", e.x, e.y, e.species.isPlayer, boss.x, boss.y); // 연출: 맞받아침(근접)
            }
            continue;
          }
        }
        e.alive = false;
        world.recordDeath(e.species, "boss");
        world.emit("kill", e.x, e.y, e.species.isPlayer); // 연출: 보스 즉사 반경
      }
    }
  }

  if (boss.globalDrain > 0) {
    for (const e of world.entities) {
      if (!e.alive) continue;
      if (!bossCanHunt(boss, e, world)) continue; // 독 안개는 전 층위 → 실질적으로 모두
      // **수풀은 피난처** · 잎 아래에 든 것은 안 빨린다. 전역 흡수에 뚫린 유일한 구멍이다
      // (층위·엄폐는 위 bossCanHunt 소관이고, 흡수는 그 게이트를 통과한 뒤라 안 걸린다).
      //
      // ⚠ **여기에는 `bossCanHunt` 의 「주차 악용 방지」 게이트(`!world.lead.commanded ...`)를 걸지 않는다.**
      //   그 게이트는 큰수리처럼 **격퇴 카운터가 있는 보스**의 카운터(시야 형질)를 수풀 주차로 통째로
      //   무효화하는 걸 막으려고 넣은 것이다. 독 안개는 애초에 카운터가 없고(그게 이 보스의 결함이었다),
      //   여기서 무리를 수풀로 미는 것은 **막아야 할 악용이 아니라 하라고 만든 일**이다.
      //   게다가 지금은 모든 런이 조종 ON 이라 그 게이트를 걸면 피난처가 그 즉시 무의미해진다
      //   (실측으로는 몰기가 이득도 아니어서 악용될 여지 자체가 없다 · drainShelter 주석 참조).
      //   (다음 사람이 "왜 여기만 게이트가 없지?"로 되돌리지 않게 근거를 남긴다.)
      // ⚠ rng 를 안 쓴다 · 순수 지형 판정이라 난수 스트림이 1비트도 안 밀린다.
      if (boss.drainShelter && world.terrain.isGrass(e.x, e.y)) continue;
      e.energy -= boss.globalDrain * (0.3 + e.genome.traits.metabolism / TRAIT_MAX);
      if (e.energy <= 0) {
        e.alive = false;
        world.recordDeath(e.species, "boss");
        world.emit("death", e.x, e.y, e.species.isPlayer); // 보스 기력 고갈 = 자연사 톤
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
        world.emit("kill", e.x, e.y, e.species.isPlayer); // 연출: 떼 개체가 문 자리
      }
    }
  }
  // 반격은 **즉사 판정과 다른 자리**에서 판정한다(아래 주석 참조). 모든 떼가 움직인 뒤라 순회 순서 무관.
  stepMeleeCounter(boss, world);
}

/**
 * 근접 전사의 **반격** 한 틱 · 떼에 붙어 있는 전사가 쿨다운마다 한 번씩 되받아쳐 격퇴 체력을 깎는다.
 *
 * 왜 즉사 판정(killRadius)에서 떼어 냈나. 예전엔 memberKills 안에서 "물린 순간 맞받아친다"로 함께
 * 판정했다. 그러면 반격 기회가 즉사 반경(약탈자 8px)이라는 **요구량과 같은 자리**에 눌려, 격퇴가
 * 형질이 아니라 접촉 면적에 지배당한다 · 떼 한복판에 낀 한 마리는 매 틱 여러 번 깎고, 스쳐 지나간
 * 판은 한 번도 못 깎는다(실측: 모든 공격력 구간에서 "한 번도 안 깎인 시드"가 늘 섞였다 = 전부 아니면
 * 전무). 반경을 넓히고(SIM.raidCounterRadius 40px × 시대 배율) 개체별 쿨다운을 두면 "붙이면 깎인다"가
 * 손끝에서 성립한다. 한 방의 크기는 SIM.raidCounterMul 로 키워 격퇴 바에서 눈에 보이게 했다.
 *
 * ⚠ 여기서는 **죽음 판정을 한 글자도 안 건드린다.** 전사가 안 죽는 것은 위 memberKills 가 그대로
 *   담당한다 · 죽음 경로가 오염되면 "보스에게 죽은 내 종 수"가 통째로 이동해 기존 밸런스가 무너진다.
 * ⚠ world.rng 를 한 번도 안 쓴다(정수 쿨다운뿐) → 난수 스트림 불변.
 */
function stepMeleeCounter(boss: Boss, world: World): void {
  if (!bossRaidable(boss)) return;
  const r2 = boss.counterRadius * boss.counterRadius;
  for (const e of world.entities) {
    if (!e.alive || !e.species.isPlayer) continue;
    if (e.raidCounterCd > 0) continue;
    if (!bossCanHunt(boss, e, world)) continue; // 숨거나 층이 다르면 못 때린다(기존 규칙 그대로)
    const power = raidMeleePower(boss, e.genome.traits);
    if (power <= 0) continue; // 근접 전사가 아니다(원거리는 behavior 에서 따로 쏜다)
    // 가장 가까운 떼 개체 · 반격 스파크가 그쪽을 향하게 하려면 방향이 필요하다.
    let best2 = Infinity;
    let bx = 0;
    let by = 0;
    for (const m of boss.members) {
      const dx = m.x - e.x;
      const dy = m.y - e.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best2) {
        best2 = d2;
        bx = m.x;
        by = m.y;
      }
    }
    if (best2 > r2) continue;
    dealRaidHit(boss, power * SIM.raidCounterMul * chargeMul(e), world); // 듀오 「돌진」 포함
    e.raidCounterCd = SIM.raidCounterCooldown;
    // 연출: 되받아침. 씹힌 것(bite)과 **다른 그림**이라야 화면에서 구별된다.
    world.emit("counter", e.x, e.y, true, bx, by);
  }
}

/**
 * 떼 개체가 문 개체를 실제로 죽이는가 — 그리고 **문 순간 격퇴 체력을 깎는가**(레이드).
 *   전사(카운터 형질≥문턱, 공격·속도·무리·시야): 물린 순간 **맞받아쳐 격퇴 체력을 깎고 살아남는다**.
 *   번식 카운터(사나운 무리): 전사가 없다 → 물리면 죽되, 물릴 때마다 다산 무리가 수로 압도해 떼를 지치게 한다.
 *   그 외(약한 개체·era 0·레이드 꺼짐): 기존 확률 저항으로 생존/죽음(카운터 형질 높으면 잘 산다).
 */
function memberKills(e: Entity, boss: Boss, world: World): boolean {
  const t = e.genome.traits;
  // 전사(근접 카운터·만능 공격, 또는 원거리)는 물려도 산다 · 여기는 **죽는가만** 판정한다.
  // 격퇴 체력을 깎는 것은 stepMeleeCounter(근접) · behavior(원거리)가 따로 맡는다. 예전엔 이 자리에서
  // 함께 깎았는데, 그러면 반격 기회가 즉사 반경에 갇혀 격퇴가 접촉 면적에 지배당했다(위 주석).
  if (bossRaidable(boss) && e.species.isPlayer) {
    if (raidMeleePower(boss, t) > 0 || raidRangedPower(t) > 0) return false;
  }
  // 비전사(약한 개체)·레이드 꺼짐: 카운터 형질 확률 저항(형질 높을수록 잘 산다). 저항 없으면(사나운 무리) 죽음.
  if (boss.cullAttackResist > 0) return world.rng.unit() >= boss.cullAttackResist * (t.attack / TRAIT_MAX);
  if (boss.cullGroupResist > 0) return world.rng.unit() >= boss.cullGroupResist * (t.herding / TRAIT_MAX);
  if (boss.cullSpeedResist > 0) return world.rng.unit() >= boss.cullSpeedResist * (t.speed / TRAIT_MAX);
  if (boss.cullVisionResist > 0) {
    // 그림자 매복자 — 수풀 안에선 시야가 안 통해 미리 못 알아챈다(저항 40%로 감소 → 수풀이 사냥터).
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
