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
import { Terrain, TILE, type TileKind } from "@/sim/terrain";
import { SpatialGrid } from "@/sim/spatialGrid";
import { makePlayerSpecies, generateWildSpecies, type Species } from "@/sim/species";
import { stepEntity } from "@/sim/behavior";
import { stepBoss, type Boss } from "@/sim/boss";
import { SIM } from "@/sim/params";

/** 한 마리가 죽은 이유 (가독성 §7: "왜 내 종이 죽었나"). 사람이 읽는 한글 라벨은 game 층에서. */
export type DeathCause = "starve" | "cold" | "heat" | "age" | "boss" | "predation" | "plague";
export type DeathTally = Record<DeathCause, number>;

export function emptyDeathTally(): DeathTally {
  return { starve: 0, cold: 0, heat: 0, age: 0, boss: 0, predation: 0, plague: 0 };
}

/** 화면 연출용 1회성 사건(전 종, 위치 포함). 렌더가 매 프레임 읽고 비운다. rng 미사용 → 결정론 무관. */
export type VisualEventKind = "birth" | "death" | "kill";
export interface VisualEvent {
  kind: VisualEventKind;
  x: number;
  y: number;
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
  /** 지형(바다/육지/산). 현재는 시각 전용 — 이동/먹이/시야 결합은 다음 슬라이스(독립 rng 라 sim 동역학 무관). */
  readonly terrain: Terrain;
  readonly grid: SpatialGrid;

  entities: Entity[] = [];
  food: Food[] = [];
  tick = 0;

  // Phase 5 단계 상태 (Game 이 설정/해제). 기본값은 평상시(영향 없음).
  boss: Boss | null = null;
  globalCold = 0; // 대멸종 한파
  heat = 0; // 대멸종 폭염
  foodRegrowMultiplier = 1; // 대멸종 대가뭄
  plagueRate = 0; // 대멸종 대역병 (매 틱 솎임 확률 — 번식/수로 메워야 버틴다)

  /** 내 종이 무엇에 죽었나 — 런 내내 누적(정산 가독성, §7). World 는 런마다 새로 만들어지므로 런 단위 집계. */
  readonly deaths: DeathTally = emptyDeathTally();

  /** 이번 프레임 연출용 사건들(탄생/죽음/잡아먹힘). 렌더가 매 프레임 읽고 비운다(상한 넘으면 버림). */
  readonly events: VisualEvent[] = [];

  private idCounter = 0;

  constructor(seed: string | number, width: number, height: number, genome: Genome) {
    this.width = width;
    this.height = height;
    this.rng = new Rng(seed);
    this.genome = genome;
    this.environment = Environment.generate(this.rng, width, height, SIM.cellSize);
    // 지형은 메인 rng 와 "독립된 rng"로 생성 → 기존 sim 동역학(결정론·밸런스)을 1비트도 안 건드린다.
    this.terrain = Terrain.generate(
      new Rng(String(seed) + "-terrain"),
      width,
      height,
      SIM.terrainCellSize,
    );
    this.grid = new SpatialGrid(width, height, SIM.gridCellSize);
    this.playerSpecies = makePlayerSpecies(genome, SIM.initialEntities);
    this.species = [this.playerSpecies, ...generateWildSpecies(this.rng)];
    this.spawnFood();
    this.spawnEntities();
    // 바다 먹이는 "독립 rng"로 생물 스폰 뒤에 — this.rng 상태(=step 동역학)를 안 건드려 밸런스 보존.
    this.spawnSeaFood(new Rng(String(seed) + "-seafood"));
    this.grid.rebuild(this.entities);
  }

  nextId(): number {
    return this.idCounter++;
  }

  step(): void {
    this.tick += 1;
    this.grid.rebuild(this.entities);

    // 렌더 보간용: 이번 스텝 이동 전 위치를 기록(화면이 prev→현재 사이를 메운다).
    for (const e of this.entities) {
      e.prevX = e.x;
      e.prevY = e.y;
    }
    if (this.boss) {
      this.boss.prevX = this.boss.x;
      this.boss.prevY = this.boss.y;
    }

    const newborns: Entity[] = [];
    for (const e of this.entities) {
      if (!e.alive) continue;
      stepEntity(e, this, newborns);
    }

    if (this.boss) stepBoss(this.boss, this);

    // 대역병: 매 틱 일부를 솎되, 번식이 왕성한 종일수록(회복력) 덜 솎인다 → 번식력이 카운터.
    // (평범한 솎임은 건강→대사로 흘러 저대사가 간접 우위가 되므로, 번식력으로 직접 게이팅.)
    if (this.plagueRate > 0) {
      for (const e of this.entities) {
        if (!e.alive) continue;
        const rate = this.plagueRate * (1 - SIM.plagueFertilityResist * e.genome.traits.fertility);
        if (rate > 0 && this.rng.unit() < rate) {
          e.alive = false;
          this.recordDeath(e.species, "plague");
          this.emit("death", e.x, e.y);
        }
      }
    }

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

    this.maybeImmigrate();
  }

  /** 하루 진행도 0~1 (0=정오 시작 → 0.5 자정 → 1 다시 정오). tick 기반 결정론. 낮밤 표시·밝기 산출에. */
  get dayPhase(): number {
    return (this.tick % SIM.dayLength) / SIM.dayLength;
  }

