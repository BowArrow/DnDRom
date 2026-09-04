import { describe, expect, it } from "vitest";
import { compileMaterialPrompt, compileObjectPropPrompt, validatePropPrompt } from "./propPrompt";

describe("prop prompt compiler", () => {
  it("isolates object references for reviewed image-to-3D", () => expect(compileObjectPropPrompt("painted brass lantern")).toContain("fully visible from base to top"));
  it.each([["floor", "top-down"], ["wall", "front elevation"], ["pillar", "triplanar"], ["general", "direction-neutral"]] as const)("contextualizes %s materials", (target, phrase) => {
    const prompt = compileMaterialPrompt("worn oak", target);
    expect(prompt).toContain(phrase); expect(prompt).toContain("no shadows"); expect(prompt).toContain("Opposite edges");
  });
  it("filters prohibited generation prompts before provider routing", () => expect(() => validatePropPrompt("child sexual content")).toThrow(/cannot/));
});
