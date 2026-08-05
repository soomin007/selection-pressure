// 무리 지시(신탁)의 **game 층 배선** 검증. sim 쪽 격리·결정론은 src/sim/herdOrder.test.ts 가 맡고,
// 여기서는 "관전이 아닌 화면에서 뜻이 새지 않는가 / 단계가 바뀌면 거둬지는가 / 단계별 경험치 상한이
// 실제로 무는가"만 본다.
//
// (이 파일은 `lead.game.test.ts` 를 대체한다. 알파 조종의 game 층 배선 — armLead 로 한 마리를
//  세우던 것 — 은 2026-08-04 에 없어졌다. 경험치 상한 검증은 여전히 유효해 그대로 옮겨 왔다.)
import { describe, it, expect } from "vitest";
import { Game } from "@/game/game";
import { GAME } from "@/game/config";

/** 한 런을 시작해 첫 프리셋을 고른 상태(watch)로 만든다(game.test.ts 의 startRun 과 같은 절차). */
function startRun(seed: string, commandEnabled: boolean): Game {
  // 배율 1 고정(3번째 인자): 예전 생성자와 같은 세계(월드 240x400 · areaScale 1)를 보존한다(game.test.ts 참고).
  const g = new Game(240, 400, 1);
  g.fixedSeed = seed;
  g.leadEnabled = commandEnabled; // 입력 층(main)이 URL 플래그를 읽어 넘기는 그 불리언(?watch 면 false)
  g.beginRun(); // draft(프리셋 선택)
  g.pickCard(0); // 첫 프리셋 → 첫 채집 단계 시작(watch)
  return g;
}

/**
 * 지금까지 이 런에서 쌓은 경험치 총량. 레벨업은 xp 를 깎아 가므로 현재 xp 만 보면 안 되고,
 * 지나온 레벨의 요구치(GAME.xpBase + (레벨-1)×xpPerLevel)를 되짚어 더해야 총량이 나온다.
 */
function accruedXp(g: Game): number {
  let total = g.xp;
  for (let lv = 1; lv < g.level; lv++) total += GAME.xpBase + (lv - 1) * GAME.xpPerLevel;
  return total;
}

/**
 * 먹이를 인위로 밀어 넣으며 그 단계를 짧게 돌린다(경험치 경로만 보려는 것이므로 시뮬 운에 안 기댄다).
 * 레벨업 카드가 열리면 첫 카드로 넘겨 이어 간다.
 */
function farmXp(g: Game, ticks: number, perTick: number): void {
  for (let i = 0; i < ticks; i++) {
    if (g.phase === "draft") g.pickCard(0);
    if (g.phase !== "watch") break;
    g.world.playerFoodEaten += perTick;
    g.update(34); // 34ms ≈ 한 틱(stepsPerSecond 30)
  }
}

