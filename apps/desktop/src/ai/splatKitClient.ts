import { readLocalAiSettings, worldWanBudget, type WorldWanBudget } from "../domain/localAiSettings";
import type { SplatReconstructionMetrics } from "../domain/types";

export type ComfyWorkflow = Record<string, { class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } }>;

export interface ComfyUpload {
  name: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyOutputFile {
  filename: string;
  subfolder: string;
  type: string;
}

export interface ComfyPromptResult {
  promptId: string;
  outputs: ComfyOutputFile[];
  outputTexts: string[];
}

export interface SplatKitCoverageDecision {
  selectedPaths: number[];
  recommendedPathCount: number;
  paths: Array<{ index: number; mean: number; minimum: number; tail: number; score: number }>;
}

export interface ComfyExecutionProgress {
  status: "queued" | "executing" | "complete" | "error";
  percent: number;
  completedNodes: number;
  totalNodes: number;
  nodeId?: string;
  nodeTitle?: string;
}

export interface ComfyProgressMonitor {
  ready: Promise<void>;
  setPromptId: (promptId: string) => void;
  close: () => void;
}

export const SPLATKIT_CAMERA_STALL_MS = 8 * 60_000;
export const SPLATKIT_GENERAL_STALL_MS = 25 * 60_000;

// Wan 2.1's VAE changes to a substantially larger activation estimate above
// four latent time slices. A 49-frame clip contains roughly 13 latent slices,
// which can leave a 10 GB card paging VAE activations around a still-resident
// 14B diffusion model. Decode four latent slices at a time while keeping each
// slice at full spatial resolution. ComfyUI converts these output-frame values
// by the VAE's 4x temporal compression before invoking its tiled decoder.
export const WAN_VAE_DECODE_BUDGET = {
  tileSize: 2048,
  overlap: 64,
  temporalSize: 16,
  temporalOverlap: 4,
} as const;

interface ComfyObjectInfo {
  input?: { required?: { ckpt_name?: [string[]] } };
}

const patchPositivePrompts = (workflow: ComfyWorkflow, description: string): number => {
  let promptPatched = 0;
  for (const node of Object.values(workflow)) {
    const className = node.class_type?.toLowerCase() ?? "";
    const title = node._meta?.title?.toLowerCase() ?? "";
    const existingText = node.inputs && typeof node.inputs.text === "string" ? node.inputs.text : "";
    const looksNegative = title.includes("negative") || /low resolution|distortion|artifact|blurr|worst quality|not of a high quality/i.test(existingText);
    if (node.inputs && existingText && (className.includes("textencode") || title.includes("prompt")) && !looksNegative) {
      node.inputs.text = description;
      promptPatched++;
    }
  }
  return promptPatched;
};

const stripUpscalerFromBundleMetadata = (value: unknown): unknown => {
  if (typeof value !== "string" || !value.includes("UPSCALE_MODEL")) return value;
  try {
    const metadata = JSON.parse(value) as Record<string, unknown>;
    const types = Array.isArray(metadata.types) ? metadata.types : [];
    const keep = types.map((type, index) => ({ type, index })).filter(({ type }) => type !== "UPSCALE_MODEL").map(({ index }) => index);
    if (keep.length === types.length) return value;
    for (const [key, entry] of Object.entries(metadata)) {
      if (Array.isArray(entry) && entry.length === types.length) metadata[key] = keep.map((index) => entry[index]);
    }
    return JSON.stringify(metadata);
  } catch {
    return value;
  }
};

const removeUnusedUpscalerBundleInputs = (workflow: ComfyWorkflow): void => {
  const upscalers = new Set(Object.entries(workflow)
    .filter(([, node]) => /upscalemodelloader/i.test(node.class_type ?? ""))
    .map(([nodeId]) => nodeId));
  for (const node of Object.values(workflow)) {
    if (!node.inputs) continue;
    if (/^bundle$/i.test(node.class_type ?? "")) {
      for (const [name, value] of Object.entries(node.inputs)) {
        const reference = Array.isArray(value) ? String(value[0]) : "";
        if (upscalers.has(reference)) delete node.inputs[name];
      }
    }
    for (const [name, value] of Object.entries(node.inputs)) {
      if (/meta/i.test(name)) node.inputs[name] = stripUpscalerFromBundleMetadata(value);
    }
  }
};

export const assertLocalComfyUiEndpoint = (base: string): string => {
  const parsed = new URL(base.trim());
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) {
    throw new Error("Scenery Studio only connects to a loopback ComfyUI endpoint (localhost, 127.0.0.1, or ::1)");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("ComfyUI must use an HTTP endpoint");
  return parsed.toString().replace(/\/+$/, "");
};

const endpoint = (base: string, path: string): string => `${assertLocalComfyUiEndpoint(base)}${path}`;

const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abortFromCaller();
  else init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      let reason = detail;
      try {
        const payload = JSON.parse(detail) as { error?: { message?: string } | string; node_errors?: Record<string, { errors?: { message?: string; details?: string }[] }> };
        const nodeReason = Object.values(payload.node_errors ?? {}).flatMap((entry) => entry.errors ?? []).map((entry) => entry.details || entry.message).filter(Boolean)[0];
        reason = nodeReason || (typeof payload.error === "string" ? payload.error : payload.error?.message) || detail;
      } catch {
        // Plain-text ComfyUI errors remain useful as-is.
      }
      throw new Error(`ComfyUI rejected the workflow (${response.status})${reason ? `: ${reason.slice(0, 360)}` : ""}`);
    }
    return response;
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
};

