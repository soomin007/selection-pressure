// 조건부 특성(perk) — **카드가 주는 것의 단일 진실.**
//
// 왜 생겼나 (2026-08-09 판 분석 · **[사용자 2026-08-08]** 승인):
//   v8 의 카드는 도장만 줬다. 그런데 성장 그릇이 「도장 100 + 열쇠 3」뿐이라 5시대짜리 런이
//   **시대 3에 그릇을 채웠다.** 채운 뒤로는 카드 100장이 전부 죽은 카드가 되어 드래프트가 통째로
//   비었고, 사용자 눈에는 화면이 고장난 것으로 보였다(판 코드 SP1-AQhqZghyMXFxZmlzeA…).
//   **[사용자 2026-08-07]** "카드에서 도장을 완전히 뺀다" · **[사용자 2026-08-08]** "카드는 유지하고
//   도장만 뺀다" → 카드는 이제 **열쇠**(없던 능력)와 **조건부 특성**(이미 있는 것이 특정 맥락에서
//   세진다) 둘만 준다. 티어는 오직 방울로만 오르므로 **성장 속도의 손잡이가 하나가 된다**
//   (지금까지는 카드와 방울이 각자 밀어서, 어느 쪽을 조여도 다른 쪽이 메웠다).
//
// 이 파일이 지키는 것 여섯:
//  ① **특성은 두 종류뿐이다.** (a) **배수 특성** = 「조건 · 축 · 배수」 · 새 sim 메커니즘을 안 만든다
//     (**[사용자 2026-07-11]** "새 형질을 만들기보다 이미 있는 형질이 그 맥락에서 작동하게 한다").
//     (b) **규칙 특성**(`rule`) = 배수로 표현이 안 되는 것 · 듀오 열 개와 **3단·4단 고유 카드 스물**이
//     여기 산다(2026-08-11 · **[사용자 2026-08-10]** "카드는 고유 효과 + 대가" · 한 장 = sim 분기 하나).
//     규칙 이름은 반드시 sim 어딘가에서 `hasRule` 로 읽혀야 한다(`perks.test.ts` 가 소스를 읽어 검사한다).
//  ② **대가는 자리마다 다르다.** 낮은 단(0~2단)의 배수 특성은 **조건 자체가 대가**라 따로 안 붙인다
//     (「밤에」는 판의 40%에서만 켜진다 · 대가를 겹치면 함정 카드다 · known_issues 「대가를 여러 개
//     겹치면」). **3단부터의 규칙 특성은 명시된 대가(`cost`) 한 겹을 반드시 갖는다** — 「공짜 점심은
//     없다 · 하이 리스크 하이 리턴」(**[사용자 2026-08-10]**). 옛 원칙 「대가를 안 붙인다」는 내(Claude)
//     판단이었고 사용자 방향과 충돌해 걷어냈다(경위: session_logs/2026-08-10.md 세션 2).
//  ③ **rng 를 한 번도 안 쓴다.** 순수 판정 + 곱셈이라 난수 스트림을 안 민다(결정론 · 기획서 §3.4).
//  ④ **특성이 없으면 배수가 정확히 1.** 야생종과 특성 0개인 종은 기존 세계와 비트 단위로 같다.
//     이게 「새 축의 기본값은 중립」(known_issues)의 이 파일판이다.
//  ⑤ **같은 특성은 한 번만 얻는다.** 중복을 허용하면 다시 「카드 운의 곱」이 되어 재설계가 무의미해진다.
//  ⑥ **화면 문구를 여기서 만든다.** 카드가 효과를 따로 적으면 언젠가 한쪽만 바뀌어 화면이 거짓말한다
//     (이 저장소가 반복해서 데인 사고 · `tiers.tierLine` 이 같은 이유로 표를 직접 읽는다).
//
// ⚠ 이 파일은 PixiJS 를 모른다(sim 순수 규칙). 화면은 여기 값을 **읽기만** 한다.

import type { Entity } from "@/sim/entity";
import type { World } from "@/sim/world";
import type { Category, Duo, KeyName, Keys, Pips } from "@/sim/tiers";
import { DUOS, DUO_BY_ID, DUO_TIER, tierOf } from "@/sim/tiers";
import { SIM } from "@/sim/params";

// ─────────────────────────────── 축 ───────────────────────────────

/**
 * 특성이 곱해질 수 있는 축 여덟. **축마다 sim 에서 곱하는 자리가 정확히 하나씩이다** —
 * 두 자리에서 곱하면 카드에 적힌 배수와 실제가 갈린다.
 *
 * ⚠ 축을 늘리려면 `behavior.ts` 에 곱하는 자리를 만드는 것이 먼저다. 여기에만 이름을 늘리면
 *   카드가 아무 일도 안 하는데 화면은 효과를 약속하는 상태가 된다.
 */
export const PERK_AXES = [
  "graze",
  "hunt",
  "speed",
  "vision",
  "upkeep",
  "defense",
  "attack",
  "fertility",
] as const;
export type PerkAxis = (typeof PERK_AXES)[number];

export interface PerkAxisInfo {
  /** 화면에 그대로 쓰는 이름. 쉬운 말만 쓴다(UI 문구 규칙). */
  label: string;
  /**
   * **낮아지는 것이 이득인 축인가.** 기운 소모만 그렇다(×0.7 = 덜 먹는다).
   * 등급 산식이 이 칸을 봐서 값어치의 방향을 맞춘다 — 안 보면 「소모 ×0.7」이 손해로 계산된다.
   */
  lower: boolean;
}

/**
 * ⚠ **`tiers.tierLine` 이 쓰는 낱말과 겹치지 않게 골랐다.** 티어 줄의 「무는 힘」·「버티는 힘」은
 * **능치**(attack·defense)의 배수인데, 특성은 물기 판정의 **결과**(피해)에 곧바로 곱한다
 * (`resolveBite` 주석 참조 · 능치를 키우면 판정이 비선형이라 카드에 적힌 수와 실제가 갈린다).
 * 같은 낱말이 두 가지를 가리키면 어휘가 갈라진다 — 이 저장소가 「관문」·「시험」에서 겪은 일이다.
 */
export const PERK_AXIS_INFO: Record<PerkAxis, PerkAxisInfo> = {
  graze: { label: "풀에서 얻는 것", lower: false },
  hunt: { label: "사냥으로 얻는 것", lower: false },
  speed: { label: "빠르기", lower: false },
  vision: { label: "보는 거리", lower: false },
  upkeep: { label: "기운 소모", lower: true },
  defense: { label: "받는 피해", lower: true },
  attack: { label: "무는 피해", lower: false },
  fertility: { label: "새끼 확률", lower: false },
};

/**
 * **범주(도장 다섯) → 그 범주가 하는 일에 해당하는 축.**
 *
 * 드래프트의 「내가 판 방향이 조금 더 자주 뜬다」(**[사용자 2026-08-06]**)가 이 표를 읽는다.
 * v8 에서는 카드가 그 범주에 도장을 주는지로 판정했는데, v9 의 카드는 도장을 안 주므로 다리를
 * 놓아야 한다 — 이빨을 판 사람에게는 무는·사냥 카드가, 무리를 판 사람에게는 새끼·함께 뜯는 카드가.
 *
 * · 가죽에 「기운 소모」를 붙인 것은 두꺼운 몸이 곧 아껴 쓰는 몸이라서다(`HIDE_METAB` 과 같은 결).
 * · 무리에 「풀에서 얻는 것」을 붙인 것은 초식 무리가 이 저장소의 실제 빌드라서다
 *   (이빨 0단 = 풀 효율 1.0 · 초식 거인 경로 · **[사용자 2026-08-06]**).
 * ⚠ 이건 **등장 확률만 손대는 표다**(은근한 보정의 경계 그대로 · 효과·수치는 불가침).
 */
export const CATEGORY_AXES: Record<Category, readonly PerkAxis[]> = {
  fang: ["attack", "hunt"],
  leg: ["speed"],
  eye: ["vision"],
  hide: ["defense", "upkeep"],
  herd: ["fertility", "graze"],
};

/**
 * 위 표의 역방향 — **축이 속한 범주.** 카드 색·정렬이 쓴다(이빨 축 카드는 이빨 색).
 * 표에서 유도하므로 둘이 어긋날 수 없다(축 하나는 정확히 한 범주에만 속한다 · 테스트가 지킨다).
 */
export const AXIS_CATEGORY: Record<PerkAxis, Category> = (() => {
  const out = {} as Record<PerkAxis, Category>;
  for (const cat of Object.keys(CATEGORY_AXES) as Category[]) {
    for (const axis of CATEGORY_AXES[cat]) out[axis] = cat;
  }
  return out;
})();

// ─────────────────────────────── 조건 ───────────────────────────────

/** 특성이 켜지는 때. 이 조건이 곧 대가다(늘 켜지는 것은 그만큼 배수가 작다). */
export const PERK_WHENS = [
  "always",
  "night",
  "day",
  "shore",
  "grass",
  "rough",
  "hungry",
  "full",
  "alone",
  "crowd",
  "hunting",
  "fleeing",
  "wounded",
] as const;
export type PerkWhen = (typeof PERK_WHENS)[number];

export interface PerkWhenInfo {
  /** 화면에 쓰는 조건 한 마디. 「늘」은 빈 문자열이라 효과만 적힌다. */
  label: string;
  /**
   * **이 조건이 성립하는 시간 비율** — 등급 산식(`perkValue`)의 밑이다.
   *
   * ⚠ **낮·밤만 계산값이고 나머지는 전부 추정이다.** 추정이라고 여기 적어 두는 이유는, 이 저장소가
   *   「잘못된 자로 잰 값을 근거로 튜닝」하는 사고를 네 번 겪었기 때문이다(known_issues 참조).
   *   프로브로 실측하기 전까지 이 수를 **밸런스 근거로 인용하지 마라** — 지금 하는 일은 등급을
   *   서로 견주는 것뿐이고, 그건 추정으로도 순서가 지켜진다.
   */
  freq: number;
  /** 왜 그 값인가. 재측정할 사람이 근거를 알아야 한다. */
  note: string;
}

