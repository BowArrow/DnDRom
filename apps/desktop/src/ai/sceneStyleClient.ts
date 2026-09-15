import { prepareLanguageSettings } from "./managedLanguage";
import { isTauri } from "../platform/desktop";
import { z } from "zod";
import { applySceneMaterials, worldMaterialRoleSchema } from "../domain/sceneGrammar";
import { deriveMaterialMaps } from "../domain/materialProcessing";
import type { CampaignSettings, GameMap, MaterialAsset, PropAsset, WorldMaterialRole } from "../domain/types";
import { storeMaterialMap } from "../persistence/materialAssets";
import { storePropModel } from "../persistence/propAssets";
import { completeLocalChat, extractJson, assertLocalAiEndpoint } from "./openAiClient";
import { generateLocalPropCandidate } from "./propImageClient";
import { loadBundledWorkflow } from "./comfyWorkflowPreset";
import { ensureLocalRuntime, type LocalRuntimeFeature } from "./localRuntime";
import { generateCharacterGlb } from "./character3dClient";
import { compileMaterialPrompt, compileObjectPropPrompt } from "./propPrompt";
import { sampleTerrainHeight } from "../domain/worldProcedural";
import { releaseComfyMemory } from "./splatKitClient";

export const sceneStylePlanSchema = z.object({
  materials: z.array(z.object({ role: worldMaterialRoleSchema, description: z.string().min(1).max(900), materialClass: z.enum(["wood", "stone", "metal", "painted", "fabric", "general"]) })).length(5),
  props: z.array(z.object({ name: z.string().min(1).max(100), description: z.string().min(1).max(900), x: z.number(), z: z.number(), height: z.number().min(.2).max(12) })).max(3),
}).superRefine((value, ctx) => { if (new Set(value.materials.map((item) => item.role)).size !== 5) ctx.addIssue({ code: "custom", message: "Each surface role must appear exactly once" }); });
export type SceneStylePlan = z.infer<typeof sceneStylePlanSchema>;

export async function prepareStyleReference(file: File): Promise<{ file: File; dataUrl: string }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 20 * 1024 * 1024 || !file.size) throw new Error("Use PNG, JPEG or WebP references under 20 MB");
  const bitmap = await createImageBitmap(file), canvas = document.createElement("canvas");
  const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const dataUrl = canvas.toDataURL("image/png");
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Reference encoding failed")), "image/png"));
  return { file: new File([blob], file.name, { type: "image/png" }), dataUrl };
}