export async function testComfyUi(baseUrl: string): Promise<void> {
  if (!baseUrl.trim()) throw new Error("Enter the local ComfyUI endpoint first");
  await fetchWithTimeout(endpoint(baseUrl, "/system_stats"));
}

export async function listComfyCheckpoints(baseUrl: string): Promise<string[]> {
  const response = await fetchWithTimeout(endpoint(baseUrl, "/object_info/CheckpointLoaderSimple"));
  const payload = await response.json() as { CheckpointLoaderSimple?: ComfyObjectInfo };
  const names = payload.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
  return Array.isArray(names) ? names.filter((entry): entry is string => typeof entry === "string") : [];
}

export function createQuickPanoramaWorkflow(checkpointName: string, description: string, seed = Math.floor(Math.random() * 2_147_483_647)): ComfyWorkflow {
  if (!checkpointName.trim()) throw new Error("Install or select a ComfyUI checkpoint first");
  if (!description.trim()) throw new Error("Describe the panorama first");
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpointName } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: `${description.trim()}, equirectangular 360 degree panorama, seamless wraparound horizon, full environment, no borders`, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: "text, watermark, frame, border, duplicate architecture, broken horizon, visible seam, low resolution, distortion, artifacts", clip: ["1", 1] }, _meta: { title: "Negative Prompt" } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 512, batch_size: 1 } },
    "5": { class_type: "KSampler", inputs: { seed, steps: 28, cfg: 6, sampler_name: "euler_ancestral", scheduler: "normal", denoise: 1, model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0] } },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { filename_prefix: "DnDRom_Panorama", images: ["6", 0] } },
  };
}

export async function uploadComfyImage(baseUrl: string, file: File): Promise<ComfyUpload> {
  const body = new FormData();
  body.append("image", file, file.name);
  body.append("type", "input");
  body.append("overwrite", "false");
  return await (await fetchWithTimeout(endpoint(baseUrl, "/upload/image"), { method: "POST", body }, 60_000)).json() as ComfyUpload;
}

