import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { configureCharacterPreset, configureDiceTexturePreset, configurePanoramaPreset, convertComfyUiWorkflow, type ComfyUiWorkflow } from "./comfyWorkflowPreset";

const preset: ComfyUiWorkflow = {
  nodes: [
    { id: 1, type: "LoadImage", inputs: [], outputs: [{ name: "IMAGE", type: "IMAGE", links: [1] }], widgets_values: ["old.png", "image"] },
    { id: 2, type: "KSampler", inputs: [{ name: "image", type: "IMAGE", link: 1 }], widgets_values: [42, "fixed", 12, 6.5] },
    { id: 3, type: "SaveGLB", mode: 2, inputs: [], widgets_values: ["3d/output", ""] },
    { id: 4, type: "Pixal3DConditioning", mode: 0 },
    { id: 5, type: "Trellis2Conditioning", mode: 4 },
    { id: 6, type: "DecimateMesh", mode: 4, widgets_values: [700_000, "midpoint"] },
    { id: 7, type: "RemeshMesh", mode: 4, outputs: [{ name: "mesh", type: "MESH", links: [] }], widgets_values: [768, "udf", false, false, false, 1, 0, false, 20, 0.01, 20_000_000] },
    { id: 8, type: "PrimitiveInt", title: "texture size", mode: 4, widgets_values: [4096, "fixed"] },
    { id: 9, type: "Trellis2UpsampleStage", mode: 4, widgets_values: [1536, 49152] },
  ],
  links: [[1, 1, 0, 2, 0, "IMAGE"]],
};

