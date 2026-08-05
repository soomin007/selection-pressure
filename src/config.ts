// 전역 상수 + 레이아웃 선택. 코어 시뮬은 동일하고, 모바일/데스크톱은 논리 해상도와 UI 만 다르다.
//
// 논리 해상도 ≠ 실제 픽셀. resolution=DPR + autoDensity(main.ts) 로 선명하게 렌더된다.
// 모바일: 세로 9:16(브라우저 주소창 감안). 데스크톱: 가로(넓은 부감). 면적은 비슷해 밸런스 유지.

export interface Layout {
  width: number;
  height: number;
  isDesktop: boolean;
}

export const MOBILE: Layout = { width: 540, height: 960, isDesktop: false };
const DESKTOP: Layout = { width: 960, height: 600, isDesktop: true };

// 맵 배율 상한 — 월드를 화면(논리 해상도)의 이 배수만큼 크게. 소수 개체(한 무리)를 카메라가 따라가며
// 탐험하고, 바이옴(사막·빙하·우림)이 뚜렷한 구역으로 펼쳐지도록 넓게 잡는다.
// ⚠ 이 값이 걸리는 것은 **온보딩 진도 3**(= 지금까지의 온전한 세계)이다. 처음 하는 사람의 첫 판은
// 1.0(월드 = 화면)이고 그 사이는 1.4·1.7 로 넓어진다 — 진도별 값은 mapScale(step)(src/game/config.ts)
// 한 곳에서만 정한다. **시대(era)가 아니라 진도(step)** 다: 진도 = min(3, 끝낸 런 수 + 시대).
// ⚠ **측정 도구의 단일 근원**: 실제 플레이 세계 치수는 여기서만 나온다. 게임 본편은 진도별 배율
// mapScale(step)(src/game/config.ts)가 이 값을 파생해 쓰고, src/sim/boss.test.ts(격퇴 테스트) ·
// scripts/balance-probe.mjs(밸런스 프로브)도 같은 근원에서 파생한다. 복사본을 만들면 맵 크기를 바꿀 때
// 측정 도구가 존재하지 않는 세계를 재게 된다
// (2026-08-04 격퇴율 72% 사고). src/sim/ 런타임은 이 모듈을 import 하지 않는다(화면 개념 없음).
export const MAP_SCALE = 2.0;
// 면적 배율(areaScale)은 여기 두지 않는다 — 진도마다 다르기 때문이다. 늘 `mapScale(step)²` 로 파생한다
// (Game.makeWorld · scripts/balance-probe.mjs · src/sim/boss.test.ts 가 전부 그렇게 쓴다).
// 개체는 절대 수(소수)라 면적 배율은 먹이 밀도·이주량·스폰 퍼짐에만 걸린다.

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

/**
 * 데스크톱 UI 확대 배율 — 폰 기준 픽셀 크기로 만든 HUD·패널·글자가 큰 모니터에서 너무 작아,
 * 창 높이에 비례해 키운다(1080p 전체화면 ≈ 1.35배). 좁은 세로 창에서 과확대되지 않게 폭으로도
 * 묶고, 상한 1.7(4K 과대 확대 방지). 모바일은 1(기존 그대로).
 * DOM 오버레이는 CSS zoom(--ui-zoom), 화면 픽셀 Pixi UI 는 컨테이너 스케일로 같은 값을 쓴다(main.ts).
 */
export function uiScale(isDesktop: boolean, screenW: number, screenH: number): number {
  if (!isDesktop) return 1;
  return Math.min(1.7, Math.max(1, Math.min(screenH / 750, screenW / 900)));
}

export const COLORS = {
  bg: 0x0b0e14,
  text: 0xe6e6e6,
  textDim: 0x8a93a6,
  accent: 0x6cc24a,
} as const;
