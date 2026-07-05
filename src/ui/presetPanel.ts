// 시작 프리셋 선택 창 — 2단계. ① 갈래(순한 종·사냥꾼·특수 능력)를 먼저 고르고 ② 그 안에서 세부 종을
// 고른다. 프리셋이 많아 한 화면에 늘어놓으면 난잡하던 것을, 큰 방향부터 좁혀 깔끔하게(사용자 피드백).
// 외형은 실제 게놈으로 만든 생물 텍스처(makeCreatureTexture)를 canvas 로 뽑아 쓴다.

import { defaultGenome, clampGenome, TRAIT_KEYS, TRAIT_LABELS, type Genome } from "@/sim/genome";
import { applyCard, type Card } from "@/game/cards";
import { describeSpecies } from "@/game/runReport";
import { makeCreatureTexture } from "@/render/worldView";
import { ABILITY_KEYS, abilityLevel, abilityWord } from "@/ui/traitDisplay";
import type { Renderer } from "pixi.js";

export interface PresetPanel {
  show: (cards: Card[], preview: string) => void;
  hide: () => void;
}

const PLAYER_COLOR = 0x6cc24a; // 프리셋에 색이 없을 때의 기본(초록)

// 프리셋 갈래(1단계) — 카드 id 로 묶어 PRESET_CARDS 순서가 바뀌어도 안전. 모든 프리셋이 한 갈래에 속한다.
interface PresetCategory {
  name: string;
  desc: string;
  color: number;
  ids: string[];
}
const CATEGORIES: PresetCategory[] = [
  { name: "순한 종", desc: "풀을 먹고 수와 시야로 버팁니다", color: 0x8bd84a, ids: ["preset_omni", "preset_herd", "preset_scout"] },
  { name: "사냥꾼", desc: "다른 종을 쫓아 사냥해 먹습니다", color: 0xff7a3a, ids: ["preset_hunter", "preset_ranged"] },
  { name: "특수 능력", desc: "바다·하늘·독 같은 특별한 재주", color: 0x5aa0f0, ids: ["preset_sea", "preset_sky", "preset_venom"] },
];

const hexColor = (c: number): string => "#" + (c & 0xffffff).toString(16).padStart(6, "0");

