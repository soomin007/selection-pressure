import { describe, it, expect } from "vitest";
import { Rng } from "@/sim/rng";
import { drawCards, applyCard, CARD_POOL, PRESET_CARDS } from "@/game/cards";
import { defaultGenome } from "@/sim/genome";
import { SIM } from "@/sim/params";

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

describe("시작 프리셋", () => {
  it("5종이고 id 가 고유하다", () => {
    expect(PRESET_CARDS.length).toBe(5);
    const ids = PRESET_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 프리셋이 식성(diet)을 절대값으로 정한다", () => {
    for (const p of PRESET_CARDS) {
      expect(p.set?.diet).toBeDefined();
      const diet = p.set?.diet ?? -1;
      expect(diet).toBeGreaterThanOrEqual(0);
      expect(diet).toBeLessThanOrEqual(1);
    }
  });

  it("바다 개척자는 시작부터 바다 먹이를 먹을 수 있다(수영 >= 임계)", () => {
    const sea = PRESET_CARDS.find((c) => c.id === "preset_sea");
    expect(sea).toBeDefined();
    if (!sea) return;
    const g = defaultGenome(); // swimming 0.5
    applyCard(g, sea);
    expect(g.traits.swimming).toBeGreaterThanOrEqual(SIM.swimThreshold);
  });

  it("적용하면 식성 구간이 의도대로(초식 무리=초식, 육식 사냥꾼=육식)", () => {
    const herd = PRESET_CARDS.find((c) => c.id === "preset_herd");
    const hunter = PRESET_CARDS.find((c) => c.id === "preset_hunter");
    expect(herd && hunter).toBeTruthy();
    if (!herd || !hunter) return;
    const gh = defaultGenome();
    applyCard(gh, herd);
    expect(gh.traits.diet).toBeLessThan(SIM.dietGrazeMax); // 초식 가능
    const gc = defaultGenome();
    applyCard(gc, hunter);
    expect(gc.traits.diet).toBeGreaterThan(SIM.dietHuntMin); // 사냥 가능
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
