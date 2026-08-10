// 티어 줄(`tierLine`) · **같은 티어라도 열쇠에 따라 다른 일이 일어난다**를 못 박는다.
//
// 왜 이 파일이 생겼나 (2026-08-08 사용자 질문): "초음파를 얻은 다음에는 눈 강화는 의미 없는 거 아니야?"
// 화면이 그렇게 읽히게 말하고 있었다. 초음파는 **눈 범주의 열쇠**라 세기가 눈 티어를 그대로 따라
// 오르는데(`EYE_ECHO`), 눈 줄은 「보는 거리」만 말해서 **눈을 더 팔 이유가 화면에서 사라져 있었다.**
//
// 이 파일이 못 박는 계약은 넷이다.
//   ① **열쇠를 안 넘기면 예전과 한 글자도 안 다르다** · 기존 호출부·초음파 없는 종은 그대로다.
//   ② **초음파는 눈 줄만 바꾼다** · 다른 네 범주는 열쇠와 무관하다.
//   ③ **초음파를 가지면 듣는 거리도 함께 말하고, 그 배율은 `EYE_ECHO` 표에서 나온다**(문구에 안 박는다).
//   ④ **이미 켜져 있는 특전을 새로 준다고 말하지 않는다** · 밤·수풀은 초음파가 이미 하고 있다.
//
// 그리고 ⑤ 로 **문구의 전제 자체**를 잰다: 낮에는 눈이, 밤에는 귀가 더 멀리 닿는다는 것.
// 이 전제가 상수 튠으로 뒤집히면 위 문구가 조용히 거짓말이 되므로, 여기서 빨간불이 켜져야 한다.
import { describe, it, expect } from "vitest";
import {
  CATEGORIES,
  DUOS,
  DUO_TIER,
  EYE_ECHO,
  EYE_VISION,
  KEY_NAMES,
  MAX_TIER,
  activeDuos,
  deriveTraits,
  emptyKeys,
  emptyPips,
  nearDuo,
  openDuos,
  pipsForTier,
  tierLine,
  type Keys,
  type Pips,
} from "@/sim/tiers";
import { SIM } from "@/sim/params";
import { isApex, nightVisionFactor } from "@/sim/behavior";

const ECHO: Keys = { ...emptyKeys(), echo: true };
/** 초음파만 빼고 전부 켠 열쇠 · "초음파가 아닌 열쇠는 이 문구를 안 건드린다"를 재는 데 쓴다. */
const ALL_BUT_ECHO: Keys = (() => {
  const k = emptyKeys();
  for (const n of KEY_NAMES) k[n] = n !== "echo";
  return k;
})();

/** 눈 티어 t 의 시야 반경(px) · `behavior.visionRadius` 와 같은 식(밤·수풀은 인자로 준다). */
function visionPx(t: number, night: boolean): number {
  const v = EYE_VISION[t] as number;
  const v01 = v / 100;
  const factor = isApex(v) || !night ? 1 : nightVisionFactor(0, v01);
  return SIM.visionBase * v01 * factor;
}
/** 눈 티어 t 의 초음파 반경(px) · 전방위·밤 무관. */
function echoPx(t: number): number {
  return SIM.echoBase * ((EYE_ECHO[t] as number) / 100);
}

