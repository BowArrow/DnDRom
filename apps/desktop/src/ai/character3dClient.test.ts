import { describe, expect, it } from "vitest";
import { prepareCharacter3dWorkflow, resolveCharacterComfyEndpoint, selectGlbOutput } from "./character3dClient";
import type { ComfyWorkflow } from "./splatKitClient";

describe("native ComfyUI character workflow", () => {
  const workflow: ComfyWorkflow = {
    "1": { class_type: "LoadImage", inputs: { image: "old.png" } },
    "2": { class_type: "Pixal3DModelLoader", inputs: {} },
    "3": { class_type: "MeshDecimate", inputs: { target_faces: 700000 } },
    "4": { class_type: "SaveGLB", inputs: { filename_prefix: "ComfyUI" }, _meta: { title: "Save GLB" } },
    "5": { class_type: "RemeshMesh", inputs: { resolution: 768, smooth_iters: 20, precluster_max_verts: 20_000_000 } },
    "6": { class_type: "PrimitiveInt", inputs: { value: 4096 }, _meta: { title: "texture size" } },
    "7": { class_type: "Trellis2UpsampleStage", inputs: { target_resolution: 1536 } },
    "8": { class_type: "VaeDecodeShapeTrellis", inputs: {} },
    "9": { class_type: "BakeTextureFromVoxel", inputs: { mesh: ["3", 0], voxel_colors: ["8", 1], texture_size: ["6", 0], reference_mesh: ["8", 0] } },
  };

  it("routes the drawing and applies the runtime mesh budget", () => {
    const prepared = prepareCharacter3dWorkflow(workflow, { name: "hero.png", subfolder: "dndrom" }, { provider: "pixal3d", targetFaces: 150000 });
    expect(prepared["1"].inputs?.image).toBe("dndrom/hero.png");
    expect(prepared["3"].inputs?.target_faces).toBe(20000);
    expect(prepared["4"].inputs?.filename_prefix).toBe("dndrom/token");
    expect(prepared["5"].inputs).toMatchObject({ resolution: 256, smooth_iters: 3, precluster_max_verts: 300_000 });
    expect(prepared["6"].inputs?.value).toBe(2048);
    expect(prepared["7"].inputs?.target_resolution).toBe(1024);
    expect(prepared["9"].inputs?.reference_mesh).toEqual(["5", 0]);
    expect(workflow["1"].inputs?.image).toBe("old.png");
  });

  it("rejects a workflow for a different provider or without GLB export", () => {
    expect(() => prepareCharacter3dWorkflow({
      "1": { class_type: "LoadImage", inputs: { image: "old.png" } },
      "2": { class_type: "Pixal3DModelLoader", inputs: {} },
      "4": { class_type: "SaveGLB", inputs: { filename_prefix: "ComfyUI" }, _meta: { title: "Save GLB" } },
    }, { name: "hero.png" }, { provider: "trellis2", targetFaces: 100000 })).toThrow(/TRELLIS/);
    expect(() => prepareCharacter3dWorkflow({
      "1": { class_type: "LoadImage", inputs: { image: "old.png" } },
      "2": { class_type: "Pixal3DModelLoader", inputs: {} },
    }, { name: "hero.png" }, { provider: "pixal3d", targetFaces: 100000 })).toThrow(/Save GLB/);
  });

  it("selects the final GLB output", () => {
    expect(selectGlbOutput({ promptId: "p", outputTexts: [], outputs: [
      { filename: "preview.png", subfolder: "", type: "output" },
      { filename: "hero.glb", subfolder: "3d", type: "output" },
    ] }).filename).toBe("hero.glb");
  });

  it("repairs the endpoint missing from legacy saved campaigns", () => {
    expect(resolveCharacterComfyEndpoint(undefined)).toBe("http://127.0.0.1:8189");
    expect(resolveCharacterComfyEndpoint("  ")).toBe("http://127.0.0.1:8189");
    expect(resolveCharacterComfyEndpoint(" http://localhost:8188 ")).toBe("http://localhost:8188");
  });
});
