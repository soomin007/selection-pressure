// 티어 구입 화면 · 모은 **방울**로 범주의 다음 단을 사는 자리.
//
// 이 화면이 지켜야 하는 것 (전부 이 저장소의 기존 규칙이다):
//  ① **가격을 여기서 만들지 않는다.** 값은 `game.tierCost(cat)` 하나만 읽고, 그건 `tiers.ts` 의
//     `pipsToNext` 를 그대로 돌려준다. 화면에 「3개」라 적었으면 정확히 3개가 들어간다.
//  ② **무엇이 좋아지는지 문구를 지어내지 않는다.** `tierLine(cat, 다음단)` 이 파생표를 직접 읽어
//     만든 문장을 그대로 건다. 표를 튜닝하면 이 화면도 저절로 따라 바뀐다(거짓말이 원리적으로 불가).
//  ③ **못 사는 이유가 그 자리에서 읽혀야 한다.** 회색으로 죽이는 데서 끝내지 않고 「2개 모자랍니다」
//     처럼 남은 수를 적는다. 왜 안 눌리는지 모르는 버튼은 고장 난 버튼과 구별이 안 된다.
//  ④ **어느 단의 값인지를 줄마다 못 박는다.** 줄 머리의 로마 숫자는 「지금 단」인데 그 아래 수치는
//     「사면 되는 단」이라, 표시를 안 하면 같은 문구가 단마다 뜻이 조용히 바뀐다(가죽 I단에서
//     「버티는 힘 ×1.43」은 지금 값이 아니라 II단 값이다). 그래서 대상 단을 문장 앞에 적는다 ·
//     카드 각주(`draftPanel`)·승급 연출(`main.playTierUps`)·대백과가 이미 쓰는 표기와 같다.
//  ⑤ **몸집은 상수표가 아니라 실값 전후로 적는다.** 몸집은 20~100 으로 잘리는 파생값이라
//     「+8」 같은 증분을 적으면 상한에 걸린 종에게 거짓말이 된다 · `derivedSize` 를 두 번 불러
//     「몸집 94 ▸ 100」처럼 적으면 잘림이 저절로 반영된다(카드 미리보기와 같은 표기).
//  ⑥ **무엇이 열리는지 말한다 — 이것이 티어를 올릴 첫 번째 이유다** (**[사용자 2026-08-10]**:
//     "티어를 올리면 더 좋은 카드, 더 특별한 카드들이 열려서 그걸 위해 티어를 올리는 거고, 그에
//     따라오는 티어 자체의 보상은 카드에 비해서는 소소한 정도였는데, 지금은 좀 뒤바뀐 느낌이잖아."
//     · "방울로 올리는 티어가 카드를 해금해준다는 알림도 없고"). 화면은 두 단계다:
//       ① 줄마다 **이름만** 몇 개 — 「II단에서 열립니다: 굳은 턱 · 쫓는 이빨 …」
//       ② 그 줄을 **한 번 더 누르면** 각 카드의 효과 한 줄과 등급이 펼쳐진다.
//     ⚠ 조건을 여기서 다시 적지 않는다 · 드래프트 후보 필터가 부르는 그 함수(`cardGateOpen` ·
//       `cardPrereqMet`)를 그대로 부른다. 두 곳에 적으면 「열린다고 적어 놓고 안 뜨는」 카드가 생긴다.
//
// ⚠ 폰 함정 하나를 피해 만들었다: 세로로 자라는 전체 화면 오버레이에서 가운데 정렬을
//    `justify-content`/`align-items` 로 잡으면, 내용이 화면보다 길어질 때 **시작 모서리를 안 지켜**
//    위가 잘린다. 게다가 `flex-direction` 이 가로인 컨테이너에 `justify-content:flex-start` 를 걸면
//    세로가 아니라 **가로**가 잡혀 패널이 왼쪽으로 치우친다(`presetPanel.ts:77` 이 지금 그 상태다).
//    → 여기서는 정렬을 전부 **패널의 `margin:auto`** 에 맡긴다. flex 의 auto 마진은 자리가 남을 때만
//      가운데로 밀고, 넘치면 0 이 되어 아무것도 안 자른다.

import {
  CATEGORIES,
  CATEGORY_DESC,
  CATEGORY_LABELS,
  KEY_DESC,
  KEY_NAMES,
  MAX_TIER,
  SIZE_MEANING,
  TIER_ROMAN,
  derivedSize,
  pipsForTier,
  tierLine,
  tierOf,
} from "@/sim/tiers";
import type { Category, Pips } from "@/sim/tiers";
import type { Genome } from "@/sim/genome";
import { PERK_BY_NAME, perkLine } from "@/sim/perks";
import { GENE_AWARD, GENE_REASON_LABELS } from "@/sim/gene";
import type { GeneReason } from "@/sim/gene";
import { TRIAL_EXCEED_EXCLUDED, type TrialKind } from "@/game/game";
import { CARD_POOL, cardGateOpen, cardPrereqMet, cardRarity, type Card } from "@/game/cards";
import { GAME } from "@/game/config";
import { COLORS, hexColor } from "@/config";
import { categoryColor, pipPct, tierTrackBackground } from "@/ui/traitDisplay";
import { ensurePanelStyles } from "@/ui/panelStyles";
import { RARITY_STYLE, rarityIndex } from "@/ui/rarity";
import { keyChip, registerKeyLayer } from "@/ui/keys";

/**
 * **방울 색 · DOM 쪽(HUD 카운터 · 가격 칩 · 잔액 숫자)이 쓰는 형태.**
 *
 * 값은 이 파일이 정하지 않는다 · `config.ts` 의 `COLORS.gene` 하나가 정하고, 필드에 그려지는 방울
 * (`render/geneDrops.ts`)도 **같은 값**을 쓴다. 색이 갈라지면 「저 반짝이는 것을 밟았더니 이 숫자가
 * 올랐다」가 안 이어진다 · 그게 이 화면과 필드를 잇는 유일한 끈이다.
 *
 * (처음 만들 땐 청록 `#6FE3C4` 이었는데, 필드의 방울은 금빛이고 **청록은 이미 먹이 색**이라
 *  금빛으로 맞췄다. HUD 의 경험치 막대는 `--lime` 이라 금빛과 안 부딪힌다.)
 */
export const GENE_COLOR = hexColor(COLORS.gene);

/** 방울 색 + 투명도 · 테두리·배경처럼 옅게 깔 자리에 쓴다(색을 두 번 적지 않으려는 것). */
function geneAlpha(a: number): string {
  const v = COLORS.gene;
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
}

/** 방울 색을 어둡게 · 구슬 표식의 아래쪽 음영(둥글게 보이려면 밝은 쪽과 어두운 쪽이 있어야 한다). */
function geneShade(k: number): string {
  const v = COLORS.gene;
  const ch = (s: number): number => Math.round(((v >> s) & 255) * k);
  return hexColor((ch(16) << 16) | (ch(8) << 8) | ch(0));
}

