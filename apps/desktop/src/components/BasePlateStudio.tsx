import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Check, CircleDot, Copy, Edit3, ImagePlus, Layers3, Leaf, LoaderCircle, MapPin, MinusCircle, Mountain, Rotate3D, RotateCcw, Save, Sparkles, Trash2, Upload, WandSparkles, Waves } from "lucide-react";
import { compileScenicBasePlateImagePrompt, designBasePlateConcepts } from "../ai/basePlateDirector";
import { generateBasePlateGlb } from "../ai/basePlate3dClient";
import { loadBundledWorkflow } from "../ai/comfyWorkflowPreset";
import { ensureLocalRuntime, runtimeProgressPercent } from "../ai/localRuntime";
import { generateHostedKreaCandidate, generateLocalPropCandidate, resolvePropImageRoute, type PropImageProvider } from "../ai/propImageClient";
import { BASE_PLATE_PRESETS, basePlatePresetName, createBasePlateAsset, createBasePlateRecipe, removeBasePlateLayer, reorderBasePlateLayer, validateBasePlateRecipe } from "../domain/baseplates";
import type { BasePlateAsset, BasePlateLayer, BasePlatePreset, SceneLightingSettings, TokenBaseShape, TokenKind } from "../domain/types";
import { useCampaignStore } from "../state/campaignStore";
import { GenerationProgress, type GenerationProgressView } from "./GenerationProgress";
import { TokenModelPreview } from "./TokenModelPreview";
import { storeBasePlateBinary } from "../persistence/basePlateAssets";
import { storePropModel } from "../persistence/propAssets";
import { AssetCatalogueDialog } from "./AssetCatalogueDialog";
import { BasePlateAssetPreview } from "./StoredAssetPreview";

type AssignmentLevel = "default" | "form" | "campaign-character" | "campaign-token" | "scene-character" | "scene-token";

interface BasePlateStudioProps {
  model: File | null;
  tokenId?: string | null;
  characterId?: string;
  formId?: string;
  characterName: string;
  kind: TokenKind;
  shape: TokenBaseShape;
  baseColor: string;
  accentColor: string;
  footprint: number;
  modelScale: number;
  placementScale: number;
  lighting: SceneLightingSettings;
  onClose: () => void;
  onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
}

const layerIcon = (layer: BasePlateLayer) => layer.kind === "surface" ? <Mountain size={14} /> : layer.effect?.kind === "water" ? <Waves size={14} /> : layer.kind === "effect" ? <Sparkles size={14} /> : <Leaf size={14} />;
type ScenicConcept = { recipe: ReturnType<typeof createBasePlateRecipe>; file?: File; url?: string };

/** Concept recipes carry direction and safety settings, never fake scenery. */
const removeSyntheticScenery = (recipe: ReturnType<typeof createBasePlateRecipe>) => validateBasePlateRecipe({
  ...recipe,
  layers: recipe.layers.filter((layer) => layer.kind === "plinth" || (layer.kind === "prop" && Boolean(layer.propAssetId))),
});

function FootMaskPainter({ radius, onStored }: { radius: number; onStored: (key: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!painting.current) return;
    const canvas = canvasRef.current, context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * canvas.width, y = (event.clientY - rect.top) / rect.height * canvas.height;
    context.fillStyle = "#ffffff"; context.beginPath(); context.arc(x, y, 13, 0, Math.PI * 2); context.fill();
  };
  const store = () => { painting.current = false; canvasRef.current?.toBlob((blob) => { if (blob) void storeBasePlateBinary(blob, "mask").then(onStored); }, "image/png"); };
  useEffect(() => {
    const context = canvasRef.current?.getContext("2d"); if (!context) return;
    context.clearRect(0, 0, 256, 256); context.fillStyle = "rgba(69,205,126,.34)"; context.beginPath(); context.ellipse(128, 128, radius * 128, radius * 108, 0, 0, Math.PI * 2); context.fill();
  }, [radius]);
  return <canvas ref={canvasRef} width="256" height="256" className="foot-mask-painter" aria-label="Paint protected foot contact area" onPointerDown={(event) => { painting.current = true; event.currentTarget.setPointerCapture(event.pointerId); draw(event); }} onPointerMove={draw} onPointerUp={store} onPointerCancel={store} />;
}

