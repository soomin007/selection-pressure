// 런 종료 진척도 화면 — 런이 끝나면(멸종·정복) 이번에 쌓인 메타 경험치가 바에 차오르며 플레이어 레벨이
// 연달아 오르고(탕탕탕), 넘긴 레벨마다 새로 열린 것을 하이라이트한다. 결과(사망 원인) 화면 직전에 낀다.
// 순수 DOM + requestAnimationFrame 애니메이션(캔버스 위 HTML 오버레이). 탭하면 끝까지 건너뛴다.

import { metaLevelInfo, type RunProgress } from "@/game/meta";

export interface LevelUpScreen {
  play: (progress: RunProgress, onDone: () => void) => void;
  clear: () => void;
}

let stylesAdded = false;
function ensureStyles(): void {
  if (stylesAdded || typeof document === "undefined") return;
  stylesAdded = true;
  const s = document.createElement("style");
  s.textContent = `
    @keyframes lvlPop { 0%{transform:scale(1)} 35%{transform:scale(1.28)} 100%{transform:scale(1)} }
    @keyframes lvlRow { from{opacity:0; transform:translateY(8px)} to{opacity:1; transform:translateY(0)} }
    .lvl-badge.pop { animation: lvlPop 380ms cubic-bezier(.2,1.4,.4,1); }
    .lvl-unlock { animation: lvlRow 320ms ease-out both; }
  `;
  document.head.appendChild(s);
}

export function createLevelUpScreen(): LevelUpScreen {
  ensureStyles();

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:40; display:none; flex-direction:column; align-items:center;" +
    "justify-content:center; gap:14px; padding:24px; background:rgba(6,9,14,0.86);" +
    "font-family:system-ui,-apple-system,sans-serif; text-align:center; user-select:none;";

  const title = document.createElement("div");
  title.textContent = "이번 혈통이 남긴 자취";
  title.style.cssText = "color:#cfe6b0; font-size:15px; font-weight:600; letter-spacing:0.4px;";

  const badge = document.createElement("div");
  badge.className = "lvl-badge";
  badge.style.cssText =
    "color:#ffe08a; font-size:44px; font-weight:900; letter-spacing:0.5px;" +
    "text-shadow:0 2px 14px rgba(255,210,90,0.4); transform-origin:center;";

  // 경험치바 — 트랙 + 차오르는 채움. 폭(%)을 매 프레임 갱신.
  const track = document.createElement("div");
  track.style.cssText =
    "width:min(78vw,300px); height:16px; background:#1b2230; border:1px solid #33405a;" +
    "border-radius:9px; overflow:hidden;";
  const fill = document.createElement("div");
  fill.style.cssText =
    "height:100%; width:0%; border-radius:9px;" +
    "background:linear-gradient(90deg,#f0c840,#ffe08a); transition:width 60ms linear;";
  track.appendChild(fill);

  const gained = document.createElement("div");
  gained.style.cssText = "color:#8a93a6; font-size:13px; font-weight:600;";

  const unlocks = document.createElement("div");
  unlocks.style.cssText =
    "display:flex; flex-direction:column; gap:6px; min-height:0; margin-top:4px; width:min(80vw,320px);";

  const continueBtn = document.createElement("button");
  continueBtn.textContent = "계속";
  continueBtn.style.cssText =
    "display:none; margin-top:10px; padding:12px 30px; border:none; border-radius:12px;" +
    "background:linear-gradient(180deg,#7db0e0,#4f84b4); color:#08161f; font-size:16px;" +
    "font-weight:800; cursor:pointer;";

  overlay.append(title, badge, track, gained, unlocks, continueBtn);
  document.body.appendChild(overlay);

  let raf = 0;
  let finished = true;

  const clear = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    finished = true;
    overlay.style.display = "none";
  };

  const play = (progress: RunProgress, onDone: () => void): void => {
    unlocks.replaceChildren();
    finished = false;
    let lastLevel = progress.beforeLevel;
    const revealed = new Set<number>();

    const addUnlock = (label: string): void => {
      const row = document.createElement("div");
      row.className = "lvl-unlock";
      row.textContent = "새로 열림 · " + label;
      row.style.cssText =
        "padding:8px 12px; border:1px solid #3f4a2a; border-radius:10px; background:#1a2012;" +
        "color:#ffe08a; font-size:14px; font-weight:700;";
      unlocks.appendChild(row);
    };
    const popLevel = (lv: number): void => {
      badge.classList.remove("pop");
      void badge.offsetWidth; // 리플로우로 애니메이션 재시작(탕!)
      badge.classList.add("pop");
      if (revealed.has(lv)) return;
      revealed.add(lv);
      const lu = progress.levelUps.find((x) => x.level === lv);
      for (const u of lu?.unlocks ?? []) addUnlock(u.label);
    };
    const render = (xp: number): void => {
      const info = metaLevelInfo(xp);
      badge.textContent = `레벨 ${info.level}`;
      const pct = info.need > 0 ? Math.min(1, info.into / info.need) : 1;
      fill.style.width = `${(pct * 100).toFixed(1)}%`;
      if (info.level > lastLevel) {
        for (let lv = lastLevel + 1; lv <= info.level; lv++) popLevel(lv);
        lastLevel = info.level;
      }
    };

    gained.textContent = progress.gained > 0 ? `이번 혈통이 남긴 경험 +${progress.gained}` : "";
    const finish = (): void => {
      if (finished) return;
      finished = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      // 최종 상태로 스냅 + 놓친 레벨/해금 마저 표시.
      const end = metaLevelInfo(progress.afterXp);
      badge.textContent = `레벨 ${end.level}`;
      fill.style.width = `${((end.need > 0 ? Math.min(1, end.into / end.need) : 1) * 100).toFixed(1)}%`;
      for (const lu of progress.levelUps) {
        if (!revealed.has(lu.level)) {
          revealed.add(lu.level);
          for (const u of lu.unlocks) addUnlock(u.label);
        }
      }
      continueBtn.style.display = "block";
    };

    // 애니메이션 길이 — 쌓인 경험치에 비례하되 상한(느긋하지도 지루하지도 않게).
    const dur = Math.min(2600, 700 + progress.gained * 9);
    let startTs = -1;
    const frame = (ts: number): void => {
      if (startTs < 0) startTs = ts;
      const t = Math.min(1, (ts - startTs) / dur);
      const eased = 1 - (1 - t) * (1 - t); // easeOutQuad
      render(progress.beforeXp + (progress.afterXp - progress.beforeXp) * eased);
      if (t < 1 && !finished) raf = requestAnimationFrame(frame);
      else finish();
    };

    // 탭하면 즉시 끝까지(폰 배려). 계속 버튼은 결과 화면으로.
    overlay.onclick = (): void => finish();
    continueBtn.onclick = (e: MouseEvent): void => {
      e.stopPropagation();
      clear();
      onDone();
    };

    continueBtn.style.display = "none";
    render(progress.beforeXp);
    overlay.style.display = "flex";
    raf = requestAnimationFrame(frame);
  };

  return { play, clear };
}
