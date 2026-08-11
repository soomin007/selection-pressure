// 시뮬 월드 — 모든 상태와 한 틱 진행(step)을 담는다. 순수 TS, 결정론.
// (게놈 + 환경 시드) → 같은 step 횟수면 항상 같은 결과. (기획서 §3.4)
//
// 다종 생태계: 내 종(player) 1개 + 야생종 여러 개가 한 세계에 산다(스포어처럼).
// 초식은 식물(food)을, 육식은 다른 종을 먹는다. 먹이/사냥 경쟁이 창발한다.

import { Rng } from "@/sim/rng";
import { TRAIT_MAX, cloneGenome, mutateGenome, type Genome, type Traits } from "@/sim/genome";
import { carnivory01, grazeEfficiency, huntEfficiency } from "@/sim/diet";
import { createEntity, type Entity } from "@/sim/entity";
import { createFood, type Food } from "@/sim/food";
import { Environment } from "@/sim/environment";
import { Terrain, TILE, type TileKind } from "@/sim/terrain";
import { mapKind, type MapType } from "@/sim/mapType";
import { SpatialGrid } from "@/sim/spatialGrid";
import { FoodGrid } from "@/sim/foodGrid";
import { makePlayerSpecies, generateWildSpecies, makeKinSpecies, makeBiomeSpecies, makeMapSpecies, mapSpeciesHabitat, makeChampionSpecies, BIOME_FOOD_KIND, areFriends, type Species, type ChampionSeed } from "@/sim/species";
import type { Biome } from "@/sim/environment";
import { stepEntity, visionRadius, leadBiteTarget, isApex } from "@/sim/behavior";
import { stepBoss, type Boss } from "@/sim/boss";
import { createLeadState, type LeadState } from "@/sim/lead";
import {
  GENE_PICK_RADIUS,
  GENE_SPAWN_RING,
  createGeneDrop,
  geneDropOffset,
  geneDropReached,
  type GeneDrop,
  type GeneReason,
} from "@/sim/gene";
import type { HerdOrder } from "@/sim/herdOrder";
import {
  CARRION_FROM_DEATH,
  CARRION_LEFTOVER,
  carcassEdible,
  carcassReached,
  createCarcass,
  type Carcass,
} from "@/sim/carrion";
import { FEVER_KEEP, SALMON_MIN_ENERGY, SALMON_SHARE, hasRule } from "@/sim/perks";
import { SIM, LEAD } from "@/sim/params";

/** 한 마리가 죽은 이유 (가독성 §7: "왜 내 종이 죽었나"). 사람이 읽는 한글 라벨은 game 층에서. */
/** "wound"(부상) = 물려서 기운이 다해 죽음. 포식자가 마무리하지 못하고 놓친 개체 — 굶주림이 아니다. */
export type DeathCause = "starve" | "cold" | "heat" | "age" | "boss" | "predation" | "plague" | "venom" | "wound";
export type DeathTally = Record<DeathCause, number>;

export function emptyDeathTally(): DeathTally {
  return { starve: 0, cold: 0, heat: 0, age: 0, boss: 0, predation: 0, plague: 0, venom: 0, wound: 0 };
}

/** 라운드(단계) 계수기 · 내 종의 사건만 센다. game 이 시험 판정에 읽는다(§round_verdict_spec B). */
export interface RoundCounts {
  hunts: number; // 내 종이 잡아먹은 수(알파든 무리든, 잡아먹힌 쪽은 아님)
  feeds: number; // 내 종의 채집 섭취 확정 수(산 보물 제외)
  births: number; // 내 종 새끼 탄생 수(일반 번식 + 산 보물 대박. 드래프트 스킵 brood 는 제외)
  marked: number; // 표식이 찍힌 야생을 잡은 수(시험 「표시된 것 사냥」)
}

/** 형질(0~100) 클램프 + 반올림. */
const clampTrait = (v: number): number => {
  const n = Math.round(v);
  return n < 0 ? 0 : n > TRAIT_MAX ? TRAIT_MAX : n;
};

/**
 * **야생 진화가 흔드는 능치 열 개 · 이 순서 그대로.** `wildEvoRng` 소비 횟수와 순서가 야생 생태
 * 밸런스 그 자체다(`species.ts` 의 `WILD_RNG_KEYS` 와 같은 계열의 제약). 만지려면 프로브부터 돌려라.
 */
const WILD_DRIFT_KEYS = [
  "speed",
  "attack",
  "vision",
  "herding",
  "metabolism",
  "fertility",
  "diet",
  "echo",
  "venom",
  "ranged",
] as const satisfies readonly (keyof Traits)[];

/** 야생종 한 무리가 겪는 압력 측정치(0~1). maybeEvolveWild 가 재서 adaptWildTraits 에 넘긴다. */
export interface WildPressure {
  /** 무리 평균 추위(0=따뜻 ~ 1=한랭) */
  avgCold: number;
  /** 무리 평균 에너지 비율(0=빈사 ~ 1=포만) — 낮으면 먹이 부족 */
  avgEnergy01: number;
  /** 무리 중 포식자에 노출된 개체 비율(0~1) */
  predFrac: number;
}

/**
 * 측정한 압력으로 야생종 공유 게놈 형질을 "한 스텝" 적응시킨다(제자리 수정). 순수 함수 — rng 미사용이라
 * 결정론적이고 단위 테스트가 쉽다(미세 무작위 드리프트는 호출부에서 별도로 한다). 적응 세 갈래:
 *   · 대사: 추위는 위로(체온), 먹이 부족은 아래로(효율). 둘이 대사 하나를 두고 밀당한다.
 *   · 포식 노출: 속도·무리 성향을 위로(빠르고 뭉쳐서 안 잡아먹힌다).
 * 각 형질은 목표를 향해 wildAdaptRate 만큼만 다가가 세대에 걸쳐 천천히 수렴한다.
 */
export function adaptWildTraits(t: Traits, p: WildPressure): void {
  // (1) 대사 — 추위 위로, 먹이 부족 아래로. 굶주림 끌기는 임계 밑에서만 켜져 배부른 무리는 기존과 동일.
  const coldPull = p.avgCold * SIM.wildColdMetaGain;
  const thr = SIM.wildScarcityEnergyThreshold;
  const scarcity = p.avgEnergy01 < thr ? (thr - p.avgEnergy01) / thr : 0; // 0~1
  const metaTarget = clampTrait(SIM.wildMetaBase + coldPull - scarcity * SIM.wildScarcityMetaDrop);
  t.metabolism = clampTrait(t.metabolism + (metaTarget - t.metabolism) * SIM.wildAdaptRate);

  // (2) 포식 압력 — 노출 비율만큼 속도·무리 목표를 현재치 위로. 노출 0이면 목표=현재라 안 움직인다.
  if (p.predFrac > 0) {
    const speedTarget = clampTrait(t.speed + p.predFrac * SIM.wildPredSpeedRange);
    const herdTarget = clampTrait(t.herding + p.predFrac * SIM.wildPredHerdRange);
    t.speed = clampTrait(t.speed + (speedTarget - t.speed) * SIM.wildAdaptRate);
    t.herding = clampTrait(t.herding + (herdTarget - t.herding) * SIM.wildAdaptRate);
  }

  // (3) **파생 축을 따라오게 한다.** v8 에서 소모·채집·사냥이 `traits` 의 파생 필드(upkeep·graze·
  //     hunt·carnivory)로 옮겨 갔는데, 그 값은 게놈을 만들 때 한 번 계산된다. 야생이 대사를 진화시켜도
  //     유지비가 안 따라가면 **"추운 곳 무리가 고대사로 수렴한다"는 적응이 세계에 아무 영향을 못 준다**
  //     (실측: 빙하 야생의 대사가 40.8 까지 올라도 소모는 시작값 그대로였다 · world.test 회귀).
  //     v7 에서는 매 틱 `0.5 + 대사/100` 을 다시 계산했으므로, 여기서 다시 계산하는 것이 v7 복원이다.
  syncWildDerived(t);
}

/**
 * 야생 능치가 드리프트한 뒤 **파생 축을 v7 공식으로 다시 낸다.** 야생 진화·개체 변이가 값을 흔든
 * 모든 자리에서 부른다.
 *
 * ⚠ 플레이어 종에는 부르지 않는다 — 그쪽은 도장에서 파생되므로 `refreshDerived` 가 맡는다.
 *   여기서 부르면 티어가 정한 값을 식성 곡선이 덮어써 화면과 실제가 갈린다.
 */
export function syncWildDerived(t: Traits): void {
  t.defense = t.attack;
  t.upkeep = 0.5 + t.metabolism / TRAIT_MAX;
  t.graze = grazeEfficiency(t.diet);
  t.hunt = t.diet > SIM.dietHuntMin ? huntEfficiency(t.diet) : 0;
  t.carnivory = carnivory01(t.diet);
}

/** 화면 연출용 1회성 사건(전 종, 위치 포함). 렌더가 매 프레임 읽고 비운다. rng 미사용 → 결정론 무관. */
/** "bite" = 못 죽인 물기(기운만 깎였다). 즉사는 "kill". */
// "block" = 이빨이 안 박힌 물기(biteOutcome.ignored). 예전엔 **아무것도 안 일어나서** 화면상
// "왜 공격이 안 먹히는지"를 알 방법이 없었다(CLAUDE.md 전달 규칙이 좋은 피드백의 예로 든 바로 그 자리:
// "물기가 튕겨 나감"). 사거리·쿨다운은 그대로 소모되므로 헛손질에 대가도 있다.
// "counter" = 내 무리가 보스에게 **되받아친** 순간(dealRaidHit 이 나는 자리). 물린 것(bite)과 갈라 놓는다 ·
// 반격 한 번은 체력 200 짜리 바에서 몇 픽셀도 못 움직인다(공격력 64 기준 3.05 HP ≈ 1픽셀). 몇 번 쳤는지를
// 사람이 실제로 읽는 것은 그 순간의 스파크다(전달 규칙 2순위: 일어나는 순간의 피드백).
// "gene" = 내 무리가 **방울을 밟아 주운** 순간. 방울은 세계에 놓인 물건이지 화면의 응답이 아니므로
// (명령 핑 "go"/"deny" 와 다르다) 자리는 여기 sim 쪽 union 이 맞다. 판정이 나는 곳은 step() 의 줍기
// 블록 한 자리뿐이라, 렌더가 좌표를 보고 "주웠나 보다" 하고 추정할 필요가 없다.
// ⚠ **지금 이 사건을 그리는 쪽은 없다**(2026-08-07 통합 시점). `render/effects.ts` 는 "gene" 을 받으면
//   곧장 return 하고, 줍기 연출은 `render/geneDrops.ts` 가 `drop.taken` 이 false→true 로 바뀌는 것을
//   스스로 보고 그린다 · `VisualEvent` 에는 `amount` 가 없어서 effects 는 3개짜리와 5개짜리를
//   구별할 수 없기 때문이다(「수치가 화면 표시와 다르면 거짓말」 규칙). 사건 자체는 남겨 둔다:
//   비용이 0 에 가깝고, 소리·햅틱처럼 「값을 모르는 채로 반응해도 되는 것」이 붙을 자리다.
// ⚠ 이 union 에 멤버를 더하면 `src/render/effects.ts` 의 `LIFE: Record<ParticleKind, number>` 가
//   즉시 컴파일 에러가 난다(Record 는 모든 키를 요구한다). 거기 `gene: <수명ms>` 한 줄을 함께 넣어야
//   짝이 맞는다 · 렌더 쪽이 이미 "counter" 로 같은 함정을 겪고 주석에 적어 둔 그 자리다.
export type VisualEventKind = "birth" | "death" | "kill" | "bite" | "spit" | "block" | "counter" | "gene";
export interface VisualEvent {
  kind: VisualEventKind;
  x: number;
  y: number;
  /** 내 무리(플레이어 종)가 얽힌 사건인가 — 렌더가 야생끼리의 사건을 옅게/생략해 화면 소음을
   *  줄이는 근거다(2026-08-02 사용자: 남의 사건 연출이 정신사납다). 판정은 emit 하는 자리(사건의
   *  당사자를 아는 곳)에서만 한다 — 렌더가 좌표로 추정하면 화면이 거짓말하게 된다. */
  mine: boolean;
  /** 방향성 사건(원거리 발사체 "spit")의 목표점 — (x,y)에서 여기로 날아간다. 없으면 제자리 사건. */
  tx?: number;
  ty?: number;
}

/**
 * 세계를 좁히는 옵션 — **처음 겪는 판을 단순하게** 만드는 데 쓴다(게임 층의 온보딩 진도가 정한다).
 *
 * ⚠ **sim 은 "시대"도 "온보딩 진도"도 모른다.** 여기 오는 것은 game 이 이미 해석해 둔 값뿐이다
 *   (world 의 `foodScarcity` 와 같은 구조 · 진도표는 game/config.ts 의 `stepWorldOptions`).
 * ⚠ **아무것도 안 주면(빈 객체) 지금까지의 온전한 세계다.** 모든 기본값이 "예전 그대로"라야
 *   기존 테스트·골든 지문이 산다 — 새 항목을 더할 때도 이 규칙을 지킬 것.
 */
export interface WorldOptions {
  /**
   * 세계에 남길 **야생종 이름 목록**. 생략 = 전부 남긴다. 내 종은 언제나 남는다.
   * ⚠ 목록에 없는 종도 **생성·스폰을 그대로 다 한 뒤** 마지막에 개체만 걸러낸다 — 아키타입 하나가
   *   메인 rng 7회라 생성을 건너뛰면 세계가 통째로 갈리고, 스폰을 건너뛰면 개체 id 가 밀린다.
   */
  keepWildNames?: readonly string[];
  /**
   * 우호 무리(친척 무리 · 챔피언)를 남기는가. 생략 = true(온전한 세계).
   * false 면 초록 계열 무리가 내 종 하나뿐이라 "누가 내 편인지"를 나중에 배우게 된다.
   */
  kin?: boolean;
  /**
   * 기후를 평탄하게 못박아 맵 전체를 한 바이옴(초원)으로 만드는가. 생략 = false(시드로 뽑은 기후).
   * 켜면 바이옴 특화종 3종과 바이옴 전용 먹이가 **기존 게이트로 저절로** 사라진다.
   */
  flatClimate?: boolean;
  /**
   * 사냥하는 야생 무리를 내 종에서 일정 거리에 옮기는가. 생략 = false(시드가 놓은 자리 그대로).
   * 켜면 "시작하자마자 물림"도 "끝까지 못 봄"도 없어진다(rng 미사용 · 결과값만 평행이동).
   */
  spacedPredators?: boolean;
  /**
   * **사냥하는 야생을 이 배수만큼 늘린다.** 생략·1 = 지금까지 그대로. game 이 시대 배율을 넘긴다
   * (`eraPredatorPressure` · 첫 시대는 1.0 이라 기존 세계·테스트가 1비트도 안 흔들린다).
   *
   * 왜 여기인가: 위협 배율(보스 체력·즉사 반경·떼 수)은 전부 관문 **안**에서만 살아, 관문 밖의 하루하루가
   * 시대마다 똑같았다(실측: 위협 ×2.22 에 시대 끝 개체 수 22.9 → 22.7). 나를 잡아먹는 것의 수는
   * 채집 라운드 내내 개체 수를 실제로 깎고, **화면에서 붉은 것이 늘어나는 것으로 곧장 읽힌다.**
   *
   * ⚠ 늘리는 개체는 **모든 스폰이 끝난 뒤 독립 rng** 로 붙인다(친척·챔피언과 같은 안전한 패턴) —
   *   메인 rng 소비 순서를 안 건드려야 같은 시드의 세계가 이 옵션 하나로 통째로 갈리지 않는다.
   */
  predatorPressure?: number;
}