/**
 * 밤/낮 문턱. `world.daylight = 0.5 + 0.5·cos(2π·하루진행도)` 이므로 비율이 정확히 나온다:
 * · 밤(0.35 미만) = 하루의 **40.3%** · 낮(0.65 이상) = **39.7%** · 나머지 20%는 어스름(둘 다 아님).
 * 어스름을 비워 둔 것은 일부러다 — 「밤 특성」과 「낮 특성」이 동시에 켜지는 순간이 없어야
 * 화면에서 무엇이 켜졌는지 읽힌다.
 */
export const NIGHT_LIGHT = 0.35;
export const DAY_LIGHT = 0.65;

/** 배가 절반 아래면 「배고플 때」, 넉넉하면 「기운이 넉넉할 때」. 사이는 둘 다 아니다(위와 같은 이유). */
export const HUNGRY_AT = 0.5;
export const FULL_AT = 0.8;

/** 3×3 칸의 동료 수(자기 포함)로 「혼자」와 「무리 속」을 가른다. */
export const ALONE_MAX = 2;
export const CROWD_MIN = 6;

/** 물가의 정의 — 이 거리 안에 물 타일이 있으면 물가다(네 방향만 본다 · 순수 기하). */
export const SHORE_REACH = 1;

export const PERK_WHEN_INFO: Record<PerkWhen, PerkWhenInfo> = {
  always: { label: "", freq: 1.0, note: "조건 없음" },
  night: { label: "밤에", freq: 0.403, note: "daylight < 0.35 = 하루의 40.3% (계산값)" },
  day: { label: "낮에", freq: 0.397, note: "daylight >= 0.65 = 하루의 39.7% (계산값)" },
  shore: { label: "물가에서", freq: 0.15, note: "추정 · 맵 종류에 따라 크게 다르다(군도 > 대륙)" },
  grass: { label: "수풀에서", freq: 0.23, note: "실측 · known_issues 「수풀 체류율 23%(가만둘 때)」" },
  rough: { label: "험한 땅에서", freq: 0.12, note: "추정 · 험지는 표고 분위수로 잘린 좁은 띠다" },
  hungry: { label: "배가 절반 아래일 때", freq: 0.35, note: "추정 · 미측정" },
  full: { label: "기운이 넉넉할 때", freq: 0.25, note: "추정 · 번식 문턱(78)과 겹치는 구간" },
  alone: { label: "곁에 동료가 적을 때", freq: 0.2, note: "추정 · 무리 티어가 높을수록 드물어진다" },
  crowd: { label: "곁에 동료가 많을 때", freq: 0.3, note: "추정 · 무리 티어가 높을수록 잦아진다" },
  hunting: { label: "쫓는 동안", freq: 0.08, note: "추정 · 사냥은 판에 5~10번뿐인 드문 사건이다" },
  fleeing: { label: "달아나는 동안", freq: 0.1, note: "추정 · 미측정" },
  wounded: { label: "물린 뒤 얼마간", freq: 0.05, note: "추정 · woundTicks 가 살아 있는 동안" },
};

// ─────────────────────────────── 조건 판정 ───────────────────────────────

/**
 * 조건을 판정하는 데 필요한 것 전부. **`stepEntity` 가 개체마다 한 번 만들어 돌려 쓴다.**
 *
 * ⚠ 여기 없는 것은 조건으로 쓸 수 없다. 새 조건이 새 상태를 요구하면 그 상태를 먼저 이 칸에
 *   올려야 하고, 그때 「누가 그것을 채우는가」가 분명해진다(프로브가 반쯤 만든 세계를 재던
 *   사고의 예방책 · known_issues 「프로브 order 모드가 목소리 반경을 안 세워」).
 */
export interface PerkCtx {
  readonly world: World;
  readonly e: Entity;
  /** 지금 사냥감을 쫓는 중인가(`targetPrey !== null`). */
  readonly hunting: boolean;
  /** 지금 도망 중인가(`computeFlee` 가 방향을 냈는가). */
  readonly fleeing: boolean;
  /** 3×3 칸의 이웃 수(자기 포함). 이웃 정보가 없으면 1. */
  readonly neighbors: number;
}

/**
 * 이 개체의 맥락. **sim 의 모든 호출부가 이 함수 하나로 만든다** — 조건이 자리마다 다르게 채워지면
 * 같은 특성이 자리마다 다르게 켜지고, 그건 화면이 못 설명하는 세계다.
 *
 * ⚠ 「달아나는 동안」·「곁에 동료가」는 개체에 남겨 둔 **한 틱 전 값**을 읽는다(`entity.fleeing` ·
 *   `entity.neighbors`). 이유는 순환이다: 도망 여부를 알려면 도망 방향을 계산해야 하고, 그 계산에는
 *   이미 특성이 곱해진 최고 속도가 필요하다. 한 틱(약 33ms)은 사람 눈에 안 보이고, 도망은 여러 틱
 *   이어지므로 실질적으로 정확하다. 대신 **도망을 시작한 첫 틱에는 안 켜진다** — 그 편이 「도망
 *   속도를 재느라 도망 여부를 두 번 계산하는」 것보다 단순하고, 무엇보다 rng 를 안 건드린다.
 */
export function perkCtxOf(e: Entity, world: World): PerkCtx {
  return { world, e, hunting: e.targetPrey !== null, fleeing: e.fleeing, neighbors: e.neighbors };
}

/**
 * 물가인가 — 네 방향으로 타일 하나씩 짚어 물이 있는지 본다. rng 미사용(결정론 안전).
 * export 인 이유: 「물가의 매복자」의 물기 판정(`behavior.resolveBite`)이 **같은 판정**을 써야
 * 카드의 「물가에서」와 화면의 「지금 켜짐」이 한 글자도 안 갈린다(두 곳에 적으면 어긋난다).
 */
export function nearShore(world: World, x: number, y: number): boolean {
  const r = world.terrain.cellSize * SHORE_REACH;
  return (
    world.terrain.isWater(x + r, y) ||
    world.terrain.isWater(x - r, y) ||
    world.terrain.isWater(x, y + r) ||
    world.terrain.isWater(x, y - r)
  );
}

const WHEN_TEST: Record<PerkWhen, (c: PerkCtx) => boolean> = {
  always: () => true,
  night: (c) => c.world.daylight < NIGHT_LIGHT,
  day: (c) => c.world.daylight >= DAY_LIGHT,
  shore: (c) => nearShore(c.world, c.e.x, c.e.y),
  grass: (c) => c.world.terrain.isGrass(c.e.x, c.e.y),
  rough: (c) => c.world.terrain.isRough(c.e.x, c.e.y),
  hungry: (c) => c.e.energy < SIM.maxEnergy * HUNGRY_AT,
  full: (c) => c.e.energy >= SIM.maxEnergy * FULL_AT,
  alone: (c) => c.neighbors <= ALONE_MAX,
  crowd: (c) => c.neighbors >= CROWD_MIN,
  hunting: (c) => c.hunting,
  fleeing: (c) => c.fleeing,
  wounded: (c) => c.e.woundTicks > 0,
};

/** 이 조건이 지금 성립하는가. 화면(「지금 켜진 특성」)과 sim 이 **같은 함수**를 부른다. */
export function whenHolds(when: PerkWhen, ctx: PerkCtx): boolean {
  return WHEN_TEST[when](ctx);
}

// ─────────────────────────────── 카드가 열리는 자리(게이트) ───────────────────────────────
//
// **[사용자 2026-08-10]** "티어를 올리면 더 좋은 카드, 더 특별한 카드들이 열려서 그걸 위해 티어를
// 올리는 거고, 그에 따라오는 티어 자체의 보상은 카드에 비해서는 소소한 정도였는데."
//
// 그래서 티어의 첫 번째 값어치는 파생 능치가 아니라 **카드를 여는 것**이다. 게이트 하나로 세 가지를
// 전부 표현한다 — 형태가 하나라 드래프트 필터도 화면 예고도 한 함수만 부른다:
//   · 보통 카드   `{ tiers: [{ cat: "fang", tier: 2 }] }`            이빨 II 에서 열린다
//   · 듀오 카드   `{ tiers: [{ cat:"fang",tier:3 }, { cat:"leg",tier:3 }] }`  둘 다 III 이어야
//   · 열쇠 듀오   `{ key: "venom", tiers: [{ cat: "herd", tier: 3 }] }`       독니 + 무리 III
// 게이트가 없으면(`undefined`) 처음부터 열려 있다.
export interface PerkGate {
  /** 이 범주들이 **각각** 이 단 이상이어야 한다. 둘이면 듀오다. */
  readonly tiers?: readonly { readonly cat: Category; readonly tier: number }[];
  /** 이 열쇠를 가지고 있어야 한다. */
  readonly key?: KeyName;
}

/**
 * 이 카드가 지금 열려 있는가. **드래프트 필터와 화면의 해금 예고가 같은 함수를 쓴다** —
 * 두 곳에 조건을 적으면 「열린다고 적혀 있는데 안 뜨는」 카드가 생긴다.
 */
export function gateOpen(gate: PerkGate | undefined, pips: Pips, keys: Keys): boolean {
  if (gate === undefined) return true;
  if (gate.key !== undefined && !keys[gate.key]) return false;
  for (const need of gate.tiers ?? []) {
    if (tierOf(pips[need.cat]) < need.tier) return false;
  }
  return true;
}

/** 이 게이트가 요구하는 가장 깊은 단 — 등급 산정과 정렬에 쓴다(깊을수록 귀하다). */
export function gateDepth(gate: PerkGate | undefined): number {
  if (gate === undefined) return 0;
  let d = 0;
  for (const need of gate.tiers ?? []) d = Math.max(d, need.tier);
  // 열쇠는 그 자체로 한 단계 더 귀하다(열쇠 상한이 3개라 아무나 못 가진다).
  return gate.key === undefined ? d : d + 1;
}

// ─────────────────────────────── 특성 목록 ───────────────────────────────

