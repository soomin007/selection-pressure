// 레이드 격퇴 체력 바 — 보스 위가 아니라 **화면 상단에 글로벌로** 뜬다(2026-07-16 사용자 방향). 보스가
// 등장하는 동안 보스 이름과 함께 큰 게이지로 떠, 무리가 보스를 얼마나 깎았는지 한눈에 읽힌다. 격퇴 체력이
// 있는 보스(레이드 켜짐)만 보이고, 전역 시련(독 안개)·격퇴 없는 상태에선 숨는다. 화면 픽셀 좌표(스케일 밖).

import { Container, Graphics, Text, TextStyle } from "pixi.js";

export class RaidBossBar {
  readonly container = new Container();
  private readonly track = new Graphics();
  private readonly fill = new Graphics();
  private readonly nameText: Text;
  private frac = 1;
  private displayFrac = 1; // 부드럽게 따라가는 표시값(깎일 때 스르륵 줄어든다)
  private color = 0xff5a44;

  constructor() {
    this.nameText = new Text({
      text: "",
      style: new TextStyle({
        fill: 0xffe0d2,
        fontSize: 15,
        fontWeight: "800",
        stroke: { color: 0x160a06, width: 4 },
        align: "center",
      }),
    });
    this.nameText.anchor.set(0.5, 1); // 가로 가운데, 아래 기준(바 위에 올린다)
    this.container.addChild(this.track, this.fill, this.nameText);
    this.container.visible = false;
  }

  /** 보스 상태 반영 — name 이 null 이면(격퇴 없는 보스·보스 없음) 숨긴다. */
  set(name: string | null, frac: number, color: number): void {
    if (name === null) {
      this.container.visible = false;
      return;
    }
    if (!this.container.visible) this.displayFrac = frac; // 새로 뜰 땐 튀지 않게 현재값으로
    this.container.visible = true;
    this.nameText.text = name;
    this.frac = frac < 0 ? 0 : frac > 1 ? 1 : frac;
    this.color = color;
  }

  update(dtMS: number, screenW: number): void {
    if (!this.container.visible) return;
    // 표시값이 실제 체력을 부드럽게 따라간다(프레임률 독립) — 물기당 깎임이 스르륵 이어져 보인다.
    const k = 1 - Math.pow(1 - 0.18, dtMS / (1000 / 60));
    this.displayFrac += (this.frac - this.displayFrac) * k;

    const barW = Math.min(360, screenW - 40);
    const barH = 13;
    const x0 = (screenW - barW) / 2;
    const y0 = 166; // 좌상단 정보 카드 + 타임라인 막대 아래(그 위는 다 가려진다). 위협 전광판(화면 중앙)과도 안 겹친다.

    this.track.clear();
    this.track.roundRect(x0 - 3, y0 - 3, barW + 6, barH + 6, 8).fill({ color: 0x0e0a08, alpha: 0.82 });

    this.fill.clear();
    const nearDown = this.displayFrac <= 0.3; // 얼마 안 남으면 밝게(곧 격퇴)
    const fw = barW * this.displayFrac;
    if (fw > 1) this.fill.roundRect(x0, y0, fw, barH, 6).fill({ color: this.color, alpha: nearDown ? 0.8 : 0.96 });
    this.track.roundRect(x0, y0, barW, barH, 6).stroke({ color: 0xffffff, width: 1, alpha: 0.32 });

    this.nameText.x = screenW / 2;
    this.nameText.y = y0 - 4;
  }
}
