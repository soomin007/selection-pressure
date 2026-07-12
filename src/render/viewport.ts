// scale-to-fit. 캔버스를 CSS 로 늘리면(작은 논리 캔버스 → 큰 화면) 뭉개진다.
// 대신 렌더러는 창 실제 픽셀로 그리고, 루트 컨테이너를 비율 유지로 스케일·중앙배치한다.
// → 항상 네이티브 해상도로 선명하게.
//
// 논리 크기(logical)는 **참조로** 받아 fit() 이 매번 최신값을 읽는다 — 모바일 주소창이 접혔다 펴지며 화면
// 비율이 달라질 때 호출부가 logical.height 를 창 비율에 맞춰 갱신하고 fit() 을 다시 부르면 레터박스가 안 남는다
// (부팅 때 한 번만 잡으면 비율이 어긋나 위아래 검은 띠가 생겼다 — 이 버그의 원인). 리사이즈 배선은 호출부가 맡는다.

import type { Application, Container } from "pixi.js";

export function setupViewport(
  app: Application,
  root: Container,
  logical: { width: number; height: number },
): { fit: () => void } {
  const fit = (): void => {
    const sw = app.screen.width;
    const sh = app.screen.height;
    const s = Math.min(sw / logical.width, sh / logical.height);
    root.scale.set(s);
    root.x = Math.round((sw - logical.width * s) / 2);
    root.y = Math.round((sh - logical.height * s) / 2);
  };
  fit();
  return { fit };
}
