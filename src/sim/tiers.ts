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
 * 왜 이 숫자인가 — 한 런에 모을 수 있는 도장이 정한다. 카드는 3장 중 1장을 고르므로 한 드래프트의
 * 기대 도장은 평균이 아니라 **최댓값**이고, 한 범주를 노릴 때 약 1.09개다. 카드 예산은 고정이 아니라
 * **띠**다(손 놓으면 12장 · 보통 17 · 아주 잘하면 22 · **[사용자]** 상한 자체를 문제 삼아 풀었다).
 *
 * **아래 표는 계산이 아니라 실측이다** (`npm run probe -- tiers` · 실제 75장 풀 · 희귀도 가중 ·
 * 소프트 디듑 · 3000런). 카드가 주는 도장은 「한 범주 최고」 기준이다.
 *
 * 표의 수는 「최고 범주 도장 / 2위 범주 도장」이고, 괄호는 그 결과 켜지는 티어다.
 *
 * | 어떻게 골랐나 | 12장 | 17장 | 22장 |
 * |---|---|---|---|
 * | 한 범주만 판다 | 16.4 / 7.4 (III) | **20.2 / 9.7 (IV 73%)** | 22.6 / 12.3 (IV 96%) |
 * | 두 범주를 판다 | 16.2 / 11.0 (III+II) | **20.0 / 15.2 (IV+III · 듀오 80%)** | 22.3 / 19.1 (IV+III) |
 * | 큰 숫자만 고른다 | 12.3 / 9.3 (II+II) | 15.5 / 12.1 (III+II) | 18.3 / 15.0 (III+III) |
 * | 아무거나 고른다 | 11.0 / 8.5 (II · **3단 0.15개**) | 13.9 / 10.6 (II~III) | 16.6 / 13.3 (III+II) |
 *
 * 마지막 줄이 이 재설계의 목표다. 예전엔 정점 넷이 런 끝에 **반드시** 다 찍혔는데, 이제 손 놓은
 * 판은 **관문 자격을 하나도 못 얻는다**(3단이 평균 0.15개). 그리고 다섯 범주 전부 4단은 원리적으로
 * 불가능하다 — 그러려면 100 도장이 필요한데 가장 후한 판의 공급이 약 35다.
 * **[사용자]** 최고 티어는 대멸종을 세 번 넘긴 뒤(시대 4)에 열린다 = 누적 20.
 *
 * ⚠ **이 표는 프리셋 시작 도장 7(주 4 + 부 3)과 카드 풀 75장을 전제로 한다.** 둘 중 하나라도
 *   만지면 사다리 전체가 움직이므로 반드시 `npm run probe -- tiers` 를 다시 돌려라.
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
 */
export const HERD_VOICE = [260, 520, 900, 4000, 4000] as const;
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
 * 하데스식 듀오 — **두 범주가 함께 3단 이상**일 때만 켜진다. 범주가 다섯이라 짝은 열 개다.
 * 범주를 적게 두면서 조합 수를 곱으로 늘리는 장치이자, "문턱 하나 앞"이라는 욕구를 만드는 장치다.
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
    desc: "쫓는 중에 무는 첫 이빨이 거의 빗나가지 않습니다.",
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

/** 지금 켜져 있는 듀오들. */
export function activeDuos(pips: Pips): Duo[] {
  const t = tiersOf(pips);
  return DUOS.filter((d) => t[d.a] >= DUO_TIER && t[d.b] >= DUO_TIER);
}

export function hasDuo(pips: Pips, id: string): boolean {
  const d = DUO_BY_ID.get(id);
  if (!d) return false;
  const t = tiersOf(pips);
  return t[d.a] >= DUO_TIER && t[d.b] >= DUO_TIER;
}

/**
 * **한 칸 앞에서 예고할 듀오** — 한쪽이 3단이고 다른 쪽이 2단일 때 하나 고른다.
 * 드래프트 헤더에 「무리 III 이 되면 늑대의 법이 켜집니다」 한 줄로 뜬다. 조건에 못 닿은 판에서도
 * 듀오가 존재한다는 것을 알게 되고, 그게 다음 판의 동기가 된다(대백과에 안 미룬다).
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
  const echo = keys.echo ? 58 + 13 * t.eye : 0;
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
 * 티어 하나가 켜질 때 화면에 뜨는 한 줄 — **무엇이 켜졌고 무엇을 잃었는가**.
 * 승급 연출·카드 각주·내 종 패널·대백과가 전부 이 함수만 부른다.
 *
 * ⚠ **배수는 문구에 박지 않고 위 파생표에서 계산한다.** 처음엔 "빠르기 ×1.19" 처럼 손으로 적었는데,
 *   그 뒤 파생표를 세 번 튜닝하는 동안 문구는 그대로 남아 **화면이 거짓말을 하게 됐다**. 이 저장소의
 *   규칙("수치가 화면 표시와 다르면 그건 거짓말이다")을 지키는 유일한 방법은 표를 읽는 것이다.
 *
 * ⚠ **모든 줄은 자립형이다.** 「×0.5」처럼 앞줄에 기대는 축약을 쓰지 않는다 — 이 문구는 카드 각주 ·
 *   도감 · 승급 연출에 **단독으로** 뜨므로, 무엇의 ×0.5 인지가 그 줄 안에 있어야 한다.
 */
