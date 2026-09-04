import { materializeComfyWorkflow, type ComfyWorkflowPreset } from "./comfyWorkflowPreset";
import { downloadComfyOutput, monitorComfyWorkflow, preparePanoramaWorkflow, queueComfyWorkflow, waitForComfyPrompt, type ComfyWorkflow } from "./splatKitClient";
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
    if (typeof node.inputs?.width === "number") node.inputs.width = 1024;
    if (typeof node.inputs?.height === "number") node.inputs.height = 1024;
    if (typeof node.inputs?.seed === "number") node.inputs.seed += index * 7919;
    if (typeof node.inputs?.noise_seed === "number") node.inputs.noise_seed += index * 7919;
    if (typeof node.inputs?.filename_prefix === "string") node.inputs.filename_prefix = `DnDRom/prop_reference_${index + 1}`;
  }
  return next;
};

export const preparePropImageWorkflow = (workflow: ComfyWorkflow, index: number): ComfyWorkflow => squareWorkflow(workflow, index);

export async function generateLocalPropCandidate(baseUrl: string, prompt: string, preset: ComfyWorkflowPreset, index: number, signal?: AbortSignal, onProgress?: (progress: PropImageProgress) => void): Promise<File> {
  onProgress?.({ message: "Preparing the local prop image workflow", percent: 8 });
  const readiness = await materializeComfyWorkflow(baseUrl, preset);
  if (readiness.missingNodes.length) throw new Error(`Local prop generation needs missing workflow nodes: ${readiness.missingNodes.join(", ")}`);
  if (readiness.missingModels.length) throw new Error("The selected local prop image pack is not installed yet");
  if (!readiness.workflow) throw new Error("The local prop image workflow could not be prepared");
  const workflow = preparePropImageWorkflow(preparePanoramaWorkflow(readiness.workflow, prompt), index);
  const clientId = crypto.randomUUID();
  const monitor = monitorComfyWorkflow(baseUrl, clientId, workflow, (event) => event.status !== "error" && onProgress?.({ message: event.nodeTitle ? `Image AI: ${event.nodeTitle}` : "Rendering reference candidate", percent: Math.min(88, Math.round(18 + event.percent * .68)), reportedByEngine: true }));
  try {
    await monitor.ready;
    const promptId = await queueComfyWorkflow(baseUrl, workflow, clientId);
    monitor.setPromptId(promptId);
    const result = await waitForComfyPrompt(baseUrl, promptId, signal);
    const output = [...result.outputs].reverse().find((entry) => /\.(png|jpe?g|webp)$/i.test(entry.filename));
    if (!output) throw new Error("The image workflow completed without a validated image output");
    const file = await downloadComfyOutput(baseUrl, output);
    if (!file.type.startsWith("image/") || file.size <= 0) throw new Error("The generated reference was not a valid image");
    onProgress?.({ message: "Reference candidate ready for review", percent: 100 });
    return file;
  } finally { monitor.close(); }
}

export async function generateHostedKreaCandidate(prompt: string, signal?: AbortSignal): Promise<File> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Hosted Krea generation is available only in the installed desktop app so its token stays in the Windows credential store");
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await invoke<number[]>("generate_krea_prop_image", { prompt });
  if (signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
  if (!blob.size) throw new Error("Krea completed without an image payload");
  return new File([blob], `krea-prop-${crypto.randomUUID()}.png`, { type: blob.type });
}
