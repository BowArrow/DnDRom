import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Check, Cpu, Download, ExternalLink, Globe2, Image, Layers3, Lightbulb, LoaderCircle, Map, Network, Plus, RotateCcw, Search, ShieldCheck, Sparkles, Trash2, Upload, WandSparkles } from "lucide-react";
import { downloadPolyHavenPanorama, fetchPolyHavenHdris, type PolyHavenHdri } from "../ai/polyHavenClient";
import { configurePanoramaPreset, loadBundledWorkflow, materializeComfyWorkflow, type ComfyWorkflowPreset } from "../ai/comfyWorkflowPreset";
import { ensureLocalRuntime, findLatestLocalTrainedWorld, findLatestLocalWorldDataset, formatRuntimeBytes, getLocalRuntimeStatus, readLocalRuntimeFile, restartLocalRuntime, runtimeProgressPercent, trainLocalWorld } from "../ai/localRuntime";
import { needsRuntimeSplatCompression, optimizeWorldSplatForRuntime, partitionWorldSplatForStreaming } from "../ai/worldSplatOptimizer";
import {
  assertComfyNodeResponsive,
  cancelComfyPrompt,
  createQuickPanoramaWorkflow,
  createSplatKitDepthPreflightWorkflow,
  createSplatKitSfmRecoveryWorkflow,
  downloadComfyOutput,
  listComfyCheckpoints,
  isRecoverableSplatKitMappingFailure,
  monitorComfyWorkflow,
  parseSplatKitCoverageDecision,
  parseSplatKitReconstructionMetrics,
  preparePanoramaWorkflow,
  prepareSplatKitWorkflow,
  queueComfyWorkflow,
  releaseComfyMemory,
  selectSplatKitWorkflowPaths,
  selectSplatKitCompatiblePaths,
  selectSplatKitDatasetPath,
  testComfyUi,
  uploadComfyImage,
  waitForComfyPrompt,
  type ComfyWorkflow,
} from "../ai/splatKitClient";
import { readLocalAiSettings, worldWanBudget, writeLocalAiSettings } from "../domain/localAiSettings";
import { MIN_GENERATED_WORLD_SPLATS, assessGeneratedWorldSplat, assessSplatReconstructionQuality, assertGeneratedWorldSplatQuality, inspectSplatFile, storeSplatFile, type SplatInspection } from "../persistence/splatAssets";
import { clearCreatorDraft, clearCreatorDraftFiles, readCreatorDraft, readCreatorDraftFile, writeCreatorDraft, writeCreatorDraftFile, type SceneForgeDraft } from "../persistence/creatorDrafts";
import { useCampaignStore } from "../state/campaignStore";
import { EMPTY_TOKEN_ASSETS } from "../state/selectors";
import { selectTokenAssets } from "../state/selectors";
import { beginGenerationJob, dismissFailedGenerationJobs, updateGenerationJob, waitForGenerationJobTurn } from "../state/generationJobs";
import { SceneViewport } from "./SceneViewport";
import { resolveSceneLighting } from "../domain/lighting";
import { generateWorldBlueprints } from "../ai/mapDirector";
import { compileWorldBlueprintAsync } from "../domain/worldForgeWorkerClient";
import { createSceneTemplate, WORLD_GENERATOR_REVISION } from "../domain/worldForge";
import { buildNavigationGrid, createHeightfield } from "../domain/worldProcedural";
import { applyApprovedWorldRefinements, approveWorldRefinement, planWorldRefinements } from "../domain/worldRefinements";
import { clearWorldGenerationCheckpoint, readWorldGenerationCheckpoint, storeWorldBinary, storeWorldBlueprint, writeWorldGenerationCheckpoint } from "../persistence/worldAssets";
import { AssetCatalogueDialog } from "./AssetCatalogueDialog";
import type { GameMap, LightingMood, LightingQuality, SplatQualityReport, SplatReconstructionMetrics, WorldBiomeSpec, WorldBlueprintV1, WorldForgeQuality, WorldRegionKind, WorldRegionSize } from "../domain/types";

interface WorldSplatPanelProps {
  onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
  onBack: () => void;
  onOpenPropForge?: (request: { name: string; description: string; kind: "object" | "material" }) => void;
}

type PanoramaSource = "prompt" | "library" | "upload";

const PANORAMA_WORKFLOW_KEY = "dndrom.scenery.panoramaWorkflow.v1";
const DATASET_WORKFLOW_KEY = "dndrom.scenery.datasetWorkflow.v1";
const formatBytes = (bytes: number): string => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

const OFFLINE_SCENE_IDEAS = [
  { name: "Moonlit harbor", tags: "coast city night mystery", prompt: "A moonlit medieval harbor enclosed by weathered stone warehouses, wet docks reflecting lantern light, ships beyond a sea wall, navigable alleys, cinematic blue hour", palette: "#173248,#a8824b" },
  { name: "Ancient forest shrine", tags: "forest ruins magic nature", prompt: "An ancient moss-covered forest shrine beneath enormous old-growth trees, broken statues, a circular clearing, soft shafts of morning light, multiple paths through dense woodland", palette: "#183b2b,#879c65" },
  { name: "Mountain citadel", tags: "mountain fortress snow city", prompt: "A fortified mountain citadel carved into dark cliffs above snowy valleys, bridges, courtyards and watchtowers, crisp dawn light, grand fantasy scale", palette: "#394654,#c3bda9" },
  { name: "Desert caravanserai", tags: "desert town market warm", prompt: "A bustling desert caravanserai surrounding a shaded market courtyard, sandstone arcades, colorful cloth awnings, distant dunes and caravan trails, late afternoon sun", palette: "#8f5a32,#dfb56f" },
  { name: "Sunken temple", tags: "swamp ruins water danger", prompt: "A partially sunken temple in a misty green marsh, vine-covered columns rising from dark water, wooden walkways and hidden entrances, overcast atmospheric light", palette: "#29443c,#788866" },
  { name: "Feywild village", tags: "village whimsical magic flowers", prompt: "A whimsical woodland village built among giant luminous flowers and twisting roots, tiny bridges, warm windows, drifting motes and twilight violet skies", palette: "#4b315d,#c27e91" },
  { name: "Volcanic observatory", tags: "lava tower dramatic dungeon", prompt: "An arcane observatory on a volcanic caldera, black stone platforms, brass instruments, lava channels and a storm-lit sky, dramatic but readable pathways", palette: "#3b2223,#d26c35" },
  { name: "Frozen fishing town", tags: "snow coast village winter", prompt: "A remote frozen fishing town beside a dark arctic sea, timber houses, snow-packed lanes, boats trapped in ice and warm smoke-lit windows, polar twilight", palette: "#294254,#8fb0bd" },
  { name: "Underground crystal city", tags: "cavern city crystal underdark", prompt: "A vast underground city built around luminous crystal formations, terraces and suspended bridges crossing a deep cavern, cool magical illumination", palette: "#272c52,#6e8ec7" },
  { name: "Pastoral crossroads", tags: "plains tavern village daylight", prompt: "A pastoral countryside crossroads with a welcoming timber inn, farms, stone walls and roads leading toward distant villages, bright spring morning", palette: "#637b43,#c6a267" },
  { name: "Gothic capital", tags: "city dark gothic rain", prompt: "A dense gothic capital square in the rain, cathedral spires, narrow streets, covered markets and torchlit archways, dramatic cloud cover", palette: "#292b34,#786154" },
  { name: "Floating sky ruins", tags: "sky ruins fantasy islands", prompt: "Ancient ruins spread across floating islands above a sea of clouds, rope bridges, waterfalls falling into open sky and a central shattered temple, golden sunrise", palette: "#6e92ac,#d9b77a" },
] as const;

const parseWorkflowText = (text: string): ComfyWorkflowPreset => {
  const parsed = JSON.parse(text) as { prompt?: unknown } | unknown;
  const candidate = parsed && typeof parsed === "object" && "prompt" in parsed && (parsed as { prompt?: unknown }).prompt
    ? (parsed as { prompt: unknown }).prompt
    : parsed;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Workflow JSON is invalid");
  return candidate as ComfyWorkflowPreset;
};

const readCachedWorkflow = (key: string): ComfyWorkflowPreset | null => {
  try {
    const value = window.localStorage.getItem(key);
    return value ? parseWorkflowText(value) : null;
  } catch {
    return null;
  }
};

