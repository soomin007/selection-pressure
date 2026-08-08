// 메타 진행(플레이어 레벨) 순수 로직 검증 — 언락은 메타 레벨(누적 경험치에서 파생)을 인자로 받아 저장소와 무관.
// (recordRunComplete/debug 는 localStorage 의존이라 인메모리 목으로 검증한다.)
import { describe, it, expect } from "vitest";
import {
  isPresetUnlocked,
  isCardUnlocked,
  isRerollUnlockedAtLevel,
  metaLevel,
  metaLevelInfo,
  metaLevelCost,
  runMetaXp,
  xpForLevelStart,
  recordRunComplete,
  debugSetMetaLevel,
  loadMeta,
  UNLOCK_TIERS,
} from "@/game/meta";
import { cardPoolFor, PRESET_CARDS } from "@/game/cards";

describe("메타 언락(플레이어 레벨 기반)", () => {
  it("기본 프리셋·카드는 레벨 1(첫 플레이)부터 항상 열려 있다", () => {
    for (const id of ["preset_omni", "preset_herd", "preset_hunter", "preset_scout"]) {
      expect(isPresetUnlocked(id, 1)).toBe(true);
    }
    for (const id of ["swift", "keen", "fangs", "grazer"]) {
      expect(isCardUnlocked(id, 1)).toBe(true);
    }
  });

  it("특수 갈래·특화 카드는 메타 레벨에서 열린다", () => {
    // ⚠ 여기 쓰는 id 는 **실제 카드 풀의 id** 여야 한다. 2026-08-08 까지 이 테스트가 옛 이름
    //    (`echo`·`wings`·`venom_fang`)을 검사하고 있었고, 그 이름들은 어떤 카드도 안 가리켰다.
    //    잠금 후보에 없는 id 는 `isCardUnlocked` 가 항상 true 로 답하는데, 그때는 표도 같이 죽어
    //    있어서 false 가 나왔다 · **테스트와 표가 같은 방향으로 틀려 서로를 가려 줬다.**
    //    아래 describe 의 「해금표가 실제 카드를 가리키는가」가 그 짝을 막는다.
    // 초음파 카드(레벨 3)
    expect(isCardUnlocked("ky_echo", 2)).toBe(false);
    expect(isCardUnlocked("ky_echo", 3)).toBe(true);
    // 바다 갈래(레벨 4) · 지느러미 카드는 처음부터 열려 있다(첫 판에도 전설을 볼 수 있게)
    expect(isCardUnlocked("ky_fin", 1)).toBe(true);
    expect(isPresetUnlocked("preset_sea", 3)).toBe(false);
    expect(isPresetUnlocked("preset_sea", 4)).toBe(true);
    // 하늘 카드(레벨 6) → 갈래(레벨 7)
    expect(isCardUnlocked("ky_wing", 5)).toBe(false);
    expect(isCardUnlocked("ky_wing", 6)).toBe(true);
    expect(isPresetUnlocked("preset_sky", 6)).toBe(false);
    expect(isPresetUnlocked("preset_sky", 7)).toBe(true);
    // 독 살갗 카드(레벨 12) → 갈래(레벨 13)
    expect(isCardUnlocked("ky_venom", 11)).toBe(false);
    expect(isCardUnlocked("ky_venom", 12)).toBe(true);
    expect(isPresetUnlocked("preset_venom", 12)).toBe(false);
    expect(isPresetUnlocked("preset_venom", 13)).toBe(true);
  });

  it("지느러미(바다 관문)는 처음부터 열려 있다 — 첫 판에도 전설 등급이 존재하도록", () => {
    // 전설은 전부 "능력 계열의 관문"이라, 하나도 안 열려 있으면 첫 판에 전설 등급 자체가 없다.
    expect(isCardUnlocked("fins", 1)).toBe(true);
  });

  it("다시 뽑기는 리롤 티어 레벨(2)부터 열린다", () => {
    expect(isRerollUnlockedAtLevel(1)).toBe(false);
    expect(isRerollUnlockedAtLevel(2)).toBe(true);
    expect(isRerollUnlockedAtLevel(9)).toBe(true);
  });

  it("티어가 레벨 순으로 오름차순이라 순차 해금된다", () => {
    for (let i = 1; i < UNLOCK_TIERS.length; i++) {
      expect((UNLOCK_TIERS[i] as { atLevel: number }).atLevel).toBeGreaterThan(
        (UNLOCK_TIERS[i - 1] as { atLevel: number }).atLevel,
      );
    }
  });
});

