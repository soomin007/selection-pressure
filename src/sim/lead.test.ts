// 알파 조종(앞장서기, ?alpha) — 슬라이스 0 의 안전장치.
//
// 이 파일의 절반은 "기능이 된다"가 아니라 **"기존 세계를 1비트도 안 건드렸다"** 를 증명한다.
// 조종은 sim 한복판(stepEntity 의 desired·cohesion)에 손을 넣는 기능이라, 잘못 걸면 난수 스트림이
// 통째로 밀려 여태 쌓은 밸런스가 조용히 다른 세계가 된다(known_issues 의 "쌍둥이 rng" 계열).
// 그래서 여기 결정론 테스트들은 **완화 대상이 아니라 감지기**다 — 빨간불이면 테스트가 낡은 게 아니라
// 설계가 틀린 것이다.
import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { SIM, LEAD } from "@/sim/params";
import { TILE } from "@/sim/terrain";
import { createBoss, bossCanHunt, type BossType } from "@/sim/boss";
import { defaultGenome, cloneGenome, type Genome, type Traits } from "@/sim/genome";
import { attackRangeOf, biteOutcome, leadBiteTarget, leadRelation, leadTargetRange } from "@/sim/behavior";
import { areFriends } from "@/sim/species";
import { createEntity } from "@/sim/entity";
import type { LeadCommand } from "@/sim/lead";
import type { Entity } from "@/sim/entity";

const W = 540;
const H = 960;

/** world.test.ts 와 **같은 지문 함수**(위치·에너지까지 포함). 두 곳의 비교 기준이 갈리면 안 된다. */
function snapshot(world: World): string {
  const ents = world.entities.map(
    (e) => `${e.id}:${e.x.toFixed(3)},${e.y.toFixed(3)},${e.energy.toFixed(3)}`,
  );
  return `t${world.tick}|p${world.population}|${ents.join(";")}`;
}

function tune(over: Partial<Traits>): Genome {
  const g = defaultGenome();
  Object.assign(g.traits, over);
  return g;
}

/** 무리 빌드. defaultGenome().herding 은 0 이라, 이 게놈이 없으면 cohesion 블록에 발도 못 딛는다. */
const HERD92 = (): Genome => tune({ herding: 92 });
/** preset_scout(느긋한 정찰자) — herding 0 인 시작 프리셋 다섯 중 하나. */
const SCOUT = (): Genome =>
  tune({ diet: 40, vision: 84, metabolism: 30, speed: 62, attack: 56, fertility: 48 });

/** 알파 없이 그냥 도는 세계(기준선). */
function runPlain(seed: string, genome: Genome, steps: number): World {
  const w = new World(seed, W, H, genome);
  for (let i = 0; i < steps; i++) w.step();
  return w;
}

/** 알파를 **지정만** 하고 명령은 한 번도 안 주는 세계(game 이 매 프레임 armLead 하는 것과 같은 모양). */
function runArmed(seed: string, genome: Genome, steps: number, cmd: LeadCommand | null = null): World {
  const w = new World(seed, W, H, genome);
  for (let i = 0; i < steps; i++) {
    w.armLead();
    w.lead.cmd = cmd;
    w.step();
  }
  return w;
}

/**
 * 보스를 띄운 세계 한 판. `arm` 이 true 면 매 틱 알파를 지정하되 **명령은 한 번도 안 준다**.
 *
 * ★ 왜 보스를 띄운 판이 따로 필요한가: 조종이 sim 규칙을 갈라지게 하는 자리가 cohesion·desired
 *   말고 하나 더 있다 — 보스의 수풀 엄폐 봉인(boss.bossCanHunt)이다. 보스 없는 판만 돌리면
 *   그 갈림길을 한 번도 안 밟고 초록불이 난다(실제로 그래서 못 잡은 결함이 있었다).
 *
 * `hidden` = "수풀에 들어 있어서 이 보스가 못 잡는 내 종" 을 매 틱 센 합계. 봉인이 새면 바로 이
 * 개체들이 사냥감이 된다(즉사 반경뿐 아니라 **보스의 목표 선택**도 bossCanHunt 를 통과한 개체
 * 중에서 고른다 → 한 마리만 노출돼도 보스의 경로가 통째로 갈린다).
 * 이 값이 0 이면 이 판엔 애초에 함정이 안 놓인 것이라 동일성 비교가 공허하다 → 테스트가 못 박는다.
 */
function runBossWorld(
  seed: string,
  genome: Genome,
  steps: number,
  type: BossType,
  arm: boolean,
): { w: World; hidden: number } {
  const w = new World(seed, W, H, genome);
  // createBoss 는 world.rng 를 안 쓴다(자체 좌표 계산) → 양쪽 판에 똑같은 보스가 선다.
  w.boss = createBoss(type, W, H, w.terrain);
  let hidden = 0;
  for (let i = 0; i < steps; i++) {
    if (arm) {
      w.armLead();
      w.lead.cmd = null;
    }
    w.step();
    const b = w.boss;
    if (b === null) continue;
    for (const e of w.entities) {
      if (!e.species.isPlayer) continue;
      if (w.terrain.isGrass(e.x, e.y) && !bossCanHunt(b, e, w)) hidden += 1;
    }
  }
  return { w, hidden };
}

/** 알파의 틱 시작 위치에서 (tx,ty) 쪽으로 전력. 테스트 코드라 rng 를 쓰지 않는다(결정론 유지). */
function steerTo(w: World, tx: number, ty: number): LeadCommand | null {
  const L = w.lead;
  if (L.leaderId < 0) return null;
  const dx = tx - L.x;
  const dy = ty - L.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { dx: 1, dy: 0, throttle: 1 };
  return { dx: dx / d, dy: dy / d, throttle: 1 };
}

const RIGHT: LeadCommand = { dx: 1, dy: 0, throttle: 1 };

// ---------------------------------------------------------------------------
// 1~4. 격리·결정론 — 이 프로토타입의 가장 중요한 안전장치
// ---------------------------------------------------------------------------
describe("알파 격리 — 지정만 하면 세계가 안 바뀐다", () => {
  /**
   * 알파를 지정하는 것만으로는 아무 일도 일어나면 안 된다. 근거는 followTicks 하나다:
   * 명령이 있는 틱에만 재충전되므로, 명령을 한 번도 안 받으면 영원히 0 → cohesion 스왑도
   * desired 덮어쓰기도 성립하지 않는다. 소수 3자리 지문에 더해 **rng 내부 상태**까지 본다
   * (위치가 조금이라도 달라지면 물기 판정·번식 단축 평가가 걸리는 틱이 달라져 rng 가 먼저 어긋난다).
   */
  function expectIdentical(seed: string, make: () => Genome, cmd: LeadCommand | null): void {
    const plain = runPlain(seed, make(), 600);
    const armed = runArmed(seed, make(), 600, cmd);
    expect(armed.lead.leaderId).toBeGreaterThanOrEqual(0); // 알파가 실제로 지정돼 있었다
    expect(armed.lead.followTicks).toBe(0); // 추종은 한 번도 안 켜졌다
    expect(snapshot(armed)).toEqual(snapshot(plain));
    expect(armed.rng.getState()).toBe(plain.rng.getState());
  }

  it("명령이 없으면 1비트도 안 바뀐다 (defaultGenome, 600틱)", () => {
    expectIdentical("golden-1", defaultGenome, null);
  });

  it("명령이 없으면 1비트도 안 바뀐다 (herding 92 게놈, 600틱)", () => {
    // ★ 핵심 감지기. defaultGenome().herding 은 0 이라 1번 테스트만으로는 cohesion 블록을
    //   한 번도 안 밟고 초록불이 난다(known_issues 에 못 박은 함정).
    expectIdentical("golden-1", HERD92, null);
  });

  it("명령이 없으면 1비트도 안 바뀐다 (herding 0 · vision 84 = preset_scout 게놈, 600틱)", () => {
    expectIdentical("golden-1", SCOUT, null);
  });

  it("throttle 0 명령은 명령 없음과 같다 (herding 92, 600틱)", () => {
    expectIdentical("golden-1", HERD92, { dx: 0, dy: 0, throttle: 0 });
  });
});

