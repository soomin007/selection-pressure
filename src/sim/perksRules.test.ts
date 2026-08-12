// 3단·4단 고유 카드 스물의 sim 계약 테스트 (2026-08-11).
//
// 카드의 gain/cost 문구가 약속한 것이 sim 에서 실제로 일어나는지를 **세계를 굴려서** 잰다.
// perks.test.ts 가 「이름·문구·상수의 일치」를 지킨다면, 이 파일은 「그 상수가 세계를 실제로
// 그렇게 움직이는가」를 지킨다. 카드마다 「특성이 없으면 옛날과 같다」 대조를 함께 둔다.
//
// 결정론 규율: Math.random 을 한 번도 안 쓴다. 무작위가 필요한 검증(즉사 굴림 등)은
// 시드를 골라 고정했다 · 그런 자리에는 「시드 고정」 주석을 달았다.
// 되도록 굴림 자체가 없는 배치(방어 66 → 즉사 확률이 정확히 0)로 결정론을 만든다.

import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { SIM } from "@/sim/params";
import { TILE } from "@/sim/terrain";
import { genomeFromTraits, type Genome, type Traits } from "@/sim/genome";
import { createEntity, type Entity } from "@/sim/entity";
import type { Species } from "@/sim/species";
import { visionRadius } from "@/sim/behavior";
import { CARRION_FROM_DEATH } from "@/sim/carrion";
import {
  BLOODGIFT_GIVE,
  BLOODGIFT_LOSS_MUL,
  CULL_THRESHOLD,
  FAMISHED_RANGE_MUL,
  FEVER_KEEP,
  GREENWAKE_GAIN,
  GREENWAKE_REGROW,
  HAMSTRING_SLOW,
  HAMSTRING_TICKS,
  MOUNTAIN_CAP,
  NEWFLESH_SHARE,
  PANGOLIN_CD_MUL,
  RATEL_FLEE_MUL,
  RATEL_REFLECT,
  SALMON_MIN_ENERGY,
  SALMON_SHARE,
  SHEDTAIL_EAT_CD_MUL,
  SHEDTAIL_ENERGY,
  TRANSFIX_FREEZE_TICKS,
  TRANSFIX_SELF_TICKS,
  UNDYING_ENERGY,
  ZEBRA_FLEE_MUL,
  nearShore,
  tryRevive,
  type PerkName,
} from "@/sim/perks";

const W = 540;
const H = 960;

// ─────────────────────────────── 공용 도우미 ───────────────────────────────

/** 능치 일부만 정한 게놈 · 야생과 같은 길(genomeFromTraits)로 만든다(world.test.ts 의 tune 과 같다). */
function tune(partial: Partial<Traits>): Genome {
  return genomeFromTraits(partial);
}

/** 능치 + 고유 카드(들)를 가진 게놈. 카드 id 와 규칙 이름이 같다(perks.ts RULE_CARD_DEFS). */
function perkGenome(partial: Partial<Traits>, perks: readonly PerkName[]): Genome {
  const g = genomeFromTraits(partial);
  g.perks.push(...perks);
  return g;
}

/** 야생 종 하나(world.test.ts 의 커스텀 종 리터럴과 같은 모양). */
function wildSpecies(id: number, genome: Genome, name = "실험 야생"): Species {
  return {
    id,
    name,
    genome,
    isPlayer: false,
    color: 0xffffff,
    initialCount: 1,
    foodKinds: [0],
    friendly: false,
    faction: 0,
  };
}

/** 내 종 개체 하나를 꺼낸다(없으면 그 자리에서 터뜨린다). */
function playerEnt(w: World): Entity {
  const e = w.entities.find((x) => x.species.isPlayer);
  if (e === undefined) throw new Error("내 종 개체가 없다");
  return e;
}

/** 위치를 강제로 옮긴다(렌더 보간용 prev 도 같이). */
function pin(e: Entity, x: number, y: number): void {
  e.x = x;
  e.y = y;
  e.prevX = x;
  e.prevY = y;
}

/**
 * 순수 육지(land) 타일만 반경 radius 타일로 깔린 빈터의 중심 좌표.
 * 수풀·험지·물가를 피해야 시야 감쇠 · 물가 특성(riverjaw)이 실험에 안 섞인다.
 */
function openLand(w: World, radius: number, avoidShore: boolean): { x: number; y: number } {
  const t = w.terrain;
  const cs = t.cellSize;
  // 1차: 순수 land 만. 2차: 걸을 수 있는 육지(수풀·험지 포함)까지 허용 · 순수 land 뭉치가
  // 이 맵에 없을 수 있어서다. 실험 대부분은 물·산만 아니면 된다(자리 의존 검증은 각 테스트가
  // visionRadius 등 실제 값을 그 자리에서 다시 재므로 수풀이 끼어도 계약이 안 흔들린다).
  for (const strict of [true, false]) {
    for (let cy = radius; cy < t.rows - radius; cy++) {
      for (let cx = radius; cx < t.cols - radius; cx++) {
        let ok = true;
        for (let dy = -radius; dy <= radius && ok; dy++) {
          for (let dx = -radius; dx <= radius && ok; dx++) {
            const x = (cx + dx + 0.5) * cs;
            const y = (cy + dy + 0.5) * cs;
            const k = t.kindAt(x, y);
            const landish = strict ? k === TILE.land : k === TILE.land || k === TILE.grass || k === TILE.rough;
            if (!landish) ok = false;
            else if (avoidShore && nearShore(w, x, y)) ok = false;
          }
        }
        if (ok) return { x: (cx + 0.5) * cs, y: (cy + 0.5) * cs };
      }
    }
  }
  throw new Error("빈터(육지)를 못 찾았다 · 시드를 바꿔라");
}

/** 물가(nearShore 참)인 육지 타일 하나. 물가의 매복자 실험용. */
function shoreLand(w: World): { x: number; y: number } {
  const t = w.terrain;
  const cs = t.cellSize;
  for (let cy = 1; cy < t.rows - 1; cy++) {
    for (let cx = 1; cx < t.cols - 1; cx++) {
      const x = (cx + 0.5) * cs;
      const y = (cy + 0.5) * cs;
      if (t.kindAt(x, y) !== TILE.land) continue;
      if (nearShore(w, x, y)) return { x, y };
    }
  }
  throw new Error("물가 육지를 못 찾았다 · 시드를 바꿔라");
}

/** 세계의 모든 풀 먹이를 끈다(실험에 채집 수입이 안 섞이게). */
function disableFood(w: World): void {
  for (const f of w.food) {
    f.available = false;
    f.regrowTimer = 10 ** 9;
  }
}

/**
 * 「내 종 포식자 vs 야생 먹잇감」 결투장. 내 종 게놈(perks 포함)이 무는 쪽이다.
 * 먹잇감 기본 능치(attack 66 → 야생 규칙상 defense 66)는 즉사 확률을 정확히 0 으로 만들어
 * 굴림 없는 결정론 실험을 가능하게 한다(0.08 + (50-66)/100 × 0.5 ≤ 0 → clamp 0).
 */
function makeHunt(
  seed: string,
  predGenome: Genome,
  preyTraits: Partial<Traits>,
  dist: number,
  ground: "open" | "shore" = "open",
): { w: World; pred: Entity; prey: Entity; spot: { x: number; y: number } } {
  const w = new World(seed, W, H, predGenome);
  const spot = ground === "shore" ? shoreLand(w) : openLand(w, 3, true);
  const pred = playerEnt(w);
  const prey = createEntity(9990, spot.x + dist, spot.y, wildSpecies(990, tune(preyTraits)), 70);
  pin(pred, spot.x, spot.y);
  w.entities = [pred, prey]; // 무는 쪽이 먼저 step 한다(사건 격리 · 순서 고정)
  return { w, pred, prey, spot };
}

