// 로비/타이틀 화면. 뒤에서는 배경 생태계가 잔잔히 돌아간다(Game 로비 단계).

import { ensurePanelStyles } from "@/ui/panelStyles";

export interface Lobby {
  show: () => void;
  hide: () => void;
}

export function createLobby(onStart: () => void): Lobby {
  ensurePanelStyles();

  const root = document.createElement("div");
  root.className = "lobby-root";

  const title = document.createElement("div");
  title.className = "lobby-title";
  title.textContent = "적자생존";

  const sub = document.createElement("div");
  sub.className = "lobby-sub";
  sub.textContent = "한 종을 길러 생태계의 정점에 올리세요.";

  const start = document.createElement("button");
  start.className = "lobby-start";
  start.textContent = "게임 시작";
  start.addEventListener("click", onStart);

  const hint = document.createElement("div");
  hint.className = "lobby-hint";
  hint.textContent = "카드를 골라 형질을 키우고, 무리가 살아남는 것을 지켜보세요.";

  root.appendChild(title);
  root.appendChild(sub);
  root.appendChild(start);
  root.appendChild(hint);
  document.body.appendChild(root);

  return {
    show: () => {
      root.style.display = "flex";
    },
    hide: () => {
      root.style.display = "none";
    },
  };
}
