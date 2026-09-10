// 지침 시트 — 감독의 사전 지침. 알파 탭 조종을 대체한다 (**[사용자 2026-09-11]** 결정 · 설계 계약은
// `docs/design/manager_instructions.md`).
//
// 문장 틀은 하나다: 「[누가] [어떤 때] [무엇을 한다]」. 줄은 위에서부터 읽고, 개체마다 매 틱
// **처음으로 성립하는 줄 하나**가 발동한다(FF12 갬빗 규칙). 맨 아래에는 늘 「모두 · 늘 · 알아서 한다」가
// 보이지 않게 깔려 있다.
//
// 이 파일은 **어휘와 평가기**만 갖는다. 발동한 행동을 실제 이동으로 옮기는 것은 `behavior.ts` 의 지침
// 블록이다(길찾기·통행 판정이 거기 있다). 조건(「어떤 때」)은 카드 특성의 `PerkWhen` 을 그대로 쓴다 ·
// 카드와 지침이 같은 말을 쓰고, 판정 함수도 하나(`whenHolds`)라 화면과 sim 이 갈릴 자리가 없다.
//
// 결정론 계약: 순수 판정 · rng 0. 시트가 null 이면 behavior 의 블록이 통째로 안 돌아 기존 세계와 비트
// 단위로 같다(`instructions.test.ts` 가 감지기다).

import type { Entity } from "@/sim/entity";
import { PERK_WHENS, PERK_WHEN_INFO, whenHolds, type PerkCtx, type PerkWhen } from "@/sim/perks";
import { SIM } from "@/sim/params";
import { HERD_SHEET_ROWS, tierOf, type Pips } from "@/sim/tiers";

// ─────────────────────────────── 어휘 ───────────────────────────────

/** 누가 — 지침이 걸리는 개체의 갈래. 순서가 곧 판 코드에 저장되는 숫자다(재배열 금지 · 새 단어는 끝에만). */
export const WHO_KEYS = ["all", "strong", "weak"] as const;
export type Who = (typeof WHO_KEYS)[number];

/** 무엇을 — 발동했을 때 하는 일. 순서가 곧 판 코드의 숫자다(재배열 금지 · 새 단어는 끝에만). */
export const ACT_KEYS = ["auto", "hide", "gather", "scatter"] as const;
export type Act = (typeof ACT_KEYS)[number];

/** 어떤 때 — 카드 특성의 조건을 그대로 쓴다. `PERK_WHENS` 의 순서가 판 코드의 숫자다. */
export const WHEN_KEYS = PERK_WHENS;

export interface Directive {
  who: Who;
  when: PerkWhen;
  act: Act;
}

/** 화면 문구. 「누가」는 주어 자리라 조사 없이, 「무엇을」은 서술어. */
export const WHO_INFO: Record<Who, { label: string; desc: string }> = {
  all: { label: "모두", desc: "살아 있는 내 종 전부." },
  strong: { label: "이빨이 센 개체", desc: `무는 힘이 ${SIM.raidWarriorAttack} 이상인 개체. 보스전에서 맞서는 개체와 같은 기준.` },
  weak: { label: "그 밖의 개체", desc: "이빨이 센 개체가 아닌 나머지." },
};

export const ACT_INFO: Record<Act, { label: string; desc: string }> = {
  auto: { label: "알아서 한다", desc: "이동을 안 건드린다. 평소대로 먹고 쫓고 달아난다." },
  hide: { label: "수풀로 숨는다", desc: "걸어 닿는 가장 가까운 수풀로 간다. 닿는 수풀이 없으면 이 줄은 건너뛴다." },
  gather: { label: "뭉친다", desc: "무리의 한가운데로 모인다. 이미 모여 있으면 그대로 둔다." },
  scatter: { label: "흩어진다", desc: "무리의 한가운데에서 멀어진다. 이미 떨어져 있으면 그대로 둔다." },
};

/** 「어떤 때」 화면 문구. 카드와 같은 말 · 「늘」만 카드에서는 빈 문자열이라 여기서 채운다. */
export function whenLabel(when: PerkWhen): string {
  return when === "always" ? "늘" : PERK_WHEN_INFO[when].label;
}

