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
  it("기본 게놈은 v2 + 모든 형질 0.5(수영 포함)", () => {
    const g = defaultGenome();
    expect(g.genomeVersion).toBe(GENOME_VERSION);
    expect(GENOME_VERSION).toBe(3);
    for (const k of TRAIT_KEYS) expect(g.traits[k]).toBe(50);
    expect(g.traits.swimming).toBe(50);
  });

  it("v1 게놈을 받으면 swimming 0.5 를 채워 v2 로 올린다", () => {
    const v1 = {
      genomeVersion: 1,
      traits: { speed: 0.7, attack: 0.3, vision: 0.6, herding: 0.4, metabolism: 0.5, fertility: 0.2, diet: 0.8 },
    };
    const g = migrateGenome(v1);
    expect(g.genomeVersion).toBe(3);
    expect(g.traits.speed).toBe(70);
    expect(g.traits.diet).toBe(80);
    expect(g.traits.swimming).toBe(50); // v1 엔 없던 형질을 기본값으로 채움
  });

  it("직렬화 왕복이 보존된다", () => {
    const g = defaultGenome();
    g.traits.swimming = 90;
    const round = deserializeGenome(serializeGenome(g));
    expect(round.traits.swimming).toBe(90);
    expect(round.genomeVersion).toBe(3);
  });

  it("알 수 없는 버전은 거부", () => {
    expect(() => migrateGenome({ genomeVersion: 99, traits: {} })).toThrow();
  });
});
