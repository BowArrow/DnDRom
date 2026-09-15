import type { WorldBlueprintV1 } from "./types";
import { compileWorldBlueprint, type CompiledWorld } from "./worldForge";

export async function compileWorldBlueprintAsync(blueprint: WorldBlueprintV1, signal?: AbortSignal): Promise<CompiledWorld> {
  signal?.throwIfAborted();
  if (typeof Worker === "undefined" || import.meta.env.MODE === "test") return compileWorldBlueprint(blueprint);
  return await new Promise<CompiledWorld>((resolve, reject) => {
    const worker = new Worker(new URL("./worldForgeWorker.ts", import.meta.url), { type: "module", name: "DnDRom world compiler" });
    const id = crypto.randomUUID();
    const abort = () => { worker.terminate(); reject(new DOMException("World compilation cancelled", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => { signal?.removeEventListener("abort", abort); worker.terminate(); reject(new Error(event.message || "World compiler failed")); };
    worker.onmessage = (event: MessageEvent<{ id: string; result?: CompiledWorld; error?: string }>) => {
      if (event.data.id !== id) return;
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (event.data.error || !event.data.result) reject(new Error(event.data.error || "World compiler returned no result"));
      else resolve(event.data.result);
    };
    worker.postMessage({ id, blueprint });
  });
}
