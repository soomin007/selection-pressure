// 개체별 미세 개성 — 같은 종이라도 한 마리씩 또렷이 달라 보이게. 개체 id 로 결정론(순수 함수, Pixi 무관).
// 표현 전용이라 sim 동역학·밸런스에는 전혀 영향이 없다. "내 애들"이 한 덩어리가 아니라 각자 다른
// 아이로 보여야 애착이 생긴다(소수 개체 게임 — 메모리 small-scale-attachment).
//
// 두 층으로 개성을 준다:
//  ① 텍스처 변형(무늬·눈) — 개체 id 를 유한한 "룩 버킷"(LOOK_BUCKETS)으로 해시해, 버킷마다 무늬 종류·
//     반점 배치·눈 크기/위치가 다른 텍스처를 만든다(버킷이 유한 → 종당 텍스처 캐시 상한 유지).
//  ② 스프라이트 변주(크기·색조) — 개체마다 연속적으로 다른 전체 배율·길쭉함·명암/색조. 텍스처를 안 늘리고
//     무한한 다양성을 준다. 두 층이 겹쳐 버킷이 같은 두 마리도 크기·톤으로 갈린다.

/** 정수 해시 → [0,1). 같은 입력은 항상 같은 값(결정론). */
function hash01(n: number): number {
  let h = (Math.trunc(n) * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = (h * 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function clamp255(v: number): number {
  const n = Math.round(v);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

// 텍스처 룩 변형 버킷 수 — 무늬·눈이 다른 텍스처 종류. 클수록 개체가 덜 겹치지만 종당 텍스처 캐시가 늘어난다.
// 소수 무리(12~20)에서 서로 다르게 보일 만큼 넉넉히 두되, 스프라이트 변주(크기·톤)가 겹침을 더 갈라준다.
export const LOOK_BUCKETS = 16;

/** 무늬 종류. 0 민무늬 · 1 줄무늬 · 2 반점 · 3 얼룩. */
export interface CreatureLook {
  pattern: 0 | 1 | 2 | 3;
  patternDark: boolean; // 무늬가 몸보다 어두운색(true)인지 밝은색(false)인지
  stripes: number; // 줄 개수(pattern 1)
  spots: ReadonlyArray<{ x: number; y: number; r: number }>; // 반점/얼룩(pattern 2/3). 몸 비율(-1~1) 좌표
  eyeScale: number; // 눈 크기 배율
  eyeDx: number; // 눈 위치 미세 이동(len 비율)
  eyeDy: number; // 눈 위치 미세 이동(wid 비율)
  // 등 가시(공격력 능선) 톱니별 미세 변형 시드(-0.5~0.5). 개수는 공격력이 정하고(정보), 각 톱니의
  // 높이·좌우 기울기만 이 값으로 흔들어 같은 종도 가시 모양이 제각각(개성). 최대 톱니 수만큼(≤6).
  spikeJit: readonly number[];
}

// 종 "대표" 모습 — 프리셋 미리보기·도감처럼 개체가 아닌 종 자체를 보일 때. 무늬 없는 기본형.
export const DEFAULT_LOOK: CreatureLook = {
  pattern: 0,
  patternDark: true,
  stripes: 0,
  spots: [],
  eyeScale: 1,
  eyeDx: 0,
  eyeDy: 0,
  spikeJit: [0, 0, 0, 0, 0, 0],
};

/** 개체 id → 텍스처 룩 버킷 번호(0~LOOK_BUCKETS-1). 텍스처 캐시 키에 쓴다. */
export function lookBucket(id: number): number {
  return Math.floor(hash01((id ^ 0x1b873593) >>> 0) * LOOK_BUCKETS);
}

/** 룩 버킷 번호 → 텍스처 변형 파라미터(결정론). 같은 버킷이면 항상 같은 무늬·눈. */
export function lookFromBucket(bucket: number): CreatureLook {
  const r = (salt: number): number => hash01(((bucket * 131 + salt) ^ 0x51ed2701) >>> 0);
  const pattern = Math.floor(r(1) * 4) as 0 | 1 | 2 | 3;
  const patternDark = r(2) < 0.6;
  const stripes = 2 + Math.floor(r(3) * 3); // 2~4 줄
  const spots: Array<{ x: number; y: number; r: number }> = [];
  if (pattern === 2 || pattern === 3) {
    const isBlotch = pattern === 3;
    const n = isBlotch ? 1 + Math.floor(r(4) * 2) : 3 + Math.floor(r(4) * 3); // 얼룩 1~2 · 반점 3~5
    for (let i = 0; i < n; i++) {
      spots.push({
        x: (r(10 + i * 3) - 0.5) * 1.0, // 몸 앞뒤로 흩뿌림(-0.5~0.5 of len)
        y: (r(11 + i * 3) - 0.62) * 0.85, // 등쪽(위) 편향
        r: (isBlotch ? 0.5 : 0.24) + r(12 + i * 3) * 0.22,
      });
    }
  }
  const spikeJit: number[] = [];
  for (let i = 0; i < 6; i++) spikeJit.push(r(20 + i) - 0.5);
  return {
    pattern,
    patternDark,
    stripes,
    spots,
    eyeScale: 0.86 + r(5) * 0.32, // 0.86~1.18
    eyeDx: (r(6) - 0.5) * 0.12,
    eyeDy: (r(7) - 0.5) * 0.12,
    spikeJit,
  };
}

/** 개체의 텍스처 룩(버킷 경유). */
export function creatureLook(id: number): CreatureLook {
  return lookFromBucket(lookBucket(id));
}

/** 개체 전체 크기 배율 — 0.82~1.18(±18%). 종 텍스처에 곱해 "큰 애 / 작은 애"가 생긴다. */
export function personalityScale(id: number): number {
  return 0.82 + hash01(id) * 0.36;
}

/** 개체 길쭉함 배율 — 1보다 크면 길고 홀쭉, 작으면 짧고 통통(가로=몸 방향에 곱). */
export function personalityStretch(id: number): number {
  return 0.93 + hash01((id ^ 0x7f4a7c15) >>> 0) * 0.14; // 0.93~1.07
}

/** 개체 명암·색조 틴트(0xRRGGBB) — 곱셈 틴트라 밝게는 못 하고, 명암과 따뜻/차가운 톤만 미세히 준다. */
export function personalityTint(id: number): number {
  const lum = 0.86 + hash01((id ^ 0x9e3779b9) >>> 0) * 0.14; // 전체 명암 0.86~1.0
  const warm = (hash01((id ^ 0x2545f491) >>> 0) - 0.5) * 0.12; // +면 따뜻(R↑B↓), -면 차가움
  const r = clamp255((lum + warm) * 255);
  const g = clamp255(lum * 255);
  const b = clamp255((lum - warm) * 255);
  return (r << 16) | (g << 8) | b;
}

/** 덩치 한 단어(정보 카드 표시용) — personalityScale 경계와 맞춘다. */
export function sizeWord(id: number): string {
  const s = personalityScale(id);
  return s < 0.93 ? "작은 몸" : s > 1.07 ? "큰 몸집" : "보통 몸집";
}
