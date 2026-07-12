// 빌드 패널 — 화면 우상단에 "내가 고른 형질(카드)"을 상시 보여준다.
// 종 한 줄 요약 + 현재 형질값(7개) + 고른 카드 목록. 캔버스 위 HTML 오버레이(인라인 스타일, 터치 통과).

import { TRAIT_KEYS, TRAIT_LABELS, TRAIT_CEILING, type Traits } from "@/sim/genome";
import { ABILITY_KEYS, abilityLevel, abilityWord, traitColor } from "@/ui/traitDisplay";
import { ensurePanelStyles } from "@/ui/panelStyles";
import { huntingBuild } from "@/game/runReport";

export interface BuildData {
  headline: string; // "빠른 잡식성" 같은 종 한 줄 요약
  traits: Traits; // 현재 게놈의 형질값(카드 누적 결과) — "내 종이 지금 얼마인지"
  cards: string[]; // 이번 런에서 고른 카드 이름들
}

/** 식성값을 쉬운 범주로. (형질 도감과 같은 경계) */
function dietWord(v: number): string {
  return v < 35 ? "초식" : v > 70 ? "육식" : "잡식";
}

export interface BuildPanel {
  setData: (data: BuildData) => void;
  setVisible: (v: boolean) => void;
}

export function createBuildPanel(): BuildPanel {
  ensurePanelStyles(); // :root 토큰 보장
  const root = document.createElement("div");
  // 컨트롤바(우상단 top:12 높이 42)와 안 겹치게 그 아래로 내린다(모바일 겹침 해소).
  root.style.cssText =
    "position:fixed; top:calc(62px + env(safe-area-inset-top)); right:calc(12px + env(safe-area-inset-right));" +
    "width:138px; box-sizing:border-box; padding:9px 11px;" +
    "background:var(--panel); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px);" +
    "border:1px solid var(--line); border-radius:var(--r-panel);" +
    "color:var(--ink); font-family:var(--font-body); font-size:12px; line-height:1.4;" +
    "z-index:9; pointer-events:none; user-select:none; display:none;";

  // 헤더(탭하면 접기/펴기). 헤더만 클릭 가능(pointer-events:auto), 본문 영역은 터치 통과.
  const header = document.createElement("div");
  header.style.cssText =
    "display:flex; align-items:center; justify-content:space-between; gap:6px;" +
    "cursor:pointer; pointer-events:auto;";
  const title = document.createElement("span");
  title.textContent = "선택한 형질";
  title.style.cssText = "font-family:var(--font-title); font-size:12.5px; color:var(--ink);";
  const arrow = document.createElement("span");
  arrow.style.cssText = "font-size:11px; color:var(--faint);";
  header.append(title, arrow);

  const body = document.createElement("div");
  body.style.cssText = "margin-top:6px;";

  const headline = document.createElement("div");
  headline.style.cssText =
    "color:var(--lime); font-family:var(--font-title); font-size:12.5px; margin-bottom:7px; word-break:keep-all;";

  // 사냥형(육식 빌드) 줄 — 순수 육식이면 무슨 사냥법인지, 잡식이면 "육식이면 켜진다"를 알린다. 사냥형이
  // 아니면 숨긴다. (사용자 지적: 육식 성향 구분이 안 보임 + diet<70 이면 사냥 특기가 조용히 꺼지는 함정.)
  const huntLine = document.createElement("div");
  huntLine.style.cssText = "font-size:11px; margin-bottom:7px; word-break:keep-all; display:none;";

  // 현재 형질값 readout — "내 종이 지금 얼마인지". 카드 누적 결과를 그대로 보여준다.
  const traitsLabel = document.createElement("div");
  traitsLabel.textContent = "현재 형질";
  traitsLabel.style.cssText = "color:var(--faint); font-family:var(--font-mono); font-size:10px; letter-spacing:0.14em; margin:2px 0 5px;";
  const traitsBox = document.createElement("div");
  traitsBox.style.cssText = "margin-bottom:8px;";

  const cardsLabel = document.createElement("div");
  cardsLabel.textContent = "고른 카드";
  cardsLabel.style.cssText = "color:var(--faint); font-family:var(--font-mono); font-size:10px; letter-spacing:0.14em; margin:2px 0 5px;";

  const list = document.createElement("div");
  body.append(headline, huntLine, traitsLabel, traitsBox, cardsLabel, list);

  // 레이아웃별 기본값: 데스크톱은 펼침(공간 여유), 모바일은 접힘(클러터 최소화). 탭으로 토글.
  let collapsed = document.body.dataset.layout !== "desktop";
  const applyCollapsed = (): void => {
    body.style.display = collapsed ? "none" : "block";
    arrow.textContent = collapsed ? "▸" : "▾";
    root.style.width = collapsed ? "auto" : "138px"; // 접으면 칩처럼 폭만 차지
  };
  header.addEventListener("click", () => {
    collapsed = !collapsed;
    applyCollapsed();
  });
  applyCollapsed();

  root.append(header, body);
  document.body.appendChild(root);

  const setData = (data: BuildData): void => {
    headline.textContent = data.headline;

    // 사냥형 라벨 — 켜졌으면 초록으로 유형, 잡식이라 꺼졌으면 호박빛으로 "육식이면 켜짐" 안내.
    const hunt = huntingBuild(data.traits);
    if (!hunt) {
      huntLine.style.display = "none";
    } else {
      huntLine.style.display = "block";
      if (hunt.active) {
        huntLine.textContent = `사냥형 · ${hunt.label}`;
        huntLine.style.color = "var(--lime)";
      } else {
        huntLine.textContent = `${hunt.label} 소질 · 육식으로 기울면 특기가 켜집니다`;
        huntLine.style.color = "var(--amber)";
      }
    }

    // 현재 형질값: 7개를 값+미니 막대로. 식성만 범주(초식/잡식/육식) 텍스트.
    traitsBox.replaceChildren();
    for (const key of TRAIT_KEYS) {
      const v = data.traits[key];
      const isAbility = ABILITY_KEYS.has(key);
      const lvl = isAbility ? abilityLevel(key, v) : 0;
      const row = document.createElement("div");
      row.style.cssText = "margin-top:3px;";
      const top = document.createElement("div");
      top.style.cssText = "display:flex; justify-content:space-between; gap:6px;";
      const name = document.createElement("span");
      name.textContent = TRAIT_LABELS[key];
      name.style.cssText = "color:var(--sub);";
      const val = document.createElement("span");
      // 능력형=3단계 단어, 식성=초식/잡식/육식, 나머지=숫자(상한 200 형질은 100 초과도 그대로).
      val.textContent = isAbility ? abilityWord(lvl) : key === "diet" ? dietWord(v) : String(Math.round(v));
      val.style.cssText = "color:var(--ink); font-family:var(--font-mono); font-variant-numeric:tabular-nums;";
      top.append(name, val);
      row.appendChild(top);
      if (key !== "diet") {
        const track = document.createElement("div");
        track.style.cssText = "margin-top:2px; height:4px; border-radius:3px; background:rgba(255,255,255,0.06); overflow:hidden;";
        const fill = document.createElement("div");
        // 능력형은 3단계 눈금(0/50/100%), 연속형은 형질별 상한(200 등) 기준 비율. 색은 형질 6색 매핑.
        const pct = isAbility ? lvl * 50 : Math.round(Math.max(0, Math.min(100, (v / TRAIT_CEILING[key]) * 100)));
        fill.style.cssText = `height:100%; width:${pct}%; border-radius:3px; background:${traitColor(key)};`;
        track.appendChild(fill);
        row.appendChild(track);
      }
      traitsBox.appendChild(row);
    }

    list.replaceChildren();
    if (data.cards.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "아직 고른 카드 없음";
      empty.style.cssText = "color:var(--faint);";
      list.appendChild(empty);
      return;
    }
    data.cards.forEach((name, i) => {
      const row = document.createElement("div");
      row.textContent = `${i + 1}. ${name}`;
      row.style.cssText = "color:var(--sub); word-break:keep-all; margin-top:2px;";
      list.appendChild(row);
    });
  };

  const setVisible = (v: boolean): void => {
    root.style.display = v ? "block" : "none";
  };

  return { setData, setVisible };
}
