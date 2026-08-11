// 게임 상태기계 (런/라운드). 한 런 = 한 혈통의 일생.
// 런은 단계 계획(SCHEDULE)을 따른다. 각 단계 앞에 드래프트가 붙는다.
//   forage     채집 라운드 (그냥 살아남고 수를 불린다)
//   boss       보스 게이트 (버티기: 끝까지 기준 개체 수 생존하면 통과)
//   extinction 대멸종 피날레 (환경 적합도 필터: 통과하면 승리)
// 멸종(개체 0)하면 그 자리에서 패배. 게놈은 런 내 누적, 새 런에서 리셋.

import { World } from "@/sim/world";
import { easeChampionGenome } from "@/sim/species";
import { Rng } from "@/sim/rng";
import { defaultGenome, cloneGenome, refreshDerived, MUTABLE_TRAITS, type Genome, type MutableTrait } from "@/sim/genome";
import {
  GENE_AWARD,
  createCrisisWatch,
  milestonesCrossed,
  stepCrisisWatch,
  type CrisisWatch,
  type GeneReason,
} from "@/sim/gene";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  KEY_NAMES,
  TIER_ROMAN,
  nearestTierGoal,
  pipsToNext,
  tiersOf,
  type Category,
} from "@/sim/tiers";
import {
  drawCards,
  applyCard,
  cardFavorsCategory,
  cardPrereqMet,
  cardRedundant,
  EMBER_CARD,
  PRESET_CARDS,
  PRESET_LINEAGE,
  type Card,
  type DraftBias,
  type Lineage,
} from "@/game/cards";
import { cardAvailable, debugResetAchievements, evaluateRun, type Achievement, type RunSummary } from "@/game/achievements";
import {
  GAME,
  SCHEDULE,
  eraDifficulty,
  eraScarcity,
  eraPredatorPressure,
  bossPassNeeded,
  extinctionPassNeeded,
  EXTINCTION,
  mapScale,
  onboardingStep,
  onboardingOpenedLine,
  stepHasChampions,
  stepHasTrial,
  stepUsesDrawnMap,
  stepWorldOptions,
  type StageKind,
} from "@/game/config";
import { loadMeta, metaLevel, isPresetUnlocked, isRerollUnlockedAtLevel, recordRunComplete, debugSetMetaLevel, debugGrantMetaXp, debugResetProgress, loadChampions, saveChampion, type RunProgress, type Champion } from "@/game/meta";
import { SIM } from "@/sim/params";
import type { LeadCommand } from "@/sim/lead";
import type { Entity } from "@/sim/entity";
import { biteOutcome } from "@/sim/behavior";
import {
  ORDER_SPECS,
  ORDER_SPEC_BY_KIND,
  orderUnlocked,
  vacuumTicks,
  voiceRadius,
  type HerdOrder,
  type OrderKind,
  type OrderSpec,
} from "@/sim/herdOrder";

/**
 * **은근한 보정의 상한.** 보정이 세면 게임이 저절로 굴러가고, 그러면 플레이어가 이룬 것이 가짜가 된다
 * (**[사용자 2026-08-06]** "플레이어가 눈치채지 못하게"). 최대 배수를 상수로 못 박고 프로브로 검증한다.
 * 1.45 = 내 방향 카드가 최대 1.45배 자주 뜬다 — 눈에 안 띄되 열 번쯤 뽑으면 한 장 더 오는 정도.
 *
 * ⚠ **2026-08-10 에 1.9 → 1.45 로 낮췄다.** 게이트가 생기면서(티어가 카드를 연다) 후보 자체가
 *   이미 내가 판 범주 쪽으로 기울었다. 그 위에 1.9 를 곱하면 **기울기가 두 번 걸려** 같은 범주만
 *   계속 나온다 — **[사용자]** 가 "매번 이빨 카드만 뜬다 · 의욕을 잃게 하는 게 더 크다"고 한 상태다.
 *   보정은 「조금 더 자주」여야지 「그것만」이 되면 그건 보정이 아니라 선택지를 뺏는 것이다.
 */
const ASSIST_MAX_WEIGHT = 1.45;

// ── 세계 위에 찍는 시험의 손끝 값 (**[사용자 2026-08-06]** 「무엇을 지켜라」) ──
//
// ⚠ 거리는 **16초 안에 갈 수 있어야** 한다. 무리 최고 속도는 1.7~2.7px/틱이고 30틱/초이므로
//   16초에 800~1300px 을 간다. 다만 무리는 먹이를 지나치지 못해 실제로는 그 절반쯤 간다
//   (behavior 의 「가는 길의 먹이」 예외). 그래서 상한을 여유 있게 잡는다.
/** 자리 시험을 무리에서 최소 이만큼 떨어뜨린다 — 발밑에 찍으면 아무것도 안 해도 합격이라 시험이 아니다. */
const TRIAL_HOLD_MIN_DIST = 220;
/** 최대 이만큼. 더 멀면 16초 안에 못 간다. */
const TRIAL_HOLD_MAX_DIST = 420;
/** 자리의 반지름(px). 무리는 무게중심에서 평균 240px 로 흩어져 사니, 좁으면 다 모으는 게 불가능하다. */
const TRIAL_HOLD_RADIUS = 130;
/** 표식을 목표보다 이만큼 더 찍는다 — 표식이 찍힌 것이 다른 이유로 죽어도 시험이 불가능해지지 않게. */
const TRIAL_MARK_SPARE = 3;
import { createBoss, bossPreview, bossName, bossCounter, bossTypeRaidable, isPredatorBoss, bossEligible, BOSS_TYPES, type BossType } from "@/sim/boss";
import { pickMapType, mapKind, FIRST_ERA_MAP, type MapKind, type MapType } from "@/sim/mapType";
import { TILE } from "@/sim/terrain";
import { buildRunReport } from "@/game/runReport";
import {
  currentCodeStamp,
  encodeRunCode,
  baseCardId,
  isBossThreat,
  DRAFT_NONE,
  DRAFT_REROLLED,
  DRAFT_SKIPPED,
  type DraftKind,
  type EndReason,
  type RunCodeData,
  type RunLogEntry,
  type TrialRecord,
} from "@/game/runCode";

/**
 * 게임이 지금 무엇을 하고 있는가. **시간이 흐르는 단계는 `watch`(와 배경만 도는 `lobby`)뿐이다.**
 * `update()` 가 그 밖의 값에서는 곧장 되돌아간다.
 *
 * `shop`(방울 구입 화면)이 여기 있는 이유: **[사용자 2026-08-09]** "방울 업그레이드 고르는 중에는
 * 시간이 안 멈추나? 그거 보다보니 멸종해버렸는데". 카드 드래프트는 `draft` 로 바뀌어 멈추는데,
 * 구입 화면은 화면만 띄우고 세계는 계속 굴러가고 있었다. **같은 「고르는 화면」인데 하나만 멈췄다.**
 * 새 정지 경로(별도 플래그)를 만들지 않고 드래프트와 **같은 장치**를 쓴다 · 정지가 두 갈래면
 * 반드시 한쪽만 안 멈추는 화면이 다시 생긴다.
 */
export type Phase = "lobby" | "draft" | "watch" | "result" | "shop";
export type RunResult = "win" | "lose";

export type ExtinctionType = "cold" | "famine" | "heat" | "plague";

/** 라운드 시험의 종류. */
export type TrialKind = "hunt" | "feed" | "birth" | "pop" | "hold" | "mark";

/**
 * **초과 달성 보상에서 빠지는 시험 종류.** 「무리」 시험은 "지켜라"라 목표가 지금 무리보다 작게 잡히고
 * (붕괴 방지), 그래서 아무것도 안 해도 1.8배를 넘기기 쉽다 = 공짜 보상이 된다.
 *
 * 판정하는 자리(`finishStage`)와 그 조건을 화면에 적는 자리(방울 안내)가 **같은 이 상수를 읽는다.**
 * 한쪽에 조건을 옮겨 적으면 반드시 조용히 갈라지고, 그 순간 화면이 거짓말을 한다.
 */
export const TRIAL_EXCEED_EXCLUDED: readonly TrialKind[] = ["pop"];

/** 이번 채집 단계의 시험 · UI 는 label 로 문구를 조립한다(숫자 포함, 표시=실물). */
export interface Trial {
  kind: TrialKind;
  target: number; // 합격선
  label: string; // "사냥 2회"·"먹이 12회"·"새끼 2마리"·"무리 9마리"
}

/** 라운드 시험 판정 결과 · main 이 플래시로 띄운다. */
export interface TrialVerdict {
  passed: boolean;
  trial: Trial;
  progress: number; // 판정 시점 달성치
  embersLeft: number; // 판정 반영 후 남은 불씨
  /** 목표를 크게 넘겨 합격했는가 — 불씨가 하나 돌아온 순간. 화면이 그 사실을 따로 알린다. */
  overachieved: boolean;
}

const EXTINCTION_TYPES: readonly ExtinctionType[] = ["cold", "famine", "heat", "plague"];

/** 런 보고서용 시계열 샘플 — 한 시점의 내 종 개체 수 + 무리 평균 형질(개체별 진화의 추이). */
export interface RunSample {
  /** 경과 시간(초) — 런 전체 누적(시대를 넘어도 이어진다). */
  t: number;
  /** 그 시점의 내 종 개체 수. */
  population: number;
  /** 살아있는 무리의 평균 형질(변이 6종). 개체마다 조금씩 다른 값이 세대가 지나며 어디로 쏠리는지 보인다. */
  traits: Record<MutableTrait, number>;
}
/** 런 보고서용 사건 종류 — 연대기에서 색·묶음을 가른다. */
export type RunEventKind = "start" | "card" | "boss" | "extinction" | "era" | "end";
/** 런 보고서용 사건 — 언제 무슨 일이 있었나(연대기 한 줄). */
export interface RunEvent {
  t: number; // 경과 시간(초)
  kind: RunEventKind;
  label: string; // 쉬운 말 한 줄
}
/** 한 혈통(run)의 일생 기록 — 결과 화면의 "이 혈통의 기록" 보고서가 읽는다. */
export interface RunHistory {
  samples: RunSample[];
  events: RunEvent[];
  durationSec: number;
}

/** 런 보고서 시계열 샘플 주기(스텝). 30 = 1초마다(sim 30스텝/초). 형질 추이는 완만해 이 정도면 충분. */
const REPORT_SAMPLE_STEPS = 30;

export class Game {
  /** 기준 화면 치수(논리 해상도). 월드 치수는 makeWorld 가 매 시대 여기에 mapScale(era) 를 곱해 만든다. */
  private readonly baseW: number;
  private readonly baseH: number;
  /** 테스트 전용 배율 고정 · 지정하면 mapScale(era) 대신 이 값을 쓴다. 생성자 의미가 "월드 치수"에서
   * "기준 화면 치수"로 바뀔 때 기존 소형 테스트 세계(예: 240x400 · areaScale 1)가 조용히 달라지지 않게. */
  private readonly fixedMapScale: number | undefined;

  /** 현재 월드 치수 · 시대별 맵 크기의 단일 진실은 world 라 여기서도 world 를 그대로 읽는다.
   * (Game 이 따로 들고 있으면 시대별 크기가 켜지는 순간 보스 스폰·카메라와 어긋난다.) */
  get width(): number {
    return this.world.width;
  }
  get height(): number {
    return this.world.height;
  }
  /** 월드 면적 배율(화면 1개=1). 맵 확장 시 개체·먹이·통과기준을 면적 비례로 키운다. */
  get areaScale(): number {
    return this.world.areaScale;
  }

  genome: Genome;
  world: World;
  phase: Phase = "lobby";
  paused = false; // 멈춤 버튼
  /** 알파 조종 모드. 기본 켜짐(main 이 true 로 세운다). `?watch` 관전 폴백에서만 false. */
  leadEnabled = false;
  /**
   * 무리가 앞장선 자를 따르는 세기(×무리 성향). null 이면 sim 기본값(LEAD.followCohesion).
   * 폰에서 `?follow=<수>` 로 손끝 느낌을 배포 없이 튜닝하려고 열어 둔 구멍이다. 단계마다 새 월드가
   * 생기므로 armLead 와 같은 자리에서 매번 다시 발라 준다.
   */
  leadFollowWeight: number | null = null;
  /** 이번 단계에 이미 적립한 경험치(조종 모드 상한용). leadEnabled=false 면 아무 데도 안 쓰인다. */
  private stageXp = 0;
  speed = 1; // 관전 배속 1/2/3
  result: RunResult | null = null;
  draftCards: Card[] = [];
  /** 이번 런에서 고른 카드 이름들(시작 식성 포함) — 화면에 "내가 무엇을 골랐나" 상시 표시용. */
  pickedCardNames: string[] = [];
  /** 이번 판에 고른 카드 id — 도전 과제 판정·보고서에 쓴다(이름은 표시용이라 id 와 따로 둔다). */
  pickedCardIds: string[] = [];
  /** 이번 판에 내 무리가 닿은 최대 개체 수(도전 과제 「대군」). */
  peakPopulation = 0;
  /** 이번 판에 쓴 다시 뽑기 횟수(도전 과제 「흔들림 없는 선택」). */
  rerollsUsed = 0;
  /** 이번 런 종료로 새로 열린 도전 과제 — 종료 화면이 알린다. */
  newAchievements: Achievement[] = [];

  /** 드래프트에 표시할 다가오는 위협 예고. */
  preview = "";
  /** 관전 중 상단에 표시할 현재 단계 라벨. */
  stageLabel = "";

  /** 지금 진행 중인 위협의 예고 문구(채집 라운드면 빈 문자열). `preview` 는 레벨업 안내로 덮이므로
   * 위협 문구는 따로 보관한다 · 드래프트가 화면을 덮어도 "무엇과 싸우는 중인지"가 읽혀야 한다. */
  private threatText = "";

  /** 혈통의 불씨 · 남은 기회. 시험 불합격 -1, 보스 격퇴 +1, 시대 진입 +1(상한 emberMax), 0 = 패배.
   * 바깥에서는 읽기만 할 것(증감은 finishStage·continueToNextEra·setupRun 만). */
  embers: number = GAME.emberStart;

  /** 직전 라운드의 판정. 판정 직후에 카드창이 열리면 화면의 판정 플래시가 그 창에 가려지므로,
   *  카드창이 맨 위에서 다시 말해 준다("왜 졌는지 모르는데 졌다"를 막는다). 새 라운드가 시작되면 비운다. */
  private lastVerdictValue: TrialVerdict | null = null;

  /** 직전 라운드 판정(카드창이 제목 자리에 싣는다). 새 라운드가 시작되면 null. */
  get lastVerdict(): TrialVerdict | null {
    return this.lastVerdictValue;
  }

  /** 아직 카드를 안 고른 레벨업 수. 라운드 경계에서 한 장씩 푼다(라운드 도중엔 안 끊는다). */
  private pendingLevels = 0;
  /** 지금 드래프트가 라운드 경계에서 열린 것인가. 고르고 나면 관전 복귀가 아니라 다음 단계로 간다. */
  private boundaryDraft = false;

  private currentTrial: Trial | null = null;
  /** 시대 보상 드래프트가 예고한 시험 · beginStage 가 그대로 채택한다. 예고 시점과 시작 시점의 게놈·
   * 개체 수가 달라도(카드 ×2 강화·스킵 새끼) 예고한 시험이 그대로 걸린다(예고=실물). */
  private pendingTrial: Trial | null = null;
  /** 이 런에서 드래프트 스킵 보상으로 낳은 새끼 누계(정수 계수 · rng 불변). */
  private skipBroodTotal = 0;
  /** 지금 시험을 만들 때의 스킵 보상 누계 스냅샷 · pop 진행도는 그 뒤 스킵 새끼를 뺀 값이다
   * ("스킵이 곧 합격"이 되면 시험이 카드 선택을 뒤틀어 버린다 · §round_verdict_spec B). */
  private trialSkipBroodBase = 0;
  private loseReason: "embers" | null = null;

  /** 지금 단계의 시험. 채집(forage) 관전·그 중간 드래프트에서만 non-null. */
  get trial(): Trial | null {
    return this.currentTrial;
  }

  /** 시험 달성치 · goalBar 가 매 프레임 읽는다. 시험이 없으면 0. */
  get trialProgress(): number {
    const t = this.currentTrial;
    if (!t) return 0;
    if (t.kind === "hunt") return this.world.roundCounts.hunts;
    if (t.kind === "feed") return this.world.roundCounts.feeds;
    if (t.kind === "birth") return this.world.roundCounts.births;
    if (t.kind === "mark") return this.world.roundCounts.marked;
    if (t.kind === "hold") {
      // **지금 이 순간 자리 안에 있는 내 종 수.** 살아 있는 진행도라, 무리를 몰면 막대가 차는 게 보인다
      // (판정은 라운드 끝에 하지만 화면은 내내 말한다 — 그래야 "가면 된다"가 손에 잡힌다).
      const z = this.world.trialZone;
      if (!z) return 0;
      let n = 0;
      for (const e of this.world.entities) {
        if (!e.alive || !e.species.isPlayer) continue;
        if ((e.x - z.x) ** 2 + (e.y - z.y) ** 2 <= z.r * z.r) n += 1;
      }
      return n;
    }
    // pop: 시험이 걸린 뒤 스킵 보상으로 낳은 새끼는 뺀다. goalBar 표시와 판정이 같은 식을 쓴다(표시=실물).
    return Math.max(0, this.world.playerPopulation - (this.skipBroodTotal - this.trialSkipBroodBase));
  }

  /** 단계 시작 직전 드래프트(시대 보상)에서, 곧 시작할 채집 단계의 시험. 그 외엔 null.
   * 드래프트를 열 때 얼려 둔 시험(pendingTrial)을 그대로 보여준다 · beginStage 도 같은 것을 쓴다.
   * (그때그때 pickTrial 로 다시 계산하면, 고른 카드가 후보 수를 3↔4 로 바꿔 예고가 거짓말이 된다.) */
  get upcomingTrial(): Trial | null {
    if (this.phase !== "draft" || !this.eraReward) return null;
    return this.pendingTrial;
  }

  /** 이번 패배가 불씨 소진인가 · 결과 화면 제목·연출 분기용(개체 0 멸종과 구분). */
  get lostByEmbers(): boolean {
    return this.loseReason === "embers";
  }

  /** 카드를 고르는 동안에도 보여야 할 안내 한 줄. 시대 보상이면 왜 이 카드가 센지, 위협이 도는
   * 중이면 무엇과 싸우는 중인지. 채집 라운드 중 평범한 레벨업이면 빈 문자열(헤더와 중복 제거). */
  get draftNotice(): string {
    if (this.phase !== "draft") return "";
    return this.eraReward ? this.preview : this.threatText;
  }

  private stageIndex = 0;
  private stageTicksLeft = 0;
  /** 이 런에서 시작한 단계의 개수 — 명령 기록이 "몇 번째 단계의 탭인가"를 적는 데 쓴다. */
  private stageOrdinal = 0;
  /** 지금 단계가 시작한 뒤 흐른 틱 — 명령 기록의 시각. 단계마다 0 으로 돌아간다.
   *  누적 틱으로 적으면 앞 단계가 한 틱만 밀려도 뒤의 모든 탭이 함께 밀린다. */
  private stageTick = 0;
  private firstChoice = true; // 런 첫 드래프트 = 시작 프리셋 선택
  /**
   * 이 런의 갈래(계통). 시작 프리셋이 정한다. 드래프트 3장 중 1장은 늘 이 갈래의 전용 카드이고,
   * 다른 갈래의 전용 카드는 이번 판에 아예 안 나온다(슬레이 더 스파이어식 직업 카드).
   */
  private lineage: Lineage | null = null;
  private eraReward = false; // 지금 드래프트가 "시대 보상"(다음 시대 진입 직전 강화 카드)인가
  private bossQueue: BossType[] = []; // 한 런의 보스들(서로 다른 종류)
  private extinctionQueue: ExtinctionType[] = []; // 한 런의 대멸종 종류들 — 미리 정해 예고 가능(보스와 대칭)