describe("bundled ComfyUI workflows", () => {
  it("converts UI graphs into API prompts using live node definitions", () => {
    const converted = convertComfyUiWorkflow(preset, {
      LoadImage: { input: { required: { image: [["old.png", "hero.png"]], upload: [["image"]] } } },
      KSampler: { input: { required: { image: ["IMAGE", { forceInput: true }], seed: ["INT"], steps: ["INT"], cfg: ["FLOAT"] } } },
      Pixal3DConditioning: { input: {} },
    });
    expect(converted.missingNodes).toEqual([]);
    expect(converted.workflow?.["1"].inputs).toMatchObject({ image: "old.png", upload: "image" });
    expect(converted.workflow?.["2"].inputs).toMatchObject({ image: ["1", 0], seed: 42, steps: 12, cfg: 6.5 });
  });

  it("reports missing nodes before queueing and configures either native model lane", () => {
    expect(convertComfyUiWorkflow(preset, {}).missingNodes).toContain("LoadImage");
    const trellis = configureCharacterPreset(preset, "trellis2") as ComfyUiWorkflow;
    expect(trellis.nodes.find((node) => node.type === "Pixal3DConditioning")?.mode).toBe(4);
    expect(trellis.nodes.find((node) => node.type === "Trellis2Conditioning")?.mode).toBe(0);
    expect(trellis.nodes.find((node) => node.type === "SaveGLB")?.mode).toBe(0);
    expect(trellis.nodes.find((node) => node.type === "DecimateMesh")?.widgets_values?.[0]).toBe(20_000);
    expect(trellis.nodes.find((node) => node.type === "RemeshMesh")?.widgets_values).toMatchObject({ 0: 256, 8: 3, 10: 300_000 });
    expect(trellis.nodes.find((node) => node.title === "texture size")?.widgets_values?.[0]).toBe(2048);
    expect(trellis.nodes.find((node) => node.type === "Trellis2UpsampleStage")?.widgets_values?.[0]).toBe(1024);
  });

  it("uses the compact remesh as the optional texture-bake reference", () => {
    const graph: ComfyUiWorkflow = {
      nodes: [
        { id: 1, type: "VaeDecodeShapeTrellis", outputs: [{ name: "mesh", type: "MESH", links: [3] }] },
        { id: 2, type: "RemeshMesh", outputs: [{ name: "mesh", type: "MESH", links: [2] }], widgets_values: [768, "udf", false, false, false, 1, 0, false, 20, 0.01, 20_000_000] },
        { id: 3, type: "BakeTextureFromVoxel", inputs: [{ name: "reference_mesh", type: "MESH", link: 3 }] },
      ],
      links: [[3, 1, 0, 3, 0, "MESH"]],
    };
    const configured = configureCharacterPreset(graph, "pixal3d") as ComfyUiWorkflow;
    expect(configured.links[0]).toEqual([3, 2, 0, 3, 0, "MESH"]);
    expect(configured.nodes[0].outputs?.[0].links).toEqual([]);
    expect(configured.nodes[1].outputs?.[0].links).toEqual([2, 3]);
  });

  it("ignores editor notes and resolves executable inputs through reroute nodes", () => {
    const graph: ComfyUiWorkflow = {
      nodes: [
        { id: 1, type: "LoadImage", outputs: [{ name: "IMAGE", type: "IMAGE", links: [1] }], widgets_values: ["hero.png"] },
        { id: 2, type: "Reroute", inputs: [{ name: "", type: "*", link: 1 }], outputs: [{ name: "", type: "IMAGE", links: [2] }] },
        { id: 3, type: "ImageConsumer", inputs: [{ name: "image", type: "IMAGE", link: 2 }] },
        { id: 4, type: "Note", title: "Note: CFG" },
      ],
      links: [
        [1, 1, 0, 2, 0, "IMAGE"],
        [2, 2, 0, 3, 0, "IMAGE"],
      ],
    };
    const converted = convertComfyUiWorkflow(graph, {
      LoadImage: { input: { required: { image: [["hero.png"]] } } },
      ImageConsumer: { input: { required: { image: ["IMAGE", { forceInput: true }] } } },
    });
    expect(converted.missingNodes).toEqual([]);
    expect(converted.workflow?.["2"]).toBeUndefined();
    expect(converted.workflow?.["4"]).toBeUndefined();
    expect(converted.workflow?.["3"]?.inputs?.image).toEqual(["1", 0]);
  });

  it("maps modern combo widgets and singular UI sockets to plural API inputs", () => {
    const graph: ComfyUiWorkflow = {
      nodes: [
        { id: 1, type: "LoadImage", outputs: [{ name: "IMAGE", type: "IMAGE", links: [1] }], widgets_values: ["hero.png"] },
        { id: 2, type: "ImageProcessor", inputs: [{ name: "image", type: "IMAGE", link: 1 }], widgets_values: ["surface net", "#000000", ""] },
      ],
      links: [[1, 1, 0, 2, 0, "IMAGE"]],
    };
    const converted = convertComfyUiWorkflow(graph, {
      LoadImage: { input: { required: { image: [["hero.png"]] } } },
      ImageProcessor: { input: { required: {
        images: ["IMAGE", { forceInput: true }],
        algorithm: ["COMBO", { options: ["surface net", "basic"] }],
        background: ["COLOR", { socketless: true }],
        viewport_state: ["LOAD_3D", {}],
      } } },
    });
    expect(converted.workflow?.["2"]?.inputs).toMatchObject({ images: ["1", 0], algorithm: "surface net", background: "#000000", viewport_state: "" });
  });

  it("flattens the selected modern dynamic-combo inputs for Comfy validation", () => {
    const converted = convertComfyUiWorkflow({
      nodes: [{ id: 1, type: "RemeshMesh", widgets_values: [768, "udf", false, true] }],
      links: [],
    }, {
      RemeshMesh: { input: { required: {
        resolution: ["INT"],
        sign_mode: ["COMFY_DYNAMICCOMBO_V3", { options: [{ key: "udf", inputs: { required: { qef: ["BOOLEAN"], drop_inverted: ["BOOLEAN"] } } }] }],
      } } },
    });
    expect(converted.workflow?.["1"].inputs).toMatchObject({ resolution: 768, sign_mode: "udf", "sign_mode.qef": false, "sign_mode.drop_inverted": true });
  });

  it("prunes the unused lazy SplatKit switch lane from prompt workflows", () => {
    const converted = convertComfyUiWorkflow({
      nodes: [
        { id: 1, type: "SelectedImage", outputs: [{ name: "image", type: "IMAGE", links: [1] }] },
        { id: 2, type: "UnusedImage", outputs: [{ name: "image", type: "IMAGE", links: [2] }] },
        { id: 3, type: "SplatKit_Switch", inputs: [{ name: "image_a", link: 1 }, { name: "image_b", link: 2 }], outputs: [{ name: "image", links: [3] }], widgets_values: [true] },
        { id: 4, type: "SaveImage", inputs: [{ name: "images", link: 3 }] },
      ],
      links: [[1, 1, 0, 3, 0, "IMAGE"], [2, 2, 0, 3, 1, "IMAGE"], [3, 3, 0, 4, 0, "IMAGE"]],
    }, {
      SelectedImage: { input: {} },
      UnusedImage: { input: {} },
      SplatKit_Switch: { input: { required: { select: ["BOOLEAN"], image_a: ["IMAGE", { forceInput: true }], image_b: ["IMAGE", { forceInput: true }] } } },
      SaveImage: { input: { required: { images: ["IMAGE", { forceInput: true }] } }, output_node: true },
    });
    expect(converted.workflow?.["2"]).toBeUndefined();
    expect(converted.workflow?.["3"].inputs).toMatchObject({ select: true, image_a: ["1", 0], image_b: ["1", 0] });
  });

  it("migrates the bundled panorama workflow to the pinned local adapter", () => {
    const configured = configurePanoramaPreset({
      "1": { class_type: "LoraLoader", inputs: { lora_name: "krea\\img-txt-2-360_v01_KREA2_000002500.safetensors" } },
    });
    expect(JSON.stringify(configured)).toContain("krea\\\\krea2_t2i_360_erp_lora_v1.safetensors");
    expect(JSON.stringify(configurePanoramaPreset({ "1": { class_type: "UpscaleModelLoader", inputs: { model_name: "RealESRGAN_x2.pth" } } }))).toContain("4x-UltraSharp.pth");
    expect(JSON.stringify(configured)).not.toContain("img-txt-2-360");
  });

  it("uses only the lightweight raw generation lane for dice textures", () => {
    const configured = configureDiceTexturePreset({
      nodes: [
        { id: 1, type: "EmptyLatentImage", widgets_values: [2048, 1024, 1] },
        { id: 2, type: "PreviewImage", title: "Path A: raw pano", mode: 0 },
        { id: 3, type: "UltimateSDUpscaleNoUpscale", mode: 0 },
        { id: 4, type: "SaveImage", title: "FINAL 360 PANO", mode: 0 },
      ],
      links: [],
    });
    expect("nodes" in configured && configured.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, widgets_values: [1024, 512, 1] }),
      expect.objectContaining({ id: 2, type: "SaveImage", mode: 0, widgets_values: ["DnDRom/dice_surface"] }),
      expect.objectContaining({ id: 4, mode: 2 }),
    ]));
  });

  it("prunes every expensive output from the bundled workflow used by Dice Forge", () => {
    const bundled = JSON.parse(readFileSync(new URL("../../public/workflows/splatkit-panorama.json", import.meta.url), "utf8")) as ComfyUiWorkflow;
    const configured = configureDiceTexturePreset(bundled) as ComfyUiWorkflow;
    const activeOutputs = configured.nodes.filter((node) => ["PreviewImage", "SaveImage"].includes(node.type) && (node.mode ?? 0) === 0);
    expect(activeOutputs).toEqual([expect.objectContaining({ type: "SaveImage", title: "DnDRom dice surface output" })]);
    expect(configured.nodes.find((node) => node.type === "UltimateSDUpscaleNoUpscale")?.mode).toBe(0);
    expect(configured.nodes.filter((node) => ["EmptyLatentImage", "EmptySD3LatentImage"].includes(node.type)).every((node) => node.widgets_values?.[0] === 1024 && node.widgets_values?.[1] === 512)).toBe(true);
  });
});
