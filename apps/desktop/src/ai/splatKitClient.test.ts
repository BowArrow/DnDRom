import { describe, expect, it } from "vitest";
import { assertLocalComfyUiEndpoint, preparePanoramaWorkflow, prepareSplatKitWorkflow, type ComfyWorkflow } from "./splatKitClient";

describe("ComfyUI-SplatKit workflow preparation", () => {
  it("patches the panorama and positive prompt without changing the negative prompt", () => {
    const workflow: ComfyWorkflow = {
      "1": { class_type: "SplatKitSphereSfMDataset", inputs: {} },
      "2": { class_type: "LoadImage", inputs: { image: "old.png" } },
      "3": { class_type: "CLIPTextEncode", inputs: { text: "old prompt" }, _meta: { title: "Positive Prompt" } },
      "4": { class_type: "CLIPTextEncode", inputs: { text: "low resolution, distortion, strange artifacts" } },
    };
    const prepared = prepareSplatKitWorkflow(workflow, { name: "pano.png", subfolder: "dndrom" }, "A moonlit city");
    expect(prepared["2"].inputs?.image).toBe("dndrom/pano.png");
    expect(prepared["3"].inputs?.text).toBe("A moonlit city");
    expect(prepared["4"].inputs?.text).toBe("low resolution, distortion, strange artifacts");
    expect(workflow["2"].inputs?.image).toBe("old.png");
  });

  it("rejects an unrelated workflow", () => {
    expect(() => prepareSplatKitWorkflow({ "1": { class_type: "LoadImage", inputs: { image: "old.png" } } }, { name: "pano.png" }, "scene"))
      .toThrow(/SplatKit/);
  });

  it("prepares a prompt-only local panorama workflow", () => {
    const prepared = preparePanoramaWorkflow({
      "1": { class_type: "CLIPTextEncode", inputs: { text: "old positive" } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "low resolution, artifacts" } },
    }, "An ancient forest observatory at blue hour");
    expect(prepared["1"].inputs?.text).toBe("An ancient forest observatory at blue hour");
    expect(prepared["2"].inputs?.text).toBe("low resolution, artifacts");
  });

  it("rejects remote generation endpoints", () => {
    expect(assertLocalComfyUiEndpoint("http://127.0.0.1:8188")).toBe("http://127.0.0.1:8188");
    expect(() => assertLocalComfyUiEndpoint("https://generation.example.com")).toThrow(/loopback/);
  });
});