  /**
   * 낮의 밝기 0(자정)~1(정오). tick 기반이라 결정론(rng 무관). 시야(밤엔 감소)·화면 밝기에 쓴다.
   * cos 곡선이라 정오→해질녘→자정→동틀녘이 부드럽게 이어진다.
   */
  get daylight(): number {
    return 0.5 + 0.5 * Math.cos(this.dayPhase * 2 * Math.PI);
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

  /** 연출용 사건 1건(전 종, 위치 포함). rng 미사용 → 결정론 무관. 상한을 두어 무한 증가 방지. */
  emit(kind: VisualEventKind, x: number, y: number): void {
    if (this.events.length < 300) this.events.push({ kind, x, y });
  }

  get availableFood(): number {
    let count = 0;
    for (const f of this.food) if (f.available) count += 1;
    return count;
  }

  private spawnFood(): void {
    // 육지 타일에만 식물 먹이. 지형 "타일" 단위로 정밀 배치(환경 칸 단위면 물 위에 떨어진다).
    // 비옥할수록 많이. this.rng 사용(스폰 전이라 생물 스폰 rng 와 이어짐 — 소비 횟수는 환경칸판과 동일).
    this.spawnFoodOnTiles(this.rng, SIM.foodPatches, false, (kind, fertility) =>
      kind === TILE.land ? 0.15 + fertility : 0,
    );
  }

  /** 바다 타일에 바다 먹이(수영 형질로만 먹는 무경쟁 틈새). 독립 rng → step 동역학 불변. */
  private spawnSeaFood(rng: Rng): void {
    this.spawnFoodOnTiles(rng, SIM.seaFoodPatches, true, (kind) => (kind === TILE.water ? 1 : 0));
  }

  /** 지형 타일 단위 가중 추첨으로 먹이 count 개를 놓는다(정밀 배치). 타일별 weight 는 콜백이 정한다. */
  private spawnFoodOnTiles(
    rng: Rng,
    count: number,
    aquatic: boolean,
    tileWeight: (kind: TileKind, fertility: number) => number,
  ): void {
    const terr = this.terrain;
    const cs = terr.cellSize;
    const weights: number[] = [];
    let total = 0;
    for (let i = 0; i < terr.tiles.length; i++) {
      const cx = i % terr.cols;
      const cy = Math.floor(i / terr.cols);
      const fert = this.environment.sampleAt((cx + 0.5) * cs, (cy + 0.5) * cs).fertility;
      const w = tileWeight(terr.tiles[i] ?? TILE.land, fert);
      weights.push(w);
      total += w;
    }
    if (total <= 0) return;
    for (let n = 0; n < count; n++) {
      let r = rng.range(0, total);
      let cell = 0;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i] ?? 0;
        if (r <= 0) {
          cell = i;
          break;
        }
      }
      const cx = cell % terr.cols;
      const cy = Math.floor(cell / terr.cols);
      const x = Math.min(this.width, (cx + rng.unit()) * cs);
      const y = Math.min(this.height, (cy + rng.unit()) * cs);
      const kind = rng.int(0, SIM.foodKindCount - 1);
      this.food.push(createFood(x, y, kind, aquatic));
    }
  }

  /** 야생 이주 — 멸종했거나 적은 야생종을 주기적으로 소수 보충(다양성 바닥). 내 종은 제외. */
  private maybeImmigrate(): void {
    if (this.tick % SIM.immigrationInterval !== 0) return;
    if (this.entities.length >= SIM.populationCap) return;
    const counts = new Map<number, number>();
    for (const e of this.entities) counts.set(e.species.id, (counts.get(e.species.id) ?? 0) + 1);
    for (const sp of this.species) {
      if (sp.isPlayer) continue;
      if ((counts.get(sp.id) ?? 0) >= SIM.immigrationFloor) continue;
      const canSwim = sp.genome.traits.swimming >= SIM.swimThreshold;
      for (let k = 0; k < SIM.immigrationBatch; k++) {
        // rng 소비 순서(width→height)를 보존한 뒤 막힌 타일이면 통행 타일로 스냅(스냅은 rng 미사용).
        const ix = this.rng.range(0, this.width);
        const iy = this.rng.range(0, this.height);
        const spot = this.terrain.nearestPassable(ix, iy, canSwim);
        this.entities.push(createEntity(this.nextId(), spot.x, spot.y, sp, SIM.startEnergy));
      }
    }
  }

  private spawnEntities(): void {
    for (const sp of this.species) {
      // 야생종은 고유한 영역(보금자리)에 모여 태어난다 — 환경 비옥도 차이 + 무리 성향과 맞물려
      // 경쟁 배제를 늦춰 더 많은 종이 공존한다. 내 종(주인공)은 맵 전체에 넓게 퍼뜨린다.
      const homeX = this.rng.range(0.14, 0.86) * this.width;
      const homeY = this.rng.range(0.14, 0.86) * this.height;
      // 야생종은 좁은 영역에 모여 태어나(영역화 → 공존), 내 종(주인공)은 맵 전체에 얇게 퍼진다.
      const spread = sp.isPlayer ? Math.max(this.width, this.height) : 72;
      const canSwim = sp.genome.traits.swimming >= SIM.swimThreshold;
      for (let i = 0; i < sp.initialCount; i++) {
        const x = Math.max(0, Math.min(this.width, homeX + this.rng.range(-spread, spread)));
        const y = Math.max(0, Math.min(this.height, homeY + this.rng.range(-spread, spread)));
        // 막힌 타일에 떨어지면 통행 타일로 스냅(rng 미사용 → 스폰 rng 소비 보존 = 밸런스 보존).
        const spot = this.terrain.nearestPassable(x, y, canSwim);
        this.entities.push(createEntity(this.nextId(), spot.x, spot.y, sp, SIM.startEnergy));
      }
    }
  }
}
