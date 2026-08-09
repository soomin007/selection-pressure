// 만렙 뒤 「줄 게 없는 드래프트」가 열리지 않는가.
//
// **[사용자 2026-08-09]** "이번 판은 시대 3에서 모든 범주 만렙을 찍어버렸어. 그랬더니 업그레이드
// 드래프트 화면이 고장나버렸고, 건너뛰어 새끼 치기만 겨우 클릭이 가능한 덕분에 그거만 매번
// 누르다가 시대를 클리어했어."
//
// 화면이 깨진 게 아니라 **게임에 남은 내용이 없었다.** 카드는 도장만 주는데(`cardRedundant`),
// 범주 다섯이 전부 4단이고 열쇠도 MAX_KEYS(3)를 채우면 카드 100장이 전부 죽은 카드가 된다.
// 그러면 후보 0장짜리 드래프트가 그냥 열려 「고장난 화면」이 된다.
//
// ⚠ 이 테스트는 **증상 방어**를 지킨다. 근본(카드가 도장 말고 줄 게 없다)은 카드 재설계가 답이고
//   (**[사용자 2026-08-08]**), 재설계 뒤에도 이 가드는 남는다 — 어떤 이유로든 후보가 빌 수 있고
//   그때 빈 화면을 띄우는 것보다 조용히 넘기는 편이 언제나 낫다.
import { describe, it, expect } from "vitest";
import { Game } from "@/game/game";
import { CARD_POOL, cardRedundant } from "@/game/cards";
import { CATEGORIES, MAX_KEYS, MAX_TIER, KEY_NAMES, pipsForTier, tierOf } from "@/sim/tiers";
import { refreshDerived } from "@/sim/genome";

/** 범주 다섯을 만렙으로, 열쇠도 상한까지 채운 종. 사용자 판이 도달한 바로 그 상태다. */
function maxOut(g: Game): void {
  for (const c of CATEGORIES) g.genome.pips[c] = pipsForTier(MAX_TIER);
  let put = 0;
  for (const k of KEY_NAMES) {
    if (put >= MAX_KEYS) break;
    g.genome.keys[k] = true;
    put += 1;
  }
  refreshDerived(g.genome);
}

describe("만렙 뒤 드래프트 · 줄 게 없으면 열지 않는다", () => {
  it("범주 다섯이 만렙이고 열쇠가 꽉 차면 카드 풀 전체가 죽은 카드가 된다", () => {
    const g = new Game(240, 400, 1);
    g.fixedSeed = "empty-draft-1";
    g.beginRun();
    g.pickCard(0);
    maxOut(g);

    // 전제 확인 — 이 판정이 무너지면 아래 가드 테스트가 무엇을 재는지 알 수 없게 된다.
    for (const c of CATEGORIES) expect(tierOf(g.genome.pips[c])).toBe(MAX_TIER);
    const alive = CARD_POOL.filter((c) => !cardRedundant(c, g.genome));
    expect(alive).toHaveLength(0);
  });

  it("그 상태에서 레벨이 올라도 드래프트가 안 열리고 관전이 이어진다", () => {
    const g = new Game(240, 400, 1);
    g.fixedSeed = "empty-draft-2";
    g.beginRun();
    g.pickCard(0);
    maxOut(g);

    let opened = 0;
    g.onDraft = () => {
      opened += 1;
    };
    // 레벨이 여러 번 오를 만큼 오래 굴린다 · 밀린 레벨이 남아 단계마다 빈 드래프트를 다시
    // 시도하는 일이 없어야 한다(그래서 한 번에 소진한다).
    const stepMs = 1000 / 30;
    for (let i = 0; i < 30 * 120 && g.phase !== "result"; i += 1) g.update(stepMs);

    expect(opened).toBe(0);
    expect(g.phase).not.toBe("draft");
  });

  it("만렙이 아니면 드래프트는 평소대로 열린다(가드가 기능을 통째로 끄지 않았다)", () => {
    // 이 확인이 없으면 "드래프트를 영영 안 여는 것"과 구별되지 않는다.
    let opened = 0;
    for (let k = 0; k < 12 && opened === 0; k += 1) {
      const g = new Game(240, 400, 1);
      g.fixedSeed = `empty-draft-open-${k}`;
      g.beginRun();
      g.pickCard(0);
      g.onDraft = () => {
        opened += 1;
      };
      const stepMs = 1000 / 30;
      for (let i = 0; i < 30 * 120 && opened === 0 && g.phase !== "result"; i += 1) g.update(stepMs);
    }
    expect(opened).toBeGreaterThan(0);
  });
});
