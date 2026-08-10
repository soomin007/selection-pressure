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
//  ① **특성은 「조건 · 축 · 배수」 셋뿐이다.** 새 sim 메커니즘은 안 만든다 — 그건 열쇠의 몫이고
//     열쇠 하나 = sim 규칙 하나라 비싸다. **[사용자 2026-07-11]** "새 형질을 만들기보다 이미 있는
//     형질이 그 맥락에서 작동하게 한다."
//  ② **대가를 안 붙인다. 조건 자체가 대가다** — 「밤에」는 판의 40%에서만 켜진다. 한 특성에 대가를
//     겹치면 함정 카드가 된다(known_issues 「새 형질의 대가를 여러 개 겹치면」 · 몸집이 그랬다).
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
import type { Category } from "@/sim/tiers";
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

/** 물가인가 — 네 방향으로 타일 하나씩 짚어 물이 있는지 본다. rng 미사용(결정론 안전). */
function nearShore(world: World, x: number, y: number): boolean {
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

// ─────────────────────────────── 특성 목록 ───────────────────────────────

interface PerkDef {
  id: string;
  /** 카드 이름이자 내 종 패널의 이름. 카드가 따로 이름을 안 갖는다(두 곳에 적지 않는다). */
  name: string;
  /** 플레이버 한 줄. **효과를 여기 적지 않는다** — 효과는 `perkLine` 이 표에서 만든다. */
  flavor: string;
  when: PerkWhen;
  axis: PerkAxis;
  /** 곱해지는 배수. 「기운 소모」만 1 아래가 이득이다(`PERK_AXIS_INFO.lower`). */
  mul: number;
}

/**
 * 특성 마흔다섯. **등급은 여기 안 적는다** — `perkRarity` 가 「조건 성립 빈도 × 효과 크기」로
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
  { id: "graze_always", name: "되새김", flavor: "한 번 삼킨 것을 다시 꺼내 씹습니다.", when: "always", axis: "graze", mul: 1.28 },

  // ── 사냥으로 얻는 것 ───────────────────────────────────────────────────
  { id: "hunt_always", name: "남김없이", flavor: "뼈에 붙은 것까지 발라 먹습니다.", when: "always", axis: "hunt", mul: 1.07 },
  { id: "hunt_hungry", name: "굶주린 뱃속", flavor: "곯은 배가 더 많이 받아들입니다.", when: "hungry", axis: "hunt", mul: 1.2 },
  { id: "hunt_night", name: "밤 사냥", flavor: "잠든 것은 저항하지 않습니다.", when: "night", axis: "hunt", mul: 1.3 },
  { id: "hunt_alone", name: "혼자 먹는 몫", flavor: "나눌 입이 없으면 전부 내 것입니다.", when: "alone", axis: "hunt", mul: 1.9 },
  // ⚠ 이름을 「긴 포만」으로 붙이지 말 것 — sim 에 이미 그 이름의 규칙이 있다(`gorgeFactor` ·
  //   육식성이 정하는 기운 상한). 같은 낱말이 두 가지를 가리키면 어휘가 갈라진다(known_issues).
  { id: "hunt_gorge", name: "배불리 먹는 법", flavor: "한 번 잡으면 남기지 않고 실컷 먹습니다.", when: "always", axis: "hunt", mul: 1.3 },

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
  { id: "defense_rock", name: "바위 살갗", flavor: "살갗이 돌처럼 굳습니다.", when: "always", axis: "defense", mul: 0.79 },

  // ── 빠르기 ─────────────────────────────────────────────────────────────
  { id: "speed_always", name: "긴 정강이", flavor: "한 걸음이 멀어집니다.", when: "always", axis: "speed", mul: 1.05 },
  { id: "speed_rough", name: "험한 땅의 걸음", flavor: "돌밭을 평지처럼 딛습니다.", when: "rough", axis: "speed", mul: 1.5 },
  { id: "speed_night", name: "밤길", flavor: "어두워도 걸음을 안 줄입니다.", when: "night", axis: "speed", mul: 1.25 },
  { id: "speed_hungry", name: "굶주린 추격", flavor: "배가 고프면 다리가 먼저 움직입니다.", when: "hungry", axis: "speed", mul: 1.35 },
  { id: "speed_hunting", name: "쫓을 때의 걸음", flavor: "쫓기 시작하면 다른 짐승이 됩니다.", when: "hunting", axis: "speed", mul: 3.0 },
  // ⚠ 배수 3.5 는 등급 경계(0.24)를 **부동소수점 여유를 두고** 넘기려는 값이다. 3.4 면 값어치가
  //   정확히 0.24 라 띠 비교가 반올림 오차에 걸린다(0.1 × 2.4 = 0.24000000000000002).
  { id: "speed_fleeing", name: "죽을힘", flavor: "쫓길 때 내는 속도는 평생 한 번뿐입니다.", when: "fleeing", axis: "speed", mul: 3.5 },

  // ── 보는 거리 ──────────────────────────────────────────────────────────
  { id: "vision_always", name: "높이 든 고개", flavor: "고개를 들고 오래 봅니다.", when: "always", axis: "vision", mul: 1.06 },
  { id: "vision_alone", name: "혼자 서는 파수", flavor: "곁에 아무도 없으면 스스로 살핍니다.", when: "alone", axis: "vision", mul: 1.3 },
  { id: "vision_grass", name: "수풀 너머", flavor: "덤불 사이로 보는 법을 익힙니다.", when: "grass", axis: "vision", mul: 1.55 },
  { id: "vision_day", name: "맑은 낮", flavor: "밝을 때 가장 멀리 봅니다.", when: "day", axis: "vision", mul: 1.3 },
  { id: "vision_night", name: "밤눈", flavor: "어두운 것이 덜 어두워집니다.", when: "night", axis: "vision", mul: 1.45 },
  { id: "vision_far", name: "지평선을 보는 눈", flavor: "점 하나가 짐승으로 보입니다.", when: "always", axis: "vision", mul: 1.3 },

  // ── 기운 소모 ──────────────────────────────────────────────────────────
  { id: "upkeep_always", name: "아끼는 몸", flavor: "쓸데없는 데 기운을 안 씁니다.", when: "always", axis: "upkeep", mul: 0.95 },
  { id: "upkeep_full", name: "비축한 몸", flavor: "배가 부를 때 남은 것을 갈무리합니다.", when: "full", axis: "upkeep", mul: 0.8 },
  { id: "upkeep_grass", name: "수풀의 그늘", flavor: "덤불 그늘에서는 덜 지칩니다.", when: "grass", axis: "upkeep", mul: 0.7 },
  { id: "upkeep_night", name: "밤의 휴식", flavor: "어두우면 움직임을 줄이고 쉽니다.", when: "night", axis: "upkeep", mul: 0.7 },
  { id: "upkeep_crowd", name: "붙어 자는 밤", flavor: "몸을 맞대면 덜 춥습니다.", when: "crowd", axis: "upkeep", mul: 0.65 },
  { id: "upkeep_slow", name: "느린 신진대사", flavor: "숨이 길고 심장이 느립니다.", when: "always", axis: "upkeep", mul: 0.78 },

  // ── 새끼 확률 ──────────────────────────────────────────────────────────
  { id: "fertility_always", name: "잦은 출산", flavor: "새끼 보는 날이 잦아집니다.", when: "always", axis: "fertility", mul: 1.06 },
  { id: "fertility_day", name: "긴 낮", flavor: "해가 긴 철에 새끼를 칩니다.", when: "day", axis: "fertility", mul: 1.16 },
  { id: "fertility_grass", name: "수풀의 보금자리", flavor: "덤불 안쪽에 자리를 봅니다.", when: "grass", axis: "fertility", mul: 1.5 },
  { id: "fertility_full", name: "배부른 어미", flavor: "기운이 넉넉해야 새끼를 칩니다.", when: "full", axis: "fertility", mul: 1.7 },
  { id: "fertility_crowd", name: "함께 기른다", flavor: "여럿이 돌보면 어린 것이 덜 죽습니다.", when: "crowd", axis: "fertility", mul: 1.85 },
] as const satisfies readonly PerkDef[];

export type PerkName = (typeof PERK_DEFS)[number]["id"];

export interface Perk extends PerkDef {
  id: PerkName;
}

export const PERKS: readonly Perk[] = PERK_DEFS as readonly Perk[];

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
  const info = PERK_AXIS_INFO[p.axis];
  const gain = info.lower ? 1 / p.mul - 1 : p.mul - 1;
  return gain * PERK_WHEN_INFO[p.when].freq;
}

/**
 * 값어치 띠 → 등급. **손으로 등급을 적지 않는 이유**: 배수를 튜닝할 때마다 등급이 조용히 거짓이 되고,
 * 그 순간 배지가 거짓말을 한다(이 저장소에서 희귀도는 반드시 값어치·확률과 묶여 있어야 한다).
 * 전설은 열쇠 전용이라 이 표에 없다(열쇠는 배수가 아니라 없던 규칙을 연다).
 */
export const PERK_VALUE_BANDS = [
  { max: 0.08, rarity: "common" },
  { max: 0.14, rarity: "uncommon" },
  { max: 0.24, rarity: "rare" },
  { max: Infinity, rarity: "epic" },
] as const;

export type PerkRarity = (typeof PERK_VALUE_BANDS)[number]["rarity"];

export function perkRarity(p: Perk): PerkRarity {
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
    if (p === undefined || p.axis !== axis) continue;
    if (WHEN_TEST[p.when](ctx)) m *= p.mul;
  }
  return m;
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
 * 카드·내 종 패널·대백과가 쓰는 **한 줄**. 예: 「밤에 보는 거리 ×1.45」 · 「기운 소모 ×0.78」.
 *
 * ⚠ **모든 줄은 자립형이다** — 이 문구는 카드 · 도감 · 패널에 단독으로 뜨므로, 무엇이 언제 얼마나
 *   달라지는지가 그 줄 안에 다 있어야 한다(`tiers.tierLine` 과 같은 규칙).
 */
export function perkLine(p: Perk): string {
  const when = PERK_WHEN_INFO[p.when].label;
  const axis = PERK_AXIS_INFO[p.axis].label;
  const body = `${axis} ${fmtMul(p.mul)}`;
  return when === "" ? body : `${when} ${body}`;
}
