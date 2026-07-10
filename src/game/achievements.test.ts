import { describe, it, expect, beforeEach } from "vitest";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CARDS,
  achievementForCard,
  BODY_COSMETICS,
  cardAvailable,
  COSMETICS,
  debugResetAchievements,
  debugUnlockAchievement,
  equipCosmetic,
  equippedCosmetic,
  evaluateRun,
  isAchievementCardUnlocked,
  loadAchievements,
  mythicNamesUnlocked,
  unlockedCosmetics,
  type RunSummary,
} from "@/game/achievements";
import { CARD_POOL } from "@/game/cards";
import { defaultGenome } from "@/sim/genome";

/** 아무것도 달성 못한 평범한 멸종 판. */
function baseRun(over: Partial<RunSummary> = {}): RunSummary {
  return {
    finished: false,
    won: false,
    conquered: false,
    era: 0,
    level: 3,
    peakPopulation: 12,
    genome: defaultGenome(),
    rerollsUsed: 1,
    ...over,
  };
}

beforeEach(() => {
  debugResetAchievements();
});

describe("도전 과제 정의", () => {
  it("id 가 고유하다", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 보상이 실재한다 — 꾸밈은 COSMETICS 에, 카드는 CARD_POOL 에 있다", () => {
    for (const a of ACHIEVEMENTS) {
      const reward = a.reward;
      if (reward.kind === "cosmetic") {
        expect(COSMETICS[reward.cosmetic]).toBeDefined();
      } else {
        expect(CARD_POOL.some((c) => c.id === reward.cardId)).toBe(true);
      }
    }
  });

  it("형질 보상은 딱 하나다(나머지는 전부 효과 없는 꾸밈)", () => {
    const cards = ACHIEVEMENTS.filter((a) => a.reward.kind === "card");
    expect(cards.length).toBe(1);
    expect(ACHIEVEMENT_CARDS.has("titan")).toBe(true);
  });

  it("몸 꾸밈 목록에 이름 목록(mythicNames)은 안 들어간다", () => {
    expect(BODY_COSMETICS).not.toContain("mythicNames");
  });
});

describe("판정", () => {
  it("첫 발자국 — 런을 끝까지 봐야 열린다(중간 시대 승리로는 안 열린다)", () => {
    expect(evaluateRun(baseRun({ finished: false })).map((a) => a.id)).not.toContain("first_run");
    debugResetAchievements();
    expect(evaluateRun(baseRun({ finished: true })).map((a) => a.id)).toContain("first_run");
  });

  it("정점 등극 — 중간 시대 승리(런은 안 끝남)에서도 열린다", () => {
    const fresh = evaluateRun(baseRun({ won: true, finished: false })).map((a) => a.id);
    expect(fresh).toContain("apex");
  });

  it("대군 — 개체 수 40 초과", () => {
    expect(evaluateRun(baseRun({ peakPopulation: 40 })).map((a) => a.id)).not.toContain("swarm");
    debugResetAchievements();
    expect(evaluateRun(baseRun({ peakPopulation: 41 })).map((a) => a.id)).toContain("swarm");
  });

  it("흔들림 없는 선택 — 다시 뽑기를 한 번이라도 쓰면 안 열린다", () => {
    expect(evaluateRun(baseRun({ won: true, rerollsUsed: 1 })).map((a) => a.id)).not.toContain("unshaken");
    debugResetAchievements();
    expect(evaluateRun(baseRun({ won: true, rerollsUsed: 0 })).map((a) => a.id)).toContain("unshaken");
  });

  it("거인의 태동 — 공격력 150 이상 + 승리", () => {
    const strong = defaultGenome();
    strong.traits.attack = 150;
    expect(evaluateRun(baseRun({ won: false, genome: strong })).map((a) => a.id)).not.toContain("titan_born");
    debugResetAchievements();
    expect(evaluateRun(baseRun({ won: true, genome: strong })).map((a) => a.id)).toContain("titan_born");
  });

  it("이미 연 과제는 다시 안 뜬다(종료 화면이 같은 걸 반복해 알리지 않게)", () => {
    const s = baseRun({ finished: true });
    expect(evaluateRun(s).map((a) => a.id)).toContain("first_run");
    expect(evaluateRun(s).map((a) => a.id)).not.toContain("first_run");
    expect(loadAchievements().has("first_run")).toBe(true);
  });
});

describe("카드 문지기", () => {
  it("「거인」은 도전 과제 전이면 어떤 레벨에서도 안 열린다", () => {
    expect(isAchievementCardUnlocked("titan")).toBe(false);
    expect(cardAvailable("titan", 1)).toBe(false);
    expect(cardAvailable("titan", 99)).toBe(false);
  });

  it("과제를 달성하면 「거인」이 열린다", () => {
    debugUnlockAchievement("titan_born");
    expect(isAchievementCardUnlocked("titan")).toBe(true);
    expect(cardAvailable("titan", 1)).toBe(true);
  });

  it("두 문지기를 모두 통과해야 한다 — 레벨로 잠긴 카드는 과제와 무관하게 닫혀 있다", () => {
    expect(cardAvailable("venom_fang", 1)).toBe(false); // 레벨 12 해금
    expect(cardAvailable("venom_fang", 12)).toBe(true);
  });

  it("과제 카드가 아닌 카드는 이 문지기를 그냥 통과한다", () => {
    expect(isAchievementCardUnlocked("swift")).toBe(true);
    expect(cardAvailable("swift", 1)).toBe(true);
  });

  it("「거인」을 여는 과제를 이름으로 찾을 수 있다(대백과 잠금 문구)", () => {
    expect(achievementForCard("titan")?.id).toBe("titan_born");
    expect(achievementForCard("swift")).toBeNull();
  });
});

describe("꾸밈", () => {
  it("안 연 꾸밈은 걸칠 수 없다", () => {
    equipCosmetic("glow");
    expect(equippedCosmetic()).toBeNull();
  });

  it("과제를 달성하면 그 꾸밈이 열리고 걸칠 수 있다", () => {
    debugUnlockAchievement("apex"); // 보상: 빛나는 몸
    expect(unlockedCosmetics()).toContain("glow");
    equipCosmetic("glow");
    expect(equippedCosmetic()).toBe("glow");
    equipCosmetic(null);
    expect(equippedCosmetic()).toBeNull();
  });

  it("「전설의 이름」은 열리면 늘 적용된다(고를 것이 없다)", () => {
    expect(mythicNamesUnlocked()).toBe(false);
    debugUnlockAchievement("swarm");
    expect(mythicNamesUnlocked()).toBe(true);
  });

  it("리셋하면 과제·꾸밈이 전부 사라진다", () => {
    debugUnlockAchievement("apex");
    equipCosmetic("glow");
    debugResetAchievements();
    expect(loadAchievements().size).toBe(0);
    expect(equippedCosmetic()).toBeNull();
  });
});