/** 「야생 포식자 vs 내 종 먹잇감」 결투장. 내 종 게놈(perks 포함)이 물리는 쪽이다. */
function makeDefend(
  seed: string,
  preyGenome: Genome,
  predTraits: Partial<Traits>,
  dist = 4,
): { w: World; pred: Entity; prey: Entity; spot: { x: number; y: number } } {
  const w = new World(seed, W, H, preyGenome);
  const spot = openLand(w, 3, true);
  const prey = playerEnt(w);
  const pred = createEntity(9991, spot.x + dist, spot.y, wildSpecies(991, tune(predTraits)), 70);
  pin(prey, spot.x, spot.y);
  w.entities = [pred, prey];
  return { w, pred, prey, spot };
}

/**
 * 물기 한 번의 기운 변화량. 매 틱 두 개체를 제자리에 고정하고 기운을 70 으로 되돌린 뒤,
 * 먹잇감 기운이 물기만큼(감지 문턱 = 절반 물기의 절반 · 상수 유도) 떨어진 첫 틱의 변화량을
 * 돌려준다. 못 물면 null. 문턱을 상수(-5)로 박으면 biteDamage 튜닝 때 절반 물기가 문턱 아래로
 * 내려가 감지가 통째로 죽는다(2026-08-11 재발: 25→10 에서 절반 4.2 < 5 → null 다섯 건).
 * 70 인 이유: 번식 문턱(78) 아래라 번식 굴림이 안 섞이고, 배부름 문턱(80) 아래라 famished 류
 * 조건도 안 섞인다.
 */
function firstBiteDelta(
  w: World,
  attacker: Entity,
  victim: Entity,
  ax: number,
  ay: number,
  vx: number,
  vy: number,
  maxTicks = 40,
): number | null {
  for (let i = 0; i < maxTicks; i++) {
    attacker.energy = 70;
    victim.energy = 70;
    pin(attacker, ax, ay);
    pin(victim, vx, vy);
    w.step();
    if (!victim.alive) return null; // 이 계열 실험에서는 안 일어나야 한다(즉사 확률 0 배치)
    const d = victim.energy - 70;
    if (d < -FULL_BITE / 4) return d; // 절반 물기(FULL_BITE/2)도 잡되, 제자리 유지비(틱당 ≪1)는 안 잡는 값
  }
  return null;
}

/** 결정론 지문(world.test.ts 의 snapshot 과 같은 형식). */
function snapshot(world: World): string {
  const ents = world.entities.map(
    (e) => `${e.id}:${e.x.toFixed(3)},${e.y.toFixed(3)},${e.energy.toFixed(3)}`,
  );
  return `t${world.tick}|p${world.population}|${ents.join(";")}`;
}

// 기준 물기: 공격 50 이 방어 66 을 물면 즉사 0 · 피해 = biteDamage × 0.84 (완전 결정론).
const PREY66: Partial<Traits> = { diet: 10, attack: 66, speed: 1 };
const FULL_BITE = SIM.biteDamage * (1 + (50 - 66) / 100);

// ─────────────────────────────── 죽지 않는 것 (undying) ───────────────────────────────

describe("죽지 않는 것(undying) · 가죽 4단", () => {
  it("tryRevive: 한 번은 기운 절반으로 살아나고(독도 비운다) 두 번째는 없다 · 특성 없으면 없다", () => {
    const sp = wildSpecies(900, perkGenome({}, ["undying"]));
    const e = createEntity(1, 0, 0, sp, 0);
    e.poison = 33;
    expect(tryRevive(e)).toBe(true);
    expect(e.energy).toBeCloseTo(SIM.maxEnergy * UNDYING_ENERGY, 9);
    expect(e.poison).toBe(0);
    expect(e.revived).toBe(true);
    e.energy = 0;
    expect(tryRevive(e)).toBe(false); // 한 개체에 한 번뿐

    const plain = createEntity(2, 0, 0, wildSpecies(901, tune({})), 0);
    expect(tryRevive(plain)).toBe(false); // 특성 없으면 옛날과 같다
  });

  it("세계에서: 기운이 다한 개체가 한 번 살아나고, 두 번째 소진에는 죽는다", () => {
    const w = new World("rule-undying-1", W, H, perkGenome({}, ["undying"]));
    const e = playerEnt(w);
    w.entities = [e];
    disableFood(w);
    e.energy = 0.05;
    w.step();
    expect(e.alive).toBe(true);
    expect(e.revived).toBe(true);
    expect(e.energy).toBeCloseTo(SIM.maxEnergy * UNDYING_ENERGY, 9); // 죽음 판정 자리에서 정확히 절반
    e.energy = 0.05;
    w.step();
    expect(e.alive).toBe(false);
    expect(w.deaths.starve).toBe(1);
  });

  it("되살아난 몸은 새끼를 못 친다(대조: 같은 조건의 안 되살아난 개체는 낳는다)", () => {
    // 대조 세계는 시드 고정: 280틱 동안 번식 굴림이 최소 한 번은 성공하는 시드다.
    const run = (revived: boolean): number => {
      const w = new World("rule-undying-fert-1", W, H, perkGenome({ fertility: 90 }, ["undying"]));
      const e = playerEnt(w);
      w.entities = [e];
      disableFood(w);
      e.revived = revived;
      for (let i = 0; i < 280; i++) {
        e.energy = 100; // 번식 문턱(78) 위로 유지 · 굴림 수는 두 세계가 같다(확률 안에서만 0 이 된다)
        w.step();
      }
      return w.roundCounts.births;
    };
    expect(run(true)).toBe(0);
    expect(run(false)).toBeGreaterThan(0);
  });
});

// ─────────────────────────────── 꼬리 자르기 (shedtail) ───────────────────────────────

describe("꼬리 자르기(shedtail) · 다리 4단", () => {
  it("잡아먹히기 직전 한 번은 꼬리로 빠져나온다 · 기운 4분의 1, 공격자는 멈추고 표적을 놓친다", () => {
    const { w, pred, prey, spot } = makeDefend(
      "rule-shed-1",
      perkGenome({ ...PREY66 }, ["shedtail"]),
      { diet: 90, attack: 50, speed: 1 },
    );
    // 먹잇감 기운을 5 로 눌러 두면 첫 물기(피해 21)가 곧장 잡아먹기(devour)로 이어진다 · 즉사 굴림 무관.
    let ticks = 0;
    for (; ticks < 30 && !prey.tailUsed; ticks++) {
      pred.energy = 70;
      prey.energy = 5;
      pin(pred, spot.x + 4, spot.y);
      pin(prey, spot.x, spot.y);
      w.step();
    }
    expect(prey.tailUsed).toBe(true);
    expect(prey.alive).toBe(true);
    // devour 가로채기에서 정확히 4분의 1 로 세워진 뒤, 같은 틱 자기 step 의 소모만 빠진다.
    expect(prey.energy).toBeGreaterThan(SIM.maxEnergy * SHEDTAIL_ENERGY - 1);
    expect(prey.energy).toBeLessThanOrEqual(SIM.maxEnergy * SHEDTAIL_ENERGY);
    expect(prey.woundTicks).toBeGreaterThan(0);
    expect(pred.attackCd).toBe(SIM.attackCooldownTicks * SHEDTAIL_EAT_CD_MUL); // 꼬리를 먹느라 멈춘다
    expect(pred.targetPrey).toBeNull(); // 그리고 표적을 놓친다

    // 두 번째 devour 에서는 죽는다(한 개체에 한 번뿐).
    for (let i = 0; i < 80 && prey.alive; i++) {
      pred.energy = 70;
      prey.energy = 5;
      pin(pred, spot.x + 4, spot.y);
      pin(prey, spot.x, spot.y);
      w.step();
    }
    expect(prey.alive).toBe(false);
    expect(w.deaths.predation).toBe(1);
  });

  it("대조: 특성이 없으면 첫 devour 에서 그대로 죽는다", () => {
    const { w, pred, prey, spot } = makeDefend("rule-shed-1", perkGenome({ ...PREY66 }, []), {
      diet: 90,
      attack: 50,
      speed: 1,
    });
    for (let i = 0; i < 30 && prey.alive; i++) {
      pred.energy = 70;
      prey.energy = 5;
      pin(pred, spot.x + 4, spot.y);
      pin(prey, spot.x, spot.y);
      w.step();
    }
    expect(prey.alive).toBe(false);
    expect(prey.tailUsed).toBe(false);
    expect(w.deaths.predation).toBe(1);
  });
});

