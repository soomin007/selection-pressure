// 방울 구입 화면의 **멈춤과 복귀**: 단계 넷에서 열고 닫아도 그 자리로 정확히 돌아오는가.
//
// **[사용자 2026-08-09]** "방울 업그레이드 고르는 중에는 시간이 안 멈추나? 그거 보다보니
// 멸종해버렸는데" → 구입 화면이 열린 동안 시뮬을 멈추게 했다(드래프트와 같은 장치 = `phase`).
//
// ⚠ 이 저장소에는 「유령 드래프트 멈춤」 전력이 있다(2026-08-07 · 카드를 골랐는데 월드가 굳어 있었다).
//   멈추는 것보다 **정확히 풀리는 것**이 어렵다. 그래서 여기서는 두 층을 따로 잰다:
//     ① game 층: 단계 넷(채집·시험·보스·대멸종)에서 열고 닫아도 지문 한 자리도 안 달라지는가.
//     ② 화면 층: 멈춤을 푸는 유일한 통로인 `genePanel.setOpen` 이 **닫는 길마다** 풀어 주는가.
//   ②를 안 재면 "game 은 맞는데 화면이 안 풀어 줘서 영영 굳는" 자리가 통째로 안 재진다.
//   이 저장소에 jsdom 이 없어서(devDependencies 확인) genePanel 이 실제로 쓰는 만큼만 흉내 낸다.
//
// 기존 `game.test.ts` 의 같은 이름 블록과 겹치지 않게 여기서는 **더 깊은 지문**(남은 틱·프레임
// 잔여 시간 acc·rng 상태 넷·시험 진행도·단계 인덱스)을 쓰고, 보스·대멸종은 `debugSummon`(타이머를
// 99999 로 밀어 놓는 디버그 문)이 아니라 **진짜 단계 전이**(`beginStage`)로 만든다.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Game } from "@/game/game";
import { SCHEDULE } from "@/game/config";
import { CATEGORIES } from "@/sim/tiers";
import { createGenePanel, type GeneShop } from "@/ui/genePanel";
import type { GenePanel } from "@/ui/genePanel";

// ---------------------------------------------------------------------------
// 공용 · 런 만들기 · 깊은 지문
// ---------------------------------------------------------------------------

/** 사적인 자리(단계 인덱스·남은 틱·프레임 잔여)를 읽는다. 멈춤이 이것들을 안 건드리는 것이 계약이다. */
interface GamePriv {
  stageIndex: number;
  stageTicksLeft: number;
  acc: number;
  runSteps: number;
  geneBankValue: number;
  beginStage(): void;
}
const priv = (g: Game): GamePriv => g as unknown as GamePriv;

/** 한 런을 시작해 첫 프리셋을 고른 상태(watch)로 만든다(game.test.ts 와 같은 소형 세계). */
function startRun(seed: string): Game {
  const g = new Game(240, 400, 1);
  g.fixedSeed = seed;
  g.beginRun();
  g.pickCard(0);
  return g;
}

/**
 * 이 판의 **깊은 지문**. 개체 좌표뿐 아니라 rng 상태 넷까지 넣는다. 멈춘 동안 난수를 한 번이라도
 * 뽑았으면 좌표가 우연히 같아도 여기서 갈린다(야생 rng 소비 순서가 이 게임의 밸런스 그 자체다).
 */
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
  const o = w.herdOrder;
  const order = o === null ? "-" : `${o.kind ?? "move"}@${o.x.toFixed(3)},${o.y.toFixed(3)}/${(o.ticks ?? 0).toFixed(4)}`;
  const drops = w.geneDrops.map((d) => `${d.reason}${d.taken ? "T" : "F"}${d.amount}`).join("/");
  return [
    `tick=${w.tick}`,
    `pop=${w.playerPopulation}`,
    `eat=${w.playerFoodEaten}`,
    `hunt=${w.playerHuntKills}`,
    `counts=${JSON.stringify(w.roundCounts)}`,
    `drops=${drops}`,
    `collected=${w.geneCollected}`,
    `bank=${g.geneBank}`,
    `xp=${g.xp}`,
    `lv=${g.level}`,
    `embers=${g.embers}`,
    `stage=${g.stageNumber}`,
    `idx=${p.stageIndex}`,
    `label=${g.stageLabel}`,
    `ticksLeft=${p.stageTicksLeft}`,
    `acc=${p.acc.toFixed(9)}`,
    `steps=${p.runSteps}`,
    `sec=${g.secondsLeft}`,
    `need=${g.survivorsNeeded}`,
    `trial=${g.trial?.label ?? "-"}/${g.trialProgress}`,
    `peak=${g.peakPopulation}`,
    `boss=${boss}`,
    `order=${order}`,
    `rng=${rng}`,
    `ents=${ents}`,
  ].join("|");
}

