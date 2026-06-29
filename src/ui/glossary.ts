// 대백과 (2단계). 첫 화면은 분류별 항목 버튼, 누르면 그림과 설명, 실제 게임 수치가 나온다.
// 형질 도감(기본 0.5 + 수치 표) · 생물 도감(내 종+야생) · 위협 도감(보스·대멸종) · 처음이라면(튜토리얼).
// 자족적 HTML 오버레이. 로비, 일시정지에서 연다. sim 과 무관(읽기 전용).
// 문구 규칙: 쉬운 말, 한글 사이 em dash 금지(마침표·쉼표·줄바꿈으로 대신).

export interface Glossary {
  show: () => void;
  hide: () => void;
}

interface Row {
  k: string;
  v: string;
  bar?: number; // 0~1, 수치의 크기를 막대로 보여줌(실제 인게임 크기 비율). 범주형 행은 생략.
  base?: boolean; // 기본값(0.5 또는 동급) 행 강조. "여기서 시작한다"가 보이게.
}
interface Entry {
  term: string;
  svg?: string; // 관련 그림(인라인 SVG)
  desc: string; // 무엇인지 쉬운 설명
  rows?: Row[]; // 실제 게임 수치 표(형질·생물 도감)
  note?: string; // 보조 설명 한 줄
  weak?: string; // 약점(위협 도감)
}
interface Section {
  title: string;
  intro?: string;
  entries: Entry[];
}

const creature = (color: string): string =>
  `<svg viewBox="0 0 140 90"><ellipse cx="68" cy="46" rx="34" ry="20" fill="${color}" stroke="#0a0e16" stroke-width="2"/><circle cx="88" cy="40" r="5" fill="#fff"/><circle cx="90" cy="40" r="2.4" fill="#111"/></svg>`;

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
  scale:
    '<svg viewBox="0 0 140 90"><line x1="16" y1="60" x2="124" y2="60" stroke="#3b465c" stroke-width="3"/><circle cx="16" cy="60" r="5" fill="#7b8595"/><circle cx="70" cy="60" r="6" fill="#9bffa0"/><circle cx="124" cy="60" r="5" fill="#7b8595"/><text x="70" y="40" fill="#9bffa0" font-size="15" text-anchor="middle" font-family="sans-serif">0.5</text></svg>',
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
  stalker:
    '<svg viewBox="0 0 140 90"><path d="M16 72 Q28 40 48 54 Q56 34 74 52 Q88 36 104 56 Q120 48 124 72 Z" fill="#2f5a36"/><circle cx="58" cy="52" r="4.5" fill="#ffd27a"/><circle cx="84" cy="54" r="4.5" fill="#ffd27a"/><circle cx="58" cy="52" r="2" fill="#1a1008"/><circle cx="84" cy="54" r="2" fill="#1a1008"/></svg>',
  cold:
    '<svg viewBox="0 0 140 90"><rect x="10" y="14" width="120" height="62" rx="8" fill="#3a6cff" opacity="0.4"/><g stroke="#d6e6ff" stroke-width="2.5" stroke-linecap="round"><line x1="70" y1="26" x2="70" y2="64"/><line x1="51" y1="45" x2="89" y2="45"/><line x1="57" y1="32" x2="83" y2="58"/><line x1="83" y1="32" x2="57" y2="58"/></g></svg>',
  heat:
    '<svg viewBox="0 0 140 90"><rect x="10" y="14" width="120" height="62" rx="8" fill="#ff5a2a" opacity="0.38"/><circle cx="70" cy="45" r="13" fill="#ffd27a"/><g stroke="#ffd27a" stroke-width="3" stroke-linecap="round"><line x1="70" y1="20" x2="70" y2="28"/><line x1="70" y1="62" x2="70" y2="70"/><line x1="45" y1="45" x2="53" y2="45"/><line x1="87" y1="45" x2="95" y2="45"/></g></svg>',
  famine:
    '<svg viewBox="0 0 140 90"><rect x="10" y="14" width="120" height="62" rx="8" fill="#8a6a3a" opacity="0.45"/><g stroke="#caa86a" stroke-width="2.5" stroke-linecap="round"><line x1="40" y1="58" x2="48" y2="40"/><line x1="48" y1="40" x2="44" y2="30"/><line x1="70" y1="60" x2="72" y2="36"/><line x1="98" y1="56" x2="92" y2="40"/></g></svg>',
  plague:
    '<svg viewBox="0 0 140 90"><rect x="10" y="14" width="120" height="62" rx="8" fill="#5a7a3a" opacity="0.5"/><circle cx="58" cy="40" r="6" fill="#1a2010"/><circle cx="82" cy="40" r="6" fill="#1a2010"/><path d="M56 58 Q70 50 84 58" fill="none" stroke="#1a2010" stroke-width="3"/></svg>',
  flow:
    '<svg viewBox="0 0 140 90"><g fill="#161b26" stroke="#3b465c" stroke-width="1.5"><rect x="8" y="34" width="26" height="22" rx="4"/><rect x="57" y="34" width="26" height="22" rx="4"/><rect x="106" y="34" width="26" height="22" rx="4"/></g><g fill="#6cff7a"><polygon points="38,45 50,39 50,51"/><polygon points="87,45 99,39 99,51"/></g></svg>',
  card:
    '<svg viewBox="0 0 140 90"><rect x="30" y="18" width="34" height="54" rx="6" fill="#161b26" stroke="#2a3346" stroke-width="2"/><rect x="76" y="18" width="34" height="54" rx="6" fill="#161b26" stroke="#6cc24a" stroke-width="2"/><line x1="82" y1="34" x2="104" y2="34" stroke="#6cff7a" stroke-width="3"/><line x1="82" y1="44" x2="100" y2="44" stroke="#9aa" stroke-width="2"/></svg>',
  trophy:
    '<svg viewBox="0 0 140 90"><path d="M54 22 h32 v14 a16 16 0 0 1 -32 0 z" fill="#ffd27a" stroke="#b8923a" stroke-width="2"/><rect x="64" y="52" width="12" height="12" fill="#ffd27a"/><rect x="54" y="64" width="32" height="8" rx="2" fill="#b8923a"/></svg>',
};

