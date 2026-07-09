import { describe, it, expect } from "vitest";
import { Rng } from "@/sim/rng";
import {
  drawCards,
  applyCard,
  boostCard,
  cardRarity,
  CARD_POOL,
  CARD_RARITY,
  PRESET_CARDS,
  RARITY_WEIGHT,
} from "@/game/cards";
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

  it("allow 로 걸러낸 풀에서만 뽑는다", () => {
    const only = new Set(["swift", "keen", "fertile"]);
    const ids = drawCards(new Rng("filtered"), 3, (c) => only.has(c.id)).map((c) => c.id);
    expect(new Set(ids)).toEqual(only);
  });

  it("풀보다 많이 요청해도 있는 만큼만 뽑는다", () => {
    const drawn = drawCards(new Rng("small"), 5, (c) => c.id === "swift" || c.id === "keen");
    expect(drawn.length).toBe(2);
  });
});

describe("희귀도", () => {
  it("풀의 모든 카드가 희귀도를 갖는다 (새 카드를 넣으면 CARD_RARITY 에도 추가할 것)", () => {
    const missing = CARD_POOL.filter((c) => CARD_RARITY[c.id] === undefined).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it("CARD_RARITY 에 풀에 없는 유령 id 가 없다", () => {
    const poolIds = new Set(CARD_POOL.map((c) => c.id));
    const ghosts = Object.keys(CARD_RARITY).filter((id) => !poolIds.has(id));
    expect(ghosts).toEqual([]);
  });

  it("전설이 흔함보다 실제로 드물게 뽑힌다 — 배지가 등장 빈도와 일치한다", () => {
    // 배지에 "전설"이라 써 놓고 흔하게 뜨면 표시가 거짓말이 된다. 뽑기 가중치가 이를 보장한다.
    const rng = new Rng("rarity-dist");
    let legendary = 0;
    let common = 0;
    const rounds = 2000;
    for (let i = 0; i < rounds; i++) {
      for (const card of drawCards(rng, 3)) {
        const r = cardRarity(card);
        if (r === "legendary") legendary += 1;
        else if (r === "common") common += 1;
      }
    }
    expect(legendary).toBeGreaterThan(0); // 아예 안 뜨면 콘페티 연출이 죽는다
    expect(legendary * 5).toBeLessThan(common); // 흔함이 압도적으로 많다
    // 전설이 3장 안에 들 확률 ≈ 5% — 한 런(레벨업 십여 번)에 한 번 볼까 말까.
    const perDraft = legendary / rounds;
    expect(perDraft).toBeGreaterThan(0.01);
    expect(perDraft).toBeLessThan(0.15);
  });

  it("가중치는 희귀할수록 작다(단조 감소)", () => {
    expect(RARITY_WEIGHT.common).toBeGreaterThan(RARITY_WEIGHT.uncommon);
    expect(RARITY_WEIGHT.uncommon).toBeGreaterThan(RARITY_WEIGHT.rare);
    expect(RARITY_WEIGHT.rare).toBeGreaterThan(RARITY_WEIGHT.epic);
    expect(RARITY_WEIGHT.epic).toBeGreaterThan(RARITY_WEIGHT.legendary);
  });

  it("미등록 카드는 흔함으로 떨어진다", () => {
    expect(cardRarity({ id: "없는카드", name: "x", desc: "", effects: {} })).toBe("common");
  });
});

describe("시작 프리셋", () => {
  it("8종이고 id 가 고유하다", () => {
    expect(PRESET_CARDS.length).toBe(8);
    const ids = PRESET_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 프리셋이 식성(diet)을 절대값으로 정한다", () => {
    for (const p of PRESET_CARDS) {
      expect(p.set?.diet).toBeDefined();
      const diet = p.set?.diet ?? -1;
      expect(diet).toBeGreaterThanOrEqual(0);
      expect(diet).toBeLessThanOrEqual(100);
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

  it("하늘 개척자는 시작부터 날 수 있다(날개 >= 임계)", () => {
    const sky = PRESET_CARDS.find((c) => c.id === "preset_sky");
    expect(sky).toBeDefined();
    if (!sky) return;
    const g = defaultGenome(); // wings 0
    applyCard(g, sky);
    expect(g.traits.wings).toBeGreaterThanOrEqual(SIM.flyThreshold);
  });

  it("독 살갗은 시작부터 독을 지닌다(venom > 0)", () => {
    const v = PRESET_CARDS.find((c) => c.id === "preset_venom");
    expect(v).toBeDefined();
    if (!v) return;
    const g = defaultGenome(); // venom 0
    applyCard(g, v);
    expect(g.traits.venom).toBeGreaterThan(0);
  });

  it("원거리 사냥꾼은 시작부터 사거리를 지닌다(ranged > 0)", () => {
    const r = PRESET_CARDS.find((c) => c.id === "preset_ranged");
    expect(r).toBeDefined();
    if (!r) return;
    const g = defaultGenome(); // ranged 0
    applyCard(g, r);
    expect(g.traits.ranged).toBeGreaterThan(0);
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
  it("효과가 누적되되 연속 형질은 증가폭이 줄고 상한 200 에서 멈춘다", () => {
    const g = defaultGenome(); // 모두 50
    const swift = CARD_POOL.find((c) => c.id === "swift");
    expect(swift).toBeDefined();
    if (!swift) return;
    applyCard(g, swift); // 속도 +15 → 상한 200 형질이라 ×0.6 = +9
    expect(g.traits.speed).toBe(59);

    // 같은 카드 여러 번 → 200(연속 형질 상한)에서 멈춤(전엔 100에서 잘렸다)
    for (let i = 0; i < 30; i++) applyCard(g, swift);
    expect(g.traits.speed).toBe(200);
  });

  it("능력형 형질(독)은 상한 100 유지 — 증가폭도 안 줄인다", () => {
    const g = defaultGenome(); // venom 0
    const venomCard = CARD_POOL.find((c) => c.id === "venom_fang"); // venom +42
    expect(venomCard).toBeDefined();
    if (!venomCard) return;
    applyCard(g, venomCard);
    expect(g.traits.venom).toBe(42); // 안 줄임(상한 100 형질)
    for (let i = 0; i < 5; i++) applyCard(g, venomCard);
    expect(g.traits.venom).toBe(100); // 100 에서 멈춤
  });
});

describe("시대 보상 카드 강화(boostCard)", () => {
  it("효과가 배수만큼 커지고(대가 포함) 나머지 필드는 보존된다", () => {
    const sprint = CARD_POOL.find((c) => c.id === "sprint"); // speed +22, metabolism +7
    expect(sprint).toBeDefined();
    if (!sprint) return;
    const boosted = boostCard(sprint, 2);
    expect(boosted.id).toBe(sprint.id);
    expect(boosted.name).toBe(sprint.name);
    expect(boosted.effects.speed).toBe(44); // +22 → ×2
    expect(boosted.effects.metabolism).toBe(14); // 대가(+7)도 함께 ×2
    // 원본은 안 건드린다(사본).
    expect(sprint.effects.speed).toBe(22);
  });

  it("보상 카드는 표시값(effectiveDelta)과 실제 적용값이 같은 객체라 어긋나지 않는다", () => {
    // 상한 200 형질은 applyCard 가 ×0.6 하지만, boostCard 로 값 자체가 커진 카드를 그대로 쓰므로
    // 카드에 적힌 effects 가 곧 표시·적용의 단일 소스다(수치 불일치 방지).
    const swift = CARD_POOL.find((c) => c.id === "swift"); // speed +15
    if (!swift) return;
    const boosted = boostCard(swift, 2); // speed +30
    const g = defaultGenome(); // speed 50
    applyCard(g, boosted); // 200 상한 형질 → ×0.6 = +18
    expect(g.traits.speed).toBe(68);
  });
});