// ---------------------------------------------------------------------------
// 4-B. 보스가 떠 있는 세계에서의 무입력 동일성 (수풀 봉인 게이트가 새는지)
// ---------------------------------------------------------------------------
describe("알파 격리 — 보스가 떠 있어도 지정만으로는 세계가 안 바뀐다", () => {
  /**
   * 위의 격리 테스트들은 보스 없는 판만 돌린다. 조종이 sim 을 갈라지게 하는 세 번째 자리
   * (bossCanHunt 의 수풀 엄폐 봉인)는 보스를 실제로 띄워야만 밟힌다.
   *
   * 봉인 게이트가 `commanded`(한 번이라도 몰았나) 가 아니라 `leaderId`(지정했나) 로 걸리면,
   * **지정만 한 판에서 수풀 속 내 종이 잡히기 시작해** 사망 수·개체 수·rng 스트림이 통째로 갈린다.
   * 그래서 이 테스트는 그 회귀 하나를 겨냥한 감지기다 — 빨간불이면 게이트가 새는 것이다.
   */
  function expectIdenticalUnderBoss(type: BossType, seed: string, make: () => Genome): number {
    const plain = runBossWorld(seed, make(), 600, type, false);
    const armed = runBossWorld(seed, make(), 600, type, true);
    expect(armed.w.lead.leaderId).toBeGreaterThanOrEqual(0); // 알파가 실제로 지정돼 있었다
    expect(armed.w.lead.commanded).toBe(false); // 한 번도 안 몰았다
    expect(armed.w.lead.followTicks).toBe(0);
    expect(snapshot(armed.w)).toEqual(snapshot(plain.w));
    expect(armed.w.rng.getState()).toBe(plain.w.rng.getState());
    expect(armed.hidden).toBe(plain.hidden); // 엄폐 판정 자체도 양쪽이 똑같이 났다
    return plain.hidden;
  }

  it("큰수리(수풀 엄폐 보스) — 지정만 한 판이 보스 없던 시절 규칙 그대로다", () => {
    const hidden = expectIdenticalUnderBoss("raptor", "env-1", defaultGenome);
    // ★ 함정이 실제로 놓였는지 못 박는다. 수풀 덕에 안 잡히고 있던 내 종이 한 번도 없었다면
    //   위의 동일성 비교는 아무것도 증명하지 못한 것이다(공허한 초록불).
    expect(hidden).toBeGreaterThan(0);
  });

  it("큰수리 + 무리 게놈(herding 92) — 같은 판에서도 1비트도 안 바뀐다", () => {
    expect(expectIdenticalUnderBoss("raptor", "env-1", HERD92)).toBeGreaterThan(0);
  });

  it("대조군 — 수풀 엄폐가 없는 보스(추격자)에서도 지정만으로는 안 바뀐다", () => {
    // grassCover 가 없는 보스라 봉인 분기 자체를 안 탄다. 위 두 테스트가 빨간불일 때
    // "보스를 띄우면 원래 어긋나는 것 아니냐"를 배제해 주는 대조군이다.
    expectIdenticalUnderBoss("chaser", "env-1", HERD92);
  });
});

// ---------------------------------------------------------------------------
// 5~8. 지정·승계는 rng 도 id 도 안 쓴다
// ---------------------------------------------------------------------------
describe("알파 지정·승계 — rng 와 id 를 안 건드린다", () => {
  it("armLead 는 멱등이고 rng·nextId 를 안 쓴다", () => {
    const w = runPlain("golden-1", HERD92(), 120);
    const rngBefore = w.rng.getState();
    const idBefore = w.nextId(); // 이 호출로 카운터는 idBefore+1 이 된다
    w.armLead();
    const first = w.lead.leaderId;
    expect(first).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 10; i++) w.armLead(); // 여러 번 불러도 알파는 안 바뀐다(멱등)
    expect(w.lead.leaderId).toBe(first);
    expect(w.rng.getState()).toBe(rngBefore);
    expect(w.nextId()).toBe(idBefore + 1); // 그 사이 id 를 한 개도 안 먹었다
  });

  it("armLead 는 '무리 한복판에 가장 가까운 내 종'을 고른다 (기대 id 를 직접 계산해 맞춘다)", () => {
    // ⚠ "두 판에서 답이 같다"만 재면 규칙을 '가장 먼 개체'로 바꿔도 초록불이다(양쪽 다 똑같이
    //   틀리니까). 그래서 여기서는 규칙(무게중심 최근접, 동률이면 작은 id)을 테스트가 직접
    //   계산해 값으로 맞춘다.
    const w = runPlain("golden-1", HERD92(), 120);
    const c = w.playerCentroid();
    let expected = -1;
    let bestD2 = Infinity;
    let farthest = -1;
    let worstD2 = -1;
    let mine = 0;
    let bx = 0;
    let by = 0;
    for (const e of w.entities) {
      if (!e.species.isPlayer) continue;
      mine += 1;
      const d2 = (e.x - c.x) ** 2 + (e.y - c.y) ** 2;
      if (d2 < bestD2 || (d2 === bestD2 && e.id < expected)) {
        bestD2 = d2;
        expected = e.id;
        bx = e.x;
        by = e.y;
      }
      if (d2 > worstD2) {
        worstD2 = d2;
        farthest = e.id;
      }
    }
    expect(mine).toBeGreaterThan(3); // 최근접과 최원거리가 갈릴 만큼은 있다(비교가 성립한다)
    expect(farthest).not.toBe(expected); // '가장 먼'으로 뒤집으면 답이 실제로 달라진다

    w.armLead();
    expect(w.lead.leaderId).toBe(expected);
    // 굳힌 스냅샷 위치도 그 개체의 자리여야 한다(엉뚱한 개체를 골랐는데 좌표만 맞을 수는 없다).
    expect(w.lead.x).toBe(bx);
    expect(w.lead.y).toBe(by);
  });

  it("승계는 rng 를 한 번도 안 쓴다 (알파 있는 세계 ≡ 알파 없는 세계)", () => {
    // 같은 개체를 양쪽에서 똑같이 쓰러뜨린 뒤 한 틱을 돌린다. 승계가 rng 를 쓰거나 세계를
    // 건드렸다면 rng 상태나 지문 중 하나는 반드시 어긋난다.
    const seed = "golden-1";
    const led = runArmed(seed, HERD92(), 200);
    const plain = runPlain(seed, HERD92(), 200);
    expect(snapshot(led)).toEqual(snapshot(plain)); // 전제: 여기까진 같은 세계다

    const victim = led.lead.leaderId;
    expect(victim).toBeGreaterThanOrEqual(0);
    for (const e of led.entities) if (e.id === victim) e.alive = false;
    for (const e of plain.entities) if (e.id === victim) e.alive = false;
    led.step();
    plain.step();

    expect(led.rng.getState()).toBe(plain.rng.getState());
    expect(snapshot(led)).toEqual(snapshot(plain));
    expect(led.lead.leaderId).not.toBe(victim); // 옆의 한 마리가 이어받았다
    expect(led.lead.leaderId).toBeGreaterThanOrEqual(0);
    expect(led.lead.changedTick).toBe(led.tick); // 승계 연출 신호
    expect(led.lead.followTicks).toBe(0); // 죽은 이의 명령으로 튀어나가지 않는다
    expect(led.lead.cmd).toBeNull();
  });

  it("승계는 결정론적이다 — 같은 시드 두 월드에서 이어받는 id 가 같다", () => {
    const succeed = (): number => {
      const w = runArmed("golden-1", HERD92(), 200);
      const victim = w.lead.leaderId;
      for (const e of w.entities) if (e.id === victim) e.alive = false;
      w.step();
      return w.lead.leaderId;
    };
    const a = succeed();
    expect(a).toBeGreaterThanOrEqual(0);
    expect(succeed()).toBe(a);
  });

  it("승계는 '쓰러진 자리에서 가장 가까운 내 종'이다 (기대 id 를 직접 계산해 맞춘다)", () => {
    // ⚠ 위 테스트는 "두 판에서 이어받는 id 가 같다"만 본다 — 규칙을 '가장 먼 개체'나 '배열의
    //   첫 개체'로 바꿔도 통과한다. 규칙 자체를 붙잡는 건 여기다.
    const w = runArmed("golden-1", HERD92(), 200);
    const victim = w.lead.leaderId;
    expect(victim).toBeGreaterThanOrEqual(0);
    const dead = w.entities.find((e) => e.id === victim);
    expect(dead).toBeDefined();
    if (!dead) return;
    // syncLeader 가 기준으로 삼는 자리 = 쓰러진 알파의 이번 틱 시작 위치. 죽은 개체는 안 움직이므로
    // 지금 위치가 곧 그 자리다.
    const lx = dead.x;
    const ly = dead.y;
    dead.alive = false;
    w.step();

    // 승계는 죽은 개체를 걷어낸 뒤·이주 전에 돈다. 이주는 내 종을 안 늘리고(isPlayer 는 건너뛴다)
    // 야생 진화도 개체를 안 만드니, step 뒤의 내 종 집합·좌표가 곧 승계가 보던 그것이다.
    let expected = -1;
    let bestD2 = Infinity;
    let farthest = -1;
    let worstD2 = -1;
    let mine = 0;
    for (const e of w.entities) {
      if (!e.species.isPlayer) continue;
      mine += 1;
      const d2 = (e.x - lx) ** 2 + (e.y - ly) ** 2;
      if (d2 < bestD2 || (d2 === bestD2 && e.id < expected)) {
        bestD2 = d2;
        expected = e.id;
      }
      if (d2 > worstD2) {
        worstD2 = d2;
        farthest = e.id;
      }
    }
    expect(mine).toBeGreaterThan(3);
    expect(farthest).not.toBe(expected);
    expect(w.lead.leaderId).toBe(expected);
  });

  it("승계는 nextId 를 안 부른다 — 승계 전후로 다음 신생아 id 가 연속이다", () => {
    const w = runArmed("golden-1", HERD92(), 200);
    const victim = w.lead.leaderId;
    const idsBefore = new Set(w.entities.map((e) => e.id));
    const before = w.nextId(); // 호출 후 카운터 = before + 1
    for (const e of w.entities) if (e.id === victim) e.alive = false;
    w.step();
    // 이 틱에 실제로 태어난(또는 이주해 온) 개체 수 — 그만큼만 id 를 먹었어야 한다.
    const created = w.entities.filter((e) => !idsBefore.has(e.id)).length;
    expect(w.nextId()).toBe(before + 1 + created);
  });

  it("내 종이 전멸하면 leaderId 는 -1 이 되고 step() 은 안 던진다", () => {
    const w = runArmed("golden-1", HERD92(), 200);
    expect(w.lead.leaderId).toBeGreaterThanOrEqual(0);
    for (const e of w.entities) if (e.species.isPlayer) e.alive = false;
    expect(() => w.step()).not.toThrow();
    expect(w.lead.leaderId).toBe(-1);
    expect(() => w.step()).not.toThrow(); // 알파 없는 세계로 계속 굴러간다
  });
});

