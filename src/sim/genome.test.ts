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
  it("기본 게놈 — 값 형질은 50, 능력 형질은 0(안 찍으면 없는 것)", () => {
    const g = defaultGenome();
    expect(g.genomeVersion).toBe(GENOME_VERSION);
    expect(GENOME_VERSION).toBe(7);
    // v7: herding(무리 성향)이 능력 형질로 강등, camouflage(은신) 신설 → 둘 다 기본 0.
    const zeroKeys = ["echo", "wings", "venom", "ranged", "herding", "camouflage"];
    for (const k of TRAIT_KEYS) expect(g.traits[k]).toBe(zeroKeys.includes(k) ? 0 : 50);
    expect(g.traits.swimming).toBe(50);
    expect(g.traits.herding).toBe(0);
    // 몸집 50 = **완전 중립**. 이 값에서 속도·대사·번식·피격 저항 보정이 전부 0 이라, 몸집을 안 건드린
    // 종은 v6 과 똑같이 굴러간다(v7 을 얹어도 기존 밸런스가 안 움직이는 열쇠).
    expect(g.traits.size).toBe(50);
    expect(g.traits.camouflage).toBe(0);
  });

  it("v1 게놈을 받으면 없던 형질을 기본값으로 채워 현재 버전으로 올린다", () => {
    const v1 = {
      genomeVersion: 1,
      traits: { speed: 0.7, attack: 0.3, vision: 0.6, herding: 0.4, metabolism: 0.5, fertility: 0.2, diet: 0.8 },
    };
    const g = migrateGenome(v1);
    expect(g.genomeVersion).toBe(7);
    expect(g.traits.speed).toBe(70);
    expect(g.traits.diet).toBe(80);
    expect(g.traits.swimming).toBe(50); // v1 엔 없던 형질을 기본값으로 채움
    expect(g.traits.venom).toBe(0); // v1 엔 없던 전투 형질은 0
    expect(g.traits.size).toBe(50); // v1 엔 없던 몸집은 중립 50
    expect(g.traits.camouflage).toBe(0);
  });

  it("v5 게놈(wings 있음)을 받으면 전투·v7 형질을 채워 올린다", () => {
    const v5 = {
      genomeVersion: 5,
      traits: { speed: 60, attack: 40, vision: 55, herding: 30, metabolism: 50, fertility: 45, diet: 70, swimming: 80, echo: 90, wings: 65 },
    };
    const g = migrateGenome(v5);
    expect(g.genomeVersion).toBe(7);
    expect(g.traits.echo).toBe(90); // v5 형질은 보존
    expect(g.traits.wings).toBe(65);
    expect(g.traits.venom).toBe(0); // v5 엔 없던 전투 형질은 0
    expect(g.traits.size).toBe(50);
  });

  it("v6 게놈의 herding 은 옛 값을 그대로 존중한다(0 으로 지우지 않는다)", () => {
    // 옛 게놈에서 herding 50 은 "무리 성향 보통"이라는 실제 형질값이었다. 능력 형질로 강등됐다고
    // 0 으로 밀면 그 종의 정체가 바뀐다 — 비동기 생물로 받은 남의 종도 있는 그대로 존중해야 한다.
    const v6 = {
      genomeVersion: 6,
      traits: { speed: 60, attack: 40, vision: 55, herding: 72, metabolism: 50, fertility: 45, diet: 30, swimming: 50, echo: 0, wings: 0, venom: 0, ranged: 0 },
    };
    const g = migrateGenome(v6);
    expect(g.genomeVersion).toBe(7);
    expect(g.traits.herding).toBe(72); // 보존
    expect(g.traits.size).toBe(50); // v6 엔 없던 몸집은 중립
    expect(g.traits.camouflage).toBe(0);
  });

  it("직렬화 왕복이 보존된다", () => {
    const g = defaultGenome();
    g.traits.swimming = 90;
    g.traits.venom = 75;
    g.traits.ranged = 40;
    g.traits.size = 88;
    g.traits.camouflage = 60;
    const round = deserializeGenome(serializeGenome(g));
    expect(round.traits.swimming).toBe(90);
    expect(round.traits.venom).toBe(75);
    expect(round.traits.ranged).toBe(40);
    expect(round.traits.size).toBe(88);
    expect(round.traits.camouflage).toBe(60);
    expect(round.genomeVersion).toBe(7);
  });

  it("알 수 없는 버전은 거부", () => {
    expect(() => migrateGenome({ genomeVersion: 99, traits: {} })).toThrow();
  });
});
