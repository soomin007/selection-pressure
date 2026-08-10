// 카드 = 종이 얻는 **열쇠**와 **조건부 특성**. v9 에서 카드가 도장을 그만 준다.
//
// **v9 에서 지운 것과 그 이유** (도장이 사라지면서 질문 자체가 없어진 것들):
//   · `cardCrossesThreshold`(문턱 넘김)·「3장 중 한 장 보장」·`tierMove`/`cardTierMoves` —
//     도장이 없으면 문턱이라는 개념이 없다. 표시용 도장 이동 계산은 프리셋 화면만 쓰므로
//     `ui/traitDisplay.ts` 로 내려갔다.
//   · `boostCard`(시대 보상 강화 ×N) — 뽑은 카드의 도장을 곱하던 것이라 곱할 것이 없어졌다.
//   · 「주는 범주가 전부 최고 티어면 죽은 카드」 — 특성은 있거나 없거나라 판정이 「이미 가졌는가」
//     하나로 줄었다. 만렙 뒤 후보가 0장이 되던 사고(2026-08-09)의 근본 원인이 여기 있었다.
//
// **v8 에서 살린 계약**은 그대로다: 뽑기 결정론 · 등급이 등장 빈도와 묶여 있다 · 대백과 표시 확률이
// 실제 빈도와 맞는다 · 죽은 카드는 후보에 안 든다 · 같은 카드를 거듭 고르면 덜 뜬다.
import { describe, it, expect } from "vitest";
import { Rng } from "@/sim/rng";
import {
  drawCards,
  applyCard,
  cardCategories,
  cardFavorsCategory,
  cardPips,
  cardRarity,
  cardSummary,
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
import { PERKS, PERK_BY_NAME, perkLine, perkRarity, type PerkName } from "@/sim/perks";
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

/** 특성 이름 전부(순서는 `PERK_DEFS` 그대로). 「그릇을 다 채운 종」을 만들 때 쓴다. */
const ALL_PERKS: PerkName[] = PERKS.map((p) => p.id);

/** 최고 티어 다섯 + 열쇠 셋 — 도장 쪽으로는 더 갈 데가 없는 게놈. */
const APEX_PIPS: Pips = pipsOf({
  fang: TIER_STEPS[3],
  leg: TIER_STEPS[3],
  eye: TIER_STEPS[3],
  hide: TIER_STEPS[3],
  herd: TIER_STEPS[3],
});
const THREE_KEYS = { ...emptyKeys(), fin: true, wing: true, echo: true };

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
    const only = new Set(["pk_vision_night", "pk_speed_night", "pk_graze_day"]);
    const ids = drawCards(new Rng("filtered"), 3, (c) => only.has(c.id)).map((c) => c.id);
    expect(new Set(ids)).toEqual(only);
  });

  it("풀보다 많이 요청해도 있는 만큼만 뽑는다", () => {
    const drawn = drawCards(
      new Rng("small"),
      5,
      (c) => c.id === "pk_vision_night" || c.id === "pk_speed_night",
    );
    expect(drawn.length).toBe(2);
  });

  it("불씨 카드는 일반 뽑기에 안 섞인다(game 이 따로 끼워 넣는다)", () => {
    expect(CARD_POOL.some((c) => c.id === EMBER_CARD.id)).toBe(false);
    expect(cardPrereqMet(EMBER_CARD, defaultGenome())).toBe(false);
    // 특성도 열쇠도 도장도 안 준다 — 고르는 순간 이번 성장은 없다는 사실이 카드에 그대로 적혀 있다.
    expect(EMBER_CARD.perk).toBeUndefined();
    expect(EMBER_CARD.key).toBeUndefined();
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
  //   보여 주는 것은 늘 52장 풀이라 실제로는 안 드러난다. 실제 풀에서의 정확성은 바로 위
  //   몬테카를로 교차검증(오차 3%p 이내)이 못 박는다.

  it("등급 서열은 등장 확률로도 안 뒤집힌다 — 안 그러면 배지가 거짓말이다", () => {
    // cards.ts 의 계약: "배지에 '전설'이라 써 놓고 흔하게 뽑히면 표시가 거짓말이 되므로, 희귀도는
    // 반드시 뽑기 확률과 묶여 있어야 한다."
    //
    // ⚠ 이건 **가중치만의 성질이 아니라 풀 구성의 성질**이다. 등급이 뜰 확률 = 종류 수 × 가중치라,
    //   한 등급의 **종류 수**가 위 등급보다 많으면 가중치가 낮아도 더 자주 뜬다.
    //   v9 풀(52장)은 흔함 16 · 드묾 13 · 귀함 9 · 아주 귀함 7 · 전설 7 이라 서열이 지켜진다:
    //   레벨 1 은 1600 > 845 > 342 > 140 > 70, 최대 레벨은 1600 > 1268 > 821 > 504 > 385.
    //   ⚠ 특성 배수를 튜닝하면 `perkRarity` 가 등급을 다시 계산해 **장수가 저절로 움직인다.**
    //     그때 이 서열이 깨지면 배수를 되돌리거나 띠(`PERK_VALUE_BANDS`)를 손봐야 한다.
    for (const level of [1, 3, 5, 7, 30]) {
      const o = rarityOdds(cardPoolFor(), 3, level);
      expect(o.legendary.perCard, `레벨 ${level}: 전설 < 아주 귀함`).toBeLessThan(o.epic.perCard);
      expect(o.epic.perCard, `레벨 ${level}: 아주 귀함 < 귀함`).toBeLessThan(o.rare.perCard);
      expect(o.rare.perCard, `레벨 ${level}: 귀함 < 드묾`).toBeLessThan(o.uncommon.perCard);
      expect(o.uncommon.perCard, `레벨 ${level}: 드묾 < 흔함`).toBeLessThan(o.common.perCard);
    }
  });
});

