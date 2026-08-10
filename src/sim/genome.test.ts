// 게놈 v8 — **도장(pip) + 열쇠**가 진짜 게놈이고, 세계가 읽는 능치(traits)는 거기서 파생된다.
//
// 이 파일이 못 박는 계약은 셋이다.
//   ① **중립점** — 도장 0 · 열쇠 없음이면 몸집이 정확히 50, 유지비가 정확히 1.0 이다.
//      이게 깨지면 "안 찍은 축은 존재하지 않는 것과 같다"가 무너져 밸런스가 통째로 이동한다.
//   ② **야생 불변** — `genomeFromTraits` 가 채우는 파생 축이 v7 공식과 비트 단위로 같다.
//      (defense = attack · upkeep = 0.5 + 대사/100 · graze/hunt/carnivory = 식성 곡선)
//   ③ **rng 소비 고정** — `MUTABLE_TRAITS` 는 여섯이다. 개수가 바뀌면 개체 변이가 다른 세계가 된다.
//
// (v7 시절 테스트에서 지운 것: "형질 열넷이 전부 50/0" 같은 값 나열. v8 의 기본 게놈은 티어 0 의
//  파생표 값이라 50 이 아니고, 그 숫자를 여기 다시 적으면 표와 테스트 두 곳에 진실이 생긴다.)
import { describe, it, expect } from "vitest";
import {
  GENOME_VERSION,
  MUTABLE_TRAITS,
  TRAIT_KEYS,
  cloneGenome,
  defaultGenome,
  deserializeGenome,
  genomeFromPips,
  genomeFromTraits,
  migrateGenome,
  mutateGenome,
  randomGenome,
  serializeGenome,
} from "@/sim/genome";
import {
  CATEGORIES,
  MAX_TIER,
  TIER_STEPS,
  derivedSize,
  derivedUpkeep,
  deriveTraits,
  emptyKeys,
  emptyPips,
  pipsForTier,
  pipsToNext,
  tierOf,
  tierSum,
  type Pips,
} from "@/sim/tiers";
import { carnivory01, grazeEfficiency, huntEfficiency } from "@/sim/diet";
import { Rng } from "@/sim/rng";
import { SIM } from "@/sim/params";

/** 도장 몇 개를 찍은 게놈(플레이어 쪽 길). */
function pipsOf(partial: Partial<Pips>): Pips {
  return { ...emptyPips(), ...partial };
}

describe("티어 사다리 — 문턱에서만 켜진다", () => {
  it("도장 수가 문턱을 넘을 때만 티어가 오른다(티어 안의 도장은 아무 뜻이 없다)", () => {
    expect(tierOf(0)).toBe(0);
    expect(tierOf(TIER_STEPS[0] - 1)).toBe(0);
    expect(tierOf(TIER_STEPS[0])).toBe(1);
    expect(tierOf(TIER_STEPS[1] - 1)).toBe(1);
    expect(tierOf(TIER_STEPS[1])).toBe(2);
    expect(tierOf(TIER_STEPS[2])).toBe(3);
    expect(tierOf(TIER_STEPS[3])).toBe(MAX_TIER);
    expect(tierOf(TIER_STEPS[3] + 50)).toBe(MAX_TIER); // 상한 밖은 더 안 오른다
  });

  it("요구 도장이 뒤로 갈수록 안 싸진다(감쇠) — 사다리가 한 칸씩 비싸진다", () => {
    // 한 칸 값 = 그 티어를 켜는 데 더 드는 도장. 뒤 칸이 앞 칸보다 **싸지면** 안 된다(감쇠가 뒤집힌다).
    // 마지막 두 칸이 같은 값인 것은 허용한다 — 사다리 끝은 프로브 실측으로 정한 자리다(tiers.ts 표).
    const steps = TIER_STEPS.map((s, i) => s - (i === 0 ? 0 : (TIER_STEPS[i - 1] as number)));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i] as number).toBeGreaterThanOrEqual(steps[i - 1] as number);
    }
    expect(steps[steps.length - 1] as number).toBeGreaterThan(steps[0] as number); // 끝이 시작보다 비싸다
  });

  it("다음 문턱까지 남은 도장이 사다리와 정확히 맞는다(화면이 읽는 그 값)", () => {
    expect(pipsToNext(0)).toBe(TIER_STEPS[0]);
    expect(pipsToNext(TIER_STEPS[0])).toBe(TIER_STEPS[1] - TIER_STEPS[0]);
    expect(pipsToNext(TIER_STEPS[3])).toBe(0); // 최고 티어는 남은 것이 없다
    expect(pipsForTier(0)).toBe(0);
    expect(pipsForTier(MAX_TIER)).toBe(TIER_STEPS[3]);
  });
});