/**
 * **방울 구슬 표식 하나.** 목표 줄의 카운터와 이 화면의 잔액이 같은 것을 쓴다 · 색이나 모양이
 * 갈라지면 「HUD 의 저 숫자」와 「이 화면의 저 숫자」가 같은 것이라는 게 안 이어진다.
 *
 * 글자(이모지)가 아니라 CSS 로 그린 원이다: 폰트에 없는 글리프로 깨질 일이 없고, 겹침 검사기도
 * 글씨가 아닌 장식으로 본다. 자기 스타일 주입까지 이 함수가 맡으므로 부르는 쪽은 아무 준비가 필요 없다.
 */
export function createGeneOrb(big = false): HTMLElement {
  ensureGeneStyles();
  const orb = document.createElement("i");
  orb.className = big ? "gene-orb big" : "gene-orb";
  orb.setAttribute("aria-hidden", "true");
  return orb;
}

/**
 * 이 화면이 게임에게 요구하는 전부. `Game` 이 이미 이 모양이라 `createGenePanel(game)` 로 끝난다
 * (구조적 타이핑) · UI 가 게임 클래스 전체를 아는 것보다 계약이 좁을수록 안전하다.
 */
export interface GeneShop {
  /** 아직 안 쓴 방울. */
  readonly geneBank: number;
  /**
   * 지금 게놈 통째로 · 티어·막대·몸집·해금 예고를 전부 여기서 읽는다. **읽기만 한다**(이 화면은
   * 게놈을 절대 안 건드린다 · 「사면 어떻게 되는가」는 늘 도장 사본 위에서 계산한다).
   *
   * 도장 말고 **열쇠와 특성까지** 필요한 이유 둘:
   *  · **몸집** — 도장과 열쇠가 함께 정하고 20~100 으로 잘리는 파생값이라(`tiers.derivedSize`),
   *    열쇠를 모르면 「사면 몸집이 얼마가 되는가」를 정확히 못 적는다.
   *  · **해금 예고** — 「이 단을 사면 열리는 카드」는 드래프트 후보 필터(`cardPrereqMet`)를 그대로
   *    부르는데, 그 판정이 이미 가진 특성과 열쇠 상한을 본다. 안 넘기면 이미 가진 카드를
   *    「열립니다」라고 적는 화면이 된다.
   * `Game.genome` 이 이미 이 모양이라 부르는 쪽은 그대로 통과한다(구조적 타이핑).
   */
  readonly genome: Genome;
  /** 이 범주의 다음 단까지 드는 방울 수(이미 최고 단이면 0). */
  tierCost(cat: Category): number;
  /** 지금 살 수 있는가 · 버튼을 켜고 끄는 단일 진실. */
  canBuyTier(cat: Category): boolean;
  /**
   * 샀으면 true(실패하면 false 이고 상태가 하나도 안 바뀐다).
   *
   * ⚠ `Game.buyTier` 는 승급을 **꺼내 가는 큐**(`takeNewTiers`)에 싣는다. 안 꺼내면 다음 카드창을
   *   닫을 때 몰아서 터진다 · 그래서 `main.ts` 는 `game` 을 그대로 넘기지 않고, 성공했을 때 큐를
   *   비우고 승급 연출까지 내보내는 **감싼 객체**를 넘긴다. 이 화면은 그 사정을 몰라도 된다.
   */
  buyTier(cat: Category): boolean;
  /**
   * **이 화면이 열린다 = 시간을 멈춘다.** 열 수 있으면 true, 지금은 열면 안 되면(관전 중이 아니면)
   * false · false 면 화면이 아예 안 열린다.
   *
   * **[사용자 2026-08-09]** "방울 업그레이드 고르는 중에는 시간이 안 멈추나? 그거 보다보니
   * 멸종해버렸는데". 예전에는 이 화면이 그냥 떴고 세계는 계속 굴러갔다.
   *
   * ⚠ 선택 인자·기본값으로 두지 않는다(필수 메서드다). 이 저장소는 "핵심 플래그를 기본값 인자로
   *   뒀더니 호출부가 안 넘겨도 컴파일이 통과해 기능이 통째로 죽어 있던" 사고를 이미 겪었다.
   */
  freeze(): boolean;
  /** 화면이 닫혔다 = 시간이 다시 흐른다. `close()` 로 가는 **모든** 길(닫기·Esc·바깥 탭·구입 직후 ·
   *  바깥에서 강제로 닫는 것)이 이 한 곳을 지난다. */
  thaw(): void;
}

export interface GenePanel {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  /** 값이 바뀌었으니 다시 그린다. **열려 있는 동안은 스스로 다시 그리므로 배선은 필요 없다.** */
  refresh: () => void;
}

/** 방울이 나오는 사건을 적는 순서(표시 전용 · 규칙이 아니다). 값과 이름은 `sim/gene.ts` 가 정한다. */
const REASON_ORDER: readonly GeneReason[] = ["boss", "extinction", "milestone", "recovery", "trialExceed"];

/** 시험 종류의 한국어 낱말 · 아래 제외 문구를 사람 말로 만들기 위한 것뿐이다(규칙은 안 담는다).
 *  `Record<TrialKind, …>` 라 시험이 늘면 여기서 컴파일이 막힌다 = 조용히 빠지는 일이 없다. */
const TRIAL_KIND_WORD: Record<TrialKind, string> = {
  hunt: "사냥",
  feed: "먹이",
  birth: "새끼",
  pop: "무리",
  hold: "자리 지키기",
  mark: "표시된 것 사냥",
};

/** 초과 달성 보상에서 빠지는 시험들의 이름 · 목록은 `game.ts` 의 `TRIAL_EXCEED_EXCLUDED` 가 정한다. */
const EXCLUDED_TRIAL_WORDS: string = TRIAL_EXCEED_EXCLUDED.map((k) => TRIAL_KIND_WORD[k]).join("·");

/**
 * 사건마다 붙는 **조건 한 마디**. 조건이 없는 사건은 빈 문자열이다.
 *
 * ⚠ **여기에 규칙을 옮겨 적지 않는다.** 숫자와 목록은 실제로 게이트가 읽는 그 값
 * (`GAME.geneCrisisMinPeak` · `TRIAL_EXCEED_EXCLUDED`)에서 만든다. 손으로 적으면 문턱을
 * 튜닝하는 순간 화면이 거짓말을 한다 · 실제로 이 두 조건이 빠져 있어서, 목표를 크게 넘겨 합격하거나
 * 작은 무리가 무너졌다 돌아와도 필드에 아무것도 안 떨어지는 화면이 됐다.
 */
