// 전역 상수. 모바일·세로 우선 + 고정 논리 해상도(scale-to-fit 의 기준).
// 폰에서 꽉 차고, 데스크톱에선 좌우 레터박스만 생긴다.
//
// 논리 해상도 ≠ 실제 픽셀. resolution=DPR + autoDensity(main.ts) 로 폰의 실제
// 픽셀 밀도만큼 선명하게 렌더된다. 여기 숫자는 "좌표 공간 + 비율"만 정한다.
// 9:16 채택 — 모바일 브라우저는 주소창/내비게이션 바가 위아래를 먹어 실사용 영역이
// 9:16 에 가깝다. (길쭉한 폰이면 위아래에 약간의 레터박스가 생길 수 있음)

/** 논리 해상도 — 모든 시뮬/렌더 좌표는 이 기준. 실제 픽셀은 viewport 가 맞춘다. */
export const LOGICAL_WIDTH = 540;
export const LOGICAL_HEIGHT = 960;

export const COLORS = {
  bg: 0x0b0e14,
  text: 0xe6e6e6,
  textDim: 0x8a93a6,
  accent: 0x6cc24a,
} as const;
