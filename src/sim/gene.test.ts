// 방울(유전자 점수) · 계약을 못 박는 테스트.
//
// 여기 있는 것들은 「기능이 된다」보다 **「다섯 사람이 각자 다르게 짜지 못하게 한다」** 가 목적이다.
// 사다리 값 · 경계 규칙(닿으면 준다) · 위기 회복 상태 기계는 부르는 쪽마다 다시 짜면 반드시 어긋난다.
import { describe, it, expect } from "vitest";
import { Rng } from "@/sim/rng";
import { TIER_STEPS } from "@/sim/tiers";
import { World, pickGeneDropSpot } from "@/sim/world";
import { genomeFromTraits, type Genome } from "@/sim/genome";
import type { Entity } from "@/sim/entity";
import {
  CRISIS_BACK,
  CRISIS_LOW,
  GENE_AWARD,
  GENE_PICK_RADIUS,
  GENE_REASON_LABELS,
  GENE_SPAWN_RING,
  POP_MILESTONES,
  createCrisisWatch,
  createGeneDrop,
  geneDropOffset,
  geneDropReached,
  milestonesCrossed,
  stepCrisisWatch,
  type GeneReason,
} from "@/sim/gene";

describe("개체 수 문턱 사다리", () => {
  // 눈금을 일곱으로 둔 것은 내 판단이다(사용자가 준 것은 「배수로 벌어진다」는 방향과 다섯 눈금
  // 예시 · gene.ts 의 POP_MILESTONES 주석 참고). 값을 바꾸려면 이 테스트도 함께 고친다.
  it("지금의 일곱 눈금 그대로다 (마지막에 한 번만 반올림)", () => {
    expect(POP_MILESTONES).toEqual([20, 30, 45, 68, 101, 152, 228]);
  });

  it("눈금에 **닿으면** 준다 (화면에 「20마리」라 적으면 20마리에서 받는다)", () => {
    expect(milestonesCrossed(19, 20)).toBe(1);
    expect(milestonesCrossed(20, 29)).toBe(0);
    expect(milestonesCrossed(20, 30)).toBe(1);
  });

  it("한 번에 여러 눈금을 건너뛰면 그만큼 센다", () => {
    expect(milestonesCrossed(0, 45)).toBe(3);
    expect(milestonesCrossed(0, 228)).toBe(POP_MILESTONES.length);
  });

  it("최고 기록이 안 올랐으면 0 이다(오르내려도 다시 안 준다)", () => {
    expect(milestonesCrossed(45, 45)).toBe(0);
    expect(milestonesCrossed(45, 20)).toBe(0);
  });
});