const REASON_NOTE: Readonly<Record<GeneReason, string>> = {
  boss: "",
  extinction: "",
  milestone: "",
  // 「최고 20마리」로 줄이면 「많아야 20마리」로 읽힌다 · 뜻이 뒤집히므로 풀어 쓴다.
  recovery: `가장 많았을 때 ${GAME.geneCrisisMinPeak}마리 이상`,
  trialExceed: EXCLUDED_TRIAL_WORDS === "" ? "" : `${EXCLUDED_TRIAL_WORDS} 시험은 빼고`,
};

/** 이 오버레이의 z-index 이자 키보드 레이어 우선순위(같은 값을 쓰는 것이 이 저장소 관례다).
 *  드래프트(15) 위 · 로비/프리셋(20) 아래 · 관전 중에만 열리는 화면이다. */
const Z = 16;

// ─────────────────────────────── 무엇이 열리는가 ───────────────────────────────

/**
 * 접기 전에 **이름을 몇 개까지 늘어놓는가.**
 *
 * 셋으로 잡은 이유(폰 실측 폭 기준): 가장 좁은 폰(360px)에서 패널은 331px, 줄 안쪽은 약 300px 이다.
 * 이름 한 장이 보통 4~7글자(가장 긴 것이 「허기가 부지런을 만든다」 11글자)라 11px 글씨로 셋이면
 * **두 줄 안에 들어온다.** 넷을 넘기면 세 줄이 되고, 그게 다섯 범주에 곱해져 패널이 화면 두 장을
 * 넘긴다 — 그러면 「티어를 올릴 이유」가 스크롤 밑으로 숨어 애초의 목적을 잃는다.
 * 나머지는 「외 N장」으로 세고, 세부는 한 번 더 눌러서 본다(**[사용자 2026-08-10]**).
 */
const PREVIEW_NAMES = 3;

/** 이 범주를 한 단 올렸을 때의 결과 · 열리는 카드와, 「원래 이 단에 걸린 카드가 몇 장인가」. */
interface OpensAt {
  /** 지금 고를 수 있게 되는 카드들(귀한 것부터). */
  cards: Card[];
  /** 이 단에 걸려 있는 카드 수 · 이미 가진 것까지 센다. `cards` 가 비었을 때 이유를 가르는 데 쓴다. */
  total: number;
}

/**
 * **이 범주를 한 단 올리면 새로 열리는 카드들.** 이 화면이 「티어를 올릴 이유」를 대는 유일한 계산이다.
 *
 * ⚠ **조건을 여기서 다시 적지 않는다.** 드래프트가 후보를 거를 때 부르는 그 함수를 그대로 부른다
 *   (`cardGateOpen` · `cardPrereqMet` → `sim/perks.gateOpen`). 두 곳에 적으면 「열린다고 적어 놓고
 *   안 뜨는」 카드가 생긴다 · 이 저장소가 반복해서 데인 사고다.
 * ⚠ **게놈을 안 건드린다.** 도장 사본을 새로 만들어 그 위에서만 판정한다(`Game` 의 값은 읽기만).
 */
function opensAtTier(genome: Genome, cat: Category, tier: number): OpensAt {
  const nextPips: Pips = { ...genome.pips };
  nextPips[cat] = pipsForTier(tier);
  const after: Genome = { ...genome, pips: nextPips };

  const cards: Card[] = [];
  let total = 0;
  for (const card of CARD_POOL) {
    if (cardGateOpen(card, genome)) continue; // 지금도 열려 있다 = 이 단이 여는 것이 아니다
    if (!cardGateOpen(card, after)) continue; // 이 단으로는 아직 안 열린다(더 깊은 단 · 듀오 · 열쇠)
    total += 1;
    // 이미 가진 특성이나 열쇠 상한에 걸린 카드는 후보에 안 뜬다 → 「열립니다」라 적으면 거짓말이다.
    if (!cardPrereqMet(card, after)) continue;
    cards.push(card);
  }
  // 귀한 것부터. 이 줄은 「올릴 이유」라서 가장 큰 것이 먼저 읽혀야 한다(전설 = 열쇠가 맨 앞).
  cards.sort((a, b) => rarityIndex(cardRarity(b)) - rarityIndex(cardRarity(a)));
  return { cards, total };
}

/**
 * 카드 한 장의 **효과 한 줄** · 드래프트 카드에 뜨는 것과 **같은 문자열**이다.
 * 특성은 `sim/perks.perkLine`, 열쇠는 `tiers.KEY_DESC`(대가까지 함께 적는 줄)가 만든다 —
 * 여기서 다시 적으면 언젠가 한쪽만 바뀌어 화면이 거짓말을 한다.
 */
function cardEffectLine(card: Card): string {
  if (card.key !== undefined) return KEY_DESC[card.key];
  if (card.perk !== undefined) {
    const p = PERK_BY_NAME.get(card.perk);
    if (p !== undefined) return perkLine(p);
  }
  return card.desc;
}