export function WorldSplatPanel({ onNotify, onBack, onOpenPropForge }: WorldSplatPanelProps) {
  const campaign = useCampaignStore((state) => state.campaign);
  const tokenAssets = useCampaignStore(selectTokenAssets);
  const savedDraft = useMemo(() => readCreatorDraft<SceneForgeDraft>(campaign.id, "scene"), [campaign.id]);
  const [panorama, setPanorama] = useState<File | null>(null);
  const [panoramaWorkflow, setPanoramaWorkflow] = useState<ComfyWorkflowPreset | null>(() => readCachedWorkflow(PANORAMA_WORKFLOW_KEY));
  const [datasetWorkflow, setDatasetWorkflow] = useState<ComfyWorkflowPreset | null>(() => readCachedWorkflow(DATASET_WORKFLOW_KEY));
  const [panoramaWorkflowName, setPanoramaWorkflowName] = useState(() => readCachedWorkflow(PANORAMA_WORKFLOW_KEY) ? "Saved API workflow" : "Optional quality workflow");
  const [datasetWorkflowName, setDatasetWorkflowName] = useState(() => readCachedWorkflow(DATASET_WORKFLOW_KEY) ? "Saved SplatKit workflow" : "SplatKit API workflow");
  const [sourceMode, setSourceMode] = useState<PanoramaSource>(savedDraft?.sourceMode ?? "prompt");
  const [ideaSearch, setIdeaSearch] = useState("");
  const [librarySearch, setLibrarySearch] = useState("");
  const [catalog, setCatalog] = useState<PolyHavenHdri[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLimit, setCatalogLimit] = useState(24);
  const [selectedHdriId, setSelectedHdriId] = useState(savedDraft?.selectedHdriId ?? "");
  const [description, setDescription] = useState(savedDraft?.description ?? "");
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [checkpoint, setCheckpoint] = useState("");
  const [status, setStatus] = useState("Ready");
  const [running, setRunning] = useState(false);
  const [worldPlanning, setWorldPlanning] = useState(false);
  const [regionKind, setRegionKind] = useState<WorldRegionKind | "auto">(savedDraft?.regionKind ?? "auto");
  const [worldBiome, setWorldBiome] = useState<WorldBiomeSpec["id"] | "auto">(savedDraft?.biome ?? "auto");
  const [useAdventureContext, setUseAdventureContext] = useState(savedDraft?.useAdventureContext ?? true);
  const [regionSize, setRegionSize] = useState<WorldRegionSize>(savedDraft?.regionSize ?? "medium");
  const [gridShape, setGridShape] = useState<"square" | "hex">(savedDraft?.gridShape ?? "square");
  const [worldQuality, setWorldQuality] = useState<WorldForgeQuality>(savedDraft?.worldQuality ?? "complete");
  const [worldSeed, setWorldSeed] = useState(savedDraft?.seed ?? Math.floor(Math.random() * 2_147_483_647));
  const [concepts, setConcepts] = useState<WorldBlueprintV1[]>(savedDraft?.concepts ?? []);
  const [selectedConceptId, setSelectedConceptId] = useState(savedDraft?.selectedConceptId ?? savedDraft?.concepts?.[0]?.id ?? "");
  const [draftMap, setDraftMap] = useState<GameMap | null>(null);
  const [sceneCatalogueOpen, setSceneCatalogueOpen] = useState(false);
  const savedPromptPanoramaCanResume = Boolean(savedDraft?.sourceMode === "prompt" && savedDraft.panoramaName && savedDraft.retryWorldFromPanorama !== false);
  const [reusePanoramaOnRetry, setReusePanoramaOnRetry] = useState(savedPromptPanoramaCanResume);
  const [retryAvailable, setRetryAvailable] = useState(Boolean(savedDraft?.panoramaName && savedDraft.retryWorldFromPanorama !== false));
  const retryPanoramaDescriptionRef = useRef(savedPromptPanoramaCanResume ? savedDraft?.description ?? "" : "");
  const [draftFileReady, setDraftFileReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const reconstructionMetricsRef = useRef<SplatReconstructionMetrics | null>(null);
  const updateSettings = useCampaignStore((state) => state.updateSettings);
  const updatePublishedMapLighting = useCampaignStore((state) => state.updateMapLighting);
  const addScenery = useCampaignStore((state) => state.addScenery);
  const removeScenery = useCampaignStore((state) => state.removeScenery);
  const addScene = useCampaignStore((state) => state.addScene);
  const saveSceneTemplate = useCampaignStore((state) => state.saveSceneTemplate);
  const addSceneTemplateToCampaign = useCampaignStore((state) => state.addSceneTemplateToCampaign);
  const removeSceneTemplateFromCampaign = useCampaignStore((state) => state.removeSceneTemplateFromCampaign);
  const removeSceneTemplate = useCampaignStore((state) => state.removeSceneTemplate);
  const sceneLibrary = useCampaignStore((state) => state.sceneLibrary);
  const propLibrary = useCampaignStore((state) => state.propLibrary);
  const materialLibrary = useCampaignStore((state) => state.materialLibrary);
  const endpoint = campaign.settings.comfyUiEndpoint || "http://127.0.0.1:8189";
  const scenery = campaign.map.scenery ?? [];
  const previewMap = draftMap ?? campaign.map;
  const legacyGeneratedWorld = Boolean(previewMap.generation?.blueprint && (previewMap.world?.generatorRevision ?? 0) < WORLD_GENERATOR_REVISION);
  const forgePreviewMap = useMemo(() => ({ ...previewMap, lighting: { ...resolveSceneLighting(previewMap.lighting), fogOfWar: false } }), [previewMap]);
  const selectedBlueprint = useMemo(() => concepts.find((entry) => entry.id === selectedConceptId), [concepts, selectedConceptId]);
  const lighting = resolveSceneLighting(previewMap.lighting);
  const updateMapLighting = (update: Partial<NonNullable<GameMap["lighting"]>>) => {
    if (draftMap) setDraftMap({ ...draftMap, lighting: { ...resolveSceneLighting(draftMap.lighting), ...update } });
    else updatePublishedMapLighting(update);
  };
  const panoramaPreview = useMemo(() => panorama ? URL.createObjectURL(panorama) : "", [panorama]);
  const selectedHdri = catalog.find((asset) => asset.id === selectedHdriId);
  const visibleIdeas = OFFLINE_SCENE_IDEAS.filter((idea) => `${idea.name} ${idea.tags} ${idea.prompt}`.toLowerCase().includes(ideaSearch.trim().toLowerCase()));
  const matchingHdris = useMemo(() => {
    const query = librarySearch.trim().toLowerCase();
    return catalog.filter((asset) => !query || `${asset.name} ${asset.description} ${asset.categories.join(" ")} ${asset.tags.join(" ")}`.toLowerCase().includes(query));
  }, [catalog, librarySearch]);

  const reportGeneration = (message: string, stageLabel: string, percent: number, detail?: string, reportedByEngine = false) => {
    setStatus(message);
    if (activeJobIdRef.current) updateGenerationJob(activeJobIdRef.current, { message, stageLabel, percent, detail, reportedByEngine });
  };

  useEffect(() => () => { if (panoramaPreview) URL.revokeObjectURL(panoramaPreview); }, [panoramaPreview]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readCreatorDraftFile(campaign.id, "scene-panorama"), readCreatorDraftFile(campaign.id, "scene-world-draft"), readWorldGenerationCheckpoint(campaign.id)]).then(async ([savedPanorama, savedWorld, savedCheckpoint]) => {
      if (cancelled) return;
      if (savedPanorama) setPanorama(savedPanorama);
      if (savedWorld) {
        try { setDraftMap(JSON.parse(await savedWorld.text()) as GameMap); }
        catch { /* An invalid interrupted draft is ignored; its blueprint remains recoverable. */ }
      }
      reconstructionMetricsRef.current = savedCheckpoint?.reconstructionMetrics ?? null;
      if (savedCheckpoint?.retryable && savedCheckpoint.stage === "reconstruction") setRetryAvailable(true);
      setDraftFileReady(true);
    });
    return () => { cancelled = true; };
  }, [campaign.id]);

  useEffect(() => {
    if (!draftFileReady) return;
    writeCreatorDraft<SceneForgeDraft>(campaign.id, "scene", {
      sourceMode, description, selectedHdriId, panoramaName: panorama?.name, retryWorldFromPanorama: reusePanoramaOnRetry,
      regionKind, biome: worldBiome, useAdventureContext, regionSize, gridShape, worldQuality, seed: worldSeed, concepts, selectedConceptId,
      updatedAt: new Date().toISOString(),
    });
  }, [campaign.id, sourceMode, description, selectedHdriId, panorama?.name, reusePanoramaOnRetry, regionKind, worldBiome, useAdventureContext, regionSize, gridShape, worldQuality, worldSeed, concepts, selectedConceptId, draftFileReady]);

  useEffect(() => { if (draftFileReady) void writeCreatorDraftFile(campaign.id, "scene-panorama", panorama); }, [campaign.id, panorama, draftFileReady]);
  useEffect(() => {
    if (!draftFileReady) return;
    const file = draftMap ? new File([JSON.stringify(draftMap)], "world-draft.json", { type: "application/json" }) : null;
    void writeCreatorDraftFile(campaign.id, "scene-world-draft", file);
  }, [campaign.id, draftMap, draftFileReady]);

  useEffect(() => {
    let cancelled = false;
    void findLatestLocalWorldDataset().then((dataset) => {
      if (!cancelled && dataset) setRetryAvailable(true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [campaign.id]);

  useEffect(() => {
    if (datasetWorkflow) return;
    let cancelled = false;
    void loadBundledWorkflow("/workflows/splatkit-dataset.json").then((preset) => {
      if (cancelled) return;
      setDatasetWorkflow(preset);
      setDatasetWorkflowName("Included official SplatKit workflow");
    }).catch((error) => {
      if (!cancelled) setDatasetWorkflowName(error instanceof Error ? error.message : "Included workflow unavailable");
    });
    return () => { cancelled = true; };
  }, [datasetWorkflow]);

  useEffect(() => {
    if (panoramaWorkflow) return;
    let cancelled = false;
    void loadBundledWorkflow("/workflows/splatkit-panorama.json").then((preset) => {
      if (cancelled) return;
      setPanoramaWorkflow(preset);
      setPanoramaWorkflowName("Included official 360° panorama workflow");
    }).catch((error) => {
      if (!cancelled) setPanoramaWorkflowName(error instanceof Error ? error.message : "Included workflow unavailable");
    });
    return () => { cancelled = true; };
  }, [panoramaWorkflow]);

  const importSplat = async (file?: File, source: "splatkit" | "import" = "import", sourceInspection?: SplatInspection, propagateFailure = false, chunkIndexStorageKey?: string) => {
    if (!file) return;
    setStatus(`Validating ${file.name}…`);
    try {
      const asset = await storeSplatFile(file, source, {
        sourceInspection,
        tabletop: { width: campaign.map.width, depth: campaign.map.depth, gridSize: campaign.map.gridSize },
        chunkIndexStorageKey,
      });
      if (source === "splatkit") {
        scenery.filter((entry) => entry.source === "splatkit").forEach((entry) => removeScenery(entry.id));
      }
      addScenery(asset);
      const fitMessage = asset.fitMode === "tabletop" ? " and fitted to the authoritative tabletop" : "";
      setStatus(`${asset.name} loaded as presentation scenery${fitMessage}`);
      onNotify(`${asset.name} was stored locally${fitMessage}.`, "success");
    } catch (error) {
      setStatus("Import failed");
      if (propagateFailure) throw error;
      onNotify(error instanceof Error ? error.message : "Splat import failed", "error");
    }
  };

  const prepareAndImportGeneratedSplat = async (sourceFile: File, progressStart: number, reconstructionMetrics?: SplatReconstructionMetrics | null) => {
    const sourceInspection = await inspectSplatFile(sourceFile);
    const assessment = assessGeneratedWorldSplat(sourceInspection);
    if (!assessment.accepted && !assessment.repairable) assertGeneratedWorldSplatQuality(sourceInspection);
    let qualityReport: SplatQualityReport | undefined;
    if (reconstructionMetrics) {
      qualityReport = assessSplatReconstructionQuality({ ...reconstructionMetrics, gaussianCount: sourceInspection.splatCount ?? 0, oversizedGaussianSheetDetected: assessment.repairable, gameplayVolumeIntersection: false });
      const nonRepairableReasons = qualityReport.reasons.filter((reason) => !/oversized Gaussian/i.test(reason));
      if (nonRepairableReasons.length) throw new Error(`World reconstruction failed measured geometry checks: ${nonRepairableReasons.join("; ")}. The four-rail dataset remains saved for a quality retry.`);
    }

    const mustRepair = assessment.repairable;
    if (mustRepair && !needsRuntimeSplatCompression(sourceFile)) {
      throw new Error(`The generated world contains repairable Gaussian outliers, but ${sourceFile.name} is already compressed and cannot be cleaned safely. The source dataset remains available for retry.`);
    }

    let runtimeFile = sourceFile;
    try {
      runtimeFile = await optimizeWorldSplatForRuntime(
        sourceFile,
        (message, percent) => reportGeneration(message, "Scene 5 of 5 · Runtime optimization", progressStart + Math.round(percent * .01), undefined, true),
        { maxGaussianScale: sourceInspection.quality?.recommendedMaxScale },
      );
    } catch (error) {
      if (mustRepair) {
        throw new Error(`The world was reconstructed successfully, but its oversized Gaussian cleanup failed: ${error instanceof Error ? error.message : String(error)}. Retry will reuse the completed camera dataset.`);
      }
      onNotify(`Runtime compression was skipped; the original world remains usable. ${error instanceof Error ? error.message : String(error)}`, "warning");
    }

    if (mustRepair) {
      const runtimeInspection = await inspectSplatFile(runtimeFile);
      const remaining = runtimeInspection.splatCount ?? 0;
      if (remaining < MIN_GENERATED_WORLD_SPLATS) {
        throw new Error(`World cleanup retained only ${remaining.toLocaleString()} readable Gaussians (${MIN_GENERATED_WORLD_SPLATS.toLocaleString()} required). The completed camera dataset remains available for retry.`);
      }
      if (reconstructionMetrics) {
        qualityReport = assessSplatReconstructionQuality({ ...reconstructionMetrics, gaussianCount: remaining, oversizedGaussianSheetDetected: false, gameplayVolumeIntersection: false });
        if (!qualityReport.accepted) throw new Error(`The cleaned world still failed measured geometry checks: ${qualityReport.reasons.join("; ")}. The completed dataset remains available for retry.`);
      }
      reportGeneration(`Removed oversized Gaussian outliers; ${remaining.toLocaleString()} readable splats remain`, "Scene 5 of 5 · Runtime optimization", 99, "The repaired world passed the playable-scene quality floor.", true);
    }
    let chunkIndexStorageKey: string | undefined;
    if (sourceInspection.bounds) {
      const tiles = await partitionWorldSplatForStreaming(sourceFile, sourceInspection.bounds, 32, (message, percent) => reportGeneration(message, "Scene 5 of 5 · Spatial tiling", 99, `${percent}%`, true), { maxGaussianScale: sourceInspection.quality?.recommendedMaxScale });
      if (tiles.length) {
        const storedTiles = [];
        for (const tile of tiles) storedTiles.push({ id: tile.id, storageKey: await storeWorldBinary("splat-tile", tile.file), bounds: tile.bounds, byteLength: tile.file.size, lod: tile.lod });
        chunkIndexStorageKey = await storeWorldBinary("splat-tile", new Blob([JSON.stringify({ version: 1, sourceBounds: sourceInspection.bounds, tileSize: 32, tiles: storedTiles })], { type: "application/json" }));
      }
    }
    reportGeneration("Importing the optimized world…", "Scene 5 of 5 · Final import", 99);
    const asset = await storeSplatFile(runtimeFile, "splatkit", { sourceInspection, tabletop: { width: campaign.map.width, depth: campaign.map.depth, gridSize: campaign.map.gridSize }, chunkIndexStorageKey, qualityReport });
    scenery.filter((entry) => entry.source === "splatkit").forEach((entry) => removeScenery(entry.id));
    addScenery(asset);
    setStatus(`${asset.name} loaded as validated, streamed presentation scenery`);
  };

  const refreshRuntime = async (notify = false): Promise<string[]> => {
    setStatus("Checking the private local creation tools…");
    try {
      const nativeStatus = await getLocalRuntimeStatus("world");
      if (nativeStatus && nativeStatus.state !== "ready" && nativeStatus.state !== "external") {
        setStatus(nativeStatus.state === "needsStart"
          ? "Local world-creation tools are installed and start automatically"
          : `One-time ${formatRuntimeBytes(nativeStatus.requiredBytes)} world-creation setup will start automatically`);
        if (notify) onNotify("Nothing else to install. Generate a world and DnDRom will prepare everything automatically.", "info");
        return [];
      }
      const generationEndpoint = nativeStatus?.endpoint ?? endpoint;
      await testComfyUi(generationEndpoint);
      const installed = await listComfyCheckpoints(generationEndpoint);
      setCheckpoints(installed);
      setCheckpoint((current) => current && installed.includes(current) ? current : installed[0] ?? "");
      const preset = datasetWorkflow ? await materializeComfyWorkflow(generationEndpoint, datasetWorkflow) : null;
      if (preset?.missingNodes.length) setStatus("Automatic SplatKit setup is incomplete · retry generation");
      else if (preset?.missingModels.length) setStatus("Automatic world-model setup is incomplete · retry generation");
      else setStatus("Private local world generation is ready");
      if (notify) onNotify(preset?.missingNodes.length || preset?.missingModels.length ? "Automatic setup did not finish. Retry Generate and DnDRom will resume it." : "Local world generation is ready.", preset?.missingNodes.length || preset?.missingModels.length ? "warning" : "success");
      return installed;
    } catch (error) {
      setStatus("Local tools will be downloaded and started automatically when you generate");
      if (notify) onNotify("Generate a world and DnDRom will prepare the private local tools automatically.", "info");
      return [];
    }
  };

  useEffect(() => {
    if (datasetWorkflow) void refreshRuntime();
    // Check once when the persistent studio becomes actionable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetWorkflow, endpoint]);

  const loadCatalog = async () => {
    if (catalogLoading || catalog.length) return;
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const assets = await fetchPolyHavenHdris();
      setCatalog(assets);
      setStatus(`${assets.length.toLocaleString()} Poly Haven HDRIs available`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load Poly Haven";
      setCatalogError(message);
      setStatus("Online library unavailable");
    } finally {
      setCatalogLoading(false);
    }
  };

  const chooseSourceMode = (mode: PanoramaSource) => {
    setSourceMode(mode);
    if (mode === "library") void loadCatalog();
  };

  const loadWorkflow = async (file: File | undefined, kind: "panorama" | "dataset") => {
    if (!file) return;
    try {
      const text = await file.text();
      const workflow = parseWorkflowText(text);
      const key = kind === "panorama" ? PANORAMA_WORKFLOW_KEY : DATASET_WORKFLOW_KEY;
      window.localStorage.setItem(key, JSON.stringify(workflow));
      if (kind === "panorama") {
        setPanoramaWorkflow(workflow);
        setPanoramaWorkflowName(file.name);
      } else {
        setDatasetWorkflow(workflow);
        setDatasetWorkflowName(file.name);
      }
      onNotify(`${kind === "panorama" ? "Panorama" : "SplatKit"} workflow saved for future sessions.`, "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not read workflow", "error");
    }
  };

  const generatePanorama = async (controller: AbortController, generationEndpoint: string): Promise<File> => {
    await testComfyUi(generationEndpoint);
    let workflow: ComfyWorkflow;
    if (panoramaWorkflow) {
      reportGeneration("Preparing the saved 360° workflow…", "Scene 2 of 5 · Panorama", 18);
      const readiness = await materializeComfyWorkflow(generationEndpoint, configurePanoramaPreset(panoramaWorkflow));
      if (readiness.missingNodes.length) throw new Error(`Automatic panorama setup is incomplete. Retry generation to resume it. Missing executable nodes: ${readiness.missingNodes.join(", ")}`);
      if (readiness.missingModels.length) throw new Error(`The panorama workflow needs these local models: ${readiness.missingModels.join(", ")}`);
      if (!readiness.workflow) throw new Error("The panorama workflow could not be prepared");
      workflow = preparePanoramaWorkflow(readiness.workflow, description.trim());
    } else {
      const installed = checkpoints.length ? checkpoints : await listComfyCheckpoints(generationEndpoint);
      const selected = checkpoint || installed[0];
      if (!selected) throw new Error("The bundled panorama pipeline is unavailable. Reinstall DnDRom to restore its included workflow.");
      setCheckpoints(installed);
      setCheckpoint(selected);
      reportGeneration("Preparing a quick 2:1 panorama draft…", "Scene 2 of 5 · Panorama", 18);
      workflow = createQuickPanoramaWorkflow(selected, description.trim());
    }
    const clientId = crypto.randomUUID();
    let receivedEngineProgress = false;
    const monitor = monitorComfyWorkflow(generationEndpoint, clientId, workflow, (event) => {
      if (event.status === "error") return;
      receivedEngineProgress = true;
      reportGeneration(event.nodeTitle ? `Panorama: ${event.nodeTitle}` : "Painting the panorama locally…", "Scene 2 of 5 · Panorama", Math.round(20 + event.percent * .22), `${event.completedNodes} of ${event.totalNodes} workflow nodes complete`, true);
    });
    await monitor.ready;
    const promptId = await queueComfyWorkflow(generationEndpoint, workflow, clientId);
    monitor.setPromptId(promptId);
    const cancelPanoramaPrompt = () => { void cancelComfyPrompt(generationEndpoint, promptId); };
    controller.signal.addEventListener("abort", cancelPanoramaPrompt, { once: true });
    let polls = 0;
    let result: Awaited<ReturnType<typeof waitForComfyPrompt>>;
    try {
      result = await waitForComfyPrompt(generationEndpoint, promptId, controller.signal, () => {
        polls++;
        if (!receivedEngineProgress) reportGeneration("Painting the panorama locally…", "Scene 2 of 5 · Panorama", 20, `${polls * 3}s elapsed · waiting for engine progress`);
      });
    } catch (error) {
      if (!controller.signal.aborted) await cancelComfyPrompt(generationEndpoint, promptId);
      throw error;
    } finally {
      controller.signal.removeEventListener("abort", cancelPanoramaPrompt);
      monitor.close();
    }
    const output = [...result.outputs].reverse().find((entry) => /\.(png|jpe?g|webp)$/i.test(entry.filename));
    if (!output) throw new Error("The panorama workflow completed without an image. Add a Save Image node to its active branch.");
    reportGeneration("Importing the generated panorama…", "Scene 2 of 5 · Panorama", 44);
    return await downloadComfyOutput(generationEndpoint, output);
  };

  const trainAndImportWorldDataset = async (datasetPath: string, reconstructionMetrics = reconstructionMetricsRef.current) => {
    if (!reconstructionMetrics) throw new Error("The saved reconstruction predates measured four-rail validation. Retry the reconstruction stage so it can be verified before import.");
    reportGeneration("Training the navigable Gaussian world locallyâ€¦", "Scene 4 of 5 Â· 3D training", 86, "The trainer continues if you switch pages or windows");
    const trained = await trainLocalWorld(datasetPath, (event) => reportGeneration(event.message, "Scene 4 of 5 Â· 3D training", Math.min(98, 86 + Math.round(runtimeProgressPercent(event) * .12)), undefined, true));
    reportGeneration("Compressing the trained world for real-time playâ€¦", "Scene 5 of 5 Â· Runtime optimization", 98);
    const trainedFile = await readLocalRuntimeFile(trained.path, trained.filename);
    await prepareAndImportGeneratedSplat(trainedFile, 98, reconstructionMetrics);
  };

  const generateWorld = async (sourcePanorama: File, controller: AbortController, generationEndpoint: string, recoverCompletedDataset = false) => {
    if (recoverCompletedDataset) {
      const recoveredDataset = await findLatestLocalWorldDataset();
      if (recoveredDataset) {
        reportGeneration("Recovered the completed camera reconstruction", "Scene 4 of 5 Â· 3D training", 86, "No camera, WAN, decode, or composite work needs to be repeated.", true);
        await trainAndImportWorldDataset(recoveredDataset);
        return;
      }
    }
    if (!datasetWorkflow) throw new Error("DnDRom could not load its bundled SplatKit workflow. Reinstall DnDRom to restore it.");
    reportGeneration("Uploading the panorama to local SplatKit…", "Scene 3 of 5 · Reconstruction", 46);
    const upload = await uploadComfyImage(generationEndpoint, sourcePanorama);
    const readiness = await materializeComfyWorkflow(generationEndpoint, datasetWorkflow);
    if (readiness.missingNodes.length) throw new Error("Automatic SplatKit setup did not finish. Retry Generate and DnDRom will resume it.");
    if (readiness.missingModels.length) throw new Error("Automatic world-model setup did not finish. Retry Generate and DnDRom will resume it.");
    if (!readiness.workflow) throw new Error("The included SplatKit workflow could not be prepared");
    let workflow = prepareSplatKitWorkflow(readiness.workflow, upload, description.trim() || sourcePanorama.name);
    const reconstructionBudget = worldWanBudget(readLocalAiSettings().memoryProfile);
    // The panorama stage can leave several large diffusion/upscale models in
    // VRAM. Release them before MoGe starts so a 10 GB card does not thrash.
    await releaseComfyMemory(generationEndpoint).catch(() => undefined);
    const depthPreflight = createSplatKitDepthPreflightWorkflow(workflow, reconstructionBudget.maxTrajectories);
    reportGeneration("Measuring playable views before WAN loads…", "Scene 3 of 5 · Reconstruction", 48, "MoGe is caching depth and checking which camera paths expose missing geometry", true);
    const preflightClientId = crypto.randomUUID();
    let preflightActivityAt = Date.now();
    let preflightTitle = "Panorama depth preflight";
    const preflightMonitor = monitorComfyWorkflow(generationEndpoint, preflightClientId, depthPreflight, (event) => {
      if (event.status === "error") return;
      preflightActivityAt = Date.now();
      preflightTitle = event.nodeTitle || preflightTitle;
      reportGeneration(`Depth preflight: ${preflightTitle}`, "Scene 3 of 5 · Reconstruction", Math.round(47 + event.percent * .03), `${event.completedNodes} of ${event.totalNodes} preparation nodes complete`, true);
    });
    await preflightMonitor.ready;
    const preflightPromptId = await queueComfyWorkflow(generationEndpoint, depthPreflight, preflightClientId);
    preflightMonitor.setPromptId(preflightPromptId);
    const cancelPreflight = () => { void cancelComfyPrompt(generationEndpoint, preflightPromptId); };
    controller.signal.addEventListener("abort", cancelPreflight, { once: true });
    let preflightResult: Awaited<ReturnType<typeof waitForComfyPrompt>>;
    try {
      preflightResult = await waitForComfyPrompt(generationEndpoint, preflightPromptId, controller.signal, () => {
        assertComfyNodeResponsive(preflightActivityAt, preflightTitle);
      }, 15 * 60_000);
    } catch (error) {
      if (!controller.signal.aborted) await cancelComfyPrompt(generationEndpoint, preflightPromptId);
      throw error;
    } finally {
      controller.signal.removeEventListener("abort", cancelPreflight);
      preflightMonitor.close();
    }
    const coverage = parseSplatKitCoverageDecision(preflightResult);
    const selectedPaths = coverage
      ? selectSplatKitCompatiblePaths(coverage, reconstructionBudget.maxTrajectories)
      : Array.from({ length: reconstructionBudget.maxTrajectories }, (_, index) => index);
    workflow = selectSplatKitWorkflowPaths(workflow, selectedPaths, reconstructionBudget);
    const coverageDetail = coverage
      ? `${selectedPaths.length} of ${coverage.paths.length} camera paths selected from measured geometry coverage`
      : `${selectedPaths.length} camera paths selected by the ${readLocalAiSettings().memoryProfile} fallback profile`;
    reportGeneration("Playable-view coverage measured", "Scene 3 of 5 · Reconstruction", 50, coverageDetail, true);
    // Keep SplatKit's CPU-side depth/mesh cache, but return MoGe's model memory
    // before the full WAN reconstruction graph is submitted.
    await releaseComfyMemory(generationEndpoint).catch(() => undefined);
    const clientId = crypto.randomUUID();
    let activeNodeTitle = "Starting local reconstruction";
    let activeNodeId = "";
    let activeNodeStartedAt = Date.now();
    let completedNodes = 0;
    let totalNodes = Math.max(1, Object.keys(workflow).length);
    let lastProgressSignature = "";
    let lastEngineActivityAt = Date.now();
    const monitor = monitorComfyWorkflow(generationEndpoint, clientId, workflow, (event) => {
      if (event.status === "error") return;
      if (event.nodeId && event.nodeId !== activeNodeId) {
        activeNodeId = event.nodeId;
        activeNodeStartedAt = Date.now();
      }
      activeNodeTitle = event.nodeTitle || activeNodeTitle;
      completedNodes = event.completedNodes;
      totalNodes = event.totalNodes;
      const signature = `${event.status}:${event.nodeId ?? ""}:${event.completedNodes}:${event.percent.toFixed(2)}`;
      if (signature !== lastProgressSignature) {
        lastProgressSignature = signature;
        lastEngineActivityAt = Date.now();
      }
      reportGeneration(event.nodeTitle ? `World reconstruction: ${event.nodeTitle}` : "Building the navigable world…", "Scene 3 of 5 · Reconstruction", Math.round(50 + event.percent * .34), `${event.completedNodes} of ${event.totalNodes} workflow nodes complete`, true);
    });
    await monitor.ready;
    const promptId = await queueComfyWorkflow(generationEndpoint, workflow, clientId);
    monitor.setPromptId(promptId);
    const cancelActivePrompt = () => { void cancelComfyPrompt(generationEndpoint, promptId); };
    controller.signal.addEventListener("abort", cancelActivePrompt, { once: true });
    const reconstructionStartedAt = Date.now();
    let result: Awaited<ReturnType<typeof waitForComfyPrompt>>;
    try {
      result = await waitForComfyPrompt(generationEndpoint, promptId, controller.signal, () => {
        assertComfyNodeResponsive(lastEngineActivityAt, activeNodeTitle);
        const elapsedMs = Date.now() - reconstructionStartedAt;
        const elapsedMinutes = Math.floor(elapsedMs / 60_000);
        const elapsedSeconds = Math.floor(elapsedMs / 1000) % 60;
        const nodeElapsedMs = Date.now() - activeNodeStartedAt;
        const nodeElapsedMinutes = Math.floor(nodeElapsedMs / 60_000);
        const nodeElapsedSeconds = Math.floor(nodeElapsedMs / 1000) % 60;
        const nodeElapsed = `${nodeElapsedMinutes}:${String(nodeElapsedSeconds).padStart(2, "0")}`;
        const totalElapsed = `${elapsedMinutes}:${String(elapsedSeconds).padStart(2, "0")}`;
        reportGeneration(`World reconstruction: ${activeNodeTitle}`, "Scene 3 of 5 · Reconstruction", Math.max(50, Math.min(84, 50 + Math.round((completedNodes / totalNodes) * 34))), `${completedNodes} of ${totalNodes} workflow nodes complete · node ${nodeElapsed} · total ${totalElapsed}`, true);
      });
    } catch (error) {
      if (!controller.signal.aborted) await cancelComfyPrompt(generationEndpoint, promptId);
      if (controller.signal.aborted || !isRecoverableSplatKitMappingFailure(error)) throw error;

      // Reuse every cached rail and retry only the inexpensive SfM solve with
      // more tolerant matching. Partial one-rail worlds are explicitly refused.
      controller.signal.removeEventListener("abort", cancelActivePrompt);
      monitor.close();
      reportGeneration(
        "Camera overlap was weak; remapping all four cached rails...",
        "Scene 3 of 5 - Reconstruction recovery",
        83,
        "All generated frames are cached. Only four-rail spherical mapping is being retried.",
        true,
      );
      const recoveryWorkflow = createSplatKitSfmRecoveryWorkflow(workflow);
      const recoveryClientId = crypto.randomUUID();
      const recoveryMonitor = monitorComfyWorkflow(generationEndpoint, recoveryClientId, recoveryWorkflow, (event) => {
        if (event.status === "error") return;
        reportGeneration(
          event.nodeTitle ? `World recovery: ${event.nodeTitle}` : "Recovering camera poses...",
          "Scene 3 of 5 - Reconstruction recovery",
          Math.round(83 + event.percent * .01),
          `${event.completedNodes} of ${event.totalNodes} cached/recovery nodes complete`,
          true,
        );
      });
      await recoveryMonitor.ready;
      const recoveryPromptId = await queueComfyWorkflow(generationEndpoint, recoveryWorkflow, recoveryClientId);
      recoveryMonitor.setPromptId(recoveryPromptId);
      const cancelRecoveryPrompt = () => { void cancelComfyPrompt(generationEndpoint, recoveryPromptId); };
      controller.signal.addEventListener("abort", cancelRecoveryPrompt, { once: true });
      try {
        result = await waitForComfyPrompt(generationEndpoint, recoveryPromptId, controller.signal, undefined, 15 * 60_000);
      } catch (recoveryError) {
        if (!controller.signal.aborted) await cancelComfyPrompt(generationEndpoint, recoveryPromptId);
        throw recoveryError;
      } finally {
        controller.signal.removeEventListener("abort", cancelRecoveryPrompt);
        recoveryMonitor.close();
      }
    } finally {
      controller.signal.removeEventListener("abort", cancelActivePrompt);
      monitor.close();
    }
    const reconstructionMetrics = parseSplatKitReconstructionMetrics(result);
    if (!reconstructionMetrics) throw new Error("SphereSfM completed without the required four-rail quality report. Retry restarts the updated local validation node; no unmeasured cloud was imported.");
    reconstructionMetricsRef.current = reconstructionMetrics;
    await writeWorldGenerationCheckpoint({ id: crypto.randomUUID(), campaignId: campaign.id, blueprintId: selectedBlueprint?.id ?? `splat-${campaign.id}`, stage: "reconstruction", completedChunkIds: [], completedAssetRequestIds: [], retryable: true, reconstructionMetrics, updatedAt: new Date().toISOString() });
    const generatedSplat = result.outputs.find((output) => /\.(compressed\.)?(ply|sog)$/i.test(output.filename));
    if (generatedSplat) {
      reportGeneration(`Preparing ${generatedSplat.filename} for real-time play…`, "Scene 5 of 5 · Final import", 96);
      const sourceFile = await downloadComfyOutput(generationEndpoint, generatedSplat);
      await prepareAndImportGeneratedSplat(sourceFile, 98, reconstructionMetrics);
    } else {
      const datasetPath = selectSplatKitDatasetPath(result) ?? await findLatestLocalWorldDataset();
      if (!datasetPath) throw new Error("The world reconstruction completed without returning its local COLMAP dataset path");
      reportGeneration("Training the navigable Gaussian world locally…", "Scene 4 of 5 · 3D training", 86, "The trainer continues if you switch pages or windows");
      const trained = await trainLocalWorld(datasetPath, (event) => reportGeneration(event.message, "Scene 4 of 5 · 3D training", Math.min(98, 86 + Math.round(runtimeProgressPercent(event) * .12)), undefined, true));
      reportGeneration("Compressing the trained world for real-time play…", "Scene 5 of 5 · Runtime optimization", 98);
      const trainedFile = await readLocalRuntimeFile(trained.path, trained.filename);
      await prepareAndImportGeneratedSplat(trainedFile, 98, reconstructionMetrics);
    }
  };

  const runGeneration = async (reconstructionOnly = false) => {
    const recoveredTrainedWorld = reconstructionOnly && reusePanoramaOnRetry
      ? await findLatestLocalTrainedWorld().catch(() => null)
      : null;
    const recoveredDataset = reconstructionOnly ? await findLatestLocalWorldDataset().catch(() => null) : null;
    if (reconstructionOnly && !panorama && !recoveredDataset && !recoveredTrainedWorld) {
      setRetryAvailable(false);
      onNotify("The saved panorama and completed camera dataset are missing. Generate or choose a panorama before retrying reconstruction.", "warning");
      return;
    }
    if (!reconstructionOnly && !description.trim() && sourceMode === "prompt") {
      onNotify("Describe the world you want to create first.", "warning");
      return;
    }
    if (!reconstructionOnly && sourceMode !== "prompt" && !panorama) {
      onNotify(sourceMode === "library" ? "Choose a Poly Haven panorama first." : "Choose a 2:1 panorama first.", "warning");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    if (reconstructionOnly) dismissFailedGenerationJobs("scene");
    const jobId = beginGenerationJob({ kind: "scene", label: reconstructionOnly ? "Scene reconstruction retry" : "Scene creation", message: recoveredTrainedWorld ? "Recovering the completed trained world…" : reconstructionOnly ? "Restarting the private local engine…" : "Preparing the private local engine…", stageLabel: recoveredTrainedWorld ? "Scene 5 of 5 · Recovery" : "Scene 1 of 5 · Local setup", percent: recoveredTrainedWorld ? 98 : 2, detail: recoveredTrainedWorld ? "Reconstruction and training are already complete; Retry will clean and import the saved result." : reconstructionOnly ? "The saved panorama will be reused; image generation is skipped." : "You can switch pages or windows; generation continues while DnDRom stays open.", onCancel: () => controller.abort() });
    activeJobIdRef.current = jobId;
    setRunning(true);
    let recoverablePanorama: File | null = reconstructionOnly ? panorama : sourceMode === "prompt" ? null : panorama;
    try {
      if (!await waitForGenerationJobTurn(jobId)) return;
      let generationEndpoint = endpoint;
      if (!recoveredTrainedWorld) {
        const startRuntime = reconstructionOnly ? restartLocalRuntime : ensureLocalRuntime;
        const runtime = await startRuntime("world", (event) => {
          const percent = runtimeProgressPercent(event);
          reportGeneration(event.message, "Scene 1 of 5 · Local setup", Math.max(2, Math.round(percent * .15)), `${formatRuntimeBytes(event.completedBytes)} / ${formatRuntimeBytes(event.totalBytes)}`, true);
        });
        generationEndpoint = runtime.endpoint;
        updateSettings({ comfyUiEndpoint: runtime.endpoint });
      }
      const recoveredTrainedFile = recoveredTrainedWorld
        ? await readLocalRuntimeFile(recoveredTrainedWorld.path, recoveredTrainedWorld.filename).catch(() => null)
        : null;
      if (recoveredTrainedFile) {
        reportGeneration("Recovered completed world training", "Scene 5 of 5 · Runtime optimization", 98, "Retry is cleaning and importing the saved world; reconstruction and training are not repeated.", true);
      await prepareAndImportGeneratedSplat(recoveredTrainedFile, 98, reconstructionMetricsRef.current);
      } else if (recoveredDataset) {
        reportGeneration("Recovered the completed camera reconstruction", "Scene 4 of 5 · 3D training", 86, "Retry is training directly from the saved 132-view dataset.", true);
        await trainAndImportWorldDataset(recoveredDataset);
      } else {
        const canReusePanorama = reconstructionOnly || (sourceMode === "prompt" && reusePanoramaOnRetry && panorama && retryPanoramaDescriptionRef.current === description.trim());
        const sourcePanorama = reconstructionOnly ? panorama! : canReusePanorama ? panorama! : sourceMode === "prompt" ? await generatePanorama(controller, generationEndpoint) : panorama!;
        recoverablePanorama = sourcePanorama;
        if (sourceMode === "prompt" && !canReusePanorama) {
          setPanorama(sourcePanorama);
          onNotify("Your panorama was generated locally.", "success");
        }
        // Persist the recovery point before SplatKit starts so a force-close can
        // resume reconstruction without regenerating the approved panorama.
        retryPanoramaDescriptionRef.current = description.trim();
        setReusePanoramaOnRetry(true);
        setRetryAvailable(true);
        await writeCreatorDraftFile(campaign.id, "scene-panorama", sourcePanorama);
        writeCreatorDraft<SceneForgeDraft>(campaign.id, "scene", {
          sourceMode, description, selectedHdriId, panoramaName: sourcePanorama.name, retryWorldFromPanorama: true, updatedAt: new Date().toISOString(),
        });
        await generateWorld(sourcePanorama, controller, generationEndpoint, reconstructionOnly);
      }
      // Successful worlds remain retriable when training/detail settings change.
      setRetryAvailable(true);
      if (panorama || recoverablePanorama) setReusePanoramaOnRetry(true);
      updateGenerationJob(jobId, { status: "complete", message: "Scene generation complete and added to the campaign", stageLabel: "Complete · Scene ready", percent: 100, detail: "The generated scene is saved locally and ready to use." });
    } catch (error) {
      if (recoverablePanorama) {
        retryPanoramaDescriptionRef.current = description.trim();
        setReusePanoramaOnRetry(true);
        setRetryAvailable(true);
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Generation cancelled");
        updateGenerationJob(jobId, { status: "error", message: "Scene generation cancelled", stageLabel: "Generation stopped", detail: "Your prompt and source panorama remain saved." });
      }
      else {
        setStatus("Generation failed");
        updateGenerationJob(jobId, { status: "error", message: error instanceof Error ? error.message : "World generation failed", stageLabel: "Generation stopped", detail: "Saved inputs were preserved. Retry starts the local engine cleanly." });
        onNotify(error instanceof Error ? error.message : "World generation failed", "error");
      }
    } finally {
      abortRef.current = null;
      activeJobIdRef.current = null;
      setRunning(false);
    }
  };

  const useSelectedHdri = async () => {
    if (!selectedHdri) return;
    setRunning(true);
    setStatus(`Downloading ${selectedHdri.name} from Poly Haven…`);
    try {
      const file = await downloadPolyHavenPanorama(selectedHdri);
      setPanorama(file);
      setDescription(selectedHdri.description || `${selectedHdri.name}, environment panorama`);
      setStatus(`${selectedHdri.name} ready for local 3D generation`);
      onNotify(`${selectedHdri.name} is ready. The asset is CC0 and credited to Poly Haven.`, "success");
    } catch (error) {
      setStatus("Panorama download failed");
      onNotify(error instanceof Error ? error.message : "Could not download panorama", "error");
    } finally {
      setRunning(false);
    }
  };

  const createWorldPlans = async () => {
    if (!description.trim() || running || worldPlanning) return;
    dismissFailedGenerationJobs("scene");
    const controller = new AbortController();
    abortRef.current = controller;
    setWorldPlanning(true);
    const jobId = beginGenerationJob({ kind: "scene", label: "World blueprint", message: "Interpreting the requested region…", stageLabel: "Blueprint and concepts", percent: 2, onCancel: () => controller.abort() });
    activeJobIdRef.current = jobId;
    try {
      if (!await waitForGenerationJobTurn(jobId)) return;
      const activeLocation = campaign.world?.locations.find((location) => location.id === campaign.activeLocationId);
      const result = await generateWorldBlueprints({
        description, kind: regionKind, biome: worldBiome, size: regionSize, gridShape, seed: worldSeed,
        background: worldQuality === "quick" ? "none" : worldQuality === "showpiece" ? "splat" : "panorama",
      }, campaign.settings, useAdventureContext ? {
        location: activeLocation?.name, biome: activeLocation?.biome,
        sceneTags: campaign.map.entities.flatMap((entry) => entry.tags ?? []).slice(0, 12),
        partyFootprints: tokenAssets.map((entry) => entry.footprint),
        recentResolvedEvents: campaign.events.slice(-5).map((entry) => entry.summary),
      } : {}, controller.signal);
      setConcepts(result.blueprints);
      setSelectedConceptId(result.blueprints[0].id);
      setDraftMap(null);
      await storeWorldBlueprint(result.blueprints[0]);
      await writeWorldGenerationCheckpoint({ id: crypto.randomUUID(), campaignId: campaign.id, blueprintId: result.blueprints[0].id, stage: "concept", completedChunkIds: [], completedAssetRequestIds: [], retryable: true, updatedAt: new Date().toISOString() });
      updateGenerationJob(jobId, { status: "complete", message: "Two playable world concepts are ready", stageLabel: "Concept review", percent: 100, detail: result.warning ?? `${result.provider === "local-ai" ? "Local AI" : "Deterministic"} blueprints validated` });
      setStatus(result.warning ?? "Choose a world concept, then build its playable region");
      if (result.warning) onNotify(result.warning, "warning");
    } catch (error) {
      updateGenerationJob(jobId, { status: "error", message: "World blueprint generation stopped", stageLabel: "Blueprint and concepts", detail: error instanceof Error ? error.message : String(error) });
      if (!(error instanceof DOMException && error.name === "AbortError")) onNotify(error instanceof Error ? error.message : "Could not create world concepts", "error");
    } finally {
      setWorldPlanning(false);
      abortRef.current = null;
      activeJobIdRef.current = null;
    }
  };

  const buildPlayableWorld = async () => {
    const blueprint = concepts.find((entry) => entry.id === selectedConceptId);
    if (!blueprint || running || worldPlanning) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setWorldPlanning(true);
    const jobId = beginGenerationJob({ kind: "scene", label: "Playable world", message: "Generating structural chunks…", stageLabel: "Structural chunks", percent: 15, onCancel: () => controller.abort() });
    const checkpointId = crypto.randomUUID();
    activeJobIdRef.current = jobId;
    try {
      if (!await waitForGenerationJobTurn(jobId)) return;
      await writeWorldGenerationCheckpoint({ id: checkpointId, campaignId: campaign.id, blueprintId: blueprint.id, stage: "structure", completedChunkIds: [], completedAssetRequestIds: [], retryable: true, updatedAt: new Date().toISOString() });
      const compiled = await compileWorldBlueprintAsync(blueprint, controller.signal);
      compiled.map.generation = { ...compiled.map.generation!, quality: worldQuality };
      compiled.map.pendingRefinements = planWorldRefinements({ map: compiled.map, campaignProps: campaign.propAssets ?? [], campaignMaterials: campaign.materialAssets ?? [], deviceProps: propLibrary, deviceMaterials: materialLibrary });
      const completedChunkIds: string[] = [];
      for (const [index, chunk] of (compiled.map.world?.chunks ?? []).entries()) {
        if (controller.signal.aborted) throw new DOMException("World compilation cancelled", "AbortError");
        const terrain = compiled.map.entities.find((entry) => entry.chunkId === chunk.id && entry.worldGeometry?.kind === "terrain");
        const terrainGeometry = terrain?.worldGeometry?.kind === "terrain" ? terrain.worldGeometry : null;
        const heightfield = terrainGeometry ? createHeightfield(terrainGeometry, terrainGeometry.heightfield?.resolution ?? 33) : null;
        const navigation = terrainGeometry ? buildNavigationGrid(terrainGeometry, 16) : null;
        const chunkGeometry = compiled.map.entities.filter((entry) => entry.chunkId === chunk.id && entry.worldGeometry).map((entry) => ({ id: entry.id, assetId: entry.assetId, position: entry.position, geometry: entry.worldGeometry }));
        const meshStorageKey = await storeWorldBinary("chunk", new Blob([JSON.stringify({ chunkId: chunk.id, generationHash: chunk.generationHash, geometry: chunkGeometry })], { type: "application/json" }));
        chunk.lods = chunk.lods.map((lod) => ({ ...lod, meshStorageKey }));
        chunk.heightfieldStorageKey = await storeWorldBinary("heightfield", new Blob([JSON.stringify({ chunkId: chunk.id, heightfield })], { type: "application/json" }));
        chunk.navigationStorageKey = await storeWorldBinary("navigation", new Blob([JSON.stringify({ chunkId: chunk.id, navigation, roomIds: chunk.roomIds ?? [], portalChunkIds: chunk.portalChunkIds ?? [], blockedEntityIds: compiled.map.entities.filter((entry) => entry.chunkId === chunk.id && !entry.tags?.includes("non-colliding") && !entry.tags?.includes("world:terrain")).map((entry) => entry.id) })], { type: "application/json" }));
        completedChunkIds.push(chunk.id);
        await writeWorldGenerationCheckpoint({ id: checkpointId, campaignId: campaign.id, blueprintId: blueprint.id, stage: "structure", completedChunkIds: [...completedChunkIds], completedAssetRequestIds: [], retryable: true, updatedAt: new Date().toISOString() });
        updateGenerationJob(jobId, { message: `Compiled chunk ${index + 1} of ${compiled.map.world?.chunks.length ?? 1}`, stageLabel: "Structural chunks", percent: 15 + Math.round(((index + 1) / (compiled.map.world?.chunks.length ?? 1)) * 30), detail: chunk.id });
      }
      setDraftMap(compiled.map);
      await storeWorldBlueprint(blueprint);
      await writeWorldGenerationCheckpoint({ id: checkpointId, campaignId: campaign.id, blueprintId: blueprint.id, stage: "validation", completedChunkIds: compiled.map.world?.chunks.map((entry) => entry.id) ?? [], completedAssetRequestIds: blueprint.assetRequests.filter((entry) => entry.status === "resolved").map((entry) => entry.id), retryable: true, updatedAt: new Date().toISOString() });
      updateGenerationJob(jobId, { status: "complete", message: "Playable procedural world ready for review", stageLabel: "Gameplay validation", percent: 100, detail: `${compiled.map.world?.chunks.length ?? 1} chunks · ${compiled.map.entities.length} editable objects · ${compiled.validation.warnings.length} warnings` });
      setStatus("Playable world ready · publish now or continue with optional visual finishing");
    } catch (error) {
      updateGenerationJob(jobId, { status: "error", message: "World compilation stopped", stageLabel: "Structural chunks", detail: error instanceof Error ? error.message : String(error) });
      if (!(error instanceof DOMException && error.name === "AbortError")) onNotify(error instanceof Error ? error.message : "Could not compile the playable world", "error");
    } finally {
      setWorldPlanning(false);
      abortRef.current = null;
      activeJobIdRef.current = null;
    }
  };

  const publishBaseWorld = () => {
    if (!draftMap?.validation?.valid) {
      onNotify("The draft must pass gameplay validation before publishing.", "warning");
      return;
    }
    const existing = sceneLibrary.find((entry) => entry.map.id === draftMap.id);
    const template = createSceneTemplate(draftMap, undefined, existing);
    saveSceneTemplate(template);
    const party = campaign.characters.filter((character) => (character.role ?? "player") === "player").map((character) => character.id);
    addScene(draftMap.name, structuredClone(draftMap), party, "Generated in AI-Directed Procedural World Forge.");
    void clearWorldGenerationCheckpoint(campaign.id);
    setDraftMap(null);
    onNotify(`${draftMap.name} was published as a new scene. The previous scene remains saved.`, "success");
  };

  const refreshRefinementMatches = () => {
    if (!draftMap) return;
    const planned = planWorldRefinements({ map: draftMap, campaignProps: campaign.propAssets ?? [], campaignMaterials: campaign.materialAssets ?? [], deviceProps: propLibrary, deviceMaterials: materialLibrary });
    setDraftMap({ ...draftMap, pendingRefinements: planned });
  };

  const approveRefinement = (id: string) => setDraftMap((current) => current ? { ...current, pendingRefinements: approveWorldRefinement(current.pendingRefinements ?? [], id) } : current);
  const applyRefinements = () => setDraftMap((current) => current ? applyApprovedWorldRefinements(current) : current);

  const openSceneTemplate = (map: GameMap, description: string) => {
    setDescription(description);
    setDraftMap(structuredClone(map));
    setConcepts(map.generation?.blueprint ? [map.generation.blueprint] : []);
    setSelectedConceptId(map.generation?.blueprint.id ?? "");
    setSceneCatalogueOpen(false);
    setStatus("Catalogue world loaded into an isolated Forge draft");
  };

  const prepareLegacyWorldRebuild = () => {
    const blueprint = previewMap.generation?.blueprint;
    if (!blueprint || running || worldPlanning) return;
    setDescription(blueprint.description);
    setConcepts([blueprint]);
    setSelectedConceptId(blueprint.id);
    setDraftMap(null);
    setStatus(`Legacy terrain loaded · Build playable world to compile visual pipeline v${WORLD_GENERATOR_REVISION}`);
  };

  const duplicateSceneTemplate = (map: GameMap, description: string) => {
    const copy = structuredClone(map);
    copy.id = crypto.randomUUID();
    copy.name = `${map.name} Copy`;
    saveSceneTemplate(createSceneTemplate(copy, description));
    onNotify(`${copy.name} was added to the local scene catalogue.`, "success");
  };

  const retryWithReferenceQuality = () => {
    writeLocalAiSettings({ ...readLocalAiSettings(), memoryProfile: "maximum" });
    void runGeneration(true);
  };

  const startNewScene = () => {
    if (running) return;
    setPanorama(null);
    setDescription("");
    setReusePanoramaOnRetry(false);
    setRetryAvailable(false);
    retryPanoramaDescriptionRef.current = "";
    setSelectedHdriId("");
    setSourceMode("prompt");
    setConcepts([]);
    setSelectedConceptId("");
    setDraftMap(null);
    setWorldSeed(Math.floor(Math.random() * 2_147_483_647));
    setStatus("New scene draft ready");
    clearCreatorDraft(campaign.id, "scene");
    void clearCreatorDraftFiles(campaign.id, "scene");
  };

  return (
          <section className="creator-workspace-page splat-studio-modal leather-plate" aria-label="AI Gaussian scenery studio">
            <div className="creator-page-actions"><button onClick={onBack} disabled={running || worldPlanning}><ArrowLeft size={15} /> Tabletop</button><small>Draft autosaved locally</small><button onClick={() => setSceneCatalogueOpen(true)}><BookOpen size={15} /> Scene catalogue</button><button onClick={startNewScene} disabled={running || worldPlanning}><Plus size={15} /> New scene</button></div>
            <span className="eyebrow arcane-eyebrow"><WandSparkles size={13} /> Local world forge</span>
            <h2>Conjure a world from an idea</h2>
            <p>Generate a panorama from a prompt, begin with a free real-world HDRI, or bring your own image. SplatKit builds presentation scenery while the editable mesh map remains authoritative.</p>

            <div className="creator-editor-shell scene-editor-shell">
            <aside className="creator-sidebar creator-sidebar-left" aria-label="Scene source settings">
            <div className="sidebar-section-heading"><WandSparkles size={14} /><span><strong>Scene source</strong><small>Prompt, library, or panorama</small></span></div>
            <div className="runtime-strip"><span><Cpu size={14} /> Local forge</span><small>Automatic</small></div>
            <section className="world-blueprint-controls" aria-label="Procedural world settings">
              <div className="sidebar-section-heading"><Map size={14} /><span><strong>Playable region</strong><small>AI-directed procedural geometry</small></span></div>
              <label className="field-label">Region type<select value={regionKind} onChange={(event) => setRegionKind(event.target.value as WorldRegionKind | "auto")}><option value="auto">Auto-detect</option><option value="exterior">Exterior</option><option value="settlement">Settlement</option><option value="interior">Interior</option><option value="dungeon">Dungeon</option></select></label>
              <label className="field-label">Biome<select value={worldBiome} onChange={(event) => setWorldBiome(event.target.value as WorldBiomeSpec["id"] | "auto")}><option value="auto">Infer from description</option><option value="forest">Forest</option><option value="plains">Plains</option><option value="mountains">Mountains</option><option value="coast">Coast</option><option value="swamp">Swamp</option><option value="desert">Desert</option><option value="snow">Snow</option><option value="urban">Urban</option><option value="dungeon">Dungeon</option><option value="cavern">Cavern</option></select></label>
              <div className="world-control-row"><label className="field-label">Size<select value={regionSize} onChange={(event) => setRegionSize(event.target.value as WorldRegionSize)}><option value="small">Small · 64m</option><option value="medium">Medium · 128m</option><option value="large">Large · 256m</option></select></label><label className="field-label">Grid<select value={gridShape} onChange={(event) => setGridShape(event.target.value as "square" | "hex")}><option value="square">Square</option><option value="hex">Hex</option></select></label></div>
              <label className="field-label">Forge profile<select value={worldQuality} onChange={(event) => setWorldQuality(event.target.value as WorldForgeQuality)}><option value="quick">Quick · catalogue only</option><option value="complete">Complete · AI assets</option><option value="showpiece">Showpiece · background splat</option></select></label>
              <label className="field-label">World seed<input type="number" min="0" max="2147483647" value={worldSeed} onChange={(event) => setWorldSeed(Math.max(0, Math.min(2_147_483_647, Number(event.target.value) || 0)))} /></label>
              <label className="world-context-toggle"><input type="checkbox" checked={useAdventureContext} onChange={(event) => setUseAdventureContext(event.target.checked)} /><span>Use current-adventure context<small>Only bounded location, biome, scene tags, party footprint, and resolved events.</small></span></label>
              <button className="primary-button" disabled={!description.trim() || running || worldPlanning} onClick={() => void createWorldPlans()}>{worldPlanning ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} Create two world plans</button>
            </section>
            <div className="panorama-source-tabs" role="tablist" aria-label="Panorama source">
              <button className={sourceMode === "prompt" ? "active" : ""} onClick={() => chooseSourceMode("prompt")}><Sparkles size={14} /> Prompt</button>
              <button className={sourceMode === "library" ? "active" : ""} onClick={() => chooseSourceMode("library")}><Globe2 size={14} /> Online library</button>
              <button className={sourceMode === "upload" ? "active" : ""} onClick={() => chooseSourceMode("upload")}><Upload size={14} /> Upload</button>
            </div>

            {sourceMode === "prompt" && <div className="source-workspace prompt-workspace">
              <label className="field-label vellum-field">Describe the world<textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A moonlit harbor where black water reflects lanterns…" /></label>
              <section className="offline-idea-library">
                <div className="idea-library-heading"><div><strong>Story seeds</strong><small>Choose one, then make it yours</small></div><label><Search size={13} /><input value={ideaSearch} onChange={(event) => setIdeaSearch(event.target.value)} placeholder="Coast, town, forest…" /></label></div>
                <div className="idea-card-grid">{visibleIdeas.map((idea) => <button key={idea.name} onClick={() => setDescription(`${idea.prompt}, seamless 360 panorama`)} style={{ background: `linear-gradient(145deg, ${idea.palette.split(",")[0]}, ${idea.palette.split(",")[1]})` }}><Sparkles size={13} /><strong>{idea.name}</strong><small>{idea.tags}</small></button>)}</div>
              </section>
              {!panoramaWorkflow && checkpoints.length > 0 && <label className="field-label checkpoint-choice">Local image model<select value={checkpoint} onChange={(event) => setCheckpoint(event.target.value)}>{checkpoints.map((name) => <option key={name} value={name}>{name}</option>)}</select><small>Quick draft mode uses only built-in ComfyUI nodes.</small></label>}
            </div>}

            {sourceMode === "library" && <div className="source-workspace library-workspace">
              <div className="library-heading"><div><strong>Poly Haven panoramas</strong><small>Free CC0 HDRIs · live online catalog</small></div><label><Search size={14} /><input value={librarySearch} onChange={(event) => { setLibrarySearch(event.target.value); setCatalogLimit(24); }} placeholder="Forest, castle, night…" /></label></div>
              {catalogLoading && <div className="library-state"><LoaderCircle className="spin" size={18} /> Opening the public library…</div>}
              {catalogError && <div className="library-state error">{catalogError}<button onClick={() => void loadCatalog()}>Try again</button></div>}
              {!catalogLoading && !catalogError && <div className="hdri-grid">{matchingHdris.slice(0, catalogLimit).map((asset) => <button key={asset.id} className={selectedHdriId === asset.id ? "selected" : ""} onClick={() => setSelectedHdriId(asset.id)} title={asset.description}><img src={asset.thumbnailUrl} alt="" loading="lazy" /><span><strong>{asset.name}</strong><small>{asset.categories.slice(0, 2).join(" · ") || "HDRI"}</small></span>{selectedHdriId === asset.id && <i><Check size={12} /></i>}</button>)}</div>}
              {matchingHdris.length > catalogLimit && <button className="load-more" onClick={() => setCatalogLimit((value) => value + 24)}>Reveal more panoramas</button>}
              {selectedHdri && <div className="selected-hdri"><span><strong>{selectedHdri.name}</strong><small>{selectedHdri.authors.length ? `By ${selectedHdri.authors.join(", ")} · ` : ""}CC0 via Poly Haven</small></span><button onClick={() => void useSelectedHdri()} disabled={running}><Globe2 size={14} /> Use this HDRI</button></div>}
            </div>}

            {sourceMode === "upload" && <div className="source-workspace upload-workspace">
              <label className={`panorama-dropzone ${panorama ? "has-file" : ""}`}>
                {panoramaPreview ? <img src={panoramaPreview} alt="Selected panorama preview" /> : <Image size={30} />}
                <span><strong>{panorama?.name ?? "Choose a 2:1 panorama"}</strong><small>PNG, JPEG, or WebP · equirectangular works best</small></span>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setPanorama(event.target.files?.[0] ?? null)} />
              </label>
              <label className="field-label vellum-field">What is in this scene?<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the actual panorama so the local world model understands it." /></label>
            </div>}

            {sourceMode === "library" && panoramaPreview && <div className="panorama-ready"><img src={panoramaPreview} alt="Selected Poly Haven panorama" /><span><Check size={14} /> Panorama ready</span></div>}
            <section className="forge-setup compact-forge-setup">
              <div><strong>Local workflows</strong><small>Included and ready to run.</small></div>
              <div className="splat-input-grid">
                <div className="included-workflow"><Check size={16} /><strong>360° panorama</strong><small>{panoramaWorkflowName}</small><label>Override<input type="file" accept="application/json,.json" onChange={(event) => void loadWorkflow(event.target.files?.[0], "panorama")} /></label></div>
                <div className="included-workflow"><Check size={16} /><strong>3D SplatKit</strong><small>{datasetWorkflowName}</small><label>Override<input type="file" accept="application/json,.json" onChange={(event) => void loadWorkflow(event.target.files?.[0], "dataset")} /></label></div>
                <label><Upload size={16} /><strong>Import splat</strong><small>PLY or SOG</small><input type="file" accept=".ply,.sog" onChange={(event) => void importSplat(event.target.files?.[0])} /></label>
              </div>
              <div className="automatic-setup-note"><Download size={14} /><span><strong>No manual setup</strong><small>DnDRom installs and starts every local tool.</small></span></div>
            </section>
            </aside>

            <main className="creator-stage scene-creator-stage" aria-label="Scene 3D preview">
              <div className="scene-forge-stage"><SceneViewport map={forgePreviewMap} tokenAssets={tokenAssets.length ? tokenAssets : EMPTY_TOKEN_ASSETS} propAssets={campaign.propAssets ?? []} materialAssets={campaign.materialAssets ?? []} selectedEntityId={null} activeAssetId={null} showGrid={false} environmentPanorama={panorama} worldOverview onPlace={() => undefined} onSelect={() => undefined} onPipette={() => undefined} />{panoramaPreview && <div className="scene-source-preview"><img src={panoramaPreview} alt="Current scene panorama" /><span>IBL source</span></div>}</div>
              {concepts.length > 0 && <section className="world-concept-review" aria-label="World concept review">{concepts.map((concept, index) => <button key={concept.id} className={selectedConceptId === concept.id ? "selected" : ""} onClick={() => { setSelectedConceptId(concept.id); setDraftMap(null); }}><span className="concept-map-icon"><Map size={20} /></span><span><strong>Concept {index + 1}: {concept.name}</strong><small>{concept.kind} · {concept.width}m · {concept.biome.id} · {concept.zones.length} connected zones</small></span>{selectedConceptId === concept.id && <Check size={15} />}</button>)}</section>}
              <div className="stage-status-bar"><div className="splat-status" aria-live="polite"><span className={running ? "pulse" : ""} />{status}</div>{retryAvailable && !running && <><button className="world-retry-button" onClick={() => void runGeneration(true)}><RotateCcw size={15} /> Retry failed stage</button><button className="world-retry-button" onClick={retryWithReferenceQuality}><Sparkles size={15} /> Retry with reference quality</button><button className="world-retry-button" disabled={!draftMap?.validation?.valid} onClick={publishBaseWorld}><ShieldCheck size={15} /> Continue without background</button></>}<button className="primary-button magical-button" disabled={running || (sourceMode === "prompt" ? !description.trim() : !panorama)} onClick={() => void runGeneration()}>{running ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />}{running ? "Forging your world…" : sourceMode === "prompt" ? "Generate panorama + 3D world" : "Build 3D world locally"}</button>{running && <button className="danger-button" onClick={() => abortRef.current?.abort()}>Cancel</button>}</div>
              {legacyGeneratedWorld && <div className="world-pipeline-upgrade" role="status"><span><strong>Legacy flat-tile world</strong><small>This saved scene predates elevation fields, ribbon roads and rivers, ecological foliage, and terrain streaming fixes.</small></span><button className="primary-button" disabled={running || worldPlanning} onClick={prepareLegacyWorldRebuild}><RotateCcw size={14} /> Prepare visual rebuild</button></div>}
              <div className="stage-caption"><strong>{previewMap.name}</strong><span>{draftMap ? `${draftMap.world?.chunks.length ?? 1} streaming chunks · procedural gameplay authority` : "Drag to orbit · wheel to zoom · current published scene remains unchanged"}</span></div>
            </main>

            <aside className="creator-sidebar creator-sidebar-right" aria-label="Scene lighting settings">
              <section className="world-draft-inspector" aria-label="World draft actions">
                <div className="sidebar-section-heading"><Network size={14} /><span><strong>World blueprint</strong><small>Review, validate, and publish</small></span></div>
                {selectedConceptId ? <><dl><div><dt>Concept</dt><dd>{concepts.find((entry) => entry.id === selectedConceptId)?.name}</dd></div><div><dt>Chunks</dt><dd>{draftMap?.world?.chunks.length ?? "Not built"}</dd></div><div><dt>Objects</dt><dd>{draftMap?.entities.length ?? "—"}</dd></div><div><dt>Validation</dt><dd className={draftMap?.validation?.valid ? "valid" : "pending"}>{draftMap?.validation?.valid ? "Passed" : "Pending"}</dd></div></dl><button className="primary-button" disabled={worldPlanning || running} onClick={() => void buildPlayableWorld()}>{worldPlanning ? <LoaderCircle className="spin" size={15} /> : <Layers3 size={15} />} Build playable world</button><button className="world-publish-button" disabled={!draftMap?.validation?.valid || worldPlanning || running} onClick={publishBaseWorld}><ShieldCheck size={15} /> Publish base world</button><small>Publishing always creates a new scene. Optional AI refinements remain reviewable.</small></> : <p>Create two plans to begin. Nothing changes the live campaign until Publish.</p>}
              </section>
              {selectedBlueprint && <section className="world-blueprint-details" aria-label="World blueprint details">
                <div><strong>Zones & connectivity</strong><small>{selectedBlueprint.zones.length} validated regions</small></div>
                <ul>{selectedBlueprint.zones.map((zone) => <li key={zone.id}><span>{zone.name}</span><small>{zone.purpose} · {zone.requiredConnections.length} links</small></li>)}</ul>
                <div><strong>Terrain & ecology</strong><small>{selectedBlueprint.biome.id} · relief {selectedBlueprint.terrain.relief.toFixed(1)}m · vegetation {Math.round(selectedBlueprint.biome.vegetationDensity * 100)}%</small></div>
                <div><strong>Asset refinements</strong><small>Catalogue first · explicit approval and apply</small></div>
                <ul>{selectedBlueprint.assetRequests.map((request) => { const refinement = draftMap?.pendingRefinements?.find((entry) => entry.assetRequestId === request.id); return <li key={request.id}><span>{request.name}</span><small>{request.importance} · {refinement?.status ?? request.status}{refinement?.source ? ` · ${refinement.source}` : ""}</small>{refinement?.resolvedAssetId && refinement.status === "catalogue-match" && <button onClick={() => approveRefinement(refinement.id)}><Check size={12} /> Approve match</button>}{refinement?.status === "needs-review" && <button onClick={() => onOpenPropForge?.({ name: request.name, description: request.description, kind: refinement.kind === "material" ? "material" : "object" })}><WandSparkles size={12} /> Review in {refinement.kind === "material" ? "Material" : "Prop"} Forge</button>}</li>; })}</ul>
                {draftMap?.pendingRefinements?.length ? <div className="world-refinement-actions"><button onClick={refreshRefinementMatches}><Search size={13} /> Rescan catalogues</button><button className="primary-button" disabled={!draftMap.pendingRefinements.some((entry) => entry.status === "approved")} onClick={applyRefinements}><Check size={13} /> Apply approved refinements</button></div> : null}
                {draftMap?.world && <div><strong>Streaming status</strong><small>{draftMap.world.chunks.length} chunks · 16m each · three geometry LODs</small></div>}
              </section>}
              <div className="sidebar-section-heading"><Lightbulb size={14} /><span><strong>Lighting engine</strong><small>IBL · three-point rig · PBR</small></span></div>
              <label className="field-label">Mood<select value={lighting.mood} onChange={(event) => updateMapLighting({ mood: event.target.value as LightingMood })}><option value="natural">Natural</option><option value="warm">Warm tavern</option><option value="moonlight">Moonlight</option><option value="crypt">Crypt</option><option value="desert">Desert</option></select></label>
              <label className="field-label">Scene quality<select value={lighting.quality} onChange={(event) => updateMapLighting({ quality: event.target.value as LightingQuality })}><option value="performance">Performance</option><option value="balanced">Balanced</option><option value="cinematic">Cinematic</option><option value="diorama">Diorama</option></select><small>The top-bar Display setting can override this scene.</small></label>
              <label className="field-label">HDRI / IBL <span>{lighting.iblIntensity.toFixed(2)}×</span><input type="range" min="0" max="1.5" step="0.05" value={lighting.iblIntensity} onChange={(event) => updateMapLighting({ iblIntensity: Number(event.target.value) })} /></label>
              <label className="field-label">Sun / moon key <span>{lighting.keyIntensity.toFixed(2)}×</span><input type="range" min="0" max="2" step="0.05" value={lighting.keyIntensity} onChange={(event) => updateMapLighting({ keyIntensity: Number(event.target.value) })} /><small>Directional world light. Generated regions retain a safe visibility floor.</small></label>
              <label className="field-label">Cool fill <span>{lighting.fillIntensity.toFixed(2)}×</span><input type="range" min="0" max="2" step="0.05" value={lighting.fillIntensity} onChange={(event) => updateMapLighting({ fillIntensity: Number(event.target.value) })} /></label>
              <label className="field-label">Camera rim <span>{lighting.rimIntensity.toFixed(2)}×</span><input type="range" min="0" max="2" step="0.05" value={lighting.rimIntensity} onChange={(event) => updateMapLighting({ rimIntensity: Number(event.target.value) })} /></label>
              <label className="field-label">Exposure <span>{lighting.exposure.toFixed(2)}×</span><input type="range" min="0.55" max="1.6" step="0.05" value={lighting.exposure} onChange={(event) => updateMapLighting({ exposure: Number(event.target.value) })} /></label>
              <div className="lighting-toggle-grid">
                <label><input type="checkbox" checked={lighting.dynamicLights} onChange={(event) => updateMapLighting({ dynamicLights: event.target.checked })} /><span>Practical lights<small>Torches and magic</small></span></label>
                <label><input type="checkbox" checked={lighting.ssao} onChange={(event) => updateMapLighting({ ssao: event.target.checked })} /><span>SSAO<small>Contact grounding</small></span></label>
                <label><input type="checkbox" checked={lighting.bloom} onChange={(event) => updateMapLighting({ bloom: event.target.checked })} /><span>Bloom<small>Emissive glow</small></span></label>
                <label><input type="checkbox" checked={lighting.depthOfField} onChange={(event) => updateMapLighting({ depthOfField: event.target.checked })} /><span>Tilt-shift DoF<small>Miniature focus</small></span></label>
                <label><input type="checkbox" checked={lighting.fogOfWar} onChange={(event) => updateMapLighting({ fogOfWar: event.target.checked })} /><span>Fog of war<small>Published Play view; Forge stays fully visible</small></span></label>
                <label><input type="checkbox" checked={lighting.fogMist} onChange={(event) => updateMapLighting({ fogMist: event.target.checked })} /><span>Volumetric mist<small>Cinematic quality</small></span></label>
              </div>
              <p className="lighting-budget-note">{lighting.quality === "performance" ? "2 smooth practical lights · one 1024px directional shadow · post effects reduced" : lighting.quality === "balanced" ? "4 smooth practical lights · one 2048px directional shadow · balanced SSAO" : lighting.quality === "cinematic" ? "6 smooth practical lights · one 2048px directional shadow · cinematic SSAO and DoF" : "8 smooth practical lights · one 4096px directional shadow · supersampled diorama detail"}</p>
            <section className="forge-setup">
              {scenery.length > 0 && <section className="splat-list"><strong>Scenery on {campaign.map.name}</strong>{scenery.map((entry) => <div key={entry.id}><span>{entry.name}<small>{entry.format.toUpperCase()} · {formatBytes(entry.byteLength)}</small></span><button title="Remove from map" onClick={() => removeScenery(entry.id)}><Trash2 size={14} /></button></div>)}</section>}
            </section>
            <p className="splat-links"><a href="https://github.com/mickmumpitz/ComfyUI-SplatKit" target="_blank" rel="noreferrer"><ExternalLink size={12} /> SplatKit</a><a href="https://github.com/ArthurBrussee/brush" target="_blank" rel="noreferrer"><ExternalLink size={12} /> Brush</a><a href="https://polyhaven.com/hdris" target="_blank" rel="noreferrer"><ExternalLink size={12} /> Poly Haven</a></p>
            </aside>
            </div>
            <p className="local-only-note">Generation stays local. The online library only requests public thumbnails and your chosen CC0 panorama from Poly Haven.</p>
            {sceneCatalogueOpen && <AssetCatalogueDialog ariaLabel="Scene catalogue" eyebrow={<><BookOpen size={13} /> Local scene catalogue</>} title="Reusable playable worlds" description="Search generated regions, inspect their dependencies, and load a copy into Scene Forge without replacing the current scene." searchPlaceholder="Search scenes, biomes, or descriptions" onClose={() => setSceneCatalogueOpen(false)} empty={<div className="miniature-library-empty"><Map size={28} /><strong>No saved scenes yet</strong><small>Publish a playable world and it will be saved here.</small></div>} items={sceneLibrary.map((template) => { const inCampaign = campaign.sceneTemplates?.some((entry) => entry.id === template.id) ?? false; return { id: template.id, name: template.name, searchText: `${template.description} ${template.map.theme} ${template.map.generation?.blueprint.biome.id ?? ""}`, preview: <div className="scene-template-preview" style={{ background: `linear-gradient(145deg, ${template.map.ambientColor}, #10130f)` }}><Map size={32} /><span>{template.map.width}×{template.map.depth}m</span></div>, details: <>{template.map.theme} · {template.map.world?.chunks.length ?? 1} chunks · {template.revisions.length} revisions · {template.propAssetIds.length + template.materialAssetIds.length} dependencies</>, inCampaign, actions: <><button onClick={() => openSceneTemplate(template.map, template.description)}>Open in Forge</button><button onClick={() => duplicateSceneTemplate(template.map, template.description)}>Duplicate</button>{template.revisions.length > 1 && <button onClick={() => openSceneTemplate(template.revisions[1].map, template.description)}>Restore prior revision</button>}{inCampaign ? <button onClick={() => removeSceneTemplateFromCampaign(template.id)}>Remove from campaign</button> : <button className="primary-button" onClick={() => addSceneTemplateToCampaign(template.id)}>Add to campaign</button>}<button className="danger-button" onClick={() => removeSceneTemplate(template.id)}><Trash2 size={13} /> Delete</button></>, status: inCampaign ? <span className="campaign-token-status"><Check size={12} /> In campaign</span> : undefined }; })} />}
          </section>
  );
}
