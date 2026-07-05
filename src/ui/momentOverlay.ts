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
@keyframes moment-flash { 0%{opacity:0} 10%{opacity:0.92} 100%{opacity:0} }
@keyframes moment-bloom { 0%{transform:scale(0.25);opacity:0} 22%{opacity:1} 100%{transform:scale(2.6);opacity:0} }
@keyframes moment-word { 0%{transform:scale(0.7);opacity:0} 24%{transform:scale(1.06);opacity:1} 72%{opacity:1} 100%{transform:scale(1);opacity:0} }
@keyframes moment-close { 0%{opacity:0} 45%{opacity:1} 100%{opacity:1} }
@keyframes moment-word-dim { 0%{opacity:0} 35%{opacity:0.92} 80%{opacity:0.92} 100%{opacity:0.55} }
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
      // 황금빛 개화 + 흰 섬광 + "정복".
      root.appendChild(
        layer(
          "position:absolute; inset:-20%; background:radial-gradient(circle at 50% 46%, rgba(255,224,120,0.95), rgba(255,180,60,0.5) 40%, transparent 66%)",
          "moment-bloom 1.9s ease-out forwards",
        ),
      );
      root.appendChild(
        layer("position:absolute; inset:0; background:#fff", "moment-flash 1.5s ease-out forwards"),
      );
      root.appendChild(
        wordLayer("정복", "#ffe08a", "0 2px 18px rgba(180,120,20,0.8)", "moment-word 1.9s ease-out forwards"),
      );
      window.setTimeout(onDone, 1500);
      window.setTimeout(() => (root.style.display = "none"), 1950);
    } else if (kind === "win") {
      // 한 시대를 넘김 — 은은한 황록빛 광채.
      root.appendChild(
        layer(
          "position:absolute; inset:-20%; background:radial-gradient(circle at 50% 48%, rgba(155,255,150,0.8), rgba(120,200,90,0.35) 42%, transparent 64%)",
          "moment-bloom 1.15s ease-out forwards",
        ),
      );
      root.appendChild(
        layer("position:absolute; inset:0; background:#efffe0", "moment-flash 1.0s ease-out forwards"),
      );
      window.setTimeout(onDone, 800);
      window.setTimeout(() => (root.style.display = "none"), 1200);
    } else {
      // 멸종 — 화면이 어둑히 닫힌다 + "멸종". 어둠은 결과 패널 뒤로 남는다(clear 로 지운다).
      root.appendChild(
        layer(
          "position:absolute; inset:0; background:radial-gradient(circle at 50% 50%, rgba(30,6,6,0.35) 20%, rgba(6,7,10,0.9) 90%)",
          "moment-close 1.3s ease-out forwards",
        ),
      );
      root.appendChild(
        wordLayer("멸종", "#e0604a", "0 2px 16px rgba(0,0,0,0.7)", "moment-word-dim 1.4s ease-out forwards"),
      );
      window.setTimeout(onDone, 1000);
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
