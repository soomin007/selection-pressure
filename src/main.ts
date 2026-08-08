// 부트스트랩. PixiJS v8 앱 + scale-to-fit 뷰포트 + 게임 상태기계 + 셸 UI(로비/멈춤/배속).
//
// 코어 시뮬은 동일. 모바일(세로)/데스크톱(가로)은 논리 해상도와 UI 만 다르다(chooseLayout).
// 월드는 스케일 컨테이너(root)에, HUD/UI 는 화면 픽셀 그대로(선명).

import { Application, Container, Graphics } from "pixi.js";
import { chooseLayout, COLORS, uiScale } from "@/config";
import { DEBUG, DEBUG_ACTIVE, TUNE, debugLabel } from "@/debug";
import { setupViewport } from "@/render/viewport";
import { WorldView } from "@/render/worldView";
import { createGoalBar, survivalChip } from "@/ui/goalBar";
import { Game, type ExtinctionType, type TrialKind, type TrialVerdict } from "@/game/game";
import { GAME } from "@/game/config";
import { BOSS_TYPES, bossName, type BossType } from "@/sim/boss";
import { createDraftPanel } from "@/ui/draftPanel";
import { createPresetPanel } from "@/ui/presetPanel";
import { createResultPanel } from "@/ui/resultPanel";
import { createRunReportScreen } from "@/ui/runReportScreen";
import { createMomentOverlay } from "@/ui/momentOverlay";
import { createLevelUpScreen } from "@/ui/levelUpScreen";
import { createLobby } from "@/ui/lobby";
import { createUnlockLadder } from "@/ui/unlockLadder";
import { createControls } from "@/ui/controls";
import { registerKeyLayer } from "@/ui/keys";
import { createBuildPanel } from "@/ui/buildPanel";
import { createGenePanel, type GeneShop } from "@/ui/genePanel";
import { createGlossary } from "@/ui/glossary";
import { ACHIEVEMENTS, equippedCosmetic, mythicNamesUnlocked } from "@/game/achievements";
import { setMythicNames } from "@/ui/creatureName";
import { describeSpecies } from "@/game/runReport";
import { Highlights } from "@/render/highlights";
import { Effects } from "@/render/effects";
import { Minimap } from "@/render/minimap";
import { ThreatBanner } from "@/render/threatBanner";
import { publishPixiTextRects } from "@/render/pixiTextRects";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  TIER_ROMAN,
  pipsToNext,
  tierLine,
  tierOf,
  type Category,
} from "@/sim/tiers";
import type { Genome } from "@/sim/genome";
import { ORDER_SPEC_BY_KIND, type OrderKind } from "@/sim/herdOrder";
import { CommandWheel, OrderLine } from "@/ui/commandWheel";
import { isPredatorBoss, bossRaidable } from "@/sim/boss";
import { ORDER } from "@/sim/params";
import { leadCapsOf } from "@/render/leadVision";

// 맵 배율은 src/config.ts 의 MAP_SCALE 이 단일 근원 · main 은 이제 그 값을 직접 읽지 않는다.
// Game 이 시대별 배율 mapScale(era)(src/game/config.ts · MAP_SCALE 파생)로 월드 치수를 만들고,
// 측정 도구(boss.test.ts·balance-probe.mjs)도 같은 근원을 읽는다(복사본 금지, 2026-08-04 사고).

// --- 무리 지시(기본 모드) 전용 화면 상수. 밸런스가 아니라 카메라·안내 표시에만 쓰인다. ---
const LEAD_CAM_EASE = 9; // 지시 모드 카메라 이징(기본 3.5 는 시상수 286ms 라 물먹은 느낌의 주범)
const LEAD_BANNER_DELAY_MS = 3000; // "아무도 안 따라옵니다" 안내까지의 유예(바로 띄우면 잔소리)
const PEEK_RETURN_MS = 1500; // 훔쳐보기(드래그·미니맵·2손가락 팬) 입력이 끝나고 무리로 복귀까지의 시간
const ORDER_DENY_MS = 1800; // 갈 수 없는 곳을 탭했을 때 목표 줄에 그 사실을 남겨 두는 시간
const ORDER_ARRIVED_PAD = 60; // 무리 도착 표시 여유(무리는 한 점에 겹치지 않는다) · 기준 반경(무리 단위 arriveRadius)은 sim 상수 공유

