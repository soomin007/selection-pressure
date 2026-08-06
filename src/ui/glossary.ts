// 대백과 (2단계). 첫 화면은 분류별 항목 버튼, 누르면 그림과 설명, 실제 게임 수치가 나온다.
// 형질 도감(범주·티어·열쇠·듀오) · 생물 도감(내 종+야생) · 위협 도감(보스·대멸종) · 처음이라면(튜토리얼).
// 자족적 HTML 오버레이. 로비, 일시정지에서 연다. sim 과 무관(읽기 전용).
// 문구 규칙: 쉬운 말, 한글 사이 em dash 금지(마침표·쉼표·줄바꿈으로 대신).

import { ensurePanelStyles } from "@/ui/panelStyles";
import {
  CARD_POOL,
  cardRarity,
  cardSummary,
  rarityOdds,
  cardPoolFor,
  RARITY_BOOST_FULL_LEVEL,
  type Card,
  type Rarity,
} from "@/game/cards";
import {
  CATEGORIES,
  CATEGORY_DESC,
  CATEGORY_LABELS,
  DUOS,
  DUO_TIER,
  KEY_DESC,
  KEY_LABELS,
  KEY_NAMES,
  KEY_PARENT,
  MAX_KEYS,
  MAX_TIER,
  TIER_ROMAN,
  TIER_STEPS,
  UPKEEP_PER_TIER,
  pipsForTier,
  tierLine,
  type Category,
} from "@/sim/tiers";
import { loadMeta, metaLevel, UNLOCK_TIERS } from "@/game/meta";
import {
  ACHIEVEMENTS,
  achievementForCard,
  cardAvailable,
  COSMETICS,
  loadAchievements,
  type Achievement,
} from "@/game/achievements";
import { RARITY_STYLE, withAlpha } from "@/ui/rarity";
import { cardAccent } from "@/ui/traitDisplay";

export interface Glossary {
  show: () => void;
  hide: () => void;
}

