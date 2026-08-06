// 카드 = 종에 찍히는 **도장(pip)**. v8 에서 카드의 정체가 통째로 바뀌었다.
//
// **지운 것과 그 이유** (v7 시절 계약 중 v8 에서 뜻이 사라진 것들):
//   · 성장 스케일(CARD_GROWTH_SCALE)·상한 근접 감쇠(growthFalloff)·정점 고정 — 카드가 형질 숫자를
//     직접 올리던 시절의 장치다. 카드가 도장만 찍는 지금은 "얼마나 붙는가"라는 질문 자체가 없다.
//   · 희생(sacrifice)·전제 조건(requiresTrait)·효과 표(effects)·cardDelta/effectiveDelta —
//     같은 이유로 사라졌다. 표시와 적용이 갈릴 수 있는 자리가 원리적으로 없어졌기 때문이다.
//   · 갈래 전용 카드 풀(lineageCards) — 「3장 중 1장은 반드시 내 갈래」를 보장하면 내 범주만 계속
//     쌓여 고르는 일이 사라진다. **[사용자 2026-08-06]** 보장이 아니라 확률 가중(`DraftBias`)으로 바꿨다.
//   · CARD_RARITY 표 — 희귀도가 카드 객체의 필드가 되어 "표에 빠진 카드" 자체가 불가능해졌다.
//
// **살린 계약**은 전부 새 구조로 옮겼다: 뽑기 결정론 · 등급이 등장 빈도와 묶여 있다 · 대백과 표시
// 확률이 실제 빈도와 맞는다 · 죽은 카드는 후보에 안 든다 · 같은 카드를 거듭 고르면 덜 뜬다.
import { describe, it, expect } from "vitest";
import { Rng } from "@/sim/rng";
import {
  drawCards,
  applyCard,
  boostCard,
  cardCategories,
  cardCrossesThreshold,
  cardPips,
  cardRarity,
  cardSummary,
  cardTierMoves,
  tierMove,
  CARD_POOL,
  EMBER_CARD,
  PRESET_CARDS,
  PRESET_LINEAGE,
  LINEAGE_NAME,
  RARITY_WEIGHT,
  RARITY_BOOST_MAX,
  RARITY_BOOST_FULL_LEVEL,
  rarityOdds,
  cardPoolFor,
  rarityWeightsAtLevel,
  cardPrereqMet,
  cardRedundant,
  type Card,
  type Rarity,
} from "@/game/cards";
import { defaultGenome, genomeFromPips } from "@/sim/genome";
import {
  CATEGORIES,
  KEY_NAMES,
  KEY_PARENT,
  MAX_KEYS,
  MAX_TIER,
  TIER_STEPS,
  emptyKeys,
  emptyPips,
  keyCount,
  pipsToNext,
  tierOf,
  type Category,
  type Pips,
} from "@/sim/tiers";

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;

const card = (id: string): Card => {
  const c = CARD_POOL.find((x) => x.id === id);
  if (!c) throw new Error(`카드 없음: ${id}`);
  return c;
};

const pipsOf = (partial: Partial<Pips>): Pips => ({ ...emptyPips(), ...partial });

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
    const only = new Set(["wc_fang1", "wc_leg1", "wc_eye1"]);
    const ids = drawCards(new Rng("filtered"), 3, (c) => only.has(c.id)).map((c) => c.id);
    expect(new Set(ids)).toEqual(only);
  });

  it("풀보다 많이 요청해도 있는 만큼만 뽑는다", () => {
    const drawn = drawCards(new Rng("small"), 5, (c) => c.id === "wc_fang1" || c.id === "wc_leg1");
    expect(drawn.length).toBe(2);
  });

  it("불씨 카드는 일반 뽑기에 안 섞인다(game 이 따로 끼워 넣는다)", () => {
    expect(CARD_POOL.some((c) => c.id === EMBER_CARD.id)).toBe(false);
    expect(cardPrereqMet(EMBER_CARD, defaultGenome())).toBe(false);
    // 도장은 0 이다 — 고르는 순간 이번 성장은 없다는 사실이 카드에 그대로 적혀 있다.
    expect(cardCategories(EMBER_CARD)).toEqual([]);
    expect(EMBER_CARD.ember).toBeGreaterThan(0);
  });
});

