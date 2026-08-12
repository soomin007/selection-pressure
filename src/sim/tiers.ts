// 범주 · 티어 — 이 게임 성장의 **단일 진실**.
//
// 왜 이 파일이 생겼나 (2026-08-06 회의 · 세션 로그 참조):
// 0~100 자연수 형질은 **"이 척도는 일정하다"는 약속**인데 실제로는 아니었다.
//   · 카드 비용이 구간마다 달랐다(50→60 은 한 장, 90→100 은 여섯 장).
//   · 효과도 일정하지 않았다(속도 60→61 은 개체 수 -0.38 · 표준편차 5.85 로 부호조차 안 맞았다).
//     눈에 띄는 최소 단위가 약 10칸이라, 100단계를 보여 주면서 뜻이 있는 눈금은 10개뿐이었다.
// **[사용자 2026-08-06]** 그래서 롤토체스식으로 갈아엎기로 확정했다:
//   범주 다섯에 **도장(pip)** 을 찍고, **문턱에서만** 효과가 켜진다. 티어 안의 도장 수는 아무 뜻이 없다.
//   다음 티어까지 몇 개 남았는지는 **화면에 늘 적혀 있으므로** 요구 도장이 늘어나는 것은 거짓말이 아니다.
//
// ⚠ 이 파일은 `PixiJS` 를 모른다(sim 순수 규칙). 화면은 여기 값을 **읽기만** 한다.
//    수치를 두 곳에 적지 말 것 — 카드 칩·내 종 패널·대백과가 전부 이 파일의 함수만 부른다.

import type { Traits } from "@/sim/genome";

// ─────────────────────────────── 범주 ───────────────────────────────

/**
 * 범주 다섯 · **[사용자 2026-08-06]** 확정.
 *
 * 왜 공격력을 이빨(무기)과 가죽(방어)으로 쪼갰나: 지금 `biteOutcome` 은 상대의 공격력을 내 피해에서
 * 빼므로 공격력 한 칸이 **무기와 방어를 동시에** 올린다. 어떤 값어치를 매겨도 이빨이 항상 정답이 된다.
 * **[사용자]** "뭐가 됐든 특정 선택이 '항상 정답'이 되어서는 안 돼."
 *
 * 왜 무리와 번식을 묶었나: **[사용자]** 지시. 폰 한 줄에 칩 다섯이 상한이고(실측 330.5px / 가용 374px),
 * "많이 낳는다"와 "함께 산다"는 같은 대가(나눠 먹기·병)를 공유한다.
 */
export const CATEGORIES = ["fang", "leg", "eye", "hide", "herd"] as const;
export type Category = (typeof CATEGORIES)[number];

/** 범주 한국어 이름. 폰 한 줄 제약 때문에 **두 글자 이내**를 지킨다. */
export const CATEGORY_LABELS: Record<Category, string> = {
  fang: "이빨",
  leg: "다리",
  eye: "눈",
  hide: "가죽",
  herd: "무리",
};

/** 범주 한 줄 설명 — 드래프트·내 종 패널이 그대로 쓴다(대백과에 안 미룬다). */
export const CATEGORY_DESC: Record<Category, string> = {
  fang: "무는 힘과 사냥. 키울수록 풀에서 얻는 것이 줄어듭니다.",
  leg: "빠르기와 험한 땅. 키울수록 몸이 가벼워지고 잘 지칩니다.",
  eye: "보는 거리와 어둠. 키울수록 옆과 뒤가 좁아집니다.",
  hide: "버티는 힘과 추위. 키울수록 몸이 커지고 더위에 약해집니다.",
  herd: "새끼와 명령이 닿는 거리. 키울수록 나눠 먹고 병이 돕니다.",
};

/** 범주 색(0xRRGGBB) — 화면에서 티어 칩·막대가 이 색을 쓴다. 희귀도 색과 축을 나눈다. */
export const CATEGORY_COLORS: Record<Category, number> = {
  fang: 0xe4614f,
  leg: 0x54c6a0,
  eye: 0x6aa9f0,
  hide: 0xd9a441,
  herd: 0xb884e8,
};

export type Pips = Record<Category, number>;

export function emptyPips(): Pips {
  return { fang: 0, leg: 0, eye: 0, hide: 0, herd: 0 };
}

// ─────────────────────────────── 티어 사다리 ───────────────────────────────

/**
 * 티어가 켜지는 **누적 도장** 수. 요구 도장이 3 · 5 · 6 · 7 로 늘어난다(= 감쇠).
 *
 * ⚠⚠ **아래 실측표는 v9 에서 통째로 무효다. 근거로 인용하지 마라.**
 *   그 표는 「카드 풀 90장이 도장을 준다」를 전제로 잰 값인데, v9 에서 **카드가 도장을 그만 준다**
 *   (`game/cards.ts` 파일 머리 · **[사용자 2026-08-08]**). 이제 도장은 **방울 구입(`Game.buyTier`)
 *   하나로만** 오르므로, 「한 런에 모을 수 있는 도장」은 카드 예산이 아니라 **방울 수입**이 정한다.
 *   표를 지우지 않고 남겨 두는 이유는 v8 이 어떤 세계였는지가 재측정의 출발점이기 때문이다.
 *   다시 재는 법: backlog 「2. 성장 속도 재측정」 · 재는 자는 `probe replay`(사람 판을 되살린다).
 *   ⚠ 이 저장소는 **잘못된 자로 잰 값을 근거로 튜닝하는 사고를 네 번** 겪었다. 다섯 번째로 만들지 마라.
 *
 * ── 아래는 v8 기준 기록(무효) ──────────────────────────────────────────────────
 *
 * 왜 이 숫자인가 — 한 런에 모을 수 있는 도장이 정한다. 카드는 3장 중 1장을 고르므로 한 드래프트의
 * 기대 도장은 평균이 아니라 **최댓값**이다. 카드 예산은 고정이 아니라 **띠**다(손 놓으면 12장 ·
 * 보통 17 · 아주 잘하면 22 · **[사용자]** 상한 자체를 문제 삼아 풀었다).
 *
 * ⚠ 예전엔 여기에 **「한 장에 약 1.09 도장」이라는 어림수**가 적혀 있었고, `game.test.ts` 가 그 상수를
 *   손으로 박아 `12 × 1.09 = 13.1 < 20` 으로 "손 놓은 판은 4단에 못 닿는다"를 통과시켰다. 그 수에는
 *   프리셋 시작 도장도 시대 보상 강화도 없어 사다리를 실제보다 한참 느리게 계산한다. 어림수를 지우고
 *   **아래 실측 표 하나만** 남긴다(테스트도 이제 실제 뽑기 경로를 굴려 판정한다).
 *
 * **아래 표는 계산이 아니라 실측이다.** 뽑은 자리를 그대로 적는다(안 적으면 다음 사람이 재현 못 한다):
 *
 *   `npm run probe -- tiers`   (2026-08-08 · 기본 인자 = 4000런 · **은근한 보정 끔** · 메타 경험치 0 ·
 *                               끝낸 런 0 · 시대 보상 12장→1회 · 17장→2회 · 22장→3회)
 *
 * 실제 90장 풀 · 희귀도 가중 · 소프트 디듑 · 프리셋 시작 도장 7. 카드가 주는 도장은 「한 범주 최고」 기준.
 *
 * 표의 수는 「최고 범주 도장 / 2위 범주 도장」이고, 괄호는 그 결과 켜지는 티어와 4단 범주 평균 개수다.
 *
 * | 어떻게 골랐나 | 12장 | 17장 | 22장 |
 * |---|---|---|---|
 * | 한 범주만 판다 | 16.8 / 7.7 (III+I · 4단 0.29) | **21.7 / 11.3 (IV+II · 4단 0.82)** | 25.3 / 16.2 (IV+III · 4단 1.24) |
 * | 두 범주를 판다 | 16.9 / 11.3 (III+II · 4단 0.27) | **21.9 / 16.3 (IV+III · 듀오 0.87)** | 26.0 / 20.9 (IV+IV · 듀오 1.56) |
 * | 매번 가장 큰 카드 | 15.7 / 11.3 (III+II · 4단 0.18) | 21.2 / 16.6 (IV+III · 듀오 2.48) | 26.5 / 21.4 (IV+IV · 듀오 6.58) |
 * | 아무거나 고른다 | 11.9 / 8.7 (II+II · **3단 0.31개**) | 16.2 / 11.9 (III+II · 4단 0.22) | 21.0 / 16.0 (IV+III · 4단 0.86) |
 *
 * ⚠ **옛 표(15.8 / 19.5 / 22.0)는 시대 보상 드래프트를 모르는 자로 잰 값이었다**(2026-08-07 발견 ·
 *   시대를 넘을 때마다 3장 전부가 ×2.0~4.9 로 강화된 드래프트가 한 번 더 돈다). 지금 자로는 한 우물
 *   17장이 이미 문턱 20 을 넘긴다.
 *
 * 마지막 줄이 이 재설계의 목표다. 예전엔 정점 넷이 런 끝에 **반드시** 다 찍혔는데, 아무거나 고르는
 * 12장 판은 지금도 **관문 자격을 거의 못 얻는다**(3단이 평균 0.31개). 다섯 범주 전부 4단(= 도장 100)은
 * 여전히 원리적으로 불가능하다 — 가장 후한 판(매번 가장 큰 카드 · 22장)에서도 4단이 평균 2.6 범주다.
 * **[사용자]** 최고 티어는 대멸종을 세 번 넘긴 뒤(시대 4)에 열린다 = 누적 20.
 *
 * ⚠ **이 표는 프리셋 시작 도장 7(주 4 + 부 3)과 카드 풀 90장을 전제로 한다.** 둘 중 하나라도
 *   만지면 사다리 전체가 움직이므로 반드시 위 명령을 다시 돌려라.
 * ⚠ 이 표에 **없는 것 셋**(전부 실제 게임에는 있다 · 그러니 표는 **하한**이다):
 *   ① 은근한 보정(`--assist`) ② 다시 뽑기(`--reroll`) ③ 방울로 사는 티어(`Game.buyTier`).
 */
