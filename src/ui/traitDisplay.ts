// 형질 표시 공통 — 능력형 형질(수영·날개·초음파·독·원거리)은 0~100 연속이 무의미(임계·켜짐/꺼짐)라
// 3단계(없음/보통/강함)로 보여준다. 프리셋 화면·설계도·대백과가 같은 규칙을 쓰도록 한 곳에 모은다(폰 피드백).

import { SIM } from "@/sim/params";
import { TRAIT_LABELS, type Traits } from "@/sim/genome";
import { effectiveDelta, type Card } from "@/game/cards";

/** 3단계로 표시하는 능력형 형질들(연속 수치 대신 없음/보통/강함). */
export const ABILITY_KEYS = new Set<keyof Traits>(["swimming", "wings", "echo", "venom", "ranged"]);

/** 능력형 형질 값 → 0(없음)/1(보통)/2(강함). 임계(수영·날개는 통행 임계, 나머지는 55)로 나눈다. */
export function abilityLevel(key: keyof Traits, v: number): 0 | 1 | 2 {
  if (key === "swimming") return v >= SIM.aquaticOnlyThreshold ? 2 : v >= SIM.swimThreshold ? 1 : 0; // 물전용/수륙양용/육지
  if (key === "wings") return v >= SIM.flyThreshold ? 2 : 0; // 비행/없음(켜짐·꺼짐)
  return v <= 0 ? 0 : v > 55 ? 2 : 1; // 초음파·독·원거리: 없음/보통/강함
}

export function abilityWord(level: 0 | 1 | 2): string {
  return level === 0 ? "없음" : level === 1 ? "보통" : "강함";
}

// 값이 클수록 강한 형질(속도·시야·공격·번식·무리) — 시작 50 은 "보통", 카드로 갈고 닦을수록 세진다.
// 화면엔 날값(68) 대신 이 단계 단어를 보여준다: 능력형(없음/보통/강함)과 같은 언어로 통일해 "68 이 좋은
// 건지 모르겠다"를 없앤다(사용자 지적). 시뮬은 여전히 연속값을 쓴다 — 표시만 단계로 뭉친다.
function valueWord(v: number): string {
  if (v < 35) return "약함";
  if (v < 70) return "보통";
  if (v < 110) return "강함";
  if (v < 155) return "막강";
  return "최강";
}

// 대사(중립) — 많고 적음이 곧 좋고 나쁨이 아니라 성질이라, 강약이 아니라 낮음/보통/높음으로 사실만 알린다.
// 낮으면 기운을 아끼고 더위·가뭄에 강하고, 높으면 추위에 강하되 기운을 많이 쓴다(환경이 유불리를 정한다).
function metabWord(v: number): string {
  if (v < 38) return "낮음";
  if (v < 63) return "보통";
  return "높음";
}

/** 식성 스펙트럼 — 초식/잡식/육식(중립). 문턱은 sim 과 같은 값(dietHuntMin·dietGrazeMax). */
export function dietWord(v: number): string {
  return v < SIM.dietHuntMin ? "초식" : v > SIM.dietGrazeMax ? "육식" : "잡식";
}

/**
 * 형질값 → 화면용 단계 단어(숫자 대신). 모든 형질을 한 규칙으로 보여줘 표시를 일관되게 한다:
 * 능력형=없음/보통/강함, 식성=초식/잡식/육식, 대사=낮음/보통/높음, 나머지(값형질)=약함/보통/강함/막강/최강.
 * 설계도·개체 카드·프리셋·드래프트가 전부 이 함수를 써서 어긋나지 않게 한다(한 곳에서 관리).
 */
export function traitWord(key: keyof Traits, v: number): string {
  if (ABILITY_KEYS.has(key)) return abilityWord(abilityLevel(key, v));
  if (key === "diet") return dietWord(v);
  if (key === "metabolism") return metabWord(v);
  return valueWord(v);
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
  herding: "#B98CE0", // 무리 성향 · purple
  metabolism: "#F2903A", // 대사 · orange
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
  text: string;
  tone: ChipTone;
  /** 방향(늘어남/줄어듦) — 중립 형질도 방향 자체는 사실이라 ▲▼ 는 그대로 보여준다. */
  up: boolean;
}

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
 * 수치는 `effectiveDelta`(실제 게놈에 붙는 값) — 카드에 적힌 원값과 다르다(상한 200 형질은 ×0.6).
 */
export function cardEffectChips(card: Card): EffectChip[] {
  const chips: EffectChip[] = [];
  for (const key of Object.keys(card.effects) as (keyof Traits)[]) {
    const v = card.effects[key] ?? 0;
    const up = v >= 0;
    const tone: ChipTone = NEUTRAL_TRAITS.has(key) ? "neutral" : up ? "gain" : "loss";
    if (ABILITY_KEYS.has(key)) {
      // 능력형(수영·날개·초음파·독·원거리)은 수치가 무의미(3단계) → 방향만 표시.
      chips.push({ text: `${TRAIT_LABELS[key]} ${up ? "강화" : "약화"}`, tone, up });
    } else {
      const d = effectiveDelta(key, v);
      chips.push({ text: `${TRAIT_LABELS[key]} ${d >= 0 ? "+" : ""}${d}`, tone: NEUTRAL_TRAITS.has(key) ? "neutral" : d >= 0 ? "gain" : "loss", up: d >= 0 });
    }
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
