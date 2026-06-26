// 용어 사전 — 형질·먹이·보스·대멸종이 실제로 어떻게 작동하는지 쉬운 말로 모아 본다.
// 자족적 HTML 오버레이(인라인 스타일). 로비·일시정지에서 열 수 있다. sim 과 무관(읽기 전용 설명).

export interface Glossary {
  show: () => void;
  hide: () => void;
}

interface Entry {
  term: string;
  desc: string;
}
interface Section {
  title: string;
  intro?: string;
  entries: Entry[];
}

const SECTIONS: readonly Section[] = [
  {
    title: "형질 — 내 종을 빚는 7가지",
    entries: [
      { term: "속도", desc: "빨리 움직여 먹이를 먼저 차지하고, 추격자에게서 도망칩니다." },
      { term: "시야", desc: "먹이와 위험을 얼마나 멀리서 알아채는지. 관전 중 내 종에 그려지는 파란 원이 그 범위입니다." },
      { term: "대사", desc: "에너지를 쓰는 속도. 높으면 자주 먹어야 하지만 추위에 강하고, 더위와 독에는 약합니다." },
      { term: "번식력", desc: "새끼를 얼마나 자주 치는지. 에너지가 넉넉할 때만 번식하며, 잃은 수를 빨리 메웁니다." },
      { term: "공격력", desc: "사냥 성공률을 높입니다. 또 나보다 약한 포식자는 무서워하지 않아 덜 쫓깁니다. 등의 가시로 보입니다." },
      { term: "무리 성향", desc: "함께 모여 다니고, 모이면 서로 보온해 추위를 덜 탑니다." },
      { term: "식성", desc: "시작에 정합니다. 초식은 식물만, 잡식은 식물과 사냥 둘 다(가까운 쪽 우선), 육식은 주로 사냥. 반대 성향 카드를 얻으면 잡식이 됩니다." },
    ],
  },
  {
    title: "먹이와 에너지",
    entries: [
      { term: "먹이 색", desc: "먹이는 3종류로 색이 다릅니다. 종마다 먹는 종류가 달라 서로 덜 다툽니다. 내 종(잡식)은 모두 먹습니다." },
      { term: "에너지", desc: "먹으면 차오르고 가만히 있어도 줄어듭니다. 넉넉하면 새끼를 치고, 0이 되면 죽습니다." },
    ],
  },
  {
    title: "보스 — 버티기 관문",
    intro: "정해진 시간을 견디면 통과합니다. 보스마다 약점(키우면 유리한 형질)이 다릅니다. 전투 전 예고를 보고 카드를 맞춰 뽑으세요.",
    entries: [
      { term: "빠른 추격자", desc: "닿으면 잡아먹습니다. 약점: 속도." },
      { term: "사나운 무리", desc: "쉴 새 없이 하나씩 솎아냅니다. 약점: 번식력과 많은 수." },
      { term: "독 안개", desc: "사방의 공기에 독이 퍼져 에너지를 빨아갑니다. 피할 수 없습니다. 약점: 낮은 대사." },
      { term: "약탈자", desc: "약한 개체부터 쓰러뜨립니다. 약점: 공격력." },
      { term: "외톨이 사냥꾼", desc: "무리에서 떨어진 외톨이를 노립니다. 약점: 무리 성향." },
    ],
  },
  {
    title: "대멸종 — 마지막 시험",
    intro: "환경이 통째로 바뀌는 큰 시험입니다. 끝까지 살아남으면 승리합니다.",
    entries: [
      { term: "혹독한 추위", desc: "얼어 죽습니다. 약점: 높은 대사(뜨거운 피)." },
      { term: "폭염", desc: "타 죽습니다. 약점: 낮은 대사." },
      { term: "대가뭄", desc: "먹이가 다시 자라지 않습니다. 약점: 낮은 대사와 많은 수." },
      { term: "대역병", desc: "병이 번져 하나씩 스러집니다. 약점: 번식력." },
    ],
  },
];

export function createGlossary(): Glossary {
  const scrim = document.createElement("div");
  scrim.style.cssText =
    "position:fixed; inset:0; z-index:40; display:none; box-sizing:border-box; padding:16px;" +
    "background:rgba(6,9,14,0.78); justify-content:center; align-items:center;" +
    "font-family:system-ui,-apple-system,sans-serif;";

  const panel = document.createElement("div");
  panel.style.cssText =
    "width:min(100%,520px); max-height:88vh; box-sizing:border-box; display:flex; flex-direction:column;" +
    "background:#0c1018; border:1px solid #3b465c; border-radius:14px; color:#e6e6e6; overflow:hidden;";

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid #232c3c;";
  const title = document.createElement("div");
  title.textContent = "용어 사전";
  title.style.cssText = "font-size:19px; font-weight:800;";
  const close = document.createElement("button");
  close.textContent = "닫기";
  close.style.cssText =
    "border:1px solid #3b465c; background:#161b26; color:#e6e6e6; border-radius:9px;" +
    "padding:8px 14px; font-size:15px; font-weight:700; cursor:pointer;";
  header.append(title, close);

  const body = document.createElement("div");
  body.style.cssText = "padding:6px 16px 16px; overflow-y:auto; -webkit-overflow-scrolling:touch;";

  for (const sec of SECTIONS) {
    const h = document.createElement("div");
    h.textContent = sec.title;
    h.style.cssText = "color:#9bffa0; font-size:14px; font-weight:800; margin:14px 0 6px;";
    body.appendChild(h);

    if (sec.intro) {
      const intro = document.createElement("div");
      intro.textContent = sec.intro;
      intro.style.cssText = "color:#aeb7c4; font-size:13px; line-height:1.5; margin-bottom:8px;";
      body.appendChild(intro);
    }

    for (const e of sec.entries) {
      const row = document.createElement("div");
      row.style.cssText = "margin:7px 0; line-height:1.5;";
      const t = document.createElement("span");
      t.textContent = e.term;
      t.style.cssText = "color:#ffffff; font-weight:700; font-size:14.5px;";
      const d = document.createElement("span");
      d.textContent = "  " + e.desc;
      d.style.cssText = "color:#c2cad6; font-size:13.5px; word-break:keep-all;";
      row.append(t, d);
      body.appendChild(row);
    }
  }

  panel.append(header, body);
  scrim.appendChild(panel);
  document.body.appendChild(scrim);

  const hide = (): void => {
    scrim.style.display = "none";
  };
  close.addEventListener("click", hide);
  // 바깥(어두운 배경) 탭하면 닫기. 패널 안 탭은 통과 안 함.
  scrim.addEventListener("click", (ev) => {
    if (ev.target === scrim) hide();
  });

  return {
    show: () => {
      scrim.style.display = "flex";
    },
    hide,
  };
}
