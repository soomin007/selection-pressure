// 로비/타이틀 화면. 뒤에서는 배경 생태계가 잔잔히 돌아간다(Game 로비 단계).
// 도전 과제로 연 꾸밈을 여기서 하나 고른다(효과 없음 — 보이는 것만 바뀐다). 해금 사다리도 여기서 연다.

import { ensurePanelStyles } from "@/ui/panelStyles";
import { registerKeyLayer, keyChip } from "@/ui/keys";
import { createCosmeticPicker } from "@/ui/cosmeticPicker";

export interface Lobby {
  show: () => void;
  hide: () => void;
}

export function createLobby(
  onStart: () => void,
  onGlossary: () => void,
  onCosmetic: () => void,
  onLadder: () => void,
): Lobby {
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
  start.appendChild(keyChip("Enter"));
  start.addEventListener("click", onStart);

  // 보조 버튼 줄 — 대백과 + 해금 사다리(투명 배경 + 호박빛 밑줄, 핸드오프 §4 보조 버튼).
  const secondaryRow = document.createElement("div");
  secondaryRow.style.cssText = "display:flex; gap:18px; margin-top:8px;";
  const linkBtn = (text: string, cb: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText =
      "padding:6px 4px 3px; border:0; background:transparent;" +
      "color:var(--ink); font-family:var(--font-body); font-size:14px; cursor:pointer;" +
      "border-bottom:1.5px solid var(--amber);";
    b.addEventListener("click", cb);
    return b;
  };
  const glossaryBtn = linkBtn("대백과", onGlossary);
  glossaryBtn.appendChild(keyChip("G"));
  const ladderBtn = linkBtn("진화 갈래", onLadder);
  ladderBtn.appendChild(keyChip("L"));
  secondaryRow.append(glossaryBtn, ladderBtn);

  // 키보드 조작 — 로비가 보일 때만. 대백과·진화 갈래 오버레이가 열리면 그쪽(높은 우선순위)이 키를 가져간다.
  registerKeyLayer(
    5,
    () => root.style.display !== "none",
    (e) => {
      if (e.repeat) return false;
      switch (e.code) {
        case "Enter":
        case "NumpadEnter":
          onStart();
          return true;
        case "KeyG":
          onGlossary();
          return true;
        case "KeyL":
          onLadder();
          return true;
        default:
          return false;
      }
    },
  );

  const hint = document.createElement("div");
  hint.className = "lobby-hint";
  hint.textContent = "카드를 골라 형질을 키우고, 무리가 살아남는 것을 지켜보세요.";

  // 꾸밈 고르기 — 재사용 컴포넌트. 하나도 안 열렸으면 스스로 숨는다(첫 판 화면을 안 어지럽힌다).
  const cosmetics = createCosmeticPicker(onCosmetic);
  cosmetics.el.style.marginTop = "16px";

  root.append(title, sub, start, secondaryRow, cosmetics.el, hint);
  document.body.appendChild(root);

  return {
    show: () => {
      cosmetics.refresh(); // 방금 딴 꾸밈이 바로 보이게 열 때마다 다시 읽는다
      root.style.display = "flex";
    },
    hide: () => {
      root.style.display = "none";
    },
  };
}
