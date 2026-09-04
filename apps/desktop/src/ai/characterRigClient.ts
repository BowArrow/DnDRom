import { downloadComfyOutput, monitorComfyWorkflow, queueComfyWorkflow, uploadComfyImage, waitForComfyPrompt, type ComfyOutputFile, type ComfyUpload, type ComfyWorkflow } from "./splatKitClient";

export type CharacterRigProfile = "humanoid" | "creature";

export interface CharacterRigProgress {
  message: string;
  percent: number;
  reportedByEngine?: boolean;
}

const safeName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "miniature";

export function createCharacterRigWorkflow(upload: ComfyUpload, name: string, profile: CharacterRigProfile): ComfyWorkflow {
  const filePath = upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
  const load = { class_type: "UniRigLoadMesh", inputs: { source_folder: "input", file_path: filePath }, _meta: { title: "Load generated miniature" } };
  if (profile === "humanoid") return {
    "1": load,
    "2": { class_type: "MIALoadModel", inputs: { precision: "auto", attn_backend: "auto" }, _meta: { title: "Load fast humanoid rigger" } },
    "3": { class_type: "MIAAutoRig", inputs: { trimesh: ["1", 0], model: ["2", 0], fbx_name: safeName(name), no_fingers: true, use_normal: false, reset_to_rest: true }, _meta: { title: "Auto-rig humanoid" } },
    "4": { class_type: "UniRigPreviewRiggedMesh", inputs: { fbx_output_path: ["3", 0] }, _meta: { title: "Save rigged miniature" } },
  };
  return {
    "1": load,
    "2": { class_type: "UniRigLoadModel", inputs: { precision: "auto", attn_backend: "auto" }, _meta: { title: "Load general creature rigger" } },
    "3": { class_type: "UniRigAutoRig", inputs: { trimesh: ["1", 0], model: ["2", 0], skeleton_template: "articulationxl", fbx_name: safeName(name), target_face_count: 20_000 }, _meta: { title: "Auto-rig creature" } },
    "4": { class_type: "UniRigPreviewRiggedMesh", inputs: { fbx_output_path: ["3", 0] }, _meta: { title: "Save rigged miniature" } },
  };
}

const selectFbxOutput = (texts: string[]): ComfyOutputFile => {
  const path = [...texts].reverse().find((value) => /\.fbx$/i.test(value.trim()));
  if (!path) throw new Error("Auto-rig completed without a downloadable FBX");
  const normalized = path.trim().replaceAll("\\", "/");
  return { filename: normalized.split("/").pop() || "rigged-miniature.fbx", subfolder: "", type: "output" };
};

export async function autoRigCharacter(
  baseUrl: string,
  model: File,
  name: string,
  profile: CharacterRigProfile,
  signal?: AbortSignal,
  onProgress?: (progress: CharacterRigProgress) => void,
): Promise<File> {
  onProgress?.({ message: "Sending the GLB to the private auto-rigger…", percent: 8 });
  const upload = await uploadComfyImage(baseUrl, model);
  const workflow = createCharacterRigWorkflow(upload, name, profile);
  const clientId = crypto.randomUUID();
  const monitor = monitorComfyWorkflow(baseUrl, clientId, workflow, (event) => {
    if (event.status !== "error") onProgress?.({ message: event.nodeTitle ? `Auto-rig: ${event.nodeTitle}` : "Building the skeleton and skin weights…", percent: Math.round(15 + event.percent * .72), reportedByEngine: true });
  });
  try {
    await monitor.ready;
    const promptId = await queueComfyWorkflow(baseUrl, workflow, clientId);
    monitor.setPromptId(promptId);
    const result = await waitForComfyPrompt(baseUrl, promptId, signal);
    onProgress?.({ message: "Importing the Mixamo-compatible rig…", percent: 94 });
    return await downloadComfyOutput(baseUrl, selectFbxOutput(result.outputTexts));
  } finally {
    monitor.close();
  }
}
