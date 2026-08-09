// **탭 명령의 판정** 계약 · 입력 층(main.ts)에서 화면 없이 검증할 수 있게 빼낸 순수 함수들.
//
// 왜 이 파일이 있나: 2026-08-09 조사에서 616건 중 **입력 층을 도는 테스트가 0건**이었다. 그 구멍
// 아래에서 결함 둘이 자랐다.
//   · 결함 D: 더블탭의 첫 탭이 이미 「가라」를 성공시키는데, 두 번째 탭의 「피해라」가 거절되면
//     아무도 그 「가라」를 안 걷었다. 기본 프리셋은 다리 0단이라 **「피해라」가 늘 거절되는 상태**였고,
//     그래서 포식자 위를 두 번 두드리면 화면은 "다리 1단이 되면…"이라 말하면서 무리는 그 포식자
//     쪽으로 걸어갔다.
//   · 결함 E: 거절 이유를 두 자리에서 말했다. 지휘 공백으로 거절될 때 진짜 이유("앞장서던 것이
//     쓰러졌습니다")를 띄운 뒤, 더블탭 분기가 칸 상태만 보고 "아직 숨을 고르는 중입니다"로 덮었다.
//     쿨타임이 0인데 쿨타임이라고 말한 것이니 **거짓말**이었다.
//
// 아래 검사는 두 층을 함께 본다: 순수 함수의 계약과, 실제 `Game` 이 그 함수에 무엇을 먹이는가.
// 순수 함수만 보면 "게임이 정말 그 모양의 값을 주는가"를 못 박지 못한다.
import { describe, it, expect } from "vitest";
import { isDoubleTap, orderDenyLine, rewoundOrder, undoneOrder, type TapUndo } from "@/main";
import { Game } from "@/game/game";
import { ORDER_SPEC_BY_KIND } from "@/sim/herdOrder";
import { TIER_STEPS } from "@/sim/tiers";

/** 한 런을 시작해 첫 프리셋을 고른 상태(watch)로 만든다(herdOrder.game.test.ts 의 절차와 같다). */
function startRun(seed: string): Game {
  const g = new Game(240, 400, 1); // 배율 1 고정 = 예전 생성자와 같은 세계
  g.fixedSeed = seed;
  g.leadEnabled = true;
  g.beginRun();
  g.pickCard(0);
  return g;
}

describe("더블탭 판정 · 시간과 거리를 함께 본다", () => {
  it("0.3초 안에 같은 자리를 두 번 두드리면 한 쌍이다", () => {
    expect(isDoubleTap({ t: 1000, x: 100, y: 200 }, 1200, 100, 200)).toBe(true);
    expect(isDoubleTap({ t: 1000, x: 100, y: 200 }, 1030, 120, 210)).toBe(true); // 손끝 굵기 안
  });

  it("늦으면 아니다 · 0.3초가 지나면 그건 새 명령이다", () => {
    expect(isDoubleTap({ t: 1000, x: 100, y: 200 }, 1300, 100, 200)).toBe(false);
    expect(isDoubleTap({ t: 1000, x: 100, y: 200 }, 1500, 100, 200)).toBe(false);
  });

  it("멀면 아니다 · 빠르기만 하고 멀면 '다른 곳을 또 탭한 것'이다", () => {
    expect(isDoubleTap({ t: 1000, x: 100, y: 200 }, 1050, 150, 200)).toBe(false);
    expect(isDoubleTap({ t: 1000, x: 100, y: 200 }, 1050, 132, 232)).toBe(false); // 대각선 45px
  });

  it("첫 탭(직전 기록이 비어 있을 때)은 절대 더블탭이 아니다", () => {
    // 초기값 t=0 · performance.now() 는 페이지 수명이라 0.3 미만인 순간이 이론상 있지만,
    // 그때는 좌표(0,0)가 멀어 걸러진다. 두 조건을 **함께** 보는 이유가 이것이다.
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, 120, 200, 300)).toBe(false);
  });
});

