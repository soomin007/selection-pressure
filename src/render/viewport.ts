// scale-to-fit. 캔버스를 CSS 로 늘리면(작은 논리 캔버스 → 큰 화면) 뭉개진다.
// 대신 렌더러는 창 실제 픽셀로 그리고, 루트 컨테이너를 비율 유지로 스케일·중앙배치한다.
// → 항상 네이티브 해상도로 선명하게. 남는 공간은 배경색 레터박스.

import type { Application, Container } from "pixi.js";

export function setupViewport(
  app: Application,
  root: Container,
  logicalW: number,
  logicalH: number,
): { fit: () => void } {
  const fit = (): void => {
    const sw = app.screen.width;
    const sh = app.screen.height;
    const s = Math.min(sw / logicalW, sh / logicalH);
    root.scale.set(s);
    root.x = Math.round((sw - logicalW * s) / 2);
    root.y = Math.round((sh - logicalH * s) / 2);
  };

  fit();
  app.renderer.on("resize", fit);
  return { fit };
}