export function createGenePanel(shop: GeneShop): GenePanel {
  ensurePanelStyles(); // :root 토큰 보장
  ensureGeneStyles();

  const root = document.createElement("div");
  root.className = "gene-root";
  // 바깥을 탭하면 닫힌다(폰에서 닫기 버튼까지 손을 옮기지 않아도 되게). 패널 안 탭은 안 새게 막는다.
  root.addEventListener("click", (e) => {
    if (e.target === root) close();
  });

  const panel = document.createElement("div");
  panel.className = "gene-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "티어 올리기");
  root.appendChild(panel);

  // ── 머리: 제목 · 닫기 · 잔액 · 어디서 나오나 ───────────────────────────────
  const head = document.createElement("div");
  head.className = "gene-head";
  const title = document.createElement("div");
  title.className = "gene-title";
  title.textContent = "티어 올리기";
  const closeBtn = document.createElement("button");
  closeBtn.className = "gene-close";
  closeBtn.type = "button";
  closeBtn.textContent = "닫기";
  closeBtn.appendChild(keyChip("Esc"));
  closeBtn.addEventListener("click", () => close());
  head.append(title, closeBtn);

  // **멈췄다고 말한다.** 화면이 멈춰 있는데 말이 없으면 "왜 안 움직이지"가 된다(카드 드래프트는
  // 전체 화면이라 저절로 읽히지만, 이 화면은 뒤로 세계가 그대로 비쳐서 더 그렇다).
  // **[사용자 2026-08-09]** 제보의 반대편이다 ▸ 예전에는 말없이 **안** 멈춰 있었다.
  const frozen = document.createElement("div");
  frozen.className = "gene-frozen";
  frozen.textContent = "고르는 동안 시간이 멈춰 있습니다";

  const bankRow = document.createElement("div");
  bankRow.className = "gene-bank";
  const bankDot = createGeneOrb(true);
  const bankNum = document.createElement("span");
  bankNum.className = "gene-bank-num";
  const bankUnit = document.createElement("span");
  bankUnit.className = "gene-bank-unit";
  bankUnit.textContent = "개";
  bankRow.append(bankDot, bankNum, bankUnit);

  const lead = document.createElement("div");
  lead.className = "gene-lead";
  // ⚠ **v9 에서 이 줄이 거짓말이 됐던 자리다.** 예전 문구는 "카드로 받은 도장은 그만큼 값을
  //   깎습니다"였는데, 드래프트 카드는 이제 도장을 한 칸도 안 준다(도장은 방울 구입과 시작 갈래뿐).
  //   값이 남은 거리라는 사실은 그대로이므로, 그 사실만 말한다(`Game.tierCost` = `pipsToNext`).
  // ⚠ **첫 문장이 바뀌었다** (**[사용자 2026-08-10]**: "방울로 올리는 티어가 카드를 해금해준다는
  //   알림도 없고, 그것 때문에 티어를 올려야겠다는 생각도 안 들어"). 단을 사는 첫 번째 이유는
  //   파생 능치가 아니라 **드래프트에 새 카드가 열리는 것**이라, 그 말이 맨 앞에 있어야 한다.
  lead.textContent =
    "모은 방울로 범주의 다음 단을 삽니다. 단이 오르면 드래프트에 새 카드가 열리고, 능력도 함께 바뀝니다. 값은 다음 단까지 남은 도장 수입니다.";

  // 방울이 어디서 나오는지 · 값은 `GENE_AWARD`, 이름은 `GENE_REASON_LABELS`, 조건은 `REASON_NOTE`
  // (게이트가 읽는 상수에서 만든다). 여기서 손으로 적으면 표를 튜닝하는 순간 화면이 거짓말을 한다.
  const sources = document.createElement("div");
  sources.className = "gene-sources";
  sources.textContent =
    "방울이 떨어지는 순간: " +
    REASON_ORDER.map((r) => {
      const note = REASON_NOTE[r];
      return `${GENE_REASON_LABELS[r]} +${GENE_AWARD[r]}${note === "" ? "" : `(${note})`}`;
    }).join(" · ") +
    ". 무리가 밟고 지나가면 주워집니다.";

  // ⚠ **샀을 때의 알림 줄은 여기 없다.** 예전엔 이 자리에 `.gene-flash` 가 있었는데 한 번도 안 보였다:
  //   `main.ts` 의 `buyTier` 감싼 객체가 승급 연출을 내보내기 전에 이 패널을 **동기로 닫으므로**,
  //   줄은 이미 숨겨진 화면 안에서 켜졌고 다시 열면 아무것도 안 산 화면에 지난 알림이 붙어 떴다.
  //   말하려던 내용(범주 · 오른 단 · 무엇이 켜졌는가)은 전체 화면 승급 연출(`main.playTierUps` →
  //   `moment.apex`)이 글자까지 똑같이 말한다 · 같은 말을 두 곳에 두는 대신 여기서 지웠다.
  const list = document.createElement("div");
  list.className = "gene-list";

  panel.append(head, frozen, bankRow, lead, sources, list);
  document.body.appendChild(root);

  // ── 범주 다섯 칸 · 한 칸이 「사는 버튼」 + 「무엇이 열리는가」 두 층이다 ────────
  //
  // ⚠ **해금 예고를 사는 버튼 안에 넣지 않는다.** 버튼 안의 버튼은 브라우저가 바깥 버튼을 먼저
  //   닫아 버려 배치가 통째로 깨진다(HTML 규칙). 그래서 한 칸(.gene-slot)이 테두리와 둥근 모서리를
  //   갖고, 그 안에 버튼 둘을 위아래로 붙인다 — 화면에는 한 카드로 읽히고 손에는 두 동작이다.
  //   위를 누르면 **산다**, 아래를 누르면 **무엇이 열리는지 펼친다**(**[사용자 2026-08-10]**).
  interface Row {
    slot: HTMLElement;
    btn: HTMLButtonElement;
    dot: HTMLElement;
    name: HTMLElement;
    tier: HTMLElement;
    price: HTMLElement;
    fill: HTMLElement;
    gain: HTMLElement;
    cost: HTMLElement;
    size: HTMLElement;
    /** 해금 예고 줄 = 펼치기 토글. */
    open: HTMLButtonElement;
    openLead: HTMLElement;
    openNames: HTMLElement;
    openMore: HTMLElement;
    /** 펼친 상세가 사는 칸. */
    detail: HTMLElement;
    /** 상세 한 줄씩 · **지우지 않고 재사용한다**(아래 fillDetail 주석 참고). */
    items: DetailItem[];
  }
  /** 상세 한 줄의 뼈대 · 카드 이름 · 등급 배지 · 효과 한 줄. */
  interface DetailItem {
    root: HTMLElement;
    name: HTMLElement;
    rar: HTMLElement;
    line: HTMLElement;
  }
  const rows = new Map<Category, Row>();
  /** 지금 상세를 펼쳐 둔 범주들. 화면 상태일 뿐이라 게놈에도 game 에도 안 남는다. */
  const expanded = new Set<Category>();

  CATEGORIES.forEach((cat, i) => {
    const slot = document.createElement("div");
    slot.className = "gene-slot";

    const btn = document.createElement("button");
    btn.className = "gene-row";
    btn.type = "button";
    btn.title = CATEGORY_DESC[cat]; // 범주가 무엇을 맡는지 · 줄을 늘리지 않고 데스크톱 툴팁으로만
    btn.addEventListener("click", () => buy(cat));

    const top = document.createElement("div");
    top.className = "gene-row-top";
    const num = keyChip(String(i + 1)); // 데스크톱 숫자 키(모바일은 CSS 가 숨긴다)
    num.style.marginLeft = "0";
    const dot = document.createElement("i");
    dot.className = "gene-dot";
    const name = document.createElement("span");
    name.className = "gene-name";
    name.textContent = CATEGORY_LABELS[cat];
    const tier = document.createElement("span");
    tier.className = "gene-tier";
    const price = document.createElement("span");
    price.className = "gene-price";
    top.append(num, dot, name, tier, price);

    const track = document.createElement("div");
    track.className = "gene-track";
    track.style.backgroundImage = tierTrackBackground(); // 문턱 눈금 · 단일 진실(traitDisplay)
    const fill = document.createElement("div");
    fill.className = "gene-fill";
    track.appendChild(fill);

    const gain = document.createElement("div");
    gain.className = "gene-line gain";
    const cost = document.createElement("div");
    cost.className = "gene-line cost";
    const size = document.createElement("div");
    size.className = "gene-line size";
    size.title = SIZE_MEANING; // 몸집은 좋고 나쁨이 안 갈리는 축이라 뜻은 이 한 문장만 말한다

    // ── 「무엇이 열리는가」 줄 · 이 화면에서 티어를 올릴 첫 번째 이유다 ──────────
    const open = document.createElement("button");
    open.className = "gene-open";
    open.type = "button";
    open.addEventListener("click", () => {
      if (expanded.has(cat)) expanded.delete(cat);
      else expanded.add(cat);
      // 다시 그리는 것은 갱신 루프가 맡는다 · 펼침 상태가 상태 지문에 들어 있어 다음 프레임에 따라온다.
    });
    const openHead = document.createElement("span");
    openHead.className = "gene-open-head";
    const openLead = document.createElement("span");
    openLead.className = "gene-open-lead";
    const openMore = document.createElement("span");
    openMore.className = "gene-open-more";
    openHead.append(openLead, openMore);
    const openNames = document.createElement("span");
    openNames.className = "gene-open-names";
    open.append(openHead, openNames);

    const detail = document.createElement("div");
    detail.className = "gene-detail";

    btn.append(top, track, gain, cost, size);
    slot.append(btn, open, detail);
    list.appendChild(slot);
    rows.set(cat, {
      slot, btn, dot, name, tier, price, fill, gain, cost, size,
      open, openLead, openMore, openNames, detail, items: [],
    });
  });

  // ── 상태 ──────────────────────────────────────────────────────────────────
  // 아래 함수들이 서로를 부르므로 상태를 먼저 선언한다(선언 전 사용은 읽는 사람을 헷갈리게 한다).
  let open_ = false;
  let raf = 0;
  /** 마지막으로 그린 상태의 지문. 바뀔 때만 DOM 에 쓴다. */
  let sig = "";

  // ── 그리기 ────────────────────────────────────────────────────────────────
  // 매 프레임 DOM 에 쓰면 폰에서 레이아웃 비용이 된다 → 상태 지문이 바뀔 때만 다시 그린다.
  // ⚠ 지문에 **열쇠도 넣는다.** 열쇠가 열리면 같은 도장·같은 잔액이어도 문구가 바뀐다
  //   (초음파를 얻는 순간 눈 줄에 「듣는 거리」가 함께 붙는다) · 안 넣으면 열어 둔 채 열쇠가
  //   열렸을 때 화면만 옛말을 계속한다.
  // ⚠ **펼침 상태와 특성 수도 지문에 넣는다.** 펼침은 이 화면만의 상태라 안 넣으면 눌러도 다음
  //   프레임에 아무 일도 안 일어난다(값이 안 바뀌었으니 다시 안 그린다). 특성 수는 「이미 가진
  //   카드」를 예고에서 빼는 판정(`cardPrereqMet`)이 읽는 값이다.
  const stateSig = (): string => {
    const p = shop.genome.pips;
    const k = shop.genome.keys;
    const opened = CATEGORIES.filter((c) => expanded.has(c)).join(",");
    return (
      `${shop.geneBank}|${CATEGORIES.map((c) => p[c]).join(",")}` +
      `|${KEY_NAMES.filter((n) => k[n]).join(",")}|${shop.genome.perks.length}|${opened}`
    );
  };

  const setText = (el: HTMLElement, s: string): void => {
    if (el.textContent !== s) el.textContent = s;
  };

  /**
   * 상세 목록을 채운다 · **줄을 지우지 않고 재사용한다.**
   * 필요한 만큼만 새로 만들고, 남는 줄은 숨긴다 — 매번 지웠다 다시 만들면 폰에서 레이아웃 비용이
   * 되고, 무엇보다 이 화면은 열려 있는 동안 매 프레임 그릴 수 있는 자리라 쓰레기를 만들면 안 된다.
   */
  const fillDetail = (r: Row, cards: readonly Card[]): void => {
    while (r.items.length < cards.length) {
      const root = document.createElement("div");
      root.className = "gene-card";
      const head = document.createElement("span");
      head.className = "gene-card-head";
      const name = document.createElement("span");
      name.className = "gene-card-name";
      const rar = document.createElement("span");
      rar.className = "gene-card-rar";
      head.append(name, rar);
      const line = document.createElement("span");
      line.className = "gene-card-line";
      root.append(head, line);
      r.detail.appendChild(root);
      r.items.push({ root, name, rar, line });
    }
    r.items.forEach((item, i) => {
      const card = cards[i];
      if (card === undefined) {
        item.root.style.display = "none";
        return;
      }
      item.root.style.display = "block";
      setText(item.name, card.name);
      // 등급 이름·색은 카드 배지와 **같은 표**에서 온다(`ui/rarity`) · 두 곳에 적지 않는다.
      const style = RARITY_STYLE[cardRarity(card)];
      setText(item.rar, style.label);
      item.rar.style.color = style.color;
      item.rar.style.background = style.badgeBg;
      setText(item.line, cardEffectLine(card));
    });
  };

  function render(): void {
    const bank = shop.geneBank;
    setText(bankNum, String(bank));
    for (const cat of CATEGORIES) {
      const r = rows.get(cat);
      if (r === undefined) continue;
      const pips = shop.genome.pips[cat];
      const t = tierOf(pips);
      const color = categoryColor(cat);
      const cost = shop.tierCost(cat);
      const maxed = cost <= 0;
      const can = shop.canBuyTier(cat);

      r.dot.style.background = color;
      r.name.style.color = t > 0 ? color : "var(--sub)";
      setText(r.tier, t > 0 ? (TIER_ROMAN[t] ?? "") : "·");
      r.tier.style.color = t > 0 ? color : "var(--faint)";
      r.fill.style.width = `${pipPct(pips)}%`;
      r.fill.style.background = color;
      r.fill.style.opacity = t > 0 ? "1" : "0.55";

      // 값 칸 · 「얼마인가」와 「왜 못 사는가」를 한 자리에서 말한다.
      if (maxed) {
        setText(r.price, "최고 단계");
        r.price.className = "gene-price max";
      } else if (can) {
        setText(r.price, `방울 ${cost}`);
        r.price.className = "gene-price ok";
      } else {
        // 남은 수를 적는다 · 회색으로 죽이기만 하면 고장 난 버튼과 구별이 안 된다.
        setText(r.price, `방울 ${cost} · ${cost - bank}개 모자람`);
        r.price.className = "gene-price short";
      }

      // 사면 무엇이 좋아지고 무엇을 잃는가 · **문구는 tiers.tierLine 이 파생표를 읽어 만든다.**
      if (maxed) {
        setText(r.gain, "더 오를 단이 없습니다.");
        setText(r.cost, "");
        setText(r.size, "");
      } else {
        // **어느 단의 값인지를 앞에 못 박는다.** 줄 머리의 로마 숫자는 「지금 단」이고 아래 수치는
        // 「사면 되는 단」이라, 안 적으면 가죽 I단 화면이 「가죽 I」과 「버티는 힘 ×1.43」(= II단 값)을
        // 나란히 보여 준다. 0단에서 I단을 살 때만 우연히 두 해석이 같아서 더 안 들킨다.
        const next = t + 1;
        const roman = TIER_ROMAN[next] ?? "";
        // 열쇠까지 넘긴다 · 같은 눈 II 라도 초음파를 가진 종은 보는 거리와 **듣는 거리가 함께**
        // 늘어난다(초음파 세기가 눈 티어를 따라 오른다 · tiers.EYE_ECHO). 그 말이 없으면
        // 「초음파를 얻었으니 눈은 이제 살 이유가 없다」로 읽힌다.
        const line = tierLine(cat, next, shop.genome.keys);
        setText(r.gain, `${roman}단 · ${line.gain}`);
        setText(r.cost, line.cost === "" ? "" : `${roman}단 대가 · ${line.cost}`);
        // 몸집은 **실값 전후**로 적는다 · 20~100 으로 잘리는 파생값이라 상수표(「+8」)를 그대로 찍으면
        // 이미 큰 종에게 거짓말이 된다(94 인 종이 가죽 IV 를 사면 102 가 100 에 잘려 실제로는 +6).
        // 몸집이 안 움직이는 범주(눈)와 상한에 완전히 걸린 경우는 저절로 빈 줄이 된다.
        const nextPips: Pips = { ...shop.genome.pips };
        nextPips[cat] = pipsForTier(next);
        const sizeFrom = derivedSize(shop.genome.pips, shop.genome.keys);
        const sizeTo = derivedSize(nextPips, shop.genome.keys);
        setText(r.size, sizeTo === sizeFrom ? "" : `몸집 ${sizeFrom} ▸ ${sizeTo}`);
      }
      r.cost.style.display = r.cost.textContent ? "block" : "none";
      r.size.style.display = r.size.textContent ? "block" : "none";

      // ── 무엇이 열리는가 ────────────────────────────────────────────────────
      // ⚠ 최고 단에서는 이 줄을 통째로 감춘다. 「더 오를 단이 없습니다」가 바로 위에 이미 있어
      //   그 칸이 빈 것으로 보이지 않는다(빈칸은 고장으로 보인다는 규칙은 **다음 단이 있는데
      //   할 말이 없는 경우**를 막는 것이고, 여기는 다음 단 자체가 없다).
      if (maxed) {
        r.open.style.display = "none";
        r.detail.style.display = "none";
      } else {
        const next = t + 1;
        const roman = TIER_ROMAN[next] ?? "";
        const { cards, total } = opensAtTier(shop.genome, cat, next);
        r.open.style.display = "block";
        if (cards.length > 0) {
          const head = cards.slice(0, PREVIEW_NAMES);
          const rest = cards.length - head.length;
          const names = head.map((c) => c.name).join(" · ");
          setText(r.openLead, `${roman}단에서 카드가 열립니다`);
          setText(r.openNames, rest > 0 ? `${names} 외 ${rest}장` : names);
          const on = expanded.has(cat);
          setText(r.openMore, on ? "접기 ▴" : "자세히 ▾");
          r.open.disabled = false;
          r.open.className = "gene-open";
          r.open.setAttribute("aria-expanded", on ? "true" : "false");
          r.detail.style.display = on ? "block" : "none";
          if (on) fillDetail(r, cards);
        } else {
          // **빈칸을 남기지 않는다.** 열릴 카드가 없으면 왜 없는지를 그 자리에서 말한다.
          //  · total > 0  = 이 단에 걸린 카드는 있는데 전부 가졌다(또는 열쇠 상한에 걸렸다)
          //  · 최고 단    = 4단은 카드가 아니라 규칙 자체가 면제되는 자리다(`tiers.MAX_TIER` 주석)
          //  ⚠ 4단 칸이 채워지면 이 분기는 저절로 위쪽(cards.length > 0)으로 넘어간다 — 여기서
          //    「4단은 카드가 없다」고 못 박지 않는 이유다.
          const why =
            total > 0
              ? `${roman}단에서 열리는 카드는 이미 다 가졌습니다.`
              : next >= MAX_TIER
                ? `${roman}단은 카드가 아니라 규칙 자체가 바뀌는 단입니다.`
                : `${roman}단에서 새로 열리는 카드는 없습니다.`;
          setText(r.openLead, why);
          setText(r.openNames, "");
          setText(r.openMore, "");
          r.open.disabled = true;
          r.open.className = "gene-open plain";
          r.open.setAttribute("aria-expanded", "false");
          r.detail.style.display = "none";
        }
        // 이름 줄이 빈 상태(위의 else 갈래)에서 위쪽 여백만 남지 않게 · 값 줄과 같은 처리다.
        r.openNames.style.display = r.openNames.textContent ? "block" : "none";
      }

      r.btn.disabled = !can;
      r.btn.className = `gene-row${maxed ? " maxed" : can ? "" : " locked"}`;
      // 살 수 있는 칸만 테두리가 살아난다(예전에 .gene-row 가 하던 일 · 테두리가 칸으로 옮겨 왔다).
      r.slot.className = can ? "gene-slot can" : "gene-slot";
    }
  }

  // 산 뒤에 무엇이 열렸는지 말하는 것은 **부르는 쪽**이다(`main.ts` 가 패널을 닫고 승급 연출을 낸다).
  // 이 함수는 상태만 바꾸고 다음 프레임에 다시 그리게 표시한다.
  function buy(cat: Category): void {
    if (!shop.canBuyTier(cat)) return;
    if (!shop.buyTier(cat)) return;
    sig = ""; // 다음 프레임에 반드시 다시 그린다(닫히지 않고 열려 있는 경우)
  }

  // 열려 있는 동안만 도는 갱신 루프. 산 직후처럼 값이 바뀌는 순간을 배선 없이 따라잡는다.
  // (2026-08-09 이후로 **열려 있는 동안 세계는 멈춰 있으므로** 잔액이 저절로 늘지는 않는다 ·
  //  예전 이 주석은 "기다리면 잔액이 는다"였는데 그건 곧 사용자가 무리를 잃고 있었다는 뜻이었다.)
  function loop(): void {
    if (!open_) return;
    const s = stateSig();
    if (s !== sig) {
      sig = s;
      render();
    }
    raf = requestAnimationFrame(loop);
  }

  /**
   * 여닫기의 **단일 통로**. 시간을 멈추고 다시 흐르게 하는 것도 여기 한 자리에서만 한다.
   * 닫는 길이 넷(닫기 버튼 · Esc · 바깥 탭 · 산 직후 자동 닫힘)이고 바깥에서 강제로 닫는 자리도
   * 셋(드래프트가 열림 · 런 종료 · 새 세계)이라, 각자 풀어 주게 두면 하나는 반드시 안 푼다.
   *
   * 열 수 없는 때(관전 중이 아님)면 `freeze()` 가 false 를 내고 **화면 자체가 안 열린다** ·
   * 「멈추지도 않았는데 떠 있는 화면」을 만들지 않는다.
   */
  function setOpen(next: boolean): void {
    if (open_ === next) return;
    if (next && !shop.freeze()) return;
    open_ = next;
    root.classList.toggle("open", next);
    if (next) {
      root.scrollTop = 0; // 다시 열 때 늘 맨 위에서 시작한다(지난번 스크롤이 남으면 제목이 안 보인다)
      sig = "";
      loop();
    } else {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      shop.thaw();
    }
  }
  const close = (): void => setOpen(false);

  // 키보드 · 숫자 1~5 로 곧장 사고, Esc 로 닫는다. 우선순위는 이 오버레이의 z-index 와 같은 값.
  registerKeyLayer(
    Z,
    () => open_,
    (e) => {
      if (e.code === "Escape" || e.code === "Backspace") {
        close();
        return true;
      }
      const m = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
      if (m !== null) {
        const cat = CATEGORIES[Number(m[1]) - 1];
        if (cat !== undefined) buy(cat);
        return true;
      }
      return false;
    },
  );

  return {
    open: () => setOpen(true),
    close,
    toggle: () => setOpen(!open_),
    isOpen: () => open_,
    refresh: () => {
      sig = "";
      if (open_) render();
    },
  };
}

