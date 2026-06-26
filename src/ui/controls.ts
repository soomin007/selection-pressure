// 인게임 컨트롤. 우상단 멈춤/배속 버튼 + 멈춤 메뉴(이어하기/처음부터/로비로).
// 로비·결과 화면에서는 숨긴다.

import { ensurePanelStyles } from "@/ui/panelStyles";

export interface ControlsCallbacks {
  onPauseToggle: () => void;
  onSpeedCycle: () => void;
  onResume: () => void;
  onRestart: () => void;
  onLobby: () => void;
  onGlossary: () => void;
}

export interface Controls {
  setVisible: (v: boolean) => void;
  setPaused: (p: boolean) => void;
  setSpeed: (s: number) => void;
}

export function createControls(cb: ControlsCallbacks): Controls {
  ensurePanelStyles();

  const bar = document.createElement("div");
  bar.className = "controls-bar";
  bar.style.display = "none";

  const speedBtn = document.createElement("button");
  speedBtn.className = "ctrl-btn";
  speedBtn.textContent = "1x";
  speedBtn.addEventListener("click", cb.onSpeedCycle);

  const pauseBtn = document.createElement("button");
  pauseBtn.className = "ctrl-btn";
  pauseBtn.textContent = "⏸";
  pauseBtn.addEventListener("click", cb.onPauseToggle);

  bar.appendChild(speedBtn);
  bar.appendChild(pauseBtn);
  document.body.appendChild(bar);

  // 멈춤 메뉴
  const menu = document.createElement("div");
  menu.className = "pause-menu";
  menu.style.display = "none";

  const menuTitle = document.createElement("div");
  menuTitle.className = "pause-title";
  menuTitle.textContent = "멈춤";

  const resume = button("이어하기", "pause-btn primary", cb.onResume);
  const restart = button("처음부터", "pause-btn", cb.onRestart);
  const glossary = button("대백과", "pause-btn", cb.onGlossary);
  const lobby = button("로비로", "pause-btn", cb.onLobby);

  menu.appendChild(menuTitle);
  menu.appendChild(resume);
  menu.appendChild(restart);
  menu.appendChild(glossary);
  menu.appendChild(lobby);
  document.body.appendChild(menu);

  return {
    setVisible: (v) => {
      bar.style.display = v ? "flex" : "none";
      if (!v) menu.style.display = "none";
    },
    setPaused: (p) => {
      pauseBtn.textContent = p ? "▶" : "⏸";
      menu.style.display = p ? "flex" : "none";
    },
    setSpeed: (s) => {
      speedBtn.textContent = `${s}x`;
    },
  };
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
