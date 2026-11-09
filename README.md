# 적자생존 (Selection Pressure)

한 종을 길러 생태계의 정점에 올리는 진화 로그라이크다. 플레이어는 경기 전에 지침 시트에 누가, 어떤 때, 무엇을 할지 적어 두고,
무리는 경기 내내 그 지침대로 움직인다. 위협이나 대멸종이 닥치면 경기가 저절로 멈추고 작전타임이 열린다.
지침은 경기가 멈춰 있을 때만 고칠 수 있다.

한 시대는 채집, 위협, 대멸종으로 이어지는 여섯 단계이고, 시대 5를 넘기면 정복이다. 레벨이 오르면 카드 세 장 중 한 장을 고른다.
이빨, 다리, 눈, 가죽, 무리 다섯 범주의 도장은 보스를 물리치거나 대멸종을 버티면 떨어지는 방울로만 오른다.
세계는 초원, 대륙, 판게아, 군도, 대양 다섯 가지이고, 시대가 지나면 세계도 바뀐다.

개발은 2026년 9월 12일 이후 멈춰 있다. 지금 올라와 있는 판은 그대로 플레이할 수 있다.

- 플레이: https://soomin007.github.io/selection-pressure/
- 게임 소개와 개발 일지: https://soomin007.github.io/g/selection-pressure/
- 문서 지도: [`docs/INDEX.md`](docs/INDEX.md)
- 개발 규칙: [`CLAUDE.md`](CLAUDE.md)

## 처음 기획에서 바뀐 것

처음 기획서 [`적자생존_기획서_v0.1.md`](적자생존_기획서_v0.1.md)는 라운드 사이에 카드를 고르기만 하고 경기는 지켜보는 관전형이었다.
2026년 8월 초에는 우두머리 한 마리를 조종하다가 누른 자리로 무리 전체에 지시를 내리는 방식으로 바뀌었고,
9월 11일에 지침 시트와 작전타임으로 무리를 이끄는 지금의 감독형이 되었다.
지금 설계의 기준은 [`docs/design/manager_instructions.md`](docs/design/manager_instructions.md)다.
화면도 이때 폰 세로 우선에서 PC 화면 기준으로 바뀌었고, 폰에서는 같은 패널을 화면 아래 서랍으로 접는다.

## 스택

TypeScript, PixiJS v8, Vite 로 만들었다. 빌드한 정적 파일을 GitHub Pages 에 올리고,
`main` 에 push 하면 GitHub Actions 가 빌드해서 위 주소로 배포한다(`.github/workflows/deploy.yml`).

## 실행

```bash
npm install
npm run dev        # 개발 서버 (Vite)
npm run typecheck  # 타입 검사
npm test           # 단위 테스트 (Vitest)
npm run build      # 프로덕션 빌드, dist/ 에 나온다
```

폰에서 보려면 `npm run dev -- --host` 로 띄운 뒤, 같은 와이파이에서 화면에 표시되는 네트워크 주소를 연다.

## 구조

- `src/sim/` 는 시뮬레이션 로직이다. 순수 TypeScript 로 쓰고 Pixi 를 쓰지 않으며, 같은 시드면 같은 결과가 나온다.
- `src/render/` 는 PixiJS 로 시뮬레이션 상태를 그린다.
- `src/game/` 는 한 판의 흐름과 카드 드래프트를 맡는다.
- `src/ui/` 는 지침 시트, 드래프트, 결과 화면 같은 HTML 화면을 그린다.
- `src/main.ts` 가 진입점이고, `src/config.ts` 에 전역 상수를 둔다.

어느 문서가 무엇의 기준인지는 [`docs/INDEX.md`](docs/INDEX.md) 에 정리되어 있다.
