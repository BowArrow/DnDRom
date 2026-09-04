import {
  downloadComfyOutput,
  listComfyCheckpoints,
  monitorComfyWorkflow,
  queueComfyWorkflow,
  uploadComfyImage,
  waitForComfyPrompt,
  type ComfyUpload,
  type ComfyWorkflow,
} from "./splatKitClient";

export interface CharacterEditProgress {
  message: string;
  percent: number;
  reportedByEngine?: boolean;
}

export interface CharacterPaintRequest {
  mode: "color" | "shade";
  color: string;
  instruction: string;
  strength?: number;
  mask?: File;
  region?: string;
}

export function characterPaintPrompt(request: CharacterPaintRequest): string {
  const direction = request.instruction.trim() || (request.mode === "color" ? "color the complete character" : "add finished dimensional lighting");
  const boundary = request.region ? ` Work only inside the supplied ${request.region} mask.` : "";
  return request.mode === "color"
    ? `Color-assist this exact character drawing. Use ${request.color} as the selected primary or requested-region color. ${direction}.${boundary} Preserve every ink line, silhouette, facial feature, outfit shape, pose, and the clean background. Apply a coherent fantasy palette with clean material boundaries; do not redraw the character.`
    : `Shade this exact colored character drawing without restyling it. ${direction}.${boundary} Preserve the existing hue and saturation palette and use ${request.color} only as a restrained lighting accent. Add key light, form and contact shadows, ambient occlusion, and highlights while preserving every line, silhouette, facial feature, outfit shape, pose, texture, and background.`;
}

export function createCharacterInpaintWorkflow(
  checkpointName: string,
  upload: ComfyUpload,
  maskUpload: ComfyUpload,
  instruction: string,
  strength = .3,
  seed = Math.floor(Math.random() * 2_147_483_647),
): ComfyWorkflow {
  if (!checkpointName.trim()) throw new Error("The local image editor has no checkpoint installed");
  const image = upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
  const mask = maskUpload.subfolder ? `${maskUpload.subfolder}/${maskUpload.name}` : maskUpload.name;
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpointName }, _meta: { title: "Local image model" } },
    "2": { class_type: "LoadImage", inputs: { image, upload: "image" }, _meta: { title: "Locked character artwork" } },
    "3": { class_type: "LoadImage", inputs: { image: mask, upload: "image" }, _meta: { title: "Protected edit mask" } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: instruction, clip: ["1", 1] }, _meta: { title: "Masked paint instruction" } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: "redrawn character, changed identity, changed pose, changed silhouette, changed line art, changed palette, extra limbs, text, watermark", clip: ["1", 1] }, _meta: { title: "Preservation negative" } },
    "6": { class_type: "VAEEncodeForInpaint", inputs: { pixels: ["2", 0], vae: ["1", 2], mask: ["3", 1], grow_mask_by: 6 }, _meta: { title: "Encode selected region only" } },
    "7": { class_type: "KSampler", inputs: { seed, steps: 24, cfg: 5, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: Math.min(.48, Math.max(.12, strength)), model: ["1", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0] }, _meta: { title: "Paint protected region" } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["1", 2] }, _meta: { title: "Decode protected edit" } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "DnDRom/character_masked_edit", images: ["8", 0] }, _meta: { title: "Save reversible AI layer" } },
  };
}

export function createKreaCharacterInpaintWorkflow(
  upload: ComfyUpload,
  maskUpload: ComfyUpload,
  instruction: string,
  strength = .3,
  seed = Math.floor(Math.random() * 2_147_483_647),
): ComfyWorkflow {
  const image = upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
  const mask = maskUpload.subfolder ? `${maskUpload.subfolder}/${maskUpload.name}` : maskUpload.name;
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "krea2_turbo_fp8_scaled.safetensors", weight_dtype: "default" }, _meta: { title: "Krea local editor" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_4b_fp8_scaled.safetensors", type: "krea2", device: "default" }, _meta: { title: "Krea text encoder" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "wan_2.1_vae.safetensors" }, _meta: { title: "Local image VAE" } },
    "4": { class_type: "LoadImage", inputs: { image, upload: "image" }, _meta: { title: "Locked character artwork" } },
    "5": { class_type: "LoadImage", inputs: { image: mask, upload: "image" }, _meta: { title: "Protected edit mask" } },
    "6": { class_type: "VAEEncodeForInpaint", inputs: { pixels: ["4", 0], vae: ["3", 0], mask: ["5", 1], grow_mask_by: 6 }, _meta: { title: "Encode selected region only" } },
    "8": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 }, _meta: { title: "Krea sampling" } },
    "9": { class_type: "CLIPTextEncode", inputs: { text: instruction, clip: ["2", 0] }, _meta: { title: "Masked paint instruction" } },
    "10": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["9", 0] }, _meta: { title: "Neutral negative" } },
    "11": { class_type: "KSampler", inputs: { seed, steps: 12, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: Math.min(.48, Math.max(.12, strength)), model: ["8", 0], positive: ["9", 0], negative: ["10", 0], latent_image: ["6", 0] }, _meta: { title: "Paint protected region" } },
    "12": { class_type: "VAEDecode", inputs: { samples: ["11", 0], vae: ["3", 0] }, _meta: { title: "Decode protected edit" } },
    "13": { class_type: "SaveImage", inputs: { filename_prefix: "DnDRom/character_masked_edit", images: ["12", 0] }, _meta: { title: "Save reversible AI layer" } },
  };
}

