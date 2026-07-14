import { describe, it, expect } from "vitest";
import { APEX_BOON, cardEffectChips, chipColor, NEUTRAL_TRAITS, traitWord, dietWord } from "@/ui/traitDisplay";
import { applyCard, cardDelta, CARD_POOL } from "@/game/cards";
import { APEX_TRAITS, defaultGenome, type Traits } from "@/sim/genome";
import { SIM } from "@/sim/params";

const cardOf = (id: string) => {
  const card = CARD_POOL.find((c) => c.id === id);
  if (!card) throw new Error(`카드 없음: ${id}`);
  return card;
};

const chipsOf = (id: string) => cardEffectChips(cardOf(id));

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

describe("형질 표시(traitWord) — 값형질·대사는 숫자, 능력형·식성은 단어", () => {
  it("값형질(속도 등)·대사는 날숫자로 보여준다(상한 100 이라 직관적)", () => {
    expect(traitWord("speed", 68)).toBe("68");
    expect(traitWord("speed", 50)).toBe("50");
    expect(traitWord("metabolism", 30)).toBe("30");
    // 다섯 값형질이 같은 규칙(숫자). v7: herding 이 능력형으로 내려가고 size(몸집)가 값형질이 됐다.
    for (const k of ["speed", "vision", "attack", "fertility", "size"] as const) {
      expect(traitWord(k, 72)).toBe("72");
    }
    // 무리 성향은 이제 능력형 — 숫자가 아니라 없음/보통/강함으로 읽는다.
    expect(traitWord("herding", 0)).toBe("없음");
    expect(traitWord("herding", 50)).toBe("보통");
    expect(traitWord("herding", SIM.herdShieldThreshold + 1)).toBe("강함"); // 무리 방어가 켜지는 선
  });

  it("소수 값도 반올림해 자연수로 보여준다", () => {
    expect(traitWord("attack", 66.6)).toBe("67");
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

describe("칩이 사실을 말한다 — 화면 수치와 실제 적용이 갈라지면 그게 거짓말이다", () => {
  it("칩에 뜬 수치는 게놈에 실제로 붙는 값과 정확히 같다 (풀 전체 · 여러 형질값)", () => {
    for (const card of CARD_POOL) {
      for (const start of [50, 70, 90, 100]) {
        const g = defaultGenome();
        // 값형질을 start 로 맞춰 감쇠·정점 구간을 모두 훑는다.
        for (const k of ["speed", "vision", "attack", "fertility"] as const) g.traits[k] = start;
        const before = { ...g.traits };
        applyCard(g, card);
        for (const key of Object.keys(card.effects) as (keyof Traits)[]) {
          const shown = cardDelta(card, key, before[key]);
          const actual = g.traits[key] - before[key];
          // 희생 형질은 아래 별도 테스트 — 여기선 effects 만 본다(같은 카드가 둘 다 건드리진 않는다).
          if (card.sacrifice?.includes(key)) continue;
          expect(actual, `${card.id} · ${key} · 시작 ${start}`).toBe(shown);
        }
      }
    }
  });

  it("상한 근접 감쇠가 걸리면 감쇠 전 값(base)을 함께 준다 — 취소선으로 보여주려고", () => {
    const swift = cardOf("swift"); // 속도 +15
    // 50 에서는 감쇠가 없다 → base 없음(취소선을 띄울 이유가 없다).
    const at50 = cardEffectChips(swift, defaultGenome().traits).find((c) => c.text.startsWith("속도"));
    expect(at50?.base).toBeUndefined();

    // 90 에서는 감쇠가 크게 걸린다 → base 가 붙고, 실제 값보다 커야 한다("원래 이만큼 오를 값이었다").
    const high = defaultGenome();
    high.traits.speed = 90;
    const at90 = cardEffectChips(swift, high.traits).find((c) => c.text.startsWith("속도"));
    expect(at90?.base).toBeDefined();
    const shown = cardDelta(swift, "speed", 90);
    expect(at90?.text).toBe(`속도 +${shown}`);
    expect(Number(at90?.base?.replace("+", ""))).toBeGreaterThan(shown);
  });

  it("정점 고정 — 대가가 막히면 칩도 '안 내려감'이라 말한다(-10 이라 써 놓고 안 내려가면 거짓말)", () => {
    const g = defaultGenome();
    g.traits.fertility = 100;
    const chips = cardEffectChips(cardOf("hunter_apex"), g.traits); // 번식력을 깎는 카드
    const fert = chips.find((c) => c.text.startsWith("번식력"));
    expect(fert?.apexLocked).toBe(true);
    expect(fert?.tone).toBe("gain"); // 대가가 사라진 것이니 이득이다
    expect(fert?.text).not.toContain("-"); // 음수를 보여주면 안 된다
  });

  it("희생(초음파) — '시야 -75' 같은 숫자가 아니라 '잃음'이라 말한다", () => {
    const g = defaultGenome();
    g.traits.vision = 90;
    const chips = cardEffectChips(cardOf("echo"), g.traits);
    const vision = chips.find((c) => c.label === "시야");
    expect(vision).toBeDefined();
    expect(vision?.tone).toBe("loss");
    expect(vision?.value).toContain("잃음");

    // 이미 눈이 먼 종(시야 0)에게는 "잃음"이라 말하지 않는다 — 잃을 눈이 없다(없는 대가를 있는 척 금지).
    const blind = defaultGenome();
    blind.traits.vision = 0;
    expect(cardEffectChips(cardOf("echo"), blind.traits).find((c) => c.label === "시야")).toBeUndefined();
  });

  it("칩은 이름과 수치를 따로 들고 있다 — 취소선을 그 사이에 끼워야 읽힌다", () => {
    const high = defaultGenome();
    high.traits.vision = 90;
    const owl = cardEffectChips(cardOf("owl_eye"), high.traits).find((c) => c.label === "시야");
    expect(owl?.label).toBe("시야"); // 이름만
    expect(owl?.value).toMatch(/^\+\d+$/); // 수치만
    expect(owl?.text).toBe(`시야 ${owl?.value}`); // 한 줄 표시는 둘을 합친 것
    // 화면은 [이름][취소선][수치] 순으로 그린다 → "시야 ~~+12~~ +6". base 를 text 앞에 붙이면
    // "~~+12~~ 시야 +6" 이 된다(실제 앱에서 그렇게 나왔다 — 그래서 label/value 를 나눴다).
    expect(owl?.base).toBeDefined();
  });

  it("정점이 있는 형질에는 전부 '무엇이 열렸는지' 문구가 있다(도감 없이 화면에서 알아채게)", () => {
    for (const key of APEX_TRAITS) {
      expect(APEX_BOON[key], `${key} 의 정점 보상 문구가 없다`).toBeDefined();
    }
  });
});
