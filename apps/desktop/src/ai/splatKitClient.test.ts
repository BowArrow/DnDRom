// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { assertComfyNodeResponsive, assertLocalComfyUiEndpoint, cancelComfyPrompt, createQuickPanoramaWorkflow, createSplatKitDepthPreflightWorkflow, createSplatKitSfmRecoveryWorkflow, isRecoverableSplatKitMappingFailure, monitorComfyWorkflow, parseSplatKitCoverageDecision, parseSplatKitReconstructionMetrics, preparePanoramaWorkflow, prepareSplatKitWorkflow, queueComfyWorkflow, releaseComfyMemory, selectSplatKitCompatiblePaths, selectSplatKitDatasetPath, selectSplatKitWorkflowPaths, waitForComfyPrompt, type ComfyWorkflow } from "./splatKitClient";

describe("ComfyUI-SplatKit workflow preparation", () => {
  it("parses measured four-rail reconstruction evidence and rejects incomplete reports", () => {
    const metrics = parseSplatKitReconstructionMetrics({ outputTexts: ['DNDROM_SFM_QUALITY:{"registeredCameraRatio":0.9,"railRegistrationRatios":[0.8,0.81,0.82,0.83],"largestComponentRatio":0.94,"groundPlaneSupport":0.72,"boundsToRailRatio":2.1}'] });
    expect(metrics?.railRegistrationRatios).toHaveLength(4);
    expect(parseSplatKitReconstructionMetrics({ outputTexts: ['DNDROM_SFM_QUALITY:{"registeredCameraRatio":0.9,"railRegistrationRatios":[0.8]}'] })).toBeNull();
  });
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

  it("keeps continuous four-rail geometry while reducing high-resolution anchor frequency", () => {
    const prepared = prepareSplatKitWorkflow({
      "1": { class_type: "LoadImage", inputs: { image: "old.png" } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "old prompt" } },
      "3": { class_type: "SplatKit_CameraPlotRenderControlGeo", inputs: { moge_level: 9, length: 81 } },
      "4": { class_type: "SplatKit_WanI2VMaskedConditioning", inputs: { width: 1440, height: 720, length: 81 } },
      "5": { class_type: "KSampler", inputs: { latent_image: ["4", 0], steps: 8 } },
      "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["9", 2] } },
      "7": { class_type: "SplatKit_HiResComposite", inputs: { output_width: 8192, frames: "0-80/2", depth_grid: "geometry_res", prefetch: true } },
      "8": { class_type: "KSampler", inputs: { latent_image: ["10", 0], steps: 28 } },
      "9": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "other.safetensors" } },
      "10": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } },
      "11": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["9", 2] } },
      "12": { class_type: "SaveVideo", inputs: { video: ["6", 0] } },
      "13": { class_type: "UpscaleModelLoader", inputs: { model_name: "4x-UltraSharp.pth" } },
      "14": { class_type: "Bundle", inputs: { input_11: ["13", 0], bundle_meta: '{"names":["MODEL","UPSCALE_MODEL"],"types":["MODEL","UPSCALE_MODEL"],"sources":["input_1","input_11"]}' } },
    }, { name: "pano.png" }, "A moonlit city");

    expect(prepared["3"].inputs).toMatchObject({ moge_level: 9, length: 81 });
    expect(prepared["4"].inputs).toMatchObject({ width: 960, height: 480, length: 81 });
    expect(prepared["5"].inputs).toMatchObject({ steps: 4 });
    expect(prepared["6"]).toMatchObject({
      class_type: "DnDRomWanVAEDecode",
      inputs: { tile_size: 2048, overlap: 64, temporal_size: 16, temporal_overlap: 4 },
      _meta: { title: "WAN VAE decode (VRAM handoff)" },
    });
    expect(prepared["7"].inputs).toMatchObject({ output_width: 4096, frames: "0-80/4", depth_grid: "geometry_res", geom_scale: 1, prefetch: false, proxy_width: 960, tone_work: 512, debug_save: "off", save_video: false, save_proxies: false, tone_mode: "luma" });
    expect(prepared["7"].inputs).not.toHaveProperty("upscale_model");
    expect(prepared["8"]).toMatchObject({ class_type: "KSampler", inputs: { steps: 28 } });
    expect(prepared["11"]).toMatchObject({ class_type: "VAEDecode" });
    expect(prepared["12"]).toBeUndefined();
    expect(prepared["14"].inputs).not.toHaveProperty("input_11");
    expect(prepared["14"].inputs?.bundle_meta).not.toContain("UPSCALE_MODEL");
  });

  it("detects a silent camera-plot stall sooner than other long reconstruction nodes", () => {
    const startedAt = 1_000;
    expect(() => assertComfyNodeResponsive(startedAt, "Splat Kit Camera Plot", startedAt + 7 * 60_000)).not.toThrow();
    expect(() => assertComfyNodeResponsive(startedAt, "Splat Kit Camera Plot", startedAt + 8 * 60_000)).toThrow(/stopped reporting progress for 8 minutes/i);
    expect(() => assertComfyNodeResponsive(startedAt, "Sphere SfM", startedAt + 8 * 60_000)).not.toThrow();
  });

  it("isolates CameraPlot depth preparation from WAN model dependencies", () => {
    const preflight = createSplatKitDepthPreflightWorkflow({
      load: { class_type: "LoadImage", inputs: { image: "panorama.png" } },
      project: { class_type: "SplatKit_DatasetProject", inputs: { project_name: "scene" } },
      bundle: { class_type: "Bundle", inputs: { model: ["wan", 0], image: ["load", 0], dataset: ["project", 0] } },
      unpack: { class_type: "UnbundleByName", inputs: { bundle: ["bundle", 0] } },
      camera: { class_type: "SplatKit_CameraPlotRenderControlGeo", inputs: { panorama: ["unpack", 3], dataset_dir: ["unpack", 4], length: 49 } },
      wan: { class_type: "UNETLoader", inputs: { unet_name: "wan.safetensors" } },
    });

    expect(Object.keys(preflight).sort()).toEqual(["camera", "dndrom_depth_preflight", "dndrom_trajectory_coverage", "load", "project"]);
    expect(preflight.camera.inputs).toMatchObject({ panorama: ["load", 0], dataset_dir: ["project", 0], length: 49 });
    expect(preflight.dndrom_depth_preflight.class_type).toBe("PreviewImage");
    expect(preflight.dndrom_trajectory_coverage).toMatchObject({
      class_type: "DnDRomTrajectoryCoverage",
      inputs: { control_mask_1: ["camera", 1], max_paths: 4 },
    });
  });

  it("parses measured path coverage and ignores unrelated output text", () => {
    const decision = parseSplatKitCoverageDecision({
      outputTexts: ["dataset ready", 'DNDROM_COVERAGE:{"selectedPaths":[0,2],"recommendedPathCount":2,"paths":[{"index":0,"mean":0.7,"minimum":0.4,"tail":0.6,"score":0.6},{"index":2,"mean":0.5,"minimum":0.2,"tail":0.4,"score":0.4}]}'],
    });
    expect(decision).toMatchObject({ selectedPaths: [0, 2], recommendedPathCount: 2 });
  });

  it("prefers an adjacent overlapping rail over an opposing high-novelty rail", () => {
    const decision = {
      selectedPaths: [0, 2], recommendedPathCount: 2,
      paths: [
        { index: 0, mean: .62, minimum: .44, tail: .5, score: .56 },
        { index: 1, mean: .31, minimum: .01, tail: .04, score: .18 },
        { index: 2, mean: .27, minimum: .01, tail: .01, score: .15 },
        { index: 3, mean: .67, minimum: .54, tail: .62, score: .63 },
      ],
    };
    expect(selectSplatKitCompatiblePaths(decision, 2)).toEqual([0, 1]);
  });

  it("retains all four rails even when coverage ranks only two first", () => {
    const workflow: ComfyWorkflow = {
      load: { class_type: "LoadImage", inputs: { image: "pano.png" } },
      shared: { class_type: "ModelLoader", inputs: {} },
      camera1: { class_type: "SplatKit_CameraPlotRenderControlGeo", inputs: { panorama: ["load", 0], length: 81 } },
      wan1: { class_type: "KSampler", inputs: { latent_image: ["camera1", 0], model: ["shared", 0] } },
      hires1: { class_type: "SplatKit_HiResComposite", inputs: { wan_frames: ["wan1", 0], frames: "all" } },
      camera2: { class_type: "SplatKit_CameraPlotRenderControlGeo", inputs: { panorama: ["load", 0] } },
      wan2: { class_type: "KSampler", inputs: { latent_image: ["camera2", 0], model: ["shared", 0] } },
      hires2: { class_type: "SplatKit_HiResComposite", inputs: { wan_frames: ["wan2", 0], frames: "all" } },
      camera3: { class_type: "SplatKit_CameraPlotRenderControlGeo", inputs: { panorama: ["load", 0], length: 81 } },
      wan3: { class_type: "KSampler", inputs: { latent_image: ["camera3", 0], model: ["shared", 0] } },
      hires3: { class_type: "SplatKit_HiResComposite", inputs: { wan_frames: ["wan3", 0], frames: "all" } },
      camera4: { class_type: "SplatKit_CameraPlotRenderControlGeo", inputs: { panorama: ["load", 0], length: 81 } },
      wan4: { class_type: "KSampler", inputs: { latent_image: ["camera4", 0], model: ["shared", 0] } },
      hires4: { class_type: "SplatKit_HiResComposite", inputs: { wan_frames: ["wan4", 0], frames: "all" } },
      sfm: { class_type: "SplatKit_SphereSfMDatasetDualRes", inputs: {
        pano_frames_1: ["camera1", 0], hires_1: ["hires1", 0],
        pano_frames_2: ["camera2", 0], hires_2: ["hires2", 0],
        pano_frames_3: ["camera3", 0], hires_3: ["hires3", 0],
        pano_frames_4: ["camera4", 0], hires_4: ["hires4", 0],
      } },
    };
    const selected = selectSplatKitWorkflowPaths(workflow, [0, 2]);
    expect(selected.sfm.inputs).toMatchObject({
      pano_frames_1: ["camera1", 0], hires_1: ["hires1", 0],
      pano_frames_2: ["camera3", 0], hires_2: ["hires3", 0],
      pano_frames_3: ["camera2", 0], hires_3: ["hires2", 0],
      pano_frames_4: ["camera4", 0], hires_4: ["hires4", 0],
      max_frames: 324, matcher_type: "exhaustive", face_size: 768, max_num_features: 8192,
      init_min_num_inliers: 15, on_split: "largest",
    });
    expect(selected.camera1.inputs).toMatchObject({ length: 81 });
    expect(selected.hires1.inputs).toMatchObject({ frames: "0-80/4" });
    expect(selected.camera2).toBeDefined();
    expect(selected.camera3).toBeDefined();
    expect(selected.camera4).toBeDefined();
    expect(selected.shared).toBeDefined();
    expect(selected.dndrom_dataset_result).toMatchObject({ class_type: "DnDRomDatasetResult", inputs: { dataset_dir: ["sfm", 0] } });
  });

  it("keeps all four cached rails in a tolerant mapping recovery", () => {
    const workflow: ComfyWorkflow = {
      shared: { class_type: "ModelLoader", inputs: {} },
      camera1: { class_type: "SplatKit_CameraPlotRenderControlGeo", inputs: { model: ["shared", 0] } },
      hires1: { class_type: "SplatKit_HiResComposite", inputs: { frames: ["camera1", 0] } },
      camera2: { class_type: "SplatKit_CameraPlotRenderControlGeo", inputs: { model: ["shared", 0] } },
      hires2: { class_type: "SplatKit_HiResComposite", inputs: { frames: ["camera2", 0] } },
      camera3: { class_type: "SplatKit_CameraPlotRenderControlGeo", inputs: { model: ["shared", 0] } },
      hires3: { class_type: "SplatKit_HiResComposite", inputs: { frames: ["camera3", 0] } },
      camera4: { class_type: "SplatKit_CameraPlotRenderControlGeo", inputs: { model: ["shared", 0] } },
      hires4: { class_type: "SplatKit_HiResComposite", inputs: { frames: ["camera4", 0] } },
      sfm: { class_type: "SplatKit_SphereSfMDatasetDualRes", inputs: {
        pano_frames_1: ["camera1", 0], hires_1: ["hires1", 0],
        pano_frames_2: ["camera2", 0], hires_2: ["hires2", 0],
        pano_frames_3: ["camera3", 0], hires_3: ["hires3", 0],
        pano_frames_4: ["camera4", 0], hires_4: ["hires4", 0],
      } },
    };
    const recovered = createSplatKitSfmRecoveryWorkflow(workflow);
    expect(recovered.sfm.inputs).toMatchObject({ matcher_type: "exhaustive", max_frames: 324, on_split: "largest", init_min_num_inliers: 10 });
    expect(recovered.sfm.inputs).toHaveProperty("pano_frames_4");
    expect(recovered.camera1).toBeDefined();
    expect(recovered.camera2).toBeDefined();
    expect(recovered.camera3).toBeDefined();
    expect(recovered.camera4).toBeDefined();
    expect(recovered.dndrom_dataset_result).toMatchObject({ inputs: { dataset_dir: ["sfm", 0] } });
    expect(isRecoverableSplatKitMappingFailure(new Error("SphereSfM could not connect enough overlapping camera views"))).toBe(true);
  });

  it("refuses to recover a partial one-rail reconstruction as a world", () => {
    expect(() => createSplatKitSfmRecoveryWorkflow({
      camera1: { class_type: "SplatKit_CameraPlotRenderControlGeo", inputs: {} },
      hires1: { class_type: "SplatKit_HiResComposite", inputs: { frames: ["camera1", 0] } },
      sfm: { class_type: "SplatKit_SphereSfMDatasetDualRes", inputs: { pano_frames_1: ["camera1", 0], hires_1: ["hires1", 0] } },
    })).toThrow(/all four camera rails/i);
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

  it("builds a core-only prompt-to-panorama workflow", () => {
    const workflow = createQuickPanoramaWorkflow("fantasy.safetensors", "A moonlit harbor", 42);
    expect(workflow["1"].inputs?.ckpt_name).toBe("fantasy.safetensors");
    expect(workflow["2"].inputs?.text).toContain("A moonlit harbor");
    expect(workflow["4"].inputs).toMatchObject({ width: 1024, height: 512 });
    expect(workflow["5"].inputs?.seed).toBe(42);
    expect(workflow["7"].class_type).toBe("SaveImage");
  });

  it("finds the generated COLMAP dataset for automatic training", () => {
    expect(selectSplatKitDatasetPath({ promptId: "p", outputs: [], outputTexts: ["done", "C:\\runtime\\output\\world\\sparse\\0"] }))
      .toBe("C:\\runtime\\output\\world\\sparse\\0");
  });

  it("stops polling when ComfyUI reports an error without a completed flag", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      "prompt-broken": {
        status: {
          completed: false,
          status_str: "error",
          messages: [["execution_error", { exception_message: "The mesh paint model could not be loaded" }]],
        },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(waitForComfyPrompt("http://127.0.0.1:8189", "prompt-broken")).rejects.toThrow(/mesh paint model could not be loaded/i);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("replaces a bare RuntimeError with the actionable SphereSfM cause", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      "prompt-broken": {
        status: {
          completed: false,
          status_str: "error",
          messages: [["execution_error", {
            exception_type: "RuntimeError",
            exception_message: "RuntimeError: [SphereSfM] mapper failed. No good initial image pair found. ERROR: failed to create sparse model",
          }]],
        },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(waitForComfyPrompt("http://127.0.0.1:8189", "prompt-broken")).rejects.toThrow(/overlapping camera views/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("explains clean recovery when the local engine is force-closed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    try {
      await expect(waitForComfyPrompt("http://127.0.0.1:8189", "force-closed")).rejects.toThrow(/restart it cleanly/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("surfaces ComfyUI node validation details instead of an opaque 400", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { message: "Prompt outputs failed validation" },
      node_errors: { "1": { errors: [{ message: "Required input is missing", details: "Required input is missing: viewport_state" }] } },
    }), { status: 400 })));
    try {
      await expect(queueComfyWorkflow("http://127.0.0.1:8189", { "1": { class_type: "BrokenNode", inputs: {} } })).rejects.toThrow(/viewport_state/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("releases prior models and interrupts running and queued work", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await releaseComfyMemory("http://127.0.0.1:8189");
      await cancelComfyPrompt("http://127.0.0.1:8189", "world-1");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(requests.map(({ url }) => url)).toEqual([
        "http://127.0.0.1:8189/free",
        "http://127.0.0.1:8189/interrupt",
        "http://127.0.0.1:8189/queue",
      ]);
      expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({ delete: ["world-1"] });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("turns local ComfyUI websocket events into workflow progress", async () => {
    const listeners = new Map<string, Array<(event: { data?: string }) => void>>();
    class MockWebSocket {
      addEventListener(type: string, listener: (event: { data?: string }) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      }
      close() { /* no-op */ }
    }
    vi.stubGlobal("WebSocket", MockWebSocket);
    const updates: Array<{ percent: number; nodeTitle?: string }> = [];
    const monitor = monitorComfyWorkflow("http://127.0.0.1:8189", "client-1", {
      "1": { class_type: "LoadImage", inputs: {}, _meta: { title: "Load drawing" } },
      "2": { class_type: "Pixal3DGenerate", inputs: {}, _meta: { title: "Generate textured mesh" } },
    }, (event) => updates.push(event));
    listeners.get("open")?.forEach((listener) => listener({}));
    await monitor.ready;
    monitor.setPromptId("prompt-1");
    listeners.get("message")?.forEach((listener) => listener({ data: JSON.stringify({ type: "executing", data: { prompt_id: "prompt-1", node: "2" } }) }));
    listeners.get("message")?.forEach((listener) => listener({ data: JSON.stringify({ type: "progress", data: { prompt_id: "prompt-1", node: "2", value: 5, max: 10 } }) }));

    expect(updates.at(-1)?.percent).toBe(25);
    expect(updates.at(-1)?.nodeTitle).toBe("Generate textured mesh");
    monitor.close();
    vi.unstubAllGlobals();
  });
});
