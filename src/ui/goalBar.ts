// 목표 한 줄 + 접이식 상세 패널 — 갈아엎은 상시 HUD 의 전부다(2026-08-02 사용자 A안 확정).
// 화면에 늘 떠 있는 것은 "지금 할 일" 한 줄과 멈춤 버튼 하나뿐이고, 나머지 정보(시대·레벨·개체 수·
// 시간·배속·패널 열기)는 그 줄을 탭했을 때만 아래로 펼쳐진다. 정보를 없앤 게 아니라 "원할 때만
// 보이게" 옮긴 것 — 상시 화면은 월드에 양보한다.
//
// "뭘 하려는 건지 모르겠다"(사용자)에 대한 대답이 이 한 줄이다: 지금 단계에서 해야 할 일을
// 게임 상태에서 자동으로 뽑아 문장으로 보여준다(채집=먹여 키우기, 보스=물리치거나 버티기, …).

import { ensurePanelStyles } from "@/ui/panelStyles";

export interface GoalBarCallbacks {
  onPauseToggle: () => void;
  onSpeedCycle: () => void;
  onTraitsToggle: () => void;
  onGlossary: () => void;
}

export interface GoalData {
  visible: boolean;
  text: string; // 지금 할 일 한 줄
  sub: string; // 보조 설명(빈 문자열이면 줄 자체를 숨김)
  stage: string; // "1시대 · 채집" 등
  level: number;
  xp01: number; // 다음 카드까지 진행(0~1)
  mine: number;
  wild: number;
  followers: number; // 따르는 무리(조종 밖이면 -1 → 줄 숨김)
  seconds: number;
  night: boolean;
}

export interface GoalBar {
  update: (d: GoalData) => void;
  setPaused: (p: boolean) => void;
  setSpeed: (s: number) => void;
  collapse: () => void; // 상세 패널 접기(단계 전환·드래프트 진입 때 main 이 부른다)
}

export function createGoalBar(cb: GoalBarCallbacks): GoalBar {
  ensurePanelStyles();
  ensureGoalStyles();

  const root = document.createElement("div");
  root.className = "goal-root";
  root.style.display = "none";

  const pill = document.createElement("button");
  pill.className = "goal-pill";
  pill.title = "탭하면 자세한 정보가 열립니다";
  const textEl = document.createElement("div");
  textEl.className = "goal-text";
  const subEl = document.createElement("div");
  subEl.className = "goal-sub";
  pill.append(textEl, subEl);

  const pauseBtn = document.createElement("button");
  pauseBtn.className = "goal-pause";
  pauseBtn.textContent = "⏸";
  pauseBtn.title = "멈춤/이어하기 (Space)";
  pauseBtn.addEventListener("click", cb.onPauseToggle);

  root.append(pill, pauseBtn);
  document.body.appendChild(root);

  // 상세 패널 — 옛 상태 바·칩이 담던 정보의 새 집. 필요할 때만 연다.
  const panel = document.createElement("div");
  panel.className = "goal-panel";
  panel.style.display = "none";

  const stageRow = row(panel);
  const levelRow = row(panel);
  const xpTrack = document.createElement("div");
  xpTrack.className = "goal-xp";
  const xpFill = document.createElement("div");
  xpFill.className = "goal-xp-fill";
  xpTrack.appendChild(xpFill);
  panel.appendChild(xpTrack);
  const countRow = row(panel);
  const timeRow = row(panel);

  const btnRow = document.createElement("div");
  btnRow.className = "goal-btnrow";
  const speedBtn = panelButton("1x", "배속 바꾸기 (1·2·3)", cb.onSpeedCycle);
  const traitsBtn = panelButton("내 형질", "지금 종의 형질 보기", () => {
    cb.onTraitsToggle();
    hidePanel();
  });
  const glossaryBtn = panelButton("대백과", "생물·규칙 설명 (G)", () => {
    cb.onGlossary();
    hidePanel();
  });
  btnRow.append(speedBtn, traitsBtn, glossaryBtn);
  panel.appendChild(btnRow);
  document.body.appendChild(panel);

  let open = false;
  const hidePanel = (): void => {
    open = false;
    panel.style.display = "none";
  };
  pill.addEventListener("click", () => {
    open = !open;
    panel.style.display = open ? "flex" : "none";
  });

  // DOM 쓰기는 값이 바뀔 때만 — 매 프레임 textContent 대입은 폰에서 레이아웃 비용이 된다.
  const cache = new Map<HTMLElement, string>();
  const setText = (el: HTMLElement, s: string): void => {
    if (cache.get(el) !== s) {
      cache.set(el, s);
      el.textContent = s;
    }
  };

  return {
    update: (d: GoalData): void => {
      const vis = d.visible ? "flex" : "none";
      if (root.style.display !== vis) {
        root.style.display = vis;
        if (!d.visible) hidePanel();
      }
      if (!d.visible) return;
      setText(textEl, d.text);
      setText(subEl, d.sub);
      const subVis = d.sub ? "block" : "none";
      if (subEl.style.display !== subVis) subEl.style.display = subVis;
      if (!open) return; // 패널이 닫혀 있으면 상세 갱신도 생략(비용 0)
      setText(stageRow, d.stage);
      setText(levelRow, `레벨 ${d.level} · 다음 카드까지 ${Math.round(d.xp01 * 100)}%`);
      xpFill.style.width = `${Math.round(d.xp01 * 100)}%`;
      setText(
        countRow,
        d.followers >= 0
          ? `내 종 ${d.mine} · 따르는 무리 ${d.followers} · 야생 ${d.wild}`
          : `내 종 ${d.mine} · 야생 ${d.wild}`,
      );
      setText(timeRow, `남은 시간 ${d.seconds}초 · ${d.night ? "밤" : "낮"}`);
    },
    setPaused: (p: boolean): void => {
      pauseBtn.textContent = p ? "▶" : "⏸";
    },
    setSpeed: (s: number): void => {
      speedBtn.textContent = `${s}x`;
    },
    collapse: hidePanel,
  };
}

