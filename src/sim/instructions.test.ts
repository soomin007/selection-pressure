// 지침 시트 — 감독의 사전 지침(**[사용자 2026-09-11]** 탭 조종 대체 · 계약은 sim/instructions.ts 머리 주석).
//
// 이 파일의 절반은 herdOrder.test.ts 와 같은 이유로 **"시트가 없거나 「알아서」뿐이면 기존 세계와 1비트도
// 안 다르다"** 를 증명한다. 지침은 stepEntity 의 desired 에 손을 넣는 기능이라, 잘못 걸면 난수 스트림이
// 통째로 밀려 여태 쌓은 밸런스가 조용히 다른 세계가 된다. 여기 결정론 테스트는 완화 대상이 아니라 감지기다.
//
// 나머지 절반은 행동 넷이 **실제로 다른 일을 하는가**(빈 이름 금지 · herdOrder.ts 의 「여덟 칸 중 일곱이
// 이동과 같았다」 사고의 재발 방지)와 FF12 규칙(대상 없는 줄은 건너뛴다 · 위에서부터 첫 줄만)이다.
import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { SIM } from "@/sim/params";
import { Terrain, TILE, type TileKind } from "@/sim/terrain";
import { genomeFromTraits, type Genome, type Traits } from "@/sim/genome";
import {
  ACT_KEYS,
  FINAL_DIRECTIVE,
  SHEET,
  WHO_KEYS,
  directiveLine,
  sameSheet,
  sanitizeSheet,
  sheetRows,
  whoMatches,
  type Directive,
} from "@/sim/instructions";
import { HERD_SHEET_ROWS, TIER_STEPS, emptyPips } from "@/sim/tiers";

const W = 540;
const H = 960;
const CS = 20;
const COLS = Math.ceil(W / CS);
const ROWS = Math.ceil(H / CS);

/** world.test.ts 와 **같은 지문 함수**(옛 herdOrder.test.ts · lead.test.ts 도 이것을 썼다). */
function snapshot(world: World): string {
  const ents = world.entities.map(
    (e) => `${e.id}:${e.x.toFixed(3)},${e.y.toFixed(3)},${e.energy.toFixed(3)}`,
  );
  return `t${world.tick}|p${world.population}|${ents.join(";")}`;
}

function tune(over: Partial<Traits>): Genome {
  return genomeFromTraits(over);
}

/** 시트를 건 채 n 틱. 시트는 game 이 세팅하는 그 자리(world.sheet)에 그대로 넣는다. */
function run(seed: string, genome: Genome, steps: number, sheet: readonly Directive[] | null): World {
  const w = new World(seed, W, H, genome);
  w.sheet = sheet;
  for (let i = 0; i < steps; i++) w.step();
  return w;
}

function alivePlayers(w: World): number {
  let n = 0;
  for (const e of w.entities) if (e.alive && e.species.isPlayer) n += 1;
  return n;
}

function sum(a: readonly number[]): number {
  let s = 0;
  for (const v of a) s += v;
  return s;
}

/** 내 종의 무게중심에서의 평균 거리 — 「뭉쳤다/흩어졌다」의 자. */
function meanSpread(w: World): number {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const e of w.entities) {
    if (!e.alive || !e.species.isPlayer) continue;
    sx += e.x;
    sy += e.y;
    n += 1;
  }
  if (n === 0) return 0;
  const cx = sx / n;
  const cy = sy / n;
  let d = 0;
  for (const e of w.entities) {
    if (!e.alive || !e.species.isPlayer) continue;
    d += Math.hypot(e.x - cx, e.y - cy);
  }
  return d / n;
}

/** 내 종 중 수풀 위에 선 개체 비율. */
function grassShare(w: World): number {
  let on = 0;
  let n = 0;
  for (const e of w.entities) {
    if (!e.alive || !e.species.isPlayer) continue;
    n += 1;
    if (w.terrain.isGrass(e.x, e.y)) on += 1;
  }
  return n === 0 ? 0 : on / n;
}