export const TIER_STEPS = [3, 8, 14, 20] as const;

/** 티어 상한. 4단 = 「규칙 면제」. */
export const MAX_TIER = 4;

/** 화면에 쓰는 티어 표기. 0단은 빈 문자열(회색 점 하나로만 그린다). */
export const TIER_ROMAN = ["", "I", "II", "III", "IV"] as const;

/** 도장 수 → 티어(0~4). */
export function tierOf(pips: number): number {
  let t = 0;
  for (const step of TIER_STEPS) {
    if (pips >= step) t += 1;
    else break;
  }
  return t;
}

/** 이 티어를 켜는 데 필요한 누적 도장. 0단은 0. */
export function pipsForTier(tier: number): number {
  if (tier <= 0) return 0;
  const i = Math.min(MAX_TIER, tier) - 1;
  return TIER_STEPS[i] as number;
}

/** 다음 문턱까지 남은 도장. 이미 최고 티어면 0. */
export function pipsToNext(pips: number): number {
  const t = tierOf(pips);
  if (t >= MAX_TIER) return 0;
  return pipsForTier(t + 1) - pips;
}

/** 다섯 범주 티어의 합 — 공통 유지비(청구서)의 밑이다. */
export function tierSum(pips: Pips): number {
  let s = 0;
  for (const c of CATEGORIES) s += tierOf(pips[c]);
  return s;
}

/** 범주별 티어표(화면·듀오 판정용). */
export function tiersOf(pips: Pips): Record<Category, number> {
  return {
    fang: tierOf(pips.fang),
    leg: tierOf(pips.leg),
    eye: tierOf(pips.eye),
    hide: tierOf(pips.hide),
    herd: tierOf(pips.herd),
  };
}

// ─────────────────────────────── 열쇠(능력) ───────────────────────────────

/**
 * 능력은 범주가 아니라 **열쇠**다 — 있다/없다 이진이고, **세기는 짝지어진 범주의 티어를 그대로 읽는다.**
 * 그래서 능력이 화면에 새 축을 만들지 않고, 이미 판 범주가 열쇠를 자동으로 키워 준다.
 */
export const KEY_NAMES = ["fin", "wing", "echo", "camo", "venom", "barb", "call"] as const;
export type KeyName = (typeof KEY_NAMES)[number];
export type Keys = Record<KeyName, boolean>;

export const KEY_LABELS: Record<KeyName, string> = {
  fin: "지느러미",
  wing: "날개",
  echo: "초음파",
  camo: "숨기",
  venom: "독니",
  barb: "뿔",
  call: "부름",
};

/** 열쇠 한 줄 설명 — 대가까지 함께 적는다(대가 미리 보이기는 **[사용자]** 필수 지시). */
export const KEY_DESC: Record<KeyName, string> = {
  fin: "물에 들어갑니다. 대신 땅에서 조금 느려집니다.",
  wing: "산과 물을 날아 넘습니다. 대신 늘 배가 고픕니다.",
  echo: "어둠 속에서 소리로 봅니다. 대신 밝을 때 눈이 부십니다.",
  camo: "포식자가 늦게 발견합니다. 큰 몸은 잘 못 숨습니다.",
  venom: "문 상대가 서서히 죽습니다. 대신 사냥 뒤 회복이 줄어듭니다.",
  barb: "멀리서 먼저 칩니다. 대신 가까이서 무는 힘이 줄어듭니다.",
  call: "명령이 닿는 거리가 훨씬 넓어집니다. 대신 포식자도 그 소리를 듣습니다.",
};

/** 열쇠의 모 범주 — 이 범주의 티어가 곧 열쇠의 세기다. */
export const KEY_PARENT: Record<KeyName, Category> = {
  fin: "leg",
  wing: "leg",
  echo: "eye",
  camo: "eye",
  venom: "fang",
  barb: "fang",
  call: "herd",
};

/**
 * 한 종이 가질 수 있는 열쇠 수 상한. 넘으면 열쇠 카드가 후보에서 빠진다.
 * 셋인 이유: 넷이면 드래프트 칩 줄이 폰 가용폭을 넘고, 무엇보다 "다 가진 종"이 되면 고르는 재미가 없다.
 */
export const MAX_KEYS = 3;

export function emptyKeys(): Keys {
  return { fin: false, wing: false, echo: false, camo: false, venom: false, barb: false, call: false };
}

export function keyCount(keys: Keys): number {
  let n = 0;
  for (const k of KEY_NAMES) if (keys[k]) n += 1;
  return n;
}

