// 결과 UI — 런 종료(승리/멸종) 화면 + 새 런 버튼. 캔버스 위 HTML 오버레이.
// 사망 원인 문단은 텍스트 대신 비례 막대로 그린다 — "무엇이 내 종을 죽였나"가 폰에서 한눈에 읽히게(§7).

import { ensurePanelStyles } from "@/ui/panelStyles";
import { createCosmeticPicker } from "@/ui/cosmeticPicker";
import { parseDeathLine, type DeathRow } from "@/game/runReport";

// 사망 원인별 색 — 3a 의미 색 팔레트와 맞춘다(추위=물빛/폭염=사냥빛/굶음=호박/잡아먹힘·보스/노화=중립).
const DEATH_COLOR: Record<string, string> = {
  추위: "#5AB0E2",
  폭염: "#F2903A",
  굶음: "#F5C33B",
  잡아먹힘: "#E85C43",
  보스: "#B98CE0",
  노화: "#C6B7A2",
};

export interface ResultPanel {
  // 해금 하이라이트는 직전 진척도 화면(levelUpScreen)이 담당 — 여기선 결과 요약 + 다음 행동만.
  show: (win: boolean, summary: string, canContinue: boolean) => void;
  hide: () => void;
}

// onNewRun = 완전히 새 종으로 다시 시작. onContinue = 승리 후 "다음 시대로"(성장 유지, 위협 강화).
// onReport = "이 혈통의 기록" 보고서 화면 열기(연대기 + 형질 추이).
// onCosmeticChange = 꾸밈을 바꾼 직후(다음 런/배경 렌더에 즉시 반영). onLadder = 해금 사다리 열기.
export function createResultPanel(
  onNewRun: () => void,
  onContinue: () => void,
  onReport: () => void,
  onCosmeticChange: () => void,
  onLadder: () => void,
): ResultPanel {
  ensurePanelStyles();

  const root = document.createElement("div");
  root.className = "ui-root ui-result";
  root.style.display = "none";

  const heading = document.createElement("div");
  heading.className = "ui-result-heading";

  const summary = document.createElement("div");
  summary.className = "ui-result-summary";

  // 다음 판 준비 — 새 런 시작 전에 꾸밈을 바로 바꾸고(로비 우회 제거, 사용자 지적) 해금도 확인한다.
  const prep = document.createElement("div");
  prep.style.cssText =
    "display:flex; flex-direction:column; align-items:center; gap:10px; margin-top:18px;" +
    "padding-top:16px; border-top:1px solid var(--line);";
  const cosmetics = createCosmeticPicker(onCosmeticChange);
  const ladderBtn = document.createElement("button");
  ladderBtn.textContent = "진화 갈래 보기";
  ladderBtn.style.cssText =
    "padding:6px 4px 3px; border:0; background:transparent; color:var(--ink);" +
    "font-family:var(--font-body); font-size:13px; cursor:pointer; border-bottom:1.5px solid var(--amber);";
  ladderBtn.addEventListener("click", onLadder);
  prep.append(cosmetics.el, ladderBtn);

  // 승리 후에만 뜨는 주 버튼 — 성장을 이어 더 험한 다음 시대로. 입체 키 버튼(한눈에 "이걸 눌러라").
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "다음 시대로 →";
  continueBtn.className = "ui-btn-primary";
  continueBtn.style.marginTop = "18px";
  continueBtn.style.display = "none";
  continueBtn.addEventListener("click", onContinue);

  // 이 혈통의 기록(보고서) 열기 — 승패와 무관하게 늘 있는 자취. 은은한 보조 버튼(주 행동은 아래 두 개).
  const reportBtn = document.createElement("button");
  reportBtn.textContent = "이 혈통의 기록 보기";
  reportBtn.style.cssText =
    "display:block; width:100%; margin:14px 0 0; padding:11px; border:1px solid var(--line);" +
    "border-radius:var(--r-btn); background:rgba(255,255,255,0.04); color:var(--sub);" +
    "font-family:var(--font-body); font-size:14px; cursor:pointer;";
  reportBtn.addEventListener("click", onReport);

  // 새 종으로 다시 시작 — 승리 시엔 보조(작고 은은한 테두리 버튼), 패배 시엔 유일한 주 버튼.
  const newRunBtn = document.createElement("button");
  newRunBtn.textContent = "새 혈통으로 시작";
  newRunBtn.addEventListener("click", onNewRun);

  root.appendChild(heading);
  root.appendChild(summary);
  root.appendChild(reportBtn);
  root.appendChild(prep);
  root.appendChild(continueBtn);
  root.appendChild(newRunBtn);
  document.body.appendChild(root);

  const show = (win: boolean, text: string, canContinue: boolean): void => {
    cosmetics.refresh(); // 그동안 딴 꾸밈이 바로 보이게(하나도 없으면 스스로 숨는다)
    heading.textContent = win ? "승리" : "멸종";
    heading.style.color = win ? "var(--lime)" : "var(--red)";
    // 본문은 빈 줄(\n\n)로 나뉜 문단들. 사망 원인 문단은 막대로, 나머지는 텍스트로 그린다.
    summary.replaceChildren();
    const blocks = text.split("\n\n");
    blocks.forEach((block, i) => {
      const rows = parseDeathLine(block);
      const el = rows.length > 0 ? deathBars(rows) : textBlock(block);
      if (i > 0) el.style.marginTop = "12px";
      summary.appendChild(el);
    });
    // 승리 && 이어갈 수 있으면 "다음 시대로"를 크고 밝은 주 버튼으로, "새 런"은 작고 은은한 보조로 분리한다.
    const emphasize = win && canContinue;
    continueBtn.style.display = emphasize ? "block" : "none";
    if (emphasize) {
      // 보조 버튼 — 은은한 텍스트 버튼 + 위 여백으로 주 버튼(다음 시대로)과 확실히 떨어뜨린다.
      newRunBtn.className = "";
      newRunBtn.textContent = "여기서 마치고 새 혈통으로";
      newRunBtn.style.cssText =
        "display:block; width:100%; margin:12px 0 0; padding:11px; border:0;" +
        "background:transparent; color:var(--faint); font-family:var(--font-body); font-size:13px; cursor:pointer;";
    } else {
      // 패배 — 새 런이 유일한 주 버튼(입체 키).
      newRunBtn.className = "ui-btn-primary";
      newRunBtn.textContent = "새 혈통으로 시작";
      newRunBtn.style.cssText = "";
      newRunBtn.style.marginTop = "18px";
    }
    root.style.display = "block";
  };

  const hide = (): void => {
    root.style.display = "none";
  };

  return { show, hide };
}

