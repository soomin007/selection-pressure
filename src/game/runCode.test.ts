// 판 분석 코드 — **넣은 것이 그대로 나오는가**(왕복)와, 어긋났을 때 **말하는가**(버전·검사합).
//
// 이 파일이 지키는 계약 셋:
//  ① 인코드 → 디코드가 원본과 한 글자도 안 다르다(안 그러면 분석이 조용히 다른 판을 본다).
//  ② 코드가 잘리거나 글자가 섞이면 **틀린 표를 뱉지 않고** 거절한다.
//  ③ 버전(스키마·게놈)·카드 풀 지문이 다르면 디코더가 그 사실을 말한다.

import { describe, it, expect } from "vitest";
import {
  RUN_CODE_PREFIX,
  RUN_CODE_SCHEMA,
  CODE_CARDS,
  DRAFT_REROLLED,
  DRAFT_SKIPPED,
  cardByCode,
  cardCodeIndex,
  currentCodeStamp,
  decodeRunCode,
  encodeRunCode,
  isBossThreat,
  poolDigest,
  type RunCodeData,
} from "@/game/runCode";
import { Game } from "@/game/game";
import { CARD_POOL, PRESET_CARDS } from "@/game/cards";
import { CATEGORIES } from "@/sim/tiers";
import { GENOME_VERSION } from "@/sim/genome";

/**
 * 풀에서 i 번째 카드의 id.
 *
 * ⚠ **풀 번호를 그냥 박지 말 것.** 예전엔 `CARD_POOL[88]!.id` 처럼 적어 뒀는데, v9 에서 카드 풀이
 *   90장(도장) → 52장(특성 45 + 열쇠 7)으로 줄자 그 자리가 undefined 가 되어 이 파일의 시험 아홉이
 *   한꺼번에 터졌다. 카드 풀 크기는 앞으로도 바뀐다 → 나머지로 감아 **범위를 안 벗어나게** 한다.
 */
const poolId = (i: number): string => (CARD_POOL[i % CARD_POOL.length] as (typeof CARD_POOL)[number]).id;

/** 있을 법한 한 판을 손으로 지어낸다(모든 기록 종류가 한 번씩 들어가게). */
function sampleData(): RunCodeData {
  return {
    ...currentCodeStamp(),
    header: {
      seed: "r7x2q1",
      mapType: "archipelago",
      metaLevel: 6,
      runsDone: 3,
      champions: 2,
      everConquered: false,
      rerollUnlocked: true,
      leadEnabled: true,
      assistEnabled: true,
    },
    entries: [
      {
        t: "draft",
        kind: "preset",
        boost: 1,
        level: 1,
        cards: PRESET_CARDS.slice(0, 5).map((c) => c.id),
        outcome: 2,
      },
      {
        t: "stage",
        kind: "forage",
        era: 0,
        boss: null,
        extinction: null,
        passed: true,
        defeated: false,
        pop: 18,
        trial: { kind: "feed", target: 45, progress: 91, passed: true, overachieved: true },
      },
      {
        t: "draft",
        kind: "level",
        boost: 1,
        level: 2,
        cards: [poolId(0), poolId(20), poolId(48)],
        outcome: DRAFT_REROLLED,
      },
      {
        t: "draft",
        kind: "level",
        boost: 1,
        level: 2,
        cards: [poolId(3), poolId(25), poolId(41)],
        outcome: DRAFT_SKIPPED,
      },
      { t: "buy", cat: "fang", cost: 5, tier: 2, stage: 2, tick: 140 },
      // 탭 하나 — 재현의 마지막 조각도 왕복하는지 함께 못박는다(2026-08-09 신설).
      { t: "order", stage: 2, tick: 141, x: 231, y: 604, kind: "evade" },
      {
        t: "stage",
        kind: "boss",
        era: 0,
        boss: "raider",
        extinction: null,
        passed: true,
        defeated: true,
        pop: 14,
        trial: null,
      },
      {
        t: "stage",
        kind: "extinction",
        era: 0,
        boss: null,
        extinction: "plague",
        passed: true,
        defeated: false,
        pop: 9,
        trial: null,
      },
      { t: "end", win: true, reason: "eraWin", era: 0, level: 6 },
      { t: "era", era: 1 },
      {
        t: "draft",
        kind: "era",
        boost: 2,
        level: 6,
        // 옛 강화 꼬리는 기록 단계에서 이미 떼였다(`baseCardId`) · 배수는 boost 가 들고 있었다.
        // v9 에는 강화가 없어 boost 는 늘 1 이지만, 옛 판 코드를 읽으려면 자리는 남아 있어야 한다.
        cards: [poolId(5), poolId(6), poolId(7)],
        outcome: 0,
      },
      {
        t: "stage",
        kind: "forage",
        era: 1,
        boss: null,
        extinction: null,
        passed: true,
        defeated: false,
        pop: 21,
        trial: { kind: "pop", target: 17, progress: 21, passed: true, overachieved: false },
      },
      { t: "end", win: false, reason: "embers", era: 1, level: 9 },
    ],
    summary: {
      durationSec: 214,
      popMax: 34,
      popMin: 4,
      popEnd: 2,
      popPeak: 34,
      era: 1,
      level: 9,
      rerollsUsed: 1,
      pips: { fang: 8, leg: 3, eye: 14, hide: 1, herd: 0 },
      keys: ["fin", "camo"],
      deaths: { starve: 12, cold: 0, heat: 3, age: 5, boss: 1, predation: 20, plague: 0, venom: 0, wound: 2 },
      geneEarned: 26,
      geneSpent: 5,
      geneLeft: 21,
    },
  };
}

