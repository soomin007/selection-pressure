// 부트스트랩. PixiJS v8 앱 + scale-to-fit 뷰포트 + 게임 상태기계.
//
// 코어 시뮬은 동일. 모바일(세로)/데스크톱(가로)은 논리 해상도와 UI 만 다르다(chooseLayout).
// 드래프트/결과는 HTML 오버레이로, 월드/HUD 는 Pixi 로 그린다.

import { Application, Container } from "pixi.js";
import { chooseLayout, COLORS } from "@/config";
import { setupViewport } from "@/render/viewport";
import { WorldView } from "@/render/worldView";
import { Hud } from "@/render/hud";
import { Game } from "@/game/game";
import { createDraftPanel } from "@/ui/draftPanel";
import { createResultPanel } from "@/ui/resultPanel";

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

  // 논리 좌표(layout) → 화면. root 컨테이너를 비율 맞춰 스케일·중앙배치(레터박스).
  const root = new Container();
  app.stage.addChild(root);
  setupViewport(app, root, layout.width, layout.height);

  const view = new WorldView(app.renderer);
  const hud = new Hud();
  root.addChild(view.container);
  root.addChild(hud.container);

  const game = new Game(layout.width, layout.height);
  const draft = createDraftPanel((i) => {
    game.pickCard(i);
    view.refreshSpecies(game.world); // 고른 형질을 내 종 모습에 반영
    draft.hide();
  });
  const result = createResultPanel(() => {
    result.hide();
    game.newRun();
  });

  game.onDraft = (cards, preview) => {
    draft.show(cards, preview);
  };
  game.onResult = (res, summary) => {
    result.show(res === "win", summary);
  };
  game.onWorldChanged = (world) => {
    view.drawEnvironment(world.environment);
    view.refreshSpecies(world);
    hud.reset();
  };

  game.start();

  app.ticker.add((ticker) => {
    game.update(ticker.deltaMS);
    view.sync(game.world);
    hud.sync(game.world, statusLine());
  });

  function statusLine(): string {
    const env = game.environmentSummary();
    const s = `${game.stageNumber}/${game.totalStages}`;
    if (game.phase === "draft") return `단계 ${s} · 카드 선택 · ${env}`;
    if (game.phase === "watch")
      return `단계 ${s} · ${game.stageLabel} · ${game.secondsLeft}초 · ${env}`;
    return env;
  }
}

boot().catch((err: unknown) => {
  console.error("부트 실패:", err);
});
