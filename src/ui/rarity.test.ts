import { describe, it, expect } from "vitest";
import { RARITY_WEIGHT, type Rarity } from "@/game/cards";
import {
  DRAFT_TIMING,
  RARITY_STYLE,
  rarityDelayMs,
  rarityIndex,
  restingShadow,
  selectionRing,
  withAlpha,
} from "@/ui/rarity";

const ALL: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

describe("희귀도 표시", () => {
  it("다섯 단계가 모두 색·라벨을 갖는다", () => {
    for (const r of ALL) {
      expect(RARITY_STYLE[r].label.length).toBeGreaterThan(0);
      expect(RARITY_STYLE[r].color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("전설만 글로우(콘페티·금빛 플래시)를 켠다", () => {
    const glowing = ALL.filter((r) => RARITY_STYLE[r].glow);
    expect(glowing).toEqual(["legendary"]);
  });

  it("등장 뜸은 희귀할수록 늦다", () => {
    for (let i = 1; i < ALL.length; i++) {
      const prev = ALL[i - 1] as Rarity;
      const cur = ALL[i] as Rarity;
      expect(rarityDelayMs(cur)).toBeGreaterThan(rarityDelayMs(prev));
    }
  });

  it("드묾·아주 귀함은 이웃의 중간값으로 보간된다 (기준점은 흔함·귀함·전설 셋뿐)", () => {
    const { delayCommonMs: c0, delayRareMs: c2, delayLegendaryMs: c4 } = DRAFT_TIMING;
    expect(rarityDelayMs("common")).toBe(c0);
    expect(rarityDelayMs("rare")).toBe(c2);
    expect(rarityDelayMs("legendary")).toBe(c4);
    expect(rarityDelayMs("uncommon")).toBe(Math.round((c0 + c2) / 2));
    expect(rarityDelayMs("epic")).toBe(Math.round((c2 + c4) / 2));
  });

  it("등장 순서(rarityIndex)와 뽑기 가중치 순서가 서로 뒤집혀 있다", () => {
    // 늦게 뜨는 카드일수록 드물게 뽑힌다 — 연출과 확률이 같은 방향을 본다.
    for (let i = 1; i < ALL.length; i++) {
      const prev = ALL[i - 1] as Rarity;
      const cur = ALL[i] as Rarity;
      expect(rarityIndex(cur)).toBeGreaterThan(rarityIndex(prev));
      expect(RARITY_WEIGHT[cur]).toBeLessThan(RARITY_WEIGHT[prev]);
    }
  });

  it("선택 링은 전설만 3px + 글로우, 나머지는 2px", () => {
    expect(selectionRing("legendary")).toContain("0 0 0 3px");
    expect(selectionRing("common")).toContain("0 0 0 2px");
    expect(restingShadow("common")).toBe("none");
    expect(restingShadow("legendary")).not.toBe("none");
  });

  it("withAlpha 는 #RRGGBB 를 rgba 로 바꾼다", () => {
    expect(withAlpha("#F5C33B", 0.5)).toBe("rgba(245,195,59,0.5)");
    expect(withAlpha("8FD14F", 1)).toBe("rgba(143,209,79,1)");
  });
});
