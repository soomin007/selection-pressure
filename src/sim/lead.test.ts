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
import { attackRangeOf, biteOutcome, leadBiteTarget, leadRelation } from "@/sim/behavior";
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
  const GOLDEN_A_SNAP = "t600|p74|4:339.921,721.876,71.499;5:173.636,359.992,3.939;10:349.003,348.113,61.885;24:169.267,438.307,3.335;37:408.750,360.640,21.930;44:540.000,534.717,21.077;46:540.000,534.027,41.066;47:529.859,498.054,136.751;48:434.812,247.052,10.954;50:397.659,329.172,55.370;52:160.550,582.128,2.452;54:540.000,620.003,17.020;55:500.033,663.805,50.020;57:353.675,867.654,48.045;58:229.241,561.873,70.357;61:160.016,960.000,62.252;63:452.868,854.010,32.349;64:257.630,960.000,89.147;66:415.204,922.783,16.568;80:306.619,852.518,50.919;83:244.056,943.632,37.833;95:124.451,931.628,5.734;97:147.017,926.672,72.043;112:218.573,523.507,5.668;126:39.872,586.447,28.223;127:367.634,300.361,17.199;130:399.643,774.967,13.255;131:147.537,927.004,68.886;134:529.512,498.271,55.780;135:262.912,735.531,24.773;136:0.068,556.006,75.399;139:341.014,723.314,61.973;142:370.239,796.601,68.230;143:475.879,618.475,95.536;145:147.207,927.147,9.363;146:413.632,268.642,107.185;147:14.306,292.728,36.522;149:160.770,590.242,27.286;150:36.691,811.884,99.249;151:137.585,661.521,51.385;154:529.077,498.628,38.281;155:96.727,533.572,26.335;157:11.065,783.407,99.249;158:60.351,857.737,46.443;160:80.004,908.346,54.230;164:411.602,269.731,7.306;165:166.282,552.851,15.338;166:191.760,592.536,16.032;168:529.885,498.022,29.602;169:410.612,280.618,9.712;171:85.870,901.663,32.655;172:349.308,879.967,81.045;173:353.594,284.155,16.976;175:527.375,500.106,38.774;176:350.534,348.670,53.631;177:174.105,575.289,97.042;178:68.550,892.427,12.822;179:129.222,916.498,49.047;180:322.547,920.636,17.708;181:339.892,340.745,88.637;182:112.750,311.943,69.522;183:243.334,914.933,37.833;184:363.584,799.199,40.867;185:198.134,563.943,37.357;186:525.667,500.793,55.625;187:418.281,833.750,55.000;188:204.261,703.882,55.000;189:470.000,30.000,55.000;190:26.553,301.666,55.000;191:354.218,441.871,55.000;192:148.658,850.876,55.000;193:454.936,157.411,55.000;194:410.000,930.000,55.000;195:33.109,647.786,55.000";
  const GOLDEN_A_RNG = 1013503331;
  const GOLDEN_B_SNAP = "t600|p109|0:253.622,264.824,51.002;4:341.870,343.632,86.130;6:179.987,359.993,5.753;8:347.156,344.554,27.560;10:68.625,183.055,98.050;11:298.933,444.518,16.925;14:347.157,344.550,15.768;15:269.566,300.996,26.147;16:65.780,182.859,64.033;19:454.672,701.605,15.523;21:360.588,696.399,46.611;28:505.826,684.206,28.081;44:523.607,376.071,45.447;45:443.599,304.807,91.040;47:440.221,873.307,90.266;48:159.986,779.635,108.315;50:243.907,83.912,44.802;51:357.620,266.321,94.808;54:536.408,660.770,50.020;55:506.065,640.006,17.020;57:340.038,879.515,31.115;58:226.112,540.740,98.462;62:517.228,839.946,34.029;66:154.924,904.457,65.238;83:140.071,886.795,7.064;89:506.129,822.501,55.061;92:14.499,775.701,44.449;93:14.538,775.564,49.044;94:15.256,774.837,10.850;95:15.256,774.835,19.564;96:15.179,775.373,16.037;97:15.256,774.828,19.625;98:15.256,774.826,19.593;99:15.256,774.823,19.593;100:15.256,774.820,52.593;101:15.256,774.817,27.623;103:16.971,116.551,32.202;104:63.056,318.470,38.494;111:497.042,609.992,61.949;113:325.048,254.873,9.574;114:16.652,698.992,96.066;115:305.209,263.108,11.327;120:491.683,518.122,40.471;123:320.631,258.462,43.094;125:238.158,539.997,22.607;126:162.124,515.752,2.997;127:178.234,955.874,54.794;128:170.480,743.475,97.042;129:15.256,774.814,18.205;134:244.428,543.329,11.302;136:379.904,860.367,32.606;137:213.938,935.273,107.318;138:369.581,753.698,48.655;140:420.158,598.007,88.945;141:76.844,477.311,65.666;142:342.538,960.000,48.453;145:171.311,561.035,24.225;147:327.517,253.972,32.414;148:319.222,286.487,29.574;149:100.021,350.729,27.018;150:359.262,672.052,29.889;152:162.016,515.748,29.934;153:368.828,900.000,29.138;154:203.322,546.688,33.201;155:44.598,76.652,19.662;156:104.768,872.724,58.161;157:215.423,938.856,6.085;158:320.712,257.932,28.927;159:221.625,65.528,77.564;160:44.460,79.642,47.752;161:326.462,254.363,36.577;162:80.068,329.008,27.020;163:15.256,774.810,37.874;164:168.311,571.109,24.225;165:309.793,680.801,29.889;166:168.951,747.443,96.924;167:179.860,606.897,32.674;168:259.920,290.588,47.864;169:15.301,825.820,21.440;170:376.301,745.663,67.563;171:44.123,70.012,19.695;172:44.042,80.205,25.770;173:96.857,904.064,88.084;174:3.534,133.859,32.961;175:340.002,864.005,33.201;176:70.345,619.480,86.151;177:169.804,744.466,40.481;178:15.255,774.918,38.023;179:331.425,953.894,48.534;180:15.271,776.061,44.417;181:325.518,255.090,36.581;182:86.790,477.864,36.903;183:501.001,524.664,40.471;184:45.415,72.985,47.752;185:253.581,286.739,47.874;186:371.313,753.275,48.655;187:18.701,782.213,49.012;188:459.783,740.607,55.000;189:90.030,485.929,55.000;190:10.000,750.000,55.000;191:408.173,653.260,55.000;192:504.339,307.260,55.000;193:26.220,72.818,55.000;194:465.074,716.223,55.000;195:423.487,572.132,55.000;196:458.781,618.425,55.000;197:339.952,439.615,55.000;198:417.591,528.118,55.000;199:310.895,38.095,55.000";
  const GOLDEN_B_RNG = -1247167464;

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
