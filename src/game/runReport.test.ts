import { describe, it, expect } from "vitest";
import {
  describeSpecies,
  huntingBuild,
  formatDeaths,
  buildRunReport,
  parseDeathLine,
  DEATH_LINE_PREFIX,
} from "@/game/runReport";
import { SIM } from "@/sim/params";
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
    const desc = describeSpecies(tune({ speed: 95, metabolism: 5, diet: 10 }));
    expect(desc).toContain("초식성");
    expect(desc).toMatch(/빠른|차가운/);
  });

  it("육식/초식 경계를 식성 명사로 가른다", () => {
    expect(describeSpecies(tune({ diet: 90 }))).toContain("육식성");
    expect(describeSpecies(tune({ diet: 10 }))).toContain("초식성");
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
      tune({ metabolism: 10, diet: 20 }),
      tally({ cold: 30, starve: 5 }),
    );
    const blocks = report.split("\n\n");
    expect(blocks[0]).toBe("4단계에서 멸종했습니다.");
    expect(blocks[1]).toContain("이 종은");
    expect(blocks[1]).toContain("추위에 약하고"); // 저대사 한온 적응 한 줄
    expect(blocks[2]).toBe(`${DEATH_LINE_PREFIX}추위 30 · 굶음 5`);
  });

  it("죽음이 없으면 사망 원인 문단을 넣지 않는다", () => {
    const report = buildRunReport("승리", defaultGenome(), emptyDeathTally());
    expect(report).not.toContain("사망 원인");
  });
});

describe("parseDeathLine — 결과 화면 막대용 역파싱", () => {
  it("사망 원인 문단이 아니면 빈 배열", () => {
    expect(parseDeathLine("이 종은 균형 잡힌 잡식성이었습니다.")).toEqual([]);
    expect(parseDeathLine("4단계에서 멸종했습니다.")).toEqual([]);
  });

  it("buildRunReport 가 만든 사망 원인 문단을 행으로 되돌린다 (포맷↔파싱 왕복)", () => {
    const report = buildRunReport(
      "멸종",
      defaultGenome(),
      tally({ cold: 41, starve: 18, predation: 7 }),
    );
    const deathBlock = report.split("\n\n").find((b) => b.startsWith(DEATH_LINE_PREFIX));
    expect(deathBlock).toBeDefined();
    expect(parseDeathLine(deathBlock ?? "")).toEqual([
      { label: "추위", count: 41 },
      { label: "굶음", count: 18 },
      { label: "잡아먹힘", count: 7 },
    ]);
  });

  it("공백 없는 라벨(잡아먹힘)도 수와 안전히 분리", () => {
    expect(parseDeathLine(`${DEATH_LINE_PREFIX}잡아먹힘 12`)).toEqual([
      { label: "잡아먹힘", count: 12 },
    ]);
  });
});

describe("육식 사냥형(huntingBuild)", () => {
  it("순수 초식은 사냥형이 아니다(빠른 초식도 null)", () => {
    expect(huntingBuild(tune({ diet: 20 }).traits)).toBeNull();
    expect(huntingBuild(tune({ diet: 20, speed: 95 }).traits)).toBeNull(); // 빠른 초식 = 잘 도망칠 뿐
  });

  it("순수 육식은 두드러진 보조 형질로 사냥형이 갈린다(켜짐)", () => {
    expect(huntingBuild(tune({ diet: 90, speed: 90 }).traits)).toEqual({ label: "질주형 사냥꾼", active: true });
    expect(huntingBuild(tune({ diet: 90, herding: 90 }).traits)).toEqual({ label: "무리 사냥꾼", active: true });
    expect(huntingBuild(tune({ diet: 90, ranged: 90 }).traits)).toEqual({ label: "원거리 사냥꾼", active: true });
    expect(huntingBuild(tune({ diet: 90, attack: 90 }).traits)).toEqual({ label: "완력 사냥꾼", active: true });
  });

  it("특기 형질 없는 순수 육식은 대식 포식자(포만·큰 사냥으로 산다)", () => {
    expect(huntingBuild(tune({ diet: 90 }).traits)).toEqual({ label: "대식 포식자", active: true });
  });

  it("잡식이라도 사냥 소질 형질이 있으면 라벨을 붙이되 꺼짐(diet<70 함정 알림)", () => {
    // 잡식(diet 50) + 빠름 → 질주형 소질은 있으나 사냥 특기(스퍼트)는 육식(70+)에서만 켜진다.
    const b = huntingBuild(tune({ diet: 50, speed: 90 }).traits);
    expect(b).toEqual({ label: "질주형 사냥꾼", active: false });
  });

  it("잡식인데 두드러진 사냥 특기 형질도 없으면 라벨 없음(잡음 방지)", () => {
    expect(huntingBuild(tune({ diet: 50 }).traits)).toBeNull();
  });

  it("문턱은 SIM 값을 따른다(무리=packShareThreshold, 원거리=rangedThreshold)", () => {
    // 무리 55(=packShareThreshold) 딱은 소질 아님(초과분 0), 56 이면 소질.
    expect(huntingBuild(tune({ diet: 90, herding: SIM.packShareThreshold }).traits)?.label).toBe("대식 포식자");
    expect(huntingBuild(tune({ diet: 90, herding: SIM.packShareThreshold + 1 }).traits)?.label).toBe("무리 사냥꾼");
  });
});
