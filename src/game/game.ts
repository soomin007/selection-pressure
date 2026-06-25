// 게임 상태기계 (런/라운드). 한 런 = 한 혈통의 일생.
//   [드래프트] 카드 3장 중 1장 → [관전] 라운드 시간만큼 시뮬 → 반복 → (Phase 5: 보스)
// 개체군은 라운드를 가로질러 이어진다. 멸종하면 그 자리에서 런 종료(패배).
//
// 환경은 런 시작 때 한 번 생성(런 내 고정), 런마다 새 환경(로그라이크 변주).
// 게놈은 런 내 누적, 새 런에서 중립값으로 리셋.

import { World } from "@/sim/world";
import { Rng } from "@/sim/rng";
import { defaultGenome, type Genome } from "@/sim/genome";
import { drawCards, applyCard, type Card } from "@/game/cards";
import { GAME } from "@/game/config";
import { SIM } from "@/sim/params";

export type Phase = "draft" | "watch" | "result";
export type RunResult = "win" | "lose";

export class Game {
  readonly width: number;
  readonly height: number;

  genome: Genome;
  world: World;
  phase: Phase = "draft";
  round = 1;
  roundTicksLeft = 0;
  draftCards: Card[] = [];
  result: RunResult | null = null;

  // main 이 설정하는 훅 (UI/렌더 연결)
  onDraft: ((cards: Card[]) => void) | null = null;
  onResult: ((result: RunResult, summary: string) => void) | null = null;
  onWorldChanged: ((world: World) => void) | null = null;

  private runIndex = 0;
  private envSeed = 0;
  private draftRng: Rng;
  private acc = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.genome = defaultGenome();
    this.draftRng = new Rng("draft-0");
    this.world = this.makeWorld();
    this.setupRun();
  }

  /** 최초 시작: 초기 훅을 한 번 쏴서 UI/배경을 맞춘다. */
  start(): void {
    this.onWorldChanged?.(this.world);
    this.onDraft?.(this.draftCards);
  }

  /** 결과 화면에서 새 런 시작. */
  newRun(): void {
    this.setupRun();
    this.onWorldChanged?.(this.world);
    this.onDraft?.(this.draftCards);
  }

  /** 드래프트에서 카드 선택. */
  pickCard(index: number): void {
    if (this.phase !== "draft") return;
    const card = this.draftCards[index];
    if (card) applyCard(this.genome, card);
    this.beginWatch();
  }

  /** 매 프레임 호출 (관전 중에만 시뮬 진행). */
  update(deltaMS: number): void {
    if (this.phase !== "watch") return;
    this.acc += deltaMS;
    const stepMs = 1000 / SIM.stepsPerSecond;
    let guard = 0;
    while (this.acc >= stepMs && guard < 5) {
      this.world.step();
      this.roundTicksLeft -= 1;
      this.acc -= stepMs;
      guard += 1;
      if (this.world.population === 0) {
        this.endRun("lose");
        return;
      }
      if (this.roundTicksLeft <= 0) {
        this.endRound();
        return;
      }
    }
    if (this.acc > stepMs) this.acc = 0;
  }

  get secondsLeft(): number {
    return Math.max(0, Math.ceil(this.roundTicksLeft / SIM.stepsPerSecond));
  }

  /** 현재 환경을 쉬운 말로 요약 (드래프트 판단용, 가독성 §4.2/§7). */
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
    this.round = 1;
    this.result = null;
    this.draftRng = new Rng(`draft-${this.runIndex}`);
    this.world = this.makeWorld();
    this.beginDraftInternal();
  }

  private makeWorld(): World {
    return new World(`env-${this.envSeed}`, this.width, this.height, this.genome);
  }

  private beginDraftInternal(): void {
    this.phase = "draft";
    this.draftCards = drawCards(this.draftRng, 3);
  }

  private beginWatch(): void {
    this.phase = "watch";
    this.roundTicksLeft = GAME.roundSeconds * SIM.stepsPerSecond;
    this.acc = 0;
  }

  private endRound(): void {
    if (this.round >= GAME.roundsPerRun) {
      // Phase 5 에서 여기 보스 게이트가 들어간다. 지금은 완주 = 승리.
      this.endRun("win");
    } else {
      this.round += 1;
      this.beginDraftInternal();
      this.onDraft?.(this.draftCards);
    }
  }

  private endRun(result: RunResult): void {
    this.phase = "result";
    this.result = result;
    const summary =
      result === "win"
        ? `${GAME.roundsPerRun}라운드를 끝까지 살아남았습니다.`
        : `${this.round}라운드에서 멸종했습니다.`;
    this.onResult?.(result, summary);
  }
}