  /** 시대(era) — 승리 후 "다음 시대로" 이어갈 때마다 +1. 0=첫 시대(난이도 배율 1.0=기존과 동일). */
  era = 0;
  /** 시드 원본(era 접미사 붙이기 전) — 다음 시대는 이 시드에서 새 맵·새 위협 순서를 파생(결정론). */
  private baseSeed = "lobby";
  /** 내 종 시작 색(프리셋에서 정함) — 다음 시대에 새 월드를 만들어도 같은 색을 유지한다. */
  private playerColor: number | undefined;
  /** 「거인」을 고른 런은 시대를 넘어 새 월드를 만들어도 몸집을 유지한다(게놈이 유지되므로 외형도 유지). */

  /** 메타 언락 기준(플레이어 레벨) — 런 시작 시 저장본의 누적 경험치에서 레벨을 읽어 프리셋·카드 풀을 거른다.
   * 런을 거듭해 경험치가 쌓일수록 레벨이 올라 더 많이 열린다. 런 도중엔 안 바뀐다(디버그 제외). */
  private metaLvl = 1;
  /** 이 사람이 한 번이라도 정복했는가 — 은근한 보정의 재료(한 번도 못 이긴 사람만 아주 조금 돕는다). */
  private everConquered = false;
  /** 이 사람이 끝낸 런 수 — 런을 거듭할수록 보정을 줄인다(실력이 붙으면 손을 뗀다). */
  private runsCompletedNow = 0;
  /** 연달아 「내 방향 카드가 하나도 안 뜬」 드래프트 수. 은근한 보정이 이 값을 읽는다. */
  private dryDrafts = 0;
  /**
   * **은근한 보정을 켤 것인가.** 프로브·밸런스 측정에서는 반드시 끈다 — 보정을 켠 채로 재면
   * **측정한 난이도가 실제 난이도가 아니다.** (`?noassist` 로도 끌 수 있다.)
   */
  assistEnabled = true;
  /** 이번 런에서 "다시 뽑기"(리롤)가 열려 있는가 — 메타 레벨이 리롤 티어 이상이면 true(런 시작 시 고정). */
  private metaRerollUnlocked = false;
  /** 현재 드래프트에서 남은 리롤 횟수(드래프트가 열릴 때 리셋). 프리셋 선택엔 리롤 없음. */
  private rerollsLeft = 0;

  /** 비동기 생물(S2) — 이 런의 세계에 등장시킬 지난 챔피언들. 런 시작 시 저장본에서 읽어 makeWorld 로 넘긴다. */
  private champions: Champion[] = [];

  /** 저장본의 **끝낸 런 수** — 온보딩 진도의 재료(진도 = 끝낸 런 수 + 시대). 런 시작 시 읽어 고정한다.
   * localStorage 가 없는 곳(테스트·프로브)에서는 늘 0 이라 "처음 하는 사람"의 세계가 된다. */
  private runsDone = 0;

  // 레벨업(형질 성장) — 시간/단계 전환이 아니라 "먹이 경험치"로 레벨을 올려 형질을 얻는다.
  // 레벨 = 세대: 레벨업해서 고른 형질은 그 뒤로 태어난 개체에게만 물려진다(세대별 적용 — 후속 슬라이스).
  level = 1; // 시작 프리셋 = 1레벨
  xp = 0; // 현재 레벨에서 쌓은 경험치(먹은 먹이 수)
  xpToNext: number = GAME.xpBase; // 다음 레벨까지 필요한 경험치(GAME.xpBase 는 리터럴이라 number 명시)
  private lastFoodEaten = 0; // world.playerFoodEaten 직전 값(매 update 의 delta 를 xp 로 누적)
  private lastHuntKills = 0; // world.playerHuntKills 직전 값(사냥 경험치의 delta 원천)

  // ── 방울(유전자 점수) ────────────────────────────────────────────────────────────
  /**
   * 아직 안 쓴 방울. **런 전체를 따라간다** · 시대를 넘어도 지갑은 안 비운다(새 런에서만 0).
   * 세계가 바뀌는 것과 내가 모은 것이 사라지는 것은 다른 이야기다.
   */
  private geneBankValue = 0;
  /**
   * `world.geneCollected` 직전 값 · 매 스텝 delta 를 지갑에 옮긴다.
   *
   * ⚠ **새 World 를 만드는 모든 자리에서 0 으로 되돌려야 한다**(누계가 0 부터 다시 세므로).
   *   `lastFoodEaten`/`lastHuntKills` 와 **언제나 같은 줄에 붙여 둔다** · 오늘(2026-08-07)
   *   `lastHuntKills` 가 continueToNextEra 에서 빠져 시대마다 경험치가 크게 깎이는 버그가 있었다.
   */
  private lastGeneCollected = 0;
  /**
   * 「위기 회복」 판정의 상태(가라앉았는가 · 지금까지의 최고). 규칙은 `sim/gene.ts` 의
   * `stepCrisisWatch` 하나가 정하고 여기서는 상태만 들고 있는다.
   *
   * ⚠ **시대를 넘을 때마다 새로 만든다**(`continueToNextEra`). 개체 수 문턱 사다리가 읽는
   *   `peakPopulation` 과는 결이 다르다: 그쪽은 「한 눈금은 런에 한 번만」이라 런 전체를 관통해야 하고,
   *   이쪽은 「무리가 무너졌다 돌아왔는가」라 **세계가 바뀌면 다시 재야 한다.** 이어서 재면 옛 시대의
   *   큰 최고 기록 때문에 새 세계의 시작 무리가 늘 「가라앉은 상태」로 출발해, 무너진 적이 없는데도
   *   다시 자라기만 하면 「위기 회복」이 성립한다(2026-08-08 감사에서 실제 발화를 확인하고 고쳤다).
   */
  private crisisWatch: CrisisWatch = createCrisisWatch();

  // 런 보고서(연대기 + 형질 추이) — 이 혈통의 일생을 game 층에서만 기록한다(world/sim rng 미소비 →
  // 결정론·밸런스 무관). 시대를 넘어가도 이어서 누적하고, 새 런(setupRun)에서만 비운다.
  private runSamples: RunSample[] = [];
  private runEvents: RunEvent[] = [];
  private runSteps = 0; // 런 전체 누적 스텝(시대 넘어가도 이어짐) → 경과 초 = runSteps / stepsPerSecond

  /**
   * **판 분석 코드가 읽는 기계용 기록**(`runCode.ts`). 연대기(`runEvents`)와 **겹치지 않는 것만** 담는다:
   * 드래프트 후보 **전부** · 리롤로 버린 후보 · 시험 판정의 수치 · 구입 비용. 연대기는 사람이 읽는
   * 한 줄이라 문구가 언제든 바뀌고, 그걸 되파싱해서는 위 것들을 복원할 수 없다(애초에 안 적혀 있다).
   *
   * 반대로 **관측 쪽은 새로 세지 않는다** — 개체 수 곡선은 `runSamples`, 사망 원인은 `world.deaths`,
   * 최종 티어·열쇠는 `genome` 을 그대로 읽는다(`runCodeData`). 같은 것을 두 곳에서 세면 조용히 갈라진다.
   *
   * ⚠ 전부 정수·배열 기록뿐이다 · rng 를 한 번도 안 쓴다(밸런스 불변).
   */
  private runLog: RunLogEntry[] = [];
  /** 이 런에서 **주운** 방울 누계(수입). 지갑(geneBankValue)은 쓴 뒤의 잔액이라 수지가 안 보인다. */
  private geneEarnedTotal = 0;
  /** 이 런에서 티어를 사는 데 **쓴** 방울 누계(지출). */
  private geneSpentTotal = 0;
  /** 지금 단계에 걸린 위협 · 분석 기록이 "무엇과 싸웠나"를 적는 데 쓴다(`clearStageState` 가 world.boss 를
   *  지운 뒤에도 남아야 해서 따로 들고 있는다). 채집 라운드면 null. */
  private stageThreat: BossType | ExtinctionType | null = null;

  /** 디버그용 고정 시드(URL ?seed=). null 이면 런마다 랜덤(맵·카드·보스가 매번 다름). */
  fixedSeed: string | null = null;
  /** 이번 런/로비의 시드. 맵·드래프트·보스가 모두 여기서 파생 → 같은 시드면 완전 재현. */
  private currentSeed = "lobby";

  /**
   * 이번 런의 세계 종류. 런 시작에 **전용 rng 로 한 번** 뽑고 시대가 바뀌어도 유지한다 — 한 혈통은
   * 한 세계에서 산다. 시대마다 세계가 바뀌면 이미 정한 빌드(바다 종 등)가 갈 곳을 잃어 손쓸 수 없이 진다.
   * 로비 기본값은 "대륙"(배경 맵) — 기존 밸런스 기준선.
   */
  private currentMapType: MapType = "continent";
  private draftRng: Rng;
  private stageRng: Rng;
  // 대멸종 종류 전용 독립 스트림. stageRng(보스 순서)를 1비트도 안 건드려, 기존 보스 순서·시드 재현이
  // 그대로 보존된다(known_issues "독립 rng" 패턴 — 소비 순서만 분리, 대멸종 종류만 여기서 결정).
  private extRng: Rng;
  private acc = 0;
  private ambientAcc = 0;

  /**
   * 방금 고른 카드로 **막 오른 티어들**. `takeNewTiers()` 로 꺼내 가면 비워진다.
   *
   * 훅(onTier)이 아니라 "꺼내 가는 큐"인 이유: 훅은 `pickCard` 안에서 **동기로** 불려 드래프트 화면이
   * 아직 떠 있는 순간에 연출이 터진다(카드 뒤에 가려 안 보인다). main 은 `draft.hide()` 뒤에 꺼내
   * 연출을 띄운다 — 순서를 부르는 쪽이 쥐게 한다.
   */
  private newTiers: { cat: Category; tier: number }[] = [];

  /** 막 오른 티어를 꺼내 간다(꺼내면 비워진다). 화면이 승급 연출을 띄우는 데 쓴다. */
  takeNewTiers(): { cat: Category; tier: number }[] {
    const out = this.newTiers;
    this.newTiers = [];
    return out;
  }

  /**
   * 불씨 회복 카드를 이 런에서 이미 한 번 썼는가.
   * **[사용자 2026-08-06]** 첫 한 번은 확정으로 뜨고, 그 뒤로는 확률이다 — 첫 한 번이 "이 규칙이
   * 존재한다"를 가르치고(대백과가 아니라 화면 안에서), 그 뒤로는 긴장이 남는다.
   */
  private emberCardUsed = false;

  // main 이 설정하는 훅
  onDraft: ((cards: Card[], preview: string) => void) | null = null;
  /** 라운드 시험 판정 알림(합·불 모두) · main 이 플래시로 배선한다. */
  onTrialVerdict: ((v: TrialVerdict) => void) | null = null;
  // canContinue = 승리라서 "다음 시대로" 이어갈 수 있는가(패배는 false). progress = 런이 진짜 끝났을 때(멸종·정복)의
  // 메타 진척도(경험치·레벨업·레벨별 해금) — 종료 화면 애니메이션용. 이어가는 중간 시대 승리면 null.
  onResult:
    | ((
        result: RunResult,
        summary: string,
        canContinue: boolean,
        progress: RunProgress | null,
        achievements: Achievement[],
      ) => void)
    | null = null;
  onWorldChanged: ((world: World) => void) | null = null;

  constructor(baseW: number, baseH: number, fixedMapScale?: number) {
    this.baseW = baseW;
    this.baseH = baseH;
    this.fixedMapScale = fixedMapScale;
    this.genome = defaultGenome();
    this.draftRng = new Rng("draft-0");
    this.stageRng = new Rng("stage-0");
    this.extRng = new Rng("ext-0");
    this.currentSeed = randomSeed(); // 로비 배경 맵도 매번 다르게
    this.reloadMeta();
    this.champions = loadChampions();
    this.world = this.makeWorld();
  }

  /** 이번 런/로비의 시드(재현용으로 복사 가능). */
  get seed(): string {
    return this.currentSeed;
  }

  /** 부트 시 1회 — 로비 화면. 배경 월드만 보여준다. */
  start(): void {
    this.phase = "lobby";
    this.onWorldChanged?.(this.world);
  }

  /** "게임 시작"/"새 런" — 실제 런 시작(시작 식성 선택부터). */
  beginRun(): void {
    this.paused = false;
    this.setupRun();
    this.onWorldChanged?.(this.world);
    this.onDraft?.(this.draftCards, this.preview);
  }

  /** 멈춤 메뉴 "로비로" — 런을 버리고 로비로 돌아간다. */
  toLobby(): void {
    this.paused = false;
    this.result = null;
    this.currentSeed = randomSeed();
    this.era = 0;
    this.genome = defaultGenome();
    this.world = this.makeWorld();
    this.phase = "lobby";
    this.onWorldChanged?.(this.world);
  }

  pickCard(index: number): void {
    if (this.phase !== "draft") return;
    const card = this.draftCards[index];
    // 분석 기록 — **고르기 전에** 적는다. 아래에서 eraReward·firstChoice 가 꺼지므로 이 자리가 지나면
    // 이 드래프트가 어떤 자리에서 열린 것이었는지 알 길이 없어진다.
    this.recordDraft(card ? index : DRAFT_NONE);
    // **티어가 오르는 순간**을 잡으려면 적용 전 티어를 떠 둬야 한다. 티어 승급은 수치가 커지는 게 아니라
    // 규칙이 통째로 켜지는 사건이라, 그 자리에서 알려 주지 않으면 화면에서 영영 안 읽힌다.
    // ⚠ 시작 프리셋(firstChoice)은 큐에 **안 넣는다** — 시작 상태는 승급 사건이 아니다. 게다가 프리셋
    // 화면(presetPanel)은 이 큐를 안 꺼내 가서, 넣으면 알림이 첫 레벨업까지 새었다가 그때 몰아서 터진다
    // (2026-08-07 실기 제보: 잡식 프리셋의 이빨·눈 승급이 다리 카드의 알림과 함께 3개로 보였다).
    const beforeTiers = this.firstChoice ? null : tiersOf(this.genome.pips);
    if (card) {
      if (card.ember) {
        // 불씨 회복 카드 — 도장은 0. 「이번엔 자라지 않습니다」가 카드에 그대로 적혀 있다.
        this.embers = Math.min(GAME.emberMax, this.embers + card.ember);
        this.emberCardUsed = true;
      } else {
        applyCard(this.genome, card);
      }
      this.pickedCardNames.push(card.name);
      this.pickedCardIds.push(card.id);
      if (beforeTiers) {
        const afterTiers = tiersOf(this.genome.pips);
        for (const cat of CATEGORIES) {
          if (afterTiers[cat] > beforeTiers[cat]) this.newTiers.push({ cat, tier: afterTiers[cat] });
        }
      }
    }
    if (this.eraReward) {
      // 시대 보상을 골랐다 — 갓 태어난 이 시대 무리에 즉시 반영하고(성장 이어짐) 첫 채집 단계로.
      this.eraReward = false;
      for (const e of this.world.entities) {
        if (e.species.isPlayer) e.genome = cloneGenome(this.world.genome);
      }
      if (card) this.logEvent("card", `시대 보상 · ${card.name}`);
      this.beginStage();
      return;
    }
    if (this.firstChoice) {
      // 시작 프리셋을 골랐으니 곧장 첫 채집 단계로.
      this.firstChoice = false;
      // **이 런의 갈래(계통)가 여기서 정해진다.** 앞으로 드래프트 3장 중 1장은 늘 이 갈래의 전용
      // 카드다(공통 풀 + 내 갈래 풀). 다른 갈래의 전용 카드는 이번 판에 영영 안 보인다.
      this.lineage = card ? (PRESET_LINEAGE[card.id] ?? null) : null;
      // 프리셋이 정한 시작 색으로 내 종을 물들인다(종마다 뚜렷이 달라 외형만으로 구분).
      // 다음 시대에 새 월드를 만들어도 같은 색을 유지하도록 저장해 둔다.
      if (card && card.color !== undefined) {
        this.world.playerSpecies.color = card.color;
        this.playerColor = card.color;
      }
      // 프리셋은 "시작 형질"이라 이미 태어난 초기 무리에도 반영한다(세대별 스냅샷은 레벨업부터).
      for (const e of this.world.entities) {
        if (e.species.isPlayer) e.genome = cloneGenome(this.world.genome);
      }
      // 보고서: 이 혈통의 출발점(어떤 종으로 시작했나) + 시작 시점 형질 샘플(t0).
      this.logEvent("start", card ? card.name : "새 혈통");
      this.sampleRun();
      this.beginStage();
    } else {
      // 레벨업 드래프트(개체별 진화) — 카드는 종 기준선(위에서 적용)뿐 아니라 "살아있는 무리 전체"에도 같은
      // 델타로 적용한다. 플레이어가 무리 전체의 방향을 쥐고(카드), 개체차(부모에서 받은 변이)는 보존한 채
      // 다 같이 그 방향으로 이동한다. 이후 새끼는 부모를 닮아 조금씩 갈리며 환경에 맞는 쪽이 살아남는다.
      if (card) {
        // **티어는 종 단위 성취다.** 카드는 무리 전체에 같은 도장을 찍고, 그러면 모두가 같은 티어가 된다
        // (도장은 정수라 개체마다 갈릴 여지가 없다 — 예전에 정점이 개체마다 갈려 "화면은 정점이라 외치는데
        // 무리는 못 누리는" 사고가 있었는데, 그 자리가 구조적으로 사라졌다). 개체차는 티어 안의 파생 능치
        // 흔들림으로만 남는다(`mutateGenome`).
        for (const e of this.world.entities) {
          if (e.species.isPlayer && e.alive) applyCard(e.genome, card);
        }
        this.logEvent("card", `레벨 ${this.level} · ${card.name}`);
      }
      this.afterDraftPick();
    }
  }

  /**
   * 레벨업 드래프트를 하나 처리한 뒤 어디로 갈지 정한다.
   * 라운드 경계에서 열린 드래프트면 남은 카드를 마저 고르고 다음 단계로, 아니면 관전 복귀.
   * (지금은 레벨업 카드가 전부 경계에서 열리므로 관전 복귀 갈래는 프리셋 이후엔 거의 안 쓰인다.)
   */
  private afterDraftPick(): void {
    if (this.boundaryDraft) {
      if (this.openPendingDraft()) return; // 한 라운드에 두 번 올랐다: 다음 장을 이어서
      this.boundaryDraft = false;
      this.beginStage();
      return;
    }
    // 진행 중이던 단계로 복귀(단계 타이머·보스 상태는 그대로 보존).
    this.phase = "watch";
    this.acc = 0;
  }

  /** 레벨업 드래프트를 스킵 — 3장이 다 별로면 형질 대신 소소한 보상(새끼 몇 마리)을 받고 관전으로 복귀한다.
   * 시작 프리셋 선택(firstChoice)은 스킵 불가(반드시 한 종으로 시작). */
  skipDraft(): void {
    if (this.phase !== "draft" || this.firstChoice) return;
    this.recordDraft(DRAFT_SKIPPED); // 안 고른 것도 선택이다 · 후보 세 장과 함께 남긴다
    this.world.spawnPlayerBrood(SIM.draftSkipBrood);
    this.skipBroodTotal += SIM.draftSkipBrood; // pop 시험 진행도에서 빼는 계수(스킵이 곧 합격이 되지 않게)
    this.pickedCardNames.push("건너뜀");
    this.logEvent("card", `레벨 ${this.level} · 건너뜀(새끼)`);
    if (this.eraReward) {
      // 시대 보상을 건너뛰면 형질 대신 새끼로 받고 새 시대 첫 단계로(관전으로 복귀가 아님).
      this.eraReward = false;
      this.beginStage();
      return;
    }
    this.afterDraftPick();
  }

  /**
   * 입력 층이 매 프레임 부르는 조종 명령 세터. 관전 중·멈춤 아님일 때만 sim 에 닿는다.
   * 드래프트·결과 화면에서 손가락이나 키가 눌린 채로 넘어가도 알파가 계속 달리지 않는다.
   *
   * ⚠ 알파 조종은 **더 이상 쓰지 않는다**(2026-08-04, 무리 지시로 전환). sim 의 능력은 남겨 두되
   * main 이 이 세터를 안 부르므로 실제 게임에서는 한 번도 안 걸린다. 제거는 무리 지시가 폰에서
   * 판정을 통과한 뒤에(backlog).
   */
  setLeadCommand(cmd: LeadCommand | null): void {
    this.world.lead.cmd =
      this.leadEnabled && this.phase === "watch" && !this.paused ? cmd : null;
  }