/** 멈춘 동안에도 프레임은 계속 들어온다. 크기가 제각각인 프레임을 섞어 넣는다(긴 프레임 포함). */
function pumpFrames(g: Game, n: number): void {
  for (let i = 0; i < n; i++) g.update(i % 17 === 16 ? 500 : 34);
}

// ---------------------------------------------------------------------------
// 단계 넷 만들기 · 보스·대멸종은 **진짜 단계 전이**로(디버그 소환이 아니다)
// ---------------------------------------------------------------------------

interface StageCase {
  readonly label: string;
  readonly make: () => Game | null;
}

const BOSS_AT = SCHEDULE.indexOf("boss");
const EXT_AT = SCHEDULE.lastIndexOf("extinction");

function makeForage(): Game | null {
  const g = startRun("panel-forage");
  for (let i = 0; i < 60; i++) g.update(34);
  return g.phase === "watch" ? g : null;
}

/** 시험은 진도 1 부터 붙는다(저장본 없는 테스트에서는 진도 = 시대) → 둘째 시대로 밀어 놓고 찾는다. */
function makeTrial(): Game | null {
  for (let k = 0; k < 12; k++) {
    const t = startRun(`panel-trial-${k}`);
    t.result = "win";
    t.continueToNextEra();
    let guard = 0;
    while (t.phase === "draft" && guard++ < 8) t.pickCard(0);
    for (let i = 0; i < 60 && t.phase === "watch"; i++) t.update(34);
    if (t.phase === "watch" && t.trial !== null) return t;
  }
  return null;
}

function makeBoss(): Game | null {
  const g = startRun("panel-boss");
  for (let i = 0; i < 30 && g.phase === "watch"; i++) g.update(34);
  if (g.phase !== "watch") return null;
  const p = priv(g);
  p.stageIndex = BOSS_AT;
  p.beginStage(); // 진짜 관문 전이. 보스가 태어나고 타이머가 bossSeconds 로 채워진다
  for (let i = 0; i < 20 && g.phase === "watch"; i++) g.update(34);
  return g.phase === "watch" && g.world.boss !== null ? g : null;
}

function makeExtinction(): Game | null {
  const g = startRun("panel-ext");
  for (let i = 0; i < 30 && g.phase === "watch"; i++) g.update(34);
  if (g.phase !== "watch") return null;
  const p = priv(g);
  p.stageIndex = EXT_AT;
  p.beginStage(); // 진짜 대멸종 전이. applyExtinction 이 세계를 바꾼다
  for (let i = 0; i < 20 && g.phase === "watch"; i++) g.update(34);
  return g.phase === "watch" && g.stageLabel.startsWith("대멸종") ? g : null;
}

const CASES: readonly StageCase[] = [
  { label: "채집", make: makeForage },
  { label: "시험", make: makeTrial },
  { label: "보스", make: makeBoss },
  { label: "대멸종", make: makeExtinction },
];

// ---------------------------------------------------------------------------
// ① game 층 · 단계 넷에서 열고 닫기
// ---------------------------------------------------------------------------

