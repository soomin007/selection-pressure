// 부트스트랩. PixiJS v8 앱 + scale-to-fit 뷰포트 + 게임 상태기계(Phase 4).
//
// Game 이 런/라운드 상태를 갖고, 관전 중에만 시뮬을 진행한다.
// 드래프트/결과는 HTML 오버레이로, 월드/HUD 는 Pixi 로 그린다.

import { Application } from "pixi.js";
import { LOGICAL_WIDTH, LOGICAL_HEIGHT, COLORS } from "@/config";
import { createViewport } from "@/render/viewport";
import { WorldView } from "@/render/worldView";
import { Hud } from "@/render/hud";
import { Game } from "@/game/game";
import { GAME } from "@/game/config";
import { createDraftPanel } from "@/ui/draftPanel";
import { createResultPanel } from "@/ui/resultPanel";

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
    background: COLORS.bg,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const mount = document.getElementById("app");
  if (!mount) throw new Error("#app 마운트 지점을 찾을 수 없습니다.");
  mount.appendChild(app.canvas);
  createViewport(app.canvas, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  const view = new WorldView();
  const hud = new Hud();
  app.stage.addChild(view.container);
  app.stage.addChild(hud.container);

  const game = new Game(LOGICAL_WIDTH, LOGICAL_HEIGHT);
  const draft = createDraftPanel((i) => {
    game.pickCard(i);
    draft.hide();
  });
  const result = createResultPanel(() => {
    result.hide();
    game.newRun();
  });

  game.onDraft = (cards) => {
    draft.show(cards);
  };
  game.onResult = (res, summary) => {
    result.show(res === "win", summary);
  };
  game.onWorldChanged = (world) => {
    view.drawEnvironment(world.environment);
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
    const r = `라운드 ${game.round}/${GAME.roundsPerRun}`;
    if (game.phase === "draft") return `${r} · 카드 선택 · ${env}`;
    if (game.phase === "watch") return `${r} · 관전 ${game.secondsLeft}초 · ${env}`;
    return env;
  }
}

boot().catch((err: unknown) => {
  console.error("부트 실패:", err);
});