describe("거절 이유 한 줄 · 참인 것만, 모르면 입을 다문다 (결함 E)", () => {
  it("잠긴 칸은 **칸에 적힌 힌트를 그대로** 옮긴다 · 티어 조건을 두 곳에 적지 않는다", () => {
    const line = orderDenyLine({
      spec: { label: "피해라", hint: "다리 1단이 되면 열립니다" },
      unlocked: false,
      cdLeft: 0,
    });
    expect(line).toBe("「피해라」 명령은 다리 1단이 되면 열립니다");
  });

  it("쿨타임 중이면 쿨타임이라고 말한다", () => {
    const line = orderDenyLine({
      spec: { label: "피해라", hint: "다리 1단이 되면 열립니다" },
      unlocked: true,
      cdLeft: 42,
    });
    expect(line).toBe("「피해라」 명령은 아직 숨을 고르는 중입니다");
  });

  it("열려 있고 쿨타임도 아닌데 거절됐으면 **아무 말도 안 한다** (여기가 결함 E 였다)", () => {
    // 예전에는 이 자리가 "아직 숨을 고르는 중입니다"로 떨어져, 쿨타임 0 인데 쿨타임이라 말하고
    // 진짜 이유(지휘 공백 안내)까지 덮었다. 이유를 모르면 안 말하는 것이 맞다.
    expect(orderDenyLine({ spec: { label: "피해라", hint: "" }, unlocked: true, cdLeft: 0 })).toBeNull();
    expect(orderDenyLine(undefined)).toBeNull(); // 그런 칸이 아예 없을 때도 마찬가지
  });

  it("게임이 실제로 주는 칸으로도 같은 답이 나온다 · 기본 프리셋은 다리 0단이라 잠김", () => {
    const g = startRun("tap-deny-locked");
    expect(g.setHerdOrder(200, 300, "evade")).toBe(false); // 전제: 기본 상태에서 「피해라」는 거절된다
    const slot = g.orderWheel().find((s) => s.spec.kind === "evade");
    expect(slot?.unlocked).toBe(false);
    const line = orderDenyLine(slot);
    expect(line).toBe(`「피해라」 명령은 ${ORDER_SPEC_BY_KIND.get("evade")?.hint ?? ""}`);
    expect(line).not.toContain("숨을 고르는"); // 쿨타임이 아닌데 쿨타임이라 말하지 않는다
  });

  it("다리를 판 뒤 「피해라」를 쓰면 그때는 쿨타임이라고 말한다", () => {
    const g = startRun("tap-deny-cd");
    g.genome.pips.leg = TIER_STEPS[0] as number; // 다리 1단 = 「피해라」 해금
    expect(g.setHerdOrder(120, 200, "evade")).toBe(true);
    expect(g.setHerdOrder(120, 200, "evade")).toBe(false); // 곧바로 또 = 쿨타임
    expect(orderDenyLine(g.orderWheel().find((s) => s.spec.kind === "evade"))).toBe(
      "「피해라」 명령은 아직 숨을 고르는 중입니다",
    );
  });

  it("지휘 공백으로 거절될 때는 **이 함수가 입을 다문다** · 이유는 그것을 아는 자리가 이미 말했다", () => {
    const g = startRun("tap-deny-vacuum");
    g.genome.pips.leg = TIER_STEPS[0] as number; // 잠김도 쿨타임도 아닌 상태를 만든다
    g.world.leadVacuum = 150; // 알파가 막 쓰러졌다(5초)
    expect(g.setHerdOrder(120, 200, "evade")).toBe(false);
    const slot = g.orderWheel().find((s) => s.spec.kind === "evade");
    expect(slot?.unlocked).toBe(true); // 칸만 보면 멀쩡하다 · 그래서 예전에 거짓 이유가 나왔다
    expect(slot?.cdLeft ?? 0).toBe(0);
    expect(orderDenyLine(slot)).toBeNull();
  });
});

describe("덮어쓴 앞 명령 되돌리기 · 흘러간 시간만큼 흘려서 (결함 D)", () => {
  it("되돌릴 것이 없으면 null 이다", () => {
    expect(rewoundOrder(null, 9)).toBeNull();
  });

  it("「가라」는 무기한이라 그대로 돌아온다", () => {
    const move = { x: 10, y: 20, kind: "move" as const, ticks: 0 };
    expect(rewoundOrder(move, 9)).toEqual(move);
    expect(rewoundOrder({ x: 10, y: 20 }, 9)).toEqual({ x: 10, y: 20 }); // ticks 없는 옛 모양
  });

  it("수명이 있는 명령은 덮여 있던 만큼 깎여서 돌아온다 · 공짜로 더 살면 화면이 거짓말이 된다", () => {
    expect(rewoundOrder({ x: 1, y: 2, kind: "evade", ticks: 120 }, 9)).toEqual({
      x: 1, y: 2, kind: "evade", ticks: 111,
    });
    expect(rewoundOrder({ x: 1, y: 2, kind: "evade", ticks: 120 }, -5)).toEqual({
      x: 1, y: 2, kind: "evade", ticks: 120, // 음수 시간은 0 으로 (시계가 거꾸로 가지 않는다)
    });
  });

  it("덮여 있는 사이에 수명이 다했으면 되살리지 않는다", () => {
    expect(rewoundOrder({ x: 1, y: 2, kind: "evade", ticks: 5 }, 9)).toBeNull();
    expect(rewoundOrder({ x: 1, y: 2, kind: "evade", ticks: 9 }, 9)).toBeNull();
  });
});

