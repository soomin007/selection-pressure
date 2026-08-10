// 목표 한 줄 + 접이식 상세 패널 · 갈아엎은 상시 HUD 의 전부다(2026-08-02 사용자 A안 확정).
// 화면에 늘 떠 있는 것은 "지금 할 일" 한 줄과 멈춤 버튼 하나뿐이고, 나머지 정보(시대·레벨·개체 수·
// 시간·배속·패널 열기)는 그 줄을 탭했을 때만 아래로 펼쳐진다. 정보를 없앤 게 아니라 "원할 때만
// 보이게" 옮긴 것 · 상시 화면은 월드에 양보한다.
//
// "뭘 하려는 건지 모르겠다"(사용자)에 대한 대답이 이 한 줄이다: 지금 단계에서 해야 할 일을
// 게임 상태에서 자동으로 뽑아 문장으로 보여준다(채집=먹여 키우기, 보스=물리치거나 버티기, …).
//
// 2026-08-05 사용자 요구 둘을 여기서 푼다.
//  ① "펼쳤을 때 반투명하게 · 화면이 갑갑하지 않게": 상세 패널을 유리처럼 만들어 뒤의 월드가 비쳐
//     보이게 한다. 다만 **글씨 대비가 우선**이라 배경을 그냥 옅게만 하지 않고 backdrop 을 어둡게
//     눌러(brightness) 깔고 글씨에 그림자를 준다. blur 반경은 폰 부담을 생각해 작게(7px) 잡고,
//     backdrop-filter 를 못 쓰는 기기에는 거의 불투명한 배경을 폴백으로 둔다.
//  ② "탭하면 펼치기/접기가 된다는 걸 한눈에": 알약 오른쪽 끝에 펼침 화살표(∨/∧)를 둔다. 글씨로
//     "탭해서 펼치기"라고 적으면 상시 HUD 가 한 줄 더 늘고 화면이 어지러워지므로 표식으로 푼다.
//     화살표는 열리면 뒤집히고(상태를 그 자리에서 말한다), 한 번도 안 열어 봤으면 천천히 깜빡여
//     시선을 부른다(한 번 열면 그친다 · 잔소리는 한 번이면 족하다).
//
// 구조 메모: 상세 패널은 알약과 **같은 뿌리(.goal-root)의 아래 칸**이다. 예전엔 화면에 따로 붙인
// position:fixed + top:62px 이라, 안내 줄이 두 줄로 늘면 알약이 그 62px 를 넘어 패널과 겹칠 수
// 있었다(반투명해지면 겹침이 더 잘 보인다). 세로 flex 로 이어 붙이면 겹칠 수가 없다.

import { ensurePanelStyles } from "@/ui/panelStyles";
// 방울 구슬 표식은 티어 구입 화면과 **같은 것을 쓴다** · 색·모양이 갈라지면 「저 숫자가 저 화면의
// 그것인지」가 안 이어진다. 표식을 만드는 함수 하나가 자기 스타일 주입까지 맡는다(genePanel).
import { createGeneOrb } from "@/ui/genePanel";

export interface GoalBarCallbacks {
  onPauseToggle: () => void;
  onSpeedCycle: () => void;
  onTraitsToggle: () => void;
  onGlossary: () => void;
  /**
   * 티어 구입 화면 열기(`genePanel`). **일부러 옵셔널이다** · 이 콜백을 필수로 만들면 아직 배선을
   * 안 한 `main.ts` 가 컴파일 에러로 무너진다(여러 세션이 같은 트리에서 일한다). 안 넘기면 방울
   * 카운터는 **누를 수 없는 숫자**로만 뜨고, 넘기는 순간 문이 열린다.
   */
  onGeneOpen?: () => void;
}

export interface GoalData {
  visible: boolean;
  text: string; // 지금 할 일 한 줄
  sub: string; // 보조 설명(빈 문자열이면 줄 자체를 숨김)
  stage: string; // "1시대 · 채집" 등
  level: number;
  xp01: number; // 다음 카드까지 진행(0~1)
  /** 범주 다섯의 지금 티어(0~4). 상시 눈금이 읽는 유일한 값 · 순서는 CATEGORIES 와 같다. */
  tiers: readonly number[];
  mine: number;
  wild: number;
  followers: number; // 지금 뜻을 향해 움직이는 수(뜻이 없으면 -1 → 상세 패널 줄 숨김)
  /** 접힌 기본 알약에 상시로 붙는 짧은 칩("따르는 중 3/5"·"무리 도착"). 빈 문자열이면 숨긴다.
   *  분모는 내 종 전부가 아니라 **아직 목표에 못 닿은 수**(world.orderPending)다 · 전부를 분모로
   *  쓰면 도착한 개체가 불복종처럼 읽힌다(2026-08-05). 문구를 main 이 만드는 이유: 도착 여부처럼
   *  월드를 봐야 아는 것이 섞여 있다(여기선 그리기만). */
  follow: string;
  /**
   * 그 칩의 성격. 관문(보스·대멸종) 동안에는 이 자리가 **"지금 몇 / 살아남아야 하는 수"** 를 말한다
   * ("생존 21/8"). 기준선에 가까워지면 색이 변해 "이대로면 진다"가 숫자를 읽기 전에 먼저 보인다.
   *   plain  평소(따르는 중 · 무리 도착)
   *   warn   여유가 얼마 안 남았다(기준의 두 배 아래)
   *   danger 기준 밑이다 · 지금 관문이 끝나면 진다
   */
  followTone: "plain" | "warn" | "danger";
  seconds: number;
  night: boolean;
  /**
   * 가진 방울 수(`game.geneBank`). **일부러 옵셔널이다** · 필수로 만들면 아직 이 값을 안 넘기는
   * `main.ts` 가 컴파일 에러로 무너진다. 넘기지 않으면 카운터를 통째로 숨기고, 넘기는 순간 뜬다.
   */
  genes?: number;
  /**
   * 지금 **당장 살 수 있는 범주가 하나라도 있는가**(`CATEGORIES.some((c) => game.canBuyTier(c))`).
   * 카운터가 방울 색으로 살아나 「지금 뭘 올릴 수 있다」를 숫자를 읽기 전에 알린다.
   * 안 넘기면 평상 모양으로만 뜬다(거짓말이 아니라 말을 덜 하는 것이다).
   */
  geneReady?: boolean;
}

