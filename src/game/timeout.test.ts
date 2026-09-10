// 작전타임 · 지침 시트의 game 층 (**[사용자 2026-09-11]** 감독형 전환 · 계약은 docs/design/manager_instructions.md).
//
// 두 층을 잰다:
//   ① 멈춤과 복귀 — 작전타임을 열고 닫아도 세계가 1비트도 안 움직이고 그 자리로 돌아오는가
//      (genePanelPause.test.ts 와 같은 깊은 지문 · 같은 단계 넷 · 「유령 드래프트 멈춤」 전력이 있는 자리).
//   ② 규칙 — 예산(단계당 1회) · 자동 작전타임(보스·대멸종 시작) · 지침은 세계가 서 있을 때만 고친다 ·
//      고친 시트는 세계가 다시 도는 순간 판 코드에 남는다 · 시대를 넘어도 시트가 따라간다 · 일정표 파생.
import { describe, it, expect } from "vitest";
import { Game } from "@/game/game";
import { GAME, SCHEDULE } from "@/game/config";
import { HERD_SHEET_ROWS } from "@/sim/tiers";
import type { Directive } from "@/sim/instructions";

interface GamePriv {
  stageIndex: number;
  stageTicksLeft: number;
  acc: number;
  runSteps: number;
  beginStage(): void;
}
const priv = (g: Game): GamePriv => g as unknown as GamePriv;

function startRun(seed: string): Game {
  const g = new Game(240, 400, 1);
  g.fixedSeed = seed;
  g.beginRun();
  g.pickCard(0);
  return g;
}

/** genePanelPause.test.ts 의 깊은 지문과 같은 재료(rng 넷 · 남은 틱 · acc · 개체 좌표). */
function snapshot(g: Game): string {
  const w = g.world;
  const p = priv(g);
  const wild = (w as unknown as { wildEvoRng: { getState(): number } }).wildEvoRng;
  const rng = [w.rng, w.mutRng, w.geneRng, wild].map((r) => r.getState()).join(",");
  const ents = w.entities
    .map((e) => `${e.id}${e.alive ? "+" : "-"}${e.x.toFixed(6)},${e.y.toFixed(6)},${e.energy.toFixed(6)}`)
    .join(";");
  const b = w.boss;
  const boss = b === null ? "-" : `${b.name}/${b.hp.toFixed(4)}/${b.x.toFixed(4)},${b.y.toFixed(4)}`;
  return [
    `tick=${w.tick}`,
    `pop=${w.playerPopulation}`,
    `stage=${g.stageNumber}`,
    `idx=${p.stageIndex}`,
    `ticksLeft=${p.stageTicksLeft}`,
    `acc=${p.acc.toFixed(9)}`,
    `steps=${p.runSteps}`,
    `boss=${boss}`,
    `rng=${rng}`,
    `ents=${ents}`,
  ].join("|");
}

function pumpFrames(g: Game, n: number): void {
  for (let i = 0; i < n; i++) g.update(i % 17 === 16 ? 500 : 34);
}

const BOSS_AT = SCHEDULE.indexOf("boss");
const EXT_AT = SCHEDULE.lastIndexOf("extinction");

function makeForage(): Game | null {
  const g = startRun("to-forage");
  for (let i = 0; i < 60; i++) g.update(34);
  return g.phase === "watch" ? g : null;
}

function makeBoss(): Game | null {
  const g = startRun("to-boss");
  for (let i = 0; i < 30 && g.phase === "watch"; i++) g.update(34);
  if (g.phase !== "watch") return null;
  const p = priv(g);
  p.stageIndex = BOSS_AT;
  p.beginStage();
  for (let i = 0; i < 20 && g.phase === "watch"; i++) g.update(34);
  return g.phase === "watch" && g.world.boss !== null ? g : null;
}

function makeExtinction(): Game | null {
  const g = startRun("to-ext");
  for (let i = 0; i < 30 && g.phase === "watch"; i++) g.update(34);
  if (g.phase !== "watch") return null;
  const p = priv(g);
  p.stageIndex = EXT_AT;
  p.beginStage();
  for (let i = 0; i < 20 && g.phase === "watch"; i++) g.update(34);
  return g.phase === "watch" && g.stageLabel.startsWith("대멸종") ? g : null;
}

const CASES = [
  { label: "채집", make: makeForage },
  { label: "보스", make: makeBoss },
  { label: "대멸종", make: makeExtinction },
] as const;