/**
 * 이 종을 이번 세계에서 감추는가. 내 종은 절대 안 감춘다.
 * 우호 무리(친척 · 챔피언 — 둘 다 `friendly`)는 `kin` 하나가 가르고, 나머지 야생은 이름 목록이 가른다.
 * (챔피언은 애초에 game 이 진도 3 전에는 넘기지 않으므로 여기 걸릴 일이 거의 없다.)
 */
function isHidden(sp: Species, opt: WorldOptions): boolean {
  if (sp.isPlayer) return false;
  if (sp.friendly) return opt.kin === false;
  return opt.keepWildNames !== undefined && !opt.keepWildNames.includes(sp.name);
}

export class World {
  readonly width: number;
  readonly height: number;
  /** 면적 배율(화면 1개 = 1). 개체·먹이·개체 상한을 월드 크기에 비례시켜 밀도를 일정하게 유지한다.
   * 테스트는 작은 월드(1)로 빠르게, 게임은 큰 월드(맵 3배 → 9)로. 밀도가 같아 밸런스가 일관된다. */
  readonly areaScale: number;
  readonly rng: Rng;
  /** 개체별 변이 전용 독립 rng — 새끼 게놈을 부모에서 조금 흔든다(개체별 진화). 메인 rng 소비 순서를 안
   * 건드려 기존 밸런스를 보존한다(known_issues: rng 스트림을 늘리면 분포가 통째로 이동). */
  readonly mutRng: Rng;
  /** 내 종 게놈 — 드래프트가 수정하는 대상(살아있는 중 바꾸면 즉시 반영). */
  readonly genome: Genome;
  readonly playerSpecies: Species;
  readonly species: Species[];
  readonly environment: Environment;
  /** 지형(바다/육지/산). 현재는 시각 전용 — 이동/먹이/시야 결합은 다음 슬라이스(독립 rng 라 sim 동역학 무관). */
  readonly terrain: Terrain;
  /** 이번 판의 세계 종류(대륙·판게아·군도·대양). 지형 파라미터와 먹이 배수를 정한다. */
  readonly mapType: MapType;
  /**
   * 이번 세계에서 **감춘 종**의 id. 좁힌 세계(온보딩 초반)에서만 비어 있지 않다.
   * 종을 만드는 것도, 스폰 추첨도 그대로 두고 **마지막에 개체만 걸러낸다** — 그래야 rng 소비·개체 id·
   * 남은 종의 스폰 좌표가 1비트도 안 밀린다. `species` 배열에는 감춘 종도 그대로 남는다(길이 불변).
   */
  readonly hiddenSpeciesIds: ReadonlySet<number>;
  readonly grid: SpatialGrid;
  /** 먹이 공간 격자 — 가까운 먹이 질의를 빠르게(큰 맵 성능). 먹이 위치 불변이라 생성 시 1회 빌드. */
  readonly foodGrid: FoodGrid;
  /** 야생 진화의 무작위 드리프트 전용 rng — 메인 rng 스트림을 안 건드려 기존 결정론을 보존한다. */
  private readonly wildEvoRng: Rng;

  /**
   * **방울 전용 rng.** 방울이 나타나는 자리를 여기서만 뽑는다 · 메인 `rng` 를 쓰면 소비 횟수가
   * 밀려 야생 스폰·진화 밸런스가 통째로 이동한다. 결정론은 그대로다(같은 시드 = 같은 자리).
   */
  readonly geneRng: Rng;

  /**
   * 알파 조종 상태. leaderId < 0 이면 이 기능은 존재하지 않는 것과 같다(= 기존 모드).
   * 알파를 **지정만** 하고 명령을 한 번도 안 줘도 마찬가지다: sim 안에서 조종이 갈라놓는 분기는
   * followTicks(무리 추종)와 commanded(수풀 봉인) 둘뿐이고, 둘 다 첫 명령 전에는 0/false 다.
   * **Entity 에는 아무것도 추가하지 않는다** — "직렬화 안 함" 관례·createEntity 시그니처·
   * 게놈 버전 계약을 흔들지 않기 위해 World 의 id 하나로만 추적한다.
   * entities 는 매 틱 filter 로 재구성되므로 인덱스가 아니라 반드시 id 로 추적한다.
   */
  readonly lead: LeadState = createLeadState();

  entities: Entity[] = [];
  food: Food[] = [];
  tick = 0;
  /** 내 종이 먹은 먹이 누적 수 — 레벨업 경험치의 소스. rng 미사용 → 결정론·밸런스 무관(game 이 delta 로 XP). */
  playerFoodEaten = 0;
  /**
   * 내 종이 성공시킨 사냥 누적 수 — **[사용자 2026-08-06]** 사냥도 경험치를 준다.
   * `roundCounts.hunts` 와 달리 라운드 경계에서 안 비워진다(누적이라야 game 이 delta 를 뽑는다).
   */
  playerHuntKills = 0;
  /** 이번 단계(라운드)의 내 종 사건 계수 · 시험 판정용. game 이 beginStage 마다 resetRoundCounts 로
   * 비운다. 정수 증가만 한다(rng 미사용 → 결정론·밸런스 무관). */
  readonly roundCounts: RoundCounts = { hunts: 0, feeds: 0, births: 0, marked: 0 };

  /**
   * **필드에 놓인 방울들.** 주운 것도 `taken: true` 로 배열에 남는다(`Food.available` 과 같은 결).
   * 한 시대에 30개 남짓이라 지울 필요가 없고, 남겨 둬야 렌더가 주운 자리에 연출을 그릴 수 있다.
   */
  geneDrops: GeneDrop[] = [];
  /**
   * 내 종이 주운 방울 **누계**. `playerFoodEaten` 과 같은 결이다 · sim 은 더하기만 하고,
   * game 이 delta 를 떠서 자기 지갑(`geneBank`)에 넣는다. rng 미사용 → 결정론·밸런스 무관.
   *
   * ⚠ **이 값은 새 World 마다 0 부터 다시 센다.** game 이 든 직전값(`lastGeneCollected`)도
   *   World 를 갈아 끼우는 **모든** 자리에서 함께 0 으로 되돌려야 한다. 오늘(2026-08-07)
   *   `lastHuntKills` 가 바로 그 짝을 놓쳐 시대 전환마다 경험치가 −85~−2410 씩 깎였다.
   */
  geneCollected = 0;

  /**
   * **필드에 남은 사체들** — 「썩은 고기를 먹는 위」(이빨 4단 카드)가 있는 판에서만 쌓인다.
   * 구조·수명 규칙은 `geneDrops` 와 같은 결(`sim/carrion.ts` 참조). 카드가 없는 판에서는
   * 빈 배열 그대로라 순회 비용도 렌더도 0 이다.
   */
  carcasses: Carcass[] = [];
  /**
   * **개체 루프 밖에서 태어난 새끼들**(「연어의 귀향」 · 보스·역병 죽음 자리). behavior 의
   * `newborns` 와 같은 규칙로 이번 틱 끝(`step` 의 합류 지점)에 세계에 들어간다.
   */
  pendingBirths: Entity[] = [];

  /**
   * 무리에게 내린 뜻(신탁). null 이면 무리는 완전히 자율로 산다 = 관전.
   * 입력층이 세팅하고 behavior 가 읽는다. 계약·설계 의도는 `sim/herdOrder.ts` 주석에 있다.
   * rng 미소비 · null 이면 관련 분기가 통째로 안 돌아 기존 세계와 부동소수점까지 같다.
   */
  herdOrder: HerdOrder | null = null;
  /**
   * **명령이 닿는 거리(px).** game 이 매 단계 무리 티어에서 계산해 넣어 준다(`herdOrder.voiceRadius`).
   * sim 은 티어를 모른다 — 받은 숫자를 쓰기만 한다(`foodScarcity` 와 같은 구조).
   * 0 이면 명령이 아무에게도 안 간다.
   */
  voiceR = 0;
  /**
   * **지휘 공백** — 알파가 죽고 나서 명령이 안 통하는 남은 틱 수. 무리 티어가 이 길이를 줄인다.
   * 0 이면 정상(명령이 통한다). 매 틱 1씩 준다.
   *
   * ⚠ **알파의 죽음으로 불씨를 깎지 않는다.** 불씨는 다섯뿐인데 알파는 앞장서는 자리라 자주 죽고,
   *   무엇보다 불씨는 「시험에 떨어졌다」 한 뜻만 가진 미터인데 알파 죽음을 섞으면 뜻이 흐려진다.
   *   공백은 **손끝으로 치르는 대가**다 — 몇 초 동안 무리가 자율로 흩어진다.
   */
  // ⚠⚠ **2026-08-10 부터 이 값을 읽는 규칙이 하나도 없다.** **[사용자]** 「이끌던 개체 어쩌고
  //   아예 없애줘」로 명령 게이트 둘(`hearsOrder` · `game.setHerdOrder`)에서 걷어냈다.
  //   값은 여전히 세지만(아래 `vacuumOnLeadDeath`) 세계는 그것으로 아무 일도 안 한다.
  //   **지우지 않고 남긴 이유**: 알파를 통째로 없앨지가 아직 미결이고(backlog 「알파를 없앨지
  //   정한다」), 그 결정과 함께 `lead`·`passBaton`·`HERD_VACUUM_TICKS` 를 한 묶음으로 정리하는
  //   편이 낫다. 지금 여기만 지우면 무리 티어의 값어치 표(`HERD_VACUUM_TICKS`)가 홀로 남는다.
  leadVacuum = 0;
  /** 알파가 죽었을 때 걸 지휘 공백의 길이(틱). game 이 무리 티어에서 계산해 넣어 준다.
   *  ⚠ 위 주석대로 **지금은 아무 효과가 없다.** */
  vacuumOnLeadDeath = 0;

  /**
   * **이 자리에 선 개체가 지금 명령을 듣는가**: 목소리가 닿는 거리 안이고, 지휘 공백이 아닐 것.
   *
   * ⚠ 이 판정은 **여기 한 곳에만** 적는다. 예전에는 behavior 의 지시 블록이 이 식을 손으로 들고
   *   있었고, game 의 기력 소모는 그 조건을 **아예 안 봤다.** 주석은 "목소리가 닿는 개체만"이라
   *   적혀 있는데 코드는 살아 있는 내 종 **전부**의 기력을 깎고 있었다(2026-08-09 발견).
   *   「피해라」 한 번에 목소리 밖의 개체까지 기력 −8 을 물던 자리다.
   *   같은 규칙을 두 곳에 적으면 반드시 갈라진다는 이 저장소의 단골 함정 그대로였다.
   *
   * rng 미사용 · 순수 기하. 지시가 없으면 부르는 쪽이 없으므로 스트림에 영향이 없다.
   */
  hearsOrder(x: number, y: number): boolean {
    // ⚠ 여기 있던 `this.leadVacuum <= 0 &&`(지휘 공백)을 2026-08-10 에 걷었다 ·
    //   **[사용자]** 「이끌던 개체 어쩌고 아예 없애줘」. 알파가 쓰러진 직후에도 명령이 계속 닿는다.
    //   `leadVacuum` 은 아직 세계가 세지만 **이제 아무도 안 본다**(아래 필드 주석 참조).
    return (
      this.voiceR > 0 &&
      (this.lead.x - x) ** 2 + (this.lead.y - y) ** 2 <= this.voiceR * this.voiceR
    );
  }

  /**
   * **이번 라운드 시험이 세계 위에 찍은 자리.** 없으면 null.
   *
   * **[사용자 2026-08-06]** 「시험을 "무엇을 해라"에서 "무엇을 지켜라"로. 세계 위에 목표를 찍는다.」
   * 예전 시험(「사냥 5회」)은 **화면 어디에도 없었다** — 그래서 2026-08-02 폰 실기에서 "뭘 하려는
   * 건지 모르겠다"가 나왔다. 목표가 땅 위에 있으면 그 자리로 무리를 몰면 되고, **명령이 곧 답이 된다.**
   *
   * sim 은 이 값을 판정에 쓰지 않는다(게임 규칙은 game 이 판정한다) — 렌더가 그리고, game 이 읽는다.
   */
  trialZone: { x: number; y: number; r: number } | null = null;

  /**
   * **표식이 찍힌 야생 개체 id.** **[사용자 2026-08-06]** 직접 낸 아이디어("특정 표시가 있는 개체
   * 사냥하기"). 잡으면 `roundCounts.marked` 가 오르고 이 목록에서 빠진다.
   *
   * 여유롭게 찍는다 — 표식이 찍힌 것이 다른 이유로 죽어도 시험이 불가능해지지 않게(목표보다 많이 찍는다).
   */
  trialMarks: number[] = [];

  /**
   * 이번 틱에 **실제로 뜻을 향해 움직인** 내 종 개체 수. 순종의 질을 화면에 보여 주는 유일한 숫자다
   * ("12마리 중 8마리가 향하는 중"). 겁먹어 달아나거나, 가는 길에 먹느라 멈춘 개체는 안 세인다.
   * ⚠ 세는 곳은 **규칙이 판정되는 그 자리 하나뿐**(behavior 의 지시 블록). 바깥에서 조건을 다시
   * 유도하면 화면과 실제가 갈린다(known_issues 의 "따르는 무리" 오집계와 같은 함정).
   * 매 틱 여기서 0 으로 되돌린다. rng 미사용·단순 합계라 순회 순서와 무관하다.
   */
  orderFollowers = 0;

