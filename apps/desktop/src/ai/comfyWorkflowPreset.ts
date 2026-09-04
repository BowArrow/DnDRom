import { assertLocalComfyUiEndpoint, type ComfyWorkflow } from "./splatKitClient";
import {
  clampMiniatureFaces,
  DEFAULT_MINIATURE_FACES,
  DEFAULT_MINIATURE_PRECLUSTER_MAX_VERTICES,
  DEFAULT_MINIATURE_REMESH_RESOLUTION,
  DEFAULT_MINIATURE_SMOOTH_ITERATIONS,
  DEFAULT_MINIATURE_SOURCE_RESOLUTION,
  DEFAULT_MINIATURE_TEXTURE_SIZE,
} from "../domain/meshBudget";

export interface ComfyUiNode {
  id: number;
  type: string;
  title?: string;
  mode?: number;
  inputs?: { name: string; type?: string; link?: number | null; widget?: { name?: string } }[];
  outputs?: { name?: string; type?: string; links?: number[] | null }[];
  widgets_values?: unknown[];
  properties?: Record<string, unknown>;
}

export interface ComfyUiWorkflow {
  nodes: ComfyUiNode[];
  links: [number, number, number, number, number, string][];
  [key: string]: unknown;
}

export type ComfyWorkflowPreset = ComfyWorkflow | ComfyUiWorkflow;

export interface ComfyNodeDefinition {
  input?: {
    required?: Record<string, [unknown, Record<string, unknown>?]>;
    optional?: Record<string, [unknown, Record<string, unknown>?]>;
  };
  output_node?: boolean;
}

export interface ComfyPresetReadiness {
  workflow: ComfyWorkflow | null;
  missingNodes: string[];
  missingModels: string[];
}

const isUiWorkflow = (value: ComfyWorkflowPreset): value is ComfyUiWorkflow => Array.isArray((value as ComfyUiWorkflow).nodes);
const endpoint = (base: string, path: string): string => `${assertLocalComfyUiEndpoint(base)}${path}`;
const FRONTEND_ONLY_NODE_TYPES = new Set(["Note", "MarkdownNote"]);
const PASSTHROUGH_NODE_TYPES = new Set(["Reroute"]);

const isExecutableNode = (node: ComfyUiNode): boolean =>
  (node.mode ?? 0) === 0 && !FRONTEND_ONLY_NODE_TYPES.has(node.type) && !PASSTHROUGH_NODE_TYPES.has(node.type);

