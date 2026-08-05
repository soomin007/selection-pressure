// 하이라이트 배너 · 주목할 사건(보스 등장/대멸종/멸종 위기/관문 통과)을 화면 위쪽에 잠깐 띄운다.
// 스케일 컨테이너 밖(화면 픽셀)에 올려 선명하게. 가독성 §7: "지금 무슨 일이 일어나는가".

import { Container, Text, TextStyle } from "pixi.js";
import type { PixiTextRect } from "@/render/pixiTextRects";

const DURATION = 2200; // ms

export class Highlights {
  readonly container = new Container();
  private readonly text: Text;
  private life = 0;
  private scale = 1; // 데스크톱 UI 확대 배율 · 화면 좌표를 되돌려 줄 때 곱한다
  /** 지금 문구가 "끝까지 보여야 하는" 문구인가(시험 판정 등). 살아 있는 동안 일반 flash 가 못 덮는다. */
  private protect = false;
  /** 보호 문구가 사는 동안 밀려난 일반 문구들 · 보호 문구가 끝나면 순서대로 이어서 띄운다(최대 2개). */
  private pending: { msg: string; color: number }[] = [];

  constructor() {
    // ⚠ wordWrap 필수(threatBanner 와 같은 함정) · 없으면 긴 문구("불씨는 이 혈통의 남은 기회입니다…")가
    // 한 줄로 뻗어 폰(360~390px)에서 양끝이 화면 밖으로 잘린다. 폭은 update 에서 매 프레임 화면에 맞춘다.
    // breakWords: 한국어는 어절이 길어 공백만으로는 안 접힐 때가 있어 글자 단위 줄바꿈까지 허용한다.
    this.text = new Text({
      text: "",
      style: new TextStyle({
        fill: 0xffffff,
        fontSize: 28,
        fontWeight: "800",
        stroke: { color: 0x06080d, width: 5 },
        align: "center",
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: 320,
      }),
    });
    // 세로 anchor 0: 여러 줄이 되면 **아래로** 자란다. 가운데(0.5) 앵커면 윗줄이 위로 자라
    // 상단 goalBar(DOM, top 8px)를 덮는다.
    this.text.anchor.set(0.5, 0);
    this.text.visible = false;
    this.container.addChild(this.text);
  }

  /** 데스크톱 UI 확대 · 컨테이너를 키우고, 텍스트는 배율만큼 높은 해상도로 다시 구워 흐림을 막는다.
   *  호출부(main)는 update 에 화면 폭을 배율로 나눈 "논리 화면"을 넘긴다. */
  setUiScale(s: number): void {
    this.scale = s;
    this.container.scale.set(s);
    this.text.resolution = (window.devicePixelRatio || 1) * s;
  }

  /**
   * 지금 뜬 문구의 아래 끝(논리 픽셀). 안 떠 있으면 0.
   * 위협 예고 전광판이 이 아래로 비켜 앉는 근거다 · 둘 다 "HUD 아래"로 밀려나면 서로 겹친다
   * (실제로 겪었다: 상세를 펼친 짧은 폰에서 보스 등장 플래시와 예고 띠가 같은 자리에 얹혔다).
   */
  bottomY(): number {
    if (!this.text.visible || this.life <= 0 || this.text.alpha < 0.05) return 0;
    return this.text.y + this.text.height;
  }

  /** 지금 실제로 보이는 글씨의 화면 사각형(겹침 검사기용 · pixiTextRects 참고). 안 보이면 빈 배열. */
  screenRects(): PixiTextRect[] {
    if (!this.text.visible || this.life <= 0 || this.text.alpha < 0.05) return [];
    const s = this.scale;
    return [
      {
        label: "Pixi 하이라이트",
        text: this.text.text,
        x: (this.text.x - this.text.width / 2) * s, // anchor(0.5, 0)
        y: this.text.y * s,
        w: this.text.width * s,
        h: this.text.height * s,
      },
    ];
  }

  /**
   * 문구 하나를 잠깐 띄운다. priority=true 는 "끝까지 읽혀야 하는" 문구(시험 판정 등):
   * 즉시 떠서 DURATION 을 보장받고, 그동안 들어온 일반 문구는 덮지 않고 뒤로 줄을 선다.
   * (단일 슬롯이라 판정 플래시가 같은 프레임의 보스 등장 플래시에 덮여 안 보이던 사고의 방지책.)
   */
  flash(message: string, color: number, priority = false): void {
    if (!priority && this.protect && this.life > 0) {
      this.pending.push({ msg: message, color });
      if (this.pending.length > 2) this.pending.shift(); // 오래된 것부터 버린다(무한 적체 방지)
      return;
    }
    this.text.text = message;
    this.text.style.fill = color;
    this.life = DURATION;
    this.protect = priority;
    this.text.visible = true;
  }

  /**
   * @param topSafe 화면 위쪽에서 DOM HUD(목표 줄)가 차지한 높이(논리 픽셀). 이 아래에만 그린다.
   *   ⚠ 기본값을 주지 않는다 · 안 넘겨도 조용히 동작하면 기능이 통째로 죽는다(known_issues).
   */
  update(deltaMS: number, screenW: number, topSafe: number): void {
    if (this.life <= 0) {
      const next = this.pending.shift();
      if (!next) {
        this.text.visible = false;
        return;
      }
      this.flash(next.msg, next.color); // 보호 문구가 끝났다 · 밀려나 있던 문구를 이어서 띄운다
    }
    this.life -= deltaMS;
    // 우상단 미니맵 기둥(고정 폭 84 + 여백, minimap.ts MM_W/MM_TOP)을 비워 두고, 남는 왼쪽 공간의
    // 가운데에 놓는다 · 화면 전체 폭으로 접으면 긴 문구의 오른쪽 끝이 미니맵 **밑으로 들어가 가려진다**.
    // 세로는 goalBar(DOM) **아래 끝에서** 시작해 anchor(0.5, 0)으로 아래로만 자란다. 예전엔 "두 줄
    // ≈ 60px" 이라 보고 66 을 박아 뒀는데, 그 줄은 문구에 따라 자라므로(보스 판에서 74px, 상세를
    // 펼치면 251px) 고정값은 언제나 틀린다 · 빨간 보스 플래시의 윗줄이 패널 뒤로 들어가 안 읽혔다.
    const reserved = 110; // 미니맵 84 + 좌우 여백
    const wrapW = Math.max(180, screenW - reserved - 16);
    if (this.text.style.wordWrapWidth !== wrapW) this.text.style.wordWrapWidth = wrapW;
    const size = screenW < 420 ? 24 : 28; // 좁은 폰은 글자를 줄여 3~4줄 폭발을 막는다(threatBanner 패턴)
    if (this.text.style.fontSize !== size) this.text.style.fontSize = size;
    const t = this.life / DURATION; // 1 → 0
    this.text.alpha = Math.min(1, t * 3); // 마지막 ~0.7초에 페이드아웃
    const top = Math.max(66, topSafe + 6); // HUD 가 짧으면 예전 자리 그대로, 길어지면 그만큼 내려간다
    // 사라질 때 살짝 떠오르는 연출 · 떠오르는 끝점이 top 이라 어떤 순간에도 HUD 를 침범하지 않는다
    // (예전엔 top 에서 8px 더 위로 올라가, 마지막 0.7초 동안 패널 뒤로 들어갔다).
    this.text.position.set((screenW - reserved + 16) / 2, top + 8 - (1 - t) * 8);
  }
}
