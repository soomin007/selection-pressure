// 형질 표시 공통 — 능력형 형질(수영·날개·초음파·독·원거리)은 0~100 연속이 무의미(임계·켜짐/꺼짐)라
// 3단계(없음/보통/강함)로 보여준다. 프리셋 화면·설계도·대백과가 같은 규칙을 쓰도록 한 곳에 모은다(폰 피드백).

import { SIM } from "@/sim/params";
import { isApexTrait, TRAIT_CEILING, TRAIT_LABELS, type Traits } from "@/sim/genome";
import { cardDelta, effectiveDelta, type Card } from "@/game/cards";

/**
 * 3단계로 표시하는 능력형 형질들(연속 수치 대신 없음/보통/강함).
 * v7: 무리 성향(herding)이 여기로 내려왔다 — 값 형질(기본 50)이면서 여덟 프리셋 중 하나에서만 실제로
 * 작동해, 나머지 빌드에선 뭉치느라 먹이 탐색만 좁아지는 순손해였다. 이제 카드로 여는 능력이다.
 * 은신(camouflage)도 능력형(기본 0).
 */
export const ABILITY_KEYS = new Set<keyof Traits>([
  "swimming", "wings", "echo", "venom", "ranged", "herding", "camouflage",
]);

/** 능력형 형질 값 → 0(없음)/1(보통)/2(강함). 임계(수영·날개는 통행 임계, 나머지는 55)로 나눈다. */
export function abilityLevel(key: keyof Traits, v: number): 0 | 1 | 2 {
  if (key === "swimming") return v >= SIM.aquaticOnlyThreshold ? 2 : v >= SIM.swimThreshold ? 1 : 0; // 물전용/수륙양용/육지
  if (key === "wings") return v >= SIM.flyThreshold ? 2 : 0; // 비행/없음(켜짐·꺼짐)
  // 무리 성향은 방패 임계(herdShieldThreshold)가 "강함"의 기준 — 그 위에서만 무리 방어가 켜진다.
  // 그 아래는 뭉침·보온만 하는 "보통". 화면 표시와 실제 규칙이 같은 문턱을 본다.
  if (key === "herding") return v <= 0 ? 0 : v > SIM.herdShieldThreshold ? 2 : 1;
  return v <= 0 ? 0 : v > 55 ? 2 : 1; // 초음파·독·원거리·은신: 없음/보통/강함
}

export function abilityWord(level: 0 | 1 | 2): string {
  return level === 0 ? "없음" : level === 1 ? "보통" : "강함";
}

/** 식성 스펙트럼 — 초식/잡식/육식(중립). 문턱은 sim 과 같은 값(dietHuntMin·dietGrazeMax). */
export function dietWord(v: number): string {
  return v < SIM.dietHuntMin ? "초식" : v > SIM.dietGrazeMax ? "육식" : "잡식";
}

/**
 * 형질값 → 화면 표시. 각 형질의 성격에 맞춘 한 규칙으로 통일한다(설계도·개체 카드·프리셋·드래프트 공용):
 * - 값형질(속도·시야·공격·번식·무리)·대사 = **숫자**(상한 100 이라 "68 = 68%"로 그대로 직관적). 드래프트에서
 *   카드 효과(+9)를 수치로 비교해 뽑으므로 숫자가 맞다(사용자 방향).
 * - 능력형(수영·날개·초음파·독·원거리) = 없음/보통/강함(값이 문턱 위에선 무의미 — 65든 89든 동작 같음).
 * - 식성 = 초식/잡식/육식(스펙트럼).
 */
export function traitWord(key: keyof Traits, v: number): string {
  if (ABILITY_KEYS.has(key)) return abilityWord(abilityLevel(key, v));
  if (key === "diet") return dietWord(v);
  return String(Math.round(v)); // 값형질·대사 = 숫자
}

/**
 * 형질 6색 매핑(고정) — 스탯바·범례·보고서 라인이 전부 이 색을 공유한다(핸드오프 §2·§9).
 * "형질이 곧 색"이라 한눈에 어떤 형질인지 읽힌다. 매핑에 없는 형질(식성·능력형)은 lime(내 종)으로.
 */
export const TRAIT_COLORS: Partial<Record<keyof Traits, string>> = {
  speed: "#F5C33B", // 속도 · amber
  vision: "#5AB0E2", // 시야 · blue
  attack: "#E85C43", // 공격력 · red
  fertility: "#8FD14F", // 번식력 · lime
  size: "#4FC3B0", // 몸집 · teal (v7 — 무리 성향이 능력형으로 내려간 자리)
  metabolism: "#F2903A", // 대사 · orange
  herding: "#B98CE0", // 무리 성향 · purple (능력형이지만 색은 유지 — 무리 카드가 이 색을 쓴다)
  camouflage: "#7E8C7A", // 은신 · muted green-grey (눈에 안 띄는 색이 곧 뜻)
};

export function traitColor(key: keyof Traits): string {
  return TRAIT_COLORS[key] ?? "#8FD14F";
}

