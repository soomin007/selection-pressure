// 게임 상태기계 (런/라운드). 한 런 = 한 혈통의 일생.
// 런은 단계 계획(SCHEDULE)을 따른다. 각 단계 앞에 드래프트가 붙는다.
//   forage     채집 라운드 (그냥 살아남고 수를 불린다)
//   boss       보스 게이트 (버티기: 끝까지 기준 개체 수 생존하면 통과)
//   extinction 대멸종 피날레 (환경 적합도 필터: 통과하면 승리)
// 멸종(개체 0)하면 그 자리에서 패배. 게놈은 런 내 누적, 새 런에서 리셋.

import { World } from "@/sim/world";
import { Rng } from "@/sim/rng";
import { defaultGenome, type Genome } from "@/sim/genome";
import { drawCards, applyCard, type Card } from "@/game/cards";
import { GAME, SCHEDULE, type StageKind } from "@/game/config";
import { SIM } from "@/sim/params";
import { createBoss, bossPreview, bossName, pickBossType, type BossType } from "@/sim/boss";

export type Phase = "draft" | "watch" | "result";
export type RunResult = "win" | "lose";
type ExtinctionType = "cold" | "famine" | "heat";

const EXTINCTION_TYPES: readonly ExtinctionType[] = ["cold", "famine", "heat"];

export class Game {
  readonly width: number;
  readonly height: number;

  genome: Genome;
  world: World;
  phase: Phase = "draft";
  result: RunResult | null = null;
  draftCards: Card[] = [];

  /** 드래프트에 표시할 다가오는 위협 예고. */
  preview = "";
  /** 관전 중 상단에 표시할 현재 단계 라벨. */
  stageLabel = "";

  private stageIndex = 0;
  private stageTicksLeft = 0;
  private pendingBoss: BossType | null = null;
  private pendingExtinction: ExtinctionType | null = null;

  private runIndex = 0;
  private envSeed = 0;
  private draftRng: Rng;
  private stageRng: Rng;
  private acc = 0;

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
    this.world = this.makeWorld();
    this.setupRun();
  }

  start(): void {
    this.onWorldChanged?.(this.world);
    this.onDraft?.(this.draftCards, this.preview);
  }

  newRun(): void {
    this.setupRun();
    this.onWorldChanged?.(this.world);
    this.onDraft?.(this.draftCards, this.preview);
  }

  pickCard(index: number): void {
    if (this.phase !== "draft") return;
    const card = this.draftCards[index];
    if (card) applyCard(this.genome, card);
    this.beginStage();
  }

  update(deltaMS: number): void {
    if (this.phase !== "watch") return;
    this.acc += deltaMS;
    const stepMs = 1000 / SIM.stepsPerSecond;
    let guard = 0;
    while (this.acc >= stepMs && guard < 5) {
      this.world.step();
      this.stageTicksLeft -= 1;
      this.acc -= stepMs;
      guard += 1;
      if (this.world.playerPopulation === 0) {
        this.finishStage(false);
        return;
      }
      if (this.stageTicksLeft <= 0) {
        this.finishStage(true);
        return;
      }
    }
    if (this.acc > stepMs) this.acc = 0;
  }

  get secondsLeft(): number {
    return Math.max(0, Math.ceil(this.stageTicksLeft / SIM.stepsPerSecond));
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
    return `${temp} · ${fert}`;
  }

  private setupRun(): void {
    this.runIndex += 1;
    this.envSeed += 1;
    this.genome = defaultGenome();
    this.stageIndex = 0;
    this.result = null;
    this.draftRng = new Rng(`draft-${this.runIndex}`);
    this.stageRng = new Rng(`stage-${this.runIndex}`);
    this.world = this.makeWorld();
    this.beginDraft();
  }

  private makeWorld(): World {
    return new World(`env-${this.envSeed}`, this.width, this.height, this.genome);
  }

  private currentKind(): StageKind {
    return SCHEDULE[this.stageIndex] ?? "forage";
  }

  private beginDraft(): void {
    this.phase = "draft";
    this.draftCards = drawCards(this.draftRng, 3);

    // 다가오는 단계의 위협을 미리 정하고 예고를 만든다(전투 전 예고, §4.2).
    const kind = this.currentKind();
    this.pendingBoss = null;
    this.pendingExtinction = null;
    if (kind === "boss") {
      this.pendingBoss = pickBossType(this.stageRng);
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
    if (result === "win") return "대멸종을 견뎌내고 정점에 올랐습니다.";
    const kind = this.currentKind();
    if (kind === "boss") return `${this.stageLabel} 관문을 넘지 못했습니다.`;
    if (kind === "extinction") return "대멸종을 견디지 못했습니다.";
    return `${this.stageNumber}단계에서 멸종했습니다.`;
  }
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
  else if (type === "famine") world.foodRegrowMultiplier = 2.5;
  else world.heat = 0.9;
}
