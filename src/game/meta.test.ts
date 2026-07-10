// 메타 진행(플레이어 레벨) 순수 로직 검증 — 언락은 메타 레벨(누적 경험치에서 파생)을 인자로 받아 저장소와 무관.
// (recordRunComplete/debug 는 localStorage 의존이라 인메모리 목으로 검증한다.)
import { describe, it, expect } from "vitest";
import {
  isPresetUnlocked,
  isCardUnlocked,
  isRerollUnlockedAtLevel,
  metaLevel,
  metaLevelInfo,
  metaLevelCost,
  runMetaXp,
  xpForLevelStart,
  recordRunComplete,
  debugSetMetaLevel,
  loadMeta,
  UNLOCK_TIERS,
} from "@/game/meta";

describe("메타 언락(플레이어 레벨 기반)", () => {
  it("기본 프리셋·카드는 레벨 1(첫 플레이)부터 항상 열려 있다", () => {
    for (const id of ["preset_omni", "preset_herd", "preset_hunter", "preset_scout"]) {
      expect(isPresetUnlocked(id, 1)).toBe(true);
    }
    for (const id of ["swift", "keen", "fangs", "grazer"]) {
      expect(isCardUnlocked(id, 1)).toBe(true);
    }
  });

  it("특수 갈래·특화 카드는 메타 레벨에서 열린다", () => {
    // 초음파 카드(레벨 3)
    expect(isCardUnlocked("echo", 2)).toBe(false);
    expect(isCardUnlocked("echo", 3)).toBe(true);
    // 바다 갈래(레벨 4) — 카드보다 갈래가 늦게 열린다
    expect(isPresetUnlocked("preset_sea", 3)).toBe(false);
    expect(isPresetUnlocked("preset_sea", 4)).toBe(true);
    // 하늘 카드(레벨 6) → 갈래(레벨 7)
    expect(isCardUnlocked("wings", 5)).toBe(false);
    expect(isCardUnlocked("wings", 6)).toBe(true);
    expect(isPresetUnlocked("preset_sky", 6)).toBe(false);
    expect(isPresetUnlocked("preset_sky", 7)).toBe(true);
    // 독 살갗 카드(레벨 12) → 갈래(레벨 13)
    expect(isCardUnlocked("venom_fang", 11)).toBe(false);
    expect(isCardUnlocked("venom_fang", 12)).toBe(true);
    expect(isPresetUnlocked("preset_venom", 12)).toBe(false);
    expect(isPresetUnlocked("preset_venom", 13)).toBe(true);
  });

  it("지느러미(바다 관문)는 처음부터 열려 있다 — 첫 판에도 전설 등급이 존재하도록", () => {
    // 전설은 전부 "능력 계열의 관문"이라, 하나도 안 열려 있으면 첫 판에 전설 등급 자체가 없다.
    expect(isCardUnlocked("fins", 1)).toBe(true);
  });

  it("다시 뽑기는 리롤 티어 레벨(2)부터 열린다", () => {
    expect(isRerollUnlockedAtLevel(1)).toBe(false);
    expect(isRerollUnlockedAtLevel(2)).toBe(true);
    expect(isRerollUnlockedAtLevel(9)).toBe(true);
  });

  it("티어가 레벨 순으로 오름차순이라 순차 해금된다", () => {
    for (let i = 1; i < UNLOCK_TIERS.length; i++) {
      expect((UNLOCK_TIERS[i] as { atLevel: number }).atLevel).toBeGreaterThan(
        (UNLOCK_TIERS[i - 1] as { atLevel: number }).atLevel,
      );
    }
  });
});

describe("메타 레벨 곡선·적립", () => {
  it("누적 경험치가 각 레벨 비용을 넘으면 레벨이 오른다(초반이 싸다)", () => {
    expect(metaLevel(0)).toBe(1);
    const c1 = metaLevelCost(1);
    expect(metaLevel(c1 - 1)).toBe(1);
    expect(metaLevel(c1)).toBe(2);
    expect(metaLevel(c1 + metaLevelCost(2))).toBe(3);
    // 레벨 비용은 뒤로 갈수록 커진다.
    expect(metaLevelCost(2)).toBeGreaterThan(metaLevelCost(1));
  });

  it("metaLevelInfo 의 into/need 가 곡선과 맞는다", () => {
    const info = metaLevelInfo(metaLevelCost(1) + 5); // 레벨 2, 5 들어감
    expect(info.level).toBe(2);
    expect(info.into).toBe(5);
    expect(info.need).toBe(metaLevelCost(2));
  });

  it("xpForLevelStart 는 그 레벨의 시작 경험치(레벨을 정확히 만든다)", () => {
    for (const lv of [1, 2, 3, 5, 9, 12]) {
      expect(metaLevel(xpForLevelStart(lv))).toBe(lv);
    }
  });

  it("런 성적이 좋을수록 더 많은 경험치를 적립한다(레벨·시대·정복)", () => {
    expect(runMetaXp(1, 0, false)).toBeGreaterThan(0);
    expect(runMetaXp(8, 0, false)).toBeGreaterThan(runMetaXp(3, 0, false)); // 도달 레벨↑
    expect(runMetaXp(5, 3, false)).toBeGreaterThan(runMetaXp(5, 0, false)); // 시대↑
    expect(runMetaXp(5, 4, true)).toBeGreaterThan(runMetaXp(5, 4, false)); // 정복 보너스
  });
});

describe("recordRunComplete / debug — 인메모리 저장소", () => {
  function memStorage(store: Record<string, string>): Storage {
    return {
      get length(): number {
        return Object.keys(store).length;
      },
      clear: (): void => {
        for (const k of Object.keys(store)) delete store[k];
      },
      getItem: (k: string): string | null => store[k] ?? null,
      key: (i: number): string | null => Object.keys(store)[i] ?? null,
      removeItem: (k: string): void => {
        delete store[k];
      },
      setItem: (k: string, v: string): void => {
        store[k] = v;
      },
    } as unknown as Storage;
  }
  function withStorage(store: Record<string, string>, fn: () => void): void {
    const gl = globalThis as unknown as { localStorage?: Storage | undefined };
    const prev = gl.localStorage;
    gl.localStorage = memStorage(store);
    try {
      fn();
    } finally {
      gl.localStorage = prev;
    }
  }

  it("경험치가 누적되고, 넘긴 레벨과 그 레벨의 해금을 진척도로 돌려준다", () => {
    withStorage({}, () => {
      // 첫 완료 — 레벨 1에서 시작. 도달 레벨 5·시대 1이면 여러 레벨 오른다.
      const p = recordRunComplete(5, 1, false);
      expect(p.beforeXp).toBe(0);
      expect(p.beforeLevel).toBe(1);
      expect(p.gained).toBe(runMetaXp(5, 1, false));
      expect(p.afterXp).toBe(p.gained);
      expect(p.afterLevel).toBeGreaterThanOrEqual(2);
      // 리롤(레벨 2 티어)이 넘긴 레벨 목록에 있다(레벨 2를 넘었으면).
      const rerollShown = p.levelUps.some((lu) => lu.unlocks.some((u) => u.reroll));
      expect(rerollShown).toBe(true);
      // 누적이 저장돼 다음 로드에 반영.
      expect(loadMeta().metaXp).toBe(p.afterXp);
    });
  });

  it("debugSetMetaLevel 은 저장본을 그 레벨로 만든다", () => {
    withStorage({}, () => {
      debugSetMetaLevel(9);
      expect(metaLevel(loadMeta().metaXp)).toBe(9);
    });
  });
});