export interface GoalBar {
  update: (d: GoalData) => void;
  setPaused: (p: boolean) => void;
  setSpeed: (s: number) => void;
  collapse: () => void; // 상세 패널 접기(단계 전환·드래프트 진입 때 main 이 부른다)
  /** 펼치기/접기 · 데스크톱 키(I)용. 탭이 없는 환경에서도 같은 문을 열 수 있어야 한다.
   *  (키 라우터가 keydown 마다 포커스를 걷어내므로 알약에 Tab 으로 포커스를 줘도 Enter 가 안 먹는다) */
  toggle: () => void;
  /** 상세 패널이 펼쳐져 있는가. 펼치면 우상단 미니맵을 덮으므로 main 이 미니맵을 숨기는 데 쓴다
   *  (같은 모서리를 쓰는 위젯은 동시에 두지 않고 상태로 나눠 쓴다 · known_issues). */
  isOpen: () => boolean;
  /**
   * 이 HUD 가 화면 위쪽에서 실제로 차지한 높이(화면 CSS 픽셀 · 안 보이면 0).
   *
   * 왜 필요한가: 캔버스(Pixi)에 그리는 글씨(위협 예고 전광판·판정/보스 플래시)는 **이 DOM 패널
   * 아래에 깔린다.** 알약이 두 줄로 늘거나 상세를 펼치면 그 글씨가 통째로 가려져 "왜 졌는지 모르는데
   * 졌다"가 된다(2026-08-05 사용자 지적, 세 번째). 예전엔 Pixi 쪽이 "대략 60px" 이라는 고정값을
   * 들고 있었는데, 이 줄은 문구 길이에 따라 자라므로 고정값은 언제나 틀린다.
   * → **여기서 실측한 높이 하나가 단일 진실**이고 main 이 그 값을 Pixi 위젯에 넘긴다.
   * 매 프레임 재면 레이아웃 비용이 드니 크기가 바뀔 때만(ResizeObserver) 다시 잰다.
   */
  bottomPx: () => number;
}

/**
 * **관문 동안 알약에 붙는 생존 칩** — "지금 몇 마리 / 살아남아야 하는 수".
 *
 * 왜 필요한가: 기준(N마리)만 말하고 지금 수를 안 보여 주면, 플레이어는 관문이 끝나고 나서야 자기가
 * 기준 아래였다는 걸 안다. 둘을 한 자리에 붙여야 "지금 위험한가"가 계산 없이 읽힌다.
 * 기준이 1(첫 시대 = 완전 멸종만 패배)이면 굳이 겁을 주지 않는다 → null(칩을 안 띄운다).
 *
 * 순수 함수(DOM 무관)라 테스트로 문턱을 못박는다. 색 문턱: 기준 미만 = danger · 기준의 두 배 미만 = warn.
 */
export function survivalChip(
  now: number,
  need: number,
): { text: string; tone: "plain" | "warn" | "danger" } | null {
  if (need <= 1) return null;
  const tone = now < need ? "danger" : now < need * 2 ? "warn" : "plain";
  // "마리"를 뒤에 붙이는 이유: 보스를 때려 잡는 판에서는 안내 줄이 "체력 바를 깎으세요"로 채워져
  // 기준을 다시 말할 자리가 없다. 칩 하나만 봐도 "지금 20마리, 6마리는 남아야 한다"가 읽혀야 한다.
  return { text: `생존 ${now}/${need}마리`, tone };
}

