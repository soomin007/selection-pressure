// 드래프트 UI — 레벨업 시 형질 카드 3장 중 하나를 고르는 전체 화면. 핸드오프 스펙 v1.0 구현.
//
// 배경: 월드는 멈춰 있고(game.update 가 draft phase 에서 world.step 을 건너뛴다) 캔버스는 계속 그려진다.
// 그 위에 뿌연 유리 3겹(블러 캔버스 + 김 서림 + 하단 가독성 그라데이션)을 얹는다. 마지막 프레임을 비트맵으로
// 캡처하지 않는다 — 캔버스에 CSS 필터만 건다(리사이즈·선명도 유지). 살아 움직이는 건 히어로 미리보기다.
//
// 히어로 자리가 곧 미리보기다: 지금 보고 있는 카드를 실제로 내 종 게놈에 적용한 사본으로 생물을 그려,
// "이 형질을 얻으면 내 애들이 이렇게 생긴다"를 고르기 전에 보여준다.

import type { Renderer } from "pixi.js";
import {
  applyCard,
  cardDelta,
  cardRarity,
  effectiveDelta,
  CARD_POOL,
  PRESET_CARDS,
  type Card,
  type Rarity,
} from "@/game/cards";
import {
  cloneGenome,
  isApexTrait,
  traitCeiling,
  APEX_TRAITS,
  TRAIT_CEILING,
  TRAIT_LABELS,
  type Genome,
  type Traits,
} from "@/sim/genome";
import { makeCreatureTexture } from "@/render/worldView";
import {
  APEX_BOON,
  cardEffectChips,
  chipColor,
  dominantTrait,
  traitColor,
  traitWord,
  abilityLevel,
  ABILITY_KEYS,
  NEUTRAL_TRAITS,
  type ChipTone,
  type EffectChip,
} from "@/ui/traitDisplay";
import { ensurePanelStyles } from "@/ui/panelStyles";
import { registerKeyLayer, keyChip } from "@/ui/keys";
import { SIM } from "@/sim/params";
import { DEBUG } from "@/debug";
import {
  DRAFT_TIMING,
  RARITY_STYLE,
  rarityDelayMs,
  rarityIndex,
  restingShadow,
  selectionRing,
  withAlpha,
} from "@/ui/rarity";

/** 내 종 팝업의 스탯 6종 — 핸드오프 §9 순서(속도·시야·공격·번식·무리·대사). */
const STAT_KEYS: readonly (keyof Traits)[] = [
  "speed",
  "vision",
  "attack",
  "fertility",
  "herding",
  "metabolism",
];

const CONFETTI_COLORS: readonly string[] = [
  "#F5C33B",
  "#8FD14F",
  "#5AB0E2",
  "#B98CE0",
  "#E85C43",
  "#F2903A",
];

/** 확정(퍼뜨리기·건너뛰기) 후 토스트를 읽을 시간. 이 동안 월드는 여전히 멈춰 있다. */
const COMMIT_DELAY_MS = 850;

/**
 * 보스에 맞설 수 있게 되는 형질 문턱. 공격력과 원거리는 **어떤 보스에게나 통하는 수단**이라
 * (sim/boss.ts 의 raidMeleePower·raidRangedPower) 어느 보스가 나오든 이 두 문턱만 넘으면 맞선다.
 * ⚠ 숫자를 여기 적지 않고 sim 상수를 그대로 읽는다 · 옮겨 적는 순간 언젠가 화면과 실제가 갈린다.
 * ⚠ "얼마나 세게 깎느냐"(충족도)는 여기서 계산하지 않는다. 그 식은 sim 안에만 있고 밖에서 다시
 *   유도하면 그게 곧 새 거짓말이 된다 · 화면에는 넘었나/못 넘었나만 말한다.
 */
const MELEE_GATE = SIM.raidWarriorAttack;
const RANGED_GATE = SIM.rangedThreshold;

function canFaceBoss(attack: number, ranged: number): boolean {
  return attack >= MELEE_GATE || ranged >= RANGED_GATE;
}

/**
 * 헤더 한 줄 · 다음 관문에 맞설 수 있는 종인가. 카드를 고르기 전에 지금 상태를 먼저 말한다.
 * ⚠ 두 문턱은 지금 같은 값이지만 sim 이 **따로 잡는 상수**다. 한 숫자로 뭉뚱그려 적으면 둘이
 *   갈리는 날 화면이 조용히 거짓말한다 → 같을 때만 한 번 적고, 다르면 각각 적는다.
 */
function gatePhrase(): string {
  return MELEE_GATE === RANGED_GATE
    ? `공격력이나 원거리가 ${MELEE_GATE} 이상이면`
    : `공격력이 ${MELEE_GATE} 이상이거나 원거리가 ${RANGED_GATE} 이상이면`;
}

function raidHeadline(boss: string, t: Traits): string {
  const a = t.attack;
  const r = t.ranged;
  if (a >= MELEE_GATE) return `다음 관문 「${boss}」 · 지금 공격력 ${a} · 맞설 수 있습니다`;
  if (r >= RANGED_GATE) return `다음 관문 「${boss}」 · 지금 원거리 ${r} · 멀리서 맞설 수 있습니다`;
  // ⚠ "이것만이 길"이라고 말하지 않는다 · 보스마다 제 약점(속도·시야·무리·번식)이 따로 있고
  //   화면은 그게 무엇인지 모른다. 공격력·원거리는 **어떤 보스에도 통하는** 길이라 그것만 단언한다.
  return `다음 관문 「${boss}」 · 지금 공격력 ${a} · ${gatePhrase()} 어떤 보스든 맞설 수 있습니다`;
}

/**
 * 카드 한 장이 "맞설 수 있는가"를 **켜는가**. 켜지 않는 카드에는 아무것도 안 붙인다.
 * 이미 맞설 수 있는 종에게 "더 세진다"고는 말하지 않는다 · 그 양을 화면이 뒷받침할 수 없다.
 * 얼마나 오르는지는 옆의 효과 칩(「공격력 +7」)이, 문턱과 지금 값은 헤더 줄이 이미 말한다.
 *
 * ⚠ **"못 맞섬" 칩은 달지 않는다 · 그건 거짓일 수 있다.** 여기서 아는 것은 공격력·원거리
 *   문턱뿐인데, 격퇴 보스 5종 중 4종은 카운터가 속도·시야·무리·번식이다. 공격력을 깎고 무리를
 *   올리는 카드(「밀물 같은 무리」 등)는 이 함수 눈에는 "못 맞섬"이지만 실제로는 외톨이 사냥꾼에
 *   맞설 능력을 켜 준다. 반대로 문턱을 넘기는 쪽은 만능 카운터라 **언제나 참**이므로 그것만 말한다.
 *   보스별 약점까지 정확히 말하려면 sim 에 판정기(보스 종류 + 게놈 → 맞섬 여부)를 두고 그것을
 *   불러야 한다 · 규칙을 UI 에서 옮겨 적으면 그 순간 두 곳으로 갈라진다.
 *
 * ⚠ 카드 아래 각주(.draft-note)로 달지 않는다. 실측: 360x780 에서 석 장 모두에 각주가 붙으면
 *   카드가 한 줄씩 자라 히어로 배지와 카드 이름이 겹쳤다(칩으로 넣으면 셋 다 붙어도 여유 20px 유지).
 */