describe("희귀도 — 배지가 등장 빈도와 일치한다", () => {
  it("풀의 모든 카드가 희귀도를 갖는다(필드라 빠질 수가 없다)", () => {
    for (const c of CARD_POOL) expect(RARITIES).toContain(cardRarity(c));
  });

  it("전설이 흔함보다 실제로 드물게 뽑힌다", () => {
    // 배지에 "전설"이라 써 놓고 흔하게 뜨면 표시가 거짓말이 된다. 뽑기 가중치가 이를 보장한다.
    const rng = new Rng("rarity-dist");
    let legendary = 0;
    let common = 0;
    const rounds = 2000;
    for (let i = 0; i < rounds; i++) {
      for (const c of drawCards(rng, 3)) {
        const r = cardRarity(c);
        if (r === "legendary") legendary += 1;
        else if (r === "common") common += 1;
      }
    }
    expect(legendary).toBeGreaterThan(0); // 아예 안 뜨면 콘페티 연출이 죽는다
    expect(legendary * 5).toBeLessThan(common); // 흔함이 압도적으로 많다
  });

  it("가중치는 희귀할수록 작다(단조 감소)", () => {
    expect(RARITY_WEIGHT.common).toBeGreaterThan(RARITY_WEIGHT.uncommon);
    expect(RARITY_WEIGHT.uncommon).toBeGreaterThan(RARITY_WEIGHT.rare);
    expect(RARITY_WEIGHT.rare).toBeGreaterThan(RARITY_WEIGHT.epic);
    expect(RARITY_WEIGHT.epic).toBeGreaterThan(RARITY_WEIGHT.legendary);
  });
});

