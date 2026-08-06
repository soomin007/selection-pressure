// 식성 곡선 — **야생종 전용의 옛 규칙**이다.
//
// v8 에서 플레이어 종은 채집·사냥 효율을 이빨 티어에서 곧바로 받는다(`sim/tiers.ts`). 그런데 야생종은
// 손으로 오래 튜닝한 식성 값(초식 12~30 · 잡식 50 · 포식자 85)으로 살고 있고, 그 값에서 나오는 효율
// 곡선이 지금의 붐-버스트·대멸종 필터를 지탱한다. 그래서 곡선을 **지우지 않고 여기로 옮겼다**:
// `genomeFromTraits` 가 야생 게놈을 만들 때 이 함수들로 파생 축을 채우면, 야생 생태가 v7 과
// 비트 단위로 같아진다.
//
// ⚠ 여기 값을 만지면 **야생 생태가 통째로 움직인다.** 플레이어 밸런스를 바꾸려면 `tiers.ts` 를 만져라.
// (게놈이 순환 import 없이 이 함수를 쓸 수 있게 behavior 에서 떼어 냈다 · behavior 는 여기서 재수출한다.)

import { SIM } from "@/sim/params";

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const DIET_MAX = 100;

/**
 * 식성별 채집 효율 — 특화할수록 자기 먹이에서 온전히(1.0), 잡식일수록 페널티(제너럴리스트 페널티).
 * 순수 육식 구간(70 위)은 완만히 0 으로 내려가 사냥 사이의 fallback 이 된다(2026-07-15 채집 절벽 완화).
 */
export function grazeEfficiency(diet: number): number {
  const span = SIM.dietGrazeMax - SIM.dietHuntMin;
  const omni01 = clamp((diet - SIM.dietHuntMin) / span, 0, 1);
  const base = 1 - SIM.dietSpecializationPenalty * omni01;
  if (diet <= SIM.dietGrazeMax) return base;
  const over = clamp((diet - SIM.dietGrazeMax) / Math.max(1, DIET_MAX - SIM.dietGrazeMax), 0, 1);
  return base * (1 - over) ** SIM.carnGrazeFalloff;
}

/** 식성별 사냥 효율 — 순수 육식이 1.0, 잡식일수록 페널티. */
export function huntEfficiency(diet: number): number {
  const span = SIM.dietGrazeMax - SIM.dietHuntMin;
  const omni01 = clamp((SIM.dietGrazeMax - diet) / span, 0, 1);
  return 1 - SIM.dietSpecializationPenalty * omni01;
}

/** 순수 육식도(0~1) — 문턱(70)에서 0, 완전 육식(100)에서 1. 스퍼트·큰 사냥·긴 포만·나눔의 공통 스케일. */
export function carnivory01(diet: number): number {
  return clamp((diet - SIM.dietGrazeMax) / Math.max(1, DIET_MAX - SIM.dietGrazeMax), 0, 1);
}
