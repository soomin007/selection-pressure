import { describe, it, expect } from "vitest";
import {
  GENOME_VERSION,
  TRAIT_KEYS,
  defaultGenome,
  migrateGenome,
  serializeGenome,
  deserializeGenome,
} from "@/sim/genome";

describe("게놈 v2 마이그레이션", () => {
  it("기본 게놈은 현재 버전 + 형질 50(초음파·날개·전투는 0 — 특화)", () => {
    const g = defaultGenome();
    expect(g.genomeVersion).toBe(GENOME_VERSION);
    expect(GENOME_VERSION).toBe(6);
    const zeroKeys = ["echo", "wings", "venom", "ranged"];
    for (const k of TRAIT_KEYS) expect(g.traits[k]).toBe(zeroKeys.includes(k) ? 0 : 50);
    expect(g.traits.swimming).toBe(50);
    expect(g.traits.venom).toBe(0);
    expect(g.traits.ranged).toBe(0);
  });

  it("v1 게놈을 받으면 없던 형질을 기본값으로 채워 현재 버전으로 올린다", () => {
    const v1 = {
      genomeVersion: 1,
      traits: { speed: 0.7, attack: 0.3, vision: 0.6, herding: 0.4, metabolism: 0.5, fertility: 0.2, diet: 0.8 },
    };
    const g = migrateGenome(v1);
    expect(g.genomeVersion).toBe(6);
    expect(g.traits.speed).toBe(70);
    expect(g.traits.diet).toBe(80);
    expect(g.traits.swimming).toBe(50); // v1 엔 없던 형질을 기본값으로 채움
    expect(g.traits.venom).toBe(0); // v1 엔 없던 전투 형질은 0
    expect(g.traits.ranged).toBe(0);
  });

  it("v5 게놈(wings 있음)을 받으면 전투(venom·ranged) 0 을 채워 v6 로 올린다", () => {
    const v5 = {
      genomeVersion: 5,
      traits: { speed: 60, attack: 40, vision: 55, herding: 30, metabolism: 50, fertility: 45, diet: 70, swimming: 80, echo: 90, wings: 65 },
    };
    const g = migrateGenome(v5);
    expect(g.genomeVersion).toBe(6);
    expect(g.traits.echo).toBe(90); // v5 형질은 보존
    expect(g.traits.wings).toBe(65);
    expect(g.traits.venom).toBe(0); // v5 엔 없던 전투 형질은 0
    expect(g.traits.ranged).toBe(0);
  });

  it("직렬화 왕복이 보존된다", () => {
    const g = defaultGenome();
    g.traits.swimming = 90;
    g.traits.venom = 75;
    g.traits.ranged = 40;
    const round = deserializeGenome(serializeGenome(g));
    expect(round.traits.swimming).toBe(90);
    expect(round.traits.venom).toBe(75);
    expect(round.traits.ranged).toBe(40);
    expect(round.genomeVersion).toBe(6);
  });

  it("알 수 없는 버전은 거부", () => {
    expect(() => migrateGenome({ genomeVersion: 99, traits: {} })).toThrow();
  });
});
