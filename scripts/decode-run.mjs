// 판 분석 코드를 사람이 읽는 표로 푼다.
//
// 왜 있나: 사용자가 폰에서 한 판을 마치고 코드 한 줄을 보내면, 나(또는 사람)가 그 판을 **추측 없이**
// 들여다볼 수 있어야 한다. 특히 **드래프트마다 「후보 세 장(등급 포함) → 고른 것」** 이 보이는 것이
// 이 기능의 핵심 쓸모다 — 2026-08-08 에 「아주 귀함이 계속 뜬다」는 제보를 시드 수십 개 돌려
// 추정으로 쫓았는데, 코드가 있으면 그 판을 바로 본다.
//
// 사용:
//   node scripts/decode-run.mjs SP1-AbCd...
//   node scripts/decode-run.mjs --file code.txt
//   type code.txt | node scripts/decode-run.mjs
//   옵션: --json (표 대신 원본 구조를 JSON 으로)
//
// 카드 이름·등급·범주 이름은 **게임 코드에서 직접** 읽는다(vite 로 TS 를 그대로 로드) · 표를 여기
// 베껴 두면 카드가 바뀌는 순간 조용히 거짓말을 한다.

import { readFileSync } from "node:fs";
import { createServer } from "vite";

const args = process.argv.slice(2);
const wantJson = args.includes("--json");

function readCode() {
  const fileFlag = args.findIndex((a) => a === "--file");
  if (fileFlag >= 0 && args[fileFlag + 1]) return readFileSync(args[fileFlag + 1], "utf8");
  const inline = args.find((a) => !a.startsWith("--"));
  if (inline) return inline;
  try {
    return readFileSync(0, "utf8"); // 표준 입력(파이프)
  } catch {
    return "";
  }
}

const raw = readCode().trim();
if (raw === "") {
  console.error("코드를 넣어 주세요: node scripts/decode-run.mjs SP1-...  (또는 --file <경로>)");
  process.exit(1);
}

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const runCodeMod = await server.ssrLoadModule("/src/game/runCode.ts");
const cardsMod = await server.ssrLoadModule("/src/game/cards.ts");
const tiersMod = await server.ssrLoadModule("/src/sim/tiers.ts");
const bossMod = await server.ssrLoadModule("/src/sim/boss.ts");
const mapMod = await server.ssrLoadModule("/src/sim/mapType.ts");
const configMod = await server.ssrLoadModule("/src/game/config.ts");

const { decodeRunCode, cardByCode, DRAFT_SKIPPED, DRAFT_REROLLED, DEATH_ORDER } = runCodeMod;
const { cardSummary } = cardsMod;
const { CATEGORY_LABELS, KEY_LABELS, TIER_ROMAN, tierOf } = tiersMod;
const { bossName } = bossMod;
const { MAP_KINDS } = mapMod;
const { onboardingStep } = configMod;

const decoded = decodeRunCode(raw);
if (!decoded.ok) {
  console.error(`읽지 못했습니다 · ${decoded.error}`);
  await server.close();
  process.exit(2);
}
const data = decoded.data;

if (wantJson) {
  console.log(JSON.stringify(data, null, 2));
  await server.close();
  process.exit(0);
}

