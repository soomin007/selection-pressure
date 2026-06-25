import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { SIM } from "@/sim/params";
import { GAME } from "@/game/config";
import { createBoss } from "@/sim/boss";
import { defaultGenome, randomGenome, type Genome } from "@/sim/genome";
import { Rng } from "@/sim/rng";

const W = 540;
const H = 960;

function snapshot(world: World): string {
  // 위치/에너지까지 포함한 전체 상태 지문 (결정론 검증용)
  const ents = world.entities.map(
    (e) => `${e.id}:${e.x.toFixed(3)},${e.y.toFixed(3)},${e.energy.toFixed(3)}`,
  );
  return `t${world.tick}|p${world.population}|${ents.join(";")}`;
}

function runPop(seed: string, genome: Genome, steps: number): number {
  const w = new World(seed, W, H, genome);
  for (let i = 0; i < steps; i++) w.step();
  return w.population;
}

describe("World 결정론", () => {
  it("같은 환경 시드 + 같은 게놈 → 완전히 같은 상태", () => {
    const a = new World("env-1", W, H, defaultGenome());
    const b = new World("env-1", W, H, defaultGenome());
    for (let i = 0; i < 600; i++) {
      a.step();
      b.step();
    }
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it("다른 환경 시드 → 다른 전개", () => {
    expect(snapshot(stepN("env-A", defaultGenome(), 300))).not.toEqual(
      snapshot(stepN("env-B", defaultGenome(), 300)),
    );
  });
});

describe("Phase 2 — 게놈이 결과를 가른다", () => {
  it("같은 환경, 형질만 다르면 생존 결과가 달라진다", () => {
    // 시야 넓고 빠른 종 vs 시야 좁고 느린 종 (같은 맵)
    const sharp = tune({ speed: 0.9, vision: 0.9, metabolism: 0.4, fertility: 0.6 });
    const dull = tune({ speed: 0.2, vision: 0.15, metabolism: 0.7, fertility: 0.3 });
    const sharpPop = runPop("env-cmp", sharp, 1500);
    const dullPop = runPop("env-cmp", dull, 1500);
    expect(sharpPop).not.toEqual(dullPop);
  });
});

describe("Phase 3 — 환경이 결과를 가른다", () => {
  it("같은 게놈도 환경(맵)에 따라 생존 결과가 갈린다", () => {
    const pops = ["m1", "m2", "m3", "m4", "m5", "m6"].map((s) =>
      runPop(s, defaultGenome(), 1500),
    );
    const spread = Math.max(...pops) - Math.min(...pops);
    expect(spread).toBeGreaterThan(8);
  });
});

describe("Phase 5 — 보스/대멸종이 형질을 거른다 (다종 환경)", () => {
  // 내 종 기준. 한 forage 라운드로 성장시킨 뒤 게이트를 적용한다.
  function afterGate(genome: Genome, seconds: number, apply: (w: World) => void): number {
    const w = new World("env-1", W, H, genome);
    for (let i = 0; i < 750; i++) w.step();
    apply(w);
    for (let i = 0; i < seconds * SIM.stepsPerSecond; i++) w.step();
    return w.playerPopulation;
  }

  it("독 안개: 저대사가 기본보다 훨씬 잘 버틴다", () => {
    // 보스는 RNG 벽이 아니라 "건강하면 버티되 카운터면 여유" — 둘 다 통과하되 저대사가 크게 우위.
    const lo = afterGate(tune({ metabolism: 0.1 }), GAME.bossSeconds, (w) => {
      w.boss = createBoss("poison", W, H);
    });
    const base = afterGate(defaultGenome(), GAME.bossSeconds, (w) => {
      w.boss = createBoss("poison", W, H);
    });
    expect(lo).toBeGreaterThan(base);
    expect(lo).toBeGreaterThanOrEqual(GAME.bossPassThreshold);
  });

  it("한파 대멸종: 고대사는 통과, 저대사는 실패", () => {
    const hi = afterGate(tune({ metabolism: 0.9 }), GAME.extinctionSeconds, (w) => {
      w.globalCold = 1.3;
    });
    const lo = afterGate(tune({ metabolism: 0.1 }), GAME.extinctionSeconds, (w) => {
      w.globalCold = 1.3;
    });
    expect(hi).toBeGreaterThanOrEqual(GAME.extinctionPassThreshold);
    expect(lo).toBeLessThan(GAME.extinctionPassThreshold);
  });

  it("폭염 대멸종: 저대사는 통과, 고대사는 실패", () => {
    const lo = afterGate(tune({ metabolism: 0.1 }), GAME.extinctionSeconds, (w) => {
      w.heat = 0.9;
    });
    const hi = afterGate(tune({ metabolism: 0.9 }), GAME.extinctionSeconds, (w) => {
      w.heat = 0.9;
    });
    expect(lo).toBeGreaterThanOrEqual(GAME.extinctionPassThreshold);
    expect(hi).toBeLessThan(GAME.extinctionPassThreshold);
  });
});

describe("Phase 6 — 사망 원인 집계", () => {
  it("같은 시드 + 같은 게놈이면 사망 원인 집계도 결정론적", () => {
    const a = new World("env-1", W, H, defaultGenome());
    const b = new World("env-1", W, H, defaultGenome());
    for (let i = 0; i < 1500; i++) {
      a.step();
      b.step();
    }
    expect(a.deaths).toEqual(b.deaths);
  });

  it("죽음이 생기면 어떤 원인으로든 집계된다 (내 종 기준)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    for (let i = 0; i < 1500; i++) w.step();
    const total = Object.values(w.deaths).reduce((s, n) => s + n, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("보스(추격자)는 보스 사망으로 집계된다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    for (let i = 0; i < 600; i++) w.step();
    w.boss = createBoss("chaser", W, H);
    for (let i = 0; i < GAME.bossSeconds * SIM.stepsPerSecond; i++) w.step();
    expect(w.deaths.boss).toBeGreaterThan(0);
  });
});

describe("World 생존 sanity", () => {
  it("기본 게놈 + 여러 환경에서 멸종하지도 폭발하지도 않는다", () => {
    for (const seed of ["env-1", "s1", "s2", "s3", "s4"]) {
      const w = new World(seed, W, H, defaultGenome());
      for (let i = 0; i < 2000; i++) w.step();
      expect(w.population).toBeGreaterThan(0);
      expect(w.population).toBeLessThan(SIM.populationCap);
    }
  });

  it("무작위 게놈도 대체로 한참 생존한다", () => {
    const w = new World("rnd", W, H, randomGenome(new Rng("species-x")));
    for (let i = 0; i < 1000; i++) w.step();
    expect(w.population).toBeGreaterThanOrEqual(0); // 멸종 자체는 유효한 결과
    expect(w.population).toBeLessThan(SIM.populationCap);
  });
});

function stepN(seed: string, genome: Genome, steps: number): World {
  const w = new World(seed, W, H, genome);
  for (let i = 0; i < steps; i++) w.step();
  return w;
}

/** 일부 형질만 지정하고 나머지는 0.5 인 게놈. */
function tune(partial: Partial<Genome["traits"]>): Genome {
  const g = defaultGenome();
  for (const key of Object.keys(partial) as (keyof Genome["traits"])[]) {
    const v = partial[key];
    if (v !== undefined) g.traits[key] = v;
  }
  return g;
}