export async function loadBundledWorkflow(path: string): Promise<ComfyWorkflowPreset> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Bundled workflow is unavailable (${response.status})`);
  const value = await response.json() as ComfyWorkflowPreset;
  if (!value || typeof value !== "object") throw new Error("Bundled workflow is invalid");
  return value;
}

const coerceWidgetValue = (value: unknown, schema: unknown): { found: boolean; value?: unknown } => {
  if (Array.isArray(schema)) {
    if (schema.includes(value)) return { found: true, value };
    if (typeof value === "string" && value.trim() !== "") {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && schema.includes(numeric)) return { found: true, value: numeric };
    }
    return { found: typeof value === "string" || typeof value === "number", value };
  }
  if (schema === "INT" || schema === "FLOAT" || schema === "NUMBER") {
    if (typeof value === "number" && Number.isFinite(value)) return { found: true, value };
    if (typeof value === "string" && value.trim() !== "") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return { found: true, value: numeric };
    }
    return { found: false };
  }
  if (schema === "BOOLEAN") return { found: typeof value === "boolean", value };
  if (["STRING", "COMBO", "COMFY_DYNAMICCOMBO_V3", "COLOR", "LOAD_3D"].includes(String(schema))) return { found: typeof value === "string", value };
  return { found: false };
};

const isWidgetSchema = (schema: unknown, config?: Record<string, unknown>): boolean => {
  if (config?.forceInput === true) return false;
  if (config?.socketless === true || Array.isArray(config?.options)) return true;
  return Array.isArray(schema) || ["INT", "FLOAT", "NUMBER", "BOOLEAN", "STRING", "COMBO", "COMFY_DYNAMICCOMBO_V3", "COLOR", "LOAD_3D"].includes(String(schema));
};

const normalizedInputName = (name: string): string => name.toLowerCase().replace(/s$/, "");
const bundleName = (node: ComfyUiNode): string => node.type === "Bundle" && typeof node.widgets_values?.[0] === "string" ? node.widgets_values[0].trim() : "";
const unbundleSourceName = (node: ComfyUiNode): string => node.type === "UnbundleByName"
  ? [...(node.widgets_values ?? [])].reverse().find((value): value is string => typeof value === "string" && value.trim() !== "" && !value.trim().startsWith("{"))?.trim() ?? ""
  : "";
const selectedSplatKitInput = (node: ComfyUiNode): string | null => node.type === "SplatKit_Switch"
  ? node.widgets_values?.[0] === false ? "image_b" : "image_a"
  : null;

const apiInputDefinitions = (definition: ComfyNodeDefinition | undefined): [string, [unknown, Record<string, unknown>?]][] => [
  ...Object.entries(definition?.input?.required ?? {}),
  ...Object.entries(definition?.input?.optional ?? {}),
];

export function convertComfyUiWorkflow(workflow: ComfyUiWorkflow, definitions: Record<string, ComfyNodeDefinition>): ComfyPresetReadiness {
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const links = new Map(workflow.links.map((link) => [link[0], link]));
  const outputRoots = workflow.nodes.filter((node) => isExecutableNode(node) && definitions[node.type]?.output_node).map((node) => node.id);
  const relevantNodes = new Set<number>();
  const visitDependencies = (nodeId: number): void => {
    if (relevantNodes.has(nodeId)) return;
    const node = nodes.get(nodeId);
    if (!node || ((node.mode ?? 0) !== 0 && (node.mode ?? 0) !== 4)) return;
    relevantNodes.add(nodeId);
    const selectedSwitchInput = selectedSplatKitInput(node);
    for (const input of node.inputs ?? []) {
      if (selectedSwitchInput && input.name !== selectedSwitchInput) continue;
      if (input.link == null) continue;
      const link = links.get(input.link);
      if (link) visitDependencies(link[1]);
    }
    const virtualBundleName = unbundleSourceName(node);
    if (virtualBundleName) {
      const bundle = workflow.nodes.find((candidate) => bundleName(candidate) === virtualBundleName);
      if (bundle) visitDependencies(bundle.id);
    }
  };
  if (outputRoots.length) outputRoots.forEach(visitDependencies);
  else workflow.nodes.forEach((node) => { if (isExecutableNode(node)) relevantNodes.add(node.id); });
  const relevantExecutable = (node: ComfyUiNode): boolean => relevantNodes.has(node.id) && isExecutableNode(node);
  const missingNodes = [...new Set(workflow.nodes.filter((node) => relevantExecutable(node) && !definitions[node.type]).map((node) => node.type))].sort();
  if (missingNodes.length) return { workflow: null, missingNodes, missingModels: [] };

  const resolveOrigin = (nodeId: number, slot: number, seen = new Set<number>()): [string, number] | null => {
    if (seen.has(nodeId)) return null;
    seen.add(nodeId);
    const node = nodes.get(nodeId);
    if (!node) return null;
    const isPassthrough = (node.mode ?? 0) === 4 || PASSTHROUGH_NODE_TYPES.has(node.type);
    if (!isPassthrough) return [String(nodeId), slot];
    const output = node.outputs?.[slot];
    const candidates = node.inputs?.filter((input) => input.link != null && (
      PASSTHROUGH_NODE_TYPES.has(node.type) || !output?.type || !input.type || input.type === "*" || output.type === "*" || input.type === output.type
    )) ?? [];
    const input = candidates[slot] ?? candidates[0];
    const link = input?.link == null ? null : links.get(input.link);
    return link ? resolveOrigin(link[1], link[2], seen) : null;
  };

  const api: ComfyWorkflow = {};
  const missingModels = new Set<string>();
  for (const node of workflow.nodes) {
    if (!relevantExecutable(node)) continue;
    const definition = definitions[node.type];
    if (!definition) continue;
    const inputSockets = new Map((node.inputs ?? []).map((input) => [input.name, input]));
    const socketFor = (name: string) => inputSockets.get(name) ?? [...inputSockets.values()].find((input) => normalizedInputName(input.name) === normalizedInputName(name));
    const originalWidgetValues = [...(node.widgets_values ?? [])];
    const sourceBundleName = unbundleSourceName(node);
    const widgetValues = sourceBundleName
      ? [sourceBundleName, originalWidgetValues.find((value) => typeof value === "string" && value.trim().startsWith("{")) ?? "{}"]
      : originalWidgetValues;
    let widgetIndex = 0;
    const inputs: Record<string, unknown> = {};
    for (const [name, [schema, config]] of apiInputDefinitions(definition)) {
      const socket = socketFor(name);
      let widgetValue: unknown = undefined;
      if (isWidgetSchema(schema, config)) {
        while (widgetIndex < widgetValues.length) {
          const coerced = coerceWidgetValue(widgetValues[widgetIndex], schema);
          widgetIndex++;
          if (coerced.found) { widgetValue = coerced.value; break; }
        }
      }
      if (socket?.link != null) {
        const link = links.get(socket.link);
        const origin = link ? resolveOrigin(link[1], link[2]) : null;
        if (origin) inputs[name] = origin;
      } else if (widgetValue !== undefined) {
        inputs[name] = widgetValue;
        if (Array.isArray(schema) && !schema.includes(widgetValue) && /\.(safetensors|ckpt|pt|pth|gguf)$/i.test(String(widgetValue))) missingModels.add(String(widgetValue));
      } else if (config && "default" in config) inputs[name] = config.default;

      const selectedSwitchInput = selectedSplatKitInput(node);
      if (selectedSwitchInput && name !== "select" && name !== selectedSwitchInput) {
        const selectedSocket = socketFor(selectedSwitchInput);
        const selectedLink = selectedSocket?.link == null ? null : links.get(selectedSocket.link);
        const selectedOrigin = selectedLink ? resolveOrigin(selectedLink[1], selectedLink[2]) : null;
        if (selectedOrigin) inputs[name] = selectedOrigin;
      }

      if (node.type === "UnbundleByName" && name === "bundle" && sourceBundleName) {
        const bundle = workflow.nodes.find((candidate) => bundleName(candidate) === sourceBundleName);
        if (bundle) inputs[name] = [String(bundle.id), 0];
      }

      if (schema === "COMFY_DYNAMICCOMBO_V3" && typeof widgetValue === "string" && Array.isArray(config?.options)) {
        const selected = (config.options as { key?: string; inputs?: ComfyNodeDefinition["input"] }[]).find((option) => option.key === widgetValue);
        for (const [nestedName, [nestedSchema, nestedConfig]] of apiInputDefinitions({ input: selected?.inputs })) {
          let nestedValue: unknown = undefined;
          while (widgetIndex < widgetValues.length) {
            const coerced = coerceWidgetValue(widgetValues[widgetIndex], nestedSchema);
            widgetIndex++;
            if (coerced.found) { nestedValue = coerced.value; break; }
          }
          const dynamicPath = `${name}.${nestedName}`;
          if (nestedValue !== undefined) inputs[dynamicPath] = nestedValue;
          else if (nestedConfig && "default" in nestedConfig) inputs[dynamicPath] = nestedConfig.default;
        }
      }
    }
    api[String(node.id)] = { class_type: node.type, inputs, _meta: { title: node.title ?? String(node.properties?.["Node name for S&R"] ?? node.type) } };
  }
  return { workflow: api, missingNodes: [], missingModels: [...missingModels].sort() };
}

export async function materializeComfyWorkflow(baseUrl: string, preset: ComfyWorkflowPreset): Promise<ComfyPresetReadiness> {
  if (!isUiWorkflow(preset)) return { workflow: structuredClone(preset), missingNodes: [], missingModels: [] };
  const normalized = assertLocalComfyUiEndpoint(baseUrl);
  let response: Response;
  try {
    response = await fetch(`${normalized}/object_info`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error("DnDRom could not start its private local creation engine. Retry Generate; if it still fails, the setup log will contain the cause.");
  }
  if (!response.ok) throw new Error(`ComfyUI returned ${response.status} while checking the bundled workflow`);
  return convertComfyUiWorkflow(preset, await response.json() as Record<string, ComfyNodeDefinition>);
}

function rewireDenseBakeReferenceToCompactProxy(workflow: ComfyUiWorkflow): void {
  const proxy = workflow.nodes.find((node) => node.type === "RemeshMesh");
  if (!proxy) return;
  const proxyOutputIndex = Math.max(0, proxy.outputs?.findIndex((output) => String(output.type ?? "").includes("MESH")) ?? 0);
  for (const bake of workflow.nodes.filter((node) => node.type === "BakeTextureFromVoxel")) {
    const referenceInput = bake.inputs?.find((input) => input.name === "reference_mesh");
    if (referenceInput?.link == null) continue;
    const link = workflow.links.find((candidate) => candidate[0] === referenceInput.link);
    if (!link || link[1] === proxy.id) continue;
    const previousSource = workflow.nodes.find((node) => node.id === link[1]);
    for (const output of previousSource?.outputs ?? []) {
      if (output.links) output.links = output.links.filter((linkId) => linkId !== referenceInput.link);
    }
    link[1] = proxy.id;
    link[2] = proxyOutputIndex;
    const proxyOutput = proxy.outputs?.[proxyOutputIndex];
    if (proxyOutput) proxyOutput.links = [...new Set([...(proxyOutput.links ?? []), referenceInput.link])];
  }
}

export function configureCharacterPreset(preset: ComfyWorkflowPreset, provider: "pixal3d" | "trellis2", targetFaces = DEFAULT_MINIATURE_FACES): ComfyWorkflowPreset {
  const configured = JSON.parse(JSON.stringify(preset).replaceAll(
    "moge-2-vitl-normal_fp16.safetensors",
    "moge_2_vitl_normal_fp16.safetensors",
  )) as ComfyWorkflowPreset;
  if (!isUiWorkflow(configured)) return configured;
  for (const node of configured.nodes) {
    if (["Preview3DAdvanced", "PreviewImage", "PreviewAny", "MaskPreview"].includes(node.type)
      && !(node.outputs ?? []).some((output) => output.links?.length)) node.mode = 2;
    if (node.type === "Pixal3DConditioning") node.mode = provider === "pixal3d" ? 0 : 4;
    if (node.type === "Trellis2Conditioning") node.mode = provider === "trellis2" ? 0 : 4;
    if (node.type === "SaveGLB") node.mode = 0;
    if (node.type === "UNETLoader" && node.widgets_values) node.widgets_values[0] = provider === "pixal3d" ? "pixal3d_int8_convrot.safetensors" : "trellis_2_int8_convrot.safetensors";
    if (node.type === "CLIPVisionLoader" && node.widgets_values) node.widgets_values[0] = provider === "pixal3d" ? "dino_v3_L_naf_fp32.safetensors" : "dino_v3_vit_l.safetensors";
    if (/^(?:DecimateMesh|MeshDecimate)$/i.test(node.type) && node.widgets_values) node.widgets_values[0] = clampMiniatureFaces(targetFaces);
    if (node.type === "Trellis2UpsampleStage" && node.widgets_values) node.widgets_values[0] = DEFAULT_MINIATURE_SOURCE_RESOLUTION;
    if (node.type === "RemeshMesh" && node.widgets_values) {
      node.widgets_values[0] = DEFAULT_MINIATURE_REMESH_RESOLUTION;
      if (node.widgets_values.length > 8) node.widgets_values[8] = DEFAULT_MINIATURE_SMOOTH_ITERATIONS;
      if (node.widgets_values.length > 10) node.widgets_values[10] = DEFAULT_MINIATURE_PRECLUSTER_MAX_VERTICES;
    }
    if (node.type === "PrimitiveInt" && /texture\s*size/i.test(node.title ?? "") && node.widgets_values) {
      node.widgets_values[0] = DEFAULT_MINIATURE_TEXTURE_SIZE;
    }
  }
  rewireDenseBakeReferenceToCompactProxy(configured);
  return configured;
}

export function configurePanoramaPreset(preset: ComfyWorkflowPreset): ComfyWorkflowPreset {
  const serialized = JSON.stringify(preset)
    .replaceAll("img-txt-2-360_v01_KREA2_000002500.safetensors", "krea2_t2i_360_erp_lora_v1.safetensors")
    .replaceAll("RealESRGAN_x2.pth", "4x-UltraSharp.pth");
  return JSON.parse(serialized) as ComfyWorkflowPreset;
}

/** Dice need one seamless material image, not panorama seam repair and tiled AI upscaling. */
export function configureDiceTexturePreset(preset: ComfyWorkflowPreset): ComfyWorkflowPreset {
  const configured = configurePanoramaPreset(preset);
  if (!isUiWorkflow(configured)) return configured;
  const output = configured.nodes.find((node) => node.type === "PreviewImage" && /path a:\s*raw pano/i.test(node.title ?? ""));
  if (!output) return configured;
  for (const node of configured.nodes) {
    if (["PreviewImage", "SaveImage"].includes(node.type)) node.mode = node.id === output.id ? 0 : 2;
    if (["EmptyLatentImage", "EmptySD3LatentImage"].includes(node.type) && node.widgets_values) {
      node.widgets_values[0] = 1024;
      node.widgets_values[1] = 512;
    }
  }
  output.type = "SaveImage";
  output.title = "DnDRom dice surface output";
  output.widgets_values = ["DnDRom/dice_surface"];
  return configured;
}
