// 판 분석 코드 — 한 판을 통째로 담아 **문자열 하나**로 내보낸다.
//
// 왜 되는가: 이 게임은 `src/sim` 에 `Math.random` 이 한 줄도 없다(결정론이 강제돼 있다).
// 그래서 **맵 시드와 선택 이력만 있으면 판이 통째로 재현된다** — 개체 위치도, 먹이 상태도,
// 야생의 진화도 저장할 필요가 없다.
//
// 담는 것은 두 종류이고, **둘 다 있어야 한다**:
//   ① 재현용 — 시드 · 시작 갈래 · 온보딩/메타 상태 · 매 드래프트의 후보 전부와 고른 것
//      (**[사용자 2026-08-08]** "선택한 것과 안 한 것 모두") · 리롤로 버린 후보 · 방울로 산 티어와 순서.
//   ② 관측용 — 시대별 결과 · 시험 합불과 수치 · 보스와 그 결말 · 개체 수 곡선 요약 · 사망 원인 ·
//      범주별 최종 티어와 열쇠 · 방울 수지.
//   재현용만 있으면 코드가 바뀌었을 때 옛 판을 못 되살리고, 관측용만 있으면 왜 그렇게 됐는지
//   파고들 수 없다. 둘을 같이 담으면 **재현 결과와 관측이 어긋나는 것 자체가 버그 신호**가 된다.
//
// ⚠ 이 파일은 **기록만** 한다 · rng 를 한 번도 안 쓰고 세계를 안 건드린다. 기록 때문에 분기가 갈리면
//   야생 밸런스가 통째로 이동한다(`species.ts` 의 `WILD_RNG_KEYS` 제약과 같은 계열).
//
// ⚠ **아래 「코드 공간」 표들의 순서를 재배열하지 마라.** 그 순서가 곧 저장된 숫자의 뜻이라,
//   섞는 순간 어제 뽑은 코드가 다른 보스·다른 시험을 가리킨다. 새 항목은 **끝에만** 더한다.
//   (카드 순서는 `poolDigest` 가 지킨다 — 풀이 바뀌면 디코더가 그렇게 말한다.)

import { CARD_POOL, PRESET_CARDS, EMBER_CARD, type Card } from "@/game/cards";
import { CATEGORIES, KEY_NAMES, TIER_STEPS, type Category, type KeyName } from "@/sim/tiers";
import { GENOME_VERSION } from "@/sim/genome";
import type { BossType } from "@/sim/boss";
import type { MapType } from "@/sim/mapType";
import type { DeathCause } from "@/sim/world";
import type { StageKind } from "@/game/config";
import type { OrderKind } from "@/sim/herdOrder";
import type { ExtinctionType, TrialKind } from "@/game/game";

/** 코드 구조(스키마) 버전. **구조가 바뀌면 올린다** · 다르면 디코더가 아예 못 읽는다고 말한다. */
export const RUN_CODE_SCHEMA = 1;

/** 사람이 앞부분만 봐도 무엇인지 알게 하는 접두사. 스키마 버전이 여기에도 보인다. */
export const RUN_CODE_PREFIX = `SP${RUN_CODE_SCHEMA}-`;

// ─────────────────────────────── 코드 공간(순서 = 뜻) ───────────────────────────────
//
// 전부 `Record<T, number>` 로 적는다 — 타입이 **빠짐없이** 적혔는지 컴파일러가 검사해 주고
// (새 보스를 넣고 여기를 잊으면 타입 오류), 숫자를 눈으로 확인할 수 있다.

// ⚠ `BOSS_TYPES`(뽑기 풀)가 아니라 **BossType 전부**를 적는다 · titan 은 풀에서 빠져 있지만
//   프리셋·디버그 소환에는 남아 있어서, 풀만 보면 "보스인지 대멸종인지" 판정이 조용히 틀린다.
const BOSS_CODE: Record<BossType, number> = {
  chaser: 0,
  swarm: 1,
  poison: 2,
  raider: 3,
  isolation: 4,
  stalker: 5,
  raptor: 6,
  hornet: 7,
  shark: 8,
  titan: 9,
};

const EXTINCTION_CODE: Record<ExtinctionType, number> = {
  cold: 0,
  famine: 1,
  heat: 2,
  plague: 3,
};

