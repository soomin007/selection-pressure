# 보스 아트 생성 프롬프트 (AI 이미지 에셋)

보스는 형질 변화가 없어(고정) 절차 도형 대신 AI 생성 이미지로 대체한다. 아래 프롬프트로 뽑은 PNG를
`assets/boss/` 에 넣으면 코드가 스프라이트로 로드한다(통합은 에셋 준비 후 별도 작업).

---

## 공통 스펙 (반드시 지킬 것 — 안 지키면 게임에 안 맞음)

- **뷰: 탑다운(바로 위에서 내려다본 부감).** 게임이 생물을 위에서 본다.
- **방향: 오른쪽(→)을 향하게.** 게임이 진행 방향으로 스프라이트를 회전시키므로, 기준이 "오른쪽 보기"여야
  아무 방향으로 움직여도 자연스럽다. (머리가 오른쪽, 꼬리가 왼쪽)
- **배경: 완전 투명(PNG, alpha).** 색 배경·그림자 바닥 없음.
- **캔버스: 정사각형(512×512 권장), 대상은 중앙 정렬 + 사방 여백 10% 정도.**
- **스타일: 스티커/플랫 인디게임 아트** — 굵고 통일된 검은(어두운) 윤곽선 + 불투명 플랫 음영(2~3톤,
  반투명 그라데이션 금지) + 크고 또렷한 사나운 눈. 사실적 렌더·질감·그림자 없음.
- **작게 줄여도 읽히는 단순하고 위압적인 실루엣.** 화면에서 지름 20~40px로 작게 그려진다.
- **한 캔버스에 한 마리만.** (떼 보스도 "떼의 한 마리"만 그린다 — 게임이 여러 개 배치한다.)

### 네거티브(빼야 할 것)
`background, ground, shadow on floor, text, watermark, multiple creatures, 3d render, realistic
texture, photograph, drop shadow, side view, front view`

### 파일명
`boss_chaser.png` · `boss_swarm.png` · `boss_raider.png` · `boss_isolation.png` · `boss_stalker.png`

### 색 (게임 코드와 맞춤 — 프롬프트에 주 색으로 반영)
| 보스 | 주 색 | 성격 |
|---|---|---|
| chaser (빠른 추격자) | 새빨강 `#ff4028` | 단일 초고속 돌진 맹수 |
| swarm (사나운 무리) | 성난 주황 `#ff7a2a` | 떼로 몰려드는 작은 포식자 |
| raider (약탈자 무리) | 핏빛 진홍 `#ff2e5a` | 뿔·엄니로 들이받는 떼 |
| isolation (외톨이 사냥꾼) | 청록 `#33c0d8` | 홀로 헤집는 날렵한 사냥꾼 |
| stalker (그림자 매복자) | 자주 `#c060d0` | 어둠 속에 숨은 매복 괴물 |

> **poison(독 안개)은 이미지 없음** — 개체가 아니라 화면 전체 틴트(전역 재난)라 스프라이트가 불필요하다.

---

## 보스별 프롬프트

각 항목의 English prompt를 이미지 AI에 붙여넣고, 공통 스펙/네거티브를 함께 준다.

### 1. chaser — 빠른 추격자 (⚠️ 상어/물고기 금지, 육상 맹수)
- 컨셉: **육지를 초고속으로 질주하는 맹수**(치타·늑대의 흉포 버전). 지금 상어처럼 생긴 게 문제 —
  지느러미 없는 육상 포식자로.
- English: `top-down view of a fierce fast land predator creature, sleek streamlined body like a
  cheetah-wolf, sharp fangs, snarling open jaw, angry glowing red eyes, bold black outline, flat
  cel-shaded sticker style, bright red color scheme, facing right, centered, transparent background`
- 주의: **no fins, no shark, not aquatic.** 다리·발톱이 보이는 육상 짐승.

### 2. swarm — 사나운 무리 (떼의 한 마리)
- 컨셉: 떼로 몰려드는 **작고 사나운 포식자 한 마리**(피라니아·성난 곤충 느낌). 큰 아가리·이빨.
- English: `top-down view of a small vicious swarm predator, piranha-like with a big toothy jaw,
  bulging angry eyes, bold black outline, flat cel-shaded sticker style, angry orange color scheme,
  facing right, centered, transparent background`

### 3. raider — 약탈자 무리 (떼의 한 마리)
- 컨셉: **뿔과 엄니로 들이받는 공격적 짐승** 한 마리. 육중하고 사납게.
- English: `top-down view of an aggressive charging beast with two forward horns and tusks, bulky
  menacing head, fierce eyes, bold black outline, flat cel-shaded sticker style, crimson blood-red
  color scheme, facing right, centered, transparent background`

### 4. isolation — 외톨이 사냥꾼 (떼의 한 마리, 소수)
- 컨셉: **홀로 헤집는 날렵한 늑대/맹금형 사냥꾼**. 뾰족한 귀, 좁은 주둥이, 매서운 눈.
- English: `top-down view of a lean solitary hunter, sleek wolf-like predator with pointed ears, a
  narrow snout and sharp menacing eyes, bold black outline, flat cel-shaded sticker style, teal cyan
  color scheme, facing right, centered, transparent background`

### 5. stalker — 그림자 매복자 (떼의 한 마리)
- 컨셉: **어둠 속에 숨은 그림자 괴물**. 검은 덩어리 몸 + 여러 개(또는 하나 큰) 번뜩이는 눈 + 삐죽한 가시.
- English: `top-down view of a shadowy ambush monster, dark amorphous body with spiky edges and
  multiple glowing menacing eyes, eerie and creepy, bold black outline, flat cel-shaded sticker
  style, purple magenta glow color scheme, facing right, centered, transparent background`

---

## 통합 메모 (에셋 받은 뒤 코드 작업 — 지금은 참고만)
- `worldView.ts` 의 `drawBossCreature`(절차 도형)를 스프라이트 로드로 교체. 보스 타입별 텍스처 캐시.
- 회전: 스프라이트 anchor 0.5, 진행 방향(헤딩)으로 `rotation`. 기준이 "오른쪽 보기"라 `atan2(hy,hx)` 그대로.
- 물기 반경(killRadius) 반투명 원 + 맥동 고리는 유지(게임성). 스프라이트는 그 위에.
- 떼 보스(swarm/raider/isolation/stalker)는 같은 한 장을 멤버 수만큼 배치(각자 회전).
- poison 은 스프라이트 없음(전역 화면 틴트 유지).