/**
 * **좋고 나쁨이 없는 형질.** ▲=이득 / ▼=손해 규칙이 이 둘에는 안 맞는다.
 * - `metabolism`(대사): 높으면 추위에 강하고 기운을 많이 쓴다. 낮으면 기운을 아끼고 더위·가뭄에 강하다.
 *   어느 쪽이 이득인지는 이번 판 환경과 다가오는 대멸종이 정한다.
 * - `diet`(식성): 초식↔육식 스펙트럼. 어느 쪽도 더 낫지 않다.
 *
 * 이 둘은 초록/빨강 대신 중립색으로 칠하고, 방향(▲▼)만 사실대로 알린다.
 */
export const NEUTRAL_TRAITS = new Set<keyof Traits>(["metabolism", "diet"]);

/** 칩의 성격 — 얻음(초록) / 잃음(빨강) / 중립(회색, 좋고 나쁨 없음). */
export type ChipTone = "gain" | "loss" | "neutral";

/** 카드 한 줄 효과 — "속도 +17"(얻음) / "번식력 -6"(잃음) / "대사 +14"(중립). */
export interface EffectChip {
  /**
   * 형질 이름만("속도"). `value` 와 나눠 두는 이유: 감쇠 취소선을 **이름과 수치 사이**에 끼워야
   * "속도 ~~+14~~ +6" 으로 읽힌다. 한 덩이 문자열에 앞으로 붙이면 "~~+14~~ 속도 +6" 이 돼 버린다
   * (실제 앱에서 그렇게 나왔다).
   */
  label: string;
  /** 변화만("+6" · "-12" · "강화" · "이미 최대" · "잃음 · 0 이 돼요"). */
  value: string;
  /** 이름 + 변화 한 줄("속도 +6") — 도감처럼 취소선을 안 쓰는 화면이 그대로 쓴다. */
  text: string;
  tone: ChipTone;
  /** 방향(늘어남/줄어듦) — 중립 형질도 방향 자체는 사실이라 ▲▼ 는 그대로 보여준다. */
  up: boolean;
  /**
   * **상한 근접 감쇠 전의 값**("+11") — 실제 값과 다를 때만 채운다. 화면은 이걸 취소선으로 함께 보여준다:
   * `~~+11~~ +5`.
   *
   * 왜 필요한가: 감쇠 자체는 거짓말이 아니었지만(칩은 늘 실제 값을 보여줬다), **같은 카드가 초반 "+11"
   * 후반 "+5" 로 보여 "카드가 약해졌나?"로 읽혔다.** 줄어든 이유(내 형질이 이미 높다)가 화면 어디에도
   * 없고 대백과에만 있었다 — 그건 미달이다(CLAUDE.md 전달 규칙). 원래 값을 나란히 보여주면
   * "카드가 약해진 게 아니라 내가 이미 높아서"가 그 자리에서 읽힌다.
   */
  base?: string;
  /** 정점 고정이 이 카드의 대가를 막았다 — 화면이 "정점은 다시 안 내려간다"는 각주를 띄울 근거. */
  apexLocked?: boolean;
}

/**
 * **정점(만렙) 보상 한 줄** — 상한 100 에 닿으면 그 형질의 약점이 사라진다(`sim/behavior.isApex`).
 * 화면(드래프트 내 종 패널·정점 도달 연출)이 "무엇이 열렸는지"를 이 문구로 알린다 — 대백과를 안 읽어도
 * 알아챌 수 있어야 한다.
 * ⚠ sim 의 실제 규칙과 반드시 같은 뜻이어야 한다. 규칙을 바꾸면 이 문구도 함께 바꾼다.
 */
export const APEX_BOON: Partial<Record<keyof Traits, string>> = {
  speed: "험한 땅도 발을 잡지 못해요",
  vision: "어둠도 수풀도 눈을 가리지 못해요",
  attack: "덩치 큰 상대도 개의치 않고 물어요",
  // ⚠ 이 줄은 `sim/behavior` 의 번식 규칙과 한 쌍이다. 2026-07-15 에 정점 번식 보상을 "번식 문턱 완화"
  // 에서 "어미가 치르는 대가 완화"로 바꿨는데 여기를 안 고쳐, 화면이 **폐기된 규칙을 말하고 있었다**
  // (실제 앱을 띄워 보고서야 잡았다 — 타입도 테스트도 이 어긋남은 못 잡는다).
  fertility: "새끼를 쳐도 어미가 덜 지쳐요",
};

/** 칩 색 — 중립은 초록도 빨강도 아니어야 한다("이건 이득/손해가 아니라 성질이 바뀐다"). */
export const CHIP_COLORS: Record<ChipTone, string> = {
  gain: "#8FD14F",
  loss: "#E85C43",
  neutral: "#C6B7A2",
};

export function chipColor(tone: ChipTone): string {
  return CHIP_COLORS[tone];
}

/**
 * 카드의 얻음/잃음 목록. 드래프트 카드와 대백과 카드 도감이 같은 규칙으로 보여준다.
 * 수치는 `effectiveDelta`(실제 게놈에 붙는 값) — 카드에 적힌 원값과 다르다.
 * `traits`(내 종의 현재 형질)를 주면 **상한 근접 감쇠까지 반영**한 진짜 값이 나온다. 드래프트는 반드시
 * 넘긴다 — 안 넘기면 "+12" 라 써 놓고 +5 만 오르는 거짓말이 된다. 카드 도감은 종이 특정되지 않아 생략.
 */
