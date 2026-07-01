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

/**
 * 창 비율로 모바일/데스크톱 레이아웃을 고른다(가로로 넓으면 데스크톱).
 *
 * 논리 해상도의 한 변만 고정하고 다른 변은 "실제 창 비율"로 맞춘다 — 고정 9:16 등으로 두면
 * 화면 비율과 달라 scale-to-fit(viewport)이 레터박스(빈 띠)를 남기고, 월드가 화면을 못 채운
 * 채(시야 작음) HUD·미니맵 박스는 그 띠(맵 밖)에 그려진다. 비율을 맞추면 레터박스가 사라진다.
 */
export function chooseLayout(): Layout {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const landscape = w > h;
  const wide = w >= 760;
  const ratio = w > 0 && h > 0 ? w / h : 540 / 960;
  if (landscape && wide) {
    // 데스크톱(가로) — 높이 고정, 폭을 창 비율로.
    return { width: Math.round(DESKTOP.height * ratio), height: DESKTOP.height, isDesktop: true };
  }
  // 모바일(세로) — 폭 고정, 높이를 창 비율로(길쭉한 폰일수록 세로가 길어져 꽉 찬다).
  return { width: MOBILE.width, height: Math.round(MOBILE.width / ratio), isDesktop: false };
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
