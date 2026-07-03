// 형질 조절 패널 (Phase 2 탐색 도구). PixiJS 캔버스 위에 얹는 HTML 오버레이 —
// <input type="range"> 는 모바일 터치가 네이티브라 폰에서 매끄럽다.
//
// 슬라이더 = 현재 무리에 즉시 적용(공유 게놈을 그 자리에서 수정).
// "같은 환경에서 다시" = 같은 맵에 현재 형질로 새 런(공정 비교).
// "새 환경" = 맵을 새로 뽑는다.
//
// 이건 탐색/검증용 도구다. 실제 게임 UI(카드 3장 드래프트)는 Phase 4.

import type { Genome, Traits } from "@/sim/genome";
import { TRAIT_LABELS } from "@/sim/genome";

/** 현재 행동에 연결된, 만질 수 있는 형질만 노출한다. (날개=비행 65↑ / 독침·원거리=전투) */
const EDITABLE: (keyof Traits)[] = ["speed", "vision", "metabolism", "fertility", "wings", "venom", "ranged"];

export interface TraitPanelOptions {
  genome: Genome;
  onLiveChange: (trait: keyof Traits, value: number) => void;
  onRestartSameEnv: () => void;
  onNewEnv: () => void;
}

export function createTraitPanel(opts: TraitPanelOptions): void {
  injectStyles();

  const root = document.createElement("div");
  root.className = "tp-root";

  const header = document.createElement("button");
  header.className = "tp-header";

  const body = document.createElement("div");
  body.className = "tp-body";

  let open = true;
  const renderHeader = (): void => {
    header.textContent = open ? "형질 조절  ▾" : "형질 조절  ▸";
  };
  renderHeader();
  header.addEventListener("click", () => {
    open = !open;
    body.style.display = open ? "block" : "none";
    renderHeader();
  });

  for (const key of EDITABLE) {
    const row = document.createElement("div");
    row.className = "tp-row";

    const top = document.createElement("div");
    top.className = "tp-rowtop";
    const name = document.createElement("span");
    name.textContent = TRAIT_LABELS[key];
    const val = document.createElement("span");
    val.className = "tp-val";
    val.textContent = fmt(opts.genome.traits[key]);
    top.appendChild(name);
    top.appendChild(val);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(opts.genome.traits[key]);
    slider.className = "tp-slider";
    slider.addEventListener("input", () => {
      const v = Number(slider.value);
      val.textContent = fmt(v);
      opts.onLiveChange(key, v);
    });

    row.appendChild(top);
    row.appendChild(slider);
    body.appendChild(row);
  }

  const btns = document.createElement("div");
  btns.className = "tp-btns";
  btns.appendChild(makeButton("같은 환경에서 다시", opts.onRestartSameEnv));
  btns.appendChild(makeButton("새 환경", opts.onNewEnv));
  body.appendChild(btns);

  const hint = document.createElement("div");
  hint.className = "tp-hint";
  hint.textContent =
    "슬라이더는 지금 무리에 바로 적용됩니다. 같은 맵에서 형질만 바꿔 비교하려면 ‘같은 환경에서 다시’. (전투·무리·식성 형질은 곧 추가)";
  body.appendChild(hint);

  root.appendChild(header);
  root.appendChild(body);
  document.body.appendChild(root);
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tp-btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function fmt(v: number): string {
  return String(Math.round(v)); // 형질 0~100 자연수
}

function injectStyles(): void {
  if (document.getElementById("tp-style")) return;
  const style = document.createElement("style");
  style.id = "tp-style";
  style.textContent = `
  .tp-root {
    position: fixed; left: 50%; bottom: 0; transform: translateX(-50%);
    width: min(100%, 520px); box-sizing: border-box;
    background: rgba(11, 14, 20, 0.92); color: #e6e6e6;
    font-family: system-ui, -apple-system, sans-serif;
    border-top-left-radius: 14px; border-top-right-radius: 14px;
    box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.45);
    z-index: 10; touch-action: auto; user-select: none;
  }
  .tp-header {
    width: 100%; border: 0; background: transparent; color: #e6e6e6;
    font-size: 16px; font-weight: 700; text-align: left;
    padding: 12px 16px; cursor: pointer; touch-action: auto;
  }
  .tp-body { padding: 0 16px 14px; }
  .tp-row { margin-bottom: 12px; }
  .tp-rowtop { display: flex; justify-content: space-between; font-size: 15px; margin-bottom: 4px; }
  .tp-val { color: #6cc24a; font-variant-numeric: tabular-nums; }
  .tp-slider { width: 100%; height: 28px; accent-color: #6cc24a; touch-action: auto; }
  .tp-btns { display: flex; gap: 10px; margin-top: 4px; }
  .tp-btn {
    flex: 1; padding: 12px; border: 1px solid #2a3346; border-radius: 10px;
    background: #161b26; color: #e6e6e6; font-size: 15px; font-weight: 600;
    cursor: pointer; touch-action: auto;
  }
  .tp-btn:active { background: #20283a; }
  .tp-hint { margin-top: 10px; font-size: 12.5px; line-height: 1.5; color: #8a93a6; }
  `;
  document.head.appendChild(style);
}