  /**
   * 무리에게 뜻을 내린다(신탁). 월드 좌표 한 점 + 무엇을 하라는 것인가.
   * 관전 중·멈춤 아님일 때만 닿는다 · 드래프트·결과 화면의 탭이 무리를 움직이지 않게.
   *
   * **[사용자 2026-08-06]** 조작 다양화. 「가라」(이동)에는 **쿨타임을 안 건다** — 기본 조작이 막히면
   * 조종 감각 자체가 죽는다. 특수 명령에만 걸고, 회피는 기력도 함께 쓴다.
   * 잠긴 칸은 여기서 막는다(화면에서도 회색으로 보이지만, 규칙은 한 곳에서만 판정한다).
   */
  setHerdOrder(x: number, y: number, kind: OrderKind = "move"): boolean {
    if (this.phase !== "watch" || this.paused) return false;
    // ⚠ 여기 있던 `if (world.leadVacuum > 0) return false`(지휘 공백)를 2026-08-10 에 걷었다 ·
    //   **[사용자]** 「이끌던 개체 어쩌고 아예 없애줘」. 알파가 쓰러져도 명령은 계속 통한다.
    const spec = ORDER_SPEC_BY_KIND.get(kind);
    if (!spec) return false;
    if (!orderUnlocked(spec, this.genome.pips)) return false;
    if ((this.orderCd.get(kind) ?? 0) > 0) return false;
    if (spec.cooldown > 0) this.orderCd.set(kind, spec.cooldown);
    if (spec.energy > 0) {
      // 회피처럼 몸을 쥐어짜는 명령은 무리의 기력을 쓴다 · **목소리가 닿는 개체만**.
      // ⚠ 2026-08-09 까지 이 주석은 "목소리가 닿는 개체만"이라 적혀 있었는데 **코드에 그 조건이
      //   없었다** · 「피해라」 한 번에 살아 있는 내 종 **전부**가 기력 −8 을 물었다(목소리 밖에서
      //   명령을 듣지도 못한 개체까지). 판정을 sim 과 **같은 함수**(world.hearsOrder)로 옮겨,
      //   「기력을 내는 개체」와 「실제로 달아나는 개체」가 정의상 같은 집합이 되게 한다.
      for (const e of this.world.entities) {
        if (!e.species.isPlayer || !e.alive) continue;
        if (!this.world.hearsOrder(e.x, e.y)) continue;
        e.energy = Math.max(1, e.energy - spec.energy);
      }
    }
    const ticks = spec.kind === "move" ? 0 : Math.round(SIM.stepsPerSecond * 4);
    // **탭 자리는 정수 픽셀로 접는다.** 손가락이 찍는 자리에 소수점은 뜻이 없고(해제 반경이 64px 다),
    // 대신 이 한 줄이 **판을 정확히 재현 가능하게** 만든다: 판 분석 코드는 좌표를 정수로 담으므로,
    // 게임이 소수점을 쓰면 되살린 판이 원판과 미세하게 다른 곳을 향하고 그 차이가 480틱 동안
    // 눈덩이처럼 커진다(2026-08-09 · 자가 검사에서 실제로 그랬다 · 단계 1부터 갈렸다).
    // 「기록된 값이 곧 게임이 쓴 값」이라야 재현이 성립한다.
    const ox = Math.round(x);
    const oy = Math.round(y);
    this.world.herdOrder = { x: ox, y: oy, kind, ticks };
    // 판 분석 코드에 남긴다 — **재현의 마지막 조각**이다(2026-08-09). 거절된 탭은 세계를 1비트도
    // 안 바꾸므로 안 담는다 · 여기까지 온 것만이 실제로 일어난 명령이다.
    // ⚠ 기록은 rng 를 안 쓰고 세계를 안 건드린다(runCode.ts 의 제약과 같은 계열).
    this.runLog.push({ t: "order", stage: this.stageOrdinal, tick: this.stageTick, x: ox, y: oy, kind });
    return true;
  }

  /** 내려 둔 뜻을 거둔다(무리는 그 자리에서 자율로 산다). 화면의 「현재 명령 한 줄」을 탭하면 여기로 온다. */
  clearHerdOrder(): void {
    this.world.herdOrder = null;
  }

  /**
   * **방금 접수한 명령을 없던 일로 한다** — 세계의 뜻을 되돌리고 **기록에서도 지운다**.
   *
   * 더블탭이 거절될 때 첫 탭의 「가라」를 걷는 자리가 이걸 쓴다(main 의 `undoTapOrder`).
   * ⚠ 예전에는 main 이 `world.herdOrder` 를 직접 되돌렸는데, 그러면 **세계는 원상복구되는데
   *   판 분석 코드에는 그 탭이 남았다.** 되살릴 때 재현은 취소된 명령을 그대로 다시 내리고,
   *   그 한 번으로 판이 갈라진다(2026-08-09 · 사용자 판 재생이 단계 1부터 어긋난 원인).
   *   되돌리기는 새 명령이 아니라 **없던 일로 하는 것**이라, 세계와 기록이 같이 움직여야 한다.
   *
   * `back` 이 null 이면 명령을 거두고, 아니면 그 뜻으로 되돌린다.
   */
  undoHerdOrder(back: HerdOrder | null): void {
    this.world.herdOrder = back;
    for (let i = this.runLog.length - 1; i >= 0; i -= 1) {
      const e = this.runLog[i];
      if (e === undefined) continue;
      if (e.t === "order") {
        this.runLog.splice(i, 1);
        return;
      }
      // 명령보다 나중에 적힌 것(단계 결과·구입 등)이 있으면 그건 「방금」이 아니다 · 손대지 않는다.
      break;
    }
  }

  /**
   * **방울 구입 화면을 연다 = 시간이 멈춘다.**
   *
   * **[사용자 2026-08-09]** "방울 업그레이드 고르는 중에는 시간이 안 멈추나? 그거 보다보니
   * 멸종해버렸는데". 무엇을 살지 읽는 동안 무리가 죽고 있었다.
   *
   * 멈추는 장치는 **드래프트가 쓰는 것과 같다**(`phase`) · `update()` 가 `watch` 가 아니면 곧장
   * 되돌아가므로, 여기서 단계를 바꾸는 것만으로 틱·타이머·보스·시험이 전부 그 자리에 선다.
   * 새 플래그를 따로 두면 "저기서도 봐야 하는데 안 봤다"가 생겨 한쪽만 안 멈추는 화면이 다시 난다.
   *
   * 관전 중일 때만 열린다(드래프트·결과·로비에서 열리면 그 화면들의 복귀 자리가 헝클어진다).
   */
  openGeneShop(): boolean {
    if (this.phase !== "watch") return false;
    this.phase = "shop";
    return true;
  }

  /**
   * 구입 화면을 닫는다. **진행 중이던 단계로 정확히 돌아간다.**
   *
   * ⚠ 여기서 `beginStage`·타이머 초기화 같은 것을 하지 않는다. 단계 상태(`stageTicksLeft`·보스·
   *   시험·`stageIndex`)는 멈춰 있는 동안 아무도 안 건드렸으므로 그대로가 곧 정답이다
   *   (2026-08-07 「유령 드래프트 멈춤」과 같은 자리라, 복귀를 새로 계산하면 그 사고가 재현된다).
   *
   * ⚠ **`acc`(프레임 잔여 시간)를 0 으로 밀지 않는다.** 멈춘 동안 `update()` 가 곧장 되돌아가
   *   `acc` 에 아무것도 안 쌓였으므로 밀 것이 없고, 밀면 열기 전의 잔여 몫이 사라져 **틱 하나가
   *   어긋난다**. 그러면 "열었다 닫은 판"과 "안 연 판"의 지문이 달라진다(결정론 위반).
   *
   * 단계가 `shop` 이 아니면 아무 일도 안 한다 · 런 종료·시대 전환처럼 게임이 단계를 이미 바꾼
   * 자리에서 화면이 뒤늦게 닫혀도 그 단계를 덮어쓰지 않게 한다.
   */
  closeGeneShop(): void {
    if (this.phase !== "shop") return;
    this.phase = "watch";
  }

  /** 지금 내려져 있는 뜻(화면에 표식을 그리는 데 쓴다). */
  get herdOrder(): HerdOrder | null {
    return this.world.herdOrder;
  }

  /**
   * **명령 휠의 여덟 칸** — 지금 무엇이 열려 있고 무엇이 잠겨 있는가.
   * 못 여는 칸은 회색으로 보인다 → 다음 판의 동기가 되고, **성장이 숫자가 아니라 손에서 읽힌다.**
   */
  orderWheel(): { spec: OrderSpec; unlocked: boolean; cdLeft: number }[] {
    return ORDER_SPECS.map((spec) => ({
      spec,
      unlocked: orderUnlocked(spec, this.genome.pips),
      cdLeft: this.orderCd.get(spec.kind) ?? 0,
    }));
  }

  /** 지휘 공백이 남아 있는 초 — 이 동안은 아무도 명령을 안 듣는다(화면이 그 사실과 되돌리는 법을
   *  알린다 · main 의 issueOrder). 0 이면 정상. */
  get leadVacuumSeconds(): number {
    return this.world.leadVacuum / SIM.stepsPerSecond;
  }

  /**
   * **지휘봉을 넘긴다** — **[사용자 2026-08-06]** 알파는 특별한 개체가 아니라 옮길 수 있는 자리다
   * (늑대 무리의 우두머리가 혈통이 아니라 지위인 것과 같다). 아무 개체나 탭하면 그 애가 알파가 된다.
   * 진화 게임에서 특정 개체만 유전적으로 특별한 것은 말이 안 되므로, 알파에게 능력을 주지 않는다.
   */
  passBaton(entityId: number): boolean {
    if (this.phase !== "watch" || this.paused) return false;
    const e = this.world.entities.find((x) => x.id === entityId && x.alive && x.species.isPlayer);
    if (!e) return false;
    this.world.lead.leaderId = e.id;
    this.world.lead.x = e.x;
    this.world.lead.y = e.y;
    this.world.lead.changedTick = this.world.tick;
    this.world.leadVacuum = 0; // 사람이 직접 넘긴 것은 공백이 아니다
    return true;
  }

  /** 명령별 남은 쿨타임(틱). 매 update 에서 줄인다. */
  private readonly orderCd = new Map<OrderKind, number>();

  /**
   * 명령 쿨타임과 특수 명령의 지속 시간을 줄인다. **배속을 그대로 곱한다** — 2배속에서 쿨타임이
   * 두 배로 길게 느껴지면 배속이 조작을 벌하는 것이 되고, 그건 플레이어가 배속을 안 쓰게 만든다.
   */
  private tickOrders(deltaMS: number): void {
    const ticks = (deltaMS / 1000) * SIM.stepsPerSecond * this.speed;
    for (const [k, v] of this.orderCd) {
      const left = v - ticks;
      if (left <= 0) this.orderCd.delete(k);
      else this.orderCd.set(k, left);
    }
    const o = this.world.herdOrder;
    if (o && o.ticks !== undefined && o.ticks > 0) {
      const left = o.ticks - ticks;
      // 특수 명령은 몇 초짜리다("피해라"가 영원히 유지되면 그건 명령이 아니라 상태다).
      if (left <= 0) this.world.herdOrder = null;
      else this.world.herdOrder = { ...o, ticks: left };
    }
  }

  /**
   * 무리 티어에서 나오는 지휘 값 둘을 sim 에 넣어 준다 — **sim 은 티어를 모른다**(받은 숫자만 쓴다).
   * 세계를 새로 만들거나 도장이 바뀌는 모든 입구에서 부른다.
   */
  private syncCommandReach(): void {
    this.world.voiceR = voiceRadius(this.genome.pips, this.genome.keys);
    this.world.vacuumOnLeadDeath = vacuumTicks(this.genome.pips);
  }

  update(deltaMS: number): void {
    if (this.paused) return;
    const stepMs = 1000 / SIM.stepsPerSecond;

    // 로비: 배경 월드를 잔잔히(1x) 돌려 생동감만 준다.
    if (this.phase === "lobby") {
      this.ambientAcc += deltaMS;
      let g = 0;
      while (this.ambientAcc >= stepMs && g < 5) {
        this.world.step();
        this.ambientAcc -= stepMs;
        g += 1;
      }
      if (this.ambientAcc > stepMs) this.ambientAcc = 0;
      return;
    }

    if (this.phase !== "watch") return;
    // **알파(지휘봉)를 세운다.** 2026-08-04 에 무리 지시로 전환하면서 이 개념을 뺐는데,
    // **[사용자 2026-08-06]** 이 다시 세웠다: 알파는 특별한 개체가 아니라 **옮길 수 있는 자리**이고,
    // 명령은 그 자리에서 나가 목소리가 닿는 데까지만 간다. 카메라도 이 개체를 따라간다.
    // (멱등이라 매 프레임 불러도 안전하다 · rng 미사용.)
    this.world.armLead();
    // 명령 쿨타임·지속 시간을 여기 한 자리에서만 줄인다(정수 카운터 · rng 미사용 → 스트림 불변).
    this.tickOrders(deltaMS);
    this.acc += deltaMS;
    let guard = 0;
    while (this.acc >= stepMs && guard < 5) {
      this.acc -= stepMs;
      guard += 1;
      // 배속만큼 한 번에 여러 스텝 진행.
      for (let s = 0; s < this.speed; s++) {
        this.world.step();
        // ── 매 틱 보는 방울 사건 둘(개체 수 문턱 · 위기 회복) ──────────────────────────────
        // 둘 다 **최고 기록**을 기준으로 삼는다. 지금 개체 수로 재면 문턱 언저리를 오르내릴 때마다
        // 방울이 쏟아진다(최고 기록은 단조 증가라 눈금 하나를 한 런에 한 번만 지난다).
        const pop = this.world.playerPopulation;
        if (pop > this.peakPopulation) {
          const crossed = milestonesCrossed(this.peakPopulation, pop);
          this.peakPopulation = pop;
          // 한 틱에 여러 눈금을 건너뛰었으면(대량 번식) 그만큼 떨어진다 · 화면에 적힌 눈금은 다 준다.
          if (crossed > 0) this.awardGenes("milestone", crossed);
        }
        // 위기 회복 · 최고의 절반 아래로 가라앉았다 90% 위로 돌아온 순간 딱 한 번.
        // 최고가 아직 작을 때(판 시작 직후의 자연스러운 출렁임)는 사건으로 안 친다 · 근거는
        // `GAME.geneCrisisMinPeak` 주석(econ 프로브가 쓴 것과 같은 문턱).
        if (stepCrisisWatch(this.crisisWatch, pop) && this.crisisWatch.peak >= GAME.geneCrisisMinPeak) {
          this.awardGenes("recovery");
        }
        // 주운 방울을 지갑으로 옮긴다. **step 바로 뒤에서** 한다 · 아래 finishStage 갈래들이 return
        // 으로 프레임을 빠져나가고, 시대 전환은 World 를 통째로 갈아 끼워 누계를 0 으로 되돌리므로,
        // update 끝에서 모으면 마지막 몇 틱에 주운 방울이 그대로 증발한다.
        this.harvestGenes();
        this.stageTicksLeft -= 1;
        this.stageTick += 1; // 명령 기록의 시각(단계 안에서의 경과)
        this.runSteps += 1;
        // 런 보고서 시계열 — 일정 주기로 개체 수·형질 평균을 남긴다(연대기 그래프의 점들).
        if (this.runSteps % REPORT_SAMPLE_STEPS === 0) this.sampleRun();
        if (this.world.playerPopulation === 0) {
          this.finishStage(false);
          return;
        }
        // **보스 격퇴(레이드)** — 무리가 카운터 형질로 격퇴 체력을 다 깎았다. 시간을 안 기다리고 즉시
        // 통과한다("직접 잡아야 사라진다" — 사용자 방향). 레이드가 안 켜진 보스(era 0·전역 시련·2단계
        // 미도입 카운터)는 maxHp 0 이라 여기 안 걸린다(기존 버티기 게이트로).
        const boss = this.world.boss;
        if (boss !== null && boss.maxHp > 0 && boss.hp <= 0) {
          this.finishStage(true, true);
          return;
        }
        if (this.stageTicksLeft <= 0) {
          this.finishStage(true);
          return;
        }
      }
    }
    if (this.acc > stepMs) this.acc = 0;
    // 이번 update 에서 내 종이 먹은 먹이만큼 경험치를 쌓고, 임계를 넘으면 레벨업 드래프트를 띄운다.
    this.updateXp();
  }

  /**
   * 먹이 섭취 · **사냥** delta 를 경험치로 누적하고, 임계 도달 시 레벨업(도장 드래프트)한다.
   *
   * **[사용자 2026-08-06]** 사냥에도 경험치를 준다. 예전엔 경험치가 「풀을 뜯었을 때」 한 곳에서만 올라서,
   * 이빨을 파면 풀 효율이 ×0.18 까지 떨어지는 육식 빌드가 **카드를 덜 받는 자살 버튼**이었다.
   * 사냥 한 번이 먹이 여섯 개 값이다 — 위험을 무릅쓴 만큼 크게. 쿨타임은 벌칙이 아니라 「배부름」이 낸다
   * (배가 부르면 안 사냥하므로 저절로 간격이 생기고, 그 사실이 기력 막대에 그대로 보인다).
   */
  private updateXp(): void {
    const eaten = this.world.playerFoodEaten;
    const hunted = this.world.playerHuntKills;
    let gain = eaten - this.lastFoodEaten + (hunted - this.lastHuntKills) * GAME.huntXp;
    this.lastFoodEaten = eaten;
    this.lastHuntKills = hunted;
    // 조종 모드에서만: 단계당 경험치 상한. 무리를 먹이에 붙이는 실력이 곧 카드 장 수가 되면
    // "카드가 결과를 좌우한다"는 명제가 뒤에서 무너진다(관전형의 '누가 해도 비슷한 곡선' 붕괴).
    if (this.leadEnabled) {
      const room = Math.max(0, GAME.leadStageXpCap - this.stageXp);
      if (gain > room) gain = room;
      this.stageXp += gain;
    }
    this.xp += gain;
    if (this.xp >= this.xpToNext) this.levelUp();
  }

  /**
   * 레벨업 · 레벨과 경험치만 올리고, **카드는 라운드가 끝난 뒤에 고르게 미룬다.**
   *
   * 예전엔 여기서 곧장 드래프트를 띄웠다. 그런데 실측하면 드래프트의 **100%가 라운드 도중**에 떴고
   * (프리셋 4시드, 단계당 0.8회), 16초짜리 시험을 보는 중에 전체 화면 카드창이 끼어들어 흐름이
   * 매번 끊겼다. 라운드 판정 루프가 생긴 뒤로는 라운드 경계가 이미 정지점이므로, 카드도 그 자리에서
   * 고르게 모아 준다: 판정 → 카드 → 다음 라운드.
   */
  private levelUp(): void {
    this.level += 1;
    this.xp -= this.xpToNext;
    if (this.xp < 0) this.xp = 0;
    this.xpToNext = GAME.xpBase + (this.level - 1) * GAME.xpPerLevel;
    this.pendingLevels += 1;
  }

