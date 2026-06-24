# 적자생존 (Selection Pressure)

한 종(種)을 길러 생태계 정점에 올리는 **관전형 진화 로그라이크**.
직접 조작하지 않고 라운드 사이에 카드를 **선택만** 하면, 규칙기반 생태 시뮬이 결과를 살아 움직이게 한다.

- **라이브 (폰에서 열기): https://soomin007.github.io/selection-pressure/**
- 기획 전문: [`적자생존_기획서_v0.1.md`](적자생존_기획서_v0.1.md)
- 문서 지도: [`docs/INDEX.md`](docs/INDEX.md)
- 개발 규칙: [`CLAUDE.md`](CLAUDE.md)

> `main` 에 push 하면 GitHub Actions 가 빌드해서 위 URL 로 자동 배포한다(`.github/workflows/deploy.yml`).

## 스택
TypeScript + PixiJS v8 + Vite. 모바일·세로 우선, 고정 논리 해상도 + scale-to-fit, 정적 URL 배포.

## 실행

```bash
npm install
npm run dev        # 개발 서버 (Vite)
npm run typecheck  # 타입 검사
npm test           # 단위 테스트 (Vitest)
npm run build      # 프로덕션 빌드 → dist/
```

폰에서 보려면 `npm run dev -- --host` 후 같은 와이파이에서 표시되는 네트워크 URL을 연다.

## 구조
- `src/sim/` — 시뮬레이션 로직 (**순수 TS, Pixi 미사용, 결정론**)
- `src/render/` — PixiJS 렌더링
- `src/config.ts` — 논리 해상도·색상 등 전역 상수
- `src/main.ts` — 진입점

현재 Phase 0(스캐폴드). 다음은 Phase 1 시뮬 코어 → [`docs/design/backlog.md`](docs/design/backlog.md).