export function BasePlateStudio(props: BasePlateStudioProps) {
  const campaign = useCampaignStore((state) => state.campaign);
  const library = useCampaignStore((state) => state.basePlateLibrary);
  const propLibrary = useCampaignStore((state) => state.propLibrary);
  const materialLibrary = useCampaignStore((state) => state.materialLibrary);
  const saveAsset = useCampaignStore((state) => state.saveBasePlateAsset);
  const savePropAsset = useCampaignStore((state) => state.savePropAsset);
  const addToCampaign = useCampaignStore((state) => state.addBasePlateToCampaign);
  const removeFromCampaign = useCampaignStore((state) => state.removeBasePlateFromCampaign);
  const removeAsset = useCampaignStore((state) => state.removeBasePlateAsset);
  const assignBase = useCampaignStore((state) => state.assignBasePlate);
  const assignTokenBase = useCampaignStore((state) => state.assignTokenBasePlate);
  const updateSettings = useCampaignStore((state) => state.updateSettings);
  const draftKey = `dndrom.baseplateDraft.v1:${campaign.id}:${props.tokenId ?? "new"}`;
  const restored = useMemo(() => { try { return JSON.parse(localStorage.getItem(draftKey) ?? "null") as { name: string; recipe: ReturnType<typeof createBasePlateRecipe> } | null; } catch { return null; } }, [draftKey]);
  const [name, setName] = useState(restored?.name ?? `${props.characterName} scenic base`);
  const [description, setDescription] = useState(restored?.recipe.description ?? `A scenic base that reflects ${props.characterName}'s current adventure.`);
  const [recipe, setRecipe] = useState(restored?.recipe ?? removeSyntheticScenery(createBasePlateRecipe("grass")));
  const [concepts, setConcepts] = useState<ScenicConcept[]>([createBasePlateRecipe("grass"), createBasePlateRecipe("tavern")].map((entry) => ({ recipe: removeSyntheticScenery(entry) })));
  const [selectedConcept, setSelectedConcept] = useState(0);
  const [approved, setApproved] = useState(false);
  const [provider, setProvider] = useState<PropImageProvider>(campaign.settings.propImageProvider ?? "sana-local");
  const [progress, setProgress] = useState<GenerationProgressView | null>(null);
  const [sourceImageStorageKey, setSourceImageStorageKey] = useState<string>();
  const [generatedSource, setGeneratedSource] = useState<BasePlateAsset["source"]>("procedural");
  const [selectedLayerId, setSelectedLayerId] = useState(recipe.layers[1]?.id ?? recipe.layers[0]?.id);
  const [saved, setSaved] = useState<BasePlateAsset | null>(null);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [assignment, setAssignment] = useState<AssignmentLevel>(props.formId ? "form" : "default");
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState<"isometric" | "top">("isometric");
  const abortRef = useRef<AbortController | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);
  const selectedLayer = recipe.layers.find((layer) => layer.id === selectedLayerId);
  const selectedImage = concepts[selectedConcept]?.file;
  const activeScene = campaign.scenes?.find((scene) => scene.id === campaign.activeSceneId);
  const previewBasePlate = useMemo(() => ({ ...createBasePlateAsset("Scenic base preview", recipe), revisions: [] }), [recipe]);
  const hasGeneratedMesh = recipe.layers.some((layer) => layer.kind === "prop" && Boolean(layer.propAssetId));

  useEffect(() => { localStorage.setItem(draftKey, JSON.stringify({ name, recipe: { ...recipe, description } })); }, [description, draftKey, name, recipe]);
  useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const updateLayer = (update: Partial<BasePlateLayer>) => setRecipe((value) => validateBasePlateRecipe({ ...value, layers: value.layers.map((layer) => layer.id === selectedLayerId ? { ...layer, ...update } : layer) }));
  const applyConcept = (index: number) => { const next = concepts[index]?.recipe; if (!next) return; setSelectedConcept(index); setApproved(false); setRecipe(next); setDescription(next.description); setSelectedLayerId(next.layers[1]?.id ?? next.layers[0].id); };
  const setReviewedConcepts = (recipes: ReturnType<typeof createBasePlateRecipe>[], files: File[]) => {
    const next = recipes.slice(0, 2).map((entry, index) => {
      const url = files[index] ? URL.createObjectURL(files[index]) : undefined;
      if (url) objectUrls.current.push(url);
      return { recipe: removeSyntheticScenery(entry), file: files[index], url };
    });
    setConcepts(next); setSelectedConcept(0); setApproved(false);
    if (next[0]) { setRecipe(next[0].recipe); setDescription(next[0].recipe.description); setSelectedLayerId(next[0].recipe.layers[1]?.id ?? next[0].recipe.layers[0].id); }
  };
  const acceptImages = (files: File[]) => {
    const valid = files.filter((file) => file.type.startsWith("image/") && file.size <= 20 * 1024 * 1024).slice(0, 2);
    if (!valid.length) { props.onNotify("Use PNG, JPEG, or WebP images under 20 MB.", "error"); return; }
    const recipes = valid.map((_, index) => index === 0 ? removeSyntheticScenery({ ...recipe, description }) : removeSyntheticScenery(createBasePlateRecipe(recipe.preset, description)));
    setReviewedConcepts(recipes, valid);
    setProgress({ status: "complete", message: "Uploaded concept ready. Approve it before Pixal3D conversion.", percent: 100, startedAt: Date.now(), stageLabel: "Human review required" });
  };
  const suggestFromAdventure = async () => {
    const controller = new AbortController(); abortRef.current = controller;
    const startedAt = Date.now(); setBusy(true); setApproved(false);
    setProgress({ status: "running", message: "Reading the bounded current-adventure context", percent: 12, startedAt, stageLabel: "Prompt direction" });
    try {
      const result = await designBasePlateConcepts({ description, character: props.characterName, location: activeScene?.name, biome: campaign.map.theme, sceneTags: campaign.map.entities.flatMap((entity) => entity.tags ?? []).slice(0, 12), recentEvents: campaign.events.filter((event) => /resolved|travel|encounter/i.test(event.type)).slice(-3).map((event) => event.summary) }, campaign.settings, controller.signal);
      const next = result.recipes.map(removeSyntheticScenery);
      setConcepts(next.map((entry) => ({ recipe: entry })));
      setSelectedConcept(0); setRecipe(next[0]); setDescription(next[0].description); setSelectedLayerId(next[0].layers[0].id);
      setProgress({ status: "complete", message: "Two prompt directions are ready. Generate images when the wording looks right.", percent: 100, startedAt, stageLabel: "Direction ready" });
      props.onNotify(result.warning ? "Prepared safe offline baseplate directions because the configured local language model was unavailable." : "Prepared two baseplate directions from the current adventure.", result.warning ? "warning" : "success");
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      const message = cancelled ? "Adventure suggestion cancelled" : error instanceof Error ? error.message : "Adventure suggestion failed";
      if (!cancelled) props.onNotify(message, "error");
      setProgress(cancelled ? null : { status: "error", message, percent: 0, startedAt, stageLabel: "Suggestion stopped" });
    } finally { if (abortRef.current === controller) abortRef.current = null; setBusy(false); }
  };
  const generateConcepts = async () => {
    const controller = new AbortController(); abortRef.current = controller;
    const startedAt = Date.now(); setBusy(true); setApproved(false);
    try {
      const recipes = [
        removeSyntheticScenery({ ...recipe, description }),
        removeSyntheticScenery({ ...(concepts[1]?.recipe ?? createBasePlateRecipe(recipe.preset, description)), description: concepts[1]?.recipe.description || description }),
      ];
      const prompts = recipes.map(compileScenicBasePlateImagePrompt);
      const generated: File[] = [];
      if (provider === "krea-cloud") {
        setProgress({ status: "running", message: "Submitting two reviewed scenic-base image jobs", percent: 8, startedAt, stageLabel: "Concept images" });
        generated.push(await generateHostedKreaCandidate(prompts[0], controller.signal), await generateHostedKreaCandidate(prompts[1], controller.signal));
      } else {
        if (provider === "krea-local" && !campaign.settings.kreaCommunityLicenseAcceptedAt) throw new Error("Accept the Krea 2 community license under Settings → AI Providers before using the optional local pack");
        const route = resolvePropImageRoute(provider);
        const runtime = await ensureLocalRuntime(route.feature!, (event) => setProgress({ status: "running", message: event.message, percent: Math.max(2, Math.round(runtimeProgressPercent(event) * .18)), startedAt, stageLabel: "Local image pack" }));
        updateSettings({ comfyUiEndpoint: runtime.endpoint, propImageProvider: provider });
        const workflow = await loadBundledWorkflow(route.workflow!);
        for (let index = 0; index < 2; index++) generated.push(await generateLocalPropCandidate(runtime.endpoint, prompts[index], workflow, index, controller.signal, (event) => setProgress({ status: "running", message: event.message, percent: Math.round(20 + index * 35 + event.percent * .34), startedAt, stageLabel: `Scenic image ${index + 1} of 2`, reportedByEngine: event.reportedByEngine })));
      }
      setReviewedConcepts(recipes, generated);
      setProgress({ status: "complete", message: "Two scenic base images are ready. Approve one before creating geometry.", percent: 100, startedAt, stageLabel: "Human review required" });
      props.onNotify("Created two cohesive scenic-base images for review.", "success");
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      const message = cancelled ? "Scenic image generation cancelled" : error instanceof Error ? error.message : "Scenic image generation failed";
      if (!cancelled) props.onNotify(message, "error");
      setProgress(cancelled ? null : { status: "error", message, percent: 0, startedAt, stageLabel: "Generation stopped" });
    } finally { if (abortRef.current === controller) abortRef.current = null; setBusy(false); }
  };
  const createScenicMesh = async () => {
    if (!selectedImage || !approved) { props.onNotify("Approve one scenic image before starting Pixal3D.", "warning"); return; }
    const controller = new AbortController(); abortRef.current = controller;
    const startedAt = Date.now(); setBusy(true);
    try {
      const runtime = await ensureLocalRuntime("characterPixal3d", (event) => setProgress({ status: "running", message: event.message, percent: Math.round(runtimeProgressPercent(event) * .2), startedAt, stageLabel: "Pixal3D setup" }));
      const workflow = await loadBundledWorkflow("/workflows/pixal3d-character.json");
      const glb = await generateBasePlateGlb(runtime.endpoint, selectedImage, workflow, controller.signal, (event) => setProgress({ status: "running", message: event.message, percent: Math.min(96, event.percent), startedAt, stageLabel: "Pixal3D image to 3D", reportedByEngine: event.reportedByEngine }));
      const prompt = compileScenicBasePlateImagePrompt(recipe);
      const prop = await storePropModel(glb, { name: `${name} scenic mesh`, description, source: "pixal3d", profile: "tabletop", acceptedSurfaceTags: ["floor", "tabletop", "stack-top"], providedSurfaces: [], collisionMode: "none", forwardAnchor: { x: 0, y: 0, z: -1 }, behavior: { kind: "static" }, defaultPlacementScale: .8, sourceImage: selectedImage, prompt });
      savePropAsset(prop);
      const imageKey = await storeBasePlateBinary(selectedImage, "source");
      setSourceImageStorageKey(imageKey); setGeneratedSource(provider === "krea-cloud" ? "cloud-ai" : "local-ai");
      setRecipe((value) => {
        const retained = value.layers.filter((layer) => layer.kind === "plinth");
        const meshLayer: BasePlateLayer = { id: crypto.randomUUID(), name: "AI scenic mesh", kind: "prop", enabled: true, order: retained.length, propAssetId: prop.id, position: { x: 0, y: .015, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: .8, y: .8, z: .8 }, solid: false, overhang: .04, triangleCount: Math.min(prop.triangleCount, 6_000) };
        setSelectedLayerId(meshLayer.id);
        return validateBasePlateRecipe({ ...value, layers: [...retained, meshLayer] });
      });
      setProgress({ status: "complete", message: "Pixal3D scenic mesh validated and added as one editable layer.", percent: 100, startedAt, stageLabel: "3D base ready" });
      props.onNotify("The approved image is now a validated scenic base mesh. Save a revision to keep it.", "success");
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      const message = cancelled ? "Scenic mesh generation cancelled" : error instanceof Error ? error.message : "Scenic mesh generation failed";
      if (!cancelled) props.onNotify(message, "error");
      setProgress(cancelled ? null : { status: "error", message, percent: 0, startedAt, stageLabel: "Generation stopped" });
    } finally { if (abortRef.current === controller) abortRef.current = null; setBusy(false); }
  };
  const saveRevision = () => {
    if (!recipe.layers.some((layer) => layer.kind === "prop" && layer.propAssetId)) { props.onNotify("Create the approved concept with Pixal3D before saving this as a finished custom base.", "warning"); return; }
    const asset = { ...createBasePlateAsset(name, { ...recipe, description }, generatedSource, saved ?? undefined), sourceImageStorageKey: sourceImageStorageKey ?? saved?.sourceImageStorageKey };
    saveAsset(asset); setSaved(asset); localStorage.removeItem(draftKey);
    props.onNotify(`Saved ${asset.name} revision ${asset.revisions.length} to the baseplate catalogue.`, "success");
  };
  const confirmAssignment = (target: BasePlateAsset | null = saved) => {
    if (!target) { props.onNotify("Save a revision before assigning this base.", "warning"); return; }
    const dependenciesAvailable = target.recipe.layers.filter((layer) => layer.kind === "prop").every((layer) => layer.propAssetId && propLibrary.some((asset) => asset.id === layer.propAssetId));
    if (!dependenciesAvailable) { props.onNotify("This base is missing its generated 3D mesh. Relink or regenerate it before assignment.", "error"); return; }
    addToCampaign(target.id);
    if ((assignment === "default" || assignment === "form") && !props.tokenId) { props.onNotify("Save the miniature first, then assign its default or form base.", "warning"); return; }
    if (assignment.endsWith("token") && !props.tokenId) { props.onNotify("Save the miniature before using a token-level campaign or scene assignment.", "warning"); return; }
    if (assignment === "form") assignTokenBase(props.tokenId!, target.id, props.formId);
    else if (assignment === "default") assignTokenBase(props.tokenId!, target.id);
    else if (assignment.endsWith("character")) {
      if (!props.characterId) { props.onNotify("Attach a character sheet before using a character-level assignment.", "warning"); return; }
      assignBase(assignment.startsWith("scene") ? "scene" : "campaign", `character:${props.characterId}`, target.id);
    } else assignBase(assignment.startsWith("scene") ? "scene" : "campaign", `token:${props.tokenId}`, target.id);
    setSaved(target);
    props.onNotify(`${target.name} assigned at the ${assignment.replace("-", " ")} level.`, "success");
  };
  const loadAsset = (asset: BasePlateAsset) => { setSaved(asset); setName(asset.name); setDescription(asset.description); setRecipe(structuredClone(asset.recipe)); setSourceImageStorageKey(asset.sourceImageStorageKey); setGeneratedSource(asset.source); setSelectedLayerId(asset.recipe.layers[1]?.id ?? asset.recipe.layers[0]?.id); };
  const moveLayer = (layerId: string, direction: -1 | 1) => setRecipe((value) => reorderBasePlateLayer(value, layerId, direction));
  const deleteLayer = (layerId: string) => setRecipe((value) => {
    const next = removeBasePlateLayer(value, layerId);
    if (selectedLayerId === layerId) setSelectedLayerId(next.layers.find((layer) => layer.kind !== "plinth")?.id ?? next.layers[0]?.id);
    return next;
  });

  return <section className="baseplate-studio" aria-label="Scenic Baseplate Creator">
    <header className="creator-studio-header"><button onClick={props.onClose}><ArrowLeft size={15} /> Character Forge</button><div><span className="eyebrow"><CircleDot size={13} /> Scenic baseplate creator</span><h1>Build a physical story beneath the miniature</h1><p>Generate a cohesive image, approve it, then let Pixal3D build the scenic geometry.</p></div><button className="forge-catalogue-button" onClick={() => setCatalogueOpen(true)}><BookOpen size={14} /><span>Baseplate catalogue</span><small>{library.length} saved</small></button></header>
    <div className="baseplate-layout">
      <aside className="baseplate-panel fantasy-panel">
        <h2>Concept image</h2><label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Describe the complete base<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} /></label>
        <label>Starting terrain<select value={recipe.preset} onChange={(event) => { const next = removeSyntheticScenery(createBasePlateRecipe(event.target.value as BasePlatePreset, description)); setRecipe(next); setSelectedLayerId(next.layers[0]?.id); }}>{BASE_PLATE_PRESETS.map((preset) => <option key={preset} value={preset}>{basePlatePresetName(preset)}</option>)}</select></label>
        <button disabled={busy} onClick={() => void suggestFromAdventure()}><Sparkles size={15} /> Use current adventure as prompt</button>
        <button className="primary-button" disabled={busy} onClick={() => void generateConcepts()}><WandSparkles size={15} /> {busy ? "Generating two concept images…" : "Generate two 3D-ready concepts"}</button>
        <label>Image provider<select value={provider} onChange={(event) => { const next = event.target.value as PropImageProvider; setProvider(next); updateSettings({ propImageProvider: next }); }}><option value="sana-local">Sana 1.5 Lite - local</option><option value="krea-local">Krea 2 Turbo - local high-end</option><option value="krea-cloud">Krea API - hosted / separate billing</option></select></label>
        <button onClick={() => uploadRef.current?.click()}><Upload size={15} /> Upload scenic concept</button><input ref={uploadRef} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => acceptImages([...event.target.files ?? []])} />
        {busy && <button onClick={() => abortRef.current?.abort()}>Cancel current job</button>}
        <small className="forge-guidance">AI creates the whole base as one intentional composition. You approve an image before Pixal3D runs. Hosted providers receive only this explicit base description.</small>
      </aside>
      <main className={`baseplate-stage fantasy-panel camera-${camera}`}>
        <div className="baseplate-camera-tabs"><button className={camera === "isometric" ? "active" : ""} onClick={() => setCamera("isometric")}>Isometric</button><button className={camera === "top" ? "active" : ""} onClick={() => setCamera("top")}>Top + clearance</button></div>
        <TokenModelPreview model={props.model} kind={props.kind} shape={props.shape} baseColor={props.baseColor} accentColor={props.accentColor} footprint={props.footprint} modelScale={props.modelScale} placementScale={props.placementScale} lighting={props.lighting} basePlate={previewBasePlate} cameraMode={camera} propAssets={propLibrary} materialAssets={materialLibrary} />
        {camera === "top" && recipe.footClearance.source === "manual" ? <FootMaskPainter radius={recipe.footClearance.radius} onStored={(maskStorageKey) => setRecipe((value) => ({ ...value, footClearance: { ...value.footClearance, maskStorageKey } }))} /> : camera === "top" && <div className="foot-clearance-overlay" style={{ width: `${recipe.footClearance.radius * 100}%`, aspectRatio: "1" }} aria-label="Protected foot clearance mask" />}
        <div className="foot-clearance-legend"><span /><strong>Protected foot anchor</strong><small>Lowest 12% of mesh, 5% dilation; central 35% fallback shown</small></div>
        <div className="baseplate-concepts" aria-label="Scenic image concepts">{concepts.map((concept, index) => <button key={`${concept.recipe.preset}-${index}`} className={selectedConcept === index ? "active" : ""} onClick={() => applyConcept(index)}>{concept.url ? <img src={concept.url} alt={`Scenic base concept ${index + 1}`} /> : <span className="concept-empty"><ImagePlus size={18} /></span>}<strong>Concept {index + 1}: {basePlatePresetName(concept.recipe.preset)}</strong><small>{concept.url ? "Generated image ready for review" : "Generate or upload an image"}</small></button>)}</div>
        {selectedImage && <div className="baseplate-image-review"><img src={concepts[selectedConcept].url} alt="Selected scenic base concept" /><div><button className={approved ? "approved" : "primary-button"} onClick={() => setApproved((value) => !value)}><Check size={15} /> {approved ? "Approved for Pixal3D" : "Approve this image"}</button><button disabled={!approved || busy} onClick={() => void createScenicMesh()}><Rotate3D size={15} /> Create scenic base in 3D</button></div></div>}
        {progress && <GenerationProgress value={progress} label="Scenic baseplate generation progress" />}
      </main>
      <aside className="baseplate-panel fantasy-panel">
        <div className="layer-heading"><h2><Layers3 size={15} /> Base components</h2><span className="ai-mesh-badge"><Sparkles size={13} /> AI mesh</span></div>
        <div className="baseplate-layer-list functional-layer-list">{recipe.layers.map((layer, index) => <div key={layer.id} className={selectedLayerId === layer.id ? "active" : ""}><button className="layer-select" title={`Edit ${layer.name}`} onClick={() => setSelectedLayerId(layer.id)}>{layerIcon(layer)}<span><strong>{layer.name}</strong><small>{layer.kind}{layer.materialAssetId ? " - PBR" : ""}{layer.propAssetId ? " - generated mesh" : ""}</small></span></button><button className="layer-order" disabled={layer.kind === "plinth" || index <= 1} aria-label={`Move ${layer.name} up`} title={layer.kind === "plinth" ? "The gameplay plinth is rules-locked" : "Move layer up"} onClick={() => moveLayer(layer.id, -1)}><ArrowUp size={11} /></button><button className="layer-order" disabled={layer.kind === "plinth" || index === recipe.layers.length - 1} aria-label={`Move ${layer.name} down`} title={layer.kind === "plinth" ? "The gameplay plinth is rules-locked" : "Move layer down"} onClick={() => moveLayer(layer.id, 1)}><ArrowDown size={11} /></button><button className="layer-remove" disabled={layer.kind === "plinth"} aria-label={`Remove ${layer.name}`} title={layer.kind === "plinth" ? "The gameplay plinth is rules-locked" : "Remove layer"} onClick={() => deleteLayer(layer.id)}><Trash2 size={11} /></button></div>)}</div>
        {selectedLayer && <fieldset className="baseplate-layer-editor"><legend>{layerIcon(selectedLayer)} {selectedLayer.name}</legend><label>Layer name<input value={selectedLayer.name} onChange={(event) => updateLayer({ name: event.target.value })} /></label>{selectedLayer.color && <label>Paint color<input type="color" value={selectedLayer.color} onChange={(event) => updateLayer({ color: event.target.value })} /></label>}{selectedLayer.kind === "surface" && <label>Reusable material<select value={selectedLayer.materialAssetId ?? ""} onChange={(event) => updateLayer({ materialAssetId: event.target.value || undefined })}><option value="">Procedural painted surface</option>{materialLibrary.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>}{selectedLayer.kind === "decoration" && <label>Reusable prop<select value={selectedLayer.propAssetId ?? ""} onChange={(event) => updateLayer({ propAssetId: event.target.value || undefined, kind: event.target.value ? "prop" : "decoration" })}><option value="">Procedural detail</option>{propLibrary.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>}{selectedLayer.density !== undefined && <label>Density <span>{Math.round(selectedLayer.density * 100)}%</span><input type="range" min="0" max="1" step=".05" value={selectedLayer.density} onChange={(event) => updateLayer({ density: Number(event.target.value) })} /></label>}{selectedLayer.relief !== undefined && <label>Relief <span>{selectedLayer.relief.toFixed(2)}</span><input type="range" min="0" max=".25" step=".01" value={selectedLayer.relief} onChange={(event) => updateLayer({ relief: Number(event.target.value) })} /></label>}{selectedLayer.effect && <><label>Effect type<select value={selectedLayer.effect.kind} onChange={(event) => updateLayer({ effect: { ...selectedLayer.effect!, kind: event.target.value as typeof selectedLayer.effect.kind } })}><option value="water">Water normals</option><option value="foliage">Grass sway</option><option value="motes">Motes</option><option value="petals">Petals</option><option value="glow">Glow</option></select></label><label>Motion speed<input type="range" min="0" max="2" step=".05" value={selectedLayer.effect.speed} onChange={(event) => updateLayer({ effect: { ...selectedLayer.effect!, speed: Number(event.target.value) } })} /></label></>}</fieldset>}
        <fieldset><legend>Plinth & safety</legend><div className="token-color-row"><label>Plinth<input type="color" value={recipe.plinthColor} onChange={(event) => setRecipe((value) => ({ ...value, plinthColor: event.target.value }))} /></label><label>Rim<input type="color" value={recipe.rimColor} onChange={(event) => setRecipe((value) => ({ ...value, rimColor: event.target.value }))} /></label></div><label>Visual shape<select value={recipe.visualShape} onChange={(event) => setRecipe((value) => ({ ...value, visualShape: event.target.value as typeof value.visualShape }))}><option value="inherit">Inherit rules shape</option><option value="round">Round</option><option value="square">Square</option><option value="hex">Hex</option></select></label><label>Foot mask<select value={recipe.footClearance.source} onChange={(event) => setRecipe((value) => ({ ...value, footClearance: { ...value.footClearance, source: event.target.value as typeof value.footClearance.source } }))}><option value="mesh-lowest-12">Derive from lowest 12%</option><option value="fallback-ellipse">Central ellipse</option><option value="manual">Manual painted mask</option></select></label><label>Protected radius <span>{Math.round(recipe.footClearance.radius * 100)}%</span><input type="range" min=".18" max=".75" step=".01" value={recipe.footClearance.radius} onChange={(event) => setRecipe((value) => ({ ...value, footClearance: { ...value.footClearance, radius: Number(event.target.value) } }))} /></label>{recipe.footClearance.source === "manual" && <button title="The mask is stored locally with this baseplate"><CircleDot size={14} /> Paint mask in top view</button>}<small>Collision remains {props.shape}, {props.footprint.toFixed(2)} m. Solid layers are clipped inside it; non-solid overhang is capped at 8%.</small></fieldset>
        <fieldset><legend>Save & assign</legend><label>Assignment level<select value={assignment} onChange={(event) => setAssignment(event.target.value as AssignmentLevel)}><option value="default">Token default</option><option value="form">Current form</option><option value="campaign-character">Campaign character</option><option value="campaign-token">Campaign token</option><option value="scene-character">Scene character</option><option value="scene-token">Scene token</option></select></label><div className="baseplate-save-actions"><button disabled={!hasGeneratedMesh} title={hasGeneratedMesh ? "Save this generated mesh and recipe" : "Approve an image and create its Pixal3D mesh first"} onClick={saveRevision}><Save size={14} /> Save revision</button><button onClick={() => { setSaved(null); setName(`${name} copy`); }}><Copy size={14} /> Duplicate</button><button disabled={!saved?.revisions[1]} onClick={() => { const revision = saved?.revisions[1]; if (revision) setRecipe(structuredClone(revision.recipe)); }}><RotateCcw size={14} /> Restore</button><button className="primary-button" disabled={!saved || !hasGeneratedMesh} onClick={() => confirmAssignment()}><Check size={14} /> Confirm assignment</button></div></fieldset>
      </aside>
    </div>
    {catalogueOpen && <AssetCatalogueDialog
      ariaLabel="Baseplate catalogue"
      eyebrow={<><BookOpen size={13} /> Local scenic baseplate catalogue</>}
      title="Choose a saved baseplate"
      description="Search your reusable scenic bases, preview their approved concept art, reopen one for editing, or assign it at the selected character level."
      searchPlaceholder="Search baseplates, terrain, or descriptions"
      onClose={() => setCatalogueOpen(false)}
      empty={<div className="miniature-library-empty"><CircleDot size={28} /><strong>No saved baseplates yet</strong><small>Generate a scenic concept, approve its 3D mesh, and save a revision.</small></div>}
      items={library.map((asset) => {
        const inCampaign = Boolean(campaign.basePlateAssets?.some((entry) => entry.id === asset.id));
        return {
          id: asset.id,
          name: asset.name,
          searchText: `${asset.description} ${asset.recipe.preset} ${asset.source}`,
          preview: <BasePlateAssetPreview asset={asset} />,
          details: <>{basePlatePresetName(asset.recipe.preset)} · {asset.revisions.length} revisions · {asset.source}</>,
          active: saved?.id === asset.id,
          inCampaign,
          actions: <><button onClick={() => { loadAsset(asset); setCatalogueOpen(false); }}><Edit3 size={14} /> Open in editor</button><button className="primary-button" onClick={() => { confirmAssignment(asset); setCatalogueOpen(false); }}><MapPin size={14} /> Use for this character</button>{inCampaign ? <button className="remove-campaign-token" onClick={() => removeFromCampaign(asset.id)}><MinusCircle size={14} /> Remove from campaign</button> : <button onClick={() => addToCampaign(asset.id)}><Check size={14} /> Add to campaign</button>}<button className="catalogue-delete-button" onClick={() => removeAsset(asset.id)}><Trash2 size={14} /> Delete saved base</button></>,
          status: inCampaign ? <span className="campaign-token-status"><Check size={12} /> In campaign</span> : undefined,
        };
      })}
    />}
  </section>;
}