// ─────────────────────────────── 파생 능치표 ───────────────────────────────
//
// **여기가 「문턱에서만 켜진다」의 구현이다.** sim 이 읽는 능치는 전부 아래 표에서 나오므로,
// 도장을 하나 더 찍어도 문턱을 안 넘으면 세계는 1비트도 안 움직인다. 화면이 "안 바뀐다"고 말하는데
// 실제로도 안 바뀌므로 거짓말이 없다.
//
// ⚠ **표 첨자는 티어(0~4)다.** 0단은 "아무 도장도 안 찍은 종"이고, 야생종은 이 표를 안 쓴다
//    (야생은 손으로 정한 값을 그대로 쓴다 — 생태 밸런스를 안 흔들기 위해서다. `species.ts` 참조).

// ⚠⚠ **0단이 곧 출발선이다. 여기를 낮추면 게임이 무너진다.**
//   처음엔 0단을 옛 「기본 게놈」(전부 50)에 맞췄다. 그런데 실제 출발선은 기본 게놈이 아니라
//   **옛 프리셋**(여섯 축을 60~66 으로 한꺼번에 올려 주던 것)이었다. 티어 구조에서는 프리셋이
//   두 범주만 켜므로, 나머지 세 범주가 50 이면 **속도 -12% · 번식 -15% · 무리 0** 이 되어
//   단위 시간에 훑는 면적과 회복력이 함께 무너진다. 실측으로 두 번 확인했다:
//     0단 46/40/42 → 도달 시대 1.9 · 굶주림 63%
//     0단 50/50/50 → 도달 시대 2.2 · 굶주림 60%   (거의 안 움직였다)
//   그래서 **0단을 옛 프리셋과 같은 자리(56~60)** 로 올린다. 티어의 값어치는 그대로다 —
//   4단(118)은 여전히 0단의 두 배다. 티어 구조는 「성장의 눈금」을 바꾸는 것이지 「출발선」을
//   낮추는 것이 아니다.
//   ⚠ **3단이 100 을 넘으면 안 된다** — `isApex(v) = v >= 100` 이 규칙 면제를 켠다. 4단만 넘긴다.

/** 이빨 → 무는 힘. 100 에서 **규칙 면제**(체급 열세 무시선이 나에게 안 걸린다 · `isApex`). */
export const FANG_ATTACK = [50, 66, 78, 90, 104] as const;
/** 이빨 → 풀에서 얻는 효율. 0단이 온전한 1.0 = **도장을 하나도 안 넣는 것 자체가 초식 빌드**다. */
export const FANG_GRAZE = [1.0, 0.84, 0.6, 0.38, 0.2] as const;
/** 이빨 → 사냥 효율. 0단은 **사냥 자체가 불가**(0). */
export const FANG_HUNT = [0, 0.72, 0.86, 0.95, 1.0] as const;
/** 이빨 → 육식성 세기(사냥 스퍼트 · 큰 사냥 · 긴 포만 · 무리 나눔이 이 값으로 스케일된다). */
export const FANG_CARN = [0, 0.15, 0.45, 0.75, 1.0] as const;
/** 이빨 → 식성 눈금(화면 표시 · 야생 비교용). 실제 판정은 위 세 값이 한다. */
export const FANG_DIET = [18, 54, 70, 76, 80] as const;

/** 다리 → 속도. 112 에서 **규칙 면제**(사냥하는 야생의 표적 목록에서 통째로 빠진다). */
export const LEG_SPEED = [60, 72, 84, 96, 118] as const;
/** 다리 → 달릴수록 배가 고파진다(질주의 대가). 최고 속도에 가까울 때 유지비에 이만큼 얹힌다. */
export const LEG_SPRINT_COST = [0, 0.06, 0.13, 0.21, 0.3] as const;

/** 눈 → 시야 반경 계수. 112 에서 **규칙 면제**(밤·수풀·상대 은신 전부 무효). */
export const EYE_VISION = [60, 72, 84, 96, 118] as const;
/**
 * 눈 → 시야각(부채꼴)의 cos. **값이 클수록 좁다.** 160° → 150 → 138 → 124 → 110.
 *
 * ⚠ **최고 티어가 자기 대가를 되사지 않는다.** 앞선 안은 4단에서 부채꼴을 없앴는데, 그건
 * **[사용자]** 「티어가 오를수록 대가도 확연히 벌어진다」를 정면으로 어긴다. 대가는 끝까지 커지고,
 * 대신 다른 축(밤·수풀·은신)에서 규칙 밖으로 나간다. 사각을 메우고 싶으면 듀오 「파수꾼」을 켜야 한다.
 */
export const EYE_FOV_COS = [0.17, 0.26, 0.36, 0.47, 0.57] as const;
/**
 * 눈 → **초음파 세기**(열쇠 `echo` 를 가진 종만 · 없으면 0). 초음파는 눈 범주의 열쇠라 세기가 눈
 * 티어를 그대로 따라 오른다 · **눈을 키우면 초음파가 함께 세진다**는 뜻이고, 화면이 그 사실을
 * 안 말하면 「초음파를 얻었으니 눈은 이제 쓸모없다」는 오해가 생긴다(`tierLine` 이 열쇠를 받는 이유).
 *
 * ⚠ **감지 범위는 `max(시야, 초음파)` 다**(`behavior.chooseGoal`) · 둘 중 어느 쪽이 이기는지는
 * 티어가 아니라 **때와 자리**가 정한다. 실측(`visionRadius` · 실제 World · px):
 *
 * | 눈단 | 시야(낮·트임) | 시야(밤) | 초음파 | 낮 | 밤 |
 * |---|---|---|---|---|---|
 * | 0 | 120 | 88.8 | 110.2 | 시야 | 초음파 |
 * | 1 | 144 | 113.5 | 134.9 | 시야 | 초음파 |
 * | 2 | 168 | 140.4 | 159.6 | 시야 | 초음파 |
 * | 3 | 192 | 169.7 | 184.3 | 시야 | 초음파 |
 * | 4 | 236 | 236 | 209.0 | 시야 | 시야 |
 *
 * 즉 **낮에는 눈이, 밤·수풀에서는 귀가** 감지를 맡고, 4단은 밤·수풀 면제(`isApex`)라 눈이 언제나
 * 이긴다. 초음파는 그때도 전방위라 부채꼴 뒤를 메운다.
 * (시야 반경은 `SIM.visionBase(200) × 값/100` 이라 **표의 값이 곧 px 이 아니다** · 초음파는
 *  `SIM.echoBase(190) × 세기/100`. 두 축을 비교할 땐 반드시 각자의 base 를 곱해서 볼 것.)
 */
export const EYE_ECHO = [58, 71, 84, 97, 110] as const;

/** 가죽 → 버티는 힘(무는 쪽이 아니라 물리는 쪽). 104 에서 **규칙 면제**(대멸종 환경 피해 면제). */
export const HIDE_DEFENSE = [56, 68, 80, 92, 110] as const;
/** 가죽 → 추위에 강해지고 **더위에 약해진다**. 이 축 하나가 「두꺼운 몸」의 양면을 다 담는다. */
export const HIDE_METAB = [50, 60, 70, 80, 90] as const;

