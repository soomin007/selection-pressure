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

export interface MetaState {
  runsCompleted: number; // 끝까지(정복/멸종) 마친 런 수 — 언락 티어의 기준
  conquered: boolean; // 시대 상한(정복) 달성 여부(표시용)
}

// 언락 티어 — runsCompleted 가 atRuns 에 도달하면 그 목록이 열린다. 특수 갈래·특화 카드를 순차로.
export interface UnlockTier {
  atRuns: number;
  presetIds: string[];
  cardIds: string[];
  label: string; // 해금 알림 문구
}
export const UNLOCK_TIERS: readonly UnlockTier[] = [
  { atRuns: 1, presetIds: ["preset_sea"], cardIds: ["fins", "webbed"], label: "바다 개척자 · 헤엄 카드" },
  { atRuns: 2, presetIds: ["preset_sky"], cardIds: ["wings", "strong_wings"], label: "하늘 개척자 · 날개 카드" },
  { atRuns: 3, presetIds: ["preset_ranged"], cardIds: ["long_horn", "spit"], label: "원거리 사냥꾼 · 원거리 카드" },
  { atRuns: 4, presetIds: ["preset_venom"], cardIds: ["venom_fang", "venom_gland"], label: "독 살갗 · 독 카드" },
  { atRuns: 5, presetIds: [], cardIds: ["echo", "bat_ear"], label: "초음파 카드" },
];

// 티어로 잠갔다 여는 대상 전체(잠금 후보). 이 집합에 없는 id 는 처음부터 항상 열려 있다.
const LOCKABLE_PRESETS = new Set(UNLOCK_TIERS.flatMap((t) => t.presetIds));
const LOCKABLE_CARDS = new Set(UNLOCK_TIERS.flatMap((t) => t.cardIds));

function readState(): MetaState {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const p = JSON.parse(raw) as Partial<MetaState>;
      return { runsCompleted: Math.max(0, Math.trunc(p.runsCompleted ?? 0)), conquered: !!p.conquered };
    }
  } catch {
    // 파싱/접근 실패(사생활 모드 등) → 첫 플레이로 취급
  }
  return { runsCompleted: 0, conquered: false };
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

/** 프리셋 id 가 지금 열려 있는가 — 잠금 후보가 아니면 항상 열림, 후보면 도달 티어까지 열림. */
export function isPresetUnlocked(id: string, runs: number): boolean {
  if (!LOCKABLE_PRESETS.has(id)) return true;
  return UNLOCK_TIERS.some((t) => t.atRuns <= runs && t.presetIds.includes(id));
}

/** 카드 id 가 지금 열려 있는가 — 잠금 후보가 아니면 항상 열림, 후보면 도달 티어까지 열림. */
export function isCardUnlocked(id: string, runs: number): boolean {
  if (!LOCKABLE_CARDS.has(id)) return true;
  return UNLOCK_TIERS.some((t) => t.atRuns <= runs && t.cardIds.includes(id));
}

/** 런 완료 기록 — runsCompleted +1, 정복 여부 갱신. 이번에 새로 열린 티어들을 반환(해금 알림용). */
export function recordRunComplete(conquered: boolean): UnlockTier[] {
  const s = readState();
  const before = s.runsCompleted;
  s.runsCompleted = before + 1;
  if (conquered) s.conquered = true;
  writeState(s);
  // before < atRuns <= after 인 티어가 이번 런 완료로 열렸다.
  return UNLOCK_TIERS.filter((t) => t.atRuns > before && t.atRuns <= s.runsCompleted);
}
