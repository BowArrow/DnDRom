import { describe, expect, it } from "vitest";
import { localGroundingLift, tokenBaseTop } from "./modelGrounding";

describe("miniature model grounding", () => {
  it("keeps the model floor on top of the base at any normalization scale", () => {
    const baseTop = tokenBaseTop(.14);
    const localModelFloor = -.62;
    for (const modelScale of [.05, .5, 1, 2.5, 5]) {
      const scaledWorldFloor = localModelFloor * modelScale;
      const lift = localGroundingLift(scaledWorldFloor, baseTop, 1);
      expect(scaledWorldFloor + lift).toBeCloseTo(baseTop, 8);
    }
  });

  it("accounts for the parent tabletop scale", () => {
    const parentScale = 1.75;
    const localBaseTop = tokenBaseTop(.18);
    const worldBaseTop = localBaseTop * parentScale;
    const modelWorldFloor = -1.4;
    const lift = localGroundingLift(modelWorldFloor, worldBaseTop, parentScale);
    expect(modelWorldFloor + lift * parentScale).toBeCloseTo(worldBaseTop, 8);
  });
});
