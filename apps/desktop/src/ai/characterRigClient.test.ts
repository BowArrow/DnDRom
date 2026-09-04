import { describe, expect, it } from "vitest";
import { createCharacterRigWorkflow } from "./characterRigClient";

describe("character auto-rig workflows", () => {
  it("uses MIA with a Mixamo-compatible rest pose for humanoids", () => {
    const workflow = createCharacterRigWorkflow({ name: "hero.glb", subfolder: "3d" }, "Sir Rowan", "humanoid");
    expect(workflow["1"].inputs?.file_path).toBe("3d/hero.glb");
    expect(workflow["2"].class_type).toBe("MIALoadModel");
    expect(workflow["3"].inputs?.reset_to_rest).toBe(true);
    expect(workflow["4"].class_type).toBe("UniRigPreviewRiggedMesh");
  });

  it("uses the general UniRig model and a bounded tabletop mesh for creatures", () => {
    const workflow = createCharacterRigWorkflow({ name: "dragon.glb" }, "Young Dragon", "creature");
    expect(workflow["2"].class_type).toBe("UniRigLoadModel");
    expect(workflow["3"].inputs?.skeleton_template).toBe("articulationxl");
    expect(workflow["3"].inputs?.target_face_count).toBe(20_000);
  });
});