export function prepareSplatKitWorkflow(workflow: ComfyWorkflow, upload: ComfyUpload, description: string): ComfyWorkflow {
  const prepared = structuredClone(workflow);
  const nodes = Object.values(prepared);
  const wanBudget = worldWanBudget(readLocalAiSettings().memoryProfile);
  if (!nodes.some((node) => node.class_type?.toLowerCase().includes("splatkit"))) {
    throw new Error("This workflow does not contain ComfyUI-SplatKit nodes. Export the official workflow in API format.");
  }
  let imagePatched = 0;
  const uploadedName = upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
  for (const node of nodes) {
    const className = node.class_type?.toLowerCase() ?? "";
    if (className.includes("loadimage") && node.inputs && "image" in node.inputs) {
      node.inputs.image = uploadedName;
      imagePatched++;
    }
    if (className === "splatkit_cameraplotrendercontrolgeo" && node.inputs) {
      // Match the composite stages so SplatKit can reuse its panorama-depth
      // cache instead of paying for a maximum-detail MoGe pass per branch.
      node.inputs.moge_level = 9;
      node.inputs.length = wanBudget.length;
    }
    if (className === "splatkit_wani2vmaskedconditioning" && node.inputs) {
      node.inputs.width = wanBudget.width;
      node.inputs.height = wanBudget.height;
      node.inputs.length = wanBudget.length;
    }
    if (className === "splatkit_hirescomposite" && node.inputs) {
      // Game profiles preserve the panorama as the sharp source and composite
      // only the WAN-repaired holes at native 2K. The learned upscaler remains
      // available only to the explicit maximum-quality profile.
      node.inputs.frames = wanBudget.compositeFrames;
      node.inputs.output_width = wanBudget.outputWidth;
      node.inputs.depth_grid = "geometry_res";
      node.inputs.geom_scale = wanBudget.geometryScale;
      node.inputs.prefetch = wanBudget.compositePrefetch;
      node.inputs.proxy_width = wanBudget.proxyWidth;
      node.inputs.tone_work = wanBudget.toneWorkWidth;
      node.inputs.debug_save = "off";
      node.inputs.save_video = false;
      node.inputs.save_proxies = false;
      node.inputs.tone_mode = "luma";
      if (!wanBudget.useLearnedUpscaler) delete node.inputs.upscale_model;
    }
  }
  // Only tune samplers fed by a WAN conditioning node. Other bundled samplers
  // may belong to panorama or model-generation stages and retain their quality.
  const wanSamplerIds = new Set<string>();
  for (const [nodeId, node] of Object.entries(prepared)) {
    if (node.class_type?.toLowerCase() !== "ksampler" || !node.inputs) continue;
    const latent = node.inputs.latent_image;
    if (!Array.isArray(latent)) continue;
    const conditioning = prepared[String(latent[0])];
    if (conditioning?.class_type?.toLowerCase() === "splatkit_wani2vmaskedconditioning") {
      node.inputs.steps = wanBudget.steps;
      wanSamplerIds.add(nodeId);
    }
  }
  // A normal VAEDecode tries to decode the complete WAN clip in one temporal
  // pass. Bound only the temporal working set; a 2048px tile keeps every world
  // profile spatially untiled, avoiding unnecessary spatial seam blending.
  for (const node of nodes) {
    if (node.class_type?.toLowerCase() !== "vaedecode" || !node.inputs) continue;
    const samples = node.inputs.samples;
    if (!Array.isArray(samples) || !wanSamplerIds.has(String(samples[0]))) continue;
    node.class_type = "DnDRomWanVAEDecode";
    node.inputs = {
      ...node.inputs,
      tile_size: WAN_VAE_DECODE_BUDGET.tileSize,
      overlap: WAN_VAE_DECODE_BUDGET.overlap,
      temporal_size: WAN_VAE_DECODE_BUDGET.temporalSize,
      temporal_overlap: WAN_VAE_DECODE_BUDGET.temporalOverlap,
    };
    node._meta = { ...node._meta, title: "WAN VAE decode (VRAM handoff)" };
  }
  // The final HiRes composites already consume every WAN branch. The official
  // graph's raw SaveVideo outputs duplicate those tensors as diagnostic videos
  // and force additional encoding/disk I/O without contributing to COLMAP.
  for (const [nodeId, node] of Object.entries(prepared)) {
    if (node.class_type?.toLowerCase() === "savevideo") delete prepared[nodeId];
  }
  if (!wanBudget.useLearnedUpscaler) removeUnusedUpscalerBundleInputs(prepared);
  const promptPatched = patchPositivePrompts(prepared, description);
  if (imagePatched === 0) throw new Error("The workflow has no LoadImage input to receive the panorama");
  if (promptPatched === 0) throw new Error("The workflow has no positive text prompt input");
  return prepared;
}

/**
 * Runs MoGe in isolation before the WAN graph stages its large text and vision
 * models. SplatKit retains the resulting panorama-depth/mesh cache in-process,
 * so the full reconstruction can reuse it without crossing the 10 GB residency
 * cliff during CameraPlot.
 */
export function createSplatKitDepthPreflightWorkflow(workflow: ComfyWorkflow, maxPaths = worldWanBudget(readLocalAiSettings().memoryProfile).maxTrajectories): ComfyWorkflow {
  const entries = Object.entries(workflow);
  const cameras = entries.filter(([, node]) => node.class_type?.toLowerCase() === "splatkit_cameraplotrendercontrolgeo");
  const panorama = entries.find(([, node]) => node.class_type?.toLowerCase() === "loadimage");
  const dataset = entries.find(([, node]) => node.class_type?.toLowerCase() === "splatkit_datasetproject");
  if (!cameras.length || !panorama || !dataset) throw new Error("The SplatKit workflow cannot isolate its panorama-depth preflight");

  const [panoramaId, panoramaNode] = panorama;
  const [datasetId, datasetNode] = dataset;
  const preflight: ComfyWorkflow = {
    [panoramaId]: structuredClone(panoramaNode),
    [datasetId]: structuredClone(datasetNode),
  };
  const analyzerInputs: Record<string, unknown> = { max_paths: Math.max(1, Math.min(4, maxPaths)) };
  cameras.slice(0, 4).forEach(([cameraId, cameraNode], index) => {
    const isolatedCamera = structuredClone(cameraNode);
    isolatedCamera.inputs = {
      ...isolatedCamera.inputs,
      panorama: [panoramaId, 0],
      dataset_dir: [datasetId, 0],
    };
    preflight[cameraId] = isolatedCamera;
    analyzerInputs[`control_mask_${index + 1}`] = [cameraId, 1];
  });
  const firstCameraId = cameras[0][0];
  preflight.dndrom_depth_preflight = {
    class_type: "PreviewImage",
    inputs: { images: [firstCameraId, 0] },
    _meta: { title: "Cache panorama depth for reconstruction" },
  };
  preflight.dndrom_trajectory_coverage = {
    class_type: "DnDRomTrajectoryCoverage",
    inputs: analyzerInputs,
    _meta: { title: "Measure playable camera coverage" },
  };
  return preflight;
}