  /**
   * 밀어 둔 레벨업 카드를 한 장 연다(라운드 경계에서만 부른다). 열었으면 true.
   * 한 라운드에 두 번 오른 경우에도 한 장씩 차례로 고르게 한다.
   */
  private openPendingDraft(): boolean {
    // 밀린 레벨을 하나씩 꺼내되, **줄 게 없는 레벨은 조용히 소진한다**(아래 가드) · 한 번에 하나만
    // 버리면 밀린 레벨이 계속 남아 단계마다 빈 드래프트를 다시 시도한다.
    while (this.pendingLevels > 0) {
      this.pendingLevels -= 1;
      this.boundaryDraft = true;
      this.phase = "draft";
      // 메타 언락: 열린 카드만 드래프트 풀에(잠긴 특화 카드는 런을 거듭해 해금).
      // 언락된 카드 중, 이 종에 이미 무의미한 카드(예: 이미 나는데 날개 카드)는 뺀다 · "손해 카드" 방지(폰 피드백).
      this.draftCards = this.drawDraft();
      // **줄 게 하나도 없으면 열지 않는다** (2026-08-09 [사용자] 제보: "모든 범주 만렙을 찍었더니
      // 업그레이드 드래프트 화면이 고장나버렸고, 건너뛰어 새끼 치기만 겨우 클릭이 가능했다").
      //
      // 화면이 깨진 게 아니라 **게임에 남은 내용이 없었던 것**이다. 후보가 0장인 드래프트가 그냥
      // 열려 "고장난 화면"으로 보였다.
      //
      // ⚠ **그때의 원인은 v9 에서 사라졌다.** v8 은 카드가 도장만 줬으므로 범주 다섯이 4단이고
      //   열쇠가 차면 풀 전체가 죽은 카드가 됐다. 지금 카드는 특성을 주므로 만렙과 후보 수는
      //   아무 관계가 없다(카드 재설계 · **[사용자 2026-08-08]**).
      //   그래도 가드는 남긴다 — 어떤 이유로든 후보가 빌 수 있고(특성을 전부 모은 종), 그때 빈
      //   화면을 띄우는 것보다 조용히 넘기는 편이 언제나 낫다(`emptyDraft.test.ts` 가 못박는다).
      if (this.draftCards.length === 0) {
        this.recordDraft(DRAFT_NONE); // 판 분석 코드에 "이 레벨업은 고를 게 없었다"가 남는다
        continue;
      }
      this.rerollsLeft = this.metaRerollUnlocked ? GAME.rerollsPerDraft : 0;
      this.preview = `레벨 ${this.level}! 새 형질을 하나 고르세요. (무리 전체에 퍼지고, 새끼는 부모를 닮아 조금씩 달라집니다)`;
      this.onDraft?.(this.draftCards, this.preview);
      return true;
    }
    // 밀린 레벨을 다 소진했는데 하나도 못 열었다 = 지금 이 종에게 줄 카드가 없다.
    this.phase = "watch";
    this.boundaryDraft = false;
    return false;
  }

  /**
   * 다시 뽑기(리롤) — 3장이 마음에 안 들면 형질 포기(스킵) 대신 카드를 새로 뽑는다. 여러 런을 마쳐야 열리는
   * 편의(meta.isRerollUnlocked). 드래프트당 GAME.rerollsPerDraft 회 제한(무한 낚시 방지). 프리셋 선택엔 없음.
   * 결정론: 시드 draftRng 로 다음 후보를 뽑는다(같은 플레이 → 같은 결과).
   *
   * ⚠ v8 에는 여기 「시대 보상이면 강화 사본으로」가 있었고, 그 배수를 고정값으로 쓰면 리롤이 조용한
   *   벌칙이 되는 결함이 있었다(2026-08-07 발견·수정). v9 에서 강화 자체가 사라져 **그 함정이 구조적으로
   *   없어졌다** — 리롤은 이제 어느 드래프트에서나 같은 일을 한다.
   */
  reroll(): void {
    if (this.phase !== "draft" || this.firstChoice || this.rerollsLeft <= 0) return;
    // 버리는 후보도 기록에 남긴다 — "무엇이 싫어서 다시 뽑았나"가 분석의 절반이다.
    this.recordDraft(DRAFT_REROLLED);
    this.rerollsLeft -= 1;
    this.rerollsUsed += 1;
    this.draftCards = this.drawDraft();
    this.onDraft?.(this.draftCards, this.preview);
  }

  /** UI 표시용 — 지금 드래프트에서 "다시 뽑기"를 누를 수 있는가(열려 있고 횟수 남음, 프리셋 아님). */
  get canReroll(): boolean {
    return this.phase === "draft" && !this.firstChoice && this.rerollsLeft > 0;
  }

  /**
   * 드래프트 3장을 뽑는다 — 레벨업·리롤·시대 보상이 **전부 이 하나를 부른다**(뽑기 규칙이 세 곳에
   * 흩어져 있으면 언젠가 한 곳만 바뀐다).
   *
   * 여기서 세 가지가 함께 걸린다:
   *  ① **불씨가 정확히 하나 남았으면 회복 카드가 낀다** — **[사용자 2026-08-06]** 첫 한 번은 확정,
   *     그 뒤로는 확률. 회복 카드는 도장이 0 이라 「이번엔 자라지 않습니다」가 카드에 그대로 적힌다.
   *  ② **내가 판 방향이 조금 더 자주 뜬다**(보장이 아니라 가중치) + 연속으로 안 뜨면 확률이 오른다.
   *  ③ **은근한 보정** — 아래 `draftBias()` 주석 참조.
   */
  private drawDraft(): Card[] {
    const cards = drawCards(
      this.draftRng,
      3,
      (c) =>
        cardAvailable(c.id, this.metaLvl) &&
        cardPrereqMet(c, this.genome) &&
        !cardRedundant(c, this.genome),
      this.level, // 레벨이 오를수록 높은 등급이 더 자주 뜬다(rarityWeightsAtLevel)
      this.pickedCounts(), // 이미 고른 카드는 뜸하게(반복 완화)
      this.draftBias(),
    );
    // 「내 방향이 하나도 안 뜬 드래프트」를 센다 — 연달아 그러면 다음 확률이 오른다(안전장치).
    // ⚠ 이건 **가중치**이지 보장이 아니다. 가끔 내 길이 하나도 안 나오는 드래프트가 생기고, 그때
    //   갈아탈지 버틸지가 진짜 질문이 된다(**[사용자 2026-08-06]** "로그라이크는 그 무작위성이 핵심 재미").
    const bias = this.draftBias();
    if (bias) {
      // ⚠ **`drawCards` 가 가중치를 걸 때 쓴 바로 그 함수로 판정한다.** 여기에 조건을 다시 적으면
      //   「내 방향이 떴는가」가 두 곳으로 갈라져, 가중은 걸렸는데 안 걸린 것으로 세는 일이 생긴다
      //   (known_issues 「화면에 뜨는 숫자를 규칙에서 다시 유도하지 마라」와 같은 자리).
      const hit = cards.some((c) => bias.cats.some((cat) => cardFavorsCategory(c, cat)));
      this.dryDrafts = hit ? 0 : this.dryDrafts + 1;
    }
    // 불씨 회복 카드 — **정확히 하나 남았을 때만**(미리 쟁여 두기 방지).
    if (this.embers === 1 && !this.eraReward && !this.firstChoice && cards.length >= 3) {
      // 첫 한 번은 확정. 그 뒤로는 확률(같은 시드 + 같은 플레이 = 같은 결과 · 결정론 보존).
      const show = !this.emberCardUsed || this.draftRng.chance(0.45);
      if (show) cards[2] = EMBER_CARD;
    }
    return cards;
  }

  /**
   * **은근한 보정** — **[사용자 2026-08-06]** "플레이어가 게임을 한 번도 클리어하지 못하고 접을 것 같은
   * 위험이 있는 경우에는 조심스럽게 도움을 주자. 대신 절대로 대놓고 티를 내면 안 되고, 플레이어가
   * 눈치채지 못하게 은근슬쩍 확률을 보정한다든가 하는 식으로."
   *
   * ⚠ **경계 두 개를 반드시 지킨다**(CLAUDE.md 「은근한 보정」):
   *  1. 보정은 **「무엇이 나오는가」에만** 건다. **「그것이 무엇을 하는가」에는 절대 안 건다.**
   *     등장 확률은 화면에 표시하지 않으므로 손대도 거짓말이 아니고, 효과·수치는 표시하므로 불가침이다.
   *  2. **작고 느리게.** 눈치채는 순간 자기가 이룬 것이 가짜가 되어, 안 도운 것보다 나쁘다.
   *
   * 결정론: `assistEnabled` 를 끄면(프로브) 보정이 통째로 사라진다. 켠 채 밸런스를 재면 **측정한
   * 난이도가 실제 난이도가 아니다.** 보정 자체도 rng 가 아니라 **런 이력의 함수**라, 같은 시드 +
   * 같은 플레이면 같은 보정이 나온다.
   */
  private draftBias(): DraftBias | undefined {
    if (!this.assistEnabled) return undefined;
    // 내가 판 방향 = 도장이 가장 많은 한둘. 도장이 하나도 없으면 방향이 없다(첫 판).
    const ranked = CATEGORIES.filter((c) => this.genome.pips[c] > 0).sort(
      (a, b) => this.genome.pips[b] - this.genome.pips[a],
    );
    if (ranked.length === 0) return undefined;
    const cats = ranked.slice(0, 2);
    // 기본 가중 1.18 = "아주 조금 더 자주". 여기에 두 보정이 얹힌다(상한 `ASSIST_MAX_WEIGHT`).
    //
    // ⚠ **2026-08-10 에 1.35 → 1.18 로 낮췄다.** **[사용자]** "카드 범주 보정이 지금 너무 과한 것
    //   같아서 이것도 완화해야겠다. (…) 이게 티어를 올릴 동기가 될 수도 있지만 지금은 **의욕을
    //   잃게 하는 게 더 큰** 것 같아."
    //   보정의 목적은 「내가 판 방향이 조금 더 자주」이지 「내가 판 방향만」이 아니다. 게이트가
    //   생기면서(2026-08-10) 후보 자체가 이미 내 범주 쪽으로 기울어 있어, 여기까지 세게 걸면
    //   **두 번 곱해진다** — 같은 범주 카드만 계속 나온다.
    let w = 1.18;
    // ① 연달아 내 방향이 안 떴으면 확률이 오른다(회복 카드의 「첫 한 번 확정」과 같은 문법).
    w += Math.min(0.3, this.dryDrafts * 0.15);
    // ② 한 번도 정복하지 못한 플레이어를 아주 조금씩 돕는다. 런을 거듭할수록 보정을 **줄인다**
    //    (실력이 붙으면 손을 뗀다 — 계속 도우면 그 사람이 이룬 것이 영영 자기 것이 안 된다).
    if (!this.everConquered) w += Math.max(0, 0.3 - this.runsCompletedNow * 0.05);
    return { cats, weight: Math.min(ASSIST_MAX_WEIGHT, w) };
  }

  /**
   * 분석 기록 · 드래프트 하나(**후보 전부 + 결말**)를 남긴다. 결말은 고른 자리이거나
   * 건너뜀·다시 뽑기다. 부르는 자리 셋(`pickCard`·`skipDraft`·`reroll`)은 전부 **화면에 떠 있는
   * 후보를 아직 안 갈아치운 시점**이라야 한다 · rng 미사용.
   */
  private recordDraft(outcome: number): void {
    const kind: DraftKind = this.firstChoice ? "preset" : this.eraReward ? "era" : "level";
    this.runLog.push({
      t: "draft",
      kind,
      // **강화 배수는 v9 에 없다 · 늘 1 이다.** v8 의 시대 보상은 뽑은 카드의 **도장을 곱하는 것**
      // 이었는데(`boostCard`), 카드가 도장을 안 주므로 곱할 것 자체가 사라졌다. 여기에 계속
      // `eraRewardBoostAt(era)` 를 적으면 분석 도구가 **없는 강화를 있다고 말한다.**
      // ⚠ 칸은 남긴다 — 옛 판 코드에는 진짜 배수가 담겨 있고, 그 코드를 계속 읽으려면 스키마의
      //   자리가 그대로여야 한다(`runCode.ts` 머리 주석: 자리를 재배열·삭제하지 않는다).
      boost: 1,
      level: this.level,
      // v8 의 강화 사본은 id 끝에 `_x2` 같은 꼬리를 달았다. v9 에는 꼬리를 다는 자리가 없어
      // `baseCardId` 가 사실상 아무 일도 안 하지만, 옛 id 가 섞여 들어와도 안전하도록 남겨 둔다.
      cards: this.draftCards.map((c) => baseCardId(c.id)),
      outcome,
    });
  }

