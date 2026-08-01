// 알파 조종의 **game 층 배선** 검증(스펙 §11-C-2). sim 쪽 격리·결정론은 src/sim/lead.test.ts 가 맡고,
// 여기서는 "모드가 꺼져 있으면 진입점이 아예 안 열리는가 / 관전이 아닌 화면에서 명령이 새지 않는가 /
// 조종 모드의 단계별 경험치 상한이 실제로 무는가"만 본다.
// 기존 game.test.ts 는 한 글자도 안 건드린다 — 이 파일은 새로 더한 것뿐이다.
import { describe, it, expect } from "vitest";
import { Game } from "@/game/game";
import { GAME } from "@/game/config";
import type { LeadCommand } from "@/sim/lead";

/** 한 런을 시작해 첫 프리셋을 고른 상태(watch)로 만든다(game.test.ts 의 startRun 과 같은 절차). */
function startRun(seed: string, leadEnabled: boolean): Game {
  const g = new Game(240, 400);
  g.fixedSeed = seed;
  g.leadEnabled = leadEnabled; // 입력 층(main)이 URL 플래그를 읽어 넘기는 그 불리언
  g.beginRun(); // draft(프리셋 선택)
  g.pickCard(0); // 첫 프리셋 → 첫 채집 단계 시작(watch)
  return g;
}

const PUSH: LeadCommand = { dx: 1, dy: 0, throttle: 1 };

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
 * 레벨업 드래프트가 열리면 첫 카드로 넘겨 같은 단계를 이어 간다.
 */
function farmXp(g: Game, ticks: number, perTick: number): void {
  for (let i = 0; i < ticks; i++) {
    if (g.phase === "draft") g.pickCard(0);
    if (g.phase !== "watch") break;
    g.world.playerFoodEaten += perTick;
    g.update(34); // 34ms ≈ 한 틱(stepsPerSecond 30)
  }
}

describe("알파 조종 — game 층 배선", () => {
  it("leadEnabled=false 면 armLead 가 안 불려 leaderId 가 끝까지 -1 이다", () => {
    const g = startRun("lead-game-off", false);
    for (let i = 0; i < 60; i++) {
      g.setLeadCommand(PUSH); // 입력 층이 명령을 줘도
      g.update(34);
      if (g.phase !== "watch") break;
    }
    expect(g.world.lead.leaderId).toBe(-1); // 진입점이 아예 안 열린다
    expect(g.world.lead.cmd).toBeNull(); // 명령도 sim 에 안 닿는다
    expect(g.world.lead.followTicks).toBe(0);
  });

  it("leadEnabled=true 면 관전에 들어간 뒤 알파가 한 마리 정해진다", () => {
    const g = startRun("lead-game-on", true);
    g.update(34);
    expect(g.world.lead.leaderId).toBeGreaterThanOrEqual(0);
    const first = g.world.lead.leaderId;
    for (let i = 0; i < 20; i++) g.update(34);
    // armLead 는 멱등 — 매 프레임 불려도 알파가 매번 갈아치워지지 않는다(살아 있는 한).
    const still = g.world.entities.some((e) => e.id === first);
    if (still) expect(g.world.lead.leaderId).toBe(first);
  });

  it("드래프트 중엔 명령을 줘도 세계가 안 돌고 명령이 sim 에 안 닿는다", () => {
    const g = new Game(240, 400);
    g.fixedSeed = "lead-game-draft";
    g.leadEnabled = true;
    g.beginRun(); // 프리셋 선택 드래프트 — 관전이 아니다
    expect(g.phase).toBe("draft");
    const tick0 = g.world.tick;
    for (let i = 0; i < 10; i++) {
      g.setLeadCommand(PUSH);
      g.update(34);
    }
    expect(g.world.tick).toBe(tick0);
    expect(g.world.lead.cmd).toBeNull();
  });

  it("멈춤 중엔 명령을 줘도 세계가 안 돌고 명령이 sim 에 안 닿는다", () => {
    const g = startRun("lead-game-paused", true);
    g.paused = true;
    const tick0 = g.world.tick;
    for (let i = 0; i < 10; i++) {
      g.setLeadCommand(PUSH);
      g.update(34);
    }
    expect(g.world.tick).toBe(tick0);
    expect(g.world.lead.cmd).toBeNull();
  });

  it("leadEnabled=true 면 한 단계에 쌓이는 경험치가 leadStageXpCap 을 못 넘는다", () => {
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

  it("leadEnabled=false 면 경험치 경로가 예전 그대로다(먹은 만큼 전부 들어온다)", () => {
    const g = startRun("lead-game-cap", false);
    const before = g.world.playerFoodEaten;
    farmXp(g, 30, 50);
    const eaten = g.world.playerFoodEaten - before;
    expect(accruedXp(g)).toBe(eaten);
    // 상한이 실제로 무는지 위 테스트가 증명하려면 주입량이 상한보다 커야 한다 — 여기서 못 박는다.
    expect(eaten).toBeGreaterThan(GAME.leadStageXpCap);
  });
});
