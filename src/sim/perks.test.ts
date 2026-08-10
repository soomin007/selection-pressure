// 조건부 특성(perk) — **카드가 약속한 것과 세계가 하는 것이 같은가.**
//
// 이 저장소의 제1 규칙이 「수치가 화면 표시와 다르면 그건 거짓말이다」라, 여기 테스트는 대부분
// **표시와 실제를 맞대 보는** 것이다. 나머지는 등급이 값어치 순서를 지키는지와 결정론이다.

import { describe, expect, it } from "vitest";
import {
  ALONE_MAX,
  CROWD_MIN,
  DAY_LIGHT,
  NIGHT_LIGHT,
  PERKS,
  PERK_AXES,
  PERK_AXIS_INFO,
  PERK_BY_NAME,
  PERK_WHENS,
  PERK_WHEN_INFO,
  activePerks,
  isPerkName,
  perkLine,
  perkMul,
  perkRarity,
  perkValue,
  whenHolds,
  type Perk,
  type PerkCtx,
  type PerkName,
} from "@/sim/perks";
import { SIM } from "@/sim/params";
import type { Entity } from "@/sim/entity";
import type { World } from "@/sim/world";

/**
 * 조건 판정에 필요한 것만 가진 가짜 맥락. 실제 World 를 띄우면 이 테스트가 지형 생성·먹이 배치까지
 * 함께 검사하는 셈이 되어 무엇이 깨졌는지 안 읽힌다(조건 판정만 격리해서 본다).
 */
function ctx(over: {
  daylight?: number;
  tile?: "water" | "grass" | "rough" | "land";
  energy?: number;
  neighbors?: number;
  hunting?: boolean;
  fleeing?: boolean;
  wounded?: boolean;
}): PerkCtx {
  const tile = over.tile ?? "land";
  const world = {
    daylight: over.daylight ?? 0.5,
    terrain: {
      cellSize: 20,
      isWater: (): boolean => tile === "water",
      isGrass: (): boolean => tile === "grass",
      isRough: (): boolean => tile === "rough",
    },
  } as unknown as World;
  const e = {
    x: 100,
    y: 100,
    energy: over.energy ?? SIM.maxEnergy * 0.65,
    woundTicks: over.wounded === true ? 10 : 0,
    targetPrey: null,
  } as unknown as Entity;
  return {
    world,
    e,
    hunting: over.hunting ?? false,
    fleeing: over.fleeing ?? false,
    neighbors: over.neighbors ?? 4,
  };
}

const byId = (id: PerkName): Perk => {
  const p = PERK_BY_NAME.get(id);
  if (p === undefined) throw new Error(`특성 없음: ${id}`);
  return p;
};

describe("특성 목록의 무결성", () => {
  it("id 가 겹치지 않는다", () => {
    expect(new Set(PERKS.map((p) => p.id)).size).toBe(PERKS.length);
  });

  it("이름이 겹치지 않는다 — 카드가 이름으로 구별되기 때문", () => {
    expect(new Set(PERKS.map((p) => p.name)).size).toBe(PERKS.length);
  });

  it("모든 축과 모든 조건이 실제로 쓰인다 — 안 쓰이는 칸은 검증 안 된 코드 경로다", () => {
    const axes = new Set(PERKS.map((p) => p.axis));
    const whens = new Set(PERKS.map((p) => p.when));
    for (const a of PERK_AXES) expect(axes.has(a), `축 ${a} 를 쓰는 특성이 없다`).toBe(true);
    for (const w of PERK_WHENS) expect(whens.has(w), `조건 ${w} 을 쓰는 특성이 없다`).toBe(true);
  });

  it("배수가 이득 방향이다 — 「낮아야 이득」인 축만 1 아래", () => {
    for (const p of PERKS) {
      const lower = PERK_AXIS_INFO[p.axis].lower;
      if (lower) expect(p.mul, p.id).toBeLessThan(1);
      else expect(p.mul, p.id).toBeGreaterThan(1);
    }
  });

  it("효과 문구에 적힌 배수가 실제로 곱해지는 배수와 **글자까지** 같다", () => {
    // 0.625 같은 값을 쓰면 화면엔 0.63 이 뜨는데 sim 은 0.625 를 곱한다 — 작지만 거짓말이다.
    for (const p of PERKS) {
      const shown = perkLine(p).match(/×([\d.]+)/)?.[1];
      expect(shown, p.id).toBeDefined();
      expect(Number(shown), `${p.id} 의 표시(${String(shown)})가 실제 배수(${p.mul})와 다르다`).toBe(p.mul);
    }
  });

  it("한 줄에 조건과 효과가 다 있다 — 이 문구는 카드·도감에 단독으로 뜬다", () => {
    for (const p of PERKS) {
      const line = perkLine(p);
      expect(line, p.id).toContain(PERK_AXIS_INFO[p.axis].label);
      const when = PERK_WHEN_INFO[p.when].label;
      if (when !== "") expect(line, p.id).toContain(when);
    }
  });

  it("설명(flavor)에 배수를 적지 않는다 — 두 곳에 적으면 한쪽만 바뀐다", () => {
    for (const p of PERKS) expect(p.flavor, p.id).not.toMatch(/×|[0-9]배/);
  });

  it("한글 사이 em dash 를 안 쓴다 (UI 문구 규칙)", () => {
    for (const p of PERKS) {
      expect(p.name, p.id).not.toContain("—");
      expect(p.flavor, p.id).not.toContain("—");
      expect(perkLine(p), p.id).not.toContain("—");
    }
  });
});

