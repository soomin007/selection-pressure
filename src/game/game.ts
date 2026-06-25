// 게임 상태기계 (런/라운드). 한 런 = 한 혈통의 일생.
// 런은 단계 계획(SCHEDULE)을 따른다. 각 단계 앞에 드래프트가 붙는다.
//   forage     채집 라운드 (그냥 살아남고 수를 불린다)
//   boss       보스 게이트 (버티기: 끝까지 기준 개체 수 생존하면 통과)
//   extinction 대멸종 피날레 (환경 적합도 필터: 통과하면 승리)
// 멸종(개체 0)하면 그 자리에서 패배. 게놈은 런 내 누적, 새 런에서 리셋.

import { World } from "@/sim/world";
import { Rng } from "@/sim/rng";
import { defaultGenome, type Genome } from "@/sim/genome";
import { drawCards, applyCard, DIET_CHOICE_CARDS, type Card } from "@/game/cards";
import { GAME, SCHEDULE, type StageKind } from "@/game/config";
import { SIM } from "@/sim/params";
import { createBoss, bossPreview, bossName, BOSS_TYPES, type BossType } from "@/sim/boss";
import { buildRunReport } from "@/game/runReport";

export type Phase = "lobby" | "draft" | "watch" | "result";
export type RunResult = "win" | "lose";
type ExtinctionType = "cold" | "famine" | "heat";

const EXTINCTION_TYPES: readonly ExtinctionType[] = ["cold", "famine", "heat"];

export class Game {
  readonly width: number;
  readonly height: number;

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
  private pendingBoss: BossType | null = null;
  private pendingExtinction: ExtinctionType | null = null;
  private firstChoice = true; // 런 첫 드래프트 = 시작 식성 선택
  private bossQueue: BossType[] = []; // 한 런의 보스들(서로 다른 종류)

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

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
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
      // 시작 식성을 골랐으니 곧장 첫 채집 단계로.
      this.firstChoice = false;
      this.beginStage();
    } else {
      this.beginStage();
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
  }

  get secondsLeft(): number {
    return Math.max(0, Math.ceil(this.stageTicksLeft / SIM.stepsPerSecond));
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
    this.draftRng = new Rng(`${this.currentSeed}-draft`);
    this.stageRng = new Rng(`${this.currentSeed}-stage`);
    this.bossQueue = shuffle(BOSS_TYPES, this.stageRng); // 한 런의 보스는 서로 다른 종류
    this.world = this.makeWorld();
    this.beginDraft();
  }

  private makeWorld(): World {
    return new World(`${this.currentSeed}-env`, this.width, this.height, this.genome);
  }

  private currentKind(): StageKind {
    return SCHEDULE[this.stageIndex] ?? "forage";
  }

  private beginDraft(): void {
    this.phase = "draft";
    this.pendingBoss = null;
    this.pendingExtinction = null;

    // 런 첫 드래프트는 시작 식성 선택.
    if (this.firstChoice) {
      this.draftCards = DIET_CHOICE_CARDS.slice();
      this.preview = "당신의 종은 무엇을 먹나요? 시작 식성을 고르세요. (반대 형질을 얻으면 잡식이 됩니다)";
      return;
    }

    this.draftCards = drawCards(this.draftRng, 3);

    // 다가오는 단계의 위협을 미리 정하고 예고를 만든다(전투 전 예고, §4.2).
    const kind = this.currentKind();
    if (kind === "boss") {
      this.pendingBoss = this.bossQueue.shift() ?? this.stageRng.pick(BOSS_TYPES);
      this.preview = `다가오는 위협 — ${bossPreview(this.pendingBoss)}`;
    } else if (kind === "extinction") {
      this.pendingExtinction = this.stageRng.pick(EXTINCTION_TYPES);
      this.preview = `대멸종이 다가옵니다 — ${extinctionPreview(this.pendingExtinction)}`;
    } else {
      this.preview = "위협 없음 · 채집 라운드입니다.";
    }
  }

  private beginStage(): void {
    this.phase = "watch";
    this.acc = 0;
    const kind = this.currentKind();
    if (kind === "boss" && this.pendingBoss) {
      this.world.boss = createBoss(this.pendingBoss, this.width, this.height);
      this.stageLabel = `보스 · ${bossName(this.pendingBoss)}`;
      this.stageTicksLeft = GAME.bossSeconds * SIM.stepsPerSecond;
    } else if (kind === "extinction" && this.pendingExtinction) {
      applyExtinction(this.world, this.pendingExtinction);
      this.stageLabel = `대멸종 · ${extinctionName(this.pendingExtinction)}`;
      this.stageTicksLeft = GAME.extinctionSeconds * SIM.stepsPerSecond;
    } else {
      this.stageLabel = "채집";
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

    let passed = true;
    if (kind === "boss") passed = this.world.playerPopulation >= GAME.bossPassThreshold;
    else if (kind === "extinction")
      passed = this.world.playerPopulation >= GAME.extinctionPassThreshold;

    if (!passed) {
      this.endRun("lose");
      return;
    }

    this.stageIndex += 1;
    if (this.stageIndex >= SCHEDULE.length) {
      this.endRun("win");
      return;
    }
    this.beginDraft();
    this.onDraft?.(this.draftCards, this.preview);
  }

  private clearStageState(): void {
    this.world.boss = null;
    this.world.globalCold = 0;
    this.world.heat = 0;
    this.world.foodRegrowMultiplier = 1;
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
  return type === "cold" ? "혹독한 추위" : type === "famine" ? "대가뭄" : "폭염";
}

function extinctionPreview(type: ExtinctionType): string {
  if (type === "cold") return "혹독한 추위가 닥칩니다. 대사가 낮으면 얼어 죽습니다(뜨거운 피가 유리).";
  if (type === "famine")
    return "대가뭄이 옵니다. 먹이가 다시 자라지 않습니다. 에너지를 아끼고 수가 많아야 버팁니다.";
  return "폭염이 옵니다. 대사가 높으면 타 죽습니다(느린 대사가 유리).";
}

function applyExtinction(world: World, type: ExtinctionType): void {
  if (type === "cold") world.globalCold = 1.3;
  else if (type === "famine") world.foodRegrowMultiplier = 3.6;
  else world.heat = 0.9;
}