/**
 * **규칙 특성의 이름** · 배수로 표현이 안 되는 것. 듀오 열 개(이름이 듀오 id 와 글자까지 같다 ·
 * `tiers.DUOS`)와 **3단·4단 고유 카드 스물**(2026-08-11 · 사용자 승인 목록)이 여기 산다.
 *
 * ⚠ **여기 이름을 늘리면 sim 에 `hasRule(perks, "그이름")` 을 부르는 자리가 반드시 있어야 한다.**
 *   `perks.test.ts` 가 `behavior.ts`·`boss.ts`·`world.ts` 를 읽어 그것을 검사한다 · 적어만 놓고 안 만든
 *   규칙은 「카드에 적힌 것이 세계에서 아무 일도 안 하는」 상태이고, 그건 이 저장소가 금지한 거짓말이다.
 */
export const PERK_RULES = [
  "pounce",
  "wolflaw",
  "ring",
  "seefirst",
  "sentinel",
  "charge",
  "ambush",
  "stone",
  "bigjaw",
  "wave",
  // ── 3단 고유 카드 열 (2026-08-11) ──────────────────────────────────────
  "famished",
  "riverjaw",
  "hamstring",
  "zebrakick",
  "eyespot",
  "noshine",
  "pangolin",
  "newflesh",
  "bloodgift",
  "greenwake",
  // ── 4단 규칙 카드 열 (2026-08-11 · 등급 전설) ──────────────────────────
  "carrion",
  "ratel",
  "footsteps",
  "shedtail",
  "cull",
  "transfix",
  "undying",
  "mountain",
  "salmonrun",
  "feverscar",
] as const;
export type PerkRule = (typeof PERK_RULES)[number];

interface PerkDef {
  id: string;
  /** 카드 이름이자 내 종 패널의 이름. 카드가 따로 이름을 안 갖는다(두 곳에 적지 않는다). */
  name: string;
  /** 플레이버 한 줄. **효과를 여기 적지 않는다** — 효과는 `perkLine` 이 표에서 만든다. */
  flavor: string;
  when: PerkWhen;
  /**
   * 이 특성이 속한 축. **규칙 특성에게는 배수의 자리가 아니라 「어느 범주의 카드인가」의 자리다**
   * (카드 색·정렬·드래프트 보정이 `AXIS_CATEGORY[axis]` 로 범주를 읽는다). 규칙 특성은 축에
   * 아무것도 안 곱하므로, 여기 무엇이 오든 세계는 안 움직인다.
   */
  axis: PerkAxis;
  /** 곱해지는 배수. **규칙 특성에는 없다.** 「기운 소모」만 1 아래가 이득이다(`PERK_AXIS_INFO.lower`). */
  mul?: number;
  /** 규칙 특성이면 그 규칙 이름. sim 은 `hasRule(perks, 이름)` 으로만 묻는다. */
  rule?: PerkRule;
  /** 규칙 특성이 화면에 뜨는 한 줄(듀오의 `desc` 를 그대로 쓴다). 배수 특성은 `perkLine` 이 만든다. */
  gain?: string;
  /**
   * **명시된 대가 한 줄** — 3단·4단 고유 카드만 갖는다(**[사용자 2026-08-10]** "공짜 점심은 없다").
   * 효과(`gain`)처럼 자립형이고, 적힌 수는 sim 상수와 글자까지 같아야 한다(제1 규칙).
   * ⚠ **글로만 있는 대가는 거짓말이다** — cost 를 적었으면 sim 에 그 대가를 실제로 무는 분기가
   *   반드시 있어야 한다(`perks.test.ts` 가 gain 과 같은 잣대로 지킨다).
   */
  cost?: string;
}

/**
 * 배수 특성 서른여섯(2026-08-11 · 옛 3단 열 장을 지우고 도전 과제 보상 「바위 살갗」만 남았다).
 * **등급은 여기 안 적는다** — `perkRarity` 가 「조건 성립 빈도 × 효과 크기」로
 * 계산한다. 손으로 적으면 배수를 튜닝할 때마다 등급이 조용히 거짓이 된다.
 *
 * 축 여덟에 고르게 뿌렸다(축마다 5~6). 한 축만 두꺼우면 그 축을 안 파는 빌드에게 드래프트의
 * 절반이 죽은 카드가 된다 — 도장 시절에 겪은 것과 같은 병이다.
 */
const PERK_DEFS = [
  // ── 풀에서 얻는 것 ─────────────────────────────────────────────────────
  { id: "graze_day", name: "낮의 풀", flavor: "해가 있을 때 부지런히 뜯습니다.", when: "day", axis: "graze", mul: 1.16 },
  { id: "graze_crowd", name: "함께 뜯기", flavor: "여럿이 붙어 뜯으면 좋은 자리를 서로 알려 줍니다.", when: "crowd", axis: "graze", mul: 1.25 },
  { id: "graze_grass", name: "수풀의 미식가", flavor: "덤불 속의 연한 것만 골라 먹습니다.", when: "grass", axis: "graze", mul: 1.45 },
  { id: "graze_shore", name: "물가의 풀", flavor: "물을 낀 땅의 풀은 늘 무성합니다.", when: "shore", axis: "graze", mul: 1.75 },
  { id: "graze_hungry", name: "허기가 부지런을 만든다", flavor: "배가 고프면 없던 자리에서도 찾아냅니다.", when: "hungry", axis: "graze", mul: 1.5 },

  // ── 사냥으로 얻는 것 ───────────────────────────────────────────────────
  { id: "hunt_always", name: "남김없이", flavor: "뼈에 붙은 것까지 발라 먹습니다.", when: "always", axis: "hunt", mul: 1.07 },
  { id: "hunt_hungry", name: "굶주린 뱃속", flavor: "곯은 배가 더 많이 받아들입니다.", when: "hungry", axis: "hunt", mul: 1.2 },
  { id: "hunt_night", name: "밤 사냥", flavor: "잠든 것은 저항하지 않습니다.", when: "night", axis: "hunt", mul: 1.3 },

  // ── 무는 힘 ────────────────────────────────────────────────────────────
  { id: "attack_always", name: "굳은 턱", flavor: "턱뼈가 두꺼워집니다.", when: "always", axis: "attack", mul: 1.05 },
  { id: "attack_hunting", name: "쫓는 이빨", flavor: "달리는 중에 무는 첫 입이 가장 깊습니다.", when: "hunting", axis: "attack", mul: 1.75 },
  { id: "attack_night", name: "밤의 이빨", flavor: "어둠 속에서 먼저 뭅니다.", when: "night", axis: "attack", mul: 1.25 },
  { id: "attack_crowd", name: "함께 무는 법", flavor: "하나가 물면 둘이 붙습니다.", when: "crowd", axis: "attack", mul: 1.4 },
  { id: "attack_hungry", name: "굶주린 턱", flavor: "굶은 짐승의 이빨이 가장 무섭습니다.", when: "hungry", axis: "attack", mul: 1.5 },

  // ── 받는 피해 ──────────────────────────────────────────────────────────
  // ⚠ 이 축만 **1 아래가 이득**이다(기운 소모와 같다). 「받는 피해 ×0.67」이 곧 「1.5배 버틴다」인데,
  //   화면에는 **실제로 곱해지는 수**를 적는다 — 「1.5배」라 적고 0.67 을 곱하면 거짓말이다.
  { id: "defense_always", name: "질긴 살", flavor: "살이 질겨 이빨이 잘 안 들어갑니다.", when: "always", axis: "defense", mul: 0.95 },
  { id: "defense_fleeing", name: "달아나는 등", flavor: "등을 보이고 뛰는 동안 급소를 감춥니다.", when: "fleeing", axis: "defense", mul: 0.63 },
  { id: "defense_grass", name: "수풀이 막아 준다", flavor: "덤불이 이빨을 한 번 걸러 줍니다.", when: "grass", axis: "defense", mul: 0.67 },
  { id: "defense_wounded", name: "물린 자리가 굳는다", flavor: "한 번 물린 곳은 쉽게 안 뚫립니다.", when: "wounded", axis: "defense", mul: 0.3 },
  { id: "defense_crowd", name: "등을 맞대고", flavor: "바깥을 보고 둘러서면 안쪽이 안전합니다.", when: "crowd", axis: "defense", mul: 0.67 },
  // ⚠ 「바위 살갗」만 옛 3단 배수 카드 중 유일하게 살아남았다(2026-08-11) — 도전 과제 「거인의 태동」의
  //   보상 카드라서다(achievements.ts · 과제로만 열린다). 풀에서 유일한 「아주 귀함」 배수 카드.
  { id: "defense_rock", name: "바위 살갗", flavor: "살갗이 돌처럼 굳습니다.", when: "always", axis: "defense", mul: 0.79 },

  // ── 빠르기 ─────────────────────────────────────────────────────────────
  { id: "speed_always", name: "긴 정강이", flavor: "한 걸음이 멀어집니다.", when: "always", axis: "speed", mul: 1.05 },
  { id: "speed_day", name: "해 있을 때의 걸음", flavor: "밝을 때 부지런히 움직입니다.", when: "day", axis: "speed", mul: 1.16 },
  { id: "speed_crowd", name: "발맞춤", flavor: "여럿이 함께 가면 걸음이 붙습니다.", when: "crowd", axis: "speed", mul: 1.25 },
  { id: "speed_shore", name: "물가를 달린다", flavor: "젖은 모래는 단단해 잘 튀어 오릅니다.", when: "shore", axis: "speed", mul: 1.75 },
  { id: "speed_rough", name: "험한 땅의 걸음", flavor: "돌밭을 평지처럼 딛습니다.", when: "rough", axis: "speed", mul: 1.5 },
  { id: "speed_night", name: "밤길", flavor: "어두워도 걸음을 안 줄입니다.", when: "night", axis: "speed", mul: 1.25 },
  { id: "speed_hungry", name: "굶주린 추격", flavor: "배가 고프면 다리가 먼저 움직입니다.", when: "hungry", axis: "speed", mul: 1.35 },

  // ── 보는 거리 ──────────────────────────────────────────────────────────
  { id: "vision_always", name: "높이 든 고개", flavor: "고개를 들고 오래 봅니다.", when: "always", axis: "vision", mul: 1.06 },
  { id: "vision_full", name: "느긋한 눈", flavor: "배가 부르면 주위를 천천히 살핍니다.", when: "full", axis: "vision", mul: 1.3 },
  { id: "vision_rough", name: "높은 데서 본다", flavor: "돌밭 위에 올라서서 멀리 봅니다.", when: "rough", axis: "vision", mul: 1.9 },
  { id: "vision_shore", name: "트인 물가", flavor: "물 위는 가리는 것이 없습니다.", when: "shore", axis: "vision", mul: 1.75 },
  { id: "vision_alone", name: "혼자 서는 파수", flavor: "곁에 아무도 없으면 스스로 살핍니다.", when: "alone", axis: "vision", mul: 1.3 },
  { id: "vision_grass", name: "수풀 너머", flavor: "덤불 사이로 보는 법을 익힙니다.", when: "grass", axis: "vision", mul: 1.55 },
  { id: "vision_day", name: "맑은 낮", flavor: "밝을 때 가장 멀리 봅니다.", when: "day", axis: "vision", mul: 1.3 },

  // ── 기운 소모 ──────────────────────────────────────────────────────────
  { id: "upkeep_always", name: "아끼는 몸", flavor: "쓸데없는 데 기운을 안 씁니다.", when: "always", axis: "upkeep", mul: 0.95 },
  { id: "upkeep_full", name: "비축한 몸", flavor: "배가 부를 때 남은 것을 갈무리합니다.", when: "full", axis: "upkeep", mul: 0.8 },
  { id: "upkeep_grass", name: "수풀의 그늘", flavor: "덤불 그늘에서는 덜 지칩니다.", when: "grass", axis: "upkeep", mul: 0.7 },
  { id: "upkeep_night", name: "밤의 휴식", flavor: "어두우면 움직임을 줄이고 쉽니다.", when: "night", axis: "upkeep", mul: 0.7 },
  { id: "upkeep_crowd", name: "붙어 자는 밤", flavor: "몸을 맞대면 덜 춥습니다.", when: "crowd", axis: "upkeep", mul: 0.65 },

  // ── 새끼 확률 ──────────────────────────────────────────────────────────
  { id: "fertility_always", name: "잦은 출산", flavor: "새끼 보는 날이 잦아집니다.", when: "always", axis: "fertility", mul: 1.06 },
  { id: "fertility_day", name: "긴 낮", flavor: "해가 긴 철에 새끼를 칩니다.", when: "day", axis: "fertility", mul: 1.16 },
  { id: "fertility_grass", name: "수풀의 보금자리", flavor: "덤불 안쪽에 자리를 봅니다.", when: "grass", axis: "fertility", mul: 1.5 },
  { id: "fertility_full", name: "배부른 어미", flavor: "기운이 넉넉해야 새끼를 칩니다.", when: "full", axis: "fertility", mul: 1.7 },
] as const satisfies readonly PerkDef[];
// ⚠ **옛 3단 배수 카드 열 장은 2026-08-11 에 지웠다**(혼자 먹는 몫 · 배불리 먹는 법 · 쫓을 때의 걸음 ·
//   죽을힘 · 밤눈 · 지평선을 보는 눈 · 바위 살갗 · 느린 신진대사 · 함께 기른다 · 되새김).
//   **[사용자 2026-08-10]** "다 너무 ~할 때 ~ 몇 배 이런 식이라 직관적이지도 않고 매력도 없네" ·
//   그 자리는 아래 RULE_CARD_DEFS(고유 효과 + 대가)가 잇는다. 옛 저장 데이터의 그 이름들은
//   게놈 마이그레이션이 조용히 버린다(모르는 이름 무시 · v9 규칙 그대로).

