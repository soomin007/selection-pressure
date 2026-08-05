// 목표 한 줄 + 접이식 상세 패널 · 갈아엎은 상시 HUD 의 전부다(2026-08-02 사용자 A안 확정).
// 화면에 늘 떠 있는 것은 "지금 할 일" 한 줄과 멈춤 버튼 하나뿐이고, 나머지 정보(시대·레벨·개체 수·
// 시간·배속·패널 열기)는 그 줄을 탭했을 때만 아래로 펼쳐진다. 정보를 없앤 게 아니라 "원할 때만
// 보이게" 옮긴 것 · 상시 화면은 월드에 양보한다.
//
// "뭘 하려는 건지 모르겠다"(사용자)에 대한 대답이 이 한 줄이다: 지금 단계에서 해야 할 일을
// 게임 상태에서 자동으로 뽑아 문장으로 보여준다(채집=먹여 키우기, 보스=물리치거나 버티기, …).
//
// 2026-08-05 사용자 요구 둘을 여기서 푼다.
//  ① "펼쳤을 때 반투명하게 · 화면이 갑갑하지 않게": 상세 패널을 유리처럼 만들어 뒤의 월드가 비쳐
//     보이게 한다. 다만 **글씨 대비가 우선**이라 배경을 그냥 옅게만 하지 않고 backdrop 을 어둡게
//     눌러(brightness) 깔고 글씨에 그림자를 준다. blur 반경은 폰 부담을 생각해 작게(7px) 잡고,
//     backdrop-filter 를 못 쓰는 기기에는 거의 불투명한 배경을 폴백으로 둔다.
//  ② "탭하면 펼치기/접기가 된다는 걸 한눈에": 알약 오른쪽 끝에 펼침 화살표(∨/∧)를 둔다. 글씨로
//     "탭해서 펼치기"라고 적으면 상시 HUD 가 한 줄 더 늘고 화면이 어지러워지므로 표식으로 푼다.
//     화살표는 열리면 뒤집히고(상태를 그 자리에서 말한다), 한 번도 안 열어 봤으면 천천히 깜빡여
//     시선을 부른다(한 번 열면 그친다 · 잔소리는 한 번이면 족하다).
//
// 구조 메모: 상세 패널은 알약과 **같은 뿌리(.goal-root)의 아래 칸**이다. 예전엔 화면에 따로 붙인
// position:fixed + top:62px 이라, 안내 줄이 두 줄로 늘면 알약이 그 62px 를 넘어 패널과 겹칠 수
// 있었다(반투명해지면 겹침이 더 잘 보인다). 세로 flex 로 이어 붙이면 겹칠 수가 없다.

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
  followers: number; // 지금 뜻을 향해 움직이는 수(뜻이 없으면 -1 → 상세 패널 줄 숨김)
  /** 접힌 기본 알약에 상시로 붙는 짧은 칩("따르는 중 3/5"·"무리 도착"). 빈 문자열이면 숨긴다.
   *  분모는 내 종 전부가 아니라 **아직 목표에 못 닿은 수**(world.orderPending)다 · 전부를 분모로
   *  쓰면 도착한 개체가 불복종처럼 읽힌다(2026-08-05). 문구를 main 이 만드는 이유: 도착 여부처럼
   *  월드를 봐야 아는 것이 섞여 있다(여기선 그리기만). */
  follow: string;
  seconds: number;
  night: boolean;
}

export interface GoalBar {
  update: (d: GoalData) => void;
  setPaused: (p: boolean) => void;
  setSpeed: (s: number) => void;
  collapse: () => void; // 상세 패널 접기(단계 전환·드래프트 진입 때 main 이 부른다)
  /** 펼치기/접기 · 데스크톱 키(I)용. 탭이 없는 환경에서도 같은 문을 열 수 있어야 한다.
   *  (키 라우터가 keydown 마다 포커스를 걷어내므로 알약에 Tab 으로 포커스를 줘도 Enter 가 안 먹는다) */
  toggle: () => void;
  /** 상세 패널이 펼쳐져 있는가. 펼치면 우상단 미니맵을 덮으므로 main 이 미니맵을 숨기는 데 쓴다
   *  (같은 모서리를 쓰는 위젯은 동시에 두지 않고 상태로 나눠 쓴다 · known_issues). */
  isOpen: () => boolean;
}

