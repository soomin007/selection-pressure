// 캔버스(Pixi) 에 그리는 글씨의 화면 사각형을 DOM 으로 내보내는 통로 · **겹침 검사기의 눈**이다.
//
// 왜 있나 (2026-08-05, 같은 부류를 세 번째로 놓친 뒤):
// `scripts/overlap-check.mjs` 는 DOM 만 잰다. 그래서 위협 예고 전광판·판정/보스 플래시처럼 캔버스에
// 그리는 글씨가 왼쪽 위 목표 줄(DOM) 뒤로 들어가 안 보여도 검사기는 늘 초록불이었다. 사용자가 세 번
// 지적한 "빨간 글씨·초록 글씨가 가려서 안 보인다"가 바로 그것이다.
// → 그리는 쪽이 자기 글씨의 화면 좌표를 `body.dataset.pixiText` 에 남기고, 검사기가 그걸 읽어
//   DOM 글자 사각형과 함께 잰다. 미니맵이 `body.dataset.minimap` 으로 쓰던 것과 같은 수법인데,
//   거긴 "떠 있나"만 알렸고 여기는 **어디에 얼마나 크게** 있는지까지 알린다.
//
// 계약(검사기와 공유): `data-pixi-text` 는 PixiTextRect[] 의 JSON. 화면 CSS 픽셀 좌표(= DOM 의
// getBoundingClientRect 와 같은 자), 글씨가 안 보이면 빈 문자열. 값이 바뀔 때만 쓴다.

/** 캔버스에 그려진 글씨 하나의 화면 사각형. */
export interface PixiTextRect {
  /** 어느 위젯인지(검사기 보고에 그대로 찍힌다). */
  label: string;
  /** 그 순간의 문구 · 어떤 안내가 가려졌는지 보고에서 바로 읽히게. */
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

let last = "";

/**
 * 지금 화면의 Pixi 글씨 목록을 body 에 싣는다. 매 프레임 불러도 되도록 값이 바뀔 때만 DOM 을 쓴다.
 * (검사기 전용 배관이라 게임 로직·밸런스와 무관하다. 크기가 아주 작아 배포 빌드에서도 그대로 둔다.
 *  개발에서만 켜면 "검사기에선 되는데 배포에선 안 되는" 상태를 또 만들 수 있다.)
 */
export function publishPixiTextRects(rects: PixiTextRect[]): void {
  const json = rects.length > 0 ? JSON.stringify(rects) : "";
  if (last === json) return;
  last = json;
  if (json === "") delete document.body.dataset["pixiText"];
  else document.body.dataset["pixiText"] = json;
}
