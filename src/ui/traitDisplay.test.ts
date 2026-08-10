// 티어·특성 표시 규칙: **칩이 사실을 말하는가.**
//
// 이 파일이 지키는 계약은 예나 지금이나 하나다: **화면이 말하는 것과 실제로 일어나는 일이 같다**
// ("수치가 화면 표시와 다르면 그건 거짓말이다"). 다만 v9 에서 「말하는 것」의 주역이 바뀌었다.
//
// v8 까지: 드래프트 카드가 도장을 찍었고, 칩은 「이 카드를 고르면 어느 티어로 가는가」를 예고했다.
// v9 부터: **드래프트 카드는 도장을 안 준다**(도장은 방울로만 오른다). 카드가 주는 것은 **조건부
//   특성**과 **열쇠** 둘뿐이고, 칩은 그 특성 한 줄을 그대로 옮긴다.
//
// 그래서 다음 계약들은 **뜻을 잃어 지웠다**:
//   · 옛 카드 id(`wc_fang1` · `wc_leg1` · `ln_fl`)로 잡던 넘김·저축·대표 색. 그 카드들이 사라졌다.
//   · 「드래프트 카드가 문턱을 넘긴다」. 도장이 없으면 문턱이라는 개념 자체가 없다.
//   · 「치우침 카드는 주 범주 색」. 도장 배분이 있는 카드는 이제 프리셋뿐이다.
// 대신 그 계약들은 **살아 있는 자리(시작 갈래 · 특성 칩)로 옮겨 유지한다.** 아래 세 줄이 이 파일의 뼈대다:
//   ① 특성 칩의 글자는 `perkLine` 이 만든 것과 **한 글자도 다르지 않다**(두 곳에 적지 않는다).
//   ② 칩은 최대 세 개다(360px 폰에서 카드 밖으로 삐져나간 전례가 있다).
//   ③ 프리셋의 도장 칩은 예전 계약 그대로다(켜짐 · 저축 · 강등 · 최고 티어).
import { describe, it, expect } from "vitest";
import {
  DOWN_CHIP_COLOR,
  KEY_CHIP_COLOR,
  PIP_BAR_MAX,
  SAVE_CHIP_COLOR,
  cardAccent,
  cardTierChips,
  cardTierMoves,
  categoryColor,
  crossingMoves,
  demotingMoves,
  hexColor,
  iGa,
  pipPct,
  tierBadges,
  tierMove,
  tierTrackBackground,
} from "@/ui/traitDisplay";
import { CARD_POOL, EMBER_CARD, PRESET_CARDS, applyCard, cardPips, type Card } from "@/game/cards";
import { defaultGenome, genomeFromPips } from "@/sim/genome";
import { AXIS_CATEGORY, PERK_BY_NAME, perkLine } from "@/sim/perks";
import {
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  KEY_LABELS,
  MAX_TIER,
  TIER_ROMAN,
  TIER_STEPS,
  emptyKeys,
  emptyPips,
  pipsToNext,
  tierOf,
  type Category,
  type Pips,
} from "@/sim/tiers";

/**
 * 이 범주에 도장을 찍는 시작 갈래 하나. **id 를 손으로 박지 않는다.** 프리셋 구성이 바뀌면
 * 조용히 낡는 대신 그 자리에서 터지게 한다(옛 테스트가 `wc_fang1` 을 박아 뒀다가 카드 풀이
 * 통째로 갈릴 때 뜻을 잃었다).
 */
const presetStamping = (cat: Category): Card => {
  const p = PRESET_CARDS.find((c) => cardPips(c, cat) > 0);
  if (!p) throw new Error(`${cat} 에 도장을 찍는 시작 갈래가 없다`);
  return p;
};

/** 특성을 주는 드래프트 카드들(= 카드 풀에서 열쇠를 뺀 나머지). */
const PERK_CARDS: readonly Card[] = CARD_POOL.filter((c) => c.perk !== undefined);
/** 열쇠를 여는 드래프트 카드들. */
const KEY_CARDS_IN_POOL: readonly Card[] = CARD_POOL.filter((c) => c.key !== undefined);

const pipsOf = (partial: Partial<Pips>): Pips => ({ ...emptyPips(), ...partial });

