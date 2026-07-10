// 도전 과제(업적) — 레벨과 다른 축의 진행. localStorage 영속, sim 결정론과 무관(게임 밖 상태).
//
// ## 레벨과 업적의 역할 분담
// - **플레이어 레벨**(meta.ts): 런을 거듭하면 자동으로 오른다 → **선택지**가 열린다(갈래·카드·리롤).
//   시간만 쓰면 누구나 도달한다.
// - **도전 과제**(이 파일): 특정한 플레이를 해내야 열린다 → **자랑거리**가 열린다(꾸밈)와 딱 하나의
//   특별 형질(「거인」). 시간이 아니라 솜씨가 연다.
//
// 보상이 파워로 쏠리지 않게 대부분을 **꾸밈(효과 없음)** 으로 둔다. meta.ts 의 "수직 언락 금지" 원칙과 같다.
// 유일한 형질 보상 「거인」도 명백한 대가(걸음 -18, 번식 -14)를 지녀 "강해지는 해금"이 아니다.

import type { Genome } from "@/sim/genome";
import { isCardUnlocked } from "@/game/meta";

const STORAGE_KEY = "selpress_achievements_v1";
const COSMETIC_KEY = "selpress_cosmetic_v1";

/** 꾸밈 — 효과가 전혀 없다. 몸이 어떻게 보이는지, 개체 이름이 어느 목록에서 나오는지만 바꾼다. */
export type CosmeticId = "stardust" | "glow" | "rainbow" | "halo" | "mythicNames";

/** 몸에 걸치는 꾸밈(하나만 고른다). `mythicNames` 는 이름 목록이라 여기 없다 — 열리면 항상 적용된다. */
export const BODY_COSMETICS: readonly CosmeticId[] = ["stardust", "glow", "rainbow", "halo"];

export interface CosmeticInfo {
  name: string;
  desc: string;
}

export const COSMETICS: Record<CosmeticId, CosmeticInfo> = {
  stardust: { name: "별가루", desc: "지나간 자리에 반짝이가 남는다." },
  glow: { name: "빛나는 몸", desc: "몸이 은은한 빛을 뿜는다." },
  rainbow: { name: "무지갯빛", desc: "몸빛이 천천히 흐르며 바뀐다." },
  halo: { name: "빛 고리", desc: "머리 위에 얇은 고리가 떠 있다." },
  mythicNames: { name: "전설의 이름", desc: "새끼들이 오래된 이름을 물려받는다." },
};

export type Reward = { kind: "cosmetic"; cosmetic: CosmeticId } | { kind: "card"; cardId: string };

/** 업적 판정에 쓰는 한 판의 성적. 판정은 순수 함수라 테스트로 고정한다. */
export interface RunSummary {
  /** 런이 정말 끝났는가(멸종 또는 정복). 중간 시대 승리는 false — 아직 이어진다. */
  finished: boolean;
  /** 한 시대를 정점으로 마쳤는가(중간 승리 포함). */
  won: boolean;
  /** 마지막 시대까지 정복했는가. */
  conquered: boolean;
  era: number;
  /** 도달한 런 레벨(세대). */
  level: number;
  /** 한 판 동안 내 무리가 닿은 최대 개체 수. */
  peakPopulation: number;
  /** 종료 시점 종 게놈. */
  genome: Genome;
  /** 이번 판에 "다시 뽑기"를 쓴 횟수. */
  rerollsUsed: number;
}

export interface Achievement {
  id: string;
  name: string;
  /** 무엇을 하면 열리는가 — 쉬운 말 한 줄. 플레이어가 읽고 노릴 수 있어야 한다. */
  desc: string;
  reward: Reward;
  check: (s: RunSummary) => boolean;
}

/**
 * 도전 과제 목록. 조건은 "한 판의 성적"만 본다(누적 조건은 아직 없다 — 판정이 단순해야 거짓말을 안 한다).
 * 순서 = 대략의 난이도. 첫 판에 하나는 반드시 열리게 해 "업적이 있다"를 알린다.
 */
