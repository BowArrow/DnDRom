import { describe, expect, it } from "vitest";
import { conditionPropWorkflow, preparePropImageWorkflow, resolvePropImageRoute } from "./propImageClient";

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

it('uses the supplied shallow reference latent at restrained denoise',()=>{
 const graph=conditionPropWorkflow({'1':{class_type:'VAEDecode',inputs:{vae:['vae',0]}},'2':{class_type:'KSampler',inputs:{latent_image:['blank',0],denoise:1}}},{name:'height-guide.png',subfolder:'',type:'input'},.58);
 expect(graph['2'].inputs!.denoise).toBe(.58);
 expect(graph['2'].inputs!.latent_image).not.toEqual(['blank',0]);
 expect(Object.values(graph).find(n=>n.class_type==='VAEEncode')?.inputs?.vae).toEqual(['vae',0]);
});
