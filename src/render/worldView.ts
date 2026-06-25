// 월드 상태를 PixiJS 로 그린다. sim 상태를 "읽기"만 하고 바꾸지 않는다.
// (render 가 sim 을 읽는 건 정상. 금지되는 건 sim 이 Pixi 를 import 하는 것.)
// 배경=환경(추위 파랑/따뜻 주황/비옥 밝기), 먹이=초록 점, 개체=에너지 밝기, 보스=빨강.
// 대멸종 중엔 화면 전체에 틴트를 깔아 무슨 일이 일어나는지 한눈에 보이게 한다(§7).
// 환경 배경은 변하지 않으니 런이 바뀔 때 한 번만 그린다.

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
  private readonly overlayG = new Graphics();

  constructor() {
    this.container.addChild(this.envG);
    this.container.addChild(this.foodG);
    this.container.addChild(this.entityG);
    this.container.addChild(this.bossG);
    this.container.addChild(this.overlayG);
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
        // 따뜻=주황, 추움=파랑. 비옥할수록 밝게(대비를 키워 폰에서 잘 보이게).
        const lift = 0.5 + 0.75 * fert;
        const r = clamp255((warm * 150 + cold * 28) * lift);
        const g = clamp255((warm * 82 + cold * 78) * lift);
        const b = clamp255((warm * 44 + cold * 156) * lift);
        const color = (r << 16) | (g << 8) | b;
        this.envG
          .rect(cx * env.cellSize, cy * env.cellSize, env.cellSize, env.cellSize)
          .fill({ color, alpha: 1 });
      }
    }
  }

  sync(world: World): void {
    this.foodG.clear();
    for (const f of world.food) {
      if (!f.available) continue;
      this.foodG.circle(f.x, f.y, 3.2).fill({ color: 0x9bee5a, alpha: 1 });
    }

    this.entityG.clear();
    for (const e of world.entities) {
      // 에너지가 많을수록 밝게 → "건강한지"가 한눈에 읽힌다 (가독성, §7)
      const t = Math.max(0, Math.min(1, e.energy / SIM.maxEnergy));
      this.entityG.circle(e.x, e.y, 4).fill({ color: COLORS.accent, alpha: 0.4 + 0.6 * t });
    }

    // 보스 + 위험 반경 (어디가 죽음의 영역인지 읽혀야 한다, §7)
    this.bossG.clear();
    const boss = world.boss;
    if (boss) {
      if (boss.auraRadius > 0) {
        this.bossG.circle(boss.x, boss.y, boss.auraRadius).fill({ color: 0xc060e0, alpha: 0.18 });
      }
      if (boss.killRadius > 0) {
        this.bossG.circle(boss.x, boss.y, boss.killRadius).fill({ color: 0xe0402a, alpha: 0.3 });
      }
      this.bossG.circle(boss.x, boss.y, 10).fill({ color: 0xff5535, alpha: 1 });
    }

    // 대멸종 화면 틴트 (한파=파랑 / 폭염=빨강 / 대가뭄=탁한 갈색)
    this.overlayG.clear();
    let tint = 0;
    let alpha = 0;
    if (world.globalCold > 0) {
      tint = 0x3a6cff;
      alpha = 0.16;
    } else if (world.heat > 0) {
      tint = 0xff5a2a;
      alpha = 0.16;
    } else if (world.foodRegrowMultiplier > 1) {
      tint = 0x8a6a3a;
      alpha = 0.14;
    }
    if (alpha > 0) {
      this.overlayG.rect(0, 0, world.width, world.height).fill({ color: tint, alpha });
    }
  }
}

function clamp255(v: number): number {
  const n = Math.round(v);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}
