// 하이라이트 배너 — 주목할 사건(보스 등장/대멸종/멸종 위기/관문 통과)을 화면 위쪽에 잠깐 띄운다.
// 스케일 컨테이너 밖(화면 픽셀)에 올려 선명하게. 가독성 §7: "지금 무슨 일이 일어나는가".

import { Container, Text, TextStyle } from "pixi.js";

const DURATION = 2200; // ms

export class Highlights {
  readonly container = new Container();
  private readonly text: Text;
  private life = 0;

  constructor() {
    this.text = new Text({
      text: "",
      style: new TextStyle({
        fill: 0xffffff,
        fontSize: 28,
        fontWeight: "800",
        stroke: { color: 0x06080d, width: 5 },
        align: "center",
      }),
    });
    this.text.anchor.set(0.5);
    this.text.visible = false;
    this.container.addChild(this.text);
  }

  flash(message: string, color: number): void {
    this.text.text = message;
    this.text.style.fill = color;
    this.life = DURATION;
    this.text.visible = true;
  }

  update(deltaMS: number, screenW: number): void {
    if (this.life <= 0) {
      this.text.visible = false;
      return;
    }
    this.life -= deltaMS;
    const t = this.life / DURATION; // 1 → 0
    this.text.alpha = Math.min(1, t * 3); // 마지막 ~0.7초에 페이드아웃
    this.text.position.set(screenW / 2, 70 + (1 - t) * -8);
  }
}
