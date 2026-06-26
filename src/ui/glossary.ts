// 용어 사전 (2단계). 첫 화면은 용어 버튼 목록, 누르면 이미지(SVG)와 설명, 수치 영향이 나온다.
// 자족적 HTML 오버레이(인라인 스타일). 로비, 일시정지에서 연다. sim 과 무관(읽기 전용).
// 문구 규칙: 쉬운 말, 한글 사이 em dash 금지(마침표·쉼표·줄바꿈으로 대신).

export interface Glossary {
  show: () => void;
  hide: () => void;
}

interface Entry {
  term: string;
  svg: string; // 관련 그림(인라인 SVG)
  desc: string; // 무엇인지 쉬운 설명
  impact: string; // 인게임 수치 영향 / 약점
}
interface Section {
  title: string;
  entries: Entry[];
}

// 작은 그림들(스키매틱). 어두운 패널 위라 밝은 색.
const SVG = {
  speed:
    '<svg viewBox="0 0 140 90"><line x1="14" y1="32" x2="46" y2="32" stroke="#7b8595" stroke-width="5"/><polygon points="46,25 60,32 46,39" fill="#7b8595"/><line x1="14" y1="60" x2="104" y2="60" stroke="#6cff7a" stroke-width="5"/><polygon points="104,52 120,60 104,68" fill="#6cff7a"/></svg>',
  vision:
    '<svg viewBox="0 0 140 90"><circle cx="70" cy="45" r="38" fill="none" stroke="#7ec8ff" stroke-width="2" stroke-dasharray="5 4"/><circle cx="70" cy="45" r="19" fill="none" stroke="#7ec8ff" stroke-width="2" stroke-dasharray="3 3" opacity="0.55"/><circle cx="70" cy="45" r="6" fill="#6cff7a"/></svg>',
  metabolism:
    '<svg viewBox="0 0 140 90"><path d="M70 16 C84 36 94 46 84 64 C79 76 58 77 54 62 C51 50 64 50 60 36 C67 41 66 28 70 16Z" fill="#ff7a3a" stroke="#ffb070" stroke-width="2"/></svg>',
  fertility:
    '<svg viewBox="0 0 140 90"><ellipse cx="28" cy="45" rx="14" ry="10" fill="#6cff7a"/><polygon points="50,38 66,45 50,52" fill="#aeb7c4"/><circle cx="86" cy="30" r="8" fill="#9bffa0"/><circle cx="108" cy="48" r="8" fill="#9bffa0"/><circle cx="86" cy="64" r="8" fill="#9bffa0"/></svg>',
  attack:
    '<svg viewBox="0 0 140 90"><polygon points="50,42 56,22 62,42" fill="#ff5535"/><polygon points="64,42 70,18 76,42" fill="#ff5535"/><polygon points="78,42 84,22 90,42" fill="#ff5535"/><ellipse cx="70" cy="54" rx="30" ry="15" fill="#c88a4a" stroke="#7a4a28" stroke-width="2"/></svg>',
  herding:
    '<svg viewBox="0 0 140 90"><circle cx="60" cy="36" r="8" fill="#9a7ad6"/><circle cx="80" cy="38" r="8" fill="#9a7ad6"/><circle cx="68" cy="54" r="8" fill="#9a7ad6"/><circle cx="86" cy="56" r="8" fill="#9a7ad6"/><circle cx="73" cy="44" r="8" fill="#9a7ad6"/></svg>',
  diet:
    '<svg viewBox="0 0 140 90"><path d="M18 62 C18 36 44 30 58 33 C55 58 36 64 18 62Z" fill="#6cc24a"/><path d="M86 30 L116 30 L108 54 L101 40 L93 54Z" fill="#e8e8e8" stroke="#9aa" stroke-width="1.5"/></svg>',
  food:
    '<svg viewBox="0 0 140 90"><circle cx="42" cy="45" r="12" fill="#9bee5a"/><circle cx="70" cy="45" r="12" fill="#5ad6b0"/><circle cx="98" cy="45" r="12" fill="#d8de5a"/></svg>',
  energy:
    '<svg viewBox="0 0 140 90"><rect x="22" y="37" width="96" height="18" rx="9" fill="#1a2230" stroke="#3b465c" stroke-width="2"/><rect x="25" y="40" width="58" height="12" rx="6" fill="#6cff7a"/></svg>',
  chaser:
    '<svg viewBox="0 0 140 90"><line x1="28" y1="45" x2="62" y2="45" stroke="#ff5535" stroke-width="3" opacity="0.45"/><circle cx="86" cy="45" r="17" fill="#ff5535" stroke="#3a0d06" stroke-width="2"/></svg>',
  swarm:
    '<svg viewBox="0 0 140 90"><circle cx="58" cy="36" r="6" fill="#ff5535"/><circle cx="76" cy="32" r="6" fill="#ff5535"/><circle cx="86" cy="50" r="6" fill="#ff5535"/><circle cx="64" cy="54" r="6" fill="#ff5535"/><circle cx="72" cy="43" r="6" fill="#ff5535"/><circle cx="90" cy="38" r="6" fill="#ff5535"/></svg>',
  poison:
    '<svg viewBox="0 0 140 90"><rect x="10" y="14" width="120" height="62" rx="8" fill="#6a9a4a" opacity="0.5"/><circle cx="70" cy="45" r="13" fill="#6a9a4a"/></svg>',
  raider:
    '<svg viewBox="0 0 140 90"><circle cx="70" cy="45" r="10" fill="#c88a4a"/><polygon points="32,45 46,40 46,50" fill="#ff5535"/><polygon points="108,45 94,40 94,50" fill="#ff5535"/><polygon points="70,14 64,28 76,28" fill="#ff5535"/><polygon points="70,76 64,62 76,62" fill="#ff5535"/></svg>',
  isolation:
    '<svg viewBox="0 0 140 90"><circle cx="34" cy="40" r="6" fill="#9a7ad6"/><circle cx="48" cy="46" r="6" fill="#9a7ad6"/><circle cx="40" cy="53" r="6" fill="#9a7ad6"/><circle cx="100" cy="46" r="8" fill="#9a7ad6"/><polygon points="120,46 108,40 108,52" fill="#ff5535"/></svg>',
  cold:
    '<svg viewBox="0 0 140 90"><rect x="10" y="14" width="120" height="62" rx="8" fill="#3a6cff" opacity="0.4"/><g stroke="#d6e6ff" stroke-width="2.5" stroke-linecap="round"><line x1="70" y1="26" x2="70" y2="64"/><line x1="51" y1="45" x2="89" y2="45"/><line x1="57" y1="32" x2="83" y2="58"/><line x1="83" y1="32" x2="57" y2="58"/></g></svg>',
  heat:
    '<svg viewBox="0 0 140 90"><rect x="10" y="14" width="120" height="62" rx="8" fill="#ff5a2a" opacity="0.38"/><circle cx="70" cy="45" r="13" fill="#ffd27a"/><g stroke="#ffd27a" stroke-width="3" stroke-linecap="round"><line x1="70" y1="20" x2="70" y2="28"/><line x1="70" y1="62" x2="70" y2="70"/><line x1="45" y1="45" x2="53" y2="45"/><line x1="87" y1="45" x2="95" y2="45"/></g></svg>',
  famine:
    '<svg viewBox="0 0 140 90"><rect x="10" y="14" width="120" height="62" rx="8" fill="#8a6a3a" opacity="0.45"/><g stroke="#caa86a" stroke-width="2.5" stroke-linecap="round"><line x1="40" y1="58" x2="48" y2="40"/><line x1="48" y1="40" x2="44" y2="30"/><line x1="70" y1="60" x2="72" y2="36"/><line x1="98" y1="56" x2="92" y2="40"/></g></svg>',
  plague:
    '<svg viewBox="0 0 140 90"><rect x="10" y="14" width="120" height="62" rx="8" fill="#5a7a3a" opacity="0.5"/><circle cx="58" cy="40" r="6" fill="#1a2010"/><circle cx="82" cy="40" r="6" fill="#1a2010"/><path d="M56 58 Q70 50 84 58" fill="none" stroke="#1a2010" stroke-width="3"/></svg>',
};

