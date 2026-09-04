import { describe, expect, it } from "vitest";
import { createCharacterMotionWorkflow } from "./characterAnimationClient";

describe("descriptor animation workflow", () => {
  it("uses HY-Motion Lite, CPU-offloaded text encoding, and custom-rig retargeting", () => {
    const workflow = createCharacterMotionWorkflow({ name: "hero.fbx", subfolder: "3d" }, "A quick sword slash", "Sword Slash", 1.2, 7);
    expect(workflow["1"].class_type).toBe("HYMotionLoadNetwork");
    expect(workflow["1"].inputs?.model_name).toBe("HY-Motion-1.0-Lite");
    expect(workflow["2"].inputs?.offload_to_cpu).toBe(true);
    expect(workflow["3"].inputs?.text).toBe("A quick sword slash");
    expect(workflow["4"].inputs?.num_samples).toBe(1);
    expect(workflow["5"].inputs?.custom_fbx_path).toBe("3d/hero.fbx");
  });
});