  /** 지금까지 고른 카드의 id→횟수 — drawCards 소프트 디듑에 넘겨 이미 고른 카드를 뜸하게 뽑는다. */
  private pickedCounts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const id of this.pickedCardIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }

  /** 디버그 표시용 — 지금 이 런에 반영된 메타 플레이어 레벨. */
  get metaLevelNow(): number {
    return this.metaLvl;
  }
  /** 디버그 표시용 — 지금 이 런에 "다시 뽑기"가 해금돼 있는가. */
  get rerollUnlockedNow(): boolean {
    return this.metaRerollUnlocked;
  }

  get secondsLeft(): number {
    return Math.max(0, Math.ceil(this.stageTicksLeft / SIM.stepsPerSecond));
  }

  /**
   * 디버그 전용 — 현재 관전 단계를 지정한 위협으로 즉시 교체한다(폰에서 특정 보스/시련을 반복
   * 플레이 없이 바로 확인). 통과 판정이 나지 않게 타이머를 넉넉히 둔다(관찰용). `?dev` 패널이 호출.
   */
  debugSummon(kind: BossType | ExtinctionType): void {
    if (this.phase !== "watch") return;
    this.clearStageState();
    const isBoss = (BOSS_TYPES as readonly string[]).includes(kind);
    // **관문 자리로 옮겨 앉는다.** 예전에는 채집 라운드 한복판에 위협만 얹었다 → 화면이 "위협: 큰수리"
    // 라고 말하면서도 생존 기준(`survivorsNeeded`)은 0(=관문 없음)이라, 목표 줄이 "끝까지 살아남으면
    // 통과합니다"라는 거짓말을 했다. 소환으로 만드는 상태는 실제 관문과 같은 값을 봐야 한다
    // (검사기·dev 패널이 재는 것이 진짜 화면이어야 한다는 이 저장소의 규칙).
    const at = (SCHEDULE as readonly StageKind[]).indexOf(isBoss ? "boss" : "extinction");
    if (at >= 0) this.stageIndex = at;
    const diff = eraDifficulty(this.era);
    if (isBoss) {
      const bt = kind as BossType;
      this.stageThreat = bt; // 소환도 진짜 단계와 같은 상태를 만든다(분석 기록도 같은 값을 본다)
      this.world.boss = createBoss(bt, this.world.width, this.world.height, this.world.terrain, diff, true); // 레이드 첫 시대부터
      this.stageLabel = `${isPredatorBoss(bt) ? "보스" : "시련"} · ${bossName(bt)}`;
      this.preview = `다가오는 위협. ${bossPreview(bt)}`;
      this.threatText = `지금 위협 「${bossName(bt)}」 · ${bossCounter(bt)}`;
    } else {
      const et = kind as ExtinctionType;
      this.stageThreat = et;
      applyExtinction(this.world, et, diff);
      this.stageLabel = `대멸종 · ${extinctionName(et)}`;
      this.preview = `대멸종. ${extinctionPreview(et)}`;
      this.threatText = `지금 위협 「${extinctionName(et)}」 · ${extinctionCounter(et)}`;
    }
    this.stageTicksLeft = 99999; // 관찰용 — 타이머 만료로 통과 판정이 나지 않게
  }

  /**
   * 이 런에서 시작한 단계의 순번(1부터). **판 재현 전용 눈금**이다 — 명령 기록의 `stage` 와 같은 값이라,
   * 재생기가 "지금 몇 번째 단계인가"를 게임에게 직접 물어 자기 눈금을 맞춘다(밖에서 다시 세면 갈라진다).
   */
  get stageOrdinalNow(): number {
    return this.stageOrdinal;
  }

  /** 지금 단계가 시작한 뒤 흐른 틱. 명령 기록의 `tick` 과 같은 눈금이다(밖에서 다시 세면 갈라진다 —
   *  update 는 드래프트·결과 단계에서 일찍 돌아가므로 프레임 수와 이 값이 다르다). */
  get stageTickNow(): number {
    return this.stageTick;
  }

  /** 레벨업 게이지 진행도 0~1 (HUD 표시용). */
  get xpProgress(): number {
    return this.xpToNext > 0 ? Math.min(1, this.xp / this.xpToNext) : 0;
  }

  /** 지금 드래프트가 "시작 프리셋 선택"인지 — main 이 프리셋 캐릭터 선택 창 vs 일반 카드 창을 고른다. */
  get isChoosingPreset(): boolean {
    return this.phase === "draft" && this.firstChoice;
  }

  /**
   * 현재 단계 끝 무렵, 다음이 위협이면 예고(전광판 제목 + 대응 힌트 부제). 아니면 null.
   * 보스는 다음 종류가 정해져 있어(bossQueue peek) 무엇이 오는지·어떻게 버티는지 미리 알린다.
   * (rng·상태 불변 — bossQueue 는 읽기만 하는 순수 조회.)
   */
  get upcomingThreat(): { title: string; sub: string } | null {
    if (this.phase !== "watch") return null;
    if (this.secondsLeft > GAME.threatPreviewLead) return null;
    const next = SCHEDULE[this.stageIndex + 1];
    if (next === "boss") {
      const bt = this.peekBossType(); // 실제로 나올 보스(무의미 보스는 건너뛴 결과) — 예고가 진실이어야 한다
      // 살아남아야 하는 수를 **위협이 시작되기 전에** 못박는다. 판정과 같은 함수(bossPassNeeded)를 읽으므로
      // 예고가 거짓말이 될 수 없다. 모르고 지면 "허무하게 졌다"가 되지만, 알고도 못 지킨 것은 허무하지 않다.
      // 때릴 수 있는 보스(개체형)는 물리치기만 해도 통과한다 · 전역 시련은 생존만이 길이다.
      const hold = survivalLine(bossPassNeeded(this.era), bt ? isPredatorBoss(bt) : false);
      // 카운터 힌트 + 만능 수단 안내: 공격력·원거리가 높으면 **때릴 수 있는** 보스는 맞서 잡는다.
      // ⚠ 「어떤 보스든」이 아니다. 독 안개 같은 전역 재난은 `raidCounter` 가 없어 격퇴 체력 자체가
      //   0 이고, 공격력·원거리가 **정확히 아무 일도 안 한다**. 그런데 이 문장이 종류를 안 가리고
      //   붙어서, 공격을 키운 사람이 때릴 대상 없는 안개 앞에 무기를 들고 서 있었다
      //   (2026-08-08 실측 · 원거리 갈래가 시대 2 에서 24/24 탈락). 바로 아래 `nextKillableBoss` 의
      //   주석이 이미 「없는 격퇴를 예고하면 그게 거짓말이다」라고 적고 있던 자리다.
      if (bt) {
        const fightable = bossTypeRaidable(bt) ? " 공격력이나 원거리가 높으면 맞서 잡습니다." : "";
        return { title: `곧 ${bossName(bt)}!`, sub: `${bossCounter(bt)}${fightable}${hold}` };
      }
      return { title: "곧 위협이 닥칩니다", sub: hold.trim() };
    }
    if (next === "extinction") {
      // 대멸종 종류도 미리 정해 저장하므로(extinctionQueue) 무엇이 오는지·어떻게 버티는지 예고한다.
      const hold = survivalLine(extinctionPassNeeded(this.era));
      const et = this.extinctionQueue[0];
      if (et) return { title: `곧 ${extinctionName(et)}!`, sub: `${extinctionCounter(et)}${hold}` };
      return { title: "곧 대멸종이 닥칩니다", sub: `형태를 갖추고 수를 늘려 대비하세요${hold}` };
    }
    return null;
  }

  /**
   * **다음 시대에 무엇이 달라지는가** — 결과 화면에서 "다음 시대로"를 누른 순간 띄우는 짧은 연출의 내용.
   *
   * 시대가 올라도 화면이 똑같으면 "세계가 험해졌다"가 어디에서도 안 읽힌다(사용자: 정밀 분석을 해야
   * 아는 게 아니라 직관적으로 체감되게). 여기 줄들은 전부 **실제로 적용되는 값과 같은 함수**를 읽는다
   * (`eraPredatorPressure` · `bossPassNeeded` · `eraDifficulty`) — 화면과 실제가 갈릴 수 없다.
   *
   * 이어갈 수 없는 상태(패배·정복)면 null.
   */
  nextEraBriefing(): { title: string; lines: string[] } | null {
    if (this.result !== "win" || this.isFinalEra) return null;
    const next = this.era + 1;
    const lines: string[] = [];
    // ① 무엇이 험해지나 — 화면에서 붉은 것이 늘어나는 그 변화.
    const pressure = eraPredatorPressure(next);
    if (pressure > eraPredatorPressure(this.era)) {
      lines.push(`나를 사냥하는 짐승이 ${pressure.toFixed(1)}배로 늘어납니다.`);
    }
    // ①-b **세계 자체가 바뀌는가** — 이 줄이 없어서 사고가 났다(2026-08-09 [사용자] 제보:
    //   "대륙 맵으로 시작했다가 갑자기 군도 맵으로 변해버리면 지느러미가 없을 때 바로 죽어버리는데
    //   이게 의도한 경험이 맞아?"). 진도가 2에 닿는 시대에 초원에서 **이 런에 뽑힌 세계**로 갈아타는데
    //   (`stepUsesDrawnMap`), 그 사실을 화면이 한 번도 말하지 않았다. 시작 화면의 「이번 세계」 요약은
    //   **지금 월드**(초원)를 말하므로 런 내내 아무도 군도가 온다는 걸 모른다.
    //   빌드를 하드카운터하는 지형이 예고 없이 오는 것은 「왜 졌는지 모르는데 졌다」다(기획서 §4.2).
    //   ⚠ 지형을 안 바꾸는 것이 아니라 **말해 주는 것**이 답이다 · 대비할 수 있으면 그건 시험이다.
    const stepNow = onboardingStep(this.runsDone, this.era);
    const stepNext = onboardingStep(this.runsDone, next);
    if (!stepUsesDrawnMap(stepNow) && stepUsesDrawnMap(stepNext)) {
      const k = mapKind(this.currentMapType);
      lines.push(`세계가 ${k.name}(으)로 바뀝니다. ${k.desc}`);
    }
    // ② 무엇을 지켜야 하나 — 관문 판정 그 값.
    const need = bossPassNeeded(next);
    if (need > 1) lines.push(`관문마다 ${need}마리가 살아남아야 합니다.`);
    // ③ 무엇이 열리나 — 험해지는 소식 뒤에 오는 이 줄이 이 연출의 보상이다.
    // v8: 「천장이 올라간다」는 사라졌다(성장의 끝은 4단이고 그건 시대가 올라도 안 움직인다).
    // 대신 **지금 내가 어디쯤인가**를 말한다 — 다음 문턱이 눈앞에 있다는 것이 이어갈 이유가 된다.
    const near = nearestTierGoal(this.genome.pips);
    if (near) {
      lines.push(`${CATEGORY_LABELS[near.cat]} ${TIER_ROMAN[near.tier]}까지 도장 ${near.need}개 남았습니다.`);
    }
    return { title: `시대 ${next + 1}`, lines };
  }

  /**
   * 다음 관문이 **때려서 물리칠 수 있는 보스**면 그 이름, 아니면 null. 드래프트가 "이 카드를 고르면
   * 맞설 수 있는가"를 카드 자리에서 말하는 데 쓴다(형질을 키울 이유는 고르는 순간에 보여야 한다).
   * 전역 시련(독 안개)은 때릴 대상이 없어 제외한다 · 없는 격퇴를 예고하면 그게 거짓말이다.
   * 순수 조회 · rng·상태 불변. (stageIndex 는 라운드가 끝날 때 이미 +1 된 뒤라 곧 시작할 단계를 가리킨다.)
   *
   * ⚠ 여기 있던 counterHint 를 지웠다. 그것은 "앞장서서 몰기 시작하면 수풀도 우리를 숨겨 주지
   *   않습니다"를 예고에 끼워 넣었는데, 그 규칙은 world.lead.commanded 로 켜지고 그 값은 무리 지시로
   *   갈아탄 뒤로 구조적으로 영영 false 다 = 실제로는 안 걸리는 규칙을 예고가 말하고 있었다.
   */
  get upcomingRaidBoss(): string | null {
    if (this.phase !== "draft") return null;
    if ((SCHEDULE[this.stageIndex] ?? "forage") !== "boss") return null;
    const bt = this.peekBossType();
    return bt !== undefined && isPredatorBoss(bt) ? bossName(bt) : null;
  }

  /** 렌더 보간 비율 [0,1) — 다음 스텝까지 얼마나 왔나(화면 60fps 가 sim 30/s 사이를 메운다). */
  get interpAlpha(): number {
    const stepMs = 1000 / SIM.stepsPerSecond;
    const a = this.phase === "lobby" ? this.ambientAcc : this.acc;
    return Math.min(1, Math.max(0, a / stepMs));
  }

  get stageNumber(): number {
    return this.stageIndex + 1;
  }

  /** 시작 종을 고르기 전에 보여줄 이번 세계 요약 — "군도 · 바다 57% · 잘게 쪼개진 섬…". */
  worldBriefing(): { name: string; sea: number; desc: string } {
    const k = this.mapKindNow;
    // **곧 다른 세계로 갈아탄다면 그것도 지금 말한다.** 이 화면은 사람이 **빌드를 정하는 자리**라,
    // 여기서 안 알리면 대비할 방법이 없다(2026-08-09 [사용자] 제보: 군도로 바뀌자 지느러미가 없어
    // 바로 죽었다). 진도가 2에 닿는 시대에 초원에서 이 런에 뽑힌 세계로 바뀐다(`stepUsesDrawnMap`).
    // ⚠ 「지금 세계」와 「곧 올 세계」를 한 문장에 담아, 고르는 사람이 둘 다 보고 정하게 한다.
    const drawn = mapKind(this.currentMapType);
    const laterDiffers = !stepUsesDrawnMap(this.onboarding) && drawn.name !== k.name;
    const desc = laterDiffers ? `${k.desc} 시대가 지나면 ${drawn.name}(으)로 바뀝니다 · ${drawn.desc}` : k.desc;
    return { name: k.name, sea: this.seaPercent, desc };
  }

  private setupRun(): void {
    // 시드 하나에서 맵·드래프트·보스를 모두 파생. 기본은 랜덤(매 런 다름), 고정 시드면 완전 재현.
    this.baseSeed = this.fixedSeed ?? randomSeed();
    this.currentSeed = this.baseSeed;
    this.reloadMeta(); // 이전 런들의 해금(누적 경험치 → 레벨)을 이번 런부터 반영
    this.champions = loadChampions(); // 지난 챔피언들을 이 런 세계에 등장(비동기 생물)
    this.era = 0; // 새 런은 첫 시대부터
    this.playerColor = undefined;
    this.genome = defaultGenome();
    this.pickedCardNames = [];
    this.pickedCardIds = [];
    this.peakPopulation = 0;
    this.rerollsUsed = 0;
    this.newAchievements = [];
    // 새 혈통 — 보고서 기록을 비운다(시대를 넘어갈 때는 이어서 누적, 새 런에서만 리셋).
    this.runSamples = [];
    this.runEvents = [];
    this.runSteps = 0;
    this.runLog = []; // 판 분석 코드의 기록도 새 혈통과 함께 처음부터
    this.stageOrdinal = 0;
    this.stageTick = 0;
    this.geneEarnedTotal = 0;
    this.geneSpentTotal = 0;
    this.stageThreat = null;
    this.stageIndex = 0;
    this.result = null;
    this.embers = GAME.emberStart; // 새 혈통 = 불씨 가득
    this.loseReason = null;
    this.threatText = "";
    this.currentTrial = null;
    this.pendingTrial = null;
    this.skipBroodTotal = 0;
    this.trialSkipBroodBase = 0;
    this.pendingLevels = 0;
    this.boundaryDraft = false;
    this.firstChoice = true;
    this.lineage = null; // 새 혈통 — 갈래는 시작 프리셋을 고를 때 다시 정해진다
    this.level = 1;
    this.xp = 0;
    this.xpToNext = GAME.xpBase;
    this.lastFoodEaten = 0;
    this.lastHuntKills = 0; // 새 World 는 사냥 누계도 0 부터다 · 셋은 언제나 짝으로 되돌린다
    this.lastGeneCollected = 0; // 방울 누계도 0 부터다(짝을 놓치면 지갑이 어긋난다)
    this.geneBankValue = 0; // 새 런 = 빈 지갑. 시대 전환에서는 **안** 비운다(모은 것은 런을 따라간다).
    this.crisisWatch = createCrisisWatch(); // 위기 회복의 최고 기록도 새 혈통과 함께 처음부터
    // (개체 수 문턱 사다리가 읽는 peakPopulation 은 위에서 이미 0 으로 되돌렸다)
    this.stageXp = 0;
    this.draftRng = new Rng(`${this.currentSeed}-draft`);
    this.stageRng = new Rng(`${this.currentSeed}-stage`);
    this.extRng = new Rng(`${this.currentSeed}-ext`);
    // 이번 세계를 뽑는다 — 전용 rng(-map)라 보스·드래프트 스트림을 1비트도 안 건드린다. 아직 안 열린
    // 세계는 후보에서 빠진다(레벨 1 이면 대륙 하나 → 기존과 동일한 세계 = 밸런스 기준선 보존).
    this.currentMapType = pickMapType(new Rng(`${this.currentSeed}-map`), this.metaLvl);
    this.bossQueue = shuffle(BOSS_TYPES, this.stageRng); // 한 런의 보스는 서로 다른 종류
    this.extinctionQueue = shuffle(EXTINCTION_TYPES, this.extRng); // 대멸종 종류도 미리 정해 예고 가능
    this.world = this.makeWorld();
    this.beginFirstDraft();
  }

  /**
   * 지금의 **온보딩 진도**(0~3) — 세계를 얼마나 여느냐의 유일한 기준.
   * 시대가 아니라 "끝낸 런 수 + 지금 시대"다(game/config.ts `onboardingStep`). 그래서 숙련자는
   * 첫 시대부터 온전한 세계에서 시작하고, 처음 하는 사람만 한 단계씩 열린다.
   * (예전엔 `era === 0` 로 갈라서 백 판을 한 사람도 매 런 첫 시대가 유아용이 됐다 · 2026-08-05 수정.)
   */
  private get onboarding(): number {
    return onboardingStep(this.runsDone, this.era);
  }

  /**
   * 이 진도의 세계 종류. 진도 0~1 은 늘 「초원」(산·험지·수풀 없는 평평한 땅 + 작은 호수 몇 개)이고,
   * 그 뒤로는 이 런에서 뽑힌 세계(currentMapType)를 쓴다. 뽑기는 런 시작에 한 번뿐이므로
   * 여기서 진도만 보고 갈라야 지형이 열린 뒤 「초원」에 갇히지 않는다.
   */
  private stepMapType(step: number): MapType {
    return stepUsesDrawnMap(step) ? this.currentMapType : FIRST_ERA_MAP;
  }

  /**
   * 이 시대의 형질 천장을 sim 에 넣어 준다 — **시대를 아는 것은 game 뿐이다.** sim(genome.ts)은 받은
   * 숫자를 쓰기만 하고, 카드 적용·감쇠·드래프트 표시가 전부 그 하나를 읽으므로 표시와 적용이 갈릴 수 없다.
   * 시대가 바뀌는 모든 입구(새 런·다음 시대·로비 복귀)에서 부른다.
   */
  private applyEraCeilings(): void {
    // v8: 형질 천장 개념이 사라졌다(성장의 끝은 4단 = 규칙 면제다). 호출부 정리를 위해 빈 함수로 남긴다.
  }

  /** 지금 종의 도장 상태(화면이 티어 칩·막대를 그릴 때 읽는다). */
  get pipsNow(): Readonly<Record<Category, number>> {
    return this.genome.pips;
  }

  // ─────────────────────────────── 방울(유전자 점수) ───────────────────────────────

  /** **아직 안 쓴 방울.** 화면의 방울 카운터가 읽는 유일한 값이다. */
  get geneBank(): number {
    return this.geneBankValue;
  }

  /**
   * 이 범주의 **다음 단까지 드는 방울 수**. 이미 4단이면 0(= 더 살 것이 없다).
   *
   * ⚠ **여기서 새 가격표를 만들지 않는다.** 방울은 도장(pip)과 같은 단위라 값은 `tiers.ts` 의
   *   `TIER_STEPS` 하나가 정하고, 이 함수는 `pipsToNext` 를 그대로 읽기만 한다. 이미 찍혀 있는
   *   도장(시작 갈래가 준 것)이 비용을 그만큼 깎는 것도 저절로 따라온다(남은 거리 = 비용).
   *   ⚠ v9 부터 **드래프트 카드는 도장을 한 칸도 안 준다** — 「카드로 받은 도장」은 이제 없다.
   */
  tierCost(cat: Category): number {
    return pipsToNext(this.genome.pips[cat]);
  }

  /** 지금 이 범주의 다음 단을 살 수 있는가 · 버튼을 켤지 끌지의 단일 진실. */
  canBuyTier(cat: Category): boolean {
    const cost = this.tierCost(cat);
    return cost > 0 && this.geneBankValue >= cost;
  }

  /**
   * **모은 방울로 이 범주의 다음 단을 산다.** 성공하면 true, 못 사면(최고 티어이거나 방울이 모자라면)
   * false 를 돌려주고 **아무것도 안 바꾼다**(부분 적용이 없다 · 실패가 상태를 반쯤 흔들면 화면과 어긋난다).
   *
   * 지키는 계약:
   * · 값은 `tierCost` 하나만 읽는다 = `tiers.ts` 의 `TIER_STEPS`. 여기에 새 가격표를 만들지 않는다.
   * · 도장은 **정확히 비용만큼** 오른다 → 다음 문턱에 정확히 닿는다. 화면에 「3개 필요」라 적었으면
   *   정확히 3개가 들어가고 3개가 나간다(수치가 화면 표시와 다르면 그건 거짓말이다).
   * · 무리 전체에 같은 도장을 찍는다 · 레벨업 카드가 하는 것과 **같은 처리**다(`pickCard` 의
   *   `applyCard(e.genome, card)` 갈래). 종 기준선만 올리고 살아 있는 개체를 안 건드리면, 화면의
   *   티어 칩은 올라갔는데 실제로 뛰는 몸은 예전 그대로인 거짓말이 된다.
   * · 도장이 바뀌었으니 지휘 값(목소리 반경·공백 시간)도 그 자리에서 다시 읽는다.
   *
   * ⚠ **부른 쪽은 곧바로 `takeNewTiers()` 를 꺼내 가라.** 승급 알림은 꺼내 가는 큐다. 안 꺼내면
   *   다음 카드창을 닫을 때 몰아서 터진다(2026-08-07 에 프리셋 승급이 그렇게 새서 고친 자리가 있다).
   */
  buyTier(cat: Category): boolean {
    if (!this.canBuyTier(cat)) return false;
    const cost = this.tierCost(cat);
    this.geneBankValue -= cost;
    this.geneSpentTotal += cost; // 분석 기록의 수지(번 것 · 쓴 것 · 남은 것)
    this.genome.pips[cat] += cost; // 정확히 다음 문턱 (cost = pipsToNext)
    refreshDerived(this.genome); // 종 기준선의 파생 능치 갱신 (applyCard 와 같은 마무리)
    // 무리 전체에 같은 도장. 도장은 정수라 개체마다 갈릴 여지가 없다(티어는 종 단위 성취다).
    for (const e of this.world.entities) {
      if (!e.species.isPlayer || !e.alive) continue;
      e.genome.pips[cat] += cost;
      refreshDerived(e.genome);
    }
    this.syncCommandReach(); // 무리 도장이 올랐으면 목소리가 더 멀리 간다 · 즉시 반영
    this.newTiers.push({ cat, tier: tiersOf(this.genome.pips)[cat] });
    this.logEvent("card", `방울 · ${CATEGORY_LABELS[cat]} ${TIER_ROMAN[tiersOf(this.genome.pips)[cat]]}`);
    // 분석 기록 — 연대기 줄은 「이빨 II」라고만 말한다. 든 값(방울)과 순서는 여기에만 남는다.
    this.runLog.push({
      t: "buy",
      cat,
      cost,
      tier: tiersOf(this.genome.pips)[cat],
      // 시각도 함께 — 순서만으로는 되살릴 때 구입이 앞뒤로 밀린다(도장이 붙는 틱이 곧 세계다).
      stage: this.stageOrdinal,
      tick: this.stageTick,
    });
    return true;
  }

  // ─────────────────────────────── 방울을 필드에 떨어뜨린다 ───────────────────────────────

  /**
   * 사건 하나가 낸 방울을 **필드에 떨어뜨린다**(지갑에 바로 넣지 않는다).
   * **[사용자 2026-08-07]**: 방울은 무리가 **밟고 지나가야** 주워진다. 지갑에 바로 넣으면
   * 그건 그냥 점수판이고, 「가라」 명령이 방울을 줍는 손이 되는 이 설계 전체가 사라진다.
   *
   * 값은 `GENE_AWARD`(sim/gene.ts) 하나만 읽는다 · 사건별 개수를 여기 적으면 두 곳이 어긋난다.
   * `times` 는 한 번에 여러 눈금을 넘겼을 때(개체 수 사다리) 그만큼 떨어뜨리기 위한 것이다.
   */
  private awardGenes(reason: GeneReason, times = 1): void {
    const amount = GENE_AWARD[reason];
    for (let i = 0; i < times; i += 1) this.dropGene(amount, reason);
  }

  /**
   * 방울 하나를 무리 곁의 고리 위에 놓는다.
   *
   * **자리를 여기서 만들지 않는다** · `world.spawnGeneDropNear` 가 정한다. 좌표를 game 이 직접
   * 계산하면 조용히 두 가지가 깨진다:
   *  ① 통행 가능한 타일이어도 **건너편 섬**이면 무리가 영영 못 간다(지형 검사만으로는 안 걸러진다).
   *     sim 쪽은 `lineOfSight` → `findPath` 로 「실제로 걸어 닿는가」까지 본다.
   *  ② 실수로 `world.rng` 를 쓰면 야생 스폰·진화의 난수 순서가 밀려 밸런스가 통째로 이동한다
   *     (`species.ts` 의 `WILD_RNG_KEYS` 제약과 같은 계열). sim 쪽은 방울 전용 `geneRng` 만 쓴다.
   * (처음엔 여기서 `geneDropOffset` + `nearestLargePassable` 로 직접 잡았는데, ①을 못 걸러
   *  「화면에 보이는데 영영 못 줍는 방울」이 날 수 있었다. 같은 규칙을 두 곳에 적지 않는다.)
   *
   * 내 종이 전멸했으면 아무것도 안 한다(줍을 무리가 없다).
   */
  private dropGene(amount: number, reason: GeneReason): void {
    this.world.spawnGeneDropNear(amount, reason);
  }

  /**
   * 내 종이 주운 방울 delta 를 지갑으로 옮긴다. 매 sim 스텝 뒤에 불린다(멱등하지 않으니
   * **부르는 자리를 늘리지 마라** · 누계 기준이라 중복 호출은 해가 없지만, 자리가 흩어지면
   * 「직전값을 되돌리는 짝」을 다시 놓친다).
   */
  private harvestGenes(): void {
    const got = this.world.geneCollected;
    if (got > this.lastGeneCollected) {
      this.geneBankValue += got - this.lastGeneCollected;
      this.geneEarnedTotal += got - this.lastGeneCollected; // 수입 누계(지갑은 쓰고 남은 잔액이라 따로 센다)
      this.lastGeneCollected = got;
    }
  }

  /**
   * 디버그 · 지갑에 방울을 곧장 넣는다(필드에 떨어뜨렸다 밟는 과정을 건너뛴다).
   *
   * 왜 필요한가: 겹침 검사기(`?ovhook`)가 티어 구입 화면을 **살 수 있는 상태**로도 재야 한다.
   * 지갑이 0 이면 다섯 줄이 전부 「모자람」이라 그 화면의 절반(켜진 테두리 · 방울 색 값 칩 ·
   * 구입 성공 줄)이 영영 안 재진다. `?dev` 패널도 같은 문으로 쓴다.
   *
   * rng 를 안 쓰고 세계를 안 건드린다 → 밸런스·결정론 무관.
   */
  debugGrantGenes(amount: number): void {
    this.geneBankValue = Math.max(0, this.geneBankValue + Math.trunc(amount));
  }

  /**
   * 디버그 · 방울 하나를 **지금 필드에 떨어뜨린다**(사건이 나기를 기다리지 않고).
   *
   * 왜 필요한가: 방울이 실제로 나오는 사건(보스 격퇴 · 대멸종 생존 …)은 판당 몇 번뿐이라, 화면에서
   * 확인해야 하는 것들 ▸ 방울이 먹이와 갈리는가 · 화면 밖 쐐기가 미니맵·목표 줄과 안 겹치는가 ·
   * 밟으면 정말 주워지는가 ▸ 을 보려고 몇 분씩 기다려야 한다. 폰으로 검토하는 프로젝트라 그 대기가
   * 곧 "확인 안 함"이 된다. `?dev` 패널의 버튼 하나가 그 자리를 연다.
   *
   * 값·자리는 실제 경로 그대로다(GENE_AWARD 를 읽고 `spawnGeneDropNear` 가 자리를 고른다) ·
   * 가짜 방울을 놓으면 확인이 거짓말이 된다.
   */
  debugDropGene(reason: GeneReason = "boss"): void {
    this.awardGenes(reason);
  }

  /** 이 런의 갈래(시작 프리셋이 정한다) — 화면이 「내 갈래」를 표시하는 데 쓴다. */
  get lineageNow(): Lineage | null {
    return this.lineage;
  }

  /**
   * 디버그 · 지금 판의 시대를 갈아 끼운다(생존 기준·천장·포식 압력이 뒤 시대 값이 된다).
   * `era` 를 직접 대입하면 **형질 천장이 안 따라와** 화면이 첫 시대 눈금을 그린다 → 반드시 이 문으로.
   * 겹침 검사기(`?ovhook`)와 `?dev` 패널이 후반 시대 화면을 만들 때 쓴다. 세계는 다시 만들지 않는다.
   */
  debugSetEra(era: number): void {
    this.era = Math.max(0, Math.min(GAME.eraCap - 1, Math.trunc(era)));
    this.applyEraCeilings();
  }

  /**
   * **이번 관문을 넘으려면 몇 마리가 살아남아야 하는가.** 판정(`finishStage`)과 예고 문구가 같은 이
   * 값을 읽는다 — 화면에 "3마리"라 써 놓고 2마리로 통과시키면 그건 거짓말이다.
   * 채집 라운드에는 관문이 없으므로 0(= 기준 없음).
   */
  get survivorsNeeded(): number {
    const kind = this.currentKind();
    if (kind === "boss") return bossPassNeeded(this.era);
    if (kind === "extinction") return extinctionPassNeeded(this.era);
    return 0;
  }

  private makeWorld(): World {
    // 진도별 맵 크기 · 세계를 만들 때마다 치수를 새로 계산한다(진도 0 은 1.0 = 월드가 화면 그대로 →
    // 무리도 보스도 화면 안. 진도가 오르면 1.4·2.0 으로 넓어진다). fixedMapScale 은 테스트 전용 고정.
    const step = this.onboarding;
    const s = this.fixedMapScale ?? mapScale(step);
    return new World(
      `${this.currentSeed}-env`,
      this.baseW * s,
      this.baseH * s,
      this.genome,
      s * s, // 면적 배율 · 개체는 절대 수(소수)지만 먹이 밀도·상한은 면적 비례
      // 마지막 진도 전에는 지난 챔피언(비동기 생물)을 부르지 않는다 — 08-05 실측에서 챔피언 2종이
      // 100초 시점 내 종을 22.9 → 9.8마리로 깎았다. this.champions 자체는 그대로 두고(진도가 차면
      // 다시 쓴다), 챔피언 경로는 이미 독립 rng 라 끄는 비용이 0이다.
      // **시대 눈높이로 눌러 데려온다**(2026-08-11 · **[사용자 2026-08-11]** "생태계 교란종" 지적 →
      // 「시대 천장 + 특성 몰수」 결정). 첫 시대는 1단 수준, 시대 4에 본모습(easeChampionGenome 주석).
      stepHasChampions(step)
        ? this.champions.map((c) => ({ ...c, genome: easeChampionGenome(c.genome, this.era + 1) }))
        : [],
      this.stepMapType(step),
      eraScarcity(this.era), // 시대가 지날수록 세계가 척박(먹이↓·재생↓) — era 0 = 1.0 = 기존과 동일
      // 진도가 해석한 세계 옵션(남길 종·친척·기후·포식자 자리). sim 은 진도도 시대도 모른다.
      // 시대별 포식 압력도 여기서 숫자 하나로만 넘긴다(era 0 = 1.0 = 첫 시대 불변).
      { ...stepWorldOptions(step), predatorPressure: eraPredatorPressure(this.era) },
    );
  }

  /**
   * 지금 세계의 종류(진도 0~1 은 초원 · 그 뒤는 이 런에 뽑힌 대륙·판게아·군도·대양).
   * **지금 살고 있는 월드에게 직접 묻는다** — 진도로 다시 계산하면(로비 복귀·저장 데이터 지우기처럼
   * 월드를 안 새로 만들고 진도만 바뀌는 순간에) 화면 설명과 실제 지형이 갈린다.
   */
  get mapType(): MapType {
    return this.world.mapType;
  }

  get mapKindNow(): MapKind {
    return mapKind(this.mapType);
  }

  /**
   * 이번 세계의 바다 비율(%) — 로비 예고에 숫자로 띄운다. "군도 · 바다 57%" 처럼 보이면 시작 종을
   * 고르는 판단 근거가 된다(맵 종류 이름만으론 얼마나 물바다인지 안 와닿는다). rng 미사용.
   */
  get seaPercent(): number {
    const t = this.world.terrain;
    let water = 0;
    for (const k of t.tiles) if (k === TILE.water) water++;
    return Math.round((100 * water) / Math.max(1, t.tiles.length));
  }

  private currentKind(): StageKind {
    return SCHEDULE[this.stageIndex] ?? "forage";
  }

  /** 런 첫 드래프트 — 시작 프리셋 선택(어떤 종으로 시작할지). 이후 형질은 레벨업으로 얻는다. */
  private beginFirstDraft(): void {
    this.phase = "draft";
    this.rerollsLeft = 0; // 시작 프리셋 선택엔 리롤 없음(한 종으로 시작을 정하는 자리)
    // 메타 언락: 열린 프리셋만 보여준다(잠긴 특수 갈래는 런을 거듭해 해금). 항상 최소한 기본 갈래는 열려 있다.
    this.draftCards = PRESET_CARDS.filter((c) => isPresetUnlocked(c.id, this.metaLvl));
    // **이번 세계를 먼저 알린다.** 세계가 정해진 뒤에 종을 고르는 게 이 게임이다 — 무엇이 기다리는지
    // 모르고 고르면 그건 선택이 아니라 운이다(군도인데 걷는 종을 고르면 섬에 갇힌다).
    const w = this.worldBriefing();
    this.preview = `이번 세계. ${w.name} · 바다 ${w.sea}%. ${w.desc} 여기서 살아갈 종을 고르세요.`;
  }

  /**
   * 이번 관문에 실제로 나올 보스 — 큐 앞에서부터 **내 종이 실제로 걸리는** 첫 보스를 찾는다.
   * 층위(하늘/땅/물)가 안 겹치는 보스는 나와봐야 아무 일도 안 일어나 "그냥 통과"가 된다(나는 종에게
   * 땅의 치타, 육상 종에게 물속 상어). 그런 보스는 건너뛰고 내 종이 실제로 쫓기는 보스를 붙인다.
   * 큐에는 항상 독 안개(전 층위)가 있어 반드시 하나는 찾는다.
   * 예고(peek)와 실제(take)가 같은 판정을 써야 "곧 X!" 예고가 거짓말이 되지 않는다.
   */
  private eligibleBossIndex(): number {
    return this.bossQueue.findIndex((bt) =>
      // ⚠ 반드시 world 의 치수로 판정한다 · 시대별 맵 크기가 켜지면 Game 의 기준 치수와 어긋날 수 있다.
      bossEligible(bt, this.genome.traits, this.world.terrain, this.world.width, this.world.height),
    );
  }

  /** 다음에 나올 보스(예고용 — rng·상태 불변 순수 조회). */
  private peekBossType(): BossType | undefined {
    const i = this.eligibleBossIndex();
    return i < 0 ? undefined : this.bossQueue[i];
  }

  /** 다음 보스를 큐에서 꺼낸다(한 런에 같은 보스는 두 번 안 나온다). */
  private takeBossType(): BossType {
    const i = this.eligibleBossIndex();
    if (i < 0) return "poison"; // 큐가 다 소진되면 전역 시련(층위 무관 — 누구에게나 통한다)
    const bt = this.bossQueue[i] as BossType;
    this.bossQueue.splice(i, 1);
    return bt;
  }

  /** 이번 채집 단계의 시험을 시드 파생 해시로 뽑는다. 어떤 기존 rng 스트림도 소비하지 않는 순수
   * 계산(새 Rng 인스턴스)이라 같은 시드·같은 단계·같은 게놈이면 항상 같은 시험이다. currentSeed 에는
   * 시대 접미사가 이미 붙어 있어(era 1+ 는 `-eraN`) 시대가 다르면 해시도 다르다. 후보는 지금 게놈으로
   * 할 수 있는 것만 담는다(못 하는 시험을 내면 안 된다 · §round_verdict_spec A). */
  private pickTrial(): Trial {
    const t = this.genome.traits;
    const candidates: Trial[] = [];
    // 무리가 커지면 시험 목표도 따라 오른다(근거·상한은 GAME.trialRefPop 주석). 1배가 하한이라
    // 작은 무리는 예전 값 그대로다. 「무리」·「표시된 자리」는 원래부터 개체 수를 보고 있었다.
    const scale = Math.min(
      GAME.trialScaleCap,
      Math.max(1, this.world.playerPopulation / GAME.trialRefPop),
    );
    const goal = (base: number): number => Math.max(base, Math.round(base * scale));
    // ⚠ **이빨 0단(초식)에게는 「사냥」 시험이 구조적으로 불가능하다.** 사냥 효율이 정확히 0 이라
    //   한 마리도 못 잡는데 불씨는 다섯뿐이다 — 못 하는 시험을 내는 것은 판정이 아니라 사형 선고다.
    //   **[사용자 2026-08-06]** 「초식 거인 경로는 반드시 만든다」가 이 한 줄에 걸려 있다.
    if (t.hunt > 0)
      candidates.push({ kind: "hunt", target: goal(GAME.trialHuntN), label: `사냥 ${goal(GAME.trialHuntN)}회` });
    if (t.graze > SIM.grazeMinEff)
      candidates.push({ kind: "feed", target: goal(GAME.trialFeedN), label: `먹이 ${goal(GAME.trialFeedN)}회` });
    candidates.push({ kind: "birth", target: goal(GAME.trialBirthN), label: `새끼 ${goal(GAME.trialBirthN)}마리` });
    // 「무리」는 붕괴를 잡는 시험이라 목표가 **지금 무리보다 클 수 없다.** 하한(8)만 걸면 2마리로 들어온
    // 라운드에서 목표가 8 이 되어 "지키기"가 "4배로 불리기"로 뒤집힌다(못 하는 시험을 내면 안 된다).
    const pop = this.world.playerPopulation;
    const popTarget = Math.min(pop, Math.max(GAME.trialPopFloor, pop - GAME.trialPopSlack));
    candidates.push({ kind: "pop", target: popTarget, label: `무리 ${popTarget}마리` });

    // ── 세계 위에 목표를 찍는 시험 둘 (**[사용자 2026-08-06]** 「무엇을 해라」에서 「무엇을 지켜라」로) ──
    //
    // 왜 이게 필요한가: 위 넷은 **화면 어디에도 없다.** 「사냥 5회」라고 예고해 놓고 그 다섯이 어디
    // 있는지는 안 알려 준다 — 2026-08-02 폰 실기의 "뭘 하려는 건지 모르겠다"가 정확히 이 자리였다.
    // 아래 둘은 땅 위에 목표가 보이므로 **무리를 그리로 몰면 되고, 명령이 곧 답이 된다.**
    //
    // ⚠ 자리·표식은 **여기서 정하지 않는다**(pickTrial 은 순수 조회라 예고에도 불린다).
    //   실제로 세계에 찍는 것은 `armTrial` 이 라운드를 시작할 때 한 번만 한다.
    const holdTarget = Math.max(3, Math.min(12, Math.round(pop * 0.5)));
    if (pop >= 4) candidates.push({ kind: "hold", target: holdTarget, label: `표시된 자리에 ${holdTarget}마리` });
    // 표식 사냥은 이빨 0단이면 못 한다(사냥 자체가 불가) · 위 「사냥」과 같은 게이트.
    if (t.hunt > 0) {
      candidates.push({ kind: "mark", target: goal(GAME.trialMarkN), label: `표시된 것 ${goal(GAME.trialMarkN)}마리 사냥` });
    }

    const idx = new Rng(`${this.currentSeed}-trial-s${this.stageIndex}`).int(0, candidates.length - 1);
    return candidates[idx] as Trial;
  }

  /**
   * **시험을 세계에 실제로 찍는다** — 라운드가 시작될 때 한 번만. 자리(원)와 표식(개체)이 여기서 정해진다.
   *
   * 결정론: 전용 `Rng` 인스턴스라 메인 스트림을 한 번도 안 건드린다(같은 시드 + 같은 단계 = 같은 자리).
   * 시험이 없거나 자리를 안 쓰는 종류면 세계에 아무것도 안 남는다.
   */
  private armTrial(trial: Trial | null): void {
    this.world.trialZone = null;
    this.world.trialMarks = [];
    if (!trial) return;
    const rng = new Rng(`${this.currentSeed}-trialmark-s${this.stageIndex}`);

    if (trial.kind === "hold") {
      // **무리에서 조금 떨어진 곳**에 찍는다. 발밑에 찍으면 아무것도 안 해도 합격이라 시험이 아니고,
      // 너무 멀면 16초 안에 못 간다(무리 속도 ≈ 1.7px/틱 × 30틱 × 16초 = 800px 이 상한이다).
      const c = this.world.playerCentroid();
      const caps = {
        swim: this.genome.traits.swimming >= SIM.swimThreshold,
        land: this.genome.traits.swimming < SIM.aquaticOnlyThreshold,
        fly: this.genome.traits.wings >= SIM.flyThreshold,
      };
      for (let tryN = 0; tryN < 40; tryN += 1) {
        const ang = rng.range(0, Math.PI * 2);
        const dist = rng.range(TRIAL_HOLD_MIN_DIST, TRIAL_HOLD_MAX_DIST);
        const x = Math.max(20, Math.min(this.world.width - 20, c.x + Math.cos(ang) * dist));
        const y = Math.max(20, Math.min(this.world.height - 20, c.y + Math.sin(ang) * dist));
        // **갈 수 있는 곳이어야 한다.** 못 가는 자리에 목표를 찍는 건 못 하는 시험을 내는 것이다.
        if (!this.world.terrain.isPassable(x, y, caps.swim, caps.land, caps.fly)) continue;
        if (!this.world.terrain.lineOfSight(c.x, c.y, x, y, caps.swim, caps.land, caps.fly)) continue;
        this.world.trialZone = { x, y, r: TRIAL_HOLD_RADIUS };
        return;
      }
      // 마흔 번 다 실패하면(섬에 갇힌 종 등) 무리 자리에 찍는다 — 시험이 쉬워질지언정 불가능하진 않게.
      this.world.trialZone = { x: c.x, y: c.y, r: TRIAL_HOLD_RADIUS };
      return;
    }

    if (trial.kind === "mark") {
      // 잡을 수 있는 야생만 고른다(내 이빨이 박히는 상대). **목표보다 넉넉히 찍는다** — 표식이 찍힌
      // 것이 다른 포식자에게 먼저 잡히거나 굶어 죽어도 시험이 불가능해지면 안 된다.
      const me = this.genome.traits;
      const pool = this.world.entities.filter(
        (e) =>
          e.alive &&
          !e.species.isPlayer &&
          !e.species.friendly &&
          !biteOutcome(me.attack, e.genome.traits.defense, me.size, e.genome.traits.size).ignored,
      );
      const want = trial.target + TRIAL_MARK_SPARE;
      // 개체 id 오름차순으로 정렬한 뒤 뽑는다 — 배열 순서(스폰 순)에 결과가 안 걸리게(결정론).
      pool.sort((a, b) => a.id - b.id);
      const picked: number[] = [];
      while (picked.length < want && pool.length > 0) {
        const i = rng.int(0, pool.length - 1);
        picked.push((pool[i] as Entity).id);
        pool.splice(i, 1);
      }
      this.world.trialMarks = picked;
    }
  }

  /**
   * 단계 시작 — 위협(보스/대멸종)을 직접 정한다. 하이브리드: 단계 전환에는 드래프트가 붙지 않고(형질은
   * 레벨업으로만), 위협만 흐른다. 예고(preview)는 stageLabel 과 함께 main 이 하이라이트로 띄운다.
   */
  private beginStage(): void {
    this.stageOrdinal += 1; // 명령 기록이 "몇 번째 단계의 탭인가"를 적는 눈금
    this.stageTick = 0; // 그 단계 안에서의 시각도 0 부터 다시
    this.stageXp = 0; // 조종 모드 경험치 상한은 단계마다 새로 찬다(leadEnabled=false 면 안 읽힌다)
    this.syncCommandReach(); // 무리 티어가 오르면 목소리가 더 멀리 간다 · 단계마다 다시 읽는다
    this.orderCd.clear(); // 명령 쿨타임은 라운드 경계에서 씻는다(라운드 시작에 손이 묶여 있으면 답답하다)
    this.world.resetRoundCounts(); // 새 단계 = 시험 계수 리셋 (뜻은 clearStageState 가 이미 거뒀다)
    this.currentTrial = null;
    this.lastVerdictValue = null; // 새 라운드가 시작되면 지난 판정은 지운다
    this.phase = "watch";
    this.acc = 0;
    const kind = this.currentKind();
    const diff = eraDifficulty(this.era); // 시대별 위협 강도 배율(era 0 = 1.0)
    this.stageThreat = null; // 분석 기록용 · 아래에서 위협이 정해지면 채운다
    if (kind === "boss") {
      const bt = this.takeBossType();
      this.stageThreat = bt;
      // 레이드는 첫 시대(era 0)부터 켠다 — 격퇴 체력바·직접 잡기는 핵심 메커니즘이라 첫 판부터 보여야 한다
      // (era 1+ 로 미뤘더니 한 판 이겨 다음 시대로 가기 전엔 아예 안 보였다 — 사용자: "레이드 체력바가 안 보인다").
      // ⚠ 보스는 world 의 치수로 태어난다 · Game 기준 치수를 쓰면 시대별 맵 크기가 켜지는 순간
      //   보스가 맵 밖에 태어나 아무 일도 안 일어난다.
      this.world.boss = createBoss(bt, this.world.width, this.world.height, this.world.terrain, diff, true);
      // 개체형(쫓아오는 개체)은 "보스", 전역 재난은 "시련"으로 부른다(시각·로직과 일치).
      this.stageLabel = `${isPredatorBoss(bt) ? "보스" : "시련"} · ${bossName(bt)}`;
      this.preview = `다가오는 위협. ${bossPreview(bt)}${survivalLine(bossPassNeeded(this.era), isPredatorBoss(bt))}`;
      // 드래프트가 화면을 덮어도 무엇과 싸우는 중인지 보이게, 대응 힌트만 짧게 붙들어 둔다.
      // 전문(preview)은 배너가 이미 띄웠고, 카드 고르는 자리에서 필요한 건 "무엇을 키워야 하나"다.
      this.threatText = `지금 위협 「${bossName(bt)}」 · ${bossCounter(bt)}`;
      this.stageTicksLeft = GAME.bossSeconds * SIM.stepsPerSecond;
    } else if (kind === "extinction") {
      // 예고와 실제가 일치하도록 미리 정해 둔 큐에서 꺼낸다(peek 로 예고한 종류 == 여기서 shift 되는 종류).
      const et = this.extinctionQueue.shift() ?? this.extRng.pick(EXTINCTION_TYPES);
      this.stageThreat = et;
      applyExtinction(this.world, et, diff);
      this.stageLabel = `대멸종 · ${extinctionName(et)}`;
      this.preview = `대멸종. ${extinctionPreview(et)}${survivalLine(extinctionPassNeeded(this.era))}`;
      this.threatText = `지금 위협 「${extinctionName(et)}」 · ${extinctionCounter(et)}`;
      this.stageTicksLeft = GAME.extinctionSeconds * SIM.stepsPerSecond;
    } else {
      this.stageLabel = "채집";
      this.preview = "";
      this.threatText = ""; // 채집 라운드에는 도는 위협이 없다
      this.stageTicksLeft = GAME.roundSeconds * SIM.stepsPerSecond;
      // 진도 0(이 게임을 처음 겪는 판의 첫 시대)에는 시험을 안 건다 — 그때 답해야 할 질문은
      // "무리를 먹여 키운다" 하나뿐이다. 이 한 줄로 판정·불씨 감소·목표 줄의 불씨 점·첫 안내 배너·
      // 드래프트 예고가 전부 연쇄로 꺼진다(전부 game.trial 을 보고 켜지므로).
      // pickTrial 은 전용 해시 Rng 라 건너뛰어도 스트림이 안 밀린다.
      if (!stepHasTrial(this.onboarding)) {
        this.currentTrial = null;
        this.pendingTrial = null;
      }
      // 시대 보상 드래프트가 예고한 시험이 있으면 그대로 쓴다(예고=실물). pop 기준점은 시험을
      // 만든 순간의 것을 유지한다(드래프트에서 스킵으로 낳은 새끼도 pop 점수에서 빠지게).
      else if (this.pendingTrial) {
        this.currentTrial = this.pendingTrial;
        this.pendingTrial = null;
      } else {
        this.currentTrial = this.pickTrial();
        this.trialSkipBroodBase = this.skipBroodTotal; // 이 시험의 pop 기준점(이후 스킵 새끼는 제외)
      }
      // 시험을 세계에 실제로 찍는다(자리·표식). 종류가 그걸 안 쓰면 세계는 그대로다.
      this.armTrial(this.currentTrial);
    }
  }

  private finishStage(survivedTimer: boolean, bossDefeated = false): void {
    const kind = this.currentKind();
    const threat = this.stageThreat;
    this.clearStageState();

    /**
     * 분석 기록 · 이 단계가 어떻게 끝났나를 **나가는 갈래마다** 한 번씩 적는다.
     * 아래 return 이 넷이라 마지막에 몰아 적을 수가 없다 · 빠뜨리면 그 단계가 코드에서 통째로 사라진다.
     */
    const recordStage = (passedFlag: boolean, trialRec: TrialRecord | null): void => {
      this.runLog.push({
        t: "stage",
        kind,
        era: this.era,
        boss: threat !== null && isBossThreat(threat) ? threat : null,
        extinction: threat !== null && !isBossThreat(threat) ? threat : null,
        passed: passedFlag,
        defeated: bossDefeated,
        pop: this.world.playerPopulation,
        trial: trialRec,
      });
    };

    if (!survivedTimer) {
      recordStage(false, null);
      this.endRun("lose");
      return;
    }

    // 통과기준은 절대 수(소수 개체 게임) — 개체가 맵 크기와 무관하게 소수라 기준도 고정.
    // 레이드: 보스를 **격퇴**했으면 개체 수와 무관하게 통과("직접 잡았다"). 못 잡아도 3마리 버티면 통과
    // (사용자 방향: 버티기도 통과는 되되 — 처치 보상·버티기 페널티는 후속 단계). 대멸종은 형질 필터.
    // 기준은 시대마다 오른다(1 · 2 · 3 · 4 · 6마리). 예고 문구가 읽는 함수와 같은 함수라 어긋날 수 없다.
    let passed = true;
    if (kind === "boss") passed = bossDefeated || this.world.playerPopulation >= bossPassNeeded(this.era);
    else if (kind === "extinction") passed = this.world.playerPopulation >= extinctionPassNeeded(this.era);

    if (!passed) {
      recordStage(false, null);
      this.endRun("lose");
      return;
    }

    // 라운드 시험 판정(채집 단계만) · 불합격은 런을 끊지 않고 불씨 하나를 대가로 치른다. 불씨 0 = 패배.
    const trial = kind === "forage" ? this.currentTrial : null;
    if (trial) {
      const prog = this.trialProgress;
      const trialPassed = prog >= trial.target;
      if (!trialPassed) this.embers -= 1;
      // **초과 달성 보상** — **[사용자 2026-08-06]** 목표를 크게 넘겨 합격하면 불씨가 하나 돌아온다.
      // 지금 회복은 보스 격퇴·시대 진입 둘뿐인데 둘 다 큰 사건이라 **위기의 순간과 어긋난다.**
      // 초과 달성은 매 시험마다 있어, 잘하는 판이 애초에 불씨 하나까지 몰리지 않게 한다.
      // ⚠ 「무리」 시험은 제외한다 · 제외 목록은 `TRIAL_EXCEED_EXCLUDED` 한 곳에 있고(이유도 거기),
      //   화면에 그 조건을 적는 자리가 같은 상수를 읽는다.
      const overachieved =
        trialPassed &&
        !TRIAL_EXCEED_EXCLUDED.includes(trial.kind) &&
        prog >= Math.ceil(trial.target * GAME.trialOverachieveMul);
      if (overachieved) {
        this.embers = Math.min(GAME.emberMax, this.embers + 1);
        // 방울도 같은 자리에서 떨어진다. 불씨는 상한에 걸려 사라질 수 있지만(가득 차 있으면 +1 이
        // 아무것도 아니다) 방울에는 상한이 없어, 잘 친 시험이 언제나 무언가를 남긴다.
        this.awardGenes("trialExceed");
      }
      const verdict: TrialVerdict = {
        passed: trialPassed,
        trial,
        progress: prog,
        embersLeft: this.embers,
        overachieved,
      };
      this.lastVerdictValue = verdict; // 곧 열릴 카드창이 제목 자리에 싣는다(플래시는 그 창에 가린다)
      this.onTrialVerdict?.(verdict);
      recordStage(true, {
        kind: trial.kind,
        target: trial.target,
        progress: prog,
        passed: trialPassed,
        overachieved,
      });
      if (this.embers <= 0) {
        this.loseReason = "embers";
        this.endRun("lose");
        return;
      }
    } else {
      recordStage(true, null);
    }

    // 보고서: 위협을 넘긴 순간(연대기). stageLabel 은 "보스 · 약탈자" · "대멸종 · 혹독한 추위" 형태.
    if (kind === "boss") {
      if (bossDefeated) {
        this.embers = Math.min(GAME.emberMax, this.embers + 1); // 격퇴 보상: 불씨 하나 회복
        // 격퇴한 자리에 방울이 떨어진다. **버틴 것에는 안 준다** · 직접 잡은 것과 시간이 흐른 것은
        // 다른 사건이고, 이 차이가 「위협을 잡으러 가는 이유」다.
        this.awardGenes("boss");
      }
      this.logEvent("boss", bossDefeated ? `${this.stageLabel} 처치` : `${this.stageLabel} 버팀`);
    } else if (kind === "extinction") {
      // 대멸종을 견딘 방울. ⚠ 이 방울은 **이 세계에서는 못 줍는다** · 대멸종은 SCHEDULE 의 마지막
      // 단계라 바로 아래에서 런이 끝나고, 이어가면 세계가 통째로 새로 만들어진다. 그래서
      // `continueToNextEra` 가 안 주운 방울을 새 세계로 옮겨 놓는다(거기서 걸어가 밟으면 주워진다).
      this.awardGenes("extinction");
      this.logEvent("extinction", `${this.stageLabel} 견딤`);
    }

    this.stageIndex += 1;
    if (this.stageIndex >= SCHEDULE.length) {
      this.endRun("win");
      return;
    }
    // 라운드 도중에 오른 레벨의 카드를 여기서 고른다(판정 → 카드 → 다음 라운드).
    // 고르고 나면 afterDraftPick 이 beginStage 로 잇는다.
    if (this.openPendingDraft()) return;
    this.beginStage();
  }

  private clearStageState(): void {
    this.world.boss = null;
    this.world.globalCold = 0;
    this.world.heat = 0;
    this.world.foodRegrowMultiplier = 1;
    this.world.plagueRate = 0;
    // 내려 둔 뜻도 라운드와 함께 끝난다. beginStage 가 아니라 **여기서** 거두는 이유: 라운드가 끝나고
    // 카드창이 열리는 동안 beginStage 는 아직 안 돈다 · 그 사이 낡은 좌표가 남아 있으면 안 된다.
    this.world.herdOrder = null;
  }

  /** 저장본에서 메타(누적 경험치 → 레벨·리롤 해금 · 끝낸 런 수)를 다시 읽어 필드에 반영.
   *  런 시작·디버그 변경 시 호출. 런 도중에는 안 바뀌므로 진도가 판 중간에 튀지 않는다. */
  private reloadMeta(): void {
    const meta = loadMeta();
    this.metaLvl = metaLevel(meta.metaXp);
    this.metaRerollUnlocked = isRerollUnlockedAtLevel(this.metaLvl);
    this.everConquered = meta.conquered;
    this.runsCompletedNow = meta.runsCompleted;
    this.runsDone = meta.runsCompleted;
  }

  private endRun(result: RunResult): void {
    this.phase = "result";
    this.result = result;
    // 보고서: 종료 시점 최종 샘플(멸종이면 개체 수가 0으로 떨어지는 게 그래프에 남는다) + 끝 사건.
    this.sampleRun();
    this.logEvent(
      "end",
      result === "win"
        ? this.isFinalEra
          ? "정복"
          : "정점 등극"
        : this.loseReason === "embers"
          ? "불씨 꺼짐"
          : "멸종",
    );
    // 런이 진짜 끝났을 때만(멸종 또는 정복) 메타 경험치 적립 + 해금. 중간 시대 승리는 "다음 시대로"
    // 이어지므로 적립하지 않는다(그때는 endRun 이 canContinue=true 로 뜨지만 런은 계속된다 → progress=null).
    const conquered = result === "win" && this.isFinalEra;
    // 분석 기록 · 이 시대가 어떻게 닫혔나. 이어가는 승리도 여기서 한 줄 남으므로 **시대별 결과**가 다 보인다.
    const endReason: EndReason =
      result === "win"
        ? conquered
          ? "conquer"
          : "eraWin"
        : this.loseReason === "embers"
          ? "embers"
          : this.world.playerPopulation === 0
            ? "extinct"
            : "gate";
    this.runLog.push({ t: "end", win: result === "win", reason: endReason, era: this.era, level: this.level });
    const runOver = result === "lose" || conquered;
    // 성적(도달 레벨·시대·정복)만큼 메타 경험치가 쌓여 플레이어 레벨이 오른다 → 종료 화면에서 애니메이션.
    const progress: RunProgress | null = runOver ? recordRunComplete(this.level, this.era, conquered) : null;
    // 비동기 생물(S2) — 시대 2 이상까지 간(또는 정복한) 종은 "기억할 만한 챔피언"으로 저장해 다음 런의
    // 세계에 다시 등장시킨다. 게놈은 성장한 현재 형태 그대로(versioned 직렬화).
    if (runOver && (conquered || this.era >= 1)) {
      const champ: Champion = {
        name: championName(this.genome, conquered),
        genome: cloneGenome(this.genome),
        era: this.era,
        // 색을 살짝 흔든다 — 같은 프리셋으로 저장한 챔피언들이 똑같은 색이라 못 알아보던 문제(사용자 지적).
        color: jitterColor(this.playerColor ?? 0x6cc24a),
      };
      saveChampion(champ);
    }
    // 도전 과제 — 중간 시대 승리에서도 판정한다("정점 등극"은 첫 승리에 열려야 한다). finished 는 런이
    // 진짜 끝났는지(멸종·정복)를 알려 "첫 발자국" 같은 완주 과제만 그때 열리게 한다.
    const achieveSummary: RunSummary = {
      finished: runOver,
      won: result === "win",
      conquered,
      era: this.era,
      level: this.level,
      peakPopulation: this.peakPopulation,
      genome: this.genome,
      rerollsUsed: this.rerollsUsed,
    };
    this.newAchievements = evaluateRun(achieveSummary);
    // 승리면 "다음 시대로" 이어갈 수 있다(brotato식 난이도 루프) — 단 마지막 시대(정복)면 더는 없다.
    this.onResult?.(
      result,
      this.buildSummary(result),
      result === "win" && !this.isFinalEra,
      progress,
      this.newAchievements,
    );
  }

  /** 디버그 전용(?dev) — 메타 레벨을 바로 세팅해 해금·리롤을 즉시 이 런에 반영(반복 플레이 없이 테스트). */
  debugSetMetaLevel(level: number): void {
    debugSetMetaLevel(level);
    this.reloadMeta();
    // 드래프트 중이면 리롤 가용을 즉시 반영해 지금 화면에서 바로 확인할 수 있게 한다(패널 재표시).
    if (this.phase === "draft" && !this.firstChoice) {
      this.rerollsLeft = this.metaRerollUnlocked ? GAME.rerollsPerDraft : 0;
      this.onDraft?.(this.draftCards, this.preview);
    }
  }

  /** 디버그 전용(?dev) — 메타 경험치를 더하고 진척도를 반환(종료 화면 애니메이션을 반복 없이 재생). */
  debugGrantMetaXp(amount: number): RunProgress {
    const progress = debugGrantMetaXp(amount);
    this.reloadMeta();
    return progress;
  }

  /** 디버그 전용(?dev) — 저장된 진행도(레벨·챔피언)를 전부 지우고 첫 플레이 상태로(즉시 이 런에 반영). */
  debugReset(): void {
    this.resetSavedProgress();
  }

  /**
   * 저장 데이터를 전부 지운다 · 첫 플레이 상태로. 로비의 "저장 데이터 지우기"가 부른다.
   * 쌓인 해금 때문에 새 기능을 첫 플레이 조건에서 시험할 수 없다는 문제(2026-08-03 사용자)의 답이다.
   *
   * ⚠ 네 곳을 다 지워야 한다: 메타 경험치·정복 / 챔피언 / 도전 과제 / 꾸밈.
   * 예전 `debugReset` 은 앞의 둘만 지워 도전 과제와 꾸밈이 살아남았다.
   */
  resetSavedProgress(): void {
    debugResetProgress(); // 메타 경험치·정복 + 챔피언(명예의 전당)
    debugResetAchievements(); // 도전 과제 + 그것으로 연 꾸밈
    this.reloadMeta(); // 메타 레벨·리롤 잠금을 이번 런에 즉시 반영
    this.champions = loadChampions(); // 비워진 챔피언(다음 런부터 안 나온다)
  }

  /**
   * 승리 후 "다음 시대로" — 게놈·레벨(성장)을 유지한 채 새 맵·더 센 위협으로 다시 시작한다.
   * era 를 올려 위협 강도(보스·대멸종)가 세지고, 통과기준은 그대로라 "성장이 난이도 상승을 앞서는가"의
   * 경주가 된다. 새 월드라 시작 무리는 초기화되지만, 종의 형질(게놈)과 레벨은 이어진다.
   */
  continueToNextEra(): void {
    if (this.result !== "win") return; // 승리 직후에만 유효
    this.era += 1;
    this.embers = Math.min(GAME.emberMax, this.embers + 1); // 시대를 넘긴 보상: 불씨 하나 회복
    this.currentTrial = null;
    this.logEvent("era", `시대 ${this.era + 1} 진입`);
    this.runLog.push({ t: "era", era: this.era });
    this.paused = false;
    this.result = null;
    this.stageIndex = 0;
    this.firstChoice = false; // 프리셋 재선택 없이 이어간다(이미 성장한 종)
    this.acc = 0;
    // 새 시대는 같은 원본 시드에서 새 맵·새 위협 순서를 파생(결정론 유지, 시대마다 다른 판).
    this.currentSeed = `${this.baseSeed}-era${this.era}`;
    this.stageRng = new Rng(`${this.currentSeed}-stage`);
    this.extRng = new Rng(`${this.currentSeed}-ext`);
    this.bossQueue = shuffle(BOSS_TYPES, this.stageRng);
    this.extinctionQueue = shuffle(EXTINCTION_TYPES, this.extRng);
    // 아직 안 주운 방울을 **옛 세계에서 떠 둔다**(세계를 갈아 끼우기 전에 해야 한다).
    // 왜 옮기는가: 「대멸종 생존」 방울은 시대의 **마지막 단계**에서 떨어져 주울 시간이 원리적으로
    // 0 이다. 그대로 두면 화면이 「대멸종 생존 · 방울 +4」라 말해 놓고 한 개도 안 주는 거짓말이 된다.
    // 공짜로 주는 것이 아니다 · 새 세계에서도 값과 사유는 그대로이고 **걸어가 밟아야** 주워진다.
    const carriedDrops = this.world.geneDrops
      .filter((d) => !d.taken)
      .map((d) => ({ amount: d.amount, reason: d.reason }));
    // 게놈은 유지(성장 이어짐). xp/레벨도 유지하되, 새 월드라 먹이·사냥 누적 기준값을 함께 리셋.
    this.world = this.makeWorld();
    this.lastFoodEaten = 0;
    // ⚠ 사냥 누계도 **반드시 함께** 되돌린다. 이 한 줄이 빠져 있어서, 새 World 의 사냥 수 0 에서
    //   직전 시대의 누계를 빼는 (0 − 누계) × huntXp 가 전환 직후 경험치에 그대로 들어갔다.
    //   실측(2026-08-07 · 프로브 계측): 전환마다 −85 ~ −2410. 사냥을 많이 한 판일수록 크게 깎여
    //   레벨 막대가 시대 초반 내내 멈춰 있었고, 진행률이 음수(%)로 표시되기도 했다.
    //   막고 나니 런당 카드가 다섯 프리셋 전부 +1.0~+1.5 늘었다(48시드).
    this.lastHuntKills = 0;
    // ⚠ 방울 누계도 **같은 자리에서** 되돌린다. 새 World 의 `geneCollected` 는 0 부터 시작하므로
    //   직전값을 안 지우면 다음 delta 가 음수가 되어 지갑이 영영 안 는다(위 사냥 누계와 같은 함정).
    //   ⚠ 지갑(`geneBankValue`)은 **안 비운다** · 시대가 바뀌는 것과 모은 것이 사라지는 것은 다르다.
    this.lastGeneCollected = 0;
    // ⚠ **위기 회복의 최고 기록도 새 세계와 함께 처음부터** 잰다. 이 한 줄이 없으면, 45마리까지 컸던
    //   시대를 넘어 시작 무리 18마리로 새 세계를 열자마자 「최고의 절반 아래」가 서고(18 < 45×0.5),
    //   자라서 41마리에 닿는 순간 위기 회복 방울이 나온다. 무리는 한 번도 무너진 적이 없고 **예정된
    //   세계 교체 뒤에 다시 자랐을 뿐**이라, 그건 회복이 아니다("위기 회복"이라는 이름이 거짓이 된다).
    //   최고가 37마리를 넘긴 시대라면 시대마다 반복된다 = 시대 수만큼 공짜 방울.
    //   지갑(geneBankValue)은 그대로 둔다 · 모은 것이 사라지는 것과 새 세계를 처음부터 재는 것은 다르다.
    this.crisisWatch = createCrisisWatch();
    this.stageXp = 0;
    // 성장한 종의 색·형질을 새 초기 무리에 반영(프리셋 선택 때와 같은 처리).
    if (this.playerColor !== undefined) this.world.playerSpecies.color = this.playerColor;
    for (const e of this.world.entities) {
      if (e.species.isPlayer) e.genome = cloneGenome(this.world.genome);
    }
    // 옛 세계에서 못 주운 방울을 새 무리 곁에 다시 놓는다(위 carriedDrops 주석 참고).
    // 자리는 새 세계의 `geneRng` 가 정하므로 기존 스트림을 1비트도 안 건드린다.
    for (const d of carriedDrops) this.dropGene(d.amount, d.reason);
    // **시대 보상 방울**(2026-08-11 · **[사용자 2026-08-11]** "4단은 찍지도 못했어" → 「시대 보상을
    // 방울로」 결정). v8 의 강화 ×N 이 사라진 자리를 방울이 잇는다 — 성장이 방울 한 갈래로 들어오는
    // v9 구조 그대로다(backlog 「시대 보상이 비어 있다 → 방울 보상으로 옮기는 것이 맞다」).
    // 새 무리 곁 필드에 떨어지므로 여전히 **걸어가 밟아야** 주워진다(지갑 직행 아님).
    this.awardGenes("era");
    this.onWorldChanged?.(this.world);
    // 첫 채집 단계로 바로 가지 않고, 먼저 "시대 보상" 드래프트를 띄운다(강해진 형질 하나 = 난이도 도약 보상).
    this.beginEraRewardDraft();
  }

  /**
   * 시대 보상 드래프트 — 시대를 넘을 때마다 카드 3장 중 하나를 더 고른다.
   *
   * ⚠ **v8 의 「강화 ×N」은 v9 에 없다.** 그건 뽑은 카드의 도장을 곱하는 것이었는데(`boostCard`),
   *   카드가 도장을 안 주므로 곱할 것이 사라졌다 · 아래 본문 주석과 `recordDraft` 참조.
   * 결정론: 시대 시드에서 파생한 독립 RNG.
   */
  private beginEraRewardDraft(): void {
    this.phase = "draft";
    this.eraReward = true;
    // 곧 시작할 단계가 채집이면 시험을 **지금** 뽑아 얼려 둔다 · upcomingTrial 예고와 beginStage 실물이
    // 같은 객체다. pickTrial 은 전용 해시 Rng 라 어떤 기존 스트림도 소비하지 않는다(결정론 불변).
    // 시험이 아직 안 열린 진도면 예고도 하지 않는다(예고와 실물은 같은 게이트를 봐야 한다).
    if (stepHasTrial(this.onboarding) && (SCHEDULE[this.stageIndex] ?? "forage") === "forage") {
      this.pendingTrial = this.pickTrial();
      this.trialSkipBroodBase = this.skipBroodTotal; // pop 기준점: 이 순간의 개체 수(스킵 새끼 이전)
    } else {
      this.pendingTrial = null;
    }
    const rng = new Rng(`${this.currentSeed}-erareward`);
    const drawn = drawCards(
      rng,
      3,
      (c) =>
        cardAvailable(c.id, this.metaLvl) &&
        cardPrereqMet(c, this.genome) &&
        !cardRedundant(c, this.genome),
      this.level, // 시대 보상도 지금까지 키운 레벨의 보정을 받는다
      this.pickedCounts(), // 이미 고른 카드는 뜸하게(반복 완화)
    );
    // ⚠ **v9 에서 「강화 ×N」이 사라졌다.** 그건 뽑은 카드의 도장을 곱하는 것이었는데(×2.0 → 4.9),
    //   카드가 도장을 안 주므로 곱할 것이 없다. 특성은 있거나 없거나라 배수를 못 매긴다.
    //   지금 이 화면은 **카드를 한 장 더 고르는 기회**일 뿐이고, 그만큼 시대를 넘은 보상이 얇아졌다.
    //   → 성장은 이제 방울 한 갈래로만 들어오므로, 이 자리의 보상도 **방울로 옮기는 것**이 맞다.
    //     값은 backlog 「2. 성장 속도 재측정」에서 프로브로 정한다 — 여기서 숫자를 지어내면
    //     그 순간 근거 없는 밸런스 상수가 하나 생긴다(이 저장소가 네 번 데인 자리).
    this.draftCards = drawn;
    this.rerollsLeft = this.metaRerollUnlocked ? GAME.rerollsPerDraft : 0;
    // 시대를 넘으면 온보딩 진도도 한 칸 오른다 → **이번에 새로 열린 것**을 여기서 한 줄로 알린다.
    // 시대 전환 직후 반드시 지나는 화면이라 가장 싼 자리다(따로 배너를 만들지 않는다). 진도가 안 올랐으면
    // (이미 온전한 세계면) 빈 줄이라 아무것도 안 붙는다.
    const step = this.onboarding;
    const opened = step > onboardingStep(this.runsDone, this.era - 1) ? onboardingOpenedLine(step) : "";
    // **지금 어디쯤인지를 이 화면에서 알아채게 한다.** 대백과에만 적으면 그건 안 끝난 작업이다
    // (CLAUDE.md 전달 규칙). 다음 문턱이 몇 개 남았는지 알려 주면, 곧바로 이어지는 드래프트에서
    // 막대가 실제로 그만큼 차는 것을 눈으로 본다.
    const near = nearestTierGoal(this.genome.pips);
    const goalLine = near
      ? `${CATEGORY_LABELS[near.cat]} ${TIER_ROMAN[near.tier]}까지 도장 ${near.need}개 남았습니다.`
      : "";
    this.preview =
      "새로운 시대에 들어섭니다. 지난 시대를 넘어선 보상으로 카드 하나를 더 고르세요. 지금 무리에 바로 물려집니다. " +
      goalLine +
      (opened === "" ? "" : ` ${opened}`);
    this.onDraft?.(this.draftCards, this.preview);
  }

  /** HUD 표시용 시대 라벨 — "시대 N / 5"로 지금 몇 번째인지·목표(정복)까지 얼마나 남았는지 항상 보인다. */
  get eraLabel(): string {
    return `시대 ${this.era + 1} / ${GAME.eraCap}`;
  }

  /** 마지막 시대인가(이 시대의 대멸종을 넘으면 정복=최종 승리, 더는 "다음 시대로"가 없다). */
  get isFinalEra(): boolean {
    return this.era >= GAME.eraCap - 1;
  }

  /** 이 혈통의 일생 기록(보고서 화면용) — 결과 화면에서 game.runHistory 로 읽어 연대기·형질 추이를 그린다. */
  get runHistory(): RunHistory {
    return {
      samples: this.runSamples.slice(),
      events: this.runEvents.slice(),
      durationSec: Math.round(this.runElapsedSec),
    };
  }

  /** 현재 경과 시간(초, 런 전체 누적 — 시대를 넘어도 이어짐). */
  private get runElapsedSec(): number {
    return this.runSteps / SIM.stepsPerSecond;
  }

  /**
   * **판 분석 코드의 알맹이** — 재현용(시드·선택 이력)과 관측용(그래서 어떻게 됐나)을 한 덩이로.
   *
   * 관측 쪽은 **새로 세지 않는다**: 개체 수 곡선은 `runSamples`, 사망 원인은 `world.deaths`,
   * 최종 도장·열쇠는 `genome` 을 그대로 읽는다. 같은 것을 두 곳에서 세면 반드시 조용히 갈라진다.
   *
   * ⚠ 챔피언(예전의 나)의 **게놈은 안 담는다** · 수만 담는다. 게놈 여덟 벌은 코드를 몇 배로 불려
   *   폰에서 복사할 수 없게 만든다. 그래서 챔피언이 도는 세계(진도 3)는 **완전 재현이 아니다** ·
   *   그 사실이 코드에 적혀 있어(champions 수) 디코더가 그렇게 말한다.
   */
  runCodeData(): RunCodeData {
    const live = this.runSamples.filter((s) => s.population > 0);
    const pops = this.runSamples.map((s) => s.population);
    const last = this.runSamples[this.runSamples.length - 1];
    const keys = KEY_NAMES.filter((k) => this.genome.keys[k]);
    return {
      ...currentCodeStamp(),
      header: {
        seed: this.baseSeed,
        mapType: this.currentMapType,
        metaLevel: this.metaLvl,
        runsDone: this.runsDone,
        champions: this.champions.length,
        everConquered: this.everConquered,
        rerollUnlocked: this.metaRerollUnlocked,
        leadEnabled: this.leadEnabled,
        assistEnabled: this.assistEnabled,
      },
      entries: this.runLog.slice(),
      summary: {
        durationSec: Math.round(this.runElapsedSec),
        popMax: pops.length > 0 ? Math.max(...pops) : 0,
        // **살아 있던 가장 적은 수.** 0 은 멸종이라 곡선의 정보가 아니다(끝값이 이미 말한다).
        popMin: live.length > 0 ? Math.min(...live.map((s) => s.population)) : 0,
        popEnd: last ? last.population : this.world.playerPopulation,
        popPeak: this.peakPopulation,
        era: this.era,
        level: this.level,
        rerollsUsed: this.rerollsUsed,
        pips: { ...this.genome.pips },
        keys: [...keys],
        deaths: { ...this.world.deaths },
        geneEarned: this.geneEarnedTotal,
        geneSpent: this.geneSpentTotal,
        geneLeft: this.geneBankValue,
      },
    };
  }

  /** 판 분석 코드 문자열(`SP1-...`). 런 보고서 화면이 복사 버튼에 싣는다. */
  runCode(): string {
    return encodeRunCode(this.runCodeData());
  }

  /** 보고서에 사건 하나 기록(현재 경과 시각으로). */
  private logEvent(kind: RunEventKind, label: string): void {
    this.runEvents.push({ t: Math.round(this.runElapsedSec), kind, label });
  }

  /** 시계열 샘플 하나 — 현재 개체 수 + 무리 평균 형질. game 층 읽기라 sim rng 미소비(결정론 무관). */
  private sampleRun(): void {
    this.runSamples.push({
      t: Math.round(this.runElapsedSec),
      population: this.world.playerPopulation,
      traits: this.playerTraitAverages(),
    });
  }

  /** 지금 살아있는 내 무리의 평균 형질(변이 6종). 개체가 없으면 0들. 개체별 게놈을 평균해 진화 추이를 낸다. */
  private playerTraitAverages(): Record<MutableTrait, number> {
    const avg = {} as Record<MutableTrait, number>;
    for (const k of MUTABLE_TRAITS) avg[k] = 0;
    let n = 0;
    for (const e of this.world.entities) {
      if (e.species.isPlayer && e.alive) {
        for (const k of MUTABLE_TRAITS) avg[k] += e.genome.traits[k];
        n += 1;
      }
    }
    if (n > 0) for (const k of MUTABLE_TRAITS) avg[k] = Math.round(avg[k] / n);
    return avg;
  }

  private buildSummary(result: RunResult): string {
    // 승패 한 줄 + "이 종은 어떤 종이었나" + 사망 원인 집계를 합쳐 정산 본문을 만든다(가독성, §7).
    return buildRunReport(this.baseSummary(result), this.genome, this.world.deaths);
  }

  private baseSummary(result: RunResult): string {
    if (result === "win") {
      if (this.isFinalEra)
        return `모든 시대(${GAME.eraCap})를 정복했습니다! 당신의 종이 이 세계의 정점입니다.`;
      if (this.era > 0) return `${this.era + 1}번째 시대의 대멸종까지 견뎌내고 정점을 지켰습니다.`;
      return "대멸종을 견뎌내고 정점에 올랐습니다. 더 험한 다음 시대로 나아갈 수 있습니다.";
    }
    if (this.loseReason === "embers")
      return "혈통의 불씨가 꺼졌습니다. 시험에 거듭 져 남은 기회를 모두 잃었습니다.";
    const kind = this.currentKind();
    if (kind === "boss") return `${this.stageLabel} 관문을 넘지 못했습니다.`;
    if (kind === "extinction") return "대멸종을 견디지 못했습니다.";
    return `${this.stageNumber}단계에서 멸종했습니다.`;
  }
}

