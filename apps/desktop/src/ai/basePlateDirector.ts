import { z } from "zod";
import { createBasePlateConcepts, createBasePlateRecipe, validateBasePlateRecipe } from "../domain/baseplates";
import type { BasePlatePreset, BasePlateRecipe, CampaignSettings } from "../domain/types";
import { completeLocalChat, extractJson } from "./openAiClient";

const conceptSchema = z.object({ concepts: z.array(z.object({ preset: z.enum(["pond", "grass", "forest", "stone", "snow", "sand", "swamp", "volcanic", "tavern", "dungeon", "arcane"]), description: z.string().min(2).max(700) })).min(2).max(2) });

export interface BasePlateSuggestionContext {
  description: string;
  character?: string;
  location?: string;
  biome?: string;
  sceneTags?: string[];
  recentEvents?: string[];
}

export function isolatedBasePlatePrompt(context: BasePlateSuggestionContext): string {
  return [context.description, context.character && `Character concept: ${context.character}`, context.location && `Current location: ${context.location}`, context.biome && `Biome: ${context.biome}`, context.sceneTags?.length && `Scene tags: ${context.sceneTags.join(", ")}`, context.recentEvents?.length && `Recent resolved events: ${context.recentEvents.slice(-3).join("; ")}`].filter(Boolean).join("\n");
}

export async function designBasePlateConcepts(context: BasePlateSuggestionContext, settings: CampaignSettings, signal?: AbortSignal): Promise<{ recipes: BasePlateRecipe[]; provider: "local-ai" | "offline-assist"; warning?: string }> {
  const prompt = isolatedBasePlatePrompt(context);
  if (!settings.localAiEndpoint.trim()) return { recipes: createBasePlateConcepts(prompt), provider: "offline-assist" };
  try {
    const response = await completeLocalChat({ endpoint: settings.localAiEndpoint, model: settings.localAiModel, signal, temperature: .45, maxTokens: 420, messages: [
      { role: "system", content: "You design safe physical miniature scenic bases. Return JSON only: {concepts:[{preset,description},{preset,description}]}. Preset must be pond, grass, forest, stone, snow, sand, swamp, volcanic, tavern, dungeon, or arcane. Keep the center 35 percent flat for feet; use shallow relief; do not alter gameplay footprint; do not create or assign assets." },
      { role: "user", content: prompt },
    ] });
    const parsed = conceptSchema.parse(extractJson(response));
    return { recipes: parsed.concepts.map((concept) => validateBasePlateRecipe(createBasePlateRecipe(concept.preset as BasePlatePreset, concept.description))), provider: "local-ai" };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { recipes: createBasePlateConcepts(prompt), provider: "offline-assist", warning: error instanceof Error ? error.message : "Local baseplate design failed" };
  }
}

/** Cloud providers receive this asset-only prompt, never sheets, campaign history, or source artwork. */
export function compileBaseDecorationPrompt(recipe: BasePlateRecipe, layerName: string): string {
  return `Isolated tabletop miniature base decoration: ${layerName}. Match this scenic base: ${recipe.description}. Fully visible single object, neutral background, no character, no text, no scenery, no cast shadow, three-quarter view.`;
}

/** Asset-only prompt for a complete scenic topper that can be reviewed before Pixal3D. */
export function compileScenicBasePlateImagePrompt(recipe: BasePlateRecipe): string {
  return `A single complete scenic miniature base topper for a tabletop roleplaying figure: ${recipe.description}. ${recipe.visualShape === "inherit" ? "Round display base" : `${recipe.visualShape} display base`}, low shallow relief, cohesive hand-painted physical terrain, clean beveled outer rim, and a naturally integrated flat clear standing area across the central 35 percent for the miniature's feet. Fully visible entire base, centered, isolated on a plain neutral background, three-quarter product view. No character, no miniature, no loose unrelated objects, no text, no labels, no border, no crop, no cast shadow, no surrounding scene.`;
}