function raidCardChip(card: Card, t: Traits): { label: string; tone: ChipTone; up: boolean } | null {
  const a = t.attack;
  const r = t.ranged;
  const da = cardDelta(card, "attack", a);
  const dr = cardDelta(card, "ranged", r);
  if (da === 0 && dr === 0) return null;
  if (!canFaceBoss(a, r) && canFaceBoss(a + da, r + dr)) {
    return { label: "보스에 맞섬", tone: "gain", up: true };
  }
  return null;
}

/**
 * "건너뛰기" 단축키. 평소엔 S 지만 **조종 모드에선 S 가 아래로 가는 키**라, 손을 WASD 에 올린 채
 * 드래프트가 뜨면 카드를 보기도 전에 건너뛰어진다(실기 피드백 2026-08-01). 그 모드에서만 X 로 옮긴다.
 * 화면의 키 칩·안내 줄도 이 값을 쓰므로 표시와 실제가 어긋날 수 없다.
 */
const SKIP_LABEL = DEBUG.leadControl ? "X" : "S";

/** 드래프트 화면이 그리는 데 필요한 종 상태. 패널은 게임 객체를 모르고 이 값만 읽는다. */
export interface DraftContext {
  level: number; // 레벨 = 세대
  genome: Genome; // 카드 적용 전 현재 종 게놈
  speciesColor: number;
  speciesName: string;
  population: number;
  pickedCardNames: readonly string[];
  canReroll: boolean;
  forecast: string; // 예고 줄("이번 시험: ..."). 빈 문자열이면 숨김
  notice: string; // 안내 줄(진행 중인 위협 · 시대 보상 설명). 빈 문자열이면 숨김
  /** 직전 라운드 판정. 있으면 제목 자리를 대신 차지한다(기본 제목은 아무 정보가 없는 문구라
   *  판정으로 바꾸는 편이 낫다). null 이면 기본 제목. */
  verdict: { text: string; passed: boolean } | null;
  /** 다음 관문이 **때려서 물리칠 수 있는 보스**면 그 이름. 아니면 null(때릴 대상이 없는 전역 시련
   *  이거나 관문이 보스가 아니다). 있을 때만 맞섬 안내가 붙는다 · 없는 격퇴를 예고하면 거짓말이다. */
  raidBoss: string | null;
}

export interface DraftPanelCallbacks {
  onPick: (index: number) => void;
  onSkip: () => void;
  onReroll: () => void;
}

export interface DraftPanel {
  show: (cards: Card[], ctx: DraftContext) => void;
  hide: () => void;
}

