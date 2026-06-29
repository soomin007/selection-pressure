import { describe, it, expect } from "vitest";
import { Rng } from "@/sim/rng";
import { drawCards, applyCard, CARD_POOL } from "@/game/cards";
import { defaultGenome } from "@/sim/genome";

describe("드래프트", () => {
  it("같은 시드는 같은 후보 3장", () => {
    const a = drawCards(new Rng("draft-1"), 3).map((c) => c.id);
    const b = drawCards(new Rng("draft-1"), 3).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it("후보는 서로 다른 카드", () => {
    const ids = drawCards(new Rng("x"), 3).map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("카드 풀의 모든 id 는 고유하다", () => {
    const ids = CARD_POOL.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("카드 적용", () => {
  it("효과가 누적되고 [0,1] 로 클램프된다", () => {
    const g = defaultGenome(); // 모두 0.5
    const swift = CARD_POOL.find((c) => c.id === "swift");
    expect(swift).toBeDefined();
    if (!swift) return;
    applyCard(g, swift); // 속도 +0.15
    expect(g.traits.speed).toBeCloseTo(0.65, 5);

    // 같은 카드 여러 번 → 1.0 에서 멈춤
    for (let i = 0; i < 10; i++) applyCard(g, swift);
    expect(g.traits.speed).toBe(1);
  });
});
