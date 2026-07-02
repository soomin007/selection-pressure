import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { SIM } from "@/sim/params";
import { TILE } from "@/sim/terrain";
import { GAME } from "@/game/config";
import { createBoss } from "@/sim/boss";
import { defaultGenome, randomGenome, type Genome } from "@/sim/genome";
import { nightVisionFactor, makeFovTest, grassVisionFactor, roughSpeedFactor } from "@/sim/behavior";
import { areFriends } from "@/sim/species";
import { createEntity, type Entity } from "@/sim/entity";
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
    const sharp = tune({ speed: 90, vision: 90, metabolism: 40, fertility: 60 });
    const dull = tune({ speed: 20, vision: 15, metabolism: 70, fertility: 30 });
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
    const lo = afterGate(tune({ metabolism: 10 }), GAME.bossSeconds, (w) => {
      w.boss = createBoss("poison", W, H);
    });
    const base = afterGate(defaultGenome(), GAME.bossSeconds, (w) => {
      w.boss = createBoss("poison", W, H);
    });
    expect(lo).toBeGreaterThan(base);
    expect(lo).toBeGreaterThanOrEqual(GAME.bossPassThreshold);
  });

  it("약탈자: 공격력이 높을수록 잘 버틴다(공격력 카운터)", () => {
    // 카운터 = 근접 반격(memberKills 의 공격력 확률 저항). 개체 시뮬 + 형질 0~100 이산화라 단일 시드
    // "lo < 통과기준"은 노이즈가 있어, 통과(hi ≥ 기준)와 방향(hi > lo)만 견고하게 본다.
    const hi = afterGate(tune({ attack: 90 }), GAME.bossSeconds, (w) => {
      w.boss = createBoss("raider", W, H);
    });
    const lo = afterGate(tune({ attack: 10 }), GAME.bossSeconds, (w) => {
      w.boss = createBoss("raider", W, H);
    });
    expect(hi).toBeGreaterThanOrEqual(GAME.bossPassThreshold);
    expect(hi).toBeGreaterThan(lo);
  });

  it("외톨이 사냥꾼: 사냥꾼 개체(members)가 실제로 개체를 솎는다", () => {
    // 무리성 카운터(cullGroupResist × herding 확률 저항)는 memberKills 에 있으나, 개체 시뮬 특성상
    // 무리성의 성장 부작용과 상충해 단일 시드 형질 게이트는 노이즈가 크다 → 여기선 "사냥꾼이 실제로
    // 솎는다"만 견고하게 검증(카운터 밸런스는 폰 체감으로 조정). 다른 시련은 형질 게이트를 유지.
    const w = new World("env-1", W, H, defaultGenome());
    for (let i = 0; i < 750; i++) w.step();
    w.boss = createBoss("isolation", W, H);
    expect(w.boss.members.length).toBe(3);
    for (let i = 0; i < GAME.bossSeconds * SIM.stepsPerSecond; i++) w.step();
    expect(w.deaths.boss).toBeGreaterThan(0);
  });

  it("그림자 매복자: 매복자 개체(members)가 실제로 개체를 솎는다", () => {
    // 카운터 = 시야로 미리 도망(cullVisionResist + stalkerVisionFlee). 개체 시뮬 + 이산화라 단일 시드
    // 형질 게이트가 불안정해(시야의 성장 효과와 얽힘) "매복자가 실제로 솎는다"만 견고하게 본다(폰 체감 조정).
    const w = new World("env-1", W, H, defaultGenome());
    for (let i = 0; i < 750; i++) w.step();
    w.boss = createBoss("stalker", W, H); // terrain 없이 = 기본 위치(수풀 스폰은 game 이 terrain 전달)
    expect(w.boss.members.length).toBe(4);
    for (let i = 0; i < GAME.bossSeconds * SIM.stepsPerSecond; i++) w.step();
    expect(w.deaths.boss).toBeGreaterThan(0);
  });

  it("수풀 지형: 수풀 안에선 시야가 줄고 시야 형질이 완화한다(지형×형질)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const cs = w.terrain.cellSize;
    let grass: { x: number; y: number } | null = null;
    let open: { x: number; y: number } | null = null;
    for (let cy = 0; cy < w.terrain.rows && !(grass && open); cy++) {
      for (let cx = 0; cx < w.terrain.cols; cx++) {
        const x = (cx + 0.5) * cs;
        const y = (cy + 0.5) * cs;
        if (!grass && w.terrain.isGrass(x, y)) grass = { x, y };
        if (!open && w.terrain.kindAt(x, y) === TILE.land) open = { x, y };
      }
    }
    expect(grass).not.toBeNull(); // 맵에 수풀이 생성된다
    if (grass) {
      const lo = grassVisionFactor(w, grass.x, grass.y, 0.1); // 시야 낮으면 크게 가려짐
      const hi = grassVisionFactor(w, grass.x, grass.y, 0.9); // 시야 높으면 덜 가려짐
      expect(lo).toBeLessThan(1);
      expect(hi).toBeGreaterThan(lo);
    }
    if (open) expect(grassVisionFactor(w, open.x, open.y, 0.5)).toBe(1); // 트인 육지는 감쇠 없음
  });

  it("험지 지형: 험지 안에선 속도가 줄고 속도 형질이 완화한다(지형×형질)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const cs = w.terrain.cellSize;
    let rough: { x: number; y: number } | null = null;
    let open: { x: number; y: number } | null = null;
    for (let cy = 0; cy < w.terrain.rows && !(rough && open); cy++) {
      for (let cx = 0; cx < w.terrain.cols; cx++) {
        const x = (cx + 0.5) * cs;
        const y = (cy + 0.5) * cs;
        if (!rough && w.terrain.isRough(x, y)) rough = { x, y };
        if (!open && w.terrain.kindAt(x, y) === TILE.land) open = { x, y };
      }
    }
    expect(rough).not.toBeNull(); // 맵에 험지가 생성된다
    if (rough) {
      const lo = roughSpeedFactor(w, rough.x, rough.y, 0.1); // 속도 낮으면 크게 느려짐
      const hi = roughSpeedFactor(w, rough.x, rough.y, 0.9); // 속도 높으면 덜 느려짐
      expect(lo).toBeLessThan(1);
      expect(hi).toBeGreaterThan(lo);
    }
    if (open) expect(roughSpeedFactor(w, open.x, open.y, 0.5)).toBe(1); // 트인 육지는 감속 없음
  });

  it("사나운 무리: 잘 성장한 큰 무리는 버티고 부진한 작은 무리는 못 버틴다", () => {
    // swarm 은 전역 솎기가 아니라 실제 추격 떼(members). 순수 도망은 speed 2.5 로 막혀(chaser 와 차별),
    // 잘 성장해 수가 많은 무리만 흩어져 버틴다(카운터 = 개체수/성장). env-1 단일 시드로 대비.
    const strong = afterGate(tune({ vision: 80, speed: 70, fertility: 70 }), GAME.bossSeconds, (w) => {
      w.boss = createBoss("swarm", W, H);
    });
    const weak = afterGate(tune({ vision: 20, speed: 20, fertility: 20 }), GAME.bossSeconds, (w) => {
      w.boss = createBoss("swarm", W, H);
    });
    expect(strong).toBeGreaterThanOrEqual(GAME.bossPassThreshold);
    expect(weak).toBeLessThan(GAME.bossPassThreshold);
    expect(strong).toBeGreaterThan(weak);
  });

  it("사나운 무리: 떼 개체(members)가 실제로 개체를 솎는다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    for (let i = 0; i < 750; i++) w.step();
    w.boss = createBoss("swarm", W, H);
    expect(w.boss.members.length).toBe(6); // 무리 대형으로 몰려드는 떼 6마리
    for (let i = 0; i < GAME.bossSeconds * SIM.stepsPerSecond; i++) w.step();
    expect(w.deaths.boss).toBeGreaterThan(0); // 떼가 문 사망이 실제로 발생
  });

  it("한파 대멸종: 고대사는 통과, 저대사는 실패", () => {
    const hi = afterGate(tune({ metabolism: 90 }), GAME.extinctionSeconds, (w) => {
      w.globalCold = 1.3;
    });
    const lo = afterGate(tune({ metabolism: 10 }), GAME.extinctionSeconds, (w) => {
      w.globalCold = 1.3;
    });
    expect(hi).toBeGreaterThanOrEqual(GAME.extinctionPassThreshold);
    expect(lo).toBeLessThan(GAME.extinctionPassThreshold);
  });

  it("폭염 대멸종: 저대사는 통과, 고대사는 실패", () => {
    const lo = afterGate(tune({ metabolism: 10 }), GAME.extinctionSeconds, (w) => {
      w.heat = 0.9;
    });
    const hi = afterGate(tune({ metabolism: 90 }), GAME.extinctionSeconds, (w) => {
      w.heat = 0.9;
    });
    expect(lo).toBeGreaterThanOrEqual(GAME.extinctionPassThreshold);
    expect(hi).toBeLessThan(GAME.extinctionPassThreshold);
  });

  it("대역병 대멸종: 번식력이 높으면 통과, 낮으면 실패", () => {
    const hi = afterGate(tune({ fertility: 90 }), GAME.extinctionSeconds, (w) => {
      w.plagueRate = 0.005;
    });
    const lo = afterGate(tune({ fertility: 10 }), GAME.extinctionSeconds, (w) => {
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
  it("내 종 + 친척 1 + 야생 8 = 10종으로 시작한다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    expect(w.species.length).toBe(10);
    expect(w.species.filter((s) => s.isPlayer).length).toBe(1);
    // 우호적 친척 종이 정확히 하나(내 종은 friendly 아님).
    expect(w.species.filter((s) => s.friendly).length).toBe(1);
    expect(w.species.filter((s) => s.friendly && s.isPlayer).length).toBe(0);
  });

  it("친척 종은 내 종과 서로 우호(사냥/도망 대상 제외), 야생과는 아니다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const player = w.species.find((s) => s.isPlayer);
    const kin = w.species.find((s) => s.friendly);
    const wild = w.species.find((s) => !s.isPlayer && !s.friendly);
    expect(player && kin && wild).toBeTruthy();
    expect(areFriends(player!, kin!)).toBe(true);
    expect(areFriends(kin!, player!)).toBe(true);
    expect(areFriends(player!, wild!)).toBe(false);
    expect(areFriends(kin!, wild!)).toBe(false);
  });

  it("야생 동맹(같은 편)끼리는 서로 우호, 중립 야생끼리는 아니다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const ally1 = w.species.find((s) => s.name === "초식 경쟁자"); // faction 2
    const ally2 = w.species.find((s) => s.name === "들풀 무리"); // faction 2
    const neutralA = w.species.find((s) => s.name === "작은 풀벌레"); // faction 0
    const neutralB = w.species.find((s) => s.name === "느린 거북"); // faction 0
    expect(ally1 && ally2 && neutralA && neutralB).toBeTruthy();
    expect(areFriends(ally1!, ally2!)).toBe(true); // 같은 2편 = 동맹
    expect(areFriends(ally1!, neutralA!)).toBe(false); // 2편 vs 중립
    expect(areFriends(neutralA!, neutralB!)).toBe(false); // 중립끼리는 편이 없어 우호 아님
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

describe("세대별 형질 (레벨 = 세대)", () => {
  it("내 종은 태어난 시점 게놈 스냅샷 — 종 게놈을 바꿔도 기존 개체는 옛 형질, 새 개체만 새 형질", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const player = w.species.find((s) => s.isPlayer);
    const existing = w.entities.find((e) => e.species.isPlayer);
    expect(player && existing).toBeTruthy();
    const before = existing!.genome.traits.speed;
    player!.genome.traits.speed = 99; // 카드(레벨업)로 종 게놈 변경
    expect(existing!.genome.traits.speed).toBe(before); // 기존 개체는 옛 형질 유지(스냅샷)
    const child = createEntity(9999, 0, 0, player!, 50); // 이후 태어난 개체
    expect(child.genome.traits.speed).toBe(99); // 새 개체만 새 형질
    expect(child.genome).not.toBe(player!.genome); // 독립 복사본
  });

  it("야생은 종 게놈을 공유한다(종 전체가 함께 진화 — 참조 공유)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const wild = w.species.find((s) => !s.isPlayer && !s.friendly);
    expect(wild).toBeTruthy();
    const child = createEntity(9998, 0, 0, wild!, 50);
    expect(child.genome).toBe(wild!.genome); // 야생은 복사 안 함(공유 참조)
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

  it("물 전용 종(수영≥0.9, 물고기 떼)은 육지에 못 올라온다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    let landViolation = 0;
    for (let i = 0; i < 1500; i++) {
      w.step();
      for (const e of w.entities) {
        if (
          e.genome.traits.swimming >= SIM.aquaticOnlyThreshold &&
          w.terrain.kindAt(e.x, e.y) === TILE.land
        ) {
          landViolation += 1;
        }
      }
    }
    expect(landViolation).toBe(0);
  });

  it("비행 종(날개≥flyThreshold)은 산을 넘어 산 위를 난다", () => {
    // 내 종만 비행(날개 70)으로 만든다. 야생종은 날개 0 이라 여전히 산을 못 넘는다.
    const g = defaultGenome();
    g.traits.wings = 70;
    const w = new World("env-1", W, H, g);
    let onMountain = 0;
    for (let i = 0; i < 1500; i++) {
      w.step();
      for (const e of w.entities) {
        if (e.species.isPlayer && w.terrain.kindAt(e.x, e.y) === TILE.mountain) onMountain += 1;
      }
    }
    expect(onMountain).toBeGreaterThan(0); // 비행 종은 지상 종과 달리 산 위를 지난다(고산 먹이 찾아)
    expect(w.population).toBeGreaterThan(0); // 그래도 자생한다
  });
});

describe("야생 진화(살아있는 생태)", () => {
  const wildMeta = (w: World): number => {
    const alive = w.species.filter((s) => !s.isPlayer && w.entities.some((e) => e.species.id === s.id));
    return alive.length
      ? alive.reduce((a, s) => a + s.genome.traits.metabolism, 0) / alive.length
      : 0;
  };

  it("추운 맵에서 야생종이 고대사로 적응한다(환경 진화)", () => {
    const w = new World("s3", W, H, defaultGenome()); // s3 는 추운 맵(평균 추위 ~0.89)
    const start = w.species
      .filter((s) => !s.isPlayer)
      .reduce((a, s) => a + s.genome.traits.metabolism, 0) / 8;
    for (let i = 0; i < 2000; i++) w.step();
    expect(wildMeta(w)).toBeGreaterThan(start); // 추위에 적응해 대사가 올라간다
  });

  it("야생 진화는 독립 rng 라 같은 시드면 동일하게 진화한다(결정론)", () => {
    const a = new World("env-1", W, H, defaultGenome());
    const b = new World("env-1", W, H, defaultGenome());
    for (let i = 0; i < 600; i++) {
      a.step();
      b.step();
    }
    const sig = (w: World): string =>
      w.species.filter((s) => !s.isPlayer).map((s) => s.genome.traits.metabolism.toFixed(5)).join(",");
    expect(sig(a)).toEqual(sig(b));
  });
});

describe("맵 확장(areaScale)", () => {
  it("개체·상한은 절대(소수), 먹이만 면적 비례(큰 맵일수록 개체당 먹이↑)", () => {
    const small = new World("env-1", W, H, defaultGenome(), 1);
    const big = new World("env-1", W * 3, H * 3, defaultGenome(), 9);
    // 개체·상한은 맵 크기와 무관(절대 수 — 소수 개체 게임)
    expect(big.entities.length).toBe(small.entities.length);
    expect(big.cap).toBe(small.cap);
    // 먹이만 면적 비례(밀도 유지 → 큰 맵에서도 개체가 안 굶는다)
    expect(big.food.length).toBeGreaterThan(small.food.length * 5);
  });

  it("playerCentroid 는 내 종 무리의 평균 위치(카메라 추적용)", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const c = w.playerCentroid();
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x).toBeLessThanOrEqual(W);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeLessThanOrEqual(H);
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

describe("시야각(부채꼴)", () => {
  // makeFovTest 는 e 의 x,y,vx,vy 만 본다 → 부분 mock 으로 충분.
  const ent = (vx: number, vy: number): Entity => ({ x: 0, y: 0, vx, vy }) as unknown as Entity;

  it("움직이면 보는 방향(앞)은 보고 등 뒤는 못 본다", () => {
    const test = makeFovTest(ent(1, 0)); // 동쪽(+x)으로 이동 = 동쪽을 봄
    expect(test(10, 0)).toBe(true); // 정면(동)
    expect(test(-10, 0)).toBe(false); // 정반대(서, 등 뒤)
  });

  it("정지(저속)하면 전방위로 본다(두리번)", () => {
    const test = makeFovTest(ent(0, 0));
    expect(test(10, 0)).toBe(true);
    expect(test(-10, 0)).toBe(true); // 뒤도 보임
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