export function createCharacterPromptEditWorkflow(
  checkpointName: string,
  upload: ComfyUpload,
  instruction: string,
  strength = .48,
  seed = Math.floor(Math.random() * 2_147_483_647),
): ComfyWorkflow {
  if (!checkpointName.trim()) throw new Error("The local image editor has no checkpoint installed");
  if (!instruction.trim()) throw new Error("Describe the character change first");
  const image = upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpointName }, _meta: { title: "Local image model" } },
    "2": { class_type: "LoadImage", inputs: { image, upload: "image" }, _meta: { title: "Current character reference" } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: `Edit this same tabletop character: ${instruction.trim()}. Preserve the character identity, silhouette, pose, proportions, centered full body, clean neutral background, detailed concept art.`, clip: ["1", 1] }, _meta: { title: "Edit instruction" } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: "different character, duplicate subject, cropped feet, changed pose, extra limbs, missing limbs, text, watermark, busy background, low quality, blurry", clip: ["1", 1] }, _meta: { title: "Negative prompt" } },
    "5": { class_type: "VAEEncode", inputs: { pixels: ["2", 0], vae: ["1", 2] }, _meta: { title: "Encode current character" } },
    "6": { class_type: "KSampler", inputs: { seed, steps: 26, cfg: 5.5, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: Math.min(.75, Math.max(.15, strength)), model: ["1", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0] }, _meta: { title: "Apply character edit" } },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["1", 2] }, _meta: { title: "Decode edited reference" } },
    "8": { class_type: "SaveImage", inputs: { filename_prefix: "DnDRom/character_revision", images: ["7", 0] }, _meta: { title: "Save character revision" } },
  };
}

export function createKreaCharacterPromptEditWorkflow(
  upload: ComfyUpload,
  instruction: string,
  strength = .48,
  seed = Math.floor(Math.random() * 2_147_483_647),
): ComfyWorkflow {
  if (!instruction.trim()) throw new Error("Describe the character change first");
  const image = upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "krea2_turbo_fp8_scaled.safetensors", weight_dtype: "default" }, _meta: { title: "Krea local editor" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_4b_fp8_scaled.safetensors", type: "krea2", device: "default" }, _meta: { title: "Krea text encoder" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "wan_2.1_vae.safetensors" }, _meta: { title: "Local image VAE" } },
    "4": { class_type: "LoadImage", inputs: { image, upload: "image" }, _meta: { title: "Current character reference" } },
    "5": { class_type: "ImageScale", inputs: { image: ["4", 0], upscale_method: "lanczos", width: 1024, height: 1024, crop: "disabled" }, _meta: { title: "Fit edit canvas" } },
    "6": { class_type: "VAEEncode", inputs: { pixels: ["5", 0], vae: ["3", 0] }, _meta: { title: "Encode current character" } },
    "7": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 }, _meta: { title: "Krea sampling" } },
    "8": { class_type: "CLIPTextEncode", inputs: { text: `Edit this same tabletop character: ${instruction.trim()}. Preserve identity, face, pose, proportions and full-body framing. Clean neutral background.`, clip: ["2", 0] }, _meta: { title: "Edit instruction" } },
    "9": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["8", 0] }, _meta: { title: "Neutral negative" } },
    "10": { class_type: "KSampler", inputs: { seed, steps: 12, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: Math.min(.7, Math.max(.2, strength)), model: ["7", 0], positive: ["8", 0], negative: ["9", 0], latent_image: ["6", 0] }, _meta: { title: "Apply character edit" } },
    "11": { class_type: "VAEDecode", inputs: { samples: ["10", 0], vae: ["3", 0] }, _meta: { title: "Decode edited reference" } },
    "12": { class_type: "SaveImage", inputs: { filename_prefix: "DnDRom/character_revision", images: ["11", 0] }, _meta: { title: "Save character revision" } },
  };
}

