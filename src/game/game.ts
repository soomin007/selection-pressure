// 게임 상태기계 (런/라운드). 한 런 = 한 혈통의 일생.
// 런은 단계 계획(SCHEDULE)을 따른다. 각 단계 앞에 드래프트가 붙는다.
//   forage     채집 라운드 (그냥 살아남고 수를 불린다)
//   boss       보스 게이트 (버티기: 끝까지 기준 개체 수 생존하면 통과)
//   extinction 대멸종 피날레 (환경 적합도 필터: 통과하면 승리)
// 멸종(개체 0)하면 그 자리에서 패배. 게놈은 런 내 누적, 새 런에서 리셋.

import { World } from "@/sim/world";
import { Rng } from "@/sim/rng";
import { defaultGenome, cloneGenome, type Genome } from "@/sim/genome";
import { drawCards, applyCard, PRESET_CARDS, type Card } from "@/game/cards";
import { GAME, SCHEDULE, eraDifficulty, type StageKind } from "@/game/config";
import { loadMeta, isPresetUnlocked, isCardUnlocked, recordRunComplete, loadChampions, saveChampion, type UnlockTier, type Champion } from "@/game/meta";
import { SIM } from "@/sim/params";
import { createBoss, bossPreview, bossName, bossCounter, isPredatorBoss, BOSS_TYPES, type BossType } from "@/sim/boss";
import { buildRunReport } from "@/game/runReport";

export type Phase = "lobby" | "draft" | "watch" | "result";
export type RunResult = "win" | "lose";

/** 런 전체 진행 타임라인 — 하나의 긴 막대(진행률) + 보스/대멸종 시점 마커. */
export interface TimelineMarker {
  kind: StageKind; // "boss" | "extinction"
  at: number; // 막대상 위치 0~1
}
export interface RunTimeline {
  progress: number; // 전체 진행 0~1(왼→오 차오름)
  markers: TimelineMarker[];
}
export type ExtinctionType = "cold" | "famine" | "heat" | "plague";

const EXTINCTION_TYPES: readonly ExtinctionType[] = ["cold", "famine", "heat", "plague"];

export class Game {
  readonly width: number;
  readonly height: number;
  /** 월드 면적 배율(화면 1개=1). 맵 확장 시 개체·먹이·통과기준을 면적 비례로 키운다. */
  readonly areaScale: number;

  genome: Genome;
  world: World;
  phase: Phase = "lobby";
  paused = false; // 멈춤 버튼
  speed = 1; // 관전 배속 1/2/3
  result: RunResult | null = null;
  draftCards: Card[] = [];
  /** 이번 런에서 고른 카드 이름들(시작 식성 포함) — 화면에 "내가 무엇을 골랐나" 상시 표시용. */
  pickedCardNames: string[] = [];

  /** 드래프트에 표시할 다가오는 위협 예고. */
  preview = "";
  /** 관전 중 상단에 표시할 현재 단계 라벨. */
  stageLabel = "";

  private stageIndex = 0;
  private stageTicksLeft = 0;
  private firstChoice = true; // 런 첫 드래프트 = 시작 프리셋 선택
  private bossQueue: BossType[] = []; // 한 런의 보스들(서로 다른 종류)
  private extinctionQueue: ExtinctionType[] = []; // 한 런의 대멸종 종류들 — 미리 정해 예고 가능(보스와 대칭)

  /** 시대(era) — 승리 후 "다음 시대로" 이어갈 때마다 +1. 0=첫 시대(난이도 배율 1.0=기존과 동일). */
  era = 0;
  /** 시드 원본(era 접미사 붙이기 전) — 다음 시대는 이 시드에서 새 맵·새 위협 순서를 파생(결정론). */
  private baseSeed = "lobby";
  /** 내 종 시작 색(프리셋에서 정함) — 다음 시대에 새 월드를 만들어도 같은 색을 유지한다. */
  private playerColor: number | undefined;

  /** 메타 언락 기준(여러 런에서 도달한 최고 레벨) — 런 시작 시 저장본에서 읽어 프리셋·카드 풀을 거른다.
   * 오래 살아 레벨을 높인 런일수록 다음 런에 더 많이 열린다(빨리 죽으면 안 열림). 런 도중엔 안 바뀐다. */
  private metaBestLevel = 0;

  /** 비동기 생물(S2) — 이 런의 세계에 등장시킬 지난 챔피언들. 런 시작 시 저장본에서 읽어 makeWorld 로 넘긴다. */
  private champions: Champion[] = [];