// ─────────────────────────────── 듀오 = 규칙 특성 열 개 ───────────────────────────────
//
// **[사용자 2026-08-10]** 의 「티어를 올리면 카드가 열린다」 구조에서 듀오만 혼자 자동 발동이었다.
// 카드로 옮기면 **고르는 순간**이 생기고, 「켜진 순간의 연출이 없다」는 오래된 결함이 통째로 사라진다
// (backlog 「듀오 열 개 중 셋은 아직 화면에서 안 읽힌다」).
//
// **이름·설명은 여기 안 적는다.** `tiers.DUOS` 의 `name`·`desc`·`flavor` 를 그대로 읽어 쓴다 —
// 옮겨 적으면 언젠가 한쪽만 바뀌어 대백과와 카드가 다른 말을 하게 된다(이 저장소가 반복해서 데인 사고).
//
// **`axis` 는 「어느 범주의 카드로 보이는가」만 정한다.** 듀오는 범주 둘에 걸쳐 있어 색이 하나뿐인
// 화면(카드 테두리·칩)에서는 둘 중 하나를 골라야 한다. 열 개를 **범주마다 정확히 둘씩** 나눠 가지게
// 배분했다(K5 의 변 열 개를 꼭짓점마다 둘씩 · `perks.test.ts` 가 이 균형을 검사한다). 안 그러면
// 「가죽을 판 사람에게 열리는 듀오 카드가 넷, 다리를 판 사람에게 하나」처럼 기운다.
const DUO_PERK_DEFS = [
  { id: "duo_pounce", rule: "pounce", axis: "attack", when: "always" },
  { id: "duo_ambush", rule: "ambush", axis: "attack", when: "always" },
  { id: "duo_charge", rule: "charge", axis: "speed", when: "always" },
  { id: "duo_wave", rule: "wave", axis: "speed", when: "always" },
  { id: "duo_seefirst", rule: "seefirst", axis: "vision", when: "always" },
  { id: "duo_sentinel", rule: "sentinel", axis: "vision", when: "always" },
  { id: "duo_stone", rule: "stone", axis: "defense", when: "always" },
  { id: "duo_bigjaw", rule: "bigjaw", axis: "upkeep", when: "always" },
  { id: "duo_wolflaw", rule: "wolflaw", axis: "graze", when: "always" },
  { id: "duo_ring", rule: "ring", axis: "fertility", when: "always" },
] as const satisfies readonly { id: string; rule: PerkRule; axis: PerkAxis; when: PerkWhen }[];

// ─────────────────────────── 3단·4단 고유 카드 스물 (2026-08-11 · 사용자 승인) ───────────────────────────
//
// **[사용자 2026-08-10]** "카드는 고유 효과 + 대가" · "'공짜 점심은 없다'와 '하이 리스크 하이 리턴'" ·
// 설계자 5 + 심판 3(취향·구현·전달) 워크플로에서 후보 37장 중 선발, 2026-08-11 사용자 승인.
// 3단 = 아주 귀함(범주당 2) · 4단 = **전설**(범주당 2 · 규칙을 바꾸는 카드).
//
// **수치는 전부 아래 상수에서 나온다.** 카드 글자와 sim 이 같은 상수를 읽어야 「수치가 화면 표시와
// 다르면 거짓말」 규칙이 원리적으로 안 깨진다. 문장 속 말수(「절반」 「열에 아홉」)는 상수와의 일치를
// `perks.test.ts` 가 못 박는다.
//
// **[사용자 2026-08-11]** "능력이 있으면 그걸 활용할 줄도 알아야지" — 행동이 달라져야 뜻이 사는
// 카드는 행동 분기까지가 카드다: 굶주린 사냥꾼(배부르면 사냥을 안 시작한다) · 썩은 고기를 먹는 위
// (사체를 먹이 목표로 삼아 걸어간다) · 숨통을 보는 눈(가장 가까운 놈이 아니라 다 죽어 가는 놈을
// 고른다) · 물가의 매복자(사냥감을 고를 때 물가 쪽을 우선한다).

/** 굶주린 사냥꾼 · 배가 절반 아래면 물 수 있는 거리가 이만큼 늘어난다. */
export const FAMISHED_RANGE_MUL = 2;
/** 물가의 매복자 · 물가에서 무는 즉사 확률(고정 · 「열에 아홉」). */
export const RIVERJAW_KILL = 0.9;
/** 물가의 매복자 · 물가 밖에서 무는 피해 배수(「절반」). */
export const RIVERJAW_AWAY_MUL = 0.5;
/** 썩은 고기를 먹는 위 · 갓 잡은 사냥 수입 배수(「절반」). */
export const CARRION_FRESH_MUL = 0.5;
/** 벌꿀오소리의 맞물기 · 반사량 = 내 무는 피해 × 이 값(「절반」). */
export const RATEL_REFLECT = 0.5;
/** 벌꿀오소리의 맞물기 · 달아나는 동안 걸음 배수(「30% 줄어든다」). */
export const RATEL_FLEE_MUL = 0.7;
/** 힘줄을 무는 법 · 절뚝임 지속 틱(「3초」 · sim 30틱 = 1초). */
export const HAMSTRING_TICKS = 90;
/** 힘줄을 무는 법 · 절뚝이는 걸음 배수(「절반」). */
export const HAMSTRING_SLOW = 0.5;
/** 힘줄을 무는 법 · 내 무는 피해 배수(「절반」). */
export const HAMSTRING_DMG_MUL = 0.5;
/** 얼룩말의 뒷발질 · 달아나는 빠르기 배수(「20% 줄어든다」). */
export const ZEBRA_FLEE_MUL = 0.8;
/** 따라오는 발소리 · 상대 현재 걸음에 대한 내 걸음 하한 배수(「반 걸음 빠르다」). */
export const FOOTSTEPS_EDGE = 1.05;
/** 꼬리 자르기 · 빠져나올 때의 기운(최대 기운 대비 · 「4분의 1」). */
export const SHEDTAIL_ENERGY = 0.25;
/** 꼬리 자르기 · 꼬리 잃은 걸음 배수(「20% 줄어든다」). */
export const SHEDTAIL_SLOW = 0.8;
/** 꼬리 자르기 · 꼬리를 먹느라 멈추는 시간(공격자 쿨타임 배수). */
export const SHEDTAIL_EAT_CD_MUL = 3;
/** 꼬리 자르기 · 공격자가 꼬리를 먹느라 실제로 멈춰 서는 틱(「멈춥니다」가 화면에서 참말이 되는 근거). */
export const SHEDTAIL_EAT_TICKS = 30;
/** 등에 그린 눈 · 안 다친 개체가 받는 피해 배수(「절반」). */
export const EYESPOT_DMG_MUL = 0.5;
/** 등에 그린 눈 · 포식자가 알아채는 거리 배수(「1.3배 멀리서」). */
export const EYESPOT_SEEN_MUL = 1.3;
/** 빛나지 않는 눈 · 밤에 사냥감이 이쪽을 알아채는 거리 배수(「절반」). */
export const NOSHINE_STEALTH = 0.5;
/** 빛나지 않는 눈 · 쫓는 동안 내 위협 감지 거리 배수(「절반」). */
export const NOSHINE_GUARD = 0.5;
/** 숨통을 보는 눈 · 처형 문턱(기본 기운 `SIM.maxEnergy` 대비 · 「4분의 1」).
 *  ⚠ 개체별 상한(maxEnergyFor)이 아니라 **화면 기운 선과 같은 밑**을 쓴다 — 막대가 4분의 1 아래로
 *  보일 때 정확히 발동해야 화면이 참말을 한다(검증 지적 · 육식 상대 기준 불일치). */
