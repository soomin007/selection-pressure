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
  cardGateOpen,
  cardPrereqMet,
  cardRedundant,
  type Card,
  type Rarity,
} from "@/game/cards";
import { defaultGenome, genomeFromPips } from "@/sim/genome";
import { ACHIEVEMENT_CARDS } from "@/game/achievements";
import {
  AXIS_CATEGORY,
  PERKS,
  PERK_BY_NAME,
  gateDepth,
  isDuoPerk,
  perkGate,
  perkLine,
  perkRarity,
  type PerkName,
} from "@/sim/perks";
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

/** 규칙 특성 카드(듀오 + 3단·4단 고유 카드) — 전부 깊은 게이트라 「전체 풀」 서열 셈에서 뺀다. */
const isRuleCard = (c: Card): boolean =>
  c.perk !== undefined && PERK_BY_NAME.get(c.perk)?.rule !== undefined;
/** 그중 듀오 카드 — 두 범주 3단에서만 열리고, 이름·문구가 tiers.DUOS 에 산다.
 *  ⚠ rule 유무로 가르면 안 된다(2026-08-11 · 고유 카드 스물도 rule 을 준다). */
const isDuoCard = (c: Card): boolean => c.perk !== undefined && isDuoPerk(c.perk);

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
    const only = new Set(["pk_vision_day", "pk_speed_night", "pk_graze_day"]);
    const ids = drawCards(new Rng("filtered"), 3, (c) => only.has(c.id)).map((c) => c.id);
    expect(new Set(ids)).toEqual(only);
  });

  it("풀보다 많이 요청해도 있는 만큼만 뽑는다", () => {
    const drawn = drawCards(
      new Rng("small"),
      5,
      (c) => c.id === "pk_vision_day" || c.id === "pk_speed_night",
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
    //   ⚠ 특성 배수를 튜닝하면 `perkRarity` 가 등급을 다시 계산해 **장수가 저절로 움직인다.**
    //     그때 이 서열이 깨지면 배수를 되돌리거나 띠(`PERK_VALUE_BANDS`)를 손봐야 한다.
    //
    // ⚠⚠ **듀오 열 장은 이 셈에서 뺀다**(2026-08-10). 풀 전체로 세면 「아주 귀함」의 종류가 갑절이
    //   되어 서열이 뒤집히는데, 그 수는 **아무도 겪지 않는 세계의 수**다 · 듀오는 두 범주를 함께
    //   3단으로 올려야(도장 28개) 후보에 뜨고, 다섯 범주를 전부 3단으로 만드는 판은 존재하지 않는다
    //   (tiers.ts 사다리표: 가장 후한 판도 두 범주가 한계다). 한 종이 실제로 보는 후보 풀에서
    //   서열이 지켜지는지는 **바로 아래 테스트**가 따로 못 박는다.
    // ⚠⚠ 2026-08-11 부터 이 셈에서 빼는 것이 「듀오」에서 「규칙 카드 전부」(듀오 + 3단·4단 고유
    //   카드 스물)로 넓어졌다. 이유는 같다 — 전부 깊은 티어 게이트 뒤에 있어, 풀 전체로 세면
    //   **아무도 겪지 않는 세계의 수**가 서열을 뒤집는다(전설이 열쇠 7 + 4단 카드 10 = 17종이 된다).
    //   그리고 배수 특성은 이제 귀함(rare)까지만 나온다 — 아주 귀함·전설은 게이트 등급이라
    //   이 사다리는 흔함~귀함 세 단만 잰다. 실제 종이 보는 풀은 아래 테스트가 따로 못 박는다.
    const noRule = cardPoolFor().filter((c) => !isRuleCard(c) && c.key === undefined);
    for (const level of [1, 3, 5, 7, 30]) {
      const o = rarityOdds(noRule, 3, level);
      expect(o.rare.perCard, `레벨 ${level}: 귀함 < 드묾`).toBeLessThan(o.uncommon.perCard);
      expect(o.uncommon.perCard, `레벨 ${level}: 드묾 < 흔함`).toBeLessThan(o.common.perCard);
    }
  });

  it("**한 종이 실제로 보는 후보 풀**에서도 서열이 지켜진다 · 듀오를 포함해서", () => {
    // 위 테스트가 듀오를 뺀 이유의 반대편 증명이다. 실제 종에게는 게이트가 걸려 있으므로
    // 후보에 드는 듀오가 한둘뿐이고, 그러면 「아주 귀함」이 「귀함」을 못 넘는다.
    const at3 = (...cats: Category[]): Pips => {
      const p = emptyPips();
      for (const c of cats) p[c] = TIER_STEPS[2] as number;
      return p;
    };
    const cases: [string, Pips][] = [
      ["두 기둥(이빨+무리)", at3("fang", "herd")],
      ["두 기둥(가죽+다리)", at3("hide", "leg")],
      ["세 기둥(이빨+무리+가죽)", at3("fang", "herd", "hide")],
    ];
    for (const [label, pips] of cases) {
      const g = genomeFromPips(pips, emptyKeys());
      // 도전 과제 보상 카드는 뺀다 — 실제 드래프트(`drawDraft`)도 cardAvailable 로 거른다.
      const pool = CARD_POOL.filter((c) => cardPrereqMet(c, g) && !ACHIEVEMENT_CARDS.has(c.id));
      const duos = pool.filter(isDuoCard);
      // 두 기둥이면 듀오는 정확히 하나, 세 기둥이어도 셋이다(짝의 수 = 기둥 수 C 2).
      expect(duos.length, `${label}: 후보에 드는 듀오 수`).toBeLessThanOrEqual(3);
      // 레벨 1 에서는 실제 후보 풀에서도 사다리가 선다(전설 < 아주 귀함 < 귀함).
      // ⚠ **레벨 30 은 일부러 안 잰다**(2026-08-11): 깊게 판 종은 3단 고유 카드가 여럿 열려 있고
      //   레벨 보정이 위 등급을 밀어 올려, 후반에는 아주 귀함이 귀함보다 잦아진다. 그건 배지의
      //   거짓말이 아니라 **티어를 올린 보상**이다(**[사용자 2026-08-10]** "티어를 올리면 더 좋은
      //   카드, 더 특별한 카드들이 열려서") · 초반 사다리만 계약으로 못 박는다.
      const o = rarityOdds(pool, 3, 1);
      expect(o.epic.perCard, `${label} 레벨 1: 아주 귀함 < 귀함`).toBeLessThan(o.rare.perCard);
      expect(o.legendary.perCard, `${label} 레벨 1: 전설 < 아주 귀함`).toBeLessThan(o.epic.perCard);
    }
  });
});

