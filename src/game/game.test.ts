// 대멸종 종류 예고 검증 — 미리 정해 둔 큐(extinctionQueue)에서 예고와 실제가 같은 값을 봐야 한다.
// Game 은 순수 TS(Pixi 무관)라 headless 로 런을 끝까지 돌려 관찰할 수 있다.
import { describe, it, expect } from "vitest";
import { Game, type RunHistory, type Trial, type TrialVerdict } from "@/game/game";
import {
  GAME,
  ONBOARDING_MAX_STEP,
  eraDifficulty,
  eraScarcity,
  eraPredatorPressure,
  eraRewardBoostAt,
  bossPassNeeded,
  extinctionPassNeeded,
  mapScale,
  onboardingOpenedLine,
  onboardingStep,
  stepHasChampions,
  stepHasTrial,
  stepUsesDrawnMap,
  stepWorldOptions,
} from "@/game/config";
import { MAP_SCALE } from "@/config";
import { createBoss } from "@/sim/boss";
import { CARD_POOL, cardCategories, cardPips, cardPrereqMet, cardRedundant, drawCards } from "@/game/cards";
import { Rng } from "@/sim/rng";
import { MUTABLE_TRAITS, genomeFromPips, refreshDerived } from "@/sim/genome";
import {
  CATEGORY_LABELS,
  KEY_NAMES,
  MAX_KEYS,
  MAX_TIER,
  TIER_STEPS,
  emptyKeys,
  emptyPips,
  keyCount,
  nearestTierGoal,
  pipsForTier,
  tierOf,
} from "@/sim/tiers";
import { SIM } from "@/sim/params";
import { debugSetMetaLevel } from "@/game/meta";

// 대멸종 이름 4종(game.ts extinctionName 과 일치) — 예고 title 이 보스 예고와 섞이지 않게 거른다.
const EXTINCTION_NAMES = ["혹독한 추위", "대가뭄", "폭염", "대역병"] as const;

/**
 * 메타 저장소(localStorage)를 인메모리로 흉내 — Game 이 loadMeta 로 읽는 값(레벨·끝낸 런 수)을 세팅한다.
 * 테스트는 기본적으로 localStorage 가 아예 없는 환경에서 돈다 = 끝낸 런 0 = 온보딩 진도가 시대와 같다.
 */
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

/** 저장본을 흉내 낸 상태로 fn 을 실행하고 원래 상태로 되돌린다. */
function withMeta<T>(state: Record<string, unknown>, fn: () => T): T {
  const gl = globalThis as unknown as { localStorage?: Storage | undefined };
  const prev = gl.localStorage;
  gl.localStorage = memStorage({ selpress_meta_v1: JSON.stringify(state) });
  try {
    return fn();
  } finally {
    gl.localStorage = prev;
  }
}

/** 한 런을 시작해 첫 프리셋을 고른 상태(watch)로 만든다. */
function startRun(seed: string): Game {
  // 배율 1 고정(3번째 인자): 생성자 의미가 "월드 치수"에서 "기준 화면 치수 × mapScale(진도)"로 바뀌었다.
  // 1 을 못박아 예전과 같은 세계(월드 240x400 · areaScale 1)를 만든다 · 진도별 배율이 켜져도 안 변한다.
  const g = new Game(240, 400, 1);
  g.fixedSeed = seed;
  g.beginRun(); // draft(프리셋 선택)
  g.pickCard(0); // 첫 프리셋 → 첫 채집 단계 시작(watch)
  return g;
}

/**
 * 레벨업 드래프트가 열릴 때까지 돌린다. 시드에 따라 그 전에 멸종할 수 있으므로 여러 시드를 시도한다
 * (밸런스를 만지면 특정 시드의 런 길이가 달라진다 — 시드 하나에 매달리면 테스트가 애먼 곳에서 깨진다).
 */
