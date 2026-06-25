// 부트스트랩. PixiJS v8 앱 + scale-to-fit 뷰포트 + 시뮬 루프 + 형질 패널(Phase 2).
//
// 환경 시드와 게놈을 분리해서 들고 있다가 World 에 함께 주입한다.
// 슬라이더는 공유 게놈을 그 자리에서 수정 → 현재 무리에 즉시 반영.
// "같은 환경에서 다시" 는 같은 envSeed + 현재 게놈으로 새 World (공정 비교).

import { Application } from "pixi.js";
import { LOGICAL_WIDTH, LOGICAL_HEIGHT, COLORS } from "@/config";
import { createViewport } from "@/render/viewport";
import { World } from "@/sim/world";
import { WorldView } from "@/render/worldView";
import { Hud } from "@/render/hud";
import { createTraitPanel } from "@/ui/traitPanel";
import { defaultGenome } from "@/sim/genome";
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

  // 종 게놈(중립 기본값에서 시작)과 환경 시드를 분리 보관.
  const genome = defaultGenome();
  let envSeed = 1;
  const makeWorld = (): World => new World(`env-${envSeed}`, LOGICAL_WIDTH, LOGICAL_HEIGHT, genome);
  let world = makeWorld();
  let extinctTicks = 0;

  createTraitPanel({
    genome,
    onLiveChange: (trait, value) => {
      // 공유 게놈을 직접 수정 → 살아있는 무리에 즉시 적용.
      genome.traits[trait] = value;
    },
    onRestartSameEnv: () => {
      world = makeWorld();
      extinctTicks = 0;
    },
    onNewEnv: () => {
      envSeed += 1;
      world = makeWorld();
      extinctTicks = 0;
    },
  });

  const stepMs = 1000 / SIM.stepsPerSecond;
  let acc = 0;

  app.ticker.add((ticker) => {
    acc += ticker.deltaMS;
    let guard = 0;
    while (acc >= stepMs && guard < 5) {
      world.step();
      acc -= stepMs;
      guard += 1;
    }
    if (acc > stepMs) acc = 0;

    // 멸종하면 잠깐 보여주고 같은 환경 + 같은 형질로 다시 (실험 정체성 유지).
    if (world.population === 0) {
      extinctTicks += 1;
      if (extinctTicks > SIM.stepsPerSecond * 2) {
        world = makeWorld();
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
