// 보스 층위(하늘/땅/물) — 보스마다 사냥터가 있고, 그 층에 없는 개체는 못 잡는다.
// 규칙(bossCanHunt·speciesLayers)은 순수 함수라 결정론적으로 못박고, "실제로 그렇게 굴러가는가"는
// 여러 시드의 솎임 수(메커니즘 작동)로 본다 — 소수 개체 게임의 절대 개체수는 노이즈다(known_issues).
import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { SIM } from "@/sim/params";
import { TILE } from "@/sim/terrain";
import { GAME } from "@/game/config";
import {
  createBoss,
  bossCanHunt,
  bossEligible,
  eligibleBossTypes,
  entityLayer,
  speciesLayers,
  BOSS_TYPES,
  type BossType,
} from "@/sim/boss";
import { defaultGenome, type Genome, type Traits } from "@/sim/genome";
import type { Entity } from "@/sim/entity";

const W = 540;
const H = 960;
const SEEDS = ["env-1", "env-2", "env-3", "env-4"];

function tune(over: Partial<Traits>): Genome {
  const g = defaultGenome();
  Object.assign(g.traits, over);
  return g;
}

const FLYING = tune({ wings: 80 }); // 날개 ≥ flyThreshold(65) → 늘 하늘에 떠 있다
const SWIMMER = tune({ swimming: 80 }); // 수륙양용 — 땅에도 물에도 있다

/** 여러 시드에서 이 게놈이 이 보스에게 솎인 내 종 개체 수 합계. */
function bossDeaths(genome: Genome, type: BossType): number {
  let total = 0;
  for (const seed of SEEDS) {
    const w = new World(seed, W, H, genome);
    for (let i = 0; i < 750; i++) w.step();
    w.boss = createBoss(type, W, H, w.terrain);
    for (let i = 0; i < GAME.bossSeconds * SIM.stepsPerSecond; i++) w.step();
    total += w.deaths.boss;
  }
  return total;
}

/**
 * 이 세계에서 물 / **트인** 땅 / 수풀 좌표를 하나씩 찾는다(층위 규칙 검증용).
 * 땅은 반드시 수풀이 아닌 트인 땅이어야 한다 — 수풀은 하늘 보스의 엄폐라 판정이 정반대로 나온다.
 */
function spots(w: World): { sea: Vec; land: Vec; grass: Vec } {
  const t = w.terrain;
  const sea = t.nearestLargePassable(W * 0.5, H * 0.5, true, false, false, SIM.minWaterRegion);
  let land: Vec = t.nearestPassable(W * 0.5, H * 0.5, false, true, false);
  for (let i = 0; i < t.tiles.length; i++) {
    if (t.tiles[i] === TILE.land) {
      land = { x: t.tileCenterX(i), y: t.tileCenterY(i) };
      break;
    }
  }
  const grass = t.grassSpots(1)[0] ?? land;
  return { sea, land, grass };
}
interface Vec {
  x: number;
  y: number;
}

/** 좌표만 바꿔 층위 규칙을 물어보기 위한 최소 개체(게놈·위치만 본다). */
function at(genome: Genome, p: Vec): Entity {
  return { genome, x: p.x, y: p.y } as Entity;
}

