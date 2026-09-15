import { materializeComfyWorkflow, type ComfyWorkflowPreset } from "./comfyWorkflowPreset";
import { cancelComfyPrompt, downloadComfyOutput, monitorComfyWorkflow, preparePanoramaWorkflow, queueComfyWorkflow, uploadComfyImage, waitForComfyPrompt, type ComfyWorkflow, type ComfyUpload } from "./splatKitClient";
import type { LocalRuntimeFeature } from "./localRuntime";

export interface PropImageProgress { message: string; percent: number; reportedByEngine?: boolean }
export type PropImageProvider = "sana-local" | "krea-local" | "krea-cloud";
export const resolvePropImageRoute = (provider: PropImageProvider): { hosted: boolean; feature?: LocalRuntimeFeature; workflow?: string } => provider === "krea-cloud"
  ? { hosted: true }
  : provider === "krea-local" ? { hosted: false, feature: "propImageKrea", workflow: "/workflows/prop-krea-reference.json" }
  : { hosted: false, feature: "propImageLite", workflow: "/workflows/prop-sana-reference.json" };

const squareWorkflow = (workflow: ComfyWorkflow, index: number): ComfyWorkflow => {
  const next = structuredClone(workflow);
  for (const node of Object.values(next)) {
    // ComfyUI_ExtraModels' EmptySanaLatentImage currently dereferences an
    // uninitialised `self.device`. The bundled DC-AE latent node produces the
    // same 32-channel Sana latent while selecting ComfyUI's intermediate
    // device correctly. Rewrite legacy/cached presets as well as shipping the
    // corrected workflow so an older graph cannot revive the failure.
    if (node.class_type === "EmptySanaLatentImage") node.class_type = "EmptyDCAELatentImage";
    if (node.class_type === "ExtraVAELoader" && node.inputs?.vae_name === "dc-ae-f32c32-sana-1.1.safetensors") node.inputs.vae_name = "dc-ae-f32c32-sana-1.1-diffusers.safetensors";
    // This encoder is outside ComfyUI's model eviction manager. Keeping its
    // 5 GB of weights on the GPU prevents Sana's plain convolution layers from
    // being loaded on common 8–12 GB cards alongside the scene renderer.
    if (node.class_type === "GemmaLoader" && node.inputs) { node.inputs.device = "cpu"; node.inputs.dtype = "FP32"; }
    if (typeof node.inputs?.width === "number") node.inputs.width = 1024;
    if (typeof node.inputs?.height === "number") node.inputs.height = 1024;
    if (typeof node.inputs?.seed === "number") node.inputs.seed += index * 7919;
    if (typeof node.inputs?.noise_seed === "number") node.inputs.noise_seed += index * 7919;
    if (typeof node.inputs?.filename_prefix === "string") node.inputs.filename_prefix = `DnDRom/prop_reference_${index + 1}`;
  }
  return next;
};

export const preparePropImageWorkflow = (workflow: ComfyWorkflow, index: number): ComfyWorkflow => squareWorkflow(workflow, index);

export function conditionPropWorkflow(workflow: ComfyWorkflow, upload: ComfyUpload, strength = .78): ComfyWorkflow {
  const result = structuredClone(workflow);
  const decoder = Object.values(result).find((node) => node.class_type === "VAEDecode");
  const sampler = Object.values(result).find((node) => node.class_type === "KSampler");
  if (!decoder?.inputs?.vae || !sampler?.inputs) throw new Error("This image workflow does not support reference conditioning");
  const prefix = `reference_${crypto.randomUUID()}`;
  result[`${prefix}_image`] = { class_type: "LoadImage", inputs: { image: upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name } };
  result[`${prefix}_scale`] = { class_type: "ImageScale", inputs: { image: [`${prefix}_image`, 0], upscale_method: "lanczos", width: 1024, height: 1024, crop: "center" } };
  result[`${prefix}_encode`] = { class_type: "VAEEncode", inputs: { pixels: [`${prefix}_scale`, 0], vae: decoder.inputs.vae } };
  sampler.inputs.latent_image = [`${prefix}_encode`, 0]; sampler.inputs.denoise = Math.max(.45, Math.min(.95, strength));
  return result;
}