export const CULL_THRESHOLD = 0.25;
/** 숨통을 보는 눈 · 문턱 위의 상대에게 무는 피해 배수(「절반」). */
export const CULL_DMG_MUL = 0.5;
/** 뱀의 응시 · 상대가 얼어붙는 틱(「1초」). */
export const TRANSFIX_FREEZE_TICKS = 30;
/** 뱀의 응시 · 이쪽이 굳는 틱(「반 초」). */
export const TRANSFIX_SELF_TICKS = 15;
/** 천산갑의 비늘 · 나를 문 상대의 다음 물기까지 걸리는 시간 배수(「두 배」). */
export const PANGOLIN_CD_MUL = 2;
/** 천산갑의 비늘 · 내가 무는 피해 배수(「절반」). */
export const PANGOLIN_DMG_MUL = 0.5;
/** 돋는 새살 · 잃은 기운 중 돌아오는 몫(「절반」). 회복 속도는 남은 상처 시간에 비례해
 *  아무는 순간 정확히 다 돌아온다(고정 속도로 하면 큰 피해의 「절반」이 잘려 거짓말이 된다 · 검증 지적). */
export const NEWFLESH_SHARE = 0.5;
/** 죽지 않는 것 · 되살아날 때의 기운(최대 기운 대비 · 「절반」). */
export const UNDYING_ENERGY = 0.5;
/** 산 같은 몸 · 물기 한 번의 피해 상한(기본 기운 `SIM.maxEnergy` 대비 · 「4분의 1」 ·
 *  CULL_THRESHOLD 와 같은 이유로 화면 기운 선과 같은 밑을 쓴다). */
export const MOUNTAIN_CAP = 0.25;
/** 산 같은 몸 · 기운 소모 배수(「1.3배」). */
export const MOUNTAIN_UPKEEP = 1.3;
/** 입에서 입으로 · 받는 쪽이 틱당 얻는 기운. 주는 쪽은 그 두 배를 잃는다(「절반이 샌다」). */
export const BLOODGIFT_GIVE = 0.2;
/** 입에서 입으로 · 주는 쪽 손실 배수(「받는 것의 두 배」). */
export const BLOODGIFT_LOSS_MUL = 2;
/** 푸른 발자국 · 뜯은 풀자리의 재생 시간 배수(「두 배 빨리」). */
export const GREENWAKE_REGROW = 0.5;
/** 푸른 발자국 · 한 입에서 얻는 것 배수(「20% 줄어든다」). */
export const GREENWAKE_GAIN = 0.8;
/** 연어의 귀향 · 새끼가 태어나는 최소 잔여 기운(「40」). */
export const SALMON_MIN_ENERGY = 40;
/** 연어의 귀향 · 새끼가 받는 몫(「절반」). */
export const SALMON_SHARE = 0.5;
/** 연어의 귀향 · 살아 있는 몸의 새끼 확률 배수(「절반」). */
export const SALMON_FERT_MUL = 0.5;
/** 열병의 흉터 · 앓아 넘길 때 남는 기운의 몫(「3분의 2를 잃는다」 = 3분의 1이 남는다). */
export const FEVER_KEEP = 1 / 3;

/**
 * 고유 카드 스물. 듀오와 달리 이름·문구가 다른 표에 없으므로 여기가 단일 진실이다.
 * `cost` 는 반드시 sim 에 그 대가를 실제로 무는 분기가 있어야 한다(글로만 있는 대가는 거짓말).
 */
