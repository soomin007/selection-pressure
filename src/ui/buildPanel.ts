// 빌드 패널 · "내 종이 지금 어디까지 왔나". HUD 의 "내 형질" 칩이 토글하는 패널(좌상단).
// v8: 형질 14개 나열을 버리고 **범주 5개의 티어 + 가진 열쇠 + 켜진 듀오 + 유지비 배수**를 보여준다.
// 목록이 짧아져 스크롤 없이 다 들어간다. 문턱·수치는 전부 sim/tiers 파생값만 읽는다(단일 진실).
// 캔버스 위 HTML 오버레이(인라인 스타일).

import type { Genome } from "@/sim/genome";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  KEY_LABELS,
  KEY_NAMES,
  MAX_TIER,
  TIER_ROMAN,
  activeDuos,
  pipsToNext,
  tierOf,
} from "@/sim/tiers";
import { categoryColor, pipPct, tierTrackBackground } from "@/ui/traitDisplay";
import { ensurePanelStyles } from "@/ui/panelStyles";

export interface BuildData {
  headline: string; // "빠른 잡식성" 같은 종 한 줄 요약
  genome: Genome; // 현재 종 게놈 · 도장(티어)·열쇠·파생 유지비를 여기서 읽는다
  cards: string[]; // 이번 런에서 고른 카드 이름들
}

export interface BuildPanel {
  setData: (data: BuildData) => void;
  setVisible: (v: boolean) => void;
}

export function createBuildPanel(): BuildPanel {
  ensurePanelStyles(); // :root 토큰 보장
  const isDesktop = document.body?.dataset.layout === "desktop";
  const root = document.createElement("div");
  // 화면 상단 왼쪽, 목표 한 줄 아래로 펼쳐지는 자리. v8 에서 내용이 짧아져 보통은 스크롤이 없지만,
  // 고른 카드가 많이 쌓이는 후반 대비로 최대 높이 안전망은 남긴다.
  root.style.cssText =
    (isDesktop
      ? "position:fixed; top:140px; left:16px;"
      : "position:fixed; top:calc(144px + env(safe-area-inset-top)); left:calc(8px + env(safe-area-inset-left));") +
    "width:190px; box-sizing:border-box; padding:10px 12px; max-height:420px; overflow-y:auto;" +
    "background:var(--panel); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px);" +
    "border:1px solid var(--line); border-radius:var(--r-card);" +
    "color:var(--ink); font-family:var(--font-body); font-size:12px; line-height:1.4;" +
    "z-index:9; pointer-events:auto; user-select:none; display:none;";

  const body = document.createElement("div");

  const headline = document.createElement("div");
  headline.style.cssText =
    "color:var(--lime); font-family:var(--font-title); font-size:12.5px; margin-bottom:7px; word-break:keep-all;";

  // 범주 5 티어 · 막대의 눈금(3·8·14·21)이 다음 문턱까지의 거리를 그대로 보여준다.
  const tiersLabel = document.createElement("div");
  tiersLabel.textContent = "범주 티어";
  tiersLabel.style.cssText =
    "color:var(--faint); font-family:var(--font-mono); font-size:10px; letter-spacing:0.14em; margin:2px 0 5px;";
  const tiersBox = document.createElement("div");
  tiersBox.style.cssText = "margin-bottom:8px;";

  // 열쇠 · 듀오 · 유지비.
  const keysLine = document.createElement("div");
  keysLine.style.cssText = "margin-bottom:4px; color:var(--sub); word-break:keep-all;";
  const duosLine = document.createElement("div");
  duosLine.style.cssText = "margin-bottom:4px; color:var(--sub); word-break:keep-all;";
  const upkeepLine = document.createElement("div");
  upkeepLine.style.cssText = "margin-bottom:8px; color:var(--sub);";

  const cardsLabel = document.createElement("div");
  cardsLabel.textContent = "고른 카드";
  cardsLabel.style.cssText =
    "color:var(--faint); font-family:var(--font-mono); font-size:10px; letter-spacing:0.14em; margin:2px 0 5px;";

  const list = document.createElement("div");
  body.append(headline, tiersLabel, tiersBox, keysLine, duosLine, upkeepLine, cardsLabel, list);

  root.appendChild(body);
  document.body.appendChild(root);

  const setData = (data: BuildData): void => {
    headline.textContent = data.headline;
    const g = data.genome;

    // 범주 5: 이름 + 티어(로마 숫자) + 도장 막대(문턱 눈금). 다음 문턱까지 남은 칸도 함께.
    tiersBox.replaceChildren();
    for (const cat of CATEGORIES) {
      const pips = g.pips[cat];
      const t = tierOf(pips);
      const row = document.createElement("div");
      row.style.cssText = "margin-top:4px;";
      const top = document.createElement("div");
      top.style.cssText = "display:flex; justify-content:space-between; gap:6px;";
      const name = document.createElement("span");
      name.textContent = CATEGORY_LABELS[cat];
      name.style.cssText = `color:${t > 0 ? categoryColor(cat) : "var(--sub)"};`;
      const val = document.createElement("span");
      const remain = pipsToNext(pips);
      val.textContent =
        t >= MAX_TIER
          ? TIER_ROMAN[MAX_TIER]
          : `${TIER_ROMAN[t] || "·"}${remain > 0 && pips > 0 ? ` · ${remain}칸` : ""}`;
      val.style.cssText =
        "color:var(--ink); font-family:var(--font-mono); font-size:11px; font-variant-numeric:tabular-nums;";
      top.append(name, val);
      row.appendChild(top);

      const track = document.createElement("div");
      track.style.cssText =
        "margin-top:2px; height:4px; border-radius:3px; background-color:rgba(255,255,255,0.06);" +
        ` overflow:hidden; position:relative; background-image:${tierTrackBackground()};`;
      const fill = document.createElement("div");
      fill.style.cssText =
        `height:100%; width:${pipPct(pips)}%; border-radius:3px; background:${categoryColor(cat)};` +
        `opacity:${t > 0 ? 1 : 0.55};`;
      track.appendChild(fill);
      row.appendChild(track);
      tiersBox.appendChild(row);
    }

    // 열쇠 · 있으면 이름을, 없으면 "없음"을. 열쇠의 세기는 짝지어진 범주 티어가 정한다(tiers.ts).
    const owned = KEY_NAMES.filter((k) => g.keys[k]).map((k) => KEY_LABELS[k]);
    keysLine.textContent = `열쇠: ${owned.join(" · ") || "없음"}`;

    // 듀오 · 두 범주가 함께 3단 이상일 때 켜지는 합체 형질. 없어도 줄은 보여 "이런 게 있다"를 알린다.
    const duos = activeDuos(g.pips);
    duosLine.textContent = `듀오: ${duos.map((d) => d.name).join(" · ") || "없음"}`;
    duosLine.title = duos.map((d) => `${d.name}: ${d.desc}`).join("\n");

    // 유지비 배수 · 티어 합이 올린 청구서. 파생값(traits.upkeep)을 그대로 읽는다.
    upkeepLine.textContent = `유지비 ×${g.traits.upkeep.toFixed(2)}`;

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
