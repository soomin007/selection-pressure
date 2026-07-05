// 메타 언락(S1) 순수 로직 검증 — isPresetUnlocked/isCardUnlocked 는 runs 를 인자로 받아 저장소와 무관.
// (recordRunComplete 는 localStorage 의존이라 headless 에선 생략 — 예측 함수만 검증한다.)
import { describe, it, expect } from "vitest";
import { isPresetUnlocked, isCardUnlocked, UNLOCK_TIERS } from "@/game/meta";

describe("메타 언락(수평)", () => {
  it("기본 프리셋·카드는 처음(runs 0)부터 항상 열려 있다", () => {
    for (const id of ["preset_omni", "preset_herd", "preset_hunter", "preset_scout"]) {
      expect(isPresetUnlocked(id, 0)).toBe(true);
    }
    for (const id of ["swift", "keen", "fangs", "grazer"]) {
      expect(isCardUnlocked(id, 0)).toBe(true);
    }
  });

  it("특수 갈래·특화 카드는 도달 티어에서 열린다", () => {
    // 바다(티어 1)
    expect(isPresetUnlocked("preset_sea", 0)).toBe(false);
    expect(isPresetUnlocked("preset_sea", 1)).toBe(true);
    expect(isCardUnlocked("fins", 0)).toBe(false);
    expect(isCardUnlocked("fins", 1)).toBe(true);
    // 독 살갗(티어 4)
    expect(isPresetUnlocked("preset_venom", 3)).toBe(false);
    expect(isPresetUnlocked("preset_venom", 4)).toBe(true);
    // 초음파 카드(티어 5)
    expect(isCardUnlocked("echo", 4)).toBe(false);
    expect(isCardUnlocked("echo", 5)).toBe(true);
  });

  it("티어가 runs 순으로 오름차순이라 순차 해금된다", () => {
    for (let i = 1; i < UNLOCK_TIERS.length; i++) {
      expect((UNLOCK_TIERS[i] as { atRuns: number }).atRuns).toBeGreaterThan(
        (UNLOCK_TIERS[i - 1] as { atRuns: number }).atRuns,
      );
    }
  });
});