export function cardEffectChips(card: Card, traits?: Traits): EffectChip[] {
  const chips: EffectChip[] = [];
  /** 칩 하나 — 이름·변화를 따로 들고, 한 줄 표시(text)는 여기서 한 번만 조립한다. */
  const chip = (
    label: string,
    value: string,
    tone: ChipTone,
    up: boolean,
    extra?: { base?: string; apexLocked?: boolean },
  ): EffectChip => ({
    label,
    value,
    text: `${label} ${value}`,
    tone,
    up,
    ...(extra?.base !== undefined ? { base: extra.base } : {}),
    ...(extra?.apexLocked !== undefined ? { apexLocked: extra.apexLocked } : {}),
  });

  for (const key of Object.keys(card.effects) as (keyof Traits)[]) {
    // 희생 형질은 여기서 건너뛴다 — 아래에서 "버린다"로 따로 보여준다(값의 문제가 아니다).
    if (card.sacrifice?.includes(key)) continue;

    const raw = card.effects[key] ?? 0;
    const label = TRAIT_LABELS[key];
    const cur = traits?.[key];
    const d = cardDelta(card, key, cur); // 실제로 붙는 값 — applyCard 와 같은 함수다(어긋날 수 없다)

    // **아무 일도 안 일어난다.** 그런데 왜 안 일어나는지에 따라 할 말이 다르다.
    // (여기서 "+15"·"-12" 라 써 놓고 게놈이 안 움직이면 그게 곧 거짓말이다.)
    if (cur !== undefined && d === 0 && raw !== 0) {
      if (raw < 0 && isApexTrait(key, cur)) {
        // 정점 고정 — 100 을 찍은 형질은 카드의 곁가지 대가로 안 내려간다. 대가가 사라진 셈이니 이득이다.
        chips.push(chip(label, "정점 · 안 내려감", "gain", true, { apexLocked: true }));
      } else if (raw > 0 && cur >= TRAIT_CEILING[key]) {
        // 더 올릴 자리가 없다 — 이건 알려야 한다("이 카드의 속도 보너스는 나한텐 헛것").
        chips.push(chip(label, "이미 최대", "neutral", true));
      }
      // 남은 경우: 이미 바닥(0)이라 손해가 안 걸린다(무리 성향 0 인 종의 「외톨이」 -18 처럼).
      // 손해가 안 걸리는 건 경고할 일이 아니니 칩을 아예 안 만든다 — 없는 대가를 있는 척하지 않는다.
      continue;
    }

    if (ABILITY_KEYS.has(key)) {
      // 능력형(수영·날개·초음파·독·원거리·무리·은신)은 수치가 무의미(3단계) → 방향만 표시.
      const up = raw >= 0;
      const tone: ChipTone = NEUTRAL_TRAITS.has(key) ? "neutral" : up ? "gain" : "loss";
      chips.push(chip(label, up ? "강화" : "약화", tone, up));
      continue;
    }

    const up = d >= 0;
    const tone: ChipTone = NEUTRAL_TRAITS.has(key) ? "neutral" : up ? "gain" : "loss";
    // 상한 근접 감쇠가 실제로 깎았다면, 감쇠 전 값을 함께 넘긴다(화면이 취소선으로 보여준다).
    const plain = effectiveDelta(key, raw); // 내 형질을 안 본 기준값(감쇠 없음)
    const damped = d > 0 && plain > d;
    chips.push(chip(label, `${up ? "+" : ""}${d}`, tone, up, damped ? { base: `+${plain}` } : {}));
  }

  // **희생** — "값이 줄어든다"가 아니라 "그 감각을 통째로 버린다". 관문 카드의 정체성이라 반드시 읽혀야 한다.
  // 단 **이미 잃은 것을 또 잃을 수는 없다**: 눈이 이미 먼 종(시야 0)이 「초음파」를 또 뽑을 때
  // "시야 잃음"이라 뜨면 그것도 없는 대가를 있는 척하는 것이다(위의 "이미 바닥" 규칙과 같은 잣대).
  for (const key of card.sacrifice ?? []) {
    const cur = traits?.[key];
    if (cur !== undefined && cur <= 0) continue;
    chips.push(chip(TRAIT_LABELS[key], "잃음 · 0 이 돼요", "loss", false));
  }
  return chips;
}

/** 카드 효과 중 가장 크게 바뀌는 형질 — 카드 점·히어로 색을 정한다. */
export function dominantTrait(card: Card): keyof Traits {
  const keys = Object.keys(card.effects) as (keyof Traits)[];
  let best: keyof Traits = keys[0] ?? "fertility";
  let bestMag = -1;
  for (const key of keys) {
    const mag = Math.abs(card.effects[key] ?? 0);
    if (mag > bestMag) {
      bestMag = mag;
      best = key;
    }
  }
  return best;
}
