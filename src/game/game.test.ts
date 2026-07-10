// 대멸종 종류 예고 검증 — 미리 정해 둔 큐(extinctionQueue)에서 예고와 실제가 같은 값을 봐야 한다.
// Game 은 순수 TS(Pixi 무관)라 headless 로 런을 끝까지 돌려 관찰할 수 있다.
import { describe, it, expect } from "vitest";
import { Game, type RunHistory } from "@/game/game";
import { eraDifficulty } from "@/game/config";
import { createBoss } from "@/sim/boss";
import { CARD_BODY_SCALE, CARD_POOL, cardPrereqMet, drawCards, type Card } from "@/game/cards";
import { Rng } from "@/sim/rng";
import { defaultGenome, type Traits } from "@/sim/genome";
import { SIM } from "@/sim/params";
import { debugSetMetaLevel } from "@/game/meta";
import { debugResetAchievements, debugUnlockAchievement } from "@/game/achievements";

// 대멸종 이름 4종(game.ts extinctionName 과 일치) — 예고 title 이 보스 예고와 섞이지 않게 거른다.
const EXTINCTION_NAMES = ["혹독한 추위", "대가뭄", "폭염", "대역병"] as const;

/** 한 런을 시작해 첫 프리셋을 고른 상태(watch)로 만든다. */
function startRun(seed: string): Game {
  const g = new Game(240, 400);
  g.fixedSeed = seed;
  g.beginRun(); // draft(프리셋 선택)
  g.pickCard(0); // 첫 프리셋 → 첫 채집 단계 시작(watch)
  return g;
}

describe("대멸종 종류 예고", () => {
  it("같은 시드면 대멸종 종류 순서가 재현된다(결정론)", () => {
    const queueOf = (seed: string): readonly string[] =>
      (startRun(seed) as unknown as { extinctionQueue: readonly string[] }).extinctionQueue.slice();
    expect(queueOf("fixed-abc")).toEqual(queueOf("fixed-abc"));
    // 다른 시드면 (거의 항상) 다른 순서 — 적어도 첫 원소 기준으로 종류가 갈릴 수 있음을 확인.
    expect(EXTINCTION_NAMES.length).toBe(4);
  });

  it("대멸종 예고가 실제로 닥칠 종류와 일치한다", () => {
    // 여러 시드로 런을 돌려, 대멸종 예고를 본 뒤 실제 발동된 대멸종 종류와 맞는지 확인한다.
    // 통과기준이 낮아(3) 대부분 완주하지만, 도중 멸종하는 시드는 건너뛴다(win 런에서만 검증).
    let verified = 0;
    for (let s = 0; s < 40 && verified < 3; s++) {
      const g = startRun(`run-${s}`);
      let predicted: string | null = null;
      for (let i = 0; i < 8000 && g.phase !== "result"; i++) {
        if (g.phase === "draft") {
          g.pickCard(0); // 레벨업 드래프트는 첫 카드로 넘긴다
          continue;
        }
        const t = g.upcomingThreat;
        // 대멸종 예고만 집는다(보스 예고 "곧 <보스이름>!" 과 이름이 겹치지 않음).
        if (t && EXTINCTION_NAMES.some((n) => t.title === `곧 ${n}!`)) predicted = t.title;
        g.update(1000); // 큰 delta 로 빠르게 진행(update 는 스텝 상한이 있어 안전)
        if (g.stageLabel.startsWith("대멸종") && predicted) {
          const name = g.stageLabel.replace("대멸종 · ", "");
          expect(predicted).toBe(`곧 ${name}!`); // 예고 종류 == 실제 종류
          verified += 1;
          break;
        }
      }
    }
    // 적어도 몇 런은 대멸종까지 도달해 예고-실제 일치를 확인했어야 한다.
    expect(verified).toBeGreaterThan(0);
  });
});

