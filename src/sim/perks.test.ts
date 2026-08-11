// 조건부 특성(perk) — **카드가 약속한 것과 세계가 하는 것이 같은가.**
//
// 이 저장소의 제1 규칙이 「수치가 화면 표시와 다르면 그건 거짓말이다」라, 여기 테스트는 대부분
// **표시와 실제를 맞대 보는** 것이다. 나머지는 등급이 값어치 순서를 지키는지와 결정론이다.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALONE_MAX,
  AXIS_CATEGORY,
  CATEGORY_AXES,
  CROWD_MIN,
  DAY_LIGHT,
  NIGHT_LIGHT,
  PERKS,
  PERK_AXES,
  PERK_AXIS_INFO,
  PERK_BY_NAME,
  PERK_RULES,
  PERK_WHENS,
  PERK_WHEN_INFO,
  HAMSTRING_TICKS,
  RIVERJAW_KILL,
  RULE_PERK_RARITY,
  SALMON_MIN_ENERGY,
  activePerks,
  gateDepth,
  gateOpen,
  hasRule,
  isDuoPerk,
  isPerkName,
  ownedDuos,
  perkCost,
  perkGate,
  perkLine,
  perkMul,
  perkRarity,
  perkValue,
  whenHolds,
  type Perk,
  type PerkCtx,
  type PerkName,
} from "@/sim/perks";
import {
  CATEGORIES,
  DUOS,
  DUO_TIER,
  TIER_STEPS,
  emptyKeys,
  emptyPips,
  openDuos,
  pipsForTier,
  type Pips,
} from "@/sim/tiers";
import { CHARGE_RAID_MUL } from "@/sim/boss";
import { SIM } from "@/sim/params";
import type { Entity } from "@/sim/entity";
import type { World } from "@/sim/world";

/** 배수 특성 · 「조건 · 축 · 배수」로 이루어진 것. 규칙 특성은 이 자로 못 잰다. */
const MUL_PERKS: Perk[] = PERKS.filter((p) => p.rule === undefined);
/** 규칙 특성 · 배수가 없고 sim 의 분기 하나와 1:1 로 묶인 것(듀오 열 + 고유 카드 스물). */
const RULE_PERKS: Perk[] = PERKS.filter((p) => p.rule !== undefined);
/** 그중 듀오에서 온 것(이름·문구가 tiers.DUOS 에 사는 것). rule 유무로 가르면 안 된다(2026-08-11). */
const DUO_RULE_PERKS: Perk[] = RULE_PERKS.filter((p) => isDuoPerk(p.id));
/** 3단·4단 고유 카드 스물(2026-08-11 · 사용자 승인 목록). */
const CARD_RULE_PERKS: Perk[] = RULE_PERKS.filter((p) => !isDuoPerk(p.id));

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