const SECTIONS: readonly Section[] = [
  {
    title: "형질 도감",
    intro: "모든 형질은 0에서 1 사이입니다. 모든 종은 0.5에서 시작하고, 카드 한 장은 보통 0.15에서 0.28을 더하거나 뺍니다.",
    entries: [
      {
        term: "수치 읽는 법",
        svg: SVG.scale,
        desc: "형질은 0(가장 낮음)에서 1(가장 높음) 사이 값입니다. 모든 종은 0.5에서 시작합니다.",
        note: '예를 들어 "속도 +0.22" 카드는 속도를 0.5에서 0.72로 올린다는 뜻입니다. 아래 각 형질에서 그 값이 실제 게임에서 얼마인지 볼 수 있습니다.',
      },
      {
        term: "속도",
        svg: SVG.speed,
        desc: "빨리 움직여 먹이를 먼저 차지하고, 추격자에게서 도망칩니다.",
        rows: [
          { k: "0.0 (가장 느림)", v: "1초에 약 20", bar: 0.28 },
          { k: "0.5 (기본)", v: "약 46", bar: 0.65, base: true },
          { k: "1.0 (가장 빠름)", v: "약 71 (3.5배)", bar: 1 },
        ],
        note: "막대는 가장 빠른 종(1.0) 대비 속도입니다. 거리는 화면 기준이며, 화면 너비는 540입니다.",
      },
      {
        term: "시야",
        svg: SVG.vision,
        desc: "먹이와 위험을 얼마나 멀리서 알아채는지 정합니다. 관전 중 내 종에 파란 원으로 보입니다.",
        rows: [
          { k: "0.0", v: "반경 52", bar: 0.29 },
          { k: "0.5 (기본)", v: "반경 117", bar: 0.64, base: true },
          { k: "1.0", v: "반경 182", bar: 1 },
        ],
        note: "화면 너비가 540이니, 시야 1.0이면 가로의 약 1/3을 봅니다.",
      },
      {
        term: "대사",
        svg: SVG.metabolism,
        desc: "에너지를 쓰는 속도입니다. 높으면 자주 먹어야 하지만 추위에 강하고, 더위와 독에는 약합니다.",
        rows: [
          { k: "0.0 (느린 대사)", v: "1틱에 0.065 소모, 추위에 약함", bar: 0.33 },
          { k: "0.5 (기본)", v: "0.13 소모", bar: 0.67, base: true },
          { k: "1.0 (뜨거운 피)", v: "0.195 소모, 추위에 강함", bar: 1 },
        ],
      },
      {
        term: "번식력",
        svg: SVG.fertility,
        desc: "새끼를 얼마나 자주 치는지 정합니다. 잃은 수를 빨리 메웁니다.",
        rows: [
          { k: "0.0", v: "1틱에 0.3% 확률", bar: 0.23 },
          { k: "0.5 (기본)", v: "0.8%", bar: 0.62, base: true },
          { k: "1.0", v: "1.3% (약 4배)", bar: 1 },
        ],
        note: "에너지가 78 이상일 때만 새끼를 칩니다.",
      },
      {
        term: "공격력",
        svg: SVG.attack,
        desc: "사냥 성공률을 높이고, 나보다 약한 포식자는 무서워하지 않아 덜 쫓깁니다.",
        rows: [
          { k: "상대와 같음", v: "사냥 성공 50%", bar: 0.5, base: true },
          { k: "상대보다 0.2 높음", v: "약 76%", bar: 0.76 },
          { k: "상대보다 0.2 낮음", v: "약 24%", bar: 0.24 },
        ],
        note: "막대는 사냥 성공 확률입니다.",
      },
      {
        term: "무리 성향",
        svg: SVG.herding,
        desc: "함께 모여 다니고, 모이면 서로 보온합니다.",
        rows: [
          { k: "0.0", v: "무리 효과 없음", bar: 0 },
          { k: "0.5 (기본)", v: "모이면 추위 소모 약 27% 감소", bar: 0.27, base: true },
          { k: "1.0", v: "약 55% 감소", bar: 0.55 },
        ],
        note: "막대는 모였을 때 추위 에너지 소모가 줄어드는 비율입니다.",
      },
      {
        term: "식성",
        svg: SVG.diet,
        desc: "무엇을 먹는지입니다. 시작에 고르고, 반대 성향 카드를 얻으면 잡식이 됩니다.",
        rows: [
          { k: "0.35 미만", v: "초식 (식물만)" },
          { k: "0.35 ~ 0.7", v: "잡식 (둘 다, 가까운 쪽 먼저)" },
          { k: "0.7 초과", v: "육식 (주로 사냥)" },
        ],
      },
    ],
  },
  {
    title: "생물 도감",
    intro: "내 종과 함께 사는 야생 6종입니다. 야생종 수치는 매 판 조금씩 흔들립니다.",
    entries: [
      {
        term: "내 종",
        svg: creature("#6cc24a"),
        desc: "당신이 기르는 종입니다. 모든 형질이 0.5에서 시작하는 균형형 잡식이며, 모든 먹이를 먹습니다. 카드로 원하는 방향으로 특화시키세요.",
        rows: [
          { k: "식성", v: "잡식 (모든 먹이)" },
          { k: "시작 수", v: "36마리" },
          { k: "특징", v: "균형형, 카드로 무엇이든 될 수 있음" },
        ],
      },
      {
        term: "초식 경쟁자",
        svg: creature("#46a6c8"),
        desc: "연두색 먹이를 먹는 초식 무리입니다. 무리 성향이 높아 함께 다닙니다.",
        rows: [
          { k: "식성", v: "초식 (연두 먹이)" },
          { k: "눈에 띄는 형질", v: "무리 성향 높음 (0.6)" },
        ],
      },
      {
        term: "들풀 무리",
        svg: creature("#9a7ad6"),
        desc: "청록색 먹이 전문 초식 무리입니다. 조금 빠르고 큰 무리를 이룹니다.",
        rows: [
          { k: "식성", v: "초식 (청록 먹이)" },
          { k: "눈에 띄는 형질", v: "무리 성향 높음 (0.6), 조금 빠름" },
        ],
      },
      {
        term: "작은 풀벌레",
        svg: creature("#d6c24a"),
        desc: "노란색 먹이 전문입니다. 약하지만 번식력이 매우 높아(다산형) 잡아먹혀도 수로 버팁니다.",
        rows: [
          { k: "식성", v: "초식 (노랑 먹이)" },
          { k: "눈에 띄는 형질", v: "번식력 매우 높음 (0.78), 무리 성향 높음" },
        ],
      },
      {
        term: "느린 거북",
        svg: creature("#5fae6a"),
        desc: "연두와 노랑 먹이를 먹는 저대사 장수형입니다. 느리고 적게 낳지만 에너지를 거의 안 써 오래 버팁니다.",
        rows: [
          { k: "식성", v: "초식 (연두, 노랑 먹이)" },
          { k: "눈에 띄는 형질", v: "대사 매우 낮음 (0.28), 느림" },
        ],
      },
      {
        term: "잡식 청소부",
        svg: creature("#c88a4a"),
        desc: "모든 먹이를 먹는 잡식입니다. 약한 사냥도 합니다. 먹이가 유연해 틈새에서 살아남습니다.",
        rows: [
          { k: "식성", v: "잡식 (모든 먹이 + 약한 사냥)" },
          { k: "눈에 띄는 형질", v: "고루 균형, 무리 성향 낮음" },
        ],
      },
      {
        term: "포식자",
        svg: creature("#e0653a"),
        desc: "식물을 안 먹는 육식입니다. 다른 종을 사냥합니다. 먹잇감이 많아야 유지됩니다.",
        rows: [
          { k: "식성", v: "육식 (사냥만)" },
          { k: "눈에 띄는 형질", v: "공격력 높음 (0.7), 빠름, 넓은 시야" },
        ],
      },
    ],
  },
  {
    title: "위협 도감",
    intro: "보스는 버티기 관문이고, 대멸종은 마지막 시험입니다. 각자 약점(키우면 유리한 형질)이 있습니다.",
    entries: [
      { term: "빠른 추격자", svg: SVG.chaser, desc: "아주 빠르게 쫓아와 닿으면 잡아먹습니다.", weak: "속도" },
      { term: "사나운 무리", svg: SVG.swarm, desc: "쉴 새 없이 개체를 하나씩 솎아냅니다.", weak: "번식력과 많은 수" },
      { term: "독 안개", svg: SVG.poison, desc: "사방의 공기에 독이 퍼져 에너지를 빨아갑니다. 피할 수 없습니다.", weak: "낮은 대사" },
      { term: "약탈자", svg: SVG.raider, desc: "사방에서 달려들어 약한 개체부터 쓰러뜨립니다.", weak: "공격력" },
      { term: "외톨이 사냥꾼", svg: SVG.isolation, desc: "무리에서 떨어진 외톨이를 노려 잡아갑니다.", weak: "무리 성향" },
      { term: "그림자 매복자", svg: SVG.stalker, desc: "수풀에 숨어 있다 덮칩니다. 미리 알아채지 못한 개체부터 당합니다.", weak: "시야 (넓을수록 일찍 보고 피함)" },
      { term: "혹독한 추위", svg: SVG.cold, desc: "혹독한 추위가 닥쳐 얼어 죽습니다.", weak: "높은 대사 (뜨거운 피)" },
      { term: "폭염", svg: SVG.heat, desc: "불볕더위에 타 죽습니다.", weak: "낮은 대사" },
      { term: "대가뭄", svg: SVG.famine, desc: "먹이가 다시 자라지 않습니다.", weak: "낮은 대사와 많은 수" },
      { term: "대역병", svg: SVG.plague, desc: "병이 번져 개체가 하나씩 스러집니다.", weak: "번식력" },
    ],
  },
  {
    title: "처음이라면",
    entries: [
      {
        term: "한 판의 흐름",
        svg: SVG.flow,
        desc: "시작에 식성을 고르고, 단계마다 카드 3장 중 1장을 골라 형질을 키웁니다. 그 사이 관전하며 무리가 살아남는지 봅니다. 보스 관문을 버티고, 마지막 대멸종까지 살아남으면 승리입니다.",
      },
      {
        term: "카드 고르기",
        svg: SVG.card,
        desc: "카드는 형질을 올리거나 내립니다. 한 판 동안 누적되고, 새 판에서 리셋됩니다. 트레이드오프 카드는 한쪽을 크게 올리는 대신 다른 쪽을 내립니다.",
        note: "형질 도감에서 각 형질이 실제로 어떤 효과인지 미리 볼 수 있습니다.",
      },
      {
        term: "위협에 대비하기",
        svg: SVG.card,
        desc: "보스와 대멸종은 각각 약점이 있습니다. 단계 전에 다가오는 위협을 예고로 알려줍니다. 그 약점에 해당하는 형질을 키우는 카드를 고르세요.",
        note: "위협 도감에서 각 위협의 약점을 미리 확인하세요.",
      },
      {
        term: "이기는 법",
        svg: SVG.trophy,
        desc: "마지막 대멸종까지 내 종이 살아남으면 승리합니다. 한 형질만 극단으로 올리기보다, 다가오는 위협에 맞춰 균형을 잡는 것이 안전합니다.",
      },
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
    "width:min(100%,460px); height:min(88vh,680px); box-sizing:border-box; display:flex; flex-direction:column;" +
    "background:#0c1018; border:1px solid #3b465c; border-radius:14px; color:#e6e6e6; overflow:hidden;";

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid #232c3c;";
  const back = document.createElement("button");
  back.textContent = "‹ 뒤로";
  back.style.cssText =
    "border:1px solid #3b465c; background:#161b26; color:#cdd5df; border-radius:9px;" +
    "padding:7px 12px; font-size:14px; font-weight:700; cursor:pointer; visibility:hidden;";
  const title = document.createElement("div");
  title.textContent = "대백과";
  title.style.cssText = "flex:1; font-size:18px; font-weight:800;";
  const close = document.createElement("button");
  close.textContent = "닫기";
  close.style.cssText =
    "border:1px solid #3b465c; background:#161b26; color:#e6e6e6; border-radius:9px;" +
    "padding:7px 13px; font-size:14px; font-weight:700; cursor:pointer;";
  header.append(back, title, close);

  const body = document.createElement("div");
  body.style.cssText = "flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:6px 14px 16px;";

  // 목록 화면
  const listView = document.createElement("div");
  for (const sec of SECTIONS) {
    const h = document.createElement("div");
    h.textContent = sec.title;
    h.style.cssText = "color:#9bffa0; font-size:14px; font-weight:800; margin:16px 2px 6px;";
    listView.appendChild(h);
    if (sec.intro) {
      const intro = document.createElement("div");
      intro.textContent = sec.intro;
      intro.style.cssText = "color:#aeb7c4; font-size:12.5px; line-height:1.5; margin:0 2px 8px;";
      listView.appendChild(intro);
    }
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

  // 상세 화면
  const detailView = document.createElement("div");
  detailView.style.display = "none";

  function showList(): void {
    detailView.style.display = "none";
    listView.style.display = "block";
    back.style.visibility = "hidden";
    body.scrollTop = 0;
  }
  function showDetail(e: Entry): void {
    detailView.replaceChildren();

    if (e.svg) {
      const img = document.createElement("div");
      img.style.cssText =
        "margin:14px 0; padding:12px; background:#0a0e16; border:1px solid #232c3c; border-radius:12px;" +
        "display:flex; justify-content:center; align-items:center; height:140px;";
      img.innerHTML = e.svg;
      detailView.appendChild(img);
    }

    const term = document.createElement("div");
    term.textContent = e.term;
    term.style.cssText = "font-size:21px; font-weight:800; margin:8px 0 6px;";
    detailView.appendChild(term);

    const desc = document.createElement("div");
    desc.textContent = e.desc;
    desc.style.cssText = "color:#cdd5df; font-size:15px; line-height:1.65; word-break:keep-all;";
    detailView.appendChild(desc);

    if (e.rows) {
      const label = document.createElement("div");
      label.textContent = "인게임 수치";
      label.style.cssText = "color:#8a93a6; font-size:12px; font-weight:700; margin:16px 0 6px;";
      detailView.appendChild(label);
      const table = document.createElement("div");
      table.style.cssText =
        "border:1px solid #232c3c; border-radius:10px; overflow:hidden; background:#0a0e16;";
      e.rows.forEach((r, idx) => {
        const row = document.createElement("div");
        row.style.cssText =
          "padding:9px 12px;" +
          (idx > 0 ? "border-top:1px solid #1a2230;" : "") +
          (r.base ? "background:#101a18;" : "");
        const head = document.createElement("div");
        head.style.cssText = "display:flex; justify-content:space-between; gap:10px; align-items:baseline;";
        const k = document.createElement("span");
        k.textContent = r.base ? r.k + " ◀ 시작값" : r.k;
        k.style.cssText = "color:" + (r.base ? "#9bffb0" : "#aeb7c4") + "; font-size:13.5px; flex:0 0 auto; font-weight:" + (r.base ? "700" : "400") + ";";
        const v = document.createElement("span");
        v.textContent = r.v;
        v.style.cssText = "color:#e6e6e6; font-size:13.5px; font-weight:600; text-align:right; word-break:keep-all;";
        head.append(k, v);
        row.appendChild(head);
        if (r.bar !== undefined) {
          const pct = Math.round(Math.max(0, Math.min(1, r.bar)) * 100);
          const track = document.createElement("div");
          track.style.cssText = "margin-top:7px; height:7px; border-radius:4px; background:#1a2230; overflow:hidden;";
          const fill = document.createElement("div");
          fill.style.cssText =
            "height:100%; width:" + pct + "%; border-radius:4px; background:" + (r.base ? "#9bffb0" : "#6cff7a") + ";";
          track.appendChild(fill);
          row.appendChild(track);
        }
        table.appendChild(row);
      });
      detailView.appendChild(table);
    }

    if (e.weak) {
      const label = document.createElement("div");
      label.textContent = "약점 (키우면 유리한 형질)";
      label.style.cssText = "color:#8a93a6; font-size:12px; font-weight:700; margin:16px 0 5px;";
      detailView.appendChild(label);
      const box = document.createElement("div");
      box.textContent = e.weak;
      box.style.cssText =
        "background:#13201a; border:1px solid #2c4a38; border-radius:10px; padding:11px 13px;" +
        "color:#9bffb0; font-size:15px; font-weight:700;";
      detailView.appendChild(box);
    }

    if (e.note) {
      const note = document.createElement("div");
      note.textContent = e.note;
      note.style.cssText = "color:#9aa3b2; font-size:13px; line-height:1.55; margin-top:14px; word-break:keep-all;";
      detailView.appendChild(note);
    }

    listView.style.display = "none";
    detailView.style.display = "block";
    back.style.visibility = "visible";
    body.scrollTop = 0;
  }

  body.append(listView, detailView);
  panel.append(header, body);
  scrim.appendChild(panel);
  document.body.appendChild(scrim);

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
