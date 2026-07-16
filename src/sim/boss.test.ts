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

/** 여러 시드에서 이 게놈이 이 보스에게 솎인 내 종 개체 수 합계(메커니즘이 작동하는가). */
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

/** 보스를 겪고 살아남은 내 종 개체 수 합계(카운터 형질이 실제로 버티게 하는가). */
function bossSurvivors(genome: Genome, type: BossType): number {
  let total = 0;
  for (const seed of SEEDS) {
    const w = new World(seed, W, H, genome);
    for (let i = 0; i < 750; i++) w.step();
    w.boss = createBoss(type, W, H, w.terrain);
    for (let i = 0; i < GAME.bossSeconds * SIM.stepsPerSecond; i++) w.step();
    total += w.playerPopulation;
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
});

describe("보스 레이드 1단계 — 공격 카운터 보스(약탈자)를 전사가 반격으로 격퇴", () => {
  /** 약탈자 레이드 결과 — era 1+ 에서 공격형이 격퇴하는가(격퇴 시드 수 + 체력 남음). */
  function raidResult(genome: Genome, diffMul: number, raidEnabled: boolean): { defeats: number; hpLeft: number } {
    let defeats = 0;
    let hpLeft = 0;
    for (const seed of SEEDS) {
      const w = new World(seed, W, H, genome);
      for (let i = 0; i < 750; i++) w.step();
      w.boss = createBoss("raider", W, H, w.terrain, diffMul, raidEnabled);
      let killed = false;
      for (let i = 0; i < GAME.bossSeconds * SIM.stepsPerSecond; i++) {
        w.step();
        if (w.boss && w.boss.maxHp > 0 && w.boss.hp <= 0) { killed = true; break; }
      }
      if (killed) defeats += 1;
      hpLeft += Math.max(0, w.boss?.hp ?? 0);
    }
    return { defeats, hpLeft };
  }

  it("raidEnabled 파라미터가 격퇴 체력을 켠다(false=버티기 · true=격퇴). 게임은 첫 시대부터 true 를 넘긴다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    // raidEnabled=false: 모든 보스 maxHp 0(레이드 없는 버티기 경로 — 테스트가 이 경로를 따로 검증).
    for (const t of BOSS_TYPES) {
      expect(createBoss(t, W, H, w.terrain, 1, false).maxHp, `${t} 가 버티기 경로에서 격퇴 체력을 가졌다`).toBe(0);
    }
    // raidEnabled=true(게임이 첫 시대부터 넘김): 카운터가 있는 보스는 격퇴 체력, 독 안개(전역)만 여전히 0.
    expect(createBoss("raider", W, H, w.terrain, 1, true).maxHp).toBeGreaterThan(0);
    expect(createBoss("chaser", W, H, w.terrain, 1, true).maxHp).toBeGreaterThan(0); // 속도 카운터
    expect(createBoss("poison", W, H, w.terrain, 1, true).maxHp).toBe(0); // 전역 시련 — 때릴 대상 없음(버티기)
  });

  it("독 안개(전역)를 뺀 모든 풀 보스는 era 1+ 에 격퇴 체력이 있다(카운터 누락 방지)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    for (const t of BOSS_TYPES) {
      const b = createBoss(t, W, H, w.terrain, 1, true);
      if (t === "poison") expect(b.raidCounter).toBeNull();
      else {
        expect(b.raidCounter, `${t} 에 카운터가 안 붙었다`).not.toBeNull();
        expect(b.maxHp, `${t} 에 격퇴 체력이 없다`).toBeGreaterThan(0);
      }
    }
  });

  it("공격형(전사)은 약탈자를 격퇴하고, 초식(공격력 낮음)은 못 잡는다", () => {
    const hunter = tune({ diet: 68, attack: 64, speed: 68, vision: 62 }); // 육식 사냥꾼
    const herb = tune({ diet: 20, attack: 44, fertility: 88, herding: 92 }); // 다산 초식(공격력<문턱)
    const hunterR = raidResult(hunter, 1, true);
    const herbR = raidResult(herb, 1, true);
    // 공격형은 대부분 시드에서 격퇴(전사 반격이 체력을 깎는다).
    expect(hunterR.defeats, "공격형이 약탈자를 못 잡았다").toBeGreaterThanOrEqual(SEEDS.length - 1);
    // 초식은 공격력이 문턱 미만이라 전사가 없어 거의 못 잡는다(자기 카운터가 아니다 → 버티기).
    expect(herbR.defeats, "초식이 약탈자를 잡아 버렸다").toBeLessThan(hunterR.defeats);
    expect(herbR.hpLeft, "초식이 체력을 많이 깎았다").toBeGreaterThan(hunterR.hpLeft);
  });

  it("공격력이 높을수록 더 많이 깎는다(반격 = 공격력 비례)", () => {
    const strong = tune({ attack: 85, speed: 66, vision: 62 });
    const mild = tune({ attack: 58, speed: 66, vision: 62 }); // 문턱 바로 위
    expect(raidResult(strong, 1, true).hpLeft).toBeLessThanOrEqual(raidResult(mild, 1, true).hpLeft);
  });

  it("상어는 물에 든 종만 솎는다 — 육상 종은 손도 못 댄다", () => {
    expect(bossDeaths(defaultGenome(), "shark")).toBe(0); // 물에 못 들어가는 종엔 무해
    expect(bossDeaths(SWIMMER, "shark")).toBeGreaterThan(0); // 헤엄치면 잡힌다
  });

  it("수륙양용 종은 땅 보스에게도 여전히 잡힌다(물이 완전한 피난처는 아니다)", () => {
    // 물에 들어갈 수 있다고 땅 보스를 통째로 무시하지 못한다 — 먹이를 찾아 뭍에 오르기 때문.
    expect(bossDeaths(SWIMMER, "chaser")).toBeGreaterThan(0);
  });

  // 카운터의 세기는 **살아남은 개체 수**로 본다. "솎인 수"로 재면 뒤집힌다 — 잘 사는 빌드는 개체가
  // 많아 떼와 부딪히는 횟수 자체가 늘어, 한 번 물릴 때 잘 버텨도 총 솎임 수는 오히려 커진다
  // (known_issues: 카운터를 절대 개체수/솎임 수로 재면 오독한다).
  it("말벌 떼: 속도가 높을수록 잘 버틴다(속도 카운터 — 쏘이기 전에 벗어난다)", () => {
    expect(bossSurvivors(tune({ speed: 90 }), "hornet")).toBeGreaterThan(
      bossSurvivors(tune({ speed: 30 }), "hornet"),
    );
  });

  it("큰수리: 시야가 넓을수록 잘 버틴다(시야 카운터 — 일찍 보고 달아난다)", () => {
    expect(bossSurvivors(tune({ vision: 90 }), "raptor")).toBeGreaterThan(
      bossSurvivors(tune({ vision: 30 }), "raptor"),
    );
  });
});

