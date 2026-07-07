// 개체 정보 카드 — 화면에서 한 마리를 탭하면 좌하단에 그 개체의 이름·상태·형질을 보여준다.
// 소수 개체 게임의 애착: 카메라가 따라가며 클로즈업하는 동안 "이 아이는 누구인지"를 읽게 한다.
// 캔버스 위 HTML 오버레이(buildPanel 과 같은 방식). 본문은 터치 통과, 닫기 버튼만 누를 수 있다.

import { TRAIT_KEYS, TRAIT_LABELS, type Traits } from "@/sim/genome";
import { traitColor } from "@/ui/traitDisplay";
import { ensurePanelStyles } from "@/ui/panelStyles";

export interface CreatureCardData {
  name: string; // 개체 애칭(예: "보리")
  speciesName: string; // 소속 종 이름("내 종" 또는 야생종)
  isPlayer: boolean; // 내 종이면 강조
  color: number; // 종 색(0xRRGGBB)
  energy: number; // 기운 0~1
  ageSeconds: number; // 살아온 시간(초)
  sizeText: string; // 덩치 한 단어(개체 개성 — 작은 몸/보통/큰 몸집)
  activity: string; // 지금 무엇을 하는 중인지(사냥/먹이/배회)
  descriptor: string; // 종 한 줄 묘사(describeSpecies)
  traits: Traits; // 이 개체의 형질값 — 개체별 진화로 같은 무리 안에서도 개체마다 다르다(‹ ›로 넘겨 비교)
}

export interface CreatureCard {
  /** 선택 개체 정보를 그린다. null 이면 카드를 숨긴다. */
  update: (data: CreatureCardData | null) => void;
}

export interface CreatureCardCallbacks {
  onClose: () => void; // 닫기(✕) — 선택 해제
  onPrev: () => void; // ‹ 같은 무리의 이전 개체로
  onNext: () => void; // › 같은 무리의 다음 개체로
}

const hex = (c: number): string => "#" + (c & 0xffffff).toString(16).padStart(6, "0");

/** 식성값 → 쉬운 범주(형질 도감·빌드 패널과 같은 경계). */
function dietWord(v: number): string {
  return v < 0.35 ? "초식" : v > 0.7 ? "육식" : "잡식";
}

/** 기운 정도를 한 단어로(즉각적 시각 피드백 — 색과 함께). 관찰 톤: 담백한 상태어. */
function energyWord(v: number): string {
  return v >= 0.7 ? "배부름" : v >= 0.34 ? "보통" : "굶주림";
}

/** 기운 막대 색 — 높으면 초록, 중간 호박, 낮으면 빨강(한눈에 위태로움을 읽게). 3a 의미 색. */
function energyColor(v: number): string {
  return v >= 0.7 ? "#8FD14F" : v >= 0.34 ? "#F5C33B" : "#E85C43";
}

