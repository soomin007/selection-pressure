// 빌드 패널 — 화면 우상단에 "내가 고른 형질(카드)"을 상시 보여준다.
// 종 한 줄 요약 + 현재 형질값(7개) + 고른 카드 목록. 캔버스 위 HTML 오버레이(인라인 스타일, 터치 통과).

import { TRAIT_KEYS, TRAIT_LABELS, type Traits } from "@/sim/genome";

export interface BuildData {
  headline: string; // "빠른 잡식성" 같은 종 한 줄 요약
  traits: Traits; // 현재 게놈의 형질값(카드 누적 결과) — "내 종이 지금 얼마인지"
  cards: string[]; // 이번 런에서 고른 카드 이름들
}

/** 식성값을 쉬운 범주로. (형질 도감과 같은 경계) */
function dietWord(v: number): string {
  return v < 0.35 ? "초식" : v > 0.7 ? "육식" : "잡식";
}

export interface BuildPanel {
  setData: (data: BuildData) => void;
  setVisible: (v: boolean) => void;
}

export function createBuildPanel(): BuildPanel {
  const root = document.createElement("div");
  // 컨트롤바(우상단 top:12 높이 42)와 안 겹치게 그 아래로 내린다(모바일 겹침 해소).
  root.style.cssText =
    "position:fixed; top:62px; right:12px; width:138px; box-sizing:border-box; padding:8px 10px;" +
    "background:rgba(11,14,20,0.82); border:1px solid #2a3346; border-radius:10px;" +
    "color:#dfe6ee; font-family:system-ui,-apple-system,sans-serif; font-size:12px; line-height:1.4;" +
    "z-index:9; pointer-events:none; user-select:none; display:none;";

  // 헤더(탭하면 접기/펴기). 헤더만 클릭 가능(pointer-events:auto), 본문 영역은 터치 통과.
  const header = document.createElement("div");
  header.style.cssText =
    "display:flex; align-items:center; justify-content:space-between; gap:6px;" +
    "cursor:pointer; pointer-events:auto;";
  const title = document.createElement("span");
  title.textContent = "선택한 형질";
  title.style.cssText = "font-weight:700; font-size:12px; color:#aeb7c4;";
  const arrow = document.createElement("span");
  arrow.style.cssText = "font-size:11px; color:#aeb7c4;";
  header.append(title, arrow);

  const body = document.createElement("div");
  body.style.cssText = "margin-top:5px;";

  const headline = document.createElement("div");
  headline.style.cssText =
    "color:#9bffa0; font-weight:700; font-size:12.5px; margin-bottom:6px; word-break:keep-all;";

  // 현재 형질값 readout — "내 종이 지금 얼마인지". 카드 누적 결과를 그대로 보여준다.
  const traitsLabel = document.createElement("div");
  traitsLabel.textContent = "현재 형질";
  traitsLabel.style.cssText = "color:#8a93a6; font-weight:700; font-size:11px; margin:2px 0 4px;";
  const traitsBox = document.createElement("div");
  traitsBox.style.cssText = "margin-bottom:7px;";

  const cardsLabel = document.createElement("div");
  cardsLabel.textContent = "고른 카드";
  cardsLabel.style.cssText = "color:#8a93a6; font-weight:700; font-size:11px; margin:2px 0 4px;";

  const list = document.createElement("div");
  body.append(headline, traitsLabel, traitsBox, cardsLabel, list);

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

    // 현재 형질값: 7개를 값+미니 막대로. 식성만 범주(초식/잡식/육식) 텍스트.
    traitsBox.replaceChildren();
    for (const key of TRAIT_KEYS) {
      const v = data.traits[key];
      const row = document.createElement("div");
      row.style.cssText = "margin-top:3px;";
      const top = document.createElement("div");
      top.style.cssText = "display:flex; justify-content:space-between; gap:6px;";
      const name = document.createElement("span");
      name.textContent = TRAIT_LABELS[key];
      name.style.cssText = "color:#aeb7c4;";
      const val = document.createElement("span");
      val.textContent = key === "diet" ? dietWord(v) : v.toFixed(2);
      val.style.cssText = "color:#dfe6ee; font-weight:700; font-variant-numeric:tabular-nums;";
      top.append(name, val);
      row.appendChild(top);
      if (key !== "diet") {
        const track = document.createElement("div");
        track.style.cssText = "margin-top:2px; height:4px; border-radius:3px; background:#1a2230; overflow:hidden;";
        const fill = document.createElement("div");
        const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
        fill.style.cssText = "height:100%; width:" + pct + "%; border-radius:3px; background:#6cc24a;";
        track.appendChild(fill);
        row.appendChild(track);
      }
      traitsBox.appendChild(row);
    }

    list.replaceChildren();
    if (data.cards.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "아직 고른 카드 없음";
      empty.style.cssText = "color:#7b8595;";
      list.appendChild(empty);
      return;
    }
    data.cards.forEach((name, i) => {
      const row = document.createElement("div");
      row.textContent = `${i + 1}. ${name}`;
      row.style.cssText = "color:#cdd5df; word-break:keep-all; margin-top:2px;";
      list.appendChild(row);
    });
  };

  const setVisible = (v: boolean): void => {
    root.style.display = v ? "block" : "none";
  };

  return { setData, setVisible };
}
