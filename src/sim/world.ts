// 시뮬 월드 — 모든 상태와 한 틱 진행(step)을 담는다. 순수 TS, 결정론.
// (게놈 + 환경 시드) → 같은 step 횟수면 항상 같은 결과. (기획서 §3.4)

import { Rng } from "@/sim/rng";
import type { Genome } from "@/sim/genome";
import { createEntity, type Entity } from "@/sim/entity";
import { createFood, type Food } from "@/sim/food";
import { stepEntity } from "@/sim/behavior";
import { SIM } from "@/sim/params";

export class World {
  readonly width: number;
  readonly height: number;
  readonly rng: Rng;
  /**
   * 종 게놈 — 모든 개체가 공유 (한 런 = 한 종). 외부에서 주입한다.
   * 환경 시드와 분리되어 있어 "같은 맵 + 다른 형질" 비교가 공정하다 (§3.4).
   * 이 객체의 traits 를 살아있는 중에 바꾸면 모든 개체에 즉시 반영된다.
   */
  readonly genome: Genome;

  entities: Entity[] = [];
  food: Food[] = [];
  tick = 0;

  private idCounter = 0;

  constructor(seed: string | number, width: number, height: number, genome: Genome) {
    this.width = width;
    this.height = height;
    this.rng = new Rng(seed);
    this.genome = genome;
    this.spawnFood();
    this.spawnEntities();
  }

  nextId(): number {
    return this.idCounter++;
  }

  step(): void {
    this.tick += 1;

    const newborns: Entity[] = [];
    for (const e of this.entities) {
      if (!e.alive) continue;
      stepEntity(e, this, newborns);
    }

    // 먹이 재생
    for (const f of this.food) {
      if (f.available) continue;
      f.regrowTimer -= 1;
      if (f.regrowTimer <= 0) f.available = true;
    }

    // 신생아 추가
    for (const n of newborns) this.entities.push(n);

    // 죽은 개체 제거
    let hasDead = false;
    for (const e of this.entities) {
      if (!e.alive) {
        hasDead = true;
        break;
      }
    }
    if (hasDead) this.entities = this.entities.filter((e) => e.alive);
  }

  get population(): number {
    return this.entities.length;
  }

  get availableFood(): number {
    let count = 0;
    for (const f of this.food) if (f.available) count += 1;
    return count;
  }

  private spawnFood(): void {
    for (let i = 0; i < SIM.foodPatches; i++) {
      this.food.push(createFood(this.rng.range(0, this.width), this.rng.range(0, this.height)));
    }
  }

  private spawnEntities(): void {
    for (let i = 0; i < SIM.initialEntities; i++) {
      this.entities.push(
        createEntity(
          this.nextId(),
          this.rng.range(0, this.width),
          this.rng.range(0, this.height),
          this.genome,
          SIM.startEnergy,
        ),
      );
    }
  }
}
