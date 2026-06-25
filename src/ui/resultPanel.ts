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
    // 본문은 빈 줄(\n\n)로 나뉜 문단들. 폰에서 "왜 졌나"가 또렷하게 읽히도록 문단별로 나눠 그린다.
    summary.replaceChildren();
    const blocks = text.split("\n\n");
    blocks.forEach((block, i) => {
      const p = document.createElement("div");
      p.textContent = block;
      if (i > 0) p.style.marginTop = "10px";
      if (block.startsWith("사망 원인")) {
        p.style.color = "#ffba8a"; // 사망 원인 줄은 눈에 띄게
        p.style.fontWeight = "600";
      }
      summary.appendChild(p);
    });
    root.style.display = "block";
  };

  const hide = (): void => {
    root.style.display = "none";
  };

  return { show, hide };
}