const HIDE: Directive = { who: "all", when: "always", act: "hide" };
const GATHER: Directive = { who: "strong", when: "night", act: "gather" };

describe("작전타임 · 멈춤과 복귀 (단계 셋에서 열고 닫기)", () => {
  for (const c of CASES) {
    it(`${c.label}: 열면 세계가 1비트도 안 움직이고, 닫으면 그 자리로 정확히 돌아온다`, () => {
      const g = c.make();
      expect(g, `${c.label} 단계를 못 만들었다`).not.toBeNull();
      if (g === null) return;
      const before = snapshot(g);
      expect(g.openTimeout()).toBe(true);
      expect(g.phase).toBe("timeout");
      pumpFrames(g, 40);
      expect(snapshot(g), "열린 동안 세계가 움직였다").toBe(before);
      g.closeTimeout();
      expect(g.phase).toBe("watch");
      expect(snapshot(g), "닫는 순간 무언가 바뀌었다(acc 를 밀었나?)").toBe(before);
      // 닫은 뒤 같은 프레임을 넣으면 「안 연 판」과 같은 곳에 간다.
      const twin = c.make() as Game;
      pumpFrames(g, 30);
      pumpFrames(twin, 30);
      expect(snapshot(g)).toBe(snapshot(twin));
    });
  }
});

describe("작전타임 · 규칙", () => {
  it("단계마다 한 번만 부를 수 있고, 다음 단계에서 다시 채워진다", () => {
    const g = makeForage() as Game;
    expect(g.timeoutsLeft).toBe(GAME.timeoutsPerStage);
    expect(g.openTimeout()).toBe(true);
    expect(g.timeoutIsAuto).toBe(false);
    g.closeTimeout();
    expect(g.timeoutsLeft).toBe(0);
    expect(g.openTimeout(), "예산이 0 인데 열렸다").toBe(false);
    expect(g.phase).toBe("watch");
    priv(g).stageIndex = 1;
    priv(g).beginStage();
    expect(g.timeoutsLeft).toBe(GAME.timeoutsPerStage);
  });

  it("관전이 아니거나 멈춤 중이면 안 열린다 · 작전타임이 아니면 닫기는 아무 일도 안 한다", () => {
    const g = makeForage() as Game;
    g.paused = true;
    expect(g.openTimeout()).toBe(false);
    g.paused = false;
    g.closeTimeout();
    expect(g.phase).toBe("watch");
    expect(g.openGeneShop()).toBe(true);
    expect(g.openTimeout(), "구입 화면 위에 작전타임이 겹쳐 열렸다").toBe(false);
    g.closeTimeout(); // shop 인데 닫기를 불러도 shop 을 덮어쓰지 않는다
    expect(g.phase).toBe("shop");
  });

  it("autoTimeout 이 켜져 있으면 보스·대멸종 단계는 멈춘 채 시작하고, 채집은 그냥 돈다", () => {
    const g = startRun("to-auto");
    g.autoTimeout = true;
    for (let i = 0; i < 10 && g.phase === "watch"; i++) g.update(34);
    expect(g.phase, "채집 라운드가 자동으로 멈췄다").toBe("watch");
    const p = priv(g);
    p.stageIndex = BOSS_AT;
    p.beginStage();
    expect(g.phase).toBe("timeout");
    expect(g.timeoutIsAuto).toBe(true);
    expect(g.world.boss, "보스가 나타난 채 멈춰야 한다").not.toBeNull();
    expect(g.timeoutsLeft, "자동 작전타임이 예산을 썼다").toBe(GAME.timeoutsPerStage);
    const frozen = snapshot(g);
    pumpFrames(g, 20);
    expect(snapshot(g)).toBe(frozen);
    g.closeTimeout();
    expect(g.phase).toBe("watch");
    expect(g.timeoutIsAuto).toBe(false);
    pumpFrames(g, 5);
    expect(snapshot(g)).not.toBe(frozen);
    p.stageIndex = EXT_AT;
    p.beginStage();
    expect(g.phase).toBe("timeout");
  });
});