const inputReference = (value: unknown): [string, number] | null => Array.isArray(value)
  && value.length >= 2
  && (typeof value[0] === "string" || typeof value[0] === "number")
  && typeof value[1] === "number"
  ? [String(value[0]), value[1]]
  : null;

export function parseSplatKitCoverageDecision(result: Pick<ComfyPromptResult, "outputTexts">): SplatKitCoverageDecision | null {
  const prefix = "DNDROM_COVERAGE:";
  for (const text of result.outputTexts) {
    const marker = text.indexOf(prefix);
    if (marker < 0) continue;
    try {
      const value = JSON.parse(text.slice(marker + prefix.length).trim()) as Partial<SplatKitCoverageDecision>;
      if (!Array.isArray(value.selectedPaths) || !Array.isArray(value.paths)) continue;
      const selectedPaths = [...new Set(value.selectedPaths.filter((entry): entry is number => Number.isInteger(entry) && entry >= 0 && entry < 4))];
      if (!selectedPaths.length) continue;
      return {
        selectedPaths,
        recommendedPathCount: Math.max(1, Number(value.recommendedPathCount) || selectedPaths.length),
        paths: value.paths.filter((entry): entry is SplatKitCoverageDecision["paths"][number] => Boolean(entry)
          && Number.isFinite(entry.index) && Number.isFinite(entry.mean) && Number.isFinite(entry.minimum)
          && Number.isFinite(entry.tail) && Number.isFinite(entry.score)),
      };
    } catch {
      // Ignore unrelated or truncated node text and use the profile fallback.
    }
  }
  return null;
}

export function parseSplatKitReconstructionMetrics(result: Pick<ComfyPromptResult, "outputTexts">): SplatReconstructionMetrics | null {
  const prefix = "DNDROM_SFM_QUALITY:";
  for (const text of result.outputTexts) {
    const marker = text.indexOf(prefix);
    if (marker < 0) continue;
    try {
      const value = JSON.parse(text.slice(marker + prefix.length).trim()) as Partial<SplatReconstructionMetrics>;
      if (!Number.isFinite(value.registeredCameraRatio) || !Array.isArray(value.railRegistrationRatios) || value.railRegistrationRatios.length !== 4 || value.railRegistrationRatios.some((entry) => !Number.isFinite(entry)) || !Number.isFinite(value.largestComponentRatio) || !Number.isFinite(value.groundPlaneSupport) || !Number.isFinite(value.boundsToRailRatio)) continue;
      return { registeredCameraRatio: value.registeredCameraRatio!, railRegistrationRatios: value.railRegistrationRatios, largestComponentRatio: value.largestComponentRatio!, groundPlaneSupport: value.groundPlaneSupport!, boundsToRailRatio: value.boundsToRailRatio! };
    } catch { /* Ignore unrelated/truncated output. */ }
  }
  return null;
}

/** Rank all authored rails for scheduling without removing geometric coverage. */
export function selectSplatKitCompatiblePaths(decision: SplatKitCoverageDecision, maxPaths: number): number[] {
  // Coverage now ranks rails for scheduling only. Removing a rail destroys the
  // multi-view continuity which SphereSfM needs, so every authored rail that
  // exists within the selected profile remains in the reconstruction.
  const count = Math.max(1, Math.min(maxPaths, decision.paths.length));
  const paths = new Map(decision.paths.map((path) => [path.index, path]));
  const score = (index: number) => paths.get(index)?.score ?? Number.POSITIVE_INFINITY;
  const adjacent = [1, 3].filter((index) => paths.has(index)).sort((left, right) => score(left) - score(right));
  const remaining = [...paths.keys()]
    .filter((index) => index !== 0 && !adjacent.includes(index))
    .sort((left, right) => score(left) - score(right));
  return [0, ...adjacent, ...remaining].filter((index) => paths.has(index)).slice(0, count);
}

/**
 * Preserves all four camera rails. The coverage preflight controls execution
 * order only; it must never turn an incomplete one-rail cloud into a world.
 */
