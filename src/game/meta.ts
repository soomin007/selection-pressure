// 메타 진행(스트레치 S1) — 런을 거듭할수록 프리셋·카드가 열린다(Brotato식 수평 언락, 기획서 §5).
// ⚠️ 파워가 아니라 "선택지" 확장이다(수직 언락 금지) — 특수 갈래·특화 카드가 순차로 열려 빌드 폭이 넓어질 뿐,
// 처음부터 강해지지 않는다. localStorage 영속. sim 결정론과 무관(게임 밖 메타 상태라 시드/밸런스에 안 섞인다).

import { migrateGenome, type Genome } from "@/sim/genome";

const STORAGE_KEY = "selpress_meta_v1";
const CHAMPION_KEY = "selpress_champions_v1";
const CHAMPION_CAP = 8; // 명예의 전당 상한(오래된 것부터 밀려남)

// 비동기 생물(스트레치 S2) — 지난 런에서 활약한 내 종의 게놈을 저장해, 다음 런의 세계에 "예전의 나"가
// 다시 등장하게 한다(스포어/네메시스식). 게놈은 versioned·직렬화 가능이라 그대로 저장/로드(기획서 §3.1·§6).
export interface Champion {
  name: string;
  genome: Genome; // 저장 시점 게놈(로드 때 migrateGenome 으로 최신 버전으로 올림 → forward-compat)
  era: number; // 도달 시대(정복이면 eraCap)
  color: number;
}

export function loadChampions(): Champion[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CHAMPION_KEY) : null;
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        const out: Champion[] = [];
        for (const c of arr) {
          const rec = c as Partial<Champion>;
          if (!rec || typeof rec.name !== "string") continue;
          // 저장된 게놈을 최신 버전으로 마이그레이션(형질 추가/변경에도 옛 챔피언이 살아난다).
          out.push({
            name: rec.name,
            genome: migrateGenome(rec.genome),
            era: Math.max(0, Math.trunc(rec.era ?? 0)),
            color: typeof rec.color === "number" ? rec.color : 0x6cc24a,
          });
          if (out.length >= CHAMPION_CAP) break;
        }
        return out;
      }
    }
  } catch {
    // 파싱/접근 실패 → 챔피언 없음(첫 플레이 취급)
  }
  return [];
}

/** 챔피언 저장 — 최신을 앞에 넣고 상한까지만 유지(오래된 것 밀려남). 같은 종 중복은 막지 않는다(계보). */
export function saveChampion(c: Champion): void {
  try {
    if (typeof localStorage === "undefined") return;
    const list = [c, ...loadChampions()].slice(0, CHAMPION_CAP);
    localStorage.setItem(CHAMPION_KEY, JSON.stringify(list));
  } catch {
    // 저장 실패면 이번 세션만 유효 — 조용히 무시
  }
}

// 지속되는 "플레이어(메타) 레벨" — 런마다 성적(도달 레벨·시대·정복)만큼 메타 경험치(metaXp)가 쌓이고,
// 그 누적으로 레벨이 오른다. 런 종료 화면에서 이 경험치바가 차오르며 레벨업이 터지고, 레벨마다 해금이 열린다.
export interface MetaState {
  metaXp: number; // 누적 메타 경험치(런마다 적립) — 플레이어 레벨의 원천
  conquered: boolean; // 시대 상한(정복) 달성 여부(표시용)
}

// 메타 레벨 곡선 — 레벨 L→L+1 에 드는 경험치. 초반은 싸서 첫 런에도 여러 번 오른다("탕탕탕"). 뒤로 갈수록 늘어난다.
const META_LEVEL_BASE = 30;
const META_LEVEL_STEP = 18;
/** 레벨 L(1부터) → L+1 로 오르는 데 필요한 경험치. */
export function metaLevelCost(level: number): number {
  return META_LEVEL_BASE + Math.max(0, level - 1) * META_LEVEL_STEP;
}

// 런 성적 → 적립 메타 경험치. 오래 살아 레벨을 높이고(도달 레벨), 시대를 넘고, 정복할수록 많이 쌓인다.
const XP_PER_INRUN_LEVEL = 14; // 그 런에서 도달한 레벨 1당
const XP_PER_ERA = 18; // 넘어선 시대 1당
const XP_CONQUER_BONUS = 80; // 정복(최종 승리) 보너스
/** 이번 런이 적립하는 메타 경험치. */
export function runMetaXp(inRunLevel: number, era: number, conquered: boolean): number {
  return (
    Math.max(0, Math.trunc(inRunLevel)) * XP_PER_INRUN_LEVEL +
    Math.max(0, Math.trunc(era)) * XP_PER_ERA +
    (conquered ? XP_CONQUER_BONUS : 0)
  );
}

