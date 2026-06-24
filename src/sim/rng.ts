// 시드 고정 결정론 RNG (기획서 §3.4).
//   (게놈 + 환경 시드) → 항상 같은 결과.
// 효과: 로그라이크 재현성, 디버깅, 비동기 생물 비교의 공정성이 공짜로 따라온다.
//
// Math.random 은 시뮬레이션 어디에서도 쓰지 않는다. 항상 이 Rng 를 주입한다.

/** 문자열 시드를 32비트 정수로 해싱 (xmur3). */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/**
 * mulberry32 기반 결정론 난수 생성기.
 * 내부 상태(state)를 직렬화/복원할 수 있어, 시뮬 중간 지점부터 재현이 가능하다.
 */
export class Rng {
  private state: number;

  constructor(seed: string | number) {
    this.state = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  }

  /** 내부 상태 스냅샷 (저장/복원용). */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }

  /** [0, 1) 균등 난수. */
  unit(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) 실수. */
  range(min: number, max: number): number {
    return min + this.unit() * (max - min);
  }

  /** [min, max] 정수. */
  int(min: number, max: number): number {
    return min + Math.floor(this.unit() * (max - min + 1));
  }

  /** 확률 p (0~1) 로 true. */
  chance(p: number): boolean {
    return this.unit() < p;
  }

  /** 배열에서 하나 균등 선택. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("빈 배열에서 pick 할 수 없습니다.");
    return items[this.int(0, items.length - 1)] as T;
  }
}
