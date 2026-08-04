// 게임 상태기계 (런/라운드). 한 런 = 한 혈통의 일생.
// 런은 단계 계획(SCHEDULE)을 따른다. 각 단계 앞에 드래프트가 붙는다.
//   forage     채집 라운드 (그냥 살아남고 수를 불린다)
//   boss       보스 게이트 (버티기: 끝까지 기준 개체 수 생존하면 통과)
//   extinction 대멸종 피날레 (환경 적합도 필터: 통과하면 승리)
// 멸종(개체 0)하면 그 자리에서 패배. 게놈은 런 내 누적, 새 런에서 리셋.

import { World } from "@/sim/world";
import { Rng } from "@/sim/rng";
import { defaultGenome, cloneGenome, isApexTrait, MUTABLE_TRAITS, TRAIT_CEILING, TRAIT_KEYS, type Genome, type MutableTrait, type Traits } from "@/sim/genome";
import { drawCards, applyCard, boostCard, cardPrereqMet, cardRedundant, PRESET_CARDS, PRESET_LINEAGE, type Card, type Lineage } from "@/game/cards";
import { cardAvailable, debugResetAchievements, evaluateRun, type Achievement, type RunSummary } from "@/game/achievements";
import { GAME, SCHEDULE, eraDifficulty, eraScarcity, type StageKind } from "@/game/config";
import { loadMeta, metaLevel, isPresetUnlocked, isRerollUnlockedAtLevel, recordRunComplete, debugSetMetaLevel, debugGrantMetaXp, debugResetProgress, loadChampions, saveChampion, type RunProgress, type Champion } from "@/game/meta";
import { SIM } from "@/sim/params";
import { grazeEfficiency } from "@/sim/behavior";
import type { LeadCommand } from "@/sim/lead";
import { createBoss, bossPreview, bossName, bossCounter, isPredatorBoss, bossEligible, BOSS_TYPES, type BossType } from "@/sim/boss";
import { pickMapType, mapKind, type MapKind, type MapType } from "@/sim/mapType";
import { TILE } from "@/sim/terrain";
import { buildRunReport } from "@/game/runReport";

export type Phase = "lobby" | "draft" | "watch" | "result";
export type RunResult = "win" | "lose";

export type ExtinctionType = "cold" | "famine" | "heat" | "plague";

