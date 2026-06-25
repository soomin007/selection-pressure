# 문서 지도 (INDEX)

무엇이 어디에서 **단일 진실**인지의 지도. 새 문서를 만들면 여기에 등록한다.

## 기획 / 설계
- [`../적자생존_기획서_v0.1.md`](../적자생존_기획서_v0.1.md) — 게임 기획 전문 (코어 설계의 단일 진실)
- [`design/open_questions.md`](design/open_questions.md) — 미해결 결정 (기획서 §11). 구현 전 확정 대상
- [`ROADMAP.md`](ROADMAP.md) — 단계별 로드맵 (앞으로 할 일만)

## 작업 관리
- [`design/backlog.md`](design/backlog.md) — **다음 작업의 단일 소스** (앞으로 할 일만)
- [`design/known_issues.md`](design/known_issues.md) — 반복 금지 함정/오류 (증상→원인→방지책)
- `../session_logs/YYYY-MM-DD.md` — 세션별 작업·결정·미해결 기록
- `../ACTIVE_WORK.md` — 동시 세션 작업 조율판 (git 미추적, 있을 때만)

## 코드 구조 (`src/`)
| 디렉터리 | 역할 | 규칙 |
|---|---|---|
| `sim/` | 시뮬레이션 로직 (게놈·RNG·환경·개체·유틸 AI) | **순수 TS. Pixi import 금지. 결정론.** |
| `render/` | PixiJS 렌더링 (sim 상태를 읽어 그림) | Pixi 는 여기서만 |
| `game/` | 런 구조·카드 드래프트·메타 루프 (Phase 4+) | |
| `ui/` | HTML 오버레이 UI. `traitPanel.ts`(Phase 2 형질 슬라이더). 보스 예고 등은 Phase 5~6 | |

진입점: `src/main.ts`. 전역 상수: `src/config.ts`.