function ensureGeneStyles(): void {
  if (document.getElementById("gene-style")) return;
  const s = document.createElement("style");
  s.id = "gene-style";
  // ⚠ 이 CSS 는 템플릿 리터럴 안이다 · 주석에 백틱을 쓰지 말 것(panelStyles 와 같은 제약).
  s.textContent = `
  /* 방울 토큰 넷 · 값은 전부 config.ts 의 COLORS.gene 하나에서 파생한다(goalBar 도 이 토큰만 쓴다). */
  :root { --gene: ${GENE_COLOR}; --geneDeep: ${geneShade(0.45)};
          --geneLine: ${geneAlpha(0.55)}; --geneFill: ${geneAlpha(0.14)}; }
  /* 뿌리 · 전체 화면 딤. **정렬을 여기서 잡지 않는다**(파일 머리 주석의 폰 함정) · 자리 배치는
     전부 .gene-panel 의 margin:auto 가 맡고, 넘치면 이 상자가 세로로 스크롤한다. */
  .gene-root { position: fixed; inset: 0; z-index: ${Z}; display: none;
    overflow-y: auto; overscroll-behavior: contain; padding: 12px 0;
    background: rgba(11, 9, 6, 0.82);
    backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
    color: var(--ink); font-family: var(--font-body); user-select: none; }
  .gene-root.open { display: flex; }
  /* margin:auto 가 가로·세로 정렬을 동시에 맡는다. flex 의 auto 마진은 남는 자리가 있을 때만 밀고
     내용이 화면보다 길면 0 이 되어(= 시작 모서리 유지) 위가 잘리지 않는다. flex:none 은 이 패널이
     stretch 로 늘어나거나 줄어드는 것을 막는다. */
  .gene-panel { width: min(360px, 92vw); box-sizing: border-box; margin: auto; flex: none;
    padding: 16px 16px 18px;
    background: var(--bg-lobby); border: 1px solid var(--line); border-radius: var(--r-panel); }
  .gene-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .gene-title { font-family: var(--font-title); font-size: 18px; }
  .gene-close { flex: none; font: inherit; font-size: 12px; color: var(--ink); background: none;
    border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; cursor: pointer; }
  .gene-close:active { background: rgba(255,255,255,0.06); }
  /* 「시간이 멈췄다」 한 줄 · 제목 바로 아래. 값이 아니라 **상태**를 말하는 줄이라 잔액(금빛)과
     색을 섞지 않는다(보조 본문색 + 옅은 테두리). 한 줄이 넘지 않게 짧게 유지할 것. */
  .gene-frozen { margin-top: 10px; padding: 5px 10px; border-radius: 999px;
    border: 1px solid var(--line); background: rgba(255,255,255,0.03);
    font-size: 11px; color: var(--sub); align-self: flex-start; display: inline-block;
    word-break: keep-all; }
  /* 잔액 · 이 화면에서 가장 큰 숫자다. 얼마 있는지가 먼저 읽혀야 무엇을 살지 정할 수 있다. */
  .gene-bank { display: flex; align-items: baseline; gap: 8px; margin-top: 12px; }
  .gene-bank-num { font-family: var(--font-mono); font-size: 26px; line-height: 1;
    color: var(--gene); font-variant-numeric: tabular-nums; }
  .gene-bank-unit { font-size: 12px; color: var(--sub); }
  /* 방울 표식 · 글자가 아니라 CSS 로 그린 구슬이다(폰트에 없는 글리프로 깨질 일이 없다).
     필드에 떨어지는 방울과 같은 색이라 「저것이 이 숫자」가 설명 없이 이어진다. */
  .gene-orb { display: inline-block; flex: none; width: 9px; height: 9px; border-radius: 50%;
    background: radial-gradient(circle at 34% 30%, #FFFFFF 0%, var(--gene) 52%, var(--geneDeep) 100%);
    box-shadow: 0 0 7px -1px var(--gene); }
  .gene-orb.big { width: 13px; height: 13px; align-self: center; }
  .gene-lead { font-size: 11.5px; color: var(--sub); line-height: 1.55; margin-top: 8px;
    word-break: keep-all; }
  /* 방울이 어디서 나오는지 · 이 게임을 굴리는 데 필요한 지식이라 **읽히게** 둔다(대백과에 안 미룬다).
     처음엔 --faint 로 깔았는데 폰 실측 화면에서 거의 안 보였다 → 보조 본문색으로 올린다. */
  .gene-sources { font-family: var(--font-mono); font-size: 10.5px; color: var(--sub);
    opacity: 0.9; line-height: 1.6; margin-top: 8px; word-break: keep-all; }
  .gene-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
  /* 범주 한 칸 · **테두리와 둥근 모서리를 이 상자가 갖는다**(예전엔 .gene-row 가 가졌다).
     안에 버튼이 둘 들어가는데(사기 · 무엇이 열리는지 펼치기) 하나의 카드로 읽혀야
     「이 단을 사면 저것이 열린다」가 이어지기 때문이다. overflow:hidden 이 아래쪽 모서리를 깎는다. */
  .gene-slot { background: var(--panelSolid); border: 1px solid var(--line);
    border-radius: var(--r-card); overflow: hidden;
    transition: border-color 0.15s ease; }
  /* 살 수 있는 칸만 테두리가 방울 색으로 살아난다 · 「지금 뭘 살 수 있나」가 글씨를 읽기 전에 보인다. */
  .gene-slot.can { border-color: var(--geneLine); }
  /* 한 줄이 통째로 버튼 · 폰에서 작은 버튼을 겨냥하게 만들지 않는다. */
  .gene-row { width: 100%; box-sizing: border-box; text-align: left; display: block;
    padding: 10px 12px 11px; background: none; border: 0; border-radius: 0; color: var(--ink);
    font: inherit; cursor: pointer; transition: transform 0.07s ease; }
  .gene-row:active { transform: translateY(2px); }
  /* 못 사는 줄은 흐리되 **읽을 수는 있어야 한다** · 거기 적힌 「몇 개 모자람」이 왜 못 사는지의
     유일한 설명이다. 안 읽히게 죽이면 고장 난 버튼과 구별이 안 된다(0.6 은 폰에서 안 읽혔다).
     ⚠ 흐려지는 것은 **사는 줄뿐**이다 · 아래 해금 예고는 못 살 때도 또렷해야 한다.
        그게 「지금은 못 사지만 모아서 사야겠다」를 만드는 유일한 문장이기 때문이다. */
  .gene-row.locked, .gene-row.maxed { cursor: default; transform: none; }
  .gene-row.locked { opacity: 0.75; }
  .gene-row.maxed { opacity: 0.82; }

  /* ── 무엇이 열리는가 · 사는 버튼 바로 아래 ────────────────────────────────────
     **[사용자 2026-08-10]** "티어 화면에서는 카드들의 대략적인 이름 정도만 보여주고, 그 티어
     버튼을 한 번 더 누르면 각 카드의 상세 내용을 볼 수 있게." 그래서 이 줄은 이름만 말하고,
     누르면 아래 .gene-detail 이 펼쳐진다. 값 칸보다 위계가 높다(방울 색으로 머리를 단다). */
  .gene-open { display: block; width: 100%; box-sizing: border-box; text-align: left;
    padding: 8px 12px 9px; background: rgba(255,255,255,0.035); border: 0;
    border-top: 1px solid var(--line); color: var(--ink); font: inherit; cursor: pointer; }
  .gene-open:active { background: rgba(255,255,255,0.09); }
  /* 펼칠 것이 없는 상태(이미 다 가졌다 · 규칙이 바뀌는 단) · 눌리지 않지만 문장은 읽힌다. */
  .gene-open.plain { cursor: default; background: none; }
  .gene-open-head { display: flex; align-items: baseline; gap: 8px; }
  .gene-open-lead { flex: 1; min-width: 0; font-size: 10.5px; line-height: 1.45;
    color: var(--gene); word-break: keep-all; }
  .gene-open.plain .gene-open-lead { color: var(--sub); }
  .gene-open-more { flex: none; font-family: var(--font-mono); font-size: 9.5px;
    color: var(--sub); white-space: nowrap; }
  .gene-open-names { display: block; margin-top: 3px; font-size: 11px; line-height: 1.45;
    color: var(--ink); opacity: 0.92; word-break: keep-all; }

  /* 펼친 상세 · 카드 한 장이 한 줄이다. 효과 문구는 드래프트 카드에 뜨는 것과 **같은 문자열**이라
     (sim/perks.perkLine · tiers.KEY_DESC) 여기와 카드가 갈라질 수 없다. */
  .gene-detail { padding: 3px 12px 10px; border-top: 1px solid var(--line);
    background: rgba(0,0,0,0.20); }
  .gene-card { padding-top: 8px; }
  .gene-card-head { display: flex; align-items: baseline; gap: 7px; }
  /* 이름은 한 줄로 자른다 · 등급 배지는 안 줄어든다(값 칸과 같은 규칙). */
  .gene-card-name { flex: 1; min-width: 0; font-family: var(--font-title); font-size: 12px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gene-card-rar { flex: none; font-family: var(--font-mono); font-size: 9px; white-space: nowrap;
    border-radius: 999px; padding: 2px 7px; }
  .gene-card-line { display: block; margin-top: 2px; font-size: 10.5px; line-height: 1.4;
    color: var(--sub); word-break: keep-all; }
  .gene-row-top { display: flex; align-items: center; gap: 7px; }
  .gene-dot { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  .gene-name { font-family: var(--font-title); font-size: 14.5px; flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gene-tier { flex: none; font-family: var(--font-mono); font-size: 13px; }
  /* 값 칸 · nowrap 이라 절대 안 접힌다. 이름 쪽이 대신 줄어든다(범주 이름은 두 글자 이내다). */
  .gene-price { flex: none; font-family: var(--font-mono); font-size: 10px; white-space: nowrap;
    border-radius: 999px; padding: 3px 8px; border: 1px solid transparent;
    font-variant-numeric: tabular-nums; }
  .gene-price.ok { color: var(--gene); background: var(--geneFill);
    border-color: var(--geneLine); }
  .gene-price.short { color: var(--sub); background: rgba(255,255,255,0.05);
    border-color: var(--line); }
  /* 「최고 단계」는 방울 금빛과 갈라 놓는다 · 예전엔 --amber 였는데 방울이 금빛이 되면서
     「살 수 있다」와 「다 채웠다」가 같은 색으로 보였다. 다 채운 것은 라임(긍정·완료)이다. */
  .gene-price.max { color: var(--lime); background: rgba(143,209,79,0.12);
    border-color: rgba(143,209,79,0.35); }
  .gene-track { margin-top: 7px; height: 5px; border-radius: 3px;
    background-color: rgba(255,255,255,0.08); overflow: hidden; position: relative; }
  .gene-fill { height: 100%; border-radius: 3px; }
  .gene-line { font-size: 10.5px; line-height: 1.45; margin-top: 5px; word-break: keep-all; }
  .gene-line.gain { color: var(--lime); }
  .gene-line.cost { color: #DB9A85; }
  .gene-line.size { color: var(--sub); opacity: 0.85; }

  /* 데스크톱 · 확대 배율 아래에서도 폰과 같은 비율로 보인다(body 직속이라 zoom 을 자동으로 받는다).
     넓은 화면에서는 패널만 조금 키운다 · 다섯 줄이 한눈에 들어오는 편이 낫다. */
  @media (min-width: 860px) {
    .gene-panel { width: min(420px, 92vw); }
    .gene-line { font-size: 11.5px; }
    .gene-price { font-size: 11px; }
    .gene-open-lead { font-size: 11.5px; }
    .gene-open-more { font-size: 10.5px; }
    .gene-open-names { font-size: 12px; }
    .gene-card-name { font-size: 13px; }
    .gene-card-line { font-size: 11.5px; }
    .gene-card-rar { font-size: 10px; }
  }

  @media (prefers-reduced-transparency: reduce) {
    .gene-root { background: rgba(11,9,6,0.96); backdrop-filter: none; -webkit-backdrop-filter: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .gene-row, .gene-slot { transition: none; }
    .gene-row:active { transform: none; }
  }
  `;
  document.head.appendChild(s);
}
