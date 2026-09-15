import type { BasePlateAsset, BasePlateAssignmentMap, BasePlateLayer, BasePlatePreset, BasePlateRecipe, Campaign, CampaignScene, LightingQuality, MapEntity, TokenAsset } from "./types";

export const MAX_BASE_REVISIONS = 8;
export const MAX_BASE_DECORATION_TRIANGLES = 6_000;
export const MAX_BASE_LAYER_TRIANGLES = 4_000;
export const DEFAULT_BASE_LAYER_TRIANGLES = 2_000;
export const MAX_BASE_OVERHANG = .08;

const presetCopy: Record<BasePlatePreset, { name: string; description: string; surface: string; accent: string; decoration: string; effect?: BasePlateLayer["effect"] }> = {
  pond: { name: "Pond & lily pad", description: "Still pond water, a raised lily pad, reeds, and small wet stones.", surface: "#315d59", accent: "#6f8c45", decoration: "lily pad", effect: { kind: "water", enabled: true, color: "#6fc8d1", intensity: .48, speed: .32, particleCount: 6 } },
  grass: { name: "Soft grass field", description: "Painted meadow turf with tufts of soft grass and tiny flowers.", surface: "#58703b", accent: "#8aa85a", decoration: "grass tufts", effect: { kind: "foliage", enabled: true, color: "#9bbc69", intensity: .25, speed: .22 } },
  forest: { name: "Forest floor", description: "Dark loam, moss, roots, stones, and fallen leaves.", surface: "#453b29", accent: "#657146", decoration: "moss and stones", effect: { kind: "motes", enabled: true, color: "#cfba79", intensity: .18, speed: .16, particleCount: 10 } },
  stone: { name: "Weathered stone", description: "Hand-painted cracked stone with grit in the joints.", surface: "#706e68", accent: "#a49e8b", decoration: "stone chips" },
  snow: { name: "Winter snow", description: "Soft snow drifts over cold stone with sparse icy grass.", surface: "#d9e2df", accent: "#9ec4cd", decoration: "snow drifts", effect: { kind: "motes", enabled: true, color: "#ffffff", intensity: .22, speed: .12, particleCount: 12 } },
  sand: { name: "Desert sand", description: "Wind-shaped sand, dry grass, and sun-bleached pebbles.", surface: "#b58d57", accent: "#d7b875", decoration: "sand ripples" },
  swamp: { name: "Swamp mire", description: "Muddy shallows, duckweed, reeds, and half-submerged stones.", surface: "#3f503b", accent: "#75834b", decoration: "reeds", effect: { kind: "water", enabled: true, color: "#718b5d", intensity: .3, speed: .18, particleCount: 5 } },
  volcanic: { name: "Volcanic ground", description: "Black fractured rock with restrained molten glow in the cracks.", surface: "#272321", accent: "#d45128", decoration: "basalt shards", effect: { kind: "glow", enabled: true, color: "#ff592b", intensity: .75, speed: .3 } },
  tavern: { name: "Tavern floorboards", description: "Scuffed inn floorboards with shallow seams and warm painted grain.", surface: "#694630", accent: "#a07043", decoration: "wood chips" },
  dungeon: { name: "Dungeon tiles", description: "Uneven dungeon slabs with worn mortar and scattered grit.", surface: "#555654", accent: "#7b786c", decoration: "rubble" },
  arcane: { name: "Arcane terrain", description: "Dark engraved stone with a softly pulsing magical sigil.", surface: "#343047", accent: "#8c72d8", decoration: "rune stones", effect: { kind: "glow", enabled: true, color: "#a88cff", intensity: .65, speed: .5, particleCount: 8 } },
};

const vec = (x: number, y: number, z: number) => ({ x, y, z });

export function createBasePlateRecipe(preset: BasePlatePreset, description?: string): BasePlateRecipe {
  const copy = presetCopy[preset];
  const layers: BasePlateLayer[] = [
    { id: crypto.randomUUID(), name: "Painted plinth", kind: "plinth", enabled: true, order: 0, color: "#24211d", position: vec(0, 0, 0), rotation: vec(0, 0, 0), scale: vec(1, 1, 1), solid: true, overhang: 0 },
    { id: crypto.randomUUID(), name: copy.name, kind: "surface", enabled: true, order: 1, color: copy.surface, position: vec(0, .02, 0), rotation: vec(0, 0, 0), scale: vec(.94, 1, .94), relief: .08, solid: true, overhang: 0 },
    { id: crypto.randomUUID(), name: copy.decoration, kind: "decoration", enabled: true, order: 2, color: copy.accent, position: vec(.24, .05, -.14), rotation: vec(0, 22, 0), scale: vec(.28, .12, .28), density: .45, relief: .12, solid: true, overhang: 0, triangleCount: 360 },
  ];
  if (copy.effect) layers.push({ id: crypto.randomUUID(), name: `${copy.effect.kind} ambience`, kind: "effect", enabled: true, order: 3, position: vec(0, .05, 0), rotation: vec(0, 0, 0), scale: vec(1, 1, 1), overhang: .04, solid: false, effect: { ...copy.effect } });
  return validateBasePlateRecipe({ version: 1, preset, description: description?.trim() || copy.description, visualShape: "inherit", plinthColor: "#24211d", rimColor: copy.accent, plinthHeight: .14, surfaceRelief: .08, footClearance: { source: "fallback-ellipse", radius: .35, dilation: .05 }, layers });
}

