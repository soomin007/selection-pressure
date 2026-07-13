// 인게임 컨트롤. 우상단 멈춤/배속 버튼 + 멈춤 메뉴(이어하기/처음부터/로비로).
// 로비·결과 화면에서는 숨긴다.

import { ensurePanelStyles } from "@/ui/panelStyles";
import { keyChip } from "@/ui/keys";

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
  speedBtn.title = "배속 바꾸기 (1·2·3)";
  speedBtn.addEventListener("click", cb.onSpeedCycle);

  const pauseBtn = document.createElement("button");
  pauseBtn.className = "ctrl-btn";
  pauseBtn.textContent = "⏸";
  pauseBtn.title = "멈춤/이어하기 (Space)";
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

  // 키 자체는 main.ts 의 관전·멈춤 키 레이어가 처리한다 — 여기 칩은 안내 표식.
  const resume = button("이어하기", "pause-btn primary", cb.onResume, "Space");
  const restart = button("처음부터", "pause-btn", cb.onRestart, "R");
  const glossary = button("대백과", "pause-btn", cb.onGlossary, "G");
  const lobby = button("로비로", "pause-btn", cb.onLobby, "Q");

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

function button(label: string, className: string, onClick: () => void, key?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = label;
  if (key !== undefined) b.appendChild(keyChip(key));
  b.addEventListener("click", onClick);
  return b;
}