describe("기본 게놈 — 중립점 검산(밸런스 보존의 열쇠)", () => {
  it("도장 하나 없는 종은 버전 9 · 도장 0 · 열쇠 0 · 특성 0", () => {
    const g = defaultGenome();
    expect(g.genomeVersion).toBe(GENOME_VERSION);
    expect(GENOME_VERSION).toBe(9);
    for (const c of CATEGORIES) expect(g.pips[c]).toBe(0);
    expect(tierSum(g.pips)).toBe(0);
    expect(Object.values(g.keys).some((v) => v)).toBe(false);
  });

  it("몸집은 정확히 50 이다 — 몸집의 다섯 소비처가 전부 0 이 되는 자리", () => {
    // 도장 0 · 열쇠 없음이면 몸집 항이 사라진다(속도·유지비·번식·물기 체급·은신 무력화 전부 무영향).
    expect(derivedSize(emptyPips(), emptyKeys())).toBe(50);
    expect(defaultGenome().traits.size).toBe(50);
  });

  it("유지비는 정확히 1.0 이다 — 야생종(대사 50)의 `0.5 + 대사/100` 과 같은 축 위에 있다", () => {
    expect(derivedUpkeep(emptyPips())).toBe(1);
    expect(defaultGenome().traits.upkeep).toBe(1);
    expect(genomeFromTraits({ metabolism: 50 }).traits.upkeep).toBe(1);
  });

  it("이빨 0단은 사냥이 원리적으로 불가하고 풀 효율이 온전하다(= 초식 거인 경로의 출발점)", () => {
    const t = defaultGenome().traits;
    expect(t.hunt).toBe(0); // 사냥 자체를 못 한다
    expect(t.carnivory).toBe(0);
    expect(t.graze).toBe(1); // 풀에서 얻는 것이 온전하다
  });

  it("열쇠를 안 가지면 그 능력은 세계에 존재하지 않는 것과 같다(0)", () => {
    const t = defaultGenome().traits;
    for (const key of ["echo", "wings", "venom", "ranged", "camouflage"] as const) {
      expect(t[key]).toBe(0);
    }
  });
});

