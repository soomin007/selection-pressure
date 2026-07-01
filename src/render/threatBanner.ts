// 위협 예고 전광판 — 보스/대멸종 단계 직전, 화면 중앙에 크게 알린다(전투 전 마음의 준비, §4.2).
// 상단 하이라이트(highlights)보다 크고 배경 띠가 있어 "전광판"처럼 확 눈에 띈다. 화면 픽셀 좌표.

import { Container, Graphics, Text, TextStyle } from "pixi.js";

const DURATION = 2600; // ms

export class ThreatBanner {
  readonly container = new Container();
  private readonly bg = new Graphics();
  private readonly text: Text;
  private life = 0;

  constructor() {
    this.text = new Text({
      text: "",
      style: new TextStyle({
        fill: 0xffe08a,
        fontSize: 40,
        fontWeight: "900",
        stroke: { color: 0x1a0606, width: 7 },
        align: "center",
      }),
    });
    this.text.anchor.set(0.5);
    this.container.addChild(this.bg);
    this.container.addChild(this.text);
    this.container.visible = false;
  }

  show(message: string): void {
    this.text.text = message;
    this.life = DURATION;
    this.container.visible = true;
  }

  update(deltaMS: number, screenW: number, screenH: number): void {
    if (this.life <= 0) {
      this.container.visible = false;
      return;
    }
    this.life -= deltaMS;
    const t = this.life / DURATION; // 1 → 0
    this.container.alpha = Math.min(1, t * 4); // 빠르게 등장, 마지막 ~0.65초에 페이드아웃
    const cx = screenW / 2;
    const cy = screenH * 0.42;
    this.text.position.set(cx, cy);
    // 어두운 경고 띠 — 텍스트 폭에 맞춰. 전광판 느낌(빨강 테두리).
    const w = this.text.width + 60;
    const h = this.text.height + 26;
    this.bg.clear();
    this.bg
      .roundRect(cx - w / 2, cy - h / 2, w, h, 12)
      .fill({ color: 0x1a0808, alpha: 0.72 })
      .stroke({ color: 0xff6a4a, width: 2, alpha: 0.85 });
  }
}