  /**
   * 이번 틱에 **아직 목표에 못 닿은**(해제 반경 ORDER.releaseRadius 밖) 내 종 개체 수.
   * 화면 "따르는 중 N/M" 의 분모다 · 분모를 살아 있는 내 종 전부로 잡으면 이미 도착한 개체까지
   * 불복종처럼 읽힌다(2026-08-05, "20마리 도착 + 4마리 오는 중"이 "4/24"로 뜨던 사고).
   * 도망 중이라 이번 틱 이동을 지시에 못 준 개체도 세므로 orderFollowers < orderPending 이
   * 정상 상태다(도망·먹이·사냥에 붙들린 수만큼 차이 난다).
   * ⚠ 세는 곳은 behavior 의 지시 블록 한 자리뿐(orderFollowers 와 같은 규칙) · 매 틱 리셋 ·
   * rng 미사용·단순 합계라 순회 순서와 무관하다.
   */
  orderPending = 0;

  /**
   * 지금 이 보스에 **맞설 수 있는** 내 종 개체 수(근접 / 원거리). 화면이 "왜 아무도 안 싸우는가"를
   * 말할 수 있게 하는 유일한 숫자다 · 이게 0 이면 격퇴 체력 바를 보여 주는 것 자체가 거짓말이다.
   *
   * ⚠ 세는 곳은 **판정이 일어나는 그 자리 하나뿐**(boss.tagRaidFighters). 렌더가 매 프레임 전 개체를
   * 돌며 isRaidFighter 를 다시 부르면 폰 프레임이 죽고, 조건을 밖에서 다시 유도하면 화면과 실제가
   * 갈린다(known_issues 의 "따르는 무리" 오집계와 같은 함정).
   * 근접·원거리를 겸하는 개체는 **근접으로만** 센다 → 두 수의 합 = raidFighter 플래그가 붙은 개체 수.
   * rng 미사용·단순 합계라 순회 순서와 무관하다. 매 틱 리셋(보스가 없으면 0).
   */
  raidMeleeFighters = 0;
  raidRangedFighters = 0;

  /**
   * 마지막으로 격퇴 체력이 깎인 틱(-1 = 이 세계에서 한 번도 없음).
   * ⚠ 2026-08-04 현재 **프로덕션에서 읽는 곳이 없다**(테스트만 읽는다). worldView 는 번쩍임·잔상을
   *   boss.hp 의 변화로 직접 낸다 → 렌더를 이 값으로 갈아타든지 이 값을 지우든지 정리할 것.
   */
  raidHitTick = -1;
  /**
   * 최근 1초(stepsPerSecond 틱) 동안 깎인 격퇴 체력 합.
   * ⚠ 위와 같다 · 지금은 매 틱 링 버퍼만 돌고 읽는 쪽이 테스트뿐이다.
   */
  private readonly raidDmgRing: number[] = new Array<number>(SIM.stepsPerSecond).fill(0);
  get raidDamageWindow(): number {
    let sum = 0;
    for (const v of this.raidDmgRing) sum += v;
    return sum;
  }
  /**
   * 격퇴 체력이 깎인 사실을 화면용 관측값에 남긴다(boss.dealRaidHit 한 자리에서만 부른다).
   * 링 버퍼라 오차가 안 쌓이고, rng 를 안 쓰며 sim 판정에도 안 쓰인다 → 결정론·밸런스와 무관하다.
   */
  recordRaidDamage(amount: number): void {
    if (amount <= 0) return;
    const i = this.tick % this.raidDmgRing.length;
    this.raidDmgRing[i] = (this.raidDmgRing[i] ?? 0) + amount;
    this.raidHitTick = this.tick;
  }

  // Phase 5 단계 상태 (Game 이 설정/해제). 기본값은 평상시(영향 없음).
  boss: Boss | null = null;
  globalCold = 0; // 대멸종 한파
  heat = 0; // 대멸종 폭염
  foodRegrowMultiplier = 1; // 대멸종 대가뭄
  plagueRate = 0; // 대멸종 대역병 (매 틱 솎임 확률 — 번식/수로 메워야 버틴다)
  /** 시대별 먹이 척박도(1=기본). 클수록 먹이가 적고 재생이 느리다 — 시대가 지날수록 위협 사이 회복이
   * 억제돼 무리가 얇아진 채 다음 시련·대멸종을 맞는다. game 이 eraScarcity(era) 로 넘긴다(sim 은 era 를
   * 모른다). era 0(첫 시대)=1.0 이라 기존 밸런스·통과기준 테스트가 그대로 보존된다. */
  readonly foodScarcity: number;

  /** 내 종이 무엇에 죽었나 — 런 내내 누적(정산 가독성, §7). World 는 런마다 새로 만들어지므로 런 단위 집계. */
  readonly deaths: DeathTally = emptyDeathTally();

  /** 이번 프레임 연출용 사건들(탄생/죽음/잡아먹힘). 렌더가 매 프레임 읽고 비운다(상한 넘으면 버림). */
  readonly events: VisualEvent[] = [];

  private idCounter = 0;

  constructor(
    seed: string | number,
    width: number,
    height: number,
    genome: Genome,
    areaScale = 1,
    champions: ChampionSeed[] = [],
    mapType: MapType = "continent",
    foodScarcity = 1,
    options: WorldOptions = {},
  ) {
    this.width = width;
    this.height = height;
    this.areaScale = areaScale;
    this.foodScarcity = foodScarcity;
    // 기본값 "대륙" = 지금까지의 유일한 맵(지형 파라미터·먹이 배수 전부 기존값) → 기존 밸런스·테스트 보존.
    this.mapType = mapType;
    this.rng = new Rng(seed);
    this.mutRng = new Rng(String(seed) + "-mut"); // 개체 변이 전용 독립 스트림(메인 rng 불변)
    this.genome = genome;
    // 환경(바이옴)도 지형처럼 "독립된 rng"로 생성 → 앞으로 환경을 손봐도 메인 sim 동역학 스트림과 무관.
    // 좁힌 세계는 기후를 평탄하게 못박아 맵 전체가 초원 하나가 된다(spread 0 = 공간 변동 없음).
    // 부수 효과로 바이옴 특화종 3종과 바이옴 전용 먹이가 기존 게이트로 저절로 사라진다.
    this.environment = Environment.generate(
      new Rng(String(seed) + "-env"),
      width,
      height,
      SIM.cellSize,
      options.flatClimate === true ? { tempBase: 0.5, moistBase: 0.35, spread: 0 } : {},
    );
    // 지형은 메인 rng 와 "독립된 rng"로 생성 → 기존 sim 동역학(결정론·밸런스)을 1비트도 안 건드린다.
    // 맵 종류가 지형 파라미터를 덮어쓴다(대륙 = 빈 덮어쓰기 = 기존과 동일).
    this.terrain = Terrain.generate(
      new Rng(String(seed) + "-terrain"),
      width,
      height,
      SIM.terrainCellSize,
      mapKind(mapType).terrain,
    );
    this.grid = new SpatialGrid(width, height, SIM.gridCellSize);
    this.wildEvoRng = new Rng(String(seed) + "-wildevo");
    // 방울 전용 독립 스트림. 방울 위치를 메인 rng 로 뽑으면 소비 횟수가 밀려 야생 스폰·진화가
    // 통째로 이동한다(`WILD_RNG_KEYS` 제약과 같은 계열). 여기 없는 스트림을 새로 만들지 말 것.
    this.geneRng = new Rng(String(seed) + "-gene");
    // 물 전용 플레이어(바다 개척자)는 바다만 살아 과밀하므로 시작 수를 줄인다(다른 게놈엔 영향 없음).
    // areaScale 은 spawnEntities 에서 일괄 곱하므로 여기선 기본 수만(이중 곱 방지).
    const baseStart =
      genome.traits.swimming >= SIM.aquaticOnlyThreshold
        ? SIM.aquaticInitialEntities
        : SIM.initialEntities;
    this.playerSpecies = makePlayerSpecies(genome, baseStart);
    // 우호적 친척 종 — 게놈 변형은 "독립 rng"라 메인 스트림(기존 밸런스)을 안 건드린다. id 는 야생 뒤 고유값.
    const wild = generateWildSpecies(this.rng);
    const kin = makeKinSpecies(wild.length + 1, new Rng(String(seed) + "-kin"), genome);
    // 바이옴 특화종(사막·빙하·우림) — "독립 rng"로 생성(메인 스트림 보존). 각자 고향 바이옴에만 스폰된다.
    const biomeSpecies = makeBiomeSpecies(wild.length + 2, new Rng(String(seed) + "-biome"));
    // 비동기 생물(S2) — 지난 챔피언(최신부터 상한까지)을 이 세계에 등장시킨다. 게놈은 저장본이라 rng 무소비
    // (메인 스트림 보존). 친척과 같은 친구 편이라 밸런스 격리. id 는 높은 대역(900+)으로 충돌 회피.
    const championSpecies = champions
      .slice(0, SIM.championMaxPerRun)
      .map((c, i) => makeChampionSpecies(900 + i, c.genome, c.name, c.color));
    // 맵 전용 야생종(대륙 들소 / 판게아 독수리·늑대 / 군도·대양의 바다뱀·범고래·거북·크릴) —
    // 바이옴 특화종과 같이 "독립 rng"로 생성(메인 스트림 보존). 물이 많은 세계에 **바다 포식자**를
    // 들이는 게 핵심이다 — 지금까지 바다엔 위험이 하나도 없어 헤엄치는 종이 공짜로 먹고 살았다.
    const mapSpecies = makeMapSpecies(new Rng(String(seed) + "-mapspecies"), mapType);
    this.species = [this.playerSpecies, kin, ...wild, ...biomeSpecies, ...mapSpecies, ...championSpecies];
    // 감출 종을 **여기서 정해 두기만** 한다(배열에서 빼지 않는다 · 스폰도 건너뛰지 않는다).
    // 실제로 빼는 것은 모든 스폰이 끝난 뒤 딱 한 번(아래 grid.rebuild 직전)이다.
    // 옵션을 안 주면 감추는 종이 하나도 없다 = 지금까지의 온전한 세계.
    this.hiddenSpeciesIds = new Set(
      this.species.filter((s) => isHidden(s, options)).map((s) => s.id),
    );
    this.spawnFood();
    this.spawnEntities();
    // 친척은 spawnEntities(메인 rng) 대신 "독립 rng"로 내 종 근처에 스폰 → 메인 소비 순서 보존(밸런스 불변).
    this.spawnKin(new Rng(String(seed) + "-kinpos"));
    // 바다·고산 먹이는 "독립 rng"로 생물 스폰 뒤에 — this.rng 상태(=step 동역학)를 안 건드려 밸런스 보존.
    this.spawnSeaFood(new Rng(String(seed) + "-seafood"));
    this.spawnDeepFood(new Rng(String(seed) + "-deepfood"));
    this.spawnMountainFood(new Rng(String(seed) + "-mtnfood"));
    // 바이옴 전용 먹이(특화종만 먹음) — 특화종을 육지 먹이 경쟁에서 격리 + 자생시킨다. 독립 rng.
    this.spawnBiomeFood(new Rng(String(seed) + "-biomefood"));
    // 물고기 떼를 "떼"답게 독립 rng 로 보강 — 무리 행동·진화가 눈에 보이려면 어느 정도 수가 필요하다.
    this.spawnWildHerdPadding(new Rng(String(seed) + "-herdpad"));
    // 바이옴 특화종을 각자 고향 바이옴에 스폰(독립 rng). 그 바이옴이 이 맵에 없으면 그 종은 안 나온다.
    this.spawnBiomeAnimals(new Rng(String(seed) + "-biomepos"));
    // 맵 전용 종을 제 삶터(바다·산·땅)에 스폰(독립 rng) — 바다 종을 육지에 두면 갇혀서 그냥 죽는다.
    this.spawnMapAnimals(new Rng(String(seed) + "-mappos"), mapSpecies);
    // 챔피언(비동기 생물)도 독립 rng 로 소수만, 친척처럼 맵의 독립 영역에 — 메인 스트림·밸런스 불변.
    this.spawnChampions(new Rng(String(seed) + "-champpos"));
    // ── 세계 좁히기: 감추기와 자리 잡기는 **모든 스폰이 끝난 이 자리에서만** 한다 ──
    // 위쪽을 하나도 안 건드리므로 rng 소비·nextId·먹이 좌표·남은 종의 스폰 좌표가 1비트도 안 밀린다.
    if (this.hiddenSpeciesIds.size > 0) {
      this.entities = this.entities.filter((e) => !this.hiddenSpeciesIds.has(e.species.id));
    }
    // 포식자 자리 잡기는 **감추기 뒤**에 — 감춘 사냥 무리까지 평균에 넣으면 엉뚱한 자리로 옮겨진다.
    if (options.spacedPredators === true) this.spaceOutPredators();
    // 시대별 포식 압력 — 감추기·자리 잡기까지 끝난 **맨 마지막**에, 살아남은 사냥 무리 옆에만 붙인다
    // (감춘 종에 붙이면 곧바로 지워질 개체를 만들고, 자리 잡기 전에 붙이면 평균이 흔들린다).
    this.spawnEraPredators(new Rng(String(seed) + "-erapred"), options.predatorPressure ?? 1);
    this.grid.rebuild(this.entities);
    // 먹이 위치는 불변이라 격자를 한 번만 빌드한다(available 토글은 탐색 시 거른다).
    this.foodGrid = new FoodGrid(width, height, SIM.gridCellSize);
    this.foodGrid.build(this.food);
  }

  nextId(): number {
    return this.idCounter++;
  }

  /**
   * 조종 모드 시작 — 무리 무게중심에 가장 가까운 내 종이 앞장선다(처음부터 무리 한복판에 서게).
   * 거리가 같으면 먼저 태어난 쪽(작은 id). id 는 유일값이라 동률이 원리적으로 불가능한 전순서다
   * → 배열 순회 순서와 무관하게 답이 하나다.
   * rng 를 안 쓰고 개체를 새로 만들지도 않는다(nextId 미호출 → 이후 신생아 wanderAngle 불변).
   * 이미 알파가 있으면 아무 일도 안 한다(멱등) — game 이 매 프레임 불러도 안전하다.
   */
  armLead(): void {
    const L = this.lead;
    if (L.leaderId >= 0) return;
    const c = this.playerCentroid();
    let best: Entity | null = null;
    let bestD2 = Infinity;
    for (const e of this.entities) {
      if (!e.species.isPlayer) continue;
      const d2 = (e.x - c.x) ** 2 + (e.y - c.y) ** 2;
      if (d2 < bestD2 || (d2 === bestD2 && best !== null && e.id < best.id)) {
        bestD2 = d2;
        best = e;
      }
    }
    if (best === null) return;
    L.leaderId = best.id;
    L.x = best.x;
    L.y = best.y;
  }