export function tierLine(cat: Category, tier: number): { gain: string; cost: string; size: number } {
  const i = Math.max(0, Math.min(MAX_TIER, tier));
  if (i === 0) return { gain: "", cost: "", size: 0 };
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
  const gain: Record<Category, readonly string[]> = {
    fang: [
      "",
      `사냥이 열립니다 · 무는 힘 ${rel(FANG_ATTACK)}`,
      `무는 힘 ${rel(FANG_ATTACK)} · 보스에 맞설 수 있습니다`,
      `무는 힘 ${rel(FANG_ATTACK)} · 한 번 잡으면 오래 버팁니다`,
      "나보다 큰 것도 뭅니다 · 어떤 가죽도 이빨을 못 막습니다",
    ],
    leg: [
      "",
      `빠르기 ${speedRel()}`,
      `빠르기 ${speedRel()} · 사냥할 때 질주합니다`,
      `빠르기 ${speedRel()} · 험한 땅을 평지처럼 지납니다`,
      "아무도 나를 쫓지 않습니다 · 험한 땅이 걸음을 못 늦춥니다",
    ],
    eye: [
      "",
      `보는 거리 ${rel(EYE_VISION)}`,
      `보는 거리 ${rel(EYE_VISION)} · 밤에도 봅니다`,
      `보는 거리 ${rel(EYE_VISION)} · 수풀 속이 보입니다`,
      "밤도 수풀도 숨은 것도 눈을 못 가립니다",
    ],
    hide: [
      "",
      `물려도 덜 다칩니다 · 버티는 힘 ${rel(HIDE_DEFENSE)} · 추위에 강해집니다`,
      `버티는 힘 ${rel(HIDE_DEFENSE)} · 한파를 거의 안 탑니다`,
      `버티는 힘 ${rel(HIDE_DEFENSE)} · 보스를 버텨서 넘을 수 있습니다`,
      "환경이 통째로 바뀌어도 안 죽습니다",
    ],
    herd: [
      "",
      `새끼 확률 ${broodRel()} · 명령이 멀리 갑니다`,
      `새끼 확률 ${broodRel()} · 잡은 것을 무리가 나눠 먹습니다`,
      `새끼 확률 ${broodRel()} · 뭉치면 포식자가 안 건드립니다`,
      "무리 안에 있는 한 즉사하지 않습니다",
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
  const cost: Record<Category, readonly string[]> = {
    fang: [
      "",
      `풀에서 얻는 것 ${rel(FANG_GRAZE)}`,
      `풀에서 얻는 것 ${rel(FANG_GRAZE)}`,
      `풀에서 얻는 것 ${rel(FANG_GRAZE)} · 풀만으로는 못 버팁니다`,
      `풀에서 얻는 것 ${rel(FANG_GRAZE)} · 사실상 고기만 먹습니다`,
    ],
    leg: [
      "",
      `전속력으로 달리면 배가 ${sprintPct()} 더 고픕니다`,
      `전속력으로 달리면 배가 ${sprintPct()} 더 고픕니다`,
      `전속력으로 달리면 배가 ${sprintPct()} 더 고픕니다`,
      `전속력으로 달리면 배가 ${sprintPct()} 더 고픕니다`,
    ],
    eye: [
      "",
      `한눈에 보는 각이 ${fovDeg(0)} 에서 ${fovDeg(1)} 로 좁아집니다`,
      `한눈에 보는 각이 ${fovDeg(2)} 로 좁아집니다`,
      `한눈에 보는 각이 ${fovDeg(3)} · 뒤가 거의 안 보입니다`,
      `한눈에 보는 각이 ${fovDeg(4)} · 최고 단계여도 안 넓어집니다`,
    ],
    hide: [
      "",
      `더위에 받는 피해 ${heatRel()}`,
      `더위에 받는 피해 ${heatRel()}`,
      `더위에 받는 피해 ${heatRel()}`,
      `더위에 받는 피해 ${heatRel()} · 뙤약볕에서 가장 먼저 지칩니다`,
    ],
    herd: [
      "",
      `개체당 풀 수입 ${rel(HERD_GRAZE_SHARE)} · 역병 피해 ${rel(HERD_PLAGUE)}`,
      `개체당 풀 수입 ${rel(HERD_GRAZE_SHARE)} · 역병 피해 ${rel(HERD_PLAGUE)}`,
      `개체당 풀 수입 ${rel(HERD_GRAZE_SHARE)} · 역병 피해 ${rel(HERD_PLAGUE)}`,
      `개체당 풀 수입 ${rel(HERD_GRAZE_SHARE)} · 역병 피해 ${rel(HERD_PLAGUE)} · 한 번 돌면 무리가 휩쓸립니다`,
    ],
  };
  return { gain: gain[cat][i] as string, cost: cost[cat][i] as string, size: SIZE_PER_TIER[cat] * i };
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