/** 누적 경험치 → 현재 레벨과 그 레벨 안 진척도. into=이번 레벨에 들어간 양, need=이번 레벨→다음까지 필요량. */
export function metaLevelInfo(totalXp: number): { level: number; into: number; need: number } {
  let level = 1;
  let remain = Math.max(0, Math.floor(totalXp));
  // 안전 상한(무한 루프 방지) — 현실 경험치로는 닿지 않는다.
  while (level < 999 && remain >= metaLevelCost(level)) {
    remain -= metaLevelCost(level);
    level += 1;
  }
  return { level, into: remain, need: metaLevelCost(level) };
}

/** 누적 경험치 → 레벨(정수). */
export function metaLevel(totalXp: number): number {
  return metaLevelInfo(totalXp).level;
}

/** 특정 레벨의 시작에 해당하는 누적 경험치(디버그로 레벨을 바로 세팅할 때 쓴다). */
export function xpForLevelStart(level: number): number {
  let xp = 0;
  for (let l = 1; l < Math.max(1, Math.trunc(level)); l++) xp += metaLevelCost(l);
  return xp;
}

// 언락 티어 — 플레이어(메타) 레벨이 atLevel 에 이르면 그 목록이 열린다. 런을 거듭해 메타 경험치가 쌓일수록
// 순차로 열린다(수평 확장: 파워가 아니라 갈래·카드·편의). reroll=true 면 그 레벨에서 "다시 뽑기"가 열린다.
export interface UnlockTier {
  atLevel: number;
  presetIds: string[];
  cardIds: string[];
  reroll?: boolean; // 이 레벨에서 드래프트 "다시 뽑기"가 열리는가
  label: string; // 해금 이름(제목)
  detail: string; // 무엇이 열리는지 한 줄 설명(제목 아래 작게)
}
/**
 * 해금 사다리. 전설 카드는 전부 "능력 계열의 관문"(cards.ts 참조)이므로, 이 표가 곧 **전설을 언제 보느냐**를
 * 정한다. 그래서 지느러미(바다)는 **처음부터 열어 둔다** — 안 그러면 첫 판에 전설 등급이 아예 없어서
 * 콘페티·금빛 플래시를 볼 길이 없다(수영은 기본 50 이라 문턱이 가장 낮은 능력이기도 하다).
 * 나머지 네 계열은 한 계열씩 열린다: 초음파 → 하늘 → 원거리 → 독.
 *
 * 프리셋(갈래)은 카드보다 한 걸음 늦게 연다 — 카드로 그 능력을 겪어 본 뒤에 "그 종으로 시작하기"가 열린다.
 */
export const UNLOCK_TIERS: readonly UnlockTier[] = [
  { atLevel: 2, presetIds: [], cardIds: [], reroll: true, label: "다시 뽑기", detail: "드래프트에서 카드를 새로 뽑는다" },
  { atLevel: 3, presetIds: [], cardIds: ["echo", "bat_ear"], label: "초음파", detail: "눈 대신 귀로 사방을 더듬는다" },
  { atLevel: 4, presetIds: ["preset_sea"], cardIds: ["webbed"], label: "바다 개척자", detail: "바다에서 시작하는 갈래" },
  { atLevel: 6, presetIds: [], cardIds: ["wings", "strong_wings"], label: "하늘", detail: "산과 바다를 날아 넘는다" },
  { atLevel: 7, presetIds: ["preset_sky"], cardIds: [], label: "하늘 개척자", detail: "하늘에서 시작하는 갈래" },
  { atLevel: 9, presetIds: [], cardIds: ["long_horn", "spit"], label: "원거리", detail: "다가서지 않고 멀리서 쏜다" },
  { atLevel: 10, presetIds: ["preset_ranged"], cardIds: [], label: "원거리 사냥꾼", detail: "원거리로 시작하는 갈래" },
  { atLevel: 12, presetIds: [], cardIds: ["venom_fang", "venom_gland"], label: "독 살갗", detail: "삼킨 포식자를 중독시킨다" },
  { atLevel: 13, presetIds: ["preset_venom"], cardIds: [], label: "독 개척자", detail: "독으로 시작하는 갈래" },
];

// 티어로 잠갔다 여는 대상 전체(잠금 후보). 이 집합에 없는 id 는 처음부터 항상 열려 있다.
const LOCKABLE_PRESETS = new Set(UNLOCK_TIERS.flatMap((t) => t.presetIds));
const LOCKABLE_CARDS = new Set(UNLOCK_TIERS.flatMap((t) => t.cardIds));
const REROLL_LEVEL = UNLOCK_TIERS.find((t) => t.reroll)?.atLevel ?? 999;

