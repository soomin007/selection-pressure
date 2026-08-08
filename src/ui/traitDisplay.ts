// 티어 표시 공통 (v8): 카드 칩·헤더 티어 줄·도장 막대가 쓰는 표시 규칙을 한 곳에 모은다.
// 문턱·효과·대가의 **수치는 전부 `sim/tiers.ts` 가 단일 진실**이고, 여기서는 그 값을
// "어떻게 보여줄지"만 정한다(두 곳에 적힌 규칙은 조용히 어긋난다: known_issues).
//
// v8 에서 이 파일의 옛 내용(능력형 3단계 표시 · 카드 효과 칩 · 정점 보상 문구)은 전부 지웠다.
// 형질 0~100 세계의 표시 규칙이라 도장·티어 세계에는 대응물이 없다.

import {
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  KEY_LABELS,
  MAX_TIER,
  TIER_ROMAN,
  TIER_STEPS,
  tierOf,
  type Category,
  type Pips,
} from "@/sim/tiers";
import { cardPips, cardTierMoves, type Card, type TierMove } from "@/game/cards";

/** 0xRRGGBB → "#rrggbb". 범주 색(숫자)을 CSS 색으로. */
export function hexColor(c: number): string {
  return "#" + (c & 0xffffff).toString(16).padStart(6, "0");
}

/** 범주 색(CSS 문자열). 카드 칩·막대·헤더 칩이 전부 이 색을 쓴다. */
export function categoryColor(cat: Category): string {
  return hexColor(CATEGORY_COLORS[cat]);
}

/** 열쇠·불씨 칩 색(금빛: 전설 카드 색과 같은 계열). */
export const KEY_CHIP_COLOR = "#F5C33B";
/** 문턱을 못 넘기는 저축 칩의 회색. */
export const SAVE_CHIP_COLOR = "#8C7C68";
/** 티어 강등·도장 잃음 칩의 붉은색. */
export const DOWN_CHIP_COLOR = "#E85C43";
/** 얻음(초록): 티어 줄 각주·유령 막대가 쓴다. */
export const GAIN_COLOR = "#8FD14F";

/**
 * 카드 칩 하나: 「이 카드가 문턱을 넘기는가」를 말하는 최소 단위.
 * cross: 문턱을 넘긴다(범주 색 + 발광) / save: 못 넘긴다(회색 · 몇 칸 남는지) /
 * down: 티어가 내려가거나 도장을 잃는다(붉은색) / key: 열쇠를 연다 / ember: 불씨를 되살린다.
 */
export interface TierChip {
  kind: "cross" | "save" | "down" | "key" | "ember";
  text: string;
  color: string;
}

function moveChip(m: TierMove): TierChip {
  const label = CATEGORY_LABELS[m.cat];
  if (m.to > m.from) {
    // 문턱을 넘긴다: 0단에서 처음 켜질 땐 「이빨 I 켜짐」, 그 뒤로는 「이빨 II ▸ III」.
    const text =
      m.from > 0
        ? `${label} ${TIER_ROMAN[m.from]} ▸ ${TIER_ROMAN[m.to]}`
        : `${label} ${TIER_ROMAN[m.to]} 켜짐`;
    return { kind: "cross", text, color: categoryColor(m.cat) };
  }
  if (m.to < m.from) {
    // 티어 강등: 맞바꿈 카드의 대가가 문턱을 되넘는다.
    return { kind: "down", text: `${label} ${TIER_ROMAN[m.from]} ▾ ${TIER_ROMAN[m.to] || "0"}`, color: DOWN_CHIP_COLOR };
  }
  if (m.delta < 0) {
    // 도장은 잃는데 티어는 안 내려간다: 그래도 잃는 건 잃는 거라 붉게 알린다.
    return { kind: "down", text: `${label} −${-m.delta}`, color: DOWN_CHIP_COLOR };
  }
  // 도장은 오르는데 문턱은 못 넘긴다: 다음 장을 위한 저축. 몇 칸 남는지가 곧 정보다.
  const text =
    m.to >= MAX_TIER ? `${label} ${TIER_ROMAN[MAX_TIER]}` : `${label} · ${m.remain}칸 남음`;
  return { kind: "save", text, color: SAVE_CHIP_COLOR };
}

/**
 * 카드 한 장의 칩 줄. 범주 칩(도장이 큰 순) + 열쇠 칩 + 불씨 칩, 최대 3개.
 * ⚠ 칩을 담는 flex 컨테이너에는 `max-width:100%` 가 필수다: 360px 폰에서 칩이 카드 밖으로
 *   삐져나간 전례가 있다(known_issues: flex-wrap 컨테이너 함정).
 */
