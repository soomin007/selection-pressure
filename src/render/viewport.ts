// scale-to-fit: 고정 논리 해상도의 캔버스를 창 크기에 맞춰 비율 유지로 확대/축소한다.
// 캔버스 내부 버퍼는 논리 해상도(×DPR) 그대로 두고, CSS 크기만 바꾼다.
// body 가 flex 중앙정렬이라 남는 공간은 자동으로 레터박스가 된다.

export function createViewport(
  canvas: HTMLCanvasElement,
  logicalW: number,
  logicalH: number,
): { fit: () => void; dispose: () => void } {
  const fit = (): void => {
    const scale = Math.min(window.innerWidth / logicalW, window.innerHeight / logicalH);
    canvas.style.width = `${Math.round(logicalW * scale)}px`;
    canvas.style.height = `${Math.round(logicalH * scale)}px`;
  };

  fit();
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);

  const dispose = (): void => {
    window.removeEventListener("resize", fit);
    window.removeEventListener("orientationchange", fit);
  };

  return { fit, dispose };
}