export function createCreatureCard(cb: CreatureCardCallbacks): CreatureCard {
  ensurePanelStyles(); // :root 토큰(var(--*)) 보장
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed; left:calc(8px + env(safe-area-inset-left)); bottom:calc(8px + env(safe-area-inset-bottom));" +
    "width:190px; box-sizing:border-box; padding:10px 12px;" +
    "background:var(--panel); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px);" +
    "border:1px solid var(--line); border-radius:var(--r-focus);" +
    "color:var(--ink); font-family:var(--font-body); font-size:12px; line-height:1.4;" +
    "z-index:11; pointer-events:none; user-select:none; display:none;";

  // 헤더 — 종 색 점 + 이름(크게) + 이전/다음 화살표 + 닫기. 버튼만 누를 수 있고 나머지는 터치 통과.
  const header = document.createElement("div");
  header.style.cssText = "display:flex; align-items:center; gap:5px;";
  const dot = document.createElement("span");
  dot.style.cssText = "width:11px; height:11px; border-radius:50%; flex:none;";
  const name = document.createElement("span");
  name.style.cssText = "font-family:var(--font-title); font-size:16px; flex:1; word-break:keep-all;";
  // ‹ › — 같은 무리의 다른 개체로 포커스 이동. 폰 손가락 기준 넉넉한 탭 영역. 계측 알약 톤.
  const mkBtn = (label: string, onTap: () => void): HTMLSpanElement => {
    const b = document.createElement("span");
    b.textContent = label;
    b.style.cssText =
      "pointer-events:auto; cursor:pointer; color:var(--ink); font-size:17px;" +
      "line-height:1; padding:3px 8px; border-radius:999px; background:rgba(255,255,255,0.08); flex:none;";
    b.addEventListener("click", onTap);
    return b;
  };
  const prev = mkBtn("‹", cb.onPrev);
  const next = mkBtn("›", cb.onNext);
  const close = document.createElement("span");
  close.textContent = "✕";
  close.style.cssText =
    "pointer-events:auto; cursor:pointer; color:var(--faint); font-size:13px; padding:1px 4px; flex:none;";
  close.addEventListener("click", cb.onClose);
  header.append(dot, name, prev, next, close);

  // 종 · 한 줄 묘사.
  const sub = document.createElement("div");
  sub.style.cssText = "margin-top:2px; color:var(--sub); font-size:11.5px; word-break:keep-all;";

  // 기운 — 라벨 + 막대 + 한 단어.
  const energyRow = document.createElement("div");
  energyRow.style.cssText = "display:flex; align-items:center; gap:6px; margin-top:8px;";
  const energyLabel = document.createElement("span");
  energyLabel.textContent = "기운";
  energyLabel.style.cssText = "color:var(--sub); font-size:11px; flex:none;";
  const energyTrack = document.createElement("div");
  energyTrack.style.cssText =
    "flex:1; height:6px; border-radius:4px; background:rgba(255,255,255,0.06); overflow:hidden;";
  const energyFill = document.createElement("div");
  energyFill.style.cssText = "height:100%; width:0%; border-radius:4px;";
  energyTrack.appendChild(energyFill);
  const energyText = document.createElement("span");
  energyText.style.cssText = "font-family:var(--font-mono); font-size:11px; flex:none; min-width:48px; text-align:right;";
  energyRow.append(energyLabel, energyTrack, energyText);

  // 나이 · 지금 하는 일.
  const lifeRow = document.createElement("div");
  lifeRow.style.cssText =
    "display:flex; justify-content:space-between; gap:8px; margin-top:5px; font-size:11.5px;";
  const ageText = document.createElement("span");
  ageText.style.cssText = "color:var(--sub); font-family:var(--font-mono);";
  const activityText = document.createElement("span");
  activityText.style.cssText = "color:var(--ink); font-weight:600; word-break:keep-all;";
  lifeRow.append(ageText, activityText);

  // 형질 — 작은 2열 막대 격자(이 아이가 어떤 형질을 가졌는지). diet 는 단어로.
  const traitsLabel = document.createElement("div");
  traitsLabel.textContent = "형질";
  traitsLabel.style.cssText = "color:var(--faint); font-family:var(--font-mono); font-size:10px; letter-spacing:0.14em; margin:9px 0 4px;";
  const traitsGrid = document.createElement("div");
  traitsGrid.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:4px 10px;";

  // 형질 셀을 한 번만 만들고(8개), 값만 매번 갱신한다.
  const traitVals = new Map<keyof Traits, HTMLSpanElement>();
  const traitFills = new Map<keyof Traits, HTMLDivElement>();
  for (const key of TRAIT_KEYS) {
    const cell = document.createElement("div");
    const top = document.createElement("div");
    top.style.cssText = "display:flex; justify-content:space-between; gap:4px;";
    const label = document.createElement("span");
    label.textContent = TRAIT_LABELS[key];
    label.style.cssText = "color:var(--sub); font-size:10.5px;";
    const val = document.createElement("span");
    val.style.cssText = "color:var(--ink); font-size:10.5px; font-family:var(--font-mono); font-variant-numeric:tabular-nums;";
    top.append(label, val);
    cell.appendChild(top);
    if (key !== "diet") {
      const track = document.createElement("div");
      track.style.cssText = "margin-top:2px; height:3px; border-radius:2px; background:rgba(255,255,255,0.06); overflow:hidden;";
      const fill = document.createElement("div");
      // 형질 6색 매핑 — 막대 색만 봐도 어떤 형질인지 읽힌다.
      fill.style.cssText = `height:100%; width:0%; border-radius:2px; background:${traitColor(key)};`;
      track.appendChild(fill);
      cell.appendChild(track);
      traitFills.set(key, fill);
    }
    traitsGrid.appendChild(cell);
    traitVals.set(key, val);
  }

  root.append(header, sub, energyRow, lifeRow, traitsLabel, traitsGrid);
  document.body.appendChild(root);

  const update = (data: CreatureCardData | null): void => {
    if (!data) {
      root.style.display = "none";
      return;
    }
    root.style.display = "block";
    dot.style.background = hex(data.color);
    name.textContent = data.name;
    name.style.color = data.isPlayer ? "var(--lime)" : "var(--ink)";
    sub.textContent = `${data.speciesName} · ${data.descriptor}`;

    const e = Math.max(0, Math.min(1, data.energy));
    energyFill.style.width = Math.round(e * 100) + "%";
    energyFill.style.background = energyColor(e);
    energyText.textContent = energyWord(e);
    energyText.style.color = energyColor(e);

    ageText.textContent = `나이 ${Math.floor(data.ageSeconds)}초 · ${data.sizeText}`;
    activityText.textContent = data.activity;

    for (const key of TRAIT_KEYS) {
      const v = data.traits[key];
      const valEl = traitVals.get(key);
      if (valEl) valEl.textContent = key === "diet" ? dietWord(v) : String(Math.round(v)); // 0~100 자연수
      const fillEl = traitFills.get(key);
      if (fillEl) fillEl.style.width = Math.round(Math.max(0, Math.min(100, v))) + "%"; // 형질 0~100
    }
  };

  return { update };
}