  /**
   * 알파의 틱 시작 스냅샷. rng 미사용·개체 생성 없음.
   * 파생값을 여기서 한 번만 굳히는 이유: 개체 루프 안에서 갱신하면 알파가 몇 번째로 순회되느냐에
   * 따라 이웃이 다른 값을 본다(숨은 순회 순서 의존 = rng 지문으로도 안 잡히는 결정론 지뢰).
   */
  private syncLeadStart(): void {
    const L = this.lead;
    // HUD 표시용 집계는 매 틱 여기서만 0 으로 되돌린다(세는 곳은 behavior 의 cohesion 한 자리뿐).
    L.followerCount = 0;
    this.orderFollowers = 0; // 뜻을 향해 움직인 수도 같은 규칙으로 매 틱 리셋(세는 곳은 behavior 한 자리)
    this.orderPending = 0; // "아직 못 닿은" 수(따르는 중 N/M 의 분모)도 같은 자리에서 매 틱 리셋
    // 맞설 수 있는 개체 수도 같은 자리에서 매 틱 0 으로. 보스가 있으면 stepBoss 가 다시 채운다
    // (보스가 사라진 틱에 낡은 수가 남아 "싸울 수 있다"고 거짓말하지 않게).
    this.raidMeleeFighters = 0;
    this.raidRangedFighters = 0;
    // 1초 창의 이번 틱 칸을 비운다(1초 전 값이 여기 들어 있다). tick 증가 뒤라 칸이 정확히 맞는다.
    this.raidDmgRing[this.tick % this.raidDmgRing.length] = 0;
    // 조준 대상도 매 틱 여기서 다시 잡는다. 먼저 비워 두면 알파가 없거나(leaderId<0) 이번 틱에
    // 쓰러진 경우(아래 조기 반환)에도 "물 수 있다"가 낡은 채로 남지 않는다.
    L.biteTargetId = -1;
    // 지정 사냥 대상은 레벨 입력이다 — 매 틱 명령에서 그대로 베낄 뿐, sim 은 저장·기억하지 않는다
    // (명령이 끊기면 다음 틱에 저절로 -1). 조기 반환들보다 위에 둬야 알파가 사라진 틱에도 낡은
    // 지정이 안 남고, 아래 leadBiteTarget 호출보다 위에 둬야 이번 틱 겨눔이 이번 틱 명령을 본다.
    const cmd = L.cmd;
    L.orderTargetId = cmd !== null && cmd.targetId !== undefined ? cmd.targetId : -1;
    if (L.followTicks > 0) L.followTicks -= 1;
    if (L.leaderId < 0) return;
    let cur: Entity | null = null;
    for (const e of this.entities) {
      if (e.id === L.leaderId) {
        cur = e;
        break;
      }
    }
    if (cur === null) return; // 이번 틱에 죽었다 → step 끝의 syncLeader 가 승계
    const t = cur.genome.traits;
    L.x = cur.x;
    L.y = cur.y;
    const sp = Math.hypot(cur.vx, cur.vy);
    L.omni = sp <= SIM.fovMinSpeed;
    if (!L.omni) {
      L.fx = cur.vx / sp;
      L.fy = cur.vy / sp;
    }
    L.visionR = visionRadius(t, this, cur.x, cur.y);
    L.echoR = SIM.echoBase * (t.echo / TRAIT_MAX);
    // 지금 물 수 있는 대상 — 화면의 물기 버튼이 이 값 하나로 켜지고 꺼진다.
    // **실제 물기가 부르는 바로 그 함수**를 부르므로 버튼이 가리키는 대상과 물리는 대상이 어긋날 수 없다.
    // 격자는 이 틱 시작에 rebuild 된 뒤라 최신이고, 이 호출은 rng 를 안 쓰며 아무것도 안 바꾼다
    // (그래서 명령을 한 번도 안 준 세계의 지문·rng 상태가 그대로다).
    const aim = leadBiteTarget(cur, this);
    L.biteTargetId = aim === null ? -1 : aim.id;
    // ★ 명령이 있는 틱에만 추종이 켜진다. 명령을 한 번도 안 받으면 followTicks 는 영원히 0,
    //   commanded 는 영원히 false 라서 "알파를 지정만 한 세계"가 기존 세계와 부동소수점까지
    //   같다(게놈과 무관하게. 수풀 봉인도 commanded 를 보므로 여기서 함께 잠긴다).
    //   bite(사냥 명령)도 개입이다 — 사냥 명령 중에도 사람이 개입 중이라, throttle 만 보면
    //   이동 없이 잠금 사냥만 하는 동안 무리 추종이 1.5초 만에 끊긴다(그 구멍을 여기서 봉합).
    if (cmd !== null && (cmd.throttle > 0 || cmd.bite === true)) {
      L.followTicks = LEAD.followHoldTicks;
      // 끈끈한 플래그 — 한 번 올라가면 이 세계가 끝날 때까지 안 내려간다(승계도 안 되돌린다).
      // 손을 떼면 되돌아가는 followTicks 로 수풀 봉인을 걸면 "몰아넣고 손 떼기"로 우회된다.
      L.commanded = true;
    }
  }

  /**
   * 알파 승계 — "쓰러진 자리에서 가장 가까운 내 종이 앞장선다. 거리가 같으면 먼저 태어난 쪽."
   * rng 를 한 번도 안 쓰고 nextId 도 안 부른다.
   * **반드시 개체 루프 밖·죽은 개체 filter 뒤에서** 부른다. stepEntity 안에서 하면 앞쪽 개체만
   * 이동을 마친 반쯤 갱신된 세계에서 "가장 가까운"을 재게 돼 순회 순서에 의존한다.
   */
  private syncLeader(): void {
    const L = this.lead;
    if (L.leaderId < 0) return;
    for (const e of this.entities) if (e.id === L.leaderId) return; // 살아 있다
    let best: Entity | null = null;
    let bestD2 = Infinity;
    for (const e of this.entities) {
      if (!e.species.isPlayer) continue; // filter 뒤라 alive 는 전부 true
      const d2 = (e.x - L.x) ** 2 + (e.y - L.y) ** 2;
      if (d2 < bestD2 || (d2 === bestD2 && best !== null && e.id < best.id)) {
        bestD2 = d2;
        best = e;
      }
    }
    // 이어받은 개체가 죽은 이의 마지막 명령으로 튀어나가지 않게 초기화한다.
    // 손가락이 여전히 눌려 있으면 다음 프레임에 자연히 다시 켜진다.
    // ⚠ L.commanded 는 **초기화하지 않는다.** "사람이 이 세계를 이미 몰았다"는 사실은 앞장선 개체가
    //   바뀌어도 유효하고, 승계로 수풀 봉인이 풀리면 알파를 일부러 버리는 우회가 생긴다.
    L.cmd = null;
    L.followTicks = 0;
    // 죽은 이의 조준까지 물려받지 않는다(다음 틱 syncLeadStart 가 새 알파 기준으로 다시 잡는다).
    L.biteTargetId = -1;
    L.changedTick = this.tick;
    // **지휘 공백** — 알파가 쓰러지면 몇 초 동안 명령이 안 통하고 무리가 자율로 흩어진다.
    // **[사용자 2026-08-06]** 확정: 알파는 특별한 개체가 아니라 옮길 수 있는 「지휘봉」이고, 그것을
    // 놓쳤을 때의 대가는 불씨가 아니라 **손끝**이 치른다. 길이는 무리 티어가 줄인다(조직이 있으면
    // 다음 개체가 곧바로 이어받는다) — game 이 `vacuumOnLeadDeath` 로 그 값을 미리 넣어 준다.
    this.leadVacuum = this.vacuumOnLeadDeath;
    this.herdOrder = null; // 공백 동안은 걸려 있던 명령도 풀린다(누가 시켰는지가 없어졌다)
    if (best === null) {
      L.leaderId = -1; // 내 종 전멸 — 패배 판정은 기존 그대로(game.ts)
      return;
    }
    L.leaderId = best.id;
    L.x = best.x;
    L.y = best.y;
  }

  step(): void {
    this.tick += 1;
    this.grid.rebuild(this.entities);

    // 렌더 보간용: 이번 스텝 이동 전 위치를 기록(화면이 prev→현재 사이를 메운다).
    for (const e of this.entities) {
      e.prevX = e.x;
      e.prevY = e.y;
      // 맞설 수 있는가는 매 틱 꺼 두고 stepBoss(tagRaidFighters)가 다시 켠다 · 보스가 사라지면
      // 저절로 꺼져, 화면이 지난 보스의 전사 표식을 계속 그리는 일이 없다.
      e.raidFighter = false;
      // 반격 쿨다운은 여기 한 자리에서만 줄인다(정수 카운터 · rng 미사용 → 스트림 불변).
      if (e.raidCounterCd > 0) e.raidCounterCd -= 1;
    }
    // 지휘 공백은 여기 한 자리에서만 줄인다(정수 카운터 · rng 미사용 → 스트림 불변).
    if (this.leadVacuum > 0) this.leadVacuum -= 1;
    // 알파의 파생값을 틱 시작에 한 번 굳힌다(알파가 없으면 첫 줄에서 빠진다 = 기존과 동일).
    this.syncLeadStart();
    if (this.boss) {
      this.boss.prevX = this.boss.x;
      this.boss.prevY = this.boss.y;
      for (const m of this.boss.members) {
        m.prevX = m.x;
        m.prevY = m.y;
      }
    }

    const newborns: Entity[] = [];
    for (const e of this.entities) {
      if (!e.alive) continue;
      stepEntity(e, this, newborns);
    }

    if (this.boss) stepBoss(this.boss, this);

    // 대역병: 매 틱 일부를 솎되, 번식이 왕성한 종일수록(회복력) 덜 솎인다 → 번식력이 카운터.
    // (평범한 솎임은 건강→대사로 흘러 저대사가 간접 우위가 되므로, 번식력으로 직접 게이팅.)
    if (this.plagueRate > 0) {
      for (const e of this.entities) {
        if (!e.alive) continue;
        // 가죽 4단(규칙 면제) — 환경이 통째로 바뀌어도 이 몸은 안 죽는다.
        const et = e.genome.traits;
        if (isApex(et.defense)) continue;
        // 무리의 고유 대가: 붙어 살면 병이 돈다(무리 티어가 올릴수록 크게 솎인다). 야생은 plague = 1.
        const rate =
          this.plagueRate * (1 - SIM.plagueFertilityResist * (et.fertility / TRAIT_MAX)) * et.plague;
        if (rate > 0 && this.rng.unit() < rate) {
          // 「열병의 흉터」(무리 4단 카드) — 죽는 대신 기운의 3분의 2를 잃고 앓아 넘긴다.
          // ⚠ **굴림 뒤 자리다** · 굴림(위 unit)은 그대로 소비돼 특성 없는 세계와 rng 열이 같다.
          //   가죽 4단의 공짜 면제(위 continue · 굴림 전)와 달리 이쪽은 값을 치르는 생존이다.
          if (e.genome.perks.length !== 0 && !e.feverScarred && hasRule(e.genome.perks, "feverscar")) {
            e.feverScarred = true;
            e.energy *= FEVER_KEEP;
            this.emit("block", e.x, e.y, e.species.isPlayer); // 앓아 넘긴 순간(튕김 반짝)
          } else {
            e.alive = false;
            this.recordDeath(e.species, "plague");
            this.emit("death", e.x, e.y, e.species.isPlayer);
            this.legacyDeath(e, false); // 역병 사체 · 연어의 귀향(기운이 남아 있는 죽음)
          }
        }
      }
    }

    // 먹이 재생 (대가뭄이면 regrowTimer 가 길어 느리게)
    for (const f of this.food) {
      if (f.available) continue;
      f.regrowTimer -= 1;
      if (f.regrowTimer <= 0) f.available = true;
    }

    for (const n of newborns) this.entities.push(n);
    // 개체 루프 밖(보스·역병 죽음 자리)에서 태어난 새끼들 — 「연어의 귀향」.
    if (this.pendingBirths.length > 0) {
      for (const n of this.pendingBirths) this.entities.push(n);
      this.pendingBirths.length = 0;
    }

    let hasDead = false;
    for (const e of this.entities) {
      if (!e.alive) {
        hasDead = true;
        break;
      }
    }
    if (hasDead) this.entities = this.entities.filter((e) => e.alive);

    // 알파가 이번 틱에 쓰러졌으면 옆에 있던 한 마리가 이어받는다(죽은 개체를 걸러낸 뒤라야 정확하다).
    this.syncLeader();

    // ── 방울 줍기 ────────────────────────────────────────────────────────────────
    //   **왜 하필 여기인가**: 죽은 개체를 걸러낸 뒤라 "이번 틱에 죽은 개체가 줍는" 일이 없고,
    //   개체가 이번 틱 이동을 마친 좌표를 본다("밟고 지나가면"이 손끝의 감각과 맞는다).
    //   ⚠ rng 를 한 번도 안 쓴다 · 여기서 한 번이라도 뽑으면 기존 밸런스가 통째로 이동한다.
    //   ⚠ 순회 순서에 안 기댄다: 어느 개체가 먼저 닿든 방울 하나는 한 번만 주워지고, 늘어나는 값도
    //     연출 좌표(방울 자리)도 같다. 그래서 결정론 지문이 개체 배열 순서에 안 흔들린다.
    //   방울 바깥 루프 · 개체 안쪽 루프 + 첫 개체에서 break 인 이유: 이미 주운 방울은 첫 줄에서
    //   통째로 건너뛰므로, 한 시대에 30개 남짓인 방울이 다 주워진 뒤에는 사실상 공짜다(격자 불필요).
    this.collectGeneDrops();
    // ── 사체 먹기(썩은 고기를 먹는 위) ── 방울 줍기와 같은 자리·같은 규칙(순회 순서 무관 · rng 0).
    this.collectCarrion();

    this.maybeImmigrate();
    this.maybeEvolveWild();
  }

  /** 하루 진행도 0~1 (0=정오 시작 → 0.5 자정 → 1 다시 정오). tick 기반 결정론. 낮밤 표시·밝기 산출에. */
  get dayPhase(): number {
    return (this.tick % SIM.dayLength) / SIM.dayLength;
  }

  /**
   * 낮의 밝기 0(자정)~1(정오). tick 기반이라 결정론(rng 무관). 시야(밤엔 감소)·화면 밝기에 쓴다.
   * cos 곡선이라 정오→해질녘→자정→동틀녘이 부드럽게 이어진다.
   */
  get daylight(): number {
    return 0.5 + 0.5 * Math.cos(this.dayPhase * 2 * Math.PI);
  }

  /** 개체 수 안전 상한 — 폭주 방지. 소수 개체 게임이라 맵 크기와 무관한 절대 상한. */
  get cap(): number {
    return SIM.populationCap;
  }

