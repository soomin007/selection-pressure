// 결과 UI — 런 종료(승리/멸종) 화면 + 새 런 버튼. 캔버스 위 HTML 오버레이.
// 사망 원인 문단은 텍스트 대신 비례 막대로 그린다 — "무엇이 내 종을 죽였나"가 폰에서 한눈에 읽히게(§7).

import { ensurePanelStyles } from "@/ui/panelStyles";
import { parseDeathLine, type DeathRow } from "@/game/runReport";

// 사망 원인별 색 — 게임 화면의 시각 언어와 맞춘다(추위=파랑/폭염·잡아먹힘=빨강 계열/보스=보라 등).
const DEATH_COLOR: Record<string, string> = {
  추위: "#5a8cff",
  폭염: "#ff6a3a",
  굶음: "#c9a23a",
  잡아먹힘: "#e0604a",
  보스: "#c060e0",
  노화: "#7aa86a",
};

export interface ResultPanel {
  show: (win: boolean, summary: string, canContinue: boolean) => void;
  hide: () => void;
}

// onNewRun = 완전히 새 종으로 다시 시작. onContinue = 승리 후 "다음 시대로"(성장 유지, 위협 강화).
export function createResultPanel(onNewRun: () => void, onContinue: () => void): ResultPanel {
  ensurePanelStyles();

  const root = document.createElement("div");
  root.className = "ui-root ui-result";
  root.style.display = "none";

  const heading = document.createElement("div");
  heading.className = "ui-result-heading";

  const summary = document.createElement("div");
  summary.className = "ui-result-summary";

  // 승리 후에만 뜨는 주 버튼 — 성장을 이어 더 험한 다음 시대로.
  const continueBtn = document.createElement("button");
  continueBtn.className = "ui-btn-primary";
  continueBtn.textContent = "다음 시대로 →";
  continueBtn.addEventListener("click", onContinue);

  // 새 종으로 다시 시작(패배 시 유일한 버튼, 승리 시 보조 버튼).
  const newRunBtn = document.createElement("button");
  newRunBtn.className = "ui-btn-primary";
  newRunBtn.textContent = "새 런 시작";
  newRunBtn.addEventListener("click", onNewRun);

  root.appendChild(heading);
  root.appendChild(summary);
  root.appendChild(continueBtn);
  root.appendChild(newRunBtn);
  document.body.appendChild(root);

  const show = (win: boolean, text: string, canContinue: boolean): void => {
    heading.textContent = win ? "승리" : "멸종";
    heading.style.color = win ? "#6cc24a" : "#e0604a";
    // 본문은 빈 줄(\n\n)로 나뉜 문단들. 사망 원인 문단은 막대로, 나머지는 텍스트로 그린다.
    summary.replaceChildren();
    const blocks = text.split("\n\n");
    blocks.forEach((block, i) => {
      const rows = parseDeathLine(block);
      const el = rows.length > 0 ? deathBars(rows) : textBlock(block);
      if (i > 0) el.style.marginTop = "12px";
      summary.appendChild(el);
    });
    // 승리 && 이어갈 수 있으면 "다음 시대로"를 주 버튼으로, "새 런"은 보조(작고 은은하게).
    continueBtn.style.display = win && canContinue ? "block" : "none";
    newRunBtn.textContent = win && canContinue ? "여기서 마치고 새 종으로" : "새 런 시작";
    newRunBtn.style.opacity = win && canContinue ? "0.7" : "1";
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
  title.style.cssText = "color:#ffba8a; font-weight:600; margin-bottom:6px;";
  wrap.appendChild(title);

  const max = Math.max(1, ...rows.map((r) => r.count));
  for (const r of rows) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex; align-items:center; gap:8px; margin-top:5px;";

    const label = document.createElement("span");
    label.textContent = r.label;
    label.style.cssText = "width:62px; flex:none; font-size:13px; color:#b6bdca;";

    const track = document.createElement("span");
    track.style.cssText =
      "flex:1; height:11px; background:#222a38; border-radius:6px; overflow:hidden;";
    const fill = document.createElement("span");
    const pct = Math.round((r.count / max) * 100);
    fill.style.cssText =
      `display:block; height:100%; width:${pct}%; border-radius:6px; ` +
      `background:${DEATH_COLOR[r.label] ?? "#8a93a6"};`;
    track.appendChild(fill);

    const num = document.createElement("span");
    num.textContent = String(r.count);
    num.style.cssText =
      "width:34px; flex:none; text-align:right; font-size:13px; font-variant-numeric:tabular-nums;";

    row.append(label, track, num);
    wrap.appendChild(row);
  }
  return wrap;
}