export function createGoalBar(cb: GoalBarCallbacks): GoalBar {
  ensurePanelStyles();
  ensureGoalStyles();

  const root = document.createElement("div");
  root.className = "goal-root";
  root.style.display = "none";

  // 윗칸 · 늘 보이는 줄(알약 + 멈춤).
  const head = document.createElement("div");
  head.className = "goal-head";

  const pill = document.createElement("button");
  pill.className = "goal-pill";
  pill.type = "button";
  pill.title = "탭하면 자세한 정보가 열립니다 (I)";
  pill.setAttribute("aria-expanded", "false");
  pill.setAttribute("aria-controls", "goal-panel");
  // 알약 = [글 묶음][펼침 화살표]. 화살표를 첫 줄 안에 넣지 않고 알약 오른쪽 끝에 세로 가운데로
  // 두는 이유: 안내 줄이 두 줄로 늘어도 화살표 자리가 안 흔들린다(펼침 표식은 늘 같은 자리에).
  const pillBody = document.createElement("div");
  pillBody.className = "goal-pill-body";
  // 첫 줄은 "할 일 + 순종 칩"이 한 줄을 나눠 쓴다(flex). 칩을 아래 sub 줄에 붙이면 기한·불씨와
  // 뒤엉키고, 새 줄로 빼면 상시 HUD 가 한 줄 더 늘어난다.
  const line = document.createElement("div");
  line.className = "goal-line";
  const textEl = document.createElement("div");
  textEl.className = "goal-text";
  const followEl = document.createElement("span");
  followEl.className = "goal-follow";
  followEl.style.display = "none";
  line.append(textEl, followEl);
  const subEl = document.createElement("div");
  subEl.className = "goal-sub";
  pillBody.append(line, subEl);
  // 화살표는 CSS 로 그린 꺾쇠다(글자 아님) · 폰트에 없는 글리프로 깨질 일이 없고, 화면 낭독기에는
  // 알약의 aria-expanded 가 이미 상태를 말하므로 표식 자체는 숨긴다.
  const caret = document.createElement("span");
  caret.className = "goal-caret hint";
  caret.setAttribute("aria-hidden", "true");
  pill.append(pillBody, caret);

  const pauseBtn = document.createElement("button");
  pauseBtn.className = "goal-pause";
  pauseBtn.type = "button";
  pauseBtn.textContent = "⏸";
  pauseBtn.title = "멈춤/이어하기 (Space)";
  pauseBtn.addEventListener("click", cb.onPauseToggle);

  head.append(pill, pauseBtn);

  // 상세 패널 · 옛 상태 바·칩이 담던 정보의 새 집. 필요할 때만 연다.
  const panel = document.createElement("div");
  panel.className = "goal-panel";
  panel.id = "goal-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "자세한 정보");
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
    setOpen(false);
  });
  const glossaryBtn = panelButton("대백과", "생물·규칙 설명 (G)", () => {
    cb.onGlossary();
    setOpen(false);
  });
  btnRow.append(speedBtn, traitsBtn, glossaryBtn);
  panel.appendChild(btnRow);

  root.append(head, panel);
  document.body.appendChild(root);

  let open = false;
  let hintOn = true; // 아직 한 번도 안 펼쳐 봤다 → 화살표가 깜빡여 "여기를 눌러 보라"고 말한다
  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    panel.style.display = next ? "flex" : "none";
    pill.classList.toggle("open", next);
    pill.setAttribute("aria-expanded", next ? "true" : "false");
    if (next && hintOn) {
      hintOn = false; // 한 번 열어 봤으면 알림은 끝. 계속 깜빡이면 그때부턴 잔소리다.
      caret.classList.remove("hint");
    }
  }
  pill.addEventListener("click", () => setOpen(!open));

  // DOM 쓰기는 값이 바뀔 때만 · 매 프레임 textContent 대입은 폰에서 레이아웃 비용이 된다.
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
        if (!d.visible) setOpen(false);
      }
      if (!d.visible) return;
      setText(textEl, d.text);
      setText(subEl, d.sub);
      const subVis = d.sub ? "block" : "none";
      if (subEl.style.display !== subVis) subEl.style.display = subVis;
      setText(followEl, d.follow);
      const followVis = d.follow ? "inline-block" : "none";
      if (followEl.style.display !== followVis) followEl.style.display = followVis;
      if (!open) return; // 패널이 닫혀 있으면 상세 갱신도 생략(비용 0)
      setText(stageRow, d.stage);
      setText(levelRow, `레벨 ${d.level} · 다음 카드까지 ${Math.round(d.xp01 * 100)}%`);
      xpFill.style.width = `${Math.round(d.xp01 * 100)}%`;
      setText(
        countRow,
        d.followers >= 0
          ? `내 종 ${d.mine} · 뜻을 따르는 중 ${d.followers} · 야생 ${d.wild}`
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
    collapse: (): void => setOpen(false),
    toggle: (): void => setOpen(!open),
    isOpen: () => open,
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
  b.type = "button";
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
  // 뿌리에 한 번만 걸면 안쪽(알약·상세 패널)이 함께 확대된다 · 안쪽에 또 걸면 배율이 두 번 곱해진다.
  // 드래프트 중에는 phase 게이트(main 의 visible)로 숨으므로 body.draft-open 규칙은 필요 없다.
  s.textContent = `
  .goal-root { position: fixed; top: 8px; left: 8px; right: 8px; z-index: 9; display: flex;
    flex-direction: column; gap: 6px; pointer-events: none; font-family: var(--font-body);
    zoom: var(--ui-zoom, 1); }
  .goal-head { display: flex; gap: 6px; align-items: stretch; }
  .goal-pill { pointer-events: auto; flex: 1; min-width: 0; text-align: left; cursor: pointer;
    display: flex; align-items: center; gap: 9px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 7px 12px;
    color: var(--ink); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
    transition: transform 0.07s ease, border-color 0.15s ease; }
  /* 눌리는 느낌 · 이 알약이 "버튼"임을 손끝으로도 알린다(패널 버튼과 같은 관례). */
  .goal-pill:active { transform: translateY(1px); }
  /* 펼쳐진 동안엔 테두리를 한 단계 밝혀, 아래 유리 패널이 이 알약에서 나온 것임을 잇는다. */
  .goal-pill.open { border-color: rgba(245, 235, 220, 0.30); }
  .goal-pill-body { flex: 1; min-width: 0; }
  /* 펼침 화살표 · 글씨가 아니라 CSS 로 그린 꺾쇠(∨). 접힘 ∨ / 펼침 ∧ 로 뒤집혀 지금 상태까지 말한다. */
  .goal-caret { flex: none; width: 9px; height: 9px; margin-right: 2px; opacity: 0.6;
    border-right: 2px solid currentColor; border-bottom: 2px solid currentColor;
    transform: translateY(-2px) rotate(45deg);
    transition: transform 0.18s ease, opacity 0.18s ease; }
  .goal-pill.open .goal-caret { transform: translateY(2px) rotate(-135deg); opacity: 0.95; }
  /* 아직 한 번도 안 펼쳐 봤을 때만 천천히 깜빡인다 · 글씨 안내를 늘리지 않고 시선만 부른다.
     밝기만 오르내리게 해서 자리가 움직이지 않는다(옆 글씨와 스칠 일이 없다).
     8번(약 21초 · 첫 라운드 길이보다 조금 길다)만 하고 그친다 · 끝까지 깜빡이면 그때부턴 소음이고,
     멈춘 뒤에도 화살표 자체는 그대로 남아 "여길 눌러 편다"를 계속 말한다. */
  .goal-caret.hint { animation: goal-caret-hint 2.6s ease-in-out 8; }
  @keyframes goal-caret-hint { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
  /* 첫 줄 = 할 일 + 순종 칩. 글이 늘어나는 쪽(goal-text)에 min-width:0 을 줘야 칩을 밀어내지 않고
     제 안에서 잘린다(안 주면 flex 기본 min-width:auto 라 칩이 알약 밖으로 밀려난다). */
  .goal-line { display: flex; align-items: baseline; gap: 6px; }
  .goal-text { flex: 1; min-width: 0; font-family: var(--font-title); font-size: 14.5px; line-height: 1.25;
    overflow: hidden; text-overflow: ellipsis; }
  .goal-follow { flex: none; font-family: var(--font-mono); font-size: 10.5px; white-space: nowrap;
    padding: 2px 6px; border-radius: 999px; background: rgba(255,255,255,0.09); opacity: 0.85; }
  /* nowrap 이면 긴 안내가 "..."로 잘려 나간다(사용자 지적). 두 줄까지 접히게 두고, 그걸 넘기면
     그때만 자른다. 문구 자체를 한 줄에 들어오게 짧게 쓰는 게 먼저다(main 의 goalSub 참고). */
  .goal-sub { font-family: var(--font-mono); font-size: 11.5px; opacity: 0.75; margin-top: 2px;
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .goal-pause { pointer-events: auto; width: 42px; border-radius: 12px; cursor: pointer;
    background: var(--panel); border: 1px solid var(--line); color: var(--ink); font-size: 15px;
    backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); flex: none;
    transition: transform 0.07s ease; }
  .goal-pause:active { transform: translateY(1px); }
  /* 상세 패널 · 뒤의 월드가 비쳐 보이는 유리. 배경만 옅게 하면 밝은 지형 위에서 글씨가 묻히므로
     backdrop 자체를 어둡게 눌러 깔고(brightness) 글씨에 그림자를 준다. blur 는 폰 부담을 생각해
     작게(7px) 잡는다. 알약과 같은 뿌리의 아래 칸이라 위치를 따로 계산하지 않는다(겹칠 수 없다). */
  .goal-panel { display: none; flex-direction: column; align-self: flex-start; gap: 7px;
    width: min(300px, 100%); box-sizing: border-box; padding: 12px; border-radius: 12px;
    background: linear-gradient(180deg, rgba(34,26,19,0.44), rgba(24,18,13,0.38));
    border: 1px solid var(--line); color: var(--ink); text-shadow: 0 1px 3px rgba(0,0,0,0.9);
    backdrop-filter: blur(7px) brightness(0.68) saturate(1.05);
    -webkit-backdrop-filter: blur(7px) brightness(0.68) saturate(1.05);
    box-shadow: 0 10px 26px -14px rgba(0,0,0,0.8);
    font-family: var(--font-mono); font-size: 12.5px; pointer-events: auto; }
  /* backdrop-filter 를 못 쓰는 기기(옛 안드로이드 웹뷰 등)에서는 뒤를 어둡게 눌러 줄 수단이 없다
     → 거의 불투명한 배경으로 되돌린다. 반투명보다 읽히는 게 먼저다. */
  @supports not ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
    .goal-panel { background: rgba(26,20,14,0.94); }
  }
  /* 투명 효과를 줄이도록 설정한 사용자에게는 불투명하게(접근성 설정 존중). */
  @media (prefers-reduced-transparency: reduce) {
    .goal-panel { background: rgba(26,20,14,0.95);
      backdrop-filter: none; -webkit-backdrop-filter: none; }
  }
  .goal-row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* 유리 위에서는 흰 반투명 트랙이 배경에 묻힌다 → 어두운 트랙으로 바꿔 연두 막대가 뜨게 한다. */
  .goal-xp { height: 5px; border-radius: 999px; background: rgba(10,8,5,0.5); overflow: hidden; }
  .goal-xp-fill { height: 100%; border-radius: 999px; background: var(--lime); width: 0%; }
  .goal-btnrow { display: flex; gap: 6px; margin-top: 2px; }
  /* 버튼도 배경이 흰 반투명이면 유리 위에서 사라진다 → 어둡게 깔아 "누를 것"으로 남긴다. */
  .goal-btn { flex: 1; padding: 7px 0; border-radius: 9px; cursor: pointer; background: rgba(18,13,9,0.55);
    border: 1px solid var(--line); color: var(--ink); font-family: var(--font-body); font-size: 12.5px;
    text-shadow: inherit; transition: transform 0.07s ease, background 0.12s ease; }
  .goal-btn:active { transform: translateY(1px); background: rgba(143, 209, 79, 0.28); }
  /* 움직임을 줄이도록 설정한 사용자 · 깜빡임·전환을 멈추고 상태(방향)만 남긴다. */
  @media (prefers-reduced-motion: reduce) {
    .goal-caret { transition: none; }
    .goal-caret.hint { animation: none; opacity: 0.85; }
    .goal-pill, .goal-pause, .goal-btn { transition: none; }
  }
  `;
  document.head.appendChild(s);
}