export function createDraftPanel(
  renderer: Renderer,
  gameCanvas: HTMLCanvasElement,
  cb: DraftPanelCallbacks,
): DraftPanel {
  ensurePanelStyles();

  const root = el("div", "draft-root");
  root.append(el("div", "draft-veil"), el("div", "draft-grad"));

  const shell = el("div", "draft-shell");
  root.appendChild(shell);

  // ── 헤더 (연출 없이 즉시 표시) ──
  const hd = el("div", "draft-hd");
  const levelText = el("div", "draft-level");
  const title = el("div", "draft-title");
  title.textContent = "새 형질이 무리에 퍼져요";
  const mineBtn = el("button", "draft-mine");
  const mineThumb = el("span", "draft-mine-thumb");
  const mineLabel = el("span", "draft-mine-label");
  mineLabel.textContent = "내 종";
  mineBtn.append(mineThumb, mineLabel, keyChip("M"));
  mineBtn.title = "내 종 정보 열기/닫기 (M)";
  hd.append(levelText, title, mineBtn);
  // 예고 줄: 진행 중 라운드의 시험(레벨업) 또는 곧 시작할 단계의 시험 예상(시대 보상).
  // .draft-hd 는 가운데 정렬 블록이라 그냥 아래 줄로 붙고, 헤더가 한 줄 늘면 fitHero 가 히어로를 줄인다.
  const forecastEl = el("div", "draft-forecast");
  hd.appendChild(forecastEl);
  // 맞섬 줄: 다음 관문이 보스면 "지금 이 종이 맞설 수 있는가"를 카드를 고르기 전에 먼저 말한다.
  // 형질을 키울 이유가 지금까지 4초짜리 전광판과 대백과에만 있었다(CLAUDE.md 전달 규칙 미달).
  const raidEl = el("div", "draft-forecast");
  hd.appendChild(raidEl);
  // 안내 줄: 지금 도는 위협("다가오는 위협. …")이나 시대 보상 설명. 카드를 고르는 동안 화면이 통째로
  // 덮이므로, 무엇과 싸우는 중인지·왜 이 카드가 센지를 여기서 알려 준다.
  const noticeEl = el("div", "draft-notice");
  hd.appendChild(noticeEl);
  shell.appendChild(hd);

  // ── 히어로 미리보기 (맨 마지막 등장 — 스포일러 방지) ──
  const hero = el("div", "draft-hero");
  const prevBtn = el("button", "draft-arrow prev");
  prevBtn.textContent = "‹";
  prevBtn.title = "이전 카드 (←)";
  const nextBtn = el("button", "draft-arrow next");
  nextBtn.textContent = "›";
  nextBtn.title = "다음 카드 (→)";
  // 배율 래퍼와 등장 연출 래퍼를 나눈다 — 한 엘리먼트에 transform 배율과 transform 키프레임을 함께 두면
  // 키프레임이 배율을 통째로 덮어쓴다(§8 함정 2와 같은 종류).
  const heroScale = el("div", "draft-hero-scale");
  const heroGroup = el("div", "draft-hero-group");
  heroScale.appendChild(heroGroup);
  const zone = el("div", "draft-medallion-zone");
  const aura = el("div", "draft-aura");
  const flourish = el("div", "draft-flourish");
  const medallion = el("div", "draft-medallion");
  const sprite = el("div", "draft-sprite");
  const tint = el("div", "draft-tint");
  medallion.append(sprite, tint);
  zone.append(aura, flourish, medallion);
  const heroBadge = el("div", "draft-hero-badge");
  const dots = el("div", "draft-dots");
  heroGroup.append(zone, heroBadge, dots);
  hero.append(prevBtn, nextBtn, heroScale);
  shell.appendChild(hero);

  // ── 카드 ──
  const cardList = el("div", "draft-cards");
  shell.appendChild(cardList);

  // ── CTA + 푸터 (연출 없이 즉시 표시되는 건너뛰기·다시 뽑기, CTA 만 히어로와 함께 등장) ──
  const ft = el("div", "draft-ft");
  const cta = el("button", "draft-cta");
  // CTA 글자는 라벨 span 에만 쓴다 — cta.textContent 로 갈아 끼우면 키 칩(Enter)까지 지워진다.
  const ctaLabel = el("span");
  cta.append(ctaLabel, keyChip("Enter"));
  const ftRow = el("div", "draft-ft-row");
  const skipBtn = el("button", "draft-skip");
  skipBtn.textContent = "건너뛰고 새끼 치기";
  // 조종 모드에선 S 가 "아래로 가기"다. 손이 WASD 에 올라가 있는 채로 드래프트가 뜨면 S 한 번에
  // 카드를 보지도 못하고 건너뛰어진다(실기 피드백 2026-08-01) → 그 모드에서만 건너뛰기를 X 로 옮긴다.
  skipBtn.appendChild(keyChip(SKIP_LABEL));
  const rerollBtn = el("button", "draft-reroll");
  rerollBtn.textContent = "↻ 다시 뽑기";
  rerollBtn.appendChild(keyChip("R"));
  ftRow.append(skipBtn, rerollBtn);
  // 키 안내 줄 — 데스크톱에서만 보인다(모바일은 CSS 가 숨김).
  const keysHint = el("div", "draft-keys-hint");
  keysHint.textContent = `← → 카드 살펴보기 · Enter 퍼뜨리기 · ${SKIP_LABEL} 건너뛰기 · R 다시 뽑기 · M 내 종`;
  ft.append(cta, ftRow, keysHint);
  shell.appendChild(ft);

  // ── 토스트 (래퍼가 중앙정렬, 안쪽 알약만 애니메이션 — §8 함정: transform 충돌) ──
  const toastWrap = el("div", "draft-toast");
  const toastPill = el("div");
  toastWrap.appendChild(toastPill);

  // ── 내 종 팝업 ──
  const dim = el("div", "draft-dim");
  const popupWrap = el("div", "draft-popup-wrap");
  const popup = el("div", "draft-popup");
  popupWrap.appendChild(popup);

  document.body.append(root, toastWrap, dim, popupWrap);

  // ── 상태 ──
  let cards: Card[] = [];
  let ctx: DraftContext | null = null;
  let preview = 0;
  let busy = false; // 확정 연출 중 — 중복 입력 차단
  let popupOpen = false;
  // 데스크톱 레이아웃(카드 3열·좌우 여백)일 때만 클릭=선택 / 팝업 인라인. CSS 의 @media 기준과 맞춘다.
  const isDesktopLayout = (): boolean => window.matchMedia("(min-width: 860px)").matches;
  // 확대 배율(--ui-zoom, 데스크톱 UI 확대)을 뺀 "논리 폭" — zoom 아래에선 px 규칙이 배율만큼 커져,
  // 실제로 쓸 수 있는 가로 공간은 창 폭을 배율로 나눈 값이다.
  const logicalViewportW = (): number => {
    const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-zoom"));
    return window.innerWidth / (Number.isFinite(z) && z > 0 ? z : 1);
  };
  let commitTimer = 0;
  let toastTimer = 0;
  const spriteUrls: (string | null)[] = [];
  const cardEls: HTMLElement[] = [];

  /** 카드가 적용된 게놈으로 그린 생물 그림(데이터 URL). 카드마다 한 번만 만들고 캐시한다. */
  const spriteFor = (i: number): string => {
    const cached = spriteUrls[i];
    if (cached) return cached;
    const card = cards[i];
    const c = ctx;
    if (!card || !c) return "";
    const g = cloneGenome(c.genome);
    applyCard(g, card); // 사본에만 적용 — 실제 종 게놈은 카드를 고를 때 game 이 바꾼다
    const tex = makeCreatureTexture(renderer, g, c.speciesColor);
    const canvas = renderer.extract.canvas(tex) as HTMLCanvasElement;
    const url = canvas.toDataURL();
    tex.destroy(true); // 픽셀은 canvas 로 복사됐다 — 드래프트마다 3장씩 쌓이는 걸 막는다
    spriteUrls[i] = url;
    return url;
  };

  /**
   * 배율·애니메이션을 끈 상태에서 히어로 그림이 **실제로** 차지하는 크기(장식 포함).
   *
   * ⚠ `heroGroup.offsetHeight` 를 쓰면 안 된다. 오라(`.draft-aura`, 196x196)는 position:absolute 라
   *   레이아웃 높이에 안 잡히는데 담긴 칸(`.draft-medallion-zone`)은 164px 뿐이라, 위아래로 16px 씩
   *   더 나간다. 새끼 메달리온·속도 대시도 마찬가지다. 그래서 자손 전부의 rect 를 합집합한다.
   *   앞으로 장식이 늘어도 자동으로 포함된다.
   * 재는 동안 배율과 애니메이션을 잠깐 끈다(오라 숨쉬기 scale 1.14, 둥둥 뜨기 translateY). 안 끄면
   * 애니메이션 위상에 따라 잴 때마다 값이 달라져 배율이 흔들린다. 그 위상 초과분은 칸의
   * overflow:hidden 이 받아낸다(오라 바깥 테두리는 완전 투명이라 잘려도 안 보인다).
   */
  const heroNaturalSize = (): { w: number; h: number } => {
    const prev = heroScale.style.transform;
    heroScale.style.transform = "none";
    hero.classList.add("measuring");
    let l = Infinity;
    let t = Infinity;
    let r = -Infinity;
    let b = -Infinity;
    const grow = (node: Element): void => {
      const q = node.getBoundingClientRect();
      if (q.width <= 0 || q.height <= 0) return;
      if (q.left < l) l = q.left;
      if (q.top < t) t = q.top;
      if (q.right > r) r = q.right;
      if (q.bottom > b) b = q.bottom;
    };
    grow(heroGroup);
    for (const node of heroGroup.querySelectorAll("*")) grow(node);
    hero.classList.remove("measuring");
    heroScale.style.transform = prev;
    return r > l && b > t ? { w: r - l, h: b - t } : { w: 0, h: 0 };
  };

  /**
   * 히어로를 남는 세로 공간에 맞춰 줄인다(§8 함정: 고정 크기 히어로는 낮은 창에서 헤더·카드·CTA 를 밀어낸다).
   * transform 이라 레이아웃 높이는 그대로다 — 히어로 칸(1fr) 안에서 가운데 정렬된 채 시각적으로만 줄어든다.
   * 여유가 있으면 조금 키운다(스펙의 데스크톱 확대). 화살표 자리(42px)는 가로 계산에서 빼 둔다.
   *
   * ⚠ 2026-08-05 사고: 예전엔 `Math.max(0.4, s)` 로 **하한 0.4 를 무조건** 걸었다. 하한은 "칸에
   *   들어가는지"와 무관하니, 헤더 문구가 길어 히어로 칸이 0 으로 접힌 화면(390x640 등)에서도 100px
   *   짜리 생물이 그려져 **헤더 글씨 위에 그대로 얹혔다**(사용자 지적). transform 은 레이아웃을 안
   *   밀어내니 아무도 못 막았고, 겹침 검사기는 글씨끼리만 재서 통과시켰다.
   *   → 하한을 없애고 **칸에 들어가는 배율만** 쓴다. 히어로가 너무 작아지는 반대 사고는 배율이 아니라
   *     자리로 막는다(panelStyles 의 max-height 720px 규칙이 카드·푸터 여백을 조여 자리를 벌어 준다).
   */
  const fitHero = (): void => {
    const availH = hero.clientHeight - 14; // 헤더·카드와 맞닿지 않게 위아래 숨 쉴 틈
    const availW = hero.clientWidth - 2 * 50;
    const nat = heroNaturalSize();
    if (!nat.w || !nat.h) return;
    // 위: 여유가 있으면 1.4배까지 키운다. 아래: 0 아래로는 안 간다(음수면 뒤집힌다).
    const s = Math.min(availH / nat.h, availW / nat.w, 1.4);
    heroScale.style.transform = `scale(${Math.max(0, s).toFixed(3)})`;
  };

  window.addEventListener("resize", () => {
    if (root.classList.contains("open")) fitHero();
  });

  const showToast = (msg: string): void => {
    window.clearTimeout(toastTimer);
    toastPill.textContent = msg;
    toastWrap.classList.remove("on");
    void toastWrap.offsetWidth; // 리플로우로 pop-bounce 재시작
    toastWrap.classList.add("on");
    toastTimer = window.setTimeout(() => toastWrap.classList.remove("on"), 1700);
  };

  /** 확정 — 토스트를 읽을 동안 월드는 멈춘 채로 두고, 그 뒤에 game 으로 넘긴다. */
  const commit = (msg: string, done: () => void): void => {
    if (busy) return;
    busy = true;
    showToast(msg);
    commitTimer = window.setTimeout(() => {
      busy = false;
      done();
    }, COMMIT_DELAY_MS);
  };

  const setPreview = (i: number): void => {
    if (!cards.length) return;
    preview = ((i % cards.length) + cards.length) % cards.length;
    const card = cards[preview] as Card;
    const accent = traitColor(dominantTrait(card));

    // 히어로 — DOM 은 그대로 두고 색·그림만 갈아 끼운다(등장 연출을 다시 재생하지 않도록).
    sprite.style.backgroundImage = `url("${spriteFor(preview)}")`;
    aura.style.background = `radial-gradient(circle, ${withAlpha(accent, 0.31)}, transparent 66%)`;
    medallion.style.border = `2px solid ${withAlpha(accent, 0.55)}`;
    medallion.style.boxShadow = `0 12px 24px -8px rgba(0,0,0,.55), 0 0 18px ${withAlpha(accent, 0.3)}`;
    tint.style.background = `radial-gradient(circle at 50% 42%, ${withAlpha(accent, 0.22)}, transparent 72%)`;
    heroBadge.textContent = `이 형질을 얻으면 · ${card.name}`;
    // 등급 색을 배경에 깔고 어두운 글씨를 얹었더니, 중간 밝기 등급(드묾의 파랑)에서 대비가 모자라
    // 글씨가 뭉개졌다. 이 프로젝트의 톤(어두운 바탕에 밝은 글씨)대로 뒤집는다: 바탕은 늘 어둡게,
    // 등급 색은 글씨와 테두리가 받는다. 그러면 등급이 여전히 보이면서 대비는 등급과 무관하게 확보된다.
    heroBadge.style.background = "rgba(16,12,8,0.86)";
    heroBadge.style.color = accent;
    heroBadge.style.border = `1px solid ${withAlpha(accent, 0.55)}`;
    flourish.replaceChildren(...heroFlourish(card, accent, spriteFor(preview)));

    dots.replaceChildren();
    cards.forEach((_, k) => {
      const dot = el("span");
      if (k === preview) dot.style.background = accent;
      dots.appendChild(dot);
    });

    cardEls.forEach((node, k) => {
      const r = cardRarity(cards[k] as Card);
      node.style.boxShadow = k === preview ? selectionRing(r) : restingShadow(r);
    });

    ctaLabel.textContent = `${card.name} 퍼뜨리기`;
    fitHero(); // 카드 이름 길이에 따라 배지 폭이 달라진다
    if (popupOpen) renderPopup();
  };

  /** 내 종 팝업 — 지금 보고 있는 카드의 변화를 스탯 막대 위에 겹쳐 보여준다(§9 미리보기 델타). */
  const renderPopup = (): void => {
    const c = ctx;
    const card = cards[preview];
    if (!c || !card) return;
    popup.replaceChildren();

    const head = el("div", "draft-popup-head");
    const idBox = el("div", "draft-popup-id");
    const thumb = el("span", "draft-popup-thumb");
    thumb.style.backgroundImage = `url("${spriteFor(preview)}")`;
    const names = el("div");
    const nm = el("div", "draft-popup-name");
    nm.textContent = "지금 내 종";
    const sub = el("div", "draft-popup-sub");
    sub.textContent = `${c.speciesName} · ${c.population}마리 · ${c.level}세대`;
    names.append(nm, sub);
    idBox.append(thumb, names);
    const closeBtn = el("button", "draft-popup-close");
    closeBtn.textContent = "닫기";
    closeBtn.addEventListener("click", closePopup);
    head.append(idBox, closeBtn);
    popup.appendChild(head);

    const rows = el("div", "draft-stats");
    for (const key of STAT_KEYS) {
      const value = c.genome.traits[key];
      const ceiling = traitCeiling(key); // 이 시대의 천장 — 시대가 오르면 막대의 눈금 자체가 넓어진다
      // `cardDelta` 는 applyCard 가 쓰는 바로 그 함수다 — 성장 스케일·상한 근접 감쇠·정점 고정·희생이
      // 전부 반영된 **실제로 붙을 값**이 나온다. 다른 식으로 계산하면 표시와 적용이 언젠가 갈라진다.
      const delta = cardDelta(card, key, value);
      const basePct = (value / ceiling) * 100;
      const deltaPct = (Math.abs(delta) / ceiling) * 100;
      const apex = isApexTrait(key, value);

      // 대사는 좋고 나쁨이 없다 — 늘어도 줄어도 중립색. 방향(막대가 늘어남/줄어듦)만 보여준다.
      const neutral = NEUTRAL_TRAITS.has(key);

      const row = el("div", "draft-stat");
      if (apex) row.classList.add("apex"); // 막대가 금빛으로 — 여긴 도착점이다
      const label = el("span", "draft-stat-label");
      label.textContent = TRAIT_LABELS[key];
      const track = el("div", "draft-stat-track");
      // 눈금 한 칸 = 형질 10. 형질 1칸의 차이는 시드 노이즈에 묻히고 화면에서 읽히는 최소 단위가
      // 약 10 이라는 실측(2026-08-05)에 맞춘 눈금이다 — "+11" 이 곧 "한 칸"으로 보인다.
      // 시대 천장이 오르면 칸이 촘촘해져 "막대가 길어졌다"가 눈금으로 읽힌다.
      track.style.backgroundSize = `${(10 / ceiling) * 100}% 100%`;
      const fill = el("div", "draft-stat-fill");
      fill.style.width = `${clamp(basePct, 0, 100)}%`;
      fill.style.background = traitColor(key);
      track.appendChild(fill);

      // **정점선**(형질 100 자리) + **정점을 넘어선 구간**. 천장이 100 위로 열린 시대에만 그린다
      // (첫 시대는 선이 막대 끝과 겹쳐 아무 정보도 없다 → 예전 화면 그대로 둔다).
      const apexPct = (TRAIT_CEILING[key] / ceiling) * 100;
      if (APEX_TRAITS.has(key) && ceiling > TRAIT_CEILING[key]) {
        const mark = el("div", "draft-stat-apexline");
        mark.style.left = `${clamp(apexPct, 0, 100)}%`;
        track.appendChild(mark);
        if (basePct > apexPct) {
          const over = el("div", "draft-stat-over");
          over.style.left = `${apexPct}%`;
          over.style.width = `${clamp(basePct - apexPct, 0, 100 - apexPct)}%`;
          track.appendChild(over);
        }
      }

      if (delta > 0) {
        const ghost = el("div", "draft-stat-gain");
        ghost.style.left = `${clamp(basePct, 0, 100)}%`;
        ghost.style.width = `${clamp(deltaPct, 0, 100 - basePct)}%`;
        if (neutral) {
          ghost.style.background = withAlpha(chipColor("neutral"), 0.3);
          ghost.style.borderColor = withAlpha(chipColor("neutral"), 0.7);
        }
        track.appendChild(ghost);
      } else if (delta < 0) {
        const ghost = el("div", "draft-stat-loss");
        ghost.style.left = `${clamp(basePct - deltaPct, 0, 100)}%`;
        ghost.style.width = `${clamp(deltaPct, 0, basePct)}%`;
        if (neutral) ghost.style.background = withAlpha(chipColor("neutral"), 0.55);
        track.appendChild(ghost);
      }

      const val = el("span", "draft-stat-val");
      val.textContent = traitWord(key, value); // 날값 대신 단계 단어(델타 +N 은 아래에서 따로 보여준다)
      if (apex) {
        const tag = el("span", "draft-apex-tag");
        tag.textContent = "정점";
        val.appendChild(tag);
      }
      if (delta !== 0) {
        const d = el("b");
        if (ABILITY_KEYS.has(key)) {
          // 능력형(무리 성향)은 값이 단계(없음/보통/강함)라 카드 칩과 똑같이 "강화/약화"로 말한다.
          // 숫자 델타·취소선을 붙이면 "강함 +12→+8"처럼 낱말과 수치가 뒤섞여 읽힌다(사용자 지적).
          d.textContent = delta > 0 ? "강화" : "약화";
        } else {
          // 값형질 — 감쇠가 깎았으면 원래 값을 취소선으로 함께(칩과 같은 규칙 — 두 화면이 같은 말을 해야 한다).
          const plain = effectiveDelta(key, card.effects[key] ?? 0);
          if (delta > 0 && plain > delta) {
            const was = el("s", "draft-was");
            was.textContent = `+${plain}`;
            val.append(" ", was);
          }
          d.textContent = delta > 0 ? `+${delta}` : String(delta);
        }
        d.style.color = neutral ? chipColor("neutral") : delta > 0 ? "#8FD14F" : "#E85C43";
        val.append(" ", d);
      }
      row.append(label, track, val);
      rows.appendChild(row);
    }

    // 능력형·식성 — 지닌 것(또는 이 카드가 건드리는 것)만 보여준다. 날개·수영 같은 중요한 스탯이 아예 안
    // 뜨던 구멍을 메운다(사용자 지적). 값이 문턱 위에선 무의미해 막대 대신 단어/범주로, 변화는 강화·약화·방향.
    const ABIL_DIET: readonly (keyof Traits)[] = ["diet", "camouflage", "swimming", "wings", "echo", "venom", "ranged"];
    for (const key of ABIL_DIET) {
      const value = c.genome.traits[key];
      const eff = card.effects[key] ?? 0;
      const affected = eff !== 0;
      const has = key === "diet" ? true : abilityLevel(key, value) > 0;
      if (!has && !affected) continue;
      const row = el("div", "draft-stat");
      const label = el("span", "draft-stat-label");
      label.textContent = TRAIT_LABELS[key];
      const track = el("div", "draft-stat-track"); // 빈 트랙 — 막대 행과 값 열을 정렬만 맞춘다
      track.style.background = "transparent";
      const val = el("span", "draft-stat-val");
      const word = traitWord(key, value);
      val.textContent = word;
      // 식성은 흰색이라 잘 안 보였다(사용자) → 초식=초록·잡식=amber·육식=빨강으로 강조(굵게).
      if (key === "diet") {
        val.style.color = word === "육식" ? "#E85C43" : word === "초식" ? "#8FD14F" : "#F5C33B";
        val.style.fontWeight = "700";
      }
      if (affected) {
        const d = el("b");
        if (key === "diet") {
          // "더 육식"만으론 얼만지 모른다(사용자) → 실제 바뀌는 값(0~100 척도)을 함께 보여준다.
          const dd = cardDelta(card, "diet", value);
          d.textContent = `${eff > 0 ? "더 육식" : "더 초식"} ${dd > 0 ? "+" : ""}${dd}`;
        } else {
          d.textContent = eff > 0 ? "강화" : "약화";
        }
        d.style.color = NEUTRAL_TRAITS.has(key) ? chipColor("neutral") : eff > 0 ? "#8FD14F" : "#E85C43";
        val.append(" ", d);
      }
      row.append(label, track, val);
      rows.appendChild(row);
    }
    popup.appendChild(rows);

    // **정점이 무엇을 열었는가** — 100 을 찍은 형질마다 그 보상을 한 줄로 적는다. 정점은 수치가 더
    // 커지는 게 아니라 **그 형질의 약점이 사라지는** 것이라, 말해 주지 않으면 화면에서 영영 안 읽힌다
    // (도감에만 있으면 미달 — CLAUDE.md 전달 규칙).
    const apexKeys = (Object.keys(c.genome.traits) as (keyof Traits)[]).filter(
      (k) => isApexTrait(k, c.genome.traits[k]) && APEX_BOON[k] !== undefined,
    );
    if (apexKeys.length > 0) {
      const box = el("div", "draft-apex-boons");
      for (const key of apexKeys) {
        const line = el("div");
        const strong = el("b");
        strong.textContent = `${TRAIT_LABELS[key]} 정점. `;
        const rest = el("span");
        rest.textContent = APEX_BOON[key] ?? "";
        line.append(strong, rest);
        box.appendChild(line);
      }
      popup.appendChild(box);
    }

    const legend = el("div", "draft-legend");
    const swatch = el("span", "draft-legend-swatch");
    const legendText = el("span");
    legendText.textContent = `보고 있던 카드(${card.name})를 고르면 이렇게 변해요.`;
    legend.append(swatch, legendText);
    popup.appendChild(legend);

    popup.appendChild(el("div", "draft-divider"));

    const pickedTitle = el("div", "draft-picked-title");
    pickedTitle.textContent = "이번 혈통이 고른 형질";
    popup.appendChild(pickedTitle);
    const chips = el("div", "draft-picked");
    if (c.pickedCardNames.length === 0) {
      const none = el("div", "draft-picked-none");
      none.textContent = "아직 없어요. 이번이 첫 형질이에요.";
      chips.appendChild(none);
    }
    for (const name of c.pickedCardNames) {
      const chip = el("span", "draft-picked-chip");
      const dot = el("i");
      dot.style.background = colorForCardName(name);
      const text = el("span");
      text.textContent = name;
      chip.append(dot, text);
      chips.appendChild(chip);
    }
    popup.appendChild(chips);
  };

  const openPopup = (): void => {
    popupOpen = true;
    renderPopup();
    dim.classList.add("on");
    popupWrap.classList.add("on");
    root.classList.add("popup-open"); // 데스크톱: 카드 영역을 왼쪽으로 밀어 팝업 자리(오른쪽)를 비운다
  };
  const closePopup = (): void => {
    popupOpen = false;
    dim.classList.remove("on");
    popupWrap.classList.remove("on");
    root.classList.remove("popup-open");
  };

  // 클릭과 키보드가 같은 길을 지나도록 행동을 함수로 뽑아 둔다.
  const pickCard = (i: number): void => {
    const card = cards[i];
    if (!card) return;
    commit(`${card.name} · 무리 전체에 퍼졌어요`, () => cb.onPick(i));
  };
  const skipDraft = (): void => {
    commit("형질 대신 새끼를 몇 마리 쳤어요", () => cb.onSkip());
  };
  const reroll = (): void => {
    if (busy || ctx?.canReroll !== true) return;
    showToast("카드를 다시 뽑아요");
    cb.onReroll(); // game.reroll → onDraft → show() 로 카드가 새로 그려진다
  };
  const togglePopup = (): void => {
    if (popupOpen) closePopup();
    else openPopup();
  };

  mineBtn.addEventListener("click", togglePopup);
  dim.addEventListener("click", closePopup);
  prevBtn.addEventListener("click", () => setPreview(preview - 1));
  nextBtn.addEventListener("click", () => setPreview(preview + 1));
  cta.addEventListener("click", () => pickCard(preview));
  skipBtn.addEventListener("click", skipDraft);
  rerollBtn.addEventListener("click", reroll);

  // 키보드 조작 — 우선순위 15 = .draft-root 의 z-index. 드래프트가 떠 있는 동안 이 레이어가 키를 받는다.
  registerKeyLayer(
    15,
    () => root.classList.contains("open"),
    (e) => {
      if (busy) return true; // 확정 연출 중 — 버튼과 마찬가지로 키 입력도 잠근다
      switch (e.code) {
        case "ArrowLeft":
          setPreview(preview - 1);
          return true;
        case "ArrowRight":
          setPreview(preview + 1);
          return true;
        case "Digit1":
        case "Digit2":
        case "Digit3":
        case "Numpad1":
        case "Numpad2":
        case "Numpad3": {
          const i = Number(e.code.slice(-1)) - 1;
          if (i < cards.length) setPreview(i);
          return true;
        }
        // Enter 만 확정 — Space 는 관전 중 "멈춤" 습관이 있어, 드래프트가 막 뜬 순간 눌러서
        // 카드를 잘못 확정하는 사고를 부른다.
        case "Enter":
        case "NumpadEnter":
          if (!e.repeat) pickCard(preview);
          return true;
        case "KeyW":
        case "KeyA":
        case "KeyD":
          // 조종 모드에서 손이 WASD 에 올라가 있다 — 드래프트 중엔 아무 일도 안 일어나게 삼킨다
          // (아래 관전 레이어로 새면 카드를 고르는 동안 앞장선 개체가 한쪽으로 달린다).
          return DEBUG.leadControl;
        case "KeyX":
          // 조종 모드에서만 X 가 건너뛰기다(평소엔 아무 의미 없는 키라 아래로 흘려보낸다).
          if (!DEBUG.leadControl) return false;
          if (!e.repeat) skipDraft();
          return true;
        case "KeyS":
          // 조종 모드면 건너뛰기가 X 로 옮겨졌다. 여기 S 는 조향 키라 삼키기만 하고 아무 일도 안 한다.
          if (DEBUG.leadControl) return true;
          if (!e.repeat) skipDraft();
          return true;
        case "KeyR":
          if (!e.repeat) reroll();
          return true;
        case "KeyM":
          if (!e.repeat) togglePopup();
          return true;
        case "Escape":
          if (!popupOpen) return false;
          closePopup();
          return true;
        default:
          return false;
      }
    },
  );

  const show = (nextCards: Card[], nextCtx: DraftContext): void => {
    window.clearTimeout(commitTimer);
    busy = false;
    closePopup();
    cards = nextCards;
    ctx = nextCtx;
    spriteUrls.length = 0;
    cardEls.length = 0;

    levelText.textContent = `레벨 ${nextCtx.level} 달성`;
    // 제목 자리: 직전 판정이 있으면 그것을 싣는다. 판정 플래시는 이 카드창에 가려 안 보이므로,
    // 여기서 말하지 않으면 불씨가 왜 하나 줄었는지 알 길이 없다.
    const v = nextCtx.verdict;
    title.textContent = v ? v.text : "새 형질이 무리에 퍼져요";
    title.style.color = v ? (v.passed ? "var(--lime)" : "var(--amber)") : "";
    forecastEl.textContent = nextCtx.forecast;
    forecastEl.style.display = nextCtx.forecast ? "" : "none";
    const raidLine = nextCtx.raidBoss ? raidHeadline(nextCtx.raidBoss, nextCtx.genome.traits) : "";
    raidEl.textContent = raidLine;
    raidEl.style.display = raidLine ? "" : "none";
    noticeEl.textContent = nextCtx.notice;
    noticeEl.style.display = nextCtx.notice ? "" : "none";
    mineThumb.style.backgroundImage = `url("${currentSpriteUrl(renderer, nextCtx)}")`;
    rerollBtn.style.display = nextCtx.canReroll ? "inline-flex" : "none";

    const bounce = DRAFT_TIMING.bounceMs;
    const delays = cards.map((card) => rarityDelayMs(cardRarity(card)));
    const endDelay = Math.max(...delays, 0) + bounce;

    // 카드 — 희귀도 낮은 순으로 뜬다. 전설은 금빛 플래시 + 콘페티.
    cardList.replaceChildren();
    cards.forEach((card, i) => {
      const rarity = cardRarity(card);
      const style = RARITY_STYLE[rarity];
      const delay = delays[i] ?? 0;

      const wrap = el("div", "draft-card-wrap");
      const node = el("button", "draft-card");
      node.style.borderTopColor = style.color;
      if (style.glow) node.style.borderColor = withAlpha(style.color, 0.45);

      const row = el("div", "draft-card-row");
      const dot = el("span", "draft-dot");
      dot.style.background = traitColor(dominantTrait(card));
      const name = el("span", "draft-card-name");
      name.textContent = card.name;
      row.append(dot, name);
      // 내 갈래 **전용** 카드임을 알린다 — 이 카드는 이 종으로 시작했기에만 볼 수 있다.
      // 공통 카드와 섞여 있으면 "왜 이 카드가 매번 뜨지?"가 안 읽힌다(3장 중 1장은 늘 전용 카드다).
      if (card.lineage !== undefined) {
        const own = el("span", "draft-lineage-badge");
        own.textContent = "내 갈래";
        row.appendChild(own);
      }
      row.appendChild(rarityBadge(rarity));

      const body = el("div", "draft-card-body");
      const desc = el("span", "draft-card-desc");
      desc.textContent = card.desc;
      const chips = el("span", "draft-chips");
      const effChips = cardEffectChips(card, ctx?.genome.traits);
      for (const c of effChips) chips.appendChild(effectChipEl(c));
      // 다음 관문이 보스면, 이 카드가 "맞설 수 있는가"를 뒤집을 때만 칩 하나를 더 단다.
      const raidChip = nextCtx.raidBoss ? raidCardChip(card, nextCtx.genome.traits) : null;
      if (raidChip) chips.appendChild(plainChipEl(raidChip.label, raidChip.tone, raidChip.up));
      body.append(desc, chips);
      // 왜 수치가 이런지를 **그 자리에서** 한 줄로 답한다(대백과로 미루지 않는다 — CLAUDE.md 전달 규칙).
      // 취소선이 떴으면 "왜 덜 오르는지", 정점 고정이 걸렸으면 "왜 안 내려가는지".
      if (effChips.some((c) => c.base !== undefined)) {
        const note = el("span", "draft-note");
        note.textContent = "형질이 100 에 가까울수록 덜 올라요. 취소선은 원래 오를 값이에요.";
        body.appendChild(note);
      }
      if (effChips.some((c) => c.apexLocked === true)) {
        const note = el("span", "draft-note apex");
        note.textContent = "정점(100)에 오른 형질은 카드로도 다시 내려가지 않아요.";
        body.appendChild(note);
      }

      node.append(row, body);
      node.style.boxShadow = restingShadow(rarity);
      node.style.animation = cardAnimation(rarity, delay, bounce);
      // 데스크톱: 클릭이 곧 선택(마우스는 클릭으로 고른다). 모바일: 클릭은 미리보기, 확정은 CTA.
      node.addEventListener("click", () => {
        if (isDesktopLayout()) pickCard(i);
        else setPreview(i);
      });
      // 호버로 preview 를 바꾸지 않는다 — 마우스가 가운데 카드에 얹혀 있으면 키보드로 다른 카드를 골라도
      // Enter(=pickCard(preview))가 가운데를 선택하던 버그(사용자 지적). 마우스는 클릭, 키보드는 화살표+Enter.
      // 카드 모서리의 번호 키 표식(1·2·3) — 데스크톱에서만 보인다.
      if (i < 3) {
        const num = keyChip(String(i + 1));
        num.classList.add("draft-kbd-corner");
        node.appendChild(num);
      }

      wrap.appendChild(node);
      if (style.glow) spawnConfetti(wrap, delay + Math.round(bounce * 0.45));
      cardList.appendChild(wrap);
      cardEls.push(node);
    });

    // 히어로·CTA 는 카드가 전부 뜬 뒤에(스포일러 방지).
    const late = `pop-soft ${Math.round(bounce * 1.2)}ms ease-out ${endDelay}ms both`;
    heroGroup.style.animation = late;
    cta.style.animation = late;

    // 가장 귀한 카드를 처음 보여준다 — 히어로가 뜨는 순간 이번 판의 가장 큰 선택지가 보인다.
    let best = 0;
    cards.forEach((card, i) => {
      if (rarityIndex(cardRarity(card)) > rarityIndex(cardRarity(cards[best] as Card))) best = i;
    });
    setPreview(best);

    root.classList.add("open");
    gameCanvas.classList.add("game-view-frosted");
    document.body.classList.add("draft-open");
    // display:none 상태에선 크기를 못 재므로 보이게 한 다음 맞춘다.
    fitHero();
    // 데스크톱: 내 종 정보(오른쪽 인라인 패널)를 기본으로 펼쳐 둔다 — 지금 스탯과 보고 있는 카드의
    // 변화를 나란히 두고 고를 수 있다(popup-open 이 카드 영역을 왼쪽으로 밀어 자리를 비운다).
    // 단 확대 배율을 뺀 논리 폭이 좁으면(작은 창) 카드가 너무 쪼그라들어 자동으로는 안 열고
    // M/내 종 버튼으로만 연다. 모바일은 바텀 시트(가림)라 닫아 둔다.
    if (isDesktopLayout() && logicalViewportW() >= 1280) openPopup();
  };

  const hide = (): void => {
    window.clearTimeout(commitTimer);
    window.clearTimeout(toastTimer);
    busy = false;
    closePopup();
    toastWrap.classList.remove("on");
    root.classList.remove("open");
    gameCanvas.classList.remove("game-view-frosted");
    document.body.classList.remove("draft-open");
  };

  return { show, hide };
}

