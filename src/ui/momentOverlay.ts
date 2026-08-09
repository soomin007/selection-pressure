// 승리·정복·멸종 순간 연출 — 결과 화면이 뜨기 직전, 전역 화면에 짧은 클라이맥스 연출을 얹는다.
// 캔버스 위 HTML 오버레이(CSS 애니메이션). sim·렌더와 무관한 순수 연출이라 결정론에 영향 없다.
//   win      한 시대를 넘김 — 은은한 황록빛 광채(아직 끝이 아니다).
//   conquest 마지막 시대 정복 — 황금빛 개화 + 섬광 + "정복" 큰 글자(클라이맥스).
//   lose     멸종 — 화면이 어둑히 닫힌다 + "멸종" 담담한 글자(스러짐). 결과 패널 뒤로 어둠이 남는다.

export type MomentKind = "win" | "conquest" | "lose";

export interface MomentOverlay {
  /** 연출을 재생하고, 결과 패널을 띄울 시점에 onDone 을 부른다(연출이 살짝 겹치며 넘어간다).
   * loseWord: 패배 큰 글자 치환("불씨 꺼짐" 등). 개체가 살아 있는데 "멸종" 글자는 거짓이라 사유별로 나눈다. */
  play: (kind: MomentKind, onDone: () => void, loseWord?: string) => void;
  /**
   * **티어 승급** — 범주 하나가 다음 단에 올라선 순간. 런을 끊지 않는다(월드는 계속 돌고 onDone 도 없다).
   *
   * ⚠ **v7 의 「정점」 연출을 재활용하지 않는다**(2026-08-09 · [사용자] 지적으로 통째로 새로 짰다).
   *   옛 연출은 형질 하나가 100 에 닿는 **단 한 번의 사건**을 위해 만든 것이라, 92px "정점" 글자와
   *   금빛 고리가 전부였다. v8 은 승급이 한 판에 열 번도 일어나는데 그걸 그대로 쓰니
   *   ① 가죽 II단에도 화면이 "정점"이라 외치고 ② 「가죽 IV 4」처럼 단이 두 번 적히고
   *   ③ 1단과 4단이 똑같이 요란해 **무엇이 큰 일인지 안 읽혔다.**
   *
   * 새 연출이 지키는 것 넷:
   *   ① **단을 눈금으로 보여 준다** — 네 칸 중 몇 칸이 찼는지가 글자보다 먼저 읽힌다.
   *   ② **강도가 단을 따라 오른다** — 1단은 조용히 스치고, 4단에서만 고리가 퍼진다
   *      (4단은 수치가 아니라 **규칙 밖으로 나가는** 단이라 그 자리에만 클라이맥스를 남긴다).
   *   ③ **월드를 안 가린다** — 전체 화면 커튼이 아니라 위쪽 띠다. 승급 중에도 무리가 보이고,
   *      연출 동안 시간이 안 멈추는 문제(backlog)의 피해도 그만큼 준다.
   *   ④ **무엇이 열렸는지 말한다**(`gain`) — 이건 옛 연출이 유일하게 옳았던 것이라 그대로 잇는다.
   *      이 줄이 없으면 빛만 번쩍이고 끝난다(도감에만 있으면 미달 · CLAUDE.md 전달 규칙).
   *
   * `label` 은 이미 다 지어진 문구다("가죽 IV") · `tier` 는 눈금 몇 칸을 채울지에만 쓴다.
   *
   * 여러 단이 한꺼번에 오르면(시대 보상 ×3 · 방울 연속 구입) **줄을 세워 차례로** 보여 준다.
   * 부르는 쪽이 setTimeout 으로 엮으면 순서가 화면 밖 사정에 휘둘린다.
   */
  tierUp: (label: string, tier: number, gain: string) => void;
  /**
   * **시대 전환** — "다음 시대로"를 누른 순간, 새 세계가 만들어지기 전에 짧고 굵게 한 번.
   *
   * 시대가 올라도 화면이 그대로면 무엇이 험해졌는지 어디에서도 안 읽힌다. 여기서 무엇이 늘고
   * 무엇이 열리는지 세 줄로 못박고, 연출이 끝나면 `onDone` 으로 실제 전환을 넘긴다(호출부가
   * 순서를 쥔다 — 세계를 먼저 만들면 곧바로 뜨는 드래프트가 이 연출을 덮는다).
   */
  era: (title: string, lines: string[], onDone: () => void) => void;
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
/* 티어 승급 — 위쪽 띠가 내려와 잠깐 머물다 올라간다(월드를 안 가린다 · 런이 안 끊긴다). */
@keyframes moment-tier-band { 0%{transform:translateY(-22px);opacity:0} 16%{transform:translateY(0);opacity:1} 80%{transform:translateY(0);opacity:1} 100%{transform:translateY(-10px);opacity:0} }
/* 눈금 한 칸이 톡 하고 박힌다. 마지막 칸만 늦게 박혀 "이번에 오른 단"이 눈에 띈다. */
@keyframes moment-tier-pip { 0%{transform:scale(0.2);opacity:0} 55%{transform:scale(1.35)} 100%{transform:scale(1);opacity:1} }
/* 4단에서만 퍼지는 고리 — 규칙 밖으로 나가는 단이라 그 자리에만 클라이맥스를 남긴다. */
@keyframes moment-tier-ring { 0%{transform:scale(0.45);opacity:0} 22%{opacity:0.75} 100%{transform:scale(2.0);opacity:0} }
/* 시대 전환 — 어두운 붉은 기운이 위에서 덮쳐 내려온다("세계가 험해졌다"). 글자는 솟았다 잠시 머물고 스러진다. */
@keyframes moment-era-sweep { 0%{transform:translateY(-100%);opacity:0} 18%{transform:translateY(0);opacity:1} 76%{opacity:1} 100%{opacity:0} }
@keyframes moment-era-word { 0%{transform:translateY(18px) scale(0.86);opacity:0} 18%{transform:translateY(0) scale(1.04);opacity:1} 78%{transform:translateY(0) scale(1);opacity:1} 100%{transform:translateY(-8px) scale(1);opacity:0} }
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