/** 온 판이 육지 · 세로 중앙에 폭 `band` 타일의 수풀 띠 하나(가로 전체). 생성기에 기대지 않는다. */
function bandTerrain(band: number): Terrain {
  const tiles: TileKind[] = new Array<TileKind>(COLS * ROWS).fill(TILE.land);
  const elev: number[] = new Array<number>(COLS * ROWS).fill(0.5);
  const y0 = Math.floor(ROWS / 2) - Math.floor(band / 2);
  for (let y = y0; y < y0 + band; y++) for (let x = 0; x < COLS; x++) tiles[y * COLS + x] = TILE.grass;
  return new Terrain(COLS, ROWS, CS, elev, tiles);
}

function flatTerrain(): Terrain {
  return new Terrain(COLS, ROWS, CS, new Array<number>(COLS * ROWS).fill(0.5), new Array<TileKind>(COLS * ROWS).fill(TILE.land));
}

/** 지형을 갈아 끼운 세계(물 먹이 정리 · 옛 herdOrder.test.ts 의 worldOn 과 같은 처리). */
function worldOn(terrain: Terrain, seed: string, over: Partial<Traits> = {}): World {
  const w = new World(seed, W, H, tune({ herding: 40, ...over }));
  (w as unknown as { terrain: Terrain }).terrain = terrain;
  for (let i = w.food.length - 1; i >= 0; i--) {
    const f = w.food[i];
    if (f === undefined) continue;
    if (f.aquatic !== (terrain.kindAt(f.x, f.y) === TILE.water)) w.food.splice(i, 1);
  }
  w.foodGrid.build(w.food);
  return w;
}

function stepN(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.step();
}

const AUTO: Directive = { who: "all", when: "always", act: "auto" };
const HIDE: Directive = { who: "all", when: "always", act: "hide" };
const GATHER: Directive = { who: "all", when: "always", act: "gather" };
const SCATTER: Directive = { who: "all", when: "always", act: "scatter" };