  // 레벨업(형질 성장) — 시간/단계 전환이 아니라 "먹이 경험치"로 레벨을 올려 형질을 얻는다.
  // 레벨 = 세대: 레벨업해서 고른 형질은 그 뒤로 태어난 개체에게만 물려진다(세대별 적용 — 후속 슬라이스).
  level = 1; // 시작 프리셋 = 1레벨
  xp = 0; // 현재 레벨에서 쌓은 경험치(먹은 먹이 수)
  xpToNext: number = GAME.xpBase; // 다음 레벨까지 필요한 경험치(GAME.xpBase 는 리터럴이라 number 명시)
  private lastFoodEaten = 0; // world.playerFoodEaten 직전 값(매 update 의 delta 를 xp 로 누적)

  /** 디버그용 고정 시드(URL ?seed=). null 이면 런마다 랜덤(맵·카드·보스가 매번 다름). */
  fixedSeed: string | null = null;
  /** 이번 런/로비의 시드. 맵·드래프트·보스가 모두 여기서 파생 → 같은 시드면 완전 재현. */
  private currentSeed = "lobby";

  private draftRng: Rng;
  private stageRng: Rng;
  // 대멸종 종류 전용 독립 스트림. stageRng(보스 순서)를 1비트도 안 건드려, 기존 보스 순서·시드 재현이
  // 그대로 보존된다(known_issues "독립 rng" 패턴 — 소비 순서만 분리, 대멸종 종류만 여기서 결정).
  private extRng: Rng;
  private acc = 0;
  private ambientAcc = 0;