describe("등급 기준 (v9 — 등급을 손으로 안 적는다)", () => {
  it("전설은 열쇠 카드다 — 한 장으로 「못 하던 걸 하게 되는」 자리", () => {
    const legendary = CARD_POOL.filter((c) => cardRarity(c) === "legendary");
    expect(legendary.every((c) => c.key !== undefined)).toBe(true);
    expect(legendary.length).toBe(KEY_NAMES.length);
    expect(new Set(legendary.map((c) => c.key))).toEqual(new Set(KEY_NAMES));
  });

  it("특성 카드의 등급은 perkRarity 가 낸 값과 **정확히** 같다", () => {
    // 등급을 손으로 적으면 배수를 튜닝할 때마다 배지가 조용히 거짓이 된다. 카드는 표에서 받아만 쓴다.
    for (const p of PERKS) {
      expect(cardRarity(card(`pk_${p.id}`)), `pk_${p.id} 의 등급이 손으로 적혀 있다`).toBe(perkRarity(p));
    }
    expect(CARD_POOL.filter((c) => c.perk !== undefined).length).toBe(PERKS.length);
    expect(CARD_POOL.length).toBe(PERKS.length + KEY_NAMES.length);
  });

  it("모든 카드가 특성이나 열쇠 중 **정확히 하나**를 준다(도장은 안 준다)", () => {
    for (const c of CARD_POOL) {
      const gives = (c.perk !== undefined ? 1 : 0) + (c.key !== undefined ? 1 : 0);
      expect(gives, `${c.id} 가 주는 것이 하나가 아니다`).toBe(1);
      // v9 에서 드래프트 카드는 도장을 안 준다 — 도장은 오직 방울로만 오른다.
      expect(c.pips, `${c.id} 에 도장이 적혀 있다`).toBeUndefined();
      expect(c.ember, `${c.id} 가 불씨를 준다(불씨는 풀 밖 카드다)`).toBeUndefined();
    }
  });

  it("desc 에 효과를 안 적는다 — 효과는 특성 줄이 말한다(두 곳에 적으면 어긋난다)", () => {
    // 수치가 문구에 박히면 표와 문구가 언젠가 한쪽만 바뀐다. 배수는 desc 에 없어야 한다.
    for (const c of CARD_POOL) {
      expect(c.desc, `${c.id} 의 설명에 수치가 박혀 있다`).not.toMatch(/[+\-−]\s?\d|×\s?\d/);
      expect(c.desc.length, `${c.id} 에 설명이 없다`).toBeGreaterThan(0);
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

describe("카드 적용 — 특성이 붙고, 열쇠가 열리고, (프리셋만) 도장이 찍힌다", () => {
  it("드래프트 카드는 도장을 1비트도 안 움직인다(v9 에서 도장은 방울로만 오른다)", () => {
    for (const c of CARD_POOL) {
      const g = genomeFromPips(pipsOf({ fang: 4, leg: 4, eye: 4, hide: 4, herd: 4 }), emptyKeys());
      const before = { ...g.pips };
      applyCard(g, c);
      for (const cat of CATEGORIES) expect(g.pips[cat], `${c.id} / ${cat}`).toBe(before[cat]);
    }
  });

  it("프리셋에 적힌 도장은 정확히 그만큼 찍힌다(거짓말이 원리적으로 불가능하다)", () => {
    for (const p of PRESET_CARDS) {
      const g = defaultGenome();
      applyCard(g, p);
      for (const cat of CATEGORIES) expect(g.pips[cat], `${p.id} / ${cat}`).toBe(cardPips(p, cat));
    }
  });

  it("고르면 genome.perks 에 **정확히 그 특성 하나**가 들어간다", () => {
    for (const c of CARD_POOL) {
      if (c.perk === undefined) continue;
      const g = defaultGenome();
      applyCard(g, c);
      expect(g.perks, c.id).toEqual([c.perk]);
    }
  });

  it("같은 특성을 두 번 넣어도 하나뿐이다 — 중복하면 배수가 곱해져 화면 한 줄과 갈린다", () => {
    const c = card("pk_vision_night");
    const g = defaultGenome();
    applyCard(g, c);
    applyCard(g, c);
    expect(g.perks).toEqual([c.perk]);
  });

  it("특성은 파생 능치를 안 건드린다(상황마다 켜졌다 꺼지는 것이라 고정 표에 안 들어간다)", () => {
    const g = defaultGenome();
    const before = { ...g.traits };
    for (const c of CARD_POOL) if (c.perk !== undefined) applyCard(g, c);
    expect(g.perks.length).toBe(PERKS.length);
    expect(g.traits).toEqual(before);
  });

  it("열쇠 카드는 열쇠를 열고, 상한(3개)을 넘겨 열지 않는다", () => {
    const g = defaultGenome();
    for (const c of CARD_POOL.filter((x) => x.key !== undefined)) applyCard(g, c);
    expect(keyCount(g.keys)).toBe(MAX_KEYS);
  });

  it("한 줄 요약(cardSummary)이 perkLine 과 **글자 그대로** 같다", () => {
    // ⚠ 여기에 배수를 적지 않는다 — 배수를 튜닝하면 그 자리가 조용히 낡는다. `perks.ts` 가 만든 줄과
    //   카드가 내놓는 줄이 같은지만 본다(두 곳에 적으면 반드시 한쪽만 바뀐다).
    for (const c of CARD_POOL) {
      if (c.perk === undefined) continue;
      const p = PERK_BY_NAME.get(c.perk);
      expect(p, `${c.id} 의 특성이 표에 없다`).toBeDefined();
      if (p) expect(cardSummary(c), c.id).toBe(perkLine(p));
    }
    expect(cardSummary(card("ky_fin"))).toContain("열쇠 「지느러미」");
    expect(cardSummary(EMBER_CARD)).toContain("불씨 +1");
    // 프리셋만 도장을 말한다(드래프트 풀 밖이라 규칙이 다르다).
    const omni = PRESET_CARDS.find((c) => c.id === "preset_omni") as Card;
    expect(cardSummary(omni)).toBe(`이빨 +${cardPips(omni, "fang")} · 눈 +${cardPips(omni, "eye")}`);
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
    const full = genomeFromPips(emptyPips(), THREE_KEYS);
    for (const c of CARD_POOL.filter((x) => x.key !== undefined)) {
      expect(cardPrereqMet(c, full), c.id).toBe(false);
    }
  });

  it("이미 가진 특성은 후보에 안 든다 — 같은 특성은 한 번뿐이다", () => {
    const has = genomeFromPips(emptyPips(), emptyKeys(), ["vision_night"]);
    expect(cardRedundant(card("pk_vision_night"), has)).toBe(true);
    expect(cardPrereqMet(card("pk_vision_night"), has)).toBe(false);
    // 같은 축의 다른 특성은 여전히 후보다(축을 판다고 그 축이 닫히지 않는다).
    expect(cardRedundant(card("pk_vision_day"), has)).toBe(false);
    expect(cardPrereqMet(card("pk_vision_day"), has)).toBe(true);
  });

  it("도장은 후보 판정에 아무 영향이 없다 — 최고 티어 종에게도 카드 52장이 그대로 뜬다", () => {
    // v8 에서 「주는 범주가 전부 최고 티어면 죽은 카드」였고, 그것이 만렙 뒤 빈 드래프트의 원인이었다.
    const apex = genomeFromPips(APEX_PIPS, emptyKeys());
    const bare = defaultGenome();
    for (const c of CARD_POOL) {
      expect(cardPrereqMet(c, apex), c.id).toBe(cardPrereqMet(c, bare));
    }
    expect(CARD_POOL.filter((c) => cardPrereqMet(c, apex)).length).toBe(CARD_POOL.length);
  });

  it("어떤 게놈에서도 후보에 남은 카드는 반드시 무언가를 바꾼다", () => {
    const genomes = [
      defaultGenome(),
      genomeFromPips(pipsOf({ fang: TIER_STEPS[3] }), emptyKeys()),
      genomeFromPips(APEX_PIPS, { ...emptyKeys(), fin: true }, ALL_PERKS.slice(0, 20)),
      genomeFromPips(APEX_PIPS, THREE_KEYS, ALL_PERKS),
    ];
    for (const g of genomes) {
      for (const c of CARD_POOL) {
        if (!cardPrereqMet(c, g) || cardRedundant(c, g)) continue;
        const opensKey = c.key !== undefined && !g.keys[c.key] && keyCount(g.keys) < MAX_KEYS;
        const addsPerk = c.perk !== undefined && !g.perks.includes(c.perk);
        expect(opensKey || addsPerk, `${c.id}: 후보인데 아무것도 안 바꾼다`).toBe(true);
      }
    }
  });

  it("한 런에 실제로 닿을 수 있는 최대 성장에서도 후보 3장이 채워진다(필터가 풀을 말리지 않는다)", () => {
    // 한 런의 카드는 12~22장이다(tiers.ts 실측표). 22장을 **전부 특성으로만** 채우고 도장도 열쇠도
    // 꽉 채운 자리 — 실제 플레이가 닿을 수 있는 가장 마른 지점이다.
    const maxed = genomeFromPips(APEX_PIPS, THREE_KEYS, ALL_PERKS.slice(0, 22));
    const allow = (c: Card): boolean => cardPrereqMet(c, maxed) && !cardRedundant(c, maxed);
    expect(CARD_POOL.filter(allow).length).toBe(PERKS.length - 22); // 남은 특성 23장
    const rng = new Rng("apex-pool");
    for (let i = 0; i < 40; i++) {
      expect(drawCards(rng, 3, allow, 7).length).toBe(3);
    }
  });

  it("풀이 마르는 것은 **특성 마흔다섯을 전부 가졌을 때뿐**이고, 그건 한 런으로 못 닿는다", () => {
    // v8 의 사고: 성장 그릇이 「도장 100 + 열쇠 3」뿐이라 5시대짜리 런이 시대 3에 그릇을 채웠고,
    // 그 뒤 드래프트가 통째로 비었다(2026-08-09). v9 의 그릇은 「특성 45 + 열쇠 3」이라 한 런
    // (카드 12~22장)으로는 절반도 못 채운다 — 즉 **정상 플레이에서 도달 불가능한 자리**다.
    // 그래도 0장이 되는 것 자체는 사실이므로, 그 사실을 여기 못 박아 둔다(game 이 빈 후보를 받는
    // 경우를 언젠가 다루게 될 때 근거가 된다).
    const everything = genomeFromPips(emptyPips(), THREE_KEYS, ALL_PERKS);
    const allow = (c: Card): boolean => cardPrereqMet(c, everything) && !cardRedundant(c, everything);
    expect(CARD_POOL.filter(allow).length).toBe(0);
    expect(drawCards(new Rng("everything"), 3, allow, 7)).toEqual([]);

    // 한 장만 모자라면 정확히 그 한 장이 뜬다 — 마르는 것은 「전부 가졌을 때」 딱 한 지점뿐이다.
    const almost = genomeFromPips(emptyPips(), THREE_KEYS, ALL_PERKS.slice(1));
    const allowAlmost = (c: Card): boolean => cardPrereqMet(c, almost) && !cardRedundant(c, almost);
    expect(CARD_POOL.filter(allowAlmost).map((c) => c.id)).toEqual([`pk_${ALL_PERKS[0] as string}`]);
  });
});

describe("내가 판 방향이 조금 더 자주 뜬다(DraftBias — 보장이 아니라 가중)", () => {
  // ⚠ 판정 근거가 v9 에서 바뀌었다: 카드가 도장을 안 주므로 `cardPips` 로는 「내 방향」을 알 수 없다.
  //   대신 `cardFavorsCategory` 가 특성의 **축**(이빨 ↔ 무는·사냥)과 열쇠의 **모 범주**로 판정한다.
  //   드래프트 가중과 game.ts 의 「내 방향이 몇 판째 안 떴나」 집계가 **둘 다 이 함수 하나**를 쓴다.

  it("판정은 축과 모 범주가 한다 — 카드 한 장은 정확히 한 범주만 편든다", () => {
    for (const c of CARD_POOL) {
      const favored = CATEGORIES.filter((cat) => cardFavorsCategory(c, cat));
      expect(favored.length, `${c.id} 가 편드는 범주가 하나가 아니다`).toBe(1);
      if (c.key !== undefined) expect(favored[0], c.id).toBe(KEY_PARENT[c.key]);
    }
    // 이빨을 판 사람에게는 무는·사냥 카드가 뜬다(축 표가 그렇게 이어 준다).
    expect(cardFavorsCategory(card("pk_attack_night"), "fang")).toBe(true);
    expect(cardFavorsCategory(card("pk_attack_night"), "eye")).toBe(false);
    expect(cardFavorsCategory(card("ky_fin"), "leg")).toBe(true); // 지느러미의 모 범주는 다리
  });

  it("가중을 걸면 그 범주의 카드가 뚜렷이 자주 뜬다", () => {
    const count = (weight: number): number => {
      const rng = new Rng("bias");
      let seen = 0;
      for (let i = 0; i < 1500; i++) {
        const drawn = drawCards(rng, 3, undefined, 5, undefined, { cats: ["fang"], weight });
        seen += drawn.filter((c) => cardFavorsCategory(c, "fang")).length;
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
      if (!drawn.some((c) => cardFavorsCategory(c, "fang"))) empty += 1;
    }
    expect(empty).toBeGreaterThan(0);
  });

  it("가중 1 은 보정 없음과 완전히 같다(결정론 보존)", () => {
    const a = drawCards(new Rng("b1"), 3, undefined, 5).map((c) => c.id);
    const b = drawCards(new Rng("b1"), 3, undefined, 5, undefined, { cats: ["fang"], weight: 1 }).map(
      (c) => c.id,
    );
    expect(a).toEqual(b);
  });
});

describe("반복 완화(소프트 디듑)", () => {
  // 전부 흔함 등급이라 가중치가 같다 — 차이가 나면 그건 오직 「몇 번 골랐나」 때문이다.
  const commons = [
    "pk_graze_day",
    "pk_graze_crowd",
    "pk_hunt_always",
    "pk_hunt_hungry",
    "pk_attack_always",
    "pk_attack_hunting",
  ];
  const allow = (c: { id: string }): boolean => commons.includes(c.id);

  it("고른 여섯 장이 모두 같은 등급이다(이 테스트의 전제)", () => {
    for (const id of commons) expect(cardRarity(card(id)), id).toBe("common");
  });

  it("이미 여러 장 고른 카드는 뚜렷이 덜 뜬다(안 고른 같은 등급 카드보다)", () => {
    const picked = new Map([["pk_graze_day", 3]]); // 세 번 골랐다
    let pickedSeen = 0;
    let freshSeen = 0;
    const rng = new Rng("dedup");
    for (let i = 0; i < 4000; i++) {
      const id = (drawCards(rng, 1, allow, 1, picked)[0] as Card).id;
      if (id === "pk_graze_day") pickedSeen += 1;
      else if (id === "pk_graze_crowd") freshSeen += 1;
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

describe("갈래 전용 풀은 폐기됐다 — 52장 전부가 누구에게나 나온다", () => {
  it("cardPoolFor 는 늘 풀 전체를 준다", () => {
    expect(cardPoolFor().length).toBe(CARD_POOL.length);
    expect(CARD_POOL.length).toBe(52);
  });

  it("최고 티어 상한은 넷이다(사다리 끝이 곧 성장의 끝)", () => {
    expect(MAX_TIER).toBe(4);
    expect(TIER_STEPS.length).toBe(MAX_TIER);
  });
});
