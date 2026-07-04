import { describe, it, expect } from "vitest";
import { Environment, classifyBiome, type Biome } from "@/sim/environment";
import { Rng } from "@/sim/rng";

const W = 540;
const H = 960;
const CS = 24;

describe("바이옴 환경", () => {
  it("온도·습도로 바이옴이 갈린다(추움=빙하, 덥고 건조=사막, 덥고 습함=우림)", () => {
    expect(classifyBiome(0.1, 0.5)).toBe("glacier"); // 한랭 = 빙하
    expect(classifyBiome(0.9, 0.2)).toBe("desert"); // 혹서 + 건조 = 사막
    expect(classifyBiome(0.9, 0.8)).toBe("rainforest"); // 혹서 + 습윤 = 우림
    expect(classifyBiome(0.5, 0.2)).toBe("grassland"); // 온대 + 건조 = 초원
    expect(classifyBiome(0.5, 0.8)).toBe("wetland"); // 온대 + 습윤 = 습지
  });

  it("사막·빙하는 척박하고 우림은 비옥하다(바이옴이 먹이량을 정한다)", () => {
    const env = Environment.generate(new Rng("bio-1-env"), W, H, CS);
    const sum: Record<Biome, { f: number; n: number }> = {
      glacier: { f: 0, n: 0 }, desert: { f: 0, n: 0 }, grassland: { f: 0, n: 0 },
      wetland: { f: 0, n: 0 }, rainforest: { f: 0, n: 0 },
    };
    for (let i = 0; i < env.fertility.length; i++) {
      const b = env.biome[i] as Biome;
      sum[b].f += env.fertility[i] ?? 0;
      sum[b].n += 1;
    }
    const avg = (b: Biome): number => (sum[b].n ? sum[b].f / sum[b].n : 0);
    // 우림·습지 비옥 > 초원 > 사막·빙하 척박 (존재하는 바이옴만 비교)
    if (sum.rainforest.n && sum.desert.n) expect(avg("rainforest")).toBeGreaterThan(avg("desert"));
    if (sum.wetland.n && sum.glacier.n) expect(avg("wetland")).toBeGreaterThan(avg("glacier"));
  });

  it("빙하는 춥고(추위>0) 사막은 덥다(열기>0) — 바이옴이 체감 기후를 정한다", () => {
    const env = Environment.generate(new Rng("bio-2-env"), W, H, CS);
    let glacierCold = 0, glacierN = 0, desertHeat = 0, desertN = 0;
    for (let i = 0; i < env.biome.length; i++) {
      if (env.biome[i] === "glacier") { glacierCold += env.coldness[i] ?? 0; glacierN += 1; }
      if (env.biome[i] === "desert") { desertHeat += env.heat[i] ?? 0; desertN += 1; }
    }
    if (glacierN) expect(glacierCold / glacierN).toBeGreaterThan(0); // 빙하 = 추위 있음
    if (desertN) expect(desertHeat / desertN).toBeGreaterThan(0); // 사막 = 열기 있음
  });

  it("같은 시드 → 같은 환경(결정론)", () => {
    const a = Environment.generate(new Rng("det-env"), W, H, CS);
    const b = Environment.generate(new Rng("det-env"), W, H, CS);
    expect(a.biome).toEqual(b.biome);
    expect(a.coldness).toEqual(b.coldness);
    expect(a.fertility).toEqual(b.fertility);
  });
});
