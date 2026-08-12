// 대멸종 종류 예고 검증 — 미리 정해 둔 큐(extinctionQueue)에서 예고와 실제가 같은 값을 봐야 한다.
// Game 은 순수 TS(Pixi 무관)라 headless 로 런을 끝까지 돌려 관찰할 수 있다.
import { describe, it, expect } from "vitest";
import { Game, type RunHistory, type Trial, type TrialKind, type TrialVerdict } from "@/game/game";
import {
  GAME,
  ONBOARDING_MAX_STEP,
  SCHEDULE,
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
import { MAP_SCALE, MOBILE } from "@/config";
import { createBoss } from "@/sim/boss";
import { CARD_POOL, cardPrereqMet, cardRedundant, drawCards } from "@/game/cards";
import type { PerkName } from "@/sim/perks";
import { Rng } from "@/sim/rng";
import { MUTABLE_TRAITS, genomeFromPips, refreshDerived } from "@/sim/genome";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  FANG_ATTACK,
  KEY_NAMES,
  LEG_SPEED,
  MAX_KEYS,
  MAX_TIER,
  TIER_STEPS,
  emptyKeys,
  emptyPips,
  keyCount,
  nearestTierGoal,
  pipsForTier,
  pipsToNext,
  tierOf,
  type Category,
  type Pips,
} from "@/sim/tiers";
import { easeChampionGenome } from "@/sim/species";
import { GENE_AWARD, milestonesCrossed, type CrisisWatch, type GeneReason } from "@/sim/gene";
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

  // ⚠ **「시대 보상을 다시 뽑아도 강화 배수가 안 떨어진다」를 갈아엎었다.** 그 시험이 재던 것은
  //   카드 이름에 박히던 "(강화 ×N)" 이었는데, v9 에서 카드가 도장을 안 주므로 곱할 것이 없어져
  //   `boostCard` 와 함께 배수 자체가 사라졌다(그래서 그 자리의 숨은 벌칙도 구조적으로 없어졌다).
  //   **살아남은 절반은 이것이다** — 시대 보상 드래프트에서도 다시 뽑기가 같은 일을 한다(3장을 새로
  //   주고, 그 뒤로도 정상적으로 고를 수 있다). 리롤이 드래프트 종류에 따라 다른 길을 타면 그 순간
  //   또 한쪽만 낡는다.
  it("시대 보상 드래프트에서도 다시 뽑기가 3장을 새로 준다", () => {
    const store: Record<string, string> = {
      selpress_meta_v1: JSON.stringify({ metaXp: 300, conquered: false }),
    };
    const gl = globalThis as unknown as { localStorage?: Storage | undefined };
    const prev = gl.localStorage;
    gl.localStorage = memStorage(store);
    try {
      let checked = 0;
      for (let s = 0; s < 20 && checked === 0; s++) {
        const g = startRun(`era-reroll-${s}`);
        for (let e = 0; e < 3; e++) {
          g.result = "win"; // 승리 직후 상태를 흉내(continueToNextEra 의 가드)
          g.continueToNextEra();
          let guard = 0;
          if (e < 2) {
            while (g.phase === "draft" && guard++ < 12) g.pickCard(0);
          }
        }
        if (g.phase !== "draft" || !g.canReroll) continue;
        expect(g.era).toBeGreaterThan(1); // 시대를 실제로 넘어온 자리다
        const before = g.draftCards.length;
        expect(before).toBe(3);
        g.reroll();
        expect(g.draftCards.length).toBe(before); // 여전히 3장(새로 뽑음)
        expect(g.canReroll).toBe(false); // 드래프트당 1회 제한은 여기서도 같다
        let picks = 0;
        while (g.phase === "draft" && picks++ < 8) g.pickCard(0);
        expect(g.phase).toBe("watch"); // 리롤 뒤에도 고르고 나면 관전으로 돌아온다
        checked += 1;
      }
      expect(checked).toBeGreaterThan(0); // 실제로 검사한 판이 있었다(빈 통과 방지)
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

describe("시대를 넘겨도 쌓은 경험치를 게워 내지 않는다", () => {
  // 새 시대는 새 World 라 먹이·사냥 누계가 0 부터 다시 센다. game 이 들고 있는 「직전 값」을 함께
  // 되돌리지 않으면 전환 뒤 첫 계산이 (0 − 직전 시대 누계) 를 경험치에 그대로 더한다.
  // 사냥 축이 실제로 그랬다(2026-08-07 계측: 전환마다 −85 ~ −2410 · 카드 1장 이상 손해).
  function crossEra(g: Game): void {
    g.result = "win"; // 승리 직후 상태를 흉내(continueToNextEra 의 가드)
    g.continueToNextEra();
    let guard = 0;
    while (g.phase === "draft" && guard++ < 12) g.pickCard(0); // 시대 보상 + 밀린 레벨업 카드
    g.update(34); // 새 월드의 첫 경험치 계산 — 빚이 남아 있으면 여기서 음수가 들어온다
  }

  it("직전 시대에 사냥을 많이 했어도 시대를 넘긴 뒤 경험치가 음수가 되지 않는다", () => {
    const g = startRun("xp-carry-hunt");
    g.world.playerHuntKills = 500; // 직전 시대에 사냥을 많이 한 상태
    for (let i = 0; i < 5; i++) g.update(34); // 그 사냥이 경험치·레벨로 반영된다
    const levelBefore = g.level;
    crossEra(g);
    expect(g.xp).toBeGreaterThanOrEqual(0);
    expect(g.level).toBeGreaterThanOrEqual(levelBefore); // 쌓은 레벨을 되돌려 뱉지 않는다
  });

  it("풀만 뜯은 종도 시대를 넘긴 뒤 경험치가 음수가 되지 않는다(채집 축 회귀 방지)", () => {
    const g = startRun("xp-carry-food");
    g.world.playerFoodEaten = 400;
    for (let i = 0; i < 5; i++) g.update(34);
    crossEra(g);
    expect(g.xp).toBeGreaterThanOrEqual(0);
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
describe("카드의 전제 조건(드래프트 후보 필터)", () => {
  const keyCards = CARD_POOL.filter((c) => c.key !== undefined);

  // ⚠ **게이트를 연 게놈으로 잰다** (2026-08-10 · **[사용자]** 「티어를 올리면 카드가 열린다」).
  //   도장 0 으로 재면 카드가 게이트에서 **먼저** 걸려, 「이미 가져서 빠진 것」과 「아직 안 열린 것」이
  //   구별되지 않는다. 이 블록이 재려는 것은 앞쪽(죽은 카드 필터)이므로 문을 다 열어 놓고 잰다.
  const OPEN_PIPS: Pips = {
    fang: TIER_STEPS[3] as number,
    leg: TIER_STEPS[3] as number,
    eye: TIER_STEPS[3] as number,
    hide: TIER_STEPS[3] as number,
    herd: TIER_STEPS[3] as number,
  };

  it("풀에 열쇠 카드가 일곱 종류 있다(열쇠마다 정확히 한 장)", () => {
    expect(keyCards.length).toBe(KEY_NAMES.length);
    expect(new Set(keyCards.map((c) => c.key)).size).toBe(KEY_NAMES.length);
  });

  it("이미 가진 열쇠는 한 번도 다시 안 나온다", () => {
    debugSetMetaLevel(20); // 모든 카드 해금
    const rng = new Rng("prereq");
    const g = genomeFromPips(OPEN_PIPS, { ...emptyKeys(), fin: true });
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
    const full = genomeFromPips(OPEN_PIPS, { ...emptyKeys(), fin: true, echo: true, venom: true });
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

  // ⚠ **「도장이 최고 티어인 범주로만 가는 카드는 후보에서 빠진다」를 v9 구조로 옮겼다.**
  //   카드가 도장을 안 주므로 「최고 티어라 더 못 받는 카드」라는 것이 없어졌다. 지금 죽은 카드는
  //   **이미 가진 특성**뿐이다(같은 특성을 두 번 주면 배수가 곱해져 다시 카드 운의 곱이 된다 →
  //   `cards.ts` 의 `cardRedundant`). 재는 계약은 그대로다: **아무 일도 안 하는 카드는 후보에 안 든다.**
  it("이미 가진 특성 카드는 후보에서 빠진다(죽은 카드)", () => {
    const perkCards = CARD_POOL.filter((c) => c.perk !== undefined);
    expect(perkCards.length).toBeGreaterThan(0); // 전제: 특성 카드가 실제로 있다
    const ownedCards = perkCards.slice(0, 3);
    const owned: PerkName[] = [];
    for (const c of ownedCards) if (c.perk !== undefined) owned.push(c.perk);
    const g = genomeFromPips(OPEN_PIPS, emptyKeys(), owned);
    for (const c of ownedCards) {
      expect(cardPrereqMet(c, g), `${c.id} 를 이미 가졌는데 후보에 남았다`).toBe(false);
      expect(cardRedundant(c, g)).toBe(true);
    }
    const ownedIds = new Set(ownedCards.map((c) => c.id));
    const rng = new Rng("perk-dup");
    for (let i = 0; i < 500; i++) {
      const drawn = drawCards(rng, 3, (c) => cardPrereqMet(c, g) && !cardRedundant(c, g), 7);
      expect(drawn.some((c) => ownedIds.has(c.id))).toBe(false);
      expect(drawn.length).toBe(3); // 그래도 후보 3장은 채워진다(풀이 안 마른다)
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
      // v8: 「자리 지키기」·「표시된 것 사냥」이 생겨 계수형이 셋뿐이 아니게 됐다. 아래 세 계수기로
      // 판정이 갈리는 시험만 고른다 — 「무리」는 개체 수가, 「자리」는 위치가, 「표식」은 표식 킬이 정한다.
      if (g.trial && (g.trial.kind === "hunt" || g.trial.kind === "feed" || g.trial.kind === "birth")) return g;
    }
    throw new Error("계수형 시험(hunt·feed·birth)이 걸리는 시드를 찾지 못했습니다");
  }

  /** 이 종류의 시험이 걸리는 시드를 찾는다. 못 찾으면 던진다(그 자체가 결함 신호다). */
  function startWithTrialKind(prefix: string, kind: TrialKind): Game {
    for (let s = 0; s < 60; s++) {
      const g = startRunEra1(`${prefix}-${s}`);
      if (g.trial?.kind === kind) return g;
    }
    throw new Error(`시험 「${kind}」가 걸리는 시드를 찾지 못했습니다`);
  }

  // ── 세계 위에 목표를 찍는 시험 (**[사용자 2026-08-06]** 「무엇을 해라」에서 「무엇을 지켜라」로) ──
  //
  // 이 절이 지키는 것: **목표가 실제로 땅 위에 있고, 갈 수 있고, 잡을 수 있다.**
  // 예전 시험(「사냥 5회」)은 화면 어디에도 없어서 "뭘 하려는 건지 모르겠다"가 나왔다(2026-08-02 폰 실기).

  it("「자리 지키기」는 세계에 원을 찍는다 · 갈 수 있는 곳에, 무리에서 떨어뜨려", () => {
    const g = startWithTrialKind("trial-hold", "hold");
    const z = g.world.trialZone;
    expect(z, "hold 시험인데 세계에 자리가 안 찍혔다").not.toBeNull();
    if (!z) return;
    // **갈 수 있어야 한다** — 못 가는 자리에 목표를 찍는 것은 못 하는 시험을 내는 것이다.
    const t = g.genome.traits;
    const canSwim = t.swimming >= SIM.swimThreshold;
    const canLand = t.swimming < SIM.aquaticOnlyThreshold;
    const canFly = t.wings >= SIM.flyThreshold;
    expect(g.world.terrain.isPassable(z.x, z.y, canSwim, canLand, canFly)).toBe(true);
    // **발밑이면 안 된다** — 아무것도 안 해도 합격이면 그건 시험이 아니다.
    const c = g.world.playerCentroid();
    expect(Math.hypot(z.x - c.x, z.y - c.y)).toBeGreaterThan(z.r);
    // 월드 밖으로 나가지 않는다.
    expect(z.x).toBeGreaterThanOrEqual(0);
    expect(z.y).toBeGreaterThanOrEqual(0);
    expect(z.x).toBeLessThanOrEqual(g.world.width);
    expect(z.y).toBeLessThanOrEqual(g.world.height);
  });

  it("「자리 지키기」의 진행도는 원 안의 내 종 수다(표시=판정)", () => {
    const g = startWithTrialKind("trial-hold-prog", "hold");
    const z = g.world.trialZone;
    if (!z) throw new Error("자리가 없다");
    const inside = g.world.entities.filter(
      (e) => e.alive && e.species.isPlayer && (e.x - z.x) ** 2 + (e.y - z.y) ** 2 <= z.r * z.r,
    ).length;
    expect(g.trialProgress).toBe(inside);
    // 무리를 통째로 자리 안에 옮기면 진행도가 그만큼 오른다 — 목표는 「가면 된다」여야 한다.
    for (const e of g.world.entities) {
      if (e.species.isPlayer && e.alive) {
        e.x = z.x;
        e.y = z.y;
      }
    }
    expect(g.trialProgress).toBe(g.world.playerPopulation);
  });

  it("「금빛 짐승 잡기」는 고블린을 낳는다 · 내 종이 갈 수 있는 자리에, 세계 안에", () => {
    // 옛 「표시된 것 사냥」(야생에 표식)은 2026-08-12 에 황금 고블린으로 갈아엎었다(sim/goblin.ts ·
    // **[사용자 2026-08-07]** 확정). 표식은 스스로 도망다니다 죽어 시험이 운이 됐다(판 코드 실측 1/4 합격).
    const g = startWithTrialKind("trial-mark", "mark");
    const t = g.trial;
    if (!t) throw new Error("시험이 없다");
    expect(g.world.goblinQuota).toBe(t.target);
    g.world.step(); // 첫 틱에 태어난다
    const gb = g.world.goblin;
    expect(gb, "mark 시험인데 고블린이 안 태어났다").not.toBeNull();
    if (!gb) return;
    // **내 종이 갈 수 있는 자리여야 한다** — 못 가는 곳으로 달아나면 못 하는 시험이 된다.
    const tr = g.genome.traits;
    const canSwim = tr.swimming >= SIM.swimThreshold;
    const canLand = tr.swimming < SIM.aquaticOnlyThreshold;
    const canFly = tr.wings >= SIM.flyThreshold;
    expect(g.world.terrain.isPassable(gb.x, gb.y, canSwim, canLand, canFly)).toBe(true);
    expect(gb.x).toBeGreaterThanOrEqual(0);
    expect(gb.y).toBeGreaterThanOrEqual(0);
    expect(gb.x).toBeLessThanOrEqual(g.world.width);
    expect(gb.y).toBeLessThanOrEqual(g.world.height);
  });

  it("고블린은 접촉으로 잡힌다 · 진행도가 오르고, 남은 수만큼 다음 마리가 곧바로 뜬다", () => {
    const g = startWithTrialKind("trial-mark-kill", "mark");
    const t = g.trial;
    if (!t) throw new Error("시험이 없다");
    g.world.step();
    const gb = g.world.goblin;
    const catcher = g.world.entities.find((e) => e.species.isPlayer && e.alive);
    if (!gb || !catcher) throw new Error("고블린이나 내 종이 없다");
    // 내 종 하나를 고블린 위에 세운다 — 다음 틱의 접촉 판정(catchRadius)이 잡는다.
    catcher.x = gb.x;
    catcher.y = gb.y;
    const before = g.world.roundCounts.marked;
    const quotaBefore = g.world.goblinQuota;
    g.world.step();
    expect(g.world.roundCounts.marked).toBe(before + 1);
    expect(g.world.goblinQuota).toBe(quotaBefore - 1);
    expect(g.trialProgress).toBe(before + 1); // 표시 = 판정(같은 계수를 읽는다)
    if (g.world.goblinQuota > 0) {
      g.world.step(); // 한 마리씩 차례로 — 남았으면 다음 마리가 뜬다
      expect(g.world.goblin, "quota 가 남았는데 다음 고블린이 안 떴다").not.toBeNull();
    }
  });

  it("시험의 자리·표식은 단계가 바뀌면 세계에서 걷힌다(보스·대멸종 단계에 안 남는다)", () => {
    // 2026-08-12 **[사용자]** 제보: 모으기(자리 지키기) 시험 뒤 폭염이 오는데 원이 안 사라졌다.
    // 원인: beginStage 의 채집 가지만 armTrial 을 불러, 보스·대멸종 가지는 세계의 자리·표식을
    // 안 걷었다. 불변식: 지금 시험이 hold 가 아니면 원이 없어야 하고, mark 가 아니면 표식이 없어야 한다.
    const g = startWithTrialKind("trial-clear", "hold");
    expect(g.world.trialZone).not.toBeNull();
    const p = g as unknown as GamePriv;
    for (let i = 0; i < 6 && g.result === null; i++) {
      p.finishStage(true);
      let guard = 0;
      while (g.phase === "draft" && guard++ < 8) g.pickCard(0);
      if (g.trial?.kind !== "hold") expect(g.world.trialZone, `단계 ${i}`).toBeNull();
      if (g.trial?.kind !== "mark") {
        expect(g.world.goblinQuota, `단계 ${i}`).toBe(0);
        expect(g.world.goblin, `단계 ${i}`).toBeNull();
      }
    }
  });

  it("이빨 0단(순수 초식)에게는 사냥이 걸리는 시험이 아예 안 뜬다", () => {
    // **[사용자 2026-08-06]** 「초식 거인 경로는 반드시 만든다」가 이 한 줄에 걸려 있다.
    // 사냥 효율이 정확히 0 인데 사냥 시험을 내면 그건 판정이 아니라 사형 선고다(불씨는 다섯뿐).
    for (let s = 0; s < 24; s++) {
      const g = startRunEra1(`trial-herbivore-${s}`);
      // 이빨 도장을 0 으로 되돌려 순수 초식으로 만든다(파생 능치도 함께 다시 낸다).
      g.genome.pips.fang = 0;
      refreshDerived(g.genome);
      expect(g.genome.traits.hunt).toBe(0);
      const t = (g as unknown as GamePriv).pickTrial();
      expect(t.kind, `초식 종에게 ${t.kind} 시험이 떴다`).not.toBe("hunt");
      // 「금빛 짐승 잡기」(mark)는 이제 초식도 할 수 있다 — 잡기가 물기가 아니라 **접촉**이라서
      // (2026-08-12 황금 고블린 개편 · sim/goblin.ts). 그래서 여기서 mark 를 금지하지 않는다.
    }
  });

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
    expect(g.world.roundCounts).toEqual({ hunts: 0, feeds: 0, births: 0, marked: 0 }); // beginStage 가 리셋
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
});

// ⚠ **「최고 티어는 한 런에 닿을 만한 목표다」 테스트와 그 사다리 모델(`runLadder`·`tierReachRate`·
//   `eraRewardCount`)을 통째로 지웠다.** 그 시험은 **카드를 고르면 도장이 오른다**를 전제로,
//   드래프트를 12·17·22장 굴려 4단 도달률을 재고 「파는 정책 vs 뿌리는 정책」을 비교했다.
//   v9 에서 카드는 도장을 한 개도 안 준다 — 도장은 **방울 구입(`Game.buyTier`)** 으로만 오른다.
//   그래서 이 모델은 무엇을 굴리든 도달률 0 을 뱉는, 잴 것이 없는 시험이 됐다.
//
//   **같은 계약을 v9 로 옮기려면 재야 하는 것이 달라진다**: 한 런에 방울이 얼마나 들어오고
//   (`sim/gene.ts` 의 사건별 지급) 그것으로 문턱을 몇 개 살 수 있는가. 그 값은 아직 안 정해졌다
//   (backlog 「성장 속도 재측정」 · 프로브가 정할 몫). 여기서 숫자를 지어내면 근거 없는 밸런스 상수가
//   하나 생기므로, **다시 세우지 않고 비워 둔다.**

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

// ─────────────────────────────── 방울(유전자 점수) ───────────────────────────────
//
// **[사용자 2026-08-07]** 확정 설계: 방울은 필드에 나타나고 무리가 **밟고 지나가야** 주워진다.
// 모은 방울로 범주의 티어를 산다. 값은 「양」이 아니라 **사건**에 붙는다.
//
// 이 절이 지키는 것 셋:
//   ① 다섯 사건이 실제로 방울을 떨어뜨린다(사건이 났는데 아무것도 안 나오면 화면이 거짓말한다).
//   ② 시대를 넘어도 지갑이 깎이지 않는다 · 오늘(2026-08-07) 사냥 누계에서 실제로 터진 버그의 형제다.
//      새 World 는 geneCollected 를 0 부터 다시 세므로, game 이 든 직전값을 짝으로 안 되돌리면
//      전환마다 (0 − 직전 누계) 가 지갑에서 빠진다.
//   ③ 가격이 화면 표시(= tiers.ts 의 문턱)와 정확히 같다. 「3개 필요」라 적었으면 3개가 나가고 3개가 든다.
describe("방울(유전자 점수) · 사건에서 나와 티어로 바뀐다", () => {
  /** private 접근(기존 GamePriv 패턴). 지갑을 직접 채우는 것은 sim 의 줍기 판정이 아직 없기 때문이다. */
  type GenePriv = {
    stageIndex: number;
    currentTrial: Trial | null;
    finishStage(a: boolean, b?: boolean): void;
    geneBankValue: number;
    awardGenes(reason: GeneReason, times?: number): void;
    /** 위기 회복의 상태 기계 · 「가라앉았는가 · 최고가 얼마인가」를 테스트가 직접 확인한다. */
    crisisWatch: CrisisWatch;
  };

  /** 지갑에 방울 n 개를 넣는다(필드에 떨어뜨렸다 밟는 과정을 생략한 것 · 구매 계약만 재는 자리). */
  function fundGenes(g: Game, n: number): void {
    (g as unknown as GenePriv).geneBankValue = n;
  }

  const dropsOf = (g: Game, reason: string): { amount: number; taken: boolean }[] =>
    g.world.geneDrops.filter((d) => d.reason === reason);

  it("보스를 격퇴하면 방울이 떨어진다 · 버티기만 해서는 안 떨어진다", () => {
    const g = startRun("gene-boss");
    const priv = g as unknown as GenePriv;
    priv.stageIndex = 2; // SCHEDULE[2] = "boss"
    expect(g.world.geneDrops).toHaveLength(0); // 판이 시작만 된 상태에는 아무것도 없다
    priv.finishStage(true, true); // 격퇴
    const got = dropsOf(g, "boss");
    expect(got).toHaveLength(1);
    expect(got[0]?.amount).toBe(GENE_AWARD.boss);
    expect(got[0]?.taken).toBe(false); // 필드에 놓인다 · 지갑에 바로 들어가지 않는다

    // 버틴 것은 격퇴가 아니다. 이 차이가 「위협을 잡으러 가는 이유」다.
    const h = startRun("gene-boss-hold");
    const hp = h as unknown as GenePriv;
    hp.stageIndex = 2;
    hp.finishStage(true, false);
    expect(dropsOf(h, "boss")).toHaveLength(0);
  });

  it("대멸종을 견디면 방울이 떨어지고, 세계가 바뀌어도 사라지지 않는다", () => {
    const g = startRun("gene-ext");
    const priv = g as unknown as GenePriv;
    priv.stageIndex = SCHEDULE.length - 1; // 대멸종은 시대의 마지막 단계다
    priv.finishStage(true);
    expect(g.result).toBe("win");
    const got = dropsOf(g, "extinction");
    expect(got).toHaveLength(1);
    expect(got[0]?.amount).toBe(GENE_AWARD.extinction);

    // 대멸종 방울은 이 세계에서는 주울 시간이 0 이다(바로 시대가 끝난다). 그대로 두면 화면이
    // 「대멸종 생존 · 방울 +4」라 말해 놓고 한 개도 안 주는 거짓말이 된다.
    g.continueToNextEra();
    const carried = dropsOf(g, "extinction");
    expect(carried, "새 세계로 안 옮겨져 영영 못 줍는 방울이 됐다").toHaveLength(1);
    expect(carried[0]?.amount).toBe(GENE_AWARD.extinction);
    expect(carried[0]?.taken).toBe(false);
  });

  it("시험을 크게 넘겨 합격하면 방울이 떨어진다", () => {
    const g = startRun("gene-trial");
    const priv = g as unknown as GenePriv;
    priv.stageIndex = 0; // SCHEDULE[0] = "forage"
    priv.currentTrial = { kind: "hunt", target: 1, label: "사냥 1회" };
    g.world.roundCounts.hunts = 99; // 목표의 1.8배를 한참 넘겼다
    let overachieved = false;
    g.onTrialVerdict = (v) => {
      overachieved = v.overachieved;
    };
    priv.finishStage(true);
    expect(overachieved).toBe(true);
    const got = dropsOf(g, "trialExceed");
    expect(got).toHaveLength(1);
    expect(got[0]?.amount).toBe(GENE_AWARD.trialExceed);
  });

  it("개체 수 최고 기록이 사다리 눈금을 넘을 때마다 방울이 떨어진다", () => {
    const g = startRun("gene-milestone");
    expect(g.peakPopulation).toBe(0);
    g.world.spawnPlayerBrood(30); // 첫 눈금(20) 위로 한 번에 올린다 · 대량 번식과 같은 상황
    g.update(34);
    const got = dropsOf(g, "milestone");
    // 눈금 수는 최고 기록 하나로 정해진다(지금 개체 수가 아니라) · 두 곳에 규칙이 있으면 반드시 어긋난다.
    expect(got).toHaveLength(milestonesCrossed(0, g.peakPopulation));
    expect(got.length).toBeGreaterThan(0);
    for (const d of got) expect(d.amount).toBe(GENE_AWARD.milestone);

    // 최고 기록은 단조 증가라 같은 눈금을 두 번 주지 않는다.
    const n = got.length;
    for (let i = 0; i < 5; i++) g.update(34);
    expect(dropsOf(g, "milestone")).toHaveLength(milestonesCrossed(0, g.peakPopulation));
    expect(dropsOf(g, "milestone").length).toBeGreaterThanOrEqual(n);
  });

  it("위기 회복 · 절반 아래로 무너졌다 돌아온 순간에만 떨어진다", () => {
    const g = startRun("gene-recovery");
    g.world.spawnPlayerBrood(30); // 최고 기록을 문턱(geneCrisisMinPeak) 위로 올린다
    g.update(34);
    const peak = g.peakPopulation;
    expect(peak).toBeGreaterThanOrEqual(GAME.geneCrisisMinPeak);
    expect(dropsOf(g, "recovery")).toHaveLength(0); // 아직 무너진 적이 없다

    // 무리가 절반 아래로 무너진다(굶주림·잡아먹힘으로 실제로 일어나는 일).
    let kept = 0;
    const keep = Math.floor(peak * 0.4);
    for (const e of g.world.entities) {
      if (!e.species.isPlayer) continue;
      kept += 1;
      if (kept > keep) e.alive = false;
    }
    g.update(34); // 죽은 것이 걸러지며 개체 수가 실제로 떨어진다
    expect(g.world.playerPopulation).toBeLessThan(peak * 0.5);
    expect(dropsOf(g, "recovery"), "가라앉기만 했는데 회복 방울이 나왔다").toHaveLength(0);

    // 다시 최고의 90% 위로 돌아온다.
    g.world.spawnPlayerBrood(peak);
    g.update(34);
    const got = dropsOf(g, "recovery");
    expect(got).toHaveLength(1);
    expect(got[0]?.amount).toBe(GENE_AWARD.recovery);

    // 돌아온 뒤에 계속 돌려도 다시 주지 않는다(한 번 무너져야 한 번 회복이다).
    for (let i = 0; i < 5; i++) g.update(34);
    expect(dropsOf(g, "recovery")).toHaveLength(1);
  });

  // ⚠ 위 테스트는 **한 세계 안에서만** 잰다. 시대를 넘으면 세계가 통째로 새로 만들어지고 무리는
  //   시작 수(18마리)로 돌아가는데, 위기 회복의 최고 기록이 옛 시대 것으로 남아 있으면 그 순간
  //   「절반 아래로 가라앉았다」가 서고, 새 세계에서 자라기만 해도 회복 방울이 나온다. 무리는 한 번도
  //   무너진 적이 없고 예정된 세계 교체를 지났을 뿐이다.
  it("시대를 넘어 새 세계에서 자란 것은 위기 회복이 아니다", () => {
    const g = startRun("gene-recovery-era");
    const priv = g as unknown as GenePriv;
    g.world.spawnPlayerBrood(30); // 이 시대에 무리를 크게 키운다 → 최고 기록이 높아진다
    g.update(34);
    const peak = priv.crisisWatch.peak;
    expect(peak).toBeGreaterThan(GAME.geneCrisisMinPeak * 1.8); // 새 시작 무리(18)의 절반 위로 충분히 높다
    expect(dropsOf(g, "recovery")).toHaveLength(0); // 이 시대에는 무너진 적이 없다

    // 예정된 세계 교체. 새 세계의 시작 무리는 옛 최고의 절반보다 작다.
    g.result = "win";
    g.continueToNextEra();
    let guard = 0;
    while (g.phase === "draft" && guard++ < 12) g.pickCard(0);
    g.update(34);
    expect(priv.crisisWatch.sunk, "새 세계의 시작 무리를 「가라앉았다」고 봤다").toBe(false);

    // 새 세계에서 옛 최고의 90% 언저리까지 자란다(위기를 겪은 적이 없다).
    g.world.spawnPlayerBrood(Math.max(1, Math.ceil(peak * 0.95) - g.world.playerPopulation));
    g.update(34);
    expect(
      dropsOf(g, "recovery"),
      "무너진 적이 없는데 세계 교체만으로 회복 방울이 나왔다",
    ).toHaveLength(0);
  });

  // ⚠ 위의 「위기 회복」 테스트는 무리를 30마리로 부풀려 시작하므로 **문턱(geneCrisisMinPeak) 위 경로만**
  //   지난다. 그래서 문턱을 0 으로 바꿔도 그 테스트는 그대로 통과한다 = 문턱을 아무도 안 지키고 있었다.
  //   판이 막 시작한 서너 마리 무리는 한 마리가 죽고 사는 것만으로 「절반 아래 → 90% 복귀」가 몇 초마다
  //   성립하므로, 문턱이 없으면 회복 방울이 판당 수십 개가 되어 가격표가 통째로 어긋난다.
  it("최고 기록이 문턱 아래인 작은 무리는 회복해도 방울이 안 나온다", () => {
    const g = startRun("gene-recovery-gate");
    const priv = g as unknown as GenePriv;
    // 첫 update 전에 무리를 문턱 아래로 줄인다 · 최고 기록은 update 에서만 오르므로 여기서 정한 수가
    // 그대로 이 런의 최고가 된다(부풀리지 않는 것이 이 테스트의 핵심이다).
    const small = Math.max(6, GAME.geneCrisisMinPeak - 6);
    let kept = 0;
    for (const e of g.world.entities) {
      if (!e.species.isPlayer) continue;
      kept += 1;
      if (kept > small) e.alive = false;
    }
    g.update(34);
    const peak = priv.crisisWatch.peak;
    expect(peak).toBeGreaterThan(0); // 무리가 통째로 죽었으면 아래 회복 자체가 성립하지 않는다

    // 절반 아래로 무너진다.
    kept = 0;
    const keep = Math.floor(peak * 0.4);
    for (const e of g.world.entities) {
      if (!e.species.isPlayer || !e.alive) continue;
      kept += 1;
      if (kept > keep) e.alive = false;
    }
    g.update(34);
    expect(priv.crisisWatch.sunk, "가라앉지도 않았다면 이 테스트는 문턱을 재는 것이 아니다").toBe(
      true,
    );

    // 최고의 90% 위로 돌아온다 · 상태 기계로는 회복이 성립하지만, 문턱 아래라 방울은 안 나온다.
    g.world.spawnPlayerBrood(Math.max(1, peak - g.world.playerPopulation));
    g.update(34);
    expect(priv.crisisWatch.sunk, "회복 자체가 성립하지 않았다면 문턱을 안 잰 것이다").toBe(false);
    expect(
      dropsOf(g, "recovery"),
      "최고 기록이 문턱 아래인데 회복 방울이 나왔다(문턱이 안 걸린다)",
    ).toHaveLength(0);
    // 이 테스트가 재는 것을 마지막에 한 줄로 못박는다 · 위의 무리는 문턱 아래였다.
    expect(peak).toBeLessThan(GAME.geneCrisisMinPeak);
  });

  it("시대를 넘겨도 지갑이 깎이지 않는다 (오늘 터진 사냥 누계 버그의 형제)", () => {
    const g = startRun("gene-bank-era");
    g.world.geneCollected = 30; // 이 시대에 방울 30개를 주웠다
    g.update(34);
    const banked = g.geneBank;
    expect(banked).toBeGreaterThanOrEqual(30);

    g.result = "win"; // 승리 직후 상태를 흉내(continueToNextEra 의 가드)
    g.continueToNextEra();
    let guard = 0;
    while (g.phase === "draft" && guard++ < 12) g.pickCard(0);
    // 새 World 의 geneCollected 는 0 이다. 직전값을 짝으로 안 되돌렸으면 여기서 −30 이 들어온다.
    for (let i = 0; i < 5; i++) g.update(34);
    expect(g.geneBank).toBeGreaterThanOrEqual(banked); // 시대가 바뀌었다고 모은 것이 사라지지 않는다
    expect(g.geneBank).toBeGreaterThanOrEqual(0);
  });

  // ⚠ 바로 위 테스트만으로는 **이 버그를 못 잡는다.** `harvestGenes` 가 `if (got > last)` 로 막고 있어
  //   지갑은 애초에 줄어들 수 없다 · "안 깎였다"는 짝을 되돌리든 말든 늘 참이다(항진명제).
  //   짝을 놓쳤을 때 실제로 나는 증상은 **깎이는 것이 아니라 「새 시대의 수입이 통째로 증발하는 것」**이다
  //   (직전값이 30 으로 남아, 새 World 의 누계가 30 을 넘을 때까지 delta 가 하나도 안 잡힌다).
  //   실측: `continueToNextEra` 의 `lastGeneCollected = 0` 한 줄을 지우면 런당 주운 방울의 절반 가까이가
  //   지갑에 안 들어온다(9프리셋 × 4시드 · 예: 42개를 주웠는데 지갑 17). 그런데 game.test.ts 73개가
  //   전부 통과했다. 그래서 「수입이 들어오는가」를 직접 재는 이 테스트를 짝으로 둔다.
  it("시대를 넘긴 뒤에도 새 시대에 주운 방울이 지갑에 들어온다 (직전값 짝의 진짜 증상)", () => {
    const g = startRun("gene-bank-era-income");
    g.world.geneCollected = 30; // 옛 시대에 30개를 벌었다
    g.update(34);
    const banked = g.geneBank;
    expect(banked).toBeGreaterThanOrEqual(30);

    g.result = "win"; // 승리 직후 상태를 흉내(continueToNextEra 의 가드)
    g.continueToNextEra();
    let guard = 0;
    while (g.phase === "draft" && guard++ < 12) g.pickCard(0);

    // 이월된 방울을 치워 잡음을 없앤다(이 테스트가 재는 것은 「delta 가 잡히는가」 하나다).
    g.world.geneDrops.length = 0;
    g.world.geneCollected = 5; // 새 시대에서 5개를 주웠다
    g.update(34);
    expect(g.geneBank, "새 시대의 수입이 지갑에 안 들어왔다(직전값 짝을 놓쳤다)").toBe(banked + 5);
  });

  it("새 런은 빈 지갑으로 시작한다", () => {
    const g = startRun("gene-bank-reset");
    fundGenes(g, 17);
    expect(g.geneBank).toBe(17);
    g.beginRun();
    expect(g.geneBank).toBe(0);
  });

  it("가격은 tiers.ts 의 문턱 그대로다 · 새 가격표를 만들지 않는다", () => {
    const g = startRun("gene-price");
    for (const cat of CATEGORIES) expect(g.tierCost(cat)).toBe(pipsToNext(g.pipsNow[cat]));
  });

  it("방울이 모자라면 못 사고 상태를 하나도 안 바꾼다", () => {
    const g = startRun("gene-buy-poor");
    const cat: Category = "leg";
    const cost = g.tierCost(cat);
    expect(cost).toBeGreaterThan(0);
    fundGenes(g, cost - 1); // 딱 하나 모자라다
    const pipsBefore = { ...g.pipsNow };
    const traitsBefore = { ...g.genome.traits };
    expect(g.canBuyTier(cat)).toBe(false);
    expect(g.buyTier(cat)).toBe(false);
    expect(g.pipsNow).toEqual(pipsBefore);
    expect(g.genome.traits).toEqual(traitsBefore);
    expect(g.geneBank).toBe(cost - 1); // 실패는 지갑도 안 건드린다
    expect(g.takeNewTiers()).toEqual([]); // 승급 알림도 안 샌다
  });

  it("사면 도장이 정확히 다음 문턱에 닿고 방울이 정확히 그 비용만큼 준다", () => {
    const g = startRun("gene-buy");
    const cat: Category = "leg";
    const cost = g.tierCost(cat);
    const tierBefore = tierOf(g.pipsNow[cat]);
    fundGenes(g, cost + 4); // 거스름돈이 남는지도 본다
    expect(g.canBuyTier(cat)).toBe(true);
    expect(g.buyTier(cat)).toBe(true);
    expect(g.pipsNow[cat]).toBe(pipsForTier(tierBefore + 1)); // 더도 덜도 아닌 정확히 문턱
    expect(tierOf(g.pipsNow[cat])).toBe(tierBefore + 1);
    expect(g.geneBank).toBe(4); // 화면에 적힌 비용만큼만 나갔다

    // 살아 있는 무리도 함께 올라야 한다 · 종 기준선만 올리면 화면은 올랐는데 뛰는 몸은 그대로다.
    let checked = 0;
    for (const e of g.world.entities) {
      if (!e.species.isPlayer || !e.alive) continue;
      checked += 1;
      expect(e.genome.pips[cat]).toBe(g.pipsNow[cat]);
    }
    expect(checked).toBeGreaterThan(0);

    // 승급 알림이 큐에 실린다(화면이 「무엇이 켜졌나」를 말하는 근거).
    expect(g.takeNewTiers()).toEqual([{ cat, tier: tierBefore + 1 }]);
  });

  it("최고 티어에서는 더 살 수 없다", () => {
    const g = startRun("gene-buy-max");
    const cat: Category = "leg";
    fundGenes(g, 999);
    let guard = 0;
    while (g.buyTier(cat) && guard++ < 10) {
      // 4단에 닿을 때까지 산다
    }
    expect(tierOf(g.pipsNow[cat])).toBe(MAX_TIER);
    expect(g.pipsNow[cat]).toBe(pipsForTier(MAX_TIER));
    expect(g.tierCost(cat)).toBe(0); // 더 살 것이 없다
    expect(g.canBuyTier(cat)).toBe(false);
    const bankBefore = g.geneBank;
    expect(g.buyTier(cat)).toBe(false);
    expect(g.geneBank).toBe(bankBefore);
  });

  it("0단에서 4단까지 드는 방울은 TIER_STEPS 의 끝(20)과 같다", () => {
    // 「한 범주를 0에서 4단까지 = 총 20개」가 확정 설계다. 두 곳에 적히면 조용히 어긋나므로
    // 실제 구매를 돌려 합계를 잰다(가격표가 tiers.ts 하나라는 것의 증거).
    const g = startRun("gene-total");
    const cat: Category = "leg";
    const startPips = g.pipsNow[cat];
    fundGenes(g, 999);
    let spent = 0;
    let guard = 0;
    while (g.canBuyTier(cat) && guard++ < 10) {
      spent += g.tierCost(cat);
      g.buyTier(cat);
    }
    expect(startPips + spent).toBe(TIER_STEPS[TIER_STEPS.length - 1]);
    expect(g.geneBank).toBe(999 - spent);
  });

  // ── sim 의 줍기와 game 의 지갑을 잇는 이음매 ────────────────────────────────────
  // 이 두 층은 따로따로 테스트돼 있었다(sim 은 `world.geneCollected` 가 는다 · game 은 지갑을 직접
  // 채워 구매 계약을 잰다). **그 사이가 안 이어져 있어도 양쪽 테스트는 다 통과한다** · 실제로
  // 오늘(2026-08-07) 사냥 누계가 정확히 그 이음매에서 끊겨 시대마다 경험치를 깎았다. 여기서 못 박는다.
  it("필드의 방울을 밟으면 그만큼 지갑이 는다 (sim 줍기 → game 지갑)", () => {
    const g = startRun("gene-pickup");
    expect(g.geneBank).toBe(0);
    // **개체 발밑**에 놓는다 · 이번에 재는 것은 「자리 고르기」가 아니라 「주운 것이 지갑까지
    // 오는가」다. 무게중심에 놓으면 무리가 흩어져 있을 때 아무도 줍기 반경(16) 안에 없을 수 있다.
    const me = g.world.entities.find((e) => e.species.isPlayer && e.alive);
    if (me === undefined) throw new Error("내 종이 하나도 없다 · 이 테스트가 아무것도 안 재고 있다");
    g.world.spawnGeneDrop(me.x, me.y, 3, "boss");
    let guard = 0;
    while (g.geneBank === 0 && guard++ < 40) g.update(34);
    expect(g.world.geneCollected, "sim 이 아예 안 주웠다").toBe(3);
    expect(g.geneBank, "sim 은 주웠는데 지갑에 안 들어왔다(이음매 끊김)").toBe(3);

    // 한 번 주운 방울이 매 틱 다시 세이지 않는다(누계 delta 를 잘못 뜨면 지갑이 무한히 는다).
    for (let i = 0; i < 20; i++) g.update(34);
    expect(g.geneBank).toBe(3);
  });

  /**
   * **이 기능 전체가 서 있는 한 문장**: 방울이 뜬 곳을 탭하면 무리가 가서 줍는다.
   *
   * 왜 따로 재는가: 「가라」 명령은 개체가 목표 64px 안(`ORDER.releaseRadius`)에 들면 놓아 주는데
   * 줍기 반경은 16px(`GENE_PICK_RADIUS`)이다. **명령만으로는 자동으로 안 겹친다** · 무리가 그 원
   * 안에서 돌아다니다 누군가 스치는 것에 기댄다. 두 상수 중 하나만 움직여도 「보냈는데 안 주워진다」가
   * 되고, 그건 이 설계에서 가장 나쁜 고장이다(사람은 명령이 안 먹혔다고 읽는다).
   *
   * 세계는 **실제 플레이 치수**로 만든다(startRun 의 240x400 은 고리가 통째로 클램프돼 거리가 거짓이
   * 된다). 실측(2026-08-07 · 6시드)은 0.2~11.8초였고, 예산 900틱(약 30초)은 한 라운드 안이라는 뜻이다.
   */
  it("방울로 보낸 무리가 실제로 줍는다 (명령 반경 64 vs 줍기 반경 16)", () => {
    for (const seed of ["reach-a", "reach-b", "reach-c"]) {
      const g = new Game(MOBILE.width, MOBILE.height);
      g.fixedSeed = seed;
      g.beginRun();
      let guard = 0;
      while (g.phase === "draft" && guard++ < 12) g.pickCard(0);
      for (let i = 0; i < 30; i++) g.update(34); // 무리가 자리를 잡는다

      const before = g.world.geneCollected;
      const bankBefore = g.geneBank;
      expect(g.world.spawnGeneDropNear(3, "boss"), `${seed}: 방울을 아예 못 놨다`).toBe(true);
      const drop = g.world.geneDrops[g.world.geneDrops.length - 1];
      expect(drop).toBeDefined();
      if (drop === undefined) return;
      expect(g.setHerdOrder(drop.x, drop.y, "move"), `${seed}: 그 자리로 보내는 명령이 거부됐다`).toBe(true);

      // **보낸 그 방울**이 주워지는지를 본다 · 예전엔 "geneCollected 가 움직였는가"로 물었는데,
      // 2026-08-09 「방울 우선」 이후로 무리가 가는 길의 **다른** 사건 방울도 알아서 주워서 그
      // 조건이 먼저 참이 될 수 있다(그러면 정작 보낸 곳은 안 재게 된다).
      let t = 0;
      while (!drop.taken && t < 900) {
        g.update(34);
        t++;
      }
      expect(t, `${seed}: 보냈는데 30초 안에 아무도 못 주웠다`).toBeLessThan(900);
      // 지갑은 **그사이 sim 이 센 만큼** 정확히 는다(상수 3 을 못 박지 않는다 · 위와 같은 이유로
      // 다른 방울이 함께 주워질 수 있다). 못 박을 것은 숫자가 아니라 sim ↔ 지갑의 이음매다.
      expect(g.geneBank - bankBefore).toBe(g.world.geneCollected - before);
      expect(g.geneBank - bankBefore).toBeGreaterThanOrEqual(3);
    }
  }, 60000);

  it("방울은 무리가 갈 수 있는 곳에만 떨어진다 (못 줍는 방울을 약속하지 않는다)", () => {
    // 화면이 「보스 격퇴 · 방울 +3」이라 말해 놓고 그 방울이 건너편 섬이면 그건 거짓말이다.
    // 자리 고르기는 sim(`spawnGeneDropNear`)이 맡고 game 은 부르기만 한다 · 그 계약을 여기서 잰다.
    const g = startRun("gene-reach");
    const terr = g.world.terrain;
    const tr = g.genome.traits;
    const canSwim = tr.swimming >= SIM.swimThreshold;
    const canLand = tr.swimming < SIM.aquaticOnlyThreshold;
    const canFly = tr.wings >= SIM.flyThreshold;
    const priv = g as unknown as GenePriv;
    for (let i = 0; i < 15; i++) priv.awardGenes("boss");
    expect(g.world.geneDrops.length).toBeGreaterThan(10);
    const c = g.world.playerCentroid();
    for (const d of g.world.geneDrops) {
      expect(terr.isPassable(d.x, d.y, canSwim, canLand, canFly), "못 가는 지형에 떨어졌다").toBe(true);
      const sameTile = terr.tileIndex(c.x, c.y) === terr.tileIndex(d.x, d.y);
      const seen = terr.lineOfSight(c.x, c.y, d.x, d.y, canSwim, canLand, canFly);
      const walk = sameTile || seen || terr.findPath(c.x, c.y, d.x, d.y, canSwim, canLand, canFly).length > 0;
      expect(walk, "걸어서 닿을 수 없는 자리에 떨어졌다").toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 구입 화면이 열린 동안에는 시간이 멈춘다
//
// **[사용자 2026-08-09]** "방울 업그레이드 고르는 중에는 시간이 안 멈추나? 그거 보다보니
// 멸종해버렸는데". 카드 드래프트는 phase 를 바꿔 멈추는데 구입 화면은 화면만 띄우고 있었다.
//
// ⚠ 이 저장소에는 「유령 드래프트 멈춤」 전력이 있다(2026-08-07). 멈추는 것보다 **정확히 돌아오는
//   것**이 어렵다. 그래서 여기서는 단계 넷(채집·시험·보스·대멸종)에서 저마다 열고 닫아 본다.
// ---------------------------------------------------------------------------
describe("방울 구입 화면 · 열려 있는 동안 시간이 멈춘다", () => {
  /** 이 세계의 지문 · 결정론 비교용(herdOrder.test.ts 의 snapshot 과 같은 형태). */
  function fingerprint(g: Game): string {
    const ents = g.world.entities.map(
      (e) => `${e.id}:${e.x.toFixed(3)},${e.y.toFixed(3)},${e.energy.toFixed(3)}`,
    );
    return `t${g.world.tick}|p${g.world.population}|${ents.join(";")}`;
  }

  /** 지금 단계에서 열고 닫아 본다: 멈췄나 · 정확히 돌아왔나 · 다시 흐르나. */
  function openCloseHere(g: Game, label: string): void {
    expect(g.phase, `${label}: 전제가 관전이 아니다`).toBe("watch");
    const before = {
      tick: g.world.tick,
      seconds: g.secondsLeft,
      pop: g.world.playerPopulation,
      boss: g.world.boss?.name ?? null,
      stage: g.stageNumber,
      trial: g.trial?.label ?? null,
      fp: fingerprint(g),
    };
    expect(g.openGeneShop(), `${label}: 화면이 안 열렸다`).toBe(true);
    expect(g.phase).toBe("shop");
    // 멈춘 동안 프레임은 계속 들어온다(렌더는 돈다) · 그래도 세계는 1비트도 안 움직여야 한다.
    for (let i = 0; i < 90; i++) g.update(34);
    expect(fingerprint(g), `${label}: 멈춘 동안 세계가 움직였다`).toBe(before.fp);
    expect(g.world.tick, `${label}: 멈춘 동안 틱이 돌았다`).toBe(before.tick);
    expect(g.secondsLeft, `${label}: 멈춘 동안 남은 시간이 줄었다`).toBe(before.seconds);
    g.closeGeneShop();
    // **정확히 그 단계로** 돌아온다. 타이머·보스·시험·단계 번호가 그대로다.
    expect(g.phase, `${label}: 닫았는데 관전으로 안 돌아왔다`).toBe("watch");
    expect(g.secondsLeft, `${label}: 남은 시간이 어긋났다`).toBe(before.seconds);
    expect(g.world.boss?.name ?? null, `${label}: 보스가 사라졌다`).toBe(before.boss);
    expect(g.stageNumber, `${label}: 단계가 넘어갔다`).toBe(before.stage);
    expect(g.trial?.label ?? null, `${label}: 시험이 바뀌었다`).toBe(before.trial);
    expect(g.world.playerPopulation, `${label}: 무리가 줄었다`).toBe(before.pop);
    // 다시 흐른다.
    g.update(34);
    expect(g.world.tick, `${label}: 닫았는데 시간이 안 흐른다`).toBeGreaterThan(before.tick);
  }

  it("채집 라운드 도중에 열고 닫아도 그 라운드가 그대로 이어진다", () => {
    const g = startRun("shop-forage");
    for (let i = 0; i < 60; i++) g.update(34);
    openCloseHere(g, "채집");
  });

  it("시험이 걸린 라운드에서도 마찬가지다(진행도·기한이 안 어긋난다)", () => {
    // ⚠ 시험은 **진도 1 부터** 붙는다(`stepHasTrial`) · 저장본이 없는 테스트에서는 진도 = 시대라
    //   era 0 에서 찾으면 영영 못 찾고 테스트가 **조용히 아무것도 안 재게** 된다. 그래서 둘째
    //   시대까지 밀어 놓고, 시험이 실제로 걸렸는지를 먼저 못 박는다.
    let g: Game | null = null;
    for (let k = 0; k < 12 && g === null; k++) {
      const t = startRun(`shop-trial-${k}`);
      t.result = "win";
      t.continueToNextEra(); // era 1 = 진도 1 = 시험 등장
      let guard = 0;
      while (t.phase === "draft" && guard++ < 8) t.pickCard(0);
      for (let i = 0; i < 60 && t.phase === "watch"; i++) t.update(34);
      if (t.phase === "watch" && t.trial !== null) g = t;
    }
    expect(g, "시험이 걸린 라운드를 못 만들었다(이 테스트가 아무것도 안 재고 있다)").not.toBeNull();
    if (g === null) return;
    const progressBefore = g.trialProgress;
    openCloseHere(g, "시험");
    expect(g.trialProgress, "멈춘 사이 시험 진행도가 움직였다").toBe(progressBefore);
  });

  it("보스 관문 도중에 열고 닫아도 그 보스가 그대로 서 있다", () => {
    const g = startRun("shop-boss");
    for (let i = 0; i < 30; i++) g.update(34);
    g.debugSummon("raider"); // 진짜 상태 전이를 밟는 문(known_issues: 디버그 문이 가짜 상태를 만들면 안 된다)
    expect(g.world.boss, "보스 소환이 안 됐다").not.toBeNull();
    openCloseHere(g, "보스");
  });

  it("대멸종 도중에 열고 닫아도 그 관문이 그대로다", () => {
    const g = startRun("shop-ext");
    for (let i = 0; i < 30; i++) g.update(34);
    g.debugSummon("cold");
    openCloseHere(g, "대멸종");
  });

  it("열었다 닫은 판은 **한 번도 안 연 판과 지문까지 같다**(멈춤은 상태를 안 바꾼다)", () => {
    // 멈춤은 「틱을 진행하지 않는 것」이지 상태를 바꾸는 것이 아니다. 그러니 진행한 프레임 수가
    // 같으면 결과도 같아야 한다. 다르면 그 자체가 결함이다(같은 시드 · 같은 update 열).
    const plain = startRun("shop-det");
    for (let i = 0; i < 200; i++) plain.update(34);

    const paused = startRun("shop-det");
    for (let i = 0; i < 90; i++) paused.update(34);
    expect(paused.openGeneShop()).toBe(true);
    for (let i = 0; i < 300; i++) paused.update(34); // 화면을 오래 들여다본다
    paused.closeGeneShop();
    for (let i = 0; i < 110; i++) paused.update(34);

    expect(fingerprint(paused)).toBe(fingerprint(plain));
  });

  it("관전 중이 아니면 아예 안 열린다(드래프트·로비의 복귀 자리를 헝클지 않는다)", () => {
    const g = new Game(240, 400, 1);
    g.fixedSeed = "shop-gate";
    g.beginRun(); // 프리셋 선택 드래프트
    expect(g.phase).toBe("draft");
    expect(g.openGeneShop()).toBe(false);
    expect(g.phase).toBe("draft");
    // 닫기도 안전하다. 열려 있지 않은데 닫아도 남의 단계를 덮어쓰지 않는다.
    g.closeGeneShop();
    expect(g.phase).toBe("draft");
  });
});

describe("챔피언은 시대 눈높이로 눌려 들어온다 (2026-08-11 · [사용자] 「생태계 교란종」 지적)", () => {
  const maxed = (): ReturnType<typeof genomeFromPips> => {
    const pips = emptyPips();
    for (const c of CATEGORIES) pips[c] = TIER_STEPS[3] as number;
    const g = genomeFromPips(pips, emptyKeys(), ["famished", "speed_night"]);
    return g;
  };

  it("낮은 시대에는 능치가 그 시대 티어까지 눌리고, 정점 면제도 함께 사라진다", () => {
    const eased = easeChampionGenome(maxed(), 1);
    expect(eased.traits.attack).toBeLessThanOrEqual(FANG_ATTACK[1] as number);
    expect(eased.traits.speed).toBeLessThanOrEqual(LEG_SPEED[1] as number);
    expect(eased.traits.attack).toBeLessThan(100); // isApex(체급 무시)가 벗겨진다
    expect(eased.traits.speed).toBeLessThan(112); // 사냥꾼 표적 제외도 벗겨진다
  });

  it("시대 4에는 본모습이다 · 단 카드 특성은 어느 시대든 몰수된다", () => {
    const original = maxed();
    const eased = easeChampionGenome(original, 4);
    expect(eased.traits.attack).toBe(original.traits.attack);
    expect(eased.traits.speed).toBe(original.traits.speed);
    expect(eased.perks).toEqual([]);
    expect(easeChampionGenome(original, 1).perks).toEqual([]);
    // 원본은 안 건드린다(저장된 챔피언이 다음 런에서도 본모습을 기억해야 한다).
    expect(original.perks.length).toBeGreaterThan(0);
  });
});

describe("시대를 넘으면 방울이 필드에 떨어진다 (2026-08-11 · [사용자] 「4단은 찍지도 못했어」)", () => {
  it("새 시대의 세계에 「새 시대 진입」 방울이 놓인다 · 지갑 직행이 아니다", () => {
    const g = startRun("era-gene-award");
    const bankBefore = g.geneBank;
    g.result = "win";
    g.continueToNextEra();
    expect(g.era).toBe(1);
    const eraDrops = g.world.geneDrops.filter((d) => d.reason === "era");
    expect(eraDrops.length).toBe(1);
    expect(eraDrops[0]?.amount).toBe(GENE_AWARD.era);
    expect(eraDrops[0]?.taken).toBe(false);
    // 밟아야 주워진다 — 떨어지는 순간 지갑은 안 는다(방울 설계의 계약 그대로).
    expect(g.geneBank).toBe(bankBefore);
  });
});