function row(parent: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "goal-row";
  parent.appendChild(el);
  return el;
}

function panelButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "goal-btn";
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function ensureGoalStyles(): void {
  if (document.getElementById("goal-style")) return;
  const s = document.createElement("style");
  s.id = "goal-style";
  // zoom: 데스크톱 확대(--ui-zoom)를 다른 DOM 오버레이와 같은 방식으로 받는다(panelStyles 관례).
  // 드래프트 중에는 phase 게이트(main 의 visible)로 숨으므로 body.draft-open 규칙은 필요 없다.
  s.textContent = `
  .goal-root { position: fixed; top: 8px; left: 8px; right: 8px; z-index: 9; display: flex; gap: 6px;
    align-items: stretch; pointer-events: none; font-family: var(--font-body); zoom: var(--ui-zoom, 1); }
  .goal-pill { pointer-events: auto; flex: 1; min-width: 0; text-align: left; cursor: pointer;
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 7px 12px;
    color: var(--ink); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); }
  .goal-text { font-family: var(--font-title); font-size: 14.5px; line-height: 1.25;
    overflow: hidden; text-overflow: ellipsis; }
  .goal-sub { font-family: var(--font-mono); font-size: 11.5px; opacity: 0.75; margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .goal-pause { pointer-events: auto; width: 42px; border-radius: 12px; cursor: pointer;
    background: var(--panel); border: 1px solid var(--line); color: var(--ink); font-size: 15px;
    backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); flex: none; }
  .goal-panel { position: fixed; top: 62px; left: 8px; z-index: 10; width: min(300px, calc(100% - 16px));
    display: none; flex-direction: column; gap: 7px; padding: 12px; border-radius: 12px;
    background: var(--panel); border: 1px solid var(--line); color: var(--ink);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); zoom: var(--ui-zoom, 1);
    font-family: var(--font-mono); font-size: 12.5px; pointer-events: auto; }
  .goal-row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .goal-xp { height: 5px; border-radius: 999px; background: rgba(255,255,255,0.12); overflow: hidden; }
  .goal-xp-fill { height: 100%; border-radius: 999px; background: var(--lime); width: 0%; }
  .goal-btnrow { display: flex; gap: 6px; margin-top: 2px; }
  .goal-btn { flex: 1; padding: 7px 0; border-radius: 9px; cursor: pointer; background: rgba(255,255,255,0.07);
    border: 1px solid var(--line); color: var(--ink); font-family: var(--font-body); font-size: 12.5px; }
  `;
  document.head.appendChild(s);
}
