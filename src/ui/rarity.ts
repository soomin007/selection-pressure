// 희귀도 표시 규칙 (핸드오프 §2) — 색·라벨·등장 뜸·특수 연출. 뽑기 확률은 game/cards 의 RARITY_WEIGHT 가
// 정하고, 여기서는 "그걸 어떻게 보여줄지"만 정한다. 카드 배지·선택 링·히어로 순서가 전부 이 표를 공유한다.

import type { Rarity } from "@/game/cards";

/** 등장 뜸의 기준값(ms) — 흔함·귀함·전설 셋만 파라미터로 두고, 드묾·아주 귀함은 이웃의 중간값으로 보간한다. */
export const DRAFT_TIMING = {
  bounceMs: 300, // 카드 pop-bounce 길이
  delayCommonMs: 550,
  delayRareMs: 1200,
  delayLegendaryMs: 2000,
  confettiCount: 16,
} as const;

export interface RarityStyle {
  /** 배지·점 색 (선택 링과 카드 상단 바가 같은 색을 쓴다) */
  color: string;
  /** 배지 배경 — 같은 색의 15~18% 투명 */
  badgeBg: string;
  label: string;
  /** 전설만 점에 글로우 + 금빛 플래시 + 콘페티 */
  glow: boolean;
}

export const RARITY_STYLE: Record<Rarity, RarityStyle> = {
  common: { color: "#B4A489", badgeBg: "rgba(180,164,137,0.16)", label: "흔함", glow: false },
  uncommon: { color: "#7FC0E6", badgeBg: "rgba(127,192,230,0.16)", label: "드묾", glow: false },
  rare: { color: "#B98CE0", badgeBg: "rgba(185,140,224,0.15)", label: "귀함", glow: false },
  epic: { color: "#F2903A", badgeBg: "rgba(242,144,58,0.16)", label: "아주 귀함", glow: false },
  legendary: { color: "#F5C33B", badgeBg: "rgba(245,195,59,0.18)", label: "전설", glow: true },
};

/** 등장 순서 — 낮은 희귀도부터 뜬다(전설이 마지막에 터지도록). */
const RARITY_ORDER: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

export function rarityIndex(r: Rarity): number {
  const i = RARITY_ORDER.indexOf(r);
  return i < 0 ? 0 : i;
}

/**
 * 희귀도별 등장 뜸(ms). 흔함·귀함·전설이 기준점이고 드묾 = (흔함+귀함)/2, 아주 귀함 = (귀함+전설)/2 로 보간한다.
 * 기준값 셋만 만지면 다섯 단계가 함께 움직인다.
 */
export function rarityDelayMs(r: Rarity): number {
  const c0 = DRAFT_TIMING.delayCommonMs;
  const c2 = DRAFT_TIMING.delayRareMs;
  const c4 = DRAFT_TIMING.delayLegendaryMs;
  const table: readonly number[] = [c0, Math.round((c0 + c2) / 2), c2, Math.round((c2 + c4) / 2), c4];
  return table[rarityIndex(r)] ?? c0;
}

/** 선택 링 box-shadow — 전설만 3px + 바깥 글로우(§10). */
export function selectionRing(r: Rarity): string {
  const s = RARITY_STYLE[r];
  if (s.glow) return `0 0 0 3px ${withAlpha(s.color, 0.85)}, 0 0 22px -4px ${withAlpha(s.color, 0.55)}`;
  return `0 0 0 2px ${withAlpha(s.color, 0.75)}`;
}

/** 선택되지 않은 카드의 기본 그림자 — 전설만 은은한 잔광을 남긴다. */
export function restingShadow(r: Rarity): string {
  return RARITY_STYLE[r].glow ? `0 0 18px -6px ${withAlpha(RARITY_STYLE[r].color, 0.25)}` : "none";
}

/** #RRGGBB → rgba(). 희귀도 색 하나에서 테두리·배경·글로우를 모두 파생시킨다. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
