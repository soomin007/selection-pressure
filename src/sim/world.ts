// 시뮬 월드 — 모든 상태와 한 틱 진행(step)을 담는다. 순수 TS, 결정론.
// (게놈 + 환경 시드) → 같은 step 횟수면 항상 같은 결과. (기획서 §3.4)
//
// 다종 생태계: 내 종(player) 1개 + 야생종 여러 개가 한 세계에 산다(스포어처럼).
// 초식은 식물(food)을, 육식은 다른 종을 먹는다. 먹이/사냥 경쟁이 창발한다.

import { Rng } from "@/sim/rng";
import { TRAIT_KEYS, TRAIT_MAX, type Genome, type Traits } from "@/sim/genome";
import { createEntity, type Entity } from "@/sim/entity";
import { createFood, type Food } from "@/sim/food";
import { Environment } from "@/sim/environment";
import { Terrain, TILE, type TileKind } from "@/sim/terrain";
import { SpatialGrid } from "@/sim/spatialGrid";
import { FoodGrid } from "@/sim/foodGrid";
import { makePlayerSpecies, generateWildSpecies, makeKinSpecies, areFriends, type Species } from "@/sim/species";
import { stepEntity } from "@/sim/behavior";
import { stepBoss, type Boss } from "@/sim/boss";
import { SIM } from "@/sim/params";

/** 한 마리가 죽은 이유 (가독성 §7: "왜 내 종이 죽었나"). 사람이 읽는 한글 라벨은 game 층에서. */
export type DeathCause = "starve" | "cold" | "heat" | "age" | "boss" | "predation" | "plague" | "venom";
export type DeathTally = Record<DeathCause, number>;

export function emptyDeathTally(): DeathTally {
  return { starve: 0, cold: 0, heat: 0, age: 0, boss: 0, predation: 0, plague: 0, venom: 0 };
}

/** 형질(0~100) 클램프 + 반올림. */
const clampTrait = (v: number): number => {
  const n = Math.round(v);
  return n < 0 ? 0 : n > TRAIT_MAX ? TRAIT_MAX : n;
};

/** 야생종 한 무리가 겪는 압력 측정치(0~1). maybeEvolveWild 가 재서 adaptWildTraits 에 넘긴다. */
export interface WildPressure {
  /** 무리 평균 추위(0=따뜻 ~ 1=한랭) */
  avgCold: number;
  /** 무리 평균 에너지 비율(0=빈사 ~ 1=포만) — 낮으면 먹이 부족 */
  avgEnergy01: number;
  /** 무리 중 포식자에 노출된 개체 비율(0~1) */
  predFrac: number;
}

/**
 * 측정한 압력으로 야생종 공유 게놈 형질을 "한 스텝" 적응시킨다(제자리 수정). 순수 함수 — rng 미사용이라
 * 결정론적이고 단위 테스트가 쉽다(미세 무작위 드리프트는 호출부에서 별도로 한다). 적응 세 갈래:
 *   · 대사: 추위는 위로(체온), 먹이 부족은 아래로(효율). 둘이 대사 하나를 두고 밀당한다.
 *   · 포식 노출: 속도·무리 성향을 위로(빠르고 뭉쳐서 안 잡아먹힌다).
 * 각 형질은 목표를 향해 wildAdaptRate 만큼만 다가가 세대에 걸쳐 천천히 수렴한다.
 */