function readState(): MetaState {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const p = JSON.parse(raw) as Partial<MetaState>;
      return { metaXp: Math.max(0, Math.floor(p.metaXp ?? 0)), conquered: !!p.conquered };
    }
  } catch {
    // 파싱/접근 실패(사생활 모드 등) → 첫 플레이로 취급
  }
  return { metaXp: 0, conquered: false };
}

function writeState(s: MetaState): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // 저장 실패면 이번 세션만 유효 — 조용히 무시(플레이는 계속된다)
  }
}

export function loadMeta(): MetaState {
  return readState();
}

/** 프리셋 id 가 지금 열려 있는가 — 잠금 후보가 아니면 항상 열림, 후보면 메타 레벨까지 열림. */
export function isPresetUnlocked(id: string, level: number): boolean {
  if (!LOCKABLE_PRESETS.has(id)) return true;
  return UNLOCK_TIERS.some((t) => t.atLevel <= level && t.presetIds.includes(id));
}

/** 카드 id 가 지금 열려 있는가 — 잠금 후보가 아니면 항상 열림, 후보면 메타 레벨까지 열림. */
export function isCardUnlocked(id: string, level: number): boolean {
  if (!LOCKABLE_CARDS.has(id)) return true;
  return UNLOCK_TIERS.some((t) => t.atLevel <= level && t.cardIds.includes(id));
}

/** 지금 "다시 뽑기"가 열려 있는가 — 메타 레벨이 리롤 티어 레벨 이상이면 열린다. */
export function isRerollUnlockedAtLevel(level: number): boolean {
  return level >= REROLL_LEVEL;
}

// 런 종료 화면(진척도 애니메이션)에 넘길 데이터 — 이번 런으로 오른 경험치와 넘긴 레벨들, 레벨별 해금.
export interface RunProgress {
  gained: number; // 이번 런 적립 경험치
  beforeXp: number;
  afterXp: number;
  beforeLevel: number;
  afterLevel: number;
  // 넘긴 각 레벨(beforeLevel+1 … afterLevel)과 거기서 열린 티어(레벨별 하이라이트용).
  levelUps: { level: number; unlocks: UnlockTier[] }[];
}

/** 런 완료 기록 — 성적만큼 메타 경험치 적립 + 정복 갱신. 진척도(경험치·레벨·레벨별 해금)를 반환(종료 화면용). */
export function recordRunComplete(inRunLevel: number, era: number, conquered: boolean): RunProgress {
  const s = readState();
  const beforeXp = s.metaXp;
  const beforeLevel = metaLevel(beforeXp);
  const gained = runMetaXp(inRunLevel, era, conquered);
  s.metaXp = beforeXp + gained;
  if (conquered) s.conquered = true;
  writeState(s);
  const afterLevel = metaLevel(s.metaXp);
  const levelUps: { level: number; unlocks: UnlockTier[] }[] = [];
  for (let lv = beforeLevel + 1; lv <= afterLevel; lv++) {
    levelUps.push({ level: lv, unlocks: UNLOCK_TIERS.filter((t) => t.atLevel === lv) });
  }
  return { gained, beforeXp, afterXp: s.metaXp, beforeLevel, afterLevel, levelUps };
}

/** 디버그 전용 — 메타 레벨을 그 레벨 시작 경험치로 바로 세팅(레벨·리롤 해금 즉시 테스트). */
export function debugSetMetaLevel(level: number): void {
  const s = readState();
  s.metaXp = xpForLevelStart(level);
  writeState(s);
}

/** 디버그 전용 — 저장된 진행도를 전부 지운다(메타 경험치·정복 + 챔피언 명예의 전당). 첫 플레이 상태로. */
export function debugResetProgress(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CHAMPION_KEY);
  } catch {
    // 접근 실패면 조용히 무시(플레이는 계속된다)
  }
}

/** 디버그 전용 — 메타 경험치를 더하고 진척도를 반환(종료 화면 애니메이션을 반복 없이 재생). */
export function debugGrantMetaXp(amount: number): RunProgress {
  const s = readState();
  const beforeXp = s.metaXp;
  const beforeLevel = metaLevel(beforeXp);
  s.metaXp = beforeXp + Math.max(0, Math.floor(amount));
  writeState(s);
  const afterLevel = metaLevel(s.metaXp);
  const levelUps: { level: number; unlocks: UnlockTier[] }[] = [];
  for (let lv = beforeLevel + 1; lv <= afterLevel; lv++) {
    levelUps.push({ level: lv, unlocks: UNLOCK_TIERS.filter((t) => t.atLevel === lv) });
  }
  return { gained: s.metaXp - beforeXp, beforeXp, afterXp: s.metaXp, beforeLevel, afterLevel, levelUps };
}