const SECTIONS: readonly Section[] = [
  {
    title: "형질",
    entries: [
      {
        term: "속도",
        svg: SVG.speed,
        desc: "빨리 움직여 먹이를 먼저 차지하고, 추격자에게서 도망칩니다.",
        impact: "가장 높이면 가장 낮을 때보다 약 3.5배 빠릅니다.",
      },
      {
        term: "시야",
        svg: SVG.vision,
        desc: "먹이와 위험을 얼마나 멀리서 알아채는지 정합니다.",
        impact: "감지 반경이 약 52에서 182까지(3.5배). 관전 중 내 종에 파란 원으로 보입니다.",
      },
      {
        term: "대사",
        svg: SVG.metabolism,
        desc: "에너지를 쓰는 속도입니다. 높으면 자주 먹어야 하지만 추위에 강합니다.",
        impact: "에너지 소모가 최대 3배. 추위 피해는 줄고, 더위와 독 피해는 늡니다.",
      },
      {
        term: "번식력",
        svg: SVG.fertility,
        desc: "새끼를 얼마나 자주 치는지 정합니다. 잃은 수를 빨리 메웁니다.",
        impact: "번식 확률이 약 4배까지. 단 에너지가 78 이상일 때만 번식합니다.",
      },
      {
        term: "공격력",
        svg: SVG.attack,
        desc: "사냥 성공률을 높이고, 나보다 약한 포식자는 무서워하지 않아 덜 쫓깁니다.",
        impact: "사냥 성공률: 상대와 같으면 50%, 크게 앞서면 95%, 크게 밀리면 5%.",
      },
      {
        term: "무리 성향",
        svg: SVG.herding,
        desc: "함께 모여 다니고, 모이면 서로 보온합니다.",
        impact: "모여 있으면 추위 소모를 최대 55%까지 줄입니다.",
      },
      {
        term: "식성",
        svg: SVG.diet,
        desc: "무엇을 먹는지입니다. 시작에 고르고, 반대 성향 카드를 얻으면 잡식이 됩니다. 잡식은 먹이와 사냥감 중 가까운 쪽을 먼저 노립니다.",
        impact: "0.35 미만은 초식, 0.35에서 0.7은 잡식, 0.7 초과는 육식.",
      },
    ],
  },
  {
    title: "먹이와 에너지",
    entries: [
      {
        term: "먹이 색",
        svg: SVG.food,
        desc: "먹이는 세 종류로 색이 다릅니다. 종마다 먹는 종류가 달라 서로 덜 다툽니다.",
        impact: "내 종(잡식)은 세 종류 모두 먹습니다.",
      },
      {
        term: "에너지",
        svg: SVG.energy,
        desc: "먹으면 차오르고 가만히 있어도 줄어듭니다.",
        impact: "0이 되면 죽습니다. 78 이상이면 새끼를 칠 수 있습니다.",
      },
    ],
  },
  {
    title: "보스 (버티기 관문)",
    entries: [
      { term: "빠른 추격자", svg: SVG.chaser, desc: "아주 빠르게 쫓아와 닿으면 잡아먹습니다.", impact: "약점: 속도" },
      { term: "사나운 무리", svg: SVG.swarm, desc: "쉴 새 없이 개체를 하나씩 솎아냅니다.", impact: "약점: 번식력과 많은 수" },
      { term: "독 안개", svg: SVG.poison, desc: "사방의 공기에 독이 퍼져 에너지를 빨아갑니다. 피할 수 없습니다.", impact: "약점: 낮은 대사" },
      { term: "약탈자", svg: SVG.raider, desc: "사방에서 달려들어 약한 개체부터 쓰러뜨립니다.", impact: "약점: 공격력" },
      { term: "외톨이 사냥꾼", svg: SVG.isolation, desc: "무리에서 떨어진 외톨이를 노려 잡아갑니다.", impact: "약점: 무리 성향" },
    ],
  },
  {
    title: "대멸종 (마지막 시험)",
    entries: [
      { term: "혹독한 추위", svg: SVG.cold, desc: "혹독한 추위가 닥쳐 얼어 죽습니다.", impact: "약점: 높은 대사(뜨거운 피)" },
      { term: "폭염", svg: SVG.heat, desc: "불볕더위에 타 죽습니다.", impact: "약점: 낮은 대사" },
      { term: "대가뭄", svg: SVG.famine, desc: "먹이가 다시 자라지 않습니다.", impact: "약점: 낮은 대사와 많은 수" },
      { term: "대역병", svg: SVG.plague, desc: "병이 번져 개체가 하나씩 스러집니다.", impact: "약점: 번식력" },
    ],
  },
];