export function adaptWildTraits(t: Traits, p: WildPressure): void {
  // (1) 대사 — 추위 위로, 먹이 부족 아래로. 굶주림 끌기는 임계 밑에서만 켜져 배부른 무리는 기존과 동일.
  const coldPull = p.avgCold * SIM.wildColdMetaGain;
  const thr = SIM.wildScarcityEnergyThreshold;
  const scarcity = p.avgEnergy01 < thr ? (thr - p.avgEnergy01) / thr : 0; // 0~1
  const metaTarget = clampTrait(SIM.wildMetaBase + coldPull - scarcity * SIM.wildScarcityMetaDrop);
  t.metabolism = clampTrait(t.metabolism + (metaTarget - t.metabolism) * SIM.wildAdaptRate);

  // (2) 포식 압력 — 노출 비율만큼 속도·무리 목표를 현재치 위로. 노출 0이면 목표=현재라 안 움직인다.
  if (p.predFrac > 0) {
    const speedTarget = clampTrait(t.speed + p.predFrac * SIM.wildPredSpeedRange);
    const herdTarget = clampTrait(t.herding + p.predFrac * SIM.wildPredHerdRange);
    t.speed = clampTrait(t.speed + (speedTarget - t.speed) * SIM.wildAdaptRate);
    t.herding = clampTrait(t.herding + (herdTarget - t.herding) * SIM.wildAdaptRate);
  }
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
  /** 면적 배율(화면 1개 = 1). 개체·먹이·개체 상한을 월드 크기에 비례시켜 밀도를 일정하게 유지한다.
   * 테스트는 작은 월드(1)로 빠르게, 게임은 큰 월드(맵 3배 → 9)로. 밀도가 같아 밸런스가 일관된다. */
  readonly areaScale: number;
  readonly rng: Rng;
  /** 내 종 게놈 — 드래프트가 수정하는 대상(살아있는 중 바꾸면 즉시 반영). */
  readonly genome: Genome;
  readonly playerSpecies: Species;
  readonly species: Species[];
  readonly environment: Environment;
  /** 지형(바다/육지/산). 현재는 시각 전용 — 이동/먹이/시야 결합은 다음 슬라이스(독립 rng 라 sim 동역학 무관). */
  readonly terrain: Terrain;
  readonly grid: SpatialGrid;
  /** 먹이 공간 격자 — 가까운 먹이 질의를 빠르게(큰 맵 성능). 먹이 위치 불변이라 생성 시 1회 빌드. */
  readonly foodGrid: FoodGrid;
  /** 야생 진화의 무작위 드리프트 전용 rng — 메인 rng 스트림을 안 건드려 기존 결정론을 보존한다. */
  private readonly wildEvoRng: Rng;

  entities: Entity[] = [];
  food: Food[] = [];
  tick = 0;
  /** 내 종이 먹은 먹이 누적 수 — 레벨업 경험치의 소스. rng 미사용 → 결정론·밸런스 무관(game 이 delta 로 XP). */
  playerFoodEaten = 0;

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

  constructor(
    seed: string | number,
    width: number,
    height: number,
    genome: Genome,
    areaScale = 1,
  ) {
    this.width = width;
    this.height = height;
    this.areaScale = areaScale;
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
    this.wildEvoRng = new Rng(String(seed) + "-wildevo");
    // 물 전용 플레이어(바다 개척자)는 바다만 살아 과밀하므로 시작 수를 줄인다(다른 게놈엔 영향 없음).
    // areaScale 은 spawnEntities 에서 일괄 곱하므로 여기선 기본 수만(이중 곱 방지).
    const baseStart =
      genome.traits.swimming >= SIM.aquaticOnlyThreshold
        ? SIM.aquaticInitialEntities
        : SIM.initialEntities;
    this.playerSpecies = makePlayerSpecies(genome, baseStart);
    // 우호적 친척 종 — 게놈 변형은 "독립 rng"라 메인 스트림(기존 밸런스)을 안 건드린다. id 는 야생 뒤 고유값.
    const wild = generateWildSpecies(this.rng);
    const kin = makeKinSpecies(wild.length + 1, new Rng(String(seed) + "-kin"), genome);
    this.species = [this.playerSpecies, kin, ...wild];
    this.spawnFood();
    this.spawnEntities();
    // 친척은 spawnEntities(메인 rng) 대신 "독립 rng"로 내 종 근처에 스폰 → 메인 소비 순서 보존(밸런스 불변).
    this.spawnKin(new Rng(String(seed) + "-kinpos"));
    // 바다·고산 먹이는 "독립 rng"로 생물 스폰 뒤에 — this.rng 상태(=step 동역학)를 안 건드려 밸런스 보존.
    this.spawnSeaFood(new Rng(String(seed) + "-seafood"));
    this.spawnDeepFood(new Rng(String(seed) + "-deepfood"));
    this.spawnMountainFood(new Rng(String(seed) + "-mtnfood"));
    // 물고기 떼를 "떼"답게 독립 rng 로 보강 — 무리 행동·진화가 눈에 보이려면 어느 정도 수가 필요하다.
    this.spawnWildHerdPadding(new Rng(String(seed) + "-herdpad"));
    this.grid.rebuild(this.entities);
    // 먹이 위치는 불변이라 격자를 한 번만 빌드한다(available 토글은 탐색 시 거른다).
    this.foodGrid = new FoodGrid(width, height, SIM.gridCellSize);
    this.foodGrid.build(this.food);
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
      for (const m of this.boss.members) {
        m.prevX = m.x;
        m.prevY = m.y;
      }
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
        const rate = this.plagueRate * (1 - SIM.plagueFertilityResist * (e.genome.traits.fertility / TRAIT_MAX));
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
    this.maybeEvolveWild();
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

  /** 개체 수 안전 상한 — 폭주 방지. 소수 개체 게임이라 맵 크기와 무관한 절대 상한. */
  get cap(): number {
    return SIM.populationCap;
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

  /** 내 종 무리의 무게중심(카메라 추적용). 내 종이 없으면 월드 중앙. */
  playerCentroid(): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const e of this.entities) {
      if (e.species.isPlayer) {
        sx += e.x;
        sy += e.y;
        n += 1;
      }
    }
    if (n === 0) return { x: this.width / 2, y: this.height / 2 };
    return { x: sx / n, y: sy / n };
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
    this.spawnFoodOnTiles(this.rng, Math.round(SIM.foodPatches * this.areaScale), false, (kind, fertility) =>
      kind === TILE.land ? 0.15 + fertility : 0,
    );
  }

  /** 바다 타일에 바다 먹이(수영 형질로만 먹는 무경쟁 틈새). 독립 rng → step 동역학 불변. */
  private spawnSeaFood(rng: Rng): void {
    const count = Math.round(SIM.seaFoodPatches * this.areaScale);
    this.spawnFoodOnTiles(rng, count, true, (kind) => (kind === TILE.water ? 1 : 0));
  }

  /** 산 타일에 고산 먹이(날개 형질로만 먹는 무경쟁 틈새 — 바다 먹이의 하늘 대칭). 독립 rng → 동역학 불변. */
  private spawnMountainFood(rng: Rng): void {
    const count = Math.round(SIM.mountainFoodPatches * this.areaScale);
    this.spawnFoodOnTiles(rng, count, false, (kind) => (kind === TILE.mountain ? 1 : 0), true);
  }

  /** 바다 타일에 깊은 바다 먹이(물 전용 종=진짜 물고기만 먹는 전용 틈새). 얕은 바다 먹이와 같은 물 타일에
   * 놓이되 deep 플래그로 양용 종을 배제 — 물고기 학교가 바다 풀뜯이와 경쟁 없이 유지된다. 독립 rng. */
  private spawnDeepFood(rng: Rng): void {
    const count = Math.round(SIM.deepFoodPatches * this.areaScale);
    this.spawnFoodOnTiles(rng, count, true, (kind) => (kind === TILE.water ? 1 : 0), false, true);
  }

  /** 지형 타일 단위 가중 추첨으로 먹이 count 개를 놓는다(정밀 배치). 타일별 weight 는 콜백이 정한다. */
  private spawnFoodOnTiles(
    rng: Rng,
    count: number,
    aquatic: boolean,
    tileWeight: (kind: TileKind, fertility: number) => number,
    mountainous = false,
    deep = false,
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
      this.food.push(createFood(x, y, kind, aquatic, mountainous, deep));
    }
  }

  /** 야생 이주 — 멸종했거나 적은 야생종을 주기적으로 소수 보충(다양성 바닥). 내 종은 제외. */
  /**
   * 야생종도 진화한다(스포어식 살아있는 생태). 주기적으로 각 야생종 게놈을 ① 자기 무리가 실제로 겪는
   * 압력에 적응 ② 형질별 미세 무작위 드리프트(종마다 조금씩 달라짐)로 옮긴다. 적응하는 압력 세 가지:
   *   · 추위 → 고대사(체온 유지). 먹이 부족 → 저대사(적게 먹고 오래 버팀). 둘은 대사 하나를 두고 밀당한다.
   *   · 포식자 노출 → 속도·무리 성향 상승(빠르고 뭉쳐서 잡아먹히지 않는다).
   * 종 게놈을 바꾸면 그 종 모든 개체가 즉시 반영(공유 게놈). 압력 측정·적응은 rng 미사용(결정론) —
   * 미세 드리프트만 독립 rng(wildEvoRng)라 메인 스트림 보존. 내 종은 제외 — 내 종의 진화 방향은
   * 플레이어(카드=선택압)가 쥔다. 짧은 시련엔 거의 안 변하고(밸런스 보존), 긴 런에서 뚜렷이 갈라진다.
   */
  private maybeEvolveWild(): void {
    if (this.tick % SIM.wildEvolveInterval !== 0) return;
    for (const sp of this.species) {
      if (sp.isPlayer) continue;
      const t = sp.genome.traits;
      // 이 종 무리를 한 번 훑어 압력을 측정한다: 추위·평균 에너지(먹이 사정)·포식자 노출.
      let n = 0;
      let coldSum = 0;
      let energySum = 0;
      let exposed = 0; // 감지 범위 안에 자기를 위협하는 포식자가 있는 개체 수
      for (const e of this.entities) {
        if (e.species.id !== sp.id) continue;
        coldSum += this.environment.sampleAt(e.x, e.y).coldness;
        energySum += e.energy;
        // 도망 판정과 같은 기준의 포식자(비우호 타종 + 사냥 식성 + 내 공격력 이상)가 근처에 있나.
        const predator = this.grid.nearestMatching(
          e.x, e.y, SIM.predatorSenseRange,
          (p) => p.alive && p.species.id !== sp.id && !areFriends(sp, p.species) &&
            p.genome.traits.diet > SIM.dietHuntMin && p.genome.traits.attack >= t.attack,
        );
        if (predator) exposed += 1;
        n += 1;
      }
      if (n === 0) continue;
      // 측정한 압력으로 형질을 한 스텝 적응(순수·결정론). 배부르고 안 추운 무리에 포식자도 없으면 무변화.
      adaptWildTraits(t, {
        avgCold: coldSum / n,
        avgEnergy01: energySum / n / SIM.maxEnergy, // 0(빈사)~1(포만)
        predFrac: exposed / n, // 0~1 — 무리 중 포식자에 노출된 비율
      });

      // 형질별 미세 드리프트(독립 rng). swimming·wings 는 수생/비행 정체성이라 제외(드리프트로 뒤집히면
      // 어색 — 비행 종이 날개를 잃으면 산에서 굶는다).
      for (const key of TRAIT_KEYS) {
        if (key === "swimming" || key === "wings") continue;
        t[key] = clampTrait(t[key] + this.wildEvoRng.range(-SIM.wildDriftStep, SIM.wildDriftStep));
      }
    }
  }

  private maybeImmigrate(): void {
    if (this.tick % SIM.immigrationInterval !== 0) return;
    if (this.entities.length >= this.cap) return;
    // 이주 바닥·보충량도 면적 비례 — 절대값이면 큰 맵에서 종당 적정 수 대비 너무 낮아(예 floor 4 vs
    // 종당 ~90) 야생이 줄어도 보충이 안 돼 내 종에게 단조 잠식된다. 비례하면 작은 맵의 회복 진동을 유지.
    const floor = Math.round(SIM.immigrationFloor * this.areaScale);
    const batch = Math.round(SIM.immigrationBatch * this.areaScale);
    const counts = new Map<number, number>();
    for (const e of this.entities) counts.set(e.species.id, (counts.get(e.species.id) ?? 0) + 1);
    for (const sp of this.species) {
      if (sp.isPlayer || sp.friendly) continue; // 친척은 이주로 보충 안 함(내 편 — 멸종하면 사라진다)
      if ((counts.get(sp.id) ?? 0) >= floor) continue;
      const canSwim = sp.genome.traits.swimming >= SIM.swimThreshold;
      const canLand = sp.genome.traits.swimming < SIM.aquaticOnlyThreshold;
      const canFly = sp.genome.traits.wings >= SIM.flyThreshold;
      for (let k = 0; k < batch; k++) {
        // rng 소비 순서(width→height)를 보존한 뒤 막힌 타일이면 통행 타일로 스냅(스냅은 rng 미사용).
        const ix = this.rng.range(0, this.width);
        const iy = this.rng.range(0, this.height);
        const spot = this.terrain.nearestPassable(ix, iy, canSwim, canLand, canFly);
        this.entities.push(createEntity(this.nextId(), spot.x, spot.y, sp, SIM.startEnergy));
      }
    }
  }

  private spawnEntities(): void {
    for (const sp of this.species) {
      // 친척(우호 종)은 여기서 스폰하지 않는다 — spawnKin(독립 rng)이 맡아 메인 rng 소비 순서를 보존한다.
      if (sp.friendly) continue;
      // 야생종은 고유한 영역(보금자리)에 모여 태어난다 — 환경 비옥도 차이 + 무리 성향과 맞물려
      // 경쟁 배제를 늦춰 더 많은 종이 공존한다. 내 종(주인공)은 맵 전체에 넓게 퍼뜨린다.
      const homeX = this.rng.range(0.14, 0.86) * this.width;
      const homeY = this.rng.range(0.14, 0.86) * this.height;
      // 야생종은 좁은 영역에 모여 태어나(영역화 → 공존), 내 종(주인공)은 맵 전체에 얇게 퍼진다.
      const canSwim = sp.genome.traits.swimming >= SIM.swimThreshold;
      const canLand = sp.genome.traits.swimming < SIM.aquaticOnlyThreshold;
      const canFly = sp.genome.traits.wings >= SIM.flyThreshold;
      // 물 전용 내 종은 보금자리를 가장 가까운 바다로 옮긴다(육지 home 이면 흩어져 고립). 스냅은 rng 미사용.
      let baseX = homeX;
      let baseY = homeY;
      if (sp.isPlayer && !canLand) {
        const wh = this.terrain.nearestPassable(homeX, homeY, canSwim, canLand, canFly);
        baseX = wh.x;
        baseY = wh.y;
      }
      // 육상/양용 내 종은 맵 전체에 얇게, 물 전용 내 종은 야생처럼 한 바다 영역에 모아(흩어지면 고립).
      // 야생 보금자리는 맵 크기(면적의 제곱근)에 비례 — 절대값이면 큰 맵에서 좁은 점에 과밀해 국소 먹이를
      // 빨리 소진하고 집단 아사한다(맵 3배에서 야생 급감의 원인). 비례하면 밀도가 유지된다.
      // 모든 종(내 종 포함)이 한 무리로 모여 태어난다 — 내 종이 맵 전체에 흩어지면 무게중심이 안
      // 움직여 카메라가 못 따라가고 개체 하나하나 관찰이 안 된다(소수 개체 게임의 핵심).
      const spread = 72 * Math.sqrt(this.areaScale);
      // 야생은 종 정체성(상대 비율)은 유지하며 전체만 절반으로(소수 생태). 개체는 절대 수(맵 크기와
      // 무관하게 소수) — areaScale(면적 배율)은 먹이 밀도·상한에만 써서, 큰 맵일수록 개체당 먹이가 넉넉하다.
      const count = Math.max(1, Math.round(sp.isPlayer ? sp.initialCount : sp.initialCount * SIM.wildCountScale));
      for (let i = 0; i < count; i++) {
        const x = Math.max(0, Math.min(this.width, baseX + this.rng.range(-spread, spread)));
        const y = Math.max(0, Math.min(this.height, baseY + this.rng.range(-spread, spread)));
        // 막힌 타일에 떨어지면 통행 타일로 스냅(물 전용은 물로, 비행은 어디든). rng 미사용 → 스폰 rng 소비 보존.
        const spot = this.terrain.nearestPassable(x, y, canSwim, canLand, canFly);
        this.entities.push(createEntity(this.nextId(), spot.x, spot.y, sp, SIM.startEnergy));
      }
    }
  }

  /**
   * 우호적 친척 무리를 스폰한다(독립 rng → 메인 밸런스 불변). 야생종처럼 자기 영역(보금자리)에 모여
   * 산다 — 내 종 옆에 두면 무리에 섞여 내 종 결속(cohesion)을 흐트러뜨려 외톨이/매복 보스에 취약해지고,
   * 국소 먹이도 함께 소진해 통과 마진을 잠식한다(세션 2·3에서 두 번 확인 — 근처 동거는 밸런스가 안 맞음).
   * 떨어져 살되 이동하다 만나면 서로 사냥·도망하지 않아(friendly) 자연스레 섞인다(스포어식 우호 종).
   */
  private spawnKin(rng: Rng): void {
    const kin = this.species.find((s) => s.friendly);
    if (!kin) return;
    const canSwim = kin.genome.traits.swimming >= SIM.swimThreshold;
    const canLand = kin.genome.traits.swimming < SIM.aquaticOnlyThreshold;
    const canFly = kin.genome.traits.wings >= SIM.flyThreshold;
    const homeX = rng.range(0.14, 0.86) * this.width;
    const homeY = rng.range(0.14, 0.86) * this.height;
    const spread = 72 * Math.sqrt(this.areaScale);
    for (let i = 0; i < kin.initialCount; i++) {
      const x = Math.max(0, Math.min(this.width, homeX + rng.range(-spread, spread)));
      const y = Math.max(0, Math.min(this.height, homeY + rng.range(-spread, spread)));
      const spot = this.terrain.nearestPassable(x, y, canSwim, canLand, canFly);
      this.entities.push(createEntity(this.nextId(), spot.x, spot.y, kin, SIM.startEnergy));
    }
  }

  /**
   * 물 전용 야생종(물고기 떼)을 독립 rng 로 보강해 진짜 "떼"로 만든다. 기본 소수 스폰(≈5)만으론 무리
   * 짓기·진화(속도·무리 상승)가 눈에 안 들어온다("물고기 떼"인데 5마리). 바다는 육지 생태와 격리된
   * 니치(물고기는 바다 먹이만 먹고 육지 종·포식자와 안 겹친다)라, 늘려도 통과기준 밸런스에 안 걸린다.
   * 독립 rng → 메인 스트림(step 동역학) 불변. 물 전용(swimming ≥ aquaticOnlyThreshold) 종만 대상.
   */
  private spawnWildHerdPadding(rng: Rng): void {
    // 개체 수는 절대(맵 크기 무관 — 소수 개체 게임). areaScale 은 먹이 밀도·상한에만 쓴다(기본 스폰과 동일).
    const pad = SIM.seaHerdPad;
    if (pad <= 0) return;
    const spread = 72 * Math.sqrt(this.areaScale);
    for (const sp of this.species) {
      if (sp.isPlayer || sp.friendly) continue;
      if (sp.genome.traits.swimming < SIM.aquaticOnlyThreshold) continue; // 물 전용(진짜 물고기)만
      const homeX = rng.range(0.14, 0.86) * this.width;
      const homeY = rng.range(0.14, 0.86) * this.height;
      for (let i = 0; i < pad; i++) {
        const x = Math.max(0, Math.min(this.width, homeX + rng.range(-spread, spread)));
        const y = Math.max(0, Math.min(this.height, homeY + rng.range(-spread, spread)));
        // 물 전용: 바다로만 스냅(canSwim=true·canLand=false). rng 미사용 스냅이라 소비 순서 보존.
        const spot = this.terrain.nearestPassable(x, y, true, false, false);
        this.entities.push(createEntity(this.nextId(), spot.x, spot.y, sp, SIM.startEnergy));
      }
    }
  }
}
