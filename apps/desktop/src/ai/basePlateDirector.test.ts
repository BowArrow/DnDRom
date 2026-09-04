import { describe, expect, it } from "vitest";
import { compileBaseDecorationPrompt, compileScenicBasePlateImagePrompt, isolatedBasePlatePrompt } from "./basePlateDirector";
import { createBasePlateRecipe } from "../domain/baseplates";

describe("baseplate prompt isolation", () => {
  it("limits hosted decoration prompts to the explicit asset recipe", () => {
    const prompt = compileBaseDecorationPrompt(createBasePlateRecipe("pond", "A lily pad over pond water"), "lily flower");
    expect(prompt).toContain("lily flower");
    expect(prompt).toContain("no character");
    expect(prompt).not.toContain("campaign history");
  });
  it("uses only bounded recent events for local contextual suggestions", () => expect(isolatedBasePlatePrompt({ description: "base", recentEvents: ["one", "two", "three", "four"] })).not.toContain("one"));
  it("compiles a cohesive full-base image prompt with a protected standing area", () => {
    const prompt = compileScenicBasePlateImagePrompt(createBasePlateRecipe("pond", "A lily pad floating on pond water"));
    expect(prompt).toContain("single complete scenic miniature base topper");
    expect(prompt).toContain("central 35 percent");
    expect(prompt).toContain("No character");
    expect(prompt).toContain("no loose unrelated objects");
  });
});