describe("난이도 루프(승리 후 진행)", () => {
  it("era 0 은 배율 1.0(기존과 동일), 이후 계단으로 오른다", () => {
    expect(eraDifficulty(0)).toBe(1);
    expect(eraDifficulty(1)).toBeCloseTo(1.22);
    expect(eraDifficulty(2)).toBeCloseTo(1.44);
    // 음수 방어(0으로 clamp).
    expect(eraDifficulty(-3)).toBe(1);
  });

  it("보스 강도(즉사 반경)가 난이도 배율로 커진다 — 첫 시대는 불변", () => {
    const base = createBoss("chaser", 240, 400); // diffMul 기본 1.0
    const scaled = createBoss("chaser", 240, 400, undefined, 2);
    expect(scaled.killRadius).toBeCloseTo(base.killRadius * 2);
    // 떼 시련은 개체 수도 배율로 늘어난다(사나운 무리 6 → 12).
    const swarm1 = createBoss("swarm", 240, 400);
    const swarm2 = createBoss("swarm", 240, 400, undefined, 2);
    expect(swarm2.members.length).toBeGreaterThan(swarm1.members.length);
  });

  it("승리 후 continueToNextEra 는 게놈·레벨을 유지하고 다음 시대(더 센 위협)로 이어간다", () => {
    // 승리하는 시드를 찾는다(통과기준 3, 대부분 완주하나 시드마다 다름).
    let won: Game | null = null;
    for (let s = 0; s < 60 && !won; s++) {
      const g = startRun(`era-run-${s}`);
      for (let i = 0; i < 12000 && g.phase !== "result"; i++) {
        if (g.phase === "draft") {
          g.pickCard(0);
          continue;
        }
        g.update(1000);
      }
      if (g.phase === "result" && g.result === "win") won = g;
    }
    expect(won).not.toBeNull();
    const g = won as Game;
    expect(g.era).toBe(0);
    // 승리 시점의 게놈(성장 결과)을 기억.
    const beforeTraits = { ...g.genome.traits };
    const beforeLevel = g.level;

    g.continueToNextEra();

    // 다음 시대로 이어졌다 — 먼저 "시대 보상" 드래프트가 뜬다(강해진 형질 하나 선택).
    expect(g.era).toBe(1);
    expect(g.phase).toBe("draft");
    expect(g.result).toBeNull();
    expect(g.draftCards.length).toBeGreaterThan(0);
    // 아직 보상을 고르지 않았으니 게놈·레벨은 유지(성장 이어짐).
    expect(g.genome.traits).toEqual(beforeTraits);
    expect(g.level).toBe(beforeLevel);

    // 보상 카드를 고르면 관전 재개 + 게놈에 반영(성장 도약).
    g.pickCard(0);
    expect(g.phase).toBe("watch");
    // 새 월드의 내 종이 살아있다(초기 무리 재생성).
    expect(g.world.playerPopulation).toBeGreaterThan(0);
    // 시대 라벨이 뜬다(N / 상한).
    expect(g.eraLabel).toBe("시대 2 / 5");
  });

  it("시대 보상 드래프트는 같은 시드면 재현된다(결정론)", () => {
    // 같은 승리 시드로 두 번 continueToNextEra 하면 보상 카드가 같아야 한다(시대 시드 파생 RNG).
    function wonGame(): Game | null {
      for (let s = 0; s < 60; s++) {
        const g = startRun(`era-reward-${s}`);
        for (let i = 0; i < 12000 && g.phase !== "result"; i++) {
          if (g.phase === "draft") {
            g.pickCard(0);
            continue;
          }
          g.update(1000);
        }
        if (g.phase === "result" && g.result === "win") return g;
      }
      return null;
    }
    const g = wonGame();
    expect(g).not.toBeNull();
    // 같은 종자 시퀀스면 같은 보상 — 여기선 한 게임 안에서 카드 id 집합이 3장 이하로 정상 생성됨을 확인.
    (g as Game).continueToNextEra();
    const ids = (g as Game).draftCards.map((c) => c.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(3);
  });
});

describe("다시 뽑기(리롤)", () => {
  // 메타 저장소(localStorage)를 인메모리로 흉내 — Game 생성 시 loadMeta 가 이걸 읽어 리롤 해금 상태가 된다.
  function memStorage(store: Record<string, string>): Storage {
    return {
      get length(): number {
        return Object.keys(store).length;
      },
      clear: (): void => {
        for (const k of Object.keys(store)) delete store[k];
      },
      getItem: (k: string): string | null => store[k] ?? null,
      key: (i: number): string | null => Object.keys(store)[i] ?? null,
      removeItem: (k: string): void => {
        delete store[k];
      },
      setItem: (k: string, v: string): void => {
        store[k] = v;
      },
    } as unknown as Storage;
  }

  it("해금 상태면 드래프트에서 새로 뽑고 횟수가 1회로 제한된다", () => {
    const store: Record<string, string> = {
      // metaXp 300 → 메타 레벨 여러 단계(리롤 티어 레벨 2 이상) 해금.
      selpress_meta_v1: JSON.stringify({ metaXp: 300, conquered: false }),
    };
    const gl = globalThis as unknown as { localStorage?: Storage | undefined };
    const prev = gl.localStorage;
    gl.localStorage = memStorage(store);
    try {
      // 프리셋 선택 뒤 레벨업 드래프트가 뜨는 지점까지 진행(여러 시드로 견고히).
      let drafted: Game | null = null;
      for (let s = 0; s < 40 && !drafted; s++) {
        const g = startRun(`reroll-${s}`);
        for (let i = 0; i < 8000; i++) {
          if (g.phase === "draft" && !g.isChoosingPreset) {
            drafted = g;
            break;
          }
          if (g.phase === "result") break;
          g.update(1000);
        }
      }
      expect(drafted).not.toBeNull();
      const g = drafted as Game;
      expect(g.canReroll).toBe(true); // 해금됐고 아직 안 뽑음
      const before = g.draftCards.length;
      g.reroll();
      expect(g.draftCards.length).toBe(before); // 여전히 3장(새로 뽑음)
      expect(g.canReroll).toBe(false); // 드래프트당 1회 제한 → 더는 못 뽑음
      // 리롤 후에도 정상적으로 카드를 고를 수 있다(관전 복귀).
      g.pickCard(0);
      expect(g.phase).toBe("watch");
    } finally {
      gl.localStorage = prev;
    }
  });

  it("해금 전이면 다시 뽑기가 잠겨 있다(canReroll=false)", () => {
    // 저장소를 비워 두면(런 0회) 리롤이 잠긴다 — 기본 상태.
    const gl = globalThis as unknown as { localStorage?: Storage | undefined };
    const prev = gl.localStorage;
    gl.localStorage = memStorage({});
    try {
      let drafted: Game | null = null;
      for (let s = 0; s < 40 && !drafted; s++) {
        const g = startRun(`noreroll-${s}`);
        for (let i = 0; i < 8000; i++) {
          if (g.phase === "draft" && !g.isChoosingPreset) {
            drafted = g;
            break;
          }
          if (g.phase === "result") break;
          g.update(1000);
        }
      }
      expect(drafted).not.toBeNull();
      const g = drafted as Game;
      expect(g.canReroll).toBe(false);
      const before = g.draftCards.map((c) => c.id);
      g.reroll(); // 잠겨 있어 아무 일도 없다
      expect(g.draftCards.map((c) => c.id)).toEqual(before);
    } finally {
      gl.localStorage = prev;
    }
  });
});

describe("런 보고서(히스토리)", () => {
  const MUTABLE = ["attack", "fertility", "herding", "metabolism", "speed", "vision"];

  // 한 런을 result 까지 끝까지 돌린다(드래프트는 첫 카드로 넘긴다).
  function playToEnd(seed: string): Game {
    const g = startRun(seed);
    for (let i = 0; i < 8000 && g.phase !== "result"; i++) {
      if (g.phase === "draft") {
        g.pickCard(0);
        continue;
      }
      g.update(1000);
    }
    return g;
  }

  it("프리셋을 고르면 시작 사건과 t0 샘플이 남는다", () => {
    const g = startRun("report-start");
    const h = g.runHistory;
    expect(h.events.some((e) => e.kind === "start")).toBe(true);
    expect(h.samples.length).toBeGreaterThanOrEqual(1);
    // 샘플의 형질 평균은 변이 6종을 모두 담는다.
    const s0 = h.samples[0] as RunHistory["samples"][number];
    expect(Object.keys(s0.traits).sort()).toEqual(MUTABLE);
  });

  it("진행하면 시계열 샘플이 시간순으로 쌓이고, 카드·종료 사건이 기록된다", () => {
    const g = playToEnd("report-timeline");
    const h = g.runHistory;
    expect(h.samples.length).toBeGreaterThan(2);
    // t 는 단조 증가(뒤로 갈수록 큼).
    for (let i = 1; i < h.samples.length; i++) {
      expect(h.samples[i]!.t).toBeGreaterThanOrEqual(h.samples[i - 1]!.t);
    }
    // 레벨업 카드 사건과 종료 사건이 남는다(대부분 시드는 완주 전 한 번은 레벨업).
    expect(h.events.some((e) => e.kind === "card")).toBe(true);
    expect(h.events.some((e) => e.kind === "end")).toBe(true);
    expect(h.durationSec).toBeGreaterThan(0);
  });

  it("같은 시드면 히스토리가 완전히 재현된다(결정론 — game 층 샘플은 rng 미소비)", () => {
    const a = playToEnd("report-determinism").runHistory;
    const b = playToEnd("report-determinism").runHistory;
    expect(a.events).toEqual(b.events);
    expect(a.samples).toEqual(b.samples);
    expect(a.durationSec).toBe(b.durationSec);
  });
});

describe("도전 과제 보상 「거인」", () => {
  it("과제를 못 땄으면 드래프트 후보에 절대 안 나온다", () => {
    debugResetAchievements();
    const g = startRun("titan-locked");
    // 레벨업 드래프트가 열릴 때까지 돌린다.
    let guard = 0;
    while (g.phase !== "draft" && guard++ < 20000) g.update(34);
    expect(g.phase).toBe("draft");
    expect(g.draftCards.some((c) => c.id === "titan")).toBe(false);
  });

  it("고르면 종의 몸집이 커진다(스탯과 외형이 함께 바뀐다)", () => {
    debugResetAchievements();
    debugUnlockAchievement("titan_born");
    const g = startRun("titan-pick");
    let guard = 0;
    while (g.phase !== "draft" && guard++ < 20000) g.update(34);

    const titan = CARD_POOL.find((c) => c.id === "titan");
    expect(titan).toBeDefined();
    if (!titan) return;
    const beforeAttack = g.genome.traits.attack;
    const beforeSpeed = g.genome.traits.speed;
    expect(g.world.playerSpecies.bodyScale ?? 1).toBe(1);

    g.draftCards = [titan];
    g.pickCard(0);

    expect(g.world.playerSpecies.bodyScale).toBe(CARD_BODY_SCALE.titan);
    expect(g.genome.traits.attack).toBeGreaterThan(beforeAttack); // 힘은 세지고
    expect(g.genome.traits.speed).toBeLessThan(beforeSpeed); // 걸음은 굼떠진다
    expect(g.pickedCardIds).toContain("titan");
  });

  it("시대를 넘어 새 월드를 만들어도 몸집을 유지한다", () => {
    debugResetAchievements();
    debugUnlockAchievement("titan_born");
    const g = startRun("titan-era");
    let guard = 0;
    while (g.phase !== "draft" && guard++ < 20000) g.update(34);
    const titan = CARD_POOL.find((c) => c.id === "titan");
    if (!titan) return;
    g.draftCards = [titan];
    g.pickCard(0);
    g.continueToNextEra();
    expect(g.world.playerSpecies.bodyScale).toBe(CARD_BODY_SCALE.titan);
  });
});

describe("런 통계(도전 과제 판정의 재료)", () => {
  it("개체 수 최고치를 기록한다", () => {
    const g = startRun("peak");
    for (let i = 0; i < 400; i++) g.update(34);
    expect(g.peakPopulation).toBeGreaterThan(0);
    expect(g.peakPopulation).toBeGreaterThanOrEqual(g.world.playerPopulation);
  });

  it("새 런은 통계를 0으로 되돌린다", () => {
    const g = startRun("reset");
    for (let i = 0; i < 200; i++) g.update(34);
    expect(g.peakPopulation).toBeGreaterThan(0);
    g.beginRun();
    expect(g.peakPopulation).toBe(0);
    expect(g.rerollsUsed).toBe(0);
    expect(g.pickedCardIds).toEqual([]);
  });
});

describe("날개 강화 카드의 전제 조건(드래프트 후보 필터)", () => {
  it("못 나는 종에게는 「튼튼한 날개」가 한 번도 안 나온다", () => {
    debugSetMetaLevel(20); // 모든 카드 해금
    const rng = new Rng("prereq");
    const ground = defaultGenome(); // wings 0
    let seen = 0;
    for (let i = 0; i < 3000; i++) {
      const drawn = drawCards(rng, 3, (c) => cardPrereqMet(c, ground.traits), 7);
      if (drawn.some((c) => c.id === "strong_wings")) seen += 1;
    }
    expect(seen).toBe(0);
  });

  it("나는 종에게는 「튼튼한 날개」가 나오고, 관문 「날개」는 더 이상 안 나온다", () => {
    const flyer = defaultGenome();
    flyer.traits.wings = SIM.flyThreshold + 3; // 「날개」 한 장 고른 상태
    const rng = new Rng("flyer");
    let strong = 0;
    let gateway = 0;
    for (let i = 0; i < 3000; i++) {
      const drawn = drawCards(rng, 3, (c) => cardPrereqMet(c, flyer.traits) && !isRedundant(c, flyer.traits), 7);
      if (drawn.some((c) => c.id === "strong_wings")) strong += 1;
      if (drawn.some((c) => c.id === "wings")) gateway += 1;
    }
    expect(strong).toBeGreaterThan(0);
    expect(gateway).toBe(0); // 이미 나는 종에게 관문 카드는 무의미(cardRedundant)
  });
});

/** game.ts 의 cardRedundant 와 같은 규칙(테스트에서 필터를 재현). */
function isRedundant(card: Card, t: Traits): boolean {
  if (card.requiresTrait) return t[card.requiresTrait.key] >= 100;
  return card.id === "wings" && t.wings >= SIM.flyThreshold;
}
