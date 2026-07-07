// 드래프트 UI — 카드 3장 중 1장 탭. 캔버스 위 HTML 오버레이(터치 친화).
// 관전 중엔 숨고, 드래프트 단계에만 보인다.

import { effectiveDelta, type Card } from "@/game/cards";
import { TRAIT_LABELS, type Traits } from "@/sim/genome";
import { ABILITY_KEYS, traitColor } from "@/ui/traitDisplay";
import { ensurePanelStyles } from "@/ui/panelStyles";

export interface DraftPanel {
  show: (cards: Card[], preview: string, canReroll: boolean) => void;
  hide: () => void;
}

export function createDraftPanel(
  onPick: (index: number) => void,
  onSkip: () => void,
  onReroll: () => void,
): DraftPanel {
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

  // 다시 뽑기(리롤) — 여러 런을 마치면 열리는 편의(meta). 3장이 별로면 새로 뽑는다. 열렸을 때만 보인다.
  const rerollBtn = document.createElement("button");
  rerollBtn.textContent = "다시 뽑기";
  rerollBtn.style.cssText =
    "display:none; width:100%; margin-top:10px; padding:10px; border:1px solid var(--line); border-radius:var(--r-btn);" +
    "background:rgba(255,255,255,0.05); color:var(--ink); font-family:var(--font-body); font-size:14px; cursor:pointer;";
  rerollBtn.addEventListener("click", onReroll);
  root.appendChild(rerollBtn);

  // 스킵 — 3장이 다 별로면 형질 대신 소소한 보상(새끼)을 받는다. 은은한 보조 버튼(카드보다 약하게).
  const skipBtn = document.createElement("button");
  skipBtn.textContent = "건너뛰고 새끼 치기";
  skipBtn.style.cssText =
    "display:block; width:100%; margin-top:8px; padding:9px; border:0;" +
    "background:transparent; color:var(--faint); font-family:var(--font-body); font-size:13px; cursor:pointer;";
  skipBtn.addEventListener("click", onSkip);
  root.appendChild(skipBtn);

  document.body.appendChild(root);

  const show = (cards: Card[], preview: string, canReroll: boolean): void => {
    previewBox.textContent = preview;
    rerollBtn.style.display = canReroll ? "block" : "none";
    list.replaceChildren();
    cards.forEach((card, i) => {
      const btn = document.createElement("button");
      btn.className = "ui-card";
      // 카드 왼쪽 휜 액센트를 대표 형질 색으로 — "무엇이 바뀌는지"가 색으로 먼저 읽힌다.
      const accent = traitColor(dominantTrait(card));
      btn.style.borderLeftColor = accent;

      const name = document.createElement("div");
      name.className = "ui-card-name";
      name.textContent = card.name;

      const desc = document.createElement("div");
      desc.className = "ui-card-desc";
      desc.textContent = card.desc;

      const eff = document.createElement("div");
      eff.className = "ui-card-eff";
      eff.style.color = accent;
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

/** 카드 효과 중 가장 크게 바뀌는 형질 — 카드 액센트 색을 정한다. */
function dominantTrait(card: Card): keyof Traits {
  const keys = Object.keys(card.effects) as (keyof Traits)[];
  let best: keyof Traits = keys[0] ?? "fertility";
  let bestMag = -1;
  for (const key of keys) {
    const mag = Math.abs(card.effects[key] ?? 0);
    if (mag > bestMag) {
      bestMag = mag;
      best = key;
    }
  }
  return best;
}

function formatEffects(card: Card): string {
  const parts: string[] = [];
  for (const key of Object.keys(card.effects) as (keyof Traits)[]) {
    const v = card.effects[key] ?? 0;
    if (ABILITY_KEYS.has(key)) {
      // 능력형(수영·날개·초음파·독·원거리)은 수치가 무의미(3단계) → 방향만 표시(강화/약화).
      parts.push(`${TRAIT_LABELS[key]} ${v >= 0 ? "강화 ↑" : "약화 ↓"}`);
    } else {
      // 실제 적용값(연속 형질은 ×0.6 축소분)을 보여준다 — 카드 수치 = 실제 붙는 값(폰 피드백).
      const d = effectiveDelta(key, v);
      parts.push(`${TRAIT_LABELS[key]} ${d >= 0 ? "+" : ""}${d}`);
    }
  }
  return parts.join("  ·  ");
}
