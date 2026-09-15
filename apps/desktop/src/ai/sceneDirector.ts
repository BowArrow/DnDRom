import { prepareLanguageSettings } from "./managedLanguage";
import { z } from "zod";
import { completeLocalChat, extractJson } from "./openAiClient";
import { expandSceneRecipe, sceneCompositionSchema, scenePartSchema } from "../domain/sceneGrammar";
import type { CampaignSettings, WorldBlueprintV1 } from "../domain/types";
const recipeOutputSchema = sceneCompositionSchema.shape.recipes.element.extend({ parts: z.array(scenePartSchema).min(1).max(12) });
const compositionOutputSchema = sceneCompositionSchema.safeExtend({ recipes: z.array(recipeOutputSchema).min(1).max(6), buildingRecipeId: z.string().min(1).max(60), placements: sceneCompositionSchema.shape.placements.max(4) });

/** The LLM authors construction rules. No inferred culture names or preset
 * selection: the same grammar expresses courtyards, temples, gates and fungi. */
export async function directSceneComposition(blueprint: WorldBlueprintV1, settings: CampaignSettings, signal?: AbortSignal): Promise<{ blueprint: WorldBlueprintV1; warning?: string; provider: "local-ai" | "procedural" }> {
  settings = await prepareLanguageSettings(settings, signal);
  signal?.throwIfAborted();
  if (!settings.useLocalAiForMaps || !settings.localAiEndpoint.trim()) return { blueprint, provider: "procedural", warning: "Using the procedural fallback. Enable a local language model for custom architecture and scene composition." };
  try {
    const response = await completeLocalChat({ responseSchema: z.toJSONSchema(compositionOutputSchema), endpoint: settings.localAiEndpoint, model: settings.localAiModel, maxTokens: 9000, temperature: .45, signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(180_000)]), messages: [
      { role: "system", content: `You are an architectural designer directing a procedural fantasy world engine. Return JSON matching the supplied schema. Interpret the actual user's subject, culture, era, construction, and layout, not generic medieval buildings. Design reusable construction recipes plus focal structures and props. Every recipe is an assembly of box, sphere, cylinder, cone, frame or curved roof parts with local position, full size, Euler rotation in degrees, color and semantic material. Y is up, parts centered on position. A roof has ridge along X, width X, rise Y, depth Z, with curve 0 straight, positive upturned eaves. Repeat creates count copies translated by step per copy and rotated in place by yaw. For buildings PREFER frame + roof over manually assembled beams. A frame creates a connected raised floor, perimeter columns, eave beams and walls with a front entrance. Set frame size width X, height Y, depth Z, center Y=height/2; bays {x:3,z:2}, levels 1, openness .5 (1 open pavilion,0 enclosed with entrance). It has no roof: add a roof centered at frame height + roof rise/2, size X/Z .8m larger than frame. Roof curve .5 makes swept eaves. Combine rotated frames around open courtyards, repeat frames for arcades, and stack levels for towers. Use repeats for other columns and fence spans. Assemblies should have floors, actual entrances, open courtyards where appropriate, roof overhangs and purposeful proportions. buildingRecipeId replaces ALL generic settlement houses; its footprint must fit within 10x10 meters. Build custom silhouettes and coherent materials: a Chinese courtyard village needs timber bays and curved tile eaves; a fungal settlement needs organic caps, stems and stairs, not stone cottages. Ruins have missing wall spans, collapsed roofs and exposed beams. Set buildingRecipeId to the main reusable house recipe. Use custom placements for EACH other focal recipe exactly once; do not repeat the house recipe there. The region already has a selected eroded geographic site; use the supplied measured zone elevations and shoreline requirements to compose buildings into that land. Place focal recipes near the supplied dry zones using scene-relative X/Z within region bounds away from entry/exit routes. elevation is height above local terrain and allows aerial structures. Keep at most 6 recipes, 4 custom placements and 120 expanded parts per recipe for real-time rendering. Compose functional playable space, not solid boxes occupying rooms. A recipe is geometry, not code.` },
      { role: "user", content: JSON.stringify({ request: blueprint.description, region: { width: blueprint.width, depth: blueprint.depth, biome: blueprint.biome, site: blueprint.site, zones: blueprint.zones }, schema: z.toJSONSchema(sceneCompositionSchema) }) },
    ] });
    let composition = sceneCompositionSchema.parse(extractJson(response));
    // Schema validity is insufficient: small models often draw a solid box
    // under a roof. Feed measurable construction defects back for one repair.
    const problems = composition.recipes.flatMap((recipe) => {
      const parts = expandSceneRecipe(recipe.parts);
      if (!parts.some((part) => part.shape === "roof") && parts.length >= 4) return [];
      const issues: string[] = [];
      if (parts.length < 10) issues.push(`${recipe.id}: only ${parts.length} structural parts. Add real columns, beams, perimeter wall spans, a raised floor, ridge and eave trim. Use repeat for regular bays.`);
      if (parts.some((part) => part.shape === "box" && part.size.x > 2 && part.size.z > 1.2 && part.size.y > 1.5)) issues.push(`${recipe.id}: a solid box blocks the building interior. Replace it with thin perimeter wall spans and leave a door or an open gateway.`);
      return issues;
    });
    if (problems.length) {
      const recipeSchema = recipeOutputSchema;
      for (const recipe of composition.recipes) {
        const defects = problems.filter((problem) => problem.startsWith(`${recipe.id}:`));
        if (!defects.length) continue;
        const repaired = await completeLocalChat({ responseSchema: z.toJSONSchema(recipeSchema), endpoint: settings.localAiEndpoint, model: settings.localAiModel, maxTokens: 6500, temperature: .3, signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(180_000)]), messages: [
          { role: "system", content: "Repair ONE architectural recipe and return JSON {id,name,parts}. Only shapes box,sphere,cylinder,cone,roof,frame are supported. Prefer one frame and one roof, plus decorative parts. A frame makes a connected floor, posts, beams and doorway; size gives total width/height/depth, center Y=height/2, bays {x:3,z:2}, levels 1, openness .4. Place the roof above it with matching width and depth plus .8m overhang. Keep 2 to 12 authored parts, using repeat for columns or bays to create at least ten expanded pieces. Walls are thin boxes, columns are cylinders, beams are thin boxes. Include an accessible floor, separate perimeter wall spans, an actual doorway, support posts, eave beams and a roof. Never enclose the interior in one solid box. Roof local width X, rise Y, depth Z; eaves are position.y-size.y/2, ridge position.y+size.y/2. Match the requested architectural culture and align roofs with their supports. No code." },
          { role: "user", content: JSON.stringify({ request: blueprint.description, defects, recipe, schema: z.toJSONSchema(recipeSchema) }) },
        ] });
        const repairedJson = extractJson(repaired) as Record<string, unknown>;
        const refined = recipeSchema.parse(repairedJson.recipe ?? repairedJson);
        recipe.name = refined.name; recipe.parts = refined.parts;
      }
      composition = sceneCompositionSchema.parse(composition);
    }
    const recipeById = new Map(composition.recipes.map((recipe) => [recipe.id, recipe]));
    for (const placement of composition.placements) {
      const recipe = recipeById.get(placement.recipeId)!;
      const unscaledRadius = Math.max(...expandSceneRecipe(recipe.parts).map((part) => Math.hypot(part.position.x, part.position.z) + Math.hypot(part.size.x, part.size.z) / 2));
      // Fit generated designs to the requested map instead of throwing away
      // all architecture for a repairable placement near a region edge.
      placement.scale = Math.min(placement.scale, (Math.min(blueprint.width, blueprint.depth) / 2 - 3) / Math.max(.1, unscaledRadius));
      const radius = unscaledRadius * placement.scale;
      const limitX = blueprint.width / 2 - radius - 1, limitZ = blueprint.depth / 2 - radius - 1;
      placement.x = Math.max(-limitX, Math.min(limitX, placement.x));
      placement.z = Math.max(-limitZ, Math.min(limitZ, placement.z));
    }
    return { blueprint: { ...blueprint, composition }, provider: "local-ai" };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { blueprint, provider: "procedural", warning: `Custom architecture could not be planned; the base scene remains available. ${error instanceof Error ? error.message : String(error)}` };
  }
}
