// 결과 UI — 런 종료(승리/멸종) 화면 + 새 런 버튼. 캔버스 위 HTML 오버레이.

import { ensurePanelStyles } from "@/ui/panelStyles";

export interface ResultPanel {
  show: (win: boolean, summary: string) => void;
  hide: () => void;
}

export function createResultPanel(onNewRun: () => void): ResultPanel {
  ensurePanelStyles();

  const root = document.createElement("div");
  root.className = "ui-root ui-result";
  root.style.display = "none";

  const heading = document.createElement("div");
  heading.className = "ui-result-heading";

  const summary = document.createElement("div");
  summary.className = "ui-result-summary";

  const button = document.createElement("button");
  button.className = "ui-btn-primary";
  button.textContent = "새 런 시작";
  button.addEventListener("click", onNewRun);

  root.appendChild(heading);
  root.appendChild(summary);
  root.appendChild(button);
  document.body.appendChild(root);

  const show = (win: boolean, text: string): void => {
    heading.textContent = win ? "승리" : "멸종";
    heading.style.color = win ? "#6cc24a" : "#e0604a";
    summary.textContent = text;
    root.style.display = "block";
  };

  const hide = (): void => {
    root.style.display = "none";
  };

  return { show, hide };
}
