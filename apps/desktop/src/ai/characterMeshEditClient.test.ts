import { describe, expect, it } from "vitest";
import { createCharacterMeshPaintWorkflow } from "./characterMeshEditClient";

describe("nondestructive character mesh paint", () => {
  it("uses the uploaded GLB as the mesh and disables remeshing", () => {
    const workflow = createCharacterMeshPaintWorkflow({ name: "frog.glb", subfolder: "3d" }, { name: "frog-edit.png", subfolder: "images" }, "Frog velvet style");
    expect(workflow["3"].inputs?.mesh_path).toBe("3d/frog.glb");
    expect(workflow["3"].inputs?.use_remesh).toBe(false);
    expect(workflow["3"].inputs?.image).toEqual(["1", 0]);
    expect(workflow["4"].inputs?.save_path).toMatch(/frog-velvet-style\.glb$/);
  });
});