// ─────────────────────────────── 산 같은 몸 (mountain) ───────────────────────────────

describe("산 같은 몸(mountain) · 가죽 4단", () => {
  it("물기 피해가 상한(최대 기운의 4분의 1)으로 잘리고 즉사 굴림에 안 죽는다 · 대조는 죽는다", () => {
    // 공격 90(몸집 100) vs 방어 0(몸집 20): diff01 = 0.9 + 1.4×0.8 = 2.02 → 피해 10×3.02 ≈ 30
    // (상한 25 초과) · 즉사 확률 0.03 + 2.02×0.3 ≈ 0.64 · 대조 먹잇감은 굴림에 곧 죽는다.
    // ⚠ 2026-08-11 TTK 재조정(biteDamage 25→10)으로 공격·몸집 차를 다 얹어야 상한(25)을 넘는
    //   피해가 나온다 — 이 시나리오는 「상한이 실제로 자른다」를 보이는 극단 대결이다.
    const run = (perks: readonly PerkName[]): { alive: boolean; minDelta: number } => {
      const { w, pred, prey, spot } = makeDefend(
        "rule-mtn-1",
        perkGenome({ diet: 10, speed: 1, size: 20, defense: 0 }, perks),
        { diet: 90, attack: 90, speed: 1, size: 100 },
      );
      let minDelta = 0;
      for (let i = 0; i < 250 && prey.alive; i++) {
        pred.energy = 70;
        prey.energy = 70;
        pin(pred, spot.x + 4, spot.y);
        pin(prey, spot.x, spot.y);
        w.step();
        if (prey.alive) minDelta = Math.min(minDelta, prey.energy - 70);
      }
      return { alive: prey.alive, minDelta };
    };
    const cap = SIM.maxEnergy * MOUNTAIN_CAP; // 25 (먹잇감은 초식 · 비축 상한 없음)
    const shielded = run(["mountain"]);
    expect(shielded.alive).toBe(true); // 즉사 굴림 무효 + 상한 피해라 결코 못 잡는다
    expect(shielded.minDelta).toBeLessThan(-cap + 3); // 물리긴 물렸다
    expect(shielded.minDelta).toBeGreaterThanOrEqual(-cap - 2); // 어떤 물기도 상한을 못 넘는다

    const plain = run([]);
    expect(plain.alive).toBe(false); // 특성 없으면 옛날처럼 즉사 굴림에 잡힌다
    expect(plain.minDelta).toBeLessThan(-cap - 4); // 그리고 피해도 상한 없이(약 -30) 박혔었다
  });
});

// ─────────────────────────────── 숨통을 보는 눈 (cull) ───────────────────────────────

describe("숨통을 보는 눈(cull) · 눈 4단", () => {
  it("기운이 문턱 아래인 상대는 한 입에 죽는다(대조: 같은 배치에서 못 잡는다)", () => {
    // 먹잇감 기운 24 는 문턱(25) 바로 아래이면서 기본 물기 피해(FULL_BITE)보다는 커서,
    // 「한 입」이 처형(killChance 1) 때문임을 대가리부터 발끝까지 결정론으로 가른다.
    expect(24).toBeLessThan(SIM.maxEnergy * CULL_THRESHOLD);
    expect(24).toBeGreaterThan(FULL_BITE);

    const cull = makeHunt("rule-cull-1", perkGenome({ diet: 90, attack: 50, speed: 1 }, ["cull"]), PREY66, 4);
    for (let i = 0; i < 5 && cull.prey.alive; i++) {
      cull.pred.energy = 40; // 배부름(80) 아래 · 사냥 자격 유지
      cull.prey.energy = 24;
      pin(cull.pred, cull.spot.x, cull.spot.y);
      pin(cull.prey, cull.spot.x + 4, cull.spot.y);
      cull.w.step();
    }
    expect(cull.prey.alive).toBe(false); // 처형은 굴림이 chance(1) 이라 결정론이다
    expect(cull.w.roundCounts.hunts).toBe(1);

    const plain = makeHunt("rule-cull-1", perkGenome({ diet: 90, attack: 50, speed: 1 }, []), PREY66, 4);
    for (let i = 0; i < 30; i++) {
      plain.pred.energy = 40;
      plain.prey.energy = 24;
      pin(plain.pred, plain.spot.x, plain.spot.y);
      pin(plain.prey, plain.spot.x + 4, plain.spot.y);
      plain.w.step();
    }
    expect(plain.prey.alive).toBe(true); // 즉사 0 · 피해 21 < 24 라 영영 못 잡는다
  });

  it("문턱 위 상대에게는 무는 피해가 절반이다", () => {
    const cull = makeHunt("rule-cull-2", perkGenome({ diet: 90, attack: 50, speed: 1 }, ["cull"]), PREY66, 4);
    const dCull = firstBiteDelta(cull.w, cull.pred, cull.prey, cull.spot.x, cull.spot.y, cull.spot.x + 4, cull.spot.y);
    const plain = makeHunt("rule-cull-2", perkGenome({ diet: 90, attack: 50, speed: 1 }, []), PREY66, 4);
    const dPlain = firstBiteDelta(plain.w, plain.pred, plain.prey, plain.spot.x, plain.spot.y, plain.spot.x + 4, plain.spot.y);
    expect(dPlain).not.toBeNull();
    expect(dCull).not.toBeNull();
    expect(dPlain as number).toBeLessThan(-FULL_BITE + 1.5); // 온전한 물기 ≈ -21
    expect(dCull as number).toBeGreaterThan(-FULL_BITE / 2 - 1.5); // 절반 물기 ≈ -10.5
    expect(dCull as number).toBeLessThan(-FULL_BITE / 2 + 1.5);
  });

  it("표적 고르기: 가장 가까운 놈이 아니라 다 죽어 가는 놈을 고른다", () => {
    const make = (perks: readonly PerkName[]): { near: Entity; far: Entity; pred: Entity; w: World } => {
      const w = new World("rule-cull-3", W, H, perkGenome({ diet: 90, attack: 50, speed: 1 }, perks));
      const spot = openLand(w, 3, true);
      const pred = playerEnt(w);
      const sp = wildSpecies(992, tune(PREY66));
      const near = createEntity(9992, spot.x + 25, spot.y, sp, 70); // 성한 놈 · 더 가깝다
      const far = createEntity(9993, spot.x + 60, spot.y, sp, 10); // 다 죽어 가는 놈(문턱 아래)
      pin(pred, spot.x, spot.y);
      w.entities = [pred, near, far];
      w.step();
      return { near, far, pred, w };
    };
    const withCull = make(["cull"]);
    expect(withCull.pred.targetPrey).toBe(withCull.far);
    const noCull = make([]);
    expect(noCull.pred.targetPrey).toBe(noCull.near);
  });

  it("산 같은 몸 대 숨통을 보는 눈: 방패가 창을 이긴다(처형 굴림이 무효가 된다)", () => {
    // 여기서만 야생에게 카드를 쥐여 준다(테스트 전용 장치) · 창(cull)과 방패(mountain)를 서로 다른
    // 개체가 들어야 하는데 카드는 원래 내 종 게놈 하나뿐이라서다. sim 은 genome.perks 만 본다.
    const run = (preyPerks: readonly PerkName[]): boolean => {
      const w = new World("rule-mtn-cull-1", W, H, perkGenome({ diet: 10, speed: 1, defense: 66 }, preyPerks));
      const spot = openLand(w, 3, true);
      const prey = playerEnt(w);
      const pred = createEntity(9994, spot.x + 4, spot.y, wildSpecies(993, perkGenome({ diet: 90, attack: 50, speed: 1 }, ["cull"])), 70);
      w.entities = [pred, prey];
      for (let i = 0; i < 60 && prey.alive; i++) {
        pred.energy = 40;
        prey.energy = 24; // 처형 문턱(25) 아래 · 피해 21 로는 안 죽는 기운
        pin(pred, spot.x + 4, spot.y);
        pin(prey, spot.x, spot.y);
        w.step();
      }
      return prey.alive;
    };
    expect(run(["mountain"])).toBe(true); // killChance 1 을 mountain 이 0 으로 되돌린다
    expect(run([])).toBe(false); // 방패가 없으면 처형된다(chance(1) · 결정론)
  });
});