  get population(): number {
    return this.entities.length;
  }

  /** 내 종 개체 수 — 승패 판정의 기준. */
  get playerPopulation(): number {
    let count = 0;
    for (const e of this.entities) if (e.species.isPlayer) count += 1;
    return count;
  }

  /** 내 종 무리의 무게중심(카메라 추적용). 내 종이 없으면 월드 중앙. */
  playerCentroid(): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const e of this.entities) {
      if (e.species.isPlayer) {
        sx += e.x;
        sy += e.y;
        n += 1;
      }
    }
    if (n === 0) return { x: this.width / 2, y: this.height / 2 };
    return { x: sx / n, y: sy / n };
  }

  /**
   * 카메라가 따라갈 내 종 초점 — 현재 시점(hint) 근처의 무리를 부드럽게 따라간다. 개체마다 hint 에서 가까울수록
   * 큰 가중치(1/(1+d²/s²))를 줘 가중 평균을 낸다. 그래서 ① 흩어진 낙오자는 거의 무시(멀면 가중치 0에 수렴)하고
   * ② 번식으로 새 개체가 무리에 더해져도 초점이 미세하게만 움직인다(칸을 고르던 옛 방식은 번식 때 최다 칸이
   * 홱 바뀌어 화면이 휙휙 돌았다 — 폰 피드백). hint 는 보통 지금 카메라 위치라, 무리를 자연스럽게 따라간다.
   */
  playerFocus(hintX: number, hintY: number): { x: number; y: number } {
    const s2 = 200 * 200; // 이 거리(px) 안의 개체를 주로 본다(반감 거리)
    let sx = 0;
    let sy = 0;
    let wsum = 0;
    let any = false;
    for (const e of this.entities) {
      if (!e.species.isPlayer) continue;
      any = true;
      const dx = e.x - hintX;
      const dy = e.y - hintY;
      const w = 1 / (1 + (dx * dx + dy * dy) / s2);
      sx += e.x * w;
      sy += e.y * w;
      wsum += w;
    }
    if (!any || wsum <= 0) return { x: this.width / 2, y: this.height / 2 };
    return { x: sx / wsum, y: sy / wsum };
  }

  /** 드래프트 스킵 보상 — 내 종 새끼 n 마리를 무리 중심 근처에 낳는다(형질 대신 개체 수). createEntity 가
   * 내 종 게놈을 현재 세대로 복사하므로 갓 태어난 무리는 지금 형질을 물려받는다. rng 미사용(결정론 무관). */
  spawnPlayerBrood(n: number): void {
    const c = this.playerCentroid();
    const tr = this.genome.traits;
    const canSwim = tr.swimming >= SIM.swimThreshold;
    const canLand = tr.swimming < SIM.aquaticOnlyThreshold;
    const canFly = tr.wings >= SIM.flyThreshold;
    for (let i = 0; i < n; i++) {
      const ang = (i / Math.max(1, n)) * Math.PI * 2;
      const x = Math.max(0, Math.min(this.width, c.x + Math.cos(ang) * 20));
      const y = Math.max(0, Math.min(this.height, c.y + Math.sin(ang) * 20));
      const spot = this.snapSpawn(x, y, canSwim, canLand, canFly);
      this.entities.push(createEntity(this.nextId(), spot.x, spot.y, this.playerSpecies, SIM.startEnergy));
      this.emit("birth", spot.x, spot.y, true); // 연출: 탄생 반짝임(내 종 시작 무리)
    }
  }

  /** 라운드 계수기를 0 으로 되돌린다 · game.beginStage() 가 단계마다 호출한다. */
  resetRoundCounts(): void {
    this.roundCounts.hunts = 0;
    this.roundCounts.feeds = 0;
    this.roundCounts.births = 0;
    this.roundCounts.marked = 0;
  }

  /**
   * **방울 하나를 필드에 놓는다.** 자리는 부르는 쪽이 정한다 · 방울을 주는 다섯 사건
   * (보스 격퇴 · 대멸종 생존 · 개체 수 문턱 · 위기 회복 · 시험 초과)은 전부 **game 이 아는 사건**이고,
   * sim 은 게임 규칙을 판정하지 않는다(`trialZone` 과 같은 구조).
   *
   * 무작위 자리가 필요하면 `gene.geneDropOffset(this.geneRng, …)` 을 쓴다. **메인 `rng` 는 쓰지 마라** ·
   * 소비 횟수가 밀리면 야생 생태가 통째로 이동한다.
   *
   * rng 미사용(자리를 받아 쓰기만 한다) → 이 함수 자체는 결정론·밸런스에 무관하다.
   */
  spawnGeneDrop(x: number, y: number, amount: number, reason: GeneReason): void {
    if (amount <= 0) return;
    this.geneDrops.push(createGeneDrop(x, y, amount, this.tick, reason));
  }

  /**
   * **자리를 골라 방울 하나를 놓는다** · 다섯 사건이 부르기 좋은 형태(좌표를 부르는 쪽이 안 만든다).
   * 자리는 `pickGeneDropSpot` 이 정한다: 내 종이 **지나갈 수 있고 실제로 걸어 닿는** 지형 중,
   * 무리에서 고리(`GENE_SPAWN_RING`) 만큼 떨어진 곳. 자리 뽑기는 전용 `geneRng` 만 쓴다.
   *
   * 자리를 끝내 못 고르면(고리가 통째로 막힌 세계 · 작은 섬에 갇힌 무리) **무리 발밑**에 떨어뜨린다.
   * 화면에 「보스 격퇴 · 방울 +3」이라 적어 놓고 방울이 안 나오면 그건 거짓말이라, 자리를 못 찾는 것이
   * 약속을 무르는 이유가 되어선 안 된다. (이건 내 판단이다 · 아주 드문 막다른 세계에서만 일어난다.)
   *
   * 내 종이 전멸했으면 아무것도 안 하고 false · 줍을 무리가 없는데 놓아 봐야 세계만 어지럽다.
   */
  spawnGeneDropNear(amount: number, reason: GeneReason): boolean {
    if (amount <= 0) return false;
    if (this.playerPopulation === 0) return false;
    const spot = pickGeneDropSpot(this.geneRng, this) ?? this.playerFootSpot();
    this.spawnGeneDrop(spot.x, spot.y, amount, reason);
    return true;
  }

  /** 무리 발밑(무게중심)에서 내 종이 설 수 있는 가장 가까운 자리. rng 미사용. */
  private playerFootSpot(): { x: number; y: number } {
    const c = this.playerCentroid();
    const t = this.genome.traits;
    return this.terrain.nearestPassable(
      c.x,
      c.y,
      t.swimming >= SIM.swimThreshold,
      t.swimming < SIM.aquaticOnlyThreshold,
      t.wings >= SIM.flyThreshold,
    );
  }

  /**
   * **밟고 지나간 방울을 줍는다** · step() 안 딱 한 자리에서만 불린다.
   *
   * 규칙(전부 여기 한 곳에만 적는다):
   * · 줍는 것은 **내 종뿐**이다. 야생이 주우면 사람이 번 방울이 화면 밖에서 증발한다.
   * · 거리 판정은 `geneDropReached` 하나로만 한다(반경을 두 곳에 적으면 반드시 어긋난다).
   * · 주운 방울은 `taken` 만 세우고 **배열에서 지우지 않는다** · 렌더가 사라지는 연출을 그릴 자리다
   *   (`Food.available` 과 같은 결).
   * · rng 를 한 번도 안 쓴다 → 결정론·밸런스 무관.
   *
   * **수명(만료)은 두지 않았다**(내 판단). 근거 셋:
   *  ① 방울은 사람이 이미 **번 것**이다. 시간이 지났다고 사라지면 「접으려는 플레이어를 은근히
   *     돕는다」는 이 프로젝트의 방향과 정면으로 어긋난다 · 못 가져간 쪽은 늘 밀리는 판이다.
   *  ② 사라지는 규칙은 **합의된 적이 없다.** 이번 단계는 「가만히 있는 방울」까지이고, 안 정해진
   *     규칙을 먼저 넣으면 그게 규칙인 척 굳는다.
   *  ③ 무한히 쌓이지 않는다 · World 는 시대마다 통째로 새로 만들어지므로 **라운드가 끝나면 저절로
   *     사라진다.** 즉 "영원히 남는다"가 아니라 "**이 시대 안에서는** 안 없어진다"이다.
   *     (시대 끝에 못 주운 방울을 어떻게 할지는 game 이 정할 일이지 sim 이 정할 일이 아니다.)
   */
  private collectGeneDrops(): void {
    for (const d of this.geneDrops) {
      if (d.taken) continue;
      for (const e of this.entities) {
        if (!e.species.isPlayer) continue;
        if (!geneDropReached(d, e.x, e.y)) continue;
        d.taken = true;
        this.geneCollected += d.amount;
        // 연출은 **방울 자리**에서 난다(주운 개체 자리가 아니라) · 어느 개체가 먼저 닿았느냐로
        // 화면이 달라지면 그것부터가 순회 순서 의존이다.
        this.emit("gene", d.x, d.y, true);
        break;
      }
    }
  }

  /** 죽음 1건 집계. 정산은 "왜 내 종이 죽었나"가 핵심이라 내 종만 센다. (rng 미사용 → 결정론 유지) */
  recordDeath(species: Species, cause: DeathCause): void {
    if (!species.isPlayer) return;
    this.deaths[cause] += 1;
  }

  /**
   * **죽음이 세계에 남기는 것** — 죽음 판정 자리 전부(behavior 소모사·노화, devour, 보스 셋, 역병)가
   * 죽음 확정 직후 이 하나를 부른다. 두 가지를 처리한다:
   * · **사체**(썩은 고기를 먹는 위 · 이빨 4단 카드): 내 종이 그 카드를 가진 판에서만 남는다.
   *   잡아먹힌 죽음(devoured)은 먹다 남긴 몫만 남는다 — 「남이 잡다 남긴 것도」가 참말이 되는 자리.
   * · **연어의 귀향**(무리 4단 카드): 기운을 40 넘게 남기고 죽은 내 종 개체 자리에서 새끼가 태어난다.
   *   잡아먹힌 죽음은 제외(카드 문구 그대로). 굶어 죽은 죽음은 기운이 0 이라 자연히 제외된다.
   *
   * ⚠ rng 규율: 사체는 rng 0. 새끼의 게놈 변이는 **독립 mutRng** 만 쓰고(일반 출산과 같은 규칙),
   *   자리·첫걸음 방향은 죽은 개체의 값을 재사용해 메인 스트림을 1비트도 안 민다.
   */
  legacyDeath(e: Entity, devoured: boolean): void {
    // 사체는 **내 종 기준선**(world.genome)이 그 카드를 가진 판에서만 세계에 남는다.
    // ⚠ 지난 런의 챔피언만 carrion 을 가진 판에서는 사체가 안 생겨, 그 챔피언은 대가(갓 사냥 절반)만
    //   물게 된다 — 알고 둔 비대칭이다(챔피언 게놈까지 뒤져 세계 상태를 켜는 값어치가 없다고 판단).
    if (hasRule(this.genome.perks, "carrion")) {
      this.carcasses.push(
        createCarcass(e.x, e.y, devoured ? CARRION_LEFTOVER : CARRION_FROM_DEATH, this.tick),
      );
    }
    // ⚠ isPlayer 를 요구하지 않는다(2026-08-11 검증 반영) — 지난 런의 챔피언도 perks 째 저장되므로,
    //   효과와 대가가 **같은 집합**(그 규칙을 가진 개체)에 걸려야 한다. 대가만 물고 보상은 못 받는
    //   비대칭이 검증에서 잡혔다. 시험 계수·연출의 「내 것」 표시만 isPlayer 로 가른다.
    // ⚠ 되살아난 몸(revived)·앓은 몸(feverScarred)은 죽어서도 새끼를 못 남긴다 — 그 두 카드의
    //   대가 문구가 절대형이라, 여기서 우회되면 카드가 거짓말이 된다(검증 지적).
    // ⚠ cap 검사는 이번 틱 behavior 쪽 newborns 를 못 본다 — 한 틱에 몇 마리 초과가 가능하나
    //   다음 틱부터 출산이 잠기므로 폭주는 없다(정확한 합산은 비용 대비 값어치가 없다고 판단).
    if (
      !devoured &&
      !e.revived &&
      !e.feverScarred &&
      e.genome.perks.length !== 0 &&
      hasRule(e.genome.perks, "salmonrun") &&
      e.energy > SALMON_MIN_ENERGY &&
      this.entities.length + this.pendingBirths.length < this.cap
    ) {
      // 내 종 새끼만 개체 변이(일반 출산과 같은 규칙 · behavior 참조). 챔피언·야생은 종 게놈 공유.
      const childGenome = e.species.isPlayer
        ? mutateGenome(cloneGenome(e.genome), this.mutRng, SIM.mutationStrength)
        : undefined;
      const child = createEntity(this.nextId(), e.x, e.y, e.species, e.energy * SALMON_SHARE, childGenome);
      child.wanderAngle = e.wanderAngle; // 죽은 몸이 향하던 방향 그대로(rng 0)
      this.pendingBirths.push(child);
      this.emit("birth", e.x, e.y, e.species.isPlayer);
      if (e.species.isPlayer) this.roundCounts.births += 1;
    }
  }

  /**
   * **사체를 먹는다**(썩은 고기를 먹는 위) · `collectGeneDrops` 와 같은 자리에서 돈다.
   * 그 규칙을 가진 개체만 먹는다(내 종 + perks 째 저장된 챔피언 · 야생은 perks 가 비어 늘 빠진다 —
   * 효과와 대가가 같은 집합에 걸려야 한다는 검증 지적 반영). rng 0.
   *
   * ⚠ 방울 줍기와 달리 **순회 순서에 이득 귀속이 의존한다**(결정론은 유지 · 배열 순서가 곧 규칙이다).
   *   방울은 세계의 점수라 누가 밟든 같지만, 사체는 특정 개체의 기운으로 들어간다. 순회를 재배열하면
   *   다른 개체가 먹는 다른 세계가 된다 — 재배열하지 마라(검증이 옛 주석의 「순서 무관」을 반증했다).
   * ⚠ 기운이 이미 기본 상한(SIM.maxEnergy) 이상인 개체는 **먹지 않고 지나간다** — 비축(gorge) 중인
   *   육식의 기운을 min() 이 아래로 끌어내리는 자기파괴와, 배부른 개체가 사체를 낭비하는 것을 함께
   *   막는다(검증 blocker). 섭취 상한도 SIM.maxEnergy 다 · 사체는 「비축」이 아니라 「끼니」다.
   */
  private collectCarrion(): void {
    if (this.carcasses.length === 0) return;
    // 삭은 사체가 시대 내내 쌓이면 이 순회와 렌더가 함께 느려진다 — 넘치면 못 먹는 것을 걷어낸다
    // (렌더는 bornTick 나이 기반이라 배열에서 빠져도 연출이 안 깨진다 · 검증 지적).
    if (this.carcasses.length > 256) {
      this.carcasses = this.carcasses.filter((c) => carcassEdible(c, this.tick));
    }
    for (const c of this.carcasses) {
      if (!carcassEdible(c, this.tick)) continue;
      for (const e of this.entities) {
        if (e.genome.perks.length === 0 || !hasRule(e.genome.perks, "carrion")) continue;
        if (e.energy >= SIM.maxEnergy) continue;
        if (!carcassReached(c, e.x, e.y)) continue;
        c.taken = true;
        e.energy = Math.min(SIM.maxEnergy, e.energy + c.amount);
        // 사체도 끼니다 — 채집과 같은 경험치 축. 단 내 종이 먹은 것만 센다(챔피언은 경험치 밖).
        if (e.species.isPlayer) this.playerFoodEaten += 1;
        this.emit("gene", c.x, c.y, e.species.isPlayer); // 삼키는 반짝임(자리는 사체 자리)
        break;
      }
    }
  }

  /** 감지 범위 안에서 가장 가까운, 아직 먹을 수 있는 사체(행동이 찾아갈 목표). rng 0 · 선형 탐색. */
  nearestCarcass(x: number, y: number, range: number, senses: (cx: number, cy: number) => boolean): Carcass | null {
    let best: Carcass | null = null;
    let best2 = range * range;
    for (const c of this.carcasses) {
      if (!carcassEdible(c, this.tick)) continue;
      const dx = c.x - x;
      const dy = c.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best2 && senses(c.x, c.y)) {
        best2 = d2;
        best = c;
      }
    }
    return best;
  }

  /** 연출용 사건 1건(전 종, 위치 포함). mine=내 무리가 얽힌 사건(렌더의 소음 다이어트 근거).
   *  tx,ty 를 주면 방향성 사건(원거리 발사체). rng 미사용 → 결정론 무관. */
  emit(kind: VisualEventKind, x: number, y: number, mine: boolean, tx?: number, ty?: number): void {
    if (this.events.length >= 300) return;
    this.events.push(tx !== undefined && ty !== undefined ? { kind, x, y, mine, tx, ty } : { kind, x, y, mine });
  }

  get availableFood(): number {
    let count = 0;
    for (const f of this.food) if (f.available) count += 1;
    return count;
  }

  private spawnFood(): void {
    // 육지 타일에만 식물 먹이. 지형 "타일" 단위로 정밀 배치(환경 칸 단위면 물 위에 떨어진다).
    // 비옥할수록 많이. this.rng 사용(스폰 전이라 생물 스폰 rng 와 이어짐 — 소비 횟수는 환경칸판과 동일).
    // 먹이 수는 "고정"이라, 땅이 좁은 맵(군도·대양)에선 같은 먹이가 좁은 땅에 몰려 밀도가 되레 치솟는다
    // → 맵 종류의 landFoodScale 로 함께 줄여 밀도를 지킨다(대륙 = 1.0 = 기존과 동일).
    // 시대가 지날수록 육지 먹이가 준다(foodScarcity) — 위협 사이 회복을 억제한다. era 0 = 1.0 = 기존과 동일.
    // ⚠ count 가 바뀌면 spawnFoodOnTiles 의 rng 소비가 달라져 그 뒤 스트림이 밀린다. 하지만 각 시대는
    // 독립 시드(`-era{n}`)라 무방하고, era 0(scarcity 1)에선 count 가 안 바뀌어 기존 밸런스가 보존된다.
    const count = Math.round(
      (SIM.foodPatches * this.areaScale * mapKind(this.mapType).landFoodScale) / this.foodScarcity,
    );
    this.spawnFoodOnTiles(this.rng, count, false, (kind, fertility) =>
      kind === TILE.land ? 0.15 + fertility : 0,
    );
  }

  /** 바다 타일에 바다 먹이(수영 형질로만 먹는 무경쟁 틈새). 독립 rng → step 동역학 불변. */
  private spawnSeaFood(rng: Rng): void {
    // 바다가 넓은 맵일수록 바다 먹이도 늘린다 — 안 그러면 넓어진 바다가 텅 비어 헤엄이 벌이 된다.
    const count = Math.round(SIM.seaFoodPatches * this.areaScale * mapKind(this.mapType).seaFoodScale);
    this.spawnFoodOnTiles(rng, count, true, (kind) => (kind === TILE.water ? 1 : 0));
  }

  /** 산 타일에 고산 먹이(날개 형질로만 먹는 무경쟁 틈새 — 바다 먹이의 하늘 대칭). 독립 rng → 동역학 불변. */
  private spawnMountainFood(rng: Rng): void {
    // 산이 많은 세계(판게아)는 산 위 먹이도 많아야 날개가 값을 한다 — 안 그러면 넘을 산만 늘어난다.
    const count = Math.round(
      SIM.mountainFoodPatches * this.areaScale * mapKind(this.mapType).mountainFoodScale,
    );
    this.spawnFoodOnTiles(rng, count, false, (kind) => (kind === TILE.mountain ? 1 : 0), true);
  }

  /** 바다 타일에 깊은 바다 먹이(물 전용 종=진짜 물고기만 먹는 전용 틈새). 얕은 바다 먹이와 같은 물 타일에
   * 놓이되 deep 플래그로 양용 종을 배제 — 물고기 학교가 바다 풀뜯이와 경쟁 없이 유지된다. 독립 rng. */
  private spawnDeepFood(rng: Rng): void {
    const count = Math.round(SIM.deepFoodPatches * this.areaScale * mapKind(this.mapType).seaFoodScale);
    this.spawnFoodOnTiles(rng, count, true, (kind) => (kind === TILE.water ? 1 : 0), false, true);
  }

  /**
   * 바이옴 전용 먹이(kind = BIOME_FOOD_KIND)를 특화종 바이옴(사막·침엽수림·우림)의 육지 타일에 놓는다.
   * 이 먹이는 특화종만 먹어(그들 foodKinds=[3], 내 종·야생은 [0..2]) — 육지 먹이 경쟁을 분리(밸런스 격리)
   * 하고 특화종을 제 바이옴에서 자생시킨다. 그 바이옴이 맵에 없으면 안 놓인다. 독립 rng → step 동역학 불변.
   */
  private spawnBiomeFood(rng: Rng): void {
    const count = Math.round(SIM.biomeFoodPatches * this.areaScale);
    const terr = this.terrain;
    const cs = terr.cellSize;
    const biomes: Biome[] = ["desert", "taiga", "rainforest"];
    const cells: number[] = [];
    for (let i = 0; i < terr.tiles.length; i++) {
      if ((terr.tiles[i] ?? TILE.land) !== TILE.land) continue; // 트인 육지에만(일반 먹이와 동일 — 물·산·수풀·험지 제외)
      const cx = ((i % terr.cols) + 0.5) * cs;
      const cy = (Math.floor(i / terr.cols) + 0.5) * cs;
      if (biomes.includes(this.environment.biomeAt(cx, cy))) cells.push(i);
    }
    if (cells.length === 0) return; // 특화종 바이옴이 이 맵에 없음(또는 그 바이옴에 트인 육지가 없음)
    for (let n = 0; n < count; n++) {
      const cell = cells[Math.floor(rng.unit() * cells.length)] ?? cells[0] ?? 0;
      const x = Math.min(this.width, ((cell % terr.cols) + rng.unit()) * cs);
      const y = Math.min(this.height, (Math.floor(cell / terr.cols) + rng.unit()) * cs);
      this.food.push(createFood(x, y, BIOME_FOOD_KIND));
    }
  }

  /** 지형 타일 단위 가중 추첨으로 먹이 count 개를 놓는다(정밀 배치). 타일별 weight 는 콜백이 정한다. */
  private spawnFoodOnTiles(
    rng: Rng,
    count: number,
    aquatic: boolean,
    tileWeight: (kind: TileKind, fertility: number) => number,
    mountainous = false,
    deep = false,
  ): void {
    const terr = this.terrain;
    const cs = terr.cellSize;
    const weights: number[] = [];
    let total = 0;
    for (let i = 0; i < terr.tiles.length; i++) {
      const cx = i % terr.cols;
      const cy = Math.floor(i / terr.cols);
      const fert = this.environment.sampleAt((cx + 0.5) * cs, (cy + 0.5) * cs).fertility;
      const w = tileWeight(terr.tiles[i] ?? TILE.land, fert);
      weights.push(w);
      total += w;
    }
    if (total <= 0) return;
    for (let n = 0; n < count; n++) {
      let r = rng.range(0, total);
      let cell = 0;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i] ?? 0;
        if (r <= 0) {
          cell = i;
          break;
        }
      }
      const cx = cell % terr.cols;
      const cy = Math.floor(cell / terr.cols);
      const x = Math.min(this.width, (cx + rng.unit()) * cs);
      const y = Math.min(this.height, (cy + rng.unit()) * cs);
      const kind = rng.int(0, SIM.foodKindCount - 1);
      this.food.push(createFood(x, y, kind, aquatic, mountainous, deep));
    }
  }

  /** 야생 이주 — 멸종했거나 적은 야생종을 주기적으로 소수 보충(다양성 바닥). 내 종은 제외. */
  /**
   * 야생종도 진화한다(스포어식 살아있는 생태). 주기적으로 각 야생종 게놈을 ① 자기 무리가 실제로 겪는
   * 압력에 적응 ② 형질별 미세 무작위 드리프트(종마다 조금씩 달라짐)로 옮긴다. 적응하는 압력 세 가지:
   *   · 추위 → 고대사(체온 유지). 먹이 부족 → 저대사(적게 먹고 오래 버팀). 둘은 대사 하나를 두고 밀당한다.
   *   · 포식자 노출 → 속도·무리 성향 상승(빠르고 뭉쳐서 잡아먹히지 않는다).
   * 종 게놈을 바꾸면 그 종 모든 개체가 즉시 반영(공유 게놈). 압력 측정·적응은 rng 미사용(결정론) —
   * 미세 드리프트만 독립 rng(wildEvoRng)라 메인 스트림 보존. 내 종은 제외 — 내 종의 진화 방향은
   * 플레이어(카드=선택압)가 쥔다. 짧은 시련엔 거의 안 변하고(밸런스 보존), 긴 런에서 뚜렷이 갈라진다.
   */
  private maybeEvolveWild(): void {
    if (this.tick % SIM.wildEvolveInterval !== 0) return;
    for (const sp of this.species) {
      if (sp.isPlayer) continue;
      const t = sp.genome.traits;
      // 이 종 무리를 한 번 훑어 압력을 측정한다: 추위·평균 에너지(먹이 사정)·포식자 노출.
      let n = 0;
      let coldSum = 0;
      let energySum = 0;
      let exposed = 0; // 감지 범위 안에 자기를 위협하는 포식자가 있는 개체 수
      for (const e of this.entities) {
        if (e.species.id !== sp.id) continue;
        coldSum += this.environment.sampleAt(e.x, e.y).coldness;
        energySum += e.energy;
        // 도망 판정과 같은 기준의 포식자(비우호 타종 + 사냥 식성 + 내 공격력 이상)가 근처에 있나.
        const predator = this.grid.nearestMatching(
          e.x, e.y, SIM.predatorSenseRange,
          (p) => p.alive && p.species.id !== sp.id && !areFriends(sp, p.species) &&
            p.genome.traits.diet > SIM.dietHuntMin && p.genome.traits.attack >= t.attack,
        );
        if (predator) exposed += 1;
        n += 1;
      }
      if (n === 0) continue;
      // 측정한 압력으로 형질을 한 스텝 적응(순수·결정론). 배부르고 안 추운 무리에 포식자도 없으면 무변화.
      adaptWildTraits(t, {
        avgCold: coldSum / n,
        avgEnergy01: energySum / n / SIM.maxEnergy, // 0(빈사)~1(포만)
        predFrac: exposed / n, // 0~1 — 무리 중 포식자에 노출된 비율
      });

      // 형질별 미세 드리프트(독립 rng).
      //
      // ⚠⚠ **이 목록과 순서가 야생 진화 밸런스 그 자체다.** 예전에는 `TRAIT_KEYS` 를 순회하며 몇 개만
      //   건너뛰는 방식이었는데, v8 에서 능치 목록이 열넷에서 스물둘로 늘면서 **소비 횟수가 10 → 18 로
      //   조용히 늘어날 뻔했다.** 그러면 `wildEvoRng` 스트림이 밀려 야생 진화가 통째로 다른 세계가 된다
      //   (known_issues: rng 스트림을 늘리면 분포가 통째로 이동한다). 그래서 명시 목록으로 못 박는다 —
      //   v7 이 실제로 흔들던 열 개를 그 순서대로.
      //   수영·날개·몸집·은신은 정체성이라 제외한다(비행 종이 날개를 잃으면 산에서 굶는다).
      for (const key of WILD_DRIFT_KEYS) {
        t[key] = clampTrait(t[key] + this.wildEvoRng.range(-SIM.wildDriftStep, SIM.wildDriftStep));
      }
      // 드리프트한 값에 파생 축을 맞춘다 — 안 그러면 진화한 대사·식성이 세계에 아무 영향을 못 준다.
      syncWildDerived(t);
    }
  }

  private maybeImmigrate(): void {
    if (this.tick % SIM.immigrationInterval !== 0) return;
    if (this.entities.length >= this.cap) return;
    // 이주 바닥·보충량도 면적 비례 — 절대값이면 큰 맵에서 종당 적정 수 대비 너무 낮아(예 floor 4 vs
    // 종당 ~90) 야생이 줄어도 보충이 안 돼 내 종에게 단조 잠식된다. 비례하면 작은 맵의 회복 진동을 유지.
    const floor = Math.round(SIM.immigrationFloor * this.areaScale);
    const batch = Math.round(SIM.immigrationBatch * this.areaScale);
    const counts = new Map<number, number>();
    for (const e of this.entities) counts.set(e.species.id, (counts.get(e.species.id) ?? 0) + 1);
    for (const sp of this.species) {
      // 친척·바이옴 특화종은 이주로 보충 안 함(친척=내 편, 바이옴종=제 바이옴에서만 산다 — 멸종하면 사라짐).
      // 감춘 종(좁힌 세계)도 마찬가지다 — 안 막으면 걸러낸 종이 10초마다 이주로 되살아난다.
      if (sp.isPlayer || sp.friendly || sp.homeBiome || this.hiddenSpeciesIds.has(sp.id)) continue;
      if ((counts.get(sp.id) ?? 0) >= floor) continue;
      const canSwim = sp.genome.traits.swimming >= SIM.swimThreshold;
      const canLand = sp.genome.traits.swimming < SIM.aquaticOnlyThreshold;
      const canFly = sp.genome.traits.wings >= SIM.flyThreshold;
      for (let k = 0; k < batch; k++) {
        // rng 소비 순서(width→height)를 보존한 뒤 막힌 타일이면 통행 타일로 스냅(스냅은 rng 미사용).
        const ix = this.rng.range(0, this.width);
        const iy = this.rng.range(0, this.height);
        // 물 전용 종은 큰 바다로 이주(웅덩이 갇힘 방지). 스냅은 rng 미사용 → 소비 순서 보존.
        const spot = this.snapSpawn(ix, iy, canSwim, canLand, canFly);
        this.entities.push(createEntity(this.nextId(), spot.x, spot.y, sp, SIM.startEnergy));
      }
    }
  }

  /**
   * 종의 통행 특성에 맞는 위치로 스냅한다(rng 미사용 → 스폰 rng 소비 순서·밸런스 무관). 물 전용 종
   * (진짜 물고기 = 수영 O·육지 X)은 "충분히 큰 바다"에만 넣어 작은 웅덩이 갇힘·폐사를 막는다. 그 외
   * (육지·양용·비행)은 통행 가능한 가장 가까운 타일(기존과 동일).
   */
  private snapSpawn(x: number, y: number, canSwim: boolean, canLand: boolean, canFly: boolean): { x: number; y: number } {
    const minRegion = canSwim && !canLand && !canFly ? SIM.minWaterRegion : 1;
    return this.terrain.nearestLargePassable(x, y, canSwim, canLand, canFly, minRegion);
  }

  /**
   * 스폰 뭉침 반경(보금자리 퍼짐) — 맵 크기(면적의 제곱근 = 길이 배율)에 비례. 절대값이면 큰 맵에서
   * 좁은 점에 과밀해 국소 먹이를 빨리 소진한다. 모든 스폰(내 종·야생·친척·챔피언·바이옴종)이 이
   * 한 값을 쓴다 — 흩어져 있던 `72 * sqrt(areaScale)` 복사 여섯 곳을 모은 것(값 동일).
   */
  private get spawnSpread(): number {
    return 72 * Math.sqrt(this.areaScale);
  }

  private spawnEntities(): void {
    for (const sp of this.species) {
      // 친척(우호 종)·바이옴 특화종은 여기서 스폰하지 않는다 — 각자 독립 rng 스폰이 맡아 메인 rng 소비 순서 보존.
      if (sp.friendly || sp.homeBiome) continue;
      // 야생종은 고유한 영역(보금자리)에 모여 태어난다 — 환경 비옥도 차이 + 무리 성향과 맞물려
      // 경쟁 배제를 늦춰 더 많은 종이 공존한다. 내 종(주인공)은 맵 전체에 넓게 퍼뜨린다.
      const homeX = this.rng.range(0.14, 0.86) * this.width;
      const homeY = this.rng.range(0.14, 0.86) * this.height;
      // 야생종은 좁은 영역에 모여 태어나(영역화 → 공존), 내 종(주인공)은 맵 전체에 얇게 퍼진다.
      const canSwim = sp.genome.traits.swimming >= SIM.swimThreshold;
      const canLand = sp.genome.traits.swimming < SIM.aquaticOnlyThreshold;
      const canFly = sp.genome.traits.wings >= SIM.flyThreshold;
      // 물 전용 내 종은 보금자리를 큰 바다로 옮긴다(육지 home 이면 흩어져 고립·웅덩이 갇힘). 스냅은 rng 미사용.
      // 야생 물고기 base 위치는 여기서 안 바꾼다 — 통과기준 테스트(육지 게놈)가 1마리 경계라, 야생 물고기
      // 위치를 어떻게든 바꾸면 step 난수 스트림이 밀려 경계가 어긋난다(물고기가 육지 종과 스트림 공유).
      // 대신 학교의 대부분인 보강(패딩 +10)·이주를 큰 바다로 넣어 "떼"가 바다에 자리 잡게 한다.
      let baseX = homeX;
      let baseY = homeY;
      if (sp.isPlayer && !canLand) {
        const wh = this.snapSpawn(homeX, homeY, canSwim, canLand, canFly);
        baseX = wh.x;
        baseY = wh.y;
      }
      // 육상/양용 내 종은 맵 전체에 얇게, 물 전용 내 종은 야생처럼 한 바다 영역에 모아(흩어지면 고립).
      // 야생 보금자리는 맵 크기(면적의 제곱근)에 비례 — 절대값이면 큰 맵에서 좁은 점에 과밀해 국소 먹이를
      // 빨리 소진하고 집단 아사한다(맵 3배에서 야생 급감의 원인). 비례하면 밀도가 유지된다.
      // 모든 종(내 종 포함)이 한 무리로 모여 태어난다 — 내 종이 맵 전체에 흩어지면 무게중심이 안
      // 움직여 카메라가 못 따라가고 개체 하나하나 관찰이 안 된다(소수 개체 게임의 핵심).
      const spread = this.spawnSpread;
      // 야생은 종 정체성(상대 비율)은 유지하며 전체만 절반으로(소수 생태). 개체는 절대 수(맵 크기와
      // 무관하게 소수) — areaScale(면적 배율)은 먹이 밀도·상한에만 써서, 큰 맵일수록 개체당 먹이가 넉넉하다.
      const count = Math.max(1, Math.round(sp.isPlayer ? sp.initialCount : sp.initialCount * SIM.wildCountScale));
      for (let i = 0; i < count; i++) {
        const x = Math.max(0, Math.min(this.width, baseX + this.rng.range(-spread, spread)));
        const y = Math.max(0, Math.min(this.height, baseY + this.rng.range(-spread, spread)));
        // 내 종만 큰 바다 스냅(위 사유 — 야생 base 위치는 통과기준 보존 위해 기존 nearestPassable 유지).
        const spot = sp.isPlayer
          ? this.snapSpawn(x, y, canSwim, canLand, canFly)
          : this.terrain.nearestPassable(x, y, canSwim, canLand, canFly);
        this.entities.push(createEntity(this.nextId(), spot.x, spot.y, sp, SIM.startEnergy));
      }
    }
  }

  /**
   * (옵션 `predatorPressure`) 사냥하는 야생을 배수만큼 **불려서** 세계를 시대에 맞게 험하게 만든다.
   *
   * 늘어난 개체는 자기 종의 기존 개체 곁(보금자리 반경 안)에 태어난다 — 새 무리를 아무 데나 만들면
   * 종의 영역성(경쟁 배제를 늦추는 장치)이 깨진다. 우호 무리(친척·챔피언)와 감춘 종은 건드리지 않는다.
   *
   * ⚠ 전용 rng 다. 메인 스트림을 안 건드리므로 배수 1(첫 시대)이면 세계가 1비트도 안 달라진다.
   */
  private spawnEraPredators(rng: Rng, pressure: number): void {
    if (!(pressure > 1)) return;
    // 종별로 지금 살아 있는 개체를 모은다(감추기가 끝난 뒤라 화면에 실제로 있는 것만 센다).
    const bySpecies = new Map<number, Entity[]>();
    for (const e of this.entities) {
      const sp = e.species;
      if (sp.isPlayer || sp.friendly) continue;
      if (sp.genome.traits.diet <= SIM.dietHuntMin) continue; // 사냥하는 종만
      const list = bySpecies.get(sp.id);
      if (list === undefined) bySpecies.set(sp.id, [e]);
      else list.push(e);
    }
    const spread = this.spawnSpread;
    // 종 id 오름차순으로 돌아 Map 삽입 순서에 결과가 안 걸리게 한다(결정론).
    for (const id of [...bySpecies.keys()].sort((a, b) => a - b)) {
      const list = bySpecies.get(id) as Entity[];
      const seed0 = list[0] as Entity;
      const sp = seed0.species;
      const extra = Math.round(list.length * (pressure - 1));
      if (extra <= 0) continue;
      const canSwim = sp.genome.traits.swimming >= SIM.swimThreshold;
      const canLand = sp.genome.traits.swimming < SIM.aquaticOnlyThreshold;
      const canFly = sp.genome.traits.wings >= SIM.flyThreshold;
      let hx = 0;
      let hy = 0;
      for (const e of list) {
        hx += e.x;
        hy += e.y;
      }
      hx /= list.length;
      hy /= list.length;
      for (let i = 0; i < extra; i++) {
        const spot = this.snapSpawn(hx + rng.range(-spread, spread), hy + rng.range(-spread, spread), canSwim, canLand, canFly);
        this.entities.push(createEntity(this.nextId(), spot.x, spot.y, sp, SIM.startEnergy));
      }
    }
  }

  /**
   * (옵션 `spacedPredators`) 사냥하는 야생 무리를 내 종에서 **일정 거리**에 옮겨 둔다.
   *
   * 왜: 실측에서 내 종과 가장 가까운 포식자까지의 거리가 시드에 따라 32px~1090px(34배)로 갈렸다.
   * 어떤 판은 시작하자마자 물리고 어떤 판은 끝까지 포식자를 못 본다 — 그건 난이도가 아니라 운이고,
   * "포식자가 있는 세계"라는 배울 거리가 시드 절반에서 통째로 사라진다.
   *
   * ⚠ rng 를 한 번도 안 쓴다. 보금자리 추첨은 그대로 두고 **결과값만 평행이동**한다
   *   (물 전용 내 종을 큰 바다로 스냅하는 기존 처리와 같은 안전한 형태).
   */
  private spaceOutPredators(): void {
    // 맵 짧은 변 대비 거리 — 이 띠 안이면 그대로 두고, 벗어난 판만 가운데 값으로 옮긴다.
    const NEAR = 0.3;
    const FAR = 0.4;
    const TARGET = 0.35;
    let px = 0;
    let py = 0;
    let pn = 0;
    const pack: Entity[] = [];
    for (const e of this.entities) {
      if (e.species.isPlayer) {
        px += e.x;
        py += e.y;
        pn += 1;
        continue;
      }
      if (e.species.friendly) continue;
      if (e.species.genome.traits.diet <= SIM.dietHuntMin) continue; // 사냥하는 종만
      pack.push(e);
    }
    const first = pack[0];
    if (pn === 0 || first === undefined) return;
    const cx = px / pn;
    const cy = py / pn;
    let qx = 0;
    let qy = 0;
    for (const e of pack) {
      qx += e.x;
      qy += e.y;
    }
    qx /= pack.length;
    qy /= pack.length;
    const side = Math.min(this.width, this.height);
    const d = Math.hypot(qx - cx, qy - cy);
    if (d >= NEAR * side && d <= FAR * side) return; // 이미 알맞은 거리 · 손대지 않는다
    const want = TARGET * side;
    const margin = this.spawnSpread;
    // 지금 있는 쪽을 우선 쓰고, 그 자리가 맵 밖이면 45°씩 돌려 본다(순수 계산 · 결정론).
    const base = d > 1e-6 ? Math.atan2(qy - cy, qx - cx) : 0;
    let tx = cx + Math.cos(base) * want;
    let ty = cy + Math.sin(base) * want;
    for (let k = 0; k < 8; k++) {
      const a = base + (k * Math.PI) / 4;
      const x = cx + Math.cos(a) * want;
      const y = cy + Math.sin(a) * want;
      if (x >= margin && x <= this.width - margin && y >= margin && y <= this.height - margin) {
        tx = x;
        ty = y;
        break;
      }
    }
    tx = Math.max(margin, Math.min(this.width - margin, tx));
    ty = Math.max(margin, Math.min(this.height - margin, ty));
    const dx = tx - qx;
    const dy = ty - qy;
    for (const e of pack) {
      const t = e.species.genome.traits;
      const spot = this.terrain.nearestPassable(
        Math.max(0, Math.min(this.width, e.x + dx)),
        Math.max(0, Math.min(this.height, e.y + dy)),
        t.swimming >= SIM.swimThreshold,
        t.swimming < SIM.aquaticOnlyThreshold,
        t.wings >= SIM.flyThreshold,
      );
      e.x = spot.x;
      e.y = spot.y;
      e.prevX = spot.x; // 렌더 보간이 옛 자리에서 새 자리로 미끄러지지 않게 함께 옮긴다
      e.prevY = spot.y;
    }
  }

  /**
   * 우호적 친척 무리를 스폰한다(독립 rng → 메인 밸런스 불변). 야생종처럼 자기 영역(보금자리)에 모여
   * 산다 — 내 종 옆에 두면 무리에 섞여 내 종 결속(cohesion)을 흐트러뜨려 외톨이/매복 보스에 취약해지고,
   * 국소 먹이도 함께 소진해 통과 마진을 잠식한다(세션 2·3에서 두 번 확인 — 근처 동거는 밸런스가 안 맞음).
   * 떨어져 살되 이동하다 만나면 서로 사냥·도망하지 않아(friendly) 자연스레 섞인다(스포어식 우호 종).
   */
  private spawnKin(rng: Rng): void {
    const kin = this.species.find((s) => s.friendly && !s.champion);
    if (!kin) return;
    const canSwim = kin.genome.traits.swimming >= SIM.swimThreshold;
    const canLand = kin.genome.traits.swimming < SIM.aquaticOnlyThreshold;
    const canFly = kin.genome.traits.wings >= SIM.flyThreshold;
    const homeX = rng.range(0.14, 0.86) * this.width;
    const homeY = rng.range(0.14, 0.86) * this.height;
    const spread = this.spawnSpread;
    for (let i = 0; i < kin.initialCount; i++) {
      const x = Math.max(0, Math.min(this.width, homeX + rng.range(-spread, spread)));
      const y = Math.max(0, Math.min(this.height, homeY + rng.range(-spread, spread)));
      const spot = this.terrain.nearestPassable(x, y, canSwim, canLand, canFly);
      this.entities.push(createEntity(this.nextId(), spot.x, spot.y, kin, SIM.startEnergy));
    }
  }

  /**
   * 비동기 생물(S2) — 챔피언(지난 런의 내 종) 각각을 독립 rng 로 맵의 독립 영역에 소수 스폰한다. 친척과
   * 같은 격리 패턴이라 메인 스트림·밸런스에 안 걸린다. 챔피언이 없으면(첫 플레이·headless) 아무 일도 안 한다.
   */
  private spawnChampions(rng: Rng): void {
    const spread = this.spawnSpread;
    for (const sp of this.species) {
      if (!sp.champion) continue;
      const tr = sp.genome.traits;
      const canSwim = tr.swimming >= SIM.swimThreshold;
      const canLand = tr.swimming < SIM.aquaticOnlyThreshold;
      const canFly = tr.wings >= SIM.flyThreshold;
      const home = this.snapSpawn(
        rng.range(0.14, 0.86) * this.width,
        rng.range(0.14, 0.86) * this.height,
        canSwim,
        canLand,
        canFly,
      );
      for (let i = 0; i < sp.initialCount; i++) {
        const x = Math.max(0, Math.min(this.width, home.x + rng.range(-spread, spread)));
        const y = Math.max(0, Math.min(this.height, home.y + rng.range(-spread, spread)));
        const spot = this.snapSpawn(x, y, canSwim, canLand, canFly);
        this.entities.push(createEntity(this.nextId(), spot.x, spot.y, sp, SIM.startEnergy));
      }
    }
  }

  /**
   * 야생 "떼종"을 독립 rng 로 보강한다 — 기본 소수 스폰만으론 무리·진화가 눈에 안 들어오고("물고기 떼"인데
   * 5마리), 먹이사슬 하위 초식이 소수면 생태가 부자연스럽다(하위일수록 많아야 자연스러운 개체수 피라미드).
   *   · 물 전용 종(물고기): seaHerdPad 만큼(≈학교). 바다는 격리된 니치라 밸런스 안 걸림.
   *   · 육지 초식(diet<사냥임계, 물 아님): landHerbivorePad × 번식력/100 — 다산형일수록 많이(넓은 바닥).
   * 독립 rng → 메인 스트림(step 동역학) 불변. 내 종·포식자·잡식은 대상 아님(소수 유지). 개체 수는 절대
   * (맵 크기 무관 — 소수 개체 게임). areaScale 은 위치 분산에만(길이라 제곱근), 개수엔 안 쓴다.
   */
  private spawnWildHerdPadding(rng: Rng): void {
    const spread = this.spawnSpread;
    for (const sp of this.species) {
      if (sp.isPlayer || sp.friendly || sp.homeBiome) continue; // 바이옴 특화종은 자기 스폰이 따로(중복 방지)
      const tr = sp.genome.traits;
      let pad = 0;
      if (tr.swimming >= SIM.aquaticOnlyThreshold) {
        pad = SIM.seaHerdPad; // 물 전용(진짜 물고기) — 학교로
      } else if (tr.diet < SIM.dietHuntMin && tr.swimming < SIM.swimThreshold) {
        pad = Math.round(SIM.landHerbivorePad * (tr.fertility / TRAIT_MAX)); // 육지 초식 — 다산형일수록 많이
      }
      if (pad <= 0) continue;
      const canSwim = tr.swimming >= SIM.swimThreshold;
      const canLand = tr.swimming < SIM.aquaticOnlyThreshold;
      const canFly = tr.wings >= SIM.flyThreshold;
      // 보금자리를 종 특성에 맞는 큰 영역으로(물고기는 큰 바다). 인접 웅덩이에 흩어져 갇히는 것 방지.
      const home = this.snapSpawn(rng.range(0.14, 0.86) * this.width, rng.range(0.14, 0.86) * this.height, canSwim, canLand, canFly);
      for (let i = 0; i < pad; i++) {
        const x = Math.max(0, Math.min(this.width, home.x + rng.range(-spread, spread)));
        const y = Math.max(0, Math.min(this.height, home.y + rng.range(-spread, spread)));
        // 통행 타일로 스냅(rng 미사용 → 소비 순서 보존). 물 전용은 큰 바다로, 육지 종은 육지로.
        const spot = this.snapSpawn(x, y, canSwim, canLand, canFly);
        this.entities.push(createEntity(this.nextId(), spot.x, spot.y, sp, SIM.startEnergy));
      }
    }
  }

  /**
   * 바이옴 특화종(homeBiome 있는 종)을 각자 고향 바이옴 구역에 스폰한다 — 사막 도마뱀은 사막에, 빙하 큰곰은
   * 빙하에. 그 지형에 사는 특화 종이 보이면 "바이옴이 생물에 영향을 준다"가 눈에 띈다. 고향 바이옴 타일이
   * 맵에 없으면(이번 맵에 그 바이옴이 안 뜸) 그 종은 이번 맵에 안 나온다(바이옴 조건부 등장). 독립 rng →
   * 메인 스트림 불변. 육지 통행 타일 중 그 바이옴인 것만 후보로 모아 rng 로 보금자리를 고른다.
   */
  private spawnBiomeAnimals(rng: Rng): void {
    const terr = this.terrain;
    const spread = this.spawnSpread;
    for (const sp of this.species) {
      if (!sp.homeBiome) continue;
      // 고향 바이옴이면서 통행 가능한 육지 타일을 후보로 모은다(물·산 제외 — 바이옴종은 육지 거주).
      const cells: number[] = [];
      for (let i = 0; i < terr.tiles.length; i++) {
        const k = terr.tiles[i] ?? TILE.land;
        if (k === TILE.water || k === TILE.mountain) continue;
        const cx = (i % terr.cols + 0.5) * terr.cellSize;
        const cy = (Math.floor(i / terr.cols) + 0.5) * terr.cellSize;
        if (this.environment.biomeAt(cx, cy) === sp.homeBiome) cells.push(i);
      }
      if (cells.length === 0) continue; // 이 바이옴이 맵에 없음 → 이 종은 이번 맵에 등장 안 함
      const home = cells[Math.floor(rng.unit() * cells.length)] ?? cells[0] ?? 0;
      const baseX = (home % terr.cols + 0.5) * terr.cellSize;
      const baseY = (Math.floor(home / terr.cols) + 0.5) * terr.cellSize;
      for (let i = 0; i < sp.initialCount; i++) {
        const x = Math.max(0, Math.min(this.width, baseX + rng.range(-spread, spread)));
        const y = Math.max(0, Math.min(this.height, baseY + rng.range(-spread, spread)));
        const spot = terr.nearestPassable(x, y, false, true, false); // 육지 거주(수영·비행 아님)
        this.entities.push(createEntity(this.nextId(), spot.x, spot.y, sp, SIM.startEnergy));
      }
    }
  }

  /**
   * 맵 전용 야생종을 제 삶터에 스폰한다(독립 rng → 메인 스트림·기존 밸런스 불변).
   *   바다 종(바다뱀·범고래·거북·크릴) → **충분히 큰 바다**(물고기 스폰과 같은 규칙). 웅덩이에 넣으면
   *     갇혀 뱅뱅 돌다 굶어 죽어 아무 일도 안 일어난다.
   *   산 종(고산 독수리) → 산 근처(날 수 있으니 통행은 자유롭지만 사냥터가 산이라 거기서 시작).
   *   땅 종(들소) → 야생종처럼 한 보금자리에 모여서.
   * 그 삶터가 이 맵에 없으면(예: 바다가 거의 없는데 바다 종) 그 종은 이번 판에 안 나온다.
   */
  private spawnMapAnimals(rng: Rng, mapSpecies: Species[]): void {
    const terr = this.terrain;
    const spread = this.spawnSpread;
    for (const sp of mapSpecies) {
      const habitat = mapSpeciesHabitat(this.mapType, sp.name);
      const canSwim = sp.genome.traits.swimming >= SIM.swimThreshold;
      const canLand = sp.genome.traits.swimming < SIM.aquaticOnlyThreshold;
      const canFly = sp.genome.traits.wings >= SIM.flyThreshold;

      // 보금자리 후보 타일 — 삶터에 맞는 타일만.
      const want: TileKind | null =
        habitat === "sea" ? TILE.water : habitat === "mountain" ? TILE.mountain : null;
      const cells: number[] = [];
      for (let i = 0; i < terr.tiles.length; i++) {
        const k = terr.tiles[i] ?? TILE.land;
        if (want === null) {
          if (k !== TILE.water && k !== TILE.mountain) cells.push(i);
        } else if (k === want) cells.push(i);
      }
      if (cells.length === 0) continue; // 이 맵엔 그 삶터가 없다 → 이 종은 안 나온다

      const home = cells[Math.floor(rng.unit() * cells.length)] ?? cells[0] ?? 0;
      const baseX = (home % terr.cols + 0.5) * terr.cellSize;
      const baseY = (Math.floor(home / terr.cols) + 0.5) * terr.cellSize;
      for (let i = 0; i < sp.initialCount; i++) {
        const x = Math.max(0, Math.min(this.width, baseX + rng.range(-spread, spread)));
        const y = Math.max(0, Math.min(this.height, baseY + rng.range(-spread, spread)));
        // 물 전용 종은 "충분히 큰 바다"로 스냅(작은 웅덩이에 갇히면 폐사) — 물고기 떼와 같은 규칙.
        const minRegion = canSwim && !canLand ? SIM.minWaterRegion : 1;
        const spot = terr.nearestLargePassable(x, y, canSwim, canLand, canFly, minRegion);
        this.entities.push(createEntity(this.nextId(), spot.x, spot.y, sp, SIM.startEnergy));
      }
    }
  }
}

