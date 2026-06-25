// 월드 상태를 PixiJS 로 그린다. sim 상태를 "읽기"만 하고 바꾸지 않는다.
// (render 가 sim 을 읽는 건 정상. 금지되는 건 sim 이 Pixi 를 import 하는 것.)
// 배경=환경(추위 파랑/따뜻 빨강/비옥 밝기), 먹이=초록 점, 개체=에너지 밝기.
// 환경 배경은 변하지 않으니 런이 바뀔 때 한 번만 그린다.
// 수천 마리로 늘어나면 ParticleContainer/스프라이트로 교체 — 그때의 일.

import { Container, Graphics } from "pixi.js";
import type { World } from "@/sim/world";
import type { Environment } from "@/sim/environment";
import { SIM } from "@/sim/params";
import { COLORS } from "@/config";

export class WorldView {
  readonly container = new Container();
  private readonly envG = new Graphics();
  private readonly foodG = new Graphics();
  private readonly entityG = new Graphics();
  private readonly bossG = new Graphics();

  constructor() {
    this.container.addChild(this.envG);
    this.container.addChild(this.foodG);
    this.container.addChild(this.entityG);
    this.container.addChild(this.bossG);
  }

  /** 런이 바뀔 때 한 번 호출. 환경 배경을 다시 그린다. */
  drawEnvironment(env: Environment): void {
    this.envG.clear();
    for (let cy = 0; cy < env.rows; cy++) {
      for (let cx = 0; cx < env.cols; cx++) {
        const i = cy * env.cols + cx;
        const cold = env.coldness[i] ?? 0;
        const fert = env.fertility[i] ?? 0;
        const warm = 1 - cold;
        const bright = 0.45 + 0.55 * fert; // 비옥할수록 밝게
        const r = Math.round(70 * warm * bright + 12);
        const g = Math.round(26 * bright + 10);
        const b = Math.round(120 * cold * bright + 16);
        const color = (r << 16) | (g << 8) | b;
        this.envG.rect(cx * env.cellSize, cy * env.cellSize, env.cellSize, env.cellSize).fill({
          color,
          alpha: 1,
        });
      }
    }
  }

  sync(world: World): void {
    this.foodG.clear();
    for (const f of world.food) {
      if (!f.available) continue;
      this.foodG.circle(f.x, f.y, 3).fill({ color: 0x7bd64a, alpha: 0.95 });
    }

    this.entityG.clear();
    for (const e of world.entities) {
      // 에너지가 많을수록 밝게 → "건강한지"가 한눈에 읽힌다 (가독성, §7)
      const t = Math.max(0, Math.min(1, e.energy / SIM.maxEnergy));
      this.entityG.circle(e.x, e.y, 4).fill({ color: COLORS.accent, alpha: 0.35 + 0.65 * t });
    }

    // 보스 + 위험 반경을 눈에 띄게 (어디가 죽음의 영역인지 읽혀야 한다, §7)
    this.bossG.clear();
    const boss = world.boss;
    if (boss) {
      if (boss.auraRadius > 0) {
        this.bossG.circle(boss.x, boss.y, boss.auraRadius).fill({ color: 0xb050d0, alpha: 0.16 });
      }
      if (boss.killRadius > 0) {
        this.bossG.circle(boss.x, boss.y, boss.killRadius).fill({ color: 0xe0402a, alpha: 0.28 });
      }
      this.bossG.circle(boss.x, boss.y, 9).fill({ color: 0xff5535, alpha: 1 });
    }
  }
}