/** 명령 종류 — 순서가 곧 저장된 숫자의 뜻이다(재배열 금지 · 새 칸은 끝에만). */
const ORDER_KIND_CODE: Record<OrderKind, number> = {
  move: 0,
  hunt: 1,
  evade: 2,
  gather: 3,
  scan: 4,
  brace: 5,
  ring: 6,
  drive: 7,
};
const ORDER_KIND_BY_CODE: OrderKind[] = ["move", "hunt", "evade", "gather", "scan", "brace", "ring", "drive"];

const TRIAL_CODE: Record<TrialKind, number> = {
  hunt: 0,
  feed: 1,
  birth: 2,
  pop: 3,
  hold: 4,
  mark: 5,
};

const STAGE_CODE: Record<StageKind, number> = {
  forage: 0,
  boss: 1,
  extinction: 2,
};

const MAP_CODE: Record<MapType, number> = {
  continent: 0,
  pangaea: 1,
  archipelago: 2,
  ocean: 3,
  meadow: 4,
};

const DEATH_CODE: Record<DeathCause, number> = {
  starve: 0,
  cold: 1,
  heat: 2,
  age: 3,
  boss: 4,
  predation: 5,
  plague: 6,
  venom: 7,
  wound: 8,
};

/** 드래프트가 어떤 자리에서 열렸나. */
export type DraftKind = "preset" | "level" | "era";
const DRAFT_KIND_CODE: Record<DraftKind, number> = { preset: 0, level: 1, era: 2 };

/** 런이 어떻게 끝났나(이 시대 기준 — 이어가면 시대마다 하나씩 남는다). */
export type EndReason = "conquer" | "eraWin" | "embers" | "extinct" | "gate";
const END_REASON_CODE: Record<EndReason, number> = {
  conquer: 0,
  eraWin: 1,
  embers: 2,
  extinct: 3,
  gate: 4,
};

/** `Record<K, number>` 를 번호 → 이름 배열로 뒤집는다(디코더가 쓴다). */
function reverseCode<K extends string>(m: Record<K, number>): (K | undefined)[] {
  const out: (K | undefined)[] = [];
  for (const k of Object.keys(m) as K[]) out[m[k]] = k;
  return out;
}

const BOSS_BY_CODE = reverseCode(BOSS_CODE);
const EXTINCTION_BY_CODE = reverseCode(EXTINCTION_CODE);
const TRIAL_BY_CODE = reverseCode(TRIAL_CODE);
const STAGE_BY_CODE = reverseCode(STAGE_CODE);
const MAP_BY_CODE = reverseCode(MAP_CODE);
const DEATH_BY_CODE = reverseCode(DEATH_CODE);
const DRAFT_KIND_BY_CODE = reverseCode(DRAFT_KIND_CODE);
const END_REASON_BY_CODE = reverseCode(END_REASON_CODE);

/** 위협 코드 공간 — 보스 뒤에 대멸종을 잇는다(한 칸으로 둘 다 가리키게). */
const EXTINCTION_CODE_BASE = 32;

/**
 * 이 위협이 보스인가(대멸종과 가른다). **완성도 검사가 걸린 위 표**를 본다 —
 * `BOSS_TYPES` 는 뽑기 풀이라 풀에서 빠진 보스(titan)를 놓치고, 그러면 기록이 그 판을
 * 「대멸종」으로 적는다.
 */
export function isBossThreat(x: BossType | ExtinctionType): x is BossType {
  return Object.prototype.hasOwnProperty.call(BOSS_CODE, x);
}

// ─────────────────────────────── 카드 번호 ───────────────────────────────

/**
 * 카드 코드 공간 — **긴 id 문자열을 그대로 넣지 않고 번호로 접는다.** 순서는 결정론이다
 * (`CARD_POOL` 은 `buildPool()` 이 늘 같은 순서로 만든다).
 * 뒤에 프리셋과 불씨 카드를 잇는다 · 셋 다 한 코드 공간에서 다뤄야 드래프트 종류를 안 가리고 적을 수 있다.
 */
export const CODE_CARDS: readonly Card[] = [...CARD_POOL, ...PRESET_CARDS, EMBER_CARD];

const CARD_INDEX = new Map<string, number>(CODE_CARDS.map((c, i) => [c.id, i]));