describe("등급별 등장 확률(rarityOdds — 대백과 표시값)", () => {
  it.each([1, 4, 7, 20])("레벨 %i 에서 대백과 표시 확률이 drawCards 의 실제 빈도와 맞는다", (level) => {
    // 표시값이 실제와 어긋나면 그게 곧 거짓말이다. 정확값 계산을 몬테카를로로 교차검증한다.
    const odds = rarityOdds(cardPoolFor(), 3, level);
    const rng = new Rng(`odds-check-${level}`);
    const rounds = 4000;
    const seen: Record<string, number> = {};
    for (let i = 0; i < rounds; i++) {
      const drawn = drawCards(rng, 3, undefined, level);
      for (const r of new Set(drawn.map(cardRarity))) seen[r] = (seen[r] ?? 0) + 1;
    }
    for (const r of RARITIES) {
      const empirical = (seen[r] ?? 0) / rounds;
      // 4000회 표본의 표준오차는 ~0.8%p 이하 — 3%p 여유면 우연한 실패는 사실상 없다.
      expect(Math.abs(empirical - odds[r].inDraw)).toBeLessThan(0.03);
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

  it("풀에 없는 등급은 확률 0 (잠긴 등급을 0장으로 보여준다)", () => {
    const onlyCommon = CARD_POOL.filter((c) => cardRarity(c) === "common");
    const odds = rarityOdds(onlyCommon);
    expect(odds.legendary.count).toBe(0);
    expect(odds.legendary.inDraw).toBe(0);
    expect(odds.common.inDraw).toBe(1);
  });

  // ⚠ 「풀이 후보 수보다 작으면 있는 만큼만 뽑는 걸 반영한다」는 테스트를 지웠다. `rarityOdds` 의
  //   `inDraw` 는 **독립 3회 추첨 근사**(1-(1-p)³)라 풀 크기를 안 본다 — 2장짜리 풀에서는 둘 다 반드시
  //   뽑히는데 표시는 25% 로 나온다. 이건 v8 에서 생긴 결함이 아니라 처음부터 그런 근사였고, 대백과가
  //   보여 주는 것은 늘 75장 풀이라 실제로는 안 드러난다. 실제 풀에서의 정확성은 바로 위
  //   몬테카를로 교차검증(오차 3%p 이내)이 못 박는다.

  it("등급 서열은 등장 확률로도 안 뒤집힌다 — 안 그러면 배지가 거짓말이다", () => {
    // cards.ts 의 계약: "배지에 '전설'이라 써 놓고 흔하게 뽑히면 표시가 거짓말이 되므로, 희귀도는
    // 반드시 뽑기 확률과 묶여 있어야 한다."
    //
    // ⚠ 이건 **가중치만의 성질이 아니라 풀 구성의 성질**이다. 등급이 뜰 확률 = 종류 수 × 가중치라,
    //   한 등급의 **종류 수**가 위 등급보다 많으면 가중치가 낮아도 더 자주 뜬다.
    //   지금 풀은 흔함 26 · 드묾 24 · 귀함 5 · 아주 귀함 10 · 전설 7 이라 **아주 귀함(10장)이
    //   귀함(5장)보다 자주 뜬다**(4.33% vs 4.11%). 고치는 길은 둘 중 하나다:
    //   귀함 카드를 늘리거나, 아주 귀함 몇 장을 귀함으로 내리는 것.
    for (const level of [1, 3, 5, 7, 30]) {
      const o = rarityOdds(cardPoolFor(), 3, level);
      expect(o.legendary.perCard, `레벨 ${level}: 전설 < 아주 귀함`).toBeLessThan(o.epic.perCard);
      expect(o.epic.perCard, `레벨 ${level}: 아주 귀함 < 귀함`).toBeLessThan(o.rare.perCard);
      expect(o.rare.perCard, `레벨 ${level}: 귀함 < 드묾`).toBeLessThan(o.uncommon.perCard);
      expect(o.uncommon.perCard, `레벨 ${level}: 드묾 < 흔함`).toBeLessThan(o.common.perCard);
    }
  });
});

describe("등급 기준 (cards.ts 주석의 규칙을 코드로 못 박는다)", () => {
  it("전설은 열쇠 카드다 — 한 장으로 「못 하던 걸 하게 되는」 자리", () => {
    const legendary = CARD_POOL.filter((c) => cardRarity(c) === "legendary");
    expect(legendary.every((c) => c.key !== undefined)).toBe(true);
    expect(new Set(legendary.map((c) => c.key))).toEqual(new Set(KEY_NAMES));
  });

  it("열쇠 카드는 모 범주에도 도장을 하나 찍는다(세기가 곧 그 범주의 티어이므로)", () => {
    for (const c of CARD_POOL) {
      if (c.key === undefined) continue;
      expect(cardPips(c, KEY_PARENT[c.key]), `${c.id} 가 모 범주에 도장을 안 찍는다`).toBeGreaterThan(0);
    }
  });

  it("desc 에 효과를 안 적는다 — 효과는 티어 칩과 티어 줄이 말한다(두 곳에 적으면 어긋난다)", () => {
    // 수치가 문구에 박히면 표와 문구가 언젠가 한쪽만 바뀐다. 도장 수·배수는 desc 에 없어야 한다.
    for (const c of CARD_POOL) {
      expect(c.desc, `${c.id} 의 설명에 수치가 박혀 있다`).not.toMatch(/[+\-−]\s?\d|×\s?\d/);
    }
  });

  it("맞바꿈 카드만 도장을 깎는다 — 그리고 주는 쪽이 확연히 크다", () => {
    for (const c of CARD_POOL) {
      const loses = CATEGORIES.filter((cat) => cardPips(c, cat) < 0);
      if (loses.length === 0) continue;
      const gain = CATEGORIES.reduce((s, cat) => s + Math.max(0, cardPips(c, cat)), 0);
      const loss = loses.reduce((s, cat) => s - cardPips(c, cat), 0);
      expect(gain, `${c.id}: 잃는 것보다 얻는 것이 커야 한다`).toBeGreaterThan(loss * 2);
      // **[사용자 2026-08-06]** "다른 칸 수를 줄이는 거라면 그만큼 보상이 더욱 획기적이어야 할 거야."
      expect(["epic", "legendary"], `${c.id}: 대가가 있는 카드가 흔한 등급이다`).toContain(cardRarity(c));
    }
  });

  it("어떤 카드도 아무 도장도 안 찍지 않는다(죽은 카드가 풀에 없다)", () => {
    for (const c of CARD_POOL) {
      const touched = CATEGORIES.some((cat) => cardPips(c, cat) !== 0);
      expect(touched || c.key !== undefined, `${c.id} 는 아무 일도 안 한다`).toBe(true);
    }
  });
});

describe("레벨 보정 (세대가 오를수록 높은 등급이 자주 뜬다)", () => {
  it("레벨 1 은 보정이 없다(기준 가중치 그대로)", () => {
    const w = rarityWeightsAtLevel(1);
    for (const r of RARITIES) expect(w[r]).toBeCloseTo(RARITY_WEIGHT[r], 10);
  });

  it("보정 최대 레벨에서 각 등급이 정확히 RARITY_BOOST_MAX 배가 된다", () => {
    const w = rarityWeightsAtLevel(RARITY_BOOST_FULL_LEVEL);
    for (const r of RARITIES) expect(w[r]).toBeCloseTo(RARITY_WEIGHT[r] * RARITY_BOOST_MAX[r], 10);
  });

  it("보정 최대 레벨을 넘어도 더 커지지 않는다(상한)", () => {
    const at = rarityWeightsAtLevel(RARITY_BOOST_FULL_LEVEL);
    const far = rarityWeightsAtLevel(RARITY_BOOST_FULL_LEVEL + 50);
    expect(far.legendary).toBeCloseTo(at.legendary, 10);
    expect(far.common).toBeCloseTo(at.common, 10);
  });

  it("흔함은 안 커지고 희귀할수록 더 많이 커진다", () => {
    const w = rarityWeightsAtLevel(RARITY_BOOST_FULL_LEVEL);
    const ratio = (r: Rarity): number => w[r] / RARITY_WEIGHT[r];
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
    expect(mid.legendary.inDraw).toBeGreaterThan(low.legendary.inDraw);
    expect(high.legendary.inDraw).toBeGreaterThan(mid.legendary.inDraw);
    expect(high.common.inDraw).toBeLessThan(low.common.inDraw);
  });

  it("보정이 걸려도 같은 시드 + 같은 레벨이면 같은 후보(결정론 유지)", () => {
    const a = drawCards(new Rng("lvl"), 3, undefined, 6).map((c) => c.id);
    const b = drawCards(new Rng("lvl"), 3, undefined, 6).map((c) => c.id);
    expect(a).toEqual(b);
  });
});

describe("시작 갈래(프리셋) — 시작 도장 다섯 + 시작 열쇠", () => {
  it("아홉 갈래이고 id 가 고유하다", () => {
    expect(PRESET_CARDS.length).toBe(9);
    const ids = PRESET_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 갈래 이름표가 프리셋마다 있다(화면이 "어떤 종으로 시작하는가"를 말할 수 있게).
    for (const p of PRESET_CARDS) {
      const lin = PRESET_LINEAGE[p.id];
      expect(lin, `${p.id} 에 갈래가 없다`).toBeDefined();
      if (lin) expect(LINEAGE_NAME[lin].length).toBeGreaterThan(0);
    }
  });

  it("모든 갈래가 두 범주를 1단으로 켜고 시작한다 — 「멀리 보고 + 무엇을 한다」가 함께 성립해야 한다", () => {
    // ⚠ 처음엔 「1단 하나」로 잡았다가 실측으로 무너졌다(cards.ts 프리셋 주석): 축 하나만 켜면
    //   탐색 반경과 걸음 중 하나가 빠져 단위 시간에 훑는 면적이 무너지고 사망의 60%가 굶주림이 됐다
    //   (도달 시대 3.8 → 2.0 · 정복 0/30). 그래서 시작 도장 수는 **사다리와 한 쌍**이다.
    for (const p of PRESET_CARDS) {
      const cats = cardCategories(p);
      expect(cats.length, `${p.id} 의 시작 범주가 둘이 아니다`).toBe(2);
      const main = cats[0] as Category;
      const sub = cats[1] as Category;
      expect(cardPips(p, main), `${p.id} 주 범주`).toBeGreaterThan(cardPips(p, sub));

      const g = defaultGenome();
      applyCard(g, p);
      expect(tierOf(g.pips[main]), `${p.id}: 주 범주가 1단으로 안 켜졌다`).toBe(1);
      expect(tierOf(g.pips[sub]), `${p.id}: 부 범주가 1단으로 안 켜졌다`).toBe(1);
      // 두 범주 다 2단은 아니다 — 1단으로 시작해 사다리를 올라가는 것이 이 게임의 성장이다.
      expect(tierOf(g.pips[main])).toBeLessThan(2);
      // 다음 문턱이 눈앞에 있다(주 범주 쪽이 더 가깝다).
      expect(pipsToNext(g.pips[main])).toBeLessThan(pipsToNext(g.pips[sub]));
    }
  });

  it("열쇠를 가진 갈래는 시작부터 그 능력을 쓴다(바다·하늘·원거리·독)", () => {
    const expected: Record<string, string> = {
      preset_sea: "fin",
      preset_sky: "wing",
      preset_ranged: "barb",
      preset_venom: "venom",
    };
    for (const [id, key] of Object.entries(expected)) {
      const p = PRESET_CARDS.find((c) => c.id === id);
      expect(p, `${id} 프리셋이 없다`).toBeDefined();
      if (!p) continue;
      expect(p.key).toBe(key);
      const g = defaultGenome();
      applyCard(g, p);
      expect(g.keys[key as keyof typeof g.keys]).toBe(true);
    }
  });

  it("느린 거인은 이빨에 도장이 하나도 없다 — 초식 거인 경로의 출발점", () => {
    // **[사용자 2026-08-06]** 「초식 거인 경로는 반드시 만든다」. 이빨 0단 = 풀 효율이 온전한 1.0 이고
    // 사냥은 영영 못 한다. 그게 벌이 아니라 **빌드**라는 것을 시작 갈래가 말한다.
    const g = defaultGenome();
    applyCard(g, card("lp_hide1") ?? PRESET_CARDS[0]!); // 자리표시 — 아래에서 진짜 프리셋으로 다시 만든다
    const giant = defaultGenome();
    const preset = PRESET_CARDS.find((c) => c.id === "preset_giant");
    expect(preset).toBeDefined();
    if (!preset) return;
    applyCard(giant, preset);
    expect(giant.pips.fang).toBe(0);
    expect(giant.traits.hunt).toBe(0);
    expect(giant.traits.graze).toBeGreaterThan(0.9);
    // 대신 가죽이 켜져 몸집이 커진다(몸집은 고르는 축이 아니라 잔액이다).
    expect(giant.traits.size).toBeGreaterThan(50);
  });
});

describe("카드 적용 — 도장을 찍고, 문턱을 넘으면 켜진다", () => {
  it("적힌 도장이 정확히 그만큼 찍힌다(거짓말이 원리적으로 불가능하다)", () => {
    for (const c of CARD_POOL) {
      const g = genomeFromPips(pipsOf({ fang: 4, leg: 4, eye: 4, hide: 4, herd: 4 }), emptyKeys());
      const before = { ...g.pips };
      applyCard(g, c);
      for (const cat of CATEGORIES) {
        expect(g.pips[cat] - before[cat], `${c.id} / ${cat}`).toBe(cardPips(c, cat));
      }
    }
  });

  it("도장은 0 아래로 안 내려간다(맞바꿈이 마이너스를 만들지 않는다)", () => {
    const trade = CARD_POOL.find((c) => CATEGORIES.some((cat) => cardPips(c, cat) < 0));
    expect(trade).toBeDefined();
    if (!trade) return;
    const g = defaultGenome();
    applyCard(g, trade);
    for (const cat of CATEGORIES) expect(g.pips[cat]).toBeGreaterThanOrEqual(0);
  });

  it("문턱을 안 넘으면 세계가 1비트도 안 움직인다(저축은 저축일 뿐)", () => {
    const g = genomeFromPips(pipsOf({ fang: TIER_STEPS[0] }), emptyKeys());
    const before = { ...g.traits };
    applyCard(g, card("wc_fang1")); // 이빨 +2 — 1단(3)에서 5 로, 2단(8)엔 못 닿는다
    expect(tierOf(g.pips.fang)).toBe(1);
    expect(g.traits).toEqual(before);
  });

  it("문턱을 넘기는 순간 그 범주가 통째로 켜진다", () => {
    const g = genomeFromPips(pipsOf({ fang: TIER_STEPS[0] - 1 }), emptyKeys());
    expect(g.traits.hunt).toBe(0); // 아직 사냥을 못 한다
    applyCard(g, card("wc_fang1")); // +2 → 문턱을 넘는다
    expect(tierOf(g.pips.fang)).toBe(1);
    expect(g.traits.hunt).toBeGreaterThan(0); // 사냥이 열린다
  });

  it("맞바꿈은 티어를 실제로 강등시킨다(대가가 화면에도 그 자리에서 보이는 그 값)", () => {
    const trade = CARD_POOL.find((c) => CATEGORIES.some((cat) => cardPips(c, cat) < 0));
    expect(trade).toBeDefined();
    if (!trade) return;
    const loss = CATEGORIES.find((cat) => cardPips(trade, cat) < 0) as Category;
    const g = genomeFromPips(pipsOf({ [loss]: TIER_STEPS[0] } as Partial<Pips>), emptyKeys());
    const move = tierMove(trade, g.pips, loss);
    expect(move.from).toBe(1);
    expect(move.to).toBe(0); // 카드가 「▾」로 예고한 그 강등
    applyCard(g, trade);
    expect(tierOf(g.pips[loss])).toBe(0);
  });

  it("열쇠 카드는 열쇠를 열고, 상한(3개)을 넘겨 열지 않는다", () => {
    const g = defaultGenome();
    for (const c of CARD_POOL.filter((x) => x.key !== undefined)) applyCard(g, c);
    expect(keyCount(g.keys)).toBe(MAX_KEYS);
  });

  it("티어 이동 예고(cardTierMoves)가 실제 적용과 정확히 같다 — 칩이 곧 결과다", () => {
    for (const c of CARD_POOL) {
      for (const start of [0, 2, TIER_STEPS[0], TIER_STEPS[1], TIER_STEPS[2], TIER_STEPS[3]]) {
        const pips = pipsOf({ fang: start, leg: start, eye: start, hide: start, herd: start });
        const g = genomeFromPips(pips, emptyKeys());
        const moves = cardTierMoves(c, pips);
        applyCard(g, c);
        for (const m of moves) {
          expect(tierOf(g.pips[m.cat]), `${c.id} / ${m.cat} @${start}`).toBe(m.to);
          expect(pipsToNext(g.pips[m.cat])).toBe(m.remain);
        }
      }
    }
  });

  it("한 줄 요약(cardSummary)이 실제 도장·열쇠와 맞는다", () => {
    expect(cardSummary(card("wc_fang1"))).toBe("이빨 +2");
    expect(cardSummary(card("td_hl"))).toBe("가죽 +3 · 다리 −1");
    expect(cardSummary(card("ky_fin"))).toContain("열쇠 「지느러미」");
    expect(cardSummary(EMBER_CARD)).toContain("불씨 +1");
  });
});

describe("시대 보상 카드 강화(boostCard)", () => {
  it("도장이 배수만큼 커지고 대가(음수)는 안 커진다 — 보상이 벌이 되면 안 된다", () => {
    const trade = CARD_POOL.find((c) => CATEGORIES.some((cat) => cardPips(c, cat) < 0));
    expect(trade).toBeDefined();
    if (!trade) return;
    const boosted = boostCard(trade, 2);
    for (const cat of CATEGORIES) {
      const base = cardPips(trade, cat);
      expect(cardPips(boosted, cat)).toBe(base > 0 ? base * 2 : base);
    }
    // 원본은 안 건드린다(사본).
    expect(cardPips(trade, cardCategories(trade)[0] as Category)).toBeGreaterThan(0);
  });

  it("표시(칩)와 적용이 같은 객체에서 나온다 — 강화 카드도 갈릴 수 없다", () => {
    const boosted = boostCard(card("wc_fang1"), 3);
    const g = defaultGenome();
    const moves = cardTierMoves(boosted, g.pips);
    applyCard(g, boosted);
    expect(g.pips.fang).toBe(cardPips(boosted, "fang"));
    for (const m of moves) expect(tierOf(g.pips[m.cat])).toBe(m.to);
  });

  it("배수 1 이하는 도장을 안 키운다(음수 배수 방어)", () => {
    const one = boostCard(card("wc_fang1"), 1);
    expect(cardPips(one, "fang")).toBe(cardPips(card("wc_fang1"), "fang"));
    const zero = boostCard(card("wc_fang1"), 0);
    expect(cardPips(zero, "fang")).toBe(cardPips(card("wc_fang1"), "fang"));
  });
});

describe("죽은 카드 필터(cardPrereqMet · cardRedundant)", () => {
  it("이미 가진 열쇠 카드는 후보에 안 든다", () => {
    const has = genomeFromPips(emptyPips(), { ...emptyKeys(), fin: true });
    expect(cardPrereqMet(card("ky_fin"), has)).toBe(false);
    expect(cardRedundant(card("ky_fin"), has)).toBe(true);
    expect(cardPrereqMet(card("ky_wing"), has)).toBe(true); // 아직 안 가진 열쇠는 유효
  });

  it("열쇠 상한(3개)에 닿으면 열쇠 카드가 통째로 빠진다", () => {
    const full = genomeFromPips(emptyPips(), { ...emptyKeys(), fin: true, wing: true, echo: true });
    for (const c of CARD_POOL.filter((x) => x.key !== undefined)) {
      expect(cardPrereqMet(c, full), c.id).toBe(false);
    }
  });

  it("주는 범주가 전부 최고 티어면 그 카드는 아무 일도 못 한다", () => {
    const maxed = genomeFromPips(pipsOf({ fang: TIER_STEPS[3] }), emptyKeys());
    expect(cardPrereqMet(card("wc_fang1"), maxed)).toBe(false); // 이빨만 주는 카드
    expect(cardRedundant(card("wc_fang1"), maxed)).toBe(true);
    // 한 범주라도 남아 있으면 후보다(부분 무효는 후보다).
    expect(cardPrereqMet(card("tw_fl"), maxed)).toBe(true); // 이빨 +1 · 다리 +1
    expect(cardRedundant(card("tw_fl"), maxed)).toBe(false);
  });

  it("문턱을 안 넘는 것 자체는 죽은 게 아니다(다음 장을 위한 저축이다)", () => {
    const g = genomeFromPips(pipsOf({ fang: TIER_STEPS[0] }), emptyKeys());
    expect(cardRedundant(card("wc_fang1"), g)).toBe(false);
  });

  it("어떤 게놈에서도 후보에 남은 카드는 반드시 무언가를 바꾼다", () => {
    const genomes = [
      defaultGenome(),
      genomeFromPips(pipsOf({ fang: TIER_STEPS[3] }), emptyKeys()),
      genomeFromPips(pipsOf({ fang: TIER_STEPS[3], leg: TIER_STEPS[3] }), { ...emptyKeys(), fin: true }),
      genomeFromPips(
        pipsOf({ fang: TIER_STEPS[3], leg: TIER_STEPS[3], eye: TIER_STEPS[3], hide: TIER_STEPS[3], herd: TIER_STEPS[3] }),
        { ...emptyKeys(), fin: true, wing: true, echo: true },
      ),
    ];
    for (const g of genomes) {
      for (const c of CARD_POOL) {
        if (!cardPrereqMet(c, g) || cardRedundant(c, g)) continue;
        const changes = c.key !== undefined || CATEGORIES.some((cat) => cardPips(c, cat) !== 0);
        expect(changes, `${c.id}: 후보인데 아무것도 안 바꾼다`).toBe(true);
      }
    }
  });

  it("한 런에 실제로 닿을 수 있는 최대 성장에서도 후보 3장이 채워진다(필터가 풀을 말리지 않는다)", () => {
    // 한 런의 도장 공급은 넉넉해도 약 30 개다(tiers.ts 실측표) — 두 범주를 최고 티어까지 미는 것이
    // 사실상 한계다. 그 지점에서 후보가 마르면 후반 드래프트가 빈 화면이 된다.
    const maxed = genomeFromPips(pipsOf({ fang: TIER_STEPS[3], leg: TIER_STEPS[3] }), {
      ...emptyKeys(),
      fin: true,
      wing: true,
      echo: true,
    });
    const allow = (c: Card): boolean => cardPrereqMet(c, maxed) && !cardRedundant(c, maxed);
    const rng = new Rng("apex-pool");
    for (let i = 0; i < 40; i++) {
      expect(drawCards(rng, 3, allow, 7).length).toBe(3);
    }
  });
});

describe("죽은 카드 규칙 (나) — 3장 중 최소 한 장은 문턱을 넘긴다", () => {
  it("도장 상황을 넘기면 문턱을 넘기는 카드가 반드시 한 장 들어간다", () => {
    // 이게 없으면 "도장은 오르는데 아무 일도 안 일어나는 픽"이 쌓이고, 새끼를 확정으로 주는 스킵이
    // 늘 정답이 된다. **[사용자 2026-08-06]** 은 보장이 아니라 확률이 재미라고 했지만, 그건 「내 방향
    // 카드가 뜨는가」의 이야기다 — 「이번 판에 아무 일도 안 일어나는가」는 보장으로 막는다.
    const rng = new Rng("cross");
    for (const start of [0, 1, 2, TIER_STEPS[0], TIER_STEPS[1] - 1, TIER_STEPS[2] - 1]) {
      const pips = pipsOf({ fang: start, leg: start, eye: start, hide: start, herd: start });
      for (let i = 0; i < 40; i++) {
        const drawn = drawCards(rng, 3, undefined, 5, undefined, undefined, pips);
        expect(drawn.length).toBe(3);
        expect(
          drawn.some((c) => cardCrossesThreshold(c, pips)),
          `도장 ${start}: 문턱을 넘기는 카드가 하나도 없다`,
        ).toBe(true);
      }
    }
  });

  it("도장을 안 넘기면 보장을 안 건다(기존 뽑기 그대로 · 결정론 보존)", () => {
    const a = drawCards(new Rng("nopips"), 3, undefined, 5).map((c) => c.id);
    const b = drawCards(new Rng("nopips"), 3, undefined, 5, undefined, undefined, undefined).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it("문턱을 넘기는 장이 늘 첫 자리에 오지 않는다(위치만 보고 알아버리면 안 된다)", () => {
    const pips = emptyPips();
    const rng = new Rng("shuffle");
    const positions = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const drawn = drawCards(rng, 3, undefined, 5, undefined, undefined, pips);
      drawn.forEach((c, idx) => {
        if (cardCrossesThreshold(c, pips)) positions.add(idx);
      });
    }
    expect(positions.size).toBeGreaterThan(1);
  });
});

describe("내가 판 방향이 조금 더 자주 뜬다(DraftBias — 보장이 아니라 가중)", () => {
  it("가중을 걸면 그 범주의 카드가 뚜렷이 자주 뜬다", () => {
    const count = (weight: number): number => {
      const rng = new Rng("bias");
      let seen = 0;
      for (let i = 0; i < 1500; i++) {
        const drawn = drawCards(rng, 3, undefined, 5, undefined, { cats: ["fang"], weight });
        seen += drawn.filter((c) => cardPips(c, "fang") > 0).length;
      }
      return seen;
    };
    expect(count(3)).toBeGreaterThan(count(1) * 1.3);
  });

  it("보장이 아니다 — 가중을 걸어도 내 방향이 하나도 없는 드래프트가 생긴다", () => {
    // **[사용자 2026-08-06]** "애초에 로그라이크는 그 무작위성과 예측 불가능함 속 운적 요소가 핵심 재미인 거잖아."
    const rng = new Rng("bias-miss");
    let empty = 0;
    for (let i = 0; i < 400; i++) {
      const drawn = drawCards(rng, 3, undefined, 5, undefined, { cats: ["fang"], weight: 2.5 });
      if (!drawn.some((c) => cardPips(c, "fang") > 0)) empty += 1;
    }
    expect(empty).toBeGreaterThan(0);
  });

  it("가중 1 은 보정 없음과 완전히 같다(결정론 보존)", () => {
    const a = drawCards(new Rng("b1"), 3, undefined, 5).map((c) => c.id);
    const b = drawCards(new Rng("b1"), 3, undefined, 5, undefined, { cats: ["fang"], weight: 1 }).map((c) => c.id);
    expect(a).toEqual(b);
  });
});

describe("반복 완화(소프트 디듑)", () => {
  const commons = ["wc_fang1", "wc_leg1", "wc_eye1", "wc_hide1", "wc_herd1", "tw_fl"];
  const allow = (c: { id: string }): boolean => commons.includes(c.id);

  it("이미 여러 장 고른 카드는 뚜렷이 덜 뜬다(안 고른 같은 등급 카드보다)", () => {
    const picked = new Map([["wc_fang1", 3]]); // 세 번 골랐다
    let pickedSeen = 0;
    let freshSeen = 0;
    const rng = new Rng("dedup");
    for (let i = 0; i < 4000; i++) {
      const id = (drawCards(rng, 1, allow, 1, picked)[0] as { id: string }).id;
      if (id === "wc_fang1") pickedSeen += 1;
      else if (id === "wc_leg1") freshSeen += 1;
    }
    expect(pickedSeen).toBeGreaterThan(0); // 0 이 아니다 — 스택은 여전히 가능(뜸할 뿐)
    expect(pickedSeen * 2).toBeLessThan(freshSeen); // 고른 쪽이 뚜렷이 덜
  });

  it("pickedCounts 가 없거나 비면 기존과 동일(결정론·기존 동작 보존)", () => {
    const a = drawCards(new Rng("s"), 3, undefined, 1).map((c) => c.id);
    const b = drawCards(new Rng("s"), 3, undefined, 1, new Map()).map((c) => c.id);
    expect(a).toEqual(b);
  });
});

describe("갈래 전용 풀은 폐기됐다 — 75장 전부가 누구에게나 나온다", () => {
  it("cardPoolFor 는 늘 풀 전체를 준다", () => {
    expect(cardPoolFor().length).toBe(CARD_POOL.length);
    expect(CARD_POOL.length).toBe(75);
  });

  it("최고 티어 상한은 넷이다(사다리 끝이 곧 성장의 끝)", () => {
    expect(MAX_TIER).toBe(4);
    expect(TIER_STEPS.length).toBe(MAX_TIER);
  });
});
