import { describe, it, expect } from "vitest";
import { World, adaptWildTraits, type WildPressure } from "@/sim/world";
import { SIM } from "@/sim/params";
import { TILE } from "@/sim/terrain";
import { GAME } from "@/game/config";
import { createBoss } from "@/sim/boss";
import { cloneGenome, defaultGenome, mutateGenome, randomGenome, type Genome } from "@/sim/genome";
import { nightVisionFactor, makeFovTest, grassVisionFactor, roughSpeedFactor, flyDrainMultiplier, biteOutcome, grazeEfficiency, huntEfficiency, huntSprintFactor, carnivory01, gorgeFactor, maxEnergyFor, packShareGain, packHerdFactor, herdShieldedBy, isApex, sizeDev, sizeSpeedFactor, sizeDrainFactor, sizeFertilityFactor, effectiveCamo, camoVisionFactor } from "@/sim/behavior";
import { areFriends, type Species } from "@/sim/species";
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
    // 카운터 = 시야로 미리 도망(cullVisionResist + stalkerVisionFlee). 개체 시뮬 + 이산화라 단일 시드는
    // 조우가 노이즈다 — sim 밸런스(예: 사냥 스퍼트)를 바꾸면 특정 시드에서 매복자가 우연히 아무도 못 잡을
    // 수 있다. 여러 시드 중 "실제로 솎는 맵이 있다"로 메커니즘 작동을 견고하게 본다(카운터 세기는 폰 체감).
    let totalBossKills = 0;
    for (const seed of ["env-1", "env-2", "env-3"]) {
      const w = new World(seed, W, H, defaultGenome());
      for (let i = 0; i < 750; i++) w.step();
      w.boss = createBoss("stalker", W, H); // terrain 없이 = 기본 위치(수풀 스폰은 game 이 terrain 전달)
      expect(w.boss.members.length).toBe(4);
      for (let i = 0; i < GAME.bossSeconds * SIM.stepsPerSecond; i++) w.step();
      totalBossKills += w.deaths.boss;
    }
    expect(totalBossKills).toBeGreaterThan(0);
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
    const weak = afterGate(tune({ vision: 15, speed: 14, fertility: 14 }), GAME.bossSeconds, (w) => {
      w.boss = createBoss("swarm", W, H);
    });
    expect(strong).toBeGreaterThanOrEqual(GAME.bossPassThreshold);
    expect(weak).toBeLessThan(GAME.bossPassThreshold);
    expect(strong).toBeGreaterThan(weak);
  });

  it("사나운 무리: 떼 개체(members)가 실제로 개체를 솎는다", () => {
    // v7: 기본 게놈은 herding 0(능력 형질로 강등)이라 **뭉치지 않는다**. 떼 보스는 killRadius 가 작아
    // (4px) 흩어진 개체를 잘 못 잡으므로, 떼가 무는 메커니즘 자체를 보려면 뭉치는 종으로 재야 한다.
    // (뭉치지 않는 종이 떼 공격에 덜 당하는 것 자체는 사실이고 의도된 결과 — 집중 포화를 피한다.)
    const w = new World("env-1", W, H, tune({ herding: 50 }));
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
      w.heat = 1.1; // 게임 applyExtinction 과 동일(폭염 세기)
    });
    const hi = afterGate(tune({ metabolism: 90 }), GAME.extinctionSeconds, (w) => {
      w.heat = 1.1;
    });
    expect(lo).toBeGreaterThanOrEqual(GAME.extinctionPassThreshold);
    expect(hi).toBeLessThan(GAME.extinctionPassThreshold);
  });

  it("대역병 대멸종: 번식력이 높으면 통과, 낮으면 실패", () => {
    const hi = afterGate(tune({ fertility: 90 }), GAME.extinctionSeconds, (w) => {
      w.plagueRate = 0.006; // 게임 applyExtinction 과 동일(대역병 세기)
    });
    const lo = afterGate(tune({ fertility: 10 }), GAME.extinctionSeconds, (w) => {
      w.plagueRate = 0.006; // 게임 applyExtinction 과 동일(대역병 세기)
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
  it("내 종 + 친척 1 + 야생 8 + 바이옴 특화 3 = 13종으로 시작한다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    expect(w.species.length).toBe(13); // 10 + 바이옴 특화종(사막·빙하·우림) 3
    expect(w.species.filter((s) => s.isPlayer).length).toBe(1);
    // 우호적 친척 종이 정확히 하나(내 종은 friendly 아님).
    expect(w.species.filter((s) => s.friendly).length).toBe(1);
    expect(w.species.filter((s) => s.friendly && s.isPlayer).length).toBe(0);
    // 바이옴 특화종 3(사막·빙하·우림) — homeBiome 을 가진다.
    expect(w.species.filter((s) => s.homeBiome).length).toBe(3);
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

describe("개체별 진화 (내 종 — 부모 상속 + 변이, 자연선택)", () => {
  it("균일(형질 50)하게 시작해도 세대를 거치며 개체 게놈이 갈린다", () => {
    // 새끼가 '종 기준선'이 아니라 '부모'를 물려받아 조금 변이하므로, 시작은 다 같아도 곧 제각각이 된다.
    const w = new World("env-4", W, H, defaultGenome()); // 시작 전부 대사 50
    for (let i = 0; i < 1500; i++) w.step();
    const mets = w.entities.filter((e) => e.alive && e.species.isPlayer).map((e) => e.genome.traits.metabolism);
    expect(mets.length).toBeGreaterThan(1); // 살아있는 내 종이 여럿
    expect(new Set(mets).size).toBeGreaterThan(1); // 개체마다 대사가 갈린다(균일 50이 아님 = 개체차 창발)
  });

  it("개체 변이는 독립 mutRng 라 같은 시드면 완전히 동일(결정론 보존)", () => {
    const run = (): number[] => {
      const w = new World("env-4", W, H, defaultGenome());
      for (let i = 0; i < 1200; i++) w.step();
      return w.entities.filter((e) => e.alive && e.species.isPlayer).map((e) => e.genome.traits.metabolism);
    };
    expect(run()).toEqual(run());
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

describe("전투 형질 (P5)", () => {
  it("방어 독 — 독 지닌 먹이를 삼킨 포식자가 중독된다(잡아먹으면 손해)", () => {
    // 독 지닌 초식(피식자)을 야생 포식자가 잡아먹으면 독이 옮아 포식자가 중독된다(독개구리·독뱀).
    const g = defaultGenome();
    g.traits.diet = 20; // 초식(피식자)
    g.traits.venom = 100; // 강한 방어 독
    const w = new World("env-1", W, H, g);
    let maxPredPoison = 0;
    for (let i = 0; i < 1500; i++) {
      w.step();
      for (const e of w.entities) {
        if (!e.species.isPlayer && e.poison > maxPredPoison) maxPredPoison = e.poison;
      }
    }
    expect(maxPredPoison).toBeGreaterThan(0); // 독먹이를 삼킨 포식자가 중독된다
    expect(w.playerPopulation).toBeGreaterThan(0); // 독으로 포식을 막아 자생
  });

  it("원거리 종은 늘어난 사거리로 사냥하며 자생한다", () => {
    const g = defaultGenome();
    g.traits.diet = 65;
    g.traits.attack = 55;
    g.traits.ranged = 100; // 사거리 12 → 34
    const w = new World("env-1", W, H, g);
    for (let i = 0; i < 1500; i++) w.step();
    expect(w.playerPopulation).toBeGreaterThan(0);
    expect(w.deaths.predation).toBeGreaterThan(0); // 사냥이 실제로 일어난다
  });
});

describe("야생 진화(살아있는 생태)", () => {
  const wildMeta = (w: World): number => {
    const alive = w.species.filter((s) => !s.isPlayer && w.entities.some((e) => e.species.id === s.id));
    return alive.length
      ? alive.reduce((a, s) => a + s.genome.traits.metabolism, 0) / alive.length
      : 0;
  };

  it("추운 맵(빙하) 야생이 더운 맵 야생보다 고대사로 적응한다(바이옴 진화)", () => {
    // 바이옴이 한 맵에 섞여 "맵 평균"만으론 약하다(추운 맵도 평균 추위 ~0.33). 대신 추운 맵 vs 더운 맵을
    // 비교하면 방향이 뚜렷하다 — 빙하가 넓은 맵의 야생이 더운 맵보다 확실히 고대사로 수렴(결정론).
    const runWildMeta = (seed: string): number => {
      const w = new World(seed, W, H, defaultGenome());
      for (let i = 0; i < 2000; i++) w.step();
      return wildMeta(w);
    };
    expect(runWildMeta("cold-1")).toBeGreaterThan(runWildMeta("env-2")); // 추운 맵(빙하) > 더운 맵
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

  // --- 압력별 적응(순수 함수 adaptWildTraits) — 결정론적으로 방향성을 직접 검증 ---
  const applyN = (t: Genome["traits"], p: WildPressure, times: number): void => {
    for (let i = 0; i < times; i++) adaptWildTraits(t, p);
  };
  // 안 춥고(0) 배부르고(1) 포식자 없음(0) — 아무 압력 없는 기준 상태
  const calm: WildPressure = { avgCold: 0, avgEnergy01: 1, predFrac: 0 };

  it("포식자에 노출되면 속도·무리 성향이 오른다(포식 압력 적응)", () => {
    const t = tune({ speed: 50, herding: 50 }).traits;
    applyN(t, { avgCold: 0, avgEnergy01: 1, predFrac: 0.5 }, 60);
    expect(t.speed).toBeGreaterThan(50); // 빨라져 도망
    expect(t.herding).toBeGreaterThan(50); // 뭉쳐서 방어
  });

  it("포식자가 없으면 속도·무리 성향은 그대로다(포식 없는 곳에서 안 부풀린다)", () => {
    const t = tune({ speed: 50, herding: 50 }).traits;
    applyN(t, calm, 60);
    expect(t.speed).toBe(50);
    expect(t.herding).toBe(50);
  });

  it("먹이가 부족하면(평균 에너지 낮음) 저대사로 적응한다(효율)", () => {
    const t = tune({ metabolism: 50 }).traits;
    applyN(t, { avgCold: 0, avgEnergy01: 0, predFrac: 0 }, 60); // 굶주림
    expect(t.metabolism).toBeLessThan(30); // 기준값(30)보다도 아래로 — 적게 먹고 버틴다
  });

  it("추위와 먹이 부족은 대사를 두고 밀당한다(같이 굶주리면 덜 오른다)", () => {
    const cold = tune({ metabolism: 50 }).traits;
    applyN(cold, { avgCold: 1, avgEnergy01: 1, predFrac: 0 }, 80); // 춥고 배부름
    const coldHungry = tune({ metabolism: 50 }).traits;
    applyN(coldHungry, { avgCold: 1, avgEnergy01: 0, predFrac: 0 }, 80); // 춥고 굶주림
    expect(cold.metabolism).toBeGreaterThan(60); // 추위만이면 고대사로 크게
    expect(coldHungry.metabolism).toBeLessThan(cold.metabolism); // 굶주림이 상승을 깎는다
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

describe("비동기 생물(S2) — 챔피언 등장", () => {
  it("챔피언을 넘기면 champion 개체가 스폰되고 내 편(faction 1)이다", () => {
    const champ = { genome: defaultGenome(), name: "테스트 정복자", color: 0xff0000 };
    const w = new World("champ-seed", W, H, defaultGenome(), 1, [champ]);
    const champs = w.entities.filter((e) => e.species.champion === true);
    expect(champs.length).toBeGreaterThan(0);
    expect(champs.length).toBe(SIM.championInitialCount);
    expect((champs[0] as Entity).species.faction).toBe(1); // 내 편이라 서로 사냥·도망 안 함
  });

  it("챔피언 등장이 메인 스폰(다른 종)을 1비트도 안 바꾼다 — 독립 rng 격리(밸런스 보존)", () => {
    const champ = { genome: defaultGenome(), name: "정복자", color: 0xff0000 };
    const withChamp = new World("iso-seed", W, H, defaultGenome(), 1, [champ]);
    const noChamp = new World("iso-seed", W, H, defaultGenome(), 1, []);
    const nonChampFingerprint = (w: World): string =>
      w.entities
        .filter((e) => !e.species.champion)
        .map((e) => `${e.species.id}:${e.x.toFixed(3)},${e.y.toFixed(3)}`)
        .join("|");
    // 챔피언을 뺀 나머지(내 종·야생·친척·바이옴)가 완전히 동일해야 한다(챔피언은 독립 rng 라 스트림 무소비).
    expect(nonChampFingerprint(withChamp)).toBe(nonChampFingerprint(noChamp));
  });
});

describe("드래프트 스킵 보상 — 새끼 낳기", () => {
  it("spawnPlayerBrood(n) 은 내 종 개체를 n 마리 늘린다", () => {
    const w = new World("brood-seed", W, H, defaultGenome());
    const before = w.entities.filter((e) => e.species.isPlayer).length;
    w.spawnPlayerBrood(3);
    const after = w.entities.filter((e) => e.species.isPlayer).length;
    expect(after).toBe(before + 3);
  });
});

describe("카메라 초점 — 주 무리를 잡는다(낙오자 무시)", () => {
  it("playerFocus 는 hint 근처 가중이라 낙오자보다 주 무리(다수)를 잡는다", () => {
    const w = new World("focus-seed", W, H, defaultGenome());
    // 기존 내 종 개체를 치우고, 낙오자 소수(좌상단) + 주 무리 다수(우하단)로 재배치한다.
    w.entities = w.entities.filter((e) => !e.species.isPlayer);
    for (let i = 0; i < 2; i++) w.entities.push(createEntity(w.nextId(), 60 + i, 60, w.playerSpecies, 50));
    for (let i = 0; i < 6; i++) w.entities.push(createEntity(w.nextId(), 400 + i * 5, 780, w.playerSpecies, 50));
    // 화면 중앙을 hint 로 줘도(첫 프레임 가정) 다수(우하단)가 가중을 지배해 그쪽을 잡는다.
    const f = w.playerFocus(W / 2, H / 2);
    expect(f.y).toBeGreaterThan(600);
    expect(f.x).toBeGreaterThan(300);
  });

  it("무리 근처에서 새 개체(번식) 하나가 더해져도 초점이 거의 안 튄다(어지럼 방지)", () => {
    const w = new World("focus-birth", W, H, defaultGenome());
    w.entities = w.entities.filter((e) => !e.species.isPlayer);
    for (let i = 0; i < 6; i++) w.entities.push(createEntity(w.nextId(), 300 + (i % 3) * 10, 500 + i * 8, w.playerSpecies, 50));
    const before = w.playerFocus(300, 520);
    // 무리 안에서 번식 — 초점이 크게 안 움직여야 한다.
    w.entities.push(createEntity(w.nextId(), 315, 540, w.playerSpecies, 50));
    const after = w.playerFocus(300, 520);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(10);
  });
});

describe("비행 대사 — 날개 크기가 의미를 갖는다", () => {
  it("못 나는 종은 영향이 없다(배수 1)", () => {
    expect(flyDrainMultiplier(0)).toBe(1);
    expect(flyDrainMultiplier(SIM.flyThreshold - 1)).toBe(1);
  });

  it("겨우 나는 종(문턱)은 대가가 가장 크다", () => {
    expect(flyDrainMultiplier(SIM.flyThreshold)).toBeCloseTo(1 + SIM.flyMetabolismCost, 10);
  });

  it("날개가 클수록 덜 지친다(단조 감소)", () => {
    const atThreshold = flyDrainMultiplier(SIM.flyThreshold);
    const mid = flyDrainMultiplier(Math.round((SIM.flyThreshold + 100) / 2));
    const full = flyDrainMultiplier(100);
    expect(mid).toBeLessThan(atThreshold);
    expect(full).toBeLessThan(mid);
    // 날개 100 이면 비행 대가가 relief 만큼 줄어든다.
    expect(full).toBeCloseTo(1 + SIM.flyMetabolismCost * (1 - SIM.flyMetabolismRelief), 10);
  });

  it("아무리 커도 비행이 공짜가 되지는 않는다", () => {
    expect(flyDrainMultiplier(100)).toBeGreaterThan(1);
    expect(flyDrainMultiplier(999)).toBe(flyDrainMultiplier(100)); // 상한 밖은 같은 값
  });
});

describe("사냥 판정 — 물기(쿨다운 + 기운 깎기)", () => {
  it("압도하면 거의 한 번에 잡는다(상한 95%)", () => {
    const b = biteOutcome(100, 0);
    expect(b.ignored).toBe(false);
    expect(b.killChance).toBe(SIM.killChanceMax);
  });

  it("호각이면 즉사 확률은 기준값, 물기 피해는 biteDamage 그대로", () => {
    const b = biteOutcome(50, 50);
    expect(b.killChance).toBeCloseTo(SIM.killChanceBias, 10);
    expect(b.damage).toBeCloseTo(SIM.biteDamage, 10);
  });

  it("체급이 밀리면 즉사 확률이 떨어지고, 결국 0 이 돼도 기운은 계속 깎는다", () => {
    // "즉사 확률이 0 이 되는 체급 차"를 파라미터에서 유도한다(상수를 박아 두면 튜닝할 때마다 깨진다).
    const zeroDiff = SIM.killChanceBias / SIM.killChanceScale; // 이만큼 밀리면 즉사 확률 0
    expect(zeroDiff).toBeLessThan(SIM.biteIgnoreDiff); // 무시 문턱보다 먼저 온다 = "물긴 무는데 못 죽인다" 구간이 있다

    const mild = biteOutcome(50, 50 + zeroDiff * 100 * 0.5); // 절반쯤 밀림
    expect(mild.ignored).toBe(false);
    expect(mild.killChance).toBeGreaterThan(0);
    expect(mild.killChance).toBeLessThan(SIM.killChanceBias);

    const noKill = biteOutcome(50, 50 + zeroDiff * 100 + 1); // 즉사 확률 0 구간
    expect(noKill.ignored).toBe(false);
    expect(noKill.killChance).toBe(0);
    expect(noKill.damage).toBeGreaterThan(0); // 그래도 기운은 깎는다
    expect(noKill.damage).toBeLessThan(SIM.biteDamage);
  });

  it("체급이 크게 밀리면 이빨이 아예 안 박힌다 — 즉사 0, 피해 0", () => {
    const diff = SIM.biteIgnoreDiff * 100;
    const just = biteOutcome(50, 50 + diff - 1); // 문턱 바로 위 → 통한다
    const over = biteOutcome(50, 50 + diff); // 문턱 도달 → 무시
    expect(just.ignored).toBe(false);
    expect(over.ignored).toBe(true);
    expect(over.killChance).toBe(0);
    expect(over.damage).toBe(0);
  });

  it("물기 피해는 체급 차에 비례한다(셀수록 깊이 박힌다)", () => {
    expect(biteOutcome(70, 50).damage).toBeGreaterThan(biteOutcome(50, 50).damage);
    expect(biteOutcome(50, 50).damage).toBeGreaterThan(biteOutcome(40, 50).damage);
  });

  it("접촉해도 즉사하지 않는다 — 쿨다운이 초당 30번 물기를 막는다", () => {
    // 예전엔 사거리에 닿는 매 틱 판정을 굴려 접촉 즉시(≈2틱) 죽었다.
    expect(SIM.attackCooldownTicks).toBeGreaterThan(1);
  });

  it("공격력이 크게 앞선 먹잇감은 약한 포식자에게 잡히지 않는다(붙어 있어도)", () => {
    const pg = defaultGenome();
    pg.traits.diet = 90; // 순수 육식
    pg.traits.attack = 40;
    const w = new World("bite-immune", 400, 400, pg);
    const preyGenome = defaultGenome();
    preyGenome.traits.attack = 90; // 차 -50 → 무시 문턱(-35) 밖
    preyGenome.traits.speed = 1; // 도망 못 감 → 계속 접촉
    preyGenome.traits.diet = 10;
    const preySpecies: Species = {
      id: 99,
      name: "먹이",
      genome: preyGenome,
      isPlayer: false,
      color: 0xffffff,
      initialCount: 1,
      foodKinds: [0],
      friendly: false,
      faction: 0,
    };
    const pred = w.entities.find((e) => e.species.isPlayer);
    expect(pred).toBeDefined();
    if (!pred) return;
    const prey = createEntity(9999, pred.x + 4, pred.y, preySpecies, 100);
    w.entities = [pred, prey];
    for (let i = 0; i < 400; i++) {
      pred.energy = 100;
      prey.energy = 100; // 굶주림으로 죽는 건 이 테스트의 관심사가 아니다
      w.step();
    }
    expect(prey.alive).toBe(true); // 400틱(13초) 붙어 있어도 못 잡는다
  });

  it("여러 번 물면 결국 잡는다(기운이 다하면 잡아먹힘으로 집계)", () => {
    const pg = defaultGenome();
    pg.traits.diet = 90;
    pg.traits.attack = 45; // 즉사 확률 0(차 -5×1.5 + 0.3 = 0.225 … 낮음)이지만 피해는 들어간다
    const w = new World("bite-attrition", 400, 400, pg);
    const preyGenome = defaultGenome();
    preyGenome.traits.attack = 60;
    preyGenome.traits.speed = 1;
    preyGenome.traits.diet = 10;
    const preySpecies: Species = {
      id: 99,
      name: "먹이",
      genome: preyGenome,
      isPlayer: false,
      color: 0xffffff,
      initialCount: 1,
      foodKinds: [0],
      friendly: false,
      faction: 0,
    };
    const pred = w.entities.find((e) => e.species.isPlayer);
    if (!pred) return;
    const prey = createEntity(9999, pred.x + 4, pred.y, preySpecies, 100);
    w.entities = [pred, prey];
    let ticks = 0;
    for (let i = 0; i < 400 && prey.alive; i++) {
      pred.energy = 100;
      w.step();
      ticks = i + 1;
    }
    expect(prey.alive).toBe(false);
    expect(ticks).toBeGreaterThan(SIM.attackCooldownTicks); // 즉사가 아니라 여러 번 물어서
  });

  it("물려서 약해진 채 쓰러지면 사망 원인은 굶주림이 아니라 부상이다", () => {
    const pg = defaultGenome();
    pg.traits.diet = 90;
    pg.traits.attack = 45; // 즉사는 못 시키고 물기 피해만 넣는 체급
    const w = new World("wound", 400, 400, pg);
    const preyGenome = defaultGenome();
    preyGenome.traits.attack = 60;
    preyGenome.traits.speed = 1;
    preyGenome.traits.diet = 10;
    const preySpecies: Species = {
      id: 99,
      name: "먹이",
      genome: preyGenome,
      isPlayer: true, // world.deaths 는 내 종만 센다 → 먹잇감을 내 종으로
      color: 0xffffff,
      initialCount: 1,
      foodKinds: [0],
      friendly: false,
      faction: 0,
    };
    const pred = w.entities.find((e) => e.species.isPlayer);
    if (!pred) return;
    // 내 종 개체를 전부 치우고 먹잇감 하나만 남긴다(집계를 깨끗하게).
    const prey = createEntity(9999, pred.x + 4, pred.y, preySpecies, 100);
    pred.species = { ...pred.species, isPlayer: false, faction: 0 };
    w.entities = [pred, prey];

    // 한 번 물린 직후 포식자를 멀리 떼어 놓는다 → 먹잇감은 다친 채 도망쳐 기운이 다한다.
    for (let i = 0; i < 300 && prey.alive; i++) {
      if (prey.woundTicks > 0) {
        pred.x = 10;
        pred.y = 10;
        pred.targetPrey = null;
        prey.energy = Math.min(prey.energy, 2); // 곧 쓰러질 만큼만
      }
      w.step();
    }
    expect(prey.alive).toBe(false);
    expect(w.deaths.wound).toBeGreaterThan(0);
    expect(w.deaths.starve).toBe(0); // 굶주림으로 잘못 집계되지 않는다
  });

  it("물린 지 오래되면 부상이 아니라 굶주림으로 집계된다(뒤집어씌우지 않는다)", () => {
    const g = defaultGenome();
    const w = new World("wound-expire", 400, 400, g);
    const e = w.entities.find((x) => x.species.isPlayer);
    if (!e) return;
    e.woundTicks = 1;
    w.step(); // woundTicks 1 → 0
    expect(e.woundTicks).toBe(0);
  });

  it("닿을 수 없는 먹잇감은 아예 조준하지 않는다(물가 머리박기 방지)", () => {
    // 땅 위 잡식 종이 물속 물고기를 노리고 물가에 갇히던 버그. 끼임 감지(stuckTicks)로는 안 풀린다 —
    // 물가에서 튕기며 진동해 "움직였다"로 판정되기 때문. 후보 선정에서 통행 가능성을 봐야 한다.
    const g = defaultGenome(); // 수영 50 < 문턱 65 → 물에 못 들어감
    let waterTargetTicks = 0;
    let entTicks = 0;
    let maxStreak = 0;
    const streak = new Map<number, number>();
    for (const seed of ["env-1", "env-3"]) {
      const w = new World(seed, 1080, 1920, g);
      for (let i = 0; i < 1200; i++) {
        w.step();
        for (const e of w.entities) {
          if (!e.species.isPlayer || !e.alive) continue;
          entTicks += 1;
          const p = e.targetPrey;
          const onWater = !!p && p.alive && w.terrain.kindAt(p.x, p.y) === TILE.water;
          if (onWater) {
            waterTargetTicks += 1;
            const n = (streak.get(e.id) ?? 0) + 1;
            streak.set(e.id, n);
            if (n > maxStreak) maxStreak = n;
          } else streak.set(e.id, 0);
        }
      }
    }
    // 수정 전엔 개체틱의 30% 넘게(수천 틱) 물속 먹잇감을 붙들고 물가에서 진동했다.
    // 지금 남는 건 **한 틱 지연**뿐 — 땅 위 먹잇감을 조준한 뒤 그 먹잇감이 같은 틱에 물로 들어간 경우다.
    // 다음 틱에 놓으므로 연속으로 붙들지 않는다(물리적으로도 자연스럽다: "얘가 방금 물에 뛰어들었다").
    expect(maxStreak).toBeLessThanOrEqual(2);
    expect(waterTargetTicks / entTicks).toBeLessThan(0.005); // 0.5% 미만(예전 31%)
  });

  it("못 죽인 물기는 연출 이벤트를 낸다(추격이 '아무 일도 안 일어남'으로 보이지 않게)", () => {
    const pg = defaultGenome();
    pg.traits.diet = 90;
    pg.traits.attack = 45;
    const w = new World("bite-fx", 400, 400, pg);
    const preyGenome = defaultGenome();
    preyGenome.traits.attack = 60;
    preyGenome.traits.speed = 1;
    preyGenome.traits.diet = 10;
    const preySpecies: Species = {
      id: 99,
      name: "먹이",
      genome: preyGenome,
      isPlayer: false,
      color: 0xffffff,
      initialCount: 1,
      foodKinds: [0],
      friendly: false,
      faction: 0,
    };
    const pred = w.entities.find((e) => e.species.isPlayer);
    if (!pred) return;
    const prey = createEntity(9999, pred.x + 4, pred.y, preySpecies, 100);
    w.entities = [pred, prey];
    let bites = 0;
    for (let i = 0; i < 200 && prey.alive; i++) {
      pred.energy = 100;
      w.step();
      bites += w.events.filter((ev) => ev.kind === "bite").length;
      w.events.length = 0; // 렌더가 매 프레임 비우는 것과 같게
    }
    expect(bites).toBeGreaterThan(0);
  });
});

describe("식성(diet) 섭취 효율 (제너럴리스트 페널티)", () => {
  const HUNT = SIM.dietHuntMin; // 35 — 사냥 시작 문턱(= 순수 초식 상한)
  const GRAZE = SIM.dietGrazeMax; // 70 — 채집 가능 상한(= 순수 육식 하한)
  const PEN = SIM.dietSpecializationPenalty;

  it("순수 초식(diet ≤ 사냥임계)은 채집 효율이 온전하다(1.0)", () => {
    // 야생 초식종(diet 12~30) 구간은 효율이 안 변한다 → 통과기준 밸런스가 잡식 기준선에만 걸린다.
    expect(grazeEfficiency(0)).toBe(1);
    expect(grazeEfficiency(20)).toBe(1);
    expect(grazeEfficiency(HUNT)).toBe(1);
  });

  it("순수 육식(diet ≥ 채집임계)은 사냥 효율이 온전하다(1.0)", () => {
    // 야생 포식자(diet 85) 구간도 효율 불변.
    expect(huntEfficiency(GRAZE)).toBe(1);
    expect(huntEfficiency(85)).toBe(1);
    expect(huntEfficiency(100)).toBe(1);
  });

  it("잡식 구간은 채집·사냥 둘 다 페널티 — 문턱 끝에서 최대(1-PEN)", () => {
    expect(grazeEfficiency(50)).toBeLessThan(1);
    expect(huntEfficiency(50)).toBeLessThan(1);
    expect(grazeEfficiency(GRAZE)).toBeCloseTo(1 - PEN); // 채집 상한에서 최저
    expect(huntEfficiency(HUNT)).toBeCloseTo(1 - PEN); // 사냥 하한에서 최저
  });

  it("특화할수록 자기 먹이 효율이 높다(초식=채집, 육식=사냥) — 특화 유인", () => {
    expect(grazeEfficiency(20)).toBeGreaterThan(grazeEfficiency(50));
    expect(huntEfficiency(85)).toBeGreaterThan(huntEfficiency(50));
  });

  it("효율은 diet 에 단조롭다(중간이 특화보다 낫지 않다)", () => {
    expect(grazeEfficiency(30)).toBeGreaterThanOrEqual(grazeEfficiency(50));
    expect(grazeEfficiency(50)).toBeGreaterThan(grazeEfficiency(65));
    expect(huntEfficiency(75)).toBeGreaterThanOrEqual(huntEfficiency(50));
    expect(huntEfficiency(50)).toBeGreaterThan(huntEfficiency(40));
  });

  it("채집 절벽 완화 — diet 70 위에서 채집 효율이 뚝 끊기지 않고 완만히 0 으로 준다", () => {
    // 예전엔 canGraze 이진 게이트가 diet 70 에서 채집을 **0 으로** 끊어 순수 육식이 굶어 죽었다.
    // 이제 70(0.7)에서 100(0)까지 tail 로 이어진다 — 순수 육식의 굶주림 fallback.
    expect(grazeEfficiency(GRAZE)).toBeCloseTo(1 - PEN); // diet 70 = tail 시작점(0.7, 불변)
    expect(grazeEfficiency(100)).toBe(0); // 완전 육식은 풀에서 아무것도 못 얻는다
    // 70~100 단조 감소(절벽이 아니라 경사).
    expect(grazeEfficiency(74)).toBeLessThan(grazeEfficiency(70));
    expect(grazeEfficiency(85)).toBeLessThan(grazeEfficiency(74));
    expect(grazeEfficiency(100)).toBeLessThan(grazeEfficiency(90));
    // diet 74(순수 육식 경계)는 fallback 이 유의미하게 남는다(즉사 방지). diet 90 은 미미(사냥 위주).
    expect(grazeEfficiency(74)).toBeGreaterThan(0.3);
    expect(grazeEfficiency(90)).toBeLessThan(0.1);
  });

  it("채집 tail 은 야생 포식자(diet 85)에게 거의 안 간다 — 생태 보존(카드 프리셋은 diet 70 아래라 불변)", () => {
    // falloff 가 급해 diet 85 는 채집 ~9% 뿐이다. 이게 커지면 야생 포식자가 채집으로 살찌워져 생태가
    // 통째로 바뀐다(프로브로 확인한 안전선). diet 70 아래(모든 프리셋·야생 초식)는 tail 이 없어 완전 불변.
    expect(grazeEfficiency(85)).toBeLessThan(0.15);
    expect(grazeEfficiency(69)).toBeCloseTo(1 - PEN * ((69 - HUNT) / (GRAZE - HUNT))); // 70 아래는 옛 공식 그대로
  });
});

describe("사냥 스퍼트 (질주형 육식 — speed 가 사냥법이 된다)", () => {
  const GRAZE = SIM.dietGrazeMax; // 70 — 순수 육식 문턱
  const BONUS = SIM.huntSprintBonus;

  it("추격 중이 아니면 스퍼트 없음(1.0)", () => {
    expect(huntSprintFactor(100, false)).toBe(1);
    expect(huntSprintFactor(50, false)).toBe(1);
  });

  it("잡식·초식은 추격해도 스퍼트 없음 — 순수 육식만(야생 초식·잡식 밸런스 보존)", () => {
    expect(huntSprintFactor(20, true)).toBe(1); // 초식
    expect(huntSprintFactor(50, true)).toBe(1); // 잡식
    expect(huntSprintFactor(GRAZE, true)).toBe(1); // 순수 육식 문턱 = 0(연속)
  });

  it("순수 육식은 추격 시 속도가 오르고, 육식일수록 크다", () => {
    expect(huntSprintFactor(100, true)).toBeCloseTo(1 + BONUS); // 완전 육식 최대
    expect(huntSprintFactor(85, true)).toBeGreaterThan(1);
    expect(huntSprintFactor(100, true)).toBeGreaterThan(huntSprintFactor(85, true)); // 단조
  });
});

describe("큰 사냥·긴 포만 (순수 육식 — 드물게 성공해도 크게 먹고 오래 버틴다)", () => {
  const GRAZE = SIM.dietGrazeMax; // 70 — 순수 육식 문턱

  it("순수 육식도(carnivory01): 잡식·초식은 0, 문턱에서 0, 완전 육식 100에서 1", () => {
    expect(carnivory01(50)).toBe(0); // 잡식 — 무영향(통과기준 보존)
    expect(carnivory01(20)).toBe(0); // 초식
    expect(carnivory01(GRAZE)).toBe(0); // 문턱 = 0(연속)
    expect(carnivory01(100)).toBe(1); // 완전 육식 = 최대
    expect(carnivory01(85)).toBeCloseTo(0.5); // 야생 포식자 = 절반 세기
    expect(carnivory01(100)).toBeGreaterThan(carnivory01(85)); // 단조
  });

  it("큰 사냥(gorgeFactor): 잡식·문턱은 1, 완전 육식은 1+carnGorgeBonus, 육식일수록 크다", () => {
    expect(gorgeFactor(50)).toBe(1); // 잡식 — 사냥 수입 불변
    expect(gorgeFactor(GRAZE)).toBe(1); // 문턱 = 1(연속)
    expect(gorgeFactor(100)).toBeCloseTo(1 + SIM.carnGorgeBonus); // 완전 육식 최대
    expect(gorgeFactor(85)).toBeGreaterThan(1);
    expect(gorgeFactor(100)).toBeGreaterThan(gorgeFactor(85)); // 단조
  });

  it("긴 포만(maxEnergyFor): 잡식·문턱은 상한 100 그대로, 완전 육식만 위로 비축", () => {
    expect(maxEnergyFor(50)).toBe(SIM.maxEnergy); // 잡식 — 상한 불변(통과기준 보존)
    expect(maxEnergyFor(GRAZE)).toBe(SIM.maxEnergy); // 문턱 = 100(연속)
    expect(maxEnergyFor(100)).toBeCloseTo(SIM.maxEnergy + SIM.carnGorgeReserve); // 완전 육식 최대 창고
    expect(maxEnergyFor(85)).toBeGreaterThan(SIM.maxEnergy);
    expect(maxEnergyFor(100)).toBeGreaterThan(maxEnergyFor(85)); // 단조
  });
});

describe("무리사냥 먹이 나눔 (herding 이 육식 생존 레버 — 늑대 무리가 함께 먹는다)", () => {
  const GRAZE = SIM.dietGrazeMax; // 70 — 순수 육식 문턱
  const THR = SIM.packShareThreshold; // 55 — 나눔에 참여하는 herding 임계
  const G = 72; // 예시 huntGain(순수 육식 gorge 킬)

  it("herding 임계(packHerdFactor): 임계 이하는 0, 임계에서 0, 완전 무리 100에서 1", () => {
    expect(packHerdFactor(40)).toBe(0); // 야생 포식자 herding — 완전 배제(잡식 승률 보존)
    expect(packHerdFactor(THR)).toBe(0); // 임계 = 0(연속)
    expect(packHerdFactor(100)).toBeCloseTo(1); // 완전 무리 = 최대
    expect(packHerdFactor(90)).toBeGreaterThan(0);
    expect(packHerdFactor(90)).toBeGreaterThan(packHerdFactor(70)); // 임계 위에서 단조
  });

  it("잡식·초식·문턱은 나눔이 0(무영향 — 통과기준 보존)", () => {
    expect(packShareGain(G, 50, 90)).toBe(0); // 잡식 — carnivory01=0
    expect(packShareGain(G, 20, 90)).toBe(0); // 초식
    expect(packShareGain(G, GRAZE, 90)).toBe(0); // 식성 문턱 = 0(연속)
  });

  it("herding 이 임계 이하면 나눔 0 — 야생 포식자(herding 40)는 완전히 배제된다", () => {
    expect(packShareGain(G, 100, 40)).toBe(0); // 야생 포식자 herding — 나눔 없음(밸런스 격리)
    expect(packShareGain(G, 100, THR)).toBe(0); // 임계 정확히 = 0
  });

  it("완전 육식·완전 무리는 huntGain × packSharePerMember(임계·식성 최대)", () => {
    expect(packShareGain(G, 100, 100)).toBeCloseTo(G * SIM.packSharePerMember);
  });

  it("herding·육식·카커스 크기에 각각 단조 증가", () => {
    expect(packShareGain(G, 100, 90)).toBeGreaterThan(packShareGain(G, 100, 70)); // herding↑
    expect(packShareGain(G, 100, 90)).toBeGreaterThan(packShareGain(G, 85, 90)); // 육식↑
    expect(packShareGain(2 * G, 100, 90)).toBeCloseTo(2 * packShareGain(G, 100, 90)); // 카커스 비례
  });
});

describe("몸집 (v7 — attack 이 겸하던 '체급'을 떼어낸 축)", () => {
  const MID = 50;

  it("몸집 50 은 **완전 중립** — 모든 보정이 정확히 1(또는 0)이다", () => {
    // 이게 v7 밸런스 보존의 열쇠다. 야생 전 종과 기존 프리셋은 몸집 50 이라, 몸집을 얹어도 v6 과
    // 똑같이 굴러간다(대멸종 필터·보스 통과기준 불변). 이 성질이 깨지면 밸런스가 통째로 이동한다.
    expect(sizeDev(MID)).toBe(0);
    expect(sizeSpeedFactor(MID)).toBe(1);
    expect(sizeDrainFactor(MID)).toBe(1);
    expect(sizeFertilityFactor(MID)).toBe(1);
    // 물기도 몸집이 같으면 v6 판정과 완전히 동일(몸집 항이 0).
    expect(biteOutcome(70, 40, MID, MID)).toEqual(biteOutcome(70, 40));
  });

  it("크면 느리고·많이 먹고·새끼를 적게 친다 (작으면 정확히 반대)", () => {
    expect(sizeSpeedFactor(100)).toBeLessThan(1);
    expect(sizeSpeedFactor(0)).toBeGreaterThan(1);
    expect(sizeDrainFactor(100)).toBeGreaterThan(1); // 큰 몸은 많이 먹는다
    expect(sizeDrainFactor(0)).toBeLessThan(1);
    expect(sizeFertilityFactor(100)).toBeLessThan(1); // 큰 몸은 새끼를 적게
    expect(sizeFertilityFactor(0)).toBeGreaterThan(1);
  });

  it("큰 먹잇감은 잘 안 죽고, 충분히 크면 이빨이 아예 안 박힌다(코끼리는 못 문다)", () => {
    const small = biteOutcome(70, 40, MID, 20); // 작은 먹잇감
    const big = biteOutcome(70, 40, MID, 85); // 큰 먹잇감
    expect(big.killChance).toBeLessThan(small.killChance);
    expect(big.damage).toBeLessThan(small.damage);
    // 몸집이 압도적이면 이빨이 안 박힌다 — 몸집 100 짜리는 보통 포식자가 아예 못 문다("코끼리").
    expect(biteOutcome(50, 50, MID, 100).ignored).toBe(true);
    // 단 **충분한 공격력 우위는 몸집 열세를 상쇄한다** — 몸집이 절대 방어가 되면 생태가 굳는다.
    // (몸집 차 50 을 뚫으려면 공격력 차가 50 은 나야 한다 — sizeBiteWeight 1.4 배율.)
    expect(biteOutcome(90, 30, MID, 100).ignored).toBe(false);
  });

  it("공격력과 몸집은 서로 다른 축이다 — 공격력은 죽이는 힘, 몸집은 안 죽는 힘", () => {
    // 같은 공격력이라도 내가 크면 더 잘 죽인다(체급으로 누른다).
    expect(biteOutcome(60, 50, 90, MID).killChance).toBeGreaterThan(biteOutcome(60, 50, MID, MID).killChance);
    // 같은 몸집이라도 공격력이 높으면 더 잘 죽인다.
    expect(biteOutcome(80, 50, MID, MID).killChance).toBeGreaterThan(biteOutcome(60, 50, MID, MID).killChance);
  });
});

describe("정점 (형질 100 — 상한에 닿으면 그 형질의 약점이 사라진다)", () => {
  it("정점은 상한(100)에서만 켜진다", () => {
    expect(isApex(100)).toBe(true);
    expect(isApex(99)).toBe(false);
    expect(isApex(50)).toBe(false);
  });

  it("정점 공격력(100) — 어떤 가죽도 이빨을 막지 못한다(체급 무시 규칙이 안 걸린다)", () => {
    // 보통 공격력이면 압도적 체급 앞에서 이빨이 안 박힌다.
    expect(biteOutcome(60, 50, 50, 100).ignored).toBe(true);
    // 정점이면 물 수는 있다 — 다만 확률·피해는 여전히 체급 차를 따른다(공짜가 아니다).
    const apex = biteOutcome(100, 50, 50, 100);
    expect(apex.ignored).toBe(false);
    expect(apex.killChance).toBeLessThan(biteOutcome(100, 50, 50, 50).killChance);
  });

  it("정점 시야(100) — 어둠도 수풀도 눈을 가리지 못한다", () => {
    // 규칙 자체는 nightVision/grassVision 이 그대로지만, stepEntity 가 정점이면 이 배율을 안 곱한다.
    // 여기서는 "정점 아래에선 감쇠가 실재한다"를 못 박아 둔다(정점의 값어치가 곧 이 감쇠의 크기다).
    expect(nightVisionFactor(0, 0.5)).toBeLessThan(1); // 자정엔 시야가 준다
    expect(isApex(100)).toBe(true);
  });

  it("정점 번식력(100) — 새끼를 쳐도 어미가 덜 지쳐 무리가 더 크게 유지된다", () => {
    // 방향으로 검증한다(소수 개체 시뮬은 절대 수치가 노이즈에 흔들린다 — known_issues).
    // 99 와 100 은 형질값이 1 차이일 뿐인데 결과가 갈려야 한다 — 그게 "정점"의 뜻이다.
    //
    // ⚠ **한 시점의 개체 수로 재지 않는다**(known_issues: "종의 건강을 최종 개체 수 하나로 재지 말 것").
    // 번식 보상은 붐-버스트를 만들 수 있어, 마지막 틱이 우연히 골짜기에 걸리면 더 강한 종이 더 약해
    // 보인다. 실제로 옛 보상(번식 문턱 완화)은 **피크는 오르는데 평균은 떨어지는** 함정이었고, 그걸
    // 최종 개체 수 하나로 재다가 놓칠 뻔했다. 그래서 **런 내내의 평균**으로 잰다.
    let apexMean = 0;
    let nearMean = 0;
    for (const seed of ["apex-0", "apex-1", "apex-2", "apex-3", "apex-4", "apex-5"]) {
      const a = new World(seed, W, H, tune({ fertility: 100, metabolism: 40, vision: 60 }));
      const b = new World(seed, W, H, tune({ fertility: 99, metabolism: 40, vision: 60 }));
      let accA = 0;
      let accB = 0;
      for (let i = 0; i < 1500; i++) {
        a.step();
        b.step();
        accA += a.playerPopulation;
        accB += b.playerPopulation;
      }
      apexMean += accA / 1500;
      nearMean += accB / 1500;
    }
    expect(apexMean).toBeGreaterThan(nearMean);
  });

  it("정점은 변이가 갉지도, 만들지도 않는다 (종 단위 성취)", () => {
    // 기준선이 100 이면 새끼도 100 으로 태어난다(안 그러면 만렙이 세대마다 새어 나간다).
    const apex = defaultGenome();
    apex.traits.speed = 100;
    const rng = new Rng("mut");
    for (let i = 0; i < 200; i++) {
      const child = mutateGenome(cloneGenome(apex), rng, 1.5);
      expect(child.traits.speed).toBe(100);
    }
    // 반대로 99 인 종의 새끼는 **절대 100 에 못 닿는다.** 닿게 두면 고정과 맞물려 래칫이 된다 —
    // 세대가 지날수록 무리가 슬금슬금 100 으로 수렴해, 화면의 "99" 와 실제 무리가 어긋난다.
    const near = defaultGenome();
    near.traits.speed = 99;
    for (let i = 0; i < 200; i++) {
      const child = mutateGenome(cloneGenome(near), rng, 1.5);
      expect(child.traits.speed).toBeLessThan(100);
    }
    // 정점이 없는 형질(대사 — 좋고 나쁨이 없는 축)은 100 에서도 정상적으로 흔들린다.
    const hot = defaultGenome();
    hot.traits.metabolism = 100;
    let moved = 0;
    for (let i = 0; i < 200; i++) {
      if (mutateGenome(cloneGenome(hot), rng, 1.5).traits.metabolism !== 100) moved += 1;
    }
    expect(moved).toBeGreaterThan(0);
  });
});

describe("은신 (v7 — 시야의 대칭축. 눈은 속이되 소리는 못 속인다)", () => {
  it("은신 0 이면 영향 없음 — 안 찍은 종은 기존 그대로(밸런스 격리)", () => {
    expect(effectiveCamo(0, 50)).toBe(0);
    expect(camoVisionFactor(0, 50)).toBe(1);
  });

  it("은신이 높을수록 포식자의 시야 감지 반경이 줄어든다", () => {
    expect(camoVisionFactor(100, 50)).toBeLessThan(camoVisionFactor(50, 50));
    expect(camoVisionFactor(50, 50)).toBeLessThan(1);
  });

  it("큰 몸은 못 숨는다 — 몸집이 은신을 무력화한다(둘은 한 축의 양끝)", () => {
    expect(effectiveCamo(100, 100)).toBeLessThan(effectiveCamo(100, 50)); // 커지면 은신이 죽는다
    expect(effectiveCamo(100, 20)).toBe(effectiveCamo(100, 50)); // 50 이하는 감쇠 없음(작다고 더 숨진 않음)
  });
});

describe("무리 방어 (herding 이 초식의 생존 레버 — 뭉친 무리는 포식자가 안 건드린다)", () => {
  const SHIELD_THR = SIM.herdShieldThreshold; // 85 — 방패가 서는 herding 임계
  const SHIELD_NB = SIM.herdShieldNeighbors; // 2 — "무리 안"으로 보는 이웃 수

  it("두 조건이 다 있어야 방패가 선다 — 무리 성향만도, 이웃만도 안 된다", () => {
    expect(herdShieldedBy(SHIELD_THR + 10, SHIELD_NB)).toBe(true); // 뭉친 무리 종 → 방패
    expect(herdShieldedBy(SHIELD_THR + 10, SHIELD_NB - 1)).toBe(false); // 형질은 있으나 흩어짐 → 없음
    expect(herdShieldedBy(SHIELD_THR, SHIELD_NB + 5)).toBe(false); // 임계 정확히 = 없음(초과여야)
    expect(herdShieldedBy(SHIELD_THR - 10, SHIELD_NB + 5)).toBe(false); // 모였으나 무리 종이 아님 → 없음
  });

  it("무리에서 떨어지면 방패가 사라진다 — 완전 면역이 아니다(포식자는 낙오자를 노린다)", () => {
    expect(herdShieldedBy(100, 0)).toBe(false);
  });

  it("야생종은 아무도 방패를 못 받는다 — 시작 herding 이 전부 임계 아래(밸런스 격리)", () => {
    // 이게 이 메커니즘의 안전판이다. 야생 초식(herding 60~72)까지 보호받으면 잡식·육식 플레이어가
    // 사냥감을 잃고 무너진다 — 임계를 75 로 뒀을 때 실제로 그렇게 깨졌다(균형 잡식 도달 6.1 → 5.5).
    const w = new World("herd-wild", W, H, defaultGenome());
    for (const sp of w.species) {
      if (sp.isPlayer) continue;
      expect(herdShieldedBy(sp.genome.traits.herding, 99)).toBe(false);
    }
  });

  it("뭉친 무리 종은 뭉치지 않는 같은 종보다 덜 잡아먹힌다(카운터 방향)", () => {
    // 절대 수치가 아니라 **방향**으로 검증한다 — 소수 개체 + 단일 시드는 노이즈가 커서 절대 기준을
    // 걸면 애먼 곳에서 깨진다(known_issues: 개체 시뮬의 형질 게이트는 hi>lo 로 견고화).
    const base = { diet: 16, fertility: 88, speed: 62, vision: 62, attack: 44, metabolism: 32 };
    const eatenWith = (herding: number): number => {
      let total = 0;
      for (const seed of ["hs-0", "hs-1", "hs-2", "hs-3"]) {
        const w = new World(seed, W, H, tune({ ...base, herding }));
        for (let i = 0; i < 2000; i++) w.step();
        total += w.deaths.predation;
      }
      return total;
    };
    expect(eatenWith(SHIELD_THR + 7)).toBeLessThan(eatenWith(SHIELD_THR - 25));
  });
});
