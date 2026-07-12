// 꾸밈 고르기 — 로비와 결과 화면이 공유하는 재사용 컴포넌트. 도전 과제로 연 꾸밈을 칩으로 고른다
// (효과 없음 — 보이는 것만 바뀐다). 하나도 안 열렸으면 통째로 숨어 첫 화면을 안 어지럽힌다.
//
// 로비에만 있던 인라인 로직을 뽑아 결과 화면에서도 그대로 쓴다 — "새 런 시작 전에 꾸민다"를 로비 우회
// 없이 바로 할 수 있게(사용자 지적). 한 곳에서 관리해 두 화면의 꾸밈 UI 가 어긋나지 않는다.

import {
  BODY_COSMETICS,
  COSMETICS,
  equipCosmetic,
  equippedCosmetic,
  unlockedCosmetics,
  type CosmeticId,
} from "@/game/achievements";

export interface CosmeticPicker {
  /** 화면에 붙일 루트 요소(열린 꾸밈이 없으면 스스로 display:none). */
  el: HTMLElement;
  /** 열린 목록·선택 상태를 다시 읽어 칩을 갱신한다(화면을 열 때마다 호출). */
  refresh: () => void;
}

/**
 * onChange: 꾸밈을 바꾼 직후 호출 — 배경/다음 런 렌더에 즉시 반영하도록 호출부가 applyCosmetics 를 건다.
 */
export function createCosmeticPicker(onChange: () => void): CosmeticPicker {
  const root = document.createElement("div");
  root.style.cssText =
    "display:none; flex-direction:column; align-items:center; gap:7px;";

  const label = document.createElement("div");
  label.textContent = "꾸밈 (효과 없음)";
  label.style.cssText =
    "color:var(--faint); font-family:var(--font-mono); font-size:10.5px; letter-spacing:0.18em;";

  const chips = document.createElement("div");
  chips.style.cssText = "display:flex; flex-wrap:wrap; justify-content:center; gap:7px;";
  root.append(label, chips);

  const refresh = (): void => {
    const open = unlockedCosmetics().filter((c): c is CosmeticId => BODY_COSMETICS.includes(c));
    if (open.length === 0) {
      root.style.display = "none";
      return;
    }
    root.style.display = "flex";
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
        refresh();
        onChange(); // 렌더에 즉시 반영 — 고른 걸 바로 본다
      });
      chips.appendChild(b);
    };
    add(null, "없음", "맨몸");
    for (const id of open) add(id, COSMETICS[id].name, COSMETICS[id].desc);
  };

  return { el: root, refresh };
}
