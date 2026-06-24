// 최소 HUD — 실시간 개체 수/먹이/틱. 멸종하면 알려준다.
// 본격 가독성 연출(死因·하이라이트·카메라)은 Phase 6.

import { Container, Text, TextStyle } from "pixi.js";
import type { World } from "@/sim/world";
import { COLORS } from "@/config";

export class Hud {
  readonly container = new Container();
  private readonly stat: Text;
  private readonly notice: Text;

  constructor() {
    this.stat = new Text({
      text: "",
      style: new TextStyle({ fill: COLORS.text, fontSize: 22, fontWeight: "600" }),
    });
    this.stat.position.set(16, 14);

    this.notice = new Text({
      text: "",
      style: new TextStyle({ fill: COLORS.textDim, fontSize: 20 }),
    });
    this.notice.position.set(16, 44);

    this.container.addChild(this.stat);
    this.container.addChild(this.notice);
  }

  sync(world: World): void {
    this.stat.text = `개체 수 ${world.population}   먹이 ${world.availableFood}   틱 ${world.tick}`;
    this.notice.text = world.population === 0 ? "멸종했습니다. 새 종으로 다시 시작합니다." : "";
  }
}
