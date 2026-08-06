// 티어 표시 규칙 — **칩이 사실을 말하는가**.
//
// v7 시절 이 파일은 「카드 효과 칩」(속도 +15 …)의 색·수치를 쟀다. 그 세계가 통째로 사라져
// (카드는 이제 도장만 찍는다) 다음 계약들은 **뜻이 없어져 지웠다**:
//   · 중립 형질(대사·식성) 색 규칙 — 그 형질들이 카드 효과 축에서 사라졌다.
//   · traitWord/dietWord(값형질은 숫자, 능력형은 단어) — 표시 축이 능치에서 티어로 바뀌었다.
//   · 상한 근접 감쇠 취소선 · 정점 고정 · 희생 표시 · APEX_BOON — 그 장치들이 전부 폐기됐다.
//
// **살린 계약은 하나이고, 그것이 이 파일의 존재 이유다**: 화면이 말하는 것과 실제로 일어나는 일이
// 같아야 한다("수치가 화면 표시와 다르면 그건 거짓말이다"). v8 에서 그 문장은 이렇게 바뀐다 —
// **칩이 예고한 티어 이동이 카드를 고른 뒤의 게놈과 정확히 같아야 한다.**
import { describe, it, expect } from "vitest";
import {
  DOWN_CHIP_COLOR,
  KEY_CHIP_COLOR,
  PIP_BAR_MAX,
  SAVE_CHIP_COLOR,
  cardAccent,
  cardTierChips,
  categoryColor,
  crossingMoves,
  demotingMoves,
  hexColor,
  iGa,
  pipPct,
  tierBadges,
  tierTrackBackground,
} from "@/ui/traitDisplay";
import { CARD_POOL, EMBER_CARD, applyCard, cardPips, PRESET_CARDS } from "@/game/cards";
import { defaultGenome, genomeFromPips } from "@/sim/genome";
import {
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  MAX_TIER,
  TIER_ROMAN,
  TIER_STEPS,
  emptyKeys,
  emptyPips,
  tierOf,
  type Pips,
} from "@/sim/tiers";

const card = (id: string) => {
  const c = CARD_POOL.find((x) => x.id === id);
  if (!c) throw new Error(`카드 없음: ${id}`);
  return c;
};

const pipsOf = (partial: Partial<Pips>): Pips => ({ ...emptyPips(), ...partial });

/** 이 파일이 훑는 도장 상황들 — 0단부터 최고 티어까지, 문턱 바로 앞과 바로 뒤를 모두 지난다. */
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

describe("칩이 사실을 말한다 — 예고한 티어 이동이 실제 결과와 같다", () => {
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
      }
    }
  });

  it("칩 종류가 실제 상황과 맞는다 — 넘김·저축·강등·열쇠·불씨", () => {
    // 넘김: 문턱 바로 앞(도장 1)에서 이빨 +2 를 고르면 그 자리에서 1단이 켜진다.
    const cross = cardTierChips(card("wc_fang1"), pipsOf({ fang: TIER_STEPS[0] - 2 }));
    expect(cross[0]?.kind).toBe("cross");
    expect(cross[0]?.color).toBe(categoryColor("fang"));
    expect(cross[0]?.text).toContain(CATEGORY_LABELS.fang);
    expect(cross[0]?.text).toContain("켜짐"); // 0단에서 켜질 땐 「이빨 I 켜짐」

    // 저축: 문턱을 못 넘기면 회색으로 **몇 칸 남았는지**를 말한다(그게 곧 정보다).
    const save = cardTierChips(card("wc_fang1"), pipsOf({ fang: TIER_STEPS[0] }));
    expect(save[0]?.kind).toBe("save");
    expect(save[0]?.color).toBe(SAVE_CHIP_COLOR);
    expect(save[0]?.text).toContain("칸 남음");

    // 강등: 맞바꿈 카드의 대가가 문턱을 되넘으면 붉은 칩이 「▾」로 말한다.
    const trade = CARD_POOL.find((c) => CATEGORIES.some((cat) => cardPips(c, cat) < 0));
    expect(trade).toBeDefined();
    if (trade) {
      const loss = CATEGORIES.find((cat) => cardPips(trade, cat) < 0);
      expect(loss).toBeDefined();
      if (loss) {
        const chips = cardTierChips(trade, pipsOf({ [loss]: TIER_STEPS[0] } as Partial<Pips>));
        const downChip = chips.find((c) => c.kind === "down");
        expect(downChip).toBeDefined();
        expect(downChip?.color).toBe(DOWN_CHIP_COLOR);
        expect(downChip?.text).toContain("▾");
      }
    }

    // 열쇠·불씨는 금빛 한 칩으로.
    const key = cardTierChips(card("ky_fin"), emptyPips()).find((c) => c.kind === "key");
    expect(key?.color).toBe(KEY_CHIP_COLOR);
    const ember = cardTierChips(EMBER_CARD, emptyPips()).find((c) => c.kind === "ember");
    expect(ember?.color).toBe(KEY_CHIP_COLOR);
    expect(ember?.text).toContain("불씨");
  });

  it("최고 티어에 이미 닿은 범주는 「몇 칸 남음」이라 거짓말하지 않는다", () => {
    const chips = cardTierChips(card("wc_fang1"), pipsOf({ fang: TIER_STEPS[3] }));
    const chip = chips[0];
    expect(chip?.kind).toBe("save");
    expect(chip?.text).not.toContain("칸 남음"); // 남은 칸이 없다
    expect(chip?.text).toContain(TIER_ROMAN[MAX_TIER]);
  });

  it("카드 대표 색은 가장 크게 찍는 범주의 색이다(카드 점·오라가 같은 값을 쓴다)", () => {
    expect(cardAccent(card("wc_fang1"))).toBe(categoryColor("fang"));
    expect(cardAccent(card("wc_leg1"))).toBe(categoryColor("leg"));
    expect(cardAccent(EMBER_CARD)).toBe(KEY_CHIP_COLOR); // 도장이 없는 카드
    // 「치우침」 카드는 주 범주(도장이 큰 쪽) 색이다.
    const lean = card("ln_fl"); // 이빨 +2 · 다리 +1
    expect(cardAccent(lean)).toBe(categoryColor("fang"));
  });
});

describe("헤더 티어 줄 — 다섯 범주가 고정 순서로 늘 보인다", () => {
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

describe("도장 막대 — 눈금이 「다음 계단이 더 멀다」를 말한다", () => {
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

describe("색 · 조사 — 화면 문구가 어색해지지 않게", () => {
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

describe("시작 갈래 카드도 같은 규칙으로 보인다", () => {
  it("프리셋은 두 범주를 켜므로 칩도 둘이고, 둘 다 「켜짐」이다", () => {
    for (const p of PRESET_CARDS) {
      const chips = cardTierChips(p, defaultGenome().pips);
      const cross = chips.filter((c) => c.kind === "cross");
      expect(cross.length, `${p.id}: 켜지는 칩이 둘이 아니다`).toBe(2);
      for (const c of cross) expect(c.text).toContain("켜짐");
      if (p.key !== undefined) expect(chips.some((c) => c.kind === "key")).toBe(true);
    }
  });
});