describe("보스 층위 — 규칙", () => {
  it("개체의 층: 나는 종은 늘 하늘, 물 위는 물, 나머지는 땅", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const { sea, land } = spots(w);
    expect(w.terrain.isWater(sea.x, sea.y)).toBe(true);
    expect(w.terrain.isWater(land.x, land.y)).toBe(false);

    expect(entityLayer(defaultGenome().traits, w.terrain, land.x, land.y)).toBe("land");
    expect(entityLayer(SWIMMER.traits, w.terrain, sea.x, sea.y)).toBe("water");
    // 나는 종은 바다 위를 지나도 물에 잠기지 않는다 — 하늘에 떠 있다.
    expect(entityLayer(FLYING.traits, w.terrain, sea.x, sea.y)).toBe("air");
    expect(entityLayer(FLYING.traits, w.terrain, land.x, land.y)).toBe("air");
  });

  it("종이 머무는 층: 나는 종=하늘 / 수륙양용=땅+물 / 물 전용=물 / 기본=땅", () => {
    expect(speciesLayers(FLYING.traits)).toEqual(["air"]);
    expect(speciesLayers(SWIMMER.traits)).toEqual(["land", "water"]);
    expect(speciesLayers(tune({ swimming: 95 }).traits)).toEqual(["water"]); // 물 전용(물고기)
    expect(speciesLayers(defaultGenome().traits)).toEqual(["land"]);
  });

  it("사냥 판정: 땅 보스는 나는 개체·물속 개체를 못 잡는다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const { sea, land } = spots(w);
    const chaser = createBoss("chaser", W, H, w.terrain);

    expect(bossCanHunt(chaser, at(defaultGenome(), land), w)).toBe(true); // 땅의 땅 종 — 잡힌다
    expect(bossCanHunt(chaser, at(FLYING, land), w)).toBe(false); // 날면 못 잡는다(사용자 요청)
    expect(bossCanHunt(chaser, at(SWIMMER, sea), w)).toBe(false); // 물속도 못 잡는다(물이 피난처)
    expect(bossCanHunt(chaser, at(SWIMMER, land), w)).toBe(true); // 뭍에 오르면 다시 잡힌다
  });

  it("사냥 판정: 하늘 보스는 하늘·땅을 덮치되 수풀에 든 땅 개체는 못 본다(엄폐)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const { sea, land, grass } = spots(w);
    const raptor = createBoss("raptor", W, H, w.terrain);

    expect(bossCanHunt(raptor, at(FLYING, land), w)).toBe(true); // 나는 종이 진짜 표적
    expect(bossCanHunt(raptor, at(defaultGenome(), land), w)).toBe(true); // 트인 땅도 내리꽂혀 낚아챈다
    expect(bossCanHunt(raptor, at(SWIMMER, sea), w)).toBe(false); // 물속은 못 건드린다
    if (w.terrain.isGrass(grass.x, grass.y)) {
      // 수풀에 들면 하늘에서 안 보인다 — 그림자 매복자(수풀=사냥터)와 정반대.
      expect(bossCanHunt(raptor, at(defaultGenome(), grass), w)).toBe(false);
      // 나는 개체는 공중이라 수풀에 숨을 수 없다(같은 좌표여도 잡힌다).
      expect(bossCanHunt(raptor, at(FLYING, grass), w)).toBe(true);
    }
  });

  it("사냥 판정: 물 보스는 물속만 잡는다(뭍은 안전)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const { sea, land } = spots(w);
    const shark = createBoss("shark", W, H, w.terrain);

    expect(bossCanHunt(shark, at(SWIMMER, sea), w)).toBe(true);
    expect(bossCanHunt(shark, at(SWIMMER, land), w)).toBe(false); // 물 밖으로 나가면 산다
    expect(bossCanHunt(shark, at(defaultGenome(), land), w)).toBe(false);
    expect(bossCanHunt(shark, at(FLYING, sea), w)).toBe(false); // 하늘은 못 문다
  });

  it("독 안개는 전역 재난 — 층위로 못 피한다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const { sea, land } = spots(w);
    const poison = createBoss("poison", W, H, w.terrain);
    expect(bossCanHunt(poison, at(FLYING, land), w)).toBe(true);
    expect(bossCanHunt(poison, at(SWIMMER, sea), w)).toBe(true);
    expect(bossCanHunt(poison, at(defaultGenome(), land), w)).toBe(true);
  });
});

