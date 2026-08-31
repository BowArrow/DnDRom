import { z } from "zod";
import { ASSET_CATALOG } from "../domain/assets";
import { generateMapFromPrompt } from "../domain/mapGenerator";
import type { CampaignSettings, GameMap } from "../domain/types";
import { completeLocalChat, extractJson } from "./openAiClient";

const placementSchema = z.object({
  assetId: z.string(),
  name: z.string().min(1).max(80),
  x: z.number().min(-30).max(30),
  z: z.number().min(-30).max(30),
  rotationY: z.number().min(-360).max(360).optional(),
  scale: z.number().min(0.25).max(4).optional(),
  notes: z.string().max(240).optional(),
});

const planSchema = z.object({
  name: z.string().min(1).max(80),
  theme: z.enum(["dungeon", "tavern", "forest", "ruins", "cavern", "city", "town", "village", "plains", "mountains", "coast", "swamp"]),
  width: z.number().int().min(8).max(60),
  depth: z.number().int().min(8).max(60),
  placements: z.array(placementSchema).min(1).max(180),
});

export async function generateAiMap(prompt: string, settings: CampaignSettings, signal?: AbortSignal): Promise<{ map: GameMap; provider: "local-ai" | "procedural"; warning?: string }> {
  if (!settings.useLocalAiForMaps || !settings.localAiEndpoint.trim()) {
    return { map: generateMapFromPrompt(prompt), provider: "procedural" };
  }
  try {
    const allowedAssets = ASSET_CATALOG.map(({ id, name, category }) => ({ id, name, category }));
    const content = await completeLocalChat({
      endpoint: settings.localAiEndpoint,
      model: settings.localAiModel,
      signal,
      temperature: 0.45,
      maxTokens: 1500,
      messages: [
        {
          role: "system",
          content: `Design a playable tabletop location using only asset IDs in the provided catalog. It may be an interior, city district, town, village, or landscape. Include navigable routes, entrances, cover, scene dressing, at least one player token, and story landmarks named in the request. Coordinates are meters on a ground plane centered at 0,0. Keep important objects at least 1.5 meters apart. Return JSON only: {name,theme,width,depth,placements:[{assetId,name,x,z,rotationY,scale,notes}]}.`,
        },
        { role: "user", content: `REQUEST:\n${prompt}\n\nASSET CATALOG:\n${JSON.stringify(allowedAssets)}` },
      ],
    });
    const plan = planSchema.parse(extractJson(content));
    const allowedIds = new Set(ASSET_CATALOG.map((asset) => asset.id));
    const placements = plan.placements.filter((placement) => allowedIds.has(placement.assetId));
    if (!placements.length) throw new Error("AI map did not use any recognized asset IDs");
    const nowId = crypto.randomUUID();
    return {
      provider: "local-ai",
      map: {
        id: nowId,
        name: plan.name,
        theme: plan.theme,
        width: plan.width,
        depth: plan.depth,
        gridSize: 1,
        ambientColor: ["forest", "plains", "village", "town", "city"].includes(plan.theme) ? "#263329" : plan.theme === "tavern" ? "#30271f" : plan.theme === "coast" ? "#243642" : "#282624",
        entities: placements.map((placement) => ({
          id: crypto.randomUUID(),
          assetId: placement.assetId,
          name: placement.name,
          position: { x: placement.x, y: 0, z: placement.z },
          rotation: { x: 0, y: placement.rotationY ?? 0, z: 0 },
          scale: { x: placement.scale ?? 1, y: placement.scale ?? 1, z: placement.scale ?? 1 },
          notes: placement.notes,
        })),
      },
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      map: generateMapFromPrompt(prompt),
      provider: "procedural",
      warning: `Local AI map planning failed; generated a deterministic local map instead. ${error instanceof Error ? error.message : ""}`.trim(),
    };
  }
}
