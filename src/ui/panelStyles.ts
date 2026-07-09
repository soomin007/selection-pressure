// 캔버스 위 HTML 오버레이 UI 의 공통 스타일 + 디자인 토큰. 한 번만 주입한다.
// 방향 3a "포근한 관찰"(docs 핸드오프): 따뜻한 흙빛 유리 패널, 크게 둥근 모서리, 둥근 활자,
// 모노는 진짜 수치에만. 토큰(:root --*)은 여기서 선언하고 모든 컴포넌트가 var(--*)로 공유한다.

export function ensurePanelStyles(): void {
  if (document.getElementById("ui-style")) return;
  const style = document.createElement("style");
  style.id = "ui-style";
  style.textContent = `
  :root {
    /* 활자 — 디스플레이/제목/본문/계측 */
    --font-display: 'Black Han Sans', sans-serif;
    --font-title: 'Jua', 'IBM Plex Sans KR', system-ui, sans-serif;
    --font-body: 'IBM Plex Sans KR', system-ui, -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace;

    /* 중립·표면 */
    --ink: #F5EEE1;      /* 기본 텍스트, 큰 제목 */
    --sub: #C6B7A2;      /* 보조 텍스트, 설명 */
    --faint: #8C7C68;    /* 비활성·힌트·모노 라벨 */
    --panel: rgba(32, 25, 19, 0.90);  /* 유리 패널 배경(blur와 함께) */
    --panelSolid: #221A14;            /* 불투명 패널 */
    --line: rgba(245, 235, 220, 0.13); /* 테두리·구분선(hairline) */

    /* 화면별 불투명 바탕 */
    --bg-lobby: #12100C;   /* 로비·프리셋 */
    --bg-report: #141009;  /* 보고서·대백과 */
    --bg-moment: #0B0906;  /* 멸종 순간 */

    /* 의미 색(형질·상태) */
    --lime: #8FD14F;   --limeD: #5F9130;  /* 내 종·주요 액션·긍정 / 주요 버튼 입체 띠 */
    --orange: #F2903A;  /* 사냥·포식·대사 */
    --blue: #5AB0E2;    /* 물·중립·시야 */
    --amber: #F5C33B;   /* 레벨·경험치·속도 */
    --red: #E85C43;     /* 위협·굶주림·멸종·공격력 */
    --purple: #B98CE0;  /* 무리 성향 */

    /* 반경 스케일 */
    --r-chip: 8px;   --r-btn: 14px;  --r-card: 16px;  --r-panel: 18px;  --r-focus: 20px;
  }

  /* 하단 시트(드래프트·결과) — 유리 패널, 크게 둥근 위 모서리, 세이프에어리어 존중 */
  .ui-root {
    position: fixed; left: 50%; bottom: 0; transform: translateX(-50%);
    width: min(100%, 500px); box-sizing: border-box;
    padding: 13px 14px calc(15px + env(safe-area-inset-bottom));
    background: var(--panel); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    color: var(--ink); font-family: var(--font-body);
    border-top: 1px solid var(--line);
    border-top-left-radius: var(--r-focus); border-top-right-radius: var(--r-focus);
    box-shadow: 0 -10px 34px rgba(0, 0, 0, 0.55);
    z-index: 10; touch-action: auto; user-select: none;
    animation: sheet-rise 0.32s ease-out;
  }
  /* 안내·예고 배너 — 따뜻한 호박빛 유리 */
  .ui-preview {
    font-family: var(--font-body); font-size: 12.5px; line-height: 1.5; color: #EAD9B8;
    background: rgba(245, 195, 59, 0.08); border: 1px solid rgba(245, 195, 59, 0.22);
    border-radius: 12px; padding: 9px 12px; margin-bottom: 10px;
  }
  .ui-title { font-family: var(--font-title); font-size: 16px; color: var(--ink); margin-bottom: 10px; text-align: center; }

  .ui-cards { display: flex; flex-direction: column; gap: 9px; }
  /* 유리 카드 + 왼쪽 휜 색 액센트(border-left, 둥근 모서리를 따라 색이 휜다) */
  .ui-card {
    text-align: left; width: 100%; box-sizing: border-box;
    padding: 10px 13px 10px 11px;
    border: 1px solid var(--line); border-left: 4px solid var(--lime);
    border-radius: var(--r-card); background: var(--panelSolid); color: var(--ink);
    cursor: pointer; touch-action: auto; transition: transform 0.07s ease;
  }
  .ui-card:active { transform: translateY(2px); }
  .ui-card-name { font-family: var(--font-title); font-size: 15.5px; color: var(--ink); }
  .ui-card-desc { font-size: 12px; color: var(--sub); margin-top: 3px; line-height: 1.4; }
  .ui-card-eff { font-family: var(--font-mono); font-size: 11px; color: var(--lime); margin-top: 4px; font-variant-numeric: tabular-nums; }

  .ui-result { text-align: center; }
  .ui-result-heading { font-family: var(--font-display); font-size: 40px; margin-bottom: 6px; letter-spacing: 0.02em; }
  .ui-result-summary { font-family: var(--font-body); font-size: 14.5px; color: var(--sub); margin-bottom: 16px; line-height: 1.55; }

  /* 주요(입체 키) 버튼 — 화면당 1개. 배경 lime, 아래 입체 띠, 누르면 내려앉는다 */
  .ui-btn-primary {
    width: 100%; box-sizing: border-box; padding: 14px;
    border: 0; border-radius: var(--r-btn); background: var(--lime); color: #1B2A0A;
    font-family: var(--font-title); font-size: 16px; cursor: pointer; touch-action: auto;
    border-bottom: 5px solid var(--limeD);
    transition: transform 0.07s ease, border-bottom-width 0.07s ease;
  }
  .ui-btn-primary:active { transform: translateY(4px); border-bottom-width: 1px; }

  /* 로비/타이틀 — 배경 생태계를 살리며 따뜻하게 받쳐준다 */
  .lobby-root {
    position: fixed; inset: 0; z-index: 20; box-sizing: border-box; padding: 24px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    background: radial-gradient(circle at 50% 42%, rgba(18, 16, 12, 0.28) 0, rgba(11, 9, 6, 0.82) 100%);
    color: var(--ink); text-align: center; font-family: var(--font-body);
  }
  .lobby-title { font-family: var(--font-display); font-size: 60px; letter-spacing: 0.03em; color: var(--ink); text-shadow: 0 4px 20px rgba(0, 0, 0, 0.6); }
  .lobby-sub { font-size: 15px; color: var(--sub); max-width: 440px; line-height: 1.65; }
  .lobby-start {
    margin-top: 14px; padding: 16px 46px;
    border: 0; border-radius: var(--r-btn); background: var(--lime); color: #1B2A0A;
    font-family: var(--font-title); font-size: 18px; cursor: pointer; touch-action: auto;
    border-bottom: 5px solid var(--limeD);
    transition: transform 0.07s ease, border-bottom-width 0.07s ease;
  }
  .lobby-start:active { transform: translateY(4px); border-bottom-width: 1px; }
  .lobby-hint { font-size: 12.5px; color: var(--faint); margin-top: 6px; line-height: 1.55; max-width: 440px; }

  /* 인게임 컨트롤 바(우상단) — 계측 알약 세그먼트 */
  .controls-bar {
    position: fixed; top: calc(12px + env(safe-area-inset-top)); right: calc(12px + env(safe-area-inset-right));
    z-index: 12; display: flex; gap: 8px; font-family: var(--font-mono);
  }
  .ctrl-btn {
    min-width: 46px; height: 42px; padding: 0 14px; border: 1px solid var(--line); border-radius: 999px;
    background: var(--panel); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
    color: var(--ink); font-family: var(--font-mono); font-size: 14px; font-weight: 500;
    cursor: pointer; touch-action: auto; display: flex; align-items: center; justify-content: center;
  }
  .ctrl-btn:active { background: rgba(143, 209, 79, 0.28); }

  /* 멈춤 메뉴 */
  .pause-menu {
    position: fixed; inset: 0; z-index: 21; box-sizing: border-box; padding: 24px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    background: rgba(11, 9, 6, 0.80); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
    font-family: var(--font-body);
  }
  .pause-title { font-family: var(--font-title); font-size: 26px; color: var(--ink); margin-bottom: 8px; }
  .pause-btn {
    width: min(82%, 300px); padding: 14px; border: 1px solid var(--line); border-radius: var(--r-btn);
    background: var(--panelSolid); color: var(--ink); font-family: var(--font-title); font-size: 16px;
    cursor: pointer; touch-action: auto; transition: transform 0.07s ease;
  }
  .pause-btn:active { transform: translateY(2px); }
  .pause-btn.primary {
    background: var(--lime); color: #1B2A0A; border: 0; border-bottom: 5px solid var(--limeD);
  }
  .pause-btn.primary:active { transform: translateY(4px); border-bottom-width: 1px; }

  /* 하단 시트 등장 애니메이션 */
  @keyframes sheet-rise { 0% { transform: translateX(-50%) translateY(24px); opacity: 0; } 100% { transform: translateX(-50%) translateY(0); opacity: 1; } }

  /* 데스크톱: 가로 레이아웃 — 카드를 한 줄로, 패널은 떠 있는 넓은 바. */
  body[data-layout="desktop"] .ui-root {
    width: min(88%, 760px); bottom: 16px; border-radius: var(--r-panel); padding: 14px 18px;
  }
  body[data-layout="desktop"] .ui-cards { flex-direction: row; }
  body[data-layout="desktop"] .ui-card { flex: 1 1 0; min-width: 0; }
  body[data-layout="desktop"] .ui-result { width: min(520px, 90%); }

  /* 모션 접근성 — 부유·상승 연출을 멈추고 상태 전환만 유지(핸드오프 §11) */
  @media (prefers-reduced-motion: reduce) {
    .ui-root { animation: none; }
  }

  /* ══════════════ 드래프트 화면 (핸드오프 드래프트 스펙 v1.0) ══════════════ */

  /* §4 배경 — 뿌연 유리. 월드는 멈춰 있고(sim step 중단) 캔버스는 계속 그려진다.
     마지막 프레임을 비트맵으로 캡처하지 않고 캔버스에 필터만 건다. scale 은 블러
     가장자리 흰 번짐을 화면 밖으로 밀어내는 용도(스펙의 "사방 24px 확장" 대응). */
  .game-view-frosted {
    filter: blur(16px) brightness(0.82) saturate(1.15);
    transform: scale(1.06);
    transform-origin: center center;
  }
  /* 드래프트 중에는 관전용 UI 를 숨긴다 — 반투명 유리 아래로 비쳐 보이면 안 된다.
     내 종 정보는 헤더의 "내 종" 팝업이 대신한다(§9).
     !important 필수: hudPanel·controls 가 display 를 인라인으로 쓴다(그냥 두면 이 규칙이 진다). */
  body.draft-open .hud-root,
  body.draft-open .controls-bar { display: none !important; }

  .draft-root { position: fixed; inset: 0; z-index: 15; display: none;
    font-family: var(--font-body); color: var(--ink); user-select: none; }
  .draft-root.open { display: block; }
  .draft-veil { position: absolute; inset: 0; background: rgba(240, 232, 218, 0.07); pointer-events: none; }
  .draft-grad { position: absolute; inset: 0; pointer-events: none; opacity: 0.55;
    background: linear-gradient(180deg, rgba(20,16,10,0.5) 0, rgba(20,16,10,0.6) 46%, rgba(20,16,10,0.95) 100%); }

  /* §3 공통 그리드 — 헤더 auto / 히어로 1fr / 카드 auto / 푸터 auto */
  .draft-shell {
    position: relative; z-index: 1; height: 100%; box-sizing: border-box;
    display: grid; grid-template: "hd" auto "hero" 1fr "cards" auto "ft" auto / 1fr;
    padding: calc(28px + env(safe-area-inset-top)) 18px calc(20px + env(safe-area-inset-bottom));
    max-width: 430px; margin: 0 auto;
  }

  /* 헤더 — 연출 없이 즉시 표시(§6) */
  .draft-hd { grid-area: hd; position: relative; text-align: center; }
  .draft-level { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.24em;
    color: var(--amber); text-shadow: 0 2px 8px rgba(0,0,0,0.6); }
  .draft-title { font-family: var(--font-title); font-size: 21px; color: var(--ink);
    margin-top: 5px; text-shadow: 0 2px 10px rgba(0,0,0,0.55); }
  .draft-mine { position: absolute; right: -4px; top: -4px; display: inline-flex; align-items: center; gap: 6px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 999px;
    padding: 6px 11px 6px 6px; cursor: pointer; font: inherit; color: var(--ink);
    transition: transform 0.07s ease; }
  .draft-mine:active { transform: translateY(1px); }
  .draft-mine-thumb { width: 22px; height: 20px; border-radius: 8px; flex: none;
    background-color: #141B28; background-position: center; background-size: 125%; background-repeat: no-repeat; }
  .draft-mine-label { font-size: 11px; }

  /* §5 히어로 미리보기 */
  .draft-hero { grid-area: hero; position: relative; min-height: 0;
    display: flex; align-items: center; justify-content: center; }
  .draft-arrow { position: absolute; top: 50%; transform: translateY(-50%); z-index: 3;
    width: 42px; height: 42px; border-radius: 50%; background: rgba(20,16,10,0.5);
    border: 1px solid rgba(245,235,220,0.18); color: var(--ink);
    font-family: var(--font-mono); font-size: 18px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; }
  .draft-arrow.prev { left: 0; }
  .draft-arrow.next { right: 0; }
  .draft-arrow:active { background: rgba(20,16,10,0.75); }
  /* 배율 래퍼 — 낮은 창에서 히어로만 줄어든다(§8). 등장 연출(transform 키프레임)은 안쪽 그룹이 맡는다. */
  .draft-hero-scale { transform-origin: center center; }
  /* 메달리온·배지·점을 한 세로 그룹으로 묶는다 — 셀 가장자리에 앵커하면 화면이 커질 때 생물과 분리된다(§5) */
  .draft-hero-group { display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .draft-medallion-zone { position: relative; width: 204px; height: 164px;
    display: flex; align-items: center; justify-content: center; }
  .draft-aura { position: absolute; width: 196px; height: 196px; border-radius: 50%;
    animation: aura-breathe 4s ease-in-out infinite; }
  .draft-flourish { position: absolute; inset: 0; pointer-events: none; }
  .draft-medallion { position: relative; width: 126px; height: 112px; border-radius: 30px;
    background: #141B28; overflow: hidden; animation: float-soft 5s ease-in-out infinite; }
  .draft-sprite { position: absolute; inset: 12px;
    background-position: center; background-size: contain; background-repeat: no-repeat; }
  .draft-tint { position: absolute; inset: 0; }
  .draft-pup { position: absolute; background: #141B28; overflow: hidden; }
  .draft-pup > i { position: absolute; inset: 5px; display: block;
    background-position: center; background-size: contain; background-repeat: no-repeat; }
  .draft-dash { position: absolute; height: 5px; border-radius: 3px;
    animation: dash-drift 1.6s ease-in-out infinite; }
  .draft-hero-badge { font-family: var(--font-mono); font-size: 10px; border-radius: 999px;
    padding: 5px 12px; white-space: nowrap; box-shadow: 0 4px 12px -4px rgba(0,0,0,0.5); }
  .draft-dots { display: flex; gap: 6px; }
  .draft-dots > span { width: 6px; height: 6px; border-radius: 50%; background: rgba(245,238,225,0.4); }

  /* §3 카드 — 모바일은 세로 스택(가로 행 카드) */
  .draft-cards { grid-area: cards; margin-top: 10px; display: flex; flex-direction: column; gap: 10px; }
  .draft-card-wrap { position: relative; min-width: 0; }
  .draft-card { position: relative; width: 100%; box-sizing: border-box; text-align: left;
    background: rgba(28,21,15,0.88); border: 1px solid var(--line); border-top: 1px solid var(--line);
    border-radius: 16px; padding: 13px 15px; color: var(--ink); font: inherit; cursor: pointer;
    transition: transform 0.07s ease; }
  .draft-card:active { transform: translateY(2px); }
  .draft-card-row { display: flex; align-items: center; gap: 9px; }
  .draft-dot { width: 11px; height: 11px; border-radius: 3px; flex: none; }
  .draft-card-name { font-family: var(--font-title); font-size: 16px; flex: 1; min-width: 0; }
  .draft-badge { display: inline-flex; align-items: center; gap: 5px; flex: none;
    font-family: var(--font-mono); font-size: 9.5px; border-radius: 999px; padding: 3px 9px; }
  .draft-badge > i { width: 5px; height: 5px; border-radius: 1px; display: block; flex: none; }
  .draft-card-body { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: 6px 10px; margin-top: 7px; }
  .draft-card-desc { font-size: 11.5px; color: var(--sub); line-height: 1.4; }
  .draft-chips { display: flex; gap: 5px; flex: none; flex-wrap: wrap; }
  .draft-chip { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
    font-family: var(--font-mono); font-size: 10.5px; border-radius: 8px; padding: 4px 9px; }
  .draft-chip > i { font-size: 7px; font-style: normal; }

  /* §7 콘페티 — 전설 카드 안에서 전방향으로 터진다 */
  .draft-confetti { position: absolute; z-index: 2; pointer-events: none; }

  /* CTA + 푸터 */
  .draft-ft { grid-area: ft; }
  .draft-cta { display: block; width: 100%; box-sizing: border-box; margin: 14px auto 0; border: 0;
    background: var(--lime); color: #1B2A0A; font-family: var(--font-title); font-size: 16px;
    text-align: center; padding: 14px 16px; border-radius: 15px; border-bottom: 5px solid var(--limeD);
    box-shadow: 0 8px 20px -6px rgba(143,209,79,0.5); cursor: pointer;
    transition: transform 0.07s ease, border-bottom-width 0.07s ease; }
  .draft-cta:active { transform: translateY(5px); border-bottom-width: 1px; }
  .draft-ft-row { display: flex; justify-content: space-between; align-items: center; margin-top: 13px; }
  .draft-skip { background: none; border: 0; font: inherit; font-size: 12.5px; color: var(--ink);
    text-shadow: 0 1px 6px rgba(0,0,0,0.6); border-bottom: 1.5px solid rgba(245,238,225,0.45);
    padding: 0 0 2px; cursor: pointer; }
  .draft-reroll { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-mono);
    font-size: 11px; color: var(--ink); background: var(--panel); border: 1px solid var(--line);
    border-radius: 999px; padding: 6px 12px; cursor: pointer; transition: transform 0.07s ease; }
  .draft-reroll:active { transform: translateY(1px); }

  /* §10 토스트 — 래퍼가 중앙정렬하고 안쪽 알약만 애니메이션(§8 함정: transform 이 translate 를 덮어쓴다) */
  .draft-toast { position: fixed; left: 0; right: 0; top: 40%; z-index: 30;
    display: none; justify-content: center; pointer-events: none; }
  .draft-toast.on { display: flex; }
  .draft-toast > div { background: rgba(30,23,16,0.96); border: 1px solid rgba(245,235,220,0.22);
    border-radius: 999px; padding: 9px 17px; font-size: 12.5px; color: var(--ink); white-space: nowrap;
    animation: pop-bounce 0.4s cubic-bezier(.34,1.3,.64,1) both; }

  /* §9 내 종 팝업 — 바텀 시트 */
  .draft-dim { position: fixed; inset: 0; background: rgba(15,12,8,0.55); z-index: 20; display: none; }
  .draft-dim.on { display: block; }
  .draft-popup-wrap { position: fixed; left: 0; right: 0; z-index: 21;
    bottom: calc(10px + env(safe-area-inset-bottom)); padding: 0 10px;
    display: none; justify-content: center; }
  .draft-popup-wrap.on { display: flex; }
  .draft-popup { width: 100%; max-width: 410px; box-sizing: border-box; background: rgba(30,23,16,0.97);
    border: 1px solid var(--line); border-radius: 22px; padding: 20px 20px 18px;
    animation: draft-sheet-rise 0.35s ease-out; }
  .draft-popup-head { display: flex; justify-content: space-between; align-items: center; }
  .draft-popup-id { display: flex; align-items: center; gap: 11px; min-width: 0; }
  .draft-popup-thumb { width: 46px; height: 42px; border-radius: 13px; flex: none;
    background-color: #141B28; background-position: center; background-size: 120%; background-repeat: no-repeat; }
  .draft-popup-name { font-family: var(--font-title); font-size: 19px; }
  .draft-popup-sub { font-size: 11px; color: var(--sub); margin-top: 1px; }
  .draft-popup-close { font: inherit; font-size: 12px; color: var(--ink); background: none;
    border: 1px solid rgba(245,235,220,0.2); border-radius: 999px; padding: 6px 14px; cursor: pointer; flex: none; }

  .draft-stats { display: flex; flex-direction: column; gap: 9px; margin-top: 18px; }
  .draft-stat { display: flex; align-items: center; gap: 9px; }
  .draft-stat-label { font-size: 11px; color: var(--sub); width: 58px; flex: none; }
  .draft-stat-track { flex: 1; height: 7px; background: rgba(255,255,255,0.12); border-radius: 4px; position: relative; }
  .draft-stat-fill { height: 100%; border-radius: 4px; }
  .draft-stat-gain { position: absolute; top: 0; bottom: 0; border-radius: 0 4px 4px 0;
    background: rgba(143,209,79,0.3); border: 1px dashed rgba(143,209,79,0.7); box-sizing: border-box; }
  .draft-stat-loss { position: absolute; top: -1px; bottom: -1px; border-radius: 2px; background: rgba(232,92,67,0.55); }
  .draft-stat-val { font-family: var(--font-mono); font-size: 10px; width: 58px; text-align: right; flex: none;
    font-variant-numeric: tabular-nums; }
  .draft-stat-val b { font-weight: 400; }

  .draft-legend { display: flex; align-items: center; gap: 7px; margin-top: 14px;
    font-size: 11px; color: var(--sub); line-height: 1.4; }
  .draft-legend-swatch { width: 16px; height: 7px; border-radius: 4px; flex: none;
    background: rgba(143,209,79,0.3); border: 1px dashed rgba(143,209,79,0.7); box-sizing: border-box; }
  .draft-divider { height: 1px; background: var(--line); margin: 15px 0 13px; }
  .draft-picked-title { font-size: 11px; color: var(--sub); margin-bottom: 8px; }
  .draft-picked { display: flex; flex-wrap: wrap; gap: 7px; }
  .draft-picked-none { font-size: 11.5px; color: var(--faint); }
  .draft-picked-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px;
    background: rgba(255,255,255,0.06); border-radius: 999px; padding: 5px 12px; }
  .draft-picked-chip > i { width: 7px; height: 7px; border-radius: 2px; display: block; flex: none; }

  /* §3 데스크톱 (>= 860px) — 세로형 카드 3장 가로 배열 */
  @media (min-width: 860px) {
    .draft-shell { max-width: 1120px; }
    .draft-level { font-size: 13px; }
    .draft-title { font-size: 30px; }
    .draft-cards { flex-direction: row; align-items: stretch; gap: 18px; }
    /* §8 함정: basis 0% 는 border-box 에서 항목 최소폭이 자기 패딩으로 잡혀 콘페티 래퍼만 좁아진다 */
    .draft-card-wrap { flex: 1 1 33.33%; }
    .draft-card { height: 100%; display: flex; flex-direction: column; align-items: center; text-align: center;
      border-radius: 20px; padding: 24px 22px 22px; border-top-width: 4px; border-top-style: solid;
      transition: transform 0.15s ease; }
    .draft-card:hover { transform: translateY(-4px); }
    .draft-card-row { flex-direction: column-reverse; gap: 12px; }
    .draft-dot { display: none; }
    .draft-card-name { font-size: 21px; flex: none; }
    .draft-badge { font-size: 10.5px; padding: 4px 11px; }
    .draft-badge > i { width: 6px; height: 6px; }
    .draft-card-body { flex: 1; flex-direction: column; align-items: center; justify-content: space-between;
      gap: 16px; margin-top: 10px; }
    .draft-card-desc { font-size: 13px; line-height: 1.55; }
    .draft-chips { justify-content: center; gap: 7px; }
    .draft-chip { font-size: 11.5px; border-radius: 9px; padding: 5px 11px; }
    .draft-chip > i { font-size: 8px; }
    .draft-cta { max-width: 520px; font-size: 20px; padding: 17px 16px; }
    .draft-skip { font-size: 14px; }
    .draft-reroll { font-size: 12.5px; padding: 9px 17px; }
  }

  /* §6 등장 연출 키프레임 */
  @keyframes aura-breathe { 0%,100% { transform: scale(1); opacity: 0.5; } 50% { transform: scale(1.14); opacity: 0.85; } }
  @keyframes float-soft { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
  @keyframes dash-drift { 0%,100% { transform: translateX(0); opacity: 0.55; } 50% { transform: translateX(-10px); opacity: 0.2; } }
  @keyframes pop-bounce { 0% { opacity: 0; transform: scale(0.12); } 45% { opacity: 1; transform: scale(1.16); }
    68% { transform: scale(0.93); } 85% { transform: scale(1.03); } 100% { opacity: 1; transform: scale(1); } }
  @keyframes pop-soft { 0% { opacity: 0; transform: scale(0.88); } 60% { opacity: 1; transform: scale(1.03); }
    100% { opacity: 1; transform: scale(1); } }
  @keyframes rare-flash { 0% { box-shadow: 0 0 0 0 rgba(245,195,59,0); }
    30% { box-shadow: 0 0 30px 3px rgba(245,195,59,0.55); }
    100% { box-shadow: 0 0 18px -6px rgba(245,195,59,0.3); } }
  @keyframes confetti-burst { 0% { transform: translate(0,0) rotate(0deg) scale(0.4); opacity: 0; }
    10% { opacity: 1; transform: translate(var(--dx1), var(--dy1)) rotate(var(--r1)) scale(1); }
    100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(0.85); opacity: 0; } }
  @keyframes draft-sheet-rise { 0% { transform: translateY(24px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }

  /* 모션 접근성 — 부유·터짐을 멈추고 읽을 것만 남긴다. 인라인 animation 을 이겨야 하므로 !important. */
  @media (prefers-reduced-motion: reduce) {
    .draft-aura, .draft-medallion, .draft-pup, .draft-dash,
    .draft-card, .draft-hero-group, .draft-cta, .draft-popup, .draft-toast > div { animation: none !important; }
    .draft-confetti { display: none; }
  }
  `;
  document.head.appendChild(style);
}