// ─────────────────────────────── 물가의 매복자 (riverjaw) ───────────────────────────────

describe("물가의 매복자(riverjaw) · 이빨 3단", () => {
  it("물가에서는 단숨에 끝낸다(대조: 특성 없으면 같은 자리에서 영영 못 잡는다)", () => {
    // 시드 고정: 물가 육지가 존재하고, 150틱(물기 약 15번) 안에 0.9 굴림이 성공하는 시드다.
    const run = (perks: readonly PerkName[]): boolean => {
      const { w, pred, prey, spot } = makeHunt(
        "rule-river-1",
        perkGenome({ diet: 90, attack: 50, speed: 1 }, perks),
        PREY66,
        4,
        "shore",
      );
      expect(nearShore(w, spot.x, spot.y)).toBe(true); // 전제: 무는 자리가 물가다
      for (let i = 0; i < 150 && prey.alive; i++) {
        pred.energy = 40;
        prey.energy = 70; // 매 틱 채워 피해 누적로는 안 죽는다 · 죽음은 오직 즉사 굴림
        pin(pred, spot.x, spot.y);
        pin(prey, spot.x + 4, spot.y);
        w.step();
      }
      return !prey.alive;
    };
    expect(run(["riverjaw"])).toBe(true); // killChance 가 0.9 로 선다
    expect(run([])).toBe(false); // 기본 killChance 는 이 배치에서 정확히 0
  });

  it("물가 밖에서는 무는 피해가 절반이다", () => {
    const jaw = makeHunt("rule-river-2", perkGenome({ diet: 90, attack: 50, speed: 1 }, ["riverjaw"]), PREY66, 4);
    expect(nearShore(jaw.w, jaw.spot.x, jaw.spot.y)).toBe(false); // 전제: 물가가 아니다
    const dJaw = firstBiteDelta(jaw.w, jaw.pred, jaw.prey, jaw.spot.x, jaw.spot.y, jaw.spot.x + 4, jaw.spot.y);
    const plain = makeHunt("rule-river-2", perkGenome({ diet: 90, attack: 50, speed: 1 }, []), PREY66, 4);
    const dPlain = firstBiteDelta(plain.w, plain.pred, plain.prey, plain.spot.x, plain.spot.y, plain.spot.x + 4, plain.spot.y);
    expect(dPlain).not.toBeNull();
    expect(dJaw).not.toBeNull();
    expect(dPlain as number).toBeLessThan(-FULL_BITE + 1.5);
    expect(dJaw as number).toBeGreaterThan(-FULL_BITE / 2 - 1.5);
    expect(dJaw as number).toBeLessThan(-FULL_BITE / 2 + 1.5);
  });
});

// ─────────────────────────────── 힘줄을 무는 법 (hamstring) ───────────────────────────────

describe("힘줄을 무는 법(hamstring) · 다리 3단", () => {
  it("문 상대는 3초 절뚝이고, 내 무는 피해는 절반이다", () => {
    const ham = makeHunt("rule-ham-1", perkGenome({ diet: 90, attack: 50, speed: 1 }, ["hamstring"]), PREY66, 4);
    const dHam = firstBiteDelta(ham.w, ham.pred, ham.prey, ham.spot.x, ham.spot.y, ham.spot.x + 4, ham.spot.y);
    expect(dHam).not.toBeNull();
    expect(dHam as number).toBeGreaterThan(-FULL_BITE / 2 - 1.5); // 절반 물기 ≈ -10.5
    expect(dHam as number).toBeLessThan(-FULL_BITE / 2 + 1.5);
    // 물린 틱에 90 으로 서고, 물린 쪽이 그 틱 자기 step 에서 1 줄인다.
    expect(ham.prey.limpTicks).toBe(HAMSTRING_TICKS - 1);

    const plain = makeHunt("rule-ham-1", perkGenome({ diet: 90, attack: 50, speed: 1 }, []), PREY66, 4);
    const dPlain = firstBiteDelta(plain.w, plain.pred, plain.prey, plain.spot.x, plain.spot.y, plain.spot.x + 4, plain.spot.y);
    expect(dPlain).not.toBeNull();
    expect(dPlain as number).toBeLessThan(-FULL_BITE + 1.5); // 특성 없으면 온전한 물기
    expect(plain.prey.limpTicks).toBe(0);
  });

  it("절뚝이는 동안 걸음이 절반쯤 준다", () => {
    // 같은 시드의 두 세계(먹이 전부 끔 · 홀로 배회)라 rng 소비가 같고, 다리 힘만 다르다.
    const walked = (limp: boolean): number => {
      const w = new World("rule-ham-2", W, H, tune({}));
      const e = playerEnt(w);
      w.entities = [e];
      disableFood(w);
      if (limp) e.limpTicks = 10000;
      let len = 0;
      for (let i = 0; i < 150; i++) {
        e.energy = 50;
        const px = e.x;
        const py = e.y;
        w.step();
        len += Math.hypot(e.x - px, e.y - py);
      }
      return len;
    };
    const ratio = walked(true) / walked(false);
    expect(ratio).toBeGreaterThan(HAMSTRING_SLOW - 0.1);
    expect(ratio).toBeLessThan(HAMSTRING_SLOW + 0.1);
  });
});

// ─────────────────────────────── 굶주린 사냥꾼 (famished) ───────────────────────────────

describe("굶주린 사냥꾼(famished) · 이빨 3단", () => {
  it("배가 절반 아래면 물 수 있는 거리가 2배가 된다(대조: 그 거리에서는 이빨이 안 닿는다)", () => {
    const dist = 20; // 기본 사거리(12) 밖 · 2배 사거리(24) 안
    expect(dist).toBeGreaterThan(SIM.attackRange);
    expect(dist).toBeLessThan(SIM.attackRange * FAMISHED_RANGE_MUL);

    const fam = makeHunt("rule-fam-1", perkGenome({ diet: 90, attack: 50, speed: 1 }, ["famished"]), PREY66, dist);
    fam.pred.energy = 30; // 배가 절반(50) 아래
    fam.w.step();
    expect(fam.prey.woundTicks).toBeGreaterThan(0); // 첫 틱에 물었다(즉사 0 배치라 반드시 부상)

    const plain = makeHunt("rule-fam-1", perkGenome({ diet: 90, attack: 50, speed: 1 }, []), PREY66, dist);
    plain.pred.energy = 30;
    plain.w.step();
    expect(plain.prey.alive).toBe(true);
    expect(plain.prey.woundTicks).toBe(0); // 같은 자리인데 특성이 없으면 안 닿는다
  });

  it("기운이 넉넉하면 스스로 사냥을 시작하지 않는다(그 사이 기운이면 시작한다)", () => {
    const at = (energy: number, perks: readonly PerkName[]): Entity | null => {
      const { w, pred } = makeHunt("rule-fam-2", perkGenome({ diet: 90, attack: 50, speed: 1 }, perks), PREY66, 20);
      pred.energy = energy;
      w.step();
      return pred.targetPrey;
    };
    expect(at(90, ["famished"])).toBeNull(); // 배부르면(80 이상) 사냥감을 알아보지 못한다
    expect(at(60, ["famished"])).not.toBeNull(); // 그 사이 기운이면 평소처럼 노린다
    expect(at(90, [])).not.toBeNull(); // 특성 없으면 배불러도 노린다(옛날과 같다)
  });
});