/** 이 파일이 훑는 도장 상황들: 0단부터 최고 티어까지, 문턱 바로 앞과 바로 뒤를 모두 지난다. */
const SAMPLE_PIPS: number[] = [
  0,
  1,
  TIER_STEPS[0] - 1,
  TIER_STEPS[0],
  TIER_STEPS[1] - 1,
  TIER_STEPS[1],
  TIER_STEPS[2] - 1,
  TIER_STEPS[2],
  TIER_STEPS[3] - 1,
  TIER_STEPS[3],
];

describe("칩이 사실을 말한다 · 예고한 것이 실제 결과와 같다", () => {
  it("풀 전체 · 모든 도장 상황에서 칩의 예고와 적용 결과가 정확히 같다", () => {
    for (const c of [...CARD_POOL, ...PRESET_CARDS, EMBER_CARD]) {
      for (const start of SAMPLE_PIPS) {
        const pips = pipsOf({ fang: start, leg: start, eye: start, hide: start, herd: start });
        const chips = cardTierChips(c, pips);
        const cross = crossingMoves(c, pips);
        const down = demotingMoves(c, pips);

        const g = genomeFromPips(pips, emptyKeys());
        applyCard(g, c);

        // ① 넘긴다고 말한 범주는 실제로 티어가 올랐다.
        for (const m of cross) {
          expect(tierOf(g.pips[m.cat]), `${c.id}@${start} / ${m.cat}: 넘긴다고 해 놓고 안 넘었다`).toBe(m.to);
          expect(m.to).toBeGreaterThan(m.from);
        }
        // ② 내려간다고 말한 범주는 실제로 내려갔다.
        for (const m of down) {
          expect(tierOf(g.pips[m.cat]), `${c.id}@${start} / ${m.cat}: 내려간다고 해 놓고 안 내려갔다`).toBe(m.to);
        }
        // ③ 칩이 말하지 않은 범주는 티어가 안 움직였다(말 안 한 변화가 없다).
        const spoken = new Set([...cross, ...down].map((m) => m.cat));
        for (const cat of CATEGORIES) {
          if (spoken.has(cat)) continue;
          expect(tierOf(g.pips[cat]), `${c.id}@${start} / ${cat}: 말 안 한 티어가 움직였다`).toBe(tierOf(pips[cat]));
        }
        // ④ 칩은 최대 세 개다(폰 한 줄 제약 · 넘치면 카드 밖으로 삐져나간다).
        expect(chips.length, `${c.id}@${start}`).toBeLessThanOrEqual(3);
        // ⑤ 아무 말도 안 하는 카드는 없다. 무엇을 하는지 적어도 한 칩으로 말한다.
        expect(chips.length, `${c.id}@${start}: 아무것도 말하지 않는 카드`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("특성 칩 · 화면이 sim 의 문구를 그대로 옮긴다", () => {
  it("특성 카드는 특성 칩을 정확히 하나 내고, 글자가 perkLine 과 한 글자도 다르지 않다", () => {
    expect(PERK_CARDS.length).toBeGreaterThan(0);
    for (const c of PERK_CARDS) {
      if (c.perk === undefined) continue;
      const p = PERK_BY_NAME.get(c.perk);
      expect(p, `${c.id}: 카드가 가리키는 특성이 없다`).toBeDefined();
      if (!p) continue;
      const perkChips = cardTierChips(c, emptyPips()).filter((ch) => ch.kind === "perk");
      expect(perkChips.length, `${c.id}: 특성 칩이 하나가 아니다`).toBe(1);
      // **여기가 이 파일의 존재 이유다.** 카드가 효과를 따로 적는 순간 언젠가 한쪽만 바뀐다.
      expect(perkChips[0]?.text, `${c.id}: 칩 글자가 perkLine 과 다르다`).toBe(perkLine(p));
      expect(perkChips[0]?.text.length).toBeGreaterThan(0);
    }
  });

  it("특성 칩 색은 그 축이 속한 범주 색이다. 이빨을 파는 사람이 색으로 먼저 알아본다", () => {
    for (const c of PERK_CARDS) {
      if (c.perk === undefined) continue;
      const p = PERK_BY_NAME.get(c.perk);
      if (!p) continue;
      const chip = cardTierChips(c, emptyPips()).find((ch) => ch.kind === "perk");
      expect(chip?.color, `${c.id}`).toBe(categoryColor(AXIS_CATEGORY[p.axis]));
    }
  });

  it("특성 칩은 도장 상황과 무관하다. 특성은 티어가 아니라 조건으로 켜진다", () => {
    const c = PERK_CARDS[0];
    expect(c?.perk).toBeDefined();
    if (!c || c.perk === undefined) return;
    const p = PERK_BY_NAME.get(c.perk);
    expect(p).toBeDefined();
    if (!p) return;
    for (const start of SAMPLE_PIPS) {
      const chips = cardTierChips(c, pipsOf({ fang: start, leg: start, eye: start, hide: start, herd: start }));
      expect(chips.map((ch) => ch.text), `${c.id}@${start}`).toEqual([perkLine(p)]);
    }
  });

  it("드래프트 카드는 도장 칩을 내지 않는다. 도장은 방울로만 오른다(v9)", () => {
    for (const c of CARD_POOL) {
      for (const start of SAMPLE_PIPS) {
        const pips = pipsOf({ fang: start, leg: start, eye: start, hide: start, herd: start });
        const chips = cardTierChips(c, pips);
        for (const ch of chips) {
          expect(["cross", "save", "down"], `${c.id}@${start}: 드래프트 카드에 도장 칩이 났다`).not.toContain(
            ch.kind,
          );
        }
        expect(cardTierMoves(c, pips), `${c.id}@${start}`).toEqual([]);
        expect(crossingMoves(c, pips)).toEqual([]);
        expect(demotingMoves(c, pips)).toEqual([]);
      }
    }
  });
});

describe("열쇠 · 불씨 칩: 금빛 한 칩으로", () => {
  it("열쇠 카드는 열쇠 이름을 그대로 말한다", () => {
    expect(KEY_CARDS_IN_POOL.length).toBeGreaterThan(0);
    for (const c of KEY_CARDS_IN_POOL) {
      if (c.key === undefined) continue;
      const chip = cardTierChips(c, emptyPips()).find((ch) => ch.kind === "key");
      expect(chip, `${c.id}: 열쇠 칩이 없다`).toBeDefined();
      expect(chip?.color).toBe(KEY_CHIP_COLOR);
      expect(chip?.text).toContain(KEY_LABELS[c.key]);
    }
  });

  it("불씨 카드는 불씨를 말한다", () => {
    const ember = cardTierChips(EMBER_CARD, emptyPips()).find((c) => c.kind === "ember");
    expect(ember?.color).toBe(KEY_CHIP_COLOR);
    expect(ember?.text).toContain("불씨");
  });
});

describe("카드 대표 색: 카드 점·오라가 같은 값을 쓴다", () => {
  it("특성 카드는 그 축이 속한 범주 색이다", () => {
    for (const c of PERK_CARDS) {
      if (c.perk === undefined) continue;
      const p = PERK_BY_NAME.get(c.perk);
      if (!p) continue;
      expect(cardAccent(c), `${c.id}`).toBe(categoryColor(AXIS_CATEGORY[p.axis]));
    }
  });

  it("도장도 특성도 없는 카드(열쇠·불씨)는 금빛이다", () => {
    for (const c of KEY_CARDS_IN_POOL) expect(cardAccent(c), `${c.id}`).toBe(KEY_CHIP_COLOR);
    expect(cardAccent(EMBER_CARD)).toBe(KEY_CHIP_COLOR);
  });

  it("시작 갈래는 가장 크게 찍는 범주의 색이다", () => {
    for (const p of PRESET_CARDS) {
      const top = [...CATEGORIES]
        .filter((c) => cardPips(p, c) !== 0)
        .sort((a, b) => Math.abs(cardPips(p, b)) - Math.abs(cardPips(p, a)))[0];
      expect(top, `${p.id}: 도장을 하나도 안 찍는 시작 갈래`).toBeDefined();
      if (top) expect(cardAccent(p), `${p.id}`).toBe(categoryColor(top));
    }
  });
});

describe("시작 갈래: 도장 칩 계약은 예전 그대로다", () => {
  it("프리셋은 두 범주를 켜므로 칩도 둘이고, 둘 다 「켜짐」이다", () => {
    for (const p of PRESET_CARDS) {
      const chips = cardTierChips(p, defaultGenome().pips);
      const cross = chips.filter((c) => c.kind === "cross");
      expect(cross.length, `${p.id}: 켜지는 칩이 둘이 아니다`).toBe(2);
      for (const c of cross) expect(c.text).toContain("켜짐");
      if (p.key !== undefined) expect(chips.some((c) => c.kind === "key")).toBe(true);
    }
  });

  it("이미 켜진 범주에서 문턱을 또 넘기면 「I ▸ II」로 말한다", () => {
    const p = presetStamping("fang");
    // ⚠ 시작 도장을 **카드가 주는 만큼 되짚어** 잡는다. 상수로 적으면 프리셋을 손볼 때 조용히 낡는다.
    const start = TIER_STEPS[1] - cardPips(p, "fang");
    expect(tierOf(start), "이 자리가 이미 1단 위여야 「▸」 분기를 지난다").toBeGreaterThan(0);
    const chip = cardTierChips(p, pipsOf({ fang: start }))[0];
    expect(chip?.kind).toBe("cross");
    expect(chip?.color).toBe(categoryColor("fang"));
    expect(chip?.text).toContain(CATEGORY_LABELS.fang);
    expect(chip?.text).toContain("▸");
    expect(chip?.text).not.toContain("켜짐"); // 0단에서 켜질 때만 「켜짐」이다
  });

  it("문턱을 못 넘기면 회색으로 **몇 칸 남았는지**를 말한다(그게 곧 정보다)", () => {
    const p = presetStamping("fang");
    const start = TIER_STEPS[0];
    const chip = cardTierChips(p, pipsOf({ fang: start }))[0];
    expect(chip?.kind).toBe("save");
    expect(chip?.color).toBe(SAVE_CHIP_COLOR);
    expect(chip?.text).toContain("칸 남음");
    // 남았다고 말한 칸 수가 실제로 남은 칸 수다.
    expect(chip?.text).toContain(String(pipsToNext(start + cardPips(p, "fang"))));
  });

  it("최고 티어에 이미 닿은 범주는 「몇 칸 남음」이라 거짓말하지 않는다", () => {
    const p = presetStamping("fang");
    const chip = cardTierChips(p, pipsOf({ fang: TIER_STEPS[3] }))[0];
    expect(chip?.kind).toBe("save");
    expect(chip?.text).not.toContain("칸 남음"); // 남은 칸이 없다
    expect(chip?.text).toContain(TIER_ROMAN[MAX_TIER]);
  });

  it("tierMove 는 고른 뒤의 도장을 그대로 계산한다(v9 에서 cards.ts 에서 옮겨온 계산)", () => {
    const p = presetStamping("fang");
    const d = cardPips(p, "fang");
    for (const start of SAMPLE_PIPS) {
      const m = tierMove(p, pipsOf({ fang: start }), "fang");
      const after = start + d;
      expect(m.cat).toBe("fang");
      expect(m.delta).toBe(d);
      expect(m.from).toBe(tierOf(start));
      expect(m.to).toBe(tierOf(after));
      expect(m.remain).toBe(pipsToNext(after));
    }
  });

  it("도장을 잃는 카드는 붉은 칩으로 말한다: 강등은 「▾」, 강등 없는 손실은 「−n」", () => {
    // ⚠ **지금 게임에 도장을 빼앗는 카드는 없다.** 그래도 표시 규칙은 살아 있으므로, 맞바꿈 프리셋이
    //   생기는 날 조용히 어긋나지 않도록 여기서 규칙만 붙잡아 둔다(이 카드는 이 파일 밖으로 안 나간다).
    const trade: Card = {
      id: "test_trade",
      name: "맞바꿈(표시 규칙 확인용)",
      desc: "",
      pips: { fang: -2 },
      rarity: "common",
    };

    // 문턱을 되넘는다: 1단(3) 에서 2를 잃으면 0단으로 내려간다.
    const demote = cardTierChips(trade, pipsOf({ fang: TIER_STEPS[0] }));
    const down = demote.find((c) => c.kind === "down");
    expect(down?.color).toBe(DOWN_CHIP_COLOR);
    expect(down?.text).toContain("▾");
    expect(demotingMoves(trade, pipsOf({ fang: TIER_STEPS[0] })).length).toBe(1);

    // 티어는 그대로인데 도장만 잃는다: 그래도 잃는 건 잃는 거라 붉게 알린다.
    const keep = cardTierChips(trade, pipsOf({ fang: TIER_STEPS[0] + 2 }))[0];
    expect(keep?.kind).toBe("down");
    expect(keep?.color).toBe(DOWN_CHIP_COLOR);
    expect(keep?.text).toContain("−2");
    expect(keep?.text).not.toContain("▾");
  });
});

describe("헤더 티어 줄: 다섯 범주가 고정 순서로 늘 보인다", () => {
  it("다섯 칩이 늘 나오고 순서가 고정이다(폰 한 줄 제약)", () => {
    const badges = tierBadges(emptyPips());
    expect(badges.map((b) => b.cat)).toEqual([...CATEGORIES]);
    expect(badges.length).toBe(5);
  });

  it("0단은 이름만 회색으로, 1단부터는 로마 숫자와 범주 색으로", () => {
    const badges = tierBadges(pipsOf({ fang: TIER_STEPS[1] }));
    const fang = badges.find((b) => b.cat === "fang");
    const leg = badges.find((b) => b.cat === "leg");
    expect(fang?.tier).toBe(2);
    expect(fang?.text).toBe(`${CATEGORY_LABELS.fang} ${TIER_ROMAN[2]}`);
    expect(fang?.color).toBe(categoryColor("fang"));
    expect(leg?.tier).toBe(0);
    expect(leg?.text).toBe(CATEGORY_LABELS.leg); // 숫자를 안 붙인다
    expect(leg?.color).toBe(SAVE_CHIP_COLOR);
  });

  it("헤더가 말하는 티어는 sim 이 쓰는 티어와 같은 함수에서 나온다", () => {
    for (const start of SAMPLE_PIPS) {
      const pips = pipsOf({ herd: start });
      const badge = tierBadges(pips).find((b) => b.cat === "herd");
      expect(badge?.tier).toBe(tierOf(start));
    }
  });
});

describe("도장 막대: 눈금이 「다음 계단이 더 멀다」를 말한다", () => {
  it("막대 오른쪽 끝은 최고 문턱보다 넉넉해 IV 눈금이 막대 안에 보인다", () => {
    expect(PIP_BAR_MAX).toBeGreaterThan(TIER_STEPS[TIER_STEPS.length - 1] as number);
  });

  it("채움 비율은 0~100 안에 있고 도장이 늘면 안 줄어든다", () => {
    expect(pipPct(0)).toBe(0);
    expect(pipPct(PIP_BAR_MAX)).toBe(100);
    expect(pipPct(PIP_BAR_MAX * 3)).toBe(100); // 상한 밖도 100 에서 멈춘다
    expect(pipPct(-5)).toBe(0);
    for (let i = 1; i < SAMPLE_PIPS.length; i++) {
      expect(pipPct(SAMPLE_PIPS[i] as number)).toBeGreaterThanOrEqual(pipPct(SAMPLE_PIPS[i - 1] as number));
    }
  });

  it("눈금은 문턱 수만큼 있고, 마지막 하나만 금빛이다(사다리의 끝)", () => {
    const bg = tierTrackBackground();
    expect(bg.split("linear-gradient").length - 1).toBe(TIER_STEPS.length);
    expect(bg.split("rgba(255,226,122,0.9)").length - 1).toBeGreaterThan(0);
  });
});

describe("색 · 조사: 화면 문구가 어색해지지 않게", () => {
  it("범주 색은 sim 의 단일 진실을 CSS 로 옮긴 것뿐이다", () => {
    for (const cat of CATEGORIES) {
      expect(categoryColor(cat)).toBe(hexColor(CATEGORY_COLORS[cat]));
      expect(categoryColor(cat)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("받침 유무로 이/가 를 고른다(「늑대의 법이」 vs 「덮치기가」)", () => {
    expect(iGa("늑대의 법")).toBe("이");
    expect(iGa("덮치기")).toBe("가");
    expect(iGa("원진")).toBe("이");
    expect(iGa("파도")).toBe("가");
  });
});