  // main 이 설정하는 훅
  onDraft: ((cards: Card[], preview: string) => void) | null = null;
  // canContinue = 승리라서 "다음 시대로" 이어갈 수 있는가(패배는 false). newUnlocks = 이번 런 완료로 새로 열린
  // 프리셋·카드(해금 알림용, 없으면 빈 배열). main 이 결과 화면 버튼·해금 배너를 가른다.
  onResult:
    | ((result: RunResult, summary: string, canContinue: boolean, newUnlocks: UnlockTier[]) => void)
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
    this.metaBestLevel = loadMeta().bestLevel;
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
    if (card) {
      applyCard(this.genome, card);
      this.pickedCardNames.push(card.name);
    }
    if (this.firstChoice) {
      // 시작 프리셋을 골랐으니 곧장 첫 채집 단계로.
      this.firstChoice = false;
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
      this.beginStage();
    } else {
      // 레벨업 드래프트 — 진행 중이던 단계로 복귀(단계 타이머·보스 상태는 그대로 보존).
      this.phase = "watch";
      this.acc = 0;
    }
  }

  /** 레벨업 드래프트를 스킵 — 3장이 다 별로면 형질 대신 소소한 보상(새끼 몇 마리)을 받고 관전으로 복귀한다.
   * 시작 프리셋 선택(firstChoice)은 스킵 불가(반드시 한 종으로 시작). */
  skipDraft(): void {
    if (this.phase !== "draft" || this.firstChoice) return;
    this.world.spawnPlayerBrood(SIM.draftSkipBrood);
    this.pickedCardNames.push("건너뜀");
    this.phase = "watch";
    this.acc = 0;
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
    this.acc += deltaMS;
    let guard = 0;
    while (this.acc >= stepMs && guard < 5) {
      this.acc -= stepMs;
      guard += 1;
      // 배속만큼 한 번에 여러 스텝 진행.
      for (let s = 0; s < this.speed; s++) {
        this.world.step();
        this.stageTicksLeft -= 1;
        if (this.world.playerPopulation === 0) {
          this.finishStage(false);
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
    this.xp += eaten - this.lastFoodEaten;
    this.lastFoodEaten = eaten;
    if (this.xp >= this.xpToNext) this.levelUp();
  }

  /** 레벨업 — 진행 중이던 단계를 멈추고 형질 카드 3장 중 하나를 고르게 한다(레벨=세대). */
  private levelUp(): void {
    this.level += 1;
    this.xp -= this.xpToNext;
    if (this.xp < 0) this.xp = 0;
    this.xpToNext = GAME.xpBase + (this.level - 1) * GAME.xpPerLevel;
    this.phase = "draft";
    // 메타 언락: 열린 카드만 드래프트 풀에(잠긴 특화 카드는 런을 거듭해 해금).
    this.draftCards = drawCards(this.draftRng, 3, (id) => isCardUnlocked(id, this.metaBestLevel));
    this.preview = `레벨 ${this.level}! 새 형질을 하나 고르세요. (지금부터 태어나는 새끼에게 물려집니다)`;
    this.onDraft?.(this.draftCards, this.preview);
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
      this.world.boss = createBoss(bt, this.width, this.height, this.world.terrain, diff);
      this.stageLabel = `${isPredatorBoss(bt) ? "보스" : "시련"} · ${bossName(bt)}`;
      this.preview = `다가오는 위협 — ${bossPreview(bt)}`;
    } else {
      const et = kind as ExtinctionType;
      applyExtinction(this.world, et, diff);
      this.stageLabel = `대멸종 · ${extinctionName(et)}`;
      this.preview = `대멸종 — ${extinctionPreview(et)}`;
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

  /** 런 전체 진행 타임라인(HUD 막대) — 완료 단계 + 현재 단계 경과. 레벨업으로 멈추면 진행도 멈춘다. */
  get timeline(): RunTimeline {
    const durs = SCHEDULE.map(stageDuration);
    const total = durs.reduce((a, b) => a + b, 0) || 1;
    let elapsed = 0;
    for (let i = 0; i < this.stageIndex; i++) elapsed += durs[i] ?? 0;
    if (this.phase === "watch" || this.phase === "draft") {
      const curDur = durs[this.stageIndex] ?? 0;
      elapsed += curDur - this.stageTicksLeft / SIM.stepsPerSecond;
    } else if (this.phase === "result" && this.result === "win") {
      elapsed = total; // 승리 = 끝까지 완주
    }
    const progress = Math.max(0, Math.min(1, elapsed / total));
    const markers: TimelineMarker[] = [];
    let acc = 0;
    for (let i = 0; i < SCHEDULE.length; i++) {
      const kind = SCHEDULE[i] as StageKind;
      if (kind === "boss" || kind === "extinction") markers.push({ kind, at: acc / total });
      acc += durs[i] ?? 0;
    }
    return { progress, markers };
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
      const bt = this.bossQueue[0];
      if (bt) return { title: `곧 ${bossName(bt)}!`, sub: bossCounter(bt) };
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

  /** 렌더 보간 비율 [0,1) — 다음 스텝까지 얼마나 왔나(화면 60fps 가 sim 30/s 사이를 메운다). */
  get interpAlpha(): number {
    const stepMs = 1000 / SIM.stepsPerSecond;
    const a = this.phase === "lobby" ? this.ambientAcc : this.acc;
    return Math.min(1, Math.max(0, a / stepMs));
  }

  get stageNumber(): number {
    return this.stageIndex + 1;
  }

  get totalStages(): number {
    return SCHEDULE.length;
  }

  /** 현재 환경을 쉬운 말로 요약 (가독성 §4.2/§7). */
  environmentSummary(): string {
    const env = this.world.environment;
    let c = 0;
    let f = 0;
    const n = env.coldness.length;
    for (let i = 0; i < n; i++) {
      c += env.coldness[i] ?? 0;
      f += env.fertility[i] ?? 0;
    }
    c /= n;
    f /= n;
    const temp = c > 0.58 ? "추운 땅" : c < 0.42 ? "따뜻한 땅" : "온화한 땅";
    const fert = f > 0.55 ? "비옥함" : f < 0.4 ? "척박함" : "보통";
    return `${temp} · 먹이 ${fert}`;
  }

  private setupRun(): void {
    // 시드 하나에서 맵·드래프트·보스를 모두 파생. 기본은 랜덤(매 런 다름), 고정 시드면 완전 재현.
    this.baseSeed = this.fixedSeed ?? randomSeed();
    this.currentSeed = this.baseSeed;
    this.metaBestLevel = loadMeta().bestLevel; // 이전 런의 해금을 이번 런부터 반영
    this.champions = loadChampions(); // 지난 챔피언들을 이 런 세계에 등장(비동기 생물)
    this.era = 0; // 새 런은 첫 시대부터
    this.playerColor = undefined;
    this.genome = defaultGenome();
    this.pickedCardNames = [];
    this.stageIndex = 0;
    this.result = null;
    this.firstChoice = true;
    this.level = 1;
    this.xp = 0;
    this.xpToNext = GAME.xpBase;
    this.lastFoodEaten = 0;
    this.draftRng = new Rng(`${this.currentSeed}-draft`);
    this.stageRng = new Rng(`${this.currentSeed}-stage`);
    this.extRng = new Rng(`${this.currentSeed}-ext`);
    this.bossQueue = shuffle(BOSS_TYPES, this.stageRng); // 한 런의 보스는 서로 다른 종류
    this.extinctionQueue = shuffle(EXTINCTION_TYPES, this.extRng); // 대멸종 종류도 미리 정해 예고 가능
    this.world = this.makeWorld();
    this.beginFirstDraft();
  }

  private makeWorld(): World {
    return new World(`${this.currentSeed}-env`, this.width, this.height, this.genome, this.areaScale, this.champions);
  }

  private currentKind(): StageKind {
    return SCHEDULE[this.stageIndex] ?? "forage";
  }

  /** 런 첫 드래프트 — 시작 프리셋 선택(어떤 종으로 시작할지). 이후 형질은 레벨업으로 얻는다. */
  private beginFirstDraft(): void {
    this.phase = "draft";
    // 메타 언락: 열린 프리셋만 보여준다(잠긴 특수 갈래는 런을 거듭해 해금). 항상 최소한 기본 갈래는 열려 있다.
    this.draftCards = PRESET_CARDS.filter((c) => isPresetUnlocked(c.id, this.metaBestLevel));
    this.preview = "어떤 종으로 시작할까요? 시작 프리셋을 고르세요. (먹이를 먹어 레벨업하며 형질을 더합니다)";
  }

  /**
   * 단계 시작 — 위협(보스/대멸종)을 직접 정한다. 하이브리드: 단계 전환에는 드래프트가 붙지 않고(형질은
   * 레벨업으로만), 위협만 흐른다. 예고(preview)는 stageLabel 과 함께 main 이 하이라이트로 띄운다.
   */
  private beginStage(): void {
    this.phase = "watch";
    this.acc = 0;
    const kind = this.currentKind();
    const diff = eraDifficulty(this.era); // 시대별 위협 강도 배율(era 0 = 1.0)
    if (kind === "boss") {
      const bt = this.bossQueue.shift() ?? this.stageRng.pick(BOSS_TYPES);
      this.world.boss = createBoss(bt, this.width, this.height, this.world.terrain, diff);
      // 개체형(쫓아오는 개체)은 "보스", 전역 재난은 "시련"으로 부른다(시각·로직과 일치).
      this.stageLabel = `${isPredatorBoss(bt) ? "보스" : "시련"} · ${bossName(bt)}`;
      this.preview = `다가오는 위협 — ${bossPreview(bt)}`;
      this.stageTicksLeft = GAME.bossSeconds * SIM.stepsPerSecond;
    } else if (kind === "extinction") {
      // 예고와 실제가 일치하도록 미리 정해 둔 큐에서 꺼낸다(peek 로 예고한 종류 == 여기서 shift 되는 종류).
      const et = this.extinctionQueue.shift() ?? this.extRng.pick(EXTINCTION_TYPES);
      applyExtinction(this.world, et, diff);
      this.stageLabel = `대멸종 · ${extinctionName(et)}`;
      this.preview = `대멸종 — ${extinctionPreview(et)}`;
      this.stageTicksLeft = GAME.extinctionSeconds * SIM.stepsPerSecond;
    } else {
      this.stageLabel = "채집";
      this.preview = "";
      this.stageTicksLeft = GAME.roundSeconds * SIM.stepsPerSecond;
    }
  }

  private finishStage(survivedTimer: boolean): void {
    const kind = this.currentKind();
    this.clearStageState();

    if (!survivedTimer) {
      this.endRun("lose");
      return;
    }

    // 통과기준은 절대 수(소수 개체 게임) — 개체가 맵 크기와 무관하게 소수라 기준도 고정.
    let passed = true;
    if (kind === "boss") passed = this.world.playerPopulation >= GAME.bossPassThreshold;
    else if (kind === "extinction") passed = this.world.playerPopulation >= GAME.extinctionPassThreshold;

    if (!passed) {
      this.endRun("lose");
      return;
    }

    this.stageIndex += 1;
    if (this.stageIndex >= SCHEDULE.length) {
      this.endRun("win");
      return;
    }
    this.beginStage(); // 다음 단계 바로 시작 — 형질 드래프트는 단계 전환이 아니라 레벨업으로만.
  }

  private clearStageState(): void {
    this.world.boss = null;
    this.world.globalCold = 0;
    this.world.heat = 0;
    this.world.foodRegrowMultiplier = 1;
    this.world.plagueRate = 0;
  }

  private endRun(result: RunResult): void {
    this.phase = "result";
    this.result = result;
    // 런이 진짜 끝났을 때만(멸종 또는 정복) 메타에 완료 기록 + 해금. 중간 시대 승리는 "다음 시대로"
    // 이어지므로 세지 않는다(그때는 endRun 이 canContinue=true 로 뜨지만 런은 계속된다).
    const conquered = result === "win" && this.isFinalEra;
    const runOver = result === "lose" || conquered;
    // 언락은 "이번 런에서 도달한 레벨"로 — 오래 살아 성장할수록 열린다(빨리 죽으면 안 열림 = 생존의 보람).
    const newUnlocks: UnlockTier[] = runOver ? recordRunComplete(this.level, conquered) : [];
    // 비동기 생물(S2) — 시대 2 이상까지 간(또는 정복한) 종은 "기억할 만한 챔피언"으로 저장해 다음 런의
    // 세계에 다시 등장시킨다. 게놈은 성장한 현재 형태 그대로(versioned 직렬화).
    if (runOver && (conquered || this.era >= 1)) {
      const champ: Champion = {
        name: championName(this.genome, conquered),
        genome: cloneGenome(this.genome),
        era: this.era,
        color: this.playerColor ?? 0x6cc24a,
      };
      saveChampion(champ);
    }
    // 승리면 "다음 시대로" 이어갈 수 있다(brotato식 난이도 루프) — 단 마지막 시대(정복)면 더는 없다.
    this.onResult?.(result, this.buildSummary(result), result === "win" && !this.isFinalEra, newUnlocks);
  }

  /**
   * 승리 후 "다음 시대로" — 게놈·레벨(성장)을 유지한 채 새 맵·더 센 위협으로 다시 시작한다.
   * era 를 올려 위협 강도(보스·대멸종)가 세지고, 통과기준은 그대로라 "성장이 난이도 상승을 앞서는가"의
   * 경주가 된다. 새 월드라 시작 무리는 초기화되지만, 종의 형질(게놈)과 레벨은 이어진다.
   */
  continueToNextEra(): void {
    if (this.result !== "win") return; // 승리 직후에만 유효
    this.era += 1;
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
    // 성장한 종의 색·형질을 새 초기 무리에 반영(프리셋 선택 때와 같은 처리).
    if (this.playerColor !== undefined) this.world.playerSpecies.color = this.playerColor;
    for (const e of this.world.entities) {
      if (e.species.isPlayer) e.genome = cloneGenome(this.world.genome);
    }
    this.onWorldChanged?.(this.world);
    this.beginStage(); // 첫 채집 단계부터 다시(phase = watch)
  }

  /** HUD 표시용 시대 라벨 — "시대 N / 5"로 지금 몇 번째인지·목표(정복)까지 얼마나 남았는지 항상 보인다. */
  get eraLabel(): string {
    return `시대 ${this.era + 1} / ${GAME.eraCap}`;
  }

  /** 마지막 시대인가(이 시대의 대멸종을 넘으면 정복=최종 승리, 더는 "다음 시대로"가 없다). */
  get isFinalEra(): boolean {
    return this.era >= GAME.eraCap - 1;
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
    const kind = this.currentKind();
    if (kind === "boss") return `${this.stageLabel} 관문을 넘지 못했습니다.`;
    if (kind === "extinction") return "대멸종을 견디지 못했습니다.";
    return `${this.stageNumber}단계에서 멸종했습니다.`;
  }
}

/** 챔피언 이름 — 가장 두드러진 형질로 별명 + 정복/생존 칭호(비동기 생물이 등장할 때 왕관과 함께 표시). */
function championName(g: Genome, conquered: boolean): string {
  const t = g.traits;
  const pairs: [number, string][] = [
    [t.speed, "질풍"],
    [t.attack, "맹아"],
    [t.vision, "천리안"],
    [t.fertility, "번성"],
    [t.herding, "결속"],
    [t.metabolism, "불꽃"],
    [t.swimming, "심해"],
    [t.wings, "창공"],
    [t.venom, "독아"],
    [t.ranged, "원사"],
    [t.echo, "음파"],
  ];
  pairs.sort((a, b) => b[0] - a[0]);
  const epithet = pairs[0]?.[1] ?? "무명";
  return `${epithet}의 ${conquered ? "정복자" : "생존자"}`;
}

/** 단계 종류별 길이(초) — 타임라인 진행·마커 계산용. */
function stageDuration(kind: StageKind): number {
  if (kind === "boss") return GAME.bossSeconds;
  if (kind === "extinction") return GAME.extinctionSeconds;
  return GAME.roundSeconds;
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
