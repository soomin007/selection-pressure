// 부트스트랩. PixiJS v8 앱을 띄우고 scale-to-fit 뷰포트를 건다.
//
// 지금은 Phase 0 플레이스홀더 무대다 (툴체인 + 렌더 + 틱커 + 시드 RNG 연결 확인용).
// Phase 1 에서 이 자리에 시뮬 코어가 들어간다.

import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { LOGICAL_WIDTH, LOGICAL_HEIGHT, COLORS } from "@/config";
import { createViewport } from "@/render/viewport";
import { Rng } from "@/sim/rng";

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

  // --- 플레이스홀더: 시드로 흩뿌린 점들이 천천히 떠다닌다 (틱커 + 결정론 RNG 확인). ---
  const rng = new Rng("phase-0-boot");
  const swarm = new Container();
  app.stage.addChild(swarm);

  const dots: { g: Graphics; vx: number; vy: number }[] = [];
  for (let i = 0; i < 40; i++) {
    const g = new Graphics().circle(0, 0, rng.range(2, 5)).fill({ color: COLORS.accent, alpha: 0.7 });
    g.x = rng.range(0, LOGICAL_WIDTH);
    g.y = rng.range(0, LOGICAL_HEIGHT);
    swarm.addChild(g);
    dots.push({ g, vx: rng.range(-0.4, 0.4), vy: rng.range(-0.4, 0.4) });
  }

  app.ticker.add((ticker) => {
    const dt = ticker.deltaTime;
    for (const d of dots) {
      d.g.x += d.vx * dt;
      d.g.y += d.vy * dt;
      if (d.g.x < 0 || d.g.x > LOGICAL_WIDTH) d.vx *= -1;
      if (d.g.y < 0 || d.g.y > LOGICAL_HEIGHT) d.vy *= -1;
    }
  });

  // --- 타이틀 텍스트 ---
  const title = new Text({
    text: "적자생존",
    style: new TextStyle({ fill: COLORS.text, fontSize: 64, fontWeight: "700" }),
  });
  title.anchor.set(0.5);
  title.position.set(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 - 24);
  app.stage.addChild(title);

  const subtitle = new Text({
    text: "Phase 0 빈 무대",
    style: new TextStyle({ fill: COLORS.textDim, fontSize: 24 }),
  });
  subtitle.anchor.set(0.5);
  subtitle.position.set(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 + 32);
  app.stage.addChild(subtitle);
}

boot().catch((err: unknown) => {
  console.error("부트 실패:", err);
});
