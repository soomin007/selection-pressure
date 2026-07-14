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
    // ⚠ wordWrap 이 필수다 — 없으면 대응 힌트("물속을 도는 상어가 …")가 한 줄로 뻗어 폰 화면 밖으로
    // **잘려 나간다**(사용자 지적). 폭은 update 에서 화면 크기에 맞춰 매 프레임 갱신한다(회전 대응).
    // breakWords: 한국어는 어절이 길어 공백만으로는 안 접힐 때가 있어 글자 단위 줄바꿈까지 허용한다.
    this.text = new Text({
      text: "",
      style: new TextStyle({
        fill: 0xf5c33b, // amber(3a 위협 예고)
        fontSize: 38,
        fontWeight: "900",
        stroke: { color: 0x1a0d06, width: 7 },
        align: "center",
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: 320,
        lineHeight: 44,
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
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: 320,
        lineHeight: 22,
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

    // 화면 폭에 맞춰 줄바꿈 폭·글자 크기를 조인다 — 좁은 폰에서 글자가 잘리거나 띠가 화면을 넘지 않게.
    // 양옆 여백 24px 씩 + 띠 안쪽 여백을 빼고 남는 만큼만 쓴다.
    const wrapW = Math.max(180, screenW - 48 - 40);
    if (this.text.style.wordWrapWidth !== wrapW) {
      this.text.style.wordWrapWidth = wrapW;
      this.subText.style.wordWrapWidth = wrapW;
    }
    const titleSize = screenW < 420 ? 30 : 38; // 좁은 화면에선 제목을 줄인다
    if (this.text.style.fontSize !== titleSize) {
      this.text.style.fontSize = titleSize;
      this.text.style.lineHeight = titleSize + 6;
    }

    this.text.position.set(cx, cy);
    const hasSub = this.subText.visible;
    this.subText.position.set(cx, cy + this.text.height / 2 + 6);
    // 어두운 경고 띠 — 이름 + 힌트를 함께 감싼다(빨강 테두리 전광판).
    // 화면을 넘지 않게 상한을 둔다(줄바꿈이 들어가도 띠가 밖으로 삐져나가지 않게).
    const w = Math.min(
      screenW - 24,
      Math.max(this.text.width, hasSub ? this.subText.width : 0) + 56,
    );
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