// ────────────────────────────── 조각들 ──────────────────────────────

/** 현재(카드 적용 전) 종 그림 — 헤더의 "내 종" 버튼 썸네일. */
function currentSpriteUrl(renderer: Renderer, ctx: DraftContext): string {
  const tex = makeCreatureTexture(renderer, ctx.genome, ctx.speciesColor);
  const canvas = renderer.extract.canvas(tex) as HTMLCanvasElement;
  const url = canvas.toDataURL();
  tex.destroy(true);
  return url;
}

function cardAnimation(rarity: Rarity, delay: number, bounce: number): string {
  const bez = "cubic-bezier(.34,1.3,.64,1)";
  const pop = `pop-bounce ${bounce}ms ${bez} ${delay}ms both`;
  if (!RARITY_STYLE[rarity].glow) return pop;
  // §8 함정: rare-flash 는 backwards 로. both/forwards 면 마지막 키프레임의 box-shadow 가
  // 인라인 선택 링을 영구히 덮어써 링이 안 보인다.
  return `${pop}, rare-flash 1100ms ease ${delay + Math.round(bounce * 0.55)}ms backwards`;
}

function rarityBadge(rarity: Rarity): HTMLElement {
  const style = RARITY_STYLE[rarity];
  const badge = el("span", "draft-badge");
  badge.style.color = style.color;
  badge.style.background = style.badgeBg;
  const dot = el("i");
  dot.style.background = style.color;
  if (style.glow) dot.style.boxShadow = `0 0 5px ${withAlpha(style.color, 0.9)}`;
  const text = el("span");
  text.textContent = style.label;
  badge.append(dot, text);
  return badge;
}