describe("위기 회복", () => {
  it("절반 아래로 가라앉았다 90% 위로 돌아온 그 순간에만 준다", () => {
    const w = createCrisisWatch();
    // 40마리까지 컸다 · 아직 위기가 아니다.
    for (const p of [10, 25, 40]) expect(stepCrisisWatch(w, p)).toBe(false);
    expect(w.peak).toBe(40);
    // 절반(20) 아래로 떨어진다.
    expect(stepCrisisWatch(w, 19)).toBe(false);
    expect(w.sunk).toBe(true);
    // 90%(36) 에 못 미치면 아직 회복이 아니다.
    expect(stepCrisisWatch(w, 35)).toBe(false);
    // 36 에 닿는 순간 준다.
    expect(stepCrisisWatch(w, 36)).toBe(true);
    expect(w.sunk).toBe(false);
    // 같은 회복으로 두 번 받지 않는다.
    expect(stepCrisisWatch(w, 40)).toBe(false);
  });

  it("**정확히 절반**은 아직 가라앉은 것이 아니다(`<` 이지 `<=` 가 아니다)", () => {
    // 최고 20 · 절반은 딱 10. 이 한 칸에서 게임(`<`)과 프로브(`<=`)의 답이 갈렸던 자리다 ·
    // 부등호가 어긋나면 같은 판을 놓고 「위기 1회」와 「0회」가 동시에 참이 된다.
    const w = createCrisisWatch();
    stepCrisisWatch(w, 20);
    expect(stepCrisisWatch(w, 10)).toBe(false);
    expect(w.sunk).toBe(false);
    // 그래서 18(최고의 90%)로 돌아와도 줄 것이 없다 · 애초에 가라앉은 적이 없다.
    expect(stepCrisisWatch(w, 18)).toBe(false);
    // 한 마리만 더 줄면 그때 가라앉고, 그 뒤 18 에서 회복이 성립한다.
    expect(stepCrisisWatch(w, 9)).toBe(false);
    expect(w.sunk).toBe(true);
    expect(stepCrisisWatch(w, 18)).toBe(true);
  });

  it("선을 인자로 옮길 수 있다(프로브의 문턱 스윕 · 안 넘기면 기본 상수)", () => {
    // 프로브가 --crisis= --recover= 로 선을 옮겨 재는 길. 이 인자가 없으면 프로브가 상태 기계를
    // 다시 짜게 되고, 그 순간 규칙이 두 곳에 산다.
    const w = createCrisisWatch();
    stepCrisisWatch(w, 100, 0.8, 0.95);
    expect(stepCrisisWatch(w, 79, 0.8, 0.95)).toBe(false);
    expect(w.sunk).toBe(true); // 기본 선(0.5)이었다면 79 는 아직 위기가 아니다
    expect(stepCrisisWatch(w, 95, 0.8, 0.95)).toBe(true);
  });

  it("절반 아래로 안 내려가면 아무리 오르내려도 안 준다", () => {
    const w = createCrisisWatch();
    stepCrisisWatch(w, 40);
    for (const p of [21, 39, 22, 40]) expect(stepCrisisWatch(w, p)).toBe(false);
  });

  it("최고가 0 인 동안(아직 아무도 안 산다)에는 아무 일도 안 일어난다", () => {
    const w = createCrisisWatch();
    expect(stepCrisisWatch(w, 0)).toBe(false);
    expect(w.sunk).toBe(false);
  });

  it("두 선은 아래가 위보다 낮다(뒤집히면 즉시 무한 지급이 된다)", () => {
    expect(CRISIS_LOW).toBeLessThan(CRISIS_BACK);
    expect(CRISIS_BACK).toBeLessThanOrEqual(1);
  });
});

describe("방울 값", () => {
  it("econ 프로브 실측대로 판당 26개 안팎이다", () => {
    // 실측 발생 횟수(손 놓은 판) · `node scripts/balance-probe.mjs econ` 을 **인자 없이**
    // (= 정책 best · 시드 8 · 갈래 5종) 돌린 2026-08-08 값. 인자를 적어 두지 않으면 다음 사람이
    // 같은 숫자를 다시 못 만든다(시드 수만 바꿔도 움직인다).
    // ⚠ recovery 가 0.75 에서 0.20 으로 내려온 것은 밸런스 변경이 아니라 **가짜 발화를 고친 결과**다
    //   (시대 전환마다 위기 없이 터지던 것 · gene.ts 의 GENE_AWARD 주석과 known_issues 참고).
    const perRun: Record<GeneReason, number> = {
      boss: 3.33,
      extinction: 1.48,
      milestone: 2.75,
      recovery: 0.2,
      trialExceed: 1.75,
    };
    let total = 0;
    for (const k of Object.keys(perRun) as GeneReason[]) total += GENE_AWARD[k] * perRun[k];
    expect(total).toBeGreaterThan(24);
    expect(total).toBeLessThan(29);
  });

  it("판당 공급이 한 범주를 0에서 4단까지 올리고도 남는다", () => {
    // 한 범주 0→4단 = TIER_STEPS 의 끝(20). 방울은 도장과 같은 단위라 그대로 비교된다.
    expect(TIER_STEPS[TIER_STEPS.length - 1]).toBe(20);
  });

  it("모든 사건에 한국어 이름이 있다(화면이 그 자리에서 말할 수 있게)", () => {
    for (const k of Object.keys(GENE_AWARD) as GeneReason[]) {
      expect(GENE_REASON_LABELS[k].length).toBeGreaterThan(0);
    }
  });
});

