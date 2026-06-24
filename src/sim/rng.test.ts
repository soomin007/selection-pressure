import { describe, it, expect } from "vitest";
import { Rng } from "@/sim/rng";
import { randomGenome, serializeGenome } from "@/sim/genome";

describe("Rng 결정론", () => {
  it("같은 시드는 같은 수열을 낸다", () => {
    const a = new Rng("hello");
    const b = new Rng("hello");
    const seqA = Array.from({ length: 8 }, () => a.unit());
    const seqB = Array.from({ length: 8 }, () => b.unit());
    expect(seqA).toEqual(seqB);
  });

  it("다른 시드는 다른 수열을 낸다", () => {
    const a = new Rng("hello");
    const b = new Rng("world");
    expect(a.unit()).not.toEqual(b.unit());
  });

  it("상태를 저장/복원하면 같은 지점부터 이어진다", () => {
    const r = new Rng(123);
    r.unit();
    r.unit();
    const snapshot = r.getState();
    const after = [r.unit(), r.unit()];
    r.setState(snapshot);
    expect([r.unit(), r.unit()]).toEqual(after);
  });
});

describe("게놈 결정론", () => {
  it("같은 시드는 같은 게놈을 낸다", () => {
    const g1 = randomGenome(new Rng("seed-42"));
    const g2 = randomGenome(new Rng("seed-42"));
    expect(serializeGenome(g1)).toEqual(serializeGenome(g2));
  });
});