/** 수치 없는 칩 하나(형질 효과가 아니라 "이 카드가 무엇을 뒤집는가"). 색·모양은 효과 칩과 같은 규칙. */
function plainChipEl(label: string, tone: ChipTone, up: boolean): HTMLElement {
  const node = el("span", "draft-chip");
  const color = chipColor(tone);
  node.style.color = color;
  node.style.background = withAlpha(color, 0.13);
  const arrow = el("i");
  arrow.textContent = up ? "▲" : "▼";
  const text = el("span");
  text.textContent = label;
  node.append(arrow, text);
  return node;
}

function effectChipEl(chip: EffectChip): HTMLElement {
  const node = el("span", "draft-chip");
  // 색은 성격(얻음/잃음/중립)이 정하고, 화살표는 방향만 알린다. 대사·식성은 중립색 — 어느 쪽이 이득인지는
  // 이번 판 환경이 정하지 카드가 정하지 않는다.
  const color = chipColor(chip.tone);
  node.style.color = color;
  node.style.background = withAlpha(color, 0.13);
  const arrow = el("i");
  arrow.textContent = chip.up ? "▲" : "▼";
  const label = el("span");
  label.textContent = chip.label;
  node.append(arrow, label);
  // 상한 근접 감쇠 — 원래 오를 값(+14)을 취소선으로, 실제 값(+6)을 그 뒤에. 두 수를 나란히 보여야
  // "카드가 약해진 게 아니라 내 형질이 이미 높아서"가 읽힌다(수치 하나만 보면 카드 탓으로 읽힌다).
  // ⚠ 반드시 **이름 뒤·수치 앞**이다. 칩 전체 문자열 앞에 붙이면 "▲ +14 속도 +6" 이 된다.
  if (chip.base !== undefined) {
    const was = el("s", "draft-was");
    was.textContent = chip.base;
    node.appendChild(was);
  }
  const value = el("span");
  value.textContent = chip.value;
  node.appendChild(value);
  return node;
}