export async function generateCharacterEditReference(
  baseUrl: string,
  source: File,
  instruction: string,
  strength = .48,
  signal?: AbortSignal,
  onProgress?: (progress: CharacterEditProgress) => void,
): Promise<File> {
  onProgress?.({ message: "Checking the private local image editor…", percent: 5 });
  const checkpoints = await listComfyCheckpoints(baseUrl);
  onProgress?.({ message: "Sending the reference to local ComfyUI…", percent: 12 });
  const upload = await uploadComfyImage(baseUrl, source);
  const checkpoint = checkpoints.find((entry) => /sdxl|juggernaut|dreamshaper|realvis|flux/i.test(entry)) ?? checkpoints[0];
  const workflow = checkpoint
    ? createCharacterPromptEditWorkflow(checkpoint, upload, instruction, strength)
    : createKreaCharacterPromptEditWorkflow(upload, instruction, strength);
  const clientId = crypto.randomUUID();
  const monitor = monitorComfyWorkflow(baseUrl, clientId, workflow, (event) => {
    if (event.status !== "error") onProgress?.({ message: event.nodeTitle ? `Character edit: ${event.nodeTitle}` : "Editing the character reference locally…", percent: Math.round(18 + event.percent * .7), reportedByEngine: true });
  });
  try {
    await monitor.ready;
    const promptId = await queueComfyWorkflow(baseUrl, workflow, clientId);
    monitor.setPromptId(promptId);
    const result = await waitForComfyPrompt(baseUrl, promptId, signal);
    const output = [...result.outputs].reverse().find((entry) => /\.(png|jpe?g|webp)$/i.test(entry.filename));
    if (!output) throw new Error("The local edit completed without an image revision");
    onProgress?.({ message: "Loading the edited character reference…", percent: 94 });
    const downloaded = await downloadComfyOutput(baseUrl, output);
    return new File([downloaded], `${source.name.replace(/\.[^.]+$/, "")}-prompt-edit.png`, { type: downloaded.type || "image/png", lastModified: Date.now() });
  } finally {
    monitor.close();
  }
}

export async function generateCharacterPaintAssist(
  baseUrl: string,
  source: File,
  request: CharacterPaintRequest,
  signal?: AbortSignal,
  onProgress?: (progress: CharacterEditProgress) => void,
): Promise<File> {
  if (request.mask) {
    onProgress?.({ message: "Checking the private masked image editor…", percent: 5 });
    const checkpoints = await listComfyCheckpoints(baseUrl);
    onProgress?.({ message: "Sending the locked artwork and protected mask locally…", percent: 12 });
    const [upload, maskUpload] = await Promise.all([uploadComfyImage(baseUrl, source), uploadComfyImage(baseUrl, request.mask)]);
    const checkpoint = checkpoints.find((entry) => /sdxl|juggernaut|dreamshaper|realvis|flux/i.test(entry)) ?? checkpoints[0];
    const instruction = characterPaintPrompt(request);
    const workflow = checkpoint
      ? createCharacterInpaintWorkflow(checkpoint, upload, maskUpload, instruction, request.strength)
      : createKreaCharacterInpaintWorkflow(upload, maskUpload, instruction, request.strength);
    const clientId = crypto.randomUUID();
    const monitor = monitorComfyWorkflow(baseUrl, clientId, workflow, (event) => {
      if (event.status !== "error") onProgress?.({ message: event.nodeTitle ? `Protected edit: ${event.nodeTitle}` : "Painting only the selected region…", percent: Math.round(18 + event.percent * .7), reportedByEngine: true });
    });
    try {
      await monitor.ready;
      const promptId = await queueComfyWorkflow(baseUrl, workflow, clientId);
      monitor.setPromptId(promptId);
      const result = await waitForComfyPrompt(baseUrl, promptId, signal);
      const output = [...result.outputs].reverse().find((entry) => /\.(png|jpe?g|webp)$/i.test(entry.filename));
      if (!output) throw new Error("The local masked edit completed without an image layer");
      const downloaded = await downloadComfyOutput(baseUrl, output);
      return new File([downloaded], `${source.name.replace(/\.[^.]+$/, "")}-masked-edit.png`, { type: downloaded.type || "image/png", lastModified: Date.now() });
    } finally { monitor.close(); }
  }
  return await generateCharacterEditReference(
    baseUrl,
    source,
    characterPaintPrompt(request),
    request.strength ?? (request.mode === "color" ? .42 : .3),
    signal,
    onProgress,
  );
}