/** 챔피언 이름 — 가장 두드러진 형질로 별명 + 정복/생존 칭호(비동기 생물이 등장할 때 왕관과 함께 표시). */
// 챔피언(예전의 내 종) 이름 — 최고 형질에서 별칭을 뽑되, **별칭·칭호를 여러 후보에서 무작위로** 골라
// 같은 빌드라도 이름이 안 겹치게 한다(사용자 지적: "맹아의 생존자"가 같은 색으로 둘 있어 못 알아본다).
// 게임 층이라 Math.random 허용(sim 결정론과 무관 — 이름은 저장 시 한 번 정해진다).
const CHAMPION_EPITHETS: Record<string, readonly string[]> = {
  speed: ["질풍", "쏜살", "바람발", "번개"],
  attack: ["맹아", "폭군", "야수", "사나운 이빨"],
  vision: ["천리안", "매의 눈", "먼눈", "밝은 눈"],
  fertility: ["번성", "다산", "만생", "불어남"],
  herding: ["결속", "무리", "동맹", "한 몸"],
  metabolism: ["불꽃", "열혈", "잿불", "화톳불"],
  swimming: ["심해", "물살", "해류", "깊은 물"],
  wings: ["창공", "하늘", "바람날개", "높이"],
  venom: ["독아", "맹독", "검은 이빨", "쐐기"],
  ranged: ["원사", "먼 사냥", "쏘는 손", "긴 팔"],
  echo: ["음파", "메아리", "밤귀", "울림"],
};
const CHAMPION_SURVIVOR = ["생존자", "방랑자", "후예", "잔존자", "그림자", "떠돌이"];
const CHAMPION_CONQUEROR = ["정복자", "군주", "패왕", "전설", "왕", "우두머리"];