// ── 표시용 이름표 (게임 코드가 안 내주는 것만 · 전부 화면 문구가 아니라 분석 표의 이름이다) ──
const RARITY_LABEL = {
  common: "흔함",
  uncommon: "드묾",
  rare: "귀함",
  epic: "아주귀함",
  legendary: "전설",
};
const EXTINCTION_LABEL = { cold: "혹독한 추위", famine: "대가뭄", heat: "폭염", plague: "대역병" };
// 게임 어휘와 함께 간다(2026-08-12 [사용자] 어휘 지시 · 시험/합격은 학사 어휘라 금지 → 시련/넘음).
const TRIAL_LABEL = {
  hunt: "사냥",
  feed: "먹이",
  birth: "새끼",
  pop: "무리",
  hold: "표시된 자리",
  mark: "금빛 짐승 잡기",
};
const DRAFT_KIND_LABEL = { preset: "시작 갈래", level: "레벨업", era: "시대 보상" };
const END_LABEL = {
  conquer: "정복(최종 승리)",
  eraWin: "시대 넘김",
  embers: "패배 · 불씨 꺼짐",
  extinct: "패배 · 멸종(0마리)",
  gate: "패배 · 관문 미달",
};
const DEATH_LABEL = {
  starve: "굶음",
  cold: "추위",
  heat: "폭염",
  age: "노화",
  boss: "보스",
  predation: "잡아먹힘",
  plague: "역병",
  venom: "중독",
  wound: "부상",
};
const STAGE_LABEL = { forage: "채집", boss: "보스", extinction: "대멸종" };

const out = [];
const line = (s = "") => out.push(s);
const rule = () => line("─".repeat(64));

// ── 머리말 ──
const h = data.header;
line(`판 분석 코드 SP${data.schema} · 게놈 v${data.genomeVersion} · 카드 풀 지문 ${data.poolDigest.toString(16).padStart(4, "0")}`);
for (const w of decoded.warnings) line(`⚠ ${w}`);
rule();
line(`시드          ${h.seed}     (재현: ?seed=${h.seed})`);
line(`뽑힌 세계     ${MAP_KINDS[h.mapType]?.name ?? h.mapType}`);
line(`메타          레벨 ${h.metaLevel} · 끝낸 런 ${h.runsDone} · ${h.everConquered ? "정복 경험 있음" : "정복 경험 없음"} · 리롤 ${h.rerollUnlocked ? "열림" : "잠김"}`);
line(`온보딩 진도   시대 0 에서 ${onboardingStep(h.runsDone, 0)} · 시대 ${data.summary.era + 1} 에서 ${onboardingStep(h.runsDone, data.summary.era)}`);
line(`조종          ${h.leadEnabled ? "켬" : "끔(관전)"} · 은근한 보정 ${h.assistEnabled ? "켬" : "끔"}`);
line(`챔피언        ${h.champions}마리 ${h.champions > 0 ? "(게놈은 코드에 없다 · 그만큼 완전 재현이 아니다)" : ""}`);

// ── 흐름 ──
rule();
line("[흐름] 시대 · 드래프트(후보 전부) · 방울 구입 · 단계 결과");
rule();