// ─────────────────────────────── 방울을 놓을 자리 고르기 ───────────────────────────────

/**
 * 고리 위에서 자리를 던져 보는 횟수. 12번이면 대륙에서는 거의 첫 판에 잡히고, 바다가 많은 세계
 * (군도·대양)에서도 육지 방향이 한 번은 걸린다. 실패해도 뽑는 것은 전용 rng 뿐이라 대가가 없다.
 * (이 수치는 내 판단이다.)
 */
const GENE_SPOT_TRIES = 12;

/**
 * "직선으로는 안 보이지만 돌아가면 닿는" 후보를 길찾기(BFS)로 확인해 보는 상한.
 * BFS 는 지형 격자 전체를 훑으므로 한 번이 싸지 않다 · 방울 하나에 두 번까지만 쓴다.
 * (이 수치는 내 판단이다.)
 */
const GENE_SPOT_PATH_TRIES = 2;

/**
 * **방울을 떨어뜨릴 자리 하나를 고른다.** 내 종이 하나도 없으면 null.
 *
 * 두 조건을 다 만족하는 자리만 돌려준다:
 *  1. **내 종이 지나갈 수 있는 지형** · 못 가는 땅(물 못 건너는 종에게 바다 · 못 나는 종에게 산)에
 *     떨어뜨리면 그 방울은 영영 안 주워진다. 화면에 보이는데 못 먹는 것만큼 나쁜 것이 없다.
 *  2. **실제로 걸어 닿는 곳** · 통행 가능한 타일이어도 건너편 섬이면 못 간다. 먼저 직선(`lineOfSight`)
 *     으로 싸게 보고, 막혔으면 길찾기로 돌아가는 길이 있는지 확인한다.
 *
 * 거리(`GENE_SPAWN_RING`)가 곧 **대가**다 · 방울을 주우러 가는 동안 무리는 본진을 비운다. 발밑에
 * 떨어뜨리면 가만히 있어도 주워져 조종이 아무 뜻이 없어지고, 너무 멀면 화면 밖이라 있는 줄도 모른다.
 * 고리가 통째로 막힌 세계(작은 섬)에서는 **고리를 좁혀** 다시 던진다 · 대가는 줄지만 0 은 아니다.
 *
 * ⚠ `rng` 는 반드시 `world.geneRng` 다. 메인 `world.rng` 를 넣으면 소비 횟수가 밀려 야생 스폰·진화가
 *   통째로 이동한다(`species.ts` 의 `WILD_RNG_KEYS` 제약과 같은 계열).
 * ⚠ 세계를 하나도 안 바꾼다(읽기만) · 뽑는 것은 넘겨받은 rng 뿐이다.
 */
