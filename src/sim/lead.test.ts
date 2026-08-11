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
import { cloneGenome, genomeFromTraits, type Genome, type Traits } from "@/sim/genome";
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

/**
 * 능치를 직접 정한 종 — **야생과 같은 길**(`genomeFromTraits`)로 만든다.
 *
 * v8 에서 플레이어 종의 능치는 도장에서 파생되지만, 이 파일이 재는 것은 **조종 규칙**(격리·결정론·
 * 권능 없음)이지 성장 규칙이 아니다. `genomeFromTraits` 는 v8 이 새로 만든 축(방어·유지비·풀/사냥
 * 효율·육식성)을 v7 이 그 자리에서 쓰던 공식으로 채우므로, 여기 세계가 v7 과 같은 축 위에 선다.
 */
function tune(over: Partial<Traits>): Genome {
  return genomeFromTraits(over);
}

/** 능치를 하나도 안 건드린 기준선 종(= v7 의 기본 게놈과 같은 능치). */
const BASE = (): Genome => tune({});

/** 무리 빌드. 기준선 종의 herding 은 0 이라, 이 게놈이 없으면 cohesion 블록에 발도 못 딛는다. */
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

  it("명령이 없으면 1비트도 안 바뀐다 (기준선 게놈, 600틱)", () => {
    expectIdentical("golden-1", BASE, null);
  });

  it("명령이 없으면 1비트도 안 바뀐다 (herding 92 게놈, 600틱)", () => {
    // ★ 핵심 감지기. 기준선 게놈의 herding 은 0 이라 1번 테스트만으로는 cohesion 블록을
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
    const hidden = expectIdenticalUnderBoss("raptor", "env-1", BASE);
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
    const w = new World("env-1", W, H, BASE()); // 수영 50 < 65 → 비수영
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

    const none = script(BASE()); // herding 0
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
  // (재기준선 이력) 2026-08-12 **몸싸움의 리듬(치고 빠지기)** 도입으로 재캡처 · **[사용자 2026-08-11]**
  //   승인("공격이 실패하면 물러나서 간을 보기도 하고"). 근접 사냥이 「간 보기(standoff) → 파고들기
  //   (대시)」 주기를 돌고, 물린 쪽은 몸부림 임펄스를 받는다(behavior.ts) — 온 세계의 근접 사냥
  //   움직임이 바뀌므로 골든이 바뀌는 것이 정상이다(순수 기하 · rng 소비 불변).
  // (재기준선 이력) 2026-08-11 **TTK 재조정 + 행동 양식 분화**로 재캡처. 세계를 실제로 바꾼 것:
  //   ① 전투 상수(attackCooldown 10→18 · killChanceBias 0.08→0.03 · Scale 0.5→0.3 · biteDamage
  //      25→10) — 1배속 TTK 약 2.5~3초 목표 · **[사용자 2026-08-11]** · 값은 실측 스윕으로(params.ts).
  //   ② 사냥의 3막(잠행 0.62배 → 돌진·히스테리시스) · 위험 기억(잡아먹힌 자리의 먹이 회피) ·
  //      빠른 종(속도 80+)의 지그재그 도주 — 특성 게이트 없이 온 세계에 적용되는 행동 변화라
  //      골든이 바뀌는 것이 정상이다(순수 산술·기하뿐, rng 소비 횟수는 불변).
  // (재기준선 이력) 2026-08-06 **게놈 v8** 으로 재캡처. 두 가지가 세계를 실제로 바꿨다:
  //   ① `MUTABLE_TRAITS` 에서 대사가 빠지고 버티는 힘이 들어왔다(개수 6 은 그대로라 mutRng 소비 횟수는
  //      불변이지만, 여섯 자리 중 넷째·다섯째가 서로 바뀌어 개체마다 다른 값이 흔들린다).
  //   ② `SIM.herdShieldThreshold` 85 → 86(무리 3단의 파생값 88 과 짝을 맞춘 것).
  //   ③ 야생 진화가 다시 세계에 닿게 됐다(`world.syncWildDerived` · 7cccb6a) — v8 에서 파생 축이
  //      게놈 생성 시 한 번만 계산돼 야생이 대사를 진화시켜도 소모가 안 따라가던 것을 되돌렸다.
  //   기준선 게놈 자체는 v7 의 기본 게놈과 **같은 능치**다(`genomeFromTraits({})`) — 게놈이 아니라
  //   세계 규칙이 바뀌었으므로 골든이 바뀌는 것이 정상이다.
  // (재기준선 이력) 2026-08-05 새끼 초기 방향 수정(entity.ts wanderAngle 버그: id 를 도 단위로 읽어
  // 연속 id 가 1도씩만 달랐다)으로 재캡처. 이 수정은 모든 세계의 헤딩을 바꾸므로 골든이 바뀌는 것이
  // 정상이다. 출생 위치 극좌표 재해석(behavior.ts, draw 2회 유지)도 같은 커밋에 포함.
  const GOLDEN_A_SNAP = "t600|p110|0:509.830,321.374,54.461;8:223.418,497.370,49.954;9:4.994,512.548,20.319;10:242.388,309.109,62.750;12:307.823,140.978,78.063;13:303.950,0.000,39.367;15:185.335,679.456,17.114;16:485.411,62.743,33.943;18:327.073,871.253,23.548;20:322.615,440.384,45.411;21:153.535,779.949,16.612;25:221.816,740.506,1.817;28:515.990,784.415,19.023;31:287.953,499.325,53.196;44:527.049,220.709,59.165;45:540.000,232.190,58.563;46:539.979,602.737,28.953;47:145.602,52.599,39.055;48:477.258,839.660,26.557;49:491.801,0.000,61.163;51:540.000,301.819,15.878;54:529.729,699.990,17.020;56:523.156,638.351,50.020;57:379.967,868.204,33.429;58:225.182,553.754,45.623;60:540.000,608.038,3.744;62:492.494,829.974,32.834;63:540.000,837.755,13.372;64:206.230,449.294,97.569;67:512.633,775.139,45.090;68:356.537,729.052,48.772;80:472.644,765.702,29.165;84:216.127,731.583,23.013;86:312.806,548.546,50.492;92:127.666,954.044,18.959;93:198.836,740.005,94.676;94:157.210,782.225,99.844;95:216.565,804.012,38.284;96:13.510,795.211,38.033;97:21.656,854.430,80.993;98:14.800,804.451,2.404;100:60.602,832.648,19.154;101:79.823,858.870,40.461;116:467.038,487.687,96.004;117:301.319,563.520,64.444;118:301.333,563.627,96.190;123:490.416,831.023,34.559;132:229.857,552.734,55.078;134:183.697,523.289,25.334;138:535.523,222.998,54.696;139:2.555,165.324,74.788;141:124.178,730.131,0.902;142:213.421,752.279,39.496;143:316.555,134.867,45.676;145:0.000,168.729,1.785;149:111.989,960.000,16.276;150:305.288,646.067,36.768;151:1.199,166.564,30.749;152:122.841,958.109,44.058;154:323.210,123.690,73.082;156:363.993,860.047,67.028;158:489.120,831.651,51.380;159:509.016,296.419,92.028;161:539.996,602.605,32.521;162:11.409,793.978,32.198;163:150.032,947.700,41.783;164:25.197,800.610,95.191;165:25.278,800.305,63.176;166:54.268,562.986,60.585;167:160.983,781.067,16.035;168:487.397,60.662,78.690;169:285.652,709.392,49.376;170:134.610,224.177,42.295;171:511.003,806.598,17.494;172:527.731,369.468,13.189;173:379.999,860.036,7.777;174:81.590,857.635,26.350;175:213.604,541.134,80.126;176:185.661,10.374,5.761;177:141.732,960.000,2.253;178:482.640,767.608,62.203;179:490.414,829.084,19.524;180:489.674,830.568,51.484;181:119.947,399.705,35.664;182:81.429,856.597,41.913;183:122.562,959.781,16.903;184:301.349,564.239,59.409;185:124.856,959.919,52.376;186:238.544,317.027,34.545;187:323.257,124.699,28.611;188:301.857,564.413,32.241;189:485.454,833.372,19.277;190:472.572,843.447,83.641;191:107.269,362.179,35.644;192:133.529,53.955,38.478;193:376.269,860.098,33.429;194:514.376,596.532,41.952;195:47.153,790.433,99.549;196:179.795,818.680,71.246;197:317.349,131.100,45.667;198:220.021,549.987,45.623;199:450.000,70.000,55.000;200:309.398,891.093,55.000;201:419.454,556.876,55.000;202:126.884,254.111,55.000;203:304.390,786.619,55.000;204:390.000,390.000,55.000;205:104.007,272.418,55.000;206:354.804,882.699,55.000;207:359.428,119.965,55.000";
  const GOLDEN_A_RNG = -1048423627;
  const GOLDEN_B_SNAP = "t600|p102|0:454.827,225.290,65.867;4:310.744,525.605,34.972;6:354.619,255.609,4.661;9:2.632,294.847,29.487;10:401.460,230.463,9.935;11:428.971,758.109,69.340;12:180.273,165.712,68.300;14:402.970,232.502,68.026;15:457.265,225.466,86.136;16:431.024,243.042,34.902;18:286.408,868.123,20.122;23:288.991,867.023,16.059;24:310.322,588.888,19.154;28:540.000,712.980,22.014;30:416.800,321.019,16.763;33:384.128,529.043,7.225;40:428.881,806.659,20.106;43:295.743,584.856,51.607;45:523.981,203.147,31.208;47:112.416,372.677,27.404;48:240.513,950.849,107.488;49:380.969,296.767,3.165;50:380.382,295.926,0.381;51:451.121,339.025,28.249;52:387.616,295.308,2.566;57:369.686,889.438,93.366;58:177.117,553.416,28.706;60:518.247,831.983,45.858;84:294.042,314.495,17.606;86:269.732,881.020,53.977;89:437.725,755.389,19.362;92:131.048,942.921,25.748;93:61.733,794.950,7.903;94:66.833,794.507,91.155;96:52.041,789.700,34.629;97:54.935,800.387,60.963;99:148.215,940.156,52.370;113:386.707,518.584,61.986;117:406.273,846.410,16.534;120:449.349,368.301,11.940;122:539.832,503.239,54.654;125:226.511,553.109,78.623;128:500.006,679.958,43.279;132:385.318,529.172,9.024;133:60.627,794.679,38.357;135:375.530,342.587,25.609;136:62.770,551.731,120.223;137:89.891,824.987,16.285;138:158.175,103.340,34.875;140:88.336,812.702,72.497;141:346.108,899.998,51.789;143:148.650,315.410,0.763;144:235.807,951.005,136.135;145:90.322,811.520,98.152;147:240.265,601.667,27.774;149:172.679,916.009,26.941;150:11.837,822.077,80.979;151:123.342,936.177,14.840;152:374.263,578.503,96.495;153:63.083,310.365,7.555;154:170.146,938.356,88.382;155:445.634,379.293,9.864;156:83.394,298.932,13.512;157:191.745,248.556,94.361;158:292.164,886.241,13.690;159:540.000,736.190,17.274;160:67.664,795.435,80.984;161:159.993,926.464,10.103;162:51.966,789.838,59.700;163:55.201,809.001,6.134;164:431.191,799.051,87.160;165:518.050,789.929,54.805;166:237.129,950.006,17.731;167:283.375,818.505,93.635;168:327.884,594.260,49.524;169:52.702,789.461,48.590;170:373.166,859.977,22.053;171:160.002,615.239,28.706;173:159.962,920.042,67.900;174:179.150,909.363,28.000;175:408.290,232.774,55.426;176:80.737,817.705,48.034;177:273.766,637.897,34.778;178:342.282,436.005,48.906;180:451.778,223.716,65.655;181:158.511,934.758,25.989;182:348.326,662.946,45.439;183:535.860,229.985,85.978;184:247.096,552.168,39.850;185:51.598,788.213,67.629;186:227.637,543.821,78.623;187:482.574,791.601,45.858;188:352.935,659.673,74.202;189:530.000,190.000,55.000;190:173.995,646.580,55.000;191:459.487,821.715,55.000;192:236.720,306.976,55.000;193:490.743,288.183,55.000;194:330.597,29.600,55.000;195:324.729,606.485,55.000;196:516.537,39.662,55.000;197:426.624,889.606,55.000";
  const GOLDEN_B_RNG = 518299713;

  it("기준선 게놈, 600틱 — 지문과 rng 상태가 기준선 그대로다", () => {
    const w = runPlain("golden-1", BASE(), 600);
    expect(snapshot(w)).toBe(GOLDEN_A_SNAP);
    expect(w.rng.getState()).toBe(GOLDEN_A_RNG);
  });

  it("herding 92, 600틱 — 지문과 rng 상태가 기준선 그대로다", () => {
    const w = runPlain("golden-1", HERD92(), 600);
    expect(snapshot(w)).toBe(GOLDEN_B_SNAP);
    expect(w.rng.getState()).toBe(GOLDEN_B_RNG);
  });

  it("알파를 지정만 한 세계도 같은 기준선 지문을 낸다 (I2 를 절대값으로 재확인)", () => {
    const a = runArmed("golden-1", BASE(), 600);
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
    const w = new World("env-1", W, H, BASE());
    const grass = w.terrain.grassSpots(1)[0];
    expect(grass).toBeDefined();
    if (!grass) return;
    expect(w.terrain.isGrass(grass.x, grass.y)).toBe(true);
    const raptor = createBoss("raptor", W, H, w.terrain); // grassCover 보스

    // ① 조종 OFF(기존 모드) — 내 종도 수풀에 숨는다. 예전과 문자 그대로 같다.
    expect(w.lead.leaderId).toBe(-1);
    expect(bossCanHunt(raptor, at(BASE(), grass, true), w)).toBe(false);

    // ② 알파를 **지정만** 한 상태 — 아직 아무도 안 몰았으니 규칙도 예전 그대로다.
    //    (여기서 봉인이 걸리면 "지정만 하면 기존과 부동소수점까지 동일"이 통째로 깨진다.)
    w.armLead();
    expect(w.lead.leaderId).toBeGreaterThanOrEqual(0);
    expect(w.lead.commanded).toBe(false);
    expect(bossCanHunt(raptor, at(BASE(), grass, true), w)).toBe(false);

    // ③ 한 번이라도 몰면 — 수풀은 형질 없이 밟는 공짜 지형이라, 무리를 세워 두면 시야 카운터가
    //    통째로 무효화된다. 그래서 몬 세계에서는 내 종에게 엄폐가 안 통한다.
    w.lead.cmd = RIGHT;
    w.step();
    expect(w.lead.commanded).toBe(true);
    expect(bossCanHunt(raptor, at(BASE(), grass, true), w)).toBe(true);

    // ④ 손을 떼도 봉인은 안 풀린다 — "무리를 수풀에 몰아넣고 손 떼기" 우회 차단.
    w.lead.cmd = null;
    for (let i = 0; i < LEAD.followHoldTicks + 2; i++) w.step();
    expect(w.lead.followTicks).toBe(0);
    expect(w.lead.commanded).toBe(true);
    expect(bossCanHunt(raptor, at(BASE(), grass, true), w)).toBe(true);

    // ⑤ 야생은 규칙이 그대로다(사람이 안 모는 종까지 벌줄 이유가 없다).
    expect(bossCanHunt(raptor, at(BASE(), grass, false), w)).toBe(false);
  });

  it("수풀이 아닌 자리·grassCover 아닌 보스에는 조종이 아무 영향이 없다", () => {
    const w = new World("env-1", W, H, BASE());
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
      bossCanHunt(raptor, at(BASE(), land, true), w),
      bossCanHunt(chaser, at(BASE(), land, true), w),
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
    // 시야·초음파 0 으로 감지 범위를 사정거리까지 좁힌다 — 딴 먹잇감이 안 끼어들게(격리).
    const g = tune({ diet: 80, attack: 10, size: 30, vision: 0, echo: 0 });
    const w = new World("block-1", 540, 960, g);
    w.armLead();
    const me = w.entities.find((e) => e.id === w.lead.leaderId);
    expect(me).toBeDefined();
    if (!me) return;
    // 바로 옆에 "못 무는" 거구를 세운다 — 같은 종·친척이 아니어야 먹잇감 관계가 선다.
    const target = w.entities.find((e) => !e.species.isPlayer && !e.species.friendly);
    expect(target).toBeDefined();
    if (!target) return;
    // 코끼리 — 이빨이 아예 안 박힌다. 초식이라(diet 10) 나를 먼저 잡아먹지도 않는다.
    // ⚠ v8 은 물기 판정이 **상대의 버티는 힘(defense)** 을 보므로 그것까지 함께 세워야 한다 —
    //   `genomeFromTraits` 가 `defense = attack` 으로 채워 v7 과 같은 수를 낸다.
    target.genome = cloneGenome(tune({ size: 100, attack: 20, diet: 10 }));
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
    //
    // ⚠ **이 자리 근처의 bite 만 센다**(2026-08-10). 위에서 다른 야생을 (5,5) 로 몰아 놨는데
    //   **거기서 자기들끼리 문다.** 전투 재설계(즉사 → 피해 싸움) 전에는 그 물기가 대부분 즉사로
    //   끝나 `kill` 사건이 됐고, 그래서 이 단언이 우연히 통과하고 있었다 — 격리가 원래부터
    //   불완전했는데 높은 즉사율이 가려 주고 있었던 셈이다. 이제는 자리로 확실히 가른다.
    const nearHere = (e: { x: number; y: number }): boolean =>
      Math.hypot(e.x - target.x, e.y - target.y) < 60;
    expect(w.events.filter((e) => e.kind === "bite" && nearHere(e)).length).toBe(0);
    expect(hpBefore - target.energy).toBeLessThan(1); // 물려서 깎인 게 아니다(물기 피해는 이보다 훨씬 크다)
    expect(target.alive).toBe(true);
  });

  it("잘 박히는 상대에는 튕김이 안 뜬다 (대조군 — 항상 뜨는 게 아니다)", () => {
    const g = tune({ diet: 80, attack: 95, size: 80, vision: 0, echo: 0 }); // 강한 이빨
    const w = new World("block-2", 540, 960, g);
    w.armLead();
    const me = w.entities.find((e) => e.id === w.lead.leaderId);
    const target = w.entities.find((e) => !e.species.isPlayer && !e.species.friendly);
    if (!me || !target) throw new Error("설정 실패");
    target.genome = cloneGenome(tune({ size: 20, attack: 10, diet: 10 }));
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