/**
 * 시대 보상 카드는 `boostCard` 가 id 끝에 `_x2` 같은 꼬리를 붙인다. 기록에는 **꼬리를 뗀 원래 id** 만
 * 담는다 — 배수는 드래프트 기록의 `boost` 가 따로 들고 있으니, 꼬리까지 담으면 같은 것을 두 곳에
 * 적는 셈이고 왕복(인코드 → 디코드)도 어긋난다(번호는 원래 카드를 가리키므로 꼬리가 되살아나지 않는다).
 */
export function baseCardId(id: string): string {
  if (CARD_INDEX.has(id)) return id;
  const cut = id.lastIndexOf("_x");
  if (cut > 0 && CARD_INDEX.has(id.slice(0, cut))) return id.slice(0, cut);
  return id;
}

/** 카드 id → 번호(강화 꼬리는 떼고 찾는다). 모르는 카드면 -1. */
export function cardCodeIndex(id: string): number {
  return CARD_INDEX.get(baseCardId(id)) ?? -1;
}

/** 번호 → 카드(모르는 번호면 null). 디코더가 이름·등급을 되살리는 문. */
export function cardByCode(index: number): Card | null {
  return CODE_CARDS[index] ?? null;
}

/**
 * **카드 풀 지문.** 카드 id 목록·범주·티어 사다리에서 뽑는다. 풀이 한 장이라도 바뀌면 값이 달라져,
 * 디코더가 "이 코드는 다른 카드 풀에서 나왔다"고 **말할 수 있다.**
 * (이 저장소는 「id 를 바꿨는데 표를 안 고쳐 조용히 죽은」 사고를 겪었다 · 지문 없는 데이터는 그 꼴이 난다.)
 */
