import type { Campaign, Character } from "../domain/types";

const download = (name: string, contents: string, type: string) => {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const safeFileName = (value: string): string => value.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "campaign";

export function exportCampaign(campaign: Campaign): void {
  download(`${safeFileName(campaign.name)}.dndrom`, JSON.stringify(campaign, null, 2), "application/json");
}

export function exportCharacter(character: Character): void {
  download(`${safeFileName(character.name)}.character.json`, JSON.stringify(character, null, 2), "application/json");
}

export async function importCampaign(file: File): Promise<Campaign> {
  if (file.size > 50 * 1024 * 1024) throw new Error("Campaign imports are limited to 50 MB");
  const campaign = JSON.parse(await file.text()) as Campaign;
  if (campaign?.schemaVersion !== 1 || typeof campaign.name !== "string" || !campaign.map || !Array.isArray(campaign.characters)) {
    throw new Error("This file is not a supported DnDRom campaign");
  }
  return { ...campaign, id: campaign.id || crypto.randomUUID(), updatedAt: new Date().toISOString() };
}

export async function saveCampaignNative(campaign: Campaign): Promise<string | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const saved = await invoke<{ name: string; path: string }>("save_campaign", { name: safeFileName(campaign.name), contents: JSON.stringify(campaign) });
  return saved.path;
}