export function cardTierChips(card: Card, pips: Pips): TierChip[] {
  const chips: TierChip[] = cardTierMoves(card, pips).map(moveChip);
  if (card.key !== undefined) {
    chips.push({ kind: "key", text: `열쇠 · ${KEY_LABELS[card.key]}`, color: KEY_CHIP_COLOR });
  }
  if (card.ember) {
    chips.push({ kind: "ember", text: `불씨 +${card.ember}`, color: KEY_CHIP_COLOR });
  }
  return chips.slice(0, 3);
}

/** 이 카드가 문턱을 **넘기는**(위로) 움직임들: 티어 줄 각주(gain/cost)가 이걸 본다. */
export function crossingMoves(card: Card, pips: Pips): TierMove[] {
  return cardTierMoves(card, pips).filter((m) => m.to > m.from);
}

/** 이 카드가 문턱을 **되넘는**(강등) 움직임들: 무엇을 잃는지 각주로 알린다. */
export function demotingMoves(card: Card, pips: Pips): TierMove[] {
  return cardTierMoves(card, pips).filter((m) => m.to < m.from);
}

/**
 * 카드의 대표 색: 카드 점·히어로 오라가 쓴다. 가장 큰 도장의 범주 색,
 * 도장 없는 카드(불씨)는 금빛, 그 외엔 내 종 lime.
 */
export function cardAccent(card: Card): string {
  const cats = CATEGORIES.filter((c) => cardPips(card, c) !== 0).sort(
    (a, b) => Math.abs(cardPips(card, b)) - Math.abs(cardPips(card, a)),
  );
  const top = cats[0];
  if (top !== undefined) return categoryColor(top);
  if (card.ember) return KEY_CHIP_COLOR;
  return GAIN_COLOR;
}

// ─────────────────────────────── 도장 막대 ───────────────────────────────

/**
 * 도장 막대의 오른쪽 끝(도장 수). 최고 문턱(21) 뒤로 여백 3칸을 둬 IV 문턱선이 막대 **안**에
 * 보이게 한다(끝에 붙으면 테두리와 구분이 안 된다). 3은 표시용 여백일 뿐 규칙이 아니다.
 */
export const PIP_BAR_MAX = (TIER_STEPS[TIER_STEPS.length - 1] as number) + 3;

/**
 * 문턱 3·8·14·20 자리에 세로 눈금을 그리는 CSS background-image.
 * 눈금 간격이 곧 "다음 계단이 더 멀다"를 말한다(요구 도장이 늘어나는 것이 화면에서 읽힌다).
 * 최고 문턱(IV)만 금빛: 거기가 이 사다리의 끝이다.
 */
export function tierTrackBackground(): string {
  const last = TIER_STEPS[TIER_STEPS.length - 1] as number;
  const layers = TIER_STEPS.map((s) => {
    const p = ((s / PIP_BAR_MAX) * 100).toFixed(2);
    const col = s === last ? "rgba(255,226,122,0.9)" : "rgba(255,255,255,0.30)";
    return (
      `linear-gradient(90deg, transparent calc(${p}% - 1px), ${col} calc(${p}% - 1px), ` +
      `${col} calc(${p}% + 1px), transparent calc(${p}% + 1px))`
    );
  });
  return layers.join(", ");
}

/** 도장 수 → 막대 채움 비율(%). */
export function pipPct(pips: number): number {
  return Math.max(0, Math.min(100, (pips / PIP_BAR_MAX) * 100));
}

// ─────────────────────────────── 헤더 티어 줄 ───────────────────────────────

export interface TierBadge {
  cat: Category;
  tier: number;
  /** 「이빨 III」 · 0단이면 이름만(회색으로 그린다). */
  text: string;
  color: string;
}

/** 다섯 범주의 지금 티어 한 줄(고정 순서). 폰 390px 가용폭에 다섯 칩이 들어간다(실측 약 330px). */
export function tierBadges(pips: Pips): TierBadge[] {
  return CATEGORIES.map((cat) => {
    const t = tierOf(pips[cat]);
    return {
      cat,
      tier: t,
      text: t > 0 ? `${CATEGORY_LABELS[cat]} ${TIER_ROMAN[t]}` : CATEGORY_LABELS[cat],
      color: t > 0 ? categoryColor(cat) : SAVE_CHIP_COLOR,
    };
  });
}

// ─────────────────────────────── 한국어 조사 ───────────────────────────────

/** 받침 유무로 이/가 를 고른다: 「늑대의 법이 켜집니다」 vs 「덮치기가 켜집니다」. */
export function iGa(word: string): "이" | "가" {
  const ch = word.charCodeAt(word.length - 1);
  if (ch >= 0xac00 && ch <= 0xd7a3) return (ch - 0xac00) % 28 > 0 ? "이" : "가";
  return "가";
}