export function selectSplatKitWorkflowPaths(
  workflow: ComfyWorkflow,
  selectedIndices: number[],
  budget: WorldWanBudget = worldWanBudget(readLocalAiSettings().memoryProfile),
): ComfyWorkflow {
  const requestedOrder = [...new Set(selectedIndices.filter((entry) => Number.isInteger(entry) && entry >= 0 && entry < 4))];
  const prepared = structuredClone(workflow);
  const finalEntry = Object.entries(prepared).find(([, node]) => /spheresfmdatasetdualres/i.test(node.class_type ?? ""));
  if (!finalEntry?.[1].inputs) throw new Error("The SplatKit workflow has no dual-resolution SphereSfM output");
  const [finalId, finalNode] = finalEntry;
  const inputs = finalNode.inputs!;
  const pairs = Array.from({ length: 4 }, (_, index) => ({
    panorama: inputs[`pano_frames_${index + 1}`],
    hires: inputs[`hires_${index + 1}`],
  }));
  const availableIndices = pairs.map((pair, index) => inputReference(pair.panorama) && inputReference(pair.hires) ? index : -1).filter((index) => index >= 0);
  const selected = [...requestedOrder, ...availableIndices].filter((index, position, values) => availableIndices.includes(index) && values.indexOf(index) === position).slice(0, budget.maxTrajectories);
  const usable = selected.map((index) => pairs[index]);
  if (usable.length < 4) throw new Error("SplatKit requires all four connected camera rails before SphereSfM can build a world");
  usable.forEach((pair, pathIndex) => {
    const branch = new Set<string>();
    const collect = (nodeId: string) => {
      if (branch.has(nodeId)) return;
      const node = prepared[nodeId];
      if (!node) return;
      branch.add(nodeId);
      for (const value of Object.values(node.inputs ?? {})) {
        const reference = inputReference(value);
        if (reference) collect(reference[0]);
      }
    };
    const panorama = inputReference(pair.panorama);
    const hires = inputReference(pair.hires);
    if (panorama) collect(panorama[0]);
    if (hires) collect(hires[0]);
    const length = pathIndex === 0 ? budget.length : budget.supplementalLength;
    const frames = pathIndex === 0 ? budget.compositeFrames : budget.supplementalCompositeFrames;
    for (const nodeId of branch) {
      const node = prepared[nodeId];
      if (!node?.inputs) continue;
      const className = node.class_type?.toLowerCase() ?? "";
      if (className === "splatkit_cameraplotrendercontrolgeo" || className === "splatkit_wani2vmaskedconditioning") {
        node.inputs.length = length;
      }
      if (className === "splatkit_hirescomposite") node.inputs.frames = frames;
    }
  });
  for (let index = 0; index < 4; index++) {
    const pair = usable[index];
    if (pair) {
      inputs[`pano_frames_${index + 1}`] = pair.panorama;
      inputs[`hires_${index + 1}`] = pair.hires;
    } else {
      delete inputs[`pano_frames_${index + 1}`];
      delete inputs[`hires_${index + 1}`];
    }
  }
  inputs.frame_stride = 1;
  inputs.max_frames = budget.sfmMaxFrames;
  inputs.matcher_type = usable.length > 1 ? "exhaustive" : "sequential";
  inputs.face_size = budget.sfmFaceSize;
  inputs.max_num_features = budget.sfmMaxFeatures;
  inputs.max_num_matches = Math.max(8192, budget.sfmMaxFeatures * 2);
  // These thresholds retain useful tabletop geometry while tolerating the
  // softer correspondences produced by short, low-resolution WAN rails.
  inputs.peak_threshold = 0.003;
  inputs.filter_max_reproj_error = 8;
  inputs.filter_min_tri_angle = 0.5;
  inputs.init_min_tri_angle = 1;
  inputs.init_min_num_inliers = 15;
  inputs.init_max_forward_motion = 1;
  inputs.on_split = "largest";
  delete inputs.reuse_solve;

  const resultNodeId = "dndrom_dataset_result";
  prepared[resultNodeId] = {
    class_type: "DnDRomDatasetResult",
    inputs: { dataset_dir: [finalId, 0] },
    _meta: { title: "Return completed world dataset" },
  };

  const keep = new Set<string>();
  const visit = (nodeId: string) => {
    if (keep.has(nodeId)) return;
    const node = prepared[nodeId];
    if (!node) return;
    keep.add(nodeId);
    for (const value of Object.values(node.inputs ?? {})) {
      const reference = inputReference(value);
      if (reference) visit(reference[0]);
    }
  };
  visit(resultNodeId);
  for (const nodeId of Object.keys(prepared)) if (!keep.has(nodeId)) delete prepared[nodeId];
  return prepared;
}

/** Retry SphereSfM with more tolerant matching while retaining every completed
 * rail. A one-rail reconstruction is never promoted as a successful world. */
