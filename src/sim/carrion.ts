// 사체(carrion) · 자료 구조와 순수 헬퍼.
//
// **[사용자 2026-08-10]** 예시 카드 「썩은 고기를 먹는 위」(2026-08-11 승인)가 요구하는
// 유일한 새 하위 시스템이다. 지금까지 이 세계는 죽으면 아무것도 안 남았다(틱 끝 filter 로 소멸).
// 이 카드가 있는 판에서만 죽은 자리에 사체가 남고, **내 종만** 그것을 찾아가 먹는다.
//
// 구조는 `gene.ts`(방울)를 그대로 본떴다 — `taken` 으로 지우지 않고 남기는 이유, `bornTick` 이
// 렌더의 유일한 등장 근거인 이유 모두 같다. World 는 시대마다 새로 만들어져 무한히 안 쌓인다.
//
// ⚠ 이 파일은 PixiJS 를 모른다(sim 순수 규칙). 화면은 여기 값을 **읽기만** 한다.
// ⚠ rng 를 한 번도 안 쓴다 — 사체는 죽은 자리에 그대로 남는다(결정론 안전).
// ⚠ **먹이(Food/FoodGrid)를 재사용하지 않는다.** 먹이 격자는 「위치 불변」 전제로 생성 시 1회만
//   만들어져(world.ts), 동적으로 밀어 넣으면 격자에 안 잡혀 화면과 판정이 갈린다(정찰 확인).

/** 필드에 남은 사체 하나. */
export interface Carcass {
  x: number;
  y: number;
  /** 먹으면 이만큼 들어온다(기운 단위). */
  amount: number;
  /** 이미 먹었는가. true 면 렌더는 안 그리고 섭취 판정도 건너뛴다. */
  taken: boolean;
  /** 생긴 틱(`world.tick`) · 렌더의 등장·부패 연출 기준. */
  bornTick: number;
}

/**
 * 사체의 크기 둘 · **내 판단 값(미실측)** — 프로브 재측정 대상이다.
 * · 제 명에 못 죽은 것(굶주림·추위·역병·보스): 몸이 통째로 남는다.
 * · 잡아먹히고 남은 것: 포식자가 먹다 남긴 몫만 남는다(「남이 잡다 남긴 것도」가 참말이 되는 자리).
 * 비교 눈금: 채집 한 입 = `SIM.foodEnergy`(모듈 순환을 피해 값을 안 읽고 주석으로만 적는다) ·
 * 사냥 한 번의 밑값 = `SIM.predationEnergy` 36.
 */
export const CARRION_FROM_DEATH = 20;
export const CARRION_LEFTOVER = 10;

/** 사체가 삭아 없어지기까지의 틱(약 40초 · 30틱 = 1초). 지나면 못 먹고 렌더도 안 그린다. */
export const CARRION_ROT_TICKS = 1200;

/** 밟아 먹는 거리(px). 방울(GENE_PICK_RADIUS 16)보다 좁다 — 사체는 일부러 찾아가는 먹이라서다. */
export const CARRION_EAT_RADIUS = 12;

export function createCarcass(x: number, y: number, amount: number, bornTick: number): Carcass {
  return { x, y, amount, taken: false, bornTick };
}

/** 아직 먹을 수 있는가(안 먹혔고 안 삭았다). 렌더와 섭취 판정이 같은 함수를 쓴다. */
export function carcassEdible(c: Carcass, tick: number): boolean {
  return !c.taken && tick - c.bornTick < CARRION_ROT_TICKS;
}

/** 이 사체가 이 개체에게 닿았는가 · 섭취 판정의 단일 진실(제곱 거리라 √ 안 쓴다). */
export function carcassReached(c: Carcass, x: number, y: number): boolean {
  const dx = c.x - x;
  const dy = c.y - y;
  return dx * dx + dy * dy <= CARRION_EAT_RADIUS * CARRION_EAT_RADIUS;
}
