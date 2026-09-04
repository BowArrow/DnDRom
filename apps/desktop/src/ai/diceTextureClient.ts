import { configureDiceTexturePreset, materializeComfyWorkflow, type ComfyWorkflowPreset } from "./comfyWorkflowPreset";
import { downloadComfyOutput, monitorComfyWorkflow, preparePanoramaWorkflow, queueComfyWorkflow, waitForComfyPrompt, type ComfyWorkflow } from "./splatKitClient";
import { harmonizeDiceAlbedoColor } from "../persistence/diceThemes";
import { diceTextureAiPrompt } from "../rendering/diceTextureTemplate";

export interface DiceTextureGenerationProgress {
  message: string;
  percent: number;
  reportedByEngine?: boolean;
}

const configureTextureResolution = (workflow: ComfyWorkflow): ComfyWorkflow => {
  const prepared = structuredClone(workflow);
  for (const node of Object.values(prepared)) {
    if (!node.inputs) continue;
    if (typeof node.inputs.width === "number" && typeof node.inputs.height === "number") {
      node.inputs.width = 1024;
      node.inputs.height = 512;
    }
    if (typeof node.inputs.filename_prefix === "string") node.inputs.filename_prefix = "DnDRom/dice_surface";
  }
  return prepared;
};

export async function generateLocalDiceAlbedo(
  baseUrl: string,
  description: string,
  bodyColor: string,
  panoramaPreset: ComfyWorkflowPreset,
  signal?: AbortSignal,
  onProgress?: (progress: DiceTextureGenerationProgress) => void,
): Promise<File> {
  onProgress?.({ message: "Preparing the included local texture workflow…", percent: 12 });
  const readiness = await materializeComfyWorkflow(baseUrl, configureDiceTexturePreset(panoramaPreset));
  if (readiness.missingNodes.length) throw new Error(`Local texture generation needs missing workflow nodes: ${readiness.missingNodes.join(", ")}`);
  if (readiness.missingModels.length) throw new Error("The local texture model setup did not finish. Retry and DnDRom will resume it.");
  if (!readiness.workflow) throw new Error("The included local texture workflow could not be prepared");
  const workflow = configureTextureResolution(preparePanoramaWorkflow(readiness.workflow, diceTextureAiPrompt(description, bodyColor)));
  const clientId = crypto.randomUUID();
  let receivedProgress = false;
  const monitor = monitorComfyWorkflow(baseUrl, clientId, workflow, (event) => {
    if (event.status === "error") return;
    receivedProgress = true;
    onProgress?.({ message: event.nodeTitle ? `Local texture AI: ${event.nodeTitle}` : "Generating the seamless dice surface…", percent: Math.round(22 + event.percent * .68), reportedByEngine: true });
  });
  try {
    onProgress?.({ message: "Starting the local texture model on your GPU…", percent: 20 });
    await monitor.ready;
    const promptId = await queueComfyWorkflow(baseUrl, workflow, clientId);
    monitor.setPromptId(promptId);
    const result = await waitForComfyPrompt(baseUrl, promptId, signal, () => {
      if (!receivedProgress) onProgress?.({ message: "Generating the seamless dice surface locally…", percent: 22 });
    });
    const output = [...result.outputs].reverse().find((entry) => /\.(png|jpe?g|webp)$/i.test(entry.filename));
    if (!output) throw new Error("The local texture workflow completed without an image output");
    onProgress?.({ message: "Converting the generated surface to the dice template…", percent: 92 });
    return await harmonizeDiceAlbedoColor(await downloadComfyOutput(baseUrl, output), bodyColor);
  } finally {
    monitor.close();
  }
}