export function poolDigest(): number {
  const text =
    CODE_CARDS.map((c) => c.id).join(",") +
    "|" +
    CATEGORIES.join(",") +
    "|" +
    TIER_STEPS.join(",") +
    "|" +
    KEY_NAMES.join(",");
  return fnv1a(text) & 0xffff;
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    // 한글처럼 두 바이트를 넘는 글자도 상위 바이트까지 섞는다(id 는 ASCII 지만 안전하게).
    const hi = text.charCodeAt(i) >> 8;
    if (hi !== 0) {
      h ^= hi;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

function fnv1aBytes(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ─────────────────────────────── 담기는 것 ───────────────────────────────

/** 드래프트 하나의 결말. 고른 자리(0~n-1)이거나 아래 셋 중 하나. */
export const DRAFT_SKIPPED = 250;
export const DRAFT_REROLLED = 251;
export const DRAFT_NONE = 252;

/** 드래프트 한 번 — 후보 **전부**와 그중 무엇을 골랐나. 리롤로 버린 후보도 한 줄로 남는다. */
export interface DraftRecord {
  t: "draft";
  kind: DraftKind;
  /** 시대 보상 강화 배수(보통 1). 카드 도장은 이 배수만큼 커져 있었다. */
  boost: number;
  /** 그때의 런 레벨. */
  level: number;
  /** 후보 카드 id(강화 꼬리 `_x2` 는 붙은 채로 들어온다 · 번호로 접을 때 떼어낸다). */
  cards: string[];
  /** 고른 자리(0부터) · `DRAFT_SKIPPED`(건너뜀) · `DRAFT_REROLLED`(다시 뽑기로 버림) · `DRAFT_NONE`. */
  outcome: number;
}

/** 방울로 티어 하나를 산 순간. */
export interface BuyRecord {
  t: "buy";
  cat: Category;
  /** 든 방울(= 그 순간 다음 문턱까지 남은 도장). */
  cost: number;
  /** 사고 나서 오른 단. */
  tier: number;
  /**
   * 이 구입이 떨어진 단계 순번(1부터). **0 = 시각이 안 담긴 옛 코드**(2026-08-09 이전).
   * 순서만 알고 시각을 모르면 되살릴 때 구입이 원판보다 앞뒤로 밀려, 도장이 붙는 틱이 달라지고
   * 세계가 그 자리에서 갈라진다(자가 검사에서 실제로 그랬다 · 시대 4 첫 단계에서 6 대 5).
   */
  stage: number;
  /** 그 단계가 시작한 뒤 흐른 틱. `stage` 가 0 이면 뜻이 없다. */
  tick: number;
}

/** 라운드 시험의 판정(수치까지). */
export interface TrialRecord {
  kind: TrialKind;
  target: number;
  progress: number;
  passed: boolean;
  /** 크게 넘겨 불씨가 하나 돌아왔는가. */
  overachieved: boolean;
}

/** 단계 하나가 어떻게 끝났나. */
export interface StageRecord {
  t: "stage";
  kind: StageKind;
  era: number;
  /** 이 단계의 위협(보스/대멸종). 채집 라운드면 null. */
  boss: BossType | null;
  extinction: ExtinctionType | null;
  passed: boolean;
  /** 보스를 직접 격퇴했는가(버틴 것과 구분 · 방울이 여기서 나온다). */
  defeated: boolean;
  /** 단계가 끝난 순간의 내 종 개체 수. */
  pop: number;
  trial: TrialRecord | null;
}

/**
 * **사람이 내린 명령 하나(탭).** 재현의 마지막 빠진 조각이다.
 *
 * ⚠ 왜 필요했나(2026-08-09). 판 코드는 시드와 카드·구입을 담아 "판이 통째로 재현된다"고 적혀
 *   있었지만, **탭은 안 담겼다.** 그래서 사람이 실제로 플레이한 판을 되살리면 첫 단계부터
 *   개체 수가 갈렸고(기록 13 · 재현 22), 무엇이 다른지 알 길이 없었다. 조종이 기본이 된 지금
 *   탭은 카드만큼 판을 바꾼다 — 지시를 따르는 동안 무리는 먹지 않고, 방울을 주우러 새고,
 *   「피해라」는 기력을 문다.
 *
 * 담는 것은 **월드 좌표와 종류와 시각(틱)** 셋뿐이다. 화면 좌표·카메라는 안 담는다(파생이라
 * 재현에 필요 없고, 담으면 화면 크기가 다른 기기에서 거짓이 된다).
 * `tick` 은 **그 단계가 시작한 뒤 흐른 틱**이다 — 런 전체 누적으로 담으면 단계 하나가 밀릴 때
 * 뒤의 모든 탭이 함께 밀린다.
 */
export interface OrderRecord {
  t: "order";
  /** 이 탭이 떨어진 단계(`entries` 안의 몇 번째 stage 인지가 아니라 그 단계의 순서 번호). */
  stage: number;
  /** 단계 시작 후 흐른 틱. */
  tick: number;
  x: number;
  y: number;
  kind: OrderKind;
}

/** 시대를 넘었다. */
export interface EraRecord {
  t: "era";
  era: number;
}

/** 이 시대(또는 런)가 끝났다. */
export interface EndRecord {
  t: "end";
  win: boolean;
  reason: EndReason;
  era: number;
  level: number;
}

export type RunLogEntry = DraftRecord | BuyRecord | OrderRecord | StageRecord | EraRecord | EndRecord;

/** 재현에 필요한 판 밖의 상태(세계를 만드는 재료). */
export interface RunCodeHeader {
  /** 맵 시드 원본 — 시대 접미사(`-eraN`) 붙이기 전. 이것 하나가 맵·드래프트·보스를 다 파생한다. */
  seed: string;
  /** 이 런에 뽑힌 세계 종류(진도 0~1 은 실제로 「초원」을 쓴다 · 그건 진도에서 파생된다). */
  mapType: MapType;
  metaLevel: number;
  /** 끝낸 런 수 — 온보딩 진도 = min(3, 이 값 + 시대). */
  runsDone: number;
  /** 이 세계에 부른 지난 챔피언 수(게놈 자체는 안 담는다 · 아래 주석 참고). */
  champions: number;
  everConquered: boolean;
  rerollUnlocked: boolean;
  leadEnabled: boolean;
  /** 은근한 보정이 켜져 있었는가(프로브는 끈다 · 켠 채 잰 난이도는 실제 난이도가 아니다). */
  assistEnabled: boolean;
}

/** 그래서 어떻게 됐나(관측). 여기 값들은 **이미 있는 것을 읽어** 만든다(새로 세지 않는다). */
export interface RunCodeSummary {
  durationSec: number;
  /** 개체 수 곡선 요약. min 은 **살아 있던 가장 적은 수**(0 은 멸종이라 곡선 정보가 아니다). */
  popMax: number;
  popMin: number;
  popEnd: number;
  popPeak: number;
  era: number;
  level: number;
  rerollsUsed: number;
  pips: Record<Category, number>;
  keys: KeyName[];
  /** 사망 원인 — **마지막 세계의 것**이다(World 는 시대마다 새로 만들어지고 집계도 함께 새로 시작한다). */
  deaths: Record<DeathCause, number>;
  geneEarned: number;
  geneSpent: number;
  geneLeft: number;
}

export interface RunCodeData {
  schema: number;
  genomeVersion: number;
  poolDigest: number;
  header: RunCodeHeader;
  entries: RunLogEntry[];
  summary: RunCodeSummary;
}

/** 지금 빌드의 도장(스키마·게놈·풀 지문) — 인코더가 코드 앞머리에 찍는다. */
export function currentCodeStamp(): { schema: number; genomeVersion: number; poolDigest: number } {
  return { schema: RUN_CODE_SCHEMA, genomeVersion: GENOME_VERSION, poolDigest: poolDigest() };
}

// ─────────────────────────────── 바이트 쓰기/읽기 ───────────────────────────────

class ByteWriter {
  private readonly out: number[] = [];

  u8(v: number): void {
    this.out.push(Math.max(0, Math.min(255, Math.trunc(v))) & 0xff);
  }

  /** 가변 길이 정수(LEB128) — 작은 수는 1바이트다. 음수·NaN 은 0 으로 눕힌다(코드가 깨지지 않게). */
  varint(v: number): void {
    let n = Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
    while (n >= 0x80) {
      this.out.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    this.out.push(n);
  }

  str(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.varint(bytes.length);
    for (const b of bytes) this.out.push(b);
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

class ByteReader {
  private at = 0;
  constructor(private readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.at >= this.buf.length;
  }

  u8(): number {
    if (this.at >= this.buf.length) throw new Error("코드가 중간에 끊겼습니다");
    return this.buf[this.at++] as number;
  }

  varint(): number {
    let shift = 1;
    let out = 0;
    for (let i = 0; i < 8; i += 1) {
      const b = this.u8();
      out += (b & 0x7f) * shift;
      if ((b & 0x80) === 0) return out;
      shift *= 128;
    }
    throw new Error("숫자가 너무 깁니다");
  }

  str(): string {
    const n = this.varint();
    if (this.at + n > this.buf.length) throw new Error("코드가 중간에 끊겼습니다");
    const s = new TextDecoder().decode(this.buf.subarray(this.at, this.at + n));
    this.at += n;
    return s;
  }
}

// ─────────────────────────────── base64url ───────────────────────────────
//
// 손으로 짠다 · `btoa`(브라우저)와 `Buffer`(node)를 갈라 쓰면 두 갈래가 언젠가 어긋난다.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INV = new Map<string, number>([...B64].map((ch, i) => [ch, i]));

function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? (bytes[i + 1] as number) : 0;
    const b2 = hasB2 ? (bytes[i + 2] as number) : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (!hasB1) break;
    out += B64[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (!hasB2) break;
    out += B64[b2 & 0x3f];
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of text) {
    const v = B64_INV.get(ch);
    if (v === undefined) throw new Error(`코드에 쓸 수 없는 글자가 있습니다: ${ch}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// ─────────────────────────────── 인코더 ───────────────────────────────

// ⚠ **태그는 끝에만 더한다.** 번호가 곧 저장된 뜻이라 재배열하면 어제 뽑은 코드가 다른 것을 가리킨다.
//   새 태그(order=6)를 더하는 것은 안전하다 — 옛 코드에는 그 바이트가 없으므로 그대로 읽힌다.
//   그래서 스키마 버전을 안 올렸다(올리면 사용자가 이미 보낸 코드를 못 읽게 된다).
//   buy=2 는 시각이 없던 옛 칸이다 · buyAt=7 이 그 자리를 잇는다(옛 코드를 계속 읽으려고 남겨 둔다).
const TAG = { draft: 1, buy: 2, stage: 3, era: 4, end: 5, order: 6, buyAt: 7 } as const;

export function encodeRunCode(data: RunCodeData): string {
  const w = new ByteWriter();
  w.u8(data.schema);
  w.u8(data.genomeVersion);
  w.u8((data.poolDigest >> 8) & 0xff);
  w.u8(data.poolDigest & 0xff);

  const h = data.header;
  w.str(h.seed);
  w.u8(MAP_CODE[h.mapType] ?? 0);
  w.varint(h.metaLevel);
  w.varint(h.runsDone);
  w.varint(h.champions);
  w.u8(
    (h.everConquered ? 1 : 0) |
      (h.rerollUnlocked ? 2 : 0) |
      (h.leadEnabled ? 4 : 0) |
      (h.assistEnabled ? 8 : 0),
  );

  w.varint(data.entries.length);
  for (const e of data.entries) writeEntry(w, e);
  writeSummary(w, data.summary);

  const body = w.bytes();
  // 끝에 검사합 두 바이트 — 폰에서 복사가 잘리거나 글자가 섞이면 디코더가 **조용히 틀리지 않고** 말한다.
  const ck = fnv1aBytes(body) & 0xffff;
  const full = new Uint8Array(body.length + 2);
  full.set(body, 0);
  full[body.length] = (ck >> 8) & 0xff;
  full[body.length + 1] = ck & 0xff;
  return RUN_CODE_PREFIX + toBase64Url(full);
}

function writeEntry(w: ByteWriter, e: RunLogEntry): void {
  if (e.t === "draft") {
    w.u8(TAG.draft);
    w.u8(DRAFT_KIND_CODE[e.kind]);
    w.varint(e.boost);
    w.varint(e.level);
    w.varint(e.cards.length);
    for (const id of e.cards) w.varint(cardCodeIndex(id) + 1); // 0 = 모르는 카드
    w.u8(e.outcome);
    return;
  }
  if (e.t === "buy") {
    // 새 코드는 언제나 시각을 담는 칸(buyAt)으로 쓴다 · 옛 칸(buy)은 읽기 전용으로만 남는다.
    w.u8(TAG.buyAt);
    w.u8(CATEGORIES.indexOf(e.cat));
    w.varint(e.cost);
    w.u8(e.tier);
    w.varint(e.stage);
    w.varint(e.tick);
    return;
  }
  if (e.t === "order") {
    w.u8(TAG.order);
    w.varint(e.stage);
    w.varint(e.tick);
    // 좌표는 정수 픽셀로 접는다 — 소수점은 재현에 필요 없다(탭은 손가락이 찍는 자리다).
    w.varint(Math.round(e.x));
    w.varint(Math.round(e.y));
    w.u8(ORDER_KIND_CODE[e.kind] ?? 0);
    return;
  }
  if (e.t === "stage") {
    w.u8(TAG.stage);
    const tr = e.trial;
    w.u8(
      (STAGE_CODE[e.kind] & 0x03) |
        (e.passed ? 4 : 0) |
        (e.defeated ? 8 : 0) |
        (tr ? 16 : 0) |
        (tr?.passed ? 32 : 0) |
        (tr?.overachieved ? 64 : 0),
    );
    w.varint(e.era);
    // 위협 한 칸 — 0 = 없음 · 1~ 보스 · EXTINCTION_CODE_BASE+ 대멸종.
    const threat =
      e.boss !== null
        ? BOSS_CODE[e.boss] + 1
        : e.extinction !== null
          ? EXTINCTION_CODE_BASE + EXTINCTION_CODE[e.extinction]
          : 0;
    w.u8(threat);
    w.varint(e.pop);
    if (tr) {
      w.u8(TRIAL_CODE[tr.kind]);
      w.varint(tr.target);
      w.varint(tr.progress);
    }
    return;
  }
  if (e.t === "era") {
    w.u8(TAG.era);
    w.varint(e.era);
    return;
  }
  w.u8(TAG.end);
  w.u8((e.win ? 1 : 0) | (END_REASON_CODE[e.reason] << 1));
  w.varint(e.era);
  w.varint(e.level);
}

function writeSummary(w: ByteWriter, s: RunCodeSummary): void {
  w.varint(s.durationSec);
  w.varint(s.popMax);
  w.varint(s.popMin);
  w.varint(s.popEnd);
  w.varint(s.popPeak);
  w.varint(s.era);
  w.varint(s.level);
  w.varint(s.rerollsUsed);
  for (const c of CATEGORIES) w.varint(s.pips[c]);
  let keyMask = 0;
  KEY_NAMES.forEach((k, i) => {
    if (s.keys.includes(k)) keyMask |= 1 << i;
  });
  w.u8(keyMask);
  for (const cause of Object.keys(DEATH_CODE) as DeathCause[]) w.varint(s.deaths[cause]);
  w.varint(s.geneEarned);
  w.varint(s.geneSpent);
  w.varint(s.geneLeft);
}

// ─────────────────────────────── 디코더 ───────────────────────────────

export type RunCodeDecode =
  | { ok: true; data: RunCodeData; warnings: string[] }
  | { ok: false; error: string };

/**
 * 코드 문자열을 되푼다. **버전이 다르면 그렇게 말한다** — 조용히 엉뚱한 표를 뱉지 않는다.
 * 줄바꿈·공백은 흘려 넘긴다(폰에서 복사하면 줄이 접힌다).
 */
export function decodeRunCode(text: string): RunCodeDecode {
  const cleaned = text.replace(/\s+/g, "");
  const body = cleaned.startsWith(RUN_CODE_PREFIX) ? cleaned.slice(RUN_CODE_PREFIX.length) : cleaned;
  if (cleaned.length === 0) return { ok: false, error: "빈 코드입니다" };
  // 접두사가 아예 다른 스키마면(SP2- 등) 구조가 다르다는 뜻이라 읽지 않는다.
  const other = /^SP(\d+)-/.exec(cleaned);
  if (other && Number(other[1]) !== RUN_CODE_SCHEMA) {
    return {
      ok: false,
      error: `코드 구조 버전이 다릅니다(코드 ${other[1]} · 이 빌드 ${RUN_CODE_SCHEMA}). 그때의 빌드로 풀어야 합니다.`,
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(body);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "코드를 읽지 못했습니다" };
  }
  if (bytes.length < 8) return { ok: false, error: "코드가 너무 짧습니다(잘려 붙여진 것 같습니다)" };

  const payload = bytes.subarray(0, bytes.length - 2);
  const ck = ((bytes[bytes.length - 2] as number) << 8) | (bytes[bytes.length - 1] as number);
  if ((fnv1aBytes(payload) & 0xffff) !== ck) {
    return { ok: false, error: "검사합이 안 맞습니다 — 코드가 잘렸거나 글자가 섞였습니다" };
  }

  const r = new ByteReader(payload);
  const warnings: string[] = [];
  try {
    const schema = r.u8();
    if (schema !== RUN_CODE_SCHEMA) {
      return {
        ok: false,
        error: `코드 구조 버전이 다릅니다(코드 ${schema} · 이 빌드 ${RUN_CODE_SCHEMA}).`,
      };
    }
    const genomeVersion = r.u8();
    if (genomeVersion !== GENOME_VERSION) {
      warnings.push(
        `게놈 버전이 다릅니다(코드 v${genomeVersion} · 이 빌드 v${GENOME_VERSION}). 형질·티어의 뜻이 달라졌을 수 있습니다.`,
      );
    }
    const digest = (r.u8() << 8) | r.u8();
    if (digest !== poolDigest()) {
      warnings.push(
        "카드 풀 지문이 다릅니다 — 이 코드가 나온 빌드와 카드 목록이 다릅니다. **카드 이름을 믿지 마세요**(번호가 다른 카드를 가리킵니다).",
      );
    }

    const seed = r.str();
    const mapType = MAP_BY_CODE[r.u8()] ?? "continent";
    const metaLevel = r.varint();
    const runsDone = r.varint();
    const champions = r.varint();
    const flags = r.u8();
    const header: RunCodeHeader = {
      seed,
      mapType,
      metaLevel,
      runsDone,
      champions,
      everConquered: (flags & 1) !== 0,
      rerollUnlocked: (flags & 2) !== 0,
      leadEnabled: (flags & 4) !== 0,
      assistEnabled: (flags & 8) !== 0,
    };

    const n = r.varint();
    const entries: RunLogEntry[] = [];
    for (let i = 0; i < n; i += 1) entries.push(readEntry(r));
    const summary = readSummary(r);
    return {
      ok: true,
      data: { schema, genomeVersion, poolDigest: digest, header, entries, summary },
      warnings,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "코드를 읽지 못했습니다" };
  }
}

function readEntry(r: ByteReader): RunLogEntry {
  const tag = r.u8();
  if (tag === TAG.draft) {
    const kind = DRAFT_KIND_BY_CODE[r.u8()] ?? "level";
    const boost = r.varint();
    const level = r.varint();
    const count = r.varint();
    const cards: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const idx = r.varint() - 1;
      cards.push(cardByCode(idx)?.id ?? `?${idx}`);
    }
    return { t: "draft", kind, boost, level, cards, outcome: r.u8() };
  }
  if (tag === TAG.buy) {
    // 옛 칸 — 시각이 없다. `stage: 0` 이 "안 담겼다"는 뜻이고, 재생기는 그때만 「살 수 있게 되면 곧」
    // 이라는 근사로 되돌아간다(그 판은 구입 시점이 원판과 다를 수 있다).
    const cat = CATEGORIES[r.u8()] ?? "fang";
    return { t: "buy", cat, cost: r.varint(), tier: r.u8(), stage: 0, tick: 0 };
  }
  if (tag === TAG.stage) {
    const f = r.u8();
    const kind = STAGE_BY_CODE[f & 0x03] ?? "forage";
    const era = r.varint();
    const threat = r.u8();
    const pop = r.varint();
    const hasTrial = (f & 16) !== 0;
    const trial: TrialRecord | null = hasTrial
      ? {
          kind: TRIAL_BY_CODE[r.u8()] ?? "hunt",
          target: r.varint(),
          progress: r.varint(),
          passed: (f & 32) !== 0,
          overachieved: (f & 64) !== 0,
        }
      : null;
    return {
      t: "stage",
      kind,
      era,
      boss: threat > 0 && threat < EXTINCTION_CODE_BASE ? (BOSS_BY_CODE[threat - 1] ?? null) : null,
      extinction:
        threat >= EXTINCTION_CODE_BASE ? (EXTINCTION_BY_CODE[threat - EXTINCTION_CODE_BASE] ?? null) : null,
      passed: (f & 4) !== 0,
      defeated: (f & 8) !== 0,
      pop,
      trial,
    };
  }
  if (tag === TAG.buyAt) {
    return {
      t: "buy",
      cat: (CATEGORIES[r.u8()] ?? CATEGORIES[0]) as Category,
      cost: r.varint(),
      tier: r.u8(),
      stage: r.varint(),
      tick: r.varint(),
    };
  }
  if (tag === TAG.order) {
    return {
      t: "order",
      stage: r.varint(),
      tick: r.varint(),
      x: r.varint(),
      y: r.varint(),
      kind: ORDER_KIND_BY_CODE[r.u8()] ?? "move",
    };
  }
  if (tag === TAG.era) return { t: "era", era: r.varint() };
  if (tag === TAG.end) {
    const f = r.u8();
    return {
      t: "end",
      win: (f & 1) !== 0,
      reason: END_REASON_BY_CODE[f >> 1] ?? "gate",
      era: r.varint(),
      level: r.varint(),
    };
  }
  throw new Error(`모르는 기록 종류(${tag}) — 코드가 깨졌거나 더 새로운 빌드에서 나왔습니다`);
}

function readSummary(r: ByteReader): RunCodeSummary {
  const durationSec = r.varint();
  const popMax = r.varint();
  const popMin = r.varint();
  const popEnd = r.varint();
  const popPeak = r.varint();
  const era = r.varint();
  const level = r.varint();
  const rerollsUsed = r.varint();
  const pips = {} as Record<Category, number>;
  for (const c of CATEGORIES) pips[c] = r.varint();
  const keyMask = r.u8();
  const keys: KeyName[] = KEY_NAMES.filter((_, i) => (keyMask & (1 << i)) !== 0);
  const deaths = {} as Record<DeathCause, number>;
  for (const cause of Object.keys(DEATH_CODE) as DeathCause[]) deaths[cause] = r.varint();
  return {
    durationSec,
    popMax,
    popMin,
    popEnd,
    popPeak,
    era,
    level,
    rerollsUsed,
    pips,
    keys,
    deaths,
    geneEarned: r.varint(),
    geneSpent: r.varint(),
    geneLeft: r.varint(),
  };
}

/** 사망 원인 코드 순서(디코더 표가 같은 순서로 그리게). */
export const DEATH_ORDER: readonly DeathCause[] = DEATH_BY_CODE.filter(
  (c): c is DeathCause => c !== undefined,
);
