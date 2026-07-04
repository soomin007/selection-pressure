import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { SIM } from "@/sim/params";
import { TILE } from "@/sim/terrain";
import { defaultGenome } from "@/sim/genome";

// 깊은 바다 먹이 틈새 — 물 전용 종(진짜 물고기)만 먹는 전용 자원. 얕은 바다(양용 종도 먹음)와 분리해
// 경쟁 배제를 풀고 물고기 학교를 유지시킨다. 바다·고산 먹이(seaFood/mountainFood.test)의 형제 니치.
const W = 540;
const H = 960;

function deepPositions(seed: string): string[] {
  return new World(seed, W, H, defaultGenome()).food
    .filter((f) => f.deep)
    .map((f) => `${f.x.toFixed(2)},${f.y.toFixed(2)}`);
}

describe("깊은 바다 먹이 틈새 (물고기 전용)", () => {
  it("깊은 바다 먹이는 물 타일에만 생긴다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const deep = w.food.filter((f) => f.deep);
    expect(deep.length).toBeGreaterThan(0);
    for (const f of deep) expect(w.terrain.kindAt(f.x, f.y)).toBe(TILE.water);
  });

  it("깊은 바다 먹이는 고산 먹이가 아니다 (플래그가 겹치지 않음)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    for (const f of w.food.filter((f) => f.deep)) expect(f.mountainous).toBe(false);
  });

  it("같은 시드 → 같은 깊은 바다 먹이 배치(결정론)", () => {
    expect(deepPositions("env-1")).toEqual(deepPositions("env-1"));
  });

  it("물고기 떼(물 전용)가 시작부터 학교로 스폰된다(떼답게 보강)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const fish = w.entities.filter((e) => e.species.name === "물고기 떼");
    // 기본 소수 스폰(≈5) + 독립 rng 보강(seaHerdPad) → 한눈에 떼로 보이는 규모
    expect(fish.length).toBeGreaterThanOrEqual(SIM.seaHerdPad + 3);
  });
});