export async function generateLocalPropCandidate(baseUrl: string, prompt: string, preset: ComfyWorkflowPreset, index: number, signal?: AbortSignal, onProgress?: (progress: PropImageProgress) => void, reference?: File, surfaceOnly = false, conditioning?: { strength: number; negativePrompt?: string }): Promise<File> {
  signal?.throwIfAborted();
  onProgress?.({ message: "Preparing the local prop image workflow", percent: 8 });
  const readiness = await materializeComfyWorkflow(baseUrl, preset);
  if (readiness.missingNodes.length) throw new Error(`Local prop generation needs missing workflow nodes: ${readiness.missingNodes.join(", ")}`);
  if (readiness.missingModels.length) throw new Error("The selected local prop image pack is not installed yet");
  if (!readiness.workflow) throw new Error("The local prop image workflow could not be prepared");
  let workflow = preparePropImageWorkflow(preparePanoramaWorkflow(readiness.workflow, prompt), index);
  if (surfaceOnly) for (const node of Object.values(workflow)) {
    if (/negative/i.test(node._meta?.title ?? "") && typeof node.inputs?.text === "string") node.inputs.text = "building, house, temple, village, landscape, sky, horizon, perspective view, object, people, border, text, letters, dramatic lighting, cast shadow, vignette";
  }
  if (conditioning?.negativePrompt) for (const node of Object.values(workflow)) {
    if (/negative/i.test(node._meta?.title ?? "") && typeof node.inputs?.text === "string") node.inputs.text = conditioning.negativePrompt;
  }
  if (reference) workflow = conditionPropWorkflow(workflow, await uploadComfyImage(baseUrl, reference), conditioning?.strength ?? .78);
  signal?.throwIfAborted();
  const clientId = crypto.randomUUID();
  const monitor = monitorComfyWorkflow(baseUrl, clientId, workflow, (event) => event.status !== "error" && onProgress?.({ message: event.nodeTitle ? `Image AI: ${event.nodeTitle}` : "Rendering reference candidate", percent: Math.min(88, Math.round(18 + event.percent * .68)), reportedByEngine: true }));
  let promptId: string | undefined;
  const cancel = () => { if (promptId) void cancelComfyPrompt(baseUrl, promptId); };
  try {
    await monitor.ready;
    signal?.throwIfAborted();
    promptId = await queueComfyWorkflow(baseUrl, workflow, clientId);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) { cancel(); signal.throwIfAborted(); }
    monitor.setPromptId(promptId);
    const result = await waitForComfyPrompt(baseUrl, promptId, signal);
    const output = [...result.outputs].reverse().find((entry) => /\.(png|jpe?g|webp)$/i.test(entry.filename));
    if (!output) throw new Error("The image workflow completed without a validated image output");
    const file = await downloadComfyOutput(baseUrl, output);
    if (!file.type.startsWith("image/") || file.size <= 0) throw new Error("The generated reference was not a valid image");
    onProgress?.({ message: "Reference candidate ready for review", percent: 100 });
    return file;
  } finally { signal?.removeEventListener("abort", cancel); monitor.close(); }
}

export async function generateHostedKreaCandidate(prompt: string, signal?: AbortSignal): Promise<File> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Hosted Krea generation is available only in the installed desktop app so its token stays in the Windows credential store");
  const { invoke } = await import("../platform/desktop");
  const bytes = await invoke<number[]>("generate_krea_prop_image", { prompt });
  if (signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
  if (!blob.size) throw new Error("Krea completed without an image payload");
  return new File([blob], `krea-prop-${crypto.randomUUID()}.png`, { type: blob.type });
}
