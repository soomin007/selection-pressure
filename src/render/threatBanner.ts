// 위협 예고 전광판 — 보스/대멸종 단계 직전, 화면 중앙에 크게 알린다(전투 전 마음의 준비, §4.2).
// 상단 하이라이트(highlights)보다 크고 배경 띠가 있어 "전광판"처럼 확 눈에 띈다. 화면 픽셀 좌표.

import { Container, Graphics, Text, TextStyle } from "pixi.js";

const DURATION = 2600; // ms

export class ThreatBanner {
  readonly container = new Container();
  private readonly bg = new Graphics();
  private readonly text: Text; // 위협 이름(큰 글씨)
  private readonly subText: Text; // 대응 힌트(작은 글씨)
  private life = 0;

  constructor() {
    this.text = new Text({
      text: "",
      style: new TextStyle({
        fill: 0xf5c33b, // amber(3a 위협 예고)
        fontSize: 38,
        fontWeight: "900",
        stroke: { color: 0x1a0d06, width: 7 },
        align: "center",
      }),
    });
    this.text.anchor.set(0.5);
    this.subText = new Text({
      text: "",
      style: new TextStyle({
        fill: 0xead9b8,
        fontSize: 16,
        fontWeight: "700",
        stroke: { color: 0x1a0d06, width: 4 },
        align: "center",
      }),
    });
    this.subText.anchor.set(0.5, 0);
    this.container.addChild(this.bg);
    this.container.addChild(this.text);
    this.container.addChild(this.subText);
    this.container.visible = false;
  }

  show(title: string, sub: string): void {
    this.text.text = title;
    this.subText.text = sub;
    this.subText.visible = sub !== "";
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
    const cy = screenH * 0.4;
    this.text.position.set(cx, cy);
    const hasSub = this.subText.visible;
    this.subText.position.set(cx, cy + this.text.height / 2 + 6);
    // 어두운 경고 띠 — 이름 + 힌트를 함께 감싼다(빨강 테두리 전광판).
    const w = Math.max(this.text.width, hasSub ? this.subText.width : 0) + 56;
    const top = cy - this.text.height / 2 - 14;
    const bottom = hasSub
      ? cy + this.text.height / 2 + 6 + this.subText.height + 12
      : cy + this.text.height / 2 + 14;
    this.bg.clear();
    this.bg
      .roundRect(cx - w / 2, top, w, bottom - top, 14)
      .fill({ color: 0x1a0d06, alpha: 0.78 })
      .stroke({ color: 0xe85c43, width: 2, alpha: 0.85 });
  }
}