const RULE_CARD_DEFS = [
  // ── 이빨 3단 ──────────────────────────────────────────────────────────
  {
    id: "famished",
    name: "굶주린 사냥꾼",
    flavor: "굶은 늑대는 엄두도 못 낼 거리에서 달려들고, 배부른 사자는 코앞의 얼룩말을 지나칩니다.",
    when: "hungry",
    axis: "hunt",
    rule: "famished",
    gain: "배가 절반 아래일 때는 물 수 있는 거리가 2배가 됩니다.",
    cost: "기운이 넉넉할 때는 사냥감을 알아보지 못합니다. 스스로 사냥을 시작하지 않고, 쫓던 것도 놓아줍니다.",
  },
  {
    id: "riverjaw",
    name: "물가의 매복자",
    flavor: "나일악어. 물가에서는 가장 무서운 턱, 물에서 멀어지면 둔한 짐승입니다.",
    when: "shore",
    axis: "attack",
    rule: "riverjaw",
    gain: "물가에서 문 이빨은 급소로 가, 열에 아홉은 단숨에 끝냅니다. 사냥감도 물가 쪽부터 고릅니다.",
    cost: "물가에서 떨어져 있으면 무는 피해가 절반이 됩니다.",
  },
  // ── 이빨 4단 (전설) ───────────────────────────────────────────────────
  {
    id: "carrion",
    name: "썩은 고기를 먹는 위",
    flavor: "대머리수리와 하이에나. 남들이 못 먹는 것을 삭이는 위는 신선한 피 맛을 잊습니다.",
    when: "always",
    axis: "hunt",
    rule: "carrion",
    gain: "죽은 것이 사체로 남고, 내 종은 사체를 찾아가 먹습니다. 남이 잡다 남긴 것도.",
    cost: "갓 잡은 사냥에서 얻는 기운이 절반이 됩니다.",
  },
  {
    id: "ratel",
    // **[사용자 2026-08-12]** "라텔은 뭐야?" → 아는 이름(벌꿀오소리)으로 개명(쉬운 말 규칙).
    name: "벌꿀오소리의 맞물기",
    flavor: "벌꿀오소리. 사자가 물어도 마주 무는 짐승입니다.",
    when: "always",
    axis: "attack",
    rule: "ratel",
    gain: "물리면 그 자리에서 마주 뭅니다. 나를 문 상대는 내 이빨 힘의 절반만큼 기운을 잃습니다.",
    cost: "달아날 때도 등을 돌리지 못해, 달아나는 동안 걸음이 30% 줄어듭니다.",
  },
  // ── 다리 3단 ──────────────────────────────────────────────────────────
  {
    id: "hamstring",
    name: "힘줄을 무는 법",
    flavor: "늑대와 하이에나. 큰 사냥감은 먼저 뒷다리 힘줄을 끊어 세웁니다.",
    when: "always",
    axis: "speed",
    rule: "hamstring",
    gain: "내가 문 상대는 힘줄을 물려, 3초 동안 걸음이 절반이 됩니다.",
    cost: "목 대신 다리를 노리므로, 내 무는 피해가 절반입니다.",
  },
  {
    id: "zebrakick",
    name: "얼룩말의 뒷발질",
    flavor: "얼룩말. 뒷발 한 방이 사자의 턱을 부숩니다.",
    when: "fleeing",
    axis: "speed",
    rule: "zebrakick",
    gain: "달아나는 동안 나를 문 상대는 뒷발에 차여, 내가 입은 피해만큼 저도 기운을 잃습니다.",
    cost: "뒷발질을 하느라, 달아나는 빠르기가 20% 줄어듭니다.",
  },
  // ── 다리 4단 (전설) ───────────────────────────────────────────────────
  {
    id: "footsteps",
    name: "따라오는 발소리",
    flavor: "인간의 걷는 사냥. 해 질 녘까지 따라가면 어떤 영양도 쓰러집니다.",
    when: "hunting",
    axis: "speed",
    rule: "footsteps",
    gain: "쫓는 동안 내 걸음은 상대보다 언제나 반 걸음 빠릅니다. 아무리 빠른 것도 언젠가는 잡힙니다.",
    cost: "한번 시작한 추격은 그만둘 수 없습니다. 상대가 무리 속에 숨거나 닿을 수 없는 곳으로 사라지지 않는 한, 잡거나 쓰러지거나 둘뿐입니다.",
  },
  {
    id: "shedtail",
    name: "꼬리 자르기",
    flavor: "도마뱀. 꼬리는 다시 자라지만, 이 판에서는 아닙니다.",
    when: "always",
    axis: "speed",
    rule: "shedtail",
    gain: "잡아먹히기 직전, 꼬리를 내주고 기운 4분의 1로 빠져나옵니다. 쫓던 것은 꼬리를 먹느라 멈춥니다. 한 개체에 한 번뿐입니다.",
    cost: "꼬리를 잃은 몸은 죽을 때까지 걸음이 20% 줄어듭니다.",
  },
  // ── 눈 3단 ────────────────────────────────────────────────────────────
  {
    id: "eyespot",
    name: "등에 그린 눈",
    flavor: "공작나비와 네눈박이고기. 가짜 눈이 첫 이빨을 급소 밖으로 이끕니다.",
    when: "always",
    axis: "vision",
    rule: "eyespot",
    gain: "아직 안 다친 개체가 물리면, 이빨이 등의 가짜 눈을 뭅니다. 받는 피해가 절반이 됩니다.",
    cost: "무늬가 커서 숨어도 소용이 없습니다. 숨은 몸도 포식자가 1.3배 멀리서 알아챕니다.",
  },
  {
    id: "noshine",
    name: "빛나지 않는 눈",
    flavor: "올빼미의 검은 눈. 빛을 삼키는 눈만 어둠에 숨습니다.",
    when: "night",
    axis: "vision",
    rule: "noshine",
    gain: "밤에는 눈이 달빛을 되비치지 않아, 사냥감이 절반 거리까지 와서야 이쪽을 알아챕니다.",
    cost: "쫓는 동안은 곁눈이 죽어, 밤이든 낮이든 나를 노리는 것을 알아채는 거리가 절반이 됩니다.",
  },
  // ── 눈 4단 (전설) ─────────────────────────────────────────────────────
  {
    id: "cull",
    name: "숨통을 보는 눈",
    flavor: "늑대와 매. 무리에서 처지는 것만 골라 칩니다.",
    when: "hunting",
    axis: "vision",
    rule: "cull",
    gain: "기운이 4분의 1 아래로 떨어진 상대를 물면 반드시 잡습니다. 사냥감도 그런 놈부터 고릅니다.",
    cost: "죽어 가는 것만 눈에 들어와, 그보다 성한 상대에게는 무는 피해가 절반이 됩니다.",
  },
  {
    id: "transfix",
    name: "뱀의 응시",
    flavor: "뱀 앞의 개구리. 눈이 마주치면 몸이 먼저 굳습니다.",
    when: "hunting",
    axis: "vision",
    rule: "transfix",
    gain: "사냥감을 노리기 시작한 순간, 눈이 마주친 상대가 1초 얼어붙습니다.",
    cost: "그 눈은 이쪽도 붙듭니다. 같은 순간 나도 반 초 굳습니다.",
  },
  // ── 가죽 3단 ──────────────────────────────────────────────────────────
  {
    id: "pangolin",
    name: "천산갑의 비늘",
    flavor: "천산갑. 사자가 물다 지쳐 떠나는 갑옷입니다.",
    when: "always",
    axis: "defense",
    rule: "pangolin",
    gain: "나를 문 상대는 비늘에 이가 상해, 다음 물기까지 두 배로 오래 걸립니다.",
    cost: "이빨 대신 비늘을 골랐습니다. 내가 무는 피해는 절반이 됩니다.",
  },
  {
    id: "newflesh",
    name: "돋는 새살",
    flavor: "아홀로틀. 잃은 살을 도로 길러 냅니다.",
    when: "wounded",
    axis: "defense",
    rule: "newflesh",
    gain: "물려서 잃은 기운의 절반이, 상처가 아무는 동안 천천히 돌아옵니다.",
    cost: "새살을 기르는 동안은 새끼를 치지 않습니다.",
  },
  // ── 가죽 4단 (전설) ───────────────────────────────────────────────────
  {
    id: "undying",
    name: "죽지 않는 것",
    flavor: "물곰. 말라 죽은 몸이 물 한 방울에 다시 깨어납니다.",
    when: "always",
    axis: "defense",
    rule: "undying",
    gain: "기운이 다해 쓰러져도 한 번은 죽지 않고, 기운 절반으로 다시 일어납니다(잡아먹힌 때는 빼고).",
    cost: "되살아난 몸은 새끼를 치지 못합니다.",
  },
  {
    id: "mountain",
    name: "산 같은 몸",
    flavor: "코끼리. 사자 무리도 한 입으로는 못 쓰러뜨립니다.",
    when: "always",
    axis: "upkeep",
    rule: "mountain",
    gain: "한 입에는 죽지 않습니다. 아무리 깊은 이빨도 물기 한 번에 내 기운의 4분의 1까지만 앗아 갑니다.",
    cost: "그 몸을 먹여 살리느라 기운 소모가 언제나 1.3배입니다.",
  },
  // ── 무리 3단 ──────────────────────────────────────────────────────────
  {
    id: "bloodgift",
    name: "입에서 입으로",
    flavor: "흡혈박쥐. 굶어 죽어 가는 동료에게 먹은 피를 게워 나눠 줍니다.",
    when: "always",
    axis: "fertility",
    rule: "bloodgift",
    gain: "배를 곯는 동료가 곁에 있으면, 기운이 넉넉한 개체가 제 기운을 흘려 넣어 살립니다.",
    cost: "옮기는 길에 절반이 새어, 주는 쪽은 동료가 받는 것의 두 배를 잃습니다.",
  },
  {
    id: "greenwake",
    name: "푸른 발자국",
    flavor: "아메리카들소. 떼가 지나간 자리의 풀이 더 짙게 돋습니다.",
    when: "always",
    axis: "graze",
    rule: "greenwake",
    gain: "내 무리가 뜯어 비운 풀자리는 두 배 빨리 다시 자랍니다.",
    cost: "짧게 끊어 뜯는 입이라, 한 입에서 얻는 것이 20% 줄어듭니다.",
  },
  // ── 무리 4단 (전설) ───────────────────────────────────────────────────
  {
    id: "salmonrun",
    name: "연어의 귀향",
    flavor: "연어. 낳고 죽으며, 그 몸이 새로 깬 것들을 먹입니다.",
    when: "always",
    axis: "fertility",
    rule: "salmonrun",
    gain: "동료가 기운을 40 넘게 남기고 죽으면(잡아먹힌 때는 빼고), 그 자리에서 새끼가 태어나 남긴 기운의 절반을 받습니다.",
    cost: "죽음으로 낳는 종이라, 살아 있는 몸의 새끼 확률은 절반이 됩니다.",
  },
  {
    id: "feverscar",
    name: "열병의 흉터",
    flavor: "유럽토끼. 열병을 앓아 넘긴 것들이 빈 들판을 도로 채웠습니다.",
    when: "always",
    axis: "graze",
    rule: "feverscar",
    gain: "돌림병이 목숨을 거두러 오면, 죽는 대신 기운의 3분의 2를 잃고 앓아 넘깁니다. 한 몸에 한 번뿐입니다.",
    cost: "앓아 넘긴 몸에는 흉터가 남아, 남은 평생 새끼를 못 칩니다.",
  },
] as const satisfies readonly PerkDef[];

export type PerkName =
  | (typeof PERK_DEFS)[number]["id"]
  | (typeof DUO_PERK_DEFS)[number]["id"]
  | (typeof RULE_CARD_DEFS)[number]["id"];

/** 듀오 하나를 꺼낸다. 표에 없으면 배치가 어긋난 것이라 조용히 넘기지 않고 그 자리에서 터뜨린다. */
function duoOf(rule: PerkRule): Duo {
  const d = DUO_BY_ID.get(rule);
  if (d === undefined) throw new Error(`듀오 «${rule}» 이 tiers.DUOS 에 없다`);
  return d;
}

/**
 * **어느 티어가 어느 카드를 여는가** — 이 표가 「티어를 올릴 이유」다 (**[사용자 2026-08-10]**).
 *
 * 카드 정의와 **따로 둔 이유**: 배치는 한눈에 보고 고쳐야 하는 것이라, 45줄에 흩어 놓으면
 * 「무리를 파면 뭐가 열리지?」에 답하려고 파일 전체를 훑어야 한다. 여기 모아 두면 표가 곧 답이다.
 *
 * **칸 수** (**[사용자 2026-08-10]** 확정 · 클래시 로얄식 「아레나마다 새 유닛」):
 *   1단 4~7장 · 2단 3장 · 3단 2장 · 4단 2장. **위로 갈수록 적고 대신 세다.**
 *   위쪽을 얇게 잡은 이유 셋: ① 4단은 도달이 드물어 여러 장을 만들면 대부분 아무도 못 본다
 *   ② 위쪽 카드는 한 장이 sim 분기 하나라 비싸다 ③ 4단은 원래 「한 장이 판을 바꾸는」 자리다.
 *   **하한 2장은 지킨다** — 「올렸는데 아무것도 안 열렸다」가 한 번이라도 생기면 그 자리에서
 *   티어를 올릴 이유가 무너진다.
 *
 * ⚠ **4단 열 칸(범주당 2)이 아직 비어 있다.** 거기 들어갈 것은 배수가 아니라 **규칙을 바꾸는 카드**라
 *   (「기운이 다해도 한 번은 안 죽는다」) sim 분기가 필요하다 · backlog 「1. 카드 재설계 2차」.
 *   그때까지 4단은 **파생 능치만** 주므로, 4단을 찍은 사람에게는 새로 열리는 것이 없다.
 * ⚠ 배치는 **값어치 순서**를 따른다(`perkValue`). 깊은 단일수록 값어치가 커야 하고,
 *   `perks.test.ts` 가 그것이 뒤집히지 않았는지 검사한다.
 */
