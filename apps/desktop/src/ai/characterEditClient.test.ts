import { describe, expect, it } from "vitest";
import { characterPaintPrompt, createCharacterInpaintWorkflow, createCharacterPromptEditWorkflow, createKreaCharacterInpaintWorkflow, createKreaCharacterPromptEditWorkflow } from "./characterEditClient";

describe("character prompt editing", () => {
  it("builds a bounded local img2img revision workflow", () => {
    const workflow = createCharacterPromptEditWorkflow("local.safetensors", { name: "hero.png", subfolder: "dndrom" }, "add a red cloak", .9, 42);
    expect(workflow["2"].inputs?.image).toBe("dndrom/hero.png");
    expect(workflow["3"].inputs?.text).toContain("add a red cloak");
    expect(workflow["6"].inputs?.denoise).toBe(.75);
    expect(workflow["8"].class_type).toBe("SaveImage");
  });

  it("rejects an empty edit instead of queueing a meaningless generation", () => {
    expect(() => createCharacterPromptEditWorkflow("local.safetensors", { name: "hero.png" }, "  ")).toThrow("Describe the character change");
  });

  it("can edit with the automatically installed Krea split-model pack", () => {
    const workflow = createKreaCharacterPromptEditWorkflow({ name: "hero.png" }, "turn the cloak blue", .1, 7);
    expect(workflow["1"].inputs?.unet_name).toBe("krea2_turbo_fp8_scaled.safetensors");
    expect(workflow["10"].inputs?.denoise).toBe(.2);
    expect(workflow["12"].class_type).toBe("SaveImage");
  });

  it("builds color-guided and full-shading instructions without surrendering the source design", () => {
    const color = characterPaintPrompt({ mode: "color", color: "#d44778", instruction: "paint the cloak and flowers" });
    const shade = characterPaintPrompt({ mode: "shade", color: "#88bfff", instruction: "moonlight from the left" });
    expect(color).toContain("#d44778");
    expect(color).toContain("Preserve every ink line");
    expect(shade).toContain("moonlight from the left");
    expect(shade).toContain("ambient occlusion");
  });

  it("uses a protected inpaint latent instead of unrestricted img2img for paint assistance", () => {
    const workflow = createCharacterInpaintWorkflow("local.safetensors", { name: "hero.png" }, { name: "mask.png" }, "paint only the cloak", .8, 9);
    expect(workflow["3"].inputs?.image).toBe("mask.png");
    expect(workflow["6"].class_type).toBe("VAEEncodeForInpaint");
    expect(workflow["6"].inputs?.mask).toEqual(["3", 1]);
    expect(workflow["7"].inputs?.denoise).toBe(.48);
  });

  it("keeps the split-model fallback mask-bound and at source dimensions", () => {
    const workflow = createKreaCharacterInpaintWorkflow({ name: "hero.png" }, { name: "mask.png" }, "shade only the subject", .3, 4);
    expect(workflow["6"].class_type).toBe("VAEEncodeForInpaint");
    expect(workflow["6"].inputs?.pixels).toEqual(["4", 0]);
    expect(workflow["11"].inputs?.latent_image).toEqual(["6", 0]);
  });
});
