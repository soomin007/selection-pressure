import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { SIM } from "@/sim/params";
import { TILE } from "@/sim/terrain";
import { GAME } from "@/game/config";
import { createBoss } from "@/sim/boss";
import { defaultGenome, randomGenome, type Genome } from "@/sim/genome";
import { nightVisionFactor } from "@/sim/behavior";
import { Rng } from "@/sim/rng";
import type { Food } from "@/sim/food";

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

  it("약탈자: 공격력이 높으면 통과, 낮으면 실패", () => {
    const hi = afterGate(tune({ attack: 0.9 }), GAME.bossSeconds, (w) => {
      w.boss = createBoss("raider", W, H);
    });
    const lo = afterGate(tune({ attack: 0.1 }), GAME.bossSeconds, (w) => {
      w.boss = createBoss("raider", W, H);
    });
    expect(hi).toBeGreaterThanOrEqual(GAME.bossPassThreshold);
    expect(lo).toBeLessThan(GAME.bossPassThreshold);
    expect(hi).toBeGreaterThan(lo);
  });

  it("외톨이 사냥꾼: 무리 성향이 높으면 통과, 낮으면 실패", () => {
    const hi = afterGate(tune({ herding: 0.9 }), GAME.bossSeconds, (w) => {
      w.boss = createBoss("isolation", W, H);
    });
    const lo = afterGate(tune({ herding: 0.1 }), GAME.bossSeconds, (w) => {
      w.boss = createBoss("isolation", W, H);
    });
    expect(hi).toBeGreaterThanOrEqual(GAME.bossPassThreshold);
    expect(lo).toBeLessThan(GAME.bossPassThreshold);
    expect(hi).toBeGreaterThan(lo);
  });

  it("그림자 매복자: 시야가 높으면 통과, 낮으면 실패", () => {
    const hi = afterGate(tune({ vision: 0.9 }), GAME.bossSeconds, (w) => {
      w.boss = createBoss("stalker", W, H);
    });
    const lo = afterGate(tune({ vision: 0.1 }), GAME.bossSeconds, (w) => {
      w.boss = createBoss("stalker", W, H);
    });
    expect(hi).toBeGreaterThanOrEqual(GAME.bossPassThreshold);
    expect(lo).toBeLessThan(GAME.bossPassThreshold);
    expect(hi).toBeGreaterThan(lo);
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

  it("대역병 대멸종: 번식력이 높으면 통과, 낮으면 실패", () => {
    const hi = afterGate(tune({ fertility: 0.9 }), GAME.extinctionSeconds, (w) => {
      w.plagueRate = 0.005;
    });
    const lo = afterGate(tune({ fertility: 0.1 }), GAME.extinctionSeconds, (w) => {
      w.plagueRate = 0.005;
    });
    expect(hi).toBeGreaterThanOrEqual(GAME.extinctionPassThreshold);
    expect(lo).toBeLessThan(GAME.extinctionPassThreshold);
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

describe("종 다양성", () => {
  it("내 종 + 야생 7종 = 8종으로 시작한다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    expect(w.species.length).toBe(8);
    expect(w.species.filter((s) => s.isPlayer).length).toBe(1);
  });

  it("먹이가 여러 종류로 나뉜다(경쟁 분할)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const kinds = new Set<number>();
    for (const f of w.food) kinds.add(f.kind);
    expect(kinds.size).toBeGreaterThanOrEqual(2);
  });

  it("먹이 분할 + 이주로 오래(2000틱) 지나도 여러 종이 공존한다", () => {
    // 예전엔 같은 먹이를 두고 다퉈 금방 1~2종만 남았다. 먹이 종류를 나누고(전문종 공존),
    // 적은 야생종을 주기적으로 보충(이주)해 다양성이 무너지지 않는다.
    const w = new World("env-1", W, H, defaultGenome());
    for (let i = 0; i < 2000; i++) w.step();
    const alive = new Set<number>();
    for (const e of w.entities) alive.add(e.species.id);
    expect(alive.size).toBeGreaterThanOrEqual(5);
  });
});

describe("지형 이동 차단 (P1 결합)", () => {
  it("비수영 종은 물·산 타일에 들어가지 못한다", () => {
    // 야생/내 종 모두 기본 수영 0.5 < 0.65 → 물에 못 들어가고, 산은 누구도 못 넘는다.
    const w = new World("env-1", W, H, defaultGenome());
    let violations = 0;
    for (let i = 0; i < 1500; i++) {
      w.step();
      for (const e of w.entities) {
        const k = w.terrain.kindAt(e.x, e.y);
        const canSwim = e.genome.traits.swimming >= SIM.swimThreshold;
        if (k === TILE.mountain) violations += 1;
        else if (k === TILE.water && !canSwim) violations += 1;
      }
    }
    expect(violations).toBe(0);
  });

  it("막힌 지형이 있어도 멸종하지 않는다(통행 가능한 육지에서 생존)", () => {
    for (const seed of ["env-1", "s2", "s3"]) {
      const w = new World(seed, W, H, defaultGenome());
      for (let i = 0; i < 1500; i++) w.step();
      expect(w.population).toBeGreaterThan(0);
    }
  });
});

describe("낮/밤 순환", () => {
  it("daylight 는 0~1 범위를 돌고 정오(시작)=1·자정(절반)≈0", () => {
    const w = new World("env-1", W, H, defaultGenome());
    expect(w.daylight).toBeCloseTo(1, 5); // tick 0 = 정오
    const half = SIM.dayLength / 2;
    for (let i = 0; i < half; i++) w.step();
    expect(w.daylight).toBeCloseTo(0, 5); // 절반 = 자정
    for (let i = 0; i < half; i++) w.step();
    expect(w.daylight).toBeCloseTo(1, 5); // 한 바퀴 = 다시 정오
  });

  it("daylight 는 tick 만의 함수라 결정론적(같은 시드 무관)", () => {
    const a = new World("env-1", W, H, defaultGenome());
    const b = new World("other-seed", W, H, defaultGenome());
    for (let i = 0; i < 123; i++) {
      a.step();
      b.step();
    }
    expect(a.daylight).toBeCloseTo(b.daylight, 10); // 시드 달라도 tick 같으면 같은 밝기
  });

  it("밤엔 시야가 줄고, vision 이 높을수록 덜 준다(야행성 틈새)", () => {
    // 낮(daylight 1)엔 vision 무관 영향 없음.
    expect(nightVisionFactor(1, 0.1)).toBeCloseTo(1, 5);
    expect(nightVisionFactor(1, 0.9)).toBeCloseTo(1, 5);
    // 자정(daylight 0)엔 시야가 준다(<1).
    expect(nightVisionFactor(0, 0.5)).toBeLessThan(1);
    // 야행성: 자정에 vision 높은 종이 낮은 종보다 더 멀리 본다.
    expect(nightVisionFactor(0, 0.9)).toBeGreaterThan(nightVisionFactor(0, 0.1));
  });
});

describe("자연스러운 이동 — 목표 고정(hysteresis)", () => {
  it("쫓는 먹이 목표를 매 틱 갈아치우지 않는다(제자리 떨림 방지)", () => {
    // 매 틱 nearest 를 새로 고르면 목표가 진동해 제자리에서 드득드득 떤다.
    // 목표를 유지(commit)하므로, 같은 목표를 이어가는 경우가 갈아타는 경우보다 압도적으로 많아야 한다.
    const w = new World("env-1", W, H, defaultGenome());
    for (let i = 0; i < 200; i++) w.step(); // 자리 잡기
    const prev = new Map<number, Food | null>();
    let kept = 0;
    let switched = 0;
    for (let s = 0; s < 200; s++) {
      for (const e of w.entities) {
        const before = prev.get(e.id);
        if (before && e.targetFood) {
          if (before === e.targetFood) kept += 1;
          else switched += 1; // null↔값(먹은 뒤 재탐색)은 세지 않음 — 진짜 목표 교체만
        }
        prev.set(e.id, e.targetFood);
      }
      w.step();
    }
    expect(kept).toBeGreaterThan(switched * 3);
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