/** 색을 무작위로 살짝 흔든다(챔피언 구분용). 각 채널을 ±이 정도로 밀되 0~255 로 클램프. Math.random 허용(게임 층). */
function jitterColor(color: number): number {
  const j = (): number => Math.round((Math.random() - 0.5) * 56); // ±28
  const cl = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
  const r = cl(((color >> 16) & 0xff) + j());
  const g = cl(((color >> 8) & 0xff) + j());
  const b = cl((color & 0xff) + j());
  return (r << 16) | (g << 8) | b;
}

function championName(g: Genome, conquered: boolean): string {
  const t = g.traits;
  const pairs: [number, string][] = [
    [t.speed, "speed"], [t.attack, "attack"], [t.vision, "vision"], [t.fertility, "fertility"],
    [t.herding, "herding"], [t.metabolism, "metabolism"], [t.swimming, "swimming"], [t.wings, "wings"],
    [t.venom, "venom"], [t.ranged, "ranged"], [t.echo, "echo"],
  ];
  pairs.sort((a, b) => b[0] - a[0]);
  const topKey = pairs[0]?.[1] ?? "attack";
  const pool = CHAMPION_EPITHETS[topKey] ?? ["무명"];
  const epithet = pool[Math.floor(Math.random() * pool.length)] ?? "무명";
  const titles = conquered ? CHAMPION_CONQUEROR : CHAMPION_SURVIVOR;
  const title = titles[Math.floor(Math.random() * titles.length)] ?? (conquered ? "정복자" : "생존자");
  return `${epithet}의 ${title}`;
}

