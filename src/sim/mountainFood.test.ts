import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { TILE } from "@/sim/terrain";
import { defaultGenome } from "@/sim/genome";

// 고산 먹이 틈새 — 바다 먹이(seaFood.test)의 하늘 대칭. 산 타일에만, 날개 종만 먹는 무경쟁 자원.
const W = 540;
const H = 960;

function mountainPositions(seed: string): string[] {
  return new World(seed, W, H, defaultGenome()).food
    .filter((f) => f.mountainous)
    .map((f) => `${f.x.toFixed(2)},${f.y.toFixed(2)}`);
}

describe("고산 먹이 틈새 (지형 결합)", () => {
  it("고산 먹이는 산 타일에만 생긴다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const mtn = w.food.filter((f) => f.mountainous);
    expect(mtn.length).toBeGreaterThan(0);
    for (const f of mtn) expect(w.terrain.kindAt(f.x, f.y)).toBe(TILE.mountain);
  });

  it("고산 먹이는 바다 먹이가 아니다 (플래그가 겹치지 않음)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    for (const f of w.food.filter((f) => f.mountainous)) expect(f.aquatic).toBe(false);
  });

  it("같은 시드 → 같은 고산 먹이 배치(결정론)", () => {
    expect(mountainPositions("env-1")).toEqual(mountainPositions("env-1"));
  });
});
