// 드래프트 UI — 카드 3장 중 1장 탭. 캔버스 위 HTML 오버레이(터치 친화).
// 관전 중엔 숨고, 드래프트 단계에만 보인다.

import type { Card } from "@/game/cards";
import { TRAIT_LABELS, type Traits } from "@/sim/genome";
import { ensurePanelStyles } from "@/ui/panelStyles";

export interface DraftPanel {
  show: (cards: Card[]) => void;
  hide: () => void;
}

export function createDraftPanel(onPick: (index: number) => void): DraftPanel {
  ensurePanelStyles();

  const root = document.createElement("div");
  root.className = "ui-root ui-draft";
  root.style.display = "none";

  const title = document.createElement("div");
  title.className = "ui-title";
  title.textContent = "형질을 하나 고르세요";
  root.appendChild(title);

  const list = document.createElement("div");
  list.className = "ui-cards";
  root.appendChild(list);

  document.body.appendChild(root);

  const show = (cards: Card[]): void => {
    list.replaceChildren();
    cards.forEach((card, i) => {
      const btn = document.createElement("button");
      btn.className = "ui-card";

      const name = document.createElement("div");
      name.className = "ui-card-name";
      name.textContent = card.name;

      const desc = document.createElement("div");
      desc.className = "ui-card-desc";
      desc.textContent = card.desc;

      const eff = document.createElement("div");
      eff.className = "ui-card-eff";
      eff.textContent = formatEffects(card);

      btn.appendChild(name);
      btn.appendChild(desc);
      btn.appendChild(eff);
      btn.addEventListener("click", () => onPick(i));
      list.appendChild(btn);
    });
    root.style.display = "block";
  };

  const hide = (): void => {
    root.style.display = "none";
  };

  return { show, hide };
}

function formatEffects(card: Card): string {
  const parts: string[] = [];
  for (const key of Object.keys(card.effects) as (keyof Traits)[]) {
    const v = card.effects[key] ?? 0;
    const sign = v >= 0 ? "+" : "";
    parts.push(`${TRAIT_LABELS[key]} ${sign}${v.toFixed(2)}`);
  }
  return parts.join("  ·  ");
}
