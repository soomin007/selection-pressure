import { describe, it, expect } from "vitest";
import { cardEffectChips, chipColor, NEUTRAL_TRAITS, traitWord, dietWord } from "@/ui/traitDisplay";
import { CARD_POOL } from "@/game/cards";
import { SIM } from "@/sim/params";

const chipsOf = (id: string) => {
  const card = CARD_POOL.find((c) => c.id === id);
  if (!card) throw new Error(`카드 없음: ${id}`);
  return cardEffectChips(card);
};

describe("칩 색 규칙 — 좋고 나쁨이 없는 형질은 중립색", () => {
  it("대사와 식성만 중립 형질이다", () => {
    expect([...NEUTRAL_TRAITS].sort()).toEqual(["diet", "metabolism"]);
  });

  it("「올빼미 눈」의 대사 -8 은 손해가 아니다(중립색, 빨강 아님)", () => {
    const met = chipsOf("owl_eye").find((c) => c.text.startsWith("대사"));
    expect(met).toBeDefined();
    expect(met?.tone).toBe("neutral");
    expect(met?.up).toBe(false); // 방향은 사실대로 ▼
    expect(chipColor("neutral")).not.toBe(chipColor("loss"));
  });

  it("「뜨거운 피」의 대사 +14 는 이득이 아니다(중립색, 초록 아님)", () => {
    const met = chipsOf("hotblood").find((c) => c.text.startsWith("대사"));
    expect(met?.tone).toBe("neutral");
    expect(met?.up).toBe(true);
    expect(chipColor("neutral")).not.toBe(chipColor("gain"));
  });

  it("식성은 어느 쪽으로 기울어도 중립이다(초식·육식 어느 쪽도 더 낫지 않다)", () => {
    expect(chipsOf("predator").find((c) => c.text.startsWith("식성"))?.tone).toBe("neutral");
    expect(chipsOf("grazer").find((c) => c.text.startsWith("식성"))?.tone).toBe("neutral");
  });

  it("보통 형질은 여전히 얻음/잃음으로 갈린다", () => {
    const cheetah = chipsOf("cheetah");
    expect(cheetah.find((c) => c.text.startsWith("속도"))?.tone).toBe("gain");
    expect(cheetah.find((c) => c.text.startsWith("번식력"))?.tone).toBe("loss");
  });

  it("풀 전체에서 대사·식성 칩은 하나도 gain/loss 로 새지 않는다", () => {
    for (const card of CARD_POOL) {
      for (const chip of cardEffectChips(card)) {
        if (chip.text.startsWith("대사") || chip.text.startsWith("식성")) {
          expect(chip.tone, `${card.id}: ${chip.text}`).toBe("neutral");
        }
      }
    }
  });
});

describe("형질 단계 단어(traitWord) — 날값 대신 단계로 통일", () => {
  it("값형질(속도 등): 시작 50 은 보통, 자랄수록 강해진다(약함→최강)", () => {
    expect(traitWord("speed", 20)).toBe("약함");
    expect(traitWord("speed", 50)).toBe("보통"); // 모든 종 시작값
    expect(traitWord("speed", 90)).toBe("강함");
    expect(traitWord("speed", 130)).toBe("막강");
    expect(traitWord("speed", 180)).toBe("최강");
    // 다섯 형질이 같은 규칙을 쓴다
    for (const k of ["speed", "vision", "attack", "fertility", "herding"] as const) {
      expect(traitWord(k, 50)).toBe("보통");
      expect(traitWord(k, 180)).toBe("최강");
    }
  });

  it("값형질 단계는 값에 단조롭다(중간이 극단보다 세지 않다)", () => {
    const order = ["약함", "보통", "강함", "막강", "최강"];
    const rank = (v: number): number => order.indexOf(traitWord("attack", v));
    let prev = -1;
    for (const v of [10, 34, 35, 69, 70, 109, 110, 154, 155, 200]) {
      const r = rank(v);
      expect(r).toBeGreaterThanOrEqual(prev); // 단조 비감소
      prev = r;
    }
  });

  it("대사(중립): 낮음/보통/높음 — 강약이 아니라 성질", () => {
    expect(traitWord("metabolism", 20)).toBe("낮음");
    expect(traitWord("metabolism", 50)).toBe("보통");
    expect(traitWord("metabolism", 85)).toBe("높음");
  });

  it("식성: 초식/잡식/육식 — sim 문턱과 같은 경계", () => {
    expect(traitWord("diet", SIM.dietHuntMin - 1)).toBe("초식");
    expect(traitWord("diet", 50)).toBe("잡식");
    expect(traitWord("diet", SIM.dietGrazeMax + 1)).toBe("육식");
    expect(dietWord(20)).toBe("초식"); // 직접도 같은 값
  });

  it("능력형(수영·날개·독…): 없음/보통/강함 3단계(기존 규칙 그대로)", () => {
    expect(traitWord("swimming", 30)).toBe("없음"); // 문턱 아래
    expect(traitWord("swimming", SIM.swimThreshold)).toBe("보통"); // 수륙양용
    expect(traitWord("wings", SIM.flyThreshold)).toBe("강함"); // 비행(켜짐)
    expect(traitWord("venom", 0)).toBe("없음");
    expect(traitWord("venom", 70)).toBe("강함");
  });
});
