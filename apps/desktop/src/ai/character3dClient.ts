import {
  downloadComfyOutput,
  monitorComfyWorkflow,
  queueComfyWorkflow,
  uploadComfyImage,
  waitForComfyPrompt,
  type ComfyOutputFile,
  type ComfyPromptResult,
  type ComfyUpload,
  type ComfyWorkflow,
} from "./splatKitClient";
import { configureCharacterPreset, materializeComfyWorkflow, type ComfyWorkflowPreset } from "./comfyWorkflowPreset";
import {
  clampMiniatureFaces,
  DEFAULT_MINIATURE_PRECLUSTER_MAX_VERTICES,
  DEFAULT_MINIATURE_REMESH_RESOLUTION,
  DEFAULT_MINIATURE_SMOOTH_ITERATIONS,
  DEFAULT_MINIATURE_SOURCE_RESOLUTION,
  DEFAULT_MINIATURE_TEXTURE_SIZE,
} from "../domain/meshBudget";

export type Character3dProvider = "pixal3d" | "trellis2";
export const DEFAULT_COMFY_UI_ENDPOINT = "http://127.0.0.1:8189";

export function resolveCharacterComfyEndpoint(value?: string): string {
  return value?.trim() || DEFAULT_COMFY_UI_ENDPOINT;
}

export interface CharacterWorkflowOptions {
  provider: Character3dProvider;
  targetFaces: number;
  /** Keeps generated baseplate and prop outputs separate from character files. */
  outputPrefix?: string;
  assetLabel?: string;
}

export interface CharacterGenerationProgress {
  stage: "workflow" | "upload" | "queued" | "generate" | "download" | "complete";
  message: string;
  percent: number;
  nodeTitle?: string;
  completedNodes?: number;
  totalNodes?: number;
  reportedByEngine?: boolean;
}

export function prepareCharacter3dWorkflow(
  workflow: ComfyWorkflow,
  upload: ComfyUpload,
  options: CharacterWorkflowOptions,
): ComfyWorkflow {
  const prepared = structuredClone(workflow);
  const entries = Object.entries(prepared);
  const nodes = entries.map(([, node]) => node);
  const providerPattern = options.provider === "pixal3d" ? /pixal\s*3d/i : /trellis\.?\s*2/i;
  const hasProvider = nodes.some((node) => providerPattern.test(`${node.class_type ?? ""} ${node._meta?.title ?? ""}`));
  if (!hasProvider) throw new Error(`This workflow does not contain native ${options.provider === "pixal3d" ? "Pixal3D" : "TRELLIS.2"} nodes`);

  const uploadedName = upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
  const targetFaces = clampMiniatureFaces(options.targetFaces);
  let imagePatched = 0;
  let exporterFound = false;
  const compactProxyId = entries.find(([, node]) => /remesh/i.test(node.class_type ?? ""))?.[0];
  for (const node of nodes) {
    const className = node.class_type?.toLowerCase() ?? "";
    const title = node._meta?.title?.toLowerCase() ?? "";
    if (node.inputs && className.includes("loadimage") && "image" in node.inputs) {
      node.inputs.image = uploadedName;
      imagePatched++;
    }
    if (!node.inputs) continue;
    if (/trellis2upsamplestage/i.test(className)) {
      for (const key of Object.keys(node.inputs)) {
        if (/target.*resolution/i.test(key) && typeof node.inputs[key] === "number") node.inputs[key] = DEFAULT_MINIATURE_SOURCE_RESOLUTION;
      }
    }
    if (/remesh/i.test(className)) {
      for (const key of Object.keys(node.inputs)) {
        if (/resolution/i.test(key) && typeof node.inputs[key] === "number") node.inputs[key] = DEFAULT_MINIATURE_REMESH_RESOLUTION;
        if (/smooth.*iter/i.test(key) && typeof node.inputs[key] === "number") node.inputs[key] = DEFAULT_MINIATURE_SMOOTH_ITERATIONS;
        if (/precluster.*(?:vert|point)/i.test(key) && typeof node.inputs[key] === "number") node.inputs[key] = DEFAULT_MINIATURE_PRECLUSTER_MAX_VERTICES;
      }
    }
    if (/baketexturefromvoxel/i.test(className) && compactProxyId && Array.isArray(node.inputs.reference_mesh)) {
      node.inputs.reference_mesh = [compactProxyId, 0];
    }
    if (/texture\s*size/i.test(title) || /bake.*texture/i.test(className)) {
      for (const key of Object.keys(node.inputs)) {
        if (/texture.*size|resolution/i.test(key) && typeof node.inputs[key] === "number") node.inputs[key] = DEFAULT_MINIATURE_TEXTURE_SIZE;
        if (/^(?:value|int)$/i.test(key) && /texture\s*size/i.test(title) && typeof node.inputs[key] === "number") node.inputs[key] = DEFAULT_MINIATURE_TEXTURE_SIZE;
      }
    }
    if (/save.*(glb|mesh)|export.*(glb|mesh)/i.test(`${className} ${title}`)) exporterFound = true;
    for (const key of Object.keys(node.inputs)) {
      if (/target.*(face|tri)|(?:face|tri).*count|max.*(face|tri)/i.test(key) && typeof node.inputs[key] === "number") {
        node.inputs[key] = targetFaces;
      }
      if (/filename_prefix/i.test(key) && typeof node.inputs[key] === "string" && /save|export/i.test(`${className} ${title}`)) {
        node.inputs[key] = options.outputPrefix ?? "dndrom/token";
      }
    }
  }
  if (imagePatched === 0) throw new Error("The workflow has no LoadImage node for the character drawing");
  if (!exporterFound) throw new Error("Add a native Save GLB/Save Mesh output node, then export the workflow in API format");
  return prepared;
}

