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
  type EffectChip,
} from "@/ui/traitDisplay";
import { ensurePanelStyles } from "@/ui/panelStyles";
import { registerKeyLayer, keyChip } from "@/ui/keys";
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

/** 드래프트 화면이 그리는 데 필요한 종 상태. 패널은 게임 객체를 모르고 이 값만 읽는다. */
export interface DraftContext {
  level: number; // 레벨 = 세대
  genome: Genome; // 카드 적용 전 현재 종 게놈
  speciesColor: number;
  speciesName: string;
  population: number;
  pickedCardNames: readonly string[];
  canReroll: boolean;
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
  skipBtn.appendChild(keyChip("S"));
  const rerollBtn = el("button", "draft-reroll");
  rerollBtn.textContent = "↻ 다시 뽑기";
  rerollBtn.appendChild(keyChip("R"));
  ftRow.append(skipBtn, rerollBtn);
  // 키 안내 줄 — 데스크톱에서만 보인다(모바일은 CSS 가 숨김).
  const keysHint = el("div", "draft-keys-hint");
  keysHint.textContent = "← → 카드 살펴보기 · Enter 퍼뜨리기 · S 건너뛰기 · R 다시 뽑기 · M 내 종";
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
   * 히어로를 남는 세로 공간에 맞춰 줄인다(§8 함정: 고정 크기 히어로는 낮은 창에서 헤더·카드·CTA 를 밀어낸다).
   * transform 이라 레이아웃 높이는 그대로다 — 히어로 칸(1fr) 안에서 가운데 정렬된 채 시각적으로만 줄어든다.
   * 여유가 있으면 조금 키운다(스펙의 데스크톱 확대). 화살표 자리(42px)는 가로 계산에서 빼 둔다.
   */
  const fitHero = (): void => {
    const availH = hero.clientHeight - 14; // 헤더·카드와 맞닿지 않게 위아래 숨 쉴 틈
    const availW = hero.clientWidth - 2 * 50;
    const natH = heroGroup.offsetHeight;
    const natW = heroGroup.offsetWidth;
    if (!availH || !availW || !natH || !natW) return;
    // 위: 여유가 있으면 1.4배까지 키운다. 아래: 세로가 아주 짧은 폰에서도 히어로가 헤더·카드를 안 덮게 0.4까지 줄인다.
    const s = Math.min(availH / natH, availW / natW, 1.4);
    heroScale.style.transform = `scale(${Math.max(0.4, s).toFixed(3)})`;
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
    heroBadge.style.background = withAlpha(accent, 0.9);
    heroBadge.style.color = "#241C10";
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
      const ceiling = TRAIT_CEILING[key];
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
      const fill = el("div", "draft-stat-fill");
      fill.style.width = `${clamp(basePct, 0, 100)}%`;
      fill.style.background = traitColor(key);
      track.appendChild(fill);

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
  };
  const closePopup = (): void => {
    popupOpen = false;
    dim.classList.remove("on");
    popupWrap.classList.remove("on");
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
        case "KeyS":
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
    // 데스크톱: 내 종 정보(오른쪽 인라인 패널)를 기본으로 펼쳐 둔다 — 가리는 게 없는 여백 자리라,
    // 지금 스탯과 보고 있는 카드의 변화를 항상 나란히 두고 고를 수 있다. 모바일은 바텀 시트(가림)라 닫아 둔다.
    if (isDesktopLayout()) openPopup();
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
