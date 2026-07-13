// 맵 종류(대륙·판게아·군도·대양) — 세계가 판마다 종류째로 달라진다.
// 지형 "등급"(바다 비율이 대륙 < 판게아 < 군도 < 대양)과 해금 필터를 못박는다. 절대 %는 시드 노이즈가
// 있으므로 서로의 순서(등급)와 넉넉한 범위로 본다 — 값 하나에 매달리면 튜닝할 때마다 깨진다.
import { describe, it, expect } from "vitest";
import { World } from "@/sim/world";
import { TILE } from "@/sim/terrain";
import { Rng } from "@/sim/rng";
import { defaultGenome } from "@/sim/genome";
import { MAP_KINDS, MAP_TYPES, pickMapType, unlockedMapTypes, type MapType } from "@/sim/mapType";

const W = 540;
const H = 960;
const SEEDS = ["m1", "m2", "m3", "m4", "m5", "m6"];

/** 이 맵 종류의 평균 바다 비율(%). */
function seaPercent(map: MapType): number {
  let water = 0;
  let total = 0;
  for (const seed of SEEDS) {
    const w = new World(seed, W, H, defaultGenome(), 1, [], map);
    for (const k of w.terrain.tiles) {
      if (k === TILE.water) water++;
      total++;
    }
  }
  return (100 * water) / total;
}

describe("맵 종류 — 지형", () => {
  it("바다는 대륙 < 판게아 < 군도 < 대양 순으로 넓어진다", () => {
    const sea = {
      continent: seaPercent("continent"),
      pangaea: seaPercent("pangaea"),
      archipelago: seaPercent("archipelago"),
      ocean: seaPercent("ocean"),
    };
    expect(sea.continent).toBeLessThan(sea.archipelago);
    expect(sea.archipelago).toBeLessThan(sea.ocean);
    // 대륙은 물이 적고(호수 수준), 대양은 지구처럼 물이 대부분이다.
    expect(sea.continent).toBeLessThan(30);
    expect(sea.ocean).toBeGreaterThan(60);
  });

  it("대양에는 뭍이 좁게나마 남는다(육상 종이 설 곳이 아예 없으면 안 된다)", () => {
    const w = new World("m1", W, H, defaultGenome(), 1, [], "ocean");
    let land = 0;
    for (const k of w.terrain.tiles) if (k !== TILE.water) land++;
    expect(land).toBeGreaterThan(0);
  });

  it("군도는 바다가 넓고 산이 거의 없다(섬)", () => {
    const w = new World("m2", W, H, defaultGenome(), 1, [], "archipelago");
    let mtn = 0;
    for (const k of w.terrain.tiles) if (k === TILE.mountain) mtn++;
    expect((100 * mtn) / w.terrain.tiles.length).toBeLessThan(10);
  });

  it("대륙은 먹이 배수가 1(밸런스 기준선) — 맵 종류를 안 넘기면 대륙이다", () => {
    expect(MAP_KINDS.continent.landFoodScale).toBe(1);
    expect(MAP_KINDS.continent.seaFoodScale).toBe(1);
    expect(MAP_KINDS.continent.mountainFoodScale).toBe(1);
    // 옛 호출부(테스트 포함)가 전부 기존 세계를 그대로 본다.
    expect(new World("m1", W, H, defaultGenome()).mapType).toBe("continent");
  });

  it("세계는 시드가 달라도 제 비율을 지킨다(같은 '군도'인데 어떤 판만 물바다면 종류가 무의미)", () => {
    // 옛 방식(고정 표고 임계값)은 시드마다 바다가 5%~48% 로 널뛰었다 — 비율(분위수) 방식으로 못박았다.
    for (const map of MAP_TYPES) {
      const seas = SEEDS.map((s) => {
        const w = new World(s, W, H, defaultGenome(), 1, [], map);
        let water = 0;
        for (const k of w.terrain.tiles) if (k === TILE.water) water++;
        return (100 * water) / w.terrain.tiles.length;
      });
      const spread = Math.max(...seas) - Math.min(...seas);
      expect(spread, `${map} 의 바다 비율이 시드마다 널뛴다`).toBeLessThan(4);
    }
  });
});

describe("맵 종류 — 해금", () => {
  it("레벨 1 이면 대륙만 나온다(헤엄칠 갈래도 없는데 대양이 뜨면 손쓸 수 없이 진다)", () => {
    expect(unlockedMapTypes(1)).toEqual(["continent"]);
    for (let i = 0; i < 30; i++) expect(pickMapType(new Rng(`lv1-${i}`), 1)).toBe("continent");
  });

  it("물이 많은 세계는 바다 갈래(레벨 4)를 연 뒤에야 나온다", () => {
    expect(MAP_KINDS.archipelago.unlockLevel).toBeGreaterThanOrEqual(4);
    expect(MAP_KINDS.ocean.unlockLevel).toBeGreaterThan(MAP_KINDS.archipelago.unlockLevel);
    expect(unlockedMapTypes(3)).not.toContain("archipelago");
    expect(unlockedMapTypes(4)).toContain("archipelago");
  });

  it("레벨이 충분하면 네 세계가 모두 나온다(같은 시드면 같은 세계 — 결정론)", () => {
    const pool = unlockedMapTypes(99);
    expect(pool).toEqual([...MAP_TYPES]);
    const seen = new Set<MapType>();
    for (let i = 0; i < 60; i++) seen.add(pickMapType(new Rng(`hi-${i}`), 99));
    expect(seen.size).toBe(MAP_TYPES.length);
    expect(pickMapType(new Rng("same"), 99)).toBe(pickMapType(new Rng("same"), 99));
  });
});