describe("거절된 더블탭 뒤에 「가라」가 남지 않는다 (결함 D)", () => {
  it("첫 탭의 「가라」는 남고, 되돌리기가 그것을 앞 명령으로 되돌린다", () => {
    const g = startRun("tap-undo-move");
    // 앞 명령: 무리는 (100,100) 으로 가는 중이었다.
    expect(g.setHerdOrder(100, 100)).toBe(true);
    const prev = g.herdOrder;
    // 탭1: 포식자 자리(200,300)로 「가라」가 먼저 나간다(더블탭인지 아직 모른다).
    expect(g.setHerdOrder(200, 300)).toBe(true);
    const installed = g.herdOrder;
    expect(installed).not.toBeNull();
    if (installed === null) return;
    const undo: TapUndo = { installed, prev, tick: g.world.tick };
    // 탭2: 「피해라」는 거절된다(기본 프리셋 다리 0단).
    expect(g.setHerdOrder(200, 300, "evade")).toBe(false);
    // ⚠ 이것이 결함 D 다: 거절됐는데 **탭 지점으로 가라는 뜻이 그대로 남아 있다.**
    expect(g.world.herdOrder).toMatchObject({ x: 200, y: 300, kind: "move" });
    // 되돌리기가 그것을 걷고 앞 명령을 복원한다.
    const back = undoneOrder(undo, g.herdOrder, g.world.tick);
    expect(back).toEqual(prev);
    if (back === undefined) return;
    g.world.herdOrder = back;
    expect(g.world.herdOrder).toMatchObject({ x: 100, y: 100, kind: "move" });
  });

  it("탭 전에 아무 명령도 없었으면 되돌린 뒤에도 없다 · 없던 뜻을 만들지 않는다", () => {
    const g = startRun("tap-undo-none");
    expect(g.world.herdOrder).toBeNull();
    expect(g.setHerdOrder(200, 300)).toBe(true);
    const installed = g.herdOrder;
    if (installed === null) return;
    const undo: TapUndo = { installed, prev: null, tick: g.world.tick };
    expect(g.setHerdOrder(200, 300, "evade")).toBe(false);
    expect(undoneOrder(undo, g.herdOrder, g.world.tick)).toBeNull(); // = 걷어라
  });

  it("진행 중이던 「피해라」를 덮었다가 되돌리면, 남은 수명이 덮인 시간만큼 줄어 돌아온다", () => {
    // 이번 커밋이 새로 만든 경우: 「피해라」가 진짜가 됐으므로, 회피(120틱) 중에 쿨타임(90틱) 안의
    // 두 번째 더블탭이 들어오면 첫 탭의 「가라」가 달아나던 무리를 방금 두드린 자리로 돌려세운다.
    const g = startRun("tap-undo-evade");
    g.genome.pips.leg = TIER_STEPS[0] as number;
    expect(g.setHerdOrder(150, 150, "evade")).toBe(true);
    const prev = g.herdOrder;
    expect(prev?.ticks).toBe(120); // 전제: 4초(30틱/초)짜리 명령이다
    // 탭1: 「가라」에는 쿨타임이 없으므로 회피를 덮는다.
    expect(g.setHerdOrder(200, 300)).toBe(true);
    const installed = g.herdOrder;
    if (installed === null) return;
    const undo: TapUndo = { installed, prev, tick: g.world.tick };
    // 탭2: 「피해라」는 쿨타임에 걸려 거절된다.
    expect(g.setHerdOrder(200, 300, "evade")).toBe(false);
    // 되돌리면 달아나던 명령이 돌아온다. 덮여 있던 3틱은 그냥 흘러간 것으로 친다.
    const back = undoneOrder(undo, g.herdOrder, undo.tick + 3);
    expect(back).toMatchObject({ x: 150, y: 150, kind: "evade", ticks: 117 });
  });

  it("그 사이 다른 것이 명령을 바꿨으면 손대지 않는다 · 알파가 쓰러져 sim 이 걷어 간 뜻을 되살리지 않는다", () => {
    const g = startRun("tap-undo-vacuum");
    expect(g.setHerdOrder(100, 100)).toBe(true);
    const prev = g.herdOrder;
    expect(g.setHerdOrder(200, 300)).toBe(true);
    const installed = g.herdOrder;
    if (installed === null) return;
    const undo: TapUndo = { installed, prev, tick: g.world.tick };
    // 알파가 죽으면 world 가 지휘 공백을 세우면서 걸려 있던 명령을 스스로 걷는다(world.ts).
    g.world.herdOrder = null;
    g.world.leadVacuum = 150;
    expect(undoneOrder(undo, g.herdOrder, g.world.tick)).toBeUndefined(); // = 손대지 마라
  });

  it("되돌릴 기록이 없으면(지휘봉 이양처럼 명령을 안 바꾼 탭) 아무것도 하지 않는다", () => {
    expect(undoneOrder(null, null, 0)).toBeUndefined();
    expect(undoneOrder(null, { x: 1, y: 2, kind: "move", ticks: 0 }, 10)).toBeUndefined();
  });
});
