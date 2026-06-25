// 시뮬 월드 — 모든 상태와 한 틱 진행(step)을 담는다. 순수 TS, 결정론.
// (게놈 + 환경 시드) → 같은 step 횟수면 항상 같은 결과. (기획서 §3.4)
//
// 다종 생태계: 내 종(player) 1개 + 야생종 여러 개가 한 세계에 산다(스포어처럼).
// 초식은 식물(food)을, 육식은 다른 종을 먹는다. 먹이/사냥 경쟁이 창발한다.

import { Rng } from "@/sim/rng";
import type { Genome } from "@/sim/genome";
import { createEntity, type Entity } from "@/sim/entity";
import { createFood, type Food } from "@/sim/food";
import { Environment } from "@/sim/environment";
import { SpatialGrid } from "@/sim/spatialGrid";
import { makePlayerSpecies, generateWildSpecies, type Species } from "@/sim/species";
import { stepEntity } from "@/sim/behavior";
import { stepBoss, type Boss } from "@/sim/boss";
import { SIM } from "@/sim/params";

/** 한 마리가 죽은 이유 (가독성 §7: "왜 내 종이 죽었나"). 사람이 읽는 한글 라벨은 game 층에서. */
export type DeathCause = "starve" | "cold" | "heat" | "age" | "boss" | "predation";
export type DeathTally = Record<DeathCause, number>;

export function emptyDeathTally(): DeathTally {
  return { starve: 0, cold: 0, heat: 0, age: 0, boss: 0, predation: 0 };
}

export class World {
  readonly width: number;
  readonly height: number;
  readonly rng: Rng;
  /** 내 종 게놈 — 드래프트가 수정하는 대상(살아있는 중 바꾸면 즉시 반영). */
  readonly genome: Genome;
  readonly playerSpecies: Species;
  readonly species: Species[];
  readonly environment: Environment;
  readonly grid: SpatialGrid;

  entities: Entity[] = [];
  food: Food[] = [];
  tick = 0;

  // Phase 5 단계 상태 (Game 이 설정/해제). 기본값은 평상시(영향 없음).
  boss: Boss | null = null;
  globalCold = 0; // 대멸종 한파
  heat = 0; // 대멸종 폭염
  foodRegrowMultiplier = 1; // 대멸종 대가뭄

  /** 내 종이 무엇에 죽었나 — 런 내내 누적(정산 가독성, §7). World 는 런마다 새로 만들어지므로 런 단위 집계. */
  readonly deaths: DeathTally = emptyDeathTally();

  private idCounter = 0;

  constructor(seed: string | number, width: number, height: number, genome: Genome) {
    this.width = width;
    this.height = height;
    this.rng = new Rng(seed);
    this.genome = genome;
    this.environment = Environment.generate(this.rng, width, height, SIM.cellSize);
    this.grid = new SpatialGrid(width, height, SIM.gridCellSize);
    this.playerSpecies = makePlayerSpecies(genome, SIM.initialEntities);
    this.species = [this.playerSpecies, ...generateWildSpecies(this.rng)];
    this.spawnFood();
    this.spawnEntities();
    this.grid.rebuild(this.entities);
  }

  nextId(): number {
    return this.idCounter++;
  }

  step(): void {
    this.tick += 1;
    this.grid.rebuild(this.entities);

    const newborns: Entity[] = [];
    for (const e of this.entities) {
      if (!e.alive) continue;
      stepEntity(e, this, newborns);
    }

    if (this.boss) stepBoss(this.boss, this);

    // 먹이 재생 (대가뭄이면 regrowTimer 가 길어 느리게)
    for (const f of this.food) {
      if (f.available) continue;
      f.regrowTimer -= 1;
      if (f.regrowTimer <= 0) f.available = true;
    }

    for (const n of newborns) this.entities.push(n);

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

  /** 내 종 개체 수 — 승패 판정의 기준. */
  get playerPopulation(): number {
    let count = 0;
    for (const e of this.entities) if (e.species.isPlayer) count += 1;
    return count;
  }

  /** 죽음 1건 집계. 정산은 "왜 내 종이 죽었나"가 핵심이라 내 종만 센다. (rng 미사용 → 결정론 유지) */
  recordDeath(species: Species, cause: DeathCause): void {
    if (!species.isPlayer) return;
    this.deaths[cause] += 1;
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
    for (const sp of this.species) {
      for (let i = 0; i < sp.initialCount; i++) {
        this.entities.push(
          createEntity(
            this.nextId(),
            this.rng.range(0, this.width),
            this.rng.range(0, this.height),
            sp,
            SIM.startEnergy,
          ),
        );
      }
    }
  }
}
