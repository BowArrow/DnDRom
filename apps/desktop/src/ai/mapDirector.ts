import { prepareLanguageSettings } from "./managedLanguage";
import { z } from "zod";
import { ASSET_CATALOG } from "../domain/assets";
import { generateMapFromPrompt } from "../domain/mapGenerator";
import { createFallbackWorldBlueprints, worldBlueprintFields, worldBlueprintSchema, type WorldForgeRequest } from "../domain/worldForge";
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

// Engine bookkeeping is authored locally. The model supplies creative decisions,
// with the exact same field types used by the final, cross-validated blueprint.
const conceptSchema = worldBlueprintFields.omit({ site: true, version: true, id: true, seed: true, size: true, width: true, depth: true, chunkSize: true, gridShape: true, composition: true, presentation: true, assetRequests: true, biomeRegions: true }).extend({
  // Keep generated prose concise; the bundled llama grammar rejects a 2000-character repetition.
  description: worldBlueprintFields.shape.description.max(600),
  biome: worldBlueprintFields.shape.biome.extend({ palette: z.object({ ground: z.string().regex(/^#[0-9a-fA-F]{6}$/), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/), water: z.string().regex(/^#[0-9a-fA-F]{6}$/) }) }),
  zones: z.array(worldBlueprintFields.shape.zones.element.omit({ id: true, requiredConnections: true })).min(4).max(8),
});

/** Connect AI-authored places with a minimum spanning tree. Reference IDs and
 * graph connectivity belong to the engine, just like the terrain road solver. */
function connectPlannedZones(plan: z.infer<typeof conceptSchema>, base: WorldBlueprintV1) {
  // Fit the authored layout uniformly into the local region, preserving relative
  // positions instead of discarding a complete plan for an outlying landmark.
  const extentX = Math.max(1, ...plan.zones.map(zone => Math.abs(zone.center.x)));
  const extentZ = Math.max(1, ...plan.zones.map(zone => Math.abs(zone.center.z)));
  const fit = Math.min(1, (base.width / 2 - 2) / extentX, (base.depth / 2 - 2) / extentZ);
  const zones = plan.zones.map((zone, index) => ({ ...zone, id: `zone-${base.seed}-${index}`,
    center: { ...zone.center, x: zone.center.x * fit, z: zone.center.z * fit },
    radius: Math.max(2, zone.radius * fit), requiredConnections: [] as string[] }));
  const connected = new Set([0]);
  while (connected.size < zones.length) {
    let bestA = 0, bestB = -1, distance = Infinity;
    for (const a of connected) for (let b = 0; b < zones.length; b++) {
      if (connected.has(b)) continue;
      const length = Math.hypot(zones[a].center.x - zones[b].center.x, zones[a].center.z - zones[b].center.z);
      if (length < distance) { distance = length; bestA = a; bestB = b; }
    }
    zones[bestA].requiredConnections.push(zones[bestB].id);
    zones[bestB].requiredConnections.push(zones[bestA].id);
    connected.add(bestB);
  }
  return zones;
}
const worldConceptsSchema = z.object({ concepts: z.array(conceptSchema).length(2) });

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
  const boundedContext: BoundedWorldContext = {
    location: context.location?.slice(0, 120), biome: context.biome?.slice(0, 60),
    sceneTags: context.sceneTags?.slice(0, 12).map((entry) => entry.slice(0, 60)),
    partyFootprints: context.partyFootprints?.slice(0, 12).map((entry) => Math.max(.25, Math.min(6, entry))),
    recentResolvedEvents: context.recentResolvedEvents?.slice(0, 5).map((entry) => entry.slice(0, 180)),
  };
  try {
    settings = await prepareLanguageSettings(settings, signal);
    signal?.throwIfAborted();
    if (!settings.useLocalAiForMaps || !settings.localAiEndpoint.trim()) return { blueprints: fallback, provider: "procedural" };
    const constrainedConcept = conceptSchema.extend({
      kind: request.kind === "auto" ? conceptSchema.shape.kind : z.literal(request.kind),
      biome: conceptSchema.shape.biome.extend({ id: request.biome && request.biome !== "auto" ? z.literal(request.biome) : conceptSchema.shape.biome.shape.id }),
      mood: request.mood ? z.literal(request.mood) : conceptSchema.shape.mood,
    });
    const responseSchema = z.toJSONSchema(z.object({ concepts: z.array(constrainedConcept).length(2) }));
    const requestSignal = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(180_000)]);
    const messages: Parameters<typeof completeLocalChat>[0]["messages"] = [
      { role: "system", content: "Design two meaningfully different, playable fantasy scene plans matching the supplied JSON schema. Follow the user's subject, architecture, atmosphere and explicit constraints. The engine supplies IDs, seeds and world streaming; you design the location. Set siteIntent to the geographic requirements: landform any/lowland/highland/valley/ridge, water none/coast/river, forest 0..1. A harbor requires coast (a large connected body of water); a mountain settlement requires highland or a sheltered valley. The engine selects an eroded geographic site before fitting your buildings and roads to it. Coordinates are meters centered on the origin: X/Z must stay between minus half the local width/depth and plus half, with a 2m margin. The engine assigns zone IDs and routes between your places. Use 4 to 8 zones per concept with descriptive place names and distinct layouts and terrain. No executable code. Return only {concepts:[plan,plan]}, not a JSON schema or an example description." },
      { role: "user", content: JSON.stringify({ request, boundedContext, localBounds: { width: fallback[0].width, depth: fallback[0].depth }, schema: responseSchema }) },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await completeLocalChat({
        responseSchema, endpoint: settings.localAiEndpoint, model: settings.localAiModel,
        signal: requestSignal, temperature: attempt ? .15 : .42, maxTokens: 6000, messages,
      });
      try {
        const parsed = worldConceptsSchema.parse(extractJson(result));
        const concepts = parsed.concepts.map((plan, index) => {
          const base = fallback[index];
          const concept = worldBlueprintSchema.parse({ ...base, ...plan, zones: connectPlannedZones(plan, base) });
          if ((request.kind !== "auto" && concept.kind !== request.kind) || (request.biome && request.biome !== "auto" && concept.biome.id !== request.biome) || (request.mood && concept.mood !== request.mood)) throw new Error("Preserve the requested kind, biome and lighting mood exactly");
          // Keep the original request available to the architectural director.
          concept.description = request.description.trim().slice(0, 2000) || concept.description;
          return concept;
        });
        return { blueprints: concepts as [WorldBlueprintV1, WorldBlueprintV1], provider: "local-ai" };
      } catch (error) {
        if (attempt || requestSignal.aborted) throw error;
        const issues = error instanceof z.ZodError
          ? error.issues.slice(0, 10).map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")
          : error instanceof Error ? error.message : "Invalid JSON";
        messages.push({ role: "assistant", content: result.slice(0, 24000) }, { role: "user", content: `Repair your two plans. ${issues}. Return the complete corrected JSON using the supplied schema and explicit request constraints.` });
      }
    }
    throw new Error("Scene planning did not return a valid plan");
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("Local AI blueprint planning failed", error);
    return { blueprints: fallback, provider: "procedural", warning: "The local AI could not finish a valid scene plan. Procedural concepts are available; try generating again." };
  }
}

export async function generateAiMap(prompt: string, settings: CampaignSettings, signal?: AbortSignal): Promise<{ map: GameMap; provider: "local-ai" | "procedural"; warning?: string }> {
  settings = await prepareLanguageSettings(settings, signal);
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