// ─────────────────────────────── 썩은 고기를 먹는 위 (carrion) ───────────────────────────────

describe("썩은 고기를 먹는 위(carrion) · 이빨 4단", () => {
  it("카드를 가진 판에서만 죽음 자리에 사체가 남는다", () => {
    const run = (perks: readonly PerkName[]): World => {
      const w = new World("rule-carrion-1", W, H, perkGenome({}, perks));
      const spot = openLand(w, 3, true);
      const me = playerEnt(w);
      const victim = createEntity(9995, spot.x + 40, spot.y, wildSpecies(994, tune({ diet: 10, speed: 1 })), 0.01);
      pin(me, spot.x, spot.y);
      w.entities = [me, victim];
      disableFood(w);
      w.step(); // 야생 하나가 굶어 죽는다
      return w;
    };
    const withCard = run(["carrion"]);
    expect(withCard.carcasses.length).toBe(1);
    expect(withCard.carcasses[0]?.amount).toBe(CARRION_FROM_DEATH);
    expect(withCard.carcasses[0]?.taken).toBe(false);
    expect(run([]).carcasses.length).toBe(0); // 카드 없는 판에서는 죽어도 아무것도 안 남는다
  });

  it("보유 개체가 사체를 찾아가 먹는다(기운이 오르고 taken 이 선다)", () => {
    const w = new World("rule-carrion-2", W, H, perkGenome({}, ["carrion"]));
    const spot = openLand(w, 3, true);
    const me = playerEnt(w);
    const victim = createEntity(9995, spot.x + 40, spot.y, wildSpecies(994, tune({ diet: 10, speed: 1 })), 0.01);
    pin(me, spot.x, spot.y);
    w.entities = [me, victim];
    disableFood(w); // 채집 수입이 안 섞이게 · 이 판의 유일한 먹을거리가 사체다
    w.step();
    const c = w.carcasses[0];
    expect(c).toBeDefined();
    if (c === undefined) return;

    me.energy = 40; // 배부름(80) 아래여야 사체를 찾아 나선다
    let jumped = false;
    for (let i = 0; i < 200 && !c.taken; i++) {
      const before = me.energy;
      w.step();
      if (me.energy - before > 10) jumped = true; // 사체 한 입(20)이 들어온 틱
    }
    expect(c.taken).toBe(true);
    expect(jumped).toBe(true);
    expect(me.alive).toBe(true);
  });
});

// ─────────────────────────────── 연어의 귀향 (salmonrun) ───────────────────────────────

describe("연어의 귀향(salmonrun) · 무리 4단", () => {
  it("기운을 40 넘게 남기고(노화로) 죽으면 그 자리에서 새끼가 태어나 절반을 받는다", () => {
    const run = (perks: readonly PerkName[]): World => {
      const w = new World("rule-salmon-1", W, H, perkGenome({}, perks));
      const e = playerEnt(w);
      w.entities = [e];
      disableFood(w);
      e.energy = 60;
      expect(e.energy).toBeGreaterThan(SALMON_MIN_ENERGY);
      e.age = SIM.baseMaxAge; // 다음 틱에 노화로 죽는다
      w.step();
      return w;
    };
    const w = run(["salmonrun"]);
    expect(w.deaths.age).toBe(1);
    expect(w.playerPopulation).toBe(1); // 죽은 자리에서 새로 태어났다
    const child = playerEnt(w);
    expect(child.age).toBe(0);
    // 남긴 기운(60 에서 그 틱 소모만 빠진 값)의 절반을 받는다.
    expect(child.energy).toBeGreaterThan(60 * SALMON_SHARE - 1.5);
    expect(child.energy).toBeLessThanOrEqual(60 * SALMON_SHARE);
    expect(w.roundCounts.births).toBe(1);

    expect(run([]).playerPopulation).toBe(0); // 특성 없으면 옛날처럼 그냥 끝이다
  });

  it("잡아먹힌 죽음과 기운 40 이하의 죽음에서는 안 태어난다", () => {
    const w = new World("rule-salmon-2", W, H, perkGenome({}, ["salmonrun"]));
    const e = playerEnt(w);
    e.energy = 60;
    w.legacyDeath(e, true); // 잡아먹힘(devoured) · 카드 문구 그대로 제외
    expect(w.pendingBirths.length).toBe(0);
    e.energy = 30; // 40 이하
    w.legacyDeath(e, false);
    expect(w.pendingBirths.length).toBe(0);
    e.energy = 60;
    w.legacyDeath(e, false); // 대조: 이 둘이 아니면 태어난다
    expect(w.pendingBirths.length).toBe(1);
  });
});

// ─────────────────────────────── 열병의 흉터 (feverscar) ───────────────────────────────

describe("열병의 흉터(feverscar) · 무리 4단", () => {
  it("역병 솎임을 한 번은 앓아 넘기고(기운 3분의 1) 두 번째는 죽는다 · 대조는 첫 솎임에 죽는다", () => {
    const run = (perks: readonly PerkName[]): { scarTick: number; deathTick: number; scarEnergy: number; w: World } => {
      const w = new World("rule-fever-1", W, H, perkGenome({}, perks));
      const e = playerEnt(w);
      w.entities = [e];
      disableFood(w);
      w.plagueRate = 0.5;
      let scarTick = -1;
      let deathTick = -1;
      let scarEnergy = -1;
      for (let i = 0; i < 400 && deathTick < 0; i++) {
        e.energy = 40; // 번식 문턱 아래로 유지 · 굴림은 역병(틱당 1)과 배회뿐이라 두 세계가 같은 열을 쓴다
        w.step();
        if (scarTick < 0 && e.feverScarred) {
          scarTick = i;
          scarEnergy = e.energy;
        }
        if (!e.alive) deathTick = i;
      }
      return { scarTick, deathTick, scarEnergy, w };
    };
    const scarred = run(["feverscar"]);
    expect(scarred.scarTick).toBeGreaterThanOrEqual(0);
    // 솎임 직전 기운은 40 에서 그 틱 소모만 빠진 값 · 그 3분의 1 로 살아남는다.
    expect(scarred.scarEnergy).toBeGreaterThan(40 * FEVER_KEEP - 1);
    expect(scarred.scarEnergy).toBeLessThanOrEqual(40 * FEVER_KEEP);
    expect(scarred.deathTick).toBeGreaterThan(scarred.scarTick); // 흉터 뒤에도 얼마간 살았다
    expect(scarred.w.deaths.plague).toBe(1); // 두 번째 솎임은 못 피한다

    const plain = run([]);
    // 같은 시드 · 같은 굴림 열이라, 대조 개체는 「특성 개체가 흉터를 얻은 바로 그 틱」에 죽는다.
    expect(plain.deathTick).toBe(scarred.scarTick);
    expect(plain.w.deaths.plague).toBe(1);
  });
});

// ─────────────────────────────── 등에 그린 눈 (eyespot) ───────────────────────────────

