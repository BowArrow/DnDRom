import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ComfyWorkflow } from "./splatKitClient";

describe("bundled local Sana workflow", () => {
  it("matches the pinned ExtraModels node contract", () => {
    const workflow = JSON.parse(readFileSync(resolve(process.cwd(), "public/workflows/prop-sana-reference.json"), "utf8")) as ComfyWorkflow;
    expect(workflow["1"].inputs).toMatchObject({
      ckpt_name: "sana1.5_1.6b_1024px_fp8.safetensors",
      model: "SanaMS1.5_1600M_P1_D20",
      dtype: "BF16",
      enable_cfg_passthrough: true,
    });
    expect(workflow["2"].inputs).toMatchObject({ model_name: "Efficient-Large-Model/gemma-2-2b-it", device: "cuda", dtype: "BF16" });
    expect(workflow["3"].inputs).toMatchObject({ vae_name: "dc-ae-f32c32-sana-1.1.safetensors", vae_type: "dcae-f32c32-sana-1.1-diffusers", dtype: "BF16" });
    expect(workflow["6"]).toMatchObject({ class_type: "EmptyDCAELatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } });
    expect(Object.values(workflow).some((node) => node.class_type === "EmptySanaLatentImage")).toBe(false);
    expect(workflow["9"].class_type).toBe("SaveImage");
  });
});