describe("tierLine · 열쇠를 안 넘기면 예전 그대로", () => {
  it("빈 열쇠를 넘겨도 안 넘긴 것과 완전히 같다(모든 범주·모든 단)", () => {
    for (const c of CATEGORIES) {
      for (let t = 0; t <= MAX_TIER; t += 1) {
        expect(tierLine(c, t, emptyKeys())).toEqual(tierLine(c, t));
      }
    }
  });

  it("초음파가 아닌 열쇠는 어떤 줄도 안 바꾼다", () => {
    for (const c of CATEGORIES) {
      for (let t = 0; t <= MAX_TIER; t += 1) {
        expect(tierLine(c, t, ALL_BUT_ECHO)).toEqual(tierLine(c, t));
      }
    }
  });

  it("초음파는 눈 줄만 바꾼다(나머지 네 범주는 그대로)", () => {
    for (const c of CATEGORIES) {
      if (c === "eye") continue;
      for (let t = 0; t <= MAX_TIER; t += 1) {
        expect(tierLine(c, t, ECHO)).toEqual(tierLine(c, t));
      }
    }
  });

  it("초음파 없는 눈 줄은 「보는 거리」로 말하고 밤·수풀 특전을 그대로 지킨다", () => {
    expect(tierLine("eye", 1).gain).toContain("보는 거리 ×");
    expect(tierLine("eye", 2).gain).toContain("밤에도 봅니다");
    expect(tierLine("eye", 3).gain).toContain("수풀 속이 보입니다");
    expect(tierLine("eye", 4).gain).toContain("밤도 수풀도");
    for (let t = 1; t <= MAX_TIER; t += 1) {
      expect(tierLine("eye", t).gain).not.toContain("듣는 거리");
    }
  });

  it("0단은 열쇠와 무관하게 빈 줄이다(문턱을 안 넘으면 아무 일도 안 일어난다)", () => {
    expect(tierLine("eye", 0, ECHO)).toEqual({ gain: "", cost: "", size: 0 });
  });
});

describe("tierLine · 초음파를 가진 종의 눈 줄", () => {
  it("보는 거리와 듣는 거리를 **함께** 말한다(눈을 키우면 초음파도 세진다)", () => {
    for (let t = 1; t <= MAX_TIER; t += 1) {
      const line = tierLine("eye", t, ECHO).gain;
      expect(line).toContain("보는 거리 ×");
      expect(line).toContain("듣는 거리 ×");
    }
  });

  it("듣는 거리의 배율은 EYE_ECHO 표에서 나온다(문구에 박은 상수가 아니다)", () => {
    const base = EYE_ECHO[0] as number;
    for (let t = 1; t <= MAX_TIER; t += 1) {
      const want = `듣는 거리 ×${(((EYE_ECHO[t] as number) / base).toFixed(2)).replace(/0$/, "")}`;
      expect(tierLine("eye", t, ECHO).gain).toContain(want);
    }
    // 시야 배율과 **다른 수**여야 한다 · 여기가 갈라지지 않으면 애초에 구분할 이유가 없다.
    expect(tierLine("eye", MAX_TIER, ECHO).gain).toContain("듣는 거리 ×1.9");
    expect(tierLine("eye", MAX_TIER, ECHO).gain).toContain("보는 거리 ×1.97");
  });

  it("이미 켜져 있는 특전(밤·수풀)을 새로 준다고 말하지 않는다 · 2·3단", () => {
    expect(tierLine("eye", 2, ECHO).gain).not.toContain("밤에도 봅니다");
    expect(tierLine("eye", 3, ECHO).gain).not.toContain("수풀 속이 보입니다");
  });

  it("4단의 밤·수풀 면제는 남긴다 · 거기서는 시야가 초음파를 밤에도 넘는다", () => {
    expect(tierLine("eye", MAX_TIER, ECHO).gain).toContain("밤도 수풀도");
    expect(visionPx(MAX_TIER, true)).toBeGreaterThan(echoPx(MAX_TIER));
  });

  it("대가(좁아지는 시야각)는 초음파가 있어도 같다 · 낮에는 부채꼴 밖이 안 보인다", () => {
    for (let t = 0; t <= MAX_TIER; t += 1) {
      expect(tierLine("eye", t, ECHO).cost).toBe(tierLine("eye", t).cost);
    }
  });
});