export function createGlossary(): Glossary {
  const scrim = document.createElement("div");
  scrim.style.cssText =
    "position:fixed; inset:0; z-index:40; display:none; box-sizing:border-box; padding:16px;" +
    "background:rgba(6,9,14,0.8); justify-content:center; align-items:center;" +
    "font-family:system-ui,-apple-system,sans-serif;";

  const panel = document.createElement("div");
  panel.style.cssText =
    "width:min(100%,460px); height:min(86vh,640px); box-sizing:border-box; display:flex; flex-direction:column;" +
    "background:#0c1018; border:1px solid #3b465c; border-radius:14px; color:#e6e6e6; overflow:hidden;";

  // 헤더: 뒤로(상세에서만) / 제목 / 닫기
  const header = document.createElement("div");
  header.style.cssText =
    "display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid #232c3c;";
  const back = document.createElement("button");
  back.textContent = "‹ 뒤로";
  back.style.cssText =
    "border:1px solid #3b465c; background:#161b26; color:#cdd5df; border-radius:9px;" +
    "padding:7px 12px; font-size:14px; font-weight:700; cursor:pointer; visibility:hidden;";
  const title = document.createElement("div");
  title.textContent = "용어 사전";
  title.style.cssText = "flex:1; font-size:18px; font-weight:800;";
  const close = document.createElement("button");
  close.textContent = "닫기";
  close.style.cssText =
    "border:1px solid #3b465c; background:#161b26; color:#e6e6e6; border-radius:9px;" +
    "padding:7px 13px; font-size:14px; font-weight:700; cursor:pointer;";
  header.append(back, title, close);

  const body = document.createElement("div");
  body.style.cssText = "flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:6px 14px 16px;";

  // 목록 화면(용어 버튼들)
  const listView = document.createElement("div");
  for (const sec of SECTIONS) {
    const h = document.createElement("div");
    h.textContent = sec.title;
    h.style.cssText = "color:#9bffa0; font-size:13px; font-weight:800; margin:14px 2px 8px;";
    listView.appendChild(h);
    const grid = document.createElement("div");
    grid.style.cssText = "display:flex; flex-wrap:wrap; gap:8px;";
    for (const e of sec.entries) {
      const b = document.createElement("button");
      b.textContent = e.term;
      b.style.cssText =
        "border:1px solid #2a3346; background:#161b26; color:#e6e6e6; border-radius:10px;" +
        "padding:10px 14px; font-size:15px; font-weight:700; cursor:pointer;";
      b.addEventListener("click", () => showDetail(e));
      grid.appendChild(b);
    }
    listView.appendChild(grid);
  }

  // 상세 화면(이미지 + 설명 + 영향)
  const detailView = document.createElement("div");
  detailView.style.display = "none";
  const dImg = document.createElement("div");
  dImg.style.cssText =
    "margin:14px 0; padding:14px; background:#0a0e16; border:1px solid #232c3c; border-radius:12px;" +
    "display:flex; justify-content:center; align-items:center; height:150px;";
  const dTerm = document.createElement("div");
  dTerm.style.cssText = "font-size:21px; font-weight:800; margin-bottom:4px;";
  const dDesc = document.createElement("div");
  dDesc.style.cssText = "color:#cdd5df; font-size:15px; line-height:1.65; word-break:keep-all;";
  const dImpactLabel = document.createElement("div");
  dImpactLabel.textContent = "인게임 영향";
  dImpactLabel.style.cssText = "color:#8a93a6; font-size:12px; font-weight:700; margin:16px 0 5px;";
  const dImpact = document.createElement("div");
  dImpact.style.cssText =
    "background:#13201a; border:1px solid #2c4a38; border-radius:10px; padding:11px 13px;" +
    "color:#9bffb0; font-size:14.5px; line-height:1.55; font-weight:600; word-break:keep-all;";
  detailView.append(dImg, dTerm, dDesc, dImpactLabel, dImpact);

  body.append(listView, detailView);
  panel.append(header, body);
  scrim.appendChild(panel);
  document.body.appendChild(scrim);

  function showList(): void {
    detailView.style.display = "none";
    listView.style.display = "block";
    back.style.visibility = "hidden";
    title.textContent = "용어 사전";
    body.scrollTop = 0;
  }
  function showDetail(e: Entry): void {
    dImg.innerHTML = e.svg;
    dTerm.textContent = e.term;
    dDesc.textContent = e.desc;
    dImpact.textContent = e.impact;
    listView.style.display = "none";
    detailView.style.display = "block";
    back.style.visibility = "visible";
    title.textContent = "용어 사전";
    body.scrollTop = 0;
  }

  const hide = (): void => {
    scrim.style.display = "none";
  };
  back.addEventListener("click", showList);
  close.addEventListener("click", hide);
  scrim.addEventListener("click", (ev) => {
    if (ev.target === scrim) hide();
  });

  return {
    show: () => {
      showList();
      scrim.style.display = "flex";
    },
    hide,
  };
}
