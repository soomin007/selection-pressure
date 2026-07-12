// 해금 사다리 — 플레이어(메타) 레벨마다 무엇이 열리는지 한자리에서 보는 열람 공간. 지금까지 연 것과
// 앞으로 열릴 것을 사다리로 펼쳐, "다음에 뭐가 열리지?"를 런 종료 순간(levelUpScreen)이 아니어도 언제든
// 확인한다(사용자 요청). 대백과처럼 로비·결과 화면에서 여는 별도 오버레이. 순수 DOM, 효과 없음(열람만).

import { UNLOCK_TIERS, metaLevelInfo, loadMeta } from "@/game/meta";

export interface UnlockLadder {
  show: () => void;
  hide: () => void;
}

let stylesAdded = false;
function ensureStyles(): void {
  if (stylesAdded || typeof document === "undefined") return;
  stylesAdded = true;
  const s = document.createElement("style");
  s.textContent = `
    /* 열린 티어의 금빛 표식 — 원 + CSS 십자(글꼴 편차 없이 정중앙). levelUpScreen 과 같은 언어. */
    .ul-mark { position:relative; flex:none; width:24px; height:24px; border-radius:50%;
      background:linear-gradient(180deg,#ffe08a,#f0b840); box-shadow:0 0 9px rgba(255,210,90,0.45); }
    .ul-mark::before, .ul-mark::after { content:""; position:absolute; left:50%; top:50%;
      background:#2a1e06; border-radius:1.5px; }
    .ul-mark::before { width:11px; height:3px; transform:translate(-50%,-50%); }
    .ul-mark::after  { width:3px; height:11px; transform:translate(-50%,-50%); }
    /* 잠긴 티어의 자물쇠 자리 — 필요 레벨 숫자를 담는 회색 원. */
    .ul-lock { display:flex; align-items:center; justify-content:center; flex:none; width:24px; height:24px;
      border-radius:50%; background:rgba(255,255,255,0.06); border:1px solid var(--line);
      color:var(--faint); font-family:var(--font-mono); font-size:10.5px; }
  `;
  document.head.appendChild(s);
}

