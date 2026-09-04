import { describe, expect, it } from "vitest";
import { seamlessValueNoise } from "./tabletopShaders";

describe("procedural tabletop surface noise", () => {
  it("wraps cleanly at texture boundaries", () => {
    for (const coordinate of [0, 7, 19, 37, 63]) {
      expect(seamlessValueNoise(0, coordinate, 8, 8, 17)).toBeCloseTo(seamlessValueNoise(64, coordinate, 8, 8, 17), 10);
      expect(seamlessValueNoise(coordinate, 0, 8, 8, 17)).toBeCloseTo(seamlessValueNoise(coordinate, 64, 8, 8, 17), 10);
    }
  });

  it("produces bounded variation without the old diagonal sine bands", () => {
    const samples = Array.from({ length: 64 }, (_, index) => seamlessValueNoise(index, index, 4, 16, 41));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    expect(new Set(samples.map((value) => value.toFixed(3))).size).toBeGreaterThan(24);
  });
});
