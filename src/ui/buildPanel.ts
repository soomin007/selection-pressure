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

  const list = document.createElement("div");
  body.append(headline, list);

  let collapsed = true; // 기본 접힘(모바일 클러터 최소화). 탭하면 펼침.
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