function dietWord(v: number): string {
  return v < 35 ? "초식성" : v > 70 ? "육식성" : "잡식성";
}
function dietColor(v: number): string {
  return v < 35 ? "#6cc24a" : v > 70 ? "#e05a4a" : "#e0b94a";
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
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed; inset:0; z-index:20; display:none; align-items:center; justify-content:center;" +
    "background:rgba(6,8,13,0.84); font-family:system-ui,-apple-system,sans-serif; user-select:none;";

  const panel = document.createElement("div");
  panel.style.cssText =
    "width:min(360px,92vw); box-sizing:border-box; padding:16px 18px 18px;" +
    "background:#0e131c; border:1px solid #2a3346; border-radius:16px; color:#dfe6ee; text-align:center;";
  root.appendChild(panel);
  document.body.appendChild(root);

  // === 1단계: 갈래 선택 화면 ===
  const catView = document.createElement("div");
  const catHeading = document.createElement("div");
  catHeading.textContent = "어떤 갈래로 시작할까요?";
  catHeading.style.cssText = "font-size:15px; font-weight:800; color:#cfd6df; margin-bottom:12px;";
  const catList = document.createElement("div");
  catList.style.cssText = "display:flex; flex-direction:column; gap:10px;";
  catView.append(catHeading, catList);

  // === 2단계: 세부 종 선택 화면 ===
  const detailView = document.createElement("div");
  detailView.style.display = "none";

  const backBtn = document.createElement("button");
  backBtn.textContent = "‹ 갈래 다시 고르기";
  backBtn.style.cssText =
    "align-self:flex-start; margin-bottom:6px; padding:6px 10px; border:none; border-radius:10px;" +
    "background:#20293a; color:#aeb7c4; font-size:12px; font-weight:700; cursor:pointer;";
  backBtn.addEventListener("click", () => showCategories());

  const catLabel = document.createElement("div");
  catLabel.style.cssText = "font-size:12px; font-weight:700; color:#7b8595; margin-bottom:8px;";

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
  const artBox = document.createElement("div");
  artBox.style.cssText =
    "flex:1; height:150px; display:flex; align-items:center; justify-content:center;" +
    "background:#111725; border-radius:12px;";
  artRow.append(prevBtn, artBox, nextBtn);

  const page = document.createElement("div");
  page.style.cssText = "font-size:12px; color:#7b8595; margin-top:6px; font-variant-numeric:tabular-nums;";

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
  const hintEl = document.createElement("div");
  hintEl.textContent = "날렵한 몸은 빠른 발, 큰 눈은 넓은 시야. 등의 톱니 능선은 힘, 날카로운 주둥이는 사냥꾼입니다.";
  hintEl.style.cssText = "font-size:11px; color:#7b8595; line-height:1.5; margin-top:10px; word-break:keep-all;";

  const selectBtn = document.createElement("button");
  selectBtn.textContent = "이 종으로 시작";
  selectBtn.style.cssText =
    "width:100%; margin-top:14px; padding:11px; border:none; border-radius:12px;" +
    "background:#6cc24a; color:#08110a; font-size:15px; font-weight:800; cursor:pointer;";
  selectBtn.addEventListener("click", () => {
    const gi = memberIndices[catPos];
    if (gi !== undefined) onPick(gi);
  });

  detailView.style.cssText = "display:none; flex-direction:column; align-items:center;";
  detailView.append(backBtn, catLabel, artRow, page, nameEl, featureEl, dietWrap, descEl, traitsEl, hintEl, selectBtn);

  panel.append(catView, detailView);

  // === 상태 ===
  let cards: Card[] = [];
  const arts: HTMLCanvasElement[] = []; // 전 프리셋 외형(전역 인덱스)
  const genomes: Genome[] = [];
  let memberIndices: number[] = []; // 현재 갈래의 세부 종(전역 인덱스) 목록
  let catPos = 0; // 현재 갈래 안에서의 위치

  function buildArts(): void {
    for (const c of arts) c.remove();
    arts.length = 0;
    genomes.length = 0;
    for (const card of cards) {
      const g = presetGenome(card);
      genomes.push(g);
      const tex = makeCreatureTexture(renderer, g, card.color ?? PLAYER_COLOR);
      const canvas = renderer.extract.canvas(tex) as HTMLCanvasElement;
      arts.push(canvas);
      tex.destroy(true);
    }
  }

  /** 카드 id → 전역 인덱스(현재 cards 기준). 없으면 -1. */
  function indexOfId(id: string): number {
    return cards.findIndex((c) => c.id === id);
  }

  function showCategories(): void {
    detailView.style.display = "none";
    catView.style.display = "block";
    catList.replaceChildren();
    for (const cat of CATEGORIES) {
      const members = cat.ids.map(indexOfId).filter((i) => i >= 0);
      if (members.length === 0) continue;
      const btn = document.createElement("button");
      btn.style.cssText =
        "display:flex; align-items:center; gap:12px; width:100%; box-sizing:border-box; padding:12px 14px;" +
        "border:1px solid #2a3346; border-radius:14px; background:#141b28; color:#dfe6ee; cursor:pointer; text-align:left;";
      // 갈래 대표 외형(첫 세부 종) — 무엇인지 한눈에. 원본 canvas 는 상세 화면이 쓰므로 픽셀을 복사한
      // 새 canvas 를 아이콘으로 둔다(cloneNode 는 canvas 비트맵을 복사하지 않아 빈 그림이 된다).
      const icon = arts[members[0] as number];
      if (icon) {
        const ic = document.createElement("canvas");
        ic.width = icon.width;
        ic.height = icon.height;
        ic.getContext("2d")?.drawImage(icon, 0, 0);
        // 비율 유지 — width/height 를 둘 다 강제하면 가로로 길쭉한 생물이 좌우로 찌그러진다(폰 피드백).
        // 고정 크기 박스에 담고 max 로 담아 종횡비를 지킨다(상세 뷰 외형과 동일 방식).
        ic.style.cssText = "max-width:100%; max-height:100%; display:block;";
        const iconBox = document.createElement("div");
        iconBox.style.cssText =
          "flex:none; width:48px; height:48px; display:flex; align-items:center; justify-content:center;";
        iconBox.appendChild(ic);
        btn.appendChild(iconBox);
      }
      const txt = document.createElement("div");
      txt.style.cssText = "flex:1; min-width:0;";
      const nm = document.createElement("div");
      nm.textContent = cat.name;
      nm.style.cssText = `font-size:16px; font-weight:800; color:${hexColor(cat.color)};`;
      const ds = document.createElement("div");
      ds.textContent = `${cat.desc} · ${members.length}종`;
      ds.style.cssText = "font-size:12px; color:#9aa6b6; margin-top:2px; word-break:keep-all;";
      txt.append(nm, ds);
      const arrow = document.createElement("div");
      arrow.textContent = "›";
      arrow.style.cssText = "flex:none; font-size:22px; font-weight:800; color:#5a6678;";
      btn.append(txt, arrow);
      btn.addEventListener("click", () => enterCategory(cat));
      catList.appendChild(btn);
    }
  }

  function enterCategory(cat: PresetCategory): void {
    memberIndices = cat.ids.map(indexOfId).filter((i) => i >= 0);
    catPos = 0;
    catLabel.textContent = cat.name;
    catView.style.display = "none";
    detailView.style.display = "flex";
    const only = memberIndices.length <= 1;
    prevBtn.style.visibility = only ? "hidden" : "visible";
    nextBtn.style.visibility = only ? "hidden" : "visible";
    renderDetail();
  }

  function step(dir: number): void {
    if (memberIndices.length === 0) return;
    catPos = (catPos + dir + memberIndices.length) % memberIndices.length;
    renderDetail();
  }

  function renderDetail(): void {
    const gi = memberIndices[catPos];
    if (gi === undefined) return;
    const card = cards[gi];
    const g = genomes[gi];
    if (!card || !g) return;
    page.textContent = memberIndices.length > 1 ? `${catPos + 1} / ${memberIndices.length}` : "";
    const art = arts[gi];
    if (art) {
      art.style.cssText = "max-width:132px; max-height:132px; image-rendering:auto;";
      artBox.replaceChildren(art);
    }
    nameEl.textContent = card.name;
    const c = card.color ?? PLAYER_COLOR;
    nameEl.style.color = hexColor(c);
    selectBtn.style.background = hexColor(c);
    featureEl.textContent = describeSpecies(g);
    dietEl.textContent = dietWord(g.traits.diet);
    dietEl.style.color = dietColor(g.traits.diet);
    descEl.textContent = card.desc;
    traitsEl.replaceChildren();
    for (const key of TRAIT_KEYS) {
      const v = g.traits[key];
      const isAbility = ABILITY_KEYS.has(key);
      const lvl = isAbility ? abilityLevel(key, v) : 0;
      // 능력형은 "보통/강함"이면 강조, 연속형은 56 초과면 강조.
      const strong = isAbility ? lvl >= 1 : v > 56;
      const cell = document.createElement("div");
      const top = document.createElement("div");
      top.style.cssText = "display:flex; justify-content:space-between; gap:4px;";
      const label = document.createElement("span");
      label.textContent = TRAIT_LABELS[key];
      label.style.cssText = `font-size:11px; color:${strong ? "#cfe6b0" : "#9aa6b6"};`;
      const val = document.createElement("span");
      // 능력형=3단계 단어, 식성=초식/잡식/육식, 나머지=숫자.
      val.textContent = isAbility ? abilityWord(lvl) : key === "diet" ? dietWord(v).slice(0, 2) : String(Math.round(v));
      val.style.cssText =
        `font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; color:${strong ? "#9bffa0" : "#dfe6ee"};`;
      top.append(label, val);
      cell.appendChild(top);
      const track = document.createElement("div");
      track.style.cssText = "margin-top:2px; height:4px; border-radius:3px; background:#1a2230; overflow:hidden;";
      const fill = document.createElement("div");
      // 능력형은 3단계 눈금(0/50/100%), 연속형은 값(0~100 기준 — 프리셋은 100 이하).
      const pct = isAbility ? lvl * 50 : Math.round(Math.max(0, Math.min(100, v)));
      fill.style.cssText = `height:100%; width:${pct}%; background:${strong ? "#6cc24a" : "#5a86c8"};`;
      track.appendChild(fill);
      cell.appendChild(track);
      traitsEl.appendChild(cell);
    }
  }

  const show = (cs: Card[], _preview: string): void => {
    cards = cs;
    buildArts();
    showCategories();
    root.style.display = "flex";
  };

  const hide = (): void => {
    root.style.display = "none";
  };

  return { show, hide };
}
