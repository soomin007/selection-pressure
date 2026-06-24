// 월드 상태를 PixiJS 로 그린다. sim 상태를 "읽기"만 하고 바꾸지 않는다.
// (render 가 sim 을 읽는 건 정상. 금지되는 건 sim 이 Pixi 를 import 하는 것.)
// Phase 1: 먹이=초록 점, 개체=밝기로 에너지 표시. (수백 마리까지 Graphics 재드로우로 충분)
// 수천 마리로 늘어나면 ParticleContainer/스프라이트로 교체 — 그때의 일.

import { Container, Graphics } from "pixi.js";
import type { World } from "@/sim/world";
import { SIM } from "@/sim/params";
import { COLORS } from "@/config";

export class WorldView {
  readonly container = new Container();
  private readonly foodG = new Graphics();
  private readonly entityG = new Graphics();

  constructor() {
    this.container.addChild(this.foodG);
    this.container.addChild(this.entityG);
  }

  sync(world: World): void {
    this.foodG.clear();
    for (const f of world.food) {
      if (!f.available) continue;
      this.foodG.circle(f.x, f.y, 3).fill({ color: 0x3a7d2c, alpha: 0.9 });
    }

    this.entityG.clear();
    for (const e of world.entities) {
      // 에너지가 많을수록 밝게 → "건강한지"가 한눈에 읽힌다 (가독성, §7)
      const t = Math.max(0, Math.min(1, e.energy / SIM.maxEnergy));
      this.entityG.circle(e.x, e.y, 4).fill({ color: COLORS.accent, alpha: 0.35 + 0.65 * t });
    }
  }
}
