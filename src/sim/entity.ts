// 개체(Entity) — 한 마리. 게놈은 종 전체가 공유하므로 참조만 갖는다.

import type { Genome } from "@/sim/genome";

export interface Entity {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  age: number; // 살아온 틱 수
  genome: Genome; // 종 게놈 참조 (한 런 = 한 종)
  alive: boolean;
}

export function createEntity(
  id: number,
  x: number,
  y: number,
  genome: Genome,
  energy: number,
): Entity {
  return { id, x, y, vx: 0, vy: 0, energy, age: 0, genome, alive: true };
}
