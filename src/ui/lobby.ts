// 로비/타이틀 화면. 뒤에서는 배경 생태계가 잔잔히 돌아간다(Game 로비 단계).
// 도전 과제로 연 꾸밈을 여기서 하나 고른다(효과 없음 — 보이는 것만 바뀐다).

import { ensurePanelStyles } from "@/ui/panelStyles";
import {
  BODY_COSMETICS,
  COSMETICS,
  equipCosmetic,
  equippedCosmetic,
  unlockedCosmetics,
  type CosmeticId,
} from "@/game/achievements";

export interface Lobby {
  show: () => void;
  hide: () => void;
}

export function createLobby(onStart: () => void, onGlossary: () => void, onCosmetic: () => void): Lobby {
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

  // 대백과 열기(보조 버튼) — 투명 배경 + 호박빛 밑줄(핸드오프 §4 보조 버튼).
  const glossary = document.createElement("button");
  glossary.textContent = "대백과";
  glossary.style.cssText =
    "margin-top:8px; padding:6px 4px 3px; border:0; background:transparent;" +
    "color:var(--ink); font-family:var(--font-body); font-size:14px; cursor:pointer;" +
    "border-bottom:1.5px solid var(--amber);";
  glossary.addEventListener("click", onGlossary);

  const hint = document.createElement("div");
  hint.className = "lobby-hint";
  hint.textContent = "카드를 골라 형질을 키우고, 무리가 살아남는 것을 지켜보세요.";

  // 꾸밈 고르기 — 하나도 안 열렸으면 통째로 숨긴다(첫 판 화면을 안 어지럽힌다).
  const cosmeticRow = document.createElement("div");
  cosmeticRow.style.cssText =
    "display:none; flex-direction:column; align-items:center; gap:7px; margin-top:16px;";
  const cosmeticLabel = document.createElement("div");
  cosmeticLabel.textContent = "꾸밈 (효과 없음)";
  cosmeticLabel.style.cssText =
    "color:var(--faint); font-family:var(--font-mono); font-size:10.5px; letter-spacing:0.18em;";
  const chips = document.createElement("div");
  chips.style.cssText = "display:flex; flex-wrap:wrap; justify-content:center; gap:7px;";
  cosmeticRow.append(cosmeticLabel, chips);

  const refreshCosmetics = (): void => {
    const open = unlockedCosmetics().filter((c): c is CosmeticId => BODY_COSMETICS.includes(c));
    if (open.length === 0) {
      cosmeticRow.style.display = "none";
      return;
    }
    cosmeticRow.style.display = "flex";
    const current = equippedCosmetic();
    chips.replaceChildren();
    const add = (id: CosmeticId | null, text: string, title: string): void => {
      const b = document.createElement("button");
      b.textContent = text;
      b.title = title;
      const on = current === id;
      b.style.cssText =
        `border:1px solid ${on ? "rgba(143,209,79,0.55)" : "var(--line)"}; border-radius:999px;` +
        `background:${on ? "rgba(143,209,79,0.16)" : "var(--panelSolid)"};` +
        `color:${on ? "var(--lime)" : "var(--sub)"}; padding:6px 13px;` +
        "font-family:var(--font-body); font-size:12.5px; cursor:pointer;";
      b.addEventListener("click", () => {
        equipCosmetic(id);
        refreshCosmetics();
        onCosmetic(); // 배경 생태계에 즉시 반영 — 고른 걸 바로 본다
      });
      chips.appendChild(b);
    };
    add(null, "없음", "맨몸");
    for (const id of open) add(id, COSMETICS[id].name, COSMETICS[id].desc);
  };

  root.appendChild(title);
  root.appendChild(sub);
  root.appendChild(start);
  root.appendChild(glossary);
  root.appendChild(cosmeticRow);
  root.appendChild(hint);
  document.body.appendChild(root);

  return {
    show: () => {
      refreshCosmetics(); // 방금 딴 꾸밈이 바로 보이게 열 때마다 다시 읽는다
      root.style.display = "flex";
    },
    hide: () => {
      root.style.display = "none";
    },
  };
}