describe("지침 시트 · game 층", () => {
  it("관전 중에는 못 고치고, 작전타임·드래프트·구입에서는 고칠 수 있다", () => {
    const g = makeForage() as Game;
    expect(g.canEditSheet).toBe(false);
    expect(g.setSheet([HIDE])).toBe(false);
    expect(g.sheet.length).toBe(0);
    g.openTimeout();
    expect(g.canEditSheet).toBe(true);
    expect(g.setSheet([HIDE])).toBe(true);
    expect(g.sheet).toEqual([HIDE]);
    expect(g.world.sheet, "세계에 즉시 붙어야 한다").toBe(g.sheet);
    g.closeTimeout();
    g.openGeneShop();
    expect(g.canEditSheet).toBe(true);
    g.closeGeneShop();
  });

  it("줄 수는 무리 티어의 상한으로 잘린다", () => {
    const g = makeForage() as Game;
    g.openTimeout();
    const many: Directive[] = [HIDE, GATHER, HIDE, GATHER, HIDE, GATHER, HIDE, GATHER];
    g.setSheet(many);
    expect(g.maxSheetRows).toBe(HERD_SHEET_ROWS[0]);
    expect(g.sheet.length).toBe(HERD_SHEET_ROWS[0]);
  });

  it("고친 시트는 세계가 다시 도는 순간 판 코드에 한 번 남는다(열 번 고쳐도 하나)", () => {
    const g = makeForage() as Game;
    const before = g.runCodeData().entries.filter((e) => e.t === "sheet").length;
    g.openTimeout();
    g.setSheet([HIDE]);
    g.setSheet([GATHER]);
    g.setSheet([HIDE, GATHER]);
    expect(g.runCodeData().entries.filter((e) => e.t === "sheet").length, "닫기 전에 기록됐다").toBe(before);
    g.closeTimeout();
    const recs = g.runCodeData().entries.filter((e) => e.t === "sheet");
    expect(recs.length).toBe(before + 1);
    const last = recs[recs.length - 1];
    expect(last && last.t === "sheet" ? last.rows : null).toEqual([HIDE, GATHER]);
    // 같은 시트로 또 열고 닫으면 기록이 안 는다.
    priv(g).stageIndex = 1;
    priv(g).beginStage();
    g.openTimeout();
    g.setSheet([HIDE, GATHER]);
    g.closeTimeout();
    expect(g.runCodeData().entries.filter((e) => e.t === "sheet").length).toBe(before + 1);
  });

  it("시대를 넘어도 시트는 새 세계를 따라간다 · 새 런에서는 비워진다", () => {
    const g = makeForage() as Game;
    g.openTimeout();
    g.setSheet([HIDE]);
    g.closeTimeout();
    g.result = "win";
    g.continueToNextEra();
    expect(g.sheet).toEqual([HIDE]);
    expect(g.world.sheet).toBe(g.sheet);
    g.beginRun();
    expect(g.sheet.length).toBe(0);
    expect(g.world.sheet).toEqual([]);
  });

  it("빈 시트는 세계에 「알아서 한다」로 붙어 있다(발동 집계가 산다)", () => {
    const g = makeForage() as Game;
    expect(g.world.sheet).not.toBeNull();
    expect(g.world.sheetFired.length).toBe(1);
  });
});

describe("일정표", () => {
  it("이 시대의 단계 여섯을 SCHEDULE 순서대로 · 지금 단계 하나만 now", () => {
    const g = makeForage() as Game;
    const s = g.schedule;
    expect(s.length).toBe(SCHEDULE.length);
    expect(s.map((e) => e.kind)).toEqual([...SCHEDULE]);
    expect(s.filter((e) => e.state === "now").length).toBe(1);
    expect(s[0]?.state).toBe("now");
    expect(s[0]?.secondsLeft).toBe(g.secondsLeft);
    expect(s[1]?.secondsLeft).toBeNull();
    expect(s.map((e) => e.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("앞으로 올 보스의 종류는 적지 않고, 대멸종 종류는 적는다 · 지금 단계의 위협은 이름이 있다", () => {
    const g = makeForage() as Game;
    const ahead = g.schedule;
    for (const e of ahead) {
      if (e.kind === "boss") expect(e.threat, `${e.ordinal}단계 보스 종류가 미리 적혔다`).toBeNull();
      if (e.kind === "extinction") expect(e.threat).not.toBeNull();
    }
    const b = makeBoss() as Game;
    const now = b.schedule.find((e) => e.state === "now");
    expect(now?.kind).toBe("boss");
    expect(now?.threat).not.toBeNull();
    expect(b.schedule.filter((e) => e.state === "done").length).toBe(BOSS_AT);
  });

  it("로비에서는 전부 ahead", () => {
    const g = new Game(240, 400, 1);
    g.start();
    expect(g.schedule.every((e) => e.state === "ahead")).toBe(true);
  });
});
