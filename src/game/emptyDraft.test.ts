// 「줄 게 없는 드래프트」가 열리지 않는가.
//
// **[사용자 2026-08-09]** "이번 판은 시대 3에서 모든 범주 만렙을 찍어버렸어. 그랬더니 업그레이드
// 드래프트 화면이 고장나버렸고, 건너뛰어 새끼 치기만 겨우 클릭이 가능한 덕분에 그거만 매번
// 누르다가 시대를 클리어했어."
//
// 화면이 깨진 게 아니라 **게임에 남은 내용이 없었다.** 후보가 0장인 드래프트가 그냥 열려
// 「고장난 화면」이 됐다.
//
// ⚠ **v8 의 원인은 v9 에서 사라졌다.** 그때는 카드가 도장만 줬으므로 범주 다섯이 만렙이고 열쇠가
//   차면 카드 100장이 전부 죽은 카드가 됐다. 지금 카드는 도장을 한 칸도 안 주고 **특성**을 주므로,
//   만렙과 후보 수는 아무 관계가 없다. 그래서 이 테스트가 재는 것도 「만렙」이 아니라 **가드 그 자체**다:
//   **후보가 0장이면 드래프트를 안 연다.** v9 에서 그 상태가 되는 자리는 하나뿐이라(특성 45개를
//   전부 가졌고 열쇠도 상한까지 찼을 때) 그 상태를 만들어 잰다.
//
// 가드는 그래서 v9 에서도 남긴다 — 어떤 이유로든 후보가 빌 수 있고, 그때 빈 화면을 띄우는 것보다
// 조용히 넘기는 편이 언제나 낫다.
import { describe, it, expect } from "vitest";
import { Game } from "@/game/game";
import { CARD_POOL, cardRedundant } from "@/game/cards";
import { MAX_KEYS, KEY_NAMES, keyCount } from "@/sim/tiers";
import { PERKS } from "@/sim/perks";
import { refreshDerived } from "@/sim/genome";

/**
 * 카드 풀이 줄 수 있는 것을 이미 다 가진 종. v9 에서 후보가 0장이 되는 **유일한** 상태다:
 * 특성 45개를 전부 가졌고(특성 카드가 전부 중복), 열쇠도 상한까지 찼다(열쇠 카드가 전부 중복).
 */
function takeEverything(g: Game): void {
  for (const p of PERKS) {
    if (!g.genome.perks.includes(p.id)) g.genome.perks.push(p.id);
  }
  for (const k of KEY_NAMES) {
    if (keyCount(g.genome.keys) >= MAX_KEYS) break;
    g.genome.keys[k] = true;
  }
  refreshDerived(g.genome);
}

describe("드래프트 가드 · 줄 게 없으면 열지 않는다", () => {
  it("특성을 전부 가지고 열쇠도 차면 후보가 0장이 된다", () => {
    const g = new Game(240, 400, 1);
    g.fixedSeed = "empty-draft-1";
    g.beginRun();
    g.pickCard(0);
    takeEverything(g);

    // 전제 확인 — 이 판정이 무너지면 아래 가드 테스트가 무엇을 재는지 알 수 없게 된다.
    expect(g.genome.perks).toHaveLength(PERKS.length);
    expect(keyCount(g.genome.keys)).toBeGreaterThanOrEqual(MAX_KEYS);
    const alive = CARD_POOL.filter((c) => !cardRedundant(c, g.genome));
    expect(alive).toHaveLength(0);
  });

  it("그 상태에서 레벨이 올라도 드래프트가 안 열리고 관전이 이어진다", () => {
    const g = new Game(240, 400, 1);
    g.fixedSeed = "empty-draft-2";
    g.beginRun();
    g.pickCard(0);
    takeEverything(g);

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

  it("줄 것이 남아 있으면 드래프트는 평소대로 열린다(가드가 기능을 통째로 끄지 않았다)", () => {
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