// ---------------------------------------------------------------------------
// 10~11. 조종이 통한다
// ---------------------------------------------------------------------------
describe("조종 — 손끝이 결과를 만든다", () => {
  it("명령 방향으로 알파가 실제로 이동한다 (60틱)", () => {
    const push = new World("golden-1", W, H, HERD92());
    push.armLead();
    const id = push.lead.leaderId;
    const startX = push.lead.x;
    for (let i = 0; i < 60; i++) {
      push.lead.cmd = RIGHT;
      push.step();
    }
    expect(push.lead.leaderId).toBe(id); // 이 짧은 구간엔 승계가 없었다(비교가 성립한다)
    const movedX = push.lead.x - startX;

    // 같은 세계를 명령 없이 60틱 돌렸을 때의 x 이동과 견준다 — 절대값이 아니라 **차이**를 본다.
    const idle = runArmed("golden-1", HERD92(), 60);
    const idleEnt = idle.entities.find((e) => e.id === id);
    const idleX = idleEnt ? idleEnt.x - startX : 0;
    expect(movedX).toBeGreaterThan(30);
    expect(movedX).toBeGreaterThan(Math.abs(idleX) + 20);
  });

  it("speed 20 과 speed 90 의 60틱 이동 거리가 뚜렷이 갈린다", () => {
    // 방향 비교만 한다 — 절대값은 지형·낮밤에 따라 흔들리므로 단정하지 않는다.
    const pushDist = (speed: number): number => {
      const w = new World("golden-1", W, H, tune({ speed }));
      w.armLead();
      const sx = w.lead.x;
      const sy = w.lead.y;
      for (let i = 0; i < 60; i++) {
        w.lead.cmd = RIGHT;
        w.step();
      }
      return Math.hypot(w.lead.x - sx, w.lead.y - sy);
    };
    expect(pushDist(90)).toBeGreaterThan(pushDist(20));
  });
});