/** 무리 → 뭉침·무리 방어. 88(3단)에서 무리 방어가 켜진다 — 야생 초식은 진화 최댓값 84 라 못 닿는다. */
export const HERD_HERDING = [32, 54, 70, 88, 100] as const;
/** 무리 → 번식력. 100 에서 **규칙 면제**(어미가 치르는 출산 대가가 준다). */
export const HERD_FERT = [60, 72, 84, 94, 106] as const;
/** 무리 고유 대가 ① 나눠 뜯느라 **개체당** 채집 수입이 준다. */
export const HERD_GRAZE_SHARE = [1.0, 0.94, 0.88, 0.8, 0.7] as const;
/** 무리 고유 대가 ② 붙어 사니 **역병이 돈다**(대멸종 「대역병」 솎임 배수). */
export const HERD_PLAGUE = [1.0, 1.25, 1.6, 2.1, 2.8] as const;
/**
 * 무리 → **명령이 닿는 거리(px)**. **[사용자 2026-08-06]** 확정: 명령은 목소리가 닿는 데까지만 가고,
 * 그 거리를 무리 티어가 넓힌다. 무리를 안 판 종은 소수를 직접 데리고 다니는 손맛, 무리를 판 종은
 * 대군을 한 번에 움직이는 맛 · **같은 게임에서 조작 감각이 둘로 갈린다.**
 * (3단부터 사실상 종 전체. 폰 논리 해상도 540x960 기준 화면 대각이 약 1100px 이다.)
 *
 * 티어 0 이 260 → 520 인 이유(2026-08-12 · 순종 처방 셋의 ①): 순종률 17.2% 의 새는 곳 1위가
 * **목소리 밖 35.4%** 였다(2026-08-08 실측). 처방 셋(520 + 「가는 길 먹이」 예외 제거 + 스침 채집)을
 * 한 묶음으로 넣으면 순종 63.7% · 도착 55% 로 실측됐다 · 하나만 넣으면 안 된다(backlog 5번).
 * 1단 700 은 그 처방이 정한 값이 아니라 사다리의 단조 증가(위 [사용자] 확정 「티어가 넓힌다」)를
 * 지키기 위한 내 판단(520~900 의 기하 중간)이다 · 성장 재측정 때 함께 다시 재도 된다.
 */
export const HERD_VOICE = [520, 700, 900, 4000, 4000] as const;
/** 알파가 죽었을 때 명령이 막히는 **지휘 공백** 틱 수. 조직이 있으면 다음 개체가 곧바로 이어받는다. */
export const HERD_VACUUM_TICKS = [150, 110, 75, 45, 20] as const;

const at = (table: readonly number[], tier: number): number =>
  table[Math.max(0, Math.min(MAX_TIER, tier))] as number;

// ─────────────────────────────── 몸집 파생 ───────────────────────────────

/**
 * **[사용자 2026-08-06]** 몸집은 고르는 축이 아니라 **다른 데 안 쓴 것의 잔액**이다.
 * 생물학적으로도 정확하다: 섬 규칙(천적 없는 섬의 코끼리는 1m 로 줄고 설치류는 고양이만 해진다) ·
 * 베르크만 법칙. 몸집은 대사율·수명·새끼 수를 정하는 주 변수이면서 그 자신은 **종속 변수**다.
 *
 * ⚠ **중립점 검산이 이 식의 가장 중요한 제약이다.** 모든 티어 0 · 열쇠 없음이면 정확히 50 이고
 * `sizeDev = 0` 이 되어 몸집의 다섯 소비처(속도·유지비·번식·물기 체급·은신 무력화)가 전부 0 이 된다.
 * 즉 도장을 안 찍은 종은 몸집 축이 **존재하지 않는 것과 같다** — 이게 밸런스 보존의 열쇠다.
 *
 * · 가죽 +8 — 두꺼운 살과 가죽. 가장 큰 양수. **초식 거인의 척추**다.
 * · 이빨 +5 — 무기를 키우면 몸도 무거워진다.
 * · 눈  0   — 중립. 어떤 몸집과도 섞이라고 일부러 비웠다.
 * · 다리 −4 — 빠른 것은 가볍다.
 * · 무리 −2 — 많이 낳으면 작다(다만 약하게 · 코끼리와 들소는 크면서 무리다).
 */
export function derivedSize(pips: Pips, keys: Keys): number {
  const t = tiersOf(pips);
  let s = 50 + 8 * t.hide + 5 * t.fang - 4 * t.leg - 2 * t.herd;
  if (keys.fin) s += 3;
  if (keys.wing) s -= 4;
  if (keys.camo) s -= 4;
  return Math.max(20, Math.min(100, Math.round(s)));
}

// ─────────────────────────────── 공통 유지비 ───────────────────────────────

/**
 * **[사용자 2026-08-06]** 대가는 두 겹이다. (a) 공통 · 티어가 오르면 유지비가 오른다
 * (자연의 배분 원리 · 기력과 굶주림은 이미 sim 에 있다) (b) 범주마다 고유한 대가 하나씩(위 파생표).
 *
 *   유지비 = 1 + 0.038 × Σ티어
 *
 * 모든 티어 0 이면 정확히 1.0 이라 **지금까지의 세계와 완전히 같다**(야생종의 `0.5 + 대사/100` 도
 * 기본 대사 50 에서 1.0 이다 · 두 세계가 같은 축 위에 있다).
 *
 * ⚠ 유지비는 **빌드를 가르는 장치가 아니라 성장 속도를 조절하는 장치**다. 빌드를 가르는 것은
 * 범주 고유 대가다. 계수 0.038 은 최댓값(Σ티어 10)이 ×1.38 로 sim 의 검증된 대사 범위
 * (×0.5 ~ ×1.5) 안에 들도록 잡았다.
 *
 * ⚠ **몸집분과 날개분은 여기 안 곱한다** — `behavior.sizeDrainFactor` 와 `flyDrainMultiplier` 가
 *   따로 곱하고 있어 두 번 걸린다. 날개의 대가(×1.25)는 이제 **티어가 올라도 안 줄어든다**
 *   (예전엔 날개를 키울수록 대가가 싸지는 유일한 자리였다 · 「대가는 커지기만 한다」와 정면 충돌).
 */
export const UPKEEP_PER_TIER = 0.038;

export function derivedUpkeep(pips: Pips): number {
  return 1 + UPKEEP_PER_TIER * tierSum(pips);
}

// ─────────────────────────────── 듀오 ───────────────────────────────

/**
 * 하데스식 듀오 · **두 범주가 함께 3단 이상**이면 그 듀오 **카드가 열린다.**
 * 범주가 다섯이라 짝은 열 개다. 범주를 적게 두면서 조합 수를 곱으로 늘리는 장치다.
 *
 * ⚠⚠ **2026-08-10: 듀오는 더 이상 저절로 켜지지 않는다. 드래프트에서 골라야 한다.**
 *   **[사용자 2026-08-10]** "티어를 올리면 더 좋은 카드, 더 특별한 카드들이 열려서 그걸 위해 티어를
 *   올리는 거고." 그 구조에서 듀오만 혼자 자동 발동이면 「고르는 순간」이 없어 화면에서 안 읽힌다
 *   (backlog: 「듀오 열 개 중 셋은 아직 화면에서 안 읽힌다 · 켜진 순간의 연출이 없다」).
 *   그래서 듀오 열 개는 **조건부 특성**(`sim/perks.ts` 의 `duo_*`)이 되었고, 두 범주 3단은
 *   그 카드가 **후보에 뜨는 조건**(게이트)이다. sim 이 묻는 것도 도장이 아니라
 *   **「그 카드를 골랐는가」**(`perks.hasRule`)다.
 *
 * **아래 `desc`·`flavor` 가 여전히 문구의 단일 진실이다.** 특성 쪽은 이 표를 읽어서 카드를 만든다
 * (`perks.DUO_PERK_DEFS`) · 옮겨 적으면 언젠가 한쪽만 바뀌어 화면이 거짓말을 한다.
 *
 * 왜 3단인가: 두 기둥을 파는 런의 공급이 보통 판 33 · 잘한 판 42 도장이다. 3단 둘(28)은 보통 판에서
 * 아슬아슬하게 하나가 열리고, 4단+3단(35)은 잘한 판에서 확실히 열린다. **[사용자]** 확률이 재미이므로
 * 여기서도 "반드시"가 아니라 "닿을 만하다"로 잡았다.
 */