export function createGoalBar(cb: GoalBarCallbacks): GoalBar {
  ensurePanelStyles();
  ensureGoalStyles();

  const root = document.createElement("div");
  root.className = "goal-root";
  root.style.display = "none";

  // 윗칸 · 늘 보이는 줄(알약 + 멈춤).
  const head = document.createElement("div");
  head.className = "goal-head";

  const pill = document.createElement("button");
  pill.className = "goal-pill";
  pill.type = "button";
  pill.title = "탭하면 자세한 정보가 열립니다 (I)";
  pill.setAttribute("aria-expanded", "false");
  pill.setAttribute("aria-controls", "goal-panel");
  // 알약 = [글 묶음][펼침 화살표]. 화살표를 첫 줄 안에 넣지 않고 알약 오른쪽 끝에 세로 가운데로
  // 두는 이유: 안내 줄이 두 줄로 늘어도 화살표 자리가 안 흔들린다(펼침 표식은 늘 같은 자리에).
  const pillBody = document.createElement("div");
  pillBody.className = "goal-pill-body";
  // 첫 줄은 "할 일 + 순종 칩"이 한 줄을 나눠 쓴다(flex). 칩을 아래 sub 줄에 붙이면 기한·불씨와
  // 뒤엉키고, 새 줄로 빼면 상시 HUD 가 한 줄 더 늘어난다.
  const line = document.createElement("div");
  line.className = "goal-line";
  const textEl = document.createElement("div");
  textEl.className = "goal-text";
  const followEl = document.createElement("span");
  followEl.className = "goal-follow";
  followEl.style.display = "none";
  line.append(textEl, followEl);
  const subEl = document.createElement("div");
  subEl.className = "goal-sub";
  pillBody.append(line, subEl);
  // 화살표는 CSS 로 그린 꺾쇠다(글자 아님) · 폰트에 없는 글리프로 깨질 일이 없고, 화면 낭독기에는
  // 알약의 aria-expanded 가 이미 상태를 말하므로 표식 자체는 숨긴다.
  const caret = document.createElement("span");
  caret.className = "goal-caret hint";
  caret.setAttribute("aria-hidden", "true");
  // 경험치 밑선 — 숫자도 글자도 없이 알약 아래를 달린다(높이 2px · 줄이 안 늘어난다).
  const xpLine = document.createElement("div");
  xpLine.className = "goal-xpline";
  xpLine.setAttribute("aria-hidden", "true"); // 상세 패널이 같은 값을 글로 말한다
  const xpLineFill = document.createElement("div");
  xpLineFill.className = "goal-xpline-fill";
  xpLine.appendChild(xpLineFill);
  pill.append(pillBody, caret, xpLine);

  // 도장 눈금 다섯 · 알약 **옆** 제 칸(세로 압박 0). 승급 띠와 같은 문법이라 두 화면이 이어진다.
  const pipsBox = document.createElement("div");
  pipsBox.className = "goal-pips";
  pipsBox.setAttribute("aria-hidden", "true"); // 상세 패널·형질 패널이 같은 값을 글로 말한다
  const pipDots: HTMLDivElement[][] = [];
  for (let c = 0; c < 5; c += 1) {
    const rowEl = document.createElement("div");
    rowEl.className = "goal-pip-row";
    const dots: HTMLDivElement[] = [];
    for (let i = 0; i < 4; i += 1) {
      const d = document.createElement("div");
      d.className = "goal-pip";
      rowEl.appendChild(d);
      dots.push(d);
    }
    pipDots.push(dots);
    pipsBox.appendChild(rowEl);
  }
  /** 직전에 그린 티어 — 오른 칸만 튀게 하려고 기억한다(매 프레임 애니메이션을 다시 걸면 계속 떤다). */
  const lastTiers = [-1, -1, -1, -1, -1];

  // 방울 카운터 · **상시 HUD 에 늘 떠 있는 자리.** 알약 첫 줄에 넣지 않은 이유: 그 줄은 할 일
  // 문구와 순종/생존 칩이 이미 나눠 쓰고 있고, 관문 동안에는 "생존 21/8마리"가 그 줄을 거의 다
  // 먹는다. 알약 옆에 제 칸으로 두면 **줄이 안 늘어나고**(세로 압박 0 · 폰 세로 화면 제약),
  // 알약 탭(상세 펼치기)과 겹치지 않는 제 손잡이가 생긴다.
  // 높이는 CSS 에서 44px 로 고정한다 — 예전엔 `.goal-head` 의 stretch 가 알약에 맞춰 줬는데,
  // 그러면 할 일 문구가 두 줄이 될 때 이 칸이 함께 세로로 늘어난다(2026-08-10 사용자 지적).
  const geneBtn = document.createElement("button");
  geneBtn.className = "goal-gene";
  geneBtn.type = "button";
  geneBtn.style.display = "none"; // genes 를 안 넘기면 통째로 숨긴다(아직 배선 전인 화면)
  const geneNum = document.createElement("span");
  geneNum.className = "goal-gene-num";
  geneBtn.append(createGeneOrb(), geneNum);
  if (cb.onGeneOpen !== undefined) {
    const openGene = cb.onGeneOpen;
    geneBtn.title = "모은 방울로 티어 올리기";
    geneBtn.addEventListener("click", () => openGene());
  } else {
    // 열 문이 없으면 누를 것도 없다 · 눌리는 척하는 버튼은 고장 난 버튼과 구별이 안 된다.
    geneBtn.classList.add("static");
  }

  const pauseBtn = document.createElement("button");
  pauseBtn.className = "goal-pause";
  pauseBtn.type = "button";
  pauseBtn.textContent = "⏸";
  pauseBtn.title = "멈춤/이어하기 (Space)";
  pauseBtn.addEventListener("click", cb.onPauseToggle);

  head.append(pill, pipsBox, geneBtn, pauseBtn);

  // 상세 패널 · 옛 상태 바·칩이 담던 정보의 새 집. 필요할 때만 연다.
  const panel = document.createElement("div");
  panel.className = "goal-panel";
  panel.id = "goal-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "자세한 정보");
  panel.style.display = "none";

  const stageRow = row(panel);
  const levelRow = row(panel);
  const xpTrack = document.createElement("div");
  xpTrack.className = "goal-xp";
  const xpFill = document.createElement("div");
  xpFill.className = "goal-xp-fill";
  xpTrack.appendChild(xpFill);
  panel.appendChild(xpTrack);
  const countRow = row(panel);
  const timeRow = row(panel);

  // 방울 줄 · 접힌 알약의 작은 숫자만으로는 "저게 뭐지"가 안 풀린다. 펼쳤을 때 한 번 더,
  // 이번엔 **이름과 함께** 말하고 문까지 연다(두 번째 문 · 첫 문은 알약 옆 카운터).
  // 아래 버튼 줄(배속·내 형질·대백과)에 네 번째 버튼으로 끼우지 않은 이유: 폰 좁은 폭에서
  // 버튼 하나가 약 63px 이 되어 "티어 올리기" 다섯 글자가 안 들어간다.
  const geneRow = document.createElement("button");
  geneRow.className = "goal-generow";
  geneRow.type = "button";
  geneRow.style.display = "none";
  if (cb.onGeneOpen !== undefined) {
    const openGene = cb.onGeneOpen;
    geneRow.addEventListener("click", () => {
      openGene();
      setOpen(false); // 구입 화면이 이 패널을 덮으므로 접어 둔다(같은 자리에 둘을 겹치지 않는다)
    });
  }
  panel.appendChild(geneRow);

  const btnRow = document.createElement("div");
  btnRow.className = "goal-btnrow";
  const speedBtn = panelButton("1x", "배속 바꾸기 (1·2·3)", cb.onSpeedCycle);
  const traitsBtn = panelButton("내 형질", "지금 종의 형질 보기", () => {
    cb.onTraitsToggle();
    setOpen(false);
  });
  const glossaryBtn = panelButton("대백과", "생물·규칙 설명 (G)", () => {
    cb.onGlossary();
    setOpen(false);
  });
  btnRow.append(speedBtn, traitsBtn, glossaryBtn);
  panel.appendChild(btnRow);

  root.append(head, panel);
  document.body.appendChild(root);

  // 이 HUD 가 차지한 아래 끝(화면 CSS 픽셀). Pixi 글씨가 그 밑으로 비켜 그려지는 근거다(bottomPx 주석).
  // 크기가 바뀔 때만 다시 잰다 · 매 프레임 getBoundingClientRect 는 폰에서 레이아웃 강제 계산 비용이다.
  let hudBottom = 0;
  const measure = (): void => {
    hudBottom = root.style.display === "none" ? 0 : root.getBoundingClientRect().bottom;
  };
  // 문구가 한 줄↔두 줄로 오가거나 상세를 펼치면 높이가 바뀐다 → 그때마다 관찰자가 다시 잰다.
  new ResizeObserver(measure).observe(root);
  // 창 크기·확대 배율(--ui-zoom)이 바뀌면 zoom 이 걸린 이 뿌리의 화면 좌표도 바뀐다(ResizeObserver 는
  // zoom 변화를 못 잡는 경우가 있어 창 이벤트로도 다시 잰다).
  window.addEventListener("resize", measure);

  let open = false;
  let hintOn = true; // 아직 한 번도 안 펼쳐 봤다 → 화살표가 깜빡여 "여기를 눌러 보라"고 말한다
  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    panel.style.display = next ? "flex" : "none";
    pill.classList.toggle("open", next);
    pill.setAttribute("aria-expanded", next ? "true" : "false");
    if (next && hintOn) {
      hintOn = false; // 한 번 열어 봤으면 알림은 끝. 계속 깜빡이면 그때부턴 잔소리다.
      caret.classList.remove("hint");
    }
  }
  pill.addEventListener("click", () => setOpen(!open));

  // DOM 쓰기는 값이 바뀔 때만 · 매 프레임 textContent 대입은 폰에서 레이아웃 비용이 된다.
  const cache = new Map<HTMLElement, string>();
  const setText = (el: HTMLElement, s: string): void => {
    if (cache.get(el) !== s) {
      cache.set(el, s);
      el.textContent = s;
    }
  };
  const setDisplay = (el: HTMLElement, v: string): void => {
    if (el.style.display !== v) el.style.display = v;
  };

  // 방울이 늘어난 순간에만 카운터를 한 번 튀긴다. 폰으로 검토하는 게임이라 조용한 숫자 변화는
  // 그냥 안 읽힌다 · 방울은 "밟고 지나가면 주워지는" 것이라 **주웠다는 사실 자체**가 피드백이다.
  let lastGenes = -1;
  const popGene = (): void => {
    geneBtn.classList.remove("pop");
    void geneBtn.offsetWidth; // 리플로우 강제 · 연달아 주워도 애니메이션이 처음부터 다시 돈다
    geneBtn.classList.add("pop");
  };

  return {
    update: (d: GoalData): void => {
      const vis = d.visible ? "flex" : "none";
      if (root.style.display !== vis) {
        root.style.display = vis;
        if (!d.visible) setOpen(false);
        measure(); // 숨김↔표시는 ResizeObserver 가 안 알려 준다(display:none 은 크기 변화가 아니다)
      }
      if (!d.visible) return;
      setText(textEl, d.text);
      setText(subEl, d.sub);
      const subVis = d.sub ? "block" : "none";
      if (subEl.style.display !== subVis) subEl.style.display = subVis;
      setText(followEl, d.follow);
      const followVis = d.follow ? "inline-block" : "none";
      if (followEl.style.display !== followVis) followEl.style.display = followVis;
      const toneCls = `goal-follow ${d.followTone}`;
      if (followEl.className !== toneCls) followEl.className = toneCls;
      // 방울 카운터. 값이 없으면(아직 배선 전) 카운터도 상세의 방울 줄도 통째로 숨긴다.
      // ⚠ 클래스는 className 대입이 아니라 toggle 로 켠다 · 대입하면 방금 붙인 pop 이 지워진다.
      if (d.genes === undefined) {
        setDisplay(geneBtn, "none");
        setDisplay(geneRow, "none");
        lastGenes = -1;
      } else {
        setDisplay(geneBtn, "flex");
        setText(geneNum, String(d.genes));
        geneBtn.classList.toggle("ready", d.geneReady === true);
        if (lastGenes >= 0 && d.genes > lastGenes) popGene();
        lastGenes = d.genes;
        // 상세의 방울 줄은 열 문이 있을 때만 · 못 여는 줄을 눌러 보게 만들지 않는다.
        setDisplay(geneRow, cb.onGeneOpen !== undefined ? "block" : "none");
        setText(geneRow, `방울 ${d.genes}개 · 티어 올리기 ›`);
      }
      // ── 상시 성장 계기 둘 · **펼침 여부와 무관하게** 갱신한다(이게 이 둘의 존재 이유다).
      xpLineFill.style.width = `${Math.round(d.xp01 * 100)}%`;
      for (let c = 0; c < pipDots.length; c += 1) {
        const t = Math.max(0, Math.min(4, d.tiers[c] ?? 0));
        const dots = pipDots[c];
        if (dots === undefined) continue;
        const was = lastTiers[c] ?? -1;
        const rose = was >= 0 && t > was;
        for (let i = 0; i < dots.length; i += 1) {
          const dot = dots[i];
          if (dot === undefined) continue;
          const on = i < t;
          dot.className = `goal-pip${on ? " on" : ""}${rose && i === t - 1 ? " bump" : ""}`;
        }
        lastTiers[c] = t;
      }
      if (!open) return; // 패널이 닫혀 있으면 상세 갱신도 생략(비용 0)
      setText(stageRow, d.stage);
      setText(levelRow, `레벨 ${d.level} · 다음 카드까지 ${Math.round(d.xp01 * 100)}%`);
      xpFill.style.width = `${Math.round(d.xp01 * 100)}%`;
      setText(
        countRow,
        d.followers >= 0
          ? `내 종 ${d.mine} · 뜻을 따르는 중 ${d.followers} · 야생 ${d.wild}`
          : `내 종 ${d.mine} · 야생 ${d.wild}`,
      );
      setText(timeRow, `남은 시간 ${d.seconds}초 · ${d.night ? "밤" : "낮"}`);
    },
    setPaused: (p: boolean): void => {
      pauseBtn.textContent = p ? "▶" : "⏸";
    },
    setSpeed: (s: number): void => {
      speedBtn.textContent = `${s}x`;
    },
    collapse: (): void => setOpen(false),
    toggle: (): void => setOpen(!open),
    isOpen: () => open,
    bottomPx: () => hudBottom,
  };
}