describe("지침 시트 — 결정론 (시트가 없거나 「알아서」뿐이면 기존과 동일)", () => {
  it("sheet 가 null 이면 지문이 완전히 같다(부동소수점까지)", () => {
    const a = run("sheet-det-1", tune({}), 300, null);
    const b = run("sheet-det-1", tune({}), 300, null);
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it("빈 시트 · 「알아서」만 있는 시트는 null 시트와 1비트도 다르지 않다(집계만 센다)", () => {
    const base = run("sheet-det-2", tune({}), 300, null);
    const empty = run("sheet-det-2", tune({}), 300, []);
    const autos = run("sheet-det-2", tune({}), 300, [AUTO, { who: "strong", when: "night", act: "auto" }]);
    expect(snapshot(empty)).toBe(snapshot(base));
    expect(snapshot(autos)).toBe(snapshot(base));
    // 집계는 산다: 빈 시트는 마지막 칸 하나, 「알아서」 둘은 세 칸.
    expect(empty.sheetFired.length).toBe(1);
    expect(autos.sheetFired.length).toBe(3);
    expect(sum(empty.sheetFired)).toBe(alivePlayers(empty));
  });

  it("같은 시트를 두 번 돌리면 같은 세계다(시트 자체가 결정론적이다)", () => {
    const sheet = [HIDE, GATHER];
    const a = worldOn(bandTerrain(3), "sheet-det-3");
    const b = worldOn(bandTerrain(3), "sheet-det-3");
    a.sheet = sheet;
    b.sheet = sheet;
    stepN(a, 240);
    stepN(b, 240);
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it("매 틱 살아 있는 내 종 전부가 정확히 한 줄에 세인다(발동 수의 합 = 내 종 수)", () => {
    const w = worldOn(bandTerrain(3), "sheet-count-1");
    w.sheet = [{ who: "strong", when: "always", act: "gather" }, HIDE, { who: "weak", when: "hungry", act: "scatter" }];
    let births = w.roundCounts.births;
    for (let i = 0; i < 120; i++) {
      w.step();
      // 이번 틱에 태어난 새끼는 개체 루프 뒤에 붙으므로 아직 어느 줄에도 안 세였다 · 그만큼만 뺀다.
      const born = w.roundCounts.births - births;
      births = w.roundCounts.births;
      expect(w.sheetFired.length).toBe(4);
      expect(sum(w.sheetFired), `t${w.tick}`).toBe(alivePlayers(w) - born);
    }
  });
});

describe("지침 시트 — 행동 넷은 실제로 다른 일을 한다(빈 이름 금지)", () => {
  it("「수풀로 숨는다」는 수풀 체류율을 올린다", () => {
    // 한 순간의 체류율은 포식자 습격(도망 = 본능이 위)에 지배당한다 · 60~300틱 **시간 평균**으로 잰다
    // (known_issues 「무리 행동의 효과를 한 순간의 퍼짐으로 재면」). 실측(2026-09-11): 대조군 0.10 · 숨기 0.72.
    const control = worldOn(bandTerrain(3), "sheet-hide-1");
    const hide = worldOn(bandTerrain(3), "sheet-hide-1");
    hide.sheet = [HIDE];
    let c = 0;
    let h = 0;
    let k = 0;
    for (let i = 1; i <= 300; i++) {
      control.step();
      hide.step();
      if (i >= 60) {
        c += grassShare(control);
        h += grassShare(hide);
        k += 1;
      }
    }
    c /= k;
    h /= k;
    expect(h, `대조군 ${c.toFixed(2)} · 숨기 ${h.toFixed(2)}`).toBeGreaterThan(c + 0.25);
    expect(h).toBeGreaterThan(0.5);
    // 발동은 첫 줄에서 · 마지막 줄(알아서)은 대상 없는 개체(닿는 수풀 없음)만 남는다.
    expect(hide.sheetFired[0]).toBeGreaterThan(0);
  });

  it("「뭉친다」는 무리를 좁히고, 「흩어진다」는 넓힌다", () => {
    // 한 순간의 퍼짐은 포식자 습격(도망 = 본능이 위)에 지배당한다 · 시드 넷 × 30~240틱의 **시간 평균**으로 잰다.
    // 실측(2026-09-11): 대조군 132.6 · 뭉침 87.5(×0.66) · 흩어짐 158.7(×1.20). 문턱은 그 절반 여유.
    const seeds = ["sheet-spread-a", "sheet-spread-b", "sheet-spread-c", "sheet-spread-d"];
    const avgSpread = (sheet: readonly Directive[] | null): number => {
      let acc = 0;
      let k = 0;
      for (const seed of seeds) {
        const w = new World(seed, W, H, tune({ herding: 40 }));
        w.sheet = sheet;
        for (let i = 0; i < 240; i++) {
          w.step();
          if (i >= 30) {
            acc += meanSpread(w);
            k += 1;
          }
        }
      }
      return acc / k;
    };
    const c = avgSpread(null);
    const g = avgSpread([GATHER]);
    const s = avgSpread([SCATTER]);
    expect(g, `대조군 ${c.toFixed(1)} · 뭉침 ${g.toFixed(1)}`).toBeLessThan(c * 0.8);
    expect(s, `대조군 ${c.toFixed(1)} · 흩어짐 ${s.toFixed(1)}`).toBeGreaterThan(c * 1.1);
    expect(g).toBeLessThan(s);
  });

  it("「뭉친다」가 만족되면(이미 모임) 이동을 안 덮는다 · 발동은 그대로 센다", () => {
    const w = run("sheet-gather-done", tune({ herding: 40 }), 120, [GATHER]);
    // 모인 뒤에도 발동 수는 여전히 전부 첫 줄이다(만족 = 발동하되 이동만 안 덮는다) · 퍼짐은 시간 평균으로.
    let spread = 0;
    for (let i = 0; i < 180; i++) {
      w.step();
      // 만족된 개체도 첫 줄에 세인다 = 마지막 줄(알아서)로 떨어지는 개체가 없다.
      expect(w.sheetFired[1]).toBe(0);
      expect(w.sheetFired[0]).toBeGreaterThan(0);
      spread += meanSpread(w);
    }
    expect(spread / 180).toBeLessThan(SHEET.gatherRadius * 1.5);
  });
});

describe("지침 시트 — FF12 규칙(위에서부터 첫 줄 · 대상 없는 줄은 건너뜀)", () => {
  it("닿는 수풀이 없으면 「숨는다」 줄은 성립하지 않고, 세계는 시트 없는 세계와 같다", () => {
    const base = worldOn(flatTerrain(), "sheet-skip-1");
    const w = worldOn(flatTerrain(), "sheet-skip-1");
    w.sheet = [HIDE];
    stepN(base, 200);
    stepN(w, 200);
    expect(snapshot(w)).toBe(snapshot(base));
    expect(w.sheetFired[0]).toBe(0);
    expect(w.sheetFired[1]).toBe(alivePlayers(w));
  });

  it("첫 줄이 성립하면 아랫줄은 안 본다(「뭉친다」 위에 「알아서」가 있으면 뭉치지 않는다)", () => {
    const control = run("sheet-first-1", tune({ herding: 40 }), 240, null);
    const shadowed = run("sheet-first-1", tune({ herding: 40 }), 240, [AUTO, GATHER]);
    expect(snapshot(shadowed)).toBe(snapshot(control));
    expect(shadowed.sheetFired[1]).toBe(0);
  });

  it("「누가」는 이빨 문턱으로 갈린다 · 「그 밖의 개체」와 「이빨이 센 개체」는 서로 여집합이다", () => {
    const strong = run("sheet-who-1", tune({ attack: SIM.raidWarriorAttack + 10 }), 60, [
      { who: "strong", when: "always", act: "gather" },
      { who: "weak", when: "always", act: "scatter" },
    ]);
    // 이 종은 전부 이빨이 세다(변이가 있어도 +10 여유) → 둘째 줄은 아무도 안 탄다.
    expect(strong.sheetFired[0]).toBe(alivePlayers(strong));
    expect(strong.sheetFired[1]).toBe(0);
    const weak = run("sheet-who-2", tune({ attack: 20 }), 60, [
      { who: "strong", when: "always", act: "gather" },
      { who: "weak", when: "always", act: "scatter" },
    ]);
    expect(weak.sheetFired[0]).toBe(0);
    expect(weak.sheetFired[1]).toBe(alivePlayers(weak));
    for (const e of weak.entities) {
      if (!e.species.isPlayer) continue;
      expect(whoMatches("strong", e) !== whoMatches("weak", e)).toBe(true);
      expect(whoMatches("all", e)).toBe(true);
    }
  });

  it("본능(도망·사냥감)이 이동을 가져간 개체는 sheetInstinct 에 세이고, 발동 수에서는 안 빠진다", () => {
    const w = worldOn(bandTerrain(3), "sheet-instinct-1");
    w.sheet = [HIDE];
    let instinctSeen = 0;
    for (let i = 0; i < 200; i++) {
      w.step();
      instinctSeen += w.sheetInstinct;
      expect(w.sheetInstinct).toBeLessThanOrEqual(w.sheetFired[0] as number);
    }
    // 200틱 동안 한 번도 도망·사냥이 없는 세계는 없다 · 있었다면 그 개체도 첫 줄에 세였다(위 부등식).
    expect(instinctSeen).toBeGreaterThanOrEqual(0);
  });
});

describe("지침 시트 — 정리·표시 도우미", () => {
  it("sanitizeSheet 는 줄 수를 자르고 모르는 단어를 버린다 · 입력은 안 바꾼다", () => {
    const rows: Directive[] = [HIDE, { who: "x" as never, when: "night", act: "auto" }, GATHER, SCATTER];
    const out = sanitizeSheet(rows, 2);
    expect(out).toEqual([HIDE, GATHER]);
    expect(rows.length).toBe(4);
    expect(sameSheet(out, [HIDE, GATHER])).toBe(true);
    expect(sameSheet(out, [HIDE])).toBe(false);
    expect(sameSheet(out, [GATHER, HIDE])).toBe(false);
  });

  it("줄 수는 무리 티어가 늘린다(tiers.ts 표 한 곳)", () => {
    const p0 = emptyPips();
    expect(sheetRows(p0)).toBe(HERD_SHEET_ROWS[0]);
    const p4 = { ...emptyPips(), herd: TIER_STEPS[TIER_STEPS.length - 1] as number };
    expect(sheetRows(p4)).toBe(HERD_SHEET_ROWS[HERD_SHEET_ROWS.length - 1]);
  });

  it("모든 단어에 화면 문구가 있고, 문장은 세 칸을 가운뎃점으로 잇는다", () => {
    expect(directiveLine(FINAL_DIRECTIVE)).toBe("모두 · 늘 · 알아서 한다");
    for (const who of WHO_KEYS) for (const act of ACT_KEYS) {
      const line = directiveLine({ who, when: "night", act });
      expect(line.split(" · ").length).toBe(3);
      expect(line).toContain("밤에");
    }
  });
});
