// 런 정산 텍스트 — "이 종은 어떤 종이었나" + 사망 원인 집계를 쉬운 한국어로 만든다.
// sim(World)은 죽음을 enum(DeathTally)으로만 센다. 사람이 읽는 한글 라벨/묘사는 게임 층인 여기서.
// UI 문구 규칙: 쉬운 말, 한자 약어 금지(사망 원인 ○ / 死因 ✕).

import type { Genome, Traits } from "@/sim/genome";
import type { DeathCause, DeathTally } from "@/sim/world";

/** 사망 원인 한글 라벨. */
const DEATH_LABELS: Record<DeathCause, string> = {
  predation: "잡아먹힘",
  boss: "보스",
  cold: "추위",
  heat: "폭염",
  starve: "굶음",
  age: "노화",
  plague: "역병",
};

/** 형질이 높을 때/낮을 때의 한 단어 묘사 (식성 diet 는 명사라 제외). */
type AdjKey = Exclude<keyof Traits, "diet">;
const HIGH_ADJ: Record<AdjKey, string> = {
  speed: "발이 빠른",
  attack: "사나운",
  vision: "눈이 밝은",
  herding: "무리 짓는",
  metabolism: "몸이 뜨거운",
  fertility: "번식이 왕성한",
  swimming: "헤엄치는",
};
const LOW_ADJ: Record<AdjKey, string> = {
  speed: "발이 느린",
  attack: "순한",
  vision: "눈이 어두운",
  herding: "혼자 다니는",
  metabolism: "몸이 차가운",
  fertility: "번식이 더딘",
  swimming: "뭍에만 사는",
};
const ADJ_KEYS: readonly AdjKey[] = [
  "speed",
  "attack",
  "vision",
  "herding",
  "metabolism",
  "fertility",
  "swimming",
];

const dietNoun = (diet: number): string =>
  diet < 35 ? "초식성" : diet > 70 ? "육식성" : "잡식성";

/** 게놈 → "이 종은 어떤 종이었나" 한 줄 묘사 (가장 두드러진 형질 1~2개 + 식성). */
export function describeSpecies(genome: Genome): string {
  const t = genome.traits;
  const scored = ADJ_KEYS.map((k) => ({ k, dev: t[k] - 50 })).sort(
    (a, b) => Math.abs(b.dev) - Math.abs(a.dev),
  );
  const adjs: string[] = [];
  for (const s of scored) {
    if (Math.abs(s.dev) < 18) break; // 50 근처면 특징 없음
    adjs.push(s.dev > 0 ? HIGH_ADJ[s.k] : LOW_ADJ[s.k]);
    if (adjs.length >= 2) break;
  }
  const noun = dietNoun(t.diet);
  return adjs.length > 0 ? `${adjs.join(" ")} ${noun}` : `균형 잡힌 ${noun}`;
}

/** 대사 → 한온 적응 한 줄 (왜 추위/폭염에 죽었는지 연결). 중간 대사면 빈 문자열. */
function climateNote(t: Traits): string {
  if (t.metabolism <= 35) return "대사가 낮아 추위에 약하고 더위에 강했습니다.";
  if (t.metabolism >= 65) return "대사가 높아 더위에 약하고 추위에 강했습니다.";
  return "";
}

/** 사망 원인 집계 → "추위 32 · 굶음 12" (많은 순). 죽음이 없으면 빈 문자열. */
export function formatDeaths(deaths: DeathTally): string {
  const rows = (Object.keys(DEATH_LABELS) as DeathCause[])
    .map((c) => ({ c, n: deaths[c] }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  return rows.map((r) => `${DEATH_LABELS[r.c]} ${r.n}`).join(" · ");
}

/** 사망 원인 문단을 식별하는 머리말. buildRunReport(포맷)과 parseDeathLine(역파싱)이 공유. */
export const DEATH_LINE_PREFIX = "사망 원인 — ";

export interface DeathRow {
  label: string;
  count: number;
}

/**
 * 결과 화면이 막대로 다시 그릴 수 있도록 사망 원인 문단을 행 목록으로 되돌린다.
 * (resultPanel 은 문자열만 받으므로, 포맷/역파싱을 이 파일 한곳에서 계약으로 묶어 둔다.)
 * 사망 원인 문단이 아니면 빈 배열.
 */
export function parseDeathLine(block: string): DeathRow[] {
  if (!block.startsWith(DEATH_LINE_PREFIX)) return [];
  const body = block.slice(DEATH_LINE_PREFIX.length);
  const rows: DeathRow[] = [];
  for (const seg of body.split(" · ")) {
    const sp = seg.lastIndexOf(" "); // 라벨엔 공백이 없으니 마지막 공백이 수와의 경계
    if (sp < 0) continue;
    const label = seg.slice(0, sp);
    const count = Number(seg.slice(sp + 1));
    if (label && Number.isFinite(count)) rows.push({ label, count });
  }
  return rows;
}

/**
 * 결과 화면 본문 텍스트를 만든다. 문단은 빈 줄(\n\n)로 구분 — resultPanel 이 또렷하게 나눠 그린다.
 *   1) 승패 한 줄(baseSummary)
 *   2) 이 종은 어떤 종이었나 + 한온 적응
 *   3) 사망 원인 — 많은 순
 */
export function buildRunReport(baseSummary: string, genome: Genome, deaths: DeathTally): string {
  const parts: string[] = [baseSummary];

  const note = climateNote(genome.traits);
  const speciesLine = `이 종은 ${describeSpecies(genome)}이었습니다.${note ? " " + note : ""}`;
  parts.push(speciesLine);

  const dead = formatDeaths(deaths);
  if (dead) parts.push(`${DEATH_LINE_PREFIX}${dead}`);

  return parts.join("\n\n");
}