describe("무리 지시 — game 층 배선", () => {
  it("관전 중에 내린 뜻은 sim 에 닿는다", () => {
    const g = startRun("order-game-on", true);
    g.setHerdOrder(120, 200);
    expect(g.world.herdOrder).toEqual({ x: 120, y: 200 });
    expect(g.herdOrder).toEqual({ x: 120, y: 200 });
  });

  it("드래프트 중에는 뜻이 안 닿는다(카드 고르다 화면을 탭해도 무리가 안 움직인다)", () => {
    const g = new Game(240, 400, 1); // 배율 1 고정 · 위 startRun 과 같은 이유
    g.fixedSeed = "order-game-draft";
    g.leadEnabled = true;
    g.beginRun(); // 프리셋 선택 드래프트 — 관전이 아니다
    expect(g.phase).toBe("draft");
    g.setHerdOrder(120, 200);
    expect(g.world.herdOrder).toBeNull();
  });

  it("멈춤 중에는 뜻이 안 닿는다", () => {
    const g = startRun("order-game-paused", true);
    g.paused = true;
    g.setHerdOrder(120, 200);
    expect(g.world.herdOrder).toBeNull();
  });

  it("뜻을 거두면 무리는 완전히 자율로 돌아간다", () => {
    const g = startRun("order-game-clear", true);
    g.setHerdOrder(120, 200);
    g.clearHerdOrder();
    expect(g.world.herdOrder).toBeNull();
  });

  it("단계가 바뀌면 지난 라운드의 뜻은 거둬진다(낡은 좌표가 다음 라운드로 안 넘어간다)", () => {
    const g = startRun("order-game-stage", true);
    const start = g.stageNumber;
    g.setHerdOrder(120, 200);
    let guard = 0;
    while (g.stageNumber === start && g.phase !== "result" && guard++ < 6000) {
      if (g.phase === "draft") g.pickCard(0);
      if (g.phase === "watch") g.update(34);
    }
    expect(g.phase).not.toBe("result"); // 도중에 런이 끝났으면 아무것도 못 잰다
    expect(g.stageNumber).toBe(start + 1);
    expect(g.world.herdOrder).toBeNull();
  });

  it("알파는 더 이상 세워지지 않는다(한 마리를 모는 개념이 없어졌다)", () => {
    const g = startRun("order-game-noalpha", true);
    for (let i = 0; i < 60; i++) {
      g.update(34);
      if (g.phase !== "watch") break;
    }
    expect(g.world.lead.leaderId).toBe(-1);
    expect(g.world.lead.cmd).toBeNull();
  });

  it("지시 모드면 한 단계에 쌓이는 경험치가 leadStageXpCap 을 못 넘는다", () => {
    const g = startRun("lead-game-cap", true);
    farmXp(g, 30, 50); // 상한(80)보다 훨씬 많은 1500 을 밀어 넣는다
    expect(accruedXp(g)).toBeLessThanOrEqual(GAME.leadStageXpCap);
  });

  it("상한은 단계마다 다시 찬다 — 두 단계를 넘기면 누적 경험치가 leadStageXpCap 을 넘는다", () => {
    // ⚠ 위 테스트는 **한 단계 안**의 상한만 잰다. beginStage 의 stageXp 리셋을 지워도(= 한 런에
    //   딱 80 만 주는 규칙이 돼도) 초록불이라, 단계 경계를 실제로 넘겨 보는 이 테스트가 필요하다.
    const g = startRun("lead-game-cap", true);
    const start = g.stageNumber;
    let guard = 0;
    while (g.stageNumber < start + 2 && g.phase !== "result" && guard < 6000) {
      if (g.phase === "draft") g.pickCard(0);
      if (g.phase === "watch") {
        g.world.playerFoodEaten += 50; // 매 틱 상한보다 훨씬 많이 밀어 넣는다
        g.update(34);
      }
      guard += 1;
    }
    // 도중에 런이 끝나(멸종·패배) 단계를 못 넘겼으면 이 테스트는 아무것도 못 잰다 — 못 박는다.
    expect(g.phase).not.toBe("result");
    expect(g.stageNumber).toBe(start + 2);
    expect(accruedXp(g)).toBeGreaterThan(GAME.leadStageXpCap);
    // 그렇다고 상한이 사라진 것도 아니다 — 넘긴 단계 수 × 상한 안쪽에 머문다.
    expect(accruedXp(g)).toBeLessThanOrEqual(GAME.leadStageXpCap * 3);
  });

  it("?watch(지시 꺼짐)면 경험치 경로가 예전 그대로다(먹은 만큼 전부 들어온다)", () => {
    const g = startRun("lead-game-cap", false);
    const before = g.world.playerFoodEaten;
    farmXp(g, 30, 50);
    const eaten = g.world.playerFoodEaten - before;
    expect(accruedXp(g)).toBe(eaten);
    // 상한이 실제로 무는지 위 테스트가 증명하려면 주입량이 상한보다 커야 한다 — 여기서 못 박는다.
    expect(eaten).toBeGreaterThan(GAME.leadStageXpCap);
  });
});
