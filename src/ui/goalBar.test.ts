import { describe, it, expect } from "vitest";
import { survivalChip } from "@/ui/goalBar";
import { bossPassNeeded, extinctionPassNeeded, GAME } from "@/game/config";

/**
 * 관문 동안 목표 줄에 붙는 "생존 21/8" 칩의 계약.
 *
 * 왜 테스트하나: 이 칩 하나가 "이번 관문에서 지는가"를 관문이 끝나기 **전에** 알리는 유일한 자리다.
 * 문턱이 슬그머니 바뀌면 위험한데도 평범한 색으로 떠서 아무 경고가 안 된다.
 */
describe("생존 칩 (관문 중 · 지금 몇 마리 / 살아남아야 하는 수)", () => {
  it("기준이 1이면 칩을 안 띄운다 — 첫 시대는 완전 멸종만 패배라 겁줄 일이 없다", () => {
    expect(survivalChip(18, 1)).toBeNull();
    expect(survivalChip(18, 0)).toBeNull(); // 채집 라운드(관문 없음)
    // 그리고 그 "1"은 실제 첫 시대의 판정 기준과 같은 값이다.
    expect(bossPassNeeded(0)).toBe(1);
    expect(extinctionPassNeeded(0)).toBe(1);
  });

  it("지금 수와 기준을 한 자리에 붙여 말한다", () => {
    expect(survivalChip(21, 8)?.text).toBe("생존 21/8마리");
  });

  it("기준 아래면 위험(danger) · 여유가 두 배 안쪽이면 경고(warn) · 그 위는 평상", () => {
    expect(survivalChip(3, 4)?.tone).toBe("danger");
    expect(survivalChip(4, 4)?.tone).toBe("warn");
    expect(survivalChip(7, 4)?.tone).toBe("warn");
    expect(survivalChip(8, 4)?.tone).toBe("plain");
    expect(survivalChip(0, 6)?.tone).toBe("danger");
  });

  it("시대가 오르면 이 칩이 실제로 뜬다 — 마지막 시대의 기준은 1보다 크다", () => {
    // 기준이 늘 1이면 칩은 영영 안 뜬다(= 이 화면 작업이 통째로 죽는다).
    expect(extinctionPassNeeded(GAME.eraCap - 1)).toBeGreaterThan(1);
    expect(survivalChip(2, extinctionPassNeeded(GAME.eraCap - 1))).not.toBeNull();
  });
});
