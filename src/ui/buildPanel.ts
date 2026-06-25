// 빌드 패널 — 화면 우상단에 "내가 고른 형질(카드)"을 상시 보여준다.
// 종 한 줄 요약 + 고른 카드 목록. 캔버스 위 HTML 오버레이(인라인 스타일, 터치 통과).

export interface BuildData {
  headline: string; // "빠른 잡식성" 같은 종 한 줄 요약
  cards: string[]; // 이번 런에서 고른 카드 이름들
}

export interface BuildPanel {
  setData: (data: BuildData) => void;
  setVisible: (v: boolean) => void;
}

export function createBuildPanel(): BuildPanel {
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed; top:8px; right:8px; width:138px; box-sizing:border-box; padding:8px 10px;" +
    "background:rgba(11,14,20,0.82); border:1px solid #2a3346; border-radius:10px;" +
    "color:#dfe6ee; font-family:system-ui,-apple-system,sans-serif; font-size:12px; line-height:1.4;" +
    "z-index:9; pointer-events:none; user-select:none; display:none;";

  const title = document.createElement("div");
  title.textContent = "선택한 형질";
  title.style.cssText = "font-weight:700; font-size:12px; color:#aeb7c4; margin-bottom:5px;";

  const headline = document.createElement("div");
  headline.style.cssText =
    "color:#9bffa0; font-weight:700; font-size:12.5px; margin-bottom:6px; word-break:keep-all;";

  const list = document.createElement("div");

  root.append(title, headline, list);
  document.body.appendChild(root);

  const setData = (data: BuildData): void => {
    headline.textContent = data.headline;
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