describe("등에 그린 눈(eyespot) · 눈 3단", () => {
  it("아직 안 다친 개체의 첫 물기는 절반, 다친 뒤의 물기는 온전하다", () => {
    const { w, pred, prey, spot } = makeDefend(
      "rule-eye-1",
      perkGenome({ ...PREY66 }, ["eyespot"]),
      { diet: 90, attack: 50, speed: 1 },
    );
    const dFirst = firstBiteDelta(w, pred, prey, spot.x + 4, spot.y, spot.x, spot.y);
    expect(dFirst).not.toBeNull();
    expect(dFirst as number).toBeGreaterThan(-FULL_BITE / 2 - 1.5); // 가짜 눈이 받아낸 첫 입 ≈ -10.5
    expect(dFirst as number).toBeLessThan(-FULL_BITE / 2 + 1.5);
    expect(prey.woundTicks).toBeGreaterThan(0);
    // 다친 상태 그대로 다음 물기(woundTicks 120 ≫ 쿨타임 10)를 기다린다.
    const dSecond = firstBiteDelta(w, pred, prey, spot.x + 4, spot.y, spot.x, spot.y, 20);
    expect(dSecond).not.toBeNull();
    expect(dSecond as number).toBeLessThan(-FULL_BITE + 1.5); // 이제 온전히 박힌다 ≈ -21
  });

  it("대가: 숨어 있어도 포식자가 1.3배 멀리서 알아챈다", () => {
    // 이 대가는 「숨은 거리」를 도로 벗기는 형태로만 관측된다 · 포식자의 탐색 반경 자체가
    // 시야(senseRange)로 잘려 있어, 숨김(camouflage)이 없는 상대에게는 1.3배가 실제로는
    // 아무 일도 안 한다(구현 관찰 · 보고서에 적음). 그래서 숨기 100 을 쥔 먹잇감으로 잰다.
    const run = (perks: readonly PerkName[]): Entity | null => {
      const w = new World("rule-eye-2", W, H, perkGenome({ ...PREY66, camouflage: 100 }, perks));
      const spot = openLand(w, 4, true);
      const prey = playerEnt(w);
      const pred = createEntity(9996, spot.x, spot.y, wildSpecies(995, tune({ diet: 90, attack: 50, speed: 1 })), 70);
      const r = visionRadius(pred.genome.traits, w, spot.x, spot.y); // 이 자리의 실제 시야
      // 숨은 반경(0.6r)과 들킨 반경(0.6r × 1.3) 사이 · 특성이 있어야만 보이는 거리.
      pin(prey, spot.x + r * 0.6 * 1.15, spot.y);
      w.entities = [pred, prey];
      w.step();
      return pred.targetPrey;
    };
    expect(run(["eyespot"])).not.toBeNull(); // 무늬 때문에 들킨다
    expect(run([])).toBeNull(); // 특성 없으면 아직 숨어 있는 거리다
  });
});

// ─────────────────────────────── 천산갑의 비늘 (pangolin) ───────────────────────────────

describe("천산갑의 비늘(pangolin) · 가죽 3단", () => {
  it("나를 문 상대는 다음 물기까지 두 배로 오래 걸린다", () => {
    const run = (perks: readonly PerkName[]): number => {
      const { w, pred, prey, spot } = makeDefend("rule-pang-1", perkGenome({ ...PREY66 }, perks), {
        diet: 90,
        attack: 50,
        speed: 1,
      });
      const d = firstBiteDelta(w, pred, prey, spot.x + 4, spot.y, spot.x, spot.y);
      expect(d).not.toBeNull();
      return pred.attackCd; // 문 틱 직후의 쿨타임(무는 쪽이 먼저 step 하므로 그 틱엔 안 줄었다)
    };
    expect(run(["pangolin"])).toBe(SIM.attackCooldownTicks * PANGOLIN_CD_MUL);
    expect(run([])).toBe(SIM.attackCooldownTicks);
  });

  it("대가: 내가 무는 피해는 절반이 된다", () => {
    const pang = makeHunt("rule-pang-2", perkGenome({ diet: 90, attack: 50, speed: 1 }, ["pangolin"]), PREY66, 4);
    const dPang = firstBiteDelta(pang.w, pang.pred, pang.prey, pang.spot.x, pang.spot.y, pang.spot.x + 4, pang.spot.y);
    const plain = makeHunt("rule-pang-2", perkGenome({ diet: 90, attack: 50, speed: 1 }, []), PREY66, 4);
    const dPlain = firstBiteDelta(plain.w, plain.pred, plain.prey, plain.spot.x, plain.spot.y, plain.spot.x + 4, plain.spot.y);
    expect(dPlain).not.toBeNull();
    expect(dPang).not.toBeNull();
    expect(dPlain as number).toBeLessThan(-FULL_BITE + 1.5);
    expect(dPang as number).toBeGreaterThan(-FULL_BITE / 2 - 1.5);
    expect(dPang as number).toBeLessThan(-FULL_BITE / 2 + 1.5);
  });
});

// ─────────────────────────────── 벌꿀오소리의 맞물기 (ratel) ───────────────────────────────

describe("벌꿀오소리의 맞물기(ratel) · 이빨 4단", () => {
  it("나를 문 상대는 내 무는 피해의 절반만큼 기운을 잃는다", () => {
    // 먹잇감(내 종) 무는 힘 50 vs 문 쪽 방어 50 · 체급 동률: 반사 밑피해 = biteDamage 그대로 → 절반.
    const run = (perks: readonly PerkName[]): number => {
      const { w, pred, prey, spot } = makeDefend(
        "rule-ratel-1",
        perkGenome({ diet: 10, attack: 50, defense: 66, speed: 1 }, perks),
        { diet: 90, attack: 50, speed: 1 },
      );
      let minPredDelta = 0;
      for (let i = 0; i < 40; i++) {
        pred.energy = 70;
        prey.energy = 70;
        pin(pred, spot.x + 4, spot.y);
        pin(prey, spot.x, spot.y);
        w.step();
        minPredDelta = Math.min(minPredDelta, pred.energy - 70);
        if (prey.woundTicks > 0 && i > 2) break; // 물기 한 번이면 충분하다
      }
      return minPredDelta;
    };
    const reflected = run(["ratel"]);
    const base = SIM.biteDamage * RATEL_REFLECT; // 상수 유도 · biteDamage 를 튜닝해도 이 줄은 참말이다
    expect(reflected).toBeLessThan(-base + 0.6); // 마주 물렸다(+ 문 쪽 제 소모 약간)
    expect(reflected).toBeGreaterThan(-base - 2.5);
    expect(run([])).toBeGreaterThan(-2); // 특성 없으면 문 쪽은 제 소모 말고 잃는 게 없다
  });

  it("대가: 달아나는 동안 걸음이 30% 줄어든다", () => {
    expect(fleePathLen("rule-ratel-2", ["ratel"]) / fleePathLen("rule-ratel-2", [])).toBeGreaterThan(
      RATEL_FLEE_MUL - 0.08,
    );
    expect(fleePathLen("rule-ratel-2", ["ratel"]) / fleePathLen("rule-ratel-2", [])).toBeLessThan(
      RATEL_FLEE_MUL + 0.08,
    );
  });
});

/**
 * 도주 감속 측정 자. 몸집 100 먹잇감(이빨이 안 박혀 절대 안 죽는다 · 굴림 자체가 없다)이
 * 빠른 포식자에게 쫓기며 달린 길이를 잰다. 굴림이 0 이라 시드 무관 결정론이고,
 * 특성 유무만 다리 힘을 바꾼다. 초반 5틱(관성 램프 · fleeing 이 한 틱 늦게 서는 계약)은 뺀다.
 */
