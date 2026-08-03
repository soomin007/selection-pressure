// 부트스트랩. PixiJS v8 앱 + scale-to-fit 뷰포트 + 게임 상태기계 + 셸 UI(로비/멈춤/배속).
//
// 코어 시뮬은 동일. 모바일(세로)/데스크톱(가로)은 논리 해상도와 UI 만 다르다(chooseLayout).
// 월드는 스케일 컨테이너(root)에, HUD/UI 는 화면 픽셀 그대로(선명).

import { Application, Container, Graphics } from "pixi.js";
import { chooseLayout, COLORS, uiScale } from "@/config";
import { DEBUG, DEBUG_ACTIVE, TUNE, debugLabel } from "@/debug";
import { setupViewport } from "@/render/viewport";
import { WorldView } from "@/render/worldView";
import { createGoalBar } from "@/ui/goalBar";
import { Game, type ExtinctionType, type TrialKind } from "@/game/game";
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
import { createGlossary } from "@/ui/glossary";
import { equippedCosmetic, mythicNamesUnlocked } from "@/game/achievements";
import { setMythicNames } from "@/ui/creatureName";
import { describeSpecies } from "@/game/runReport";
import { Highlights } from "@/render/highlights";
import { Effects } from "@/render/effects";
import { Minimap } from "@/render/minimap";
import { ThreatBanner } from "@/render/threatBanner";
import { TRAIT_LABELS } from "@/sim/genome";
import { APEX_BOON } from "@/ui/traitDisplay";
import { isPredatorBoss } from "@/sim/boss";
// 탭 명령의 사냥 판정 — 화면에서 규칙을 다시 유도하지 않고 sim 의 판정 함수를 그대로 부른다(순수 질의).
import { leadRelation } from "@/sim/behavior";
import { leadCapsOf } from "@/render/leadVision";
import type { LeadCommand } from "@/sim/lead";
import type { Entity } from "@/sim/entity";

// 맵 배율 — 월드를 화면의 이 배수만큼 크게. 소수 개체(한 무리)를 카메라가 따라가며 탐험. 바이옴(사막·빙하·
// 우림)이 뚜렷한 구역으로 펼쳐지도록 넓게. 개체는 절대 수(소수)라 먹이 밀도·상한만 면적 비례(areaScale).
const MAP_SCALE = 2.0;