export function createUnlockLadder(onClose: () => void): UnlockLadder {
  ensureStyles();

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:42; display:none; flex-direction:column; align-items:center;" +
    "padding:22px 16px; background:rgba(11,9,6,0.92); font-family:var(--font-body);" +
    "overflow-y:auto; user-select:none;";

  const title = document.createElement("div");
  title.textContent = "진화 갈래";
  title.style.cssText =
    "color:#ffe08a; font-family:'Black Han Sans',sans-serif; font-size:26px; letter-spacing:0.02em; margin-top:6px;";

  const sub = document.createElement("div");
  sub.textContent = "레벨이 오를수록 새 갈래와 카드가 열립니다. 레벨은 런을 마칠 때마다 쌓입니다.";
  sub.style.cssText =
    "color:var(--sub); font-size:12.5px; line-height:1.5; text-align:center; max-width:330px; margin-top:8px;";

  // 현재 레벨 + 진척도 바(다음 레벨까지). levelUpScreen 과 같은 금빛 바.
  const levelLine = document.createElement("div");
  levelLine.style.cssText =
    "color:#ffe08a; font-family:var(--font-title); font-size:18px; margin-top:14px;";
  const track = document.createElement("div");
  track.style.cssText =
    "width:min(80vw,300px); height:12px; background:rgba(255,255,255,0.06); border:1px solid var(--line);" +
    "border-radius:7px; overflow:hidden; margin-top:8px;";
  const fill = document.createElement("div");
  fill.style.cssText =
    "height:100%; width:0%; border-radius:7px; background:linear-gradient(90deg,#f0c840,#ffe08a);";
  track.appendChild(fill);
  const intoText = document.createElement("div");
  intoText.style.cssText = "color:var(--faint); font-family:var(--font-mono); font-size:11px; margin-top:6px;";

  const list = document.createElement("div");
  list.style.cssText =
    "display:flex; flex-direction:column; gap:8px; width:min(88vw,360px); margin-top:18px;";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "닫기";
  closeBtn.style.cssText =
    "margin:20px 0 6px; padding:11px 40px; border:1px solid var(--line); border-radius:var(--r-btn);" +
    "background:rgba(255,255,255,0.05); color:var(--ink); font-family:var(--font-body); font-size:14px; cursor:pointer;";
  closeBtn.addEventListener("click", onClose);

  overlay.append(title, sub, levelLine, track, intoText, list, closeBtn);
  document.body.appendChild(overlay);

  const rebuild = (): void => {
    const info = metaLevelInfo(loadMeta().metaXp);
    levelLine.textContent = `현재 레벨 ${info.level}`;
    const pct = info.need > 0 ? Math.min(1, info.into / info.need) : 1;
    fill.style.width = `${(pct * 100).toFixed(1)}%`;
    intoText.textContent = `다음 레벨까지 ${Math.max(0, info.need - info.into)} / ${info.need}`;

    list.replaceChildren();
    // 레벨 오름차순으로 사다리를 펼친다(열린 것 위, 앞으로 열릴 것 아래 — 자연스러운 진행 순).
    const tiers = [...UNLOCK_TIERS].sort((a, b) => a.atLevel - b.atLevel);
    const nextLevel = tiers.find((t) => t.atLevel > info.level)?.atLevel ?? -1;
    for (const t of tiers) {
      const unlocked = t.atLevel <= info.level;
      const isNext = t.atLevel === nextLevel;
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex; align-items:center; gap:11px; padding:10px 12px; border-radius:12px;" +
        (unlocked
          ? "border:1px solid #46542a; background:rgba(255,224,138,0.06);"
          : isNext
            ? "border:1px solid #6b5620; background:rgba(245,195,59,0.05);"
            : "border:1px solid var(--line); background:rgba(255,255,255,0.02);");

      const mark = document.createElement("div");
      if (unlocked) {
        mark.className = "ul-mark";
      } else {
        mark.className = "ul-lock";
        mark.textContent = String(t.atLevel);
      }

      const texts = document.createElement("div");
      texts.style.cssText = "display:flex; flex-direction:column; gap:2px; text-align:left; min-width:0; flex:1;";
      const name = document.createElement("div");
      name.textContent = t.label;
      name.style.cssText =
        `font-family:var(--font-title); font-size:15px;` +
        (unlocked ? "color:#ffe08a;" : isNext ? "color:#e8cf94;" : "color:var(--sub);");
      const detail = document.createElement("div");
      detail.textContent = t.detail;
      detail.style.cssText =
        `font-size:12px; font-weight:500; line-height:1.35;` +
        (unlocked ? "color:#a7b596;" : "color:var(--faint);");
      texts.append(name, detail);

      // 우측 상태 꼬리표 — 열림 / 다음 / 레벨 N 필요.
      const tag = document.createElement("div");
      tag.style.cssText = "flex:none; font-family:var(--font-mono); font-size:10.5px; letter-spacing:0.1em;";
      if (unlocked) {
        tag.textContent = "열림";
        tag.style.color = "var(--lime)";
      } else if (isNext) {
        tag.textContent = "다음";
        tag.style.color = "#f0c840";
      } else {
        tag.textContent = `레벨 ${t.atLevel}`;
        tag.style.color = "var(--faint)";
      }

      row.append(mark, texts, tag);
      list.appendChild(row);
    }
  };

  return {
    show: () => {
      rebuild(); // 열 때마다 현재 레벨을 다시 읽는다(런 사이에 레벨이 올랐을 수 있다)
      overlay.scrollTop = 0;
      overlay.style.display = "flex";
    },
    hide: () => {
      overlay.style.display = "none";
    },
  };
}
