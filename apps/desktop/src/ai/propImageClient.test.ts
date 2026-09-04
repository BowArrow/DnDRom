import { describe, expect, it } from "vitest";
import { preparePropImageWorkflow, resolvePropImageRoute } from "./propImageClient";

describe("prop image provider routing", () => {
  it("keeps Sana and Krea in isolated local feature packs", () => {
    expect(resolvePropImageRoute("sana-local")).toMatchObject({ hosted: false, feature: "propImageLite" });
    expect(resolvePropImageRoute("krea-local")).toMatchObject({ hosted: false, feature: "propImageKrea" });
  });
  it("routes hosted Krea without a local runtime feature", () => expect(resolvePropImageRoute("krea-cloud")).toEqual({ hosted: true }));

  it("repairs legacy Sana latent nodes before a workflow is queued", () => {
    const prepared = preparePropImageWorkflow({
      "6": { class_type: "EmptySanaLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
      "9": { class_type: "SaveImage", inputs: { filename_prefix: "old" } },
    }, 1);
    expect(prepared["6"]).toMatchObject({ class_type: "EmptyDCAELatentImage", inputs: { width: 1024, height: 1024 } });
    expect(prepared["9"].inputs?.filename_prefix).toBe("DnDRom/prop_reference_2");
  });
});
