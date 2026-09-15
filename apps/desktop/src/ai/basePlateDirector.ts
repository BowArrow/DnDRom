import { z } from "zod";
import { createBasePlateConcepts, createBasePlateRecipe, validateBasePlateRecipe } from "../domain/baseplates";
import type { BasePlatePreset, BasePlateRecipe, CampaignSettings } from "../domain/types";
import { completeLocalChat, extractJson } from "./openAiClient";
import { sceneryHeightRatio } from "../rendering/scenicBaseGeometry";

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
  const percent=Math.round(sceneryHeightRatio(recipe)*100);
  const relief=percent<=12 ? "very low horizontal ground cover, flat leaves and tiny edge details" : percent<=24 ? "shallow ground relief and small peripheral details" : "low peripheral scenery around a broad clear floor";
  return `Macro product photograph of a realistic physical miniature BASE PLATE, ${relief}. Maximum total height ${percent} percent of base width: a 32 mm wide base has at most ${(32*sceneryHeightRatio(recipe)).toFixed(1)} mm of height INCLUDING all plants and props. Subject: ${recipe.description}. Rich realistic materials, intricate leaf veins, wet reflections, tiny surface imperfections, soft natural studio illumination, physically shaded three-dimensional surfaces. Interpret the subject as a walkable ground surface. Keep the central 55 percent of the width open, level and near the bottom; put decorative focal elements at the outer edge. Continuous flat walkable surface through the middle. Match the provided shallow silhouette and empty upper background. Replace guide colours with detailed natural materials; do not add height. ${recipe.visualShape === "inherit" ? "Round" : recipe.visualShape} footprint, edge-to-edge scenery, thin edge. Orthographic product view 30 degrees above the ground, entire plate visible on plain light grey, no surrounding landscape, no character, no stand, no text.`;
}

/** Both image requests belong to the same explicit brief. Old concepts and
 * adventure presets must never supply the second candidate's subject. */
export function prepareScenicImageConcepts(template: BasePlateRecipe, description: string) {
  const brief = description.trim();
  if (!brief) throw new Error("Describe the scenic base before generating concepts.");
  return [
    "Use a balanced composition with the requested focal shape clearly readable.",
    "Explore a different arrangement of the same requested elements, with an organic silhouette and edge detail.",
  ].map((variation) => {
    const recipe = validateBasePlateRecipe({ ...structuredClone(template), description: brief, layers: template.layers.filter(layer => layer.kind === "plinth").map(layer => structuredClone(layer)) });
    return { recipe, prompt: `${compileScenicBasePlateImagePrompt(recipe)} ${variation} Preserve every requested subject and environment; vary the composition, not the scene's theme.` };
  });
}
