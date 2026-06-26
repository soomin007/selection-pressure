// 캔버스 위 HTML 오버레이 UI 의 공통 스타일. 한 번만 주입한다.

export function ensurePanelStyles(): void {
  if (document.getElementById("ui-style")) return;
  const style = document.createElement("style");
  style.id = "ui-style";
  style.textContent = `
  .ui-root {
    position: fixed; left: 50%; bottom: 0; transform: translateX(-50%);
    width: min(100%, 500px); box-sizing: border-box; padding: 11px 12px;
    background: rgba(11, 14, 20, 0.94); color: #e6e6e6;
    font-family: system-ui, -apple-system, sans-serif;
    border-top-left-radius: 16px; border-top-right-radius: 16px;
    box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.5);
    z-index: 10; touch-action: auto; user-select: none;
  }
  .ui-preview {
    font-size: 12px; line-height: 1.4; color: #ffd27a;
    background: #1a1410; border: 1px solid #3a2c18; border-radius: 9px;
    padding: 7px 9px; margin-bottom: 8px;
  }
  .ui-title { font-size: 14px; font-weight: 700; margin-bottom: 8px; text-align: center; }

  .ui-cards { display: flex; flex-direction: column; gap: 7px; }
  .ui-card {
    text-align: left; width: 100%; box-sizing: border-box;
    padding: 9px 11px; border: 1px solid #2a3346; border-radius: 10px;
    background: #161b26; color: #e6e6e6; cursor: pointer; touch-action: auto;
  }
  .ui-card:active { background: #20283a; }
  .ui-card-name { font-size: 14.5px; font-weight: 700; }
  .ui-card-desc { font-size: 12px; color: #b6bdca; margin-top: 2px; line-height: 1.3; }
  .ui-card-eff { font-size: 11.5px; color: #6cc24a; margin-top: 3px; font-variant-numeric: tabular-nums; }

  .ui-result { text-align: center; }
  .ui-result-heading { font-size: 34px; font-weight: 800; margin-bottom: 6px; }
  .ui-result-summary { font-size: 15px; color: #b6bdca; margin-bottom: 16px; line-height: 1.5; }

  .ui-btn-primary {
    width: 100%; box-sizing: border-box; padding: 14px;
    border: 0; border-radius: 12px; background: #6cc24a; color: #0b0e14;
    font-size: 16px; font-weight: 800; cursor: pointer; touch-action: auto;
  }
  .ui-btn-primary:active { background: #5aa83d; }

  /* 로비/타이틀 */
  .lobby-root {
    position: fixed; inset: 0; z-index: 20; box-sizing: border-box; padding: 24px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    background: rgba(8, 11, 17, 0.6); color: #e6e6e6; text-align: center;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .lobby-title { font-size: 46px; font-weight: 800; letter-spacing: 3px; }
  .lobby-sub { font-size: 15px; color: #b6bdca; max-width: 440px; line-height: 1.6; }
  .lobby-start {
    margin-top: 14px; padding: 16px 44px; border: 0; border-radius: 12px;
    background: #6cc24a; color: #0b0e14; font-size: 18px; font-weight: 800;
    cursor: pointer; touch-action: auto;
  }
  .lobby-start:active { background: #5aa83d; }
  .lobby-hint { font-size: 12.5px; color: #8a93a6; margin-top: 6px; line-height: 1.5; max-width: 440px; }

  /* 인게임 컨트롤 바(우상단) + 멈춤 메뉴 */
  .controls-bar {
    position: fixed; top: 12px; right: 12px; z-index: 12; display: flex; gap: 8px;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .ctrl-btn {
    min-width: 46px; height: 42px; padding: 0 12px; border: 1px solid #2a3346; border-radius: 10px;
    background: rgba(22, 27, 38, 0.92); color: #e6e6e6; font-size: 15px; font-weight: 700;
    cursor: pointer; touch-action: auto; display: flex; align-items: center; justify-content: center;
  }
  .ctrl-btn:active { background: #20283a; }
  .pause-menu {
    position: fixed; inset: 0; z-index: 21; box-sizing: border-box; padding: 24px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    background: rgba(8, 11, 17, 0.74); font-family: system-ui, -apple-system, sans-serif;
  }
  .pause-title { font-size: 28px; font-weight: 800; color: #e6e6e6; margin-bottom: 8px; }
  .pause-btn {
    width: min(82%, 300px); padding: 14px; border: 1px solid #2a3346; border-radius: 12px;
    background: #161b26; color: #e6e6e6; font-size: 16px; font-weight: 700;
    cursor: pointer; touch-action: auto;
  }
  .pause-btn:active { background: #20283a; }
  .pause-btn.primary { background: #6cc24a; color: #0b0e14; border: 0; }

  /* 데스크톱: 가로 레이아웃 — 카드를 한 줄로, 패널은 떠 있는 넓은 바. */
  body[data-layout="desktop"] .ui-root {
    width: min(88%, 760px); bottom: 16px; border-radius: 16px; padding: 13px 16px;
  }
  body[data-layout="desktop"] .ui-cards { flex-direction: row; }
  body[data-layout="desktop"] .ui-card { flex: 1 1 0; min-width: 0; }
  body[data-layout="desktop"] .ui-result { width: min(520px, 90%); }
  `;
  document.head.appendChild(style);
}