function fleePathLen(seed: string, perks: readonly PerkName[]): number {
  const w = new World(seed, W, H, perkGenome({ size: 100, defense: 50, diet: 10, speed: 50 }, perks));
  const spot = openLand(w, 3, true);
  const prey = playerEnt(w);
  const pred = createEntity(9997, spot.x + 30, spot.y, wildSpecies(996, tune({ diet: 90, attack: 60, speed: 80 })), 50);
  pin(prey, spot.x, spot.y);
  w.entities = [pred, prey];
  disableFood(w);
  let len = 0;
  for (let i = 0; i < 40; i++) {
    prey.energy = 50;
    pred.energy = 50; // 번식 문턱 아래 · 굴림 0 유지
    const px = prey.x;
    const py = prey.y;
    w.step();
    if (i >= 5) len += Math.hypot(prey.x - px, prey.y - py);
  }
  expect(prey.alive).toBe(true); // 이빨이 안 박히는 배치였는지 확인(죽으면 자가 아니라 다른 것을 쟀다)
  expect(prey.fleeing).toBe(true); // 내내 도망 중이었다
  return len;
}

// ─────────────────────────────── 얼룩말의 뒷발질 (zebrakick) ───────────────────────────────

describe("얼룩말의 뒷발질(zebrakick) · 다리 3단", () => {
  it("달아나는 동안 물리면 문 쪽도 같은 만큼 기운을 잃는다", () => {
    // 도망이 서려면 문 쪽 공격(50) ≥ 내 방어(50)여야 해서 즉사 굴림(0.08)이 생긴다.
    // 시드 고정: 도망 중의 물기(뒷발질 반사)가 즉사 성공보다 먼저 나오는 시드다.
    const run = (perks: readonly PerkName[]): number => {
      const w = new World("rule-zebra-1", W, H, perkGenome({ diet: 10, defense: 50, speed: 30 }, perks));
      const spot = openLand(w, 3, true);
      const prey = playerEnt(w);
      const pred = createEntity(9998, spot.x + 4, spot.y, wildSpecies(997, tune({ diet: 90, attack: 50, speed: 70 })), 70);
      pin(prey, spot.x, spot.y);
      w.entities = [pred, prey];
      disableFood(w);
      let minPredDelta = 0;
      for (let i = 0; i < 60 && prey.alive; i++) {
        pred.energy = 70;
        prey.energy = 70;
        const before = pred.energy;
        w.step();
        minPredDelta = Math.min(minPredDelta, pred.energy - before);
      }
      return minPredDelta;
    };
    // 입은 피해(체급 동률 = biteDamage 그대로)만큼 되갚았다 · 상수 유도라 튜닝에도 참말.
    expect(run(["zebrakick"])).toBeLessThan(-SIM.biteDamage + 1);
    expect(run(["zebrakick"])).toBeGreaterThan(-SIM.biteDamage - 3);
    expect(run([])).toBeGreaterThan(-5); // 특성 없으면 문 쪽이 잃는 건 제 소모뿐
  });

  it("대가: 달아나는 빠르기가 20% 줄어든다", () => {
    const ratio = fleePathLen("rule-zebra-2", ["zebrakick"]) / fleePathLen("rule-zebra-2", []);
    expect(ratio).toBeGreaterThan(ZEBRA_FLEE_MUL - 0.08);
    expect(ratio).toBeLessThan(ZEBRA_FLEE_MUL + 0.08);
  });
});

// ─────────────────────────────── 돋는 새살 (newflesh) ───────────────────────────────

describe("돋는 새살(newflesh) · 가죽 3단", () => {
  it("물려 잃은 기운의 절반이 상처가 아무는 동안 돌아온다(적립 후 회복 · 아물면 소멸)", () => {
    // 같은 시드의 두 세계. 특성은 움직임을 안 바꾸므로 굴림 열이 같고, 기운 차이 = 돌아온 몫이다.
    const run = (perks: readonly PerkName[]): { energy: number; regenAfterBite: number; regenAtEnd: number } => {
      const { w, pred, prey, spot } = makeDefend(
        "rule-newflesh-1",
        perkGenome({ ...PREY66 }, perks),
        { diet: 90, attack: 50, speed: 1 },
      );
      disableFood(w);
      for (let i = 0; i < 30 && prey.woundTicks === 0; i++) {
        pred.energy = 70;
        prey.energy = 75; // 물린 직후에도 번식 문턱(78) 아래에 머무는 시작값
        pin(pred, spot.x + 4, spot.y);
        pin(prey, spot.x, spot.y);
        w.step();
      }
      expect(prey.woundTicks).toBeGreaterThan(0);
      const regenAfterBite = prey.pendingRegen;
      // 문 쪽을 멀리 치우고(두 세계 똑같이) 상처가 다 아물 때까지 둔다.
      for (let i = 0; i < 125; i++) {
        pin(pred, 10, 10);
        pred.targetPrey = null;
        pred.attackCd = 50;
        pred.energy = 70;
        w.step();
      }
      return { energy: prey.energy, regenAfterBite, regenAtEnd: prey.pendingRegen };
    };
    const healed = run(["newflesh"]);
    const plain = run([]);
    expect(healed.regenAfterBite).toBeGreaterThan(FULL_BITE * NEWFLESH_SHARE - 1); // 잃은 21 의 절반이 적립됐다
    expect(healed.regenAtEnd).toBe(0); // 상처가 아물면 남은 몫은 사라진다
    expect(plain.regenAfterBite).toBe(0);
    // 돌아온 몫 = 두 세계의 기운 차 = 정확히 피해의 절반(10.5).
    expect(healed.energy - plain.energy).toBeCloseTo(FULL_BITE * NEWFLESH_SHARE, 5);
  });
});

// ─────────────────────────────── 뱀의 응시 (transfix) ───────────────────────────────

describe("뱀의 응시(transfix) · 눈 4단", () => {
  it("표적을 잡는 순간 상대는 1초, 나는 반 초 굳는다(굳은 동안 상대는 못 움직인다)", () => {
    const { w, pred, prey } = makeHunt(
      "rule-trans-1",
      perkGenome({ diet: 90, attack: 50 }, ["transfix"]),
      PREY66,
      50,
    );
    w.step(); // 첫 틱에 표적 획득 → 응시
    expect(pred.targetPrey).toBe(prey);
    expect(pred.gazeTargetId).toBe(prey.id);
    // 건 틱에 세워지고, 각자 자기 step 에서 1 줄인 값이 남는다.
    expect(prey.frozenTicks).toBe(TRANSFIX_FREEZE_TICKS - 1);
    expect(pred.frozenTicks).toBe(TRANSFIX_SELF_TICKS - 1);
    const fx = prey.x;
    const fy = prey.y;
    for (let i = 0; i < 20; i++) {
      prey.energy = 70;
      pred.energy = 40;
      w.step();
    }
    expect(Math.hypot(prey.x - fx, prey.y - fy)).toBeLessThan(0.001); // 얼어붙어 제자리다

    const plain = makeHunt("rule-trans-1", perkGenome({ diet: 90, attack: 50 }, []), PREY66, 50);
    plain.w.step();
    expect(plain.pred.targetPrey).toBe(plain.prey);
    expect(plain.prey.frozenTicks).toBe(0); // 특성 없으면 아무도 안 굳는다
    expect(plain.pred.frozenTicks).toBe(0);
  });

  it("같은 표적에게 연속으로 다시 안 걸린다", () => {
    const { w, pred, prey } = makeHunt(
      "rule-trans-2",
      perkGenome({ diet: 90, attack: 50 }, ["transfix"]),
      PREY66,
      50,
    );
    w.step();
    expect(prey.frozenTicks).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) {
      prey.energy = 70;
      pred.energy = 40;
      w.step();
    }
    expect(prey.frozenTicks).toBe(0); // 첫 응시는 다 풀렸다
    pred.targetPrey = null; // 표적을 잠깐 놓쳤다가
    w.step(); // 같은 놈을 다시 잡는다
    expect(pred.targetPrey).toBe(prey);
    expect(prey.frozenTicks).toBe(0); // 같은 표적이라 응시가 다시 안 걸린다(gazeTargetId 계약)
  });
});

