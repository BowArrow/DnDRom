import { z } from "zod";
import { ASSET_CATALOG } from "../domain/assets";
import { generateMapFromPrompt } from "../domain/mapGenerator";
import { createFallbackWorldBlueprints, worldBlueprintSchema, type WorldForgeRequest } from "../domain/worldForge";
import type { CampaignSettings, GameMap, WorldBlueprintV1 } from "../domain/types";
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

const worldConceptsSchema = z.object({ concepts: z.array(worldBlueprintSchema).length(2) });

export interface BoundedWorldContext {
  location?: string;
  biome?: string;
  sceneTags?: string[];
  partyFootprints?: number[];
  recentResolvedEvents?: string[];
}

export async function generateWorldBlueprints(
  request: WorldForgeRequest,
  settings: CampaignSettings,
  context: BoundedWorldContext = {},
  signal?: AbortSignal,
): Promise<{ blueprints: [WorldBlueprintV1, WorldBlueprintV1]; provider: "local-ai" | "procedural"; warning?: string }> {
  const fallback = createFallbackWorldBlueprints(request);
  if (!settings.useLocalAiForMaps || !settings.localAiEndpoint.trim()) return { blueprints: fallback, provider: "procedural" };
  const boundedContext: BoundedWorldContext = {
    location: context.location?.slice(0, 120), biome: context.biome?.slice(0, 60),
    sceneTags: context.sceneTags?.slice(0, 12).map((entry) => entry.slice(0, 60)),
    partyFootprints: context.partyFootprints?.slice(0, 12).map((entry) => Math.max(.25, Math.min(6, entry))),
    recentResolvedEvents: context.recentResolvedEvents?.slice(0, 5).map((entry) => entry.slice(0, 180)),
  };
  try {
    const result = await completeLocalChat({
      endpoint: settings.localAiEndpoint, model: settings.localAiModel, signal, temperature: .42, maxTokens: 5_000,
      messages: [
        { role: "system", content: `You design deterministic, editable tabletop regions. Return JSON only with {concepts:[WorldBlueprintV1,WorldBlueprintV1]}. Both concepts must use version 1, chunkSize 16, the requested exact dimensions, validated zone connections, and no executable code. Use only these theme values: dungeon,tavern,forest,ruins,cavern,city,town,village,plains,mountains,coast,swamp. Asset requests describe needs and never invent resolved asset IDs. AI controls bounded parameters; procedural code creates geometry. The two concepts must be meaningfully different while remaining playable.` },
        { role: "user", content: JSON.stringify({ request, boundedContext, fallbackShape: fallback }) },
      ],
    });
    const parsed = worldConceptsSchema.parse(extractJson(result));
    return { blueprints: parsed.concepts as [WorldBlueprintV1, WorldBlueprintV1], provider: "local-ai" };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { blueprints: fallback, provider: "procedural", warning: `Local AI blueprint planning failed; deterministic concepts are ready. ${error instanceof Error ? error.message : ""}`.trim() };
  }
}

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
