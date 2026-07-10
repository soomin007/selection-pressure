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

/** 카드 한 줄 효과 — "속도 +17"(얻음) / "번식력 -6"(잃음). up 이 색(lime/red)과 ▲▼ 를 정한다. */
export interface EffectChip {
  text: string;
  up: boolean;
}

/**
 * 카드의 얻음/잃음 목록. 드래프트 카드와 대백과 카드 도감이 같은 규칙으로 보여준다.
 * 수치는 `effectiveDelta`(실제 게놈에 붙는 값) — 카드에 적힌 원값과 다르다(상한 200 형질은 ×0.6).
 */
export function cardEffectChips(card: Card): EffectChip[] {
  const chips: EffectChip[] = [];
  for (const key of Object.keys(card.effects) as (keyof Traits)[]) {
    const v = card.effects[key] ?? 0;
    if (ABILITY_KEYS.has(key)) {
      // 능력형(수영·날개·초음파·독·원거리)은 수치가 무의미(3단계) → 방향만 표시.
      chips.push({ text: `${TRAIT_LABELS[key]} ${v >= 0 ? "강화" : "약화"}`, up: v >= 0 });
    } else {
      const d = effectiveDelta(key, v);
      chips.push({ text: `${TRAIT_LABELS[key]} ${d >= 0 ? "+" : ""}${d}`, up: d >= 0 });
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
