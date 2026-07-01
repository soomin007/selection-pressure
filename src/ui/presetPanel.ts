// 시작 프리셋 선택 창 — 캐릭터 선택 화면. 한 종의 외형 미리보기 + 이름·특징·설명·형질을 보여준다.
// 외형만으론 프리셋 차이가 미묘해서(형질 폭이 작음), "이 형태가 무슨 뜻인지"를 안내 문구와 형질
// 강조로 함께 전한다. 폰은 한 종씩(‹ ›), 데스크탑은 5종을 캐러셀로 나열하고 가운데를 크게 본다.
// 외형은 실제 게놈으로 만든 생물 텍스처(makeCreatureTexture)를 canvas 로 뽑아 쓴다.

import { defaultGenome, clampGenome, TRAIT_KEYS, TRAIT_LABELS, type Genome } from "@/sim/genome";
import { applyCard, type Card } from "@/game/cards";
import { describeSpecies } from "@/game/runReport";
import { makeCreatureTexture } from "@/render/worldView";
import type { Renderer } from "pixi.js";

export interface PresetPanel {
  show: (cards: Card[], preview: string) => void;
  hide: () => void;
}

const PLAYER_COLOR = 0x6cc24a; // 내 종 초록(프리셋 미리보기 색)

function dietWord(v: number): string {
  return v < 0.35 ? "초식성" : v > 0.7 ? "육식성" : "잡식성";
}
function dietColor(v: number): string {
  return v < 0.35 ? "#6cc24a" : v > 0.7 ? "#e05a4a" : "#e0b94a";
}
function presetGenome(card: Card): Genome {
  const g = defaultGenome();
  applyCard(g, card);
  return clampGenome(g);
}

