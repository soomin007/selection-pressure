// 시뮬 월드 — 모든 상태와 한 틱 진행(step)을 담는다. 순수 TS, 결정론.
// (게놈 + 환경 시드) → 같은 step 횟수면 항상 같은 결과. (기획서 §3.4)

import { Rng } from "@/sim/rng";
import type { Genome } from "@/sim/genome";
import { createEntity, type Entity } from "@/sim/entity";
import { createFood, type Food } from "@/sim/food";
import { Environment } from "@/sim/environment";
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
  /** 절차 환경 (추위/비옥도 필드). 환경 시드로 결정. */
  readonly environment: Environment;

  entities: Entity[] = [];
  food: Food[] = [];
  tick = 0;

  private idCounter = 0;

  constructor(seed: string | number, width: number, height: number, genome: Genome) {
    this.width = width;
    this.height = height;
    this.rng = new Rng(seed);
    this.genome = genome;
    this.environment = Environment.generate(this.rng, width, height, SIM.cellSize);
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
    // 비옥한 칸일수록 먹이가 더 많이 놓이도록 가중 추첨한다.
    const env = this.environment;
    const weights: number[] = [];
    let total = 0;
    for (let i = 0; i < env.fertility.length; i++) {
      const w = 0.15 + (env.fertility[i] ?? 0);
      weights.push(w);
      total += w;
    }
    for (let n = 0; n < SIM.foodPatches; n++) {
      let r = this.rng.range(0, total);
      let cell = 0;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i] ?? 0;
        if (r <= 0) {
          cell = i;
          break;
        }
      }
      const cx = cell % env.cols;
      const cy = Math.floor(cell / env.cols);
      const x = Math.min(this.width, (cx + this.rng.unit()) * env.cellSize);
      const y = Math.min(this.height, (cy + this.rng.unit()) * env.cellSize);
      this.food.push(createFood(x, y));
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
