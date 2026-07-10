// 런 종료 진척도 화면 — 런이 끝나면(멸종·정복) 이번에 쌓인 메타 경험치가 바에 차오르며 플레이어 레벨이
// 연달아 오르고(탕탕탕), 넘긴 레벨마다 새로 열린 것을 하이라이트한다. 결과(사망 원인) 화면 직전에 낀다.
// 순수 DOM + requestAnimationFrame 애니메이션(캔버스 위 HTML 오버레이). 탭하면 끝까지 건너뛴다.

import { metaLevelInfo, type RunProgress, type UnlockTier } from "@/game/meta";
import { COSMETICS, type Achievement } from "@/game/achievements";

export interface LevelUpScreen {
  /**
   * progress = null 이면 경험치·레벨업을 숨기고 도전 과제만 알린다. 중간 시대 승리(런이 안 끝나 메타 경험치가
   * 안 쌓임)에서도 "정점 등극" 같은 과제는 따야 하므로 그 경우를 따로 다룬다.
   */
  play: (progress: RunProgress | null, achievements: Achievement[], onDone: () => void) => void;
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
    /* 해금 표식 — 글리프(전각 ＋) 대신 CSS 십자 막대로 원 정중앙에 딱 맞춘다(글꼴 편차 제거). */
    .lvl-mark { position:relative; flex:none; width:26px; height:26px; border-radius:50%;
      background:linear-gradient(180deg,#ffe08a,#f0b840); box-shadow:0 0 10px rgba(255,210,90,0.5); }
    .lvl-mark::before, .lvl-mark::after { content:""; position:absolute; left:50%; top:50%;
      background:#2a1e06; border-radius:1.5px; }
    .lvl-mark::before { width:12px; height:3px; transform:translate(-50%,-50%); }
    .lvl-mark::after  { width:3px; height:12px; transform:translate(-50%,-50%); }
  `;
  document.head.appendChild(s);
}

export function createLevelUpScreen(): LevelUpScreen {
  ensureStyles();

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:40; display:none; flex-direction:column; align-items:center;" +
    "justify-content:center; gap:14px; padding:24px; background:rgba(11,9,6,0.85);" +
    "font-family:var(--font-body); text-align:center; user-select:none;";

  const title = document.createElement("div");
  title.textContent = "이번 혈통이 남긴 자취";
  title.style.cssText = "color:var(--sub); font-size:15px; letter-spacing:0.4px;";

  const badge = document.createElement("div");
  badge.className = "lvl-badge";
  badge.style.cssText =
    "color:#ffe08a; font-family:'Black Han Sans',sans-serif; font-size:46px; letter-spacing:0.02em;" +
    "text-shadow:0 2px 14px rgba(255,210,90,0.4); transform-origin:center;";

  // 경험치바 — 트랙 + 차오르는 채움. 폭(%)을 매 프레임 갱신.
  const track = document.createElement("div");
  track.style.cssText =
    "width:min(78vw,300px); height:16px; background:rgba(255,255,255,0.06); border:1px solid var(--line);" +
    "border-radius:9px; overflow:hidden;";
  const fill = document.createElement("div");
  fill.style.cssText =
    "height:100%; width:0%; border-radius:9px;" +
    "background:linear-gradient(90deg,#f0c840,#ffe08a); transition:width 60ms linear;";
  track.appendChild(fill);

  const gained = document.createElement("div");
  gained.style.cssText = "color:var(--faint); font-family:var(--font-mono); font-size:12.5px;";

  // "새로 열림" 박스 — 넘긴 레벨에서 열린 것들을 담는다. 항목이 하나도 없으면 숨긴다.
  const unlockBox = document.createElement("div");
  unlockBox.style.cssText =
    "display:none; flex-direction:column; gap:9px; width:min(82vw,330px); margin-top:6px; padding:13px 14px;" +
    "border:1px solid #55672f; border-radius:16px;" +
    "background:linear-gradient(180deg, rgba(42,54,26,0.55), rgba(20,26,13,0.75));" +
    "box-shadow:0 0 22px rgba(120,180,60,0.16);";
  const unlockHeader = document.createElement("div");
  unlockHeader.textContent = "새로 열림";
  unlockHeader.style.cssText =
    "color:#cfe6b0; font-family:var(--font-mono); font-size:11px; letter-spacing:0.24em; text-align:center; opacity:0.92;";
  const unlockList = document.createElement("div");
  unlockList.style.cssText = "display:flex; flex-direction:column; gap:8px;";
  unlockBox.append(unlockHeader, unlockList);

  // "도전 과제 달성" 박스 — 레벨 해금과 다른 축이라 따로 보여준다(금빛 = 솜씨로 얻은 것).
  const achieveBox = document.createElement("div");
  achieveBox.style.cssText =
    "display:none; flex-direction:column; gap:9px; width:min(82vw,330px); margin-top:6px; padding:13px 14px;" +
    "border:1px solid #6b5620; border-radius:16px;" +
    "background:linear-gradient(180deg, rgba(70,54,20,0.55), rgba(30,23,10,0.75));" +
    "box-shadow:0 0 22px rgba(245,195,59,0.16);";
  const achieveHeader = document.createElement("div");
  achieveHeader.textContent = "도전 과제 달성";
  achieveHeader.style.cssText =
    "color:#ffe08a; font-family:var(--font-mono); font-size:11px; letter-spacing:0.24em; text-align:center; opacity:0.92;";
  const achieveList = document.createElement("div");
  achieveList.style.cssText = "display:flex; flex-direction:column; gap:8px;";
  achieveBox.append(achieveHeader, achieveList);

  const continueBtn = document.createElement("button");
  continueBtn.textContent = "계속";
  continueBtn.style.cssText =
    "display:none; margin-top:10px; padding:12px 34px; border:0; border-radius:var(--r-btn);" +
    "background:var(--lime); color:#1B2A0A; font-family:var(--font-title); font-size:16px;" +
    "border-bottom:5px solid var(--limeD); cursor:pointer;";

  overlay.append(title, badge, track, gained, unlockBox, achieveBox, continueBtn);
  document.body.appendChild(overlay);

  let raf = 0;
  let finished = true;

  const clear = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    finished = true;
    overlay.style.display = "none";
  };

  const play = (progress: RunProgress | null, achievements: Achievement[], onDone: () => void): void => {
    unlockList.replaceChildren();
    unlockBox.style.display = "none";
    // 새로 딴 도전 과제 — 경험치바와 무관하게 바로 보여준다(레벨이 안 올라도 딸 수 있다).
    achieveList.replaceChildren();
    achieveBox.style.display = achievements.length > 0 ? "flex" : "none";
    for (const a of achievements) {
      const item = document.createElement("div");
      item.className = "lvl-unlock";
      item.style.cssText =
        "display:flex; align-items:center; gap:11px; padding:9px 11px; border-radius:12px;" +
        "border:1px solid #6b5620; background:rgba(245,195,59,0.07);";
      const mark = document.createElement("div");
      mark.className = "lvl-mark";
      const texts = document.createElement("div");
      texts.style.cssText = "display:flex; flex-direction:column; gap:1px; text-align:left; min-width:0;";
      const name = document.createElement("div");
      name.textContent = a.name;
      name.style.cssText = "color:#ffe08a; font-family:var(--font-title); font-size:15px;";
      const reward = document.createElement("div");
      reward.textContent =
        a.reward.kind === "card"
          ? "형질 「거인」이 드래프트에 나타난다"
          : `꾸밈 · ${COSMETICS[a.reward.cosmetic].name}`;
      reward.style.cssText = "color:#c9b98a; font-size:12px; font-weight:500; line-height:1.35;";
      texts.append(name, reward);
      item.append(mark, texts);
      achieveList.appendChild(item);
    }
    finished = false;

    // 런이 안 끝났으면(중간 시대 승리) 경험치·레벨 부분을 통째로 숨기고 과제만 알린다.
    const xpParts = [title, badge, track, gained, unlockBox];
    for (const el of xpParts) el.style.display = progress ? "" : "none";
    if (!progress) {
      overlay.onclick = null;
      continueBtn.style.display = "block";
      continueBtn.onclick = (e: MouseEvent): void => {
        e.stopPropagation();
        clear();
        onDone();
      };
      finished = true;
      overlay.style.display = "flex";
      return;
    }
    unlockBox.style.display = "none"; // xpParts 에서 "" 로 되돌린 것을 다시 숨김(해금이 있을 때만 켠다)

    let lastLevel = progress.beforeLevel;
    const revealed = new Set<number>();

    // 한 해금 항목 — 금빛 표식(＋) + 제목 + 한 줄 설명. 가운뎃점 줄글 대신 구조로 읽힌다.
    const addUnlock = (u: UnlockTier): void => {
      unlockBox.style.display = "flex";
      const item = document.createElement("div");
      item.className = "lvl-unlock";
      item.style.cssText =
        "display:flex; align-items:center; gap:11px; padding:9px 11px; border-radius:12px;" +
        "border:1px solid #46542a; background:rgba(255,224,138,0.06);";
      const mark = document.createElement("div");
      mark.className = "lvl-mark"; // 원 + CSS 십자(글리프 편차 없이 정중앙)
      const texts = document.createElement("div");
      texts.style.cssText = "display:flex; flex-direction:column; gap:1px; text-align:left; min-width:0;";
      const name = document.createElement("div");
      name.textContent = u.label;
      name.style.cssText = "color:#ffe08a; font-family:var(--font-title); font-size:15px;";
      const detail = document.createElement("div");
      detail.textContent = u.detail;
      detail.style.cssText = "color:#a7b596; font-size:12px; font-weight:500; line-height:1.35;";
      texts.append(name, detail);
      item.append(mark, texts);
      unlockList.appendChild(item);
    };
    const popLevel = (lv: number): void => {
      badge.classList.remove("pop");
      void badge.offsetWidth; // 리플로우로 애니메이션 재시작(탕!)
      badge.classList.add("pop");
      if (revealed.has(lv)) return;
      revealed.add(lv);
      const lu = progress.levelUps.find((x) => x.level === lv);
      for (const u of lu?.unlocks ?? []) addUnlock(u);
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
          for (const u of lu.unlocks) addUnlock(u);
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