export function createSplatKitSfmRecoveryWorkflow(workflow: ComfyWorkflow): ComfyWorkflow {
  const recovered = structuredClone(workflow);
  const finalEntry = Object.entries(recovered).find(([, node]) => /spheresfmdatasetdualres/i.test(node.class_type ?? ""));
  if (!finalEntry?.[1].inputs) throw new Error("The SplatKit workflow has no SphereSfM stage to recover");
  const [finalId, finalNode] = finalEntry;
  const finalInputs = finalNode.inputs!;
  const connectedRails = Array.from({ length: 4 }, (_, index) => inputReference(finalInputs[`pano_frames_${index + 1}`]) && inputReference(finalInputs[`hires_${index + 1}`])).filter(Boolean).length;
  if (connectedRails < 4) throw new Error("Recovery cannot import a partial reconstruction; all four camera rails are required");
  Object.assign(finalInputs, {
    matcher_type: "exhaustive",
    max_frames: worldWanBudget(readLocalAiSettings().memoryProfile).sfmMaxFrames,
    max_num_features: 12_288,
    max_num_matches: 32_768,
    peak_threshold: 0.002,
    filter_max_reproj_error: 10,
    filter_min_tri_angle: 0.25,
    init_min_tri_angle: 0.5,
    init_min_num_inliers: 10,
    init_max_forward_motion: 1,
    on_split: "largest",
  });
  delete finalInputs.reuse_solve;
  finalNode._meta = { ...finalNode._meta, title: "SphereSfM overlap recovery" };

  const resultNodeId = "dndrom_dataset_result";
  recovered[resultNodeId] = {
    class_type: "DnDRomDatasetResult",
    inputs: { dataset_dir: [finalId, 0] },
    _meta: { title: "Return recovered world dataset" },
  };

  const keep = new Set<string>();
  const visit = (nodeId: string) => {
    if (keep.has(nodeId)) return;
    const node = recovered[nodeId];
    if (!node) return;
    keep.add(nodeId);
    for (const value of Object.values(node.inputs ?? {})) {
      const reference = inputReference(value);
      if (reference) visit(reference[0]);
    }
  };
  visit(resultNodeId);
  for (const nodeId of Object.keys(recovered)) if (!keep.has(nodeId)) delete recovered[nodeId];
  return recovered;
}

export const isRecoverableSplatKitMappingFailure = (error: unknown): boolean => /SphereSfM|initial image pair|sparse model|spherical mapping/i.test(error instanceof Error ? error.message : String(error));

export function comfyNodeStallLimitMs(nodeTitle?: string): number {
  return /camera\s*plot|render\s*control/i.test(nodeTitle ?? "") ? SPLATKIT_CAMERA_STALL_MS : SPLATKIT_GENERAL_STALL_MS;
}

export function assertComfyNodeResponsive(lastActivityAt: number, nodeTitle?: string, now = Date.now()): void {
  const limit = comfyNodeStallLimitMs(nodeTitle);
  if (now - lastActivityAt < limit) return;
  const minutes = Math.round(limit / 60_000);
  throw new Error(`${nodeTitle || "The current reconstruction step"} stopped reporting progress for ${minutes} minutes. DnDRom cancelled the stalled local job; your panorama is preserved and can be retried.`);
}

export function preparePanoramaWorkflow(workflow: ComfyWorkflow, description: string): ComfyWorkflow {
  const prepared = structuredClone(workflow);
  if (patchPositivePrompts(prepared, description) === 0) throw new Error("The panorama workflow has no positive text prompt input");
  return prepared;
}

export async function queueComfyWorkflow(baseUrl: string, workflow: ComfyWorkflow, clientId = crypto.randomUUID()): Promise<string> {
  const response = await fetchWithTimeout(endpoint(baseUrl, "/prompt"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  }, 30_000);
  const result = await response.json() as { prompt_id?: string; error?: string; node_errors?: unknown };
  if (!result.prompt_id) throw new Error(result.error || `ComfyUI rejected the workflow${result.node_errors ? ": check missing nodes or models" : ""}`);
  return result.prompt_id;
}

export async function releaseComfyMemory(baseUrl: string): Promise<void> {
  await fetchWithTimeout(endpoint(baseUrl, "/free"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }, 30_000);
}

/** Stops both a running prompt and a matching queued prompt. Cleanup is
 * best-effort because cancellation must never mask the original job error. */
export async function cancelComfyPrompt(baseUrl: string, promptId: string): Promise<void> {
  await Promise.allSettled([
    fetchWithTimeout(endpoint(baseUrl, "/interrupt"), { method: "POST" }, 15_000),
    fetchWithTimeout(endpoint(baseUrl, "/queue"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delete: [promptId] }),
    }, 15_000),
  ]);
}

