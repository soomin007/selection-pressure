// 부트스트랩. PixiJS v8 앱 + scale-to-fit 뷰포트 + 게임 상태기계 + 셸 UI(로비/멈춤/배속).
//
// 코어 시뮬은 동일. 모바일(세로)/데스크톱(가로)은 논리 해상도와 UI 만 다르다(chooseLayout).
// 월드는 스케일 컨테이너(root)에, HUD/UI 는 화면 픽셀 그대로(선명).

import { Application, Container, Graphics } from "pixi.js";
import { chooseLayout, COLORS } from "@/config";
import { DEBUG, DEBUG_ACTIVE, debugLabel } from "@/debug";
import { setupViewport } from "@/render/viewport";
import { WorldView } from "@/render/worldView";
import { createHudPanel } from "@/ui/hudPanel";
import { Game, type ExtinctionType } from "@/game/game";
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
import { registerKeyLayer, keyChip } from "@/ui/keys";
import { createBuildPanel } from "@/ui/buildPanel";
import { createGlossary } from "@/ui/glossary";
import { equippedCosmetic, mythicNamesUnlocked } from "@/game/achievements";
import { setMythicNames } from "@/ui/creatureName";
import { createCreatureCard } from "@/ui/creatureCard";
import { creatureName } from "@/ui/creatureName";
import { describeSpecies } from "@/game/runReport";
import { Highlights } from "@/render/highlights";
import { Effects } from "@/render/effects";
import { Minimap } from "@/render/minimap";
import { ThreatBanner } from "@/render/threatBanner";
import { RaidBossBar } from "@/render/raidBossBar";
import { sizeWord } from "@/render/creatureLook";
import { TRAIT_LABELS } from "@/sim/genome";
import { APEX_BOON } from "@/ui/traitDisplay";
import { isPredatorBoss } from "@/sim/boss";
import { SIM } from "@/sim/params";
import type { Entity } from "@/sim/entity";