// --- 알파 조종(기본 모드) 전용 화면·입력 상수. 밸런스가 아니라 "손끝 느낌"과 표시에만 쓰인다. ---
// 조종 중 카메라 줌. 2.2 로 올렸더니 "캐릭터가 너무 크고 밀도가 높다"(2026-08-02 폰 실기) — 한 단계
// 내린다. 탭 판정 반경은 화면 픽셀 기준으로 일정해서(pickEntity) 줌을 내려도 조작감은 안 나빠진다.
const LEAD_ZOOM = 1.8;
const LEAD_CAM_EASE = 9; // 조종 중 카메라 이징(기본 3.5 는 시상수 286ms 라 물먹은 느낌의 주범)
const LEAD_SNAP_MS = 400; // 승계 직후 이 시간 동안은 기본 이징으로(화면이 홱 튀는 것 완화)
const LEAD_BANNER_DELAY_MS = 3000; // "아무도 안 따라옵니다" 안내까지의 유예(바로 띄우면 잔소리)
const PEEK_RETURN_MS = 1500; // 훔쳐보기(드래그·미니맵·2손가락 팬) 입력이 끝나고 알파로 복귀까지의 시간
const MOVE_ARRIVE_PX = 12; // 이동 명령 도착 판정 — 이 안이면 명령 완료(제자리 맴돌이 방지)
const MOVE_SLOW_PX = 40; // 목표 이 거리 안부터 감속(급정거 대신 스르륵 도착)
const MOVE_MIN_THROTTLE = 0.35; // 감속 하한 — 너무 늦으면 도착 직전에 기는 느낌이 든다
const WAYPOINT_PX = 8; // 경로 웨이포인트 통과 판정 — 이 안이면 다음 웨이포인트로

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

  // 소수 개체 게임: 월드를 약간 크게(MAP_SCALE) + 개체는 절대 수(소수)지만 먹이 밀도·상한은 면적 비례
  // (areaScale=면적배율) → 큰 맵일수록 개체당 먹이가 넉넉해 굶지 않는다. 카메라가 한 무리를 따라다닌다.
  const game = new Game(layout.width * MAP_SCALE, layout.height * MAP_SCALE, MAP_SCALE * MAP_SCALE);

  // 디버그: URL 에 ?seed=… 가 있으면 그 시드로 고정(맵·카드·보스 완전 재현). 없으면 런마다 랜덤.
  const seedParam = new URLSearchParams(window.location.search).get("seed");
  if (seedParam) game.fixedSeed = seedParam;

  // 알파 조종(기본값) — URL·DOM 은 여기까지만 읽고, sim 에는 불리언 하나만 넘어간다.
  // ?watch 로 끄면 game.leadEnabled 가 false 라 world.lead.leaderId 가 영영 -1 이고, 아래 조종 코드는
  // 전부 첫 줄에서 빠진다 = 조작 없는 예전 관전 세계와 문자 그대로 동일하게 돈다(밸런스 비교용).
  const leadMode = DEBUG.leadControl;
  game.leadEnabled = leadMode;
  // ?follow=<수> 로 "무리가 얼마나 따라오는가"를 배포 없이 폰에서 바로 바꿔 본다. 안 붙이면 NaN 이라
  // sim 기본값(LEAD.followCohesion)을 그대로 쓴다.
  if (leadMode && Number.isFinite(TUNE.leadFollow)) game.leadFollowWeight = TUNE.leadFollow;

  // 훔쳐보기 카메라 — 드래그·미니맵·2손가락 팬으로 잠깐 다른 곳을 본다. 입력이 끝나고
  // PEEK_RETURN_MS 지나면 알파에게 자동 복귀한다(카메라는 기본이 "항상 알파 고정"이다).
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
      traits: game.genome.traits,
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

  const draft = createDraftPanel(app.renderer, app.canvas, {
    onPick: (i) => {
      game.pickCard(i);
      refreshBuild(); // 방금 고른 카드를 빌드 패널(설계도=최신 게놈)에 반영
      // 세대별 형질: 텍스처를 새로 만들지 않는다 — 이미 태어난 개체는 옛 모습을 유지하고, 이후 태어난
      // 개체가 새 게놈 서명으로 lazy 생성된다(worldView.textureFor). refreshSpecies(전체 교체)는 안 부른다.
      draft.hide();
      // **정점(만렙) 도달** — 반드시 draft.hide() 뒤에. 드래프트 화면이 떠 있는 동안 띄우면 카드 뒤에
      // 가려 아무도 못 본다. 한 카드가 둘을 동시에 올리는 일은 드물지만, 생기면 차례로 보여준다
      // (하나만 띄우고 나머지를 삼키면 무엇이 열렸는지 영영 모른다).
      game.takeNewApex().forEach((key, k) => {
        const boon = APEX_BOON[key] ?? "";
        const value = game.genome.traits[key];
        if (k === 0) moment.apex(TRAIT_LABELS[key], value, boon);
        else window.setTimeout(() => moment.apex(TRAIT_LABELS[key], value, boon), k * 2300);
      });
    },
    onSkip: () => {
      // 스킵 — 형질 대신 새끼 몇 마리를 낳고 관전으로 복귀.
      game.skipDraft();
      refreshBuild();
      draft.hide();
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
      game.continueToNextEra();
      refreshBuild();
      controls.setVisible(true);
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
  });

  game.onDraft = (cards, preview) => {
    // 시작 프리셋 선택은 캐릭터 선택 창, 레벨업 형질은 일반 카드 창.
    // 드래프트 화면은 게임 객체를 모른다 — 그릴 때 필요한 종 상태만 넘긴다(레벨 = 세대).
    // 시작 종을 고르는 화면엔 "이번 세계"(대륙·판게아·군도·대양 + 바다 비율)를 함께 띄운다 —
    // 세계를 보고 종을 고르는 게 이 게임이라, 모르고 고르면 선택이 아니라 운이 된다.
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
  const TRIAL_WORD: Record<TrialKind, string> = { hunt: "사냥", feed: "먹이", birth: "새끼", pop: "무리" };
  // priority=true: 같은 프레임에 다음 단계(보스) 등장 플래시가 이어져도 판정이 덮이지 않고 끝까지 보인다.
  game.onTrialVerdict = (v) => {
    if (v.passed) highlights.flash(`시험 합격 · ${v.trial.label}`, 0x8fd14f, true);
    else
      highlights.flash(
        `시험 불합격 · ${TRIAL_WORD[v.trial.kind]} ${Math.min(v.progress, v.trial.target)}/${v.trial.target} · 불씨 1을 잃었습니다`,
        0xffba3a,
        true,
      );
  };
  // 승리·정복·멸종 순간 연출 — 결과 패널 직전에 전역 화면 클라이맥스를 얹는다.
  const moment = createMomentOverlay();
  // 런 종료 진척도 화면 — 순간 연출 다음, 결과(사망 원인) 화면 직전에 경험치바·레벨업·해금을 보여준다.
  const levelScreen = createLevelUpScreen();
  game.onResult = (res, summary, canContinue, progress, achievements) => {
    controls.setVisible(false);
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
  const clampUserZoom = (z: number): number => Math.max(0.5, Math.min(3.5, z));
  // 알파 조종 표시 상태 — onWorldChanged 가 game.start()에서 곧장 불려 이 값들을 초기화하므로,
  // 그 콜백보다 반드시 먼저 선언한다(아래쪽에 두면 TDZ ReferenceError 로 부팅이 죽는다 — known_issues).
  let leadZeroMs = 0; // 아무도 안 따라오는 상태가 이어진 시간(ms)
  let leadZeroShown = false; // 그 안내를 이번 월드에서 이미 띄웠나(한 번만)
  let prevLeadChanged = -1; // 직전 프레임의 world.lead.changedTick — 바뀌면 승계가 일어난 것
  let leadSnapMs = 0; // 승계 직후 카메라를 기본 이징으로 두는 남은 시간(ms)
  let prevCommanded = false; // 직전 프레임의 world.lead.commanded — false→true 가 "몰기 시작한 순간"
  // 탭 명령 상태 — 동시에 하나만 산다(새 탭이 이전 명령을 대체). sim 은 이 상태의 존재를 모른다:
  // 이동은 입력층이 매 프레임 LeadCommand{dx,dy,throttle} 로 번역하고, 사냥은 targetId 로만 흘려보낸다.
  // ⚠ onWorldChanged 가 game.start() 에서 곧장 이 값들을 초기화하므로 그 콜백보다 먼저 선언한다(TDZ).
  let moveOrder: { x: number; y: number } | null = null; // 이동 명령 목표(월드 좌표)
  let huntOrder: { id: number } | null = null; // 사냥 명령(개체 잠금 — 대상 사망·길 끊김·새 탭까지 유지)
  // 이동 경로 캐시 — (알파 타일, 목표 타일)이 같은 동안 BFS 를 다시 돌리지 않는다(매 프레임 호출이라).
  let movePath: { key: string; tiles: number[]; idx: number } | null = null;
  let tapHintShown = false; // "탭 = 명령" 안내(런당 1회) 표시 여부
  let emberHintShown = false; // "불씨 = 남은 기회" 첫 안내(런당 1회) 표시 여부
  let emberHintMs = 0; // 관전 진입 후 그 안내까지의 대기 시간(탭 안내 플래시를 덮지 않게 늦춘다)

  game.onWorldChanged = (world) => {
    view.drawEnvironment(world);
    view.refreshSpecies(world);
    goalBar.collapse(); // 새 월드 = 상세 패널 접기(낡은 수치가 열린 채 남지 않게)
    effects.clear();
    moment.clear(); // 멸종 암전 등 남은 순간 연출을 지운다(새 월드 시작).
    levelScreen.clear(); // 진척도 화면도 닫는다(혹시 남아 있으면).
    reportScreen.hide(); // 이전 혈통의 보고서 화면이 남아 있으면 닫는다.
    // 새 월드 → 옛 명령(좌표·개체 id)은 무효. 훔쳐보기도 알파로 복귀.
    moveOrder = null;
    huntOrder = null;
    movePath = null;
    manualCam = null;
    // 알파 조종 표시 상태 초기화 — 새 월드에선 안내를 다시 한 번 띄울 수 있고, 승계 감지도 처음부터.
    leadZeroShown = false;
    leadZeroMs = 0;
    prevLeadChanged = -1;
    prevCommanded = false; // 새 월드 = commanded 도 false 로 다시 시작(단계마다 새 월드다)
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

  // 하이라이트 이벤트 감지 상태(카메라 변수는 위에서 onWorldChanged 보다 먼저 선언했다).
  let prevBoss = false;
  let prevExt = "";
  let prevLowWarn = false;
  let prevLevel = game.level;
  let prevThreat: string | null = null;

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

  app.stage.on("pointerdown", (e) => {
    if (game.phase !== "watch" && game.phase !== "draft") return;
    if (e.target !== app.stage || onCanvasUI(e.global.x, e.global.y)) return;
    activePointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
    if (activePointers.size === 1) {
      dragStart = { sx: e.global.x, sy: e.global.y, camX, camY };
      dragging = false;
    } else if (activePointers.size === 2) {
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
      if (!dragging && Math.hypot(dx, dy) > 8) dragging = true; // 탭/드래그 구분 임계
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
    issueOrder(p.x, p.y);
  };
  app.stage.on("pointerup", endPointer);
  app.stage.on("pointerupoutside", endPointer);

  /**
   * 탭 지점을 명령으로 해석한다 — 동시에 하나만: 사냥할 수 있는 개체면 사냥 잠금, 그 외 전부
   * (빈 땅·내 무리·못 사냥하는 상대)는 그 지점으로 이동. 목표가 못 가는 지형이거나 길이 없으면
   * 명령을 바꾸지 않고 거부 핑만 띄운다(왜 안 가는지 그 자리에서 보이게).
   */
  function issueOrder(wx: number, wy: number): void {
    const lead = findLeadEntity();
    if (!lead) return;
    const picked = pickEntity(wx, wy);
    if (picked && picked.id !== lead.id) {
      // 사냥 판정은 sim 의 leadRelation 그대로 — 화면에서 규칙을 다시 유도하면 브래킷과 어긋난다.
      const rel = leadRelation(lead, picked);
      if (rel.prey || rel.tough) {
        // 대상까지 실제로 갈 수 있어야 잠근다 — 물 건너 물고기처럼 길이 없는 상대를 잠그면
        // "명령이 걸렸는데 아무 일도 안 일어나는" 유령 잠금이 된다(반박 검증에서 확인된 사고).
        if (!reachableFrom(lead, picked.x, picked.y)) {
          effects.spawnPing(picked.x, picked.y, "deny");
          return;
        }
        huntOrder = { id: picked.id };
        moveOrder = null;
        movePath = null;
        return;
      }
    }
    // 이동 명령 — 알파의 통행 능력으로 목표 지형과 길을 검사한다(불가능한 약속을 하지 않게).
    if (!reachableFrom(lead, wx, wy)) {
      effects.spawnPing(wx, wy, "deny");
      return;
    }
    moveOrder = { x: wx, y: wy };
    huntOrder = null;
    movePath = null; // 경로 캐시는 실행부(steerToMoveOrder)가 필요할 때 다시 만든다
    effects.spawnPing(wx, wy, "go");
  }

  /** 알파가 (gx, gy)까지 실제로 갈 수 있나 — 목표 지형 통행 + (직선 또는 BFS 길) 검사.
   *  이동·사냥 명령이 같은 기준을 쓴다(한쪽만 조이면 두 명령의 약속이 서로 어긋난다). */
  function reachableFrom(lead: Entity, gx: number, gy: number): boolean {
    const caps = leadCapsOf(lead.genome);
    const terrain = game.world.terrain;
    if (!terrain.isPassable(gx, gy, caps.canSwim, caps.canLand, caps.canFly)) return false;
    if (terrain.lineOfSight(lead.x, lead.y, gx, gy, caps.canSwim, caps.canLand, caps.canFly)) return true;
    // 직선이 막혔으면 길이 실제로 있는지 BFS 로 확인. 같은 타일 안이면 길 확인이 필요 없다.
    if (terrain.tileIndex(lead.x, lead.y) === terrain.tileIndex(gx, gy)) return true;
    return terrain.findPath(lead.x, lead.y, gx, gy, caps.canSwim, caps.canLand, caps.canFly).length > 0;
  }

  /** 알파 개체를 찾는다(없으면 null — 승계 공백·관전 모드). 명령 해석과 조향이 같은 근거를 쓴다. */
  function findLeadEntity(): Entity | null {
    return findEntityById(game.world.lead.leaderId);
  }

  /** id 로 개체를 찾는다(선형 탐색 — 프레임당 몇 번뿐이라 충분). 죽어 정리됐으면 null. */
  function findEntityById(id: number): Entity | null {
    if (id < 0) return null;
    for (const en of game.world.entities) {
      if (en.id === id) return en;
    }
    return null;
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

  // E 키를 누르고 있는 동안만 자동 물기 명령이 나간다(유지 입력 — 프레임률·배속과 무관).
  // 실제로 몇 번 무는지는 sim 의 쿨다운(AI 와 같은 값)이 정한다. 탭 사냥 명령과 별개의 보조 경로다.
  let biteKeyHeld = false;

  // 눌러 유지하는 조향 — keys.ts 라우터는 keydown 전용이라 keyup 만 window 에서 따로 듣는다.
  // (새 키 레이어를 등록하면 열린 첫 레이어에서 무조건 return 하는 구조 탓에 기존 관전 키가 통째로 죽는다.)
  // blur 초기화를 빼먹으면 탭을 바꾼 뒤 알파가 영원히 한 방향으로 간다.
  const heldDirs = new Set<string>();
  const DIR_CODES: ReadonlySet<string> = new Set([
    "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  ]);
  if (leadMode) {
    window.addEventListener("keyup", (ev: KeyboardEvent) => {
      heldDirs.delete(ev.code);
      if (ev.code === "KeyE") biteKeyHeld = false;
    });
    window.addEventListener("blur", () => {
      heldDirs.clear();
      biteKeyHeld = false;
    });
  }

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
      // 조종 모드에서만 방향키·WASD 가 조향이 된다. ?watch 에선 아래 switch 만 남는다.
      if (leadMode && DIR_CODES.has(e.code)) {
        // 손 조향이 새로 잡히는 순간 이동 명령은 취소한다(손이 명령보다 우선). 사냥 잠금은 유지 —
        // 잠근 대상 쪽으로 직접 몰아가는 것이 자연스러운 사용법이기 때문이다.
        if (!heldDirs.has(e.code)) {
          moveOrder = null;
          movePath = null;
        }
        heldDirs.add(e.code);
        manualCam = null; // 조향이 들어오면 훔쳐보기를 풀고 카메라가 알파로 돌아온다
        return true;
      }
      // 물기(E) — 조종 모드에서만. 누르고 있는 동안 계속 나가고, 떼는 것은 위 window keyup 이 받는다.
      // 관전 레이어에서 안 쓰던 키라 기존 조작(Space·F·B·[ ]·숫자·+/−·Esc·Q·G)을 하나도 안 뺏는다.
      if (leadMode && e.code === "KeyE") {
        biteKeyHeld = true;
        return true;
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

  // 손을 뗀 뒤 타력으로 나아가는 시간(ms). 0 이면 키를 떼는 그 순간 개체가 완전한 자율로 돌아가
  // 도망 로직이 켜지는데, 방향을 바꾸려고 W 를 떼고 A 를 누르는 그 찰나에도 그렇게 된다 —
  // 상어가 옆에 있으면 알파가 내 손을 벗어나 반대로 달아난다(실기 피드백 2026-08-01).
  // 타력이 있으면 키를 갈아 쥐는 동안엔 계속 내 뜻대로 가고, 정말로 놓으면 서서히 자율로 돌아간다.
  const COAST_MS = 420;
  let coastMs = 0;
  let coastDx = 0;
  let coastDy = 0;

  /**
   * 이번 프레임의 조종 명령. **유지 입력(레벨)**이라 프레임률·배속과 무관하게 안전하다 —
   * 한 프레임이 0틱이든 15틱이든 같은 명령을 보므로 입력이 씹히지도 중복되지도 않는다.
   *
   * 우선순위: 손 조향(WASD·화살표) > 이동 명령 조향 > 사냥 명령 조향 > 타력(coast — 손을 뗀 직후용).
   * 사냥 명령(huntOrder)은 bite:true + targetId 를 매 프레임 다시 보내고(레벨 입력 — sim 은 저장하지
   * 않는다), **추격의 이동도 여기(입력층)가 몰아간다.** sim 에 맡기면 두 가지가 어긋난다는 게 반박
   * 검증에서 확인됐다: ① sim 은 겨눔 범위 안에서만 targetPrey 를 세운다(범위 밖 탭 = 유령 잠금)
   * ② 범위 안이라도 더 가까운 먹잇감이 있으면 chooseGoal 히스테리시스가 이동 목표를 가로채
   * 알파가 엉뚱한 놈 옆을 맴돈다. "물기"만은 여전히 sim 의 단일 경로(resolveBite)다.
   * 아무 명령도 입력도 없으면 null → "명령이 전혀 없는 세계는 기존과 동일"이 그대로 성립한다.
   */
  function buildLeadCommand(dtMS: number): LeadCommand | null {
    if (!leadMode || game.phase !== "watch" || game.paused) {
      coastMs = 0;
      return null;
    }
    const bite = biteKeyHeld;
    // 1) 손 조향이 최우선 — 잡히는 순간 이동 명령을 밀어낸다(사냥 잠금은 유지: 잠근 상대 쪽으로
    //    직접 몰아가는 것이 자연스러운 사용법이라서).
    if (heldDirs.size > 0) {
      let kx = 0;
      let ky = 0;
      if (heldDirs.has("KeyA") || heldDirs.has("ArrowLeft")) kx -= 1;
      if (heldDirs.has("KeyD") || heldDirs.has("ArrowRight")) kx += 1;
      if (heldDirs.has("KeyW") || heldDirs.has("ArrowUp")) ky -= 1;
      if (heldDirs.has("KeyS") || heldDirs.has("ArrowDown")) ky += 1;
      const len = Math.hypot(kx, ky);
      if (len > 0) {
        moveOrder = null;
        movePath = null;
        const dx = kx / len;
        const dy = ky / len;
        // 타력을 만땅으로 채워 두고 방향을 기억한다(키를 갈아 쥐는 찰나에 자율로 안 돌아가게).
        coastMs = COAST_MS;
        coastDx = dx;
        coastDy = dy;
        return huntOrder
          ? { dx, dy, throttle: 1, bite: true, targetId: huntOrder.id }
          : { dx, dy, throttle: 1, bite };
      }
    }
    // 2) 이동 명령 — 다음 웨이포인트 방향으로 번역한다(sim 은 이동 명령의 존재를 모른다).
    //    이동과 사냥은 동시에 못 산다(issueOrder 가 보장) — 여기서 targetId 를 실을 일은 없다.
    if (moveOrder) {
      const steer = steerToMoveOrder();
      if (steer) {
        coastMs = 0; // 명령 조향은 타력을 안 남긴다 — 도착 지점을 지나쳐 밀리지 않게
        return { dx: steer.dx, dy: steer.dy, throttle: steer.throttle, bite };
      }
    }
    // 3) 사냥 명령 — 잠근 대상의 현재 위치로 몰아간다(이동 명령과 같은 길찾기). 닿으면 sim 이 문다.
    if (huntOrder) {
      const steer = steerToHuntOrder();
      if (steer) {
        coastMs = 0;
        return { dx: steer.dx, dy: steer.dy, throttle: steer.throttle, bite: true, targetId: huntOrder.id };
      }
      // 조향이 없어도(코앞 밀착 등) 명령이 살아 있으면 잠금만 흘려보낸다 — bite 가 함께 실리므로
      // sim 의 무리 추종·수풀 봉인은 유지된다(사냥 중 대열이 끊기지 않게). steerToHuntOrder 가
      // 명령을 접었을 수도 있어(대상 사망·길 끊김) 다시 확인한다.
      if (huntOrder) return { dx: 0, dy: 0, throttle: 0, bite: true, targetId: huntOrder.id };
    }
    // 4) 입력 없음 — 남은 타력만큼 마지막 방향으로 힘이 빠지며 나아간다(1 → 0 선형. WASD 릴리즈용 —
    //    방향을 바꾸려 키를 떼는 찰나에 알파가 자율로 돌아가 반대로 달아나는 사고를 막는다).
    if (coastMs > 0) {
      coastMs = Math.max(0, coastMs - dtMS);
      if (coastMs > 0) {
        const throttle = coastMs / COAST_MS;
        return { dx: coastDx, dy: coastDy, throttle, bite };
      }
    }
    // 5) E 키 자동 물기 — 대상 지정 없이 가장 가까운 상대를 무는 기존 경로 그대로.
    if (!bite) return null;
    return { dx: 0, dy: 0, throttle: 0, bite: true };
  }

  /**
   * 이동 명령을 이번 프레임의 조향으로 번역한다. 도착했거나(≤ MOVE_ARRIVE_PX) 길이 사라졌으면
   * 명령을 스스로 거두고 null. terrain 길찾기는 순수 질의(rng 무관)라 입력층이 불러도 결정론과
   * 무관하고, BFS 는 (알파 타일, 목표 타일)이 같은 동안 캐시로 아낀다.
   */
  function steerToMoveOrder(): { dx: number; dy: number; throttle: number } | null {
    const mo = moveOrder;
    if (!mo) return null;
    const lead = findLeadEntity();
    if (!lead) return null;
    const distGoal = Math.hypot(mo.x - lead.x, mo.y - lead.y);
    if (distGoal <= MOVE_ARRIVE_PX) {
      moveOrder = null;
      movePath = null;
      return null;
    }
    const dir = steerToward(lead, mo.x, mo.y);
    if (!dir) {
      // 명령을 받을 땐 길이 있었는데 지금은 없다(승계로 통행 능력이 바뀐 경우 등). 못 지키는
      // 명령은 접는다 — 벽에 머리를 박고 서 있는 것보다 낫다.
      moveOrder = null;
      movePath = null;
      return null;
    }
    // 목표 근처에선 감속 — 급정거 대신 스르륵 도착(도착 판정 안은 위에서 이미 명령 완료로 접었다).
    const throttle = distGoal < MOVE_SLOW_PX ? Math.max(MOVE_MIN_THROTTLE, distGoal / MOVE_SLOW_PX) : 1;
    return { dx: dir.dx, dy: dir.dy, throttle };
  }

  /**
   * 사냥 명령의 이동 — 잠근 대상의 **현재 위치**로 몰아간다(움직이는 목표라 매 프레임 다시 겨눈다).
   * 대상이 죽었으면 명령을 접고, 길이 끊겼으면(물 건너 도망 등) 거부 핑과 함께 접는다 — 소리 없이
   * 사라지는 유령 잠금을 만들지 않는다. 감속 없이 끝까지 미는 것이 사냥이다(물기는 sim 이 사거리에서).
   */
  function steerToHuntOrder(): { dx: number; dy: number; throttle: number } | null {
    const ho = huntOrder;
    if (!ho) return null;
    const lead = findLeadEntity();
    if (!lead) return null;
    const target = findEntityById(ho.id);
    if (!target || !target.alive) {
      huntOrder = null;
      movePath = null;
      return null;
    }
    const dir = steerToward(lead, target.x, target.y);
    if (!dir) {
      effects.spawnPing(target.x, target.y, "deny");
      huntOrder = null;
      movePath = null;
      return null;
    }
    return { dx: dir.dx, dy: dir.dy, throttle: 1 };
  }

  /**
   * (공용) 알파에서 목표 지점으로의 이번 프레임 조향 방향. 직선이 뚫려 있으면 직진, 막혔으면 BFS
   * 웨이포인트를 따른다. 길이 없으면 null — 호출한 명령이 스스로 접는다. terrain 질의는 전부
   * 순수(rng 무관)라 입력층이 불러도 결정론과 무관하고, BFS 는 (알파 타일, 목표 타일)이 같은 동안
   * 캐시로 아낀다. 이동·사냥 명령은 동시에 하나뿐이라 movePath 캐시를 공유해도 안전하다.
   */
  function steerToward(lead: Entity, gx: number, gy: number): { dx: number; dy: number } | null {
    const caps = leadCapsOf(lead.genome);
    const terrain = game.world.terrain;
    // 웨이포인트: 직선이 뚫려 있으면 목표 그 자체, 막혔으면 BFS 경로의 다음 타일 중심.
    let wpX = gx;
    let wpY = gy;
    if (!terrain.lineOfSight(lead.x, lead.y, gx, gy, caps.canSwim, caps.canLand, caps.canFly)) {
      const startTile = terrain.tileIndex(lead.x, lead.y);
      const goalTile = terrain.tileIndex(gx, gy);
      const key = `${startTile}>${goalTile}`;
      if (!movePath || movePath.key !== key) {
        const tiles = terrain.findPath(lead.x, lead.y, gx, gy, caps.canSwim, caps.canLand, caps.canFly);
        if (tiles.length === 0 && startTile !== goalTile) return null;
        movePath = { key, tiles, idx: 0 };
      }
      // 이미 지난 웨이포인트(WAYPOINT_PX 안)는 건너뛰고 다음 것을 겨눈다. 경로 끝까지 지났으면
      // 목표 지점으로 직진(마지막 타일과 목표는 같은 타일 안이다).
      while (movePath.idx < movePath.tiles.length) {
        const ti = movePath.tiles[movePath.idx]!;
        const cx = terrain.tileCenterX(ti);
        const cy = terrain.tileCenterY(ti);
        if (Math.hypot(cx - lead.x, cy - lead.y) > WAYPOINT_PX) {
          wpX = cx;
          wpY = cy;
          break;
        }
        movePath.idx += 1;
      }
    } else {
      movePath = null;
    }
    const dxr = wpX - lead.x;
    const dyr = wpY - lead.y;
    const len = Math.hypot(dxr, dyr);
    if (len < 1e-6) return null;
    return { dx: dxr / len, dy: dyr / len };
  }

  /**
   * 사냥 명령의 수명 — 대상이 죽어 사라지면 접는다. 추격은 매 프레임 조향(steerToHuntOrder)이
   * 잠금을 유지한 채 책임지므로, "겨눔에서 벗어나면 시한 해제" 같은 유예는 더 없다. 취소는
   * 새 탭·단계 전환·승계·길 끊김뿐이다.
   */
  function resolveHuntOrder(): void {
    const ho = huntOrder;
    if (!ho) return;
    const target = findEntityById(ho.id);
    if (!target || !target.alive) {
      huntOrder = null;
      if (!moveOrder) movePath = null;
    }
  }

  app.ticker.add((ticker) => {
    // 키·손가락 잔류 누수 방지 — 드래프트·멈춤으로 넘어가는 순간 눌려 있던 입력을 비운다.
    // (안 비우면 카드를 고르는 동안 알파가 계속 한쪽으로 달린다.)
    if (leadMode && (game.phase !== "watch" || game.paused)) {
      heldDirs.clear();
      // 물기도 같이 푼다 — 카드를 고르는 동안 눌린 상태가 남으면 관전으로 돌아오는 순간 물어 버린다.
      biteKeyHeld = false;
      // 탭 명령도 청소 — 단계를 넘거나 멈춘 순간, 낡은 좌표·개체 잠금이 다음 관전까지 살아남지 않게.
      moveOrder = null;
      huntOrder = null;
      movePath = null;
    }
    game.setLeadCommand(buildLeadCommand(ticker.deltaMS)); // update 직전 — 이번 프레임의 모든 틱이 같은 명령을 본다
    game.update(ticker.deltaMS);
    // 사냥 명령 수명 판정은 update 직후 — 방금 틱에 대상이 죽었으면 이번 프레임 안에 접는다.
    resolveHuntOrder();
    view.sync(game.world, game.interpAlpha, ticker.deltaMS);
    view.setMoveTarget(moveOrder); // 이동 명령 깃발(렌더) — 명령이 없으면 null 로 지운다
    // 사건 연출: sim 이 이번 프레임에 emit 한 사건(탄생/죽음/잡아먹힘)을 효과로 옮기고 비운다.
    for (const ev of game.world.events) effects.spawn(ev.kind, ev.x, ev.y, ev.mine, ev.tx, ev.ty);
    game.world.events.length = 0;
    effects.update(ticker.deltaMS);
    // --- 목표 한 줄 — "지금 뭘 해야 하나"를 게임 상태에서 자동으로 뽑는다(상시 화면의 전부) ---
    {
      const gw = game.world;
      let mineCount = 0;
      let wildCount = 0;
      for (const en of gw.entities) {
        if (!en.alive) continue;
        if (en.species.isPlayer) mineCount += 1;
        else wildCount += 1;
      }
      const gBoss = gw.boss;
      // 대멸종 판정은 detectEvents 의 플래시와 같은 근거를 읽는다(다른 조건으로 재유도하면 어긋난다).
      const extName =
        gw.globalCold > 0 ? "한파" : gw.heat > 0 ? "폭염" : gw.foodRegrowMultiplier > 1 ? "대가뭄" : gw.plagueRate > 0 ? "역병" : "";
      let goalText: string;
      let goalSub: string;
      if (gBoss) {
        goalText = `위협: ${gBoss.name}`;
        goalSub =
          gBoss.maxHp > 0 && gBoss.hp > 0
            ? "몸 위의 체력 바를 다 깎으면 물리칩니다. 못 깎아도 버티면 통과합니다."
            : "시간이 다 될 때까지 살아남으면 통과합니다.";
      } else if (extName) {
        goalText = `큰 시험: ${extName}`;
        goalSub = "환경이 통째로 바뀌었습니다. 시간이 다 될 때까지 버티세요.";
      } else {
        // 라운드 시험: "이번 16초가 답해야 할 질문"을 목표 줄로. 진행 숫자는 sim 계수기 그대로.
        // sub 는 **불씨 하나만** 싣는다. 예전엔 "다음 카드까지 %"를 같이 실었는데, 그 값은 펼침 패널에
        // 막대와 함께 또 있어 같은 것을 두 번 보여줬다(상시 화면에 진척 지표가 셋이라 어수선했다).
        const t = game.trial;
        goalText = t
          ? `이번 시험: ${t.label} (${Math.min(game.trialProgress, t.target)}/${t.target})`
          : "무리를 먹여 키우세요";
        goalSub = `불씨 ${emberDots(game.embers)}`;
      }
      goalBar.update({
        visible: game.phase === "watch",
        text: goalText,
        sub: goalSub,
        stage: `${game.eraLabel ? `${game.eraLabel} · ` : ""}${game.stageLabel}`,
        level: game.level,
        xp01: game.xpProgress,
        mine: mineCount,
        wild: wildCount,
        followers: leadMode ? gw.lead.followerCount : -1,
        seconds: game.secondsLeft,
        night: gw.daylight < 0.5,
      });
    }
    // 불씨 첫 안내(런당 1회): "불씨"라는 말은 처음 나올 때 한 번 풀이한다(UI 문구 규칙).
    if (game.phase === "watch" && game.trial && !emberHintShown) {
      emberHintMs += ticker.deltaMS;
      if (emberHintMs >= 3500) { // 탭 안내 플래시(2200ms)와 겹쳐 덮어쓰지 않게 뒤로 미룬다
        emberHintShown = true;
        // priority: "불씨"의 유일한 첫 풀이라 레벨업·위협 플래시가 끼어들어도 끝까지 읽혀야 한다.
        highlights.flash("불씨는 이 혈통의 남은 기회입니다. 시험에 지면 하나 꺼집니다.", 0xf0f8ff, true);
      }
    }
    // 내 형질 패널은 관전 중 + 칩이 켜져 있을 때만 — 드래프트는 전체 화면이라 그 아래 깔린 UI 가
    // 뿌연 유리로 비쳐 보인다. 드래프트 중 내 종 정보는 헤더의 "내 종" 팝업이 대신한다(핸드오프 §9).
    buildPanel.setVisible(game.phase === "watch" && traitsOpen);

    // --- 알파 조종: 화면 안에서 알아채게 하는 것들(칩·안내·승계 알림) ---
    if (leadMode && game.phase === "watch") {
      // 따르는 수는 sim 이 규칙을 판정한 그 자리에서 센 값이다(마지막 틱 기준). 표시는 goalBar 패널.
      const followers = game.world.lead.followerCount;
      let mine = 0;
      for (const en of game.world.entities) {
        if (en.species.isPlayer) mine += 1;
      }
      // 첫 관전 진입 안내(런당 1회) — 탭이 곧 명령이라는 것은 화면만 봐서는 알 수 없으니 한 번 알려 준다.
      if (!tapHintShown) {
        tapHintShown = true;
        highlights.flash("땅을 탭하면 이동합니다 · 먹잇감을 탭하면 사냥합니다", 0xf0f8ff);
      }
      // 조종 중인데 아무도 안 따라오면 잠시 뒤 한 번만 알려 준다. 시작 종 여덟 중 다섯이
      // 무리 성향 0 이라, 모르면 "조작은 되는데 왜 나 혼자지"로 끝난다.
      // ⚠ 원인을 단정하지 않는다 — 무리 성향이 0 일 때만 그것을 이유로 대고, 그 밖에는 본 대로만
      //   말한다(형질이 있어도 달아나는 중이거나 흩어져 있으면 따르는 수가 0 으로 나온다).
      if (followers === 0 && mine > 1 && game.world.lead.followTicks > 0) {
        leadZeroMs += ticker.deltaMS;
        if (leadZeroMs >= LEAD_BANNER_DELAY_MS && !leadZeroShown) {
          highlights.flash(
            game.world.genome.traits.herding <= 0
              ? "무리 성향이 0 입니다. 앞장서도 아무도 따라오지 않습니다."
              : "지금은 아무도 따라오지 않습니다. 무리가 흩어져 있거나 달아나는 중입니다.",
            0xffba3a,
          );
          leadZeroShown = true;
        }
      } else {
        leadZeroMs = 0;
      }
      // 승계 알림 — sim 의 사건 배열은 안 늘렸다(렌더가 changedTick 변화를 감지한다).
      if (game.world.lead.changedTick !== prevLeadChanged) {
        prevLeadChanged = game.world.lead.changedTick;
        if (prevLeadChanged >= 0) {
          highlights.flash("앞장서던 개체가 쓰러졌습니다. 옆에 있던 한 마리가 앞으로 나섭니다.", 0xf0f8ff);
          leadSnapMs = LEAD_SNAP_MS;
          // 새 알파에게 옛 명령을 물려주지 않는다 — 위치·통행 능력이 달라 목표가 무의미할 수 있다.
          moveOrder = null;
          huntOrder = null;
          movePath = null;
        }
      }
      view.setLead(game.world.lead.leaderId >= 0 ? game.world.lead.leaderId : null);
    } else {
      view.setLead(null);
    }

    updateCamera(ticker.deltaMS);
    // 미니맵 — 관전 중에만. 드래프트에선 캔버스 전체가 블러라 뭉갠 미니맵이 남으면 지저분하다.
    // 목표 줄 상세를 펼쳤을 때도 숨긴다: 그 패널이 미니맵 자리를 덮어 조각만 삐져나와 지저분했다.
    minimap.container.visible = game.phase === "watch" && !goalBar.isOpen();
    // 미니맵은 캔버스에 그려 DOM 으로 못 잰다. 겹침 검사기(scripts/overlap-check.mjs)가 "지금 떠 있나"를
    // 알 수 있게 body 에 표식만 남긴다(값이 바뀔 때만 쓴다 · 매 프레임 DOM 쓰기 아님).
    const mmFlag = minimap.container.visible ? "on" : "off";
    if (document.body.dataset["minimap"] !== mmFlag) document.body.dataset["minimap"] = mmFlag;
    if (minimap.container.visible) {
      minimap.sync(game.world, camX, camY, camZoom, layout.width, layout.height);
      minimap.place(app.screen.width, app.screen.height);
    }
    detectEvents();
    highlights.update(ticker.deltaMS, app.screen.width / uiZoom);
    threatBanner.update(ticker.deltaMS, app.screen.width / uiZoom, app.screen.height / uiZoom);
    // 격퇴 체력 바는 worldView 가 보스 몸 위에 그린다(상단 글로벌 바 제거 — HUD 갈아엎기).

    if (debugBadge) {
      let txt = `디버그: ${debugLabel()}`;
      if (DEBUG.showAlpha) txt += `  α=${game.interpAlpha.toFixed(2)}`;
      debugBadge.textContent = txt;
    }
  });

  function updateCamera(dtMS: number): void {
    // 훔쳐보기 자동 복귀 — 입력(드래그·핀치·미니맵)이 끝나고 PEEK_RETURN_MS 지나면 알파로 돌아간다.
    // 조종 모드에서만: ?watch 관전 세계에선 수동 조망을 그대로 두는 것이 관찰에 맞다.
    if (leadMode && manualCam) {
      // 손가락이 하나라도 화면에 붙어 있거나 미니맵을 쥐고 있으면 "보는 중"이다 — 핀치에서 한
      // 손가락만 뗀 상태·미니맵을 가만히 누르고 있는 상태에서 카메라가 손 위에서 튀지 않게.
      const peekHeld = activePointers.size > 0 || minimap.panHeld;
      if (peekHeld) peekIdleMs = 0;
      else peekIdleMs += dtMS;
      if (peekIdleMs >= PEEK_RETURN_MS) manualCam = null;
    }
    // 우선순위: 훔쳐보기(manualCam) > 알파 고정(LEAD_ZOOM) > 내 무리 폴백(알파 공백·관전 세계).
    let tx: number;
    let ty: number;
    let tz: number;
    if (manualCam) {
      // 수동 조망(넓게 보도록 줌 1). 조종 모드에선 잠시 뒤 자동으로 풀린다(위).
      tx = manualCam.x;
      ty = manualCam.y;
      tz = 1;
    } else if (leadMode && game.world.lead.leaderId >= 0) {
      // 알파를 따라간다. sim 위치(30Hz 계단)를 쓰면 화면이 떨리므로 스프라이트와 같은 렌더 위치를 쓴다.
      const dp = view.getDisplayPos(game.world.lead.leaderId);
      tx = dp ? dp.x : game.world.lead.x;
      ty = dp ? dp.y : game.world.lead.y;
      tz = LEAD_ZOOM;
    } else {
      // 흩어진 낙오자 대신 "지금 시점 근처의 주 무리"를 부드럽게 따라간다(hint=현재 카메라). 번식으로 초점이
      // 홱 튀지 않게 가중 평균을 쓴다.
      const focus = game.world.playerFocus(camX, camY);
      tx = focus.x;
      ty = focus.y;
      tz = 1;
    }
    // 사용자 줌을 모든 모드의 목표 줌에 곱한다(자동/수동 무관). 최종 줌은 안전 범위로 클램프.
    tz = Math.max(0.5, Math.min(5, tz * userZoom));
    // 조종 중엔 카메라가 몸에 붙는다(기본 3.5 는 시상수 286ms 라 조종이 물먹은 느낌의 진짜 주범이다).
    // 승계 직후 잠깐은 기본값으로 되돌려 다른 개체로 갈아탈 때 화면이 홱 튀는 것을 줄인다.
    if (leadSnapMs > 0) leadSnapMs = Math.max(0, leadSnapMs - dtMS);
    const ease = leadMode && leadSnapMs <= 0 ? LEAD_CAM_EASE : 3.5;
    const k = Math.min(1, (dtMS / 1000) * ease); // 시간 기반 이징
    camX += (tx - camX) * k;
    camY += (ty - camY) * k;
    camZoom += (tz - camZoom) * k;
    // 월드(game.width/height)와 화면(layout) 분리 — 큰 월드의 일부만 화면에 보여준다.
    view.setCamera(camX, camY, camZoom, game.width, game.height, layout.width, layout.height);
  }

  // 월드 좌표에서 가장 가까운 개체를 고른다(화면상 일정한 탭 반경). 닿는 개체가 없으면 null.
  function pickEntity(wx: number, wy: number): Entity | null {
    // 줌이 클수록 더 좁은 월드 반경 = 화면상 탭 반경 일정. 폰 손가락 기준 넉넉히, 최소 바닥값 유지.
    const r = Math.max(16, 38 / Math.max(0.6, camZoom));
    let best: Entity | null = null;
    let bestSq = r * r;
    for (const en of game.world.entities) {
      const dx = en.x - wx;
      const dy = en.y - wy;
      const d = dx * dx + dy * dy;
      if (d < bestSq) {
        bestSq = d;
        best = en;
      }
    }
    return best;
  }

  function detectEvents(): void {
    const w = game.world;
    const bossNow = w.boss !== null;
    if (bossNow && !prevBoss && w.boss) {
      // 개체형=보스, 전역 재난=시련으로 알린다(시각·용어 일치).
      const kind = isPredatorBoss(w.boss.type) ? "보스" : "시련";
      highlights.flash(`${kind} · ${w.boss.name}`, 0xff6a4a);
    }
    // 조종 모드 전용 규칙 예고 — 하늘에서 내려다보는 보스에게는 수풀이 내 무리를 안 숨겨 준다.
    // (무리를 수풀에 세워 두면 이 보스의 카운터인 시야 형질이 통째로 무의미해지기 때문이다.)
    // ⚠ 봉인은 **한 번이라도 몰았을 때**(lead.commanded) 켜진다. 아직 한 번도 안 몰았으면 지금
    //   이 순간에는 수풀이 아직 숨겨 주므로, 문구를 그 사실에 맞춰 나눈다(화면이 거짓말하지 않게).
    if (leadMode && bossNow && !prevBoss && w.boss?.grassCover) {
      highlights.flash(
        w.lead.commanded
          ? "이 보스에게는 수풀이 우리를 숨겨 주지 않습니다. 눈이 밝아야 삽니다."
          : "앞장서서 몰기 시작하면 수풀이 우리를 숨겨 주지 않습니다. 눈이 밝아야 삽니다.",
        0xffba3a,
      );
    }
    // 안 몰고 있다가 몰기 시작한 순간 — 그 자리에서 규칙이 바뀐다(수풀 엄폐가 풀린다). commanded 는
    // 한 번 켜지면 안 꺼지므로 이 알림은 단계당 최대 한 번이다.
    if (leadMode && bossNow && w.boss?.grassCover && w.lead.commanded && !prevCommanded) {
      highlights.flash("몰기 시작했습니다. 이제 수풀이 우리를 숨겨 주지 않습니다.", 0xffba3a);
    }
    prevCommanded = w.lead.commanded;
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

/** 불씨 점 5칸: 남은 만큼 ●, 꺼진 만큼 ○. */
function emberDots(n: number): string {
  const k = Math.max(0, Math.min(GAME.emberMax, n));
  return "●".repeat(k) + "○".repeat(GAME.emberMax - k);
}

boot().catch((err: unknown) => {
  console.error("부트 실패:", err);
});
