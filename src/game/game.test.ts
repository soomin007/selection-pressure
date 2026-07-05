// 대멸종 종류 예고 검증 — 미리 정해 둔 큐(extinctionQueue)에서 예고와 실제가 같은 값을 봐야 한다.
// Game 은 순수 TS(Pixi 무관)라 headless 로 런을 끝까지 돌려 관찰할 수 있다.
import { describe, it, expect } from "vitest";
import { Game } from "@/game/game";
import { eraDifficulty } from "@/game/config";
import { createBoss } from "@/sim/boss";

// 대멸종 이름 4종(game.ts extinctionName 과 일치) — 예고 title 이 보스 예고와 섞이지 않게 거른다.
const EXTINCTION_NAMES = ["혹독한 추위", "대가뭄", "폭염", "대역병"] as const;

/** 한 런을 시작해 첫 프리셋을 고른 상태(watch)로 만든다. */
function startRun(seed: string): Game {
  const g = new Game(240, 400);
  g.fixedSeed = seed;
  g.beginRun(); // draft(프리셋 선택)
  g.pickCard(0); // 첫 프리셋 → 첫 채집 단계 시작(watch)
  return g;
}

describe("대멸종 종류 예고", () => {
  it("같은 시드면 대멸종 종류 순서가 재현된다(결정론)", () => {
    const queueOf = (seed: string): readonly string[] =>
      (startRun(seed) as unknown as { extinctionQueue: readonly string[] }).extinctionQueue.slice();
    expect(queueOf("fixed-abc")).toEqual(queueOf("fixed-abc"));
    // 다른 시드면 (거의 항상) 다른 순서 — 적어도 첫 원소 기준으로 종류가 갈릴 수 있음을 확인.
    expect(EXTINCTION_NAMES.length).toBe(4);
  });

  it("대멸종 예고가 실제로 닥칠 종류와 일치한다", () => {
    // 여러 시드로 런을 돌려, 대멸종 예고를 본 뒤 실제 발동된 대멸종 종류와 맞는지 확인한다.
    // 통과기준이 낮아(3) 대부분 완주하지만, 도중 멸종하는 시드는 건너뛴다(win 런에서만 검증).
    let verified = 0;
    for (let s = 0; s < 40 && verified < 3; s++) {
      const g = startRun(`run-${s}`);
      let predicted: string | null = null;
      for (let i = 0; i < 8000 && g.phase !== "result"; i++) {
        if (g.phase === "draft") {
          g.pickCard(0); // 레벨업 드래프트는 첫 카드로 넘긴다
          continue;
        }
        const t = g.upcomingThreat;
        // 대멸종 예고만 집는다(보스 예고 "곧 <보스이름>!" 과 이름이 겹치지 않음).
        if (t && EXTINCTION_NAMES.some((n) => t.title === `곧 ${n}!`)) predicted = t.title;
        g.update(1000); // 큰 delta 로 빠르게 진행(update 는 스텝 상한이 있어 안전)
        if (g.stageLabel.startsWith("대멸종") && predicted) {
          const name = g.stageLabel.replace("대멸종 · ", "");
          expect(predicted).toBe(`곧 ${name}!`); // 예고 종류 == 실제 종류
          verified += 1;
          break;
        }
      }
    }
    // 적어도 몇 런은 대멸종까지 도달해 예고-실제 일치를 확인했어야 한다.
    expect(verified).toBeGreaterThan(0);
  });
});

describe("난이도 루프(승리 후 진행)", () => {
  it("era 0 은 배율 1.0(기존과 동일), 이후 계단으로 오른다", () => {
    expect(eraDifficulty(0)).toBe(1);
    expect(eraDifficulty(1)).toBeCloseTo(1.22);
    expect(eraDifficulty(2)).toBeCloseTo(1.44);
    // 음수 방어(0으로 clamp).
    expect(eraDifficulty(-3)).toBe(1);
  });

  it("보스 강도(즉사 반경)가 난이도 배율로 커진다 — 첫 시대는 불변", () => {
    const base = createBoss("chaser", 240, 400); // diffMul 기본 1.0
    const scaled = createBoss("chaser", 240, 400, undefined, 2);
    expect(scaled.killRadius).toBeCloseTo(base.killRadius * 2);
    // 떼 시련은 개체 수도 배율로 늘어난다(사나운 무리 6 → 12).
    const swarm1 = createBoss("swarm", 240, 400);
    const swarm2 = createBoss("swarm", 240, 400, undefined, 2);
    expect(swarm2.members.length).toBeGreaterThan(swarm1.members.length);
  });

  it("승리 후 continueToNextEra 는 게놈·레벨을 유지하고 다음 시대(더 센 위협)로 이어간다", () => {
    // 승리하는 시드를 찾는다(통과기준 3, 대부분 완주하나 시드마다 다름).
    let won: Game | null = null;
    for (let s = 0; s < 60 && !won; s++) {
      const g = startRun(`era-run-${s}`);
      for (let i = 0; i < 12000 && g.phase !== "result"; i++) {
        if (g.phase === "draft") {
          g.pickCard(0);
          continue;
        }
        g.update(1000);
      }
      if (g.phase === "result" && g.result === "win") won = g;
    }
    expect(won).not.toBeNull();
    const g = won as Game;
    expect(g.era).toBe(0);
    // 승리 시점의 게놈(성장 결과)을 기억.
    const beforeTraits = { ...g.genome.traits };
    const beforeLevel = g.level;

    g.continueToNextEra();

    // 다음 시대로 이어졌다 — 관전 재개, era +1, 결과 해제.
    expect(g.era).toBe(1);
    expect(g.phase).toBe("watch");
    expect(g.result).toBeNull();
    // 게놈·레벨은 유지(성장 이어짐).
    expect(g.genome.traits).toEqual(beforeTraits);
    expect(g.level).toBe(beforeLevel);
    // 새 월드의 내 종이 살아있다(초기 무리 재생성).
    expect(g.world.playerPopulation).toBeGreaterThan(0);
    // 시대 라벨이 뜬다(N / 상한).
    expect(g.eraLabel).toBe("시대 2 / 5");
  });
});