export function basePlatePresetName(preset: BasePlatePreset): string { return presetCopy[preset].name; }
export const BASE_PLATE_PRESETS = Object.keys(presetCopy) as BasePlatePreset[];

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function validateBasePlateRecipe(recipe: BasePlateRecipe): BasePlateRecipe {
  let triangleTotal = 0;
  const layers = recipe.layers.slice().sort((a, b) => a.order - b.order).map((layer, order) => {
    const triangles = Math.round(clamp(layer.triangleCount ?? 0, 0, MAX_BASE_LAYER_TRIANGLES));
    const remaining = Math.max(0, MAX_BASE_DECORATION_TRIANGLES - triangleTotal);
    const triangleCount = Math.min(triangles, remaining);
    triangleTotal += triangleCount;
    return {
      ...layer,
      order,
      overhang: clamp(layer.overhang ?? 0, 0, layer.solid ? 0 : MAX_BASE_OVERHANG),
      density: layer.density === undefined ? undefined : clamp(layer.density, 0, 1),
      relief: layer.relief === undefined ? undefined : clamp(layer.relief, 0, .25),
      triangleCount: triangleCount || undefined,
      scale: { x: clamp(layer.scale.x, .02, 1.08), y: clamp(layer.scale.y, .02, 4), z: clamp(layer.scale.z, .02, 1.08) },
      effect: layer.effect ? { ...layer.effect, intensity: clamp(layer.effect.intensity, 0, 2), speed: clamp(layer.effect.speed, 0, 2), particleCount: Math.round(clamp(layer.effect.particleCount ?? 0, 0, 48)) } : undefined,
    };
  });
  return { ...recipe, version: 1, description: recipe.description.trim().slice(0, 700), plinthHeight: clamp(recipe.plinthHeight, .06, .24), surfaceRelief: clamp(recipe.surfaceRelief, 0, .25), footClearance: { ...recipe.footClearance, radius: clamp(recipe.footClearance.radius, .18, .75), dilation: clamp(recipe.footClearance.dilation, 0, .12) }, layers };
}

/** Moves a layer in the persisted render order and normalizes every order value. */
export function reorderBasePlateLayer(recipe: BasePlateRecipe, layerId: string, direction: -1 | 1): BasePlateRecipe {
  const layers = recipe.layers.slice().sort((a, b) => a.order - b.order);
  const from = layers.findIndex((layer) => layer.id === layerId);
  if (from < 0) return validateBasePlateRecipe(recipe);
  if (layers[from].kind === "plinth") return validateBasePlateRecipe(recipe);
  const firstEditable = layers[0]?.kind === "plinth" ? 1 : 0;
  const to = Math.min(layers.length - 1, Math.max(firstEditable, from + direction));
  if (from === to) return validateBasePlateRecipe(recipe);
  const [moved] = layers.splice(from, 1);
  layers.splice(to, 0, moved);
  return validateBasePlateRecipe({ ...recipe, layers: layers.map((layer, order) => ({ ...layer, order })) });
}

/** Removes an editable scenic layer while preserving the rules-locked plinth. */
export function removeBasePlateLayer(recipe: BasePlateRecipe, layerId: string): BasePlateRecipe {
  const target = recipe.layers.find((layer) => layer.id === layerId);
  if (!target || target.kind === "plinth") return validateBasePlateRecipe(recipe);
  return validateBasePlateRecipe({ ...recipe, layers: recipe.layers.filter((layer) => layer.id !== layerId) });
}

export function createBasePlateAsset(name: string, recipe: BasePlateRecipe, source: BasePlateAsset["source"] = "procedural", existing?: BasePlateAsset): BasePlateAsset {
  const now = new Date().toISOString();
  const normalized = validateBasePlateRecipe(recipe);
  const revision = { id: crypto.randomUUID(), recipe: normalized, createdAt: now, prompt: normalized.description };
  return { id: existing?.id ?? `baseplate-${crypto.randomUUID()}`, name: name.trim() || basePlatePresetName(normalized.preset), description: normalized.description, recipe: normalized, source, sourceImageStorageKey: existing?.sourceImageStorageKey, thumbnailStorageKey: existing?.thumbnailStorageKey, revisions: [revision, ...(existing?.revisions ?? [])].slice(0, MAX_BASE_REVISIONS), createdAt: existing?.createdAt ?? now, updatedAt: now };
}