export function createPresetPanel(
  renderer: Renderer,
  onPick: (index: number) => void,
): PresetPanel {
  const isDesktop = typeof document !== "undefined" && document.body?.dataset.layout === "desktop";

  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed; inset:0; z-index:20; display:none; align-items:center; justify-content:center;" +
    "background:rgba(6,8,13,0.84); font-family:system-ui,-apple-system,sans-serif; user-select:none;";

  const panel = document.createElement("div");
  panel.style.cssText =
    `width:min(${isDesktop ? 640 : 340}px,92vw); box-sizing:border-box; padding:16px 18px 18px;` +
    "background:#0e131c; border:1px solid #2a3346; border-radius:16px; color:#dfe6ee; text-align:center;";

  const heading = document.createElement("div");
  heading.textContent = "어떤 종으로 시작할까요?";
  heading.style.cssText = "font-size:14px; font-weight:700; color:#aeb7c4; margin-bottom:8px;";

  // --- 외형 영역 ---
  const artRow = document.createElement("div");
  artRow.style.cssText = "display:flex; align-items:center; justify-content:center; gap:8px;";
  const mkArrow = (label: string, onTap: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText =
      "flex:none; width:40px; height:40px; border:none; border-radius:12px; background:#20293a;" +
      "color:#dfe6ee; font-size:22px; font-weight:800; cursor:pointer; line-height:1;";
    b.addEventListener("click", onTap);
    return b;
  };
  const prevBtn = mkArrow("‹", () => step(-1));
  const nextBtn = mkArrow("›", () => step(1));
  // 모바일: 가운데 1개 박스. 데스크탑: 5개 캐러셀을 담는 넓은 스트립.
  const artBox = document.createElement("div");
  artBox.style.cssText = isDesktop
    ? "flex:1; height:150px; display:flex; align-items:center; justify-content:center; gap:6px;"
    : "flex:1; height:150px; display:flex; align-items:center; justify-content:center; background:#111725; border-radius:12px;";
  artRow.append(prevBtn, artBox, nextBtn);

  const page = document.createElement("div");
  page.style.cssText = "font-size:12px; color:#7b8595; margin-top:6px; font-variant-numeric:tabular-nums;";

  // --- 정보 영역(선택 중인 종) ---
  const nameEl = document.createElement("div");
  nameEl.style.cssText = "font-size:20px; font-weight:800; color:#9bffa0; margin-top:8px; word-break:keep-all;";
  const featureEl = document.createElement("div");
  featureEl.style.cssText = "font-size:12.5px; color:#aeb7c4; margin-top:2px; word-break:keep-all;";
  const dietWrap = document.createElement("div");
  const dietEl = document.createElement("span");
  dietEl.style.cssText =
    "display:inline-block; margin-top:6px; padding:2px 10px; border-radius:999px;" +
    "font-size:12px; font-weight:700; background:#1a2230;";
  dietWrap.appendChild(dietEl);
  const descEl = document.createElement("div");
  descEl.style.cssText = "font-size:13px; color:#cdd5df; line-height:1.5; margin-top:8px; word-break:keep-all;";
  const traitsEl = document.createElement("div");
  traitsEl.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:3px 12px; margin-top:12px;";
  // 외형 읽는 법 — 형태가 무슨 형질을 뜻하는지(외형만으론 미묘하니 말로 거든다).
  const hintEl = document.createElement("div");
  hintEl.textContent = "몸이 길수록 빠르고, 눈이 클수록 멀리 봅니다. 등가시는 공격력, 뾰족한 입은 사냥꾼.";
  hintEl.style.cssText = "font-size:11px; color:#7b8595; line-height:1.5; margin-top:10px; word-break:keep-all;";

  const selectBtn = document.createElement("button");
  selectBtn.textContent = "이 종으로 시작";
  selectBtn.style.cssText =
    "width:100%; margin-top:14px; padding:11px; border:none; border-radius:12px;" +
    "background:#6cc24a; color:#08110a; font-size:15px; font-weight:800; cursor:pointer;";
  selectBtn.addEventListener("click", () => onPick(idx));

  panel.append(heading, artRow, page, nameEl, featureEl, dietWrap, descEl, traitsEl, hintEl, selectBtn);
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
      arts.push(canvas);
      tex.destroy(true);
    }
  }

  /** 데스크탑 캐러셀 — 5종을 idx 가 가운데 오게 재배열, 가운데가 가장 크고 양옆은 작고 흐리게. */
  function renderCarousel(): void {
    const n = cards.length;
    const nodes: HTMLElement[] = [];
    for (let d = -2; d <= 2; d++) {
      const i = ((idx + d) % n + n) % n;
      const canvas = arts[i];
      if (!canvas) continue;
      const dist = Math.abs(d);
      const h = dist === 0 ? 132 : dist === 1 ? 92 : 62;
      canvas.style.cssText =
        `height:${h}px; width:auto; cursor:pointer;` +
        `opacity:${dist === 0 ? 1 : dist === 1 ? 0.75 : 0.45}; transition:height 0.12s;`;
      canvas.onclick = () => {
        idx = i;
        render();
      };
      nodes.push(canvas);
    }
    artBox.replaceChildren(...nodes);
  }

  function render(): void {
    const card = cards[idx];
    const g = genomes[idx];
    if (!card || !g) return;
    page.textContent = `${idx + 1} / ${cards.length}`;
    if (isDesktop) {
      renderCarousel();
    } else {
      const art = arts[idx];
      if (art) {
        art.style.cssText = "max-width:132px; max-height:132px; image-rendering:auto;";
        artBox.replaceChildren(art);
      }
    }
    nameEl.textContent = card.name;
    featureEl.textContent = describeSpecies(g);
    dietEl.textContent = dietWord(g.traits.diet);
    dietEl.style.color = dietColor(g.traits.diet);
    descEl.textContent = card.desc;
    traitsEl.replaceChildren();
    for (const key of TRAIT_KEYS) {
      const v = g.traits[key];
      const strong = v > 0.56; // 기본(0.5)보다 뚜렷이 높은 강점 형질은 밝게 강조
      const cell = document.createElement("div");
      const top = document.createElement("div");
      top.style.cssText = "display:flex; justify-content:space-between; gap:4px;";
      const label = document.createElement("span");
      label.textContent = TRAIT_LABELS[key];
      label.style.cssText = `font-size:11px; color:${strong ? "#cfe6b0" : "#9aa6b6"};`;
      const val = document.createElement("span");
      val.textContent = key === "diet" ? dietWord(v).slice(0, 2) : v.toFixed(2);
      val.style.cssText =
        `font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; color:${strong ? "#9bffa0" : "#dfe6ee"};`;
      top.append(label, val);
      cell.appendChild(top);
      const track = document.createElement("div");
      track.style.cssText = "margin-top:2px; height:4px; border-radius:3px; background:#1a2230; overflow:hidden;";
      const fill = document.createElement("div");
      fill.style.cssText =
        `height:100%; width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%; background:${strong ? "#6cc24a" : "#5a86c8"};`;
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