describe("도장이 능치를 만든다 — 문턱을 안 넘으면 세계는 1비트도 안 움직인다", () => {
  it("같은 티어 안에서 도장을 더 찍어도 능치가 하나도 안 바뀐다", () => {
    const a = deriveTraits(pipsOf({ fang: TIER_STEPS[0] }), emptyKeys());
    const b = deriveTraits(pipsOf({ fang: TIER_STEPS[1] - 1 }), emptyKeys());
    expect(b).toEqual(a);
  });

  it("문턱을 넘는 순간 그 범주의 능치가 통째로 켜진다", () => {
    const below = deriveTraits(pipsOf({ fang: TIER_STEPS[0] - 1 }), emptyKeys());
    const above = deriveTraits(pipsOf({ fang: TIER_STEPS[0] }), emptyKeys());
    expect(below.hunt).toBe(0);
    expect(above.hunt).toBeGreaterThan(0); // 사냥이 열린다
    expect(above.attack).toBeGreaterThan(below.attack);
    expect(above.graze).toBeLessThan(below.graze); // 대가도 같은 순간에 켜진다
  });

  it("최고 티어(4단)는 규칙 면제선(100)에 닿고, 3단은 못 닿는다", () => {
    const apex = deriveTraits(pipsOf({ fang: TIER_STEPS[3], leg: TIER_STEPS[3], hide: TIER_STEPS[3] }), emptyKeys());
    const third = deriveTraits(pipsOf({ fang: TIER_STEPS[2], leg: TIER_STEPS[2], hide: TIER_STEPS[2] }), emptyKeys());
    expect(apex.attack).toBeGreaterThanOrEqual(100);
    expect(apex.speed).toBeGreaterThanOrEqual(100);
    expect(apex.defense).toBeGreaterThanOrEqual(100);
    expect(third.attack).toBeLessThan(100);
    expect(third.speed).toBeLessThan(100);
    expect(third.defense).toBeLessThan(100);
  });

  it("티어가 오르면 공통 유지비(청구서)가 함께 오른다 — 대가는 커지기만 한다", () => {
    const one = derivedUpkeep(pipsOf({ leg: TIER_STEPS[0] }));
    const two = derivedUpkeep(pipsOf({ leg: TIER_STEPS[1] }));
    expect(one).toBeGreaterThan(1);
    expect(two).toBeGreaterThan(one);
  });

  it("열쇠의 세기는 모 범주의 티어를 그대로 읽는다(새 축을 만들지 않는다)", () => {
    const keys = { ...emptyKeys(), venom: true };
    const weak = deriveTraits(pipsOf({ fang: TIER_STEPS[0] }), keys);
    const strong = deriveTraits(pipsOf({ fang: TIER_STEPS[2] }), keys);
    expect(weak.venom).toBeGreaterThan(0);
    expect(strong.venom).toBeGreaterThan(weak.venom);
    // 독니의 고유 대가 — 사냥 뒤 회복이 준다.
    expect(strong.hunt).toBeLessThan(deriveTraits(pipsOf({ fang: TIER_STEPS[2] }), emptyKeys()).hunt);
  });

  it("genomeFromPips 는 도장·열쇠에서 능치를 그대로 낸다(카드가 부르는 길)", () => {
    const pips = pipsOf({ herd: TIER_STEPS[1] });
    const keys = { ...emptyKeys(), call: true };
    const g = genomeFromPips(pips, keys);
    expect(g.pips).toEqual(pips);
    expect(g.keys.call).toBe(true);
    expect(g.traits).toEqual(deriveTraits(pips, keys));
  });
});

describe("야생 게놈 — v7 과 비트 단위로 같은 수를 낸다(생태 불변)", () => {
  it("안 넘겨 준 파생 축을 v7 공식 그대로 채운다", () => {
    for (const [attack, metabolism, diet] of [
      [50, 50, 50],
      [72, 30, 85],
      [38, 66, 16],
    ] as const) {
      const t = genomeFromTraits({ attack, metabolism, diet }).traits;
      expect(t.defense).toBe(attack); // biteOutcome 이 v7 과 같은 수를 낸다
      expect(t.upkeep).toBeCloseTo(0.5 + metabolism / 100, 12); // 소모 공식이 v7 과 같다
      expect(t.graze).toBeCloseTo(grazeEfficiency(diet), 12);
      expect(t.carnivory).toBeCloseTo(carnivory01(diet), 12);
      expect(t.hunt).toBeCloseTo(diet > SIM.dietHuntMin ? huntEfficiency(diet) : 0, 12);
    }
  });

  it("넘겨 준 축은 그대로 존중한다(아키타입이 손으로 정한 값이 이긴다)", () => {
    const t = genomeFromTraits({ attack: 60, defense: 90, upkeep: 0.4, hunt: 0.5 }).traits;
    expect(t.defense).toBe(90);
    expect(t.upkeep).toBe(0.4);
    expect(t.hunt).toBe(0.5);
  });

  it("아무것도 안 넘기면 v7 의 기본 게놈과 같은 능치다(야생 기준선)", () => {
    const t = genomeFromTraits({}).traits;
    expect(t.speed).toBe(50);
    expect(t.attack).toBe(50);
    expect(t.defense).toBe(50);
    expect(t.vision).toBe(50);
    expect(t.herding).toBe(0); // v7 에서 능력 형질로 강등된 그대로
    expect(t.metabolism).toBe(50);
    expect(t.fertility).toBe(50);
    expect(t.diet).toBe(50);
    expect(t.swimming).toBe(50);
    expect(t.size).toBe(50);
    expect(t.upkeep).toBe(1);
    expect(t.fovCos).toBe(SIM.fovHalfCos);
    expect(t.plague).toBe(1); // 야생은 역병 배수 1(무리의 고유 대가는 플레이어 몫)
    expect(t.sprintCost).toBe(0);
  });

  it("야생 능치에서 역산한 도장은 화면 표시용일 뿐 밸런스에 안 닿는다(능치는 그대로다)", () => {
    const g = genomeFromTraits({ attack: 90, speed: 95, vision: 95, herding: 92 });
    expect(g.traits.attack).toBe(90); // 역산이 능치를 덮어쓰지 않는다
    expect(g.traits.speed).toBe(95);
    expect(tierOf(g.pips.fang)).toBeGreaterThan(0); // 다만 "몇 단짜리 종인가"는 말할 수 있다
  });
});