describe("메타 레벨 곡선·적립", () => {
  it("누적 경험치가 각 레벨 비용을 넘으면 레벨이 오른다(초반이 싸다)", () => {
    expect(metaLevel(0)).toBe(1);
    const c1 = metaLevelCost(1);
    expect(metaLevel(c1 - 1)).toBe(1);
    expect(metaLevel(c1)).toBe(2);
    expect(metaLevel(c1 + metaLevelCost(2))).toBe(3);
    // 레벨 비용은 뒤로 갈수록 커진다.
    expect(metaLevelCost(2)).toBeGreaterThan(metaLevelCost(1));
  });

  it("metaLevelInfo 의 into/need 가 곡선과 맞는다", () => {
    const info = metaLevelInfo(metaLevelCost(1) + 5); // 레벨 2, 5 들어감
    expect(info.level).toBe(2);
    expect(info.into).toBe(5);
    expect(info.need).toBe(metaLevelCost(2));
  });

  it("xpForLevelStart 는 그 레벨의 시작 경험치(레벨을 정확히 만든다)", () => {
    for (const lv of [1, 2, 3, 5, 9, 12]) {
      expect(metaLevel(xpForLevelStart(lv))).toBe(lv);
    }
  });

  it("런 성적이 좋을수록 더 많은 경험치를 적립한다(레벨·시대·정복)", () => {
    expect(runMetaXp(1, 0, false)).toBeGreaterThan(0);
    expect(runMetaXp(8, 0, false)).toBeGreaterThan(runMetaXp(3, 0, false)); // 도달 레벨↑
    expect(runMetaXp(5, 3, false)).toBeGreaterThan(runMetaXp(5, 0, false)); // 시대↑
    expect(runMetaXp(5, 4, true)).toBeGreaterThan(runMetaXp(5, 4, false)); // 정복 보너스
  });
});

describe("recordRunComplete / debug — 인메모리 저장소", () => {
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
  function withStorage(store: Record<string, string>, fn: () => void): void {
    const gl = globalThis as unknown as { localStorage?: Storage | undefined };
    const prev = gl.localStorage;
    gl.localStorage = memStorage(store);
    try {
      fn();
    } finally {
      gl.localStorage = prev;
    }
  }

  it("경험치가 누적되고, 넘긴 레벨과 그 레벨의 해금을 진척도로 돌려준다", () => {
    withStorage({}, () => {
      // 첫 완료 — 레벨 1에서 시작. 도달 레벨 5·시대 1이면 여러 레벨 오른다.
      const p = recordRunComplete(5, 1, false);
      expect(p.beforeXp).toBe(0);
      expect(p.beforeLevel).toBe(1);
      expect(p.gained).toBe(runMetaXp(5, 1, false));
      expect(p.afterXp).toBe(p.gained);
      expect(p.afterLevel).toBeGreaterThanOrEqual(2);
      // 리롤(레벨 2 티어)이 넘긴 레벨 목록에 있다(레벨 2를 넘었으면).
      const rerollShown = p.levelUps.some((lu) => lu.unlocks.some((u) => u.reroll));
      expect(rerollShown).toBe(true);
      // 누적이 저장돼 다음 로드에 반영.
      expect(loadMeta().metaXp).toBe(p.afterXp);
    });
  });

  it("debugSetMetaLevel 은 저장본을 그 레벨로 만든다", () => {
    withStorage({}, () => {
      debugSetMetaLevel(9);
      expect(metaLevel(loadMeta().metaXp)).toBe(9);
    });
  });

  it("끝낸 런 수가 한 판마다 1씩 쌓인다(온보딩 진도의 재료)", () => {
    withStorage({}, () => {
      expect(loadMeta().runsCompleted).toBe(0); // 첫 플레이
      recordRunComplete(3, 0, false);
      expect(loadMeta().runsCompleted).toBe(1);
      recordRunComplete(6, 2, true);
      expect(loadMeta().runsCompleted).toBe(2);
      // 디버그로 레벨을 바꿔도 끝낸 런 수는 안 지워진다(같은 저장본의 다른 칸).
      debugSetMetaLevel(9);
      expect(loadMeta().runsCompleted).toBe(2);
    });
  });

  it("이 칸이 없던 옛 저장본은 0 으로 읽는다(마이그레이션 단계 불필요)", () => {
    withStorage({ selpress_meta_v1: JSON.stringify({ metaXp: 300, conquered: true }) }, () => {
      const m = loadMeta();
      expect(m.metaXp).toBe(300); // 나머지 칸은 그대로 살아난다
      expect(m.conquered).toBe(true);
      expect(m.runsCompleted).toBe(0);
    });
  });

  it("저장소가 아예 없으면(테스트·프로브·사생활 모드) 조용히 첫 플레이로 읽는다", () => {
    const gl = globalThis as unknown as { localStorage?: Storage | undefined };
    const prev = gl.localStorage;
    gl.localStorage = undefined;
    try {
      expect(loadMeta()).toEqual({ metaXp: 0, conquered: false, runsCompleted: 0 });
      expect(() => recordRunComplete(3, 0, false)).not.toThrow(); // 저장 실패해도 플레이는 계속된다
    } finally {
      gl.localStorage = prev;
    }
  });
});

