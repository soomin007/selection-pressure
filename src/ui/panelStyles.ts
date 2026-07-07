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
  `;
  document.head.appendChild(style);
}
