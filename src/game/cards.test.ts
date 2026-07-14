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
  RARITY_BOOST_MAX,
  RARITY_BOOST_FULL_LEVEL,
  rarityOdds,
  cardPoolFor,
  lineageCards,
  type Lineage,
  rarityWeightsAtLevel,
  cardPrereqMet,
  cardRedundant,
  type Card,
} from "@/game/cards";
import { defaultGenome, type Traits } from "@/sim/genome";
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

describe("등급별 등장 확률(rarityOdds — 대백과 표시값)", () => {
  it.each([1, 4, 7, 20])("레벨 %i 에서 대백과 표시 확률이 drawCards 의 실제 빈도와 맞는다", (level) => {
    // 표시값이 실제와 어긋나면 그게 곧 거짓말이다. 정확값 계산을 몬테카를로로 교차검증한다.
    // 갈래를 안 넘기면 drawCards 는 공통 카드만 본다 — 표시 확률도 같은 풀로 계산해야 맞는다.
    const odds = rarityOdds(cardPoolFor(), 3, level);
    const rng = new Rng(`odds-check-${level}`);
    const rounds = 4000;
    const seen: Record<string, number> = {};
    for (let i = 0; i < rounds; i++) {
      const drawn = drawCards(rng, 3, undefined, level);
      for (const r of new Set(drawn.map(cardRarity))) seen[r] = (seen[r] ?? 0) + 1;
    }
    for (const r of ["common", "uncommon", "rare", "epic", "legendary"] as const) {
      const empirical = (seen[r] ?? 0) / rounds;
      // 4000회 표본의 표준오차는 ~0.8%p 이하 — 3%p 여유면 우연한 실패는 사실상 없다.
      expect(Math.abs(empirical - odds[r].inDraft)).toBeLessThan(0.03);
    }
  });

  it("등급별 카드 수를 다 더하면 풀 전체가 된다", () => {
    const odds = rarityOdds(CARD_POOL);
    const total = Object.values(odds).reduce((s, o) => s + o.count, 0);
    expect(total).toBe(CARD_POOL.length);
  });

  it("한 장당 확률의 합은 1", () => {
    const odds = rarityOdds(CARD_POOL);
    const sum = Object.values(odds).reduce((s, o) => s + o.perCard, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("희귀할수록 뜰 확률이 낮다", () => {
    // 실제로 뽑는 풀(공통)로 본다 — CARD_POOL 전체는 여덟 갈래의 전용 카드가 다 섞여 있어
    // 아무도 그렇게 뽑지 않는다(갈래 전용은 자기 갈래에서만 후보가 된다).
    const odds = rarityOdds(cardPoolFor());
    expect(odds.common.inDraft).toBeGreaterThan(odds.uncommon.inDraft);
    expect(odds.uncommon.inDraft).toBeGreaterThan(odds.rare.inDraft);
    expect(odds.rare.inDraft).toBeGreaterThan(odds.epic.inDraft);
    expect(odds.epic.inDraft).toBeGreaterThan(odds.legendary.inDraft);
  });

  it("풀에 없는 등급은 확률 0 (잠긴 등급을 0장으로 보여준다)", () => {
    const onlyCommon = CARD_POOL.filter((c) => cardRarity(c) === "common");
    const odds = rarityOdds(onlyCommon);
    expect(odds.legendary.count).toBe(0);
    expect(odds.legendary.inDraft).toBe(0);
    expect(odds.common.inDraft).toBe(1);
  });

  it("풀이 후보 수보다 작으면 있는 만큼만 뽑는 걸 반영한다", () => {
    const two = CARD_POOL.filter((c) => c.id === "swift" || c.id === "fins");
    const odds = rarityOdds(two, 3);
    // 2장뿐이라 둘 다 뽑힌다 → 두 등급 모두 확률 1
    expect(odds.common.inDraft).toBeCloseTo(1, 10);
    expect(odds.legendary.inDraft).toBeCloseTo(1, 10);
  });
});

const LINEAGES: Lineage[] = ["omni", "herd", "scout", "hunter", "ranged", "sea", "sky", "venom"];

describe("등급 기준 (cards.ts 주석의 규칙을 코드로 못 박는다)", () => {
  it("전설은 능력 관문 카드들 + 「거인」이다", () => {
    // v7: 무리(herd)·은신(camo)이 능력 관문으로 합류했다. 관문 카드는 **한 장으로 그 능력을 연다**
    // (herd 는 무리 방어 문턱, camo 는 은신) — 문턱을 못 넘기면 카드 설명이 거짓말이 된다.
    const legendary = CARD_POOL.filter((c) => cardRarity(c) === "legendary")
      .map((c) => c.id)
      .sort();
    expect(legendary).toEqual(
      ["echo", "fins", "long_horn", "titan", "venom_fang", "wings", "herd", "camo"].sort(),
    );
  });

  it("같은 능력 계열의 두 번째 카드는 전설이 아니다(강화이지 관문이 아니다)", () => {
    for (const id of ["webbed", "strong_wings", "bat_ear", "venom_gland", "spit"]) {
      const card = CARD_POOL.find((c) => c.id === id);
      expect(card).toBeDefined();
      if (card) expect(cardRarity(card)).not.toBe("legendary");
    }
  });

  it("흔함 카드는 생태 형질을 깎지 않는다(대가 없음이 흔함의 정의)", () => {
    // 대사(metabolism)는 양방향 절충이라 제외 — 낮아도 높아도 이득인 상황이 있다.
    const costly: (keyof Traits)[] = ["speed", "vision", "attack", "fertility", "herding"];
    for (const card of CARD_POOL.filter((c) => cardRarity(c) === "common")) {
      for (const key of costly) {
        expect(card.effects[key] ?? 0).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("귀함 이상인 비능력 카드는 모두 무언가를 잃는다(판단을 요구한다)", () => {
    // 능력형 카드는 예외다. 그 대가는 카드 수치가 아니라 sim 이 받는다(비행은 대사가 더 들고, 물전용은
    // 뭍에 못 오르고, 초음파는 시야를 내주고, **무리는 뭉치느라 먹이를 늦게 찾고, 큰 몸은 못 숨는다**).
    // 그래서 카드 효과만 보면 "공짜"로 보인다 — 예: 튼튼한 날개(날개 +30, 걸음 +6).
    // v7: 몸집(size)도 같은 성격이라 여기 넣는다 — 커지면 시뮬이 알아서 느려지고 많이 먹고 새끼를 덜 친다.
    const costly: (keyof Traits)[] = ["speed", "vision", "attack", "fertility", "size"];
    const abilityKeys: (keyof Traits)[] = [
      "swimming", "wings", "echo", "venom", "ranged", "herding", "camouflage",
    ];
    for (const card of CARD_POOL) {
      const r = cardRarity(card);
      if (r !== "rare" && r !== "epic" && r !== "legendary") continue;
      if (abilityKeys.some((k) => (card.effects[k] ?? 0) !== 0)) continue;
      const loses = costly.some((k) => (card.effects[k] ?? 0) < 0);
      expect(loses, `${card.id}(${r}) 는 대가가 없다`).toBe(true);
    }
  });

  it("등급 분포는 피라미드다(흔할수록 종류가 많다)", () => {
    // **플레이어가 실제로 뽑는 풀**로 본다 — 공통 풀(갈래 없음)과 갈래별 풀(공통 + 그 갈래 전용).
    // CARD_POOL 전체로 세면 여덟 갈래의 전용 카드가 전부 합산돼, 아무도 못 보는 분포를 검사하게 된다.
    const check = (pool: readonly Card[], label: string): void => {
      const n = (r: string): number => pool.filter((c) => cardRarity(c) === r).length;
      expect(n("common"), `${label}: 흔함 > 드묾`).toBeGreaterThan(n("uncommon"));
      expect(n("uncommon"), `${label}: 드묾 > 귀함`).toBeGreaterThan(n("rare"));
      expect(n("rare"), `${label}: 귀함 ≥ 아주 귀함`).toBeGreaterThanOrEqual(n("epic"));
      expect(n("epic"), `${label}: 아주 귀함 > 전설`).toBeGreaterThan(n("legendary"));
    };
    check(cardPoolFor(), "공통 풀");
    for (const l of LINEAGES) check(cardPoolFor(l), `${l} 갈래 풀`);
  });
});

describe("갈래 전용 카드 (슬레이 더 스파이어식 직업 풀)", () => {
  it("여덟 갈래 모두 전용 카드를 갖는다", () => {
    for (const l of LINEAGES) {
      const own = lineageCards(l);
      expect(own.length, `${l} 갈래에 전용 카드가 없다`).toBeGreaterThanOrEqual(3);
      for (const c of own) expect(c.lineage).toBe(l);
    }
  });

  it("전용 카드에 전설은 없다 — 전설은 '못 하던 걸 하게 되는' 공통 관문의 자리다", () => {
    for (const l of LINEAGES)
      for (const c of lineageCards(l)) expect(cardRarity(c)).not.toBe("legendary");
  });

  it("남의 갈래 전용 카드는 아예 안 나온다", () => {
    const pool = cardPoolFor("hunter");
    expect(pool.some((c) => c.lineage === "hunter")).toBe(true);
    expect(pool.some((c) => c.lineage !== undefined && c.lineage !== "hunter")).toBe(false);
    // 갈래를 안 정하면(시작 종 선택 전) 공통 카드만 본다.
    expect(cardPoolFor().every((c) => c.lineage === undefined)).toBe(true);
  });

  it("드래프트 3장 중 1장은 반드시 내 갈래 전용 카드다", () => {
    for (const l of LINEAGES) {
      const rng = new Rng(`lineage-${l}`);
      for (let i = 0; i < 40; i++) {
        const drawn = drawCards(rng, 3, undefined, 3, undefined, l);
        expect(drawn.length).toBe(3);
        expect(drawn.filter((c) => c.lineage === l).length, `${l}: 전용 카드가 안 나왔다`).toBeGreaterThanOrEqual(1);
        // 남의 갈래 카드는 절대 섞이지 않는다.
        expect(drawn.some((c) => c.lineage !== undefined && c.lineage !== l)).toBe(false);
      }
    }
  });

  it("능력 관문(지느러미·날개·초음파·독 살갗·가시 쏘기)은 공통이다 — 걷던 종도 날 수 있어야 한다", () => {
    for (const id of ["fins", "wings", "echo", "venom_fang", "long_horn"]) {
      const card = CARD_POOL.find((c) => c.id === id);
      expect(card, `${id} 카드가 없다`).toBeDefined();
      expect(card?.lineage, `${id} 이 갈래에 잠겼다 — 진화의 자유가 막힌다`).toBeUndefined();
    }
  });

  it("갈래 전용 카드가 다 떨어져도 3장은 채운다(공통으로 메운다)", () => {
    // 이 갈래의 전용 카드를 전부 막으면 → 남는 건 공통뿐. 그래도 후보 3장은 나와야 한다.
    const drawn = drawCards(new Rng("dry"), 3, (c) => c.lineage === undefined, 3, undefined, "sky");
    expect(drawn.length).toBe(3);
    expect(drawn.every((c) => c.lineage === undefined)).toBe(true);
  });
});

describe("레벨 보정 (세대가 오를수록 높은 등급이 자주 뜬다)", () => {
  it("레벨 1 은 보정이 없다(기준 가중치 그대로)", () => {
    const w = rarityWeightsAtLevel(1);
    for (const r of ["common", "uncommon", "rare", "epic", "legendary"] as const) {
      expect(w[r]).toBeCloseTo(RARITY_WEIGHT[r], 10);
    }
  });

  it("보정 최대 레벨에서 각 등급이 정확히 RARITY_BOOST_MAX 배가 된다", () => {
    const w = rarityWeightsAtLevel(RARITY_BOOST_FULL_LEVEL);
    for (const r of ["common", "uncommon", "rare", "epic", "legendary"] as const) {
      expect(w[r]).toBeCloseTo(RARITY_WEIGHT[r] * RARITY_BOOST_MAX[r], 10);
    }
  });

  it("보정 최대 레벨을 넘어도 더 커지지 않는다(상한)", () => {
    const at = rarityWeightsAtLevel(RARITY_BOOST_FULL_LEVEL);
    const far = rarityWeightsAtLevel(RARITY_BOOST_FULL_LEVEL + 50);
    expect(far.legendary).toBeCloseTo(at.legendary, 10);
    expect(far.common).toBeCloseTo(at.common, 10);
  });

  it("흔함은 안 커지고 희귀할수록 더 많이 커진다", () => {
    const w = rarityWeightsAtLevel(RARITY_BOOST_FULL_LEVEL);
    const ratio = (r: keyof typeof RARITY_WEIGHT): number => w[r] / RARITY_WEIGHT[r];
    expect(ratio("common")).toBeCloseTo(1, 10); // 흔함은 그대로 — 몫만 자연히 줄어든다
    expect(ratio("uncommon")).toBeGreaterThan(ratio("common"));
    expect(ratio("rare")).toBeGreaterThan(ratio("uncommon"));
    expect(ratio("epic")).toBeGreaterThan(ratio("rare"));
    expect(ratio("legendary")).toBeGreaterThan(ratio("epic"));
  });

  it("레벨이 오를수록 전설이 잘 뜨고 흔함은 덜 뜬다", () => {
    const low = rarityOdds(cardPoolFor(), 3, 1);
    const mid = rarityOdds(cardPoolFor(), 3, 4);
    const high = rarityOdds(cardPoolFor(), 3, RARITY_BOOST_FULL_LEVEL);
    expect(mid.legendary.inDraft).toBeGreaterThan(low.legendary.inDraft);
    expect(high.legendary.inDraft).toBeGreaterThan(mid.legendary.inDraft);
    expect(high.common.inDraft).toBeLessThan(low.common.inDraft);
  });

  it("보정을 받아도 등급 서열은 안 뒤집힌다(전설이 흔함보다 잦아지지 않는다)", () => {
    for (const level of [1, 3, 5, 7, 30]) {
      const o = rarityOdds(cardPoolFor(), 3, level);
      expect(o.legendary.perCard).toBeLessThan(o.epic.perCard);
      expect(o.epic.perCard).toBeLessThan(o.rare.perCard);
      expect(o.rare.perCard).toBeLessThan(o.uncommon.perCard);
      expect(o.uncommon.perCard).toBeLessThan(o.common.perCard);
    }
  });

  it("보정이 걸려도 같은 시드 + 같은 레벨이면 같은 후보(결정론 유지)", () => {
    const a = drawCards(new Rng("lvl"), 3, undefined, 6).map((c) => c.id);
    const b = drawCards(new Rng("lvl"), 3, undefined, 6).map((c) => c.id);
    expect(a).toEqual(b);
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
  it("효과가 누적되되 값형질은 증가폭이 줄고 상한 100 에서 멈춘다", () => {
    const g = defaultGenome(); // 모두 50
    const swift = CARD_POOL.find((c) => c.id === "swift");
    expect(swift).toBeDefined();
    if (!swift) return;
    applyCard(g, swift); // 속도 +15 → 값형질이라 ×0.6 = +9(상한 내려도 증가폭은 그대로)
    expect(g.traits.speed).toBe(59);

    // 같은 카드 여러 번 → 100(상한)에서 멈춤
    for (let i = 0; i < 30; i++) applyCard(g, swift);
    expect(g.traits.speed).toBe(100);
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

  it("수영 카드를 쌓아도 내 종은 물 전용 문턱을 못 넘는다(수륙양용 상한 — 육지에서 안 죽는다)", () => {
    const g = defaultGenome();
    g.traits.swimming = 88; // 바다 프리셋 수준(수륙양용)
    const fins = CARD_POOL.find((c) => c.id === "fins"); // 지느러미 +22
    const webbed = CARD_POOL.find((c) => c.id === "webbed"); // 물갈퀴 +16
    expect(fins && webbed).toBeTruthy();
    if (!fins || !webbed) return;
    applyCard(g, fins);
    applyCard(g, webbed); // 88+22+16 = 126 이지만 물 전용 문턱 아래로 막힌다
    expect(g.traits.swimming).toBeLessThan(SIM.aquaticOnlyThreshold);
    expect(g.traits.swimming).toBe(SIM.aquaticOnlyThreshold - 1); // 수륙양용 상한에 붙는다
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

describe("날개 계열 — 관문과 강화가 실제로 다르다", () => {
  it("「날개」 한 장이면 바로 난다(관문 카드는 그 능력을 실제로 열어야 한다)", () => {
    const g = defaultGenome(); // wings 0
    const wings = CARD_POOL.find((c) => c.id === "wings");
    expect(wings).toBeDefined();
    if (!wings) return;
    applyCard(g, wings);
    expect(g.traits.wings).toBeGreaterThanOrEqual(SIM.flyThreshold);
  });

  it("「튼튼한 날개」는 못 나는 종에게는 후보로 안 나온다(전제 조건)", () => {
    const strong = CARD_POOL.find((c) => c.id === "strong_wings");
    expect(strong).toBeDefined();
    if (!strong) return;
    const ground = defaultGenome(); // wings 0
    expect(cardPrereqMet(strong, ground.traits)).toBe(false);

    const flyer = defaultGenome();
    flyer.traits.wings = SIM.flyThreshold;
    expect(cardPrereqMet(strong, flyer.traits)).toBe(true);
  });

  it("「튼튼한 날개」는 날개를 상한까지 채운다(비행 대사를 덜어낸다)", () => {
    const g = defaultGenome();
    const wings = CARD_POOL.find((c) => c.id === "wings");
    const strong = CARD_POOL.find((c) => c.id === "strong_wings");
    if (!wings || !strong) return;
    applyCard(g, wings);
    applyCard(g, strong);
    expect(g.traits.wings).toBe(100);
  });

  it("전제 조건이 붙은 카드는 강화 카드뿐이다(관문에는 안 붙는다)", () => {
    const gateways = ["fins", "wings", "echo", "venom_fang", "long_horn"];
    for (const card of CARD_POOL) {
      if (!card.requiresTrait) continue;
      expect(gateways).not.toContain(card.id);
    }
    expect(CARD_POOL.find((c) => c.id === "wings")?.requiresTrait).toBeUndefined();
  });
});

describe("무의미 카드 필터(cardRedundant)", () => {
  const withSwim = (v: number): Traits => {
    const t = defaultGenome().traits;
    t.swimming = v;
    return t;
  };
  const card = (id: string): (typeof CARD_POOL)[number] => {
    const c = CARD_POOL.find((x) => x.id === id);
    if (!c) throw new Error(id);
    return c;
  };

  it("수영 문턱을 넘으면 지느러미·물갈퀴는 무의미해진다(이미 헤엄치는데 또 뜨던 버그)", () => {
    // 예전엔 물전용 문턱(90)을 봤는데, 카드로 수영은 89 까지만 오르게 막혀 있어(applyCard) 90 에 영영
    // 못 닿아 필터가 안 걸렸다 — 게다가 수영값은 문턱(65) 위에선 아무 효과도 없다(전부 임계 비교뿐).
    expect(cardRedundant(card("fins"), withSwim(SIM.swimThreshold - 1))).toBe(false); // 아직 못 헤엄침 → 유효
    expect(cardRedundant(card("fins"), withSwim(SIM.swimThreshold))).toBe(true); // 이미 헤엄침 → 무의미
    expect(cardRedundant(card("webbed"), withSwim(SIM.aquaticOnlyThreshold - 1))).toBe(true); // 카드 상한(89)서도 무의미
  });

  it("날개는 비행 문턱을 넘으면 무의미(수영과 같은 관문 규칙)", () => {
    const t = defaultGenome().traits;
    t.wings = SIM.flyThreshold - 1;
    expect(cardRedundant(card("wings"), t)).toBe(false);
    t.wings = SIM.flyThreshold;
    expect(cardRedundant(card("wings"), t)).toBe(true);
  });

  it("식성·대사 카드는 방향/절충이라 늘 유효(제외 안 함)", () => {
    const t = defaultGenome().traits;
    t.diet = 95;
    expect(cardRedundant(card("predator"), t)).toBe(false); // 이미 육식이어도 diet 는 늘 유효
    t.metabolism = 95;
    expect(cardRedundant(card("hotblood"), t)).toBe(false); // 대사도 늘 유효
  });

  it("값형질(속도 등)은 상한 100 에 닿아야 무의미", () => {
    const t = defaultGenome().traits;
    t.speed = 80;
    expect(cardRedundant(card("swift"), t)).toBe(false); // 아직 상한 아래
    t.speed = 100;
    expect(cardRedundant(card("swift"), t)).toBe(true); // 상한
  });
});

describe("반복 완화(소프트 디듑)", () => {
  const commons = ["swift", "keen", "fertile", "herd", "fangs", "pack_hunt"];
  const allow = (c: { id: string }): boolean => commons.includes(c.id);

  it("이미 여러 장 고른 카드는 뚜렷이 덜 뜬다(안 고른 같은 등급 카드보다)", () => {
    const picked = new Map([["swift", 3]]); // swift 를 세 번 골랐다
    let swiftSeen = 0;
    let keenSeen = 0;
    const rng = new Rng("dedup");
    for (let i = 0; i < 4000; i++) {
      const id = (drawCards(rng, 1, allow, 1, picked)[0] as { id: string }).id;
      if (id === "swift") swiftSeen += 1;
      else if (id === "keen") keenSeen += 1;
    }
    expect(swiftSeen).toBeGreaterThan(0); // 0 이 아니다 — 스택은 여전히 가능(뜸할 뿐)
    expect(swiftSeen * 2).toBeLessThan(keenSeen); // 고른 swift 가 안 고른 keen 보다 뚜렷이 덜
  });

  it("pickedCounts 가 없거나 비면 기존과 동일(결정론·기존 동작 보존)", () => {
    const a = drawCards(new Rng("s"), 3, undefined, 1).map((c) => c.id);
    const b = drawCards(new Rng("s"), 3, undefined, 1, new Map()).map((c) => c.id);
    expect(a).toEqual(b);
  });
});