describe("등급은 값어치가 정한다", () => {
  it("값어치 = 조건 성립 빈도 × 효과 크기 (「낮아야 이득」 축은 역수로)", () => {
    const night = byId("vision_night"); // 밤에 · 보는 거리 ×1.45
    expect(perkValue(night)).toBeCloseTo(PERK_WHEN_INFO.night.freq * 0.45, 10);
    const slow = byId("upkeep_slow"); // 늘 · 기운 소모 ×0.78
    expect(perkValue(slow)).toBeCloseTo(1 / 0.78 - 1, 10);
  });

  it("등급이 오르면 값어치도 오른다 — 배지가 크기를 말한다", () => {
    const order = ["common", "uncommon", "rare", "epic"] as const;
    let prevMax = 0;
    for (const r of order) {
      const vals = PERKS.filter((p) => perkRarity(p) === r).map(perkValue);
      expect(vals.length, `${r} 등급이 비어 있다`).toBeGreaterThan(0);
      expect(Math.min(...vals), `${r} 의 최솟값이 아래 등급의 최댓값보다 작다`).toBeGreaterThanOrEqual(
        prevMax,
      );
      prevMax = Math.max(...vals);
    }
  });

  it("아래 등급일수록 종류가 많다 — 종류 수 × 가중치가 등장 확률이라 뒤집히면 배지가 거짓말한다", () => {
    const count = (r: string): number => PERKS.filter((p) => perkRarity(p) === r).length;
    expect(count("common")).toBeGreaterThan(count("uncommon"));
    expect(count("uncommon")).toBeGreaterThan(count("rare"));
    expect(count("rare")).toBeGreaterThan(count("epic"));
  });

  it("한 축에 등급이 몰리지 않는다 — 몰리면 그 축을 안 파는 빌드에게 드래프트가 죽는다", () => {
    for (const a of PERK_AXES) {
      const n = PERKS.filter((p) => p.axis === a).length;
      expect(n, `축 ${a}`).toBeGreaterThanOrEqual(4);
      expect(n, `축 ${a}`).toBeLessThanOrEqual(7);
    }
  });
});

