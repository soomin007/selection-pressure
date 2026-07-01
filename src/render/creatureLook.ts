// 개체별 미세 개성 — 같은 종이라도 한 마리씩 조금씩 다르게 보이게(크기·명암). 개체 id 로 결정론.
// 순수 함수(Pixi 무관) — 표현 전용이라 sim 동역학·밸런스에는 전혀 영향이 없다.
// "내 애들"이 한 덩어리가 아니라 각자 다른 아이로 보여야 애착이 생긴다(소수 개체 게임).

/** 정수 해시 → [0,1). 같은 id 는 항상 같은 값(결정론). */
function hash01(n: number): number {
  let h = (Math.trunc(n) * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = (h * 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** 개체 크기 배율 — 0.82~1.18(±18%). 종 텍스처에 곱해 "큰 애 / 작은 애"가 생긴다. */
export function personalityScale(id: number): number {
  return 0.82 + hash01(id) * 0.36;
}

/** 개체 명암 틴트(0xRRGGBB, 회색) — 0.9~1.0 을 곱해 미세한 명암 다양성을 준다. */
export function personalityTint(id: number): number {
  const f = 0.9 + hash01(id ^ 0x9e3779b9) * 0.1;
  const c = Math.round(f * 255);
  return (c << 16) | (c << 8) | c;
}

/** 덩치 한 단어(정보 카드 표시용) — personalityScale 경계와 맞춘다. */
export function sizeWord(id: number): string {
  const s = personalityScale(id);
  return s < 0.93 ? "작은 몸" : s > 1.07 ? "큰 몸집" : "보통 몸집";
}