/** 배수 특성의 배수. 규칙 특성에는 배수가 없으므로 그 자리에서 터뜨린다. */
const mulOf = (id: PerkName): number => {
  const m = byId(id).mul;
  if (m === undefined) throw new Error(`배수가 없는 특성: ${id}`);
  return m;
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

  it("특성은 **배수 아니면 규칙** 둘 중 하나다 — 둘 다이거나 둘 다 아닌 것은 없다", () => {
    for (const p of PERKS) {
      const isRule = p.rule !== undefined;
      expect(p.mul === undefined, `${p.id}: 배수와 규칙 중 하나만 가져야 한다`).toBe(isRule);
      // 규칙 특성만 화면 문구를 스스로 갖는다(배수 특성은 `perkLine` 이 표에서 만든다).
      expect(p.gain !== undefined, `${p.id}: gain 은 규칙 특성만 갖는다`).toBe(isRule);
    }
    expect(MUL_PERKS.length + RULE_PERKS.length).toBe(PERKS.length);
  });

  it("배수가 이득 방향이다 — 「낮아야 이득」인 축만 1 아래", () => {
    for (const p of MUL_PERKS) {
      const lower = PERK_AXIS_INFO[p.axis].lower;
      if (lower) expect(p.mul, p.id).toBeLessThan(1);
      else expect(p.mul, p.id).toBeGreaterThan(1);
    }
  });

  it("효과 문구에 적힌 배수가 실제로 곱해지는 배수와 **글자까지** 같다", () => {
    // 0.625 같은 값을 쓰면 화면엔 0.63 이 뜨는데 sim 은 0.625 를 곱한다 — 작지만 거짓말이다.
    for (const p of MUL_PERKS) {
      const shown = perkLine(p).match(/×([\d.]+)/)?.[1];
      expect(shown, p.id).toBeDefined();
      expect(Number(shown), `${p.id} 의 표시(${String(shown)})가 실제 배수(${p.mul})와 다르다`).toBe(p.mul);
    }
  });

  it("한 줄에 조건과 효과가 다 있다 — 이 문구는 카드·도감에 단독으로 뜬다", () => {
    for (const p of MUL_PERKS) {
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
    const grass = byId("vision_grass"); // 수풀에서 · 보는 거리 ×1.55
    expect(perkValue(grass)).toBeCloseTo(PERK_WHEN_INFO.grass.freq * 0.55, 10);
    const thrifty = byId("upkeep_full"); // 기운이 넉넉할 때 · 기운 소모 ×0.8
    expect(perkValue(thrifty)).toBeCloseTo((1 / 0.8 - 1) * PERK_WHEN_INFO.full.freq, 10);
  });

  it("등급이 오르면 값어치도 오른다 — 배지가 크기를 말한다", () => {
    // ⚠ 규칙 특성은 뺀다 · 곱해지는 축이 없어 `perkValue` 가 못 재고 0 을 돌려준다.
    //   그 0 을 등급 사다리에 섞으면 「아주 귀함의 최솟값이 0」이 되어 사다리 자체가 뜻을 잃는다.
    // ⚠ 2026-08-11 부터 「아주 귀함」 배수 특성은 도전 과제 보상 「바위 살갗」 한 장뿐이다 —
    //   그 등급의 나머지는 전부 고유 효과(듀오·3단 카드)의 자리다.
    const order = ["common", "uncommon", "rare", "epic"] as const;
    let prevMax = 0;
    for (const r of order) {
      const vals = MUL_PERKS.filter((p) => perkRarity(p) === r).map(perkValue);
      expect(vals.length, `${r} 등급이 비어 있다`).toBeGreaterThan(0);
      expect(Math.min(...vals), `${r} 의 최솟값이 아래 등급의 최댓값보다 작다`).toBeGreaterThanOrEqual(
        prevMax,
      );
      prevMax = Math.max(...vals);
    }
  });

  it("아래 등급일수록 종류가 많다 — 종류 수 × 가중치가 등장 확률이라 뒤집히면 배지가 거짓말한다", () => {
    // ⚠ 규칙 특성(듀오 열 장)은 뺀다. 풀 전체로 세면 「아주 귀함」이 갑절이 되지만, 듀오는 두 범주를
    //   함께 3단으로 올려야(도장 28개) 후보에 뜬다 · 한 종이 동시에 보는 듀오는 사실상 한둘이다.
    //   「실제로 보는 후보 풀에서도 서열이 지켜지는가」는 `game/cards.test.ts` 가 따로 못 박는다.
    const count = (r: string): number => MUL_PERKS.filter((p) => perkRarity(p) === r).length;
    expect(count("common")).toBeGreaterThan(count("uncommon"));
    expect(count("uncommon")).toBeGreaterThan(count("rare"));
    expect(count("rare")).toBeGreaterThan(count("epic"));
  });

  // ⚠ **축이 아니라 범주로 센다**(2026-08-10 게이트 도입). 카드가 열리는 단위는 범주이므로,
  //   「무리를 파는 사람에게 열릴 카드가 몇 장인가」가 실제 질문이다. 축은 범주 안의 갈래일 뿐이라
  //   축별로 고르게 맞추면 오히려 범주가 기울 수 있다(다리·눈은 축이 하나뿐이다).
  it("한 범주에 카드가 몰리거나 마르지 않는다 — 마르면 그 범주를 판 사람에게 열릴 것이 없다", () => {
    // 상한 17 은 고유 카드 스물(범주마다 넷씩 · 아래 게이트 테스트가 지킨다)과 도전 과제 보상
    // 「바위 살갗」(가죽)이 들어오면서 올렸다.
    for (const cat of Object.keys(CATEGORY_AXES) as (keyof typeof CATEGORY_AXES)[]) {
      const n = PERKS.filter((p) => AXIS_CATEGORY[p.axis] === cat).length;
      expect(n, `범주 ${cat}`).toBeGreaterThanOrEqual(9);
      expect(n, `범주 ${cat}`).toBeLessThanOrEqual(17);
    }
  });
});