/** 일반 문단 한 줄. */
function textBlock(text: string): HTMLDivElement {
  const p = document.createElement("div");
  p.textContent = text;
  return p;
}

/** 사망 원인 막대 묶음 — 라벨 + 비례 막대(색=원인) + 수. 많이 죽은 원인이 길고 또렷하다. */
function deathBars(rows: DeathRow[]): HTMLDivElement {
  const wrap = document.createElement("div");

  const title = document.createElement("div");
  title.textContent = "사망 원인";
  title.style.cssText = "color:var(--red); font-family:var(--font-title); font-size:14px; margin-bottom:7px;";
  wrap.appendChild(title);

  const max = Math.max(1, ...rows.map((r) => r.count));
  for (const r of rows) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex; align-items:center; gap:8px; margin-top:5px;";

    const label = document.createElement("span");
    label.textContent = r.label;
    label.style.cssText = "width:62px; flex:none; font-size:13px; color:var(--sub); font-family:var(--font-body);";

    const track = document.createElement("span");
    track.style.cssText =
      "flex:1; height:11px; background:rgba(255,255,255,0.06); border-radius:6px; overflow:hidden;";
    const fill = document.createElement("span");
    const pct = Math.round((r.count / max) * 100);
    fill.style.cssText =
      `display:block; height:100%; width:${pct}%; border-radius:6px; ` +
      `background:${DEATH_COLOR[r.label] ?? "#8a93a6"};`;
    track.appendChild(fill);

    const num = document.createElement("span");
    num.textContent = String(r.count);
    num.style.cssText =
      "width:34px; flex:none; text-align:right; font-size:13px; color:var(--ink);" +
      "font-family:var(--font-mono); font-variant-numeric:tabular-nums;";

    row.append(label, track, num);
    wrap.appendChild(row);
  }
  return wrap;
}