const friendlyNodeTitle = (workflow: ComfyWorkflow, nodeId: string): string => {
  const node = workflow[nodeId];
  const raw = node?._meta?.title || node?.class_type || "Local 3D processing";
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Opens ComfyUI's local progress socket before a prompt is queued. HTTP history
 * polling remains authoritative for completion, so a missing/stale socket only
 * makes the progress bar indeterminate; it never loses the generated result.
 */
export function monitorComfyWorkflow(
  baseUrl: string,
  clientId: string,
  workflow: ComfyWorkflow,
  onProgress: (progress: ComfyExecutionProgress) => void,
): ComfyProgressMonitor {
  const socketUrl = new URL(endpoint(baseUrl, "/ws"));
  socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
  socketUrl.searchParams.set("clientId", clientId);
  let socket: WebSocket;
  try {
    socket = new WebSocket(socketUrl);
  } catch {
    return { ready: Promise.resolve(), setPromptId: () => undefined, close: () => undefined };
  }
  let promptId = "";
  let activeNode = "";
  let closed = false;
  const completed = new Set<string>();
  const workflowNodeCount = Math.max(1, Object.keys(workflow).length);
  const pendingMessages: unknown[] = [];

  let settleReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => { settleReady = resolve; });
  const readyTimer = window.setTimeout(() => settleReady?.(), 1_500);
  const markReady = () => {
    window.clearTimeout(readyTimer);
    settleReady?.();
    settleReady = undefined;
  };

  const emit = (status: ComfyExecutionProgress["status"], nodeId = activeNode, fraction = 0) => {
    const totalNodes = Math.max(workflowNodeCount, completed.size + (nodeId ? 1 : 0));
    const percent = status === "complete"
      ? 100
      : Math.min(99, Math.max(0, ((completed.size + Math.min(1, Math.max(0, fraction))) / totalNodes) * 100));
    onProgress({
      status,
      percent,
      completedNodes: Math.min(completed.size, totalNodes),
      totalNodes,
      nodeId: nodeId || undefined,
      nodeTitle: nodeId ? friendlyNodeTitle(workflow, nodeId) : undefined,
    });
  };

  const consume = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const message = value as { type?: string; data?: Record<string, unknown> };
    const data = message.data ?? {};
    const messagePromptId = typeof data.prompt_id === "string" ? data.prompt_id : "";
    if (!promptId) { pendingMessages.push(value); return; }
    if (messagePromptId && messagePromptId !== promptId) return;

    if (message.type === "execution_start") {
      emit("queued");
      return;
    }
    if (message.type === "executing") {
      const node = typeof data.node === "string" || typeof data.node === "number" ? String(data.node) : "";
      if (!node) { emit("complete", "", 1); return; }
      if (activeNode && activeNode !== node) completed.add(activeNode);
      activeNode = node;
      emit("executing", node);
      return;
    }
    if (message.type === "executed") {
      const node = typeof data.node === "string" || typeof data.node === "number" ? String(data.node) : activeNode;
      if (node) completed.add(node);
      emit("executing", activeNode === node ? "" : activeNode);
      return;
    }
    if (message.type === "execution_cached" && Array.isArray(data.nodes)) {
      for (const node of data.nodes) completed.add(String(node));
      emit("executing");
      return;
    }
    if (message.type === "progress") {
      const node = typeof data.node === "string" || typeof data.node === "number" ? String(data.node) : activeNode;
      if (node) activeNode = node;
      const progressValue = Number(data.value);
      const maximum = Number(data.max);
      emit("executing", node, Number.isFinite(progressValue) && Number.isFinite(maximum) && maximum > 0 ? progressValue / maximum : 0);
      return;
    }
    if (message.type === "progress_state" && data.nodes && typeof data.nodes === "object") {
      let runningNode = activeNode;
      let runningFraction = 0;
      for (const [nodeId, stateValue] of Object.entries(data.nodes as Record<string, unknown>)) {
        if (!stateValue || typeof stateValue !== "object") continue;
        const state = stateValue as { state?: unknown; value?: unknown; max?: unknown };
        if (state.state === "finished") completed.add(nodeId);
        if (state.state === "running") {
          runningNode = nodeId;
          const current = Number(state.value);
          const maximum = Number(state.max);
          runningFraction = Number.isFinite(current) && Number.isFinite(maximum) && maximum > 0 ? current / maximum : 0;
        }
      }
      activeNode = runningNode;
      emit("executing", runningNode, runningFraction);
      return;
    }
    if (message.type === "execution_error" || message.type === "execution_interrupted") emit("error");
  };

  socket.addEventListener("open", markReady);
  socket.addEventListener("error", markReady);
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try { consume(JSON.parse(event.data) as unknown); } catch { /* Ignore preview/status frames that are not JSON. */ }
  });

  return {
    ready,
    setPromptId: (value) => {
      promptId = value;
      const buffered = pendingMessages.splice(0);
      buffered.forEach(consume);
      emit("queued");
    },
    close: () => {
      if (closed) return;
      closed = true;
      markReady();
      socket.close();
    },
  };
}

