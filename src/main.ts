// 부트스트랩. PixiJS v8 앱 + scale-to-fit 뷰포트 + 게임 상태기계 + 셸 UI(로비/멈춤/배속).
//
// 코어 시뮬은 동일. 모바일(세로)/데스크톱(가로)은 논리 해상도와 UI 만 다르다(chooseLayout).
// 월드는 스케일 컨테이너(root)에, HUD/UI 는 화면 픽셀 그대로(선명).

import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { chooseLayout, COLORS } from "@/config";
import { DEBUG, DEBUG_ACTIVE, debugLabel } from "@/debug";
import { setupViewport } from "@/render/viewport";
import { WorldView } from "@/render/worldView";
import { Hud } from "@/render/hud";
import { Game } from "@/game/game";
import { createDraftPanel } from "@/ui/draftPanel";
import { createResultPanel } from "@/ui/resultPanel";
import { createLobby } from "@/ui/lobby";
import { createControls } from "@/ui/controls";
import { createBuildPanel } from "@/ui/buildPanel";
import { describeSpecies } from "@/game/runReport";
import { Highlights } from "@/render/highlights";

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

  // 월드는 비율 맞춰 스케일·중앙배치(레터박스). HUD 는 스케일 밖(화면 픽셀)이라 글자가 선명.
  const root = new Container();
  app.stage.addChild(root);
  setupViewport(app, root, layout.width, layout.height);

  const view = new WorldView(app.renderer);
  const hud = new Hud();
  const highlights = new Highlights();
  root.addChild(view.container);
  // 월드를 논리 사각형으로 클리핑 — 가장자리 생물이 레터박스 밖으로 삐져나오지 않게.
  const worldMask = new Graphics().rect(0, 0, layout.width, layout.height).fill(0xffffff);
  root.addChild(worldMask);
  view.container.mask = worldMask;
  app.stage.addChild(hud.container); // ← root(스케일) 밖 = 네이티브 해상도
  app.stage.addChild(highlights.container);

  const game = new Game(layout.width, layout.height);

  // 디버그: URL 에 ?seed=… 가 있으면 그 시드로 고정(맵·카드·보스 완전 재현). 없으면 런마다 랜덤.
  const seedParam = new URLSearchParams(window.location.search).get("seed");
  if (seedParam) game.fixedSeed = seedParam;

  const buildPanel = createBuildPanel();
  const refreshBuild = (): void => {
    buildPanel.setData({ headline: describeSpecies(game.genome), cards: game.pickedCardNames });
  };
  refreshBuild();

  const draft = createDraftPanel((i) => {
    game.pickCard(i);
    refreshBuild(); // 방금 고른 카드를 빌드 패널에 반영
    view.refreshSpecies(game.world); // 고른 형질을 내 종 모습에 반영
    draft.hide();
  });
  const result = createResultPanel(() => {
    result.hide();
    game.beginRun();
    refreshBuild();
    view.refreshSpecies(game.world);
    controls.setVisible(true);
  });
  const lobby = createLobby(() => {
    lobby.hide();
    game.beginRun();
    refreshBuild();
    view.refreshSpecies(game.world);
    controls.setVisible(true);
  });
  const controls = createControls({
    onPauseToggle: () => {
      game.paused = !game.paused;
      controls.setPaused(game.paused);
    },
    onSpeedCycle: () => {
      game.speed = game.speed >= 3 ? 1 : game.speed + 1;
      controls.setSpeed(game.speed);
    },
    onResume: () => {
      game.paused = false;
      controls.setPaused(false);
    },
    onRestart: () => {
      game.paused = false;
      controls.setPaused(false);
      game.beginRun();
      view.refreshSpecies(game.world);
    },
    onLobby: () => {
      game.paused = false;
      controls.setPaused(false);
      controls.setVisible(false);
      game.toLobby();
      lobby.show();
    },
  });

  game.onDraft = (cards, preview) => {
    draft.show(cards, preview);
  };
  game.onResult = (res, summary) => {
    controls.setVisible(false);
    result.show(res === "win", summary);
  };
  game.onWorldChanged = (world) => {
    view.drawEnvironment(world.environment);
    view.refreshSpecies(world);
    hud.reset();
    // 재현용: 이 맵의 시드를 콘솔에 남긴다(?seed=… 로 다시 불러올 수 있음).
    console.info(`[seed] ${game.seed}  (재현: ?seed=${game.seed})`);
  };

  game.start(); // 로비 진입
  lobby.show();

  // 떨림 진단 배지 — ?norot/?nointerp/?showalpha 중 하나라도 켜졌을 때만 화면 우상단에 표시.
  let debugText: Text | null = null;
  if (DEBUG_ACTIVE) {
    debugText = new Text({
      text: "",
      style: new TextStyle({ fill: 0xffe08a, fontSize: 16, fontWeight: "700" }),
    });
    app.stage.addChild(debugText);
  }

  // 카메라(보스 추적 줌) + 하이라이트 이벤트 감지 상태
  let camX = layout.width / 2;
  let camY = layout.height / 2;
  let camZoom = 1;
  let prevBoss = false;
  let prevExt = "";
  let prevLowWarn = false;
  let prevPhase = game.phase;

  app.ticker.add((ticker) => {
    game.update(ticker.deltaMS);
    view.sync(game.world, game.interpAlpha, ticker.deltaMS);
    hud.sync(game.world, statusLine());
    buildPanel.setVisible(game.phase === "draft" || game.phase === "watch");

    updateCamera(ticker.deltaMS);
    detectEvents();
    highlights.update(ticker.deltaMS, app.screen.width);

    if (debugText) {
      let txt = `디버그: ${debugLabel()}`;
      if (DEBUG.showAlpha) txt += `  α=${game.interpAlpha.toFixed(2)}`;
      debugText.text = txt;
      debugText.x = app.screen.width - debugText.width - 12;
      debugText.y = 12;
    }

    prevPhase = game.phase;
  });

  function updateCamera(dtMS: number): void {
    const boss = game.world.boss;
    const focusBoss = game.phase === "watch" && boss !== null;
    const tz = focusBoss ? 1.35 : 1;
    const tx = focusBoss && boss ? boss.x : layout.width / 2;
    const ty = focusBoss && boss ? boss.y : layout.height / 2;
    const k = Math.min(1, (dtMS / 1000) * 3.5); // 시간 기반 이징
    camX += (tx - camX) * k;
    camY += (ty - camY) * k;
    camZoom += (tz - camZoom) * k;
    view.setCamera(camX, camY, camZoom, layout.width, layout.height);
  }

  function detectEvents(): void {
    const w = game.world;
    const bossNow = w.boss !== null;
    if (bossNow && !prevBoss && w.boss) highlights.flash(`${w.boss.name} 등장`, 0xff6a4a);
    // 보스 단계를 통과하면(보스 있던 watch → draft) 알린다.
    if (prevPhase === "watch" && game.phase === "draft" && prevBoss && !bossNow) {
      highlights.flash("관문 통과", 0x6cc24a);
    }
    prevBoss = bossNow;

    const ext = w.globalCold > 0 ? "한파" : w.heat > 0 ? "폭염" : w.foodRegrowMultiplier > 1 ? "대가뭄" : "";
    if (ext && ext !== prevExt) highlights.flash(`대멸종 — ${ext}`, 0x8ab4ff);
    prevExt = ext;

    const pop = w.playerPopulation;
    if (game.phase === "watch" && pop > 0 && pop <= 5) {
      if (!prevLowWarn) highlights.flash("멸종 위기!", 0xffba3a);
      prevLowWarn = true;
    } else if (pop > 9) {
      prevLowWarn = false;
    }
  }

  function statusLine(): string {
    if (game.phase === "lobby") return "";
    const env = game.environmentSummary();
    const s = `${game.stageNumber}/${game.totalStages}`;
    if (game.phase === "draft") return `단계 ${s} · 카드 선택 · ${env}`;
    if (game.phase === "watch")
      return `단계 ${s} · ${game.stageLabel} · ${game.secondsLeft}초${game.paused ? " (멈춤)" : ""} · ${env}`;
    return env;
  }
}

boot().catch((err: unknown) => {
  console.error("부트 실패:", err);
});