export function selectGlbOutput(result: ComfyPromptResult): ComfyOutputFile {
  const output = [...result.outputs].reverse().find((entry) => entry.filename.toLowerCase().endsWith(".glb"));
  if (!output) throw new Error("ComfyUI completed without a GLB. Connect the generated mesh to a Save GLB output node.");
  return output;
}

export async function generateCharacterGlb(
  baseUrl: string,
  drawing: File,
  workflow: ComfyWorkflowPreset,
  options: CharacterWorkflowOptions,
  signal?: AbortSignal,
  onProgress?: (progress: CharacterGenerationProgress) => void,
): Promise<File> {
  const assetLabel = options.assetLabel?.trim() || "character";
  onProgress?.({ stage: "workflow", message: `Checking the included ${assetLabel} workflow…`, percent: 22 });
  const readiness = await materializeComfyWorkflow(baseUrl, configureCharacterPreset(workflow, options.provider, options.targetFaces));
  if (readiness.missingNodes.length) throw new Error(`Automatic local tool setup is incomplete. Retry Generate to resume it. Missing executable nodes: ${readiness.missingNodes.join(", ")}`);
  if (readiness.missingModels.length) throw new Error(`Automatic ${options.provider === "pixal3d" ? "Pixal3D" : "TRELLIS.2"} model setup did not finish. Retry Generate and DnDRom will resume it.`);
  if (!readiness.workflow) throw new Error("The included character workflow could not be prepared");
  onProgress?.({ stage: "upload", message: `Uploading the ${assetLabel} concept to private local ComfyUI…`, percent: 30 });
  const upload = await uploadComfyImage(baseUrl, drawing);
  const prepared = prepareCharacter3dWorkflow(readiness.workflow, upload, options);
  const providerName = options.provider === "pixal3d" ? "Pixal3D" : "TRELLIS.2";
  const clientId = crypto.randomUUID();
  let receivedEngineProgress = false;
  const monitor = monitorComfyWorkflow(baseUrl, clientId, prepared, (event) => {
    if (event.status === "error") return;
    receivedEngineProgress = true;
    onProgress?.({
      stage: "generate",
      message: event.nodeTitle ? `${providerName}: ${event.nodeTitle}` : `Running ${providerName} locally…`,
      percent: Math.round(38 + event.percent * .54),
      nodeTitle: event.nodeTitle,
      completedNodes: event.completedNodes,
      totalNodes: event.totalNodes,
      reportedByEngine: true,
    });
  });
  try {
    onProgress?.({ stage: "queued", message: `Starting ${providerName} on your GPU…`, percent: 36 });
    await monitor.ready;
    const promptId = await queueComfyWorkflow(baseUrl, prepared, clientId);
    monitor.setPromptId(promptId);
    const result = await waitForComfyPrompt(baseUrl, promptId, signal, () => {
      if (!receivedEngineProgress) onProgress?.({ stage: "generate", message: `Running ${providerName} locally…`, percent: 38 });
    });
    onProgress?.({ stage: "download", message: `Importing the textured ${assetLabel} GLB…`, percent: 94 });
    const file = await downloadComfyOutput(baseUrl, selectGlbOutput(result));
    onProgress?.({ stage: "complete", message: `${assetLabel[0].toUpperCase()}${assetLabel.slice(1)} generation complete`, percent: 100 });
    return file;
  } finally {
    monitor.close();
  }
}
