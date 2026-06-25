// 전역 상수 + 레이아웃 선택. 코어 시뮬은 동일하고, 모바일/데스크톱은 논리 해상도와 UI 만 다르다.
//
// 논리 해상도 ≠ 실제 픽셀. resolution=DPR + autoDensity(main.ts) 로 선명하게 렌더된다.
// 모바일: 세로 9:16(브라우저 주소창 감안). 데스크톱: 가로(넓은 부감). 면적은 비슷해 밸런스 유지.

export interface Layout {
  width: number;
  height: number;
  isDesktop: boolean;
}

const MOBILE: Layout = { width: 540, height: 960, isDesktop: false };
const DESKTOP: Layout = { width: 960, height: 600, isDesktop: true };

/** 창 비율로 모바일/데스크톱 레이아웃을 고른다. (가로로 넓으면 데스크톱) */
export function chooseLayout(): Layout {
  const landscape = window.innerWidth > window.innerHeight;
  const wide = window.innerWidth >= 760;
  return landscape && wide ? { ...DESKTOP } : { ...MOBILE };
}

// 하위 호환용 기본값(모바일).
export const LOGICAL_WIDTH = MOBILE.width;
export const LOGICAL_HEIGHT = MOBILE.height;

export const COLORS = {
  bg: 0x0b0e14,
  text: 0xe6e6e6,
  textDim: 0x8a93a6,
  accent: 0x6cc24a,
} as const;
