// 메타 언락(S1) 순수 로직 검증 — isPresetUnlocked/isCardUnlocked 는 도달 최고 레벨을 인자로 받아 저장소와 무관.
// (recordRunComplete 는 localStorage 의존이라 headless 에선 생략 — 예측 함수만 검증한다.)
import { describe, it, expect } from "vitest";
import { isPresetUnlocked, isCardUnlocked, isRerollUnlocked, REROLL_UNLOCK_RUNS, UNLOCK_TIERS } from "@/game/meta";

describe("메타 언락(레벨 기반)", () => {
  it("기본 프리셋·카드는 레벨 1(첫 플레이)부터 항상 열려 있다", () => {
    for (const id of ["preset_omni", "preset_herd", "preset_hunter", "preset_scout"]) {
      expect(isPresetUnlocked(id, 1)).toBe(true);
    }
    for (const id of ["swift", "keen", "fangs", "grazer"]) {
      expect(isCardUnlocked(id, 1)).toBe(true);
    }
  });

  it("특수 갈래·특화 카드는 도달 레벨에서 열린다(빨리 죽으면 안 열림)", () => {
    // 바다(레벨 3)
    expect(isPresetUnlocked("preset_sea", 2)).toBe(false);
    expect(isPresetUnlocked("preset_sea", 3)).toBe(true);
    expect(isCardUnlocked("fins", 2)).toBe(false);
    expect(isCardUnlocked("fins", 3)).toBe(true);
    // 독 살갗(레벨 9)
    expect(isPresetUnlocked("preset_venom", 8)).toBe(false);
    expect(isPresetUnlocked("preset_venom", 9)).toBe(true);
    // 초음파 카드(레벨 12)
    expect(isCardUnlocked("echo", 11)).toBe(false);
    expect(isCardUnlocked("echo", 12)).toBe(true);
  });

  it("티어가 레벨 순으로 오름차순이라 순차 해금된다", () => {
    for (let i = 1; i < UNLOCK_TIERS.length; i++) {
      expect((UNLOCK_TIERS[i] as { atLevel: number }).atLevel).toBeGreaterThan(
        (UNLOCK_TIERS[i - 1] as { atLevel: number }).atLevel,
      );
    }
  });
});

describe("다시 뽑기(리롤) 해금 — 마친 런 수 기준", () => {
  it("임계 미만이면 잠기고 이상이면 열린다(레벨·정복과 무관)", () => {
    expect(isRerollUnlocked({ bestLevel: 20, conquered: true, runsCompleted: REROLL_UNLOCK_RUNS - 1 })).toBe(false);
    expect(isRerollUnlocked({ bestLevel: 0, conquered: false, runsCompleted: REROLL_UNLOCK_RUNS })).toBe(true);
    expect(isRerollUnlocked({ bestLevel: 0, conquered: false, runsCompleted: REROLL_UNLOCK_RUNS + 9 })).toBe(true);
  });
});