// 맵 배율 — 월드를 화면의 이 배수만큼 크게. 소수 개체(한 무리)를 카메라가 따라가며 탐험. 바이옴(사막·빙하·
// 우림)이 뚜렷한 구역으로 펼쳐지도록 넓게. 개체는 절대 수(소수)라 먹이 밀도·상한만 면적 비례(areaScale).
const MAP_SCALE = 2.0;

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
  const hud = createHudPanel(); // 상단 HUD — 캔버스 위 DOM 오버레이(정보 카드·타임라인·범례)
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
  const threatBanner = new ThreatBanner(); // 위협 예고 전광판(최상단)
  app.stage.addChild(threatBanner.container);
  const raidBossBar = new RaidBossBar(); // 레이드 격퇴 체력 바(화면 상단 글로벌 — 보스 이름 + 게이지)
  app.stage.addChild(raidBossBar.container);

  // 소수 개체 게임: 월드를 약간 크게(MAP_SCALE) + 개체는 절대 수(소수)지만 먹이 밀도·상한은 면적 비례
  // (areaScale=면적배율) → 큰 맵일수록 개체당 먹이가 넉넉해 굶지 않는다. 카메라가 한 무리를 따라다닌다.
  const game = new Game(layout.width * MAP_SCALE, layout.height * MAP_SCALE, MAP_SCALE * MAP_SCALE);

  // 디버그: URL 에 ?seed=… 가 있으면 그 시드로 고정(맵·카드·보스 완전 재현). 없으면 런마다 랜덤.
  const seedParam = new URLSearchParams(window.location.search).get("seed");
  if (seedParam) game.fixedSeed = seedParam;

  // 개인 카메라(방향 전환 2단계) — 탭으로 고른 한 개체를 따라가며 클로즈업한다(소수 개체 애착의 핵심).
  let selectedId: number | null = null; // 따라가는 개체 id(없으면 무리 추적)
  let favoriteId: number | null = null; // 즐겨찾기(단골)로 고정한 개체 id(선택과 무관, 월드에 별 마커)
  let currentSelected: Entity | null = null; // 이번 프레임의 선택 개체(카메라가 읽음)
  const INDIVIDUAL_ZOOM = 2.6; // 개체 추적 시 줌 배율(클로즈업)

  // 미니맵 드래그 카메라 — 미니맵을 누르거나 끌면 그 지점으로 카메라를 수동 이동(맵 탐색·조망).
  let manualCam: { x: number; y: number } | null = null;
  minimap.onPan = (wx, wy) => {
    manualCam = { x: wx, y: wy };
    selectedId = null; // 수동 조망 중엔 개체 추적 해제
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
    },
    onSpeedCycle: (): void => {
      game.speed = game.speed >= 3 ? 1 : game.speed + 1;
      controls.setSpeed(game.speed);
    },
    onResume: (): void => {
      game.paused = false;
      controls.setPaused(false);
    },
    onRestart: (): void => {
      game.paused = false;
      controls.setPaused(false);
      game.beginRun();
      view.refreshSpecies(game.world);
    },
    onLobby: (): void => {
      game.paused = false;
      controls.setPaused(false);
      controls.setVisible(false);
      game.toLobby();
      lobby.show();
    },
    onGlossary: (): void => glossary.show(),
  };
  const controls = createControls(controlsCb);

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
      });
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
      result.show(res === "win", summary, canContinue);
    };
    moment.play(kind, () => {
      // 런이 진짜 끝났으면(progress 있음) 진척도 화면을 먼저, 그 뒤 결과 화면. 중간 시대 승리(이어감)면 바로 결과.
      // 진척도(런 종료) 또는 새 도전 과제가 있으면 종료 화면을 거친다. 중간 시대 승리는 progress 가 없지만
      // "정점 등극" 같은 과제는 거기서 열리므로 과제만 있어도 화면을 띄운다.
      if (progress || achievements.length > 0) levelScreen.play(progress, achievements, showResult);
      else showResult();
    });
  };
  // 카메라 상태 — onWorldChanged 가 game.start()에서 곧장 호출돼 camX/camY 를 스냅하므로, 그 콜백보다
  // 반드시 먼저 선언한다. (전엔 아래쪽에 뒀다가 TDZ ReferenceError 로 부팅이 통째로 죽었다 — known_issues.)
  let camX = game.width / 2;
  let camY = game.height / 2;
  let camZoom = 1;
  // 사용자 줌 배율 — 자동/수동 시점 무관하게 모든 모드의 목표 줌에 곱한다(버튼·휠·핀치로 조절).
  let userZoom = 1;
  const clampUserZoom = (z: number): number => Math.max(0.5, Math.min(3.5, z));

  game.onWorldChanged = (world) => {
    view.drawEnvironment(world);
    view.refreshSpecies(world);
    hud.reset();
    effects.clear();
    moment.clear(); // 멸종 암전 등 남은 순간 연출을 지운다(새 월드 시작).
    levelScreen.clear(); // 진척도 화면도 닫는다(혹시 남아 있으면).
    reportScreen.hide(); // 이전 혈통의 보고서 화면이 남아 있으면 닫는다.
    selectedId = null; // 새 월드 → 옛 선택(개체 id)은 무효
    currentSelected = null;
    manualCam = null; // 수동 조망도 초기화
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

  // 선택 개체 정보 카드(좌하단). 닫기(✕)=선택 해제, ‹ ›=같은 무리의 다른 개체로 포커스 이동.
  const creatureCard = createCreatureCard(app.renderer, {
    onClose: () => {
      selectedId = null;
    },
    onPrev: () => cycleSelection(-1),
    onNext: () => cycleSelection(1),
    // ★ 지금 보는 개체를 단골로 고정/해제 — 이미 이 개체가 단골이면 해제, 아니면 새로 지정.
    onFavorite: () => {
      if (currentSelected) favoriteId = favoriteId === currentSelected.id ? null : currentSelected.id;
    },
  });

  // 월드 탭 → 가장 가까운 개체를 골라 따라간다. 같은 개체를 다시 탭하거나 빈 곳을 탭하면 선택 해제.
  // 월드 레이어는 hit-test 에서 빼(none) 탭이 stage 까지 통과하게 한다 → 개체는 좌표로 직접 찾는다
  // (스프라이트는 풀 재사용이라 개체와 1:1 이 아니므로 스프라이트 이벤트 대신 좌표 + 최근접 탐색).
  view.container.eventMode = "none";
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  // 브라우저 기본 제스처(스크롤·핀치 확대)를 막아 캔버스가 드래그·핀치를 직접 받게 한다.
  app.canvas.style.touchAction = "none";

  // 카메라 수동 조작 — 드래그(1손가락)=자유 이동, 핀치(2손가락)/휠=줌. 탭(안 끌었을 때)=개체 선택.
  const activePointers = new Map<number, { x: number; y: number }>();
  let dragStart: { sx: number; sy: number; camX: number; camY: number } | null = null;
  let dragging = false;
  let pinchDist = 0;
  let pinchedThisGesture = false; // 이번 제스처에 핀치(2손가락)가 있었나 — 끝날 때 탭 선택을 막는다
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
      dragStart = null; // 핀치 중엔 팬 중단
      pinchedThisGesture = true;
    }
  });

  app.stage.on("pointermove", (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
    if (activePointers.size >= 2) {
      const pts = [...activePointers.values()];
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      if (pinchDist > 0) userZoom = clampUserZoom(userZoom * (d / pinchDist));
      pinchDist = d;
      return;
    }
    if (dragStart) {
      const dx = e.global.x - dragStart.sx;
      const dy = e.global.y - dragStart.sy;
      if (!dragging && Math.hypot(dx, dy) > 8) dragging = true; // 탭/드래그 구분 임계
      if (dragging) {
        // 드래그 = 자유 이동(수동 시점). 손가락 아래 월드가 따라오게 카메라를 반대로 민다.
        selectedId = null;
        manualCam = { x: dragStart.camX - dx / camZoom, y: dragStart.camY - dy / camZoom };
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
    const hadPinch = pinchedThisGesture;
    pinchedThisGesture = false;
    // 끌지 않은 단순 탭만 개체 선택으로 처리(드래그·핀치 끝은 선택 안 함).
    if (!hadPointer || wasDragging || hadPinch) return;
    if (game.phase !== "watch" && game.phase !== "draft") return;
    if (e.target !== app.stage || onCanvasUI(e.global.x, e.global.y)) return;
    const p = view.container.toLocal(e.global as { x: number; y: number });
    const picked = pickEntity(p.x, p.y);
    manualCam = null; // 탭 = 수동 조망 종료(개체 추적 또는 빈 곳이면 무리 복귀)
    selectedId = !picked || picked.id === selectedId ? null : picked.id;
  };
  app.stage.on("pointerup", endPointer);
  app.stage.on("pointerupoutside", endPointer);

  // 휠 줌(데스크톱).
  app.canvas.addEventListener(
    "wheel",
    (ev: WheelEvent) => {
      ev.preventDefault();
      userZoom = clampUserZoom(userZoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12));
    },
    { passive: false },
  );

  // 좌하단 컨트롤 열 — "내 애 보기"(내 종 한 마리 바로 클로즈업) + 줌 +/−. 폰에서 핀치 없이도 조작.
  const zoomBar = document.createElement("div");
  zoomBar.style.cssText =
    "position:fixed; left:6px; bottom:52px; z-index:31; display:flex; flex-direction:column; align-items:flex-start; gap:6px;";
  // 한 마리 관찰 — 내 종 한 개체를 바로 따라간다(반복 탭 = 다음 개체). 눈에 띄는 초록으로.
  const focusBtn = document.createElement("button");
  focusBtn.textContent = "◎ 한 마리 관찰";
  focusBtn.appendChild(keyChip("F"));
  focusBtn.title = "내 종 한 마리를 가까이 따라갑니다 (다시 누르면 다음 개체) (F)";
  // 주요(입체 키) 버튼 — 3a 스펙상 "한 마리 관찰"은 화면당 하나의 lime 키 버튼.
  focusBtn.style.cssText =
    "height:44px; padding:0 16px; border:0; border-radius:var(--r-btn); background:var(--lime);" +
    "color:#1B2A0A; font-family:var(--font-title); font-size:14.5px; line-height:1; cursor:pointer;" +
    "white-space:nowrap; border-bottom:4px solid var(--limeD);";
  focusBtn.addEventListener("click", () => focusMyCreature());
  const mkZoom = (label: string, dz: number): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = dz > 1 ? "확대 (+)" : "축소 (−)";
    // 계측(알약) 버튼 — 줌 +/−.
    b.style.cssText =
      "width:44px; height:44px; border:1px solid var(--line); border-radius:999px;" +
      "background:var(--panel); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px);" +
      "color:var(--ink); font-family:var(--font-mono); font-size:22px; line-height:1; cursor:pointer;";
    b.addEventListener("click", () => {
      userZoom = clampUserZoom(userZoom * dz);
    });
    return b;
  };
  const zoomRow = document.createElement("div");
  zoomRow.style.cssText = "display:flex; gap:6px;";
  zoomRow.append(mkZoom("+", 1.25), mkZoom("−", 1 / 1.25));
  zoomBar.append(focusBtn, zoomRow);
  document.body.appendChild(zoomBar);

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
          return true;
        case "KeyF":
          focusMyCreature();
          return true;
        case "ArrowLeft":
        case "ArrowRight":
          // 개체를 보고 있으면 무리 안 이전/다음으로, 아니면 내 종 한 마리부터 관찰 시작.
          if (selectedId === null) focusMyCreature();
          else cycleSelection(e.code === "ArrowLeft" ? -1 : 1);
          return true;
        case "KeyB":
          // 지금 보는 개체를 단골(★)로 고정/해제 — 개체 카드의 별 버튼과 동일.
          if (!e.repeat && currentSelected)
            favoriteId = favoriteId === currentSelected.id ? null : currentSelected.id;
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
          // 보던 개체가 있으면 선택 해제, 없으면 멈춤 메뉴 열기.
          if (selectedId !== null) selectedId = null;
          else controlsCb.onPauseToggle();
          return true;
        default:
          return false;
      }
    },
  );

  app.ticker.add((ticker) => {
    game.update(ticker.deltaMS);
    // 개인 카메라: 선택 개체를 해석(죽었으면 작별, 관전 아니면 해제) → 강조 고리·카드·카메라에 반영.
    resolveSelection();
    view.sync(game.world, game.interpAlpha, ticker.deltaMS);
    // 사건 연출: sim 이 이번 프레임에 emit 한 사건(탄생/죽음/잡아먹힘)을 효과로 옮기고 비운다.
    for (const ev of game.world.events) effects.spawn(ev.kind, ev.x, ev.y);
    game.world.events.length = 0;
    effects.update(ticker.deltaMS);
    hud.update({
      world: game.world,
      statusText: statusLine(),
      level: game.level,
      xpProgress: game.xpProgress,
      timeline: game.timeline,
    });
    // 설계도는 관전 중에만 — 드래프트는 전체 화면이라 그 아래 깔린 UI 가 뿌연 유리로 비쳐 보인다.
    // 드래프트 중 내 종 정보는 헤더의 "내 종" 팝업이 대신한다(핸드오프 §9).
    buildPanel.setVisible(game.phase === "watch");
    // 좌하단 조작 열(한 마리 관찰·줌)은 관전 중 + 개체 미선택일 때만 — 로비·드래프트·개체 정보 카드와
    // 좌하단에서 겹치지 않게(known_issues: 좌하단 UI 셋이 한자리에 겹친다).
    zoomBar.style.display = game.phase === "watch" && selectedId === null ? "flex" : "none";

    updateCamera(ticker.deltaMS);
    // 미니맵 — 관전 중에만. 드래프트에선 캔버스 전체가 블러라 뭉갠 미니맵이 남으면 지저분하다.
    minimap.container.visible = game.phase === "watch";
    if (minimap.container.visible) {
      minimap.sync(game.world, camX, camY, camZoom, layout.width, layout.height);
      minimap.place(app.screen.width, app.screen.height);
    }
    detectEvents();
    highlights.update(ticker.deltaMS, app.screen.width);
    threatBanner.update(ticker.deltaMS, app.screen.width, app.screen.height);
    // 레이드 격퇴 체력 바(글로벌) — 관전 중 격퇴 체력이 있는 보스(레이드 켜짐)일 때 보스 이름 + 게이지를 상단에.
    const rbBoss = game.world.boss;
    const raidActive = game.phase === "watch" && rbBoss !== null && rbBoss.maxHp > 0 && rbBoss.hp > 0;
    raidBossBar.set(raidActive && rbBoss ? rbBoss.name : null, raidActive && rbBoss ? rbBoss.hp / rbBoss.maxHp : 0, 0xff5a44);
    raidBossBar.update(ticker.deltaMS, app.screen.width);

    if (debugBadge) {
      let txt = `디버그: ${debugLabel()}`;
      if (DEBUG.showAlpha) txt += `  α=${game.interpAlpha.toFixed(2)}`;
      debugBadge.textContent = txt;
    }
  });

  function updateCamera(dtMS: number): void {
    const boss = game.world.boss;
    const focusBoss = game.phase === "watch" && boss !== null;
    // 우선순위: 고른 개체(클로즈업) > 보스 관전(줌인) > 평상시 내 무리 무게중심.
    let tx: number;
    let ty: number;
    let tz: number;
    if (currentSelected) {
      // 개체의 부드러운 렌더 위치를 따라가 떨림 없이 클로즈업한다(sim 위치는 고주파 진동이 있다).
      const dp = view.getDisplayPos(currentSelected.id);
      tx = dp ? dp.x : currentSelected.x;
      ty = dp ? dp.y : currentSelected.y;
      tz = INDIVIDUAL_ZOOM;
    } else if (manualCam) {
      // 미니맵으로 옮긴 수동 조망 위치(넓게 보도록 줌 1). 개체·빈 곳 탭으로 해제된다.
      tx = manualCam.x;
      ty = manualCam.y;
      tz = 1;
    } else if (focusBoss && boss) {
      tx = boss.x;
      ty = boss.y;
      tz = 1.35;
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
    const k = Math.min(1, (dtMS / 1000) * 3.5); // 시간 기반 이징
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

  // 카드의 ‹ › — 현재 선택 개체와 같은 무리(종) 안에서 이전/다음 개체로 포커스를 옮긴다(id 순환).
  function cycleSelection(dir: number): void {
    if (selectedId === null) return;
    const cur = game.world.entities.find((en) => en.id === selectedId);
    if (!cur) return;
    const same = game.world.entities
      .filter((en) => en.species.id === cur.species.id)
      .sort((a, b) => a.id - b.id);
    const idx = same.findIndex((en) => en.id === selectedId);
    if (idx < 0) return;
    const next = same[(idx + dir + same.length) % same.length];
    if (next) {
      selectedId = next.id;
      manualCam = null; // 개체 추적으로 전환(수동 조망 해제)
    }
  }

  // "내 애 보기" 버튼 — 내 종 한 마리를 바로 따라가며 클로즈업한다. 이미 내 개체를 따라가는 중이면 다음
  // 개체로 넘겨(반복 탭 = 무리 둘러보기), 아니면 지금 카메라가 보는 곳에서 가장 가까운 내 개체를 고른다.
  function focusMyCreature(): void {
    if (game.phase !== "watch" && game.phase !== "draft") return;
    const players = game.world.entities.filter((en) => en.species.isPlayer);
    if (players.length === 0) return;
    const cur = selectedId !== null ? game.world.entities.find((en) => en.id === selectedId) : null;
    if (cur && cur.species.isPlayer) {
      cycleSelection(1); // 이미 내 개체 추적 중 → 다음 개체
      return;
    }
    let best = players[0]!;
    let bestD = Infinity;
    for (const e of players) {
      const d = (e.x - camX) ** 2 + (e.y - camY) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    selectedId = best.id;
    manualCam = null; // 개체 추적으로 전환(수동 조망 해제)
  }

  // 선택 개체를 매 프레임 해석한다 — 죽었으면 작별 인사 후 해제, 관전 단계가 아니면 해제.
  // 그 결과를 강조 고리(view) · 정보 카드 · 카메라(currentSelected)에 일관되게 반영한다.
  function resolveSelection(): void {
    if (game.phase !== "watch" && game.phase !== "draft") {
      selectedId = null;
      manualCam = null;
    }
    currentSelected = null;
    if (selectedId !== null) {
      const found = game.world.entities.find((en) => en.id === selectedId) ?? null;
      if (!found) {
        // 따라가던 아이가 죽었다 — 작별 인사 한 번 띄우고 무리 시점으로 돌아간다(애착의 무게).
        highlights.flash(`${creatureName(selectedId)} 떠남`, 0xffd089);
        selectedId = null;
      } else {
        currentSelected = found;
      }
    }
    view.setSelected(selectedId);
    // 즐겨찾기(단골) 개체가 죽었으면 마커를 조용히 해제(작별 인사는 선택 개체에만). 살아있으면 상시 별 유지.
    if (favoriteId !== null) {
      let favAlive = false;
      for (const en of game.world.entities) {
        if (en.id === favoriteId) {
          favAlive = true;
          break;
        }
      }
      if (!favAlive) favoriteId = null;
    }
    view.setFavorite(favoriteId);
    // 개체 정보 카드는 관전 중일 때만 그린다 — 드래프트가 뜨면 숨겨 하단 카드와 좌하단에서 겹치지 않게
    // (카메라 추적은 currentSelected 로 계속 유지). known_issues: 좌하단 UI 셋이 한자리에 겹친다.
    if (currentSelected && game.phase === "watch") {
      const en = currentSelected;
      creatureCard.update({
        id: en.id,
        genome: en.genome,
        name: creatureName(en.id),
        speciesName: en.species.name,
        isPlayer: en.species.isPlayer,
        color: en.species.color,
        energy: en.energy / SIM.maxEnergy,
        ageSeconds: en.age / SIM.stepsPerSecond,
        sizeText: sizeWord(en.id),
        activity: en.targetPrey ? "사냥하는 중" : en.targetFood ? "먹이로 가는 중" : "돌아다니는 중",
        descriptor: describeSpecies(en.genome),
        traits: en.genome.traits,
        isFavorite: favoriteId === en.id,
      });
    } else {
      creatureCard.update(null);
    }
  }

  function detectEvents(): void {
    const w = game.world;
    const bossNow = w.boss !== null;
    if (bossNow && !prevBoss && w.boss) {
      // 개체형=보스, 전역 재난=시련으로 알린다(시각·용어 일치).
      const kind = isPredatorBoss(w.boss.type) ? "보스" : "시련";
      highlights.flash(`${kind} · ${w.boss.name}`, 0xff6a4a);
    }
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

  function statusLine(): string {
    if (game.phase === "lobby") return "";
    const env = game.environmentSummary();
    const s = `${game.stageNumber}/${game.totalStages}`;
    // 모바일에서 한 줄이 길어 잘리던 문제 → 2줄(단계·시간 / 환경)로 나눈다.
    if (game.phase === "draft") return `단계 ${s} · 카드 선택\n${env}`;
    // 관전 첫 줄은 무슨 단계인지(시련/보스 이름)만 둔다 — 단계 번호(N/M)는 타임라인 막대가 대신
    // 보여줘 중복이고, 긴 시련 이름(그림자 매복자 등)이 우상단 낮밤 타이머와 겹치지 않게 짧게 유지한다.
    if (game.phase === "watch") {
      // 시대(era>0)면 "시대 N ·" 접두어로 지금 몇 번째 시대인지 보인다(첫 시대는 빈 문자열이라 변화 없음).
      const eraPre = game.eraLabel ? `${game.eraLabel} · ` : "";
      return `${eraPre}${game.stageLabel}\n${game.secondsLeft}초${game.paused ? " (멈춤)" : ""} · ${env}`;
    }
    return env;
  }
}

boot().catch((err: unknown) => {
  console.error("부트 실패:", err);
});