/** 라운드 시험의 종류. */
export type TrialKind = "hunt" | "feed" | "birth" | "pop";

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
  readonly width: number;
  readonly height: number;
  /** 월드 면적 배율(화면 1개=1). 맵 확장 시 개체·먹이·통과기준을 면적 비례로 키운다. */
  readonly areaScale: number;

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
  /** 이번 런에서 "다시 뽑기"(리롤)가 열려 있는가 — 메타 레벨이 리롤 티어 이상이면 true(런 시작 시 고정). */
  private metaRerollUnlocked = false;
  /** 현재 드래프트에서 남은 리롤 횟수(드래프트가 열릴 때 리셋). 프리셋 선택엔 리롤 없음. */
  private rerollsLeft = 0;

  /** 비동기 생물(S2) — 이 런의 세계에 등장시킬 지난 챔피언들. 런 시작 시 저장본에서 읽어 makeWorld 로 넘긴다. */
  private champions: Champion[] = [];

  // 레벨업(형질 성장) — 시간/단계 전환이 아니라 "먹이 경험치"로 레벨을 올려 형질을 얻는다.
  // 레벨 = 세대: 레벨업해서 고른 형질은 그 뒤로 태어난 개체에게만 물려진다(세대별 적용 — 후속 슬라이스).
  level = 1; // 시작 프리셋 = 1레벨
  xp = 0; // 현재 레벨에서 쌓은 경험치(먹은 먹이 수)
  xpToNext: number = GAME.xpBase; // 다음 레벨까지 필요한 경험치(GAME.xpBase 는 리터럴이라 number 명시)
  private lastFoodEaten = 0; // world.playerFoodEaten 직전 값(매 update 의 delta 를 xp 로 누적)

  // 런 보고서(연대기 + 형질 추이) — 이 혈통의 일생을 game 층에서만 기록한다(world/sim rng 미소비 →
  // 결정론·밸런스 무관). 시대를 넘어가도 이어서 누적하고, 새 런(setupRun)에서만 비운다.
  private runSamples: RunSample[] = [];
  private runEvents: RunEvent[] = [];
  private runSteps = 0; // 런 전체 누적 스텝(시대 넘어가도 이어짐) → 경과 초 = runSteps / stepsPerSecond

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
   * 방금 고른 카드로 **막 정점(100)에 닿은** 형질들. `takeNewApex()` 로 꺼내 가면 비워진다.
   *
   * 훅(onApex)이 아니라 "꺼내 가는 큐"인 이유: 훅은 `pickCard` 안에서 **동기로** 불려 드래프트 화면이
   * 아직 떠 있는 순간에 연출이 터진다(카드 뒤에 가려 안 보인다). main 은 `draft.hide()` 뒤에 꺼내
   * 연출을 띄운다 — 순서를 부르는 쪽이 쥐게 한다.
   */
  private newApex: (keyof Traits)[] = [];

  /** 막 정점에 닿은 형질을 꺼내 간다(꺼내면 비워진다). 화면이 도달 연출을 띄우는 데 쓴다. */
  takeNewApex(): (keyof Traits)[] {
    const out = this.newApex;
    this.newApex = [];
    return out;
  }

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

  constructor(width: number, height: number, areaScale = 1) {
    this.width = width;
    this.height = height;
    this.areaScale = areaScale;
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
    this.genome = defaultGenome();
    this.world = this.makeWorld();
    this.phase = "lobby";
    this.onWorldChanged?.(this.world);
  }

  pickCard(index: number): void {
    if (this.phase !== "draft") return;
    const card = this.draftCards[index];
    // 정점(100)에 **막 닿는 순간**을 잡으려면 적용 전 값을 떠 둬야 한다. 정점은 수치가 커지는 게 아니라
    // 그 형질의 약점이 사라지는 보상이라, 도달 순간에 알려 주지 않으면 화면에서 영영 안 읽힌다.
    const before: Partial<Record<keyof Traits, number>> = {};
    for (const key of TRAIT_KEYS) before[key] = this.genome.traits[key];
    if (card) {
      applyCard(this.genome, card);
      this.pickedCardNames.push(card.name);
      this.pickedCardIds.push(card.id);
      for (const key of TRAIT_KEYS) {
        const was = before[key] ?? 0;
        if (!isApexTrait(key, was) && isApexTrait(key, this.genome.traits[key])) this.newApex.push(key);
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
        for (const e of this.world.entities) {
          if (e.species.isPlayer && e.alive) applyCard(e.genome, card);
        }
        // **정점은 종 단위 성취다** — 기준선이 100 에 닿는 순간 살아있는 무리 전체가 정점이어야 한다.
        // 카드만 각자에게 적용하면 안 된다: 개체는 **자기 값** 기준으로 상한 근접 감쇠를 받으므로(변이로
        // 기준선보다 낮은 개체는 같은 카드로 덜 오른다) 기준선은 100 인데 무리는 95~99 에 흩어진 채
        // 남는다. 그러면 화면은 "정점!"이라 외치는데 정작 무리는 정점 효과(험지 면제 등)를 못 누린다.
        // 변이는 정점을 **만들지 않으므로**(genome.mutateGenome) 이 스냅이 정점의 유일한 입구다.
        for (const key of this.newApex) {
          for (const e of this.world.entities) {
            if (e.species.isPlayer && e.alive) e.genome.traits[key] = TRAIT_CEILING[key];
          }
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
   * 무리에게 뜻을 내린다(신탁). 월드 좌표 한 점. null 이면 지시를 거둔다 = 완전 자율(관전).
   * 관전 중·멈춤 아님일 때만 닿는다 · 드래프트·결과 화면의 탭이 무리를 움직이지 않게.
   */
  setHerdOrder(x: number, y: number): void {
    if (this.phase !== "watch" || this.paused) return;
    this.world.herdOrder = { x, y };
  }

  /** 내려 둔 뜻을 거둔다(무리는 그 자리에서 자율로 산다). */
  clearHerdOrder(): void {
    this.world.herdOrder = null;
  }

  /** 지금 내려져 있는 뜻(화면에 표식을 그리는 데 쓴다). */
  get herdOrder(): { x: number; y: number } | null {
    return this.world.herdOrder;
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
    // 알파를 세우지 않는다 · 무리 지시로 전환하면서 "앞장선 한 마리"라는 개념 자체가 없어졌다.
    // armLead 를 안 부르므로 lead.leaderId 는 -1 로 남고, sim 의 알파 분기는 한 번도 안 걸린다.
    this.acc += deltaMS;
    let guard = 0;
    while (this.acc >= stepMs && guard < 5) {
      this.acc -= stepMs;
      guard += 1;
      // 배속만큼 한 번에 여러 스텝 진행.
      for (let s = 0; s < this.speed; s++) {
        this.world.step();
        if (this.world.playerPopulation > this.peakPopulation) this.peakPopulation = this.world.playerPopulation;
        this.stageTicksLeft -= 1;
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

  /** 먹이 섭취 delta 를 경험치로 누적하고, 임계 도달 시 레벨업(형질 드래프트)한다. */
  private updateXp(): void {
    const eaten = this.world.playerFoodEaten;
    let gain = eaten - this.lastFoodEaten;
    this.lastFoodEaten = eaten;
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
    if (this.pendingLevels <= 0) return false;
    this.pendingLevels -= 1;
    this.boundaryDraft = true;
    this.phase = "draft";
    // 메타 언락: 열린 카드만 드래프트 풀에(잠긴 특화 카드는 런을 거듭해 해금).
    // 언락된 카드 중, 이 종에 이미 무의미한 카드(예: 이미 나는데 날개 카드)는 뺀다 · "손해 카드" 방지(폰 피드백).
    this.draftCards = drawCards(
      this.draftRng,
      3,
      (c) =>
        cardAvailable(c.id, this.metaLvl) &&
        cardPrereqMet(c, this.genome.traits) &&
        !cardRedundant(c, this.genome.traits),
      this.level, // 레벨이 오를수록 높은 등급이 더 자주 뜬다(rarityWeightsAtLevel)
      this.pickedCounts(), // 이미 고른 카드는 뜸하게(반복 완화)
      this.lineage ?? undefined, // 3장 중 1장은 내 갈래 전용 카드
    );
    this.rerollsLeft = this.metaRerollUnlocked ? GAME.rerollsPerDraft : 0;
    this.preview = `레벨 ${this.level}! 새 형질을 하나 고르세요. (무리 전체에 퍼지고, 새끼는 부모를 닮아 조금씩 달라집니다)`;
    this.onDraft?.(this.draftCards, this.preview);
    return true;
  }

  /**
   * 다시 뽑기(리롤) — 3장이 마음에 안 들면 형질 포기(스킵) 대신 카드를 새로 뽑는다. 여러 런을 마쳐야 열리는
   * 편의(meta.isRerollUnlocked). 드래프트당 GAME.rerollsPerDraft 회 제한(무한 낚시 방지). 프리셋 선택엔 없음.
   * 결정론: 시드 draftRng 로 다음 후보를 뽑는다(같은 플레이 → 같은 결과). 시대 보상 리롤이면 강화 사본으로.
   */
  reroll(): void {
    if (this.phase !== "draft" || this.firstChoice || this.rerollsLeft <= 0) return;
    this.rerollsLeft -= 1;
    this.rerollsUsed += 1;
    const drawn = drawCards(
      this.draftRng,
      3,
      (c) =>
        cardAvailable(c.id, this.metaLvl) &&
        cardPrereqMet(c, this.genome.traits) &&
        !cardRedundant(c, this.genome.traits),
      this.level, // 다시 뽑아도 같은 레벨 보정을 받는다
      this.pickedCounts(), // 이미 고른 카드는 뜸하게(반복 완화)
      this.lineage ?? undefined, // 다시 뽑아도 내 갈래 카드 한 장은 보장
    );
    this.draftCards = this.eraReward ? drawn.map((c) => boostCard(c, GAME.eraRewardBoost)) : drawn;
    this.onDraft?.(this.draftCards, this.preview);
  }

  /** UI 표시용 — 지금 드래프트에서 "다시 뽑기"를 누를 수 있는가(열려 있고 횟수 남음, 프리셋 아님). */
  get canReroll(): boolean {
    return this.phase === "draft" && !this.firstChoice && this.rerollsLeft > 0;
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
    const diff = eraDifficulty(this.era);
    if ((BOSS_TYPES as readonly string[]).includes(kind)) {
      const bt = kind as BossType;
      this.world.boss = createBoss(bt, this.width, this.height, this.world.terrain, diff, true); // 레이드 첫 시대부터
      this.stageLabel = `${isPredatorBoss(bt) ? "보스" : "시련"} · ${bossName(bt)}`;
      this.preview = `다가오는 위협. ${bossPreview(bt)}`;
      this.threatText = `지금 위협 「${bossName(bt)}」 · ${bossCounter(bt)}`;
    } else {
      const et = kind as ExtinctionType;
      applyExtinction(this.world, et, diff);
      this.stageLabel = `대멸종 · ${extinctionName(et)}`;
      this.preview = `대멸종. ${extinctionPreview(et)}`;
      this.threatText = `지금 위협 「${extinctionName(et)}」 · ${extinctionCounter(et)}`;
    }
    this.stageTicksLeft = 99999; // 관찰용 — 타이머 만료로 통과 판정이 나지 않게
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
      // 카운터 힌트 + 만능 수단 안내: 공격력·원거리가 높으면 어떤 보스든 맞서 잡는다(원거리로 시작해도 보스전 가능).
      if (bt) return { title: `곧 ${bossName(bt)}!`, sub: `${bossCounter(bt)} 공격력이나 원거리가 높으면 어떤 보스든 맞서 잡습니다.` };
      return { title: "곧 위협이 닥칩니다", sub: "" };
    }
    if (next === "extinction") {
      // 대멸종 종류도 미리 정해 저장하므로(extinctionQueue) 무엇이 오는지·어떻게 버티는지 예고한다.
      const et = this.extinctionQueue[0];
      if (et) return { title: `곧 ${extinctionName(et)}!`, sub: extinctionCounter(et) };
      return { title: "곧 대멸종이 닥칩니다", sub: "형태를 갖추고 수를 늘려 대비하세요" };
    }
    return null;
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
    return { name: k.name, sea: this.seaPercent, desc: k.desc };
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

  private makeWorld(): World {
    return new World(
      `${this.currentSeed}-env`,
      this.width,
      this.height,
      this.genome,
      this.areaScale,
      this.champions,
      this.currentMapType,
      eraScarcity(this.era), // 시대가 지날수록 세계가 척박(먹이↓·재생↓) — era 0 = 1.0 = 기존과 동일
    );
  }

  /** 이번 런의 세계 종류(대륙·판게아·군도·대양). 로비가 "이번 세계"로 보여준다. */
  get mapType(): MapType {
    return this.currentMapType;
  }

  get mapKindNow(): MapKind {
    return mapKind(this.currentMapType);
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
      bossEligible(bt, this.genome.traits, this.world.terrain, this.width, this.height),
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
    if (t.diet > SIM.dietHuntMin)
      candidates.push({ kind: "hunt", target: GAME.trialHuntN, label: `사냥 ${GAME.trialHuntN}회` });
    if (grazeEfficiency(t.diet) > SIM.grazeMinEff)
      candidates.push({ kind: "feed", target: GAME.trialFeedN, label: `먹이 ${GAME.trialFeedN}회` });
    candidates.push({ kind: "birth", target: GAME.trialBirthN, label: `새끼 ${GAME.trialBirthN}마리` });
    // 「무리」는 붕괴를 잡는 시험이라 목표가 **지금 무리보다 클 수 없다.** 하한(8)만 걸면 2마리로 들어온
    // 라운드에서 목표가 8 이 되어 "지키기"가 "4배로 불리기"로 뒤집힌다(못 하는 시험을 내면 안 된다).
    const pop = this.world.playerPopulation;
    const popTarget = Math.min(pop, Math.max(GAME.trialPopFloor, pop - GAME.trialPopSlack));
    candidates.push({ kind: "pop", target: popTarget, label: `무리 ${popTarget}마리` });
    const idx = new Rng(`${this.currentSeed}-trial-s${this.stageIndex}`).int(0, candidates.length - 1);
    return candidates[idx] as Trial;
  }

  /**
   * 단계 시작 — 위협(보스/대멸종)을 직접 정한다. 하이브리드: 단계 전환에는 드래프트가 붙지 않고(형질은
   * 레벨업으로만), 위협만 흐른다. 예고(preview)는 stageLabel 과 함께 main 이 하이라이트로 띄운다.
   */
  private beginStage(): void {
    this.stageXp = 0; // 조종 모드 경험치 상한은 단계마다 새로 찬다(leadEnabled=false 면 안 읽힌다)
    this.world.resetRoundCounts(); // 새 단계 = 시험 계수 리셋 (뜻은 clearStageState 가 이미 거뒀다)
    this.currentTrial = null;
    this.lastVerdictValue = null; // 새 라운드가 시작되면 지난 판정은 지운다
    this.phase = "watch";
    this.acc = 0;
    const kind = this.currentKind();
    const diff = eraDifficulty(this.era); // 시대별 위협 강도 배율(era 0 = 1.0)
    if (kind === "boss") {
      const bt = this.takeBossType();
      // 레이드는 첫 시대(era 0)부터 켠다 — 격퇴 체력바·직접 잡기는 핵심 메커니즘이라 첫 판부터 보여야 한다
      // (era 1+ 로 미뤘더니 한 판 이겨 다음 시대로 가기 전엔 아예 안 보였다 — 사용자: "레이드 체력바가 안 보인다").
      this.world.boss = createBoss(bt, this.width, this.height, this.world.terrain, diff, true);
      // 개체형(쫓아오는 개체)은 "보스", 전역 재난은 "시련"으로 부른다(시각·로직과 일치).
      this.stageLabel = `${isPredatorBoss(bt) ? "보스" : "시련"} · ${bossName(bt)}`;
      this.preview = `다가오는 위협. ${bossPreview(bt)}`;
      // 드래프트가 화면을 덮어도 무엇과 싸우는 중인지 보이게, 대응 힌트만 짧게 붙들어 둔다.
      // 전문(preview)은 배너가 이미 띄웠고, 카드 고르는 자리에서 필요한 건 "무엇을 키워야 하나"다.
      this.threatText = `지금 위협 「${bossName(bt)}」 · ${bossCounter(bt)}`;
      this.stageTicksLeft = GAME.bossSeconds * SIM.stepsPerSecond;
    } else if (kind === "extinction") {
      // 예고와 실제가 일치하도록 미리 정해 둔 큐에서 꺼낸다(peek 로 예고한 종류 == 여기서 shift 되는 종류).
      const et = this.extinctionQueue.shift() ?? this.extRng.pick(EXTINCTION_TYPES);
      applyExtinction(this.world, et, diff);
      this.stageLabel = `대멸종 · ${extinctionName(et)}`;
      this.preview = `대멸종. ${extinctionPreview(et)}`;
      this.threatText = `지금 위협 「${extinctionName(et)}」 · ${extinctionCounter(et)}`;
      this.stageTicksLeft = GAME.extinctionSeconds * SIM.stepsPerSecond;
    } else {
      this.stageLabel = "채집";
      this.preview = "";
      this.threatText = ""; // 채집 라운드에는 도는 위협이 없다
      this.stageTicksLeft = GAME.roundSeconds * SIM.stepsPerSecond;
      // 시대 보상 드래프트가 예고한 시험이 있으면 그대로 쓴다(예고=실물). pop 기준점은 시험을
      // 만든 순간의 것을 유지한다(드래프트에서 스킵으로 낳은 새끼도 pop 점수에서 빠지게).
      if (this.pendingTrial) {
        this.currentTrial = this.pendingTrial;
        this.pendingTrial = null;
      } else {
        this.currentTrial = this.pickTrial();
        this.trialSkipBroodBase = this.skipBroodTotal; // 이 시험의 pop 기준점(이후 스킵 새끼는 제외)
      }
    }
  }

  private finishStage(survivedTimer: boolean, bossDefeated = false): void {
    const kind = this.currentKind();
    this.clearStageState();

    if (!survivedTimer) {
      this.endRun("lose");
      return;
    }

    // 통과기준은 절대 수(소수 개체 게임) — 개체가 맵 크기와 무관하게 소수라 기준도 고정.
    // 레이드: 보스를 **격퇴**했으면 개체 수와 무관하게 통과("직접 잡았다"). 못 잡아도 3마리 버티면 통과
    // (사용자 방향: 버티기도 통과는 되되 — 처치 보상·버티기 페널티는 후속 단계). 대멸종은 형질 필터.
    let passed = true;
    if (kind === "boss") passed = bossDefeated || this.world.playerPopulation >= GAME.bossPassThreshold;
    else if (kind === "extinction") passed = this.world.playerPopulation >= GAME.extinctionPassThreshold;

    if (!passed) {
      this.endRun("lose");
      return;
    }

    // 라운드 시험 판정(채집 단계만) · 불합격은 런을 끊지 않고 불씨 하나를 대가로 치른다. 불씨 0 = 패배.
    const trial = kind === "forage" ? this.currentTrial : null;
    if (trial) {
      const prog = this.trialProgress;
      const trialPassed = prog >= trial.target;
      if (!trialPassed) this.embers -= 1;
      const verdict: TrialVerdict = { passed: trialPassed, trial, progress: prog, embersLeft: this.embers };
      this.lastVerdictValue = verdict; // 곧 열릴 카드창이 제목 자리에 싣는다(플래시는 그 창에 가린다)
      this.onTrialVerdict?.(verdict);
      if (this.embers <= 0) {
        this.loseReason = "embers";
        this.endRun("lose");
        return;
      }
    }

    // 보고서: 위협을 넘긴 순간(연대기). stageLabel 은 "보스 · 약탈자" · "대멸종 · 혹독한 추위" 형태.
    if (kind === "boss") {
      if (bossDefeated) this.embers = Math.min(GAME.emberMax, this.embers + 1); // 격퇴 보상: 불씨 하나 회복
      this.logEvent("boss", bossDefeated ? `${this.stageLabel} 처치` : `${this.stageLabel} 버팀`);
    } else if (kind === "extinction") this.logEvent("extinction", `${this.stageLabel} 견딤`);

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

  /** 저장본에서 메타(누적 경험치 → 레벨·리롤 해금)를 다시 읽어 필드에 반영. 런 시작·디버그 변경 시 호출. */
  private reloadMeta(): void {
    this.metaLvl = metaLevel(loadMeta().metaXp);
    this.metaRerollUnlocked = isRerollUnlockedAtLevel(this.metaLvl);
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
    // 게놈은 유지(성장 이어짐). xp/레벨도 유지하되, 새 월드라 먹이 누적 기준값만 리셋.
    this.world = this.makeWorld();
    this.lastFoodEaten = 0;
    this.stageXp = 0;
    // 성장한 종의 색·형질을 새 초기 무리에 반영(프리셋 선택 때와 같은 처리).
    if (this.playerColor !== undefined) this.world.playerSpecies.color = this.playerColor;
    for (const e of this.world.entities) {
      if (e.species.isPlayer) e.genome = cloneGenome(this.world.genome);
    }
    this.onWorldChanged?.(this.world);
    // 첫 채집 단계로 바로 가지 않고, 먼저 "시대 보상" 드래프트를 띄운다(강해진 형질 하나 = 난이도 도약 보상).
    this.beginEraRewardDraft();
  }

  /**
   * 시대 보상 드래프트 — 시대를 넘을 때마다 강화된 카드(정상 ×eraRewardBoost 강도) 3장 중 하나를 고른다.
   * 위협이 시대마다 세지는 만큼 성장에 큰 도약을 줘 난이도 루프를 "갈수록 재밌게"(어렵기만 하지 않게).
   * 결정론: 시대 시드에서 파생한 독립 RNG. 보상 카드는 boostCard 사본이라 표시값=실제 적용값.
   */
  private beginEraRewardDraft(): void {
    this.phase = "draft";
    this.eraReward = true;
    // 곧 시작할 단계가 채집이면 시험을 **지금** 뽑아 얼려 둔다 · upcomingTrial 예고와 beginStage 실물이
    // 같은 객체다. pickTrial 은 전용 해시 Rng 라 어떤 기존 스트림도 소비하지 않는다(결정론 불변).
    if ((SCHEDULE[this.stageIndex] ?? "forage") === "forage") {
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
        cardPrereqMet(c, this.genome.traits) &&
        !cardRedundant(c, this.genome.traits),
      this.level, // 시대 보상도 지금까지 키운 레벨의 보정을 받는다
      this.pickedCounts(), // 이미 고른 카드는 뜸하게(반복 완화)
    );
    this.draftCards = drawn.map((c) => boostCard(c, GAME.eraRewardBoost));
    this.rerollsLeft = this.metaRerollUnlocked ? GAME.rerollsPerDraft : 0;
    this.preview =
      "새로운 시대에 들어섭니다. 지난 시대를 넘어선 보상으로, 크게 강해진 형질 하나를 고르세요. 지금 무리에 바로 물려집니다.";
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

function extinctionPreview(type: ExtinctionType): string {
  if (type === "cold") return "혹독한 추위가 닥칩니다. 대사가 낮으면 얼어 죽습니다(뜨거운 피가 유리).";
  if (type === "famine")
    return "대가뭄이 옵니다. 먹이가 다시 자라지 않습니다. 에너지를 아끼고 수가 많아야 버팁니다.";
  if (type === "plague")
    return "대역병이 번집니다. 번식이 더디면 회복하지 못해 스러집니다(번식력이 높아야 유리).";
  return "폭염이 옵니다. 대사가 높으면 타 죽습니다(느린 대사가 유리).";
}

// 대멸종 강도를 세팅한다. mul(era 난이도 배율)로 시대가 오를수록 더 혹독하게. mul=1(첫 시대)이면 기존과 동일.
function applyExtinction(world: World, type: ExtinctionType, mul = 1): void {
  if (type === "cold") world.globalCold = 1.3 * mul;
  else if (type === "famine") world.foodRegrowMultiplier = 3.6 * mul;
  else if (type === "plague") world.plagueRate = 0.006 * mul; // 0.005→0.006: 바이옴 생태 추가로 저산 필터가 경계(3)로 → 복원.
  else world.heat = 1.1 * mul; // 폭염 — 0.9→1.1: 바이옴 동물이 env 생태를 바꿔 고대사 필터가 경계(3)로 약해져 복원.
}
