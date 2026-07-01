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
import { GAME, SCHEDULE, type StageKind } from "@/game/config";
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
type ExtinctionType = "cold" | "famine" | "heat" | "plague";

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
  private acc = 0;
  private ambientAcc = 0;

  // main 이 설정하는 훅
  onDraft: ((cards: Card[], preview: string) => void) | null = null;
  onResult: ((result: RunResult, summary: string) => void) | null = null;
  onWorldChanged: ((world: World) => void) | null = null;

  constructor(width: number, height: number, areaScale = 1) {
    this.width = width;
    this.height = height;
    this.areaScale = areaScale;
    this.genome = defaultGenome();
    this.draftRng = new Rng("draft-0");
    this.stageRng = new Rng("stage-0");
    this.currentSeed = randomSeed(); // 로비 배경 맵도 매번 다르게
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
      if (card && card.color !== undefined) this.world.playerSpecies.color = card.color;
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
    this.draftCards = drawCards(this.draftRng, 3);
    this.preview = `레벨 ${this.level}! 새 형질을 하나 고르세요. (지금부터 태어나는 새끼에게 물려집니다)`;
    this.onDraft?.(this.draftCards, this.preview);
  }

  get secondsLeft(): number {
    return Math.max(0, Math.ceil(this.stageTicksLeft / SIM.stepsPerSecond));
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
    this.currentSeed = this.fixedSeed ?? randomSeed();
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
    this.bossQueue = shuffle(BOSS_TYPES, this.stageRng); // 한 런의 보스는 서로 다른 종류
    this.world = this.makeWorld();
    this.beginFirstDraft();
  }

  private makeWorld(): World {
    return new World(`${this.currentSeed}-env`, this.width, this.height, this.genome, this.areaScale);
  }

  private currentKind(): StageKind {
    return SCHEDULE[this.stageIndex] ?? "forage";
  }

  /** 런 첫 드래프트 — 시작 프리셋 선택(어떤 종으로 시작할지). 이후 형질은 레벨업으로 얻는다. */
  private beginFirstDraft(): void {
    this.phase = "draft";
    this.draftCards = PRESET_CARDS.slice();
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
    if (kind === "boss") {
      const bt = this.bossQueue.shift() ?? this.stageRng.pick(BOSS_TYPES);
      this.world.boss = createBoss(bt, this.width, this.height);
      // 개체형(쫓아오는 개체)은 "보스", 전역 재난은 "시련"으로 부른다(시각·로직과 일치).
      this.stageLabel = `${isPredatorBoss(bt) ? "보스" : "시련"} · ${bossName(bt)}`;
      this.preview = `다가오는 위협 — ${bossPreview(bt)}`;
      this.stageTicksLeft = GAME.bossSeconds * SIM.stepsPerSecond;
    } else if (kind === "extinction") {
      const et = this.stageRng.pick(EXTINCTION_TYPES);
      applyExtinction(this.world, et);
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
    this.onResult?.(result, this.buildSummary(result));
  }

  private buildSummary(result: RunResult): string {
    // 승패 한 줄 + "이 종은 어떤 종이었나" + 사망 원인 집계를 합쳐 정산 본문을 만든다(가독성, §7).
    return buildRunReport(this.baseSummary(result), this.genome, this.world.deaths);
  }

  private baseSummary(result: RunResult): string {
    if (result === "win") return "대멸종을 견뎌내고 정점에 올랐습니다.";
    const kind = this.currentKind();
    if (kind === "boss") return `${this.stageLabel} 관문을 넘지 못했습니다.`;
    if (kind === "extinction") return "대멸종을 견디지 못했습니다.";
    return `${this.stageNumber}단계에서 멸종했습니다.`;
  }
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

function shuffle(types: readonly BossType[], rng: Rng): BossType[] {
  const out = types.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = out[i] as BossType;
    const b = out[j] as BossType;
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

function extinctionPreview(type: ExtinctionType): string {
  if (type === "cold") return "혹독한 추위가 닥칩니다. 대사가 낮으면 얼어 죽습니다(뜨거운 피가 유리).";
  if (type === "famine")
    return "대가뭄이 옵니다. 먹이가 다시 자라지 않습니다. 에너지를 아끼고 수가 많아야 버팁니다.";
  if (type === "plague")
    return "대역병이 번집니다. 번식이 더디면 회복하지 못해 스러집니다(번식력이 높아야 유리).";
  return "폭염이 옵니다. 대사가 높으면 타 죽습니다(느린 대사가 유리).";
}

function applyExtinction(world: World, type: ExtinctionType): void {
  if (type === "cold") world.globalCold = 1.3;
  else if (type === "famine") world.foodRegrowMultiplier = 3.6;
  else if (type === "plague") world.plagueRate = 0.005;
  else world.heat = 0.9;
}