export function pickGeneDropSpot(rng: Rng, world: World): { x: number; y: number } | null {
  if (world.playerPopulation === 0) return null;

  const c = world.playerCentroid();
  // 통행 특성은 **내 종 게놈** 에서 낸다(개체 하나가 아니라). 개체별로 다르지 않고, 게놈은 드래프트가
  // 바꾸는 즉시 반영되므로 "수영을 배운 순간부터 바다에도 방울이 뜬다"가 저절로 맞는다.
  const t = world.genome.traits;
  const canSwim = t.swimming >= SIM.swimThreshold;
  const canLand = t.swimming < SIM.aquaticOnlyThreshold;
  const canFly = t.wings >= SIM.flyThreshold;
  const terr = world.terrain;
  const homeTile = terr.tileIndex(c.x, c.y);

  // 방울이 화면·세계 밖으로 반쯤 걸치면 줍기 반경이 잘린다 → 반경만큼 안쪽으로 물린다.
  const lo = Math.min(GENE_PICK_RADIUS, world.width / 2, world.height / 2);
  const clampX = (v: number): number => Math.max(lo, Math.min(world.width - lo, v));
  const clampY = (v: number): number => Math.max(lo, Math.min(world.height - lo, v));

  // 통행은 되는데 직선이 막힌 후보들 · 고리 한 바퀴가 끝난 뒤에만(길찾기가 비싸다) 살펴본다.
  let detour: { x: number; y: number }[] = [];

  const tryRing = (minR: number, maxR: number): { x: number; y: number } | null => {
    detour = [];
    for (let i = 0; i < GENE_SPOT_TRIES; i += 1) {
      const { dx, dy } = geneDropOffset(rng, minR, maxR);
      const x = clampX(c.x + dx);
      const y = clampY(c.y + dy);
      if (!terr.isPassable(x, y, canSwim, canLand, canFly)) continue;
      // 무리가 서 있는 바로 그 타일은 뺀다 · 발밑은 대가가 0 이다(좁힌 고리에서만 걸린다).
      if (terr.tileIndex(x, y) === homeTile) continue;
      if (terr.lineOfSight(c.x, c.y, x, y, canSwim, canLand, canFly)) return { x, y };
      if (detour.length < GENE_SPOT_PATH_TRIES) detour.push({ x, y });
    }
    return null;
  };

  const viaPath = (): { x: number; y: number } | null => {
    for (const d of detour) {
      // findPath 는 길이 없으면 빈 배열이다. 같은 타일은 위에서 이미 걸렀으므로 빈 배열 = 못 간다.
      if (terr.findPath(c.x, c.y, d.x, d.y, canSwim, canLand, canFly).length > 0) return d;
    }
    return null;
  };

  const far = tryRing(GENE_SPAWN_RING.min, GENE_SPAWN_RING.max);
  if (far !== null) return far;
  const farDetour = viaPath();
  if (farDetour !== null) return farDetour;

  // 고리가 통째로 막혔다(작은 섬에 갇힌 무리 · 물 전용 종이 좁은 만에 있는 경우).
  // 고리를 줍기 반경의 세 배까지 좁혀 다시 던진다 · 몇 걸음이라도 걸어가야 하는 것은 그대로다.
  const near = tryRing(GENE_PICK_RADIUS * 3, GENE_SPAWN_RING.min);
  if (near !== null) return near;
  return viaPath();
}