const BASE_GATES: Record<(typeof PERK_DEFS)[number]["id"], PerkGate> = {
  // ⚠⚠ **범주마다 두 장은 게이트가 없다**(`{}` 로 적힌 것들 · 2026-08-10 밤).
  //   그게 없으면 게이트가 **악순환**을 만든다. 실측: 잡식으로 시작하면(이빨 4 · 눈 3) 후보 13장이
  //   **전부 이빨·눈**이었다 — 다리·가죽·무리는 도장이 0 이라 카드가 한 장도 안 열리고, 그러면
  //   그 범주에 무엇이 있는지 **영영 못 보므로** 올릴 이유를 못 느끼고, 계속 이빨만 나온다.
  //   **[사용자 2026-08-10]** "매번 이빨 카드만 떠서 다른 범주는 아예 올릴 엄두도 못 내고 있는데,
  //   이게 티어를 올릴 동기가 될 수도 있지만 지금은 **의욕을 잃게 하는 게 더 큰** 것 같아."
  //
  //   그래서 **각 범주의 가장 작은 두 장을 문 밖에 뒀다.** 「이런 범주가 있다」를 시작부터 보여 주되
  //   그 둘은 값어치가 바닥이라(0.05~0.06) **티어를 올릴 이유는 그대로다** — 1단을 사면 그 범주에서
  //   두세 장이 더 열리고 그것들이 더 세다.
  // ── 이빨 ─────────────────────────────────────────────────────────────
  attack_always: {},
  attack_hunting: {},
  hunt_always: { tiers: [{ cat: "fang", tier: 1 }] },
  hunt_hungry: { tiers: [{ cat: "fang", tier: 1 }] },
  attack_night: { tiers: [{ cat: "fang", tier: 1 }] },
  attack_crowd: { tiers: [{ cat: "fang", tier: 2 }] },
  hunt_night: { tiers: [{ cat: "fang", tier: 2 }] },
  attack_hungry: { tiers: [{ cat: "fang", tier: 2 }] },

  // ── 다리 ─────────────────────────────────────────────────────────────
  speed_always: {},
  speed_rough: {},
  speed_day: { tiers: [{ cat: "leg", tier: 1 }] },
  speed_crowd: { tiers: [{ cat: "leg", tier: 1 }] },
  speed_night: { tiers: [{ cat: "leg", tier: 2 }] },
  speed_shore: { tiers: [{ cat: "leg", tier: 2 }] },
  speed_hungry: { tiers: [{ cat: "leg", tier: 2 }] },

  // ── 눈 ───────────────────────────────────────────────────────────────
  vision_always: {},
  vision_alone: {},
  vision_full: { tiers: [{ cat: "eye", tier: 1 }] },
  vision_rough: { tiers: [{ cat: "eye", tier: 1 }] },
  vision_shore: { tiers: [{ cat: "eye", tier: 2 }] },
  vision_day: { tiers: [{ cat: "eye", tier: 2 }] },
  vision_grass: { tiers: [{ cat: "eye", tier: 2 }] },

  // ── 가죽 ─────────────────────────────────────────────────────────────
  defense_always: {},
  upkeep_always: {},
  defense_fleeing: { tiers: [{ cat: "hide", tier: 1 }] },
  upkeep_full: { tiers: [{ cat: "hide", tier: 1 }] },
  upkeep_grass: { tiers: [{ cat: "hide", tier: 1 }] },
  defense_grass: { tiers: [{ cat: "hide", tier: 1 }] },
  defense_wounded: { tiers: [{ cat: "hide", tier: 1 }] },
  defense_crowd: { tiers: [{ cat: "hide", tier: 2 }] },
  upkeep_crowd: { tiers: [{ cat: "hide", tier: 2 }] },
  upkeep_night: { tiers: [{ cat: "hide", tier: 2 }] },
  // 도전 과제 「거인의 태동」 보상 전용(과제 잠금은 cardAvailable 이 건다 · 여긴 티어 게이트만).
  defense_rock: { tiers: [{ cat: "hide", tier: 3 }] },

  // ── 무리 ─────────────────────────────────────────────────────────────
  fertility_always: {},
  graze_day: {},
  fertility_day: { tiers: [{ cat: "herd", tier: 1 }] },
  graze_crowd: { tiers: [{ cat: "herd", tier: 1 }] },
  graze_grass: { tiers: [{ cat: "herd", tier: 1 }] },
  fertility_grass: { tiers: [{ cat: "herd", tier: 1 }] },
  graze_shore: { tiers: [{ cat: "herd", tier: 2 }] },
  fertility_full: { tiers: [{ cat: "herd", tier: 2 }] },
  graze_hungry: { tiers: [{ cat: "herd", tier: 2 }] },
};

/**
 * **고유 카드 스물의 게이트** — 범주당 3단 2장 · 4단 2장(**[사용자 2026-08-10]** 칸 수 확정).
 * 순수 티어 게이트만 쓴다(열쇠 게이트를 섞으면 「모든 티어를 연 종 = 풀 전체」 계약이 깨진다).
 */
const RULE_CARD_GATES: Record<(typeof RULE_CARD_DEFS)[number]["id"], PerkGate> = {
  famished: { tiers: [{ cat: "fang", tier: 3 }] },
  riverjaw: { tiers: [{ cat: "fang", tier: 3 }] },
  carrion: { tiers: [{ cat: "fang", tier: 4 }] },
  ratel: { tiers: [{ cat: "fang", tier: 4 }] },
  hamstring: { tiers: [{ cat: "leg", tier: 3 }] },
  zebrakick: { tiers: [{ cat: "leg", tier: 3 }] },
  footsteps: { tiers: [{ cat: "leg", tier: 4 }] },
  shedtail: { tiers: [{ cat: "leg", tier: 4 }] },
  eyespot: { tiers: [{ cat: "eye", tier: 3 }] },
  noshine: { tiers: [{ cat: "eye", tier: 3 }] },
  cull: { tiers: [{ cat: "eye", tier: 4 }] },
  transfix: { tiers: [{ cat: "eye", tier: 4 }] },
  pangolin: { tiers: [{ cat: "hide", tier: 3 }] },
  newflesh: { tiers: [{ cat: "hide", tier: 3 }] },
  undying: { tiers: [{ cat: "hide", tier: 4 }] },
  mountain: { tiers: [{ cat: "hide", tier: 4 }] },
  bloodgift: { tiers: [{ cat: "herd", tier: 3 }] },
  greenwake: { tiers: [{ cat: "herd", tier: 3 }] },
  salmonrun: { tiers: [{ cat: "herd", tier: 4 }] },
  feverscar: { tiers: [{ cat: "herd", tier: 4 }] },
};

/**
 * **듀오 카드의 게이트는 표에 안 적는다** · 듀오의 두 범주(`tiers.DUOS`)에서 그대로 유도한다.
 * 손으로 옮겨 적으면 「대백과에는 가죽+무리라 적혀 있는데 실제로는 이빨에서 열리는」 카드가 생긴다.
 */
const DUO_GATES: Record<(typeof DUO_PERK_DEFS)[number]["id"], PerkGate> = (() => {
  const out = {} as Record<(typeof DUO_PERK_DEFS)[number]["id"], PerkGate>;
  for (const d of DUO_PERK_DEFS) {
    const duo = duoOf(d.rule);
    out[d.id] = {
      tiers: [
        { cat: duo.a, tier: DUO_TIER },
        { cat: duo.b, tier: DUO_TIER },
      ],
    };
  }
  return out;
})();

const GATES: Record<PerkName, PerkGate> = { ...BASE_GATES, ...DUO_GATES, ...RULE_CARD_GATES };

/** 이 특성이 열리는 자리. 표에 없으면 처음부터 열려 있다. */
export function perkGate(id: PerkName): PerkGate | undefined {
  return GATES[id];
}

export interface Perk extends PerkDef {
  id: PerkName;
}

/** 듀오 열 개를 카드로 · 이름·설명·효과 한 줄이 전부 `tiers.DUOS` 에서 온다. */
const DUO_PERKS: readonly Perk[] = DUO_PERK_DEFS.map((d): Perk => {
  const duo = duoOf(d.rule);
  return {
    id: d.id,
    name: duo.name,
    flavor: duo.flavor,
    gain: duo.desc,
    rule: d.rule,
    axis: d.axis,
    when: d.when,
  };
});

export const PERKS: readonly Perk[] = [
  ...(PERK_DEFS as readonly Perk[]),
  ...DUO_PERKS,
  ...(RULE_CARD_DEFS as readonly Perk[]),
];

/** 듀오에서 온 규칙 특성인가 — 카드 테스트가 듀오와 고유 카드를 가를 때 쓴다(rule 유무로 갈라선 안 된다). */
export function isDuoPerk(id: PerkName): boolean {
  return DUO_PERK_DEFS.some((d) => d.id === id);
}

export const PERK_BY_NAME: ReadonlyMap<PerkName, Perk> = new Map(PERKS.map((p) => [p.id, p]));

/** 한 종이 가진 특성 목록. **순서가 곧 얻은 순서다**(화면이 그대로 보여 준다). */
export type Perks = readonly PerkName[];

export function isPerkName(s: string): s is PerkName {
  return PERK_BY_NAME.has(s as PerkName);
}

// ─────────────────────────────── 값어치와 등급 ───────────────────────────────

/**
 * **한 특성의 값어치 = 조건 성립 빈도 × 효과 크기.** 등급은 이 수 하나가 정한다.
 *
 * 「밤에만」은 판의 40%에서만 켜지므로 같은 배수라도 「늘」의 40% 값어치다. 그래서 조건이 좁을수록
 * 배수를 크게 줄 수 있고, 그게 **판마다 다르게 작동하는 카드**를 만든다.
 *
 * ⚠ **축 사이의 무게 차이는 여기서 안 본다.** 「풀 ×1.3」과 「빠르기 ×1.3」이 게임에서 같은 값어치인지는
 *   아직 잰 적이 없다. 추정을 하나 더 겹치면 더 틀리므로, 그건 프로브로 재고 나서 넣는다.
 *   지금 이 산식이 하는 일은 **카드끼리의 순서를 지키는 것**뿐이고 그건 추정으로도 성립한다.
 */
export function perkValue(p: Perk): number {
  // 규칙 특성(듀오)은 이 자로 못 잰다 · 곱해지는 축이 없다. 0 은 「값어치가 없다」가 아니라
  // **「이 자로는 못 잰다」**는 뜻이므로, 등급도 이 수로 정하지 않는다(`perkRarity` 가 따로 답한다).
  if (p.mul === undefined) return 0;
  const info = PERK_AXIS_INFO[p.axis];
  const gain = info.lower ? 1 / p.mul - 1 : p.mul - 1;
  return gain * PERK_WHEN_INFO[p.when].freq;
}

/**
 * 값어치 띠 → 등급. **손으로 등급을 적지 않는 이유**: 배수를 튜닝할 때마다 등급이 조용히 거짓이 되고,
 * 그 순간 배지가 거짓말을 한다(이 저장소에서 희귀도는 반드시 값어치·확률과 묶여 있어야 한다).
 * 전설은 열쇠 전용이라 이 표에 없다(열쇠는 배수가 아니라 없던 규칙을 연다).
 */