describe("조건 판정", () => {
  it("밤과 낮이 동시에 성립하지 않는다 — 어스름은 둘 다 아니다", () => {
    for (const d of [0, 0.2, 0.34, 0.35, 0.5, 0.64, 0.65, 0.8, 1]) {
      const c = ctx({ daylight: d });
      expect(whenHolds("night", c) && whenHolds("day", c), `daylight ${d}`).toBe(false);
    }
    expect(whenHolds("night", ctx({ daylight: NIGHT_LIGHT - 0.01 }))).toBe(true);
    expect(whenHolds("day", ctx({ daylight: DAY_LIGHT }))).toBe(true);
  });

  it("배고픔과 넉넉함이 동시에 성립하지 않는다", () => {
    for (const f of [0, 0.3, 0.49, 0.5, 0.7, 0.79, 0.8, 1]) {
      const c = ctx({ energy: SIM.maxEnergy * f });
      expect(whenHolds("hungry", c) && whenHolds("full", c), `기운 ${f}`).toBe(false);
    }
  });

  it("혼자와 무리 속이 동시에 성립하지 않는다", () => {
    for (let n = 0; n <= 12; n += 1) {
      const c = ctx({ neighbors: n });
      expect(whenHolds("alone", c) && whenHolds("crowd", c), `이웃 ${n}`).toBe(false);
    }
    expect(whenHolds("alone", ctx({ neighbors: ALONE_MAX }))).toBe(true);
    expect(whenHolds("crowd", ctx({ neighbors: CROWD_MIN }))).toBe(true);
  });

  it("지형·상태 조건이 그 자리에서만 켜진다", () => {
    expect(whenHolds("grass", ctx({ tile: "grass" }))).toBe(true);
    expect(whenHolds("grass", ctx({ tile: "land" }))).toBe(false);
    expect(whenHolds("rough", ctx({ tile: "rough" }))).toBe(true);
    expect(whenHolds("shore", ctx({ tile: "water" }))).toBe(true);
    expect(whenHolds("shore", ctx({ tile: "land" }))).toBe(false);
    expect(whenHolds("wounded", ctx({ wounded: true }))).toBe(true);
    expect(whenHolds("wounded", ctx({}))).toBe(false);
    expect(whenHolds("hunting", ctx({ hunting: true }))).toBe(true);
    expect(whenHolds("fleeing", ctx({ fleeing: true }))).toBe(true);
    expect(whenHolds("always", ctx({}))).toBe(true);
  });
});

describe("배수 적용", () => {
  it("특성이 없으면 정확히 1 — 야생종과 v8 종이 겪는 세계가 안 바뀐다", () => {
    for (const a of PERK_AXES) expect(perkMul([], a, ctx({}))).toBe(1);
  });

  it("조건이 안 맞으면 1 · 맞으면 그 배수", () => {
    const day = ctx({ daylight: 1 });
    const night = ctx({ daylight: 0 });
    expect(perkMul(["vision_night"], "vision", day)).toBe(1);
    expect(perkMul(["vision_night"], "vision", night)).toBe(byId("vision_night").mul);
  });

  it("다른 축에는 안 걸린다", () => {
    const night = ctx({ daylight: 0 });
    expect(perkMul(["vision_night"], "speed", night)).toBe(1);
  });

  it("같은 축의 여러 특성은 곱해진다", () => {
    const night = ctx({ daylight: 0 });
    const both = perkMul(["vision_night", "vision_always"], "vision", night);
    expect(both).toBeCloseTo(byId("vision_night").mul * byId("vision_always").mul, 10);
  });

  it("같은 입력이면 같은 결과 — rng 를 안 쓴다(결정론)", () => {
    const c = ctx({ daylight: 0, tile: "grass", neighbors: 8 });
    const names: PerkName[] = ["vision_night", "vision_grass", "upkeep_crowd", "graze_grass"];
    for (const a of PERK_AXES) {
      const first = perkMul(names, a, c);
      for (let i = 0; i < 5; i += 1) expect(perkMul(names, a, c)).toBe(first);
    }
  });

  it("모르는 이름은 조용히 지나간다 — 옛 저장 데이터가 판을 못 깨게", () => {
    expect(perkMul(["없는특성" as PerkName, "vision_always"], "vision", ctx({}))).toBe(
      byId("vision_always").mul,
    );
    expect(isPerkName("vision_always")).toBe(true);
    expect(isPerkName("없는특성")).toBe(false);
  });

  it("지금 켜진 특성 목록이 배수와 같은 판정을 쓴다 — 화면과 sim 이 갈리지 않는다", () => {
    const night = ctx({ daylight: 0 });
    const names: PerkName[] = ["vision_night", "vision_day"];
    const on = activePerks(names, night).map((p) => p.id);
    expect(on).toEqual(["vision_night"]);
    expect(perkMul(names, "vision", night)).toBe(byId("vision_night").mul);
  });
});