export async function planSceneStyle(map: GameMap, instruction: string, settings: CampaignSettings, references: Array<{ dataUrl: string }> = [], signal?: AbortSignal): Promise<{ plan: SceneStylePlan; warning?: string }> {
  settings = await prepareLanguageSettings(settings, signal);
  const materialDefaults = { ground: ["Layered earth, grass and worn paths", "general"], masonry: ["Weathered structural stone and plaster", "stone"], timber: ["Architectural timber and bark", "wood"], roof: ["Roofing surface with small repeating tiles", "stone"], foliage: ["Dense natural foliage surface", "general"] } as const;
  const fallback = sceneStylePlanSchema.parse({ materials: Object.entries(materialDefaults).map(([role, [description, materialClass]]) => ({ role, description: `${description}. Art direction: ${instruction}`, materialClass })), props: [] });
  if (!settings.useLocalAiForMaps || !settings.localAiEndpoint.trim()) return { plan: fallback, warning: "Surface prompts use your instruction directly. A local language model is needed to interpret custom prop requests." };
  try {
    const context = JSON.stringify({ instruction, scene: map.generation?.blueprint.description ?? map.name, composition: map.generation?.blueprint.composition?.design, dimensions: [map.width, map.depth], schema: z.toJSONSchema(sceneStylePlanSchema) });
    const result = await completeLocalChat({ endpoint: settings.localAiEndpoint, model: settings.localAiModel, responseSchema: z.toJSONSchema(sceneStylePlanSchema), signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(120_000)]), temperature: .4, maxTokens: 3500, messages: [
      { role: "system", content: "You art-direct an editable fantasy scene. Return JSON matching the supplied schema, with exactly one material for each of ground,masonry,timber,roof,foliage. Describe distinct seamless albedo surfaces that share the requested art style, palette, culture and weathering. Images are visual style references: extract their palette, brushwork, pattern and material character, not their screen layout. Include up to three distinctive props only when requested, with descriptions suitable for isolated image-to-3D and safe positions inside the world. Do not claim to change structural geometry through textures." },
      { role: "user", content: references.length ? [{ type: "text", text: context }, ...references.map(({ dataUrl }) => ({ type: "image_url" as const, image_url: { url: dataUrl } }))] : context },
    ] });
    const plan = sceneStylePlanSchema.parse(extractJson(result));
    if (plan.props.some((prop) => Math.abs(prop.x) > map.width / 2 - 4 || Math.abs(prop.z) > map.depth / 2 - 4)) throw new Error("A prop was placed outside the scene");
    return { plan };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { plan: fallback, warning: `Style interpretation failed; using your text with image conditioning. ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function runtimeEndpoint(feature: LocalRuntimeFeature, settings: CampaignSettings, signal: AbortSignal, progress: (message: string) => void): Promise<string> {
  signal.throwIfAborted();
  if (isTauri()) {
    const runtime = await ensureLocalRuntime(feature, (event) => progress(event.message));
    signal.throwIfAborted(); return runtime.endpoint;
  }
  const endpoint = assertLocalAiEndpoint(settings.comfyUiEndpoint || "http://127.0.0.1:8189");
  const response = await fetch(`${endpoint}/system_stats`, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
  if (!response.ok) throw new Error("Start your local ComfyUI runtime to generate scene materials and props");
  return endpoint;
}

export interface SceneStyleOptions {
  map: GameMap; instruction: string; references: File[]; settings: CampaignSettings; signal: AbortSignal;
  onProgress: (message: string, percent: number) => void;
  saveMaterial: (asset: MaterialAsset) => void; saveProp: (asset: PropAsset) => void;
  onPreview: (map: GameMap) => void;
}

export async function restyleScene(options: SceneStyleOptions): Promise<{ map: GameMap; warnings: string[] }> {
  const { signal, onProgress, settings } = options;
  signal.throwIfAborted();
  const references = await Promise.all(options.references.slice(0, 3).map(prepareStyleReference));
  onProgress("Interpreting style, surfaces and requested props", 3);
  const { plan, warning } = await planSceneStyle(options.map, options.instruction, settings, references, signal);
  const warnings = warning ? [warning] : [];
  const endpoint = await runtimeEndpoint(references.length ? "propImageKrea" : "propImageLite", settings, signal, (message) => onProgress(message, 6));
  const usedEndpoints = new Set([endpoint]);
  try {
  const workflow = await loadBundledWorkflow(references.length ? "/workflows/prop-krea-reference.json" : "/workflows/prop-sana-reference.json");
  const bindings: Partial<Record<WorldMaterialRole, string>> = {};
  let result = options.map;
  for (const [index, material] of plan.materials.entries()) {
    signal.throwIfAborted();
    const prompt = compileMaterialPrompt(material.description, "general");
    const reference = references[index % Math.max(1, references.length)]?.file;
    const image = await generateLocalPropCandidate(endpoint, prompt, workflow, index, signal, (event) => onProgress(`${material.role}: ${event.message}`, 8 + index * 14 + event.percent * .12), reference, true);
    signal.throwIfAborted();
    onProgress(`Building ${material.role} albedo, normal, roughness, metallic and AO maps`, 19 + index * 14);
    const maps = await deriveMaterialMaps(image, material.materialClass, .7);
    const stored = { albedo: await storeMaterialMap(maps.albedo), normal: await storeMaterialMap(maps.normal), roughness: await storeMaterialMap(maps.roughness), metallic: await storeMaterialMap(maps.metallic), ambientOcclusion: await storeMaterialMap(maps.ambientOcclusion) };
    signal.throwIfAborted();
    const now = new Date().toISOString();
    const asset: MaterialAsset = { id: `material-custom-${crypto.randomUUID()}`, name: `${material.role} · ${options.instruction.slice(0, 60)}`, description: material.description, target: "general", materialClass: material.materialClass, maps: stored, projection: "uv", scale: .65, rotation: 0, normalStrength: .7, roughness: 1, metallic: material.materialClass === "metal" ? 1 : 0, seamScore: maps.seamScore, source: "local-ai", prompt, revisions: [{ id: crypto.randomUUID(), maps: stored, createdAt: now, prompt }], createdAt: now, updatedAt: now };
    options.saveMaterial(asset); bindings[material.role] = asset.id;
    result = applySceneMaterials(result, bindings); options.onPreview(result);
  }
  if (plan.props.length) {
    // Image and 3D work are sequential, keeping a single GPU job resident.
    const images: File[] = [];
    for (const [index, prop] of plan.props.entries()) {
      images.push(await generateLocalPropCandidate(endpoint, compileObjectPropPrompt(`${prop.description}. ${options.instruction}`), workflow, 10 + index, signal, (event) => onProgress(`${prop.name}: ${event.message}`, 80 + index * 2), references[0]?.file));
    }
    const meshEndpoint = await runtimeEndpoint("characterPixal3d", settings, signal, (message) => onProgress(message, 86));
    usedEndpoints.add(meshEndpoint);
    const meshWorkflow = await loadBundledWorkflow("/workflows/pixal3d-character.json");
    for (const [index, prop] of plan.props.entries()) {
      signal.throwIfAborted();
      const glb = await generateCharacterGlb(meshEndpoint, images[index], meshWorkflow, { provider: "pixal3d", targetFaces: 8000, assetLabel: "scene prop" }, signal, (event) => onProgress(`${prop.name}: ${event.message}`, 86 + index * 4 + event.percent * .03));
      signal.throwIfAborted();
      const asset = await storePropModel(glb, { name: prop.name, description: prop.description, source: "pixal3d", profile: "floor-standing", acceptedSurfaceTags: ["floor"], providedSurfaces: [], collisionMode: "solid", forwardAnchor: { x: 0, y: 0, z: -1 }, behavior: { kind: "static" }, sourceImage: images[index], prompt: prop.description });
      signal.throwIfAborted();
      options.saveProp(asset);
      const terrain = result.entities.find((entity) => entity.worldGeometry?.kind === "terrain" && prop.x >= entity.worldGeometry.originX && prop.x < entity.worldGeometry.originX + entity.worldGeometry.size && prop.z >= entity.worldGeometry.originZ && prop.z < entity.worldGeometry.originZ + entity.worldGeometry.size);
      const y = terrain?.worldGeometry?.kind === "terrain" ? sampleTerrainHeight(terrain.worldGeometry, prop.x, prop.z) : 0;
      const scale = Math.min(12, prop.height / Math.max(.01, asset.bounds.max.y - asset.bounds.min.y));
      const entity = { id: crypto.randomUUID(), assetId: asset.id, name: prop.name, position: { x: prop.x, y, z: prop.z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: scale, y: scale, z: scale }, chunkId: terrain?.chunkId, tags: ["world:generated-prop"] };
      result = { ...result, entities: [...result.entities, entity], world: result.world ? { ...result.world, chunks: result.world.chunks.map((chunk) => chunk.id === entity.chunkId ? { ...chunk, entityIds: [...chunk.entityIds, entity.id] } : chunk) } : undefined };
      options.onPreview(result);
    }
  }
  onProgress("Scene materials and requested props are ready", 100);
  return { map: result, warnings };
  } finally {
    // Finished image weights otherwise displace the language model on the next
    // spoken request. Release only runtimes used by this serialized scene job.
    await Promise.allSettled([...usedEndpoints].map(releaseComfyMemory));
  }
}