describe("줍기 판정", () => {
  it("반경 안이면 줍고 밖이면 안 줍는다", () => {
    const d = createGeneDrop(100, 100, 3, 0, "boss");
    expect(geneDropReached(d, 100, 100)).toBe(true);
    expect(geneDropReached(d, 100 + GENE_PICK_RADIUS, 100)).toBe(true);
    expect(geneDropReached(d, 100 + GENE_PICK_RADIUS + 1, 100)).toBe(false);
  });

  it("이미 주운 방울은 다시 안 걸린다", () => {
    const d = createGeneDrop(100, 100, 3, 0, "boss");
    d.taken = true;
    expect(geneDropReached(d, 100, 100)).toBe(false);
  });
});

describe("나타나는 자리", () => {
  it("고리 안쪽·바깥쪽 사이에 떨어진다", () => {
    const rng = new Rng("gene-test");
    for (let i = 0; i < 200; i += 1) {
      const { dx, dy } = geneDropOffset(rng);
      const r = Math.hypot(dx, dy);
      expect(r).toBeGreaterThanOrEqual(GENE_SPAWN_RING.min - 1e-6);
      expect(r).toBeLessThanOrEqual(GENE_SPAWN_RING.max + 1e-6);
    }
  });

  it("같은 시드면 같은 자리다(결정론 · 프로브가 여기 기댄다)", () => {
    const a = geneDropOffset(new Rng("same"));
    const b = geneDropOffset(new Rng("same"));
    expect(a).toEqual(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// 여기부터는 **세계 안에서** 방울이 실제로 놓이고 주워지는가 (world.ts 의 줍기·자리 고르기)
// ═══════════════════════════════════════════════════════════════════════════════════════

const W = 540;
const H = 960;

/** 능치를 하나도 안 건드린 기준선 종(world.test 의 baseGenome 과 같은 것). */
function baseGenome(): Genome {
  return genomeFromTraits({});
}

/** 내 종 개체 하나(없으면 테스트를 세운다). */
function anyPlayer(w: World): Entity {
  const e = w.entities.find((x) => x.species.isPlayer);
  if (e === undefined) throw new Error("내 종 개체가 없다 · 테스트 전제가 깨졌다");
  return e;
}

/** 내 종 전부에게서 minD 이상 떨어진 야생 개체(없으면 null). */
function lonelyWild(w: World, minD: number): Entity | null {
  for (const e of w.entities) {
    if (e.species.isPlayer) continue;
    let ok = true;
    for (const p of w.entities) {
      if (!p.species.isPlayer) continue;
      if (Math.hypot(p.x - e.x, p.y - e.y) < minD) {
        ok = false;
        break;
      }
    }
    if (ok) return e;
  }
  return null;
}

describe("세계 안에서 줍기", () => {
  it("내 종이 밟으면 주워지고 geneCollected 가 **정확히 amount 만큼** 는다", () => {
    const w = new World("gene-pick-mine", W, H, baseGenome());
    const e = anyPlayer(w);
    w.spawnGeneDrop(e.x, e.y, 3, "boss");
    expect(w.geneCollected).toBe(0);

    w.step(); // 한 틱에 개체가 움직이는 거리는 2px 남짓 → 반경 16 안에 그대로 있다

    expect(w.geneCollected).toBe(3);
    expect(w.geneDrops[0]?.taken).toBe(true);
    // 주운 방울도 배열에 남는다(렌더가 사라지는 연출을 그릴 자리).
    expect(w.geneDrops.length).toBe(1);
    // 주운 순간이 화면 사건으로 나간다 · 내 무리 사건이다.
    const picked = w.events.filter((ev) => ev.kind === "gene");
    expect(picked.length).toBe(1);
    expect(picked[0]?.mine).toBe(true);
  });

  it("한 방울은 **한 번만** 주워진다(여러 마리가 겹쳐 서 있어도)", () => {
    const w = new World("gene-pick-once", W, H, baseGenome());
    const e = anyPlayer(w);
    w.spawnGeneDrop(e.x, e.y, 5, "recovery");
    for (let i = 0; i < 30; i++) w.step();
    expect(w.geneCollected).toBe(5);
    expect(w.events.filter((ev) => ev.kind === "gene").length).toBeLessThanOrEqual(1);
  });

  it("**야생 종이 밟아도 안 주워진다**", () => {
    // 야생이 주우면 사람이 번 방울이 화면 밖에서 증발한다.
    let w: World | null = null;
    let wild: Entity | null = null;
    for (const seed of ["gene-wild-1", "gene-wild-2", "gene-wild-3"]) {
      const cand = new World(seed, W, H, baseGenome());
      const lone = lonelyWild(cand, 60); // 내 종에게서 60px 밖 = 한 틱으론 절대 안 닿는다
      if (lone !== null) {
        w = cand;
        wild = lone;
        break;
      }
    }
    if (w === null || wild === null) throw new Error("내 종과 떨어진 야생 개체를 못 찾았다");

    w.spawnGeneDrop(wild.x, wild.y, 4, "extinction");
    w.step();

    expect(w.geneCollected).toBe(0);
    expect(w.geneDrops[0]?.taken).toBe(false);
    expect(w.events.filter((ev) => ev.kind === "gene").length).toBe(0);
  });

  it("줍기는 rng 를 안 쓴다 · 방울이 있든 없든 세계의 전개가 1비트도 안 달라진다", () => {
    const fingerprint = (seed: string, withDrop: boolean): string => {
      const w = new World(seed, W, H, baseGenome());
      if (withDrop) {
        const e = anyPlayer(w);
        w.spawnGeneDrop(e.x, e.y, 3, "milestone");
      }
      for (let i = 0; i < 300; i++) w.step();
      return w.entities.map((e) => `${e.id}:${e.x.toFixed(3)},${e.y.toFixed(3)}`).join(";");
    };
    expect(fingerprint("gene-nodrift", true)).toEqual(fingerprint("gene-nodrift", false));
  });
});

describe("방울을 놓을 자리 (pickGeneDropSpot)", () => {
  it("같은 시드로 두 번 돌리면 **방울 위치가 완전히 같다**(결정론)", () => {
    const run = (): string => {
      const w = new World("gene-det", W, H, baseGenome());
      const out: string[] = [];
      for (let i = 0; i < 400; i++) {
        w.step();
        if (i % 50 === 0) {
          w.spawnGeneDropNear(2, "milestone");
          const d = w.geneDrops[w.geneDrops.length - 1];
          out.push(d === undefined ? "none" : `${d.x.toFixed(6)},${d.y.toFixed(6)}`);
        }
      }
      return out.join("|");
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a).not.toContain("none"); // 실제로 뽑히긴 했는지(빈 결과로 통과하는 것 방지)
  });

  it("자리를 뽑아도 **메인 rng 를 안 건드린다**(야생 생태 밸런스 보존)", () => {
    const fingerprint = (spawn: boolean): string => {
      const w = new World("gene-stream", W, H, baseGenome());
      for (let i = 0; i < 300; i++) {
        w.step();
        if (spawn && i % 20 === 0) w.spawnGeneDropNear(2, "milestone");
      }
      // 방울을 안 주운 세계와 비교해야 하므로 좌표만 본다(주운 것은 geneCollected 로 갈린다).
      return w.entities.map((e) => `${e.id}:${e.x.toFixed(3)},${e.y.toFixed(3)}`).join(";");
    };
    expect(fingerprint(true)).toEqual(fingerprint(false));
  });

  it("**갈 수 없는 지형을 고르지 않는다** (물도 산도 못 가는 종 · 바다가 많은 세계)", () => {
    const land = genomeFromTraits({ swimming: 0, wings: 0 }); // 물 X · 산 X
    let tried = 0;
    for (const seed of ["gene-terr-a", "gene-terr-b", "gene-terr-c"]) {
      for (const map of ["archipelago", "ocean", "continent"] as const) {
        const w = new World(seed, W, H, land, 1, [], map);
        for (let i = 0; i < 60; i++) w.step();
        for (let k = 0; k < 40; k++) {
          const spot = pickGeneDropSpot(w.geneRng, w);
          if (spot === null) continue; // 뽑을 자리가 아예 없는 세계는 이 검사의 대상이 아니다
          tried += 1;
          expect(w.terrain.isWater(spot.x, spot.y)).toBe(false);
          expect(w.terrain.isMountain(spot.x, spot.y)).toBe(false);
          expect(w.terrain.isPassable(spot.x, spot.y, false, true, false)).toBe(true);
          // 세계 밖으로 나가지 않는다(반쯤 걸치면 줍기 반경이 잘린다).
          expect(spot.x).toBeGreaterThanOrEqual(0);
          expect(spot.y).toBeGreaterThanOrEqual(0);
          expect(spot.x).toBeLessThanOrEqual(W);
          expect(spot.y).toBeLessThanOrEqual(H);
        }
      }
    }
    expect(tried).toBeGreaterThan(50); // 빈손으로 통과하지 않았는지
  });

  it("**걸어 닿는 곳만** 고른다 · 무리에서 길이 이어진다", () => {
    const land = genomeFromTraits({ swimming: 0, wings: 0 });
    let checked = 0;
    for (const map of ["archipelago", "ocean"] as const) {
      const w = new World("gene-reach", W, H, land, 1, [], map);
      for (let i = 0; i < 60; i++) w.step();
      const c = w.playerCentroid();
      // ⚠ 시도를 25 → 40 으로 늘렸다(2026-08-10). 아래 `checked > 20` 은 **표본이 충분한지** 보는
      //   보조 단언인데, 전투 재설계로 60틱 뒤 무리 자리가 조금 달라지자 19 로 떨어져 걸렸다
      //   (정작 중요한 계약 — 고른 자리가 걸어 닿는가 — 은 19번 모두 통과했다).
      //   하한을 낮추는 대신 **표본을 늘린다** · 그래야 계약 검증이 오히려 강해진다.
      for (let k = 0; k < 40; k++) {
        const spot = pickGeneDropSpot(w.geneRng, w);
        if (spot === null) continue;
        checked += 1;
        const sameTile = w.terrain.tileIndex(c.x, c.y) === w.terrain.tileIndex(spot.x, spot.y);
        const straight = w.terrain.lineOfSight(c.x, c.y, spot.x, spot.y, false, true, false);
        const path = w.terrain.findPath(c.x, c.y, spot.x, spot.y, false, true, false);
        expect(sameTile || straight || path.length > 0).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("내 종이 전멸하면 자리도 없고 방울도 안 놓인다", () => {
    const w = new World("gene-extinct", W, H, baseGenome());
    w.entities = w.entities.filter((e) => !e.species.isPlayer);
    expect(pickGeneDropSpot(w.geneRng, w)).toBeNull();
    expect(w.spawnGeneDropNear(3, "boss")).toBe(false);
    expect(w.geneDrops.length).toBe(0);
  });

  it("놓인 방울은 무리에서 **떨어져** 있다(가만히 있어도 주워지면 조종이 뜻을 잃는다)", () => {
    const w = new World("gene-dist", W, H, baseGenome());
    for (let i = 0; i < 60; i++) w.step();
    const c = w.playerCentroid();
    expect(w.spawnGeneDropNear(3, "boss")).toBe(true);
    const d = w.geneDrops[0];
    if (d === undefined) throw new Error("방울이 안 놓였다");
    // 발밑(줍기 반경 안)에 떨어지지 않는다. 고리를 좁히는 최후 수단도 줍기 반경의 3배부터다.
    expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeGreaterThan(GENE_PICK_RADIUS);
  });
});