/**
 * 형질별 히어로 연출 — 무리·번식이 늘면 새끼 메달리온이 주위를 떠다니고, 속도가 늘면 속도 대시가 흐른다.
 * 카드마다 손으로 짜지 않고 효과에서 뽑아내, 새 카드가 들어와도 알아서 붙는다.
 */
function heroFlourish(card: Card, accent: string, spriteUrl: string): HTMLElement[] {
  const e = card.effects;
  const herding = e.herding ?? 0;
  const fertility = e.fertility ?? 0;
  const speed = e.speed ?? 0;

  const pup = (css: string, delay: number, flip: boolean): HTMLElement => {
    const node = el("div", "draft-pup");
    node.style.cssText += css;
    node.style.animation = `float-soft ${(4.2 + delay * 0.4).toFixed(1)}s ease-in-out ${delay}s infinite`;
    node.style.border = `1.5px solid ${withAlpha(accent, 0.45)}`;
    const inner = el("i");
    inner.style.backgroundImage = `url("${spriteUrl}")`;
    if (flip) inner.style.transform = "scaleX(-1)";
    node.appendChild(inner);
    return node;
  };

  if (herding > 0) {
    return [
      pup("left:0; top:10px; width:46px; height:41px; border-radius:14px;", 0.5, false),
      pup("right:2px; top:2px; width:41px; height:37px; border-radius:13px;", 1, true),
      pup("right:8px; bottom:6px; width:36px; height:32px; border-radius:12px;", 1.4, true),
    ];
  }
  if (fertility > 0) {
    return [
      pup("left:2px; top:16px; width:46px; height:41px; border-radius:14px;", 0.6, false),
      pup("right:4px; top:8px; width:38px; height:34px; border-radius:12px;", 1.1, true),
    ];
  }
  if (speed > 0) {
    return [30, 20, 13].map((w, i) => {
      const dash = el("div", "draft-dash");
      dash.style.cssText += `left:${[2, 10, 6][i] ?? 2}px; top:${56 + i * 20}px; width:${w}px;`;
      dash.style.background = accent;
      dash.style.opacity = String(0.6 - i * 0.1);
      dash.style.animationDelay = `${i * 0.3}s`;
      return dash;
    });
  }
  return [];
}

