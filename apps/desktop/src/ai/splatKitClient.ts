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
  try {
    const response = await fetch(url, { ...init, signal: init.signal ?? controller.signal });
    if (!response.ok) throw new Error(`ComfyUI returned ${response.status} ${response.statusText}`);
    return response;
  } finally {
    window.clearTimeout(timeout);
  }
};

export async function testComfyUi(baseUrl: string): Promise<void> {
  if (!baseUrl.trim()) throw new Error("Enter the local ComfyUI endpoint first");
  await fetchWithTimeout(endpoint(baseUrl, "/system_stats"));
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
  }
  const promptPatched = patchPositivePrompts(prepared, description);
  if (imagePatched === 0) throw new Error("The workflow has no LoadImage input to receive the panorama");
  if (promptPatched === 0) throw new Error("The workflow has no positive text prompt input");
  return prepared;
}

export function preparePanoramaWorkflow(workflow: ComfyWorkflow, description: string): ComfyWorkflow {
  const prepared = structuredClone(workflow);
  if (patchPositivePrompts(prepared, description) === 0) throw new Error("The panorama workflow has no positive text prompt input");
  return prepared;
}

export async function queueComfyWorkflow(baseUrl: string, workflow: ComfyWorkflow): Promise<string> {
  const response = await fetchWithTimeout(endpoint(baseUrl, "/prompt"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
  }, 30_000);
  const result = await response.json() as { prompt_id?: string; error?: string; node_errors?: unknown };
  if (!result.prompt_id) throw new Error(result.error || `ComfyUI rejected the workflow${result.node_errors ? ": check missing nodes or models" : ""}`);
  return result.prompt_id;
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

export async function waitForComfyPrompt(baseUrl: string, promptId: string, signal?: AbortSignal, onPoll?: () => void): Promise<ComfyPromptResult> {
  while (!signal?.aborted) {
    const history = await (await fetchWithTimeout(endpoint(baseUrl, `/history/${encodeURIComponent(promptId)}`), { signal }, 30_000)).json() as Record<string, { outputs?: unknown; status?: { completed?: boolean; status_str?: string; messages?: unknown[] } }>;
    const job = history[promptId];
    if (job?.status?.completed) {
      if (job.status.status_str && job.status.status_str !== "success") throw new Error(`ComfyUI generation ended with status ${job.status.status_str}`);
      return { promptId, outputs: outputFiles(job.outputs) };
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
