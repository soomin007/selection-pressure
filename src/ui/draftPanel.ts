// 드래프트 UI — 카드 3장 중 1장 탭. 캔버스 위 HTML 오버레이(터치 친화).
// 관전 중엔 숨고, 드래프트 단계에만 보인다.

import type { Card } from "@/game/cards";
import { TRAIT_LABELS, type Traits } from "@/sim/genome";
import { ABILITY_KEYS } from "@/ui/traitDisplay";
import { ensurePanelStyles } from "@/ui/panelStyles";

export interface DraftPanel {
  show: (cards: Card[], preview: string) => void;
  hide: () => void;
}

export function createDraftPanel(onPick: (index: number) => void, onSkip: () => void): DraftPanel {
  ensurePanelStyles();

  const root = document.createElement("div");
  root.className = "ui-root ui-draft";
  root.style.display = "none";

  const previewBox = document.createElement("div");
  previewBox.className = "ui-preview";
  root.appendChild(previewBox);

  const title = document.createElement("div");
  title.className = "ui-title";
  title.textContent = "형질을 하나 고르세요";
  root.appendChild(title);

  const list = document.createElement("div");
  list.className = "ui-cards";
  root.appendChild(list);

  // 스킵 — 3장이 다 별로면 형질 대신 소소한 보상(새끼)을 받는다. 은은한 보조 버튼(카드보다 약하게).
  const skipBtn = document.createElement("button");
  skipBtn.textContent = "건너뛰고 새끼 치기";
  skipBtn.style.cssText =
    "display:block; width:100%; margin-top:10px; padding:9px; border:1px solid #3a4658; border-radius:12px;" +
    "background:transparent; color:#8a93a6; font-size:13px; font-weight:600; cursor:pointer;";
  skipBtn.addEventListener("click", onSkip);
  root.appendChild(skipBtn);

  document.body.appendChild(root);

  const show = (cards: Card[], preview: string): void => {
    previewBox.textContent = preview;
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
    if (ABILITY_KEYS.has(key)) {
      // 능력형(수영·날개·초음파·독·원거리)은 수치가 무의미(3단계) → 방향만 표시(강화/약화).
      parts.push(`${TRAIT_LABELS[key]} ${v >= 0 ? "강화 ↑" : "약화 ↓"}`);
    } else {
      const sign = v >= 0 ? "+" : "";
      parts.push(`${TRAIT_LABELS[key]} ${sign}${Math.round(v)}`);
    }
  }
  return parts.join("  ·  ");
}