describe("해금표가 실제 카드·갈래를 가리키는가 (2026-08-08 · 통째로 죽어 있던 자리)", () => {
  // 왜 이 테스트가 있나: `UNLOCK_TIERS.cardIds` 가 게놈 v8 이전 이름(`echo`·`wings`·`venom_fang` …)인 채로
  // 남아 지금 풀의 어떤 카드와도 안 맞았다. 그러면 `isCardUnlocked` 가 전부 통과시켜 **전설 일곱이
  // 첫 판부터 전부 열린다.** 잠긴 것이 없어도 게임은 멀쩡히 돌아가므로 아무도 눈치채지 못했다.
  // 카드 id 를 바꿀 때 이 표를 같이 안 고치면 여기서 빨간불이 난다.
  it("해금표의 카드 id 가 전부 실제 카드 풀에 있다", () => {
    const ids = new Set(cardPoolFor().map((c) => c.id));
    for (const t of UNLOCK_TIERS) {
      for (const id of t.cardIds) {
        expect(ids.has(id), `해금표 「${t.label}」의 카드 id 「${id}」가 카드 풀에 없다`).toBe(true);
      }
    }
  });

  it("해금표의 갈래 id 가 전부 실제 프리셋에 있다", () => {
    const ids = new Set(PRESET_CARDS.map((c) => c.id));
    for (const t of UNLOCK_TIERS) {
      for (const id of t.presetIds) {
        expect(ids.has(id), `해금표 「${t.label}」의 갈래 id 「${id}」가 프리셋에 없다`).toBe(true);
      }
    }
  });

  it("잠글 수 있는 전설이 실제로 잠겨 있다(첫 판에 전설이 전부 열려 있지 않다)", () => {
    const legendary = cardPoolFor().filter((c) => c.rarity === "legendary");
    expect(legendary.length).toBeGreaterThan(0);
    const openAtFirst = legendary.filter((c) => isCardUnlocked(c.id, 1));
    // 첫 판에도 전설이 **하나는** 열려 있어야 한다(금빛 연출을 볼 길이 있어야 하므로 · 위 주석 참고).
    expect(openAtFirst.length).toBeGreaterThan(0);
    // 그러나 전부 열려 있으면 해금 사다리가 죽은 것이다.
    expect(openAtFirst.length).toBeLessThan(legendary.length);
  });
});
