import { describe, expect, it } from "vitest";
import { tokenBaseGeometry } from "./tokenGeometry";

describe("token base geometry", () => {
  it("builds hex tokens as a six-sided 3D prism", () => {
    expect(tokenBaseGeometry("hex")).toEqual({ primitive: "cylinder", capSegments: 6 });
  });

  it("keeps round and square bases as solid primitives", () => {
    expect(tokenBaseGeometry("round")).toEqual({ primitive: "cylinder", capSegments: 48 });
    expect(tokenBaseGeometry("square")).toEqual({ primitive: "box" });
  });
});