export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: "first_run",
    name: "첫 발자국",
    desc: "한 판을 끝까지 지켜본다. 이기든 지든.",
    reward: { kind: "cosmetic", cosmetic: "stardust" },
    check: (s) => s.finished,
  },
  {
    id: "apex",
    name: "정점 등극",
    desc: "한 시대의 정점에 오른다(승리).",
    reward: { kind: "cosmetic", cosmetic: "glow" },
    check: (s) => s.won,
  },
  {
    id: "swarm",
    name: "대군",
    desc: "한 판에서 내 무리를 40마리 넘게 불린다.",
    reward: { kind: "cosmetic", cosmetic: "mythicNames" },
    check: (s) => s.peakPopulation > 40,
  },
  {
    id: "long_lineage",
    name: "긴 혈통",
    desc: "한 판에서 8세대까지 이어간다.",
    reward: { kind: "cosmetic", cosmetic: "halo" },
    check: (s) => s.level >= 8,
  },
  {
    id: "unshaken",
    name: "흔들림 없는 선택",
    desc: "다시 뽑기를 한 번도 쓰지 않고 승리한다.",
    reward: { kind: "cosmetic", cosmetic: "rainbow" },
    check: (s) => s.won && s.rerollsUsed === 0,
  },
  {
    id: "titan_born",
    name: "거인의 태동",
    desc: "공격력 150 이상인 종으로 승리한다.",
    reward: { kind: "card", cardId: "titan" },
    check: (s) => s.won && s.genome.traits.attack >= 150,
  },
  {
    id: "conqueror",
    name: "정복자",
    desc: "마지막 시대까지 정복한다.",
    reward: { kind: "cosmetic", cosmetic: "rainbow" },
    check: (s) => s.conquered,
  },
];

/** 도전 과제로만 열리는 카드 id — 플레이어 레벨로는 절대 안 열린다. */
export const ACHIEVEMENT_CARDS: ReadonlySet<string> = new Set(
  ACHIEVEMENTS.filter((a) => a.reward.kind === "card").map((a) => (a.reward as { cardId: string }).cardId),
);

// ── 저장 ──
//
// **메모리 캐시가 진실이고 localStorage 는 그 사본이다.** 사생활 모드처럼 localStorage 를 못 쓰는 환경에서도
// 이번 세션 안에서는 딴 업적이 제대로 보여야 한다(안 그러면 종료 화면에 "달성!"이 뜨고 대백과엔 안 뜬다).
// 저장이 막혀도 플레이는 그대로 굴러가고, 다음 실행에만 잊는다.

let unlockedCache: Set<string> | null = null;
let cosmeticCache: CosmeticId | null | undefined; // undefined = 아직 안 읽음

function readUnlocked(): Set<string> {
  if (unlockedCache) return unlockedCache;
  const s = new Set<string>();
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) for (const x of arr) if (typeof x === "string") s.add(x);
    }
  } catch {
    // 파싱/접근 실패 → 아무것도 안 열린 것으로 시작
  }
  unlockedCache = s;
  return s;
}

function writeUnlocked(s: Set<string>): void {
  unlockedCache = s;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify([...s]));
  } catch {
    // 저장 실패면 이번 세션만 유효 — 조용히 무시(캐시에는 남아 있다)
  }
}

/** 지금까지 연 업적 id 들(사본 — 호출자가 고쳐도 내부 상태가 안 망가진다). */
export function loadAchievements(): Set<string> {
  return new Set(readUnlocked());
}

export function isAchievementUnlocked(id: string): boolean {
  return readUnlocked().has(id);
}

/**
 * 한 판의 성적으로 새로 열린 업적을 판정하고 저장한다. **새로 열린 것만** 돌려준다(종료 화면이 그것만 알린다).
 * 이미 열린 업적은 다시 안 뜬다.
 */
