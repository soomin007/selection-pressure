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
  // 해금 하이라이트는 직전 진척도 화면(levelUpScreen)이 담당 — 여기선 결과 요약 + 다음 행동만.
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

  // 승리 후에만 뜨는 주 버튼 — 성장을 이어 더 험한 다음 시대로. 크고 밝게 강조(한눈에 "이걸 눌러라").
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "다음 시대로 →";
  continueBtn.style.cssText =
    "display:block; width:100%; margin:18px 0 0; padding:16px; border:none; border-radius:14px;" +
    "background:linear-gradient(180deg,#7de06a,#4fb43a); color:#08210a; font-size:18px; font-weight:800;" +
    "cursor:pointer; box-shadow:0 4px 18px rgba(90,200,80,0.45); letter-spacing:0.3px;";
  continueBtn.addEventListener("click", onContinue);

  // 새 종으로 다시 시작 — 승리 시엔 보조(작고 은은한 테두리 버튼), 패배 시엔 유일한 주 버튼.
  const newRunBtn = document.createElement("button");
  newRunBtn.textContent = "새 혈통으로 시작";
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
    // 승리 && 이어갈 수 있으면 "다음 시대로"를 크고 밝은 주 버튼으로, "새 런"은 작고 은은한 보조로 분리한다.
    const emphasize = win && canContinue;
    continueBtn.style.display = emphasize ? "block" : "none";
    if (emphasize) {
      // 보조 버튼 — 테두리만 있는 은은한 스타일 + 위 여백으로 주 버튼과 확실히 떨어뜨린다.
      newRunBtn.textContent = "여기서 마치고 새 혈통으로";
      newRunBtn.style.cssText =
        "display:block; width:100%; margin:12px 0 0; padding:11px; border:1px solid #3a4658;" +
        "border-radius:12px; background:transparent; color:#8a93a6; font-size:13px; font-weight:600; cursor:pointer;";
    } else {
      // 패배 — 새 런이 유일한 주 버튼(밝게).
      newRunBtn.textContent = "새 혈통으로 시작";
      newRunBtn.style.cssText =
        "display:block; width:100%; margin:18px 0 0; padding:14px; border:none; border-radius:14px;" +
        "background:linear-gradient(180deg,#7db0e0,#4f84b4); color:#08161f; font-size:16px; font-weight:800; cursor:pointer;";
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
