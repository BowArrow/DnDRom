import type { Campaign, CampaignScene, GameMap } from "./types";

const cloneMap = (map: GameMap): GameMap => structuredClone(map);

export function normalizeCampaignScenes(campaign: Campaign): Campaign {
  if (campaign.scenes?.length && campaign.activeSceneId && campaign.scenes.some((scene) => scene.id === campaign.activeSceneId)) {
    return { ...campaign, tokenCharacterLinks: campaign.tokenCharacterLinks ?? {} };
  }
  const now = campaign.updatedAt || new Date().toISOString();
  const scene: CampaignScene = {
    id: campaign.activeSceneId || crypto.randomUUID(),
    name: campaign.map.name,
    map: cloneMap(campaign.map),
    partyCharacterIds: campaign.characters.filter((character) => (character.role ?? "player") === "player").map((character) => character.id),
    notes: "Recovered from a campaign created before multi-scene support.",
    createdAt: campaign.createdAt || now,
    updatedAt: now,
  };
  return { ...campaign, scenes: [scene], activeSceneId: scene.id, tokenCharacterLinks: campaign.tokenCharacterLinks ?? {} };
}

export function snapshotActiveScene(campaign: Campaign): Campaign {
  const normalized = normalizeCampaignScenes(campaign);
  const now = new Date().toISOString();
  return {
    ...normalized,
    scenes: normalized.scenes!.map((scene) => scene.id === normalized.activeSceneId
      ? { ...scene, name: normalized.map.name || scene.name, map: cloneMap(normalized.map), updatedAt: now }
      : scene),
  };
}

export function makeCampaignScene(name: string, map: GameMap, partyCharacterIds: string[], notes = ""): CampaignScene {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: name.trim() || map.name || "Untitled scene",
    map: { ...cloneMap(map), id: crypto.randomUUID(), name: name.trim() || map.name },
    partyCharacterIds: [...new Set(partyCharacterIds)],
    notes,
    createdAt: now,
    updatedAt: now,
  };
}

export function campaignCatalog(active: Campaign, archived: Campaign[]): Campaign[] {
  const current = snapshotActiveScene(active);
  return [current, ...archived.filter((campaign) => campaign.id !== current.id)]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}
