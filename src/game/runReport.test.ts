import { describe, it, expect } from "vitest";
import { describeSpecies, formatDeaths, buildRunReport } from "@/game/runReport";
import { defaultGenome, type Genome } from "@/sim/genome";
import { emptyDeathTally, type DeathTally } from "@/sim/world";

function tune(partial: Partial<Genome["traits"]>): Genome {
  const g = defaultGenome();
  for (const key of Object.keys(partial) as (keyof Genome["traits"])[]) {
    const v = partial[key];
    if (v !== undefined) g.traits[key] = v;
  }
  return g;
}

function tally(partial: Partial<DeathTally>): DeathTally {
  return { ...emptyDeathTally(), ...partial };
}

describe("describeSpecies", () => {
  it("형질이 평범하면 '균형 잡힌'으로 묘사", () => {
    expect(describeSpecies(defaultGenome())).toBe("균형 잡힌 잡식성");
  });

  it("두드러진 형질을 식성 명사와 함께 묘사", () => {
    const desc = describeSpecies(tune({ speed: 0.95, metabolism: 0.05, diet: 0.1 }));
    expect(desc).toContain("초식성");
    expect(desc).toMatch(/빠른|차가운/);
  });

  it("육식/초식 경계를 식성 명사로 가른다", () => {
    expect(describeSpecies(tune({ diet: 0.9 }))).toContain("육식성");
    expect(describeSpecies(tune({ diet: 0.1 }))).toContain("초식성");
  });
});

describe("formatDeaths", () => {
  it("죽음이 없으면 빈 문자열", () => {
    expect(formatDeaths(emptyDeathTally())).toBe("");
  });

  it("많은 순으로 한글 라벨과 수를 잇는다", () => {
    expect(formatDeaths(tally({ cold: 41, starve: 18, predation: 7 }))).toBe(
      "추위 41 · 굶음 18 · 잡아먹힘 7",
    );
  });
});

describe("buildRunReport", () => {
  it("승패 줄 · 종 묘사 · 사망 원인을 빈 줄로 나눈다", () => {
    const report = buildRunReport(
      "4단계에서 멸종했습니다.",
      tune({ metabolism: 0.1, diet: 0.2 }),
      tally({ cold: 30, starve: 5 }),
    );
    const blocks = report.split("\n\n");
    expect(blocks[0]).toBe("4단계에서 멸종했습니다.");
    expect(blocks[1]).toContain("이 종은");
    expect(blocks[1]).toContain("추위에 약하고"); // 저대사 한온 적응 한 줄
    expect(blocks[2]).toBe("사망 원인 — 추위 30 · 굶음 5");
  });

  it("죽음이 없으면 사망 원인 문단을 넣지 않는다", () => {
    const report = buildRunReport("승리", defaultGenome(), emptyDeathTally());
    expect(report).not.toContain("사망 원인");
  });
});
