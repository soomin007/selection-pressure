# 문서 지도 (INDEX)

무엇이 어디에서 **단일 진실**인지의 지도. 새 문서를 만들면 여기에 등록한다.

## 기획 / 설계
- [`../적자생존_기획서_v0.1.md`](../적자생존_기획서_v0.1.md) — 게임 기획 전문 (코어 설계의 단일 진실)
- [`design/open_questions.md`](design/open_questions.md) — 미해결 결정 (기획서 §11). 구현 전 확정 대상
- [`ROADMAP.md`](ROADMAP.md) — 단계별 로드맵 (앞으로 할 일만)
- [`UI_HANDOFF.md`](UI_HANDOFF.md) — **UI 핸드오프 문서** (코드 안 보고 맥락 파악: Game API·화면 흐름·컴포넌트·톤 규칙)

## 작업 관리
- [`design/backlog.md`](design/backlog.md) — **다음 작업의 단일 소스** (앞으로 할 일만)
- [`design/known_issues.md`](design/known_issues.md) — 반복 금지 함정/오류 (증상→원인→방지책)
- [`design/parked_ideas.md`](design/parked_ideas.md) — **보류 아이디어** (안 하기로 했지만 버리지 않은 방향. 실시간 카드 배틀러 등)
- `../session_logs/YYYY-MM-DD.md` — 세션별 작업·결정·미해결 기록
- `../ACTIVE_WORK.md` — 동시 세션 작업 조율판 (git 미추적, 있을 때만)

## 코드 구조 (`src/`)
| 디렉터리 | 역할 | 규칙 |
|---|---|---|
| `sim/` | 시뮬레이션 로직 (게놈·RNG·환경·개체·유틸 AI) | **순수 TS. Pixi import 금지. 결정론.** |
| `render/` | PixiJS 렌더링 (sim 상태를 읽어 그림) | Pixi 는 여기서만 |
| `game/` | 런 구조·카드 드래프트·메타 루프 (Phase 4+) | |
| `ui/` | HTML 오버레이 UI (드래프트·결과·도감 등) | |

진입점: `src/main.ts`. 전역 상수: `src/config.ts`.

### 단일 진실 파일 (여기 말고 다른 데 옮겨 적지 않는다)

| 파일 | 무엇의 단일 진실인가 |
|---|---|
| `src/sim/tiers.ts` | **성장 수치**: 범주 다섯·도장 문턱·티어 파생 능치·몸집 식·유지비·듀오, 그리고 티어 한 줄(`tierLine`). 도장은 **방울로만** 오른다(`Game.buyTier`). |
| `src/sim/perks.ts` | **조건부 특성(perk)**: 카드가 주는 것의 단일 진실(v9 신설). 조건 13종·축 8종·배수, 등급 계산(`perkRarity`), 화면 한 줄(`perkLine`), sim 이 곱하는 자리(`perkMul`)가 전부 여기 있다. 카드(`game/cards.ts`)는 특성의 이름·설명·효과를 **따로 안 갖는다**. |
| `src/sim/genome.ts` | **게놈 직렬화**(v9 = 도장 + 열쇠 + 특성 → 파생 능치) · `GENOME_VERSION` · 마이그레이션 |
| `src/game/cards.ts` | **카드 풀과 뽑기**: 카드 = 열쇠 또는 특성 하나. 희귀도 가중치·레벨 보정·드래프트 보정(`DraftBias`) |
| `src/game/runCode.ts` | **판 분석 코드**의 형식(`scripts/decode-run.mjs` 가 푼다) |

## 도구 (`scripts/`)
- `balance-probe.mjs` — 밸런스 실측(`npm run probe -- <모드>`). 밸런스를 만졌을 때만 수동으로.
- `overlap-check.mjs` — UI 겹침 점검(`npm run overlap`). **UI 를 넣거나 옮길 때마다.**
- `decode-run.mjs` — **판 분석 코드를 사람이 읽는 표로 푼다**(`node scripts/decode-run.mjs SP1-...`).
  코드를 만드는 쪽은 `src/game/runCode.ts`(형식의 단일 진실)이고, 기록을 모으는 곳은 `src/game/game.ts`,
  복사 버튼은 런 보고서 화면(`src/ui/runReportScreen.ts`)에 있다.
- `smoke.mjs` · `screenshots.mjs` · `boss-preview.mjs` · `gene-preview.mjs` — 스모크·촬영·미리보기.