// ⚠ 띠 경계에 정확히 걸리는 배수를 만들지 마라 — 0.1 × 2.4 = 0.24000000000000002 처럼 부동소수점이
//   경계 비교를 뒤집는다(옛 「죽을힘」 ×3.5 가 이 여유 때문에 3.4 가 아니었다 · 2026-08-11 카드 삭제와
//   함께 근거를 여기로 옮김). 2026-08-11 이후 배수 특성은 귀함(rare)까지만 나온다 — 아주 귀함부터는
//   고유 효과(듀오·3단 카드)와 전설(열쇠·4단 카드)의 자리다.
export const PERK_VALUE_BANDS = [
  { max: 0.08, rarity: "common" },
  { max: 0.14, rarity: "uncommon" },
  { max: 0.24, rarity: "rare" },
  { max: Infinity, rarity: "epic" },
] as const;

export type PerkRarity = (typeof PERK_VALUE_BANDS)[number]["rarity"] | "legendary";

/**
 * **규칙 특성의 등급은 값어치 산식 밖에서, 게이트 깊이가 정한다.** 배수가 없어 「빈도 × 크기」로
 * 못 재기 때문이다. 대신 게이트 자체가 값어치의 증거다:
 *   깊이 3(듀오 · 3단 고유 카드) = 아주 귀함 · 깊이 4(4단 규칙 카드) = **전설**.
 *
 * ⚠ 전설의 뜻이 넓어졌다(2026-08-11): 옛 경계 「전설은 열쇠 전용」은 내(Claude) 판단이었는데,
 *   **[사용자 2026-08-10]** 이 「죽지 않는 것」을 전설 예시로 들며 4단 카드에 그 무게를 줬다.
 *   지금 경계는 **「전설 = 없던 규칙」**(열쇠 + 4단 규칙 카드)이고 `cards.test.ts` 가 지킨다.
 * ⚠ 등급 서열 검사는 **한 종이 실제로 보는 후보 풀**에서 해야 뜻이 있다(`cards.test.ts`) —
 *   깊은 게이트 카드는 풀 전체 종류 수를 부풀리지만 동시에 보이는 것은 한둘이다.
 */
export const RULE_PERK_RARITY: PerkRarity = "epic";

export function perkRarity(p: Perk): PerkRarity {
  if (p.rule !== undefined) {
    return gateDepth(perkGate(p.id)) >= 4 ? "legendary" : RULE_PERK_RARITY;
  }
  const v = perkValue(p);
  for (const band of PERK_VALUE_BANDS) if (v < band.max) return band.rarity;
  return "epic";
}

// ─────────────────────────────── 적용 ───────────────────────────────

/**
 * 이 축에 지금 걸리는 배수. **sim 은 이 함수 하나만 부른다.**
 *
 * 특성이 하나도 없으면 곧바로 1 을 돌려준다 — 야생종과 특성 0개인 종이 기존 세계와 비트 단위로
 * 같아야 하기 때문이다(부동소수점 곱셈 `x * 1` 은 x 와 같지만, 아예 안 곱하는 편이 분명하다).
 */
export function perkMul(perks: Perks, axis: PerkAxis, ctx: PerkCtx): number {
  if (perks.length === 0) return 1;
  let m = 1;
  for (const name of perks) {
    const p = PERK_BY_NAME.get(name);
    // 규칙 특성(듀오)은 축에 아무것도 안 곱한다 · `axis` 는 카드 색을 정할 뿐이다.
    if (p === undefined || p.mul === undefined || p.axis !== axis) continue;
    if (WHEN_TEST[p.when](ctx)) m *= p.mul;
  }
  return m;
}

// ─────────────────────────────── 규칙 특성 묻기 ───────────────────────────────

/** 규칙 이름 → 그 규칙을 주는 특성 id. 규칙 하나는 정확히 카드 하나에서만 나온다. */
const PERK_ID_BY_RULE: Record<PerkRule, PerkName> = (() => {
  const out = {} as Record<PerkRule, PerkName>;
  // 듀오만이 아니라 **PERKS 전체**를 훑는다(2026-08-11 · 3단·4단 고유 카드도 규칙을 준다).
  for (const p of PERKS) {
    if (p.rule === undefined) continue;
    if (out[p.rule] !== undefined) throw new Error(`규칙 «${p.rule}» 을 주는 카드가 둘이다`);
    out[p.rule] = p.id;
  }
  for (const r of PERK_RULES) {
    if (out[r] === undefined) throw new Error(`규칙 «${r}» 을 주는 카드가 없다`);
  }
  return out;
})();

/**
 * **이 종이 그 규칙을 가졌는가** · sim 이 듀오를 묻는 유일한 함수.
 *
 * ⚠ **2026-08-10 이전에는 도장을 봤다**(`tiers.hasDuo(pips, id)`). 이제는 **카드를 골랐는가**를 본다.
 *   두 범주를 3단까지 올려도 그것만으로는 아무 일도 안 일어난다 · 티어는 카드를 **열 뿐**이다.
 * ⚠ 특성이 없는 종(야생·보스·v8 챔피언)은 첫 줄에서 곧바로 false 로 빠진다 · 그 세계는 예전과
 *   비트 단위로 같다. 배열 훑기도 안 하므로 옛 `hasDuo`(도장 → 티어표 객체 생성)보다 오히려 싸다.
 */
export function hasRule(perks: Perks, rule: PerkRule): boolean {
  return perks.length !== 0 && perks.includes(PERK_ID_BY_RULE[rule]);
}

/**
 * **이 종이 실제로 가진 듀오들** · 화면이 「듀오: 늑대의 법」이라 적을 때 물어야 하는 것.
 * (`tiers.openDuos(pips)` 는 「열려 있는가」를 답할 뿐 「가졌는가」를 답하지 않는다.)
 */
export function ownedDuos(perks: Perks): Duo[] {
  if (perks.length === 0) return [];
  const owned = new Set<string>();
  for (const d of DUO_PERK_DEFS) if (perks.includes(d.id)) owned.add(d.rule);
  return DUOS.filter((d) => owned.has(d.id)); // 표시 순서는 DUOS 그대로(대백과와 같은 차례)
}

/** 지금 켜져 있는 특성들 — 화면이 「무엇이 지금 작동하는가」를 보여 줄 때 쓴다(sim 과 같은 판정). */
export function activePerks(perks: Perks, ctx: PerkCtx): Perk[] {
  const out: Perk[] = [];
  for (const name of perks) {
    const p = PERK_BY_NAME.get(name);
    if (p !== undefined && WHEN_TEST[p.when](ctx)) out.push(p);
  }
  return out;
}

// ─────────────────────────────── 화면 문구 ───────────────────────────────

/**
 * 배수 표기. 3.00 → 「×3」 · 1.50 → 「×1.5」 · 1.05 → 「×1.05」.
 *
 * ⚠ **모든 배수는 소수점 둘째 자리 안에서 정해야 한다.** 0.625 같은 값을 쓰면 화면에는 반올림된
 *   0.63 이 뜨는데 sim 은 0.625 를 곱한다 — 작지만 「수치가 화면 표시와 다르면 그건 거짓말이다」의
 *   위반이다. `perks.test.ts` 가 이걸 잡는다.
 */
function fmtMul(mul: number): string {
  return `×${mul.toFixed(2).replace(/\.?0+$/, "")}`;
}

/**
 * 카드·내 종 패널·대백과가 쓰는 **한 줄**. 예: 「수풀에서 보는 거리 ×1.55」 · 「기운 소모 ×0.65」.
 *
 * ⚠ **모든 줄은 자립형이다** — 이 문구는 카드 · 도감 · 패널에 단독으로 뜨므로, 무엇이 언제 얼마나
 *   달라지는지가 그 줄 안에 다 있어야 한다(`tiers.tierLine` 과 같은 규칙).
 */
export function perkLine(p: Perk): string {
  // 규칙 특성(듀오)은 표에서 만들 수가 없다 · 곱해지는 축이 없으므로 「무엇이 달라지는가」를
  // 문장으로만 말할 수 있다. 그 문장의 단일 진실은 `tiers.DUOS` 의 `desc` 이고, 여기서는
  // 그것을 **그대로** 내보낸다(카드·대백과·내 종 패널이 한 글자도 안 갈린다).
  if (p.gain !== undefined) return p.gain;
  const when = PERK_WHEN_INFO[p.when].label;
  const axis = PERK_AXIS_INFO[p.axis].label;
  const body = `${axis} ${fmtMul(p.mul as number)}`;
  return when === "" ? body : `${when} ${body}`;
}

/**
 * **대가 한 줄** — 3단·4단 고유 카드만 갖는다. 없으면 undefined(0~2단 배수 카드 · 조건이 곧 대가).
 * 카드·구입 화면 예고·대백과가 전부 이 함수만 불러야 「대가가 자리마다 다르게 적히는」 일이 없다.
 */
export function perkCost(p: Perk): string | undefined {
  return p.cost;
}

/**
 * 「죽지 않는 것」 — 기운이 다한 죽음을 한 번 무른다. **죽음 판정 자리에서, recordDeath·emit 이전에**
 * 부른다(그러면 통계·연출 정리가 아예 필요 없다). true 면 되살아난 것이니 죽음 처리를 건너뛴다.
 *
 * 여기(순수 규칙 파일)에 있는 이유: 기운이 다하는 죽음 자리가 둘이다(`behavior.stepEntity` 의 소모사 ·
 * `boss` 의 전역 흡수). 두 곳에 각자 적으면 반드시 어긋난다. rng 를 안 쓴다(결정론 안전).
 * ⚠ 독(poison)을 비운다 — 안 비우면 다음 틱 독 피해로 곧바로 다시 쓰러진다(정찰 확인).
 */
export function tryRevive(e: Entity): boolean {
  if (e.genome.perks.length === 0 || e.revived || !hasRule(e.genome.perks, "undying")) return false;
  e.revived = true;
  e.energy = SIM.maxEnergy * UNDYING_ENERGY;
  e.poison = 0;
  return true;
}