const outputFiles = (outputs: unknown): ComfyOutputFile[] => {
  const found: ComfyOutputFile[] = [];
  if (!outputs || typeof outputs !== "object") return found;
  for (const nodeOutput of Object.values(outputs as Record<string, unknown>)) {
    if (!nodeOutput || typeof nodeOutput !== "object") continue;
    for (const value of Object.values(nodeOutput as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      for (const entry of value) {
        if (entry && typeof entry === "object" && typeof (entry as { filename?: unknown }).filename === "string") {
          const file = entry as { filename: string; subfolder?: string; type?: string };
          found.push({ filename: file.filename, subfolder: file.subfolder ?? "", type: file.type ?? "output" });
        }
      }
    }
  }
  return found;
};

const outputTexts = (outputs: unknown): string[] => {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.length < 4096) found.add(value);
      return;
    }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(visit);
  };
  visit(outputs);
  return [...found];
};

export function selectSplatKitDatasetPath(result: ComfyPromptResult): string | null {
  return result.outputTexts.find((value) => /(?:^|[\\/])sparse[\\/]0(?:$|[\\/])/i.test(value))
    ?? result.outputTexts.find((value) => /(?:colmap|dataset)/i.test(value) && /[\\/]/.test(value))
    ?? null;
}

const comfyFailureMessage = (messages: unknown): string | null => {
  const found: Array<{ key: string; value: string }> = [];
  const visit = (value: unknown, key = ""): void => {
    if (typeof value === "string" && /(?:message|error|exception)/i.test(key) && value.trim()) {
      found.push({ key, value: value.trim() });
      return;
    }
    if (Array.isArray(value)) { value.forEach((entry) => visit(entry, key)); return; }
    if (value && typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([entryKey, entry]) => visit(entry, entryKey));
    }
  };
  visit(messages);
  const combined = found.map(({ value }) => value).join("\n");
  if (/No good initial image pair|failed to create sparse model|mapper produced no reconstruction/i.test(combined)) {
    return "SphereSfM could not connect enough overlapping camera views into one 3D reconstruction";
  }
  const ranked = found.sort((left, right) => {
    const weight = (key: string) => /exception_message/i.test(key) ? 3 : /(?:details|error)/i.test(key) ? 2 : /exception_type/i.test(key) ? 0 : 1;
    return weight(right.key) - weight(left.key);
  });
  const detail = ranked.find(({ value }) => !/^RuntimeError$/i.test(value))?.value;
  return detail ? detail.replace(/\s+/g, " ").slice(0, 700) : null;
};

const isTerminalComfyFailure = (status: string): boolean => /^(?:error|failed|failure|interrupted|cancelled|canceled|execution_error|execution_interrupted)$/i.test(status.trim());

export async function waitForComfyPrompt(
  baseUrl: string,
  promptId: string,
  signal?: AbortSignal,
  onPoll?: () => void,
  maxWaitMs = 90 * 60_000,
): Promise<ComfyPromptResult> {
  const startedAt = Date.now();
  while (!signal?.aborted) {
    if (Date.now() - startedAt >= maxWaitMs) {
      throw new Error(`ComfyUI did not finish this job within ${Math.max(1, Math.round(maxWaitMs / 60_000))} minutes. The current asset was not changed.`);
    }
    let history: Record<string, { outputs?: unknown; status?: { completed?: boolean; status_str?: string; messages?: unknown[] } }>;
    try {
      history = await (await fetchWithTimeout(endpoint(baseUrl, `/history/${encodeURIComponent(promptId)}`), { signal }, 30_000)).json() as typeof history;
    } catch (error) {
      if (signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
      throw new Error(`The local generation engine stopped responding. Retry this job and DnDRom will restart it cleanly. ${error instanceof Error ? error.message : ""}`.trim());
    }
    const job = history[promptId];
    const status = job?.status?.status_str?.trim() ?? "";
    if (status && isTerminalComfyFailure(status)) {
      const detail = comfyFailureMessage(job?.status?.messages);
      throw new Error(detail ? `ComfyUI ${status}: ${detail}` : `ComfyUI generation ended with status ${status}`);
    }
    if (job?.status?.completed) {
      if (status && status.toLowerCase() !== "success") throw new Error(`ComfyUI generation ended with status ${status}`);
      return { promptId, outputs: outputFiles(job.outputs), outputTexts: outputTexts(job.outputs) };
    }
    onPoll?.();
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, 3000);
      signal?.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Generation cancelled", "AbortError")); }, { once: true });
    });
  }
  throw new DOMException("Generation cancelled", "AbortError");
}

export async function downloadComfyOutput(baseUrl: string, output: ComfyOutputFile): Promise<File> {
  const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder, type: output.type });
  const blob = await (await fetchWithTimeout(endpoint(baseUrl, `/view?${query}`), {}, 120_000)).blob();
  return new File([blob], output.filename, { type: blob.type || "application/octet-stream" });
}
