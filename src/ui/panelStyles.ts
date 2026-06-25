// 캔버스 위 HTML 오버레이 UI 의 공통 스타일. 한 번만 주입한다.

export function ensurePanelStyles(): void {
  if (document.getElementById("ui-style")) return;
  const style = document.createElement("style");
  style.id = "ui-style";
  style.textContent = `
  .ui-root {
    position: fixed; left: 50%; bottom: 0; transform: translateX(-50%);
    width: min(100%, 520px); box-sizing: border-box; padding: 16px;
    background: rgba(11, 14, 20, 0.94); color: #e6e6e6;
    font-family: system-ui, -apple-system, sans-serif;
    border-top-left-radius: 16px; border-top-right-radius: 16px;
    box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.5);
    z-index: 10; touch-action: auto; user-select: none;
  }
  .ui-preview {
    font-size: 13.5px; line-height: 1.5; color: #ffd27a;
    background: #1a1410; border: 1px solid #3a2c18; border-radius: 10px;
    padding: 10px 12px; margin-bottom: 12px;
  }
  .ui-title { font-size: 17px; font-weight: 700; margin-bottom: 12px; text-align: center; }

  .ui-cards { display: flex; flex-direction: column; gap: 10px; }
  .ui-card {
    text-align: left; width: 100%; box-sizing: border-box;
    padding: 14px; border: 1px solid #2a3346; border-radius: 12px;
    background: #161b26; color: #e6e6e6; cursor: pointer; touch-action: auto;
  }
  .ui-card:active { background: #20283a; }
  .ui-card-name { font-size: 17px; font-weight: 700; }
  .ui-card-desc { font-size: 13.5px; color: #b6bdca; margin-top: 4px; line-height: 1.45; }
  .ui-card-eff { font-size: 13px; color: #6cc24a; margin-top: 6px; font-variant-numeric: tabular-nums; }

  .ui-result { text-align: center; }
  .ui-result-heading { font-size: 34px; font-weight: 800; margin-bottom: 6px; }
  .ui-result-summary { font-size: 15px; color: #b6bdca; margin-bottom: 16px; line-height: 1.5; }

  .ui-btn-primary {
    width: 100%; box-sizing: border-box; padding: 14px;
    border: 0; border-radius: 12px; background: #6cc24a; color: #0b0e14;
    font-size: 16px; font-weight: 800; cursor: pointer; touch-action: auto;
  }
  .ui-btn-primary:active { background: #5aa83d; }
  `;
  document.head.appendChild(style);
}