export function evaluateRun(summary: RunSummary): Achievement[] {
  const have = readUnlocked();
  const fresh: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.id)) continue;
    if (a.check(summary)) {
      have.add(a.id);
      fresh.push(a);
    }
  }
  if (fresh.length > 0) writeUnlocked(have);
  return fresh;
}

/** 이 카드가 도전 과제로 열려 있는가. 도전 과제 카드가 아니면 이 문지기는 통과시킨다. */
export function isAchievementCardUnlocked(cardId: string): boolean {
  if (!ACHIEVEMENT_CARDS.has(cardId)) return true;
  const have = readUnlocked();
  return ACHIEVEMENTS.some(
    (a) => have.has(a.id) && a.reward.kind === "card" && a.reward.cardId === cardId,
  );
}

/** 이 카드를 여는 도전 과제(없으면 null) — 대백과가 "○○ 달성 시 열림"을 적는 데 쓴다. */
export function achievementForCard(cardId: string): Achievement | null {
  return ACHIEVEMENTS.find((a) => a.reward.kind === "card" && a.reward.cardId === cardId) ?? null;
}

/**
 * 이 카드가 지금 드래프트 후보에 나올 수 있는가 — **두 문지기를 모두 통과해야 한다**.
 * 레벨 해금(meta) 과 도전 과제 해금(여기). 드래프트 뽑기와 대백과 확률 계산이 반드시 같은 이 함수를 쓴다
 * (한쪽만 쓰면 대백과에 뜨는 확률이 실제와 어긋난다).
 */
export function cardAvailable(cardId: string, metaLevel: number): boolean {
  return isCardUnlocked(cardId, metaLevel) && isAchievementCardUnlocked(cardId);
}

/** 지금까지 열린 꾸밈 전부. */
export function unlockedCosmetics(): CosmeticId[] {
  const have = readUnlocked();
  const out: CosmeticId[] = [];
  for (const a of ACHIEVEMENTS) {
    if (a.reward.kind !== "cosmetic" || !have.has(a.id)) continue;
    if (!out.includes(a.reward.cosmetic)) out.push(a.reward.cosmetic);
  }
  return out;
}

/** 지금 몸에 걸친 꾸밈. 안 골랐거나 아직 안 열렸으면 null(맨몸). 안 연 꾸밈은 저장돼 있어도 무시한다. */
export function equippedCosmetic(): CosmeticId | null {
  if (cosmeticCache === undefined) {
    cosmeticCache = null;
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(COSMETIC_KEY) : null;
      if (raw && BODY_COSMETICS.includes(raw as CosmeticId)) cosmeticCache = raw as CosmeticId;
    } catch {
      // 접근 실패 → 맨몸
    }
  }
  const id = cosmeticCache;
  if (id === null) return null;
  return unlockedCosmetics().includes(id) ? id : null;
}

export function equipCosmetic(id: CosmeticId | null): void {
  cosmeticCache = id;
  try {
    if (typeof localStorage === "undefined") return;
    if (id === null) localStorage.removeItem(COSMETIC_KEY);
    else localStorage.setItem(COSMETIC_KEY, id);
  } catch {
    // 저장 실패면 이번 세션만 유효(캐시에는 남아 있다)
  }
}

/** 「전설의 이름」이 열렸는가 — 열리면 개체 이름이 오래된 이름 목록에서 나온다(항상 적용, 고를 것 없음). */
export function mythicNamesUnlocked(): boolean {
  return unlockedCosmetics().includes("mythicNames");
}

/** 디버그 전용 — 도전 과제와 꾸밈 선택을 전부 지운다(캐시까지). */
export function debugResetAchievements(): void {
  unlockedCache = new Set();
  cosmeticCache = null;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(COSMETIC_KEY);
  } catch {
    // 접근 실패면 조용히 무시
  }
}

/** 디버그 전용 — 업적을 즉시 연다(꾸밈·카드 확인용). */
export function debugUnlockAchievement(id: string): void {
  const have = new Set(readUnlocked());
  have.add(id);
  writeUnlocked(have);
}
