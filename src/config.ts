// 전역 상수. 모바일·세로 우선 + 고정 논리 해상도(scale-to-fit 의 기준).
// 폰에서 꽉 차고, 데스크톱에선 좌우 레터박스만 생긴다.

/** 논리 해상도 — 모든 시뮬/렌더 좌표는 이 기준. 실제 픽셀은 viewport 가 맞춘다. */
export const LOGICAL_WIDTH = 540;
export const LOGICAL_HEIGHT = 960;

export const COLORS = {
  bg: 0x0b0e14,
  text: 0xe6e6e6,
  textDim: 0x8a93a6,
  accent: 0x6cc24a,
} as const;