// ---------------------------------------------------------------------------
// 12~15. 규칙을 우회하지 않는다 (조종은 "방향"만 정한다)
// ---------------------------------------------------------------------------
describe("조종은 규칙을 우회하지 않는다", () => {
  it("물 쪽으로 계속 밀어도 비수영 알파는 물·산에 못 들어간다 (1500틱)", () => {
    const w = new World("env-1", W, H, defaultGenome()); // 수영 50 < 65 → 비수영
    const sea = w.terrain.nearestLargePassable(W * 0.5, H * 0.5, true, false, false, SIM.minWaterRegion);
    let violations = 0;
    for (let i = 0; i < 1500; i++) {
      w.armLead(); // 승계된 뒤에도(전멸했다면 다시) 계속 물로 민다
      w.lead.cmd = steerTo(w, sea.x, sea.y);
      w.step();
      for (const e of w.entities) {
        const k = w.terrain.kindAt(e.x, e.y);
        const canSwim = e.genome.traits.swimming >= SIM.swimThreshold;
        if (k === TILE.mountain) violations += 1;
        else if (k === TILE.water && !canSwim) violations += 1;
      }
    }
    expect(violations).toBe(0);
  });

  it("육지 쪽으로 계속 밀어도 물 전용 알파는 뭍에 못 올라온다 (1500틱)", () => {
    const w = new World("env-1", W, H, tune({ swimming: 95 })); // ≥ aquaticOnlyThreshold(90)
    // 트인 땅 한 곳을 목표로 삼는다(수풀·험지도 육지지만 판정은 TILE.land 로 못 박는다).
    let land = { x: W * 0.5, y: H * 0.5 };
    for (let i = 0; i < w.terrain.tiles.length; i++) {
      if (w.terrain.tiles[i] === TILE.land) {
        land = { x: w.terrain.tileCenterX(i), y: w.terrain.tileCenterY(i) };
        break;
      }
    }
    let landViolation = 0;
    for (let i = 0; i < 1500; i++) {
      w.armLead();
      w.lead.cmd = steerTo(w, land.x, land.y);
      w.step();
      for (const e of w.entities) {
        if (
          e.genome.traits.swimming >= SIM.aquaticOnlyThreshold &&
          w.terrain.kindAt(e.x, e.y) === TILE.land
        ) {
          landViolation += 1;
        }
      }
    }
    expect(landViolation).toBe(0);
  });

  it("월드 밖으로 못 나간다 (좌상단·우하단으로 각각 400틱 밀어붙인다)", () => {
    const w = new World("golden-1", W, H, HERD92());
    let outside = 0;
    const drive = (tx: number, ty: number, ticks: number): void => {
      for (let i = 0; i < ticks; i++) {
        w.armLead();
        w.lead.cmd = steerTo(w, tx, ty);
        w.step();
        for (const e of w.entities) {
          if (e.x < 0 || e.x > W || e.y < 0 || e.y > H) outside += 1;
        }
      }
    };
    drive(-5000, -5000, 400);
    drive(W + 5000, H + 5000, 400);
    expect(outside).toBe(0);
  });

  it("명령을 계속 주며 먹이를 다 막으면 알파도 굶어 죽는다", () => {
    // 조종은 "방향"만 정한다 — 대사·굶주림은 그대로다. 순수 초식(diet 0)이라 사냥으로도 못 버틴다.
    const w = new World("env-1", W, H, tune({ diet: 0 }));
    w.armLead();
    const first = w.lead.leaderId;
    expect(first).toBeGreaterThanOrEqual(0);
    let gone = false;
    for (let i = 0; i < 3000 && !gone; i++) {
      for (const f of w.food) {
        f.available = false;
        f.regrowTimer = 1_000_000;
      }
      w.armLead();
      w.lead.cmd = steerTo(w, W * 0.5, H * 0.5);
      w.step();
      gone = !w.entities.some((e) => e.id === first);
    }
    expect(gone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 16~18. 무리 추종 — 형질이 곧 규칙
// ---------------------------------------------------------------------------
describe("무리 추종", () => {
  it("명령을 끊으면 LEAD.followHoldTicks 뒤에 추종이 꺼진다", () => {
    const w = new World("golden-1", W, H, HERD92());
    w.armLead();
    // 대조군 — 명령이 살아 있는 동안엔 실제로 따라오는 개체가 있었다. 이게 없으면 아래의 "0"은
    // "원래부터 아무도 안 따라왔다"와 구분되지 않아 증거가 되지 못한다.
    let maxFollowers = 0;
    for (let i = 0; i < 60; i++) {
      w.lead.cmd = steerTo(w, W * 0.5, H * 0.5);
      w.step();
      maxFollowers = Math.max(maxFollowers, w.lead.followerCount);
    }
    expect(maxFollowers).toBeGreaterThan(0);
    // syncLeadStart 는 "먼저 1 감소 → 명령이 있으면 재충전" 순서라, 명령이 있는 틱 직후엔 만땅이다.
    expect(w.lead.followTicks).toBe(LEAD.followHoldTicks);

    w.lead.cmd = null;
    for (let i = 0; i < LEAD.followHoldTicks - 1; i++) w.step();
    expect(w.lead.followTicks).toBe(1);
    w.step();
    expect(w.lead.followTicks).toBe(0);
    // 추종이 꺼지면 아무도 알파에게 끌리지 않는다. HUD 의 "따르는 무리 N" 이 읽는 바로 그 값이다
    // (규칙이 판정되는 자리에서 센 값이라, 규칙과 어긋날 수가 없다).
    expect(w.lead.followerCount).toBe(0);
    for (let i = 0; i < 10; i++) {
      w.step();
      expect(w.lead.followerCount).toBe(0); // 손을 뗀 뒤로는 계속 0 이다
    }
  });

  it("herding 92 가 herding 10 보다 알파에게 바짝 붙어 따라온다 (방향 비교)", () => {
    // 알파를 중앙 둘레로 천천히 끌고 다니며, 끝난 시점의 알파–내 무리 평균 거리를 견준다.
    // 절대 거리는 지형·개체 수에 흔들리므로 여러 시드의 합으로 방향만 본다.
    const meanDist = (herding: number, seed: string): number => {
      const w = new World(seed, W, H, tune({ herding }));
      w.armLead();
      for (let i = 0; i < 300; i++) {
        const a = i * 0.02;
        w.lead.cmd = steerTo(w, W * 0.5 + 140 * Math.cos(a), H * 0.5 + 140 * Math.sin(a));
        w.step();
      }
      let sum = 0;
      let n = 0;
      for (const e of w.entities) {
        if (!e.species.isPlayer || e.id === w.lead.leaderId) continue;
        sum += Math.hypot(e.x - w.lead.x, e.y - w.lead.y);
        n += 1;
      }
      return n === 0 ? 0 : sum / n;
    };
    const seeds = ["golden-1", "env-1", "env-2"];
    const tight = seeds.reduce((s, seed) => s + meanDist(92, seed), 0);
    const loose = seeds.reduce((s, seed) => s + meanDist(10, seed), 0);
    expect(tight).toBeLessThan(loose);
  });

  it("herding 0 이면 앞장서도 아무도 안 따라온다 (사양 고정)", () => {
    // 이 프로토타입의 약속: 조종은 형질을 대체하지 않는다. 무리성을 안 찍었으면 추종은 0 이고,
    // 그 사실을 화면(따르는 무리 칩·배너)이 그대로 말한다.
    //
    // ⚠ "0 이 나왔다"만 보면 이 테스트는 거저 통과한다(명령이 안 들어갔어도 0 이다). 그래서
    //   ① 조종이 실제로 살아 있었는지(followTicks>0 인 틱 수)와 ② 같은 각본을 herding 92 로
    //   돌리면 추종이 분명히 잡히는지를 함께 못 박는다 — 대조군 없는 0 은 증거가 아니다.
    const script = (genome: Genome): { followers: number; liveTicks: number } => {
      const w = new World("golden-1", W, H, genome);
      w.armLead();
      let followers = 0;
      let liveTicks = 0;
      for (let i = 0; i < 300; i++) {
        w.lead.cmd = steerTo(w, W * 0.5, H * 0.5);
        w.step();
        if (w.lead.followTicks > 0) liveTicks += 1;
        // 규칙이 판정되는 자리에서 센 값(HUD 의 "따르는 무리 N")을 그대로 더한다.
        // ⚠ followerCount 는 step 이 갱신하므로 반드시 step **직후**에 읽어야 그 틱 값이다.
        followers += w.lead.followerCount;
      }
      return { followers, liveTicks };
    };

    const none = script(defaultGenome()); // herding 0
    expect(none.liveTicks).toBeGreaterThan(250); // 조종은 내내 살아 있었다
    expect(none.followers).toBe(0);

    const herd = script(HERD92()); // 대조군 — 같은 각본, 무리성만 다르다
    expect(herd.followers).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 19. 회귀 — visionRadius 추출이 값을 안 바꿨다
// ---------------------------------------------------------------------------
describe("golden 지문 — visionRadius 추출이 값을 안 바꾼다", () => {
  // 코드를 얹기 전(기준선)에 캡처한 문자열 그대로다. world.test.ts 의 결정론 테스트는 두 세계를
  // 서로 비교할 뿐이라 "둘 다 똑같이 밀린" 변화를 못 잡는다 — 절대값을 박아 두는 건 여기뿐이다.
  // ⚠ 이게 빨간불이면 시야 계산의 곱셈 순서가 바뀐 것이다. 기대치를 갱신하지 말고 코드를 되돌려라.
  // (재기준선 이력) 2026-08-05 새끼 초기 방향 수정(entity.ts wanderAngle 버그: id 를 도 단위로 읽어
  // 연속 id 가 1도씩만 달랐다)으로 재캡처. 이 수정은 모든 세계의 헤딩을 바꾸므로 골든이 바뀌는 것이
  // 정상이다. 출생 위치 극좌표 재해석(behavior.ts, draw 2회 유지)도 같은 커밋에 포함.
  const GOLDEN_A_SNAP = "t600|p86|8:291.264,274.897,0.281;9:355.364,119.685,92.850;10:222.093,398.373,78.246;11:272.545,230.210,54.350;18:206.035,676.369,15.344;24:360.858,726.329,82.402;29:206.209,470.205,73.371;30:295.893,354.008,51.284;32:186.114,511.381,30.403;45:361.845,706.311,90.678;47:177.755,11.045,81.706;48:368.083,253.497,62.283;49:528.642,0.111,54.593;52:20.838,525.724,6.657;54:500.028,679.996,50.020;55:526.741,699.893,17.020;57:379.917,880.233,87.349;58:230.520,569.367,28.999;59:422.787,895.131,61.665;62:540.000,839.993,46.791;64:399.347,928.972,56.177;65:403.870,919.954,51.625;69:411.663,912.934,19.076;83:184.065,724.226,56.050;84:27.448,485.655,48.720;88:403.648,930.320,17.165;89:441.198,715.742,60.208;93:14.387,850.336,40.788;94:192.426,766.145,97.161;95:159.999,942.587,82.733;96:0.000,772.823,60.361;130:78.632,896.134,46.524;131:0.000,460.003,18.412;136:0.000,763.448,43.268;138:370.933,225.238,132.876;139:236.782,554.850,96.214;144:364.945,860.036,69.359;145:140.725,275.191,42.033;146:51.562,810.673,84.131;148:322.460,54.646,62.876;149:192.019,768.267,96.333;150:0.000,779.820,50.152;151:539.775,800.267,65.519;154:300.712,662.104,48.960;155:382.512,942.042,35.349;156:23.578,760.002,38.184;157:225.399,403.253,85.472;158:103.434,820.069,6.252;159:65.960,274.580,78.208;163:222.416,399.875,42.522;165:135.219,207.132,28.494;166:362.954,705.043,87.789;167:107.520,376.404,16.516;168:219.895,573.561,22.720;169:57.554,489.898,18.984;170:140.059,919.977,31.801;171:330.473,255.183,48.168;172:229.594,569.860,27.553;175:183.964,799.277,58.098;176:33.322,787.549,86.926;177:100.578,934.959,83.663;178:329.591,256.307,42.467;179:270.796,224.549,25.699;180:347.228,940.757,43.833;181:182.862,747.099,47.575;182:200.942,791.301,96.640;183:201.056,791.280,63.671;184:188.770,260.446,41.702;185:16.775,865.031,39.842;186:379.978,878.370,36.167;187:320.799,259.550,48.000;188:200.904,765.462,47.575;189:387.804,259.472,62.283;190:315.903,647.285,48.960;191:370.000,710.000,55.000;192:75.732,947.641,55.000;193:310.000,290.000,55.000;194:76.792,602.600,55.000;195:135.377,196.687,55.000;196:383.662,745.075,55.000;197:337.862,603.641,55.000;198:178.404,445.945,55.000;199:221.013,954.979,55.000;200:342.232,671.048,55.000;201:376.248,586.671,55.000;202:530.822,812.514,55.000";
  const GOLDEN_A_RNG = -32612748;
  const GOLDEN_B_SNAP = "t600|p88|0:521.302,256.715,43.356;4:296.695,702.019,83.590;7:94.089,622.739,14.651;9:178.410,707.204,11.488;10:312.155,279.644,51.781;11:302.224,180.058,91.035;13:303.057,541.961,68.726;15:319.465,276.188,60.904;16:280.038,249.600,83.261;21:423.894,805.514,2.861;24:427.032,680.366,41.621;25:231.192,747.036,34.990;28:540.000,584.659,57.655;32:218.243,426.708,14.047;41:174.851,917.812,86.581;47:469.894,351.180,55.615;48:340.598,763.009,111.424;49:380.769,281.784,75.849;51:353.016,320.387,43.265;52:379.534,686.932,42.339;53:424.767,84.296,19.060;54:517.952,679.969,50.020;55:540.000,675.075,17.020;57:340.007,860.021,32.396;58:187.265,553.853,41.305;61:352.977,642.148,96.298;65:405.266,883.939,14.775;67:435.429,874.173,9.984;81:307.302,742.039,23.322;86:433.703,521.842,3.819;89:511.084,807.879,50.056;93:115.546,923.824,25.664;94:209.844,768.777,18.197;96:7.643,853.519,40.793;129:175.566,771.035,94.085;134:336.882,768.430,54.121;137:374.015,860.067,33.610;139:206.666,751.457,94.913;140:46.129,794.358,36.168;142:22.508,759.847,85.753;143:347.346,712.382,7.046;145:140.618,485.017,51.486;146:121.867,938.114,37.782;147:200.005,750.595,45.072;150:513.107,214.311,94.364;151:46.265,792.654,87.122;152:153.040,808.273,35.427;153:353.036,899.953,65.396;154:538.449,0.097,112.851;155:186.433,489.830,106.010;156:181.430,39.932,35.387;157:256.674,3.509,31.775;160:444.579,823.518,48.032;161:170.243,801.531,16.977;162:378.937,879.526,1.810;163:69.849,880.104,59.850;164:431.752,402.343,37.437;165:143.095,801.129,41.873;166:23.622,143.881,3.441;167:10.183,788.943,72.518;168:46.564,792.208,77.002;169:0.000,871.436,13.318;170:417.492,841.064,16.311;171:481.281,246.433,43.621;173:251.855,368.672,53.147;174:338.900,761.853,42.722;175:20.453,70.602,29.686;176:266.421,290.574,23.075;178:46.797,792.000,30.079;179:129.002,897.836,24.771;180:336.950,768.202,54.090;181:191.268,488.590,46.777;182:135.492,953.188,25.776;183:408.494,334.154,53.662;184:191.872,552.239,74.305;185:429.390,680.585,41.621;186:118.195,944.546,37.701;187:19.093,821.614,41.540;188:404.060,344.272,36.673;189:400.109,671.808,55.000;190:425.373,667.912,55.000;191:50.000,890.000,55.000;192:519.031,374.532,55.000;193:36.481,570.665,55.000;194:70.000,910.000,55.000;195:280.035,624.876,55.000;196:401.858,525.858,55.000;197:424.699,652.329,55.000";
  const GOLDEN_B_RNG = -689593409;

  it("defaultGenome, 600틱 — 지문과 rng 상태가 기준선 그대로다", () => {
    const w = runPlain("golden-1", defaultGenome(), 600);
    expect(snapshot(w)).toBe(GOLDEN_A_SNAP);
    expect(w.rng.getState()).toBe(GOLDEN_A_RNG);
  });

  it("herding 92, 600틱 — 지문과 rng 상태가 기준선 그대로다", () => {
    const w = runPlain("golden-1", HERD92(), 600);
    expect(snapshot(w)).toBe(GOLDEN_B_SNAP);
    expect(w.rng.getState()).toBe(GOLDEN_B_RNG);
  });

  it("알파를 지정만 한 세계도 같은 기준선 지문을 낸다 (I2 를 절대값으로 재확인)", () => {
    const a = runArmed("golden-1", defaultGenome(), 600);
    expect(snapshot(a)).toBe(GOLDEN_A_SNAP);
    expect(a.rng.getState()).toBe(GOLDEN_A_RNG);
    const b = runArmed("golden-1", HERD92(), 600);
    expect(snapshot(b)).toBe(GOLDEN_B_SNAP);
    expect(b.rng.getState()).toBe(GOLDEN_B_RNG);
  });
});

// ---------------------------------------------------------------------------
// 20. 보스 규칙 — 수풀 주차 우회 봉인
// ---------------------------------------------------------------------------
interface Vec {
  x: number;
  y: number;
}

/** 층위 규칙은 게놈·좌표·소속만 본다(boss.test.ts 의 같은 헬퍼에 "내 종인가"를 더한 것). */
function at(genome: Genome, p: Vec, isPlayer: boolean): Entity {
  return { genome, x: p.x, y: p.y, species: { isPlayer } } as unknown as Entity;
}

describe("보스 — 한 번이라도 몬 세계에선 수풀이 내 종을 숨겨 주지 않는다", () => {
  it("지정만으로는 봉인이 안 걸리고, 한 번 몰면 걸리고, 손을 떼도 안 풀린다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    const grass = w.terrain.grassSpots(1)[0];
    expect(grass).toBeDefined();
    if (!grass) return;
    expect(w.terrain.isGrass(grass.x, grass.y)).toBe(true);
    const raptor = createBoss("raptor", W, H, w.terrain); // grassCover 보스

    // ① 조종 OFF(기존 모드) — 내 종도 수풀에 숨는다. 예전과 문자 그대로 같다.
    expect(w.lead.leaderId).toBe(-1);
    expect(bossCanHunt(raptor, at(defaultGenome(), grass, true), w)).toBe(false);

    // ② 알파를 **지정만** 한 상태 — 아직 아무도 안 몰았으니 규칙도 예전 그대로다.
    //    (여기서 봉인이 걸리면 "지정만 하면 기존과 부동소수점까지 동일"이 통째로 깨진다.)
    w.armLead();
    expect(w.lead.leaderId).toBeGreaterThanOrEqual(0);
    expect(w.lead.commanded).toBe(false);
    expect(bossCanHunt(raptor, at(defaultGenome(), grass, true), w)).toBe(false);

    // ③ 한 번이라도 몰면 — 수풀은 형질 없이 밟는 공짜 지형이라, 무리를 세워 두면 시야 카운터가
    //    통째로 무효화된다. 그래서 몬 세계에서는 내 종에게 엄폐가 안 통한다.
    w.lead.cmd = RIGHT;
    w.step();
    expect(w.lead.commanded).toBe(true);
    expect(bossCanHunt(raptor, at(defaultGenome(), grass, true), w)).toBe(true);

    // ④ 손을 떼도 봉인은 안 풀린다 — "무리를 수풀에 몰아넣고 손 떼기" 우회 차단.
    w.lead.cmd = null;
    for (let i = 0; i < LEAD.followHoldTicks + 2; i++) w.step();
    expect(w.lead.followTicks).toBe(0);
    expect(w.lead.commanded).toBe(true);
    expect(bossCanHunt(raptor, at(defaultGenome(), grass, true), w)).toBe(true);

    // ⑤ 야생은 규칙이 그대로다(사람이 안 모는 종까지 벌줄 이유가 없다).
    expect(bossCanHunt(raptor, at(defaultGenome(), grass, false), w)).toBe(false);
  });

  it("수풀이 아닌 자리·grassCover 아닌 보스에는 조종이 아무 영향이 없다", () => {
    const w = new World("env-1", W, H, defaultGenome());
    let land: Vec = { x: W * 0.5, y: H * 0.5 };
    for (let i = 0; i < w.terrain.tiles.length; i++) {
      if (w.terrain.tiles[i] === TILE.land) {
        land = { x: w.terrain.tileCenterX(i), y: w.terrain.tileCenterY(i) };
        break;
      }
    }
    const raptor = createBoss("raptor", W, H, w.terrain);
    const chaser = createBoss("chaser", W, H, w.terrain); // grassCover 없음
    const probe = (): boolean[] => [
      bossCanHunt(raptor, at(defaultGenome(), land, true), w),
      bossCanHunt(chaser, at(defaultGenome(), land, true), w),
    ];
    const before = probe();
    w.armLead();
    expect(probe()).toEqual(before);
    // 실제로 몰아도(commanded) 수풀 밖·엄폐 없는 보스에는 아무 변화가 없다.
    w.lead.cmd = RIGHT;
    w.step();
    expect(w.lead.commanded).toBe(true);
    expect(probe()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 21~30. 사람이 시킨 물기
//
// 이 모드의 약속은 하나다: **알파는 능력을 새로 얻지 않는다. 이미 있는 능력을 사람이 대신 결정할
// 뿐이다.** 그래서 아래 테스트의 절반은 "된다"가 아니라 **"권능이 안 붙었다"** 를 증명한다 —
// 사거리 밖은 못 물고, 이빨이 안 박히는 상대는 못 물고, 사냥하는 식성이 아니면 아무도 못 물고,
// 쿨다운은 AI 사냥과 같은 값이다. 여기가 빨간불이면 형질이 장식이 된 것이다.
// ---------------------------------------------------------------------------

/** 물기만 누른 명령 — main 이 이동 입력 없이 물기만 눌렸을 때 보내는 것과 같은 모양(제자리 물기). */
const BITE: LeadCommand = { dx: 0, dy: 0, throttle: 0, bite: true };

/** 사냥하는 식성 + 보통 이빨. 웬만한 상대에겐 이빨이 박힌다. */
const HUNTER: Partial<Traits> = { diet: 90, attack: 60 };
/** 사냥하는 식성이지만 이빨이 약한 쪽 — 물어도 잘 안 죽는다(여러 번 물기를 관찰하려고). */
const HUNTER_WEAK: Partial<Traits> = { diet: 90, attack: 40 };
/** 물면 그냥 죽는 약한 상대. */
const SOFT: Partial<Traits> = { attack: 20, size: 40, diet: 5 };
/**
 * 물리긴 하는데 한 입에 안 죽는 상대. HUNTER_WEAK(공격 40) 기준 유효 체급 차 -0.30 →
 * 즉사 확률이 정확히 0 이고(clamp) 피해만 들어간다 → 여러 틱을 관찰해도 표적이 안 사라진다.
 */
const TOUGH: Partial<Traits> = { attack: 70, size: 50, diet: 5 };
/** 이빨이 아예 안 박히는 상대(체급 압도). HUNTER 기준 유효 체급 차 -0.98 → biteOutcome.ignored. */
const TANK: Partial<Traits> = { attack: 95, size: 95, diet: 5 };

interface Mark {
  /** 개체 id 를 직접 준다 — 동률 처리(작은 id)를 "만든 순서"와 갈라 놓고 재려면 필요하다. */
  id: number;
  dx: number;
  dy: number;
  traits: Partial<Traits>;
}

interface BiteLab {
  w: World;
  alpha: Entity;
  /** 세운 순서대로의 표적들(= w.entities 에 들어간 순서). */
  targets: Entity[];
}

/**
 * 물기 실험대 — 알파 한 마리와 내가 세운 표적만 남긴 세계.
 *
 * 알파 게놈에 **시야·초음파 0** 을 강제한다. 알파의 **자율 사냥**을 끄기 위해서다: 코앞의 표적을
 * AI 가 먼저 물어 버리면 "사람이 시킨 물기"만 따로 잴 수가 없다(대조군의 0 이 증거가 못 된다).
 * 물기 판정 자체는 감각을 안 보므로(사거리 안 = 코앞이다) 실험이 왜곡되지 않는다 — 아래 대조군
 * 테스트가 "명령이 없으면 0 건"으로 그 사실을 매번 다시 확인한다.
 */
function biteLab(alphaOver: Partial<Traits>, marks: readonly Mark[]): BiteLab {
  const w = new World("bite-1", W, H, tune({ vision: 0, echo: 0, ...alphaOver }));
  w.armLead();
  const alpha = w.entities.find((e) => e.id === w.lead.leaderId);
  if (!alpha) throw new Error("알파가 지정되지 않았다");
  w.entities = [alpha]; // 알파만 남긴다 — 다른 개체가 끼면 "누가 물었나"가 흐려진다
  const wild = w.species.find((s) => !s.isPlayer && !areFriends(alpha.species, s));
  if (!wild) throw new Error("표적으로 쓸 야생종이 없다");
  const targets = marks.map((m) =>
    createEntity(m.id, alpha.x + m.dx, alpha.y + m.dy, wild, 100, tune(m.traits)),
  );
  for (const t of targets) w.entities.push(t);
  w.grid.rebuild(w.entities); // leadBiteTarget 을 step 없이 바로 물어볼 수 있게
  return { w, alpha, targets };
}

/**
 * 알파와 표적을 **제자리에 고정한 채** cmd 로 ticks 틱 돌리고, 그동안 실제로 성사된 물기 수를 센다.
 * 위치를 매 틱 되돌리는 이유: 배회·도망으로 몇 px 씩 흘러가면 "사거리 안/밖"이 실험 도중 뒤집힌다.
 * 세는 방법은 sim 이 실제로 낸 연출 사건이다 — 물기가 박히면 "bite", 잡아먹으면 "kill" 이 뜬다.
 */
function holdAndStep(lab: BiteLab, cmd: LeadCommand | null, ticks: number): number {
  const ax = lab.alpha.x;
  const ay = lab.alpha.y;
  const spots = lab.targets.map((t) => ({ t, x: t.x, y: t.y }));
  let bites = 0;
  for (let i = 0; i < ticks; i++) {
    lab.alpha.x = ax;
    lab.alpha.y = ay;
    lab.alpha.vx = 0;
    lab.alpha.vy = 0;
    for (const s of spots) {
      s.t.x = s.x;
      s.t.y = s.y;
      s.t.vx = 0;
      s.t.vy = 0;
    }
    lab.w.events.length = 0; // 이번 틱의 사건만 세려고 비운다(렌더가 매 프레임 하는 것과 같다)
    lab.w.lead.cmd = cmd;
    lab.w.step();
    for (const ev of lab.w.events) if (ev.kind === "bite" || ev.kind === "kill") bites += 1;
  }
  return bites;
}

/** 이 게놈의 사냥 사정거리(px) — AI 사냥이 쓰는 바로 그 값. */
function rangeOf(over: Partial<Traits>): number {
  return attackRangeOf(tune(over).traits);
}

describe("사람이 시킨 물기 — 무입력 동일성", () => {
  it("이동 명령에 bite:false 를 달아도 세계가 1비트도 안 바뀐다 (600틱)", () => {
    // 같은 각본을 두 번 돌린다. 한 번은 **bite 필드가 아예 없는** 명령(기존 호출부·테스트와 같은
    // 모양), 한 번은 bite:false 를 명시한 명령. 물기 코드가 한 줄이라도 돌면 rng 가 밀려 어긋난다.
    const drive = (explicit: boolean): World => {
      const w = new World("golden-1", W, H, HERD92());
      for (let i = 0; i < 600; i++) {
        w.armLead();
        const c = steerTo(w, W * 0.5, H * 0.5);
        w.lead.cmd = c === null ? null : explicit ? { ...c, bite: false } : c;
        w.step();
      }
      return w;
    };
    const plain = drive(false);
    const explicit = drive(true);
    expect(snapshot(explicit)).toEqual(snapshot(plain));
    expect(explicit.rng.getState()).toBe(plain.rng.getState());
  });

  it("물기를 한 번도 안 누른 실험대는 아무도 안 문다 (대조군 — 아래 0 들이 증거가 되게)", () => {
    // 이게 없으면 "0 건"은 "명령이 안 통했다"와 구분되지 않는다. 여기서 0 이고 다음 테스트에서
    // 같은 배치에 물기만 눌러 >0 이 나와야 비로소 명령이 원인이라고 말할 수 있다.
    const lab = biteLab(HUNTER, [{ id: 5000, dx: rangeOf(HUNTER) * 0.5, dy: 0, traits: SOFT }]);
    expect(holdAndStep(lab, null, 12)).toBe(0);
    expect(lab.targets[0]?.alive).toBe(true);
  });
});

describe("사람이 시킨 물기 — 권능이 없다", () => {
  it("사거리 안이면 물리고, 사거리 밖이면 못 문다 (사거리는 AI 사냥과 같은 값)", () => {
    const r = rangeOf(HUNTER);
    const near = biteLab(HUNTER, [{ id: 5000, dx: r * 0.5, dy: 0, traits: SOFT }]);
    expect(holdAndStep(near, BITE, 12)).toBeGreaterThan(0);

    const far = biteLab(HUNTER, [{ id: 5000, dx: r * 3, dy: 0, traits: SOFT }]);
    expect(holdAndStep(far, BITE, 12)).toBe(0);
    expect(far.targets[0]?.alive).toBe(true);
    expect(far.targets[0]?.woundTicks).toBe(0);
    expect(far.w.lead.biteTargetId).toBe(-1); // 화면도 "지금은 못 문다"고 말한다
  });

  it("이빨이 안 박히는 상대(체급 압도)는 물어도 아무 일이 안 일어난다", () => {
    const lab = biteLab(HUNTER, [{ id: 5000, dx: 4, dy: 0, traits: TANK }]);
    const tank = lab.targets[0];
    expect(tank).toBeDefined();
    if (!tank) return;
    // 실험 전제 — 규칙이 실제로 "못 문다"라고 말하고 있다(안 그러면 아래 0 은 공허하다).
    const rel = leadRelation(lab.alpha, tank);
    expect(rel.prey).toBe(false); // 먹잇감(물리는 것)이 아니다
    expect(rel.tough).toBe(true); // 다만 **노릴 수는 있다** — 물어 보고 튕겨야 이유를 배운다

    expect(holdAndStep(lab, BITE, 30)).toBe(0); // 피해 0
    expect(tank.alive).toBe(true);
    expect(tank.woundTicks).toBe(0);
    // 겨눌 수는 있다(버튼이 켜진다). 못 무는 상대를 화면에서 통째로 감추면 "왜 안 되는지"를
    // 배울 길이 없다 — 노려서 튕기는 것이 이 게임이 체급을 가르치는 방식이다.
    expect(lab.w.lead.biteTargetId).toBe(5000);
    // 튕겼어도 쿨다운은 돈다 — 안 통하는 상대에게 달려든 대가는 있어야 한다.
    expect(lab.alpha.attackCd).toBeGreaterThan(0);
  });

  it("사냥하는 식성이 아니면(초식) 이빨이 세도 아무도 못 문다", () => {
    // 공격력 90 · 몸집 90 짜리 초식 — 힘은 넘치는데 **식성**이 사냥이 아니다. 같은 몸으로 식성만
    // 바꾸면(대조군) 곧바로 물린다 → 못 무는 이유가 힘이 아니라 형질(식성)임이 드러난다.
    const body: Partial<Traits> = { attack: 90, size: 90 };
    const grazer = biteLab({ ...body, diet: 10 }, [{ id: 5000, dx: 4, dy: 0, traits: SOFT }]);
    const gt = grazer.targets[0];
    expect(gt).toBeDefined();
    if (!gt) return;
    expect(leadRelation(grazer.alpha, gt).prey).toBe(false);
    expect(holdAndStep(grazer, BITE, 30)).toBe(0);
    expect(gt.alive).toBe(true);
    expect(grazer.w.lead.biteTargetId).toBe(-1);

    const carn = biteLab({ ...body, diet: 90 }, [{ id: 5000, dx: 4, dy: 0, traits: SOFT }]);
    expect(holdAndStep(carn, BITE, 30)).toBeGreaterThan(0);
  });

  it("쿨다운은 AI 사냥과 같다 — 계속 누르고 있어도 attackCooldownTicks 마다 한 번만 나간다", () => {
    // 즉사 확률이 정확히 0 인 조합이라 표적이 안 사라지고, 물기 횟수만 깨끗이 남는다.
    const lab = biteLab(HUNTER_WEAK, [{ id: 5000, dx: 4, dy: 0, traits: TOUGH }]);
    const ticks = 10;
    const n = holdAndStep(lab, BITE, ticks);
    expect(n).toBe(Math.ceil(ticks / SIM.attackCooldownTicks)); // 3틱 간격 → 10틱에 4번
    const t = lab.targets[0];
    expect(t?.alive).toBe(true); // 즉사 확률 0 — "확실히 죽인다" 같은 알파 보정이 없다
    expect(t?.woundTicks).toBeGreaterThan(0); // 그래도 물리긴 했다(피해는 들어간다)
  });

  it("명령은 알파 한 마리만 쓴다 — 옆에 선 같은 종은 물지 않는다", () => {
    // world.lead.cmd 는 세계에 하나뿐이다. 게이트가 leaderId 가 아니면 내 종 전부가 동시에 문다.
    const lab = biteLab(HUNTER_WEAK, [
      { id: 4000, dx: 4, dy: 0, traits: TOUGH }, // 알파 코앞
      { id: 5000, dx: 200, dy: 0, traits: TOUGH }, // 저 멀리 — 아래 동료의 코앞
    ]);
    const mate = createEntity(6000, lab.alpha.x + 204, lab.alpha.y, lab.alpha.species, 100);
    lab.w.entities.push(mate);
    holdAndStep(lab, BITE, 6);
    expect(lab.targets[0]?.woundTicks).toBeGreaterThan(0); // 알파는 물었다
    expect(lab.targets[1]?.woundTicks).toBe(0); // 동료는 안 물었다
    expect(lab.targets[1]?.alive).toBe(true);
  });
});

describe("사람이 시킨 물기 — 대상 선택(화면의 브래킷과 같은 규칙)", () => {
  it("사거리 안에서 가장 가까운 것을 고른다 (세운 순서와 무관)", () => {
    const pick = (nearFirst: boolean): number => {
      const near: Mark = { id: 5000, dx: 4, dy: 0, traits: TOUGH };
      const far: Mark = { id: 4000, dx: 9, dy: 0, traits: TOUGH };
      const lab = biteLab(HUNTER_WEAK, nearFirst ? [near, far] : [far, near]);
      return leadBiteTarget(lab.alpha, lab.w)?.id ?? -1;
    };
    expect(pick(true)).toBe(5000); // 가까운 쪽(5000)이 먼저 세워져도
    expect(pick(false)).toBe(5000); // 나중에 세워져도 답은 같다
  });

  it("거리가 같으면 작은 id 를 고른다 (rng 도, 배열 순서도 아니다)", () => {
    // 알파 좌우 같은 거리에 한 마리씩. **세운 순서를 뒤집어도** 늘 작은 id 가 뽑혀야 한다
    // (거리 비교만 하고 동률을 안 깨면 '먼저 세운 쪽'이 뽑혀 두 답이 갈린다).
    const pick = (bigFirst: boolean): number => {
      const big: Mark = { id: 5000, dx: 6, dy: 0, traits: TOUGH };
      const small: Mark = { id: 4000, dx: -6, dy: 0, traits: TOUGH };
      const lab = biteLab(HUNTER_WEAK, bigFirst ? [big, small] : [small, big]);
      // 실험 전제 — 두 거리가 실제로 완전히 같다(부동소수점까지).
      const a = lab.targets[0];
      const b = lab.targets[1];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a && b) {
        const d = (t: Entity): number => (t.x - lab.alpha.x) ** 2 + (t.y - lab.alpha.y) ** 2;
        expect(d(a)).toBe(d(b));
      }
      return leadBiteTarget(lab.alpha, lab.w)?.id ?? -1;
    };
    expect(pick(true)).toBe(4000);
    expect(pick(false)).toBe(4000);
  });

  it("leadRelation.prey 가 false 면 더 가까워도 안 고른다 (브래킷이 뜬 것만 물린다)", () => {
    // 코앞에 '못 무는' 상대(체급 압도), 그 뒤에 '물 수 있는' 상대. 거리만 보면 앞의 것이 뽑히지만
    // 화면에 브래킷이 뜨는 건 뒤의 것뿐이고, 물기도 뒤의 것에 나가야 화면이 거짓말을 안 한다.
    const lab = biteLab(HUNTER, [
      { id: 4000, dx: 3, dy: 0, traits: TANK },
      { id: 5000, dx: 9, dy: 0, traits: SOFT },
    ]);
    const tank = lab.targets[0];
    const soft = lab.targets[1];
    expect(tank).toBeDefined();
    expect(soft).toBeDefined();
    if (!tank || !soft) return;
    expect(leadRelation(lab.alpha, tank).prey).toBe(false);
    expect(leadRelation(lab.alpha, soft).prey).toBe(true);
    expect(leadBiteTarget(lab.alpha, lab.w)?.id).toBe(5000);
  });

  it("사거리 밖은 후보에 안 든다", () => {
    const r = rangeOf(HUNTER);
    const inside = biteLab(HUNTER, [{ id: 5000, dx: r * 0.9, dy: 0, traits: SOFT }]);
    expect(leadBiteTarget(inside.alpha, inside.w)?.id).toBe(5000);
    const outside = biteLab(HUNTER, [{ id: 5000, dx: r * 1.2, dy: 0, traits: SOFT }]);
    expect(leadBiteTarget(outside.alpha, outside.w)).toBeNull();
  });
});

describe("사람이 시킨 물기 — 화면과 실제가 같다 / 결정론", () => {
  it("버튼이 가리키는 개체(biteTargetId)가 실제로 물리는 개체다", () => {
    const lab = biteLab(HUNTER_WEAK, [
      { id: 4000, dx: 9, dy: 0, traits: TOUGH }, // 조금 먼 쪽
      { id: 5000, dx: 4, dy: 0, traits: TOUGH }, // 가까운 쪽 = 조준 대상
    ]);
    expect(holdAndStep(lab, BITE, 4)).toBeGreaterThan(0);
    expect(lab.w.lead.biteTargetId).toBe(5000); // 화면이 가리키던 것
    expect(lab.targets[1]?.woundTicks).toBeGreaterThan(0); // 실제로 물린 것
    expect(lab.targets[0]?.woundTicks).toBe(0); // 옆의 상대는 멀쩡하다
  });

  it("같은 시드·같은 명령 각본이면 두 세계가 완전히 같다", () => {
    const run = (): { snap: string; rng: number; bites: number } => {
      const lab = biteLab(HUNTER_WEAK, [
        { id: 4000, dx: 5, dy: 0, traits: TOUGH },
        { id: 5000, dx: -5, dy: 3, traits: TOUGH },
      ]);
      const bites = holdAndStep(lab, BITE, 40);
      return { snap: snapshot(lab.w), rng: lab.w.rng.getState(), bites };
    };
    const a = run();
    const b = run();
    expect(a.bites).toBeGreaterThan(0); // 함정이 실제로 놓였다(물기가 돌긴 했다)
    expect(b).toEqual(a);
  });

  it("먹잇감을 쫓으며 계속 무는 긴 각본도 두 세계가 같다 (실제 월드, 900틱)", () => {
    // 실험대가 아니라 **살아 있는 세계** 한복판에서 돌린다. 사람이 하듯 가장 가까운 '물 수 있는'
    // 상대로 몰아가며 물기를 계속 누르고 있는다 — 물기가 실제로 여러 번 성사되고, 그 결과가 번식·
    // 사망·야생 진화로 퍼져 나간 뒤에도 두 세계가 완전히 같아야 한다.
    const run = (): { snap: string; rng: number; armed: number; bites: number } => {
      const w = new World("golden-1", W, H, tune({ diet: 90, attack: 80, speed: 80, herding: 60 }));
      let armed = 0;
      let bites = 0;
      for (let i = 0; i < 900; i++) {
        w.armLead();
        const alpha = w.entities.find((e) => e.id === w.lead.leaderId);
        let gx = W * 0.5;
        let gy = H * 0.5;
        if (alpha) {
          let bestD2 = Infinity;
          for (const o of w.entities) {
            if (o === alpha || !leadRelation(alpha, o).prey) continue;
            const d2 = (o.x - alpha.x) ** 2 + (o.y - alpha.y) ** 2;
            if (d2 < bestD2) {
              bestD2 = d2;
              gx = o.x;
              gy = o.y;
            }
          }
        }
        const c = steerTo(w, gx, gy);
        w.lead.cmd = c === null ? null : { ...c, bite: true };
        w.events.length = 0; // 이번 틱의 사건만 세려고(렌더가 매 프레임 하는 것과 같다 — sim 은 안 읽는다)
        w.step();
        if (w.lead.biteTargetId >= 0) armed += 1;
        for (const ev of w.events) if (ev.kind === "bite" || ev.kind === "kill") bites += 1;
      }
      return { snap: snapshot(w), rng: w.rng.getState(), armed, bites };
    };
    const a = run();
    // 각본이 공허하지 않다 — 조준이 실제로 걸렸고 물기도 실제로 성사됐다.
    expect(a.armed).toBeGreaterThan(0);
    expect(a.bites).toBeGreaterThan(0);
    expect(run()).toEqual(a);
  });
});

describe("튕김(block) — 이빨이 안 박히면 화면이 그렇게 말한다", () => {
  it("체급이 크게 밀리는 상대를 물면 아무 피해도 없고 block 사건이 뜬다", () => {
    const g = defaultGenome();
    g.traits.diet = 80; // 사냥하는 식성
    g.traits.attack = 10; // 아주 약한 이빨
    g.traits.size = 30; // 작은 몸
    g.traits.vision = 0; // 감지 범위를 사정거리로 좁힌다 — 딴 먹잇감이 안 끼어들게(격리)
    g.traits.echo = 0;
    const w = new World("block-1", 540, 960, g);
    w.armLead();
    const me = w.entities.find((e) => e.id === w.lead.leaderId);
    expect(me).toBeDefined();
    if (!me) return;
    // 바로 옆에 "못 무는" 거구를 세운다 — 같은 종·친척이 아니어야 먹잇감 관계가 선다.
    const target = w.entities.find((e) => !e.species.isPlayer && !e.species.friendly);
    expect(target).toBeDefined();
    if (!target) return;
    target.genome = cloneGenome(target.genome);
    target.genome.traits.size = 100; // 코끼리 — 이빨이 아예 안 박힌다
    target.genome.traits.attack = 20;
    target.genome.traits.diet = 10; // 초식 거구. 사냥을 안 하므로 나를 먼저 잡아먹지 않는다
    target.energy = 999; // 굶어 죽지 않게(이 테스트는 물기 판정만 본다)
    target.x = me.x + 4;
    target.y = me.y;
    for (const o of w.entities) if (o !== target && o !== me && !o.species.isPlayer) { o.x = 5; o.y = 5; }
    const hpBefore = target.energy;

    const rel = leadRelation(me, target);
    expect(rel.tough).toBe(true); // 노릴 수는 있지만 이빨이 안 박히는 상대
    expect(rel.prey).toBe(false); // 먹잇감(물리는 것)은 아니다 — 둘은 배타적이다
    expect(biteOutcome(10, 20, 30, 100).ignored).toBe(true);

    w.lead.cmd = { dx: 1, dy: 0, throttle: 1, bite: true };
    w.events.length = 0;
    w.step();

    const blocked = w.events.filter((e) => e.kind === "block");
    expect(blocked.length).toBeGreaterThan(0); // 튕김이 화면에 나간다
    // 물기가 **먹힌** 적은 없다(bite 사건은 이빨이 박혔을 때만 뜬다). 기운이 조금 준 것은 제 대사다.
    expect(w.events.filter((e) => e.kind === "bite").length).toBe(0);
    expect(hpBefore - target.energy).toBeLessThan(1); // 물려서 깎인 게 아니다(물기 피해는 이보다 훨씬 크다)
    expect(target.alive).toBe(true);
  });

  it("잘 박히는 상대에는 튕김이 안 뜬다 (대조군 — 항상 뜨는 게 아니다)", () => {
    const g = defaultGenome();
    g.traits.diet = 80;
    g.traits.attack = 95; // 강한 이빨
    g.traits.size = 80;
    g.traits.vision = 0;
    g.traits.echo = 0;
    const w = new World("block-2", 540, 960, g);
    w.armLead();
    const me = w.entities.find((e) => e.id === w.lead.leaderId);
    const target = w.entities.find((e) => !e.species.isPlayer && !e.species.friendly);
    if (!me || !target) throw new Error("설정 실패");
    target.genome = cloneGenome(target.genome);
    target.genome.traits.size = 20;
    target.genome.traits.attack = 10;
    target.x = me.x + 4;
    target.y = me.y;
    for (const o of w.entities) if (o !== target && o !== me && !o.species.isPlayer) { o.x = 5; o.y = 5; }

    w.lead.cmd = { dx: 1, dy: 0, throttle: 1, bite: true };
    w.events.length = 0;
    w.step();
    expect(w.events.filter((e) => e.kind === "block").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 31~. 지정 사냥(탭 명령) — targetId 는 "그 놈" 잠금이지 권능이 아니다
//
// 계약 세 줄: ① 지정하면 더 가까운 다른 먹잇감이 있어도 그 개체만 겨눈다. ② 지정이 무효
// (죽음·범위 밖)면 자동으로 딴 놈을 무는 게 아니라 아무도 안 겨눈다. ③ targetId 가 없으면
// 기존 자동 선택(E 키 경로)이 문자 그대로 남는다.
// ---------------------------------------------------------------------------

/** 지정 사냥 명령 — 이동 없이 targetId 만 잠근 모양(잠금 효과만 따로 잰다). */
function biteAt(targetId: number): LeadCommand {
  return { dx: 0, dy: 0, throttle: 0, bite: true, targetId };
}

describe("지정 사냥 — 누구를 물지 사람이 정한다", () => {
  it("더 가까운 먹잇감이 있어도 지정한 개체를 겨누고 문다", () => {
    const lab = biteLab(HUNTER_WEAK, [
      { id: 4000, dx: 4, dy: 0, traits: TOUGH }, // 더 가깝다 — 자동 선택이면 이쪽이 물린다
      { id: 5000, dx: 9, dy: 0, traits: TOUGH }, // 지정 대상
    ]);
    expect(holdAndStep(lab, biteAt(5000), 6)).toBeGreaterThan(0);
    expect(lab.w.lead.biteTargetId).toBe(5000); // 화면의 잠금 표시 = 실제 물리는 개체
    expect(lab.targets[1]?.woundTicks).toBeGreaterThan(0); // 지정한 쪽이 물렸다
    expect(lab.targets[0]?.woundTicks).toBe(0); // 더 가까운 쪽은 멀쩡하다
  });

  it("targetId 없는 bite:true 는 기존 자동 선택 그대로다 (가장 가까운 쪽)", () => {
    // 위 테스트와 같은 배치에서 지정만 뺀 대조군 — 지정 분기가 자동 경로를 오염시키지 않았다는 증거.
    const lab = biteLab(HUNTER_WEAK, [
      { id: 4000, dx: 4, dy: 0, traits: TOUGH },
      { id: 5000, dx: 9, dy: 0, traits: TOUGH },
    ]);
    expect(holdAndStep(lab, BITE, 6)).toBeGreaterThan(0);
    expect(lab.w.lead.biteTargetId).toBe(4000);
    expect(lab.targets[0]?.woundTicks).toBeGreaterThan(0);
    expect(lab.targets[1]?.woundTicks).toBe(0);
  });

  it("지정한 개체가 죽으면 자동 대체 없이 -1 이다 (옆 놈을 물지 않는다)", () => {
    const lab = biteLab(HUNTER_WEAK, [
      { id: 4000, dx: 4, dy: 0, traits: TOUGH }, // 코앞의 대체 후보 — 물리면 잠금이 샌 것이다
      { id: 5000, dx: 9, dy: 0, traits: TOUGH },
    ]);
    const mark = lab.targets[1];
    expect(mark).toBeDefined();
    if (!mark) return;
    mark.alive = false; // 잠근 대상이 방금 쓰러졌다
    expect(holdAndStep(lab, biteAt(5000), 6)).toBe(0); // 물기 자체가 안 나간다
    expect(lab.w.lead.biteTargetId).toBe(-1);
    expect(lab.targets[0]?.woundTicks).toBe(0);
    expect(lab.targets[0]?.alive).toBe(true);
  });

  it("지정한 개체가 겨눔 범위 밖이면 -1 이다 (자동 대체 안 함)", () => {
    const r = rangeOf(HUNTER_WEAK); // 실험대는 시야·초음파 0 → 겨눔 반경 = 사정거리
    const lab = biteLab(HUNTER_WEAK, [
      { id: 4000, dx: 4, dy: 0, traits: TOUGH },
      { id: 5000, dx: r * 3, dy: 0, traits: TOUGH }, // 지정 대상은 저 멀리
    ]);
    expect(holdAndStep(lab, biteAt(5000), 6)).toBe(0);
    expect(lab.w.lead.biteTargetId).toBe(-1);
    expect(lab.targets[0]?.woundTicks).toBe(0);
  });

  it("bite:true 만으로도 무리 추종이 재충전되고 commanded 가 켜진다", () => {
    // 사냥 명령 중에도 사람이 개입 중이다 — throttle 만 보면 이동 없이 잠금 사냥만 하는 동안
    // 추종이 1.5초 만에 끊긴다(그 구멍을 world.syncLeadStart 가 봉합했다는 감지기).
    const w = new World("golden-1", W, H, HERD92());
    w.armLead();
    expect(w.lead.followTicks).toBe(0);
    expect(w.lead.commanded).toBe(false);
    w.lead.cmd = BITE; // throttle 0 — 이동 없이 사냥 명령만
    w.step();
    expect(w.lead.followTicks).toBe(LEAD.followHoldTicks);
    expect(w.lead.commanded).toBe(true);
  });

  it("leadTargetRange 가 겨눔 반경의 단일 진실이다 — 바로 안은 겨눠지고 바로 밖은 안 겨눠진다", () => {
    // 같은 시드·같은 게놈이면 실험대 세계는 완전히 같다 — 첫 실험대에서 반경을 재고,
    // 나머지 두 실험대에 그 반경 바로 안/밖으로 표적을 세운다(렌더가 흐림 경계를 그릴 바로 그 값).
    const over: Partial<Traits> = { ...HUNTER, vision: 60 };
    const probe = biteLab(over, []);
    const r = leadTargetRange(probe.alpha, probe.w);
    expect(r).toBeGreaterThan(rangeOf(HUNTER)); // 시야가 겨눔 반경을 실제로 넓혔다(전제)
    const inside = biteLab(over, [{ id: 5000, dx: r * 0.95, dy: 0, traits: SOFT }]);
    expect(leadBiteTarget(inside.alpha, inside.w)?.id).toBe(5000);
    const outside = biteLab(over, [{ id: 5000, dx: r * 1.05, dy: 0, traits: SOFT }]);
    expect(leadBiteTarget(outside.alpha, outside.w)).toBeNull();
  });

  it("지정 사냥 통합 — 몰아가며 잠근 그 개체만 물어 쓰러뜨린다 (추격 포함)", () => {
    // 위치를 고정하지 않고 굴린다: 지정 표적은 제 규칙대로 움직이고(도망 포함), 각본은 표적 쪽으로
    // 몰며 사냥 명령을 유지한다. 죽는 데까지 가야 잠금이 실전에서 성립한다는 증거고, 겨눔이 잡힌
    // 모든 틱에 지정 id 였는지도 함께 못 박는다(잠금 불변식 — 한 틱이라도 딴 놈이면 실패).
    const lab = biteLab({ ...HUNTER, speed: 85 }, [
      { id: 4000, dx: 6, dy: 0, traits: TOUGH }, // 경로에 낀 미끼 — 잠금이 새면 얘가 물린다
      { id: 5000, dx: 48, dy: 0, traits: SOFT }, // 지정 표적(멀리) — 추격해야 닿는다
    ]);
    const decoy = lab.targets[0];
    const mark = lab.targets[1];
    expect(decoy).toBeDefined();
    expect(mark).toBeDefined();
    if (!decoy || !mark) return;
    let bites = 0;
    let mislock = 0;
    for (let i = 0; i < 900 && mark.alive; i++) {
      const c = steerTo(lab.w, mark.x, mark.y);
      lab.w.lead.cmd = c === null ? null : { ...c, bite: true, targetId: 5000 };
      lab.w.events.length = 0;
      lab.w.step();
      if (lab.w.lead.biteTargetId >= 0 && lab.w.lead.biteTargetId !== 5000) mislock += 1;
      for (const ev of lab.w.events) if (ev.kind === "bite" || ev.kind === "kill") bites += 1;
    }
    expect(mark.alive).toBe(false); // 잡았다
    expect(bites).toBeGreaterThan(0); // 물어서다 — 이 세계의 사냥꾼은 알파뿐이라 사건 출처가 하나다
    expect(mislock).toBe(0); // 잠금이 한 번도 새지 않았다
    expect(decoy.alive).toBe(true); // 미끼는 안 물렸다
    expect(decoy.woundTicks).toBe(0);
  });
});