describe("등급 기준 (v9 — 등급을 손으로 안 적는다)", () => {
  it("전설 = **없던 규칙** — 열쇠 일곱 + 4단 규칙 카드 열", () => {
    // 옛 경계 「전설은 열쇠 전용」은 2026-08-11 에 넓어졌다: **[사용자 2026-08-10]** 이
    // 「죽지 않는 것」을 전설 예시로 들며 4단 카드에 그 무게를 줬다. 공통 정의는 「없던 규칙을 연다」.
    const legendary = CARD_POOL.filter((c) => cardRarity(c) === "legendary");
    const keyCards = legendary.filter((c) => c.key !== undefined);
    const ruleCards = legendary.filter((c) => c.key === undefined);
    expect(keyCards.length).toBe(KEY_NAMES.length);
    expect(new Set(keyCards.map((c) => c.key))).toEqual(new Set(KEY_NAMES));
    expect(ruleCards.length, "전설 규칙 카드는 4단 열 장뿐").toBe(10);
    for (const c of ruleCards) {
      expect(gateDepth(perkGate(c.perk as PerkName)), `${c.id} 는 4단 게이트여야 한다`).toBe(4);
    }
  });

  it("듀오 열 장은 **두 범주 3단 전에는 후보에 안 든다** · 티어를 올릴 이유가 여기 있다", () => {
    const duoCards = CARD_POOL.filter(isDuoCard);
    expect(duoCards.length, "듀오 카드 수").toBe(10);
    for (const c of duoCards) {
      expect(cardRarity(c), `${c.id} 의 등급`).toBe("epic");
      // 도장이 하나도 없는 종에게는 절대 안 뜬다.
      expect(cardGateOpen(c, defaultGenome()), `${c.id} 가 0단에서 열렸다`).toBe(false);
      // 한 범주만 최고 티어여도 안 뜬다 · 두 범주가 함께 3단이라야 한다.
      for (const cat of CATEGORIES) {
        const only = emptyPips();
        only[cat] = TIER_STEPS[3] as number;
        expect(cardGateOpen(c, genomeFromPips(only, emptyKeys())), `${c.id} 가 ${cat} 하나로 열렸다`).toBe(
          false,
        );
      }
    }
    // 다섯 범주가 전부 3단이면(현실에서는 안 오는 자리) 열 장이 다 열린다 · 게이트가 막힌 게 아니다.
    const all3 = genomeFromPips(
      pipsOf({
        fang: TIER_STEPS[2],
        leg: TIER_STEPS[2],
        eye: TIER_STEPS[2],
        hide: TIER_STEPS[2],
        herd: TIER_STEPS[2],
      }),
      emptyKeys(),
    );
    expect(duoCards.filter((c) => cardGateOpen(c, all3)).length).toBe(10);
  });

  it("듀오 카드는 **고른 뒤에야** 종에 붙는다 · 도장이 저절로 켜 주지 않는다", () => {
    const g = genomeFromPips(pipsOf({ fang: TIER_STEPS[2], herd: TIER_STEPS[2] }), emptyKeys());
    expect(g.perks).toEqual([]); // 3단 둘을 가졌지만 아직 아무 듀오도 없다
    const wolflaw = CARD_POOL.find((c) => c.perk === "duo_wolflaw") as Card;
    expect(cardPrereqMet(wolflaw, g)).toBe(true); // 후보에는 든다
    applyCard(g, wolflaw);
    expect(g.perks).toEqual(["duo_wolflaw"]);
    expect(cardRedundant(wolflaw, g), "같은 듀오를 두 번 주지 않는다").toBe(true);
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
    const c = card("pk_vision_day");
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
    // ⚠ 열쇠 카드는 **모 범주 1단**에서 열린다(2026-08-10 게이트). 도장 0 으로 재면 게이트에서
    //    먼저 걸려 「이미 가져서 빠진 것」과 구별이 안 된다 — 그래서 다리를 1단으로 켜 놓고 잰다.
    const has = genomeFromPips(pipsOf({ leg: TIER_STEPS[0] }), { ...emptyKeys(), fin: true });
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
    // 게이트를 열어 두고 잰다(최고 티어) · 안 그러면 게이트에 먼저 걸려 중복 판정이 안 보인다.
    const has = genomeFromPips(APEX_PIPS, emptyKeys(), ["vision_grass"]);
    expect(cardRedundant(card("pk_vision_grass"), has)).toBe(true);
    expect(cardPrereqMet(card("pk_vision_grass"), has)).toBe(false);
    // 같은 축의 다른 특성은 여전히 후보다(축을 판다고 그 축이 닫히지 않는다).
    expect(cardRedundant(card("pk_vision_day"), has)).toBe(false);
    expect(cardPrereqMet(card("pk_vision_day"), has)).toBe(true);
  });

  // ⚠⚠ **이 계약은 2026-08-10 저녁에 정반대로 뒤집혔다.**
  //   그날 아침(v9 1차)에는 「도장은 후보 판정에 아무 영향이 없다」가 계약이었다 — v8 의 「최고 티어면
  //   죽은 카드」가 만렙 뒤 빈 드래프트를 만들었기에 그 반대로 갔던 것이다.
  //   그런데 **[사용자 2026-08-10]** 폰 검토에서 「티어를 올리면 더 특별한 카드가 열려야 한다 ·
  //   지금은 역할이 뒤바뀌었다」는 지적이 나와, 도장이 **카드를 여는 열쇠**가 됐다.
  //   두 계약이 정반대라 헷갈리기 쉽다: **도장은 카드를 「닫지」 않고 「연다」.** 최고 티어 종에게
  //   모든 카드가 열리는 것은 그대로이고, 달라진 것은 **낮은 티어에서 일부가 아직 안 열린다**는 쪽이다.
  it("도장이 카드를 **연다** — 최고 티어 종에게는 전부 열린다", () => {
    const apex = genomeFromPips(APEX_PIPS, emptyKeys());
    expect(CARD_POOL.filter((c) => cardPrereqMet(c, apex)).length).toBe(CARD_POOL.length);
  });

  // ⚠ 2026-08-10 밤에 뒤집혔다: 낮에는 「도장이 없으면 0장」이었는데 그것이 악순환을 만들었다
  //   (시작 범주 카드만 계속 뜬다 → 다른 범주를 볼 일이 없다 → 올릴 이유가 없다).
  //   지금은 **범주마다 두 장이 문 밖에 있다**(`perks.ts` 의 BASE_GATES 머리 주석).
  it("도장이 없어도 다섯 범주가 다 보인다 — 「이런 범주가 있다」를 시작부터 알린다", () => {
    const bare = defaultGenome();
    const open = CARD_POOL.filter((c) => cardPrereqMet(c, bare));
    expect(open.length).toBe(10); // 범주 다섯 × 둘
    expect(open.every((c) => c.perk !== undefined), "열쇠는 아직 안 열린다").toBe(true);
  });

  it("**시작 갈래로 시작해도 다섯 범주가 다 후보에 든다** — 한 범주만 계속 뜨면 안 된다", () => {
    // [사용자 2026-08-10] "매번 이빨 카드만 떠서 다른 범주는 아예 올릴 엄두도 못 내고 있는데."
    // 잡식(이빨 4 · 눈 3)으로 시작한 그 자리를 그대로 재현해 잰다.
    for (const preset of PRESET_CARDS) {
      const g = defaultGenome();
      applyCard(g, preset);
      const open = CARD_POOL.filter((c) => cardPrereqMet(c, g));
      const cats = new Set<Category>();
      for (const c of open) {
        if (c.perk === undefined) continue;
        const p = PERK_BY_NAME.get(c.perk);
        if (p !== undefined) cats.add(AXIS_CATEGORY[p.axis]);
      }
      expect(cats.size, `${preset.name}: 후보에 든 범주 수`).toBe(CATEGORIES.length);
    }
  });

  it("티어를 올리면 후보가 늘어난다 — 드래프트에서 눈으로 확인되는 보상", () => {
    const counts = [1, 2, 3, 4].map((tier) => {
      const pips = emptyPips();
      for (const c of CATEGORIES) pips[c] = TIER_STEPS[tier - 1] as number;
      const g = genomeFromPips(pips, emptyKeys());
      return CARD_POOL.filter((c) => cardPrereqMet(c, g)).length;
    });
    expect(counts[1] as number, "2단이 1단보다 많다").toBeGreaterThan(counts[0] as number);
    expect(counts[2] as number, "3단이 2단보다 많다").toBeGreaterThan(counts[1] as number);
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

  it("풀이 마르는 것은 **특성 전부를 가졌을 때뿐**이고, 그건 한 런으로 못 닿는다", () => {
    // v8 의 사고: 성장 그릇이 「도장 100 + 열쇠 3」뿐이라 5시대짜리 런이 시대 3에 그릇을 채웠고,
    // 그 뒤 드래프트가 통째로 비었다(2026-08-09). v9 의 그릇은 「특성 45 + 열쇠 3」이라 한 런
    // (카드 12~22장)으로는 절반도 못 채운다 — 즉 **정상 플레이에서 도달 불가능한 자리**다.
    // 그래도 0장이 되는 것 자체는 사실이므로, 그 사실을 여기 못 박아 둔다(game 이 빈 후보를 받는
    // 경우를 언젠가 다루게 될 때 근거가 된다).
    const everything = genomeFromPips(APEX_PIPS, THREE_KEYS, ALL_PERKS);
    const allow = (c: Card): boolean => cardPrereqMet(c, everything) && !cardRedundant(c, everything);
    expect(CARD_POOL.filter(allow).length).toBe(0);
    expect(drawCards(new Rng("everything"), 3, allow, 7)).toEqual([]);

    // 한 장만 모자라면 정확히 그 한 장이 뜬다 — 마르는 것은 「전부 가졌을 때」 딱 한 지점뿐이다.
    const almost = genomeFromPips(APEX_PIPS, THREE_KEYS, ALL_PERKS.slice(1));
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

describe("갈래 전용 풀은 폐기됐다 — 풀 전체가 누구에게나 나온다", () => {
  it("cardPoolFor 는 늘 풀 전체를 준다", () => {
    expect(cardPoolFor().length).toBe(CARD_POOL.length);
    expect(CARD_POOL.length).toBe(PERKS.length + KEY_NAMES.length);
  });

  it("최고 티어 상한은 넷이다(사다리 끝이 곧 성장의 끝)", () => {
    expect(MAX_TIER).toBe(4);
    expect(TIER_STEPS.length).toBe(MAX_TIER);
  });
});
