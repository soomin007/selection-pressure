// 맵 전용 야생종 — 세계마다 그 세계에만 사는 종이 산다.
// 가장 중요한 계약: **물이 많은 세계에는 바다 포식자가 있다.** 예전엔 바다에 위험이 하나도 없었다
// (야생 포식자는 수영 50 이라 물에 못 들어가고, 바다에 사는 둘은 초식). 그래서 헤엄치는 종이 공짜로
// 먹고 살았고, 그게 바다 개척자가 어느 세계에서든 압도적이던 진짜 이유였다.
import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { SIM } from "@/sim/params";
import { TILE } from "@/sim/terrain";
import { MAP_ARCHETYPES, type Species } from "@/sim/species";
import { defaultGenome } from "@/sim/genome";
import type { MapType } from "@/sim/mapType";

const W = 540;
const H = 960;

function worldOf(map: MapType): World {
  return new World("mapspec-1", W, H, defaultGenome(), 1, [], map);
}
function named(w: World, name: string): Species | undefined {
  return w.species.find((s) => s.name === name);
}

describe("맵 전용 야생종", () => {
  it("바다 세계에는 바다 포식자가 산다(예전 바다엔 위험이 하나도 없었다)", () => {
    for (const [map, predator] of [
      ["archipelago", "바다뱀"],
      ["ocean", "범고래 무리"],
    ] as const) {
      const w = worldOf(map);
      const sp = named(w, predator);
      expect(sp, `${map} 에 ${predator} 가 없다`).toBeDefined();
      const t = sp?.genome.traits;
      expect(t?.diet, "포식자여야 한다").toBeGreaterThan(SIM.dietHuntMin);
      // 물 전용 — 뭍에는 못 올라온다. 헤엄치는 종은 물에서 쫓기되 뭍으로 도망칠 수 있다(읽히는 규칙).
      expect(t?.swimming ?? 0).toBeGreaterThanOrEqual(SIM.aquaticOnlyThreshold);
    }
  });

  it("바다 종은 실제로 바다에서 태어난다(육지에 두면 갇혀서 그냥 죽는다)", () => {
    const w = worldOf("archipelago");
    const snake = named(w, "바다뱀");
    expect(snake).toBeDefined();
    const born = w.entities.filter((e) => e.species.id === snake?.id);
    expect(born.length).toBeGreaterThan(0);
    for (const e of born) expect(w.terrain.isWater(e.x, e.y)).toBe(true);
  });

  it("대양에는 크릴이 있다 — 포식자만 넣으면 내 종만 노려 학살이 된다", () => {
    const w = worldOf("ocean");
    const krill = named(w, "크릴 떼");
    expect(krill).toBeDefined();
    expect(krill?.genome.traits.diet ?? 99).toBeLessThan(SIM.dietHuntMin); // 초식(범고래의 밥)
  });

  it("판게아의 고산 독수리는 날 수 있다(산 위 먹이를 먹으려면 날개가 필요하다)", () => {
    const w = worldOf("pangaea");
    const eagle = named(w, "고산 독수리");
    expect(eagle).toBeDefined();
    expect(eagle?.genome.traits.wings ?? 0).toBeGreaterThanOrEqual(SIM.flyThreshold);
    // 산에서 태어난다(사냥터가 산이다).
    const born = w.entities.filter((e) => e.species.id === eagle?.id);
    expect(born.length).toBeGreaterThan(0);
    expect(born.some((e) => w.terrain.kindAt(e.x, e.y) === TILE.mountain)).toBe(true);
  });

  it("남의 세계 종은 안 나온다", () => {
    expect(named(worldOf("continent"), "바다뱀")).toBeUndefined();
    expect(named(worldOf("pangaea"), "범고래 무리")).toBeUndefined();
    expect(named(worldOf("archipelago"), "고산 독수리")).toBeUndefined();
  });

  it("대륙에는 아직 전용 종이 없다 — 여긴 밸런스 기준선이다", () => {
    // 들소 무리를 넣어 봤더니 육지 먹이를 나눠 먹어 보스 통과기준 테스트가 깨졌다(사나운 무리).
    // 시작 프리셋이 이미 약한 상태라 대륙을 더 조이는 건 방향이 반대다 — 프리셋 밸런스를 잡은 뒤에.
    expect(MAP_ARCHETYPES.continent).toEqual([]);
    // 대륙 세계는 맵 종류 도입 전과 같은 종 구성을 갖는다(내 종 + 친척 + 야생 8 + 바이옴 특화 3).
    expect(worldOf("continent").species.length).toBe(13);
  });

  it("맵 전용 종은 독립 rng 로 만든다 — 같은 시드면 완전히 재현된다(메인 스트림 불변)", () => {
    const a = worldOf("ocean");
    const b = worldOf("ocean");
    const fp = (w: World): string =>
      w.species.map((s) => `${s.name}:${Object.values(s.genome.traits).join(",")}`).join("|");
    expect(fp(a)).toEqual(fp(b));
  });
});
