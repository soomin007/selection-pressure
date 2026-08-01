// 알파 조종(앞장서기)의 플로팅 조이스틱 표시. **그리기만 한다** — 입력 판정은 main 이 하고,
// 여기는 그 상태를 그대로 옮겨 그린다(sim 은 물론이고 입력 로직도 이 파일에 없다).
//
// app.stage 에 직접(월드 스케일 밖) 붙어 포인터 좌표(e.global)와 1:1 인 스크린 픽셀로 그린다 →
// 카메라 줌·팬과 무관하게 "누른 자리"와 그림이 어긋나지 않는다. 스케일도 안 건다: 스틱은 손가락
// 입력 전용이고(데스크톱은 WASD), 모바일에서 UI 확대 배율은 항상 1 이라 배율을 곱하면 오히려
// 포인터 좌표와 어긋난다(known_issues 의 "zoom 아래 좌표 함정"과 같은 자리).
//
// DOM 위젯을 안 쓰는 이유: 좌하단은 이미 확대 바·개체 카드·드래프트 하단이 3중으로 겹치는 자리다.

import { Container, Graphics } from "pixi.js";

// 월드의 알파 표식(worldView 의 LEAD_COLOR)과 같은 청백 — "이 스틱이 저 개체를 민다"가 색으로 이어진다.
const STICK_COLOR = 0xf0f8ff;
// 스틱 아래 깔리는 어둠. 밝은 지형(사막·눈) 위에서도 흰 링이 읽히게 하되, 아래가 안 보이면 안 되니 옅게.
const STICK_SHADE = 0x06080d;
// 엄지 점 반경(스크린 px). 손가락 아래로 사라지지 않을 만큼 크고, 시야를 안 가릴 만큼 작게.
const THUMB_R = 15;

/**
 * 누른 자리에 생기는 플로팅 조이스틱. 드래그하는 동안에만 보인다.
 *
 * 세기(throttle)를 밝기로 보인다 — 살살 미는 것과 끝까지 미는 것이 실제로 갈리는데(main 의
 * 데드존~최대 램프), 그림이 항상 같으면 "왜 느리지"를 화면에서 알 수 없다.
 */
export class LeadStick {
  readonly container = new Container();
  private readonly g = new Graphics();

  constructor() {
    this.container.addChild(this.g);
    this.container.visible = false;
  }

  /**
   * origin 이 null 이면 숨긴다(손을 뗀 상태). dx,dy 는 누른 자리에서의 스크린 오프셋,
   * maxR 은 출력이 1 이 되는 반경(main 의 STICK_MAX). 엄지 점은 maxR 로 클램프해
   * "여기까지가 전력이고 더 밀어도 안 빨라진다"를 손끝에 알린다.
   */
  set(origin: { x: number; y: number } | null, dx: number, dy: number, maxR: number): void {
    this.g.clear();
    if (origin === null || maxR <= 0) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    const len = Math.hypot(dx, dy);
    const k = len > maxR ? maxR / len : 1; // 최대 반경으로 클램프(표시가 실제 출력과 같아야 한다)
    const tx = origin.x + dx * k;
    const ty = origin.y + dy * k;
    const power = Math.min(1, len / maxR); // 0~1 — 지금 얼마나 세게 밀고 있나

    // 최대 출력 반경 테두리 — 여기까지 밀면 전력. 밀수록 테두리가 밝아진다.
    this.g.circle(origin.x, origin.y, maxR).fill({ color: STICK_SHADE, alpha: 0.12 });
    this.g
      .circle(origin.x, origin.y, maxR)
      .stroke({ color: STICK_COLOR, width: 2, alpha: 0.2 + 0.2 * power });
    // 누른 자리(원점) — 손가락이 미끄러져도 기준점이 어디였는지 보인다.
    this.g.circle(origin.x, origin.y, 4).fill({ color: STICK_COLOR, alpha: 0.3 });
    // 원점 → 엄지 막대. 방향과 세기가 한 그림에 다 들어간다.
    if (len > 0.5) {
      this.g
        .moveTo(origin.x, origin.y)
        .lineTo(tx, ty)
        .stroke({ color: STICK_COLOR, width: 2.5, alpha: 0.22 + 0.3 * power });
    }
    // 엄지 점.
    this.g.circle(tx, ty, THUMB_R).fill({ color: STICK_COLOR, alpha: 0.12 + 0.16 * power });
    this.g
      .circle(tx, ty, THUMB_R)
      .stroke({ color: STICK_COLOR, width: 2, alpha: 0.45 + 0.35 * power });
  }
}