describe("보스 층위 — 풀 필터(무의미 보스 방지)", () => {
  it("내 종이 발 들일 수 없는 층만 사냥하는 보스는 안 뽑는다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const t = w.terrain;
    const el = (g: Genome): BossType[] => eligibleBossTypes(g.traits, t, W, H);

    // 나는 종 — 땅 보스는 아무 일도 못 하니 제외. 하늘 보스와 전역 시련만 남는다.
    const fly = el(FLYING);
    expect(fly).not.toContain("chaser");
    expect(fly).not.toContain("stalker");
    expect(fly).not.toContain("shark");
    expect(fly).toContain("raptor");
    expect(fly).toContain("hornet");
    expect(fly).toContain("poison");

    // 육상 종 — 물속 상어는 손도 못 대니 제외. 나머지는 다 걸린다.
    const ground = el(defaultGenome());
    expect(ground).not.toContain("shark");
    expect(ground).toContain("chaser");
    expect(ground).toContain("raptor");

    // 수륙양용 — 땅에도 물에도 있으니 상어까지 다 걸린다(물에 사는 대가).
    expect(el(SWIMMER)).toContain("shark");
    expect(el(SWIMMER)).toContain("chaser");

    // 어떤 종이든 최소 하나는 남는다(독 안개는 전 층위).
    for (const g of [FLYING, SWIMMER, defaultGenome(), tune({ swimming: 95 })])
      expect(el(g).length).toBeGreaterThan(0);
  });

  it("모든 보스 종류에 층위·사냥터가 정의돼 있다(새 보스 추가 시 누락 방지)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    for (const t of BOSS_TYPES) {
      const b = createBoss(t, W, H, w.terrain);
      expect(b.huntLayers.length).toBeGreaterThan(0);
      expect(["air", "land", "water"]).toContain(b.roam);
      // 적격 판정이 게놈 하나에서라도 성립해야 한다(아무에게도 안 걸리는 죽은 보스 금지).
      const anyone = [FLYING, SWIMMER, defaultGenome()].some((g) =>
        bossEligible(t, g.traits, w.terrain, W, H),
      );
      expect(anyone, `${t} 는 어떤 종에게도 안 걸린다`).toBe(true);
    }
  });
});

describe("보스 층위 — 실제로 그렇게 굴러간다", () => {
  it("나는 종은 땅 보스에게 한 마리도 안 잡힌다(하늘로 회피)", () => {
    for (const t of ["chaser", "swarm", "raider", "isolation", "stalker"] as const) {
      expect(bossDeaths(FLYING, t), `나는 종이 ${t} 에게 잡혔다`).toBe(0);
    }
    // 대조 — 같은 보스가 땅에 사는 종은 실제로 솎는다(회피가 "보스가 약해서"가 아니다).
    expect(bossDeaths(defaultGenome(), "chaser")).toBeGreaterThan(0);
  });

  it("나는 종도 하늘 보스에게는 잡힌다 — 땅 보스 회피가 공짜가 아니다", () => {
    expect(bossDeaths(FLYING, "raptor")).toBeGreaterThan(0);
    expect(bossDeaths(FLYING, "hornet")).toBeGreaterThan(0);
  });

  it("상어는 물에 든 종만 솎는다 — 육상 종은 손도 못 댄다", () => {
    expect(bossDeaths(defaultGenome(), "shark")).toBe(0); // 물에 못 들어가는 종엔 무해
    expect(bossDeaths(SWIMMER, "shark")).toBeGreaterThan(0); // 헤엄치면 잡힌다
  });

  it("수륙양용 종은 땅 보스에게도 여전히 잡힌다(물이 완전한 피난처는 아니다)", () => {
    // 물에 들어갈 수 있다고 땅 보스를 통째로 무시하지 못한다 — 먹이를 찾아 뭍에 오르기 때문.
    expect(bossDeaths(SWIMMER, "chaser")).toBeGreaterThan(0);
  });

  it("말벌 떼: 속도가 높을수록 덜 쏘인다(속도 카운터)", () => {
    const fast = bossDeaths(tune({ speed: 90 }), "hornet");
    const slow = bossDeaths(tune({ speed: 30 }), "hornet");
    expect(fast).toBeLessThan(slow);
  });

  it("큰수리: 시야가 넓을수록 덜 솎인다(시야 카운터 — 일찍 보고 달아난다)", () => {
    const sharp = bossDeaths(tune({ vision: 90 }), "raptor");
    const dull = bossDeaths(tune({ vision: 50 }), "raptor");
    expect(sharp).toBeLessThan(dull);
  });
});