// ─────────────────────────────── 따라오는 발소리 (footsteps) ───────────────────────────────

describe("따라오는 발소리(footsteps) · 다리 4단", () => {
  it("표적이 감지 범위를 벗어나도 추격이 유지된다(대조: 특성 없으면 놓는다)", () => {
    const run = (perks: readonly PerkName[]): { kept: boolean; farEnough: boolean } => {
      const { w, pred, prey, spot } = makeHunt(
        "rule-foot-1",
        perkGenome({ diet: 90, attack: 50 }, perks),
        PREY66,
        50,
      );
      w.step(); // 표적 획득
      expect(pred.targetPrey).toBe(prey);
      // 표적을 유지 한계(keep = 감지 반경 × 1.2) 밖으로 순간이동시킨다.
      const far = w.terrain.nearestPassable(spot.x, spot.y + 300, false, true, false);
      pin(prey, far.x, far.y);
      const keep = visionRadius(pred.genome.traits, w, pred.x, pred.y) * SIM.targetKeepFactor;
      const dist = Math.hypot(prey.x - pred.x, prey.y - pred.y);
      w.step();
      return { kept: pred.targetPrey === prey, farEnough: dist > keep + 20 };
    };
    const chased = run(["footsteps"]);
    expect(chased.farEnough).toBe(true); // 전제: 정말 한계 밖이었다
    expect(chased.kept).toBe(true); // 한번 시작한 추격은 그만둘 수 없다
    const plain = run([]);
    expect(plain.farEnough).toBe(true);
    expect(plain.kept).toBe(false); // 특성 없으면 옛날처럼 놓는다
  });

  it("이빨이 안 박히는 상대는 애초에 표적으로 안 잡는다(그만둘 수 없는 추격의 안전핀)", () => {
    // 방어 95(공격 50 과 차 -0.45 ≤ 무시 문턱 -0.35) → 물어도 튕기는 상대.
    const run = (perks: readonly PerkName[]): Entity | null => {
      const { w, pred } = makeHunt(
        "rule-foot-2",
        perkGenome({ diet: 90, attack: 50 }, perks),
        { diet: 10, attack: 95, speed: 1 },
        30,
      );
      w.step();
      return pred.targetPrey;
    };
    expect(run(["footsteps"])).toBeNull(); // 못 무는 거구를 향한 죽음의 행군을 시작하지 않는다
    expect(run([])).not.toBeNull(); // 보통 사냥꾼은 옛날처럼 일단 노린다(물면 튕길 뿐)
  });
});

// ─────────────────────────────── 푸른 발자국 (greenwake) ───────────────────────────────

describe("푸른 발자국(greenwake) · 무리 3단", () => {
  it("한 입에서 얻는 것은 0.8배, 뜯은 자리의 재생은 두 배 빠르다", () => {
    // 같은 시드의 두 세계 · 특성은 움직임을 안 바꾸므로 첫 채집이 같은 틱, 같은 풀에서 일어난다.
    const run = (perks: readonly PerkName[]): { gain: number; timer: number } => {
      const w = new World("rule-green-1", W, H, perkGenome({}, perks));
      const e = playerEnt(w);
      w.entities = [e];
      let prevDelta = 0;
      for (let i = 0; i < 280; i++) {
        const before = e.energy;
        const feedsBefore = w.roundCounts.feeds;
        w.step();
        const delta = e.energy - before;
        if (w.roundCounts.feeds > feedsBefore) {
          const eaten = w.food.find((f) => !f.available && f.regrowTimer > 0);
          expect(eaten).toBeDefined();
          // 한 입의 순수입 = 채집 틱 변화량 - 직전 틱의 소모(두 세계에서 같은 값).
          return { gain: delta - prevDelta, timer: eaten?.regrowTimer ?? 0 };
        }
        prevDelta = delta;
      }
      throw new Error("280틱 안에 채집이 안 일어났다 · 시드를 바꿔라");
    };
    const wake = run(["greenwake"]);
    const plain = run([]);
    expect(wake.gain / plain.gain).toBeGreaterThan(GREENWAKE_GAIN - 0.03); // 20% 줄어든 한 입
    expect(wake.gain / plain.gain).toBeLessThan(GREENWAKE_GAIN + 0.03);
    expect(wake.timer / plain.timer).toBeGreaterThan(GREENWAKE_REGROW - 0.02); // 두 배 빠른 재생
    expect(wake.timer / plain.timer).toBeLessThan(GREENWAKE_REGROW + 0.02);
  });
});

// ─────────────────────────────── 입에서 입으로 (bloodgift) ───────────────────────────────

describe("입에서 입으로(bloodgift) · 무리 3단", () => {
  /** 한 틱 뒤의 (주는 쪽, 받는 쪽) 기운. giverEnergy 로 「넉넉함」 조건을 조작한다. */
  const after = (perks: readonly PerkName[], giverEnergy: number): { giver: number; taker: number } => {
    const w = new World("rule-blood-1", W, H, perkGenome({}, perks));
    const spot = openLand(w, 3, true);
    const players = w.entities.filter((e) => e.species.isPlayer);
    const giver = players[0];
    const taker = players[1];
    if (giver === undefined || taker === undefined) throw new Error("내 종 개체가 모자라다");
    pin(giver, spot.x, spot.y);
    pin(taker, spot.x + 20, spot.y); // 나눔 반경(55) 안
    w.entities = [giver, taker];
    disableFood(w);
    giver.energy = giverEnergy;
    taker.energy = 30; // 배를 곯는(50 아래) 동료
    w.step();
    return { giver: giver.energy, taker: taker.energy };
  };

  it("넉넉한 개체가 굶는 이웃에게 기운을 옮기고, 자신은 그 두 배를 잃는다", () => {
    const gift = after(["bloodgift"], 90);
    const plain = after([], 90);
    expect(gift.taker - plain.taker).toBeCloseTo(BLOODGIFT_GIVE, 6); // 받는 쪽 +0.2
    expect(gift.giver - plain.giver).toBeCloseTo(-BLOODGIFT_GIVE * BLOODGIFT_LOSS_MUL, 6); // 주는 쪽 -0.4
  });

  it("기운이 넉넉하지 않으면(80 미만) 아무것도 안 옮긴다", () => {
    const gift = after(["bloodgift"], 60);
    const plain = after([], 60);
    expect(gift.taker).toBeCloseTo(plain.taker, 9);
    expect(gift.giver).toBeCloseTo(plain.giver, 9);
  });
});

// ─────────────────────────────── 결정론 최종 방벽 ───────────────────────────────

describe("고유 카드 결정론 · 보유 세계도 같은 시드면 같은 결과", () => {
  it("카드 여럿을 쥔 세계 둘(같은 시드)을 300틱 굴리면 지문이 같다", () => {
    const make = (): World =>
      new World(
        "rule-det-1",
        W,
        H,
        perkGenome({ diet: 60, attack: 60, vision: 70, speed: 60 }, [
          "famished",
          "hamstring",
          "carrion",
          "salmonrun",
          "mountain",
        ]),
      );
    const a = make();
    const b = make();
    for (let i = 0; i < 300; i++) {
      a.step();
      b.step();
    }
    expect(snapshot(a)).toBe(snapshot(b));
    expect(a.deaths).toEqual(b.deaths);
    expect(a.carcasses.length).toBe(b.carcasses.length);
  });
});