describe("보스 레이드 2단계 — 초식 카운터(속도·무리·시야·번식)가 격퇴 체력을 깎는다", () => {
  /** era 1+ 에서 이 게놈이 이 보스를 격퇴한 시드 수(매 틱 무리 충족도가 hp 를 깎아 0 이 되는가). */
  function defeats(genome: Genome, type: BossType): number {
    let count = 0;
    for (const seed of SEEDS) {
      const w = new World(seed, W, H, genome);
      for (let i = 0; i < 750; i++) w.step();
      w.boss = createBoss(type, W, H, w.terrain, 1, true);
      for (let i = 0; i < GAME.bossSeconds * SIM.stepsPerSecond; i++) {
        w.step();
        if (w.boss && w.boss.maxHp > 0 && w.boss.hp <= 0) {
          count += 1;
          break;
        }
      }
    }
    return count;
  }

  it("속도 카운터(추격자·말벌): 빠른 무리는 격퇴하고, 느린 무리는 한 번도 못 잡는다(따돌림)", () => {
    const fast = tune({ speed: 88, vision: 55 });
    const slow = tune({ speed: 45, vision: 85 }); // 속도 floor — 시야가 높아도 속도 카운터는 안 통한다
    for (const t of ["chaser", "hornet"] as const) {
      expect(defeats(fast, t), `빠른 무리가 ${t} 를 못 잡았다`).toBeGreaterThanOrEqual(SEEDS.length - 1);
      expect(defeats(slow, t), `느린 무리가 ${t} 를 잡아 버렸다(엉뚱한 격퇴)`).toBe(0);
    }
  });

  it("시야 카운터(매복자·큰수리): 넓은 시야는 격퇴하고, 좁은 시야는 못 잡는다(경계)", () => {
    const sharp = tune({ vision: 90 });
    const blind = tune({ vision: 40 });
    for (const t of ["stalker", "raptor"] as const) {
      expect(defeats(sharp, t), `넓은 시야가 ${t} 를 못 잡았다`).toBeGreaterThanOrEqual(SEEDS.length - 1);
      expect(defeats(blind, t), `좁은 시야가 ${t} 를 잡아 버렸다`).toBe(0);
    }
  });

  it("번식 카운터(사나운 무리): 다산 무리는 격퇴하고, 저번식은 못 잡는다(수로 메운다)", () => {
    const fecund = tune({ fertility: 92, herding: 60, diet: 20 });
    const barren = tune({ fertility: 40, diet: 20 });
    // 번식은 가장 약한 카운터다 — 사나운 무리는 즉사 반경이 작아(4px) 물기(격퇴 이벤트)가 드물다. 절반쯤
    // 격퇴하고 나머지는 버티기로 통과(통과기준 1). 핵심은 저번식이 **한 번도** 못 잡는 것(카운터 불일치).
    expect(defeats(fecund, "swarm"), "다산 무리가 사나운 무리를 한 번도 못 잡았다").toBeGreaterThanOrEqual(2);
    expect(defeats(barren, "swarm"), "저번식이 사나운 무리를 잡아 버렸다").toBe(0);
  });

  it("무리 카운터(외톨이 사냥꾼): 뭉친 무리만 격퇴하고, 흩어진 무리는 못 잡는다(뭉침)", () => {
    const tight = tune({ herding: 95, fertility: 70, diet: 20 });
    const loose = tune({ herding: 40 }); // 방패 문턱(85) 아래 — 뭉침 카운터 무효
    // 외톨이는 가장 elusive 한 카운터(무리가 시드에 따라 안 뭉치면 못 잡고 버틴다) — 적어도 한 시드는 격퇴.
    expect(defeats(tight, "isolation"), "뭉친 무리가 외톨이를 한 번도 못 잡았다").toBeGreaterThan(0);
    expect(defeats(loose, "isolation"), "흩어진 무리가 외톨이를 잡아 버렸다").toBe(0);
  });

  it("공격·원거리는 만능 카운터 — 어떤 보스든 잡는다(모든 빌드가 싸우게)", () => {
    // 공격 특화는 자기 카운터가 아닌 속도 보스(추격자)도 이빨·뿔로 맞서 잡는다.
    const bruiser = tune({ attack: 90, speed: 55, diet: 60 });
    expect(defeats(bruiser, "chaser"), "공격 특화가 추격자를 못 잡았다").toBeGreaterThan(0);
    // 원거리 특화는 즉사 반경 밖에서 쏴 어떤 보스든 깎는다(원거리로 시작해도 보스전이 된다 — 사용자 지적).
    const sniper = tune({ ranged: 85, diet: 55, attack: 45 });
    expect(defeats(sniper, "chaser"), "원거리 특화가 추격자를 못 잡았다").toBeGreaterThan(0);
  });

  it("싸울 형질이 하나도 없으면 격퇴 못 한다(공격·원거리·카운터 전부 문턱 아래)", () => {
    // 공격 40·원거리 40·속도 45 — 전사가 되는 형질이 없어 어떤 보스도 못 깎는다(도망만).
    const helpless = tune({ attack: 40, ranged: 40, speed: 45, vision: 45, herding: 40, fertility: 45 });
    expect(defeats(helpless, "chaser"), "싸울 형질 없는 빌드가 추격자를 잡았다").toBe(0);
    expect(defeats(helpless, "raider"), "싸울 형질 없는 빌드가 약탈자를 잡았다").toBe(0);
  });
});