  const play = (kind: MomentKind, onDone: () => void, loseWord?: string): void => {
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
          "position:absolute; inset:0; background:radial-gradient(circle at 50% 50%, rgba(40,14,10,0.35) 18%, rgba(11,9,6,0.85) 96%)",
          "moment-close 1.4s ease-out forwards",
        ),
      );
      root.appendChild(
        wordLayer(loseWord ?? "멸종", "#E85C43", "0 3px 20px rgba(0,0,0,0.8)", "moment-word-dim 1.6s ease-out forwards"),
      );
      window.setTimeout(onDone, 1250);
      // lose 는 오버레이를 안 숨긴다 — 결과 패널 뒤로 어둠 유지. clear() 에서 지운다.
    }
  };

  // 승급 연출은 **자기 레이어**에서 논다 — play() 의 root 를 같이 쓰면 멸종 어둠(clear 전까지 남는다)을
  // 지워 버리거나, 반대로 승급 빛이 결과 화면 뒤에 남는다.
  const tierRoot = document.createElement("div");
  tierRoot.style.cssText =
    "position:fixed; left:0; right:0; top:0; z-index:18; pointer-events:none; display:none;" +
    "font-family:system-ui,-apple-system,sans-serif;";
  document.body.appendChild(tierRoot);
  let tierTimer = 0;
  /** 아직 못 보여 준 승급들. 여럿이 한꺼번에 올라도 차례로 하나씩 보여 준다. */
  const tierQueue: { label: string; tier: number; gain: string }[] = [];
  let tierPlaying = false;

  /** 단마다 다른 세기 — 1단은 스치듯, 4단은 오래 머물고 고리가 퍼진다. */
  const TIER_LOOK = [
    { ms: 900, accent: "#9fb98a", ring: false },
    { ms: 950, accent: "#9fb98a", ring: false },
    { ms: 1100, accent: "#bcd77a", ring: false },
    { ms: 1300, accent: "#e8c85a", ring: false },
    { ms: 1750, accent: "#FFE27A", ring: true },
  ] as const;

  /** 큐에서 하나 꺼내 그린다. 비었으면 레이어를 접는다. */
  const tierNext = (): void => {
    const item = tierQueue.shift();
    if (item === undefined) {
      tierPlaying = false;
      tierRoot.style.display = "none";
      tierRoot.replaceChildren();
      return;
    }
    tierPlaying = true;
    const look = TIER_LOOK[Math.max(0, Math.min(4, item.tier))] ?? TIER_LOOK[0];
    tierRoot.replaceChildren();
    tierRoot.style.display = "block";

    // 띠 — 화면 위쪽 · 목표 줄 아래. 월드를 덮지 않는 높이로만 자란다.
    const band = document.createElement("div");
    // ⚠ **가운데 맞추기를 transform 으로 하지 않는다.** 이 띠는 `transform` 을 움직이는 애니메이션을
    //   달고 있어서, `translateX(-50%)` 를 같이 쓰면 키프레임이 그걸 통째로 덮어쓴다 —
    //   띠가 오른쪽으로 밀려 화면 밖으로 67px 나갔다(2026-08-09 겹침 검사가 잡았다).
    //   좌우 0 + `margin:auto` 는 transform 과 안 싸운다.
    band.style.cssText =
      "position:absolute; left:0; right:0; top:20vh; margin:0 auto;" +
      "width:min(92vw,420px); box-sizing:border-box; padding:12px 16px 13px;" +
      "border-radius:14px; border:1px solid rgba(255,255,255,0.10);" +
      "background:linear-gradient(180deg, rgba(24,28,22,0.94), rgba(16,19,15,0.94));" +
      "box-shadow:0 8px 28px rgba(0,0,0,0.55);" +
      `animation:moment-tier-band ${look.ms}ms ease-out forwards;`;

    // 4단에서만 — 띠 뒤로 고리가 한 번 퍼진다.
    if (look.ring) {
      const ring = document.createElement("div");
      ring.style.cssText =
        "position:absolute; left:50%; top:20vh; width:38vmin; height:38vmin; margin:-19vmin 0 0 -19vmin;" +
        `border-radius:50%; border:3px solid ${look.accent};` +
        `box-shadow:0 0 34px ${look.accent}88, inset 0 0 34px ${look.accent}55;` +
        "animation:moment-tier-ring 1.5s ease-out forwards;";
      tierRoot.appendChild(ring);
    }

    // 첫 줄 — 눈금 넷 + 「가죽 III단」. 눈금이 글자보다 먼저 읽힌다.
    const head = document.createElement("div");
    head.style.cssText = "display:flex; align-items:center; gap:10px;";
    const pips = document.createElement("div");
    pips.style.cssText = "display:flex; gap:5px; flex:0 0 auto;";
    for (let i = 1; i <= 4; i += 1) {
      const dot = document.createElement("div");
      const filled = i <= item.tier;
      dot.style.cssText =
        "width:11px; height:11px; border-radius:3px;" +
        (filled
          ? `background:${look.accent}; box-shadow:0 0 10px ${look.accent}99;`
          : "background:rgba(255,255,255,0.13);") +
        // 이번에 오른 칸만 늦게 박힌다 — "무엇이 방금 올랐나"가 그 지연으로 읽힌다.
        (i === item.tier ? "animation:moment-tier-pip 420ms ease-out 180ms backwards;" : "");
      pips.appendChild(dot);
    }
    const name = document.createElement("div");
    // 단 표기는 **부르는 쪽이 정한다** — 드래프트 미리보기(`draftPanel`)와 같은 문법("가죽 IV")을
    // 쓰려면 로마자 표가 필요한데, 그 표는 sim/tiers 에 있다. 여기서 다시 만들면 두 화면이 갈라진다.
    name.textContent = item.label;
    name.style.cssText =
      `color:${look.accent}; font-size:min(5vw,20px); font-weight:800; letter-spacing:0.01em;` +
      "text-shadow:0 2px 10px rgba(0,0,0,0.8);";
    head.append(pips, name);

    // 둘째 줄 — **무엇이 열렸는가.** 이 줄이 이 연출의 존재 이유다(없으면 빛만 번쩍이고 끝난다).
    const sub = document.createElement("div");
    sub.textContent = item.gain;
    sub.style.cssText =
      "margin-top:6px; color:#d8e2d2; font-size:min(3.9vw,15px); font-weight:500; line-height:1.5;";

    band.append(head, sub);
    tierRoot.appendChild(band);
    tierTimer = window.setTimeout(tierNext, look.ms);
  };

  const tierUp = (label: string, tier: number, gain: string): void => {
    tierQueue.push({ label, tier, gain });
    if (!tierPlaying) tierNext();
  };

  // 시대 전환 연출 — 결과 화면(z-index 20대)이 아직 떠 있을 수 있으므로 자기 레이어를 그 위에 둔다.
  const eraRoot = document.createElement("div");
  eraRoot.style.cssText =
    "position:fixed; inset:0; z-index:34; pointer-events:none; display:none; overflow:hidden;" +
    "font-family:system-ui,-apple-system,sans-serif;";
  document.body.appendChild(eraRoot);
  let eraTimer = 0;

  const era = (title: string, lines: string[], onDone: () => void): void => {
    window.clearTimeout(eraTimer);
    eraRoot.replaceChildren();
    eraRoot.style.display = "block";

    eraRoot.appendChild(
      layer(
        "position:absolute; inset:0; background:linear-gradient(180deg, rgba(88,18,10,0.96), rgba(14,10,8,0.97))",
        "moment-era-sweep 2.6s ease-out forwards",
      ),
    );

    const stack = document.createElement("div");
    stack.style.cssText =
      "position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;" +
      "justify-content:center; gap:10px; text-align:center; padding:0 26px;" +
      "animation:moment-era-word 2.6s ease-out forwards;";

    const word = document.createElement("div");
    word.textContent = title;
    word.style.cssText =
      "color:#FFD9A0; font-family:'Black Han Sans',sans-serif; font-size:min(15vw,80px);" +
      "letter-spacing:0.06em; text-shadow:0 3px 24px rgba(0,0,0,0.9);";

    const head = document.createElement("div");
    head.textContent = "세계가 험해집니다";
    head.style.cssText =
      "color:#F5C33B; font-size:min(5.4vw,23px); font-weight:800; letter-spacing:0.02em;" +
      "text-shadow:0 2px 10px rgba(0,0,0,0.9);";

    stack.append(word, head);
    for (const t of lines) {
      const line = document.createElement("div");
      line.textContent = t;
      line.style.cssText =
        "color:#EAD9B8; font-size:min(4.1vw,16px); font-weight:600; line-height:1.5; max-width:24em;" +
        "word-break:keep-all; text-shadow:0 2px 10px rgba(0,0,0,0.9);";
      stack.appendChild(line);
    }
    eraRoot.appendChild(stack);

    // 연출이 다 스러진 뒤에 실제 전환을 넘긴다 — 세계를 먼저 만들면 곧장 뜨는 시대 보상 드래프트가
    // 이 화면을 덮어 아무도 못 본다(known_issues "전체 화면 패널이 곧바로 뜨는 자리").
    eraTimer = window.setTimeout(() => {
      eraRoot.style.display = "none";
      eraRoot.replaceChildren();
      onDone();
    }, 2500);
  };

  const clear = (): void => {
    root.style.display = "none";
    root.replaceChildren();
    window.clearTimeout(tierTimer);
    tierQueue.length = 0; // 줄 서 있던 승급도 함께 버린다(새 월드에 옛 승급이 뒤늦게 뜨지 않게)
    tierPlaying = false;
    tierRoot.style.display = "none";
    tierRoot.replaceChildren();
    // ⚠ 시대 연출은 여기서 지우지 않는다 — 새 월드가 만들어지는 순간(onWorldChanged)에 clear 가 불리는데,
    //   시대 연출은 바로 그 전환을 감싸며 재생 중이다. 지우면 자기 자신을 지운다.
  };

  return { play, tierUp, era, clear };
}

function wordLayer(text: string, color: string, shadow: string, anim: string): HTMLDivElement {
  const d = document.createElement("div");
  d.textContent = text;
  d.style.cssText =
    "position:absolute; inset:0; display:flex; align-items:center; justify-content:center;" +
    `color:${color}; font-family:'Black Han Sans',sans-serif; font-size:min(24vw,132px); letter-spacing:0.06em;` +
    `text-shadow:${shadow}; animation:${anim};`;
  return d;
}
