import { describe, it, expect } from "vitest";
import { creatureName } from "@/ui/creatureName";

describe("creatureName", () => {
  it("같은 id 는 항상 같은 이름(결정론)", () => {
    expect(creatureName(0)).toBe(creatureName(0));
    expect(creatureName(37)).toBe(creatureName(37));
  });

  it("두 글자 한글 애칭을 만든다", () => {
    for (const id of [0, 1, 19, 20, 41, 123]) {
      expect(creatureName(id)).toHaveLength(2);
    }
  });

  it("작은 무리 범위(0~39)에서 이름이 충분히 다양하다", () => {
    const names = new Set<string>();
    for (let id = 0; id < 40; id++) names.add(creatureName(id));
    // 첫 글자(20종)가 20마다 한 바퀴 돌되 둘째 글자가 바뀌어 40개가 모두 달라야 한다.
    expect(names.size).toBe(40);
  });

  it("음수·소수 id 도 안전하게 처리(결정론 유지)", () => {
    expect(creatureName(-5)).toHaveLength(2);
    expect(creatureName(3.9)).toBe(creatureName(3));
  });
});
