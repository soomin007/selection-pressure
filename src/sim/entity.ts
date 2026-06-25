// 개체(Entity) — 한 마리. 어떤 종(Species)에 속하며, 게놈은 그 종이 공유한다.

import type { Genome } from "@/sim/genome";
import type { Species } from "@/sim/species";
import type { Food } from "@/sim/food";

export interface Entity {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  age: number; // 살아온 틱 수
  species: Species; // 소속 종
  genome: Genome; // = species.genome (편의 참조)
  alive: boolean;
  // 직전 스텝의 위치 (렌더 보간용, 직렬화 안 함). sim 은 30/s, 화면은 60fps → 그 사이를 메운다.
  prevX: number;
  prevY: number;
  // 쫓는 목표 (런타임 상태, 직렬화 안 함). 매 틱 재탐색 대신 commit 을 유지해 목표 진동을 없앤다.
  targetFood: Food | null;
  targetPrey: Entity | null;
}

export function createEntity(
  id: number,
  x: number,
  y: number,
  species: Species,
  energy: number,
): Entity {
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    energy,
    age: 0,
    species,
    genome: species.genome,
    alive: true,
    prevX: x,
    prevY: y,
    targetFood: null,
    targetPrey: null,
  };
}
