import { downloadComfyOutput, monitorComfyWorkflow, queueComfyWorkflow, uploadComfyImage, waitForComfyPrompt, type ComfyOutputFile, type ComfyUpload, type ComfyWorkflow } from "./splatKitClient";

export interface CharacterMotionProgress {
  message: string;
  percent: number;
  reportedByEngine?: boolean;
}

const safeName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "motion";

export function createCharacterMotionWorkflow(rig: ComfyUpload, prompt: string, name: string, duration = 2.5, seed = Math.floor(Math.random() * 2_147_483_647)): ComfyWorkflow {
  const path = rig.subfolder ? `${rig.subfolder}/${rig.name}` : rig.name;
  return {
    "1": { class_type: "HYMotionLoadNetwork", inputs: { model_name: "HY-Motion-1.0-Lite" }, _meta: { title: "Load HY-Motion Lite" } },
    "2": { class_type: "HYMotionLoadLLM", inputs: { model_name: "Qwen3-0.6B", quantization: "int8", offload_to_cpu: true }, _meta: { title: "Load motion language encoder with CPU offload" } },
    "3": { class_type: "HYMotionEncodeText", inputs: { llm: ["2", 0], text: prompt.trim() }, _meta: { title: "Interpret player motion description" } },
    "4": { class_type: "HYMotionGenerate", inputs: { network: ["1", 0], conditioning: ["3", 0], duration: Math.min(12, Math.max(.5, duration)), seed, cfg_scale: 5, num_samples: 1 }, _meta: { title: "Generate skeletal motion" } },
    "5": { class_type: "HYMotionExportFBX", inputs: { motion_data: ["4", 0], output_dir: "dndrom_motion", filename_prefix: safeName(name), custom_fbx_path: path, yaw_offset: 0, scale: 0 }, _meta: { title: "Retarget motion to miniature" } },
  };
}

const selectMotionOutput = (texts: string[]): ComfyOutputFile => {
  const path = [...texts].reverse().find((value) => /\.fbx$/i.test(value.trim()));
  if (!path) throw new Error("Motion generation finished without a downloadable retargeted FBX");
  const normalized = path.trim().replaceAll("\\", "/");
  const parts = normalized.split("/");
  return { filename: parts.pop() || "character-motion.fbx", subfolder: parts.at(-1) === "dndrom_motion" ? "dndrom_motion" : "", type: "output" };
};

export async function generateCharacterMotion(baseUrl: string, rig: File, prompt: string, name: string, duration: number, signal?: AbortSignal, onProgress?: (progress: CharacterMotionProgress) => void): Promise<File> {
  if (!prompt.trim()) throw new Error("Describe the character motion first");
  onProgress?.({ message: "Uploading the Mixamo-compatible rig...", percent: 6 });
  const upload = await uploadComfyImage(baseUrl, rig);
  const workflow = createCharacterMotionWorkflow(upload, prompt, name, duration);
  const clientId = crypto.randomUUID();
  const monitor = monitorComfyWorkflow(baseUrl, clientId, workflow, (event) => {
    if (event.status !== "error") onProgress?.({ message: event.nodeTitle ? `Animation: ${event.nodeTitle}` : "Generating and retargeting motion...", percent: Math.round(12 + event.percent * .78), reportedByEngine: true });
  });
  try {
    await monitor.ready;
    const promptId = await queueComfyWorkflow(baseUrl, workflow, clientId);
    monitor.setPromptId(promptId);
    const result = await waitForComfyPrompt(baseUrl, promptId, signal);
    onProgress?.({ message: "Importing the retargeted animation...", percent: 94 });
    return await downloadComfyOutput(baseUrl, selectMotionOutput(result.outputTexts));
  } finally {
    monitor.close();
  }
}