describe("tierLine · 그 문구가 서 있는 전제(상수를 튜닝하면 여기가 먼저 깨진다)", () => {
  it("낮에는 눈이 더 멀리 본다(다섯 단 전부)", () => {
    for (let t = 0; t <= MAX_TIER; t += 1) {
      expect(visionPx(t, false)).toBeGreaterThan(echoPx(t));
    }
  });

  it("밤에는 귀가 더 멀리 닿는다(0~3단) · 그래서 눈의 밤 보정을 「새로 준다」고 말하면 안 된다", () => {
    for (let t = 0; t < MAX_TIER; t += 1) {
      expect(visionPx(t, true)).toBeLessThan(echoPx(t));
    }
  });

  it("4단은 밤·수풀 면제라 밤에도 눈이 이긴다(정점만 예외)", () => {
    expect(isApex(EYE_VISION[MAX_TIER] as number)).toBe(true);
    expect(visionPx(MAX_TIER, true)).toBe(visionPx(MAX_TIER, false));
  });

  it("초음파 세기는 눈 티어를 그대로 따라 오른다(deriveTraits 가 EYE_ECHO 를 읽는다)", () => {
    for (let t = 0; t <= MAX_TIER; t += 1) {
      const pips = { ...emptyPips(), eye: pipsForTier(t) };
      expect(deriveTraits(pips, ECHO).echo).toBe(EYE_ECHO[t]);
      expect(deriveTraits(pips, emptyKeys()).echo).toBe(0); // 열쇠가 없으면 세계에 없는 것과 같다
    }
  });
});

// ─────────────────────────────── 듀오 · 도장은 카드를 「열 뿐」이다 ───────────────────────────────
//
// **[사용자 2026-08-10]** "티어를 올리면 더 좋은 카드, 더 특별한 카드들이 열려서 그걸 위해 티어를
// 올리는 거고." 그 전까지 듀오만 혼자 도장으로 저절로 켜졌다. 이제 두 범주 3단은 **카드를 열고**,
// 켜는 것은 드래프트에서 고르는 일이다(`sim/perks.ts` 의 `duo_*` · `perks.hasRule`).
// 이 파일은 그 경계의 **도장 쪽**만 잰다(카드 쪽은 `perks.test.ts`).
describe("듀오는 도장으로 열리고 카드로 켜진다", () => {
  it("두 범주가 함께 3단이라야 열린다 · 한쪽만 최고 티어여도 안 열린다", () => {
    for (const d of DUOS) {
      const onlyA = { ...emptyPips(), [d.a]: pipsForTier(MAX_TIER) } as Pips;
      const both = { ...emptyPips(), [d.a]: pipsForTier(DUO_TIER), [d.b]: pipsForTier(DUO_TIER) } as Pips;
      expect(openDuos(onlyA).map((x) => x.id), `${d.id}: ${d.a} 한 범주만`).not.toContain(d.id);
      expect(openDuos(both).map((x) => x.id), `${d.id}: 두 범주 3단`).toContain(d.id);
    }
  });

  it("activeDuos 는 openDuos 의 옛 이름일 뿐이다 · 「가진 듀오」를 묻는 함수가 아니다", () => {
    // 「가졌는가」는 `perks.ownedDuos(genome.perks)` 가 답한다. 이 이름을 남긴 것은 `src/ui/` 의
    // 두 호출부를 이번 갈래가 안 건드리기로 했기 때문이고, UI 가 옮겨 가면 지운다.
    expect(activeDuos).toBe(openDuos);
  });

  it("nearDuo 는 「한 칸 앞」을 짚는다 · 어느 범주를 몇 칸 올리면 듀오 카드가 열리는가", () => {
    const d = DUOS[0] as (typeof DUOS)[number];
    const pips = { ...emptyPips(), [d.a]: pipsForTier(DUO_TIER), [d.b]: pipsForTier(DUO_TIER - 1) } as Pips;
    const near = nearDuo(pips);
    expect(near, "한쪽이 3단 · 다른 쪽이 2단이면 예고가 있어야 한다").not.toBeNull();
    expect(near?.pips).toBe(pipsForTier(DUO_TIER) - pipsForTier(DUO_TIER - 1));
    // 예고한 만큼 채우면 실제로 열린다 · 예고와 판정이 같은 사다리를 본다.
    const filled = { ...pips, [near?.need ?? d.b]: pipsForTier(DUO_TIER) } as Pips;
    expect(openDuos(filled).length).toBeGreaterThan(0);
  });

  it("도장이 하나도 없으면 열리는 듀오도 예고도 없다", () => {
    expect(openDuos(emptyPips())).toEqual([]);
    expect(nearDuo(emptyPips())).toBeNull();
  });
});