describe("구입 화면 멈춤 · 단계 넷에서 열고 닫기", () => {
  it("단계 넷을 실제로 만들 수 있다(아래 표가 아무것도 안 재는 일이 없게)", () => {
    expect(BOSS_AT, "SCHEDULE 에 보스 단계가 없다").toBeGreaterThanOrEqual(0);
    expect(EXT_AT, "SCHEDULE 에 대멸종 단계가 없다").toBeGreaterThanOrEqual(0);
    for (const c of CASES) {
      const g = c.make();
      expect(g, `${c.label} 단계를 못 만들었다`).not.toBeNull();
    }
  });

  for (const c of CASES) {
    it(`${c.label}: 열면 세계가 1비트도 안 움직이고, 닫으면 그 자리로 정확히 돌아온다`, () => {
      const g = c.make();
      expect(g, `${c.label} 단계를 못 만들었다`).not.toBeNull();
      if (g === null) return;
      expect(g.phase, "전제가 관전이 아니다").toBe("watch");

      const before = snapshot(g);
      expect(g.openGeneShop(), "화면이 안 열렸다").toBe(true);
      expect(g.phase).toBe("shop");

      pumpFrames(g, 240); // 8초어치 프레임 + 긴 프레임 몇 개
      expect(snapshot(g), `${c.label}: 멈춘 동안 세계가 움직였다`).toBe(before);

      g.closeGeneShop();
      expect(g.phase, `${c.label}: 닫았는데 관전으로 안 돌아왔다`).toBe("watch");
      expect(snapshot(g), `${c.label}: 닫는 순간 상태가 달라졌다`).toBe(before);

      // 다시 흐른다. 그리고 **그 단계 그대로** 흐른다(단계 번호·라벨이 안 바뀐다).
      const tick0 = g.world.tick;
      const stage0 = g.stageNumber;
      const label0 = g.stageLabel;
      for (let i = 0; i < 3; i++) g.update(34);
      expect(g.world.tick, `${c.label}: 닫았는데 시간이 안 흐른다`).toBeGreaterThan(tick0);
      expect(g.stageNumber, `${c.label}: 단계가 건너뛰었다`).toBe(stage0);
      expect(g.stageLabel).toBe(label0);
    });

    it(`${c.label}: 열었다 닫은 판은 한 번도 안 연 판과 **깊은 지문까지** 같다`, () => {
      const a = c.make();
      const b = c.make();
      expect(a, `${c.label} 단계를 못 만들었다`).not.toBeNull();
      expect(b).not.toBeNull();
      if (a === null || b === null) return;
      expect(snapshot(a), "전제: 같은 시드의 두 판이 같은 자리에서 시작한다").toBe(snapshot(b));

      for (let i = 0; i < 150; i++) a.update(34);

      for (let i = 0; i < 40; i++) b.update(34);
      expect(b.openGeneShop(), "화면이 안 열렸다").toBe(true);
      pumpFrames(b, 400); // 화면을 오래 들여다본다(13초어치)
      b.closeGeneShop();
      for (let i = 0; i < 110; i++) b.update(34);

      expect(b.phase, `${c.label}: 단계가 갈렸다`).toBe(a.phase);
      expect(snapshot(b), `${c.label}: 멈춤이 판을 바꿨다(결정론 위반)`).toBe(snapshot(a));
    });
  }

  it("두 번 열어도 멈춤이 두 겹으로 안 쌓인다 · 한 번 닫으면 확실히 풀린다", () => {
    const g = makeForage();
    expect(g).not.toBeNull();
    if (g === null) return;
    expect(g.openGeneShop()).toBe(true);
    expect(g.openGeneShop(), "두 번째 열기가 성공하면 멈춤이 겹칠 수 있다").toBe(false);
    expect(g.phase).toBe("shop");
    g.closeGeneShop(); // 한 번만 닫는다
    expect(g.phase, "한 번 닫았는데 안 풀렸다(유령 멈춤)").toBe("watch");
    const t0 = g.world.tick;
    for (let i = 0; i < 3; i++) g.update(34);
    expect(g.world.tick).toBeGreaterThan(t0);
    // 남는 닫기는 아무 일도 안 한다(남의 단계를 덮어쓰지 않는다).
    g.closeGeneShop();
    expect(g.phase).toBe("watch");
  });

  it("여닫기를 되풀이해도 매번 다시 흐른다(멈춤이 새지 않는다)", () => {
    const g = makeForage();
    expect(g).not.toBeNull();
    if (g === null) return;
    let last = g.world.tick;
    for (let cycle = 0; cycle < 5; cycle++) {
      expect(g.openGeneShop(), `${cycle}회차: 못 열었다`).toBe(true);
      pumpFrames(g, 30);
      expect(g.world.tick, `${cycle}회차: 멈춘 동안 틱이 돌았다`).toBe(last);
      g.closeGeneShop();
      expect(g.phase).toBe("watch");
      for (let i = 0; i < 10; i++) g.update(34);
      expect(g.world.tick, `${cycle}회차: 닫았는데 안 흐른다`).toBeGreaterThan(last);
      last = g.world.tick;
    }
  });

  it("멈춘 동안에는 카드창·판정·런 종료가 하나도 안 열린다(라운드 몇 개 분량을 밀어 넣어도)", () => {
    const g = makeForage();
    expect(g).not.toBeNull();
    if (g === null) return;
    let drafts = 0;
    let verdicts = 0;
    let results = 0;
    g.onDraft = (): void => {
      drafts += 1;
    };
    g.onTrialVerdict = (): void => {
      verdicts += 1;
    };
    g.onResult = (): void => {
      results += 1;
    };
    const stage0 = g.stageNumber;
    expect(g.openGeneShop()).toBe(true);
    for (let i = 0; i < 2000; i++) g.update(34); // 68초 = 채집 라운드(16초) 네 번 분량
    expect(drafts, "멈춘 동안 카드창이 열렸다").toBe(0);
    expect(verdicts, "멈춘 동안 시험 판정이 났다").toBe(0);
    expect(results, "멈춘 동안 런이 끝났다").toBe(0);
    expect(g.phase).toBe("shop");
    expect(g.stageNumber, "멈춘 동안 단계가 넘어갔다").toBe(stage0);
    g.closeGeneShop();
    expect(g.phase).toBe("watch");
  });

  it("멈춘 동안 내려진 명령·지휘봉·디버그 소환이 세계를 못 건드린다", () => {
    const g = makeForage();
    expect(g).not.toBeNull();
    if (g === null) return;
    const c = g.world.playerCentroid();
    expect(g.setHerdOrder(c.x + 20, c.y + 20, "move"), "전제: 지시를 내릴 수 있는 상태").toBe(true);
    const before = snapshot(g);
    expect(g.openGeneShop()).toBe(true);
    expect(g.setHerdOrder(c.x - 40, c.y - 40, "move"), "멈춘 동안 새 지시가 먹혔다").toBe(false);
    const first = g.world.entities.find((e) => e.alive && e.species.isPlayer);
    if (first) expect(g.passBaton(first.id), "멈춘 동안 지휘봉이 옮겨졌다").toBe(false);
    g.debugSummon("raider"); // 관전이 아니면 아무 일도 안 해야 한다
    pumpFrames(g, 60);
    expect(snapshot(g), "멈춘 동안 세계가 건드려졌다").toBe(before);
    g.closeGeneShop();
    expect(g.phase).toBe("watch");
  });

  it("멈춤 버튼으로 세워 둔 판에서 열고 닫아도 그 멈춤은 그대로다(멈춤 둘이 안 엉킨다)", () => {
    const g = makeForage();
    expect(g).not.toBeNull();
    if (g === null) return;
    g.paused = true; // 사람이 건 멈춤
    const before = snapshot(g);
    expect(g.openGeneShop(), "멈춰 둔 판에서는 구입 화면이 안 열린다").toBe(true);
    pumpFrames(g, 60);
    expect(snapshot(g)).toBe(before);
    g.closeGeneShop();
    expect(g.phase).toBe("watch");
    expect(g.paused, "구입 화면이 사람이 건 멈춤을 대신 풀어 버렸다").toBe(true);
    pumpFrames(g, 60);
    expect(snapshot(g), "닫았더니 멈춤 버튼이 무시됐다").toBe(before);
    g.paused = false;
    const t0 = g.world.tick;
    for (let i = 0; i < 3; i++) g.update(34);
    expect(g.world.tick, "멈춤을 풀었는데 안 흐른다").toBeGreaterThan(t0);
  });

  it("단계가 끝나기 직전에 열고 닫아도 끝나는 자리가 안 밀린다", () => {
    const control = makeForage();
    const test = makeForage();
    expect(control).not.toBeNull();
    expect(test).not.toBeNull();
    if (control === null || test === null) return;
    priv(control).stageTicksLeft = 2; // 두 틱 뒤에 라운드가 끝난다
    priv(test).stageTicksLeft = 2;

    for (let i = 0; i < 12; i++) control.update(34);
    expect(test.openGeneShop()).toBe(true);
    pumpFrames(test, 200);
    test.closeGeneShop();
    for (let i = 0; i < 12; i++) test.update(34);

    expect(test.phase, "경계에서 멈췄더니 단계 전이가 갈렸다").toBe(control.phase);
    expect(snapshot(test), "경계에서 멈췄더니 판이 갈렸다").toBe(snapshot(control));
  });

  it("관전이 아니면 아예 안 열리고, 그 단계를 덮어쓰지도 않는다", () => {
    const g = new Game(240, 400, 1);
    g.fixedSeed = "panel-gate";
    g.beginRun(); // 프리셋 선택 드래프트
    expect(g.phase).toBe("draft");
    expect(g.openGeneShop()).toBe(false);
    expect(g.phase).toBe("draft");
    g.closeGeneShop();
    expect(g.phase, "열리지도 않았는데 닫기가 단계를 관전으로 바꿨다").toBe("draft");
  });
});

