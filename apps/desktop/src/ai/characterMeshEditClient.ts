import { downloadComfyOutput, monitorComfyWorkflow, queueComfyWorkflow, uploadComfyImage, waitForComfyPrompt, type ComfyOutputFile, type ComfyUpload, type ComfyWorkflow } from "./splatKitClient";

export interface CharacterMeshEditProgress {
  message: string;
  percent: number;
  reportedByEngine?: boolean;
}

const safeName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "character-style";
const uploadPath = (upload: ComfyUpload): string => upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;

/** Hunyuan3D Paint changes the PBR surface while keeping the uploaded mesh topology. */
export function createCharacterMeshPaintWorkflow(mesh: ComfyUpload, reference: ComfyUpload, name: string): ComfyWorkflow {
  return {
    "1": { class_type: "LoadImage", inputs: { image: uploadPath(reference) }, _meta: { title: "Load edited style reference" } },
    "2": { class_type: "[Comfy3D] Load Hunyuan3D 21 TexGen Pipeline", inputs: { max_num_view: 6, resolution: 512, force_cuda_rasterize: true }, _meta: { title: "Load local mesh paint model" } },
    "3": { class_type: "[Comfy3D] Hunyuan3D 21 TexGen", inputs: { texgen_pipe: ["2", 0], image: ["1", 0], mesh_path: uploadPath(mesh), use_remesh: false, force_cuda_rasterize: true }, _meta: { title: "Paint the existing miniature mesh" } },
    "4": { class_type: "[Comfy3D] Save 3D Mesh", inputs: { mesh: ["3", 0], save_path: `dndrom_styles/${safeName(name)}.glb` }, _meta: { title: "Save nondestructive GLB revision" } },
  };
}

const selectGlb = (values: string[]): ComfyOutputFile => {
  const path = [...values].reverse().find((value) => /\.glb$/i.test(value.trim()));
  if (!path) throw new Error("Mesh painting completed without a downloadable GLB revision");
  const normalized = path.trim().replaceAll("\\", "/");
  const parts = normalized.split("/");
  return { filename: parts.pop() || "character-style.glb", subfolder: parts.slice(-1)[0] === "dndrom_styles" ? "dndrom_styles" : "", type: "output" };
};

export async function paintExistingCharacterMesh(baseUrl: string, model: File, reference: File, name: string, signal?: AbortSignal, onProgress?: (progress: CharacterMeshEditProgress) => void): Promise<File> {
  onProgress?.({ message: "Uploading the current miniature and edited style reference...", percent: 5 });
  const [meshUpload, referenceUpload] = await Promise.all([uploadComfyImage(baseUrl, model), uploadComfyImage(baseUrl, reference)]);
  const workflow = createCharacterMeshPaintWorkflow(meshUpload, referenceUpload, name);
  const clientId = crypto.randomUUID();
  let lastPercent = 12;
  const monitor = monitorComfyWorkflow(baseUrl, clientId, workflow, (event) => {
    if (event.status !== "error") {
      lastPercent = Math.round(12 + event.percent * .76);
      onProgress?.({ message: event.nodeTitle ? `3D edit: ${event.nodeTitle}` : "Painting the existing mesh...", percent: lastPercent, reportedByEngine: true });
    }
  });
  try {
    await monitor.ready;
    const promptId = await queueComfyWorkflow(baseUrl, workflow, clientId);
    monitor.setPromptId(promptId);
    const result = await waitForComfyPrompt(baseUrl, promptId, signal, () => {
      onProgress?.({ message: "The local mesh painter is still processing this revision...", percent: Math.min(92, Math.max(14, lastPercent)) });
    }, 45 * 60_000);
    onProgress?.({ message: "Importing the preserved-geometry GLB revision...", percent: 94 });
    return await downloadComfyOutput(baseUrl, selectGlb(result.outputTexts));
  } finally {
    monitor.close();
  }
}