describe("마이그레이션 — 지난 런의 챔피언이 옛 모습 그대로 돌아온다", () => {
  it("v1 게놈은 0~1 스케일을 100 배로 올려 받는다", () => {
    const g = migrateGenome({
      genomeVersion: 1,
      traits: { speed: 0.7, attack: 0.3, vision: 0.6, herding: 0.4, metabolism: 0.5, fertility: 0.2, diet: 0.8 },
    });
    expect(g.genomeVersion).toBe(GENOME_VERSION);
    expect(g.traits.speed).toBe(70);
    expect(g.traits.diet).toBe(80);
    expect(g.traits.swimming).toBe(50); // v1 엔 없던 축은 기본값
    expect(g.traits.venom).toBe(0);
    expect(g.traits.size).toBe(50);
    // v8 이 새로 만든 축도 v7 공식으로 채워진다.
    expect(g.traits.defense).toBe(30);
    expect(g.traits.upkeep).toBeCloseTo(1, 12);
  });

  it("v5·v6 게놈의 값은 있는 그대로 존중한다(0 으로 밀지 않는다)", () => {
    const v5 = migrateGenome({
      genomeVersion: 5,
      traits: { speed: 60, attack: 40, vision: 55, herding: 30, metabolism: 50, fertility: 45, diet: 70, swimming: 80, echo: 90, wings: 65 },
    });
    expect(v5.traits.echo).toBe(90);
    expect(v5.traits.wings).toBe(65);
    expect(v5.traits.venom).toBe(0);

    const v6 = migrateGenome({
      genomeVersion: 6,
      traits: { speed: 60, attack: 40, vision: 55, herding: 72, metabolism: 50, fertility: 45, diet: 30, swimming: 50, echo: 0, wings: 0, venom: 0, ranged: 0 },
    });
    expect(v6.traits.herding).toBe(72); // 옛 종의 정체를 지우지 않는다
    expect(v6.traits.size).toBe(50);
    expect(v6.traits.camouflage).toBe(0);
  });

  it("v8 왕복 — 도장 게놈은 도장에서 능치를 다시 낸다(저장된 값이 낡아도 규칙이 이긴다)", () => {
    const g = genomeFromPips(pipsOf({ fang: TIER_STEPS[1], herd: TIER_STEPS[0] }), { ...emptyKeys(), venom: true });
    const round = deserializeGenome(serializeGenome(g));
    expect(round.genomeVersion).toBe(GENOME_VERSION);
    expect(round.pips).toEqual(g.pips);
    expect(round.keys).toEqual(g.keys);
    expect(round.traits).toEqual(g.traits);
  });

  it("v8 왕복 — 도장이 하나도 없는 야생 게놈은 저장된 능치를 그대로 존중한다", () => {
    // 도장으로 설명되지 않는 종(모든 축이 1단 문턱 아래)은 손으로 정한 능치가 유일한 진실이다.
    // ⚠ 반대로 도장이 하나라도 있으면 위 테스트처럼 **도장이 이긴다** — 저장본이 낡았어도 규칙이 이긴다.
    const g = genomeFromTraits({ diet: 85, attack: 50, swimming: 90, camouflage: 60 });
    for (const c of CATEGORIES) expect(g.pips[c]).toBe(0); // 전제: 역산 도장이 0 이다
    const round = deserializeGenome(serializeGenome(g));
    expect(round.traits.diet).toBe(85);
    expect(round.traits.swimming).toBe(90);
    expect(round.traits.camouflage).toBe(60);
    expect(round.traits.attack).toBe(50);
  });

  it("알 수 없는 버전은 거부", () => {
    expect(() => migrateGenome({ genomeVersion: 99, traits: {} })).toThrow();
    expect(() => migrateGenome(null)).toThrow();
  });
});