function spawnConfetti(host: HTMLElement, burstDelayMs: number): void {
  for (let i = 0; i < DRAFT_TIMING.confettiCount; i++) {
    const round = Math.random() < 0.3;
    // 전방향 발사 — i 번째 각도에 지터를 얹어 고르게 퍼지되 규칙적으로 보이지 않게.
    const angle = (i / DRAFT_TIMING.confettiCount) * Math.PI * 2 + Math.random() * 0.7;
    const dist = 55 + Math.random() * 75;
    const dx = Math.round(Math.cos(angle) * dist);
    const dy = Math.round(Math.sin(angle) * dist);
    const rot = (Math.random() < 0.5 ? -1 : 1) * (160 + Math.round(Math.random() * 220));

    const bit = el("span", "draft-confetti");
    bit.style.left = `${Math.round(35 + Math.random() * 30)}%`;
    bit.style.top = `${Math.round(30 + Math.random() * 40)}%`;
    bit.style.width = `${round ? 6 : 5 + Math.round(Math.random() * 2)}px`;
    bit.style.height = `${round ? 6 : 7 + Math.round(Math.random() * 3)}px`;
    bit.style.borderRadius = round ? "50%" : "2px";
    bit.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? "#F5C33B";
    bit.style.setProperty("--dx", `${dx}px`);
    bit.style.setProperty("--dy", `${dy}px`);
    bit.style.setProperty("--dx1", `${Math.round(dx * 0.35)}px`);
    bit.style.setProperty("--dy1", `${Math.round(dy * 0.35)}px`);
    bit.style.setProperty("--rot", `${rot}deg`);
    bit.style.setProperty("--r1", `${Math.round(rot * 0.3)}deg`);
    const dur = 850 + Math.round(Math.random() * 400);
    const start = burstDelayMs + Math.round(Math.random() * 180);
    bit.style.animation = `confetti-burst ${dur}ms cubic-bezier(.17,.67,.4,1) ${start}ms both`;
    host.appendChild(bit);
  }
}

const ALL_CARDS: readonly Card[] = [...CARD_POOL, ...PRESET_CARDS];

/** 고른 형질 칩의 점 색 — 프리셋은 종 시작색, 일반 카드는 대표 형질 색. */
function colorForCardName(name: string): string {
  const card = ALL_CARDS.find((c) => c.name === name);
  if (!card) return "#8C7C68"; // "건너뜀" 등 카드가 아닌 항목
  if (card.color !== undefined) return `#${card.color.toString(16).padStart(6, "0")}`;
  return traitColor(dominantTrait(card));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}