let era = 0;
let draftNo = 0;
let stageNo = 0;
line(`◆ 시대 ${era + 1}`);
for (const e of data.entries) {
  if (e.t === "era") {
    era = e.era;
    stageNo = 0;
    line("");
    line(`◆ 시대 ${era + 1}`);
    continue;
  }
  if (e.t === "draft") {
    draftNo += 1;
    // 「강화 ×N」은 **v8 이하의 것**이다 — 그때는 시대 보상이 뽑은 카드의 도장을 곱했다.
    // v9 부터 카드가 도장을 안 주므로 곱할 것이 없고, 게임도 늘 1 을 적는다(`game.recordDraft`).
    // 칸은 옛 코드를 계속 읽으려고 남아 있으니, 1 이 아닌 값이 보이면 **옛 빌드의 판**이라고 말한다.
    const boost = e.boost > 1 ? ` · 옛 빌드의 강화 ×${e.boost}` : "";
    let tail = "";
    if (e.outcome === DRAFT_REROLLED) tail = "  → 다시 뽑기로 버림";
    else if (e.outcome === DRAFT_SKIPPED) tail = "  → 건너뜀(새끼)";
    else if (e.outcome >= e.cards.length) tail = "  → 고른 것 없음";
    line(`  드래프트 ${draftNo} · ${DRAFT_KIND_LABEL[e.kind] ?? e.kind} · 레벨 ${e.level}${boost}${tail}`);
    e.cards.forEach((id, i) => {
      const card = cardByCode(indexOfId(id));
      const mark = i === e.outcome ? "✓" : " ";
      const rarity = card ? (RARITY_LABEL[card.rarity] ?? card.rarity) : "?";
      const name = card ? card.name : id;
      const eff = card ? cardSummary(card) : "";
      // ⚠ 효과 줄에 배수를 곱해 적지 않는다. v9 의 효과 줄은 「밤에 보는 거리 ×1.45」 같은 특성
      //   문장이라, 뒤에 「×2」를 붙이면 그 자체가 없는 규칙을 지어내는 거짓말이 된다.
      line(`     ${mark} [${rarity.padEnd(4, " ")}] ${name}${eff ? `  (${eff})` : ""}`);
    });
    continue;
  }
  if (e.t === "buy") {
    line(`  방울 구입 · ${CATEGORY_LABELS[e.cat]} ${TIER_ROMAN[e.tier]}단  (방울 ${e.cost}개)`);
    continue;
  }
  if (e.t === "stage") {
    stageNo += 1;
    const bits = [`  단계 ${stageNo} · ${STAGE_LABEL[e.kind] ?? e.kind}`];
    if (e.boss) bits.push(`위협 ${bossName(e.boss)}${e.defeated ? " 격퇴" : e.passed ? " 버팀" : ""}`);
    if (e.extinction) bits.push(`${EXTINCTION_LABEL[e.extinction] ?? e.extinction}`);
    if (e.trial) {
      const t = e.trial;
      const verdict = t.passed ? (t.overachieved ? "크게 넘음(불씨 +1)" : "넘음") : "못 넘음(불씨 −1)";
      bits.push(`시련 ${TRIAL_LABEL[t.kind] ?? t.kind} ${t.progress}/${t.target} ${verdict}`);
    }
    bits.push(`끝 개체 ${e.pop}`);
    if (!e.passed) bits.push("관문 실패");
    line(bits.join(" · "));
    continue;
  }
  if (e.t === "end") {
    line(`  ▣ ${END_LABEL[e.reason] ?? e.reason} · 시대 ${e.era + 1} · 레벨 ${e.level}`);
  }
}

// ── 관측 요약 ──
const s = data.summary;
rule();
line("[그래서 어떻게 됐나]");
rule();
line(`도달          시대 ${s.era + 1} · 레벨 ${s.level} · ${s.durationSec}초 · 다시 뽑기 ${s.rerollsUsed}회`);
line(`개체 수       최대 ${s.popMax} · (살아 있던)최소 ${s.popMin} · 끝 ${s.popEnd} · 판 최고 ${s.popPeak}`);
const pipLine = Object.keys(s.pips)
  .map((c) => `${CATEGORY_LABELS[c]} ${TIER_ROMAN[tierOf(s.pips[c])] || "0"}단(도장 ${s.pips[c]})`)
  .join(" · ");
line(`범주          ${pipLine}`);
line(`열쇠          ${s.keys.length > 0 ? s.keys.map((k) => KEY_LABELS[k] ?? k).join(" · ") : "없음"}`);
line(`방울 수지     번 것 ${s.geneEarned} · 쓴 것 ${s.geneSpent} · 남은 것 ${s.geneLeft}`);
const deadRows = DEATH_ORDER.filter((c) => s.deaths[c] > 0)
  .sort((a, b) => s.deaths[b] - s.deaths[a])
  .map((c) => `${DEATH_LABEL[c] ?? c} ${s.deaths[c]}`);
line(`사망 원인     ${deadRows.length > 0 ? deadRows.join(" · ") : "없음"}  (마지막 세계 기준)`);
line("");
line(`코드 길이     ${raw.replace(/\s+/g, "").length}자`);

console.log(out.join("\n"));
await server.close();

/** 디코더가 되돌려 준 카드 id 를 다시 번호로(표시용 이름·등급을 얻기 위해). */
function indexOfId(id) {
  const m = /^\?(-?\d+)$/.exec(id);
  if (m) return Number(m[1]);
  return runCodeMod.cardCodeIndex(id);
}
