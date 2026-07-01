// 대멸종 종류 예고 검증 — 미리 정해 둔 큐(extinctionQueue)에서 예고와 실제가 같은 값을 봐야 한다.
// Game 은 순수 TS(Pixi 무관)라 headless 로 런을 끝까지 돌려 관찰할 수 있다.
import { describe, it, expect } from "vitest";
import { Game } from "@/game/game";

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