export function basePlateParticleBudget(quality: LightingQuality, reducedMotion: boolean): number {
  if (reducedMotion || quality === "performance") return 0;
  return quality === "balanced" ? 16 : quality === "cinematic" ? 32 : 48;
}

export function basePlateDependencies(asset: BasePlateAsset): { propAssetIds: string[]; materialAssetIds: string[] } {
  return { propAssetIds: [...new Set(asset.recipe.layers.flatMap((layer) => layer.propAssetId ? [layer.propAssetId] : []))], materialAssetIds: [...new Set(asset.recipe.layers.flatMap((layer) => layer.materialAssetId ? [layer.materialAssetId] : []))] };
}

const assigned = (map: BasePlateAssignmentMap | undefined, subject: string): string | undefined => map?.[subject as keyof BasePlateAssignmentMap];

export function resolveBasePlateAssetId(options: { campaign: Campaign; scene?: CampaignScene; token: TokenAsset; entity?: MapEntity; characterId?: string }): string | undefined {
  const { campaign, scene, token, entity } = options;
  const characterId = options.characterId || undefined;
  return (entity && assigned(scene?.basePlateAssignments, `entity:${entity.id}`))
    ?? (characterId && assigned(scene?.basePlateAssignments, `character:${characterId}`))
    ?? assigned(scene?.basePlateAssignments, `token:${token.id}`)
    ?? (characterId && assigned(campaign.basePlateAssignments, `character:${characterId}`))
    ?? assigned(campaign.basePlateAssignments, `token:${token.id}`)
    ?? (entity?.tokenStateId ? token.formBasePlateAssignments?.[token.states?.find((state) => state.id === entity.tokenStateId)?.formId ?? entity.tokenStateId] : undefined)
    ?? token.defaultBasePlateAssetId;
}

export function suggestBasePlatePresets(context: string): BasePlatePreset[] {
  const value = context.toLowerCase();
  const scored = BASE_PLATE_PRESETS.map((preset, index) => {
    const words: Record<BasePlatePreset, string[]> = { pond: ["frog", "pond", "lily", "water"], grass: ["field", "meadow", "peaceful", "monk"], forest: ["forest", "woodland", "ranger"], stone: ["stone", "city", "road"], snow: ["snow", "ice", "winter"], sand: ["desert", "sand", "dune"], swamp: ["swamp", "mire", "bog"], volcanic: ["fire", "lava", "volcano"], tavern: ["tavern", "inn", "barkeep", "woodboard"], dungeon: ["dungeon", "crypt", "vault"], arcane: ["magic", "arcane", "wizard", "enchanted"] };
    return { preset, score: words[preset].reduce((sum, word) => sum + (value.includes(word) ? 3 : 0), 0) - index * .001 };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, 2).map((entry) => entry.preset);
}

export function createBasePlateConcepts(context: string): BasePlateRecipe[] {
  return suggestBasePlatePresets(context).map((preset) => createBasePlateRecipe(preset, context));
}

export interface DerivedFootContactMask {
  source: "mesh-lowest-12" | "fallback-ellipse";
  center: { x: number; z: number };
  radius: number;
  dilation: number;
  sampleCount: number;
}

/** Projects the model's lowest 12 percent of vertices into normalized base space. */
export function deriveFootContactMask(vertices: readonly { x: number; y: number; z: number }[], footprint: number): DerivedFootContactMask {
  if (vertices.length < 3 || footprint <= 0) return { source: "fallback-ellipse", center: { x: 0, z: 0 }, radius: .35, dilation: .05, sampleCount: 0 };
  const ys = vertices.map((vertex) => vertex.y);
  const min = Math.min(...ys), max = Math.max(...ys);
  const threshold = min + (max - min) * .12;
  const samples = vertices.filter((vertex) => vertex.y <= threshold);
  if (!samples.length) return { source: "fallback-ellipse", center: { x: 0, z: 0 }, radius: .35, dilation: .05, sampleCount: 0 };
  const x = samples.reduce((sum, vertex) => sum + vertex.x, 0) / samples.length;
  const z = samples.reduce((sum, vertex) => sum + vertex.z, 0) / samples.length;
  const radius = samples.reduce((largest, vertex) => Math.max(largest, Math.hypot(vertex.x - x, vertex.z - z)), 0) / footprint;
  return { source: "mesh-lowest-12", center: { x: clamp(x / footprint, -.5, .5), z: clamp(z / footprint, -.5, .5) }, radius: clamp(radius + .05, .18, .75), dilation: .05, sampleCount: samples.length };
}