function row(parent: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "goal-row";
  parent.appendChild(el);
  return el;
}

function panelButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "goal-btn";
  b.type = "button";
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function ensureGoalStyles(): void {
  if (document.getElementById("goal-style")) return;
  const s = document.createElement("style");
  s.id = "goal-style";
  // zoom: 데스크톱 확대(--ui-zoom)를 다른 DOM 오버레이와 같은 방식으로 받는다(panelStyles 관례).
  // 뿌리에 한 번만 걸면 안쪽(알약·상세 패널)이 함께 확대된다 · 안쪽에 또 걸면 배율이 두 번 곱해진다.
  // 드래프트 중에는 phase 게이트(main 의 visible)로 숨으므로 body.draft-open 규칙은 필요 없다.
  s.textContent = `
  .goal-root { position: fixed; top: 8px; left: 8px; right: 8px; z-index: 9; display: flex;
    flex-direction: column; gap: 6px; pointer-events: none; font-family: var(--font-body);
    zoom: var(--ui-zoom, 1); }
  /* ⚠ **stretch 가 아니다** (2026-08-10 사용자 지적: "옆의 방울 칸과 일시정지/메뉴 버튼도 길어져서
     못생겨지는 문제"). 할 일 문구가 두 줄이 되면 알약이 51 → 69px 로 커지는데, stretch 면 옆의
     방울 칸과 멈춤 버튼이 **함께 늘어나 세로로 길쭉한 직사각형**이 된다(실측).
     center 로 두면 알약만 커지고 버튼은 제 크기로 가운데 선다 — 문구 길이와 무관하게 모양이 같다. */
  .goal-head { display: flex; gap: 6px; align-items: center; }
  .goal-pill { pointer-events: auto; flex: 1; min-width: 0; text-align: left; cursor: pointer;
    position: relative; /* 경험치 밑선(goal-xpline)의 기준 상자 */
    display: flex; align-items: center; gap: 9px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 7px 12px;
    color: var(--ink); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
    transition: transform 0.07s ease, border-color 0.15s ease; }
  /* 눌리는 느낌 · 이 알약이 "버튼"임을 손끝으로도 알린다(패널 버튼과 같은 관례). */
  .goal-pill:active { transform: translateY(1px); }
  /* 펼쳐진 동안엔 테두리를 한 단계 밝혀, 아래 유리 패널이 이 알약에서 나온 것임을 잇는다. */
  .goal-pill.open { border-color: rgba(245, 235, 220, 0.30); }
  .goal-pill-body { flex: 1; min-width: 0; }
  /* ── 상시 성장 계기 둘 (2026-08-09 [사용자] 지시) ─────────────────────────────────────
     "경험치 바가 숨겨져 있어서 실시간으로 성장하는 재미를 즐기기 어렵다. 성장이라는 느낌이
      게임을 플레이하게 하는 가장 큰 원동력이자 핵심 요소다."
     둘 다 **줄을 안 늘린다** — 상시 HUD 는 목표 한 줄만이라는 2026-08-02 A안을 최대한 지키려고,
     눈금은 알약 **옆 세로 칸**에, 경험치는 알약 **밑선**에 얹었다(높이 0). */
  /* 도장 눈금 다섯 · 승급 띠와 **같은 문법**(네 칸 중 몇 칸이 찼는가)을 아주 작게. 다섯 범주가
     세로로 서서 "무엇을 얼마나 팠나"가 한눈에 · 한 칸 오르면 그 줄이 톡 튄다. */
  .goal-pips { pointer-events: none; flex: none; display: flex; flex-direction: column;
    justify-content: center; gap: 2px; padding: 0 1px; }
  .goal-pip-row { display: flex; gap: 2px; }
  .goal-pip { width: 4px; height: 4px; border-radius: 1px; background: rgba(255,255,255,0.13); }
  .goal-pip.on { background: var(--ink); opacity: 0.62; }
  @keyframes goal-pip-bump { 0%{transform:scale(0.3);opacity:0} 55%{transform:scale(1.5)} 100%{transform:scale(1);opacity:1} }
  .goal-pip.bump { animation: goal-pip-bump 460ms ease-out; }
  /* 경험치 · 알약 **아래 테두리 위**를 달리는 실선. 숫자도 글자도 없이 "다음 카드가 가까워진다"만
     곁눈으로 읽히게 한다(높이 2px · 세로 압박 0). */
  /* ⚠ 이름이 「.goal-xp」 가 아니다 — 상세 패널의 경험치 바가 그 이름을 이미 쓴다(아래 497행 근처).
     같은 이름을 두 곳에 두면 나중 규칙이 이겨 둘 중 하나가 조용히 망가진다. */
  .goal-xpline { position: absolute; left: 10px; right: 10px; bottom: 2px; height: 2px;
    border-radius: 1px; background: rgba(255,255,255,0.10); overflow: hidden; }
  .goal-xpline-fill { height: 100%; width: 0%; border-radius: 1px; background: var(--amber);
    opacity: 0.75; transition: width 0.25s ease; }
  /* 펼침 화살표 · 글씨가 아니라 CSS 로 그린 꺾쇠(∨). 접힘 ∨ / 펼침 ∧ 로 뒤집혀 지금 상태까지 말한다. */
  .goal-caret { flex: none; width: 9px; height: 9px; margin-right: 2px; opacity: 0.6;
    border-right: 2px solid currentColor; border-bottom: 2px solid currentColor;
    transform: translateY(-2px) rotate(45deg);
    transition: transform 0.18s ease, opacity 0.18s ease; }
  .goal-pill.open .goal-caret { transform: translateY(2px) rotate(-135deg); opacity: 0.95; }
  /* 아직 한 번도 안 펼쳐 봤을 때만 천천히 깜빡인다 · 글씨 안내를 늘리지 않고 시선만 부른다.
     밝기만 오르내리게 해서 자리가 움직이지 않는다(옆 글씨와 스칠 일이 없다).
     8번(약 21초 · 첫 라운드 길이보다 조금 길다)만 하고 그친다 · 끝까지 깜빡이면 그때부턴 소음이고,
     멈춘 뒤에도 화살표 자체는 그대로 남아 "여길 눌러 편다"를 계속 말한다. */
  .goal-caret.hint { animation: goal-caret-hint 2.6s ease-in-out 8; }
  @keyframes goal-caret-hint { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
  /* 첫 줄 = 할 일 + 순종 칩. 글이 늘어나는 쪽(goal-text)에 min-width:0 을 줘야 칩을 밀어내지 않고
     제 안에서 잘린다(안 주면 flex 기본 min-width:auto 라 칩이 알약 밖으로 밀려난다). */
  .goal-line { display: flex; align-items: baseline; gap: 6px; }
  /* 두 줄까지 접히고 그걸 넘기면 그때 자른다(goal-sub 와 같은 규칙). 예전엔 한 줄 ellipsis 였는데
     white-space 를 안 줘서 실제로는 **줄 수 제한 없이 늘어났다** · 긴 안내에서 알약이 계속
     커졌다(2026-08-10 사용자 지적 "그 칸도 잘려서 나오고"). 늘어나는 데 상한을 둔다.
     ⚠ 문구 자체를 한 줄에 들어오게 짧게 쓰는 것이 먼저다(main 의 goalText 참고).
     ⚠⚠ **이 블록은 템플릿 리터럴 안이다. 주석에도 백틱을 쓰지 마라** · 문자열이 거기서 끊긴다
        (방금 그렇게 깨뜨렸다). 코드 이름을 인용할 땐 따옴표나 맨글자로 적는다. */
  .goal-text { flex: 1; min-width: 0; font-family: var(--font-title); font-size: 14.5px; line-height: 1.25;
    overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .goal-follow { flex: none; font-family: var(--font-mono); font-size: 10.5px; white-space: nowrap;
    padding: 2px 6px; border-radius: 999px; background: rgba(255,255,255,0.09); opacity: 0.85; }
  /* 관문 동안 이 칩은 "생존 21/8"이 된다 · 기준에 다가갈수록 색이 세진다(숫자를 읽기 전에 먼저 보인다).
     글씨 크기를 한 단계 키워 관문에서는 이 칩이 알약에서 가장 먼저 눈에 들어오게 한다. */
  .goal-follow.warn, .goal-follow.danger { font-size: 11.5px; font-weight: 700; opacity: 1; }
  .goal-follow.warn { background: rgba(245,195,59,0.22); color: #F5C33B; }
  .goal-follow.danger { background: rgba(232,92,67,0.30); color: #FFC9BE;
    animation: goal-follow-danger 1.1s ease-in-out infinite; }
  @keyframes goal-follow-danger { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
  /* nowrap 이면 긴 안내가 "..."로 잘려 나간다(사용자 지적). 두 줄까지 접히게 두고, 그걸 넘기면
     그때만 자른다. 문구 자체를 한 줄에 들어오게 짧게 쓰는 게 먼저다(main 의 goalSub 참고). */
  .goal-sub { font-family: var(--font-mono); font-size: 11.5px; opacity: 0.75; margin-top: 2px;
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  /* 방울 카운터 · 알약과 멈춤 사이의 제 칸. flex:none 이라 알약이 대신 줄어들고, 알약 안의 글은
     min-width:0 + ellipsis 라 밀려 나가지 않는다(첫 줄 계산: goal-line 주석 참고).
     색은 티어 구입 화면과 같은 --gene(genePanel 이 :root 에 싣는다) · 두 곳에 색을 적지 않는다. */
  /* 높이를 고정한다 · .goal-head 가 center 라 알약을 안 따라간다(위 주석 참조).
     44px 은 손가락으로 누르는 최소 크기이자 짧은 알약(실측 51px)과 나란히 놓아도 안 어색한 값이다. */
  .goal-gene { pointer-events: auto; flex: none; display: flex; align-items: center; gap: 4px; padding: 0 8px;
    height: 44px; box-sizing: border-box;
    border-radius: 12px; cursor: pointer; background: var(--panel); border: 1px solid var(--line);
    color: var(--ink); font-family: var(--font-mono);
    backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
    transition: transform 0.07s ease, border-color 0.15s ease, box-shadow 0.15s ease; }
  .goal-gene:active { transform: translateY(1px); }
  /* 열 문이 아직 없으면 그냥 숫자다(누르는 척하지 않는다). */
  .goal-gene.static { pointer-events: none; cursor: default; }
  /* 지금 올릴 수 있는 범주가 하나라도 있으면 카운터가 살아난다 · 숫자를 읽기 전에 먼저 보인다. */
  .goal-gene.ready { border-color: var(--gene); box-shadow: 0 0 11px -3px var(--gene); }
  .goal-gene-num { font-size: 12.5px; font-variant-numeric: tabular-nums; }
  /* 주운 순간 한 번 튄다 · 자리는 그대로고 크기만 잠깐 커진다(옆 버튼과 스치지 않는다). */
  .goal-gene.pop { animation: goal-gene-pop 0.42s ease-out; }
  @keyframes goal-gene-pop { 0% { transform: scale(1); } 34% { transform: scale(1.16); } 100% { transform: scale(1); } }
  /* 상세 패널의 방울 줄 · 왼쪽 띠만 방울 색으로 물들여 위 카운터와 같은 것임을 잇는다. */
  .goal-generow { width: 100%; box-sizing: border-box; text-align: left; margin-top: 2px;
    padding: 8px 10px; border-radius: 9px; cursor: pointer; background: rgba(18,13,9,0.55);
    border: 1px solid var(--line); border-left: 3px solid var(--gene); color: var(--ink);
    font-family: var(--font-body); font-size: 12.5px; text-shadow: inherit;
    transition: transform 0.07s ease, background 0.12s ease; }
  .goal-generow:active { transform: translateY(1px); background: rgba(255,255,255,0.10); }
  .goal-pause { pointer-events: auto; width: 44px; height: 44px; box-sizing: border-box;
    border-radius: 12px; cursor: pointer;
    background: var(--panel); border: 1px solid var(--line); color: var(--ink); font-size: 15px;
    backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); flex: none;
    transition: transform 0.07s ease; }
  .goal-pause:active { transform: translateY(1px); }
  /* 상세 패널 · 뒤의 월드가 비쳐 보이는 유리. 배경만 옅게 하면 밝은 지형 위에서 글씨가 묻히므로
     backdrop 자체를 어둡게 눌러 깔고(brightness) 글씨에 그림자를 준다. blur 는 폰 부담을 생각해
     작게(7px) 잡는다. 알약과 같은 뿌리의 아래 칸이라 위치를 따로 계산하지 않는다(겹칠 수 없다). */
  .goal-panel { display: none; flex-direction: column; align-self: flex-start; gap: 7px;
    width: min(300px, 100%); box-sizing: border-box; padding: 12px; border-radius: 12px;
    background: linear-gradient(180deg, rgba(34,26,19,0.44), rgba(24,18,13,0.38));
    border: 1px solid var(--line); color: var(--ink); text-shadow: 0 1px 3px rgba(0,0,0,0.9);
    backdrop-filter: blur(7px) brightness(0.68) saturate(1.05);
    -webkit-backdrop-filter: blur(7px) brightness(0.68) saturate(1.05);
    box-shadow: 0 10px 26px -14px rgba(0,0,0,0.8);
    font-family: var(--font-mono); font-size: 12.5px; pointer-events: auto; }
  /* backdrop-filter 를 못 쓰는 기기(옛 안드로이드 웹뷰 등)에서는 뒤를 어둡게 눌러 줄 수단이 없다
     → 거의 불투명한 배경으로 되돌린다. 반투명보다 읽히는 게 먼저다. */
  @supports not ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
    .goal-panel { background: rgba(26,20,14,0.94); }
  }
  /* 투명 효과를 줄이도록 설정한 사용자에게는 불투명하게(접근성 설정 존중). */
  @media (prefers-reduced-transparency: reduce) {
    .goal-panel { background: rgba(26,20,14,0.95);
      backdrop-filter: none; -webkit-backdrop-filter: none; }
  }
  .goal-row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* 유리 위에서는 흰 반투명 트랙이 배경에 묻힌다 → 어두운 트랙으로 바꿔 연두 막대가 뜨게 한다. */
  .goal-xp { height: 5px; border-radius: 999px; background: rgba(10,8,5,0.5); overflow: hidden; }
  .goal-xp-fill { height: 100%; border-radius: 999px; background: var(--lime); width: 0%; }
  .goal-btnrow { display: flex; gap: 6px; margin-top: 2px; }
  /* 버튼도 배경이 흰 반투명이면 유리 위에서 사라진다 → 어둡게 깔아 "누를 것"으로 남긴다. */
  .goal-btn { flex: 1; padding: 7px 0; border-radius: 9px; cursor: pointer; background: rgba(18,13,9,0.55);
    border: 1px solid var(--line); color: var(--ink); font-family: var(--font-body); font-size: 12.5px;
    text-shadow: inherit; transition: transform 0.07s ease, background 0.12s ease; }
  .goal-btn:active { transform: translateY(1px); background: rgba(143, 209, 79, 0.28); }
  /* 움직임을 줄이도록 설정한 사용자 · 깜빡임·전환을 멈추고 상태(방향)만 남긴다. */
  @media (prefers-reduced-motion: reduce) {
    .goal-caret { transition: none; }
    .goal-caret.hint { animation: none; opacity: 0.85; }
    .goal-pill, .goal-pause, .goal-btn, .goal-gene, .goal-generow { transition: none; }
    /* 주웠다는 사실은 숫자가 이미 말한다 · 움직임만 뺀다(테두리 발광은 그대로 남는다). */
    .goal-gene.pop { animation: none; }
    /* 깜빡임을 멈춰도 색은 남는다 — 경고는 움직임이 아니라 색으로도 읽혀야 한다. */
    .goal-follow.danger { animation: none; }
  }
  `;
  document.head.appendChild(s);
}
