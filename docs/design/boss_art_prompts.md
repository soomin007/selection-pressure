# 보스 아트 생성 프롬프트 (AI 이미지 에셋)

보스는 형질 변화가 없어(고정) 절차 도형 대신 AI 생성 이미지로 대체한다. 아래 **프롬프트를 그대로 복사해**
GPT(이미지 생성)에 붙이면 된다. 뽑은 PNG를 `assets/boss/` 에 넣으면 코드가 스프라이트로 로드한다(통합은
에셋 준비 후 별도 작업).

---

## 핵심 규칙 (왜 이렇게 쓰는가 — 지난 시행착오)

- **"sticker(스티커)" 단어 금지.** 스티커라고 하면 GPT 가 실물 스티커처럼 **흰색 다이컷 테두리**를 둘러버린다.
  대신 **"flat vector mascot logo / esports emblem"** 으로 부른다. 생물 자체의 **굵은 검은 윤곽선은 유지**하되,
  그 바깥을 감싸는 흰 테두리·프레임은 뺀다.
- **배경은 단색 마젠타(#FF00FF).** GPT 는 진짜 투명 PNG 를 못 만든다(검은 배경으로 나옴). 게다가 이 캐릭터들은
  검은 윤곽선이 있어 검은 배경을 빼면 윤곽선까지 사라진다. 캐릭터에 없는 색(마젠타)을 배경으로 뽑으면 통합 때
  코드로 깔끔히 제거해 투명으로 만들 수 있다.
- **측면(side profile) 액션 포즈, 오른쪽(→)을 향하게.** 게임이 진행 방향으로 스프라이트를 회전시키므로 기준이
  "오른쪽 보기"여야 한다. (GPT 가 잘 뽑는 esports 마스코트 측면 포즈가 그대로 맞다.)
- **한 캔버스에 한 마리만**, 전신, 중앙 정렬. 떼 보스도 "떼의 한 마리"만 그린다(게임이 여러 개 배치).
- 색은 아래 표대로(게임 코드와 맞춤). poison(독 안개)은 개체가 아니라 화면 전체 틴트라 **이미지 불필요**.

| 보스 | 주 색 | 파일명 |
|---|---|---|
| chaser (빠른 추격자) | 새빨강 | `boss_chaser.png` |
| swarm (사나운 무리) | 성난 주황 | `boss_swarm.png` |
| raider (약탈자 무리) | 핏빛 진홍 | `boss_raider.png` |
| isolation (외톨이 사냥꾼) | 청록 | `boss_isolation.png` |
| stalker (그림자 매복자) | 자주/보라 | `boss_stalker.png` |

---

## 프롬프트 (각 블록을 통째로 복사해 붙여넣기)

### 1. chaser — 빠른 추격자 (⚠️ 상어/물고기 금지, 육상 맹수 · 새빨강)

```
Flat vector mascot logo of a fierce fast LAND predator — a snarling red wolf-cheetah hybrid in a dynamic lunging run, side profile facing RIGHT (head and open jaw on the right, tail on the left). Bold clean black linework with flat cel-shaded coloring, bright red and dark crimson color scheme, angry glowing eyes, sharp white fangs, gaping snarling jaw, powerful legs and claws. Esports emblem / gaming mascot style. NO white outline, NO sticker border, NO die-cut edge, NO frame — the creature only. Solid flat magenta background (#FF00FF), no scenery, no ground shadow, no text. Full body, centered. It is a land beast: no fins, not a shark, not aquatic.
```

### 2. swarm — 사나운 무리 (떼의 한 마리 · 성난 주황)

```
Flat vector mascot logo of a small vicious swarm predator — a piranha-like biting creature with a big toothy open jaw and bulging angry eyes, side profile facing RIGHT. Bold clean black linework with flat cel-shaded coloring, angry orange and dark orange color scheme, sharp teeth, aggressive posture. Esports emblem / gaming mascot style. NO white outline, NO sticker border, NO die-cut edge, NO frame — the creature only. Solid flat magenta background (#FF00FF), no scenery, no ground shadow, no text. Full body, centered.
```

### 3. raider — 약탈자 무리 (떼의 한 마리 · 핏빛 진홍)

```
Flat vector mascot logo of an aggressive charging beast with two forward-pointing horns and tusks, a bulky menacing head lowered to ram, side profile facing RIGHT. Bold clean black linework with flat cel-shaded coloring, crimson blood-red and dark red color scheme, fierce glowing eyes, sharp tusks. Esports emblem / gaming mascot style. NO white outline, NO sticker border, NO die-cut edge, NO frame — the creature only. Solid flat magenta background (#FF00FF), no scenery, no ground shadow, no text. Full body, centered.
```

### 4. isolation — 외톨이 사냥꾼 (떼의 한 마리 · 청록)

```
Flat vector mascot logo of a lean solitary hunter — a sleek wolf-like predator with pointed ears, a narrow snout and sharp menacing eyes, prowling in a low stalking pose, side profile facing RIGHT. Bold clean black linework with flat cel-shaded coloring, teal and cyan color scheme, sharp fangs. Esports emblem / gaming mascot style. NO white outline, NO sticker border, NO die-cut edge, NO frame — the creature only. Solid flat magenta background (#FF00FF), no scenery, no ground shadow, no text. Full body, centered.
```

### 5. stalker — 그림자 매복자 (떼의 한 마리 · 자주/보라)

```
Flat vector mascot logo of a shadowy ambush monster — a dark amorphous creature with spiky edges and multiple glowing menacing eyes, eerie and creepy, side profile facing RIGHT. Bold clean black linework with flat cel-shaded coloring, deep purple and magenta glow color scheme, sharp spikes, sinister expression. Esports emblem / gaming mascot style. NO white outline, NO sticker border, NO die-cut edge, NO frame — the creature only. Solid flat magenta background (#FF00FF), no scenery, no ground shadow, no text. Full body, centered.
```

> 흰 테두리가 또 생기면 프롬프트 맨 앞에 `Absolutely no white border or outline around the shape.` 한 줄을 더
> 붙인다. 배경이 검게 나오면 `The background must be solid magenta #FF00FF, filling the entire canvas.` 를 강조한다.

---

## 통합 메모 (에셋 받은 뒤 코드 작업 — 지금은 참고만)
- 배경 제거: 마젠타(#FF00FF)를 크로마키로 빼 투명 PNG 로. 캐릭터에 마젠타가 없어 윤곽선 손상 없이 깨끗하다
  (사용자가 remove.bg 등으로 미리 빼 와도 됨). 반투명 가장자리는 알파 임계로 정리.
- `render/worldView.ts` 의 `drawBossCreature`(절차 도형)를 스프라이트 로드로 교체. 보스 타입별 텍스처 캐시.
- 회전: 스프라이트 anchor 0.5, 진행 방향(헤딩)으로 `rotation`. 기준이 "오른쪽 보기"라 `atan2(hy,hx)` 그대로.
  (측면 포즈라 위/아래로 갈 때 90° 회전이 어색하면, 회전 대신 좌우 뒤집기(flip)만 하는 방식도 검토.)
- 물기 반경(killRadius) 반투명 원 + 맥동 고리는 유지(게임성). 스프라이트는 그 위에.
- 떼 보스(swarm/raider/isolation/stalker)는 같은 한 장을 멤버 수만큼 배치(각자 회전/뒤집기).
- poison 은 스프라이트 없음(전역 화면 틴트 유지).