describe("듀오는 카드다 (2026-08-10 · 도장만으로는 안 켜진다)", () => {
  it("듀오 열 개가 전부 카드가 됐고, 이름·설명이 tiers.DUOS 와 **글자까지** 같다", () => {
    expect(DUO_RULE_PERKS.length).toBe(DUOS.length);
    for (const d of DUOS) {
      const p = DUO_RULE_PERKS.find((x) => x.rule === d.id);
      expect(p, `듀오 ${d.id} 의 카드가 없다`).toBeDefined();
      if (p === undefined) continue;
      // 문구를 옮겨 적으면 대백과와 카드가 다른 말을 한다 · 그래서 표를 그대로 읽는다.
      expect(p.name, d.id).toBe(d.name);
      expect(p.flavor, d.id).toBe(d.flavor);
      expect(perkLine(p), d.id).toBe(d.desc);
    }
  });

  it("게이트가 **두 범주 3단**이다 · 듀오의 두 범주에서 그대로 유도된다", () => {
    for (const p of DUO_RULE_PERKS) {
      const d = DUOS.find((x) => x.id === p.rule);
      expect(d, p.id).toBeDefined();
      if (d === undefined) continue;
      const gate = perkGate(p.id);
      expect(gate?.tiers?.length, p.id).toBe(2);
      expect(gate?.key, `${p.id}: 듀오는 열쇠를 요구하지 않는다`).toBeUndefined();
      const need = new Map((gate?.tiers ?? []).map((t) => [t.cat, t.tier]));
      expect(need.get(d.a), `${p.id} 의 ${d.a}`).toBe(DUO_TIER);
      expect(need.get(d.b), `${p.id} 의 ${d.b}`).toBe(DUO_TIER);
    }
  });

  it("**티어만 올려서는 안 켜진다** · 열리기만 한다(이게 이번 재설계의 전부다)", () => {
    const d = DUOS[0] as (typeof DUOS)[number];
    const p = DUO_RULE_PERKS.find((x) => x.rule === d.id) as Perk;
    const pips = emptyPips();
    pips[d.a] = pipsForTier(DUO_TIER);
    pips[d.b] = pipsForTier(DUO_TIER);
    // 도장은 카드를 **연다**
    expect(gateOpen(perkGate(p.id), pips, emptyKeys())).toBe(true);
    expect(openDuos(pips).map((x) => x.id)).toContain(d.id);
    // 그러나 카드를 고르기 전에는 sim 이 아무것도 못 본다
    expect(hasRule([], d.id as (typeof PERK_RULES)[number])).toBe(false);
    expect(ownedDuos([])).toEqual([]);
    // 골라야 켜진다
    expect(hasRule([p.id], d.id as (typeof PERK_RULES)[number])).toBe(true);
    expect(ownedDuos([p.id]).map((x) => x.id)).toEqual([d.id]);
  });

  it("듀오 카드가 범주 다섯에 **둘씩** 나뉜다 · 한 범주만 듀오가 넷이면 그쪽이 늘 정답이 된다", () => {
    const per = new Map<string, number>();
    for (const p of DUO_RULE_PERKS) {
      const cat = AXIS_CATEGORY[p.axis];
      const d = DUOS.find((x) => x.id === p.rule);
      // 카드가 입은 색은 반드시 그 듀오의 **두 범주 중 하나**여야 한다(아무 색이나 입히면 거짓말).
      expect([d?.a, d?.b], `${p.id} 의 색(${cat})이 듀오의 범주가 아니다`).toContain(cat);
      per.set(cat, (per.get(cat) ?? 0) + 1);
    }
    for (const c of CATEGORIES) expect(per.get(c) ?? 0, `범주 ${c} 의 듀오 카드 수`).toBe(2);
  });

  it("등급은 값어치 산식 밖에서, 게이트 깊이가 정한다 · 배수가 없어 그 자로 못 잰다", () => {
    for (const p of RULE_PERKS) {
      // 듀오·3단 고유 카드(깊이 3) = 아주 귀함 · 4단 규칙 카드(깊이 4) = 전설.
      const want = gateDepth(perkGate(p.id)) >= 4 ? "legendary" : RULE_PERK_RARITY;
      expect(perkRarity(p), p.id).toBe(want);
      expect(perkValue(p), `${p.id}: 못 재는 것은 0 으로 둔다`).toBe(0);
    }
    // 전설 규칙 카드는 정확히 열 장(범주당 4단 2장 · 2026-08-11 사용자 승인 목록).
    expect(RULE_PERKS.filter((p) => perkRarity(p) === "legendary").length).toBe(10);
  });

  it("배수 축에는 아무것도 안 곱한다 · `axis` 는 카드 색일 뿐이다", () => {
    const names = RULE_PERKS.map((p) => p.id);
    for (const a of PERK_AXES) expect(perkMul(names, a, ctx({})), a).toBe(1);
  });

  // ★ **이 테스트가 「적어만 놓고 안 만든 규칙」을 막는다.**
  //   규칙 특성은 카드에 문장을 약속해 놓고 sim 이 그 이름을 한 번도 안 물으면 아무 일도 안 한다.
  //   그건 이 저장소가 금지한 거짓말(「수치가 화면 표시와 다르면」의 가장 나쁜 형태 · 0 이다)이라,
  //   **sim 소스를 실제로 읽어** `hasRule(…, "이름")` 이 있는지 확인한다.
  it("모든 규칙 이름이 sim 안에서 **실제로 읽힌다**", () => {
    // world.ts 도 읽는다(2026-08-11) — 열병의 흉터(역병)·연어의 귀향·썩은 고기(legacyDeath)가 거기 산다.
    // perks.ts 도 읽는다 — 「죽지 않는 것」의 분기(tryRevive)는 두 죽음 자리가 공유하는 함수라
    // perks.ts 안에 살고, 그 안의 hasRule("undying") 이 유일한 호출부다.
    const src = ["./behavior.ts", "./boss.ts", "./world.ts", "./perks.ts"]
      .map((f) => readFileSync(new URL(f, import.meta.url), "utf8"))
      .join("\n");
    const read = new Set<string>();
    for (const m of src.matchAll(/hasRule\([^,]+,\s*"([a-z_]+)"\s*\)/g)) read.add(m[1] as string);
    for (const r of PERK_RULES) {
      expect(read.has(r), `규칙 «${r}» 을 sim 이 한 번도 안 읽는다 · 카드가 아무 일도 안 한다`).toBe(true);
    }
    // 반대쪽도 막는다: sim 이 목록에 없는 이름을 물으면 그 조건은 영원히 거짓이다(죽은 분기).
    for (const r of read) {
      expect((PERK_RULES as readonly string[]).includes(r), `sim 이 없는 규칙 «${r}» 을 묻는다`).toBe(true);
    }
  });

  it("듀오 「돌진」의 설명에 적힌 배수와 sim 의 상수가 같다 · 문장에서 뺄 수 없는 유일한 수다", () => {
    const charge = DUOS.find((d) => d.id === "charge");
    expect(charge?.desc, "돌진 설명이 사라졌다").toContain(`${CHARGE_RAID_MUL}배`);
  });
});