describe("판 분석 코드 · 왕복", () => {
  it("인코드 → 디코드가 원본과 정확히 같다", () => {
    const data = sampleData();
    const decoded = decodeRunCode(encodeRunCode(data));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.warnings).toEqual([]);
    expect(decoded.data).toEqual(data);
  });

  it("같은 판이면 코드도 똑같다(결정론 · 인코더에 무작위가 없다)", () => {
    expect(encodeRunCode(sampleData())).toBe(encodeRunCode(sampleData()));
  });

  it("접두사가 붙고 URL 에 그대로 실을 수 있는 글자만 쓴다", () => {
    const code = encodeRunCode(sampleData());
    expect(code.startsWith(RUN_CODE_PREFIX)).toBe(true);
    expect(RUN_CODE_PREFIX).toBe(`SP${RUN_CODE_SCHEMA}-`);
    expect(code.slice(RUN_CODE_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("폰에서 줄이 접혀 붙여져도(공백·줄바꿈) 읽는다", () => {
    const code = encodeRunCode(sampleData());
    const wrapped = code.slice(0, 40) + "\n  " + code.slice(40, 90) + " \n" + code.slice(90);
    const decoded = decodeRunCode(wrapped);
    expect(decoded.ok).toBe(true);
  });
});

describe("판 분석 코드 · 어긋나면 말한다", () => {
  it("잘린 코드는 조용히 틀린 표를 뱉지 않고 거절한다", () => {
    const code = encodeRunCode(sampleData());
    const cut = code.slice(0, code.length - 6);
    const decoded = decodeRunCode(cut);
    expect(decoded.ok).toBe(false);
  });

  it("글자 하나가 바뀌면 검사합에 걸린다", () => {
    const code = encodeRunCode(sampleData());
    const at = RUN_CODE_PREFIX.length + 5;
    const ch = code[at] === "A" ? "B" : "A";
    const broken = code.slice(0, at) + ch + code.slice(at + 1);
    const decoded = decodeRunCode(broken);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toContain("검사합");
  });

  it("코드 구조 버전이 다르면 읽지 않고 그렇게 말한다", () => {
    const code = encodeRunCode(sampleData()).replace(RUN_CODE_PREFIX, "SP9-");
    const decoded = decodeRunCode(code);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toContain("구조 버전");
  });

  it("게놈 버전이 다르면 경고로 알린다(읽기는 한다)", () => {
    const data = { ...sampleData(), genomeVersion: GENOME_VERSION + 1 };
    const decoded = decodeRunCode(encodeRunCode(data));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.warnings.join(" ")).toContain("게놈 버전");
  });

  it("카드 풀 지문이 다르면 '카드 이름을 믿지 마세요'라고 말한다", () => {
    const data = { ...sampleData(), poolDigest: (poolDigest() ^ 0x1234) & 0xffff };
    const decoded = decodeRunCode(encodeRunCode(data));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.warnings.join(" ")).toContain("카드 풀 지문");
  });

  it("빈 문자열·엉뚱한 글자는 에러다", () => {
    expect(decodeRunCode("").ok).toBe(false);
    expect(decodeRunCode("SP1-!!!").ok).toBe(false);
  });
});

describe("판 분석 코드 · 카드 번호", () => {
  it("코드 공간의 카드 id 는 서로 겹치지 않는다", () => {
    const ids = new Set(CODE_CARDS.map((c) => c.id));
    expect(ids.size).toBe(CODE_CARDS.length);
  });

  it("풀·프리셋·불씨 카드가 모두 번호를 갖는다", () => {
    expect(CODE_CARDS.length).toBe(CARD_POOL.length + PRESET_CARDS.length + 1);
    for (const c of CODE_CARDS) expect(cardByCode(cardCodeIndex(c.id))?.id).toBe(c.id);
  });

  // v9 에서 「강화 ×N」(`boostCard`)은 사라졌다 — 카드가 도장을 안 주니 곱할 것이 없다.
  // 하지만 **꼬리를 떼는 규칙은 살아 있다**(`runCode.ts` 의 `baseCardId`): 그 시절에 뽑아 둔 판 코드가
  // 아직 돌아다니고, 디코더가 꼬리 붙은 id 를 못 읽으면 「모르는 카드」로 조용히 뭉갠다.
  // 그래서 `boostCard` 대신 꼬리를 직접 붙여 같은 계약을 잰다.
  it("옛 시대 보상의 강화 꼬리(_x3)를 떼고 원래 카드를 찾는다", () => {
    const base = CARD_POOL[12] as (typeof CARD_POOL)[number];
    expect(cardCodeIndex(`${base.id}_x3`)).toBe(cardCodeIndex(base.id));
    expect(cardCodeIndex(base.id)).toBeGreaterThanOrEqual(0); // 대조군: 원래 카드는 실제로 번호가 있다
  });

  it("모르는 카드는 -1 이다(0 번 카드로 조용히 둔갑하지 않는다)", () => {
    expect(cardCodeIndex("없는카드_id")).toBe(-1);
  });

  it("카드 풀 지문은 16비트이고 같은 풀이면 늘 같다", () => {
    expect(poolDigest()).toBe(poolDigest());
    expect(poolDigest()).toBeGreaterThanOrEqual(0);
    expect(poolDigest()).toBeLessThanOrEqual(0xffff);
  });

  it("보스와 대멸종을 가르는 판정이 뽑기 풀 밖의 보스(titan)도 보스로 안다", () => {
    expect(isBossThreat("titan")).toBe(true);
    expect(isBossThreat("shark")).toBe(true);
    expect(isBossThreat("cold")).toBe(false);
    expect(isBossThreat("plague")).toBe(false); // 대멸종 · 보스 poison 과 헷갈리지 않게
  });
});

describe("판 분석 코드 · 진짜 판에서 뽑는다", () => {
  /** 한 판을 headless 로 끝까지 돌린다(카드는 첫 장, 드래프트마다 후보가 기록된다). */
  function playRun(seed: string): Game {
    const g = new Game(240, 400, 1);
    g.fixedSeed = seed;
    g.beginRun();
    let guard = 0;
    while (g.phase !== "result" && guard++ < 60000) {
      if (g.phase === "draft") g.pickCard(0);
      else g.update(34);
    }
    return g;
  }

  it("판을 돌려 뽑은 코드가 왕복한다(드래프트 후보가 전부 들어 있다)", () => {
    const g = playRun("runcode-live-1");
    const data = g.runCodeData();
    const decoded = decodeRunCode(g.runCode());
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data).toEqual(data);

    const drafts = data.entries.filter((e) => e.t === "draft");
    expect(drafts.length).toBeGreaterThan(0);
    // 첫 드래프트는 시작 갈래(프리셋)이고, 그 뒤 레벨업 드래프트는 늘 세 장이다.
    expect(drafts[0]?.t === "draft" && drafts[0].kind).toBe("preset");
    for (const d of drafts) {
      if (d.t !== "draft") continue;
      expect(d.cards.length).toBeGreaterThanOrEqual(1);
      if (d.kind === "level") expect(d.cards.length).toBe(3);
      // 고른 자리는 후보 안에 있거나(0~n-1) 건너뜀/리롤이다.
      const ok = d.outcome < d.cards.length || d.outcome === DRAFT_SKIPPED || d.outcome === DRAFT_REROLLED;
      expect(ok).toBe(true);
    }
    // 단계 기록이 하나도 없으면 판이 통째로 안 담긴 것이다.
    expect(data.entries.some((e) => e.t === "stage")).toBe(true);
    expect(data.entries.some((e) => e.t === "end")).toBe(true);
  });

  it("기록한 선택을 그대로 다시 두면 같은 판이 나온다(재현용이 진짜 재현한다)", () => {
    // 같은 시드 + 같은 선택 = 같은 코드. 기록이 판을 재현하는 데 충분하다는 최소 증명이다.
    expect(playRun("runcode-live-2").runCode()).toBe(playRun("runcode-live-2").runCode());
  });

  it("고른 카드가 기록의 그 자리 카드와 같다(표시=실물)", () => {
    const g = playRun("runcode-live-3");
    const picked: string[] = [];
    for (const e of g.runCodeData().entries) {
      if (e.t !== "draft") continue;
      if (e.outcome >= e.cards.length) continue;
      picked.push(e.cards[e.outcome] as string);
    }
    // Game 이 따로 들고 있는 「고른 카드 id」 목록과 정확히 일치해야 한다(건너뜀은 양쪽 다 안 센다).
    expect(picked).toEqual(g.pickedCardIds);
  });

  it("범주 도장 합이 코드의 최종 도장과 맞는다(관측이 재현과 어긋나면 버그 신호)", () => {
    const g = playRun("runcode-live-4");
    const data = g.runCodeData();
    for (const c of CATEGORIES) expect(data.summary.pips[c]).toBe(g.pipsNow[c]);
  });

  it("코드 길이가 폰에서 복사할 만하다(한 판 = 1000자 아래)", () => {
    const code = playRun("runcode-live-5").runCode();
    expect(code.length).toBeLessThan(1000);
  });
});