interface Row {
  k: string;
  v: string;
  bar?: number; // 0~1, 수치의 크기를 막대로 보여줌(실제 인게임 크기 비율). 범주형 행은 생략.
  base?: boolean; // 기본값(50 또는 동급) 행 강조. "여기서 시작한다"가 보이게.
}
interface Entry {
  term: string;
  svg?: string; // 관련 그림(인라인 SVG)
  desc: string; // 무엇인지 쉬운 설명
  rows?: Row[]; // 실제 게임 수치 표(형질·생물 도감)
  note?: string; // 보조 설명 한 줄
  weak?: string; // 약점(위협 도감)
  /** 등급별 등장 확률 표(카드 도감 첫 항목). 열 때마다 지금 열린 카드로 새로 계산한다. */
  oddsTable?: boolean;
  /** 이 등급의 카드 목록(카드 도감). 열 때마다 해금 상태를 새로 읽는다. */
  rarity?: Rarity;
  /** 도전 과제 목록(달성 여부 + 보상). 열 때마다 저장본을 새로 읽는다. */
  achievements?: boolean;
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
    '<svg viewBox="0 0 140 90"><path d="M34 45 L41 3 A44 44 0 0 1 41 87 Z" fill="#7ec8ff" opacity="0.14"/><path d="M34 45 L41 3 A44 44 0 0 1 41 87" fill="none" stroke="#7ec8ff" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.6"/><circle cx="34" cy="45" r="7" fill="#6cff7a"/><circle cx="30" cy="45" r="2.6" fill="#0a2a0a"/><circle cx="94" cy="29" r="4" fill="#d8de5a"/></svg>',
  echo:
    '<svg viewBox="0 0 140 90"><circle cx="70" cy="45" r="7" fill="#6cff7a"/><circle cx="70" cy="45" r="19" fill="none" stroke="#c07aff" stroke-width="2" opacity="0.65"/><circle cx="70" cy="45" r="31" fill="none" stroke="#c07aff" stroke-width="2" opacity="0.4"/><circle cx="70" cy="45" r="43" fill="none" stroke="#c07aff" stroke-width="2" opacity="0.2"/></svg>',
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
    '<svg viewBox="0 0 140 90"><line x1="16" y1="60" x2="124" y2="60" stroke="#3b465c" stroke-width="3"/><circle cx="16" cy="60" r="5" fill="#7b8595"/><circle cx="70" cy="60" r="6" fill="#9bffa0"/><circle cx="124" cy="60" r="5" fill="#7b8595"/><text x="70" y="40" fill="#9bffa0" font-size="15" text-anchor="middle" font-family="sans-serif">50</text></svg>',
  food:
    '<svg viewBox="0 0 140 90"><circle cx="42" cy="45" r="12" fill="#9bee5a"/><circle cx="70" cy="45" r="12" fill="#5ad6b0"/><circle cx="98" cy="45" r="12" fill="#d8de5a"/></svg>',
  swimming:
    '<svg viewBox="0 0 140 90"><path d="M14 36 q12 -9 24 0 t24 0 t24 0 t24 0" fill="none" stroke="#5ad6f0" stroke-width="3"/><path d="M14 62 q12 -9 24 0 t24 0 t24 0 t24 0" fill="none" stroke="#5ad6f0" stroke-width="3" opacity="0.6"/><ellipse cx="76" cy="49" rx="16" ry="9" fill="#6cc24a"/><polygon points="62,49 50,42 50,56" fill="#6cc24a"/></svg>',
  wings:
    '<svg viewBox="0 0 140 90"><polygon points="16,80 42,50 68,80" fill="#5a6474" opacity="0.55"/><polygon points="72,80 100,46 128,80" fill="#5a6474" opacity="0.55"/><polygon points="56,40 24,26 46,42" fill="#f0c840"/><polygon points="84,40 116,26 94,42" fill="#f0c840"/><ellipse cx="70" cy="40" rx="13" ry="8" fill="#6cc24a"/></svg>',
  venom:
    '<svg viewBox="0 0 140 90"><ellipse cx="56" cy="46" rx="26" ry="15" fill="#6cc24a"/><polygon points="82,42 96,50 82,58" fill="#6cc24a"/><circle cx="92" cy="38" r="5" fill="#c030e0"/><circle cx="92" cy="58" r="5" fill="#c030e0"/><circle cx="108" cy="30" r="3.5" fill="#c030e0" opacity="0.6"/><circle cx="114" cy="46" r="2.5" fill="#c030e0" opacity="0.4"/></svg>',
  ranged:
    '<svg viewBox="0 0 140 90"><ellipse cx="42" cy="46" rx="24" ry="14" fill="#6cc24a"/><circle cx="56" cy="40" r="4" fill="#fff"/><line x1="66" y1="46" x2="116" y2="46" stroke="#aeb7c4" stroke-width="4"/><polygon points="116,39 130,46 116,53" fill="#aeb7c4"/></svg>',
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
  // 세계 도감 — 바다(파랑)·땅(초록)·산(회색) 비율을 그림으로 한눈에 보인다.
  mapContinent:
    '<svg viewBox="0 0 140 90"><rect x="6" y="8" width="128" height="74" rx="6" fill="#4a8f4a"/><ellipse cx="34" cy="30" rx="14" ry="9" fill="#2a6a8a"/><ellipse cx="102" cy="60" rx="17" ry="10" fill="#2a6a8a"/><ellipse cx="70" cy="24" rx="8" ry="5" fill="#2a6a8a"/><polygon points="60,58 70,42 80,58" fill="#8a97a4"/></svg>',
  mapPangaea:
    '<svg viewBox="0 0 140 90"><rect x="6" y="8" width="128" height="74" rx="6" fill="#2a6a8a"/><ellipse cx="70" cy="45" rx="52" ry="30" fill="#4a8f4a"/><polygon points="44,52 56,28 68,52" fill="#8a97a4"/><polygon points="66,54 80,26 94,54" fill="#8a97a4"/><polygon points="70,26 76,34 64,34" fill="#e0e6ea"/></svg>',
  mapArchipelago:
    '<svg viewBox="0 0 140 90"><rect x="6" y="8" width="128" height="74" rx="6" fill="#2a6a8a"/><ellipse cx="34" cy="28" rx="15" ry="10" fill="#4a8f4a"/><ellipse cx="96" cy="24" rx="12" ry="8" fill="#4a8f4a"/><ellipse cx="56" cy="60" rx="14" ry="9" fill="#4a8f4a"/><ellipse cx="106" cy="62" rx="16" ry="10" fill="#4a8f4a"/><ellipse cx="24" cy="62" rx="8" ry="6" fill="#4a8f4a"/><ellipse cx="72" cy="36" rx="6" ry="4" fill="#4a8f4a"/></svg>',
  mapOcean:
    '<svg viewBox="0 0 140 90"><rect x="6" y="8" width="128" height="74" rx="6" fill="#1e5a7e"/><ellipse cx="44" cy="34" rx="13" ry="8" fill="#4a8f4a"/><ellipse cx="98" cy="58" rx="11" ry="7" fill="#4a8f4a"/><ellipse cx="24" cy="66" rx="6" ry="4" fill="#4a8f4a"/><g stroke="#7fc0e8" stroke-width="2" stroke-linecap="round" opacity="0.6"><path d="M62 22 q7 -5 14 0 q7 5 14 0" fill="none"/><path d="M20 46 q7 -5 14 0 q7 5 14 0" fill="none"/><path d="M76 72 q7 -5 14 0 q7 5 14 0" fill="none"/></g></svg>',
  raptor:
    '<svg viewBox="0 0 140 90"><ellipse cx="86" cy="74" rx="20" ry="6" fill="#0a1408" opacity="0.3"/><path d="M70 34 Q42 24 18 42 Q46 42 62 50 Z" fill="#e0a020" stroke="#5a3a04" stroke-width="2"/><path d="M70 34 Q98 24 122 42 Q94 42 78 50 Z" fill="#e0a020" stroke="#5a3a04" stroke-width="2"/><ellipse cx="70" cy="44" rx="9" ry="19" fill="#c08018" stroke="#5a3a04" stroke-width="2"/><polygon points="70,18 64,32 76,32" fill="#ffd86a" stroke="#5a3a04" stroke-width="1.5"/></svg>',
  hornet:
    '<svg viewBox="0 0 140 90"><ellipse cx="62" cy="28" rx="20" ry="9" fill="#ffffff" opacity="0.4" stroke="#241a06" stroke-width="1"/><ellipse cx="62" cy="62" rx="20" ry="9" fill="#ffffff" opacity="0.4" stroke="#241a06" stroke-width="1"/><line x1="18" y1="45" x2="34" y2="45" stroke="#241a06" stroke-width="4" stroke-linecap="round"/><ellipse cx="56" cy="45" rx="24" ry="15" fill="#ffc814" stroke="#241a06" stroke-width="2"/><rect x="42" y="33" width="7" height="24" fill="#241a06"/><rect x="58" y="33" width="7" height="24" fill="#241a06"/><circle cx="88" cy="45" r="11" fill="#241a06"/><circle cx="106" cy="45" r="9" fill="#ffc814" stroke="#241a06" stroke-width="2"/></svg>',
  shark:
    '<svg viewBox="0 0 140 90"><rect x="10" y="14" width="120" height="62" rx="8" fill="#2a6a8a" opacity="0.35"/><polygon points="22,45 42,30 39,45 42,60" fill="#8a97a4" stroke="#3a4652" stroke-width="1.5"/><polygon points="66,36 84,36 75,20" fill="#8a97a4" stroke="#3a4652" stroke-width="1.5"/><ellipse cx="76" cy="45" rx="34" ry="11" fill="#b0bcc8" stroke="#3a4652" stroke-width="2"/><polygon points="112,45 96,38 96,52" fill="#2a323c"/><circle cx="92" cy="41" r="2.6" fill="#1a2028"/></svg>',
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


// ── 형질 도감(v8) 항목 · 문턱·효과·대가 문구는 전부 sim/tiers 의 상수·함수에서 그대로 가져와
//    만든다(수치를 여기 다시 적으면 두 곳에 적힌 규칙이 조용히 어긋난다). ──

const categorySvg: Record<Category, string> = {
  fang: SVG.attack,
  leg: SVG.speed,
  eye: SVG.vision,
  hide: SVG.metabolism,
  herd: SVG.herding,
};

/** 범주 하나의 도감 항목 · 티어 사다리(무엇이 켜지나)와 대가(무엇이 커지나)를 tierLine 에서 만든다. */
function categoryEntry(cat: Category): Entry {
  const rows: Row[] = [];
  for (let t = 1; t <= MAX_TIER; t += 1) {
    rows.push({ k: `${TIER_ROMAN[t]} (도장 ${pipsForTier(t)})`, v: tierLine(cat, t).gain, bar: t / MAX_TIER });
  }
  return {
    term: CATEGORY_LABELS[cat],
    svg: categorySvg[cat],
    desc: CATEGORY_DESC[cat],
    rows,
    note:
      `대가도 함께 커집니다. ${TIER_ROMAN[1]}에서 「${tierLine(cat, 1).cost}」, ` +
      `${TIER_ROMAN[MAX_TIER]}에서는 「${tierLine(cat, MAX_TIER).cost}」.`,
  };
}

const READING_ENTRY: Entry = {
  term: "도장과 티어 읽는 법",
  svg: SVG.scale,
  desc:
    "카드는 다섯 범주에 도장을 찍습니다. 도장이 문턱에 닿으면 티어가 하나 오르고, 그 순간에만 종이 실제로 강해집니다. " +
    "문턱 사이의 도장은 다음 계단을 위한 저축이라, 화면의 칩이 「몇 칸 남았는지」를 늘 알려줍니다.",
  rows: TIER_STEPS.map((s, i) => ({
    k: `${TIER_ROMAN[i + 1]} 티어`,
    v: `도장 ${s}개부터`,
    bar: s / (TIER_STEPS[TIER_STEPS.length - 1] as number),
  })),
  note:
    "위로 갈수록 계단이 멀어집니다. " +
    `그리고 티어 합 1마다 유지비 배수가 ${UPKEEP_PER_TIER} 씩 올라, 많이 가진 종은 많이 먹어야 합니다.`,
};

const KEYS_ENTRY: Entry = {
  term: "열쇠 (능력)",
  svg: SVG.wings,
  desc:
    "수영·비행·초음파 같은 능력은 열쇠입니다. 있거나 없거나 둘 중 하나이고, 전설 카드 한 장으로 열립니다. " +
    "세기는 괄호에 적힌 범주의 티어가 그대로 정합니다. 그 범주를 키우면 열쇠도 함께 강해집니다.",
  rows: KEY_NAMES.map((k) => ({ k: `${KEY_LABELS[k]} (${CATEGORY_LABELS[KEY_PARENT[k]]})`, v: KEY_DESC[k] })),
  note: `한 종이 가질 수 있는 열쇠는 ${MAX_KEYS}개까지입니다. 상한에 닿으면 열쇠 카드가 더는 나오지 않습니다.`,
};

const DUOS_ENTRY: Entry = {
  term: "듀오 (합체 형질)",
  svg: SVG.herding,
  desc:
    `두 범주가 함께 ${TIER_ROMAN[DUO_TIER]} 이상이 되면 저절로 켜지는 합체 형질입니다. 카드가 따로 없습니다. ` +
    "두 기둥을 깊게 판 종만 닿는 자리이고, 켜질 수 있는 듀오는 드래프트 화면이 미리 예고합니다.",
  rows: DUOS.map((d) => ({ k: `${d.name} · ${CATEGORY_LABELS[d.a]}+${CATEGORY_LABELS[d.b]}`, v: d.desc })),
};

const SIZE_ENTRY: Entry = {
  term: "몸집",
  svg: SVG.scale,
  desc:
    "몸집은 고르는 축이 아니라 나머지 선택의 결과입니다. 가죽과 이빨을 키우면 커지고, 다리와 무리를 키우면 작아집니다. " +
    "크면 좀처럼 잡아먹히지 않지만 느리고 많이 먹으며, 작으면 그 반대입니다. 화면에서 생물 크기로 바로 보입니다.",
};

const SECTIONS: readonly Section[] = [
  {
    title: "형질 도감",
    intro:
      "이 게임의 성장은 다섯 범주(이빨·다리·눈·가죽·무리)에 도장을 모으는 일입니다.\n" +
      `문턱(도장 ${TIER_STEPS.join(" · ")})에 닿을 때마다 티어가 I 에서 ${TIER_ROMAN[MAX_TIER]} 까지 오르고, 효과는 문턱을 넘는 순간에만 켜집니다.\n` +
      "범주마다 키울수록 얻는 것과 잃는 것이 함께 커집니다. 어느 범주도 항상 정답이 아닙니다.",
    entries: [READING_ENTRY, ...CATEGORIES.map(categoryEntry), KEYS_ENTRY, DUOS_ENTRY, SIZE_ENTRY],
  },
  {
    title: "카드 도감",
    intro:
      // (마크다운 별표를 쓰면 안 된다 · 이 문구는 textContent 로 그려져 별표가 그대로 보인다.)
      "카드는 범주에 도장을 찍거나(대부분) 열쇠 하나를 엽니다(전설). 그 밖의 일은 하지 않습니다.\n" +
      "카드 풀 전부가 어느 종에게나 나옵니다. 다만 내가 이미 판 방향의 카드가 조금 더 자주 뜹니다. 보장이 아니라 확률이라, 가끔 내 길이 하나도 안 뜨는 드래프트도 있습니다.\n" +
      "카드마다 희귀도가 있어, 희귀할수록 후보로 잘 안 뜨고 드래프트에서도 더 늦게 등장합니다. 무리가 세대를 거듭할수록 높은 등급이 더 자주 찾아옵니다.",
    entries: [
      {
        term: "희귀도와 확률",
        svg: SVG.card,
        desc: `카드는 다섯 등급으로 나뉩니다. 등급은 그 카드가 종을 얼마나 바꾸는지로 정합니다. 흔함은 대가 없이 한 가지가 조금 오르고, 전설은 종의 정체성 자체를 바꿉니다. 세대(레벨)가 오를수록 높은 등급의 확률이 올라가며, 세대 ${RARITY_BOOST_FULL_LEVEL}에서 최대가 됩니다.`,
        oddsTable: true,
        note: "확률은 지금 열려 있는 카드만 세어 계산합니다. 판이 진행되는 동안에는 이미 소용없는 카드(예: 벌써 나는데 또 나오는 날개)가 후보에서 빠지므로, 실제 확률은 위 값과 조금 달라집니다.",
      },
      {
        term: "흔함",
        rarity: "common",
        desc: "한 범주에 도장을 안전하게 찍습니다. 기틀을 다질 때 고릅니다.",
      },
      {
        term: "드묾",
        rarity: "uncommon",
        desc: "두 범주에 나눠 찍거나, 주 범주와 부 범주에 함께 찍습니다.",
      },
      {
        term: "귀함",
        rarity: "rare",
        desc: "한 범주에 크게 찍습니다. 문턱을 한 장에 넘기기 좋은, 방향을 정하는 카드입니다.",
      },
      {
        term: "아주 귀함",
        rarity: "epic",
        desc: "가장 크게 찍거나, 다른 범주의 도장을 내놓는 맞바꿈입니다. 판을 한쪽으로 크게 기울입니다.",
      },
      {
        term: "전설",
        rarity: "legendary",
        desc: "열쇠(능력)를 엽니다. 종의 정체성 자체가 바뀝니다. 뜨면 카드가 금빛으로 터집니다.",
        note: "날개·초음파·독·원거리 전설은 플레이어 레벨이 올라야 열립니다. 잠긴 카드는 후보에 아예 안 나옵니다.",
      },
    ],
  },
  {
    title: "세계 도감",
    intro:
      "판마다 세계의 종류가 달라집니다. 세계는 무작위로 정해지고, 그 뒤에 시작 종을 고릅니다.\n" +
      "시작 화면 맨 위에 이번 세계가 뜨니, 그걸 보고 여기서 살아남을 종을 고르세요. " +
      "물이 많은 세계는 헤엄칠 갈래를 연 뒤에야 나옵니다.",
    entries: [
      {
        term: "대륙",
        svg: SVG.mapContinent,
        desc: "땅이 넓고 바다는 호수처럼 흩어져 있습니다. 걷는 종이 살기 좋은 기본 세계입니다.",
        rows: [
          { k: "바다", v: "약 15~20%", base: true },
          { k: "유리", v: "걷는 종 (속도·시야·사냥)" },
          { k: "열림", v: "처음부터" },
        ],
      },
      {
        term: "판게아",
        svg: SVG.mapPangaea,
        desc: "하나로 이어진 넓은 땅을 바다가 둘러쌉니다. 가운데를 가르는 산맥 위에 먹이가 많아, 날개가 그 먹이를 독차지합니다.",
        rows: [
          { k: "바다", v: "약 15%" },
          { k: "산", v: "많음 (산 위 먹이도 많음)" },
          { k: "유리", v: "날개 · 걷는 종" },
          { k: "열림", v: "레벨 3" },
        ],
      },
      {
        term: "군도",
        svg: SVG.mapArchipelago,
        desc: "잘게 쪼개진 섬과 얕은 바다입니다. 헤엄치거나 날지 못하면 한 섬에 갇혀 먹이가 떨어집니다.",
        rows: [
          { k: "바다", v: "약 45~50%" },
          { k: "유리", v: "수영 · 날개" },
          { k: "열림", v: "레벨 4 (바다 개척자와 함께)" },
        ],
      },
      {
        term: "대양",
        svg: SVG.mapOcean,
        desc: "지구처럼 바다가 대부분입니다. 뭍은 좁아 붐비고, 바다가 진짜 삶터입니다. 헤엄치지 못하는 종에게는 가장 혹독합니다.",
        rows: [
          { k: "바다", v: "약 70%" },
          { k: "유리", v: "수영 (그 외에는 몹시 힘듦)" },
          { k: "열림", v: "레벨 6" },
        ],
      },
    ],
  },
  {
    title: "생물 도감",
    intro:
      "내 종과 함께 사는 야생종입니다. 수치는 매 판 조금씩 흔들립니다.\n" +
      "아래 여섯 종은 어느 세계에나 삽니다. 그 밖에 세계마다 그 세계에만 사는 종이 따로 있습니다. " +
      "판게아의 산맥에는 고산 독수리가, 군도와 대양의 바다에는 바다뱀·바다거북·범고래·크릴이 삽니다.",
    entries: [
      {
        term: "내 종",
        svg: creature("#6cc24a"),
        desc: "당신이 기르는 종입니다. 시작 갈래로 출발 도장의 배분과 시작 열쇠를 정하고, 카드로 계속 특화시키세요.",
        rows: [
          { k: "시작", v: "시작 갈래 중 하나" },
          { k: "시작 수", v: "36마리" },
          { k: "특징", v: "프리셋으로 출발, 카드로 무엇이든 될 수 있음" },
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
      // ── 세계마다 사는 종(맵 전용) ──
      {
        term: "고산 독수리 (판게아)",
        svg: creature("#e8d8b0"),
        desc: "판게아의 산맥 위를 도는 큰 새입니다. 산 위 먹이를 먹고 삽니다. 날개를 키운 내 종과 그 먹이를 두고 다툽니다.",
        rows: [
          { k: "사는 곳", v: "판게아의 산맥" },
          { k: "식성", v: "초식 (산 위 먹이)" },
          { k: "눈에 띄는 형질", v: "날개 74, 시야 76" },
        ],
      },
      {
        term: "바다뱀 (군도)",
        svg: creature("#2fbf6a"),
        desc: "섬 사이 얕은 바다의 포식자입니다. 물에서만 살아 뭍에는 못 올라옵니다. 헤엄치는 종에게는 무섭지만, 물 밖으로 나가면 손도 못 댑니다.",
        rows: [
          { k: "사는 곳", v: "군도의 바다" },
          { k: "식성", v: "육식 (헤엄치는 것을 사냥)" },
          { k: "약점", v: "뭍으로 올라가면 안전" },
        ],
      },
      {
        term: "바다거북 무리 (군도·대양)",
        svg: creature("#d8a860"),
        desc: "느리고 오래 사는 바다 초식입니다. 뭍에도 오릅니다. 얕은 바다 먹이를 두고 헤엄치는 내 종과 다툽니다.",
        rows: [
          { k: "사는 곳", v: "군도·대양의 바다" },
          { k: "식성", v: "초식 (얕은 바다 먹이)" },
          { k: "눈에 띄는 형질", v: "느림, 단단함(공격력 48)" },
        ],
      },
      {
        term: "범고래 무리 (대양)",
        svg: creature("#1a2430"),
        desc: "대양의 정점입니다. 물에서만 살아 뭍에는 못 올라옵니다. 주로 크릴을 먹지만, 헤엄치는 무엇이든 노립니다.",
        rows: [
          { k: "사는 곳", v: "대양의 바다" },
          { k: "식성", v: "육식 (헤엄치는 것을 사냥)" },
          { k: "약점", v: "뭍으로 올라가면 안전" },
        ],
      },
      {
        term: "크릴 떼 (대양)",
        svg: creature("#ff9ec8"),
        desc: "대양 먹이사슬의 바닥입니다. 크게 무리 지어 다니며, 범고래를 먹여 살립니다. 크릴이 없으면 범고래가 내 종만 노립니다.",
        rows: [
          { k: "사는 곳", v: "대양의 바다" },
          { k: "식성", v: "초식 (바다 먹이)" },
          { k: "눈에 띄는 형질", v: "큰 무리, 약함" },
        ],
      },
    ],
  },
  {
    title: "도전 과제",
    intro:
      "플레이어 레벨은 시간을 쓰면 오르고, 도전 과제는 해내야 열립니다. 보상은 대부분 꾸밈이라 세지지 않습니다. 딱 하나, 「거인」만 형질이고 그마저 뚜렷한 대가를 치릅니다.",
    entries: [
      {
        term: "과제 목록",
        svg: SVG.trophy,
        desc: "한 판을 마칠 때마다 그 판의 성적으로 판정합니다. 이미 열린 과제는 다시 뜨지 않습니다.",
        achievements: true,
        note: "꾸밈은 몸에 하나만 걸칩니다. 로비에서 고를 수 있습니다. 「전설의 이름」은 이름 목록이라 열리면 늘 적용됩니다.",
      },
    ],
  },
  {
    title: "위협 도감",
    intro:
      "보스와 대멸종은 라운드 시험이 아니라 관문입니다. 끝까지 살아남으면 넘어갑니다.\n" +
      "각자 약점(키우면 유리한 형질)이 있습니다.\n" +
      "보스마다 사냥하는 자리가 다릅니다. 땅 짐승은 땅 위만 노려서, 날개를 키워 하늘로 오르면 손도 못 댑니다. " +
      "대신 하늘에는 하늘의 사냥꾼이 있고, 물에는 상어가 있습니다. 어디로 도망칠 수 있는지가 곧 무기입니다. " +
      "독 안개만은 온 땅을 덮어 하늘로도 물로도 피할 수 없습니다.",
    entries: [
      { term: "질주하는 추격자 (땅)", svg: SVG.chaser, desc: "아주 빠르게 쫓아와 닿으면 잡아먹습니다. 땅 위만 달려서, 날거나 물에 든 개체는 못 건드립니다.", weak: "속도" },
      { term: "사나운 무리 (땅)", svg: SVG.swarm, desc: "떼로 몰려들어 닿는 개체를 물어뜯습니다. 땅 위만 기어옵니다.", weak: "번식력과 많은 수" },
      { term: "약탈자 무리 (땅)", svg: SVG.raider, desc: "뿔 달린 짐승 떼가 달려들어 약한 개체부터 들이받습니다. 땅 위만 달립니다.", weak: "공격력" },
      { term: "외톨이 사냥꾼 (땅)", svg: SVG.isolation, desc: "늑대가 무리에서 떨어진 외톨이를 노려 잡아갑니다. 땅 위만 달립니다.", weak: "무리 성향" },
      { term: "그림자 매복자 (땅)", svg: SVG.stalker, desc: "표범이 수풀에 숨어 있다 덮칩니다. 수풀 안에서는 시야가 안 통해 미리 못 알아챕니다.", weak: "시야 (넓을수록 일찍 보고 피함)" },
      { term: "하늘의 사냥꾼 (하늘)", svg: SVG.raptor, desc: "큰 새가 하늘을 돌다 내리꽂혀 낚아챕니다. 땅에서는 수풀에 숨으면 하늘에서 안 보입니다. 물속만은 못 건드립니다.", weak: "시야 (그리고 땅에서는 수풀 엄폐)" },
      { term: "성난 말벌 떼 (하늘)", svg: SVG.hornet, desc: "말벌 떼가 하늘에서 몰려와 쏘아댑니다. 맞서 싸울 수 없어 빠르게 벗어나야 합니다.", weak: "속도" },
      { term: "굶주린 상어 (물)", svg: SVG.shark, desc: "물속을 도는 상어가 헤엄치는 개체를 삼킵니다. 뭍은 건드리지 못해, 물 밖으로 나가면 안전합니다.", weak: "시야 (일찍 보고 뭍으로 달아남)" },
      { term: "독 안개 (전역)", svg: SVG.poison, desc: "사방의 공기에 독이 퍼져 에너지를 빨아갑니다. 하늘로도 물로도 피할 수 없습니다.", weak: "낮은 대사" },
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
        desc: "시작 종을 고르고, 화면을 탭해 우두머리를 이끕니다. 탭한 곳이 사냥할 수 있는 상대면 쫓아가 물고, 그 밖의 곳이면 그리로 갑니다. 나머지 무리는 스스로 살면서 우두머리를 따라옵니다. 맨 처음 하는 판은 무리를 먹여 키우는 것만 하면 되고, 시대를 넘을 때마다 시험·지형·예전에 기르던 종이 한 가지씩 늘어납니다. 마지막 대멸종까지 살아남으면 승리입니다.",
      },
      {
        term: "라운드 시험과 불씨",
        svg: SVG.trophy,
        desc: "채집 라운드마다 시험이 하나 걸립니다. 사냥 몇 번, 먹이 몇 번, 새끼 몇 마리, 무리 몇 마리처럼 그 라운드 안에 채워야 하는 목표입니다. 목표는 라운드가 시작되기 전 카드 고르는 화면에 미리 나오니, 그걸 보고 카드를 고르세요. 맨 처음 하는 판의 첫 시대에만 시험이 없습니다(그때는 무리를 먹여 키우는 것만 배웁니다).",
        note: "불씨는 이 혈통에 남은 기회입니다. 다섯 개로 시작해 시험에 질 때마다 하나씩 꺼지고, 모두 꺼지면 판이 끝납니다. 시험이 없는 동안에는 불씨도 줄지 않습니다. 보스를 물리치거나 다음 시대로 넘어가면 하나 되살아납니다.",
      },
      {
        term: "카드 고르기",
        svg: SVG.card,
        desc: "카드는 범주에 도장을 찍습니다. 도장이 문턱에 닿아 티어가 오르는 순간에만 종이 강해집니다. 카드에 붙은 칩이 이번 장으로 문턱을 넘는지, 몇 칸 남는지를 미리 알려줍니다. 한 판 동안 누적되고, 새 판에서 리셋됩니다.",
        note: "형질 도감에서 각 범주의 티어가 실제로 무엇을 켜는지 미리 볼 수 있습니다.",
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
        desc: "마지막 대멸종까지 내 종이 살아남으면 승리합니다. 지는 길은 둘입니다. 무리가 한 마리도 남지 않거나, 시험에 거듭 져 불씨가 다 꺼지거나. 한 형질만 극단으로 올리기보다, 다가오는 위협에 맞춰 균형을 잡는 것이 안전합니다.",
      },
    ],
  },
];

// ── 카드 도감 렌더 (열 때마다 지금 해금 상태로 새로 계산한다) ──

const RARITY_ORDER: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** 지금 플레이어 레벨(런 밖 영속). 잠긴 카드는 드래프트 후보에서 빠지므로 확률 계산의 풀도 달라진다. */
function currentMetaLevel(): number {
  return metaLevel(loadMeta().metaXp);
}

/** 이 카드가 열리는 플레이어 레벨. 처음부터 열려 있으면 null. */
function unlockLevelOf(id: string): number | null {
  for (const t of UNLOCK_TIERS) if (t.cardIds.includes(id)) return t.atLevel;
  return null;
}

function pct(v: number): string {
  const p = v * 100;
  if (p >= 10) return `${Math.round(p)}%`;
  if (p >= 1) return `${p.toFixed(1)}%`;
  return `${p.toFixed(2)}%`;
}

/** 카드 한 줄 요약 칩 · cardSummary(단일 진실)를 그대로 보여준다. 예: 「가죽 +3 · 다리 −1」 */
function chipRow(card: Card): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; max-width:100%;";
  const chip = document.createElement("span");
  const color = cardAccent(card);
  chip.textContent = cardSummary(card);
  chip.style.cssText =
    `display:inline-flex; align-items:center; font-family:var(--font-mono); font-size:10.5px;` +
    `border-radius:8px; padding:3px 8px; color:${color}; background:${withAlpha(color, 0.13)};`;
  wrap.appendChild(chip);
  return wrap;
}

/** 대백과가 확률을 보여줄 런 레벨들. 마지막이 보정 최대(그 위는 같다). */
const SHOWN_LEVELS: readonly number[] = [1, 3, 5, RARITY_BOOST_FULL_LEVEL];

/** 지금 열려 있는 카드만. 잠긴 카드는 후보에 안 나오므로 확률 계산에서도 빼야 한다. */
/**
 * 대백과의 확률 표가 보는 풀 — **공통 카드만**(열린 것). 갈래 전용 카드는 시작 종을 고른 뒤에야
 * 후보가 되므로, 여기 섞으면 표시 확률이 실제와 어긋난다(안 뽑히는 카드까지 세는 셈).
 * 갈래 전용 카드는 "갈래 전용 카드" 항목에서 따로 설명한다.
 */
function unlockedPool(): Card[] {
  const lvl = currentMetaLevel();
  return cardPoolFor().filter((c) => cardAvailable(c.id, lvl));
}

/** 다섯 등급의 카드 수와 등장 확률. 확률은 `drawCards` 와 같은 가중치로 계산한 정확값이다. */
function buildOddsTable(): HTMLElement {
  const metaLvl = currentMetaLevel();
  const pool = unlockedPool();
  const box = document.createElement("div");

  const label = document.createElement("div");
  label.textContent = `지금 열린 카드 ${pool.length}장 기준 (플레이어 레벨 ${metaLvl})`;
  label.style.cssText =
    "color:var(--faint); font-family:var(--font-mono); font-size:11px; letter-spacing:0.14em; margin:16px 0 6px;";
  box.appendChild(label);

  // 런 레벨(세대) 선택 — 레벨이 오를수록 높은 등급의 가중치가 커진다.
  let runLevel = 1;
  const tabs = document.createElement("div");
  tabs.style.cssText = "display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap;";
  const tabBtns: HTMLButtonElement[] = [];
  const host = document.createElement("div");

  const paint = (): void => {
    tabBtns.forEach((b, i) => {
      const on = SHOWN_LEVELS[i] === runLevel;
      b.style.background = on ? "rgba(143,209,79,0.16)" : "var(--panelSolid)";
      b.style.borderColor = on ? "rgba(143,209,79,0.5)" : "var(--line)";
      b.style.color = on ? "var(--lime)" : "var(--sub)";
    });
    host.replaceChildren(oddsRows(pool, runLevel));
  };

  for (const lv of SHOWN_LEVELS) {
    const b = document.createElement("button");
    b.textContent = lv === RARITY_BOOST_FULL_LEVEL ? `세대 ${lv} 이상` : `세대 ${lv}`;
    b.style.cssText =
      "border:1px solid var(--line); background:var(--panelSolid); color:var(--sub); border-radius:999px;" +
      "padding:6px 12px; font-family:var(--font-mono); font-size:11.5px; cursor:pointer;";
    b.addEventListener("click", () => {
      runLevel = lv;
      paint();
    });
    tabBtns.push(b);
    tabs.appendChild(b);
  }
  box.append(tabs, host);
  paint();
  return box;
}

/** 한 레벨에서의 등급별 확률 표. */
function oddsRows(pool: readonly Card[], runLevel: number): HTMLElement {
  const odds = rarityOdds(pool, 3, runLevel);
  const table = document.createElement("div");
  table.style.cssText =
    "border:1px solid var(--line); border-radius:var(--r-card); overflow:hidden; background:var(--panelSolid);";
  RARITY_ORDER.forEach((r, idx) => {
    const style = RARITY_STYLE[r];
    const o = odds[r];
    const row = document.createElement("div");
    row.style.cssText = "padding:10px 12px;" + (idx > 0 ? "border-top:1px solid var(--line);" : "");

    const head = document.createElement("div");
    head.style.cssText = "display:flex; justify-content:space-between; gap:10px; align-items:baseline;";
    const left = document.createElement("span");
    left.style.cssText = "display:inline-flex; align-items:center; gap:7px; flex:0 0 auto;";
    const dot = document.createElement("span");
    dot.style.cssText =
      `width:8px; height:8px; border-radius:2px; background:${style.color}; flex:none;` +
      (style.glow ? `box-shadow:0 0 6px ${withAlpha(style.color, 0.9)};` : "");
    const name = document.createElement("span");
    name.textContent = `${style.label} · ${o.count}장`;
    name.style.cssText = `color:${style.color}; font-size:13.5px;`;
    left.append(dot, name);
    const v = document.createElement("span");
    v.textContent = `3장 중 ${pct(o.inDraw)}`;
    v.style.cssText = "color:var(--ink); font-family:var(--font-mono); font-size:13px; text-align:right;";
    head.append(left, v);
    row.appendChild(head);

    const track = document.createElement("div");
    track.style.cssText =
      "margin-top:7px; height:7px; border-radius:4px; background:rgba(255,255,255,0.06); overflow:hidden;";
    const fill = document.createElement("div");
    fill.style.cssText = `height:100%; width:${(o.inDraw * 100).toFixed(1)}%; border-radius:4px; background:${style.color};`;
    track.appendChild(fill);
    row.appendChild(track);

    const sub = document.createElement("div");
    sub.textContent = `카드 한 장이 이 등급일 확률 ${pct(o.perCard)}`;
    sub.style.cssText = "color:var(--faint); font-family:var(--font-mono); font-size:10.5px; margin-top:5px;";
    row.appendChild(sub);

    table.appendChild(row);
  });
  return table;
}

/** 보상 한 줄 — 무엇을 얻는가. 형질 보상은 "형질"이라 못박고, 나머지는 "꾸밈(효과 없음)"이라 적는다. */
function rewardText(a: Achievement): string {
  if (a.reward.kind === "card") return `형질 「거인」. 드래프트에 나타난다`;
  return `꾸밈 · ${COSMETICS[a.reward.cosmetic].name}. ${COSMETICS[a.reward.cosmetic].desc}`;
}

/** 도전 과제 목록 — 달성한 것은 또렷하게, 아직인 것은 흐리게. 조건을 읽고 노릴 수 있어야 한다. */
function buildAchievements(): HTMLElement {
  const have = loadAchievements();
  const box = document.createElement("div");

  const label = document.createElement("div");
  label.textContent = `${have.size} / ${ACHIEVEMENTS.length} 달성`;
  label.style.cssText =
    "color:var(--faint); font-family:var(--font-mono); font-size:11px; letter-spacing:0.14em; margin:16px 0 6px;";
  box.appendChild(label);

  const list = document.createElement("div");
  list.style.cssText =
    "border:1px solid var(--line); border-radius:var(--r-card); overflow:hidden; background:var(--panelSolid);";
  ACHIEVEMENTS.forEach((a, idx) => {
    const done = have.has(a.id);
    const isCard = a.reward.kind === "card";
    const row = document.createElement("div");
    row.style.cssText =
      "padding:11px 12px;" +
      (idx > 0 ? "border-top:1px solid var(--line);" : "") +
      (done ? "background:rgba(143,209,79,0.06);" : "opacity:0.55;");

    const head = document.createElement("div");
    head.style.cssText = "display:flex; align-items:center; gap:8px;";
    const mark = document.createElement("span");
    mark.textContent = done ? "✓" : "·";
    mark.style.cssText =
      `width:18px; height:18px; border-radius:50%; flex:none; display:flex; align-items:center;` +
      `justify-content:center; font-size:11px; font-family:var(--font-mono);` +
      (done
        ? "background:var(--lime); color:#1B2A0A;"
        : "background:rgba(255,255,255,0.08); color:var(--faint);");
    const name = document.createElement("span");
    name.textContent = a.name;
    name.style.cssText = `font-family:var(--font-title); font-size:15px; flex:1; color:${done ? "var(--ink)" : "var(--sub)"};`;
    head.append(mark, name);
    row.appendChild(head);

    const desc = document.createElement("div");
    desc.textContent = a.desc;
    desc.style.cssText = "color:var(--sub); font-size:12.5px; line-height:1.5; margin-top:4px; word-break:keep-all;";
    row.appendChild(desc);

    const reward = document.createElement("div");
    reward.textContent = rewardText(a);
    const rc = isCard ? "#F5C33B" : "#8FD14F";
    reward.style.cssText =
      `margin-top:7px; display:inline-block; font-family:var(--font-mono); font-size:10.5px;` +
      `border-radius:8px; padding:4px 9px; color:${rc}; background:${withAlpha(rc, 0.12)};`;
    row.appendChild(reward);

    list.appendChild(row);
  });
  box.appendChild(list);
  return box;
}

/** 한 등급의 카드 전부. 잠긴 카드는 흐리게 + 열리는 레벨을 적는다(후보에 안 나온다). */
function buildRarityList(rarity: Rarity): HTMLElement {
  const lvl = currentMetaLevel();
  const style = RARITY_STYLE[rarity];
  const cards = CARD_POOL.filter((c) => cardRarity(c) === rarity);
  const pool = unlockedPool();
  const o = rarityOdds(pool, 3, 1)[rarity];
  const top = rarityOdds(pool, 3, RARITY_BOOST_FULL_LEVEL)[rarity];

  const box = document.createElement("div");

  const summary = document.createElement("div");
  summary.textContent =
    o.count === 0
      ? `이 등급은 아직 한 장도 안 열렸습니다 (전체 ${cards.length}장).`
      : `열린 ${o.count}장 · 후보 3장에 뜰 확률 ${pct(o.inDraw)} (세대 1) → ${pct(top.inDraw)} (세대 ${RARITY_BOOST_FULL_LEVEL} 이상)`;
  summary.style.cssText =
    `margin:16px 0 8px; padding:10px 12px; border-radius:var(--r-card); font-family:var(--font-mono); font-size:12.5px;` +
    `color:${style.color}; background:${withAlpha(style.color, 0.1)}; border:1px solid ${withAlpha(style.color, 0.3)};`;
  box.appendChild(summary);

  const list = document.createElement("div");
  list.style.cssText =
    "border:1px solid var(--line); border-radius:var(--r-card); overflow:hidden; background:var(--panelSolid);";
  cards.forEach((card, idx) => {
    const locked = !cardAvailable(card.id, lvl);
    const row = document.createElement("div");
    row.style.cssText =
      "padding:11px 12px;" + (idx > 0 ? "border-top:1px solid var(--line);" : "") + (locked ? "opacity:0.45;" : "");

    const head = document.createElement("div");
    head.style.cssText = "display:flex; align-items:center; gap:8px;";
    const dot = document.createElement("span");
    dot.style.cssText = `width:9px; height:9px; border-radius:2px; flex:none; background:${cardAccent(card)};`;
    const name = document.createElement("span");
    name.textContent = card.name;
    name.style.cssText = "font-family:var(--font-title); font-size:15px; color:var(--ink); flex:1;";
    head.append(dot, name);
    if (locked) {
      const lock = document.createElement("span");
      // 카드를 잠근 문지기가 둘이다 — 플레이어 레벨(meta) 과 도전 과제. 어느 쪽인지 정확히 알려준다.
      const byAchievement = achievementForCard(card.id);
      lock.textContent = byAchievement
        ? `「${byAchievement.name}」 달성 시 열림`
        : `레벨 ${unlockLevelOf(card.id) ?? "?"}에 열림`;
      lock.style.cssText = "font-family:var(--font-mono); font-size:10px; color:var(--faint); flex:none;";
      head.appendChild(lock);
    }
    row.appendChild(head);

    const desc = document.createElement("div");
    desc.textContent = card.desc;
    desc.style.cssText = "color:var(--sub); font-size:12.5px; line-height:1.5; margin-top:4px; word-break:keep-all;";
    row.append(desc, chipRow(card));
    list.appendChild(row);
  });
  box.appendChild(list);
  return box;
}

export function createGlossary(): Glossary {
  ensurePanelStyles(); // :root 토큰 보장
  const scrim = document.createElement("div");
  scrim.style.cssText =
    "position:fixed; inset:0; z-index:40; display:none; box-sizing:border-box; padding:16px;" +
    "background:rgba(11,9,6,0.82); backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px);" +
    "justify-content:center; align-items:center; font-family:var(--font-body);";

  const panel = document.createElement("div");
  // position:relative — 따라다니는 목차 버튼(absolute)이 이 패널을 기준으로 붙는다.
  panel.style.cssText =
    "position:relative; width:min(100%,460px); height:min(88vh,680px); box-sizing:border-box; display:flex; flex-direction:column;" +
    "background:var(--bg-report); border:1px solid var(--line); border-radius:var(--r-panel); color:var(--ink); overflow:hidden;";

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid var(--line);";
  const back = document.createElement("button");
  back.textContent = "‹ 뒤로";
  back.style.cssText =
    "border:1px solid var(--line); background:rgba(255,255,255,0.05); color:var(--sub); border-radius:999px;" +
    "padding:7px 14px; font-family:var(--font-body); font-size:14px; cursor:pointer; visibility:hidden;";
  const title = document.createElement("div");
  title.textContent = "대백과";
  title.style.cssText = "flex:1; font-family:var(--font-title); font-size:19px; color:var(--ink);";
  const close = document.createElement("button");
  close.textContent = "닫기";
  close.style.cssText =
    "border:1px solid var(--line); background:rgba(255,255,255,0.05); color:var(--ink); border-radius:999px;" +
    "padding:7px 15px; font-family:var(--font-body); font-size:14px; cursor:pointer;";
  header.append(back, title, close);

  const body = document.createElement("div");
  body.style.cssText = "flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:6px 14px 16px;";

  // 목록 화면. 섹션 제목 요소를 모아 둔다(목차가 이 위치로 스크롤한다).
  const listView = document.createElement("div");
  const sectionHeads: HTMLElement[] = [];
  for (const sec of SECTIONS) {
    const h = document.createElement("div");
    h.textContent = sec.title;
    h.style.cssText = "color:var(--lime); font-family:var(--font-title); font-size:15px; margin:16px 2px 6px;";
    listView.appendChild(h);
    sectionHeads.push(h);
    if (sec.intro) {
      const intro = document.createElement("div");
      intro.textContent = sec.intro;
      // pre-line: 인트로에 넣은 줄바꿈(\n)이 실제 줄바꿈으로 보인다(textContent 는 기본적으로 공백으로 뭉갠다).
      intro.style.cssText =
        "color:var(--sub); font-size:12.5px; line-height:1.5; margin:0 2px 8px; white-space:pre-line;";
      listView.appendChild(intro);
    }
    const grid = document.createElement("div");
    grid.style.cssText = "display:flex; flex-wrap:wrap; gap:8px;";
    for (const e of sec.entries) {
      const b = document.createElement("button");
      b.textContent = e.term;
      // 등급 항목은 그 등급 색으로 — 목록에서 바로 희귀도 서열이 읽힌다.
      const tint = e.rarity ? RARITY_STYLE[e.rarity] : null;
      b.style.cssText =
        `border:1px solid ${tint ? withAlpha(tint.color, 0.4) : "var(--line)"};` +
        `background:${tint ? withAlpha(tint.color, 0.1) : "var(--panelSolid)"};` +
        `color:${tint ? tint.color : "var(--ink)"}; border-radius:var(--r-card);` +
        "padding:10px 14px; font-family:var(--font-title); font-size:15px; cursor:pointer;";
      b.addEventListener("click", () => showDetail(e));
      grid.appendChild(b);
    }
    listView.appendChild(grid);
  }

  // 상세 화면
  const detailView = document.createElement("div");
  detailView.style.display = "none";

  // --- 따라다니는 목차 (패널 우하단 고정) ---
  // 대백과가 길어져(7개 섹션·수십 항목) 폰에서 원하는 곳까지 한참 굴려야 했다. 목차로 바로 뛴다.
  const tocBtn = document.createElement("button");
  tocBtn.textContent = "≡ 목차";
  tocBtn.style.cssText =
    "position:absolute; right:14px; bottom:14px; z-index:2;" +
    "border:1px solid var(--line); background:var(--panelSolid); color:var(--ink);" +
    "border-radius:999px; padding:9px 15px; font-family:var(--font-title); font-size:14px;" +
    "cursor:pointer; box-shadow:0 3px 12px rgba(0,0,0,0.45);";

  // 목차 메뉴 — 버튼 위로 펼쳐진다(드롭업). 섹션을 누르면 그 자리로 스크롤하고 닫힌다.
  const tocMenu = document.createElement("div");
  tocMenu.style.cssText =
    "position:absolute; right:14px; bottom:56px; z-index:3; display:none; flex-direction:column; gap:2px;" +
    "background:var(--bg-report); border:1px solid var(--line); border-radius:var(--r-card);" +
    "padding:6px; box-shadow:0 6px 20px rgba(0,0,0,0.55); min-width:150px;";
  SECTIONS.forEach((sec, i) => {
    const item = document.createElement("button");
    item.textContent = sec.title;
    item.style.cssText =
      "border:0; background:transparent; color:var(--ink); text-align:left;" +
      "padding:9px 11px; border-radius:8px; font-family:var(--font-body); font-size:14px; cursor:pointer;";
    item.addEventListener("mouseenter", () => (item.style.background = "rgba(255,255,255,0.07)"));
    item.addEventListener("mouseleave", () => (item.style.background = "transparent"));
    item.addEventListener("click", () => {
      const head = sectionHeads[i];
      // 상세를 보던 중이면 목록으로 먼저 돌아온다(목차는 목록의 좌표계를 쓴다).
      if (detailView.style.display !== "none") showList(true);
      if (head) smoothScrollTo(head.offsetTop - 8);
      closeToc();
    });
    tocMenu.appendChild(item);
  });

  /**
   * 목차 점프를 **빠르게 굴러가는 느낌**으로 (사용자 요청: "바로 팍 움직이지 말고").
   * 순간이동하면 어디로 갔는지 감이 안 잡힌다 — 굴러가는 게 보여야 위치 감각이 남는다.
   * 거리에 따라 260~420ms 로 잡고(멀수록 살짝 길게) easeOutCubic 으로 끝에서 부드럽게 선다.
   * 브라우저 기본 `behavior:"smooth"` 를 안 쓰는 이유: 속도를 못 정해 길 땐 답답하게 느리다.
   */
  let scrollRaf = 0;
  function smoothScrollTo(target: number): void {
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    const start = body.scrollTop;
    const max = body.scrollHeight - body.clientHeight;
    const end = Math.max(0, Math.min(max, target));
    const dist = end - start;
    if (Math.abs(dist) < 2) return;
    const dur = Math.min(420, 260 + Math.abs(dist) * 0.08);
    let t0 = 0;
    const step = (now: number): void => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic — 빠르게 출발해 부드럽게 선다
      body.scrollTop = start + dist * eased;
      if (p < 1) scrollRaf = requestAnimationFrame(step);
      else scrollRaf = 0;
    };
    scrollRaf = requestAnimationFrame(step);
  }

