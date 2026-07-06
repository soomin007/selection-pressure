// 승리·정복·멸종 순간 연출 — 결과 화면이 뜨기 직전, 전역 화면에 짧은 클라이맥스 연출을 얹는다.
// 캔버스 위 HTML 오버레이(CSS 애니메이션). sim·렌더와 무관한 순수 연출이라 결정론에 영향 없다.
//   win      한 시대를 넘김 — 은은한 황록빛 광채(아직 끝이 아니다).
//   conquest 마지막 시대 정복 — 황금빛 개화 + 섬광 + "정복" 큰 글자(클라이맥스).
//   lose     멸종 — 화면이 어둑히 닫힌다 + "멸종" 담담한 글자(스러짐). 결과 패널 뒤로 어둠이 남는다.

export type MomentKind = "win" | "conquest" | "lose";

export interface MomentOverlay {
  /** 연출을 재생하고, 결과 패널을 띄울 시점에 onDone 을 부른다(연출이 살짝 겹치며 넘어간다). */
  play: (kind: MomentKind, onDone: () => void) => void;
  /** 남은 오버레이를 지운다(새 월드 시작 등). */
  clear: () => void;
}

let stylesInjected = false;
function ensureStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement("style");
  s.textContent = `
@keyframes moment-flash { 0%{opacity:0} 8%{opacity:0.95} 100%{opacity:0} }
@keyframes moment-bloom { 0%{transform:scale(0.2);opacity:0} 18%{opacity:1} 100%{transform:scale(2.9);opacity:0} }
@keyframes moment-rays { 0%{transform:rotate(-8deg);opacity:0} 20%{opacity:0.8} 100%{transform:rotate(46deg);opacity:0} }
@keyframes moment-word { 0%{transform:scale(0.6);opacity:0} 20%{transform:scale(1.12)} 30%{transform:scale(1);opacity:1} 78%{opacity:1} 100%{transform:scale(1.04);opacity:0} }
@keyframes moment-close { 0%{opacity:0} 45%{opacity:1} 100%{opacity:1} }
@keyframes moment-word-dim { 0%{transform:scale(0.8);opacity:0} 30%{opacity:0.95} 82%{opacity:0.95} 100%{transform:scale(1);opacity:0.6} }
`;
  document.head.appendChild(s);
}

export function createMomentOverlay(): MomentOverlay {
  ensureStyles();
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed; inset:0; z-index:19; pointer-events:none; display:none; overflow:hidden;" +
    "font-family:system-ui,-apple-system,sans-serif;";
  document.body.appendChild(root);

  const layer = (css: string, anim: string): HTMLDivElement => {
    const d = document.createElement("div");
    d.style.cssText = css + `;animation:${anim};`;
    return d;
  };

  const play = (kind: MomentKind, onDone: () => void): void => {
    root.replaceChildren();
    root.style.display = "block";

    if (kind === "conquest") {
      // 정복 — 황금빛 개화 + 사방으로 뻗는 햇살(rays) + 흰 섬광 + "정복" 큰 글자. 가장 화려하게.
      root.appendChild(
        layer(
          "position:absolute; inset:-30%; background:repeating-conic-gradient(from 0deg at 50% 45%, rgba(255,226,150,0.42) 0deg 4deg, transparent 4deg 15deg)",
          "moment-rays 2.2s ease-out forwards",
        ),
      );
      root.appendChild(
        layer(
          "position:absolute; inset:-20%; background:radial-gradient(circle at 50% 45%, rgba(255,230,140,0.98), rgba(255,180,60,0.55) 38%, transparent 66%)",
          "moment-bloom 2.2s ease-out forwards",
        ),
      );
      root.appendChild(
        layer("position:absolute; inset:0; background:#fff", "moment-flash 1.6s ease-out forwards"),
      );
      root.appendChild(
        wordLayer("정복", "#ffe27a", "0 3px 26px rgba(180,110,20,0.9)", "moment-word 2.2s ease-out forwards"),
      );
      window.setTimeout(onDone, 1750);
      window.setTimeout(() => (root.style.display = "none"), 2300);
    } else if (kind === "win") {
      // 한 시대를 넘김 — 뚜렷한 황록빛 개화 + 섬광 + "생존" 글자(무엇이 일어났는지 읽히게).
      root.appendChild(
        layer(
          "position:absolute; inset:-20%; background:radial-gradient(circle at 50% 47%, rgba(170,255,150,0.95), rgba(130,220,90,0.5) 40%, transparent 66%)",
          "moment-bloom 1.5s ease-out forwards",
        ),
      );
      root.appendChild(
        layer("position:absolute; inset:0; background:#eaffd6", "moment-flash 1.3s ease-out forwards"),
      );
      root.appendChild(
        wordLayer("생존", "#c9ffb0", "0 2px 20px rgba(60,140,40,0.85)", "moment-word 1.5s ease-out forwards"),
      );
      window.setTimeout(onDone, 1150);
      window.setTimeout(() => (root.style.display = "none"), 1550);
    } else {
      // 멸종 — 화면이 어둑히 닫히며 "멸종" 큰 글자. 어둠은 결과 패널 뒤로 남는다(clear 로 지운다).
      root.appendChild(
        layer(
          "position:absolute; inset:0; background:radial-gradient(circle at 50% 50%, rgba(30,10,10,0.35) 18%, rgba(8,11,17,0.82) 96%)",
          "moment-close 1.4s ease-out forwards",
        ),
      );
      root.appendChild(
        wordLayer("멸종", "#e0604a", "0 3px 20px rgba(0,0,0,0.8)", "moment-word-dim 1.6s ease-out forwards"),
      );
      window.setTimeout(onDone, 1250);
      // lose 는 오버레이를 안 숨긴다 — 결과 패널 뒤로 어둠 유지. clear() 에서 지운다.
    }
  };

  const clear = (): void => {
    root.style.display = "none";
    root.replaceChildren();
  };

  return { play, clear };
}

function wordLayer(text: string, color: string, shadow: string, anim: string): HTMLDivElement {
  const d = document.createElement("div");
  d.textContent = text;
  d.style.cssText =
    "position:absolute; inset:0; display:flex; align-items:center; justify-content:center;" +
    `color:${color}; font-size:min(22vw,120px); font-weight:900; letter-spacing:0.1em;` +
    `text-shadow:${shadow}; animation:${anim};`;
  return d;
}