// 런 시드를 무작위로 하나 뽑는다(게임 층이라 Math.random 사용 가능 — sim 결정론과 무관).
function randomSeed(): string {
  return "r" + Math.floor(Math.random() * 0xffffffff).toString(36);
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * 위협 예고 끝에 붙는 **생존 기준 한 줄** — "이번 시대를 넘으려면 몇 마리가 살아남아야 하는가".
 *
 * 왜 반드시 붙이나: 기준을 안 보여 주면 관문에서 지는 순간이 "허무하게 졌다"가 된다(2026-07-16 에
 * 기준을 3 → 1 로 내린 이유가 바로 그것이었다). 미리 못박아 두면 같은 패배가 **"알고도 못 지켰다"** 가
 * 된다. 첫 시대(1마리)는 곧 "완전 멸종만 패배"라 굳이 겁을 주지 않는다.
 */
function survivalLine(need: number, killable = false): string {
  if (need <= 1) return "";
  // ⚠ 보스는 **물리치기만 하면 개체 수와 무관하게 통과**한다(finishStage: bossDefeated || pop >= need).
  //   그래서 조건 없이 "N마리가 살아남아야 합니다"라고만 하면 화면이 실제 규칙보다 겁을 준다.
  //   때릴 수 있는 보스에는 "물리치지 못하면"을 붙여 두 갈래를 다 말한다. 대멸종·전역 시련은 때릴
  //   대상이 없어 생존만이 길이므로 그대로 단언한다.
  if (killable) return ` 물리치지 못하면 ${need}마리가 살아남아야 합니다.`;
  return ` 이 시대를 넘으려면 ${need}마리가 살아남아야 합니다.`;
}

function extinctionName(type: ExtinctionType): string {
  if (type === "cold") return "혹독한 추위";
  if (type === "famine") return "대가뭄";
  if (type === "plague") return "대역병";
  return "폭염";
}

/** 대멸종 대응 힌트(예고 전광판 부제) — 이 형질을 키우면 버틴다(보스의 bossCounter 와 대칭, 짧게). */
function extinctionCounter(type: ExtinctionType): string {
  if (type === "cold") return "뜨거운 피(높은 대사)라야 얼지 않고 버팁니다";
  if (type === "famine") return "에너지를 아끼고 수가 많아야 버팁니다";
  if (type === "plague") return "번식력이 높아야 스러진 수를 메웁니다";
  return "느린 대사라야 타지 않고 버팁니다";
}

/**
 * 대멸종 예고 한 줄.
 *
 * ⚠ **여기는 「무엇이 죽이는가」를 실제와 맞춰 적어야 하는 자리다**(전달 규칙: 수치가 화면 표시와
 *   다르면 그건 거짓말이다). 2026-08-09 실측에서 이 넷의 예고가 전부 **실제 사인과 달랐다**:
 *   자란 무리(가죽 IV단)에게 재난이 직접 죽인 개체는 **0.0명**이고, 죽은 것은 전부 **굶주림**이었다
 *   (시대 3 · 시드 8 · `probe extinction`: 굶음 54~131 대 직접 0.0).
 *   재난이 **야생 생태를 함께 쓸어서**(같은 판에서 야생 157 → 16, −90%) 먹이 사슬이 끊기기 때문이다.
 *   그런데 옛 예고는 「얼어 죽습니다」·「타 죽습니다」처럼 **직접 사인만** 말했다. 사람은 화면이
 *   시킨 대비를 하고도 다른 이유로 죽었고, 그래서 「왜 졌는지 모르는데 졌다」가 됐다(기획서 §4.2 위반).
 *
 * 그래서 두 가지를 반드시 함께 적는다: ① 재난이 **먹이를 함께 앗아간다**는 것
 * ② 그 판에서 **실제로 듣는 대비**. 재는 자는 `npm run probe -- extinction` 이다.
 */
function extinctionPreview(type: ExtinctionType): string {
  if (type === "cold")
    return "혹독한 추위가 닥칩니다. 먹이도 다른 생물도 함께 얼어붙어, 대개는 굶주림으로 무너집니다. 뭉쳐 있으면 서로 덥혀 줍니다.";
  if (type === "famine")
    return "대가뭄이 옵니다. 먹이가 다시 자라지 않습니다. 에너지를 아끼고 수가 많아야 버팁니다.";
  if (type === "plague")
    return "대역병이 번집니다. 앓다 스러진 자리를 메울 만큼 번식이 빨라야 하고, 먹잇감도 함께 줄어듭니다.";
  return "폭염이 옵니다. 들판이 마르고 먹잇감이 흩어져, 타 죽기보다 굶어 죽는 일이 많습니다.";
}

// 대멸종 강도를 세팅한다. mul(era 난이도 배율)로 시대가 오를수록 더 혹독하게. mul=1(첫 시대)이면 기존과 동일.
/**
 * 대멸종을 세계에 건다. **세기는 `EXTINCTION`(config) 한 곳에만 적혀 있다** — 여기에 숫자를 다시
 * 쓰면 프로브가 게임과 다른 세계를 재게 된다(2026-08-09 · 그래서 재난을 실제로 잰 적이 없었다).
 */
function applyExtinction(world: World, type: ExtinctionType, mul = 1): void {
  if (type === "cold") world.globalCold = EXTINCTION.cold * mul;
  else if (type === "famine") world.foodRegrowMultiplier = EXTINCTION.famine * mul;
  else if (type === "plague") world.plagueRate = EXTINCTION.plague * mul;
  else world.heat = EXTINCTION.heat * mul;
}