  function closeToc(): void {
    tocMenu.style.display = "none";
  }
  tocBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    tocMenu.style.display = tocMenu.style.display === "none" ? "flex" : "none";
  });

  // 읽던 위치 기억 — 항목에 들어갔다 「‹ 뒤로」로 돌아오면 **보던 자리 그대로** 복귀한다.
  // (예전엔 맨 위로 튕겨서, 목록 아래쪽 항목을 하나 볼 때마다 다시 굴려 내려와야 했다.)
  let listScroll = 0;

  function showList(keepScroll = false): void {
    detailView.style.display = "none";
    listView.style.display = "block";
    back.style.visibility = "hidden";
    tocBtn.style.display = "block";
    if (!keepScroll) body.scrollTop = listScroll;
  }
  function showDetail(e: Entry): void {
    detailView.replaceChildren();

    if (e.svg) {
      const img = document.createElement("div");
      img.style.cssText =
        "margin:14px 0; padding:12px; background:var(--panelSolid); border:1px solid var(--line); border-radius:var(--r-card);" +
        "display:flex; justify-content:center; align-items:center; height:140px;";
      img.innerHTML = e.svg;
      detailView.appendChild(img);
    }

    const term = document.createElement("div");
    term.textContent = e.term;
    term.style.cssText = "font-family:var(--font-title); font-size:22px; color:var(--ink); margin:8px 0 6px;";
    detailView.appendChild(term);

    const desc = document.createElement("div");
    desc.textContent = e.desc;
    desc.style.cssText = "color:var(--sub); font-size:15px; line-height:1.65; word-break:keep-all;";
    detailView.appendChild(desc);

    // 카드 도감은 열 때마다 새로 계산한다(플레이어 레벨이 오르면 열린 카드와 확률이 바뀐다).
    if (e.oddsTable) detailView.appendChild(buildOddsTable());
    if (e.rarity) detailView.appendChild(buildRarityList(e.rarity));
    if (e.achievements) detailView.appendChild(buildAchievements());

    if (e.rows) {
      const label = document.createElement("div");
      label.textContent = "인게임 수치";
      label.style.cssText = "color:var(--faint); font-family:var(--font-mono); font-size:11px; letter-spacing:0.14em; margin:16px 0 6px;";
      detailView.appendChild(label);
      const table = document.createElement("div");
      table.style.cssText =
        "border:1px solid var(--line); border-radius:var(--r-card); overflow:hidden; background:var(--panelSolid);";
      e.rows.forEach((r, idx) => {
        const row = document.createElement("div");
        row.style.cssText =
          "padding:9px 12px;" +
          (idx > 0 ? "border-top:1px solid var(--line);" : "") +
          (r.base ? "background:rgba(143,209,79,0.08);" : "");
        const head = document.createElement("div");
        head.style.cssText = "display:flex; justify-content:space-between; gap:10px; align-items:baseline;";
        const k = document.createElement("span");
        k.textContent = r.base ? r.k + " ◀ 시작값" : r.k;
        k.style.cssText = "color:" + (r.base ? "var(--lime)" : "var(--sub)") + "; font-size:13.5px; flex:0 0 auto;";
        const v = document.createElement("span");
        v.textContent = r.v;
        v.style.cssText = "color:var(--ink); font-family:var(--font-mono); font-size:13px; text-align:right; word-break:keep-all;";
        head.append(k, v);
        row.appendChild(head);
        if (r.bar !== undefined) {
          const pct = Math.round(Math.max(0, Math.min(1, r.bar)) * 100);
          const track = document.createElement("div");
          track.style.cssText = "margin-top:7px; height:7px; border-radius:4px; background:rgba(255,255,255,0.06); overflow:hidden;";
          const fill = document.createElement("div");
          fill.style.cssText =
            "height:100%; width:" + pct + "%; border-radius:4px; background:var(--lime); opacity:" + (r.base ? "1" : "0.7") + ";";
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
      label.style.cssText = "color:var(--faint); font-family:var(--font-mono); font-size:11px; letter-spacing:0.14em; margin:16px 0 5px;";
      detailView.appendChild(label);
      const box = document.createElement("div");
      box.textContent = e.weak;
      box.style.cssText =
        "background:rgba(143,209,79,0.08); border:1px solid rgba(143,209,79,0.28); border-radius:var(--r-card); padding:11px 13px;" +
        "color:var(--lime); font-family:var(--font-title); font-size:15px;";
      detailView.appendChild(box);
    }

    if (e.note) {
      const note = document.createElement("div");
      note.textContent = e.note;
      note.style.cssText = "color:var(--faint); font-size:13px; line-height:1.55; margin-top:14px; word-break:keep-all;";
      detailView.appendChild(note);
    }

    // 들어가기 직전의 목록 스크롤을 기억해 둔다(「‹ 뒤로」가 이 자리로 되돌린다).
    listScroll = body.scrollTop;
    listView.style.display = "none";
    detailView.style.display = "block";
    back.style.visibility = "visible";
    tocBtn.style.display = "none"; // 상세에선 목차를 숨긴다(목록의 좌표계라 뜻이 없다)
    closeToc();
    body.scrollTop = 0;
  }

  body.append(listView, detailView);
  panel.append(header, body, tocMenu, tocBtn);
  scrim.appendChild(panel);
  document.body.appendChild(scrim);

  const hide = (): void => {
    closeToc();
    scrim.style.display = "none";
  };
  back.addEventListener("click", () => showList());
  close.addEventListener("click", hide);
  body.addEventListener("click", closeToc); // 본문을 누르면 목차가 닫힌다
  scrim.addEventListener("click", (ev) => {
    if (ev.target === scrim) hide();
  });

  return {
    show: () => {
      listScroll = 0; // 새로 열 땐 맨 위부터
      showList();
      scrim.style.display = "flex";
    },
    hide,
  };
}
