import { describe, expect, it } from "vitest";
import { compileBaseDecorationPrompt, compileScenicBasePlateImagePrompt, isolatedBasePlatePrompt, prepareScenicImageConcepts } from "./basePlateDirector";
import { createBasePlateRecipe } from "../domain/baseplates";

describe("baseplate prompt isolation", () => {
  it("replaces stale preset descriptions in both requests and carries the height budget", () => {
    const old=createBasePlateRecipe('tavern');old.sceneryHeightRatio=.08;
    const requests=prepareScenicImageConcepts(old,'Giant lily pad floating on a pond');
    for(const request of requests){expect(request.recipe.description).toBe('Giant lily pad floating on a pond');expect(request.prompt).toContain('Giant lily pad floating on a pond');expect(request.prompt).toContain('8 percent');expect(request.prompt).not.toMatch(/floorboard|Scuffed inn/i);expect(request.recipe.layers.every(layer=>layer.kind==='plinth')).toBe(true);}
    expect(requests[0].prompt).not.toBe(requests[1].prompt);
    expect(old.description).not.toContain('lily');
  });
  it("supports arbitrary briefs and rejects empty requests",()=>{expect(prepareScenicImageConcepts(createBasePlateRecipe('grass'),'A clockwork moon of stained glass')[1].prompt).toContain('A clockwork moon of stained glass');expect(()=>prepareScenicImageConcepts(createBasePlateRecipe('grass'),'  ')).toThrow('Describe');});
  it("limits hosted decoration prompts to the explicit asset recipe", () => {
    const prompt = compileBaseDecorationPrompt(createBasePlateRecipe("pond", "A lily pad over pond water"), "lily flower");
    expect(prompt).toContain("lily flower");
    expect(prompt).toContain("no character");
    expect(prompt).not.toContain("campaign history");
  });
  it("uses only bounded recent events for local contextual suggestions", () => expect(isolatedBasePlatePrompt({ description: "base", recentEvents: ["one", "two", "three", "four"] })).not.toContain("one"));
  it("compiles a cohesive full-base image prompt with a protected standing area", () => {
    const prompt = compileScenicBasePlateImagePrompt(createBasePlateRecipe("pond", "A lily pad floating on pond water"));
    expect(prompt).toContain("physical miniature BASE PLATE");
    expect(prompt).toContain("central 55 percent");
    expect(prompt).toContain("no character");
    expect(prompt).toContain("Continuous flat walkable surface");
  });
});