/** 한 줄을 사람 말로. 화면·판 보고서·테스트 메시지가 같은 문장을 쓴다. */
export function directiveLine(d: Directive): string {
  return `${WHO_INFO[d.who].label} · ${whenLabel(d.when)} · ${ACT_INFO[d.act].label}`;
}

/** 보이지 않게 깔린 마지막 줄. 화면에는 고정 줄로 보여 준다. */
export const FINAL_DIRECTIVE: Readonly<Directive> = { who: "all", when: "always", act: "auto" };

// ─────────────────────────────── 상수 ───────────────────────────────

/**
 * 시트 전용 상수. `params.ts` 의 밸런스 상수와 섞지 않는다(그쪽은 야생 생태의 기준선이다).
 * `pull` 은 옛 지시 블록의 `ORDER.pull`(0.9) 과 같은 값에서 출발한다 · 실측이 바뀌면 여기만 고친다.
 */
export const SHEET = {
  /** 발동한 이동이 자율 이동을 덮는 비율(0~1). */
  pull: 0.9,
  /** 「수풀로 숨는다」가 찾는 반경(타일 수). 이 밖의 수풀은 없는 것으로 친다. */
  hideRadiusTiles: 12,
  /** 「뭉친다」 · 무게중심에서 이 거리(px) 안이면 이미 모인 것. */
  gatherRadius: 80,
  /** 「흩어진다」 · 무게중심에서 이 거리(px) 밖이면 이미 흩어진 것. */
  scatterRadius: 160,
} as const;

/** 이 도장으로 쓸 수 있는 줄 수(무리 티어가 늘린다 · 표는 `tiers.ts` 한 곳). */
export function sheetRows(pips: Pips): number {
  return HERD_SHEET_ROWS[Math.max(0, Math.min(HERD_SHEET_ROWS.length - 1, tierOf(pips.herd)))] as number;
}

// ─────────────────────────────── 평가 ───────────────────────────────

/** 「누가」 판정. 순수 · 개체의 게놈만 본다. */
export function whoMatches(who: Who, e: Entity): boolean {
  if (who === "all") return true;
  const strong = e.genome.traits.attack >= SIM.raidWarriorAttack;
  return who === "strong" ? strong : !strong;
}

/**
 * 「이 줄이 이 개체에게 성립하는가」 — 누가 + 어떤 때. 행동의 대상이 있는가(닿는 수풀·무리)는 여기서
 * 모른다 · 그것은 behavior 의 블록이 이동을 만들면서 판정하고, 대상이 없으면 **다음 줄로 넘어간다**
 * (FF12: 대상 없는 갬빗은 건너뜀). 그래서 평가기는 「후보 줄」을 위에서부터 순서대로 돌려준다.
 */
export function directiveApplies(d: Directive, e: Entity, ctx: PerkCtx): boolean {
  return whoMatches(d.who, e) && whenHolds(d.when, ctx);
}

/**
 * 시트를 정리한다: 줄 수 상한 · 모르는 단어 제거. game 층이 받아들일 때 한 번 부른다(sim 은 믿고 읽는다).
 * 새 배열을 돌려준다(입력을 안 바꾼다).
 */
export function sanitizeSheet(rows: readonly Directive[], maxRows: number): Directive[] {
  const out: Directive[] = [];
  for (const r of rows) {
    if (out.length >= maxRows) break;
    if (!WHO_KEYS.includes(r.who) || !WHEN_KEYS.includes(r.when) || !ACT_KEYS.includes(r.act)) continue;
    out.push({ who: r.who, when: r.when, act: r.act });
  }
  return out;
}

/** 두 시트가 같은가(판 코드 기록의 「바뀌었나」 판정). */
export function sameSheet(a: readonly Directive[], b: readonly Directive[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as Directive;
    const y = b[i] as Directive;
    if (x.who !== y.who || x.when !== y.when || x.act !== y.act) return false;
  }
  return true;
}
