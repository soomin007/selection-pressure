// 부트스트랩. PixiJS v8 앱 + scale-to-fit 뷰포트 + Phase 1 시뮬 루프.
//
// 고정 타임스텝: 프레임률과 무관하게 시뮬을 같은 간격으로 진행한다(결정론, §3.4).
// 멸종하면 잠시 뒤 새 시드로 다시 시작 — 폰으로 가만히 봐도 살아있게.

import { Application } from "pixi.js";
import { LOGICAL_WIDTH, LOGICAL_HEIGHT, COLORS } from "@/config";
import { createViewport } from "@/render/viewport";
import { World } from "@/sim/world";
import { WorldView } from "@/render/worldView";
import { Hud } from "@/render/hud";
import { SIM } from "@/sim/params";

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

  let runIndex = 1;
  let world = new World(`run-${runIndex}`, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  let extinctTicks = 0;

  const stepMs = 1000 / SIM.stepsPerSecond;
  let acc = 0;

  app.ticker.add((ticker) => {
    acc += ticker.deltaMS;
    // 한 프레임에 최대 5스텝만 (탭 전환 등으로 밀렸을 때 폭주 방지)
    let guard = 0;
    while (acc >= stepMs && guard < 5) {
      world.step();
      acc -= stepMs;
      guard += 1;
    }
    if (acc > stepMs) acc = 0;

    // 멸종 → 잠깐 보여주고 새 런 시작
    if (world.population === 0) {
      extinctTicks += 1;
      if (extinctTicks > SIM.stepsPerSecond * 2) {
        runIndex += 1;
        world = new World(`run-${runIndex}`, LOGICAL_WIDTH, LOGICAL_HEIGHT);
        extinctTicks = 0;
      }
    } else {
      extinctTicks = 0;
    }

    view.sync(world);
    hud.sync(world);
  });
}

boot().catch((err: unknown) => {
  console.error("부트 실패:", err);
});
