// 시작 프리셋 선택 창 — 캐릭터 선택 화면처럼 한 종씩 보여준다(외형 미리보기 + 이름·설명·형질).
// 화살표로 페이지를 넘겨가며 보고 "이 종으로 시작"을 누른다. 글이 가득한 목록 대신 하나씩 집중.
// 외형은 실제 게놈으로 만든 생물 텍스처(makeCreatureTexture)를 canvas 로 뽑아 보여준다.

import { defaultGenome, clampGenome, TRAIT_KEYS, TRAIT_LABELS, type Genome } from "@/sim/genome";
import { applyCard, type Card } from "@/game/cards";
import { makeCreatureTexture } from "@/render/worldView";
import type { Renderer } from "pixi.js";

export interface PresetPanel {
  show: (cards: Card[], preview: string) => void;
  hide: () => void;
}

const PLAYER_COLOR = 0x6cc24a; // 내 종 초록(프리셋 미리보기 색)

/** 식성값 → 쉬운 범주 + 색(배지). */
function dietWord(v: number): string {
  return v < 0.35 ? "초식성" : v > 0.7 ? "육식성" : "잡식성";
}
function dietColor(v: number): string {
  return v < 0.35 ? "#6cc24a" : v > 0.7 ? "#e05a4a" : "#e0b94a";
}

/** 프리셋 카드를 기본 게놈에 적용한 결과 게놈(미리보기·형질 표시용). */
function presetGenome(card: Card): Genome {
  const g = defaultGenome();
  applyCard(g, card);
  return clampGenome(g);
}

export function createPresetPanel(
  renderer: Renderer,
  onPick: (index: number) => void,
): PresetPanel {
  // 전체 화면 모달 오버레이(어둡게 깔고 중앙 카드).
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed; inset:0; z-index:20; display:none; align-items:center; justify-content:center;" +
    "background:rgba(6,8,13,0.84); font-family:system-ui,-apple-system,sans-serif; user-select:none;";

  const panel = document.createElement("div");
  panel.style.cssText =
    "width:min(340px,90vw); box-sizing:border-box; padding:16px 18px 18px;" +
    "background:#0e131c; border:1px solid #2a3346; border-radius:16px; color:#dfe6ee; text-align:center;";

  const heading = document.createElement("div");
  heading.textContent = "어떤 종으로 시작할까요?";
  heading.style.cssText = "font-size:14px; font-weight:700; color:#aeb7c4; margin-bottom:2px;";

  const page = document.createElement("div");
  page.style.cssText = "font-size:12px; color:#7b8595; margin-bottom:8px; font-variant-numeric:tabular-nums;";

  // 외형 미리보기 + 좌우 화살표(같은 줄).
  const artRow = document.createElement("div");
  artRow.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:6px;";
  const mkArrow = (label: string, onTap: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText =
      "flex:none; width:40px; height:40px; border:none; border-radius:12px; background:#20293a;" +
      "color:#dfe6ee; font-size:22px; font-weight:800; cursor:pointer; line-height:1;";
    b.addEventListener("click", onTap);
    return b;
  };
  const artBox = document.createElement("div");
  artBox.style.cssText =
    "flex:1; height:132px; display:flex; align-items:center; justify-content:center;" +
    "background:#111725; border-radius:12px;";
  const prevBtn = mkArrow("‹", () => step(-1));
  const nextBtn = mkArrow("›", () => step(1));
  artRow.append(prevBtn, artBox, nextBtn);

  const nameEl = document.createElement("div");
  nameEl.style.cssText = "font-size:20px; font-weight:800; color:#9bffa0; margin-top:10px; word-break:keep-all;";

  const dietEl = document.createElement("span");
  dietEl.style.cssText =
    "display:inline-block; margin-top:6px; padding:2px 10px; border-radius:999px;" +
    "font-size:12px; font-weight:700; background:#1a2230;";

  const descEl = document.createElement("div");
  descEl.style.cssText = "font-size:13px; color:#cdd5df; line-height:1.5; margin-top:8px; word-break:keep-all;";

  // 형질 미니 그리드(2열).
  const traitsEl = document.createElement("div");
  traitsEl.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:3px 12px; margin-top:12px;";

  const selectBtn = document.createElement("button");
  selectBtn.textContent = "이 종으로 시작";
  selectBtn.style.cssText =
    "width:100%; margin-top:14px; padding:11px; border:none; border-radius:12px;" +
    "background:#6cc24a; color:#08110a; font-size:15px; font-weight:800; cursor:pointer;";
  selectBtn.addEventListener("click", () => onPick(idx));

  panel.append(heading, page, artRow, nameEl, document.createElement("div"), descEl, traitsEl, selectBtn);
  // dietEl 은 이름 아래 별도 래퍼에.
  const dietWrap = panel.children[4] as HTMLDivElement;
  dietWrap.appendChild(dietEl);
  root.appendChild(panel);
  document.body.appendChild(root);

  let idx = 0;
  let cards: Card[] = [];
  const arts: HTMLCanvasElement[] = [];
  const genomes: Genome[] = [];

  function buildArts(): void {
    for (const c of arts) c.remove();
    arts.length = 0;
    genomes.length = 0;
    for (const card of cards) {
      const g = presetGenome(card);
      genomes.push(g);
      const tex = makeCreatureTexture(renderer, g, PLAYER_COLOR);
      const canvas = renderer.extract.canvas(tex) as HTMLCanvasElement;
      canvas.style.cssText = "max-width:118px; max-height:118px; image-rendering:auto;";
      arts.push(canvas);
      tex.destroy(true);
    }
  }

  function render(): void {
    const card = cards[idx];
    const g = genomes[idx];
    const art = arts[idx];
    if (!card || !g || !art) return;
    page.textContent = `${idx + 1} / ${cards.length}`;
    artBox.replaceChildren(art);
    nameEl.textContent = card.name;
    dietEl.textContent = dietWord(g.traits.diet);
    dietEl.style.color = dietColor(g.traits.diet);
    descEl.textContent = card.desc;
    traitsEl.replaceChildren();
    for (const key of TRAIT_KEYS) {
      const v = g.traits[key];
      const cell = document.createElement("div");
      const top = document.createElement("div");
      top.style.cssText = "display:flex; justify-content:space-between; gap:4px;";
      const label = document.createElement("span");
      label.textContent = TRAIT_LABELS[key];
      label.style.cssText = "color:#9aa6b6; font-size:11px;";
      const val = document.createElement("span");
      val.textContent = key === "diet" ? dietWord(v).slice(0, 2) : v.toFixed(2);
      val.style.cssText = "color:#dfe6ee; font-size:11px; font-weight:700; font-variant-numeric:tabular-nums;";
      top.append(label, val);
      cell.appendChild(top);
      const track = document.createElement("div");
      track.style.cssText = "margin-top:2px; height:4px; border-radius:3px; background:#1a2230; overflow:hidden;";
      const fill = document.createElement("div");
      fill.style.cssText =
        "height:100%; width:" + Math.round(Math.max(0, Math.min(1, v)) * 100) + "%; background:#5a86c8;";
      track.appendChild(fill);
      cell.appendChild(track);
      traitsEl.appendChild(cell);
    }
  }

  function step(dir: number): void {
    if (cards.length === 0) return;
    idx = (idx + dir + cards.length) % cards.length;
    render();
  }

  const show = (cs: Card[], _preview: string): void => {
    cards = cs;
    idx = 0;
    buildArts();
    render();
    root.style.display = "flex";
  };

  const hide = (): void => {
    root.style.display = "none";
  };

  return { show, hide };
}