// ---------------------------------------------------------------------------
// ② 화면 층 · 멈춤을 푸는 유일한 통로(genePanel.setOpen)
//
// jsdom 이 없으므로 genePanel 이 실제로 쓰는 DOM 만 흉내 낸다(createElement · append ·
// classList · addEventListener · getElementById · rAF). 흉내가 모자라면 createGenePanel 이
// 곧바로 터지므로 "조용히 아무것도 안 재는" 상태가 될 수 없다.
// ---------------------------------------------------------------------------

class FakeEl {
  className = "";
  id = "";
  type = "";
  title = "";
  disabled = false;
  scrollTop = 0;
  textContent = "";
  readonly kids: FakeEl[] = [];
  readonly style: Record<string, string> = {};
  readonly classes = new Set<string>();
  private readonly handlers = new Map<string, ((e: unknown) => void)[]>();
  private readonly attrs = new Map<string, string>();
  constructor(readonly tagName: string) {}
  appendChild(k: FakeEl): FakeEl {
    this.kids.push(k);
    return k;
  }
  append(...ks: FakeEl[]): void {
    for (const k of ks) this.kids.push(k);
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  get classList(): { toggle: (name: string, on: boolean) => void } {
    return {
      toggle: (name: string, on: boolean): void => {
        if (on) this.classes.add(name);
        else this.classes.delete(name);
      },
    };
  }
  /** 이 요소에 등록된 손잡이를 실제로 당긴다(닫기 버튼·바깥 탭·범주 줄). */
  fire(type: string, ev: unknown): number {
    const list = this.handlers.get(type) ?? [];
    for (const fn of list) fn(ev);
    return list.length;
  }
}

const created: FakeEl[] = [];
const docKeyHandlers: ((e: unknown) => void)[] = [];
const fakeDoc = {
  body: new FakeEl("body"),
  head: new FakeEl("head"),
  activeElement: null,
  createElement: (tag: string): FakeEl => {
    const el = new FakeEl(tag);
    created.push(el);
    return el;
  },
  getElementById: (id: string): FakeEl | null => created.find((e) => e.id === id) ?? null,
  addEventListener: (type: string, fn: (e: unknown) => void): void => {
    if (type === "keydown") docKeyHandlers.push(fn);
  },
};

let rafSeq = 1;
const rafQueue = new Map<number, () => void>();
const fakeRaf = (cb: () => void): number => {
  const id = rafSeq;
  rafSeq += 1;
  rafQueue.set(id, cb);
  return id;
};
const fakeCancelRaf = (id: number): void => {
  rafQueue.delete(id);
};
/** 프레임 n 개를 실제로 흘린다. 열려 있는 동안 도는 갱신 루프(render)를 진짜로 돌려 본다. */
function flushFrames(n: number): void {
  for (let i = 0; i < n; i++) {
    const cbs = [...rafQueue.values()];
    rafQueue.clear();
    for (const cb of cbs) cb();
  }
}

interface GlobalPatch {
  document?: unknown;
  requestAnimationFrame?: unknown;
  cancelAnimationFrame?: unknown;
  HTMLElement?: unknown;
}
const gl = globalThis as unknown as GlobalPatch;

/** 클래스 이름이 정확히 일치하는 요소를 찾는다(만들어질 때의 이름 기준). */
function findAll(root: FakeEl, cls: string): FakeEl[] {
  const out: FakeEl[] = [];
  const walk = (el: FakeEl): void => {
    if (el.className === cls) out.push(el);
    for (const k of el.kids) walk(k);
  };
  walk(root);
  return out;
}
function findOne(root: FakeEl, cls: string): FakeEl {
  const hit = findAll(root, cls)[0];
  if (hit === undefined) throw new Error(`화면에 ${cls} 가 없다(흉내 DOM 이 모자라거나 화면이 바뀌었다)`);
  return hit;
}
/** 방금 만들어진 이 패널의 뿌리(.gene-root) · 패널마다 하나씩 body 에 붙는다. */
function lastRoot(): FakeEl {
  const roots = findAll(fakeDoc.body, "gene-root");
  const last = roots[roots.length - 1];
  if (last === undefined) throw new Error("gene-root 가 body 에 안 붙었다");
  return last;
}

describe("구입 화면 멈춤 · 화면과 game 의 배선(genePanel)", () => {
  beforeAll(() => {
    gl.document = fakeDoc;
    gl.requestAnimationFrame = fakeRaf;
    gl.cancelAnimationFrame = fakeCancelRaf;
    gl.HTMLElement = class {};
  });
  afterAll(() => {
    delete gl.document;
    delete gl.requestAnimationFrame;
    delete gl.cancelAnimationFrame;
    delete gl.HTMLElement;
  });

  /** main.ts 가 넘기는 것과 **같은 모양의 감싼 객체**(산 직후 스스로 닫는 것까지 같다). */
  function wireShop(g: Game, hold: { panel: GenePanel | null }): GeneShop {
    return {
      get geneBank(): number {
        return g.geneBank;
      },
      get genome(): Game["genome"] {
        return g.genome;
      },
      tierCost: (cat): number => g.tierCost(cat),
      canBuyTier: (cat): boolean => g.canBuyTier(cat),
      buyTier: (cat): boolean => {
        if (!g.buyTier(cat)) return false;
        hold.panel?.close(); // main.ts 와 같다. 승급 연출이 패널을 덮으므로 먼저 접는다
        return true;
      },
      freeze: (): boolean => g.openGeneShop(),
      thaw: (): void => g.closeGeneShop(),
    };
  }

  function wired(seed: string): { g: Game; panel: GenePanel; root: FakeEl } {
    const g = startRun(seed);
    for (let i = 0; i < 60; i++) g.update(34);
    const hold: { panel: GenePanel | null } = { panel: null };
    const panel = createGenePanel(wireShop(g, hold));
    hold.panel = panel;
    return { g, panel, root: lastRoot() };
  }

  it("패널을 열면 game 이 멈추고, 닫으면 그 자리에서 다시 흐른다(실제 배선 그대로)", () => {
    const { g, panel } = wired("panel-wire");
    expect(g.phase).toBe("watch");
    const before = snapshot(g);

    panel.open();
    expect(panel.isOpen()).toBe(true);
    expect(g.phase, "화면은 열렸는데 시간이 안 멈췄다").toBe("shop");
    pumpFrames(g, 200);
    flushFrames(5); // 갱신 루프도 실제로 돌려 본다(그려도 세계를 안 건드려야 한다)
    expect(snapshot(g), "화면이 열린 동안 세계가 움직였다").toBe(before);

    panel.close();
    expect(panel.isOpen()).toBe(false);
    expect(g.phase, "닫았는데 시간이 안 흐른다(유령 멈춤)").toBe("watch");
    expect(snapshot(g)).toBe(before);
    const t0 = g.world.tick;
    for (let i = 0; i < 3; i++) g.update(34);
    expect(g.world.tick).toBeGreaterThan(t0);
  });

  it("닫는 길 셋(닫기 버튼 · 바깥 탭 · Esc)이 전부 멈춤을 푼다", () => {
    const { g, panel, root } = wired("panel-close-paths");

    // ① 닫기 버튼
    panel.open();
    expect(g.phase).toBe("shop");
    expect(findOne(root, "gene-close").fire("click", {}), "닫기 버튼에 손잡이가 없다").toBeGreaterThan(0);
    expect(panel.isOpen()).toBe(false);
    expect(g.phase, "닫기 버튼으로 닫았는데 안 풀렸다").toBe("watch");

    // ② 바깥(딤) 탭 · target 이 뿌리 자신일 때만 닫힌다
    panel.open();
    expect(g.phase).toBe("shop");
    root.fire("click", { target: root });
    expect(panel.isOpen()).toBe(false);
    expect(g.phase, "바깥을 탭해 닫았는데 안 풀렸다").toBe("watch");

    // ③ Esc · 키 라우터를 통해 들어온다
    panel.open();
    expect(g.phase).toBe("shop");
    expect(docKeyHandlers.length, "키 라우터가 설치되지 않았다").toBeGreaterThan(0);
    for (const fn of docKeyHandlers) {
      fn({ code: "Escape", ctrlKey: false, metaKey: false, altKey: false, isComposing: false, preventDefault: () => {} });
    }
    expect(panel.isOpen()).toBe(false);
    expect(g.phase, "Esc 로 닫았는데 안 풀렸다").toBe("watch");
  });

  it("사고 나면 게임이 굳는 자리 · **산 직후 스스로 닫히는 길**도 멈춤을 푼다", () => {
    const { g, panel, root } = wired("panel-buy");
    priv(g).geneBankValue = 99; // 무엇이든 살 수 있게
    const cat = CATEGORIES[0];
    expect(cat).toBeDefined();
    if (cat === undefined) return;
    const pipsBefore = g.genome.pips[cat];

    panel.open();
    expect(g.phase).toBe("shop");
    const rows = findAll(root, "gene-row");
    expect(rows.length, "범주 줄이 하나도 없다").toBe(CATEGORIES.length);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    row.fire("click", {}); // 첫 범주를 산다 → main 과 같은 감싼 객체가 패널을 닫는다

    expect(g.genome.pips[cat], "구입이 안 됐다(이 테스트가 아무것도 안 재고 있다)").toBeGreaterThan(pipsBefore);
    expect(g.geneBank).toBeLessThan(99);
    expect(panel.isOpen(), "산 뒤에 화면이 안 닫혔다").toBe(false);
    expect(g.phase, "샀더니 게임이 영영 멈춰 있다").toBe("watch");
    const t0 = g.world.tick;
    for (let i = 0; i < 3; i++) g.update(34);
    expect(g.world.tick).toBeGreaterThan(t0);

    // 산 뒤에도 다시 열린다(문이 한 번 쓰고 죽지 않는다).
    panel.open();
    expect(g.phase).toBe("shop");
    panel.close();
    expect(g.phase).toBe("watch");
  });

  it("바깥에서 단계가 이미 바뀐 뒤에 화면이 뒤늦게 닫혀도 그 단계를 안 덮어쓴다", () => {
    // main.ts 의 강제 닫기 자리 셋(드래프트가 열림 · 런 종료 · 새 세계)은 game 이 단계를 **이미
    // 바꾼 뒤**에 온다. 그때 닫기가 단계를 관전으로 되돌리면, 카드창이 뜬 채로 세계가 흐르는
    // 「유령 드래프트」의 정확한 반대편이 생긴다.
    const { g, panel } = wired("panel-late-close");
    panel.open();
    expect(g.phase).toBe("shop");
    g.phase = "draft"; // 게임이 먼저 다음 화면으로 옮겨 앉았다(openPendingDraft 가 하는 일)
    panel.close(); // 그 뒤에야 화면이 닫힌다
    expect(panel.isOpen()).toBe(false);
    expect(g.phase, "닫기가 남의 단계를 관전으로 덮어썼다").toBe("draft");
  });

  it("열 수 없는 때는 화면이 안 뜨고, 풀어 주지도 않는다(멈추지 않은 채 떠 있는 화면 금지)", () => {
    let freezes = 0;
    let thaws = 0;
    let allow = false;
    const g = startRun("panel-deny");
    const stub: GeneShop = {
      get geneBank(): number {
        return g.geneBank;
      },
      get genome(): Game["genome"] {
        return g.genome;
      },
      tierCost: (cat): number => g.tierCost(cat),
      canBuyTier: (): boolean => false,
      buyTier: (): boolean => false,
      freeze: (): boolean => {
        freezes += 1;
        return allow;
      },
      thaw: (): void => {
        thaws += 1;
      },
    };
    const panel = createGenePanel(stub);

    panel.open(); // 거절당한다
    expect(panel.isOpen(), "멈추지도 않았는데 화면이 떴다").toBe(false);
    expect(freezes).toBe(1);
    expect(thaws, "열리지도 않았는데 풀어 줬다(짝이 안 맞는 thaw)").toBe(0);
    panel.close();
    expect(thaws, "안 열린 화면을 닫았는데 풀어 줬다").toBe(0);

    allow = true;
    panel.open();
    expect(panel.isOpen()).toBe(true);
    expect(freezes).toBe(2);
    panel.open(); // 이미 열려 있다. 멈춤을 두 겹으로 걸지 않는다
    expect(freezes, "이미 열린 화면이 멈춤을 한 번 더 걸었다").toBe(2);
    panel.close();
    expect(thaws).toBe(1);
    panel.close(); // 이미 닫혀 있다
    expect(thaws, "닫힌 화면이 또 풀어 줬다").toBe(1);
    panel.toggle();
    expect(freezes).toBe(3);
    panel.toggle();
    expect(thaws, "여닫기 짝이 안 맞는다").toBe(2);
  });
});