describe("티어가 카드를 연다 (게이트)", () => {
  /** 다섯 범주를 각각 이 단으로 올린 도장. */
  const pipsAt = (tier: number): Pips => {
    const p = emptyPips();
    for (const c of CATEGORIES) p[c] = tier <= 0 ? 0 : (TIER_STEPS[tier - 1] as number);
    return p;
  };
  const openCount = (tier: number): number =>
    PERKS.filter((p) => gateOpen(perkGate(p.id), pipsAt(tier), emptyKeys())).length;

  it("모든 특성에 열리는 자리가 있다 — 게이트가 없으면 티어를 올릴 이유에서 빠진다", () => {
    for (const p of PERKS) expect(perkGate(p.id), p.id).toBeDefined();
  });

  // ⚠ **2026-08-10 밤에 뒤집힌 계약.** 그날 낮에는 「도장이 없으면 아무것도 안 열린다」였는데,
  //   그것이 **악순환**을 만들었다(실측: 잡식 시작 시 후보 13장이 전부 이빨·눈 · 다른 세 범주는 0).
  //   **[사용자]** "매번 이빨 카드만 떠서 다른 범주는 아예 올릴 엄두도 못 내고 있는데, 이게 티어를
  //   올릴 동기가 될 수도 있지만 지금은 **의욕을 잃게 하는 게 더 큰** 것 같아."
  it("범주마다 두 장은 처음부터 열려 있다 — 「이런 범주가 있다」를 시작부터 보여 준다", () => {
    const open = PERKS.filter((p) => gateOpen(perkGate(p.id), emptyPips(), emptyKeys()));
    expect(open.length).toBe(10);
    // 다섯 범주가 **빠짐없이** 둘씩이어야 한다 — 한 범주라도 0 이면 그 범주는 다시 안 보이게 된다.
    for (const cat of CATEGORIES) {
      const n = open.filter((p) => AXIS_CATEGORY[p.axis] === cat).length;
      expect(n, `범주 ${cat} 가 처음부터 보이는 카드 수`).toBe(2);
    }
  });

  it("처음부터 열린 열 장은 **가장 작은 것들**이다 — 티어를 올릴 이유가 남아야 한다", () => {
    const open = PERKS.filter((p) => gateOpen(perkGate(p.id), emptyPips(), emptyKeys()));
    const locked = MUL_PERKS.filter((p) => !gateOpen(perkGate(p.id), emptyPips(), emptyKeys()));
    const maxOpen = Math.max(...open.map(perkValue));
    const avgLocked = locked.reduce((s, p) => s + perkValue(p), 0) / locked.length;
    expect(maxOpen, "처음부터 열린 것 중 가장 큰 것이 잠긴 것들의 평균보다 작아야 한다").toBeLessThan(
      avgLocked,
    );
  });

  it("**티어를 올릴 때마다 열리는 것이 늘어난다** — 이것이 티어를 올릴 이유다", () => {
    // 2026-08-11: 4단까지 넓혔다 — 옛 감지기(「4단은 아직 아무것도 안 연다」)가 설계대로 깨지면서
    // 이 상한을 올리라고 알려 준 그 자리다. 4단은 이제 범주당 전설 2장을 연다.
    const counts = [0, 1, 2, 3, 4].map(openCount);
    for (let t = 1; t <= 4; t += 1) {
      expect(counts[t] as number, `${t}단이 ${t - 1}단보다 많이 열려야 한다`).toBeGreaterThan(
        counts[t - 1] as number,
      );
    }
  });

  it("한 범주를 한 단 올리면 **최소 두 장**이 열린다 — 「올렸는데 아무것도 안 열렸다」가 없어야 한다", () => {
    const maxTier = 4;
    for (const cat of CATEGORIES) {
      for (let t = 1; t <= maxTier; t += 1) {
        const before = emptyPips();
        const after = emptyPips();
        if (t > 1) before[cat] = TIER_STEPS[t - 2] as number;
        after[cat] = TIER_STEPS[t - 1] as number;
        const opened = PERKS.filter(
          (p) =>
            gateOpen(perkGate(p.id), after, emptyKeys()) && !gateOpen(perkGate(p.id), before, emptyKeys()),
        );
        expect(opened.length, `${cat} ${t}단에서 열리는 카드`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("깊은 단일수록 값어치가 크다 — 「티어를 올리면 더 좋은 카드」가 참이어야 한다", () => {
    // ⚠ 규칙 특성(듀오)은 뺀다 · `perkValue` 가 못 재는 것을 평균에 섞으면 3단 평균이 0 쪽으로 끌린다.
    //   듀오가 「더 좋은 카드」인 것은 값어치 수가 아니라 **게이트 자체**(두 범주 3단)가 말한다.
    const byDepth = new Map<number, number[]>();
    for (const p of MUL_PERKS) {
      const d = gateDepth(perkGate(p.id));
      byDepth.set(d, [...(byDepth.get(d) ?? []), perkValue(p)]);
    }
    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    for (let i = 1; i < depths.length; i += 1) {
      const prev = byDepth.get(depths[i - 1] as number) as number[];
      const cur = byDepth.get(depths[i] as number) as number[];
      const avgPrev = prev.reduce((s, v) => s + v, 0) / prev.length;
      const avgCur = cur.reduce((s, v) => s + v, 0) / cur.length;
      expect(avgCur, `${depths[i]}단 평균이 ${depths[i - 1]}단보다 커야 한다`).toBeGreaterThan(avgPrev);
    }
  });

  it("열쇠를 요구하는 게이트는 그 열쇠가 없으면 안 열린다", () => {
    const gate = { key: "venom" as const, tiers: [{ cat: "herd" as const, tier: 1 }] };
    const pips = pipsAt(4);
    expect(gateOpen(gate, pips, emptyKeys())).toBe(false);
    expect(gateOpen(gate, pips, { ...emptyKeys(), venom: true })).toBe(true);
  });
});

describe("3단·4단 고유 카드 스물 (2026-08-11 · 사용자 승인)", () => {
  it("범주마다 3단 2장 · 4단 2장이다 — 칸 수는 [사용자 2026-08-10] 확정", () => {
    for (const cat of CATEGORIES) {
      const mine = CARD_RULE_PERKS.filter((p) => AXIS_CATEGORY[p.axis] === cat);
      const t3 = mine.filter((p) => gateDepth(perkGate(p.id)) === 3);
      const t4 = mine.filter((p) => gateDepth(perkGate(p.id)) === 4);
      expect(t3.length, `범주 ${cat} 의 3단 고유 카드`).toBe(2);
      expect(t4.length, `범주 ${cat} 의 4단 규칙 카드`).toBe(2);
      // 게이트는 자기 범주의 순수 티어 게이트 하나뿐이다(열쇠 게이트 금지 · 계약 지도 참조).
      for (const p of mine) {
        const gate = perkGate(p.id);
        expect(gate?.key, p.id).toBeUndefined();
        expect(gate?.tiers?.length, p.id).toBe(1);
        expect(gate?.tiers?.[0]?.cat, p.id).toBe(cat);
      }
    }
  });

  it("스무 장 전부 **대가 한 줄**을 갖는다 — 공짜 점심은 없다 [사용자 2026-08-10]", () => {
    for (const p of CARD_RULE_PERKS) {
      const cost = perkCost(p);
      expect(cost, `${p.id}: 대가가 없다`).toBeDefined();
      expect((cost as string).length, `${p.id}: 대가가 빈 문자열이다`).toBeGreaterThan(0);
      expect(cost, p.id).not.toContain("—"); // em dash 금지(문구 규칙)
    }
    // 듀오와 배수 특성은 대가 줄이 없다 — 조건(듀오는 깊은 게이트)이 곧 대가다.
    for (const p of [...DUO_RULE_PERKS, ...MUL_PERKS]) {
      expect(perkCost(p), p.id).toBeUndefined();
    }
  });

  it("문구의 수가 상수와 어긋나지 않는다 — 대표 표본(수치가 화면 표시와 다르면 거짓말)", () => {
    // 「열에 아홉」 = RIVERJAW_KILL 0.9 · 「3초」 = HAMSTRING_TICKS 90틱(30틱 = 1초) ·
    // 「40 넘게」 = SALMON_MIN_ENERGY. 전부를 못 박기보다 서로 다른 표기 세 갈래를 하나씩 박아,
    // 상수를 튜닝하면 문구도 같이 고치라고 알린다.
    expect(RIVERJAW_KILL).toBe(0.9);
    expect(HAMSTRING_TICKS / 30).toBe(3);
    expect(byId("salmonrun").gain).toContain(`${SALMON_MIN_ENERGY} 넘게`);
    expect(byId("riverjaw").gain).toContain("열에 아홉");
    expect(byId("hamstring").gain).toContain("3초");
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
    expect(perkMul(["speed_night"], "speed", day)).toBe(1);
    expect(perkMul(["speed_night"], "speed", night)).toBe(byId("speed_night").mul);
  });

  it("다른 축에는 안 걸린다", () => {
    const night = ctx({ daylight: 0 });
    expect(perkMul(["speed_night"], "vision", night)).toBe(1);
  });

  it("같은 축의 여러 특성은 곱해진다", () => {
    const night = ctx({ daylight: 0 });
    const both = perkMul(["speed_night", "speed_always"], "speed", night);
    expect(both).toBeCloseTo(mulOf("speed_night") * mulOf("speed_always"), 10);
  });

  it("같은 입력이면 같은 결과 — rng 를 안 쓴다(결정론)", () => {
    const c = ctx({ daylight: 0, tile: "grass", neighbors: 8 });
    const names: PerkName[] = ["speed_night", "vision_grass", "upkeep_crowd", "graze_grass"];
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
    const names: PerkName[] = ["speed_night", "speed_day"];
    const on = activePerks(names, night).map((p) => p.id);
    expect(on).toEqual(["speed_night"]);
    expect(perkMul(names, "speed", night)).toBe(byId("speed_night").mul);
  });
});
