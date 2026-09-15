import type { Campaign } from "../domain/types";

export async function downloadUnrealScene(campaign: Campaign): Promise<number> {
  const worker = new Worker(new URL("./unrealScene.worker.ts", import.meta.url), { type: "module" });
  try {
    const result = await new Promise<{ json: string; warnings: number }>((resolve, reject) => {
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
      worker.onerror = () => reject(new Error("Unreal scene export failed. The campaign has not been changed."));
      worker.postMessage(campaign);
    });
    const url = URL.createObjectURL(new Blob([result.json], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${campaign.name.replace(/[^a-z0-9_-]/gi, "-").slice(0, 80) || "campaign"}.dndscene`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    return result.warnings;
  } finally { worker.terminate(); }
}