describe("개체 변이 — rng 소비 횟수가 밸런스 그 자체다", () => {
  it("흔드는 축은 정확히 여섯이다(개수가 바뀌면 개체 변이가 다른 세계가 된다)", () => {
    expect(MUTABLE_TRAITS.length).toBe(6);
    expect(new Set(MUTABLE_TRAITS).size).toBe(6);
    for (const key of MUTABLE_TRAITS) expect(TRAIT_KEYS).toContain(key);
  });

  it("같은 rng 스트림이면 같은 새끼가 나온다(결정론)", () => {
    const make = (): number[] => {
      const rng = new Rng("mut-det");
      const out: number[] = [];
      for (let i = 0; i < 30; i++) {
        const child = mutateGenome(cloneGenome(genomeFromTraits({})), rng, 1.5);
        for (const key of MUTABLE_TRAITS) out.push(child.traits[key]);
      }
      return out;
    };
    expect(make()).toEqual(make());
  });

  it("규칙 면제(100)는 변이가 갉지도, 만들지도 않는다", () => {
    const rng = new Rng("mut-apex");
    for (const key of MUTABLE_TRAITS) {
      const apex = genomeFromTraits({});
      apex.traits[key] = 100;
      const near = genomeFromTraits({});
      near.traits[key] = 99;
      for (let i = 0; i < 60; i++) {
        expect(mutateGenome(cloneGenome(apex), rng, 1.5).traits[key]).toBe(100);
        expect(mutateGenome(cloneGenome(near), rng, 1.5).traits[key]).toBeLessThan(100);
      }
    }
  });

  it("티어(도장)는 안 흔든다 — 문턱 효과가 개체마다 다르면 화면에서 안 읽힌다", () => {
    const g = genomeFromPips(pipsOf({ fang: TIER_STEPS[1], hide: TIER_STEPS[0] }), emptyKeys());
    const child = mutateGenome(cloneGenome(g), new Rng("mut-pip"), 3);
    expect(child.pips).toEqual(g.pips);
    expect(child.keys).toEqual(g.keys);
  });

  it("변이 폭 0 이면 아무것도 안 바뀐다(rng 도 안 쓴다)", () => {
    const rng = new Rng("mut-zero");
    const before = rng.getState();
    const g = genomeFromTraits({});
    const child = mutateGenome(cloneGenome(g), rng, 0);
    expect(child.traits).toEqual(g.traits);
    expect(rng.getState()).toBe(before);
  });
});

describe("무작위 게놈 — 도장을 뿌린다(결정론)", () => {
  it("같은 시드면 같은 게놈", () => {
    const a = randomGenome(new Rng("rnd-1"));
    const b = randomGenome(new Rng("rnd-1"));
    expect(a).toEqual(b);
    expect(a.genomeVersion).toBe(GENOME_VERSION);
    for (const c of CATEGORIES) expect(a.pips[c]).toBeGreaterThanOrEqual(0);
  });
});