export interface Duo {
  id: string;
  name: string;
  a: Category;
  b: Category;
  /** 화면에 그대로 쓰는 한 줄. 무엇이 켜지는지 **숫자까지** 적는다(대백과에 안 미룬다). */
  desc: string;
  /** 어떤 동물의 이야기인가 — 툴팁 둘째 줄. */
  flavor: string;
}

export const DUO_TIER = 3;

export const DUOS: readonly Duo[] = [
  {
    id: "pounce",
    name: "덮치기",
    a: "fang",
    b: "leg",
    // ⚠ 2026-08-10 에 문구와 효과를 함께 고쳤다. 옛 문구 「거의 빗나가지 않습니다」는 즉사 확률
    //   +0.25 를 가리켰는데, 전투가 피해 싸움으로 바뀌면서 그 절대값이 뜻을 잃었다(behavior 주석).
    desc: "쫓던 상대에게는 무는 피해가 1.5배입니다.",
    flavor: "치타 · 따라잡으면 끝난다",
  },
  {
    id: "wolflaw",
    name: "늑대의 법",
    a: "fang",
    b: "herd",
    desc: "같이 물면 피해가 1.5배. 잡은 것을 나누는 몫도 커집니다.",
    flavor: "늑대·리카온 · 혼자서는 못 잡는 것을 같이 잡는다",
  },
  {
    id: "ring",
    name: "원진",
    a: "hide",
    b: "herd",
    desc: "이웃이 하나만 있어도 무리 방어가 켜지고, 도는 병이 절반이 됩니다.",
    flavor: "사향소 · 원을 만들고 안쪽에 새끼를 넣는다",
  },
  {
    id: "seefirst",
    name: "먼저 보고 먼저 뛴다",
    a: "eye",
    b: "leg",
    desc: "포식자를 1.5배 멀리서 알아채고, 도망칠 때 더 빨라집니다.",
    flavor: "가젤·영양",
  },
  {
    id: "sentinel",
    name: "파수꾼",
    a: "eye",
    b: "herd",
    desc: "한 마리가 본 것을 전원이 압니다. 눈의 좁은 시야가 절반으로 줄어듭니다.",
    flavor: "미어캣 · 누군가는 언제나 깨어 있다",
  },
  {
    id: "charge",
    name: "돌진",
    a: "hide",
    b: "leg",
    desc: "부딪혀 싸웁니다. 보스를 밀어내는 힘이 1.6배가 됩니다.",
    flavor: "코뿔소·들소",
  },
  {
    id: "ambush",
    name: "매복",
    a: "eye",
    b: "fang",
    desc: "나를 아직 못 본 상대를 물면 피해가 2배입니다.",
    flavor: "표범 · 한 번에 끝낸다",
  },
  {
    id: "stone",
    name: "바위",
    a: "hide",
    b: "eye",
    desc: "가만히 있으면 포식자 눈에 잘 안 띕니다.",
    flavor: "거북·카멜레온 · 움직이지 않으면 돌이다",
  },
  {
    id: "bigjaw",
    name: "큰 턱",
    a: "hide",
    b: "fang",
    desc: "한 번 문 것으로 기력이 훨씬 많이 찹니다.",
    flavor: "악어·큰곰",
  },
  {
    id: "wave",
    name: "파도",
    a: "leg",
    b: "herd",
    desc: "무리가 한 몸처럼 방향을 바꿉니다. 그때 쫓던 포식자가 표적을 놓칩니다.",
    flavor: "정어리 떼·찌르레기 군무",
  },
];

export const DUO_BY_ID: ReadonlyMap<string, Duo> = new Map(DUOS.map((d) => [d.id, d]));

/**
 * **이 도장으로 후보에 뜰 수 있는 듀오 카드들** · 「가진 듀오」가 아니라 「열린 듀오」다.
 *
 * ⚠ 듀오는 이제 카드라, 열렸다고 켜진 것이 아니다. 그 종이 실제로 **가진** 듀오는
 *   `perks.ownedDuos(genome.perks)` 가 답한다.
 */
export function openDuos(pips: Pips): Duo[] {
  const t = tiersOf(pips);
  return DUOS.filter((d) => t[d.a] >= DUO_TIER && t[d.b] >= DUO_TIER);
}

/**
 * @deprecated 옛 이름. 듀오가 카드가 된 뒤로 「활성」이 아니라 **「열림」**을 뜻한다(`openDuos`).
 *
 * ⚠ `src/ui/buildPanel.ts` · `src/ui/draftPanel.ts` 가 아직 이 결과를 「가진 듀오」로 표시하는데,
 *   그건 이제 참이 아니다. UI 갈래가 `perks.ownedDuos(genome.perks)` 로 바꿔야 화면이 참말을 한다.
 *   이름을 그대로 남겨 둔 이유는 이 파일 갈래가 `src/ui/` 를 안 건드리기로 했기 때문이다.
 */
export const activeDuos = openDuos;

/**
 * **한 칸 앞에서 예고할 듀오** — 한쪽이 3단이고 다른 쪽이 2단일 때 하나 고른다.
 * 드래프트 헤더에 「무리 III 이 되면 늑대의 법이 열립니다」 한 줄로 뜬다. 조건에 못 닿은 판에서도
 * 듀오가 존재한다는 것을 알게 되고, 그게 다음 판의 동기가 된다(대백과에 안 미룬다).
 *
 * ⚠ **지우지 않고 남긴 이유**(2026-08-10 판단): 듀오가 카드가 되면서 뜻이 「켜진다」에서
 *   **「후보에 뜬다」**로 바뀌었을 뿐, 계산은 한 글자도 달라지지 않는다 · 어느 범주를 몇 칸 올리면
 *   3단 두 개가 되는가. 오히려 지금이 이 예고가 더 필요한 자리다. 티어를 올릴 이유가 파생 능치가
 *   아니라 **열리는 카드**이므로(**[사용자 2026-08-10]**), 「무엇이 열리는가」를 미리 말해 주지
 *   않으면 방울을 쓸 이유가 화면에서 사라진다.
 * ⚠ 다만 **UI 문구는 「켜집니다」가 아니라 「열립니다」여야 한다**(`src/ui/draftPanel.ts`).
 *   지금 그 자리는 아직 옛 낱말을 쓴다 · UI 갈래가 고쳐야 할 한 줄이다.
 */
export function nearDuo(pips: Pips): { duo: Duo; need: Category; pips: number } | null {
  const t = tiersOf(pips);
  let best: { duo: Duo; need: Category; pips: number } | null = null;
  for (const d of DUOS) {
    const pair: [Category, Category][] = [
      [d.a, d.b],
      [d.b, d.a],
    ];
    for (const [have, want] of pair) {
      if (t[have] < DUO_TIER || t[want] >= DUO_TIER) continue;
      const need = pipsForTier(DUO_TIER) - pips[want];
      if (need <= 0) continue;
      if (best === null || need < best.pips) best = { duo: d, need: want, pips: need };
    }
  }
  return best;
}