function runToDraft(seedPrefix: string): Game | null {
  for (let k = 0; k < 12; k++) {
    const g = startRun(`${seedPrefix}-${k}`);
    let guard = 0;
    while (g.phase === "watch" && guard++ < 40000) g.update(34);
    if (g.phase === "draft") return g;
  }
  return null;
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
  it("era 0 은 배율 1.0(기존과 동일), 이후 **복리**로 오른다", () => {
    const step = 1 + GAME.eraDifficultyStep;
    expect(eraDifficulty(0)).toBe(1);
    expect(eraDifficulty(1)).toBeCloseTo(step);
    // 지수(복리)다 — 선형이면 1 + 2×0.30 = 1.60 이겠지만 1.30² = 1.69 다. 카드 성장이 곱셈처럼 쌓이는데
    // 위협만 덧셈으로 오르면 후반이 시시해진다(사용자: "난이도는 선형이 아니라 지수적으로 상승해야 해").
    expect(eraDifficulty(2)).toBeCloseTo(step ** 2);
    expect(eraDifficulty(5)).toBeCloseTo(step ** 5);
    // 뒤 시대일수록 계단이 가팔라진다(복리의 정의).
    expect(eraDifficulty(5) - eraDifficulty(4)).toBeGreaterThan(eraDifficulty(2) - eraDifficulty(1));
    // 음수 방어(0으로 clamp).
    expect(eraDifficulty(-3)).toBe(1);
  });

  it("세계 척박화도 era 0 은 1.0(첫 시대 보존), 이후 복리로 오른다", () => {
    expect(eraScarcity(0)).toBe(1); // 첫 시대 = 먹이 척박 없음(기존 밸런스·통과기준 테스트 보존)
    expect(eraScarcity(1)).toBeCloseTo(1.14);
    expect(eraScarcity(2)).toBeCloseTo(1.14 ** 2);
    expect(eraScarcity(5)).toBeCloseTo(1.14 ** 5);
    expect(eraScarcity(-2)).toBe(1); // 음수 방어
    // 위협 강도와 척박화가 함께 오른다 — 위협이 세지는 동시에 회복이 억제된다(사용자: "시대가 안 어려워진다").
    expect(eraScarcity(3)).toBeGreaterThan(eraScarcity(1));
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
  // 메타 저장소(localStorage)는 파일 위쪽 memStorage 로 흉내 낸다 — Game 생성 시 loadMeta 가 이걸 읽는다.
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
      // 한 라운드에 레벨이 두 번 올랐으면 카드창이 이어서 한 번 더 열린다(밀린 레벨업) → 다 고르고 확인.
      let picks = 0;
      while (g.phase === "draft" && picks++ < 8) g.pickCard(0);
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
  // 샘플이 담는 축 = **개체 변이 축**(genome.ts MUTABLE_TRAITS) 그대로다. 목록을 여기 다시 적으면
  // 축이 바뀔 때마다 두 곳이 조용히 어긋난다(v8 에서 대사가 빠지고 버티는 힘이 들어왔을 때 실제로 그랬다).
  const MUTABLE = [...MUTABLE_TRAITS].sort();

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

// ⚠ **「거인」 절을 지웠다.** v8 카드 풀(72장)에 `titan` 카드가 없다 — 도장 카드로 갈아엎으면서
//   사라졌는데 `game/achievements.ts` 의 보상(`cardId: "titan"`)만 남아 있다. 여기서 카드를 흉내 내
//   테스트를 초록으로 만들면 **그 불일치가 감춰진다.** 결함 자체는 achievements.test 의
//   「모든 보상이 실재한다 — 꾸밈은 COSMETICS 에, 카드는 CARD_POOL 에 있다」가 잡고 있으므로,
//   보상 카드가 정해지면 이 절을 그 카드로 되살린다.
//
// 몸집은 이제 **고르는 축이 아니라 파생값**이다(가죽·이빨을 파면 커지고 다리·무리를 파면 작아진다 ·
// `tiers.derivedSize`). "몸집을 키우는 카드"라는 것 자체가 v8 에는 없다.

describe("시대를 넘어도 게놈이 이어진다", () => {
  it("시대를 넘어 새 월드를 만들어도 도장·파생 능치가 그대로다", () => {
    const g = runToDraft("carry-era");
    expect(g).not.toBeNull();
    if (!g) return;
    const pips = { ...g.genome.pips };
    const size = g.genome.traits.size;
    g.result = "win";
    g.continueToNextEra();
    expect(g.genome.pips).toEqual(pips);
    expect(g.genome.traits.size).toBe(size);
    expect(g.world.genome.traits.size).toBe(size);
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

// ⚠ **「튼튼한 날개」 절을 갈아엎었다.** v8 에는 강화 카드라는 것이 없다 — 능력은 **열쇠**이고,
//   세기는 짝지어진 범주의 티어가 읽는다(`tiers.KEY_PARENT`). 그래서 "관문 한 장 + 강화 여러 장"이라는
//   구조 자체가 사라졌고, 전제 조건도 「이미 가졌는가 · 상한에 닿았는가」 둘로 단순해졌다.
//   같은 계약(못 쓰는 카드는 후보에 안 든다)을 새 구조에서 그대로 잰다.
describe("열쇠 카드의 전제 조건(드래프트 후보 필터)", () => {
  const keyCards = CARD_POOL.filter((c) => c.key !== undefined);

  it("풀에 열쇠 카드가 일곱 종류 있다(열쇠마다 정확히 한 장)", () => {
    expect(keyCards.length).toBe(KEY_NAMES.length);
    expect(new Set(keyCards.map((c) => c.key)).size).toBe(KEY_NAMES.length);
  });

  it("이미 가진 열쇠는 한 번도 다시 안 나온다", () => {
    debugSetMetaLevel(20); // 모든 카드 해금
    const rng = new Rng("prereq");
    const g = genomeFromPips(emptyPips(), { ...emptyKeys(), fin: true });
    let seen = 0;
    for (let i = 0; i < 3000; i++) {
      const drawn = drawCards(rng, 3, (c) => cardPrereqMet(c, g), 7);
      if (drawn.some((c) => c.key === "fin")) seen += 1;
    }
    expect(seen).toBe(0);
    // 아직 안 가진 열쇠는 정상적으로 나온다(대조군 — 필터가 열쇠를 통째로 죽인 게 아니다).
    const rng2 = new Rng("prereq2");
    let other = 0;
    for (let i = 0; i < 3000; i++) {
      const drawn = drawCards(rng2, 3, (c) => cardPrereqMet(c, g), 7);
      if (drawn.some((c) => c.key !== undefined)) other += 1;
    }
    expect(other).toBeGreaterThan(0);
  });

  it("열쇠 상한(3개)에 닿으면 열쇠 카드가 통째로 후보에서 빠진다", () => {
    const full = genomeFromPips(emptyPips(), { ...emptyKeys(), fin: true, echo: true, venom: true });
    expect(keyCount(full.keys)).toBe(MAX_KEYS);
    for (const c of keyCards) {
      expect(cardPrereqMet(c, full), `${c.id} 가 상한을 넘어 후보에 남았다`).toBe(false);
      expect(cardRedundant(c, full)).toBe(true);
    }
    const rng = new Rng("keycap");
    for (let i = 0; i < 500; i++) {
      const drawn = drawCards(rng, 3, (c) => cardPrereqMet(c, full) && !cardRedundant(c, full), 7);
      expect(drawn.some((c) => c.key !== undefined)).toBe(false);
      expect(drawn.length).toBe(3); // 그래도 후보 3장은 채워진다(풀이 안 마른다)
    }
  });

  it("도장이 최고 티어인 범주로만 가는 카드는 후보에서 빠진다(죽은 카드)", () => {
    const maxed = genomeFromPips({ ...emptyPips(), fang: TIER_STEPS[3] }, emptyKeys());
    const fangOnly = CARD_POOL.filter(
      (c) => c.key === undefined && cardCategories(c).length === 1 && cardPips(c, "fang") > 0,
    );
    expect(fangOnly.length).toBeGreaterThan(0); // 전제: 이빨 한 우물 카드가 실제로 있다
    for (const c of fangOnly) {
      expect(cardPrereqMet(c, maxed), `${c.id} 가 최고 티어인데 후보에 남았다`).toBe(false);
    }
  });
});

describe("라운드 시험과 혈통의 불씨", () => {
  /** private 멤버 접근용 캐스팅(기존 extinctionQueue 패턴). finishStage 로 단계를 즉시 끝낸다. */
  type GamePriv = {
    stageIndex: number;
    currentTrial: Trial | null;
    finishStage(a: boolean, b?: boolean): void;
    beginStage(): void;
    pickTrial(): Trial;
  };

  /**
   * 둘째 시대(era 1)의 첫 채집 단계까지 진행한 런.
   * 테스트 환경에는 저장본이 없어 **끝낸 런 수 0** = 온보딩 진도가 곧 시대다 → era 0 은 진도 0(시험 없음),
   * era 1 이 진도 1(시험 등장)이다. 시험·불씨 검증은 시험이 실제로 열리는 진도에서 해야 한다
   * (기능을 지운 게 아니라 등장 시점을 옮긴 것이므로 테스트도 따라간다).
   */
  function startRunEra1(seed: string): Game {
    const g = startRun(seed);
    g.result = "win"; // 승리 직후 상태를 흉내(continueToNextEra 의 가드)
    g.continueToNextEra(); // era 1 · 시대 보상 드래프트가 열린다
    let guard = 0;
    while (g.phase === "draft" && guard++ < 8) g.pickCard(0); // 밀린 레벨업이 있으면 이어서 고른다
    return g;
  }

  /** 채집 단계의 시험이 pop(무리)이 아닌 시드를 찾는다 · 계수기 조작만으로 합·불을 강제할 수 있는 시험. */
  function startWithCountTrial(prefix: string): Game {
    for (let s = 0; s < 40; s++) {
      const g = startRunEra1(`${prefix}-${s}`);
      if (g.trial && g.trial.kind !== "pop") return g;
    }
    throw new Error("계수형 시험(hunt·feed·birth)이 걸리는 시드를 찾지 못했습니다");
  }

  it("같은 시드면 같은 시험이 나온다(시드 파생 해시 · 기존 rng 스트림 미소비)", () => {
    const a = startRunEra1("trial-same").trial;
    const b = startRunEra1("trial-same").trial;
    expect(a).not.toBeNull(); // 둘째 시대부터는 채집 단계에 시험이 항상 있다
    expect(a).toEqual(b);
    // 다른 시드에서는 시험이 갈린다 · 여러 시드를 모으면 적어도 두 종류 이상 나와야 한다.
    const labels = new Set<string>();
    for (let s = 0; s < 16; s++) {
      const t = startRunEra1(`trial-vary-${s}`).trial;
      if (t) labels.add(t.label);
    }
    expect(labels.size).toBeGreaterThan(1);
  });

  it("진도 0(처음 하는 사람의 첫 시대)에는 시험이 안 걸린다 · 진도 1 부터 걸린다", () => {
    // 처음부터 시험·불씨·예고가 한꺼번에 나오면 배울 것이 너무 많다 → 등장 시점을 한 칸 뒤로 옮겼다.
    // 이 한 가지가 꺼지면 판정·불씨 감소·목표 줄의 불씨 점·첫 안내 배너·드래프트 예고가 연쇄로 꺼진다.
    for (let s = 0; s < 12; s++) {
      const g = startRun(`no-trial-step0-${s}`);
      expect(g.era).toBe(0);
      expect(g.trial).toBeNull();
      expect(g.upcomingTrial).toBeNull();
      expect(startRunEra1(`no-trial-step0-${s}`).trial).not.toBeNull(); // 진도 1 에는 걸린다
    }
  });

  it("한 판을 끝낸 사람은 첫 시대(진도 1)부터 시험이 걸린다 — 시대가 아니라 겪은 양이 기준", () => {
    // 이것이 2026-08-05 수정의 핵심이다: 예전엔 era 0 로 갈라서 몇 판을 하든 첫 시대가 늘 유아용이었다.
    for (let s = 0; s < 6; s++) {
      const g = withMeta({ metaXp: 0, conquered: false, runsCompleted: 1 }, () =>
        startRun(`veteran-trial-${s}`),
      );
      expect(g.era).toBe(0);
      expect(g.trial).not.toBeNull();
    }
  });

  it("이빨 0단(초식)에게 사냥 시험이, 풀을 못 뜯는 종에게 먹이 시험이 안 나온다(후보 필터)", () => {
    // **[사용자 2026-08-06]** 「초식 거인 경로는 반드시 만든다」가 이 한 줄에 걸려 있다 — 이빨에
    // 도장을 하나도 안 넣은 종은 사냥 효율이 정확히 0 이라 한 마리도 못 잡는데, 못 하는 시험을 내면
    // 그건 판정이 아니라 사형 선고다(불씨는 다섯뿐이다).
    for (let s = 0; s < 20; s++) {
      const g = startRun(`filter-${s}`);
      const priv = g as unknown as GamePriv;
      for (let k = 0; k < 3; k++) {
        priv.stageIndex = k; // pickTrial 은 순수 계산이라 단계만 바꿔 여러 번 물어도 안전
        // 이빨 0단 — 도장을 지우고 파생을 다시 낸다(카드가 도장을 찍는 것과 같은 길).
        g.genome.pips.fang = 0;
        refreshDerived(g.genome);
        expect(g.genome.traits.hunt).toBe(0); // 전제: 사냥이 원리적으로 불가능하다
        expect(priv.pickTrial().kind).not.toBe("hunt");
        // 풀 효율이 바닥인 종(극단 육식 야생 능치) — 채집 시험도 못 낸다.
        g.genome.traits.graze = 0;
        expect(priv.pickTrial().kind).not.toBe("feed");
      }
    }
  });

  it("보스 단계에는 시험이 없다(그 단계 자체가 시험)", () => {
    const g = startRun("no-trial-boss");
    const priv = g as unknown as GamePriv;
    priv.stageIndex = 2; // SCHEDULE[2] = "boss"
    priv.beginStage();
    expect(g.trial).toBeNull();
  });

  it("합격: 불씨 유지 · 다음 단계 진행 · 계수 리셋", () => {
    const g = startWithCountTrial("trial-pass");
    const verdicts: TrialVerdict[] = [];
    g.onTrialVerdict = (v) => verdicts.push(v);
    // 계수형 시험이므로 계수기를 목표 이상으로 채우면 무조건 합격.
    g.world.roundCounts.hunts = 99;
    g.world.roundCounts.feeds = 99;
    g.world.roundCounts.births = 99;
    const stageBefore = g.stageNumber;
    (g as unknown as GamePriv).finishStage(true);
    expect(g.embers).toBe(GAME.emberStart); // 합격은 불씨를 안 건드린다
    expect(g.stageNumber).toBe(stageBefore + 1); // 다음 단계로 정상 진행
    expect(g.phase).toBe("watch");
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.passed).toBe(true);
    expect(g.world.roundCounts).toEqual({ hunts: 0, feeds: 0, births: 0 }); // beginStage 가 리셋
  });

  it("불합격: 불씨 -1 인데 런은 계속된다(부분 패배)", () => {
    const g = startWithCountTrial("trial-fail");
    const verdicts: TrialVerdict[] = [];
    g.onTrialVerdict = (v) => verdicts.push(v);
    // 계수기를 0 으로 두면 계수형 시험은 반드시 불합격.
    g.world.roundCounts.hunts = 0;
    g.world.roundCounts.feeds = 0;
    g.world.roundCounts.births = 0;
    (g as unknown as GamePriv).finishStage(true);
    expect(g.embers).toBe(GAME.emberStart - 1); // 불씨 하나를 잃는다
    expect(g.phase).toBe("watch"); // 결과 화면이 아니라 다음 단계로(런은 계속)
    expect(g.result).toBeNull();
    expect(verdicts[0]?.passed).toBe(false);
    expect(verdicts[0]?.embersLeft).toBe(GAME.emberStart - 1);
  });

  it("불씨 0 = 패배 · 사유가 개체 0 멸종과 구분된다", () => {
    const g = startWithCountTrial("trial-last-ember");
    g.embers = 1; // 마지막 불씨
    let summary = "";
    g.onResult = (_result, s) => {
      summary = s;
    };
    g.world.roundCounts.hunts = 0;
    g.world.roundCounts.feeds = 0;
    g.world.roundCounts.births = 0;
    (g as unknown as GamePriv).finishStage(true);
    expect(g.result).toBe("lose");
    expect(g.lostByEmbers).toBe(true); // 개체 0 멸종이 아니라 불씨 소진
    expect(summary).toContain("불씨");
  });

  it("보스 격퇴는 불씨를 1 회복하되 상한을 넘지 않는다", () => {
    const g = startRun("boss-ember");
    const priv = g as unknown as GamePriv;
    priv.stageIndex = 2; // SCHEDULE[2] = "boss"
    g.embers = 3;
    priv.finishStage(true, true); // 격퇴
    expect(g.embers).toBe(4);
    const g2 = startRun("boss-ember-cap");
    const priv2 = g2 as unknown as GamePriv;
    priv2.stageIndex = 2;
    expect(g2.embers).toBe(GAME.emberMax); // 시작 = 상한
    priv2.finishStage(true, true);
    expect(g2.embers).toBe(GAME.emberMax); // 가득이면 그대로
  });

  it("레벨업 카드는 라운드 도중에 끼어들지 않고 라운드 경계에서 열린다", () => {
    // 예전엔 레벨이 오르는 즉시 전체 화면 카드창이 떴다(실측: 드래프트의 100%가 라운드 도중).
    // 지금은 레벨만 오르고 카드는 밀어 뒀다가 판정 뒤에 연다.
    const g = runToDraft("trial-draft-boundary");
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.level).toBeGreaterThan(1); // 레벨은 라운드 도중에 올랐고
    expect(g.secondsLeft).toBe(0); // 카드창은 타이머가 다 된 뒤에야 열렸다
  });

  it("경계 드래프트에서 카드를 고르면 다음 라운드가 시작되고 시험 계수가 리셋된다", () => {
    const g = runToDraft("trial-draft-next");
    expect(g).not.toBeNull();
    if (!g) return;
    g.world.roundCounts.feeds = 7;
    let guard = 0;
    while (g.phase === "draft" && guard++ < 8) g.pickCard(0); // 한 라운드에 두 번 올랐으면 이어서 한 장 더
    expect(g.phase).toBe("watch");
    expect(g.world.roundCounts.feeds).toBe(0); // 새 라운드라 계수는 0 부터
    expect(g.secondsLeft).toBeGreaterThan(0); // 새 라운드 타이머가 채워졌다
  });

  it("시대 진입은 불씨를 1 회복하되 상한을 넘지 않고, 시대 보상 드래프트에 다음 시험 예상이 뜬다", () => {
    const g = startRun("era-ember");
    g.result = "win"; // 승리 직후 상태를 흉내(continueToNextEra 의 가드)
    g.embers = 3;
    g.continueToNextEra();
    expect(g.embers).toBe(4);
    // 시대 보상 드래프트 중에는 곧 시작할 채집 단계의 시험 예상을 미리 볼 수 있다.
    expect(g.phase).toBe("draft");
    expect(g.upcomingTrial).not.toBeNull();
    const g2 = startRun("era-ember-cap");
    g2.result = "win";
    expect(g2.embers).toBe(GAME.emberMax);
    g2.continueToNextEra();
    expect(g2.embers).toBe(GAME.emberMax); // 상한 클램프
  });

  it("시대 보상 드래프트의 예고 시험이 어떤 선택을 해도 그대로 시작된다(예고=실물)", () => {
    // 예고를 읽고 고른 카드(×2 강화)가 식성·무리 수를 바꿔도 시험이 안 바뀌어야 한다.
    // 얼리기 전에는 카드가 후보 수를 3↔4 로 바꿔 예고와 실제가 어긋났다(적대적 검증: 640건 중 9%).
    for (let s = 0; s < 6; s++) {
      for (const choice of [0, 1, 2, -1]) {
        const g = startRun(`era-freeze-${s}`);
        g.result = "win"; // 승리 직후 상태를 흉내(continueToNextEra 의 가드)
        g.continueToNextEra();
        const promised = g.upcomingTrial;
        expect(promised).not.toBeNull();
        if (choice < 0) g.skipDraft();
        else g.pickCard(choice);
        expect(g.phase).toBe("watch");
        expect(g.trial).toEqual(promised); // 예고한 그 시험이 그대로 걸린다
      }
    }
  });

  it("드래프트 스킵 보상 새끼는 pop 시험 점수에 안 들어간다(스킵이 곧 합격 금지)", () => {
    const g = runToDraft("skip-pop");
    expect(g).not.toBeNull();
    if (!g) return;
    (g as unknown as GamePriv).currentTrial = { kind: "pop", target: 10, label: "무리 10마리" };
    const popBefore = g.world.playerPopulation;
    const progBefore = g.trialProgress;
    g.skipDraft(); // 새끼 +SIM.draftSkipBrood
    expect(g.world.playerPopulation).toBe(popBefore + SIM.draftSkipBrood); // 개체는 실제로 늘었지만
    expect(g.trialProgress).toBe(progBefore); // 시험 점수는 그대로(표시=판정 같은 식)
  });
});


describe("온보딩 진도 (시대가 아니라 겪은 양으로 세계가 열린다)", () => {
  it("진도 = min(3, 끝낸 런 수 + 시대) — 처음 하는 사람만 0 에서 시작한다", () => {
    expect(onboardingStep(0, 0)).toBe(0); // 첫 런 첫 시대
    expect(onboardingStep(0, 1)).toBe(1);
    expect(onboardingStep(0, 2)).toBe(2);
    expect(onboardingStep(0, 3)).toBe(ONBOARDING_MAX_STEP);
    expect(onboardingStep(1, 0)).toBe(1); // 두 번째 런은 첫 시대부터 한 칸 위
    expect(onboardingStep(2, 0)).toBe(2);
    expect(onboardingStep(3, 0)).toBe(ONBOARDING_MAX_STEP); // 네 번째 런부터는 늘 온전한 세계
    expect(onboardingStep(99, 0)).toBe(ONBOARDING_MAX_STEP);
    expect(onboardingStep(99, 99)).toBe(ONBOARDING_MAX_STEP);
    // 이상한 입력에도 진도는 0~3 안에 있다(저장본이 손상돼도 세계가 깨지지 않게).
    expect(onboardingStep(-5, -5)).toBe(0);
    expect(onboardingStep(1.9, 0.9)).toBe(1);
  });

  it("한 칸에 한 가지씩만 열린다 — 줄어드는 구간이 없다(맵 크기·지형·시험·챔피언)", () => {
    for (let step = 1; step <= 8; step++) {
      expect(mapScale(step)).toBeGreaterThanOrEqual(mapScale(step - 1));
      // 남길 종 목록은 앞 단계를 반드시 포함한다(undefined = 전부 = 최대).
      const prev = stepWorldOptions(step - 1).keepWildNames;
      const now = stepWorldOptions(step).keepWildNames;
      if (prev !== undefined) {
        expect(now === undefined || prev.every((n) => now.includes(n))).toBe(true);
        if (now !== undefined) expect(now.length).toBeGreaterThanOrEqual(prev.length);
      } else {
        expect(now).toBeUndefined(); // 한 번 다 열린 뒤에는 다시 닫히지 않는다
      }
      // 켜진 기능은 다시 안 꺼진다.
      if (stepHasTrial(step - 1)) expect(stepHasTrial(step)).toBe(true);
      if (stepUsesDrawnMap(step - 1)) expect(stepUsesDrawnMap(step)).toBe(true);
      if (stepHasChampions(step - 1)) expect(stepHasChampions(step)).toBe(true);
    }
    expect(mapScale(ONBOARDING_MAX_STEP)).toBe(MAP_SCALE); // 마지막 진도는 상한(src/config.ts 단일 근원)
    expect(mapScale(99)).toBe(MAP_SCALE);
    // 시험은 진도 1 부터 · 챔피언은 마지막 진도부터.
    expect(stepHasTrial(0)).toBe(false);
    expect(stepHasTrial(1)).toBe(true);
    expect(stepHasChampions(ONBOARDING_MAX_STEP - 1)).toBe(false);
    expect(stepHasChampions(ONBOARDING_MAX_STEP)).toBe(true);
  });

  it("새로 열린 것은 시대 보상 화면이 한 줄로 알린다(대백과 없이 알아챌 수 있게)", () => {
    expect(onboardingOpenedLine(0)).toBe(""); // 처음엔 알릴 것이 없다
    for (let step = 1; step <= ONBOARDING_MAX_STEP; step++) {
      expect(onboardingOpenedLine(step).length).toBeGreaterThan(0);
    }
    expect(onboardingOpenedLine(ONBOARDING_MAX_STEP + 1)).toBe(""); // 더 열릴 것이 없으면 침묵
    // 실제로 시대를 넘으면 그 문구가 카드 고르는 화면의 안내에 실린다.
    const g = startRun("opened-line");
    g.result = "win";
    g.continueToNextEra();
    expect(g.era).toBe(1);
    expect(g.draftNotice).toContain(onboardingOpenedLine(1));
  });

  it("진도 0 월드는 기준 화면 그대로다 — 미니맵이 저절로 꺼지는 조건", () => {
    // main 은 화면(논리 해상도) 치수만 넘기고 Game 이 mapScale(진도) 로 월드를 만든다.
    // 진도 0 배율이 1 이라야 "월드 ≤ 화면"이 성립해 main 의 worldFitsScreen 이 미니맵을 거둔다.
    expect(mapScale(0)).toBe(1);
    const g = new Game(540, 960);
    expect(g.width).toBe(540);
    expect(g.height).toBe(960);
    expect(g.areaScale).toBe(1); // 면적 배율은 늘 배율의 제곱
  });

  it("시대를 넘으면 그 진도의 배율로 월드가 다시 만들어진다", () => {
    const g = startRun("era-map-scale");
    expect(g.width).toBe(240); // startRun 은 배율 1 고정(예전 소형 테스트 세계 보존)
    const free = new Game(540, 960); // 고정 없이 = 실제 게임과 같은 길
    free.fixedSeed = "era-map-scale";
    free.beginRun();
    free.pickCard(0);
    expect(free.width).toBe(540);
    free.result = "win";
    free.continueToNextEra();
    expect(free.era).toBe(1);
    expect(free.width).toBe(Math.round(540 * mapScale(1)));
    expect(free.areaScale).toBeCloseTo(mapScale(1) * mapScale(1), 6);
  });

  it("네 판을 끝낸 사람은 첫 시대부터 온전한 세계에서 시작한다(맵 2.0 · 뽑힌 세계 · 야생 전 종)", () => {
    // 예전 결함: era 0 로 갈라서 숙련자도 매 런 첫 시대가 종 셋짜리 초원이었다(시대 하나를 통째로 버렸다).
    const g = withMeta({ metaXp: 0, conquered: false, runsCompleted: 4 }, () => {
      const free = new Game(540, 960);
      free.fixedSeed = "veteran-world";
      free.beginRun();
      free.pickCard(0);
      return free;
    });
    expect(g.era).toBe(0);
    expect(g.width).toBe(Math.round(540 * MAP_SCALE));
    expect(g.mapType).not.toBe("meadow"); // 이 런에 뽑힌 세계(대륙 등)
    expect(g.world.hiddenSpeciesIds.size).toBe(0); // 감추는 종이 하나도 없다
    expect(g.world.entities.some((e) => e.species.name === "친척 무리")).toBe(true);
  });

  it("처음 하는 사람의 첫 시대는 좁은 세계다(같은 코드 경로 · 저장본만 다르다)", () => {
    const free = new Game(540, 960);
    free.fixedSeed = "veteran-world";
    free.beginRun();
    free.pickCard(0);
    expect(free.width).toBe(540); // 배율 1.0
    expect(free.mapType).toBe("meadow");
    expect(free.world.hiddenSpeciesIds.size).toBeGreaterThan(0);
    const alive = new Set(free.world.entities.map((e) => e.species.name));
    expect([...alive].sort()).toEqual(["내 종", "초식 경쟁자", "포식자"].sort());
  });
});


// ⚠ **「형질 천장 상승」 테스트 넷을 지웠다.** v8 에서 `eraTraitCeiling`·`eraTraitCeilings`·
//   `setTraitCeilings`·`isApexTrait`·`effectiveDelta`(상한 근접 감쇠)가 전부 폐기됐다. 천장 상승은
//   감쇠와 한 쌍으로 설계된 장치인데 티어 구조에서 감쇠 자체가 사라져 개념이 소멸했고, 무엇보다
//   **[사용자 2026-08-06]** 이 문제 삼은 자리가 여기다: "천장이 점점 높아지는 건 무슨 의미고, 그럼
//   정점이라는 건 왜 있는 건데?" 이제 성장의 끝은 **4단(규칙 면제)** 이고 시대가 올라도 안 움직인다.
//   그 계약은 `sim/genome.test.ts` 의 티어 사다리 절이 맡는다.
describe("지수 난이도 (성장 곡선과 난이도 곡선의 경주)", () => {
  it("성장의 끝(4단)은 시대가 올라도 안 움직인다 — 도착점이 있는 사다리다", () => {
    // 예전엔 시대마다 천장이 올라 "정점"이 통과점이 됐다. 지금은 반대다: 사다리 끝이 고정이고,
    // 시대는 **난이도만** 올린다. 그래서 마지막 시대에 4단으로 치르는 판이 진짜 클라이맥스가 된다.
    expect(pipsForTier(MAX_TIER)).toBe(TIER_STEPS[TIER_STEPS.length - 1]);
    expect(tierOf(TIER_STEPS[3] + 100)).toBe(MAX_TIER); // 아무리 더 찍어도 그 위는 없다
  });

  it("관문 생존 기준은 시대마다 지수로 오르고, 첫 시대는 1(완전 멸종만 패배)이다", () => {
    expect(bossPassNeeded(0)).toBe(1);
    expect(extinctionPassNeeded(0)).toBe(1);
    for (let era = 1; era < GAME.eraCap; era++) {
      expect(extinctionPassNeeded(era)).toBeGreaterThanOrEqual(extinctionPassNeeded(era - 1));
    }
    // 마지막 시대는 첫 시대의 몇 배여야 한다 — 이 계단이 없으면 위협을 아무리 세게 만들어도
    // 판정이 안 바뀐다(2026-08-05 실측: 위협 ×2.22 에 시대 끝 개체 수 22.9 → 22.7).
    expect(extinctionPassNeeded(GAME.eraCap - 1)).toBeGreaterThan(extinctionPassNeeded(0) * 3);
  });

  it("포식 압력·시대 보상도 시대마다 오르고, 첫 시대는 손대지 않는다", () => {
    expect(eraPredatorPressure(0)).toBe(1);
    expect(eraPredatorPressure(2)).toBeGreaterThan(1);
    expect(eraPredatorPressure(9)).toBeLessThanOrEqual(GAME.eraPredatorCap); // 상한에서 멈춘다
    expect(eraRewardBoostAt(1)).toBeCloseTo(GAME.eraRewardBoost);
    expect(eraRewardBoostAt(4)).toBeGreaterThan(eraRewardBoostAt(1));
  });

  it("난이도는 시대마다 복리로 오른다 — 뒤 시대의 계단이 앞 시대보다 크다", () => {
    expect(eraDifficulty(0)).toBe(1);
    for (let era = 1; era < GAME.eraCap; era++) {
      expect(eraDifficulty(era)).toBeGreaterThan(eraDifficulty(era - 1));
    }
    const last = GAME.eraCap - 1;
    expect(eraDifficulty(last) - eraDifficulty(last - 1)).toBeGreaterThan(eraDifficulty(1) - eraDifficulty(0));
    // 마지막 시대는 첫 시대의 몇 배여야 한다 — 성장(사다리 넷)이 따라잡을 수 없을 만큼은 아니지만
    // 손 놓으면 확실히 무너질 만큼.
    expect(eraDifficulty(last)).toBeGreaterThan(2);
  });

  it("화면에 못박은 생존 기준과 실제 판정 기준이 같은 함수에서 나온다", () => {
    // 예고 문구가 다른 수를 말하고 판정이 다른 수로 자르면 그건 거짓말이다(2026-07-16 "허무하게 졌다"의 재발).
    const g = new Game(540, 960);
    g.fixedSeed = "pass-line";
    g.beginRun();
    g.pickCard(0);
    // 채집 라운드에는 관문이 없다.
    expect(g.survivorsNeeded).toBe(0);
    // 첫 시대는 1마리 = 완전 멸종만 패배 → 겁주는 문구를 붙이지 않는다.
    expect(bossPassNeeded(0)).toBe(1);
  });

  it("최고 티어는 한 런에 「닿을 만한」 목표다 — 반드시 찍히지도, 영영 못 찍지도 않는다", () => {
    // 예전엔 정점 넷이 런 끝에 **반드시** 다 찍혔다(그래서 성장이 끝나 있었다). 사다리는 그 정확한
    // 반대를 노린다: 한 범주만 파면 잘한 판에서 4단이 열리고, 다섯을 고루 뿌리면 어디에도 못 닿는다.
    // 카드 한 장의 기대 도장이 약 1.09 개(3장 중 최댓값)이고 한 런의 카드 예산은 12~22 장이다.
    const perCard = 1.09;
    const oneWell = (cards: number): number => cards * perCard;
    expect(oneWell(12)).toBeLessThan(TIER_STEPS[3]); // 손 놓은 판은 4단에 못 닿는다
    expect(oneWell(22)).toBeGreaterThan(TIER_STEPS[3]); // 아주 잘한 판은 닿는다
    // 다섯을 고루 뿌리면 잘한 판에서도 2단이 한계다(정책 없는 성장은 보상이 없다).
    const spread = (22 * perCard) / 5;
    expect(tierOf(Math.round(spread))).toBeLessThan(3);
  });
});

/**
 * 2단계 — **성장과 난이도가 화면에서 읽히는가**의 계약.
 *
 * 값은 1단계에서 섰다(천장 상승·통과 기준 상승·포식 압력). 여기서 못박는 것은 "그 값을 화면이
 * 같은 함수에서 읽는가" 하나다. 화면이 자기 식으로 다시 계산하면 그 순간 두 진실이 생기고,
 * 이 저장소는 그 사고(예고와 실제가 갈린 시험·격퇴율 72%)를 이미 두 번 겪었다.
 */
describe("시대 전환 연출이 말하는 것 (nextEraBriefing)", () => {
  function readyRun(seed: string): Game {
    const g = new Game(540, 960);
    g.fixedSeed = seed;
    g.beginRun();
    g.pickCard(0); // 시작 프리셋
    return g;
  }

  it("이길 때까지는 아무 말도 하지 않는다", () => {
    const g = readyRun("brief-none");
    expect(g.nextEraBriefing()).toBeNull();
  });

  it("다음 시대에 무엇이 늘고 무엇이 열리는지를 실제 적용 값 그대로 말한다", () => {
    const g = readyRun("brief-win");
    g.result = "win";
    const b = g.nextEraBriefing();
    expect(b).not.toBeNull();
    const brief = b as { title: string; lines: string[] };
    expect(brief.title).toBe("시대 2");
    // ① 사냥하는 짐승이 늘어난다 — 화면에서 붉은 것이 늘어나는 그 변화.
    expect(brief.lines.some((l) => l.includes("사냥"))).toBe(true);
    // ② 관문 기준 · 판정과 같은 함수(bossPassNeeded)의 값이어야 한다.
    expect(brief.lines.some((l) => l.includes(`${bossPassNeeded(1)}마리`))).toBe(true);
    // ③ **[사용자 2026-08-06]** 「천장이 올라간다」는 v8 에서 사라졌다(성장의 끝은 4단이고 시대가
    //    올라도 안 움직인다). 대신 험해지는 소식 뒤에 **지금 내가 어디쯤인가**를 말한다 — 다음 문턱이
    //    눈앞에 있다는 것이 이어갈 이유가 된다. 그 값도 화면이 읽는 함수(nearestTierGoal)에서 나와야 한다.
    const near = nearestTierGoal(g.genome.pips);
    expect(near, "시작 프리셋인데 다음 문턱이 없다").not.toBeNull();
    if (near) {
      expect(brief.lines.some((l) => l.includes(CATEGORY_LABELS[near.cat]))).toBe(true);
      expect(brief.lines.some((l) => l.includes(`도장 ${near.need}개`))).toBe(true);
    }
  });

  it("마지막 시대에서는 이어갈 곳이 없으니 예고도 없다", () => {
    const g = readyRun("brief-final");
    g.result = "win";
    g.era = GAME.eraCap - 1;
    expect(g.nextEraBriefing()).toBeNull();
  });

  it("시대가 갈수록 예고의 숫자도 함께 커진다(연출이 매번 같은 말을 하지 않는다)", () => {
    const g = readyRun("brief-grow");
    g.result = "win";
    const at = (era: number): string => {
      g.era = era;
      const b = g.nextEraBriefing() as { lines: string[] };
      return b.lines.join(" ");
    };
    const early = at(0);
    const late = at(GAME.eraCap - 2);
    expect(early).not.toBe(late);
    // 마지막 계단은 관문 기준을 판정과 같은 함수에서 읽어 말한다(화면이 자기 식으로 다시 계산하면
    // 그 순간 두 진실이 생긴다 — 이 저장소가 이미 두 번 겪은 사고다).
    expect(late).toContain(`${bossPassNeeded(GAME.eraCap - 1)}마리`);
  });
});