async function boot(): Promise<void> {
  const layout = chooseLayout();
  document.body.dataset.layout = layout.isDesktop ? "desktop" : "mobile";

  const app = new Application();
  await app.init({
    resizeTo: window, // 창 실제 픽셀로 렌더 → 선명
    background: COLORS.bg,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const mount = document.getElementById("app");
  if (!mount) throw new Error("#app 마운트 지점을 찾을 수 없습니다.");
  mount.appendChild(app.canvas);

  // 월드는 비율 맞춰 스케일·중앙배치. HUD 는 스케일 밖(화면 픽셀)이라 글자가 선명. logical(=layout)을 참조로
  // 넘겨 fit() 이 매번 최신 논리 크기를 읽는다 — 아래 relayout 이 화면 비율에 맞춰 갱신하면 레터박스가 안 남는다.
  const root = new Container();
  app.stage.addChild(root);
  const viewport = setupViewport(app, root, layout);

  const view = new WorldView(app.renderer);
  const effects = new Effects();
  view.container.addChild(effects.container); // 사건 연출(월드 좌표 → 카메라와 함께 움직임)
  // 상시 HUD 는 목표 한 줄(goalBar)뿐이다(2026-08-02 갈아엎기, 사용자 A안). 옛 상태 바·타임라인·
  // 칩은 goalBar 의 접이식 패널로 흡수됐고, goalBar 자체는 콜백(멈춤·배속)이 준비된 뒤에 만든다.
  let traitsOpen = false;
  const highlights = new Highlights();
  root.addChild(view.container);
  // 월드를 논리 사각형으로 클리핑 — 가장자리 생물이 화면 밖으로 삐져나오지 않게.
  const worldMask = new Graphics().rect(0, 0, layout.width, layout.height).fill(0xffffff);
  root.addChild(worldMask);
  view.container.mask = worldMask;

  // 화면 리사이즈(모바일 주소창 접힘/펴짐 등) 때 논리 크기를 현재 화면 비율에 맞춰 갱신한다 → 레터박스(검은 띠)
  // 없이 꽉 채운다. 월드(game.*)는 부팅 크기 그대로 두고 뷰포트(layout.*)만 반응한다 — 카메라(setCamera)가 매
  // 프레임 뷰포트 크기를 인자로 받으므로, 논리 높이만 바꾸면 카메라가 화면 비율에 맞는 창을 보여준다(월드 재생성 X).
  // (부팅 때 한 번만 잡던 게 원인: 주소창이 사라지며 화면이 길어지면 낡은 비율이라 위아래 띠가 생겼다.)
  const relayout = (): void => {
    const sw = app.screen.width;
    const sh = app.screen.height;
    if (sw <= 0 || sh <= 0) return;
    if (layout.isDesktop) layout.width = Math.max(1, Math.round(layout.height * (sw / sh)));
    else layout.height = Math.max(1, Math.round(layout.width * (sh / sw)));
    worldMask.clear().rect(0, 0, layout.width, layout.height).fill(0xffffff);
    viewport.fit();
  };
  app.renderer.on("resize", relayout);
  app.stage.addChild(highlights.container);
  const minimap = new Minimap(); // 큰 맵 조망 — 화면 픽셀 좌표(카메라 변환 밖, 모서리 고정)
  app.stage.addChild(minimap.container);
  const threatBanner = new ThreatBanner(); // 위협 예고 전광판(그 순간에만 뜬다)
  app.stage.addChild(threatBanner.container);
  // 격퇴 체력 바는 이제 화면 상단 글로벌 위젯이 아니라 worldView 가 보스 몸 위에 그린다(HUD 갈아엎기).
  // 데스크톱 UI 확대 — 폰 기준 크기의 글자·패널이 큰 모니터에서 너무 작다(사용자 지적). 창 높이에 비례한
  // 배율(uiScale)을 DOM 오버레이엔 CSS zoom(--ui-zoom, panelStyles)으로, 화면 픽셀 Pixi UI(미니맵·하이라이트·
  // 위협 전광판·보스 바)엔 컨테이너 스케일로 똑같이 먹인다. update 호출부는 화면 크기를 배율로 나눠
  // "논리 화면"을 넘긴다 → 중앙·모서리 배치가 그대로 맞는다.
  let uiZoom = 1;
  const applyUiScale = (): void => {
    uiZoom = uiScale(layout.isDesktop, app.screen.width, app.screen.height);
    document.documentElement.style.setProperty("--ui-zoom", uiZoom.toFixed(3));
    minimap.setUiScale(uiZoom);
    highlights.setUiScale(uiZoom);
    threatBanner.setUiScale(uiZoom);
  };
  applyUiScale();
  app.renderer.on("resize", applyUiScale);

  // 소수 개체 게임: main 은 화면(논리 해상도) 치수만 넘긴다. 월드 치수는 Game 이 시대별 배율
  // mapScale(era) 로 매 시대 파생한다(치수 = 화면 × 배율 · 먹이 밀도·상한은 면적 비례라 큰 맵일수록
  // 개체당 먹이가 넉넉해 굶지 않는다). 카메라가 한 무리를 따라다닌다.
  const game = new Game(layout.width, layout.height);

  // 디버그: URL 에 ?seed=… 가 있으면 그 시드로 고정(맵·카드·보스 완전 재현). 없으면 런마다 랜덤.
  const seedParam = new URLSearchParams(window.location.search).get("seed");
  if (seedParam) game.fixedSeed = seedParam;

  // 무리 지시(기본값) · URL·DOM 은 여기까지만 읽고, sim 에는 불리언 하나만 넘어간다.
  // ?watch 로 끄면 game.leadEnabled 가 false 라 world.lead.leaderId 가 영영 -1 이고, 아래 조종 코드는
  // 전부 첫 줄에서 빠진다 = 조작 없는 예전 관전 세계와 문자 그대로 동일하게 돈다(밸런스 비교용).
  const leadMode = DEBUG.leadControl;
  game.leadEnabled = leadMode;
  // ?follow=<수> 로 "무리가 얼마나 따라오는가"를 배포 없이 폰에서 바로 바꿔 본다. 안 붙이면 NaN 이라
  // sim 기본값(LEAD.followCohesion)을 그대로 쓴다.
  if (leadMode && Number.isFinite(TUNE.leadFollow)) game.leadFollowWeight = TUNE.leadFollow;

  // 훔쳐보기 카메라 — 드래그·미니맵·2손가락 팬으로 잠깐 다른 곳을 본다. 입력이 끝나고
  // PEEK_RETURN_MS 지나면 무리에게 자동 복귀한다(카메라의 기본은 주 무리를 담는 것이다).
  let manualCam: { x: number; y: number } | null = null;
  let peekIdleMs = 0; // 마지막 훔쳐보기 입력 이후 지난 시간(ms) — 입력이 이어지는 동안 0 으로 되돌린다
  minimap.onPan = (wx, wy) => {
    manualCam = { x: wx, y: wy };
    peekIdleMs = 0;
  };

  const buildPanel = createBuildPanel();
  const refreshBuild = (): void => {
    buildPanel.setData({
      headline: describeSpecies(game.genome),
      genome: game.genome, // v8 — 패널이 도장·열쇠·유지비를 게놈에서 직접 읽는다
      cards: game.pickedCardNames,
    });
  };
  refreshBuild();

  const glossary = createGlossary(); // 용어 사전(로비·일시정지에서 열기)
  // 대백과(z-index 40)가 열려 있는 동안 아래 화면(로비의 Enter 등)이 키를 받지 않게 막는다.
  // glossary 는 열림 상태를 노출하지 않으므로 DOM 으로 우회한다 — createGlossary 는 마지막에
  // 스크림(전체 덮개)을 body 에 붙이므로, 호출 직후 body 의 마지막 자식이 그 스크림이다.
  const glossaryScrim = document.body.lastElementChild as HTMLElement;
  registerKeyLayer(
    40,
    () => glossaryScrim.style.display === "flex",
    (e) => {
      if (e.code === "Escape" || e.code === "Enter" || e.code === "NumpadEnter") {
        glossary.hide();
        return true;
      }
      return false;
    },
  );

  // **막 오른 티어 승급 연출을 몰아서 내보낸다**(반드시 카드창이 닫힌 뒤에 부를 것 — 떠 있는 동안
  // 띄우면 카드 뒤에 가려 아무도 못 본다). 여럿이면 차례로 보여준다(하나만 띄우고 나머지를 삼키면
  // 무엇이 열렸는지 영영 모른다). 내보낸 수를 돌려준다.
  const playTierUps = (): number => {
    const ups = game.takeNewTiers();
    ups.forEach((up, k) => {
      const line = tierLine(up.cat, up.tier, game.genome.keys);
      const title = `${CATEGORY_LABELS[up.cat]} ${TIER_ROMAN[up.tier]}`;
      if (k === 0) moment.apex(title, up.tier, line.gain);
      else window.setTimeout(() => moment.apex(title, up.tier, line.gain), k * 2300);
    });
    return ups.length;
  };

  // ── 티어 구입 화면(방울) ───────────────────────────────────────────────────────
  // **새 제스처를 만들지 않았다.** 월드 조작은 이미 꽉 차 있다(탭=가라 · 더블탭=피해라 · 길게
  // 누르기=명령 휠 · 명령 줄 탭=철회) · 여기에 하나를 더 얹으면 그때부터 오작동이 규칙이 된다.
  // 그래서 문은 전부 **이미 있는 HUD 손잡이**다:
  //   ① 목표 줄 알약 옆의 방울 카운터(상시로 떠 있고, 살 수 있으면 테두리가 켜진다)
  //   ② 알약을 펼쳤을 때 나오는 「방울 N개 · 티어 올리기 ›」 줄
  // 둘 다 goalBar 의 `onGeneOpen` 하나로 들어온다(아래 createGoalBar). 화면 안에 손잡이가 보이므로
  // 숨은 단축키를 따로 두지 않았다 · 안 보이는 키는 이 프로젝트의 「화면에서 알아채게」 규칙에 어긋난다.
  //
  // ⚠ `game` 을 그대로 넘기지 않고 **감싼다.** `Game.buyTier` 는 승급을 「꺼내 가는 큐」
  //   (`takeNewTiers`)에 싣는데, 산 자리에서 안 꺼내면 다음 카드창을 닫을 때 몰아서 터진다
  //   (2026-08-07 프리셋 승급이 정확히 그렇게 샜다). 여기서 산 즉시 꺼내 연출까지 내보낸다.
  const geneShop: GeneShop = {
    get geneBank(): number {
      return game.geneBank;
    },
    get genome(): Genome {
      return game.genome;
    },
    tierCost: (cat: Category): number => game.tierCost(cat),
    canBuyTier: (cat: Category): boolean => game.canBuyTier(cat),
    buyTier: (cat: Category): boolean => {
      if (!game.buyTier(cat)) return false;
      refreshBuild(); // 설계도(내 형질)에 방금 오른 단을 반영
      // 승급 연출(moment.apex)은 전체 화면 z18 이라 이 패널(z16)을 2.2초 동안 통째로 덮는다.
      // 덮인 채로 두면 "닫힌 건지 멈춘 건지" 모를 화면이 되므로 먼저 접고 연출을 내보낸다.
      // 다시 사려면 알약 옆 카운터를 한 번 더 누르면 된다(문이 상시로 떠 있다).
      genePanel.close();
      playTierUps();
      // 세대별 형질과 같은 처리 · 텍스처를 새로 만들지 않는다(이미 태어난 개체는 옛 모습을 유지하고
      // 이후 태어난 개체가 새 게놈 서명으로 생성된다 · 카드를 골랐을 때와 같다).
      return true;
    },
  };
  const genePanel = createGenePanel(geneShop);

  const draft = createDraftPanel(app.renderer, app.canvas, {
    onPick: (i) => {
      // 고르기 **전** 게놈을 떠 둔다 — 아래에서 "무엇이 얼마나 세졌는지"를 실제 차이로 말하기 위해서다.
      // 카드에 적힌 수치가 아니라 게놈의 전후 차이를 쓰는 이유: 감쇠·정점 고정·클램프가 걸리면 카드
      // 숫자와 실제가 다르다(그 차이를 화면이 감추면 그게 거짓말이다).
      const beforePips = { ...game.pipsNow };
      game.pickCard(i);
      refreshBuild(); // 방금 고른 카드를 빌드 패널(설계도=최신 게놈)에 반영
      // 세대별 형질: 텍스처를 새로 만들지 않는다 — 이미 태어난 개체는 옛 모습을 유지하고, 이후 태어난
      // 개체가 새 게놈 서명으로 lazy 생성된다(worldView.textureFor). refreshSpecies(전체 교체)는 안 부른다.
      // ⚠ **한 라운드에 레벨이 두 번 오르면** pickCard 가 동기로 다음 카드창을 연다(onDraft → draft.show).
      // 그때 아래 hide() 를 부르면 방금 연 카드창이 사라지고, phase 는 "draft" 라 시뮬이 영영 멈춘다
      // (2026-08-07 실기 제보: 카드를 고르자 월드로 돌아왔는데 다들 멈춰 있었다). 창이 다시 열렸으면
      // 그대로 두고, 승급 연출은 마지막 장까지 고른 뒤 몰아서 내보낸다(newTiers 큐가 모아 둔다).
      if (game.phase === "draft") return;
      draft.hide();
      const upCount = playTierUps();
      // **고른 직후 무엇이 얼마나 세졌는가.** 티어가 안 오른 판에서도 도장은 쌓였으니, 다음 문턱까지
      // 몇 개 남았는지를 그 자리에서 말한다("저축했다"가 손해로 읽히지 않게).
      // 승급 연출이 나가는 판에는 생략한다 — 그쪽이 훨씬 큰 소식이고, 겹치면 서로 덮는다.
      if (upCount === 0) {
        const line = savingLine(beforePips, game.pipsNow);
        if (line) highlights.flash(line, 0x8fd14f);
      }
    },
    onSkip: () => {
      // 스킵 — 형질 대신 새끼 몇 마리를 낳고 관전으로 복귀.
      game.skipDraft();
      refreshBuild();
      // 연속 레벨업의 다음 카드창이 이미 떠 있으면 그대로 둔다(onPick 과 같은 유령 드래프트 함정).
      if (game.phase === "draft") return;
      draft.hide();
      // 스킵으로 사슬이 끝나도 앞 장들이 올린 승급 연출은 여기서 내보낸다 — 안 그러면 큐가 다음
      // 드래프트까지 새어 엉뚱한 순간에 터진다(프리셋 알림 누수와 같은 함정).
      playTierUps();
    },
    onReroll: () => {
      // 다시 뽑기 — 카드를 새로 뽑는다(game.reroll 이 onDraft 를 다시 불러 패널이 새 카드로 갱신된다).
      game.reroll();
      refreshBuild();
    },
  });
  // 시작 프리셋은 캐릭터 선택 창으로(외형 미리보기 + 화살표로 페이지 넘기며 선택).
  const presetPanel = createPresetPanel(app.renderer, (i) => {
    game.pickCard(i);
    refreshBuild();
    presetPanel.hide();
  });
  // 런 보고서(연대기 + 형질 추이) — 결과 화면 위에 뜨는 별도 화면. 닫으면 결과 화면으로 돌아간다.
  const reportScreen = createRunReportScreen(() => reportScreen.hide());
  // 도전 과제로 연 꾸밈을 렌더·이름에 반영한다. 효과는 없다(보이는 것만 바뀐다).
  // (결과 패널·로비가 콜백으로 받으므로 그 생성보다 먼저 선언한다 — 아래에서 참조 시 TDZ 방지, known_issues.)
  const applyCosmetics = (): void => {
    view.playerCosmetic = equippedCosmetic();
    setMythicNames(mythicNamesUnlocked());
  };
  applyCosmetics();
  // 해금 사다리 — 로비·결과 화면에서 여는 열람 오버레이(레벨별로 무엇이 열리는지 한자리에서 본다).
  const unlockLadder = createUnlockLadder(() => unlockLadder.hide());
  const result = createResultPanel(
    () => {
      // 새 종으로 다시 시작(완전 리셋). 그동안 바꾼 꾸밈을 이번 판부터 적용.
      reportScreen.hide();
      result.hide();
      applyCosmetics();
      tapHintShown = false; // 새 런 = 탭 안내 다시 1회(선언은 위쪽 상태 블록 — 클릭 시점 실행이라 TDZ 무관)
      emberHintShown = false; // 불씨 첫 안내도 다시 1회
      emberHintMs = 0;
      game.beginRun();
      refreshBuild();
      view.refreshSpecies(game.world);
      controls.setVisible(true);
    },
    () => {
      // 승리 후 "다음 시대로" — 성장 유지, 위협 강화. 새 월드는 continueToNextEra 가 만든다. 꾸밈도 반영(시각만).
      reportScreen.hide();
      result.hide();
      applyCosmetics();
      // 시대가 올라도 화면이 그대로면 "세계가 험해졌다"가 어디에서도 안 읽힌다 → 전환하기 전에 짧게 한 번
      // 못박는다(무엇이 늘고 무엇이 열리는지). 문구는 game 이 실제 적용 함수에서 뽑는다(화면=실제).
      // ⚠ 연출이 끝난 **뒤에** 전환한다 · 먼저 전환하면 곧장 뜨는 시대 보상 드래프트가 이 화면을 덮는다.
      const brief = game.nextEraBriefing();
      const go = (): void => {
        game.continueToNextEra();
        refreshBuild();
        controls.setVisible(true);
      };
      if (brief) moment.era(brief.title, brief.lines, go);
      else go();
    },
    () => reportScreen.show(game.runHistory), // "이 혈통의 기록 보기"
    applyCosmetics, // 결과 화면에서 꾸밈을 바꾸면 즉시 반영(다음 런에 그대로 적용)
    () => unlockLadder.show(), // 해금 사다리 열기
  );
  const lobby = createLobby(
    () => {
      lobby.hide();
      applyCosmetics(); // 방금 딴 꾸밈을 이번 판부터 적용
      tapHintShown = false; // 새 런 = 탭 안내 다시 1회
      emberHintShown = false; // 불씨 첫 안내도 다시 1회
      emberHintMs = 0;
      game.beginRun();
      refreshBuild();
      view.refreshSpecies(game.world);
      controls.setVisible(true);
    },
    () => glossary.show(),
    applyCosmetics, // 로비에서 꾸밈을 바꾸면 배경 생태계에 즉시 반영
    () => unlockLadder.show(), // 로비에서 해금 사다리 열기
    () => {
      // 저장 데이터 전부 지우기(로비에서 두 번 눌러야 실행된다). 지운 결과가 지금 화면에도 바로
      // 보이게 꾸밈과 배경 생태계를 다시 읽는다.
      game.resetSavedProgress();
      applyCosmetics();
      view.refreshSpecies(game.world);
    },
  );
  // 버튼(controls)과 키보드(아래 관전 키 레이어)가 같은 콜백을 쓰도록 이름을 붙여 둔다.
  const controlsCb = {
    onPauseToggle: (): void => {
      game.paused = !game.paused;
      controls.setPaused(game.paused);
      goalBar.setPaused(game.paused);
    },
    onSpeedCycle: (): void => {
      game.speed = game.speed >= 3 ? 1 : game.speed + 1;
      controls.setSpeed(game.speed);
      goalBar.setSpeed(game.speed);
    },
    onResume: (): void => {
      game.paused = false;
      controls.setPaused(false);
      goalBar.setPaused(false);
    },
    onRestart: (): void => {
      game.paused = false;
      controls.setPaused(false);
      goalBar.setPaused(false);
      tapHintShown = false; // 새 런 = 탭 안내 다시 1회
      emberHintShown = false; // 불씨 첫 안내도 다시 1회
      emberHintMs = 0;
      game.beginRun();
      view.refreshSpecies(game.world);
    },
    onLobby: (): void => {
      game.paused = false;
      controls.setPaused(false);
      goalBar.setPaused(false);
      controls.setVisible(false);
      game.toLobby();
      lobby.show();
    },
    onGlossary: (): void => glossary.show(),
  };
  // 우상단 배속·멈춤 바는 goalBar 가 대신한다(bar:false) — controls 는 멈춤 메뉴(전체 덮개)만 남는다.
  const controls = createControls(controlsCb, { bar: false });
  // 목표 한 줄 — 화면에 상시로 남는 유일한 HUD. 멈춤·배속·형질 패널·대백과가 전부 여기로 들어온다.
  const goalBar = createGoalBar({
    onPauseToggle: (): void => controlsCb.onPauseToggle(),
    onSpeedCycle: (): void => controlsCb.onSpeedCycle(),
    onTraitsToggle: (): void => {
      traitsOpen = !traitsOpen;
    },
    onGlossary: (): void => glossary.show(),
    // 방울 카운터(알약 옆) · 상세의 「티어 올리기」 줄 · 둘 다 이 문으로 들어온다.
    onGeneOpen: (): void => genePanel.open(),
  });

  game.onDraft = (cards, preview) => {
    // 시작 프리셋 선택은 캐릭터 선택 창, 레벨업 형질은 일반 카드 창.
    // 드래프트 화면은 게임 객체를 모른다 — 그릴 때 필요한 종 상태만 넘긴다(레벨 = 세대).
    // 시작 종을 고르는 화면엔 "이번 세계"(대륙·판게아·군도·대양 + 바다 비율)를 함께 띄운다 —
    // 세계를 보고 종을 고르는 게 이 게임이라, 모르고 고르면 선택이 아니라 운이 된다.
    // 카드창은 전체 화면(z 15)인데 티어 구입 화면은 그 위(z 16)다 → 열린 채로 두면 카드를 덮는다.
    genePanel.close();
    if (game.isChoosingPreset) presetPanel.show(cards, preview, game.worldBriefing());
    else
      draft.show(cards, {
        level: game.level,
        genome: game.genome,
        speciesColor: game.world.playerSpecies.color,
        speciesName: describeSpecies(game.genome),
        population: game.world.playerPopulation,
        pickedCardNames: game.pickedCardNames,
        canReroll: game.canReroll,
        forecast: draftForecast(),
        notice: game.draftNotice,
        // 다음 관문이 때려서 물리칠 수 있는 보스면 그 이름. 카드가 "고르면 맞설 수 있는가"를
        // 그 자리에서 말한다(형질을 키울 이유는 고르는 순간에 보여야 한다).
        raidBoss: game.upcomingRaidBoss,
        // 판정 직후에 열린 카드창이면 제목 자리에 판정을 싣는다(플래시는 이 창에 가려 안 보인다).
        verdict: game.lastVerdict
          ? { text: verdictLine(game.lastVerdict), passed: game.lastVerdict.passed }
          : null,
      });
  };
  /** 드래프트 예고 줄: 진행 중 라운드의 시험(레벨업) 또는 곧 시작할 단계의 시험(시대 보상).
   *  시대 보상 쪽은 game 이 얼려 둔 확정 시험이라(예고=실물) 그대로 시작된다. 라운드 전이라 진행 숫자만 뺀다. */
  function draftForecast(): string {
    const t = game.trial;
    if (t) return `이번 시험: ${t.label} (${Math.min(game.trialProgress, t.target)}/${t.target})`;
    const nt = game.upcomingTrial;
    return nt ? `다음 시험: ${nt.label}` : "";
  }
  // 라운드 시험 판정 플래시: 합격은 라임, 불합격은 호박에 이유(진행/목표)와 대가(불씨)를 한 줄로.
  const TRIAL_WORD: Record<TrialKind, string> = {
    hunt: "사냥",
    feed: "먹이",
    birth: "새끼",
    pop: "무리",
    hold: "자리 지키기",
    mark: "표시된 것 사냥",
  };
  // priority=true: 같은 프레임에 다음 단계(보스) 등장 플래시가 이어져도 판정이 덮이지 않고 끝까지 보인다.
  /** 판정 한 줄 · 화면 플래시와 카드창 제목이 **같은 문구**를 쓴다(둘이 갈리면 화면이 거짓말한다). */
  function verdictLine(v: TrialVerdict): string {
    return v.passed
      ? `시험 합격 · ${v.trial.label}`
      : `시험 불합격 · ${TRIAL_WORD[v.trial.kind]} ${Math.min(v.progress, v.trial.target)}/${v.trial.target} · 불씨 하나가 꺼졌습니다`;
  }
  game.onTrialVerdict = (v) => {
    highlights.flash(verdictLine(v), v.passed ? 0x8fd14f : 0xffba3a, true);
  };
  // 승리·정복·멸종 순간 연출 — 결과 패널 직전에 전역 화면 클라이맥스를 얹는다.
  const moment = createMomentOverlay();
  // 런 종료 진척도 화면 — 순간 연출 다음, 결과(사망 원인) 화면 직전에 경험치바·레벨업·해금을 보여준다.
  const levelScreen = createLevelUpScreen();
  game.onResult = (res, summary, canContinue, progress, achievements) => {
    controls.setVisible(false);
    genePanel.close(); // 런이 끝났다 · 결과·진척도 화면 아래에 구입 화면이 남지 않게
    // 정복 = 마지막 시대 승리(더 이어갈 수 없음), 승리 = 한 시대 넘김(이어감), 멸종 = 패배.
    const kind = res === "lose" ? "lose" : canContinue ? "win" : "conquest";
    const showResult = (): void => {
      // 순간 연출(멸종 비네트·"멸종" 글자 등)을 걷어낸 뒤 결과 화면 → 월드를 정상 밝기로 보여주고,
      // 결과 패널 제목의 "멸종"과 순간 연출 글자가 겹쳐 두 번 보이던 문제를 없앤다.
      moment.clear();
      // 불씨 소진 패배는 제목·큰 글자를 "불씨 꺼짐"으로 나눈다. 개체가 살아 있는데 "멸종"은 거짓이다.
      result.show(res === "win", summary, canContinue, game.lostByEmbers ? "불씨 꺼짐" : undefined);
    };
    moment.play(kind, () => {
      // 런이 진짜 끝났으면(progress 있음) 진척도 화면을 먼저, 그 뒤 결과 화면. 중간 시대 승리(이어감)면 바로 결과.
      // 진척도(런 종료) 또는 새 도전 과제가 있으면 종료 화면을 거친다. 중간 시대 승리는 progress 가 없지만
      // "정점 등극" 같은 과제는 거기서 열리므로 과제만 있어도 화면을 띄운다.
      if (progress || achievements.length > 0) levelScreen.play(progress, achievements, showResult);
      else showResult();
    }, game.lostByEmbers ? "불씨 꺼짐" : undefined);
  };
  // 카메라 상태 — onWorldChanged 가 game.start()에서 곧장 호출돼 camX/camY 를 스냅하므로, 그 콜백보다
  // 반드시 먼저 선언한다. (전엔 아래쪽에 뒀다가 TDZ ReferenceError 로 부팅이 통째로 죽었다 — known_issues.)
  let camX = game.width / 2;
  let camY = game.height / 2;
  let camZoom = 1;
  // 사용자 줌 배율 — 자동/수동 시점 무관하게 모든 모드의 목표 줌에 곱한다(버튼·휠·핀치로 조절).
  let userZoom = 1;
  // 줌아웃 하한은 절대값이 아니라 **맵이 화면을 꽉 채우는 배율**이다 — 그보다 물러나면 맵 바깥의
  // 검은 빈 공간이 보인다(2026-08-07 실기 제보: 첫 시대는 맵=화면 크기라 줌아웃이 아예 안 되는 게
  // 맞는데 검은 바깥으로 빠졌다). 맵은 시대마다 커지므로(mapScale) 하한은 저절로 내려가고,
  // 0.5 는 거대한 후반 맵에서도 너무 멀어지지 않게 막는 바닥이다.
  const minUserZoom = (): number =>
    Math.max(0.5, layout.width / game.width, layout.height / game.height);
  const clampUserZoom = (z: number): number => Math.max(minUserZoom(), Math.min(3.5, z));
  // 무리 지시 표시 상태 · onWorldChanged 가 game.start()에서 곧장 불려 이 값들을 초기화하므로,
  // 그 콜백보다 반드시 먼저 선언한다(아래쪽에 두면 TDZ ReferenceError 로 부팅이 죽는다 — known_issues).
  let leadZeroMs = 0; // 아무도 안 따라오는 상태가 이어진 시간(ms)
  let leadZeroShown = false; // 그 안내를 이번 월드에서 이미 띄웠나(한 번만)
  let denyMs = 0; // "그곳으로는 갈 수 없습니다"를 목표 줄에 남겨 둘 남은 시간(ms)
  let tapHintShown = false; // "탭 = 명령" 안내(런당 1회) 표시 여부
  let emberHintShown = false; // "불씨 = 남은 기회" 첫 안내(런당 1회) 표시 여부
  let emberHintMs = 0; // 관전 진입 후 그 안내까지의 대기 시간(탭 안내 플래시를 덮지 않게 늦춘다)

  game.onWorldChanged = (world) => {
    view.drawEnvironment(world);
    view.refreshSpecies(world);
    goalBar.collapse(); // 새 월드 = 상세 패널 접기(낡은 수치가 열린 채 남지 않게)
    genePanel.close(); // 같은 이유 · 새 세계로 넘어가는데 구입 화면이 떠 있으면 안 된다
    effects.clear();
    moment.clear(); // 멸종 암전 등 남은 순간 연출을 지운다(새 월드 시작).
    levelScreen.clear(); // 진척도 화면도 닫는다(혹시 남아 있으면).
    reportScreen.hide(); // 이전 혈통의 보고서 화면이 남아 있으면 닫는다.
    // 새 월드 → 훔쳐보기를 풀고 카메라가 무리로 복귀.
    manualCam = null;
    // 무리 지시 표시 상태 초기화 · 새 월드에선 안내를 다시 한 번 띄울 수 있다.
    leadZeroShown = false;
    leadZeroMs = 0;
    denyMs = 0;
    // 새 월드의 내 무리로 카메라를 즉시 스냅(hint 가 엉뚱한 데서 시작해 첫 프레임에 휙 도는 걸 방지).
    const c0 = world.playerCentroid();
    camX = c0.x;
    camY = c0.y;
    // 재현용: 이 맵의 시드를 콘솔에 남긴다(?seed=… 로 다시 불러올 수 있음).
    console.info(`[seed] ${game.seed}  (재현: ?seed=${game.seed})`);
  };

  game.start(); // 로비 진입
  lobby.show();

  // 떨림 진단 배지 — 디버그 파라미터(?norot/?nointerp/?showalpha/?dz/?rotk)가 있을 때만 표시.
  // HTML 오버레이로 좌하단·높은 z-index 에 둬서, 우상단 패널들에 가리지 않고 dz 값이 보이게 한다.
  let debugBadge: HTMLDivElement | null = null;
  if (DEBUG_ACTIVE) {
    debugBadge = document.createElement("div");
    debugBadge.className = "dev-overlay";
    debugBadge.style.cssText =
      "position:fixed; left:8px; bottom:8px; z-index:30; padding:6px 9px;" +
      "background:rgba(11,14,20,0.9); border:1px solid #4a4030; border-radius:8px;" +
      "color:#ffe08a; font-family:system-ui,-apple-system,sans-serif; font-size:13px;" +
      "font-weight:700; pointer-events:none; user-select:none;";
    document.body.appendChild(debugBadge);
  }

  // ?dev — 디버그 패널(접이식). 위협 즉시 소환 + 메타 레벨/진척도/초기화. 정보 박스(좌상단)·컨트롤(우상단)·
  // 미니맵(우하단) 어느 것도 안 가리게 둔다.
  // 데스크톱은 "종 안내" 범례가 자동으로 펼쳐져 좌상단~중앙을 덮으므로, dev 패널을 좌하단(줌 바 위)으로 내리고
  // 그리드를 위로 펼친다(column-reverse). 모바일은 범례가 접혀 있어 좌측 세로 중앙 그대로 둔다.
  // 드래프트는 전체 화면이라(z-index 15) 그 위를 덮는다 → `dev-overlay` 클래스로 드래프트 중엔 숨긴다.
  if (DEBUG.devSummon) {
    const panel = document.createElement("div");
    panel.className = "dev-overlay";
    panel.style.cssText = layout.isDesktop
      ? "position:fixed; left:6px; bottom:150px; z-index:31; display:flex; flex-direction:column-reverse;" +
        " align-items:flex-start; gap:4px; pointer-events:none;"
      : "position:fixed; left:6px; top:42%; transform:translateY(-50%); z-index:31; display:flex;" +
        " flex-direction:column; align-items:flex-start; gap:4px; pointer-events:none;";
    const grid = document.createElement("div");
    grid.style.cssText =
      "display:none; flex-wrap:wrap; gap:4px; justify-content:flex-start; max-width:min(72vw,420px);";
    const threats: { kind: BossType | ExtinctionType; label: string }[] = [
      ...BOSS_TYPES.map((t) => ({ kind: t as BossType | ExtinctionType, label: bossName(t) })),
      { kind: "cold", label: "한파" },
      { kind: "famine", label: "가뭄" },
      { kind: "heat", label: "폭염" },
      { kind: "plague", label: "역병" },
    ];
    // 누른 버튼을 잠깐 밝게(적용됐다는 즉각 피드백) + 현재 메타 상태를 토글에 항상 표시(뭐가 적용됐는지 확인).
    const flash = (b: HTMLButtonElement): void => {
      b.style.background = "rgba(255,224,138,0.9)";
      b.style.color = "#1a1406";
      window.setTimeout(() => {
        b.style.background = "rgba(11,14,20,0.92)";
        b.style.color = "#ffe08a";
      }, 260);
    };
    const devBtn = (label: string, on: (b: HTMLButtonElement) => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText =
        "pointer-events:auto; padding:6px 9px; background:rgba(11,14,20,0.92); border:1px solid" +
        " #4a4030; border-radius:7px; color:#ffe08a; font:700 12px system-ui,-apple-system;";
      b.addEventListener("click", () => on(b));
      return b;
    };
    for (const th of threats) grid.appendChild(devBtn(th.label, (b) => { game.debugSummon(th.kind); flash(b); }));
    // 메타 진행 테스트 — 레벨을 바로 세팅(리롤=Lv2, 바다=Lv3, 하늘=Lv5, 독=Lv9)하거나, 종료 진척도 화면을
    // 반복 플레이 없이 재생(+120 경험치 적립 애니메이션). 리롤은 드래프트 중 눌러 바로 확인 가능.
    for (const lv of [1, 2, 3, 5, 9, 12])
      grid.appendChild(devBtn(`Lv${lv}`, (b) => { game.debugSetMetaLevel(lv); flash(b); updateToggle(); }));
    // 방울 두 문 · 필드에 놓기(먹이와 갈리는지 · 화면 밖 쐐기 · 밟아서 주워지는지를 바로 본다)와
    // 지갑 채우기(구입 화면을 바로 눌러 본다). 둘 다 실제 경로를 그대로 탄다.
    grid.appendChild(devBtn("방울 놓기", (b) => { game.debugDropGene(); flash(b); }));
    grid.appendChild(devBtn("방울+20", (b) => { game.debugGrantGenes(20); flash(b); }));
    grid.appendChild(
      devBtn("진척도+120", (b) => {
        flash(b);
        controls.setVisible(false);
        levelScreen.play(game.debugGrantMetaXp(120), [], () => {
          controls.setVisible(true);
          updateToggle();
        });
      }),
    );
    // 저장된 진행도(레벨·챔피언) 초기화 — 첫 플레이 상태로 되돌려 테스트(레벨 1·리롤 잠금·챔피언 없음).
    grid.appendChild(devBtn("초기화", (b) => { game.debugReset(); flash(b); updateToggle(); }));
    const toggle = document.createElement("button");
    toggle.style.cssText =
      "pointer-events:auto; padding:5px 11px; background:rgba(11,14,20,0.92); border:1px solid" +
      " #4a4030; border-radius:7px; color:#ffe08a; font:700 12px system-ui,-apple-system;";
    // 토글에 현재 메타 레벨·리롤 상태를 항상 표시 → 레벨 버튼을 눌렀을 때 "적용됐다"가 바로 읽힌다.
    const updateToggle = (): void => {
      const open = grid.style.display !== "none";
      const roll = game.rerollUnlockedNow ? " 리롤" : "";
      toggle.textContent = `dev · Lv${game.metaLevelNow}${roll} ${open ? "▴" : "▾"}`;
    };
    toggle.addEventListener("click", () => {
      grid.style.display = grid.style.display === "none" ? "flex" : "none";
      updateToggle();
    });
    panel.appendChild(toggle);
    panel.appendChild(grid);
    document.body.appendChild(panel);
    updateToggle();
  }

  // ?ovhook: 겹침 검사기(scripts/overlap-check.mjs) 전용 문. "그 순간에만 뜨는 화면"을 스크립트가
  // 만들 수 있게 한다: 위협 예고 전광판·판정 플래시·보스 등장·런 종료 진척도.
  // ⚠ 문구를 여기서 지어내지 않는다 · summon 은 진짜 보스를 소환해 **게임이 만드는 문구**를 띄우고,
  //   levelUp 은 진짜 해금표·진짜 도전 과제 목록을 쓴다. 가짜 문자열을 검사하면 검사가 거짓말이 된다.
  // ⚠ `?dev` 패널을 대신 쓰지 않는 이유: 그 버튼 무더기가 화면 절반을 덮어 겹침 측정을 오염시킨다.
  interface OverlapHooks {
    /** 위협 예고 전광판을 띄운다(검사기가 최악 길이의 제목·힌트를 넣는다). */
    banner: (title: string, sub: string) => void;
    /** 상단 플래시를 띄운다(판정 문구 등 · 색은 게임과 같은 값을 검사기가 넘긴다). */
    flash: (msg: string, color: number, priority: boolean) => void;
    /** 진짜 보스를 지금 단계에 소환 · 목표 줄이 두 줄로 늘고 빨간 등장 플래시가 뜬다(사용자 신고 상황). */
    summon: (kind: string) => void;
    /** 런 종료 진척도 화면 · 실제 해금표(경험치 적립)와 실제 도전 과제 앞 n개로 최악 길이를 만든다. */
    levelUp: (xp: number, achCount: number) => void;
    /**
     * 지금 판의 시대를 갈아 끼운다. 관문의 생존 기준은 시대마다 오르므로(1 · 2 · 3 · 4 · 6마리),
     * 목표 줄의 생존 칩("생존 21/6")은 **후반 시대에만** 뜬다 — 시대를 못 올리면 그 칩이 붙은
     * 최악의 알약(긴 보스 이름 + 칩)을 영영 못 잰다. 값은 게임의 진짜 판정 경로로 흘러간다.
     */
    setEra: (n: number) => void;
    /** 시대 전환 연출을 지금 재생한다(문구는 game.nextEraBriefing 이 만든 진짜 세 줄). */
    eraMoment: () => void;
    /**
     * 지갑에 방울을 넣는다 · **티어 구입 화면을 「살 수 있는 상태」로도 재기 위해서다.**
     * 지갑이 0 이면 그 화면의 다섯 줄이 전부 「모자람」이라, 켜진 테두리 · 방울 색 값 칩 ·
     * 구입 성공 줄을 영영 안 재게 된다(화면의 절반만 검사하는 셈).
     */
    genes: (n: number) => void;
  }
  if (new URLSearchParams(window.location.search).has("ovhook")) {
    const hooks: OverlapHooks = {
      banner: (title, sub) => threatBanner.show(title, sub),
      flash: (msg, color, priority) => highlights.flash(msg, color, priority),
      summon: (kind) => game.debugSummon(kind as BossType),
      levelUp: (xp, achCount) => {
        controls.setVisible(false);
        levelScreen.play(game.debugGrantMetaXp(xp), ACHIEVEMENTS.slice(0, achCount), () => {});
      },
      setEra: (n) => game.debugSetEra(n),
      eraMoment: () => {
        // 문구는 게임이 만든다(nextEraBriefing) · 여기서 지어내면 검사가 거짓말이 된다.
        const was = game.result;
        game.result = "win";
        const b = game.nextEraBriefing();
        game.result = was;
        if (b) moment.era(b.title, b.lines, () => {});
      },
      genes: (n) => game.debugGrantGenes(n),
    };
    (window as unknown as { __ov: OverlapHooks }).__ov = hooks;
  }

  // 하이라이트 이벤트 감지 상태(카메라 변수는 위에서 onWorldChanged 보다 먼저 선언했다).
  let prevBoss = false;
  let prevExt = "";
  let prevLowWarn = false;
  let prevLevel = game.level;
  let prevThreat: string | null = null;
  // 보스가 나타난 틱. 등장 배너를 **한 틱 늦춰** 띄우기 위한 것 · 보스는 라운드 전환 안에서 만들어지고
  // 그 틱에는 stepBoss 가 아직 안 돌아 전사 수가 0 이다. 그대로 띄우면 셀 수 있는 종에게도
  // "맞설 수 있는 개체가 없습니다"라고 말해 버린다(≈33ms 뒤라 눈에는 즉시로 보인다).
  let bossBannerTick = -1;

  // 월드 탭 = 명령. 월드 레이어는 hit-test 에서 빼(none) 탭이 stage 까지 통과하게 한다 →
  // 개체는 좌표로 직접 찾는다(스프라이트는 풀 재사용이라 개체와 1:1 이 아니므로 좌표 + 최근접 탐색).
  view.container.eventMode = "none";
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  // 브라우저 기본 제스처(스크롤·핀치 확대)를 막아 캔버스가 드래그·핀치를 직접 받게 한다.
  app.canvas.style.touchAction = "none";

  // 카메라 수동 조작 — 드래그(1손가락)=훔쳐보기 팬, 핀치(2손가락)=줌+팬, 휠=줌. 탭(안 끌었을 때)=명령.
  const activePointers = new Map<number, { x: number; y: number }>();
  let dragStart: { sx: number; sy: number; camX: number; camY: number } | null = null;
  let dragging = false;
  let pinchDist = 0;
  let pinchedThisGesture = false; // 이번 제스처에 핀치(2손가락)가 있었나 — 끝날 때 탭 명령을 막는다
  let pinchMid: { x: number; y: number } | null = null; // 2손가락 팬의 직전 중점
  const onCanvasUI = (x: number, y: number): boolean =>
    minimap.container.visible && minimap.containsScreenPoint(x, y);

  // --- 조작 확장 (**[사용자 2026-08-06]**): 길게 누르기 = 명령 휠 · 더블탭 = 회피 · 명령 줄 = 철회 ---
  //
  // 오작동을 어떻게 가르나:
  //  · **단일 탭은 즉시 실행하고, 더블탭이 오면 덮어쓴다.** 탭을 잡아 두고 더블탭을 기다리면 기본
  //    조작에 지연이 생기는데, 이동은 취소해도 손해가 없으니 먼저 가고 나중에 고치는 쪽이 낫다.
  //  · **길게 누르기는 손가락이 안 움직인 채 0.25초.** 움직이면 그건 훔쳐보기(팬)다.
  const LONG_PRESS_MS = 250;
  const DOUBLE_TAP_MS = 300;
  const DOUBLE_TAP_PX = 44; // 손끝 굵기. 이보다 멀면 "다른 곳을 또 탭한 것"이다.
  let pressTimer = 0;
  let lastTap = { t: 0, x: 0, y: 0 };
  const wheel = new CommandWheel(document.body, {
    onPick: (kind, wx, wy) => {
      if (!issueOrder(wx, wy, kind)) effects.spawnPing(wx, wy, "deny");
    },
  });
  const orderLine = new OrderLine(document.body, () => {
    game.clearHerdOrder();
    denyMs = 0;
  });

  const cancelLongPress = (): void => {
    if (pressTimer !== 0) {
      window.clearTimeout(pressTimer);
      pressTimer = 0;
    }
  };

  app.stage.on("pointerdown", (e) => {
    if (game.phase !== "watch" && game.phase !== "draft") return;
    if (e.target !== app.stage || onCanvasUI(e.global.x, e.global.y)) return;
    activePointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
    if (activePointers.size === 1) {
      dragStart = { sx: e.global.x, sy: e.global.y, camX, camY };
      dragging = false;
      // 길게 누르기 → 명령 휠. 손가락이 그대로일 때만 열린다(움직였으면 pointermove 가 취소한다).
      if (leadMode && game.phase === "watch" && !game.paused) {
        const sx = e.global.x;
        const sy = e.global.y;
        const p = view.container.toLocal({ x: sx, y: sy });
        cancelLongPress();
        pressTimer = window.setTimeout(() => {
          pressTimer = 0;
          if (dragging || activePointers.size !== 1) return;
          wheel.open(sx, sy, p.x, p.y, game.orderWheel());
        }, LONG_PRESS_MS);
      }
    } else if (activePointers.size === 2) {
      cancelLongPress();
      wheel.cancel();
      const pts = [...activePointers.values()];
      pinchDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      pinchMid = { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
      dragStart = null; // 핀치 중엔 1손가락 팬 중단
      pinchedThisGesture = true;
    }
  });

  app.stage.on("pointermove", (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
    // 휠이 떠 있으면 손가락은 「고르는 손」이다 — 카메라를 안 민다(한 손으로 끝나는 조작의 핵심).
    if (wheel.isOpen) {
      wheel.moveTo(e.global.x, e.global.y);
      return;
    }
    if (activePointers.size >= 2) {
      const pts = [...activePointers.values()];
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      const mx = (pts[0]!.x + pts[1]!.x) / 2;
      const my = (pts[0]!.y + pts[1]!.y) / 2;
      if (pinchDist > 0) userZoom = clampUserZoom(userZoom * (d / pinchDist));
      // 2손가락 드래그 = 조망 이동(팬). 미니맵 드래그만 남기면 세로 폰에서 넓게 보기가 어렵다.
      if (pinchMid) {
        const bx = manualCam ? manualCam.x : camX;
        const by = manualCam ? manualCam.y : camY;
        manualCam = { x: bx - (mx - pinchMid.x) / camZoom, y: by - (my - pinchMid.y) / camZoom };
        peekIdleMs = 0;
      }
      pinchMid = { x: mx, y: my };
      pinchDist = d;
      return;
    }
    if (dragStart) {
      const dx = e.global.x - dragStart.sx;
      const dy = e.global.y - dragStart.sy;
      if (!dragging && Math.hypot(dx, dy) > 8) {
        dragging = true; // 탭/드래그 구분 임계
        cancelLongPress(); // 움직였으면 그건 훔쳐보기지 길게 누르기가 아니다
      }
      if (dragging) {
        // 드래그 = 훔쳐보기(마우스·손가락 공통). 손가락 아래 월드가 따라오게 카메라를 반대로 민다.
        manualCam = { x: dragStart.camX - dx / camZoom, y: dragStart.camY - dy / camZoom };
        peekIdleMs = 0;
      }
    }
  });

  const endPointer = (e: { pointerId: number; global: { x: number; y: number }; target: unknown }): void => {
    const wasDragging = dragging;
    const hadPointer = activePointers.delete(e.pointerId);
    cancelLongPress();
    // 휠에서 손을 뗐다 = 고르고 있던 칸을 실행한다. 이 제스처는 이동 명령이 아니다.
    if (wheel.isOpen) {
      wheel.close();
      if (activePointers.size === 0) {
        dragStart = null;
        dragging = false;
        pinchMid = null;
        pinchedThisGesture = false;
      }
      return;
    }
    if (activePointers.size < 2) pinchDist = 0;
    if (activePointers.size > 0) return;
    dragStart = null;
    dragging = false;
    pinchMid = null;
    const hadPinch = pinchedThisGesture;
    pinchedThisGesture = false;
    // 끌지 않은 단순 탭만 명령으로 처리(드래그·핀치 끝은 명령 아님 — 훔쳐보기였다).
    if (!hadPointer || wasDragging || hadPinch) return;
    // 미니맵 게이트 — 안 지키면 미니맵 탭이 이동 명령으로 샌다(조사에서 확인된 회귀 지점).
    if (e.target !== app.stage || onCanvasUI(e.global.x, e.global.y)) return;
    // ?watch 관전 폴백: 탭 = 수동 조망 해제(예전 관전 동작). 자동 복귀 타이머가 없는 모드라
    // 탭마저 없으면 드래그 한 번에 그 월드 내내 수동 카메라에 갇힌다(반박 검증에서 확인된 회귀).
    if (!leadMode) {
      manualCam = null;
      return;
    }
    // 명령은 관전 단계 + 비멈춤에서만. 드래프트 중 탭은 카드 화면 몫이다(기존 phase 게이트).
    if (game.phase !== "watch" || game.paused) return;
    const p = view.container.toLocal(e.global as { x: number; y: number });

    // **더블탭 = 회피.** 단일 탭(이동)은 이미 나갔고, 두 번째 탭이 그것을 덮어쓴다.
    const now = performance.now();
    const isDouble =
      now - lastTap.t < DOUBLE_TAP_MS &&
      Math.hypot(e.global.x - lastTap.x, e.global.y - lastTap.y) < DOUBLE_TAP_PX;
    lastTap = { t: now, x: e.global.x, y: e.global.y };
    if (isDouble) {
      // 다리 1단이 없으면 회피가 잠겨 있다 — 조용히 무시하지 않고 왜 안 되는지 그 자리에서 말한다
      // (없다는 것으로 가르치는 건 가장 약한 가르침이다).
      if (!issueOrder(p.x, p.y, "evade")) {
        effects.spawnPing(p.x, p.y, "deny");
        highlights.flash("다리 1단이 되면 「피해라」를 쓸 수 있습니다", 0xd0b050);
      }
      return;
    }

    // **지휘봉 이양** — 내 개체를 바로 짚었으면 그 애가 알파가 된다(**[사용자 2026-08-06]**).
    // 이동 명령과 겹치지 않는 이유: 내 무리가 이미 있는 자리로 가라는 것은 어차피 아무 일도 아니다.
    const own = nearestOwnEntity(p.x, p.y, 20);
    if (own !== null && game.passBaton(own)) {
      effects.spawnPing(p.x, p.y, "go");
      return;
    }

    issueOrder(p.x, p.y);
  };

  /** 이 자리에서 반경 안에 있는 **내 종** 개체 중 가장 가까운 것의 id. 없으면 null. */
  function nearestOwnEntity(wx: number, wy: number, r: number): number | null {
    let best: number | null = null;
    let bestD2 = r * r;
    for (const en of game.world.entities) {
      if (!en.alive || !en.species.isPlayer) continue;
      const d2 = (en.x - wx) ** 2 + (en.y - wy) ** 2;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = en.id;
      }
    }
    return best;
  }
  app.stage.on("pointerup", endPointer);
  app.stage.on("pointerupoutside", endPointer);

  /**
   * 탭 지점을 명령으로 해석한다 — 동시에 하나만: 사냥할 수 있는 개체면 사냥 잠금, 그 외 전부
   * (빈 땅·내 무리·못 사냥하는 상대)는 그 지점으로 이동. 목표가 못 가는 지형이거나 길이 없으면
   * 명령을 바꾸지 않고 거부 핑만 띄운다(왜 안 가는지 그 자리에서 보이게).
   */
  function issueOrder(wx: number, wy: number, kind: OrderKind = "move"): boolean {
    // 무리 지시(신탁) · 탭한 곳이 곧 "저기로 가라"다. 개체를 고르는 게 아니라 **종에게** 내리는 뜻이라
    // 무엇을 탭했는지는 상관없다(생물 위를 탭해도 그 자리로 간다).
    // ⚠ 「가라」만 통행 가능성을 본다 — 회피·원진처럼 제자리에서 하는 명령은 목표 지형과 무관하다.
    if (kind === "move" && !herdCanReach(wx, wy)) {
      effects.spawnPing(wx, wy, "deny"); // 왜 안 가는지 그 자리에서 보이게(못 가는 지형·길 없음)
      // 0.25초짜리 핑만으로는 "탭이 먹기는 했는지"조차 안 읽힌다(실측: 탭 여섯 번 중 한 번이 조용히
      // 거부됐다). 새 줄을 만들지 않고 이미 있는 목표 줄에 잠깐 말로 남긴다.
      denyMs = ORDER_DENY_MS;
      return false;
    }
    // **지휘 공백**(알파가 막 쓰러졌다)이면 아무도 안 듣는다 — 그 사실을 말로 알린다.
    if (game.leadVacuumSeconds > 0) {
      effects.spawnPing(wx, wy, "deny");
      highlights.flash("앞장서던 것이 쓰러졌습니다. 무리가 잠시 흩어집니다", 0xd07050);
      return false;
    }
    if (!game.setHerdOrder(wx, wy, kind)) return false;
    effects.spawnPing(wx, wy, "go");
    denyMs = 0; // 새 지시가 먹혔다 · 거부 안내는 그 자리에서 걷는다
    return true;
  }

  /**
   * 무리가 내려 둔 뜻에 사실상 도착했나 · **무리 단위**(무게중심 기준, ORDER.arriveRadius 200).
   * sim 의 개체별 게이트는 따로 있다(ORDER.releaseRadius 64 · behavior 지시 블록) · 개체 하나가
   * 지시를 놓는 문턱과 "무리가 도착했다"는 화면 표시는 척도가 달라 상수도 다르다(params.ts 주석).
   * 이걸 안 가르면 목표 근방에 모여 사는 무리가 "아무도 안 따른다"로 표시된다(화면이 거짓말한다).
   */
  function herdArrived(): boolean {
    const o = game.world.herdOrder;
    if (o === null) return false;
    const c = game.world.playerCentroid();
    return Math.hypot(c.x - o.x, c.y - o.y) <= ORDER.arriveRadius + ORDER_ARRIVED_PAD;
  }

  /**
   * 무리가 (gx, gy)까지 갈 수 있나 · 종의 통행 능력(게놈)과 무리 중심에서의 길로 검사한다.
   * 불가능한 약속을 하지 않으려는 것이지, 개체 하나하나가 닿는지를 보증하는 것은 아니다
   * (누가 언제 닿는지는 그 개체의 천성이 정한다 · sim/herdOrder.ts).
   */
  function herdCanReach(gx: number, gy: number): boolean {
    const caps = leadCapsOf(game.genome);
    const terrain = game.world.terrain;
    if (!terrain.isPassable(gx, gy, caps.canSwim, caps.canLand, caps.canFly)) return false;
    const from = game.world.playerFocus(camX, camY); // 지금 주 무리가 있는 자리
    if (terrain.tileIndex(from.x, from.y) === terrain.tileIndex(gx, gy)) return true;
    // **직선(lineOfSight) 단축을 쓰지 않는다.** 직선 판정은 Bresenham 이라 한 걸음에 x·y 가 함께
    // 움직여 **대각 모서리를 뚫고 지나간다**(8연결). 그런데 실제 이동과 findPath 는 4연결이라, 두
    // 육지가 모서리로만 맞닿은 자리는 "직선으로 보이지만 갈 수는 없는 곳"이 된다(2026-08-08 실측:
    // lineOfSight=true · findPath=경로 0 · 무리는 400틱 내내 42px 앞에서 못 건넜다).
    // 그때 이 게이트가 통과시키면 게임이 **못 지킬 약속**을 한다 · 「가라」 핑이 뜨고, 무리는 물가에
    // 서 있고, 화면은 「무리 도착」이라 말한다. 갈 수 있는지를 묻는 자리이니 **실제로 걸어갈 길
    // (findPath)에게만** 묻는다. 탭은 몇 초에 한 번이고 격자는 27x48 이라 BFS 값이 싸다.
    return terrain.findPath(from.x, from.y, gx, gy, caps.canSwim, caps.canLand, caps.canFly).length > 0;
  }

  // 휠 줌(데스크톱).
  app.canvas.addEventListener(
    "wheel",
    (ev: WheelEvent) => {
      ev.preventDefault();
      userZoom = clampUserZoom(userZoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12));
    },
    { passive: false },
  );

  // "따르는 무리" 수는 goalBar 상세 패널에 있다(HUD 갈아엎기로 좌하단 상시 칩 제거 — 하단은 월드 몫).
  // 숫자의 단일 진실은 여전히 sim 이 판정 자리에서 센 world.lead.followerCount 다.

  // 키보드 조작(관전·멈춤 메뉴) — 우선순위 0(바닥). 드래프트·결과·오버레이가 열리면 그쪽 레이어가 먼저 받는다.
  registerKeyLayer(
    0,
    () => game.phase === "watch",
    (e) => {
      // 멈춤 메뉴가 떠 있는 동안 — 메뉴 버튼과 같은 동작만 받고, 나머지 게임 키는 잠근다.
      if (game.paused) {
        if (e.repeat) return true;
        switch (e.code) {
          case "Space":
          case "Escape":
          case "Enter":
          case "NumpadEnter":
            controlsCb.onResume();
            return true;
          case "KeyR":
            controlsCb.onRestart();
            return true;
          case "KeyG":
            controlsCb.onGlossary();
            return true;
          case "KeyQ":
            controlsCb.onLobby();
            return true;
          default:
            return true;
        }
      }
      switch (e.code) {
        case "Space":
          if (!e.repeat) controlsCb.onPauseToggle();
          return true;
        case "Digit1":
        case "Digit2":
        case "Digit3":
        case "Numpad1":
        case "Numpad2":
        case "Numpad3":
          game.speed = Number(e.code.slice(-1));
          controls.setSpeed(game.speed);
          goalBar.setSpeed(game.speed); // 표시 동기화 — 키로 바꿔도 goalBar 패널의 배속 버튼이 맞게
          return true;
        case "KeyI":
          // 자세한 정보(목표 줄 아래 상세 패널) 펼치기/접기 · 폰은 탭, 데스크톱은 이 키.
          // 알약은 button 이지만 이 라우터가 keydown 마다 포커스를 걷어내므로(keys.ts) Tab+Enter 로는
          // 못 연다 → 키보드 경로를 여기서 따로 준다.
          goalBar.toggle();
          return true;
        case "Equal":
        case "NumpadAdd":
          userZoom = clampUserZoom(userZoom * 1.25);
          return true;
        case "Minus":
        case "NumpadSubtract":
          userZoom = clampUserZoom(userZoom / 1.25);
          return true;
        case "Escape":
          controlsCb.onPauseToggle();
          return true;
        default:
          return false;
      }
    },
  );

  app.ticker.add((ticker) => {
    game.update(ticker.deltaMS);
    view.sync(game.world, game.interpAlpha, ticker.deltaMS);
    // 뜻 표식(깃발) · 지시가 없으면 null 로 지운다. 단계가 바뀌면 game 이 뜻을 거두므로 저절로 사라진다.
    view.setMoveTarget(game.herdOrder);
    // **현재 명령 한 줄** — 철회하려면 먼저 무엇이 걸려 있는지 보여야 한다(**[사용자 2026-08-06]**).
    // 드래프트·결과 화면에서는 감춘다(그때 탭은 카드 화면 몫이라 철회할 것도 없다).
    {
      const o = game.phase === "watch" && !game.paused ? game.herdOrder : null;
      const spec = o ? ORDER_SPEC_BY_KIND.get(o.kind ?? "move") : undefined;
      orderLine.set(spec ? spec.label : null);
    }
    // 사건 연출: sim 이 이번 프레임에 emit 한 사건(탄생/죽음/잡아먹힘)을 효과로 옮기고 비운다.
    for (const ev of game.world.events) effects.spawn(ev.kind, ev.x, ev.y, ev.mine, ev.tx, ev.ty);
    game.world.events.length = 0;
    effects.update(ticker.deltaMS);
    if (denyMs > 0) denyMs = Math.max(0, denyMs - ticker.deltaMS);
    const gw = game.world;
    const gBoss = gw.boss;
    let mineCount = 0;
    let wildCount = 0;
    for (const en of gw.entities) {
      if (!en.alive) continue;
      if (en.species.isPlayer) mineCount += 1;
      else wildCount += 1;
    }
    // "지금 이 보스에 맞설 수 있는 수" · sim 이 판정한 그 자리에서 센 값을 그대로 읽는다. 화면에서
    // 조건을 다시 유도하면 화면과 실제가 갈리고(known_issues), 매 프레임 전 개체를 다시 도는 비용도 든다.
    // 보스가 없는 틱에는 sim 이 0 으로 되돌리므로 낡은 수가 남지 않는다.
    const raidFighters = gw.raidMeleeFighters + gw.raidRangedFighters;
    // --- 목표 한 줄 — "지금 뭘 해야 하나"를 게임 상태에서 자동으로 뽑는다(상시 화면의 전부) ---
    {
      // 대멸종 판정은 detectEvents 의 플래시와 같은 근거를 읽는다(다른 조건으로 재유도하면 어긋난다).
      const extName =
        gw.globalCold > 0 ? "한파" : gw.heat > 0 ? "폭염" : gw.foodRegrowMultiplier > 1 ? "대가뭄" : gw.plagueRate > 0 ? "역병" : "";
      // sub 줄은 **기한이 먼저**다. "시험에 기한이 있는지, 언제 불씨가 꺼지는지 알 수가 없다"(2026-08-03
      // 사용자)가 이 자리의 문제였다: 남은 시간이 펼쳐야 보이는 상세 패널에만 있었다. 한 줄에 들어가도록
      // 안내 문구는 짧게 자른다(예전 보스 문구는 한 줄을 넘겨 "..."로 잘려 나갔다).
      const left = `${game.secondsLeft}초 남음`;
      let goalText: string;
      let goalSub: string;
      if (gBoss) {
        goalText = `위협: ${gBoss.name}`;
        // 깎을 수 없는 판에서 "깎으세요"라고 말하는 것이 이 화면의 가장 큰 거짓말이었다. 판단 근거를
        // 격퇴 체력(있기만 하면 참)에서 **맞설 수 있는 개체 수**로 바꾼다 · 0 이면 그렇다고 말한다.
        // 살아남아야 하는 수는 시대마다 오른다 — **판정과 같은 값**(game.survivorsNeeded)을 그대로 쓴다.
        // 기준을 안 보여 주면 관문에서 지는 순간이 "허무하게 졌다"가 된다(2026-07-16 에 기준을 내린 이유).
        const need = game.survivorsNeeded;
        const hold = need > 1 ? `${need}마리가 살아남아야 합니다` : "끝까지 살아남으면 통과합니다";
        goalSub = !bossRaidable(gBoss)
          ? `${left} · ${hold}`
          : raidFighters === 0
            ? `${left} · 맞설 개체가 없습니다 · ${hold}`
            : `${left} · 맞서는 개체 ${raidFighters}마리 · 체력 바를 깎으세요`;
      } else if (extName) {
        goalText = `대멸종: ${extName}`;
        const need = game.survivorsNeeded;
        goalSub = need > 1 ? `${left} · ${need}마리가 살아남아야 합니다` : `${left} · 환경이 바뀌었습니다. 버티세요`;
      } else {
        // 라운드 시험: "이번 16초가 답해야 할 질문"을 목표 줄로. 진행 숫자는 sim 계수기 그대로.
        // 기한(남은 시간)과 대가(불씨)를 나란히 둔다 · 시험이 걸린 판돈이 한눈에 읽혀야 한다.
        const t = game.trial;
        goalText = t
          ? `이번 시험: ${t.label} (${Math.min(game.trialProgress, t.target)}/${t.target})`
          : "무리를 먹여 키우세요";
        goalSub = t
          ? `${game.secondsLeft}초 안에 채우세요 · 불씨 ${emberDots(game.embers)}`
          : left;
      }
      // 갈 수 없는 곳을 탭했으면 이 줄의 뒷말만 잠깐 바꾼다(기한은 그대로 남긴다 · 새 줄을 안 만든다).
      if (denyMs > 0) goalSub = `${left} · 그곳으로는 갈 수 없습니다`;
      // 접힌 기본 상태에서 순종을 알리는 표시가 하나도 없었다 → 명령이 먹혔는지 알 방법이 없으니
      // "말을 안 듣는다"로 읽힌다.
      // 분모는 **아직 목표에 못 닿은 수**(sim 의 orderPending)다 · 살아 있는 내 종 전부를 분모로
      // 쓰면 이미 도착한 개체가 불복종처럼 세여 "4/24"가 뜬다(2026-08-05 사고 · 실은 20마리 도착).
      // 분자(orderFollowers)가 분모보다 작은 것은 정상이다 · 못 닿은 개체 중 일부는 달아나는 중이거나
      // 눈앞의 먹이·사냥에 붙들려 있다(그 사정은 0명 배너가 말한다 · 칩은 숫자만).
      // "무리 도착"은 무리 단위 판정(herdArrived)이 먼저다 · 개체 몇이 근방을 들락여도(orderPending 이
      // 0 과 소수를 오간다) 무리가 목표에 살면 도착이 맞다. orderPending === 0 은 그 안전망이다.
      const follow =
        gw.herdOrder === null || mineCount === 0
          ? ""
          : herdArrived() || gw.orderPending === 0
            ? "무리 도착"
            : `따르는 중 ${gw.orderFollowers}/${gw.orderPending}`;
      // **관문 동안에는 이 칩 자리를 생존 수가 가져간다.** 순종보다 판정이 급하다 — 이 라운드가 끝날 때
      // 기준 아래면 런이 끝난다. 기준(game.survivorsNeeded)은 판정과 같은 값이라 화면이 거짓말할 수 없다.
      const gate = survivalChip(mineCount, game.survivorsNeeded);
      const followText = gate ? gate.text : follow;
      const followTone = gate ? gate.tone : "plain";
      goalBar.update({
        visible: game.phase === "watch",
        text: goalText,
        sub: goalSub,
        stage: `${game.eraLabel ? `${game.eraLabel} · ` : ""}${game.stageLabel}`,
        level: game.level,
        xp01: game.xpProgress,
        mine: mineCount,
        wild: wildCount,
        // 순종의 질 · 지금 뜻을 향해 움직이는 수. sim 이 규칙을 판정한 그 자리에서 센 값을 그대로 읽는다.
        // 뜻을 안 내렸으면 셀 것이 없으므로 줄을 숨긴다(-1).
        followers: gw.herdOrder !== null ? gw.orderFollowers : -1,
        follow: followText, // 접힌 알약에 상시로 붙는 짧은 칩(빈 문자열이면 숨김)
        followTone,
        seconds: game.secondsLeft,
        night: gw.daylight < 0.5,
        // 방울 지갑 · 카운터가 읽는 유일한 값(game.geneBank). 늘면 카운터가 한 번 튄다.
        genes: game.geneBank,
        // 지금 당장 올릴 수 있는 범주가 하나라도 있나 · 카운터가 방울 색으로 살아나 「살 게 있다」를
        // 숫자를 읽기 전에 알린다. 판정은 game 한 곳(canBuyTier)이 하고 화면은 읽기만 한다.
        geneReady: CATEGORIES.some((c) => game.canBuyTier(c)),
      });
    }
    // 불씨 첫 안내(런당 1회): "불씨"라는 말은 처음 나올 때 한 번 풀이한다(UI 문구 규칙).
    if (game.phase === "watch" && game.trial && !emberHintShown) {
      emberHintMs += ticker.deltaMS;
      if (emberHintMs >= 3500) { // 탭 안내 플래시(2200ms)와 겹쳐 덮어쓰지 않게 뒤로 미룬다
        emberHintShown = true;
        // priority: "불씨"의 유일한 첫 풀이라 레벨업·위협 플래시가 끼어들어도 끝까지 읽혀야 한다.
        // 기한을 먼저 말한다("시험에 기한이 있는지 알 수가 없다" 2026-08-03 사용자). 다만 이 배너는
        // 화면 한복판을 덮으므로 두 문장을 넘기지 않는다 · 길면 세계가 통째로 가린다.
        highlights.flash("라운드가 끝날 때 시험을 판정합니다. 못 채우면 남은 기회(불씨)가 하나 꺼집니다.", 0xf0f8ff, true);
      }
    }
    // 내 형질 패널은 관전 중 + 칩이 켜져 있을 때만 — 드래프트는 전체 화면이라 그 아래 깔린 UI 가
    // 뿌연 유리로 비쳐 보인다. 드래프트 중 내 종 정보는 헤더의 "내 종" 팝업이 대신한다(핸드오프 §9).
    buildPanel.setVisible(game.phase === "watch" && traitsOpen);

    // --- 무리 지시: 화면 안에서 알아채게 하는 것들 ---
    // ⚠ 여기 있던 안내 넷은 전부 `world.lead.*`(알파 조종 시절 필드)를 읽었는데, 무리 지시로 갈아탄 뒤로
    //   armLead()·setLeadCommand() 호출부가 0 건이라 leaderId 는 영영 -1, followTicks 는 영영 0,
    //   commanded 는 영영 false 였다 = **한 번도 뜬 적이 없는 안내**. 하필 "지금은 아무도 따라오지
    //   않습니다"가 사용자가 실제로 겪은 상황의 설명인데 그게 죽은 코드였다. 근거를 지금 살아 있는 값
    //   (world.herdOrder · world.orderFollowers)으로 다시 잡는다.
    if (leadMode && game.phase === "watch") {
      // 첫 관전 진입 안내(런당 1회) — 탭이 곧 명령이라는 것은 화면만 봐서는 알 수 없으니 한 번 알려 준다.
      if (!tapHintShown) {
        tapHintShown = true;
        highlights.flash("화면을 탭하면 무리가 그곳으로 갑니다", 0xf0f8ff);
      }
      // 뜻을 내렸는데 아무도 그쪽으로 안 움직이면 잠시 뒤 한 번만 알린다.
      // ⚠ 원인을 단정하지 않는다 · 도망·눈앞의 먹이가 다 같은 0 으로 나온다. 조건은 칩과 같은
      //   기준이다: 못 닿은 개체가 있는데(orderPending > 0) 아무도 안 움직이고(orderFollowers 0)
      //   무리 도착도 아니어야(herdArrived) 한다 · 도착해 모여 사는 무리에게 띄우면 거짓말이 된다.
      if (gw.herdOrder !== null && gw.orderFollowers === 0 && gw.orderPending > 0 && mineCount > 1 && !herdArrived()) {
        leadZeroMs += ticker.deltaMS;
        if (leadZeroMs >= LEAD_BANNER_DELAY_MS && !leadZeroShown) {
          highlights.flash("지금은 아무도 뜻을 따르지 않습니다. 달아나는 중이거나 눈앞의 일에 붙들려 있습니다.", 0xffba3a);
          leadZeroShown = true;
        }
      } else {
        leadZeroMs = 0;
      }
    }
    view.setLead(null); // 앞장선 한 마리를 표시하던 자리 · 무리 지시에는 그런 개체가 없다

    updateCamera(ticker.deltaMS);
    // 미니맵 — 관전 중에만. 드래프트에선 캔버스 전체가 블러라 뭉갠 미니맵이 남으면 지저분하다.
    // 목표 줄 상세를 펼쳤을 때도 숨긴다: 그 패널이 미니맵 자리를 덮어 조각만 삐져나와 지저분했다.
    // 월드가 화면보다 크지 않으면 미니맵은 보여 줄 것이 없다(같은 그림의 축소판일 뿐) → 숨긴다.
    // 첫 시대 맵이 화면 크기로 좁아지면 이 조건이 알아서 미니맵을 거둔다.
    const worldFitsScreen = game.width <= layout.width && game.height <= layout.height;
    minimap.container.visible = game.phase === "watch" && !goalBar.isOpen() && !worldFitsScreen;
    // 미니맵은 캔버스에 그려 DOM 으로 못 잰다. 겹침 검사기(scripts/overlap-check.mjs)가 "지금 떠 있나"를
    // 알 수 있게 body 에 표식만 남긴다(값이 바뀔 때만 쓴다 · 매 프레임 DOM 쓰기 아님).
    const mmFlag = minimap.container.visible ? "on" : "off";
    if (document.body.dataset["minimap"] !== mmFlag) document.body.dataset["minimap"] = mmFlag;
    if (minimap.container.visible) {
      minimap.sync(game.world, camX, camY, camZoom, layout.width, layout.height);
      minimap.place(app.screen.width, app.screen.height);
    }
    detectEvents(raidFighters);
    // 캔버스 글씨(플래시·위협 예고)는 DOM 목표 줄 **아래**에 깔린다 → 그 줄이 실제로 차지한 높이를
    // 넘겨 그만큼 비켜 그리게 한다. 고정값(예전 66px)은 문구가 길어지는 순간 틀린다(goalBar.bottomPx 주석).
    // 논리 좌표로 바꿔 넘긴다 · Pixi UI 는 uiZoom 배율 안에서 산다.
    const hudSafe = goalBar.bottomPx() / uiZoom;
    highlights.update(ticker.deltaMS, app.screen.width / uiZoom, hudSafe);
    // 화면 밖 방울을 가리키는 쐐기도 같은 근거로 HUD 를 피한다. 다만 **좌표계가 다르다** ▸ 쐐기는
    // 월드 컨테이너(논리 화면 layout.width 기준) 안에서 그려지고 goalBar 는 DOM(CSS px)이라,
    // 논리/CSS 비율을 곱해 옮긴다. 안 옮기면 폰에서 78 이 56 CSS px 로 줄어 알약(59~74) 뒤에 깔린다.
    view.hudSafeLogical =
      app.screen.width > 0 ? goalBar.bottomPx() * (layout.width / app.screen.width) : 0;
    // 전광판은 HUD 뿐 아니라 **위 플래시 아래**로도 비켜 앉는다. 둘 다 "HUD 아래"로만 밀면 서로
    // 겹친다(상세를 펼친 짧은 폰에서 보스 등장 플래시와 예고 띠가 같은 자리에 얹혔다). 위에서부터
    // HUD → 플래시 → 전광판 순으로 쌓는다.
    const bannerSafe = Math.max(hudSafe, highlights.bottomY());
    threatBanner.update(ticker.deltaMS, app.screen.width / uiZoom, app.screen.height / uiZoom, bannerSafe);
    // 겹침 검사기가 캔버스 글씨를 잴 수 있게 화면 좌표를 body 에 싣는다(pixiTextRects 주석).
    publishPixiTextRects([...highlights.screenRects(), ...threatBanner.screenRects()]);
    // 격퇴 체력 바는 worldView 가 보스 몸 위에 그린다(상단 글로벌 바 제거 — HUD 갈아엎기).

    if (debugBadge) {
      let txt = `디버그: ${debugLabel()}`;
      if (DEBUG.showAlpha) txt += `  α=${game.interpAlpha.toFixed(2)}`;
      debugBadge.textContent = txt;
    }
  });

  function updateCamera(dtMS: number): void {
    // 훔쳐보기 자동 복귀 · 입력(드래그·핀치·미니맵)이 끝나고 PEEK_RETURN_MS 지나면 무리로 돌아간다.
    // 지시 모드에서만: ?watch 관전 세계에선 수동 조망을 그대로 두는 것이 관찰에 맞다.
    if (leadMode && manualCam) {
      // 손가락이 하나라도 화면에 붙어 있거나 미니맵을 쥐고 있으면 "보는 중"이다 — 핀치에서 한
      // 손가락만 뗀 상태·미니맵을 가만히 누르고 있는 상태에서 카메라가 손 위에서 튀지 않게.
      const peekHeld = activePointers.size > 0 || minimap.panHeld;
      if (peekHeld) peekIdleMs = 0;
      else peekIdleMs += dtMS;
      if (peekIdleMs >= PEEK_RETURN_MS) manualCam = null;
    }
    // 우선순위: 훔쳐보기(manualCam) > 주 무리 따라가기.
    // 알파 고정 시점은 없어졌다 · 플레이어는 무리의 일원이 아니라 종을 주관하는 쪽이므로 카메라도
    // 한 마리에 붙지 않고 **무리를 담는다**(2026-08-04 무리 지시 전환).
    let tx: number;
    let ty: number;
    let tz: number;
    if (manualCam) {
      // 수동 조망(넓게 보도록 줌 1). 잠시 뒤 자동으로 무리에게 돌아간다(위).
      tx = manualCam.x;
      ty = manualCam.y;
      tz = 1;
    } else {
      // 흩어진 낙오자 대신 "지금 시점 근처의 주 무리"를 부드럽게 따라간다(hint=현재 카메라). 번식으로 초점이
      // 홱 튀지 않게 가중 평균을 쓴다.
      const focus = game.world.playerFocus(camX, camY);
      tx = focus.x;
      ty = focus.y;
      tz = 1;
    }
    // 사용자 줌을 모든 모드의 목표 줌에 곱한다(자동/수동 무관). 하한은 맵 크기 기준(minUserZoom) —
    // 시대가 바뀌거나 화면이 회전하면 저장된 userZoom 이 새 하한 밑일 수 있어 매 프레임 다시 조인다
    // (예: 큰 맵에서 0.5 까지 물러난 채 새 런의 작은 첫 맵으로 오면 검은 바깥이 그대로 보인다).
    userZoom = clampUserZoom(userZoom);
    tz = Math.max(minUserZoom(), Math.min(5, tz * userZoom));
    // 지시 모드에선 카메라가 무리에 바짝 붙는다(기본 3.5 는 시상수 286ms 라 화면이 물먹은 느낌이 된다).
    const ease = leadMode ? LEAD_CAM_EASE : 3.5;
    const k = Math.min(1, (dtMS / 1000) * ease); // 시간 기반 이징
    camX += (tx - camX) * k;
    camY += (ty - camY) * k;
    camZoom += (tz - camZoom) * k;
    // 월드(game.width/height)와 화면(layout) 분리 — 큰 월드의 일부만 화면에 보여준다.
    view.setCamera(camX, camY, camZoom, game.width, game.height, layout.width, layout.height);
  }

  function detectEvents(fighters: number): void {
    const w = game.world;
    const bossNow = w.boss !== null;
    if (bossNow && !prevBoss) bossBannerTick = w.tick;
    if (!bossNow) bossBannerTick = -1; // 뜨기도 전에 사라졌으면 예약을 거둔다
    if (bossBannerTick >= 0 && w.tick > bossBannerTick && w.boss) {
      bossBannerTick = -1;
      const b = w.boss;
      // 개체형=보스, 전역 재난=시련으로 알린다(시각·용어 일치).
      const kind = isPredatorBoss(b.type) ? "보스" : "시련";
      // "이 판은 잡는 판인가 버티는 판인가"를 등장하는 그 순간에 정해 준다. 지금까지는 40초 내내
      // 같은 문구만 돌고 대응법이 한 번도 안 나왔다. ⚠ 배너를 두 번 띄우면 뒤엣것이 앞엣것을
      // 덮는다(단일 슬롯 · known_issues) → 한 줄로 합친다.
      const how = !bossRaidable(b)
        ? ""
        : fighters > 0
          ? ` · 맞서는 개체 ${fighters}마리`
          : " · 맞설 수 있는 개체가 없습니다. 버티세요";
      highlights.flash(`${kind} · ${b.name}${how}`, 0xff6a4a);
    }
    // ⚠ 여기 있던 "몰기 시작하면 수풀이 우리를 숨겨 주지 않습니다" 안내 둘을 지웠다. 그 규칙은
    //   world.lead.commanded 로 켜지는데 그 값이 구조적으로 영영 false 라(무리 지시에는 모는 개체가
    //   없다) 실제로는 한 번도 안 걸린다 = 화면이 없는 규칙을 설명하고 있었다.
    // 위협(보스/시련)이 사라진 순간 = 넘긴 것(단계 전환에 드래프트가 없으니 phase 대신 boss 유무로).
    if (prevBoss && !bossNow) highlights.flash("위협을 넘겼습니다", 0x6cc24a);
    prevBoss = bossNow;

    const ext = w.globalCold > 0 ? "한파" : w.heat > 0 ? "폭염" : w.foodRegrowMultiplier > 1 ? "대가뭄" : "";
    if (ext && ext !== prevExt) highlights.flash(`대멸종. ${ext}`, 0x8ab4ff);
    prevExt = ext;

    const pop = w.playerPopulation;
    if (game.phase === "watch" && pop > 0 && pop <= 5) {
      if (!prevLowWarn) highlights.flash("멸종 위기!", 0xffba3a);
      prevLowWarn = true;
    } else if (pop > 9) {
      prevLowWarn = false;
    }

    // 레벨업 — 경험치가 차 새 형질을 고르는 순간(드래프트 팝업과 함께 눈에 띄게).
    if (game.level > prevLevel) highlights.flash(`레벨 ${game.level} 달성!`, 0xffd24a);
    prevLevel = game.level;

    // 위협 예고 전광판 — 위협 직전에 종류·대응 힌트를 크게 띄운다(같은 예고는 중복 표시 안 함).
    const threat = game.upcomingThreat;
    const threatKey = threat ? threat.title : null;
    if (threat && threatKey !== prevThreat) threatBanner.show(threat.title, threat.sub);
    prevThreat = threatKey;
  }

}

/**
 * 카드를 고른 직후의 성장 한 줄 — "속도 68 → 79 · 시야 51 → 55". 안 바뀐 게 없으면 빈 문자열.
 *
 * 값형질은 **전후를 나란히** 적는다(+11 만 적으면 지금 얼마인지 모른다 · 성장은 누적으로 느껴진다).
 * 능력형(수영·날개·초음파·독·원거리·무리·은신)은 값이 아니라 단계라 "강화/약화"로만 말한다
 * (드래프트 칩·설계도와 같은 규칙 · 낱말과 숫자를 섞으면 읽히지 않는다 · known_issues).
 * 한 줄 배너라 세 개까지만 — 그보다 많으면 화면을 덮고 아무것도 안 읽힌다.
 */
function savingLine(before: Record<Category, number>, after: Record<Category, number>): string {
  const parts: string[] = [];
  for (const cat of CATEGORIES) {
    const d = after[cat] - before[cat];
    if (d === 0) continue;
    const left = pipsToNext(after[cat]);
    const tier = tierOf(after[cat]);
    const tail =
      left > 0
        ? ` · ${TIER_ROMAN[Math.min(4, tier + 1)]}까지 ${left}개`
        : " · 더 오를 데가 없습니다";
    parts.push(`${CATEGORY_LABELS[cat]} 도장 ${d > 0 ? "+" : "−"}${Math.abs(d)}${tail}`);
    if (parts.length >= 2) break;
  }
  return parts.join(" · ");
}

/** 불씨 점 5칸: 남은 만큼 ●, 꺼진 만큼 ○. */
function emberDots(n: number): string {
  const k = Math.max(0, Math.min(GAME.emberMax, n));
  return "●".repeat(k) + "○".repeat(GAME.emberMax - k);
}

boot().catch((err: unknown) => {
  console.error("부트 실패:", err);
});