// ─────────────────────────────── 파생 능치 만들기 ───────────────────────────────

/**
 * 도장 + 열쇠 → sim 이 읽는 능치 한 벌.
 *
 * **이 함수가 이 게임의 유일한 성장 규칙이다.** 카드는 도장만 주고, 세계는 여기서 나온 값만 본다.
 * 그래서 "카드에 적힌 것과 실제가 다르다"가 원리적으로 불가능하다 — 카드는 도장을 적고, 도장은
 * 문턱을 넘거나 못 넘거나 둘 중 하나이며, 넘으면 이 표의 다음 칸이 통째로 켜진다.
 */
export function deriveTraits(pips: Pips, keys: Keys): Traits {
  const t = tiersOf(pips);
  const size = derivedSize(pips, keys);

  // 열쇠 세기 = 모 범주의 티어. 안 가진 열쇠는 0(= 그 능력이 세계에 존재하지 않는 것과 같다).
  const swimming = keys.fin ? 68 + 4 * t.leg : 40;
  const wings = keys.wing ? 66 + 8 * t.leg : 0;
  const echo = keys.echo ? at(EYE_ECHO, t.eye) : 0;
  const camouflage = keys.camo ? 42 + 14 * t.eye : 0;
  const venom = keys.venom ? 40 + 15 * t.fang : 0;
  const ranged = keys.barb ? 58 + 11 * t.fang : 0;

  // 뿔·뱉기는 멀리서 치는 대신 가까이서 무는 힘을 20% 내놓는다(고유 대가).
  const attack = Math.round(at(FANG_ATTACK, t.fang) * (keys.barb ? 0.8 : 1));

  return {
    speed: at(LEG_SPEED, t.leg),
    attack,
    defense: at(HIDE_DEFENSE, t.hide),
    vision: at(EYE_VISION, t.eye),
    herding: at(HERD_HERDING, t.herd),
    fertility: at(HERD_FERT, t.herd),
    metabolism: at(HIDE_METAB, t.hide),
    upkeep: derivedUpkeep(pips),
    size,
    diet: at(FANG_DIET, t.fang),
    // 무리는 나눠 뜯느라 개체당 채집 수입이 준다(고유 대가).
    graze: at(FANG_GRAZE, t.fang) * at(HERD_GRAZE_SHARE, t.herd),
    // 독니는 무는 데 독을 쓰느라 사냥 뒤 회복이 20% 준다(고유 대가).
    hunt: at(FANG_HUNT, t.fang) * (keys.venom ? 0.8 : 1),
    carnivory: at(FANG_CARN, t.fang),
    fovCos: at(EYE_FOV_COS, t.eye),
    sprintCost: at(LEG_SPRINT_COST, t.leg),
    plague: at(HERD_PLAGUE, t.herd),
    swimming,
    echo,
    wings,
    venom,
    ranged,
    camouflage,
  };
}

/**
 * 야생종·옛 게놈처럼 **손으로 정한 능치**에서 도장을 역산한다.
 *
 * ⚠ 이 함수는 밸런스에 닿지 않는다 — 야생은 자기 능치를 그대로 쓰고, 여기서 나온 도장은
 * **화면 표시와 「이 종이 몇 단짜리인가」 비교**에만 쓴다. 야생 생태를 티어 격자에 억지로 맞추면
 * 손으로 오래 튜닝한 붐-버스트가 통째로 흔들린다.
 */
export function pipsFromTraits(t: Traits): Pips {
  const back = (table: readonly number[], v: number): number => {
    let tier = 0;
    for (let i = 1; i <= MAX_TIER; i += 1) if (v >= (table[i] as number)) tier = i;
    return pipsForTier(tier);
  };
  return {
    fang: back(FANG_ATTACK, t.attack),
    leg: back(LEG_SPEED, t.speed),
    eye: back(EYE_VISION, t.vision),
    hide: back(HIDE_DEFENSE, t.defense),
    herd: back(HERD_HERDING, t.herding),
  };
}

/**
 * **가장 가까운 다음 문턱** — 어느 범주가 몇 개 남았는가. 이미 판 방향을 우선한다(도장이 많은 쪽).
 * "문턱 하나 앞"이라는 욕구가 이 게임이 플레이어를 미는 대신 **당기는** 장치다.
 * 도장이 하나도 없으면 null.
 */
export function nearestTierGoal(pips: Pips): { cat: Category; tier: number; need: number } | null {
  let best: { cat: Category; tier: number; need: number } | null = null;
  for (const c of CATEGORIES) {
    if (pips[c] <= 0) continue;
    const t = tierOf(pips[c]);
    if (t >= MAX_TIER) continue;
    const need = pipsForTier(t + 1) - pips[c];
    if (best === null || need < best.need) best = { cat: c, tier: t + 1, need };
  }
  return best;
}

/**
 * 티어 줄 한 벌 · **한 줄은 두 토막이다**(2026-08-10).
 *
 * 왜 쪼갰나 (**[사용자 2026-08-10]** 폰 검토): "티어별 얻는 것과 잃는 것 설명도 좀 길고 많아보이긴
 * 하네. UI를 깔끔하게 만드는 게 필요하겠어." 한 줄에 **수치와 규칙 변화가 함께** 들어 있어서
 * (「무는 힘 ×1.56 · 보스에 맞설 수 있습니다」) 다섯 범주를 늘어놓으면 화면이 글자로 꽉 찼다.
 *
 * 그런데 이 저장소의 제1 규칙은 「수치가 화면 표시와 다르면 그건 거짓말이다」라, 수치를 **지울 수는
 * 없다.** 그래서 지우는 대신 **접는다**: 줄을 「머리」와 「접힘」으로 쪼개고, 좁은 화면은 머리만
 * 보여 주다가 「자세히」를 누르면 접힘까지 편다.
 *
 * ⚠ **`gain`·`cost` 는 예전과 같은 자립형 한 줄이다**(계약 유지) · 머리와 접힘을 ` · ` 로 이어 만든다.
 *   카드 각주(`draftPanel`)·승급 연출(`main.playTierUps`)·도감은 그대로 이 둘만 읽으면 된다.
 */
export interface TierLine {
  /** **자립형 한 줄**(머리 · 접힘). 「×0.5」처럼 앞줄에 기대는 축약을 쓰지 않는다. */
  gain: string;
  cost: string;
  /** 이 범주를 한 단 올릴 때 몸집이 움직이는 몫(중립 표시용 · `SIZE_PER_TIER` 에서 나온다). */
  size: number;
  /** **접어도 남는 한 마디** — 대개 「무엇이 달라지는가」. 화면이 좁으면 이것만 보인다. */
  gainHead: string;
  costHead: string;
  /** **접히는 나머지** — 대개 수치. 없으면 빈 문자열이고, 그러면 접을 것도 없다. */
  gainFold: string;
  costFold: string;
}

/**
 * 티어 하나가 켜질 때 화면에 뜨는 한 줄 — **무엇이 켜졌고 무엇을 잃었는가**.
 * 승급 연출·카드 각주·내 종 패널·구입 화면·대백과가 전부 이 함수만 부른다.
 *
 * ⚠ **배수는 문구에 박지 않고 위 파생표에서 계산한다.** 처음엔 "빠르기 ×1.19" 처럼 손으로 적었는데,
 *   그 뒤 파생표를 세 번 튜닝하는 동안 문구는 그대로 남아 **화면이 거짓말을 하게 됐다**. 이 저장소의
 *   규칙("수치가 화면 표시와 다르면 그건 거짓말이다")을 지키는 유일한 방법은 표를 읽는 것이다.
 *
 * ⚠ **모든 줄은 자립형이다.** 「×0.5」처럼 앞줄에 기대는 축약을 쓰지 않는다 — 이 문구는 카드 각주 ·
 *   도감 · 승급 연출에 **단독으로** 뜨므로, 무엇의 ×0.5 인지가 그 줄 안에 있어야 한다.
 *   쪼갠 머리·접힘도 각자 그 규칙을 지킨다(머리만 봐도, 이어 붙여 봐도 말이 된다).
 *
 * ⚠ **머리에는 「규칙이 어떻게 바뀌는가」를, 접힘에는 「수치」를 둔다.** 그 단에 규칙 변화가 없으면
 *   (예: 다리 I단은 그냥 빨라질 뿐이다) 수치가 곧 그 단의 전부이므로 머리가 수치를 맡고 접힘이 빈다.
 *
 * ⚠ **열쇠를 함께 넘겨라.** 같은 티어라도 열쇠를 가진 종에게는 **다른 일이 일어난다**(지금은 눈 ×
 *   초음파 한 자리). 안 넘기면 열쇠 없는 종의 문구가 나오므로 기존 호출부는 그대로 통과하지만,
 *   종의 게놈이 손에 있는 자리(구입 화면·카드 각주·승급 연출)에서는 **반드시 넘겨야** 화면이
 *   그 종에게 참인 말을 한다.
 */
export function tierLine(cat: Category, tier: number, keys?: Keys): TierLine {
  const i = Math.max(0, Math.min(MAX_TIER, tier));
  /** 머리와 접힘을 자립형 한 줄로 잇는다 · 한쪽이 비면 나머지가 그대로 그 줄이다. */
  const join = (head: string, fold: string): string =>
    head === "" ? fold : fold === "" ? head : `${head} · ${fold}`;
  const made = (g: readonly [string, string], c: readonly [string, string], size: number): TierLine => ({
    gain: join(g[0], g[1]),
    cost: join(c[0], c[1]),
    size,
    gainHead: g[0],
    gainFold: g[1],
    costHead: c[0],
    costFold: c[1],
  });
  if (i === 0) return made(["", ""], ["", ""], 0);
  /** 0단 대비 배수 — 표를 직접 읽어 계산한다. */
  const rel = (table: readonly number[], base = table[0] as number): string =>
    `×${((table[i] as number) / base).toFixed(2).replace(/0$/, "")}`;
  /** 최고 속도는 `1.7 × (0.4 + 값/100)` 이라 값의 비가 아니다 — 실제 공식으로 잰다. */
  const speedRel = (): string => {
    const f = (v: number): number => 0.4 + v / 100;
    return `×${(f(LEG_SPEED[i] as number) / f(LEG_SPEED[0] as number)).toFixed(2).replace(/0$/, "")}`;
  };
  /** 새끼 확률은 `0.3 + 번식/100` 에 비례한다. */
  const broodRel = (): string => {
    const f = (v: number): number => 0.3 + v / 100;
    return `×${(f(HERD_FERT[i] as number) / f(HERD_FERT[0] as number)).toFixed(2).replace(/0$/, "")}`;
  };
  /** [머리, 접힘] · 머리는 규칙 변화, 접힘은 수치. 규칙 변화가 없는 단은 머리가 수치를 맡는다. */
  type Split = readonly [string, string];
  const gain: Record<Category, readonly Split[]> = {
    fang: [
      ["", ""],
      ["사냥이 열립니다", `무는 힘 ${rel(FANG_ATTACK)}`],
      ["보스에 맞설 수 있습니다", `무는 힘 ${rel(FANG_ATTACK)}`],
      ["한 번 잡으면 오래 버팁니다", `무는 힘 ${rel(FANG_ATTACK)}`],
      ["나보다 큰 것도 뭅니다", "어떤 가죽도 이빨을 못 막습니다"],
    ],
    leg: [
      ["", ""],
      [`빠르기 ${speedRel()}`, ""],
      ["사냥할 때 질주합니다", `빠르기 ${speedRel()}`],
      ["험한 땅을 평지처럼 지납니다", `빠르기 ${speedRel()}`],
      ["아무도 나를 쫓지 않습니다", "험한 땅이 걸음을 못 늦춥니다"],
    ],
    eye: [
      ["", ""],
      [`보는 거리 ${rel(EYE_VISION)}`, ""],
      ["밤에도 봅니다", `보는 거리 ${rel(EYE_VISION)}`],
      ["수풀 속이 보입니다", `보는 거리 ${rel(EYE_VISION)}`],
      ["밤도 수풀도 숨은 것도 눈을 못 가립니다", ""],
    ],
    hide: [
      ["", ""],
      // 「물려도 덜 다칩니다」는 「버티는 힘 ×1.21」을 쉬운 말로 옮긴 것뿐이라 같은 줄에 둘 다 두면
      // 같은 말을 두 번 한다 · 쉬운 말을 머리에, 수치를 접힘에 둔다.
      ["덜 다치고 추위에 강해집니다", `버티는 힘 ${rel(HIDE_DEFENSE)}`],
      ["한파를 거의 안 탑니다", `버티는 힘 ${rel(HIDE_DEFENSE)}`],
      ["보스를 버텨서 넘을 수 있습니다", `버티는 힘 ${rel(HIDE_DEFENSE)}`],
      ["환경이 통째로 바뀌어도 안 죽습니다", ""],
    ],
    herd: [
      ["", ""],
      ["명령이 멀리 갑니다", `새끼 확률 ${broodRel()}`],
      ["잡은 것을 무리가 나눠 먹습니다", `새끼 확률 ${broodRel()}`],
      ["뭉치면 포식자가 안 건드립니다", `새끼 확률 ${broodRel()}`],
      ["무리 안에 있는 한 즉사하지 않습니다", ""],
    ],
  };
  /** 전속력으로 달릴 때 유지비에 얹히는 몫(%). 다리의 고유 대가. */
  const sprintPct = (): string => `${Math.round((LEG_SPRINT_COST[i] as number) * 100)}%`;
  /** 시야각(도) — 표의 cos 을 사람이 읽는 각으로 되돌린다. */
  const fovDeg = (n: number): string => `${Math.round((Math.acos(EYE_FOV_COS[n] as number) * 360) / Math.PI)}°`;
  /** 더위 피해 배수 — 두꺼운 몸은 열을 못 버린다(`heatDrain ×= 대사/100`). */
  const heatRel = (): string =>
    `×${((HIDE_METAB[i] as number) / (HIDE_METAB[0] as number)).toFixed(2).replace(/0$/, "")}`;

  // ⚠ **잃는 것 칸에는 「방향이 분명한 손해」만 적는다.**
  //   처음엔 여기에 「몸이 무거워집니다」처럼 몸집 변화를 적었는데, 두 가지가 틀렸다:
  //   ① **무거워지는 게 좋은지 나쁜지가 안 읽힌다.** 큰 몸은 잘 안 물리는 이득이면서 느리고 많이
  //      먹는 손해다 — 방향이 섞인 것을 「잃는 것」 칸에 넣으면 그 자체로 거짓말이다.
  //   ② **몸집은 다섯 범주가 함께 정하는 파생값이다.** 이빨을 파면서 다리도 판 종은 실제로 안 커진다.
  //      한 범주의 줄에서 몸집을 단정하면 그 종에게는 틀린 말이 된다.
  //   몸집은 `SIZE_PER_TIER` 로 따로 내보내 **중립 표시**(「몸집 +5」)와 그림(카드 미리보기에서
  //   생물이 실제로 커진다)이 맡는다. 무엇을 뜻하는지는 `SIZE_MEANING` 한 곳에서만 말한다.
  const cost: Record<Category, readonly Split[]> = {
    fang: [
      ["", ""],
      [`풀에서 얻는 것 ${rel(FANG_GRAZE)}`, ""],
      [`풀에서 얻는 것 ${rel(FANG_GRAZE)}`, ""],
      ["풀만으로는 못 버팁니다", `풀에서 얻는 것 ${rel(FANG_GRAZE)}`],
      ["사실상 고기만 먹습니다", `풀에서 얻는 것 ${rel(FANG_GRAZE)}`],
    ],
    leg: [
      ["", ""],
      [`전속력으로 달리면 배가 ${sprintPct()} 더 고픕니다`, ""],
      [`전속력으로 달리면 배가 ${sprintPct()} 더 고픕니다`, ""],
      [`전속력으로 달리면 배가 ${sprintPct()} 더 고픕니다`, ""],
      [`전속력으로 달리면 배가 ${sprintPct()} 더 고픕니다`, ""],
    ],
    eye: [
      ["", ""],
      // 「한눈에」를 뺐다 · 「보는 각」 자체가 이미 한눈에 담기는 부채꼴이라 없어도 뜻이 안 바뀐다.
      // 출발 각(0단 160°)은 접힘으로 내린다 · 나머지 단은 애초에 도착 각만 말한다(표기가 한 벌이 된다).
      [`보는 각이 ${fovDeg(1)} 로 좁아집니다`, `원래 ${fovDeg(0)}`],
      [`보는 각이 ${fovDeg(2)} 로 좁아집니다`, ""],
      [`보는 각이 ${fovDeg(3)} 로 좁아집니다`, "뒤가 거의 안 보입니다"],
      [`보는 각이 ${fovDeg(4)} 로 좁아집니다`, "최고 단계여도 안 넓어집니다"],
    ],
    hide: [
      ["", ""],
      [`더위에 받는 피해 ${heatRel()}`, ""],
      [`더위에 받는 피해 ${heatRel()}`, ""],
      [`더위에 받는 피해 ${heatRel()}`, ""],
      ["뙤약볕에서 가장 먼저 지칩니다", `더위에 받는 피해 ${heatRel()}`],
    ],
    herd: [
      ["", ""],
      [`개체당 풀 수입 ${rel(HERD_GRAZE_SHARE)} · 역병 피해 ${rel(HERD_PLAGUE)}`, ""],
      [`개체당 풀 수입 ${rel(HERD_GRAZE_SHARE)} · 역병 피해 ${rel(HERD_PLAGUE)}`, ""],
      [`개체당 풀 수입 ${rel(HERD_GRAZE_SHARE)} · 역병 피해 ${rel(HERD_PLAGUE)}`, ""],
      [
        "한 번 돌면 무리가 휩쓸립니다",
        `개체당 풀 수입 ${rel(HERD_GRAZE_SHARE)} · 역병 피해 ${rel(HERD_PLAGUE)}`,
      ],
    ],
  };
  // ── 초음파를 가진 종의 눈 사다리 · **눈 하나로 두 감각이 함께 자란다** ──────────────────
  // 초음파는 눈 범주의 열쇠라 세기가 눈 티어를 그대로 따라 오른다(`EYE_ECHO`). 그런데 지금까지
  // 이 줄은 「보는 거리」만 말해서, 초음파를 얻은 사람에게는 **눈을 더 파야 할 이유가 화면에서
  // 사라져 있었다**(사용자 질문: "초음파를 얻은 다음에는 눈 강화는 의미 없는 거 아니야?").
  // 그래서 **듣는 거리도 같은 줄에 적는다** · 답이 그 자리에 있게.
  //
  // 밤·수풀 특전을 여기서 빼는 이유(2·3단): 그 둘은 **초음파가 이미 하고 있는 일**이다. 밤에는
  // 감지가 초음파 반경으로 정해지므로(0~3단 실측: 밤 시야 88.8~169.7 < 초음파 110.2~184.3),
  // 눈의 밤 보정이 올라가도 그 종이 실제로 아는 범위는 1px 도 안 넓어진다. 이미 켜져 있는 것을
  // 새로 준다고 말하는 것은 이 저장소가 금지한 거짓말이다. 4단은 다르다 · 거기서는 밤·수풀 면제로
  // 시야(236)가 초음파(209)를 **밤에도** 넘으므로, 그 줄만 특전을 그대로 남긴다.
  //
  // ⚠ 대가(부채꼴)는 **손대지 않는다.** 초음파가 전방위라도 시야가 이기는 낮에는 초음파 반경 밖의
  //   초승달(예: 낮 4단 209~236px)이 부채꼴 안에서만 보이므로, 좁아지는 것이 이 종에게도 진짜 손해다.
  if (cat === "eye" && keys?.echo === true) {
    const both = `보는 거리 ${rel(EYE_VISION)} · 듣는 거리 ${rel(EYE_ECHO)}`;
    // 이 종에게는 **두 수치가 곧 그 단의 답**이다("초음파를 얻으면 눈은 이제 쓸모없나?"). 그래서
    // 여기서만 수치가 머리에 선다 — 접어 놓으면 물음에 답을 못 하는 화면이 된다.
    const g: Split = i === MAX_TIER ? ["밤도 수풀도 눈을 못 가립니다", both] : [both, ""];
    return made(g, cost[cat][i] as Split, SIZE_PER_TIER.eye * i);
  }
  return made(gain[cat][i] as Split, cost[cat][i] as Split, SIZE_PER_TIER[cat] * i);
}

/**
 * **몸집은 범주마다 이만큼씩 움직인다** (`derivedSize` 의 계수와 같은 표 · 두 곳에 적지 않으려고 여기서 뽑는다).
 * 화면은 이 값을 **중립으로** 표시한다(「몸집 +5」) — 좋고 나쁨을 단정하지 않는다.
 */
export const SIZE_PER_TIER: Record<Category, number> = {
  hide: 8,
  fang: 5,
  eye: 0,
  leg: -4,
  herd: -2,
};

/**
 * **몸집이 무엇을 뜻하는가 — 이 한 줄이 유일한 설명이다.**
 *
 * 몸집은 좋고 나쁨이 갈리지 않는 축이라, 티어 줄의 「얻는 것 / 잃는 것」 어느 쪽에도 넣을 수 없다.
 * 대신 몸집 값을 보여 주는 자리(내 종 패널 · 카드 미리보기)가 이 문장을 함께 띄운다.
 * 그리고 무엇보다 **그림이 먼저 말한다** — 카드를 고르면 미리보기의 생물이 실제로 커지거나 작아진다.
 */
export const SIZE_MEANING =
  "큰 몸은 좀처럼 안 물리지만 느리고 많이 먹고 새끼를 적게 칩니다. 작은 몸은 정확히 반대입니다.";
