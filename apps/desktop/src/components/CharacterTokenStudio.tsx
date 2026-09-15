import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, Bone, Box, Check, CircleDot, Cpu, Download, Edit3, ImagePlus, Lightbulb, LoaderCircle, MapPin, Palette, Plus, RotateCcw, ShieldPlus, Sparkles, Trash2, Upload } from "lucide-react";
import { generateCharacterGlb, resolveCharacterComfyEndpoint, type Character3dProvider, type CharacterGenerationProgress } from "../ai/character3dClient";
import { configureCharacterPreset, loadBundledWorkflow, materializeComfyWorkflow, type ComfyWorkflowPreset } from "../ai/comfyWorkflowPreset";
import { ensureLocalRuntime, formatRuntimeBytes, getLocalRuntimeStatus, runtimeProgressPercent, type LocalRuntimeFeature } from "../ai/localRuntime";
import type { LightingMood, LightingQuality, SceneLightingSettings, TokenBaseShape, TokenKind } from "../domain/types";
import { DEFAULT_SCENE_LIGHTING } from "../domain/lighting";
import { getStoredTokenModel, mergeTokenAssetRevision, storeTokenAnimationFile, storeTokenModel, storeTokenRevisionModel, storeTokenRigFile, storeTokenStateModel } from "../persistence/tokenAssets";
import { clearCreatorDraft, clearCreatorDraftFiles, readCreatorDraft, readCreatorDraftFile, writeCreatorDraft, writeCreatorDraftFile, type CharacterForgeDraft } from "../persistence/creatorDrafts";
import { clampMiniatureFaces, DEFAULT_MINIATURE_FACES, DEFAULT_MINIATURE_PRECLUSTER_MAX_VERTICES, MAX_MINIATURE_FACES, MIN_MINIATURE_FACES } from "../domain/meshBudget";
import { useCampaignStore } from "../state/campaignStore";
import { selectMiniatureLibrary } from "../state/selectors";
import { TokenModelPreview } from "./TokenModelPreview";
import { resolveBasePlateAssetId } from "../domain/baseplates";
import { importCharacterFile, type CharacterImportResult } from "../importers/characterImport";
import { GenerationProgress, type GenerationProgressView } from "./GenerationProgress";
import { SketchPaintStudio } from "./SketchPaintStudio";
import { generateCharacterEditReference, generateCharacterPaintAssist, type CharacterEditProgress, type CharacterPaintRequest } from "../ai/characterEditClient";
import { autoRigCharacter, type CharacterRigProfile } from "../ai/characterRigClient";
import { generateCharacterMotion } from "../ai/characterAnimationClient";
import { paintExistingCharacterMesh } from "../ai/characterMeshEditClient";
import { defaultTokenAnimations, normalizeTokenAnimation, resolveTokenForms, resolveTokenStates } from "../domain/tokenAnimation";
import { TokenStateAnimationEditor, type ForgeTokenStateDraft } from "./TokenStateAnimationEditor";
import { AssetThumbnail } from "./AssetThumbnail";
import { BasePlateStudio } from "./BasePlateStudio";
import { AssetCatalogueDialog } from "./AssetCatalogueDialog";

interface CharacterTokenStudioProps {
  onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
  onBack: () => void;
  onOpenSheet: (characterId: string) => void;
  requestedTokenId?: string | null;
  onRequestedTokenLoaded?: () => void;
  onNewDraftReady?: () => void;
}

const roleDefaults: Record<TokenKind, { footprint: number; scale: number; base: string; accent: string }> = {
  player: { footprint: 0.55, scale: 1, base: "#17243a", accent: "#4f8fd8" },
  enemy: { footprint: 0.65, scale: 1, base: "#341b1d", accent: "#b54b51" },
  boss: { footprint: 1.25, scale: 1.35, base: "#28152f", accent: "#a85cc1" },
};

export function CharacterTokenStudio({ onNotify, onBack, onOpenSheet, requestedTokenId = null, onRequestedTokenLoaded, onNewDraftReady }: CharacterTokenStudioProps) {
  const campaignId = useCampaignStore((state) => state.campaign.id);
  const savedDraft = useMemo(() => readCreatorDraft<CharacterForgeDraft>(campaignId, "character"), [campaignId]);
  const [name, setName] = useState(savedDraft?.name ?? "New miniature");
  const [kind, setKind] = useState<TokenKind>(savedDraft?.kind ?? "player");
  const [provider, setProvider] = useState<Character3dProvider>(savedDraft?.provider ?? "pixal3d");
  const [drawing, setDrawing] = useState<File | null>(null);
  const [originalDrawing, setOriginalDrawing] = useState<File | null>(null);
  const [workflow, setWorkflow] = useState<ComfyWorkflowPreset | null>(null);
  const [workflowName, setWorkflowName] = useState("Loading included workflow…");
  const [runtimeStatus, setRuntimeStatus] = useState<{ tone: "checking" | "ready" | "missing"; message: string }>({ tone: "checking", message: "Checking local generation…" });
  const [model, setModel] = useState<File | null>(null);
  const [savedAssetId, setSavedAssetId] = useState<string | null>(null);
  const [rigWorkflowStep, setRigWorkflowStep] = useState<1 | 2 | 3>(1);
  const [characterId, setCharacterId] = useState(savedDraft?.characterId ?? "");
  const [baseShape, setBaseShape] = useState<TokenBaseShape>(savedDraft?.baseShape ?? "round");
  const [baseColor, setBaseColor] = useState(savedDraft?.baseColor ?? roleDefaults.player.base);
  const [accentColor, setAccentColor] = useState(savedDraft?.accentColor ?? roleDefaults.player.accent);
  const [footprint, setFootprint] = useState(savedDraft?.footprint ?? roleDefaults.player.footprint);
  const [modelScale, setModelScale] = useState(savedDraft?.modelScale ?? 1);
  const [placementScale, setPlacementScale] = useState(savedDraft?.placementScale ?? roleDefaults.player.scale);
  const [targetFaces, setTargetFaces] = useState(clampMiniatureFaces(savedDraft?.targetFaces ?? DEFAULT_MINIATURE_FACES));
  const [previewLighting, setPreviewLighting] = useState<SceneLightingSettings>({ ...DEFAULT_SCENE_LIGHTING, mood: "warm", dynamicLights: false, depthOfField: false, ...savedDraft?.previewLighting });
  const [working, setWorking] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgressView | null>(null);
  const [draftFilesReady, setDraftFilesReady] = useState(false);
  const [sheetImport, setSheetImport] = useState<CharacterImportResult | null>(null);
  const [importingSheet, setImportingSheet] = useState(false);
  const [studioMode, setStudioMode] = useState<"model" | "paint">("model");
  const [basePlateStudioOpen, setBasePlateStudioOpen] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState(savedDraft?.editPrompt ?? "");
  const [editStrength, setEditStrength] = useState(savedDraft?.editStrength ?? .48);
  const [previousRevision, setPreviousRevision] = useState<{ drawing: File; model: File | null; assetId: string | null } | null>(null);
  const [rigProfile, setRigProfile] = useState<CharacterRigProfile>(savedDraft?.rigProfile ?? "humanoid");
  const [riggedModel, setRiggedModel] = useState<File | null>(null);
  const initialStateId = savedDraft?.activeStateId ?? savedDraft?.states?.[0]?.id ?? `token-state-${crypto.randomUUID()}`;
  const [tokenStates, setTokenStates] = useState<ForgeTokenStateDraft[]>(() => savedDraft?.states?.length
    ? savedDraft.states.map((state) => ({ ...state, formId: state.formId ?? state.id, styleName: state.styleName ?? "Classic", model: null, riggedModel: null, rigProfile: state.rigProfile ?? savedDraft.rigProfile ?? "humanoid", animations: state.animations.map((animation) => ({ ...normalizeTokenAnimation(animation), draftFile: null })), revisions: state.revisions?.map((revision) => ({ ...revision, model: null })) ?? [] }))
    : [{ id: initialStateId, formId: initialStateId, name: "Default", styleName: "Classic", model: null, riggedModel: null, rigProfile: savedDraft?.rigProfile ?? "humanoid", animations: defaultTokenAnimations(), revisions: [] }]);
  const [activeStateId, setActiveStateId] = useState(initialStateId);
  const sheetFileRef = useRef<HTMLInputElement>(null);
  const draftRecoveryAttempted = useRef(false);
  const activeEditAbort = useRef<AbortController | null>(null);
  const characters = useCampaignStore((state) => state.campaign.characters);
  const campaignTokenAssets = useCampaignStore((state) => state.campaign.tokenAssets ?? []);
  const tokenAssets = useCampaignStore(selectMiniatureLibrary);
  const basePlateCampaign = useCampaignStore(state => state.campaign);
  const basePlateLibrary = useCampaignStore(state => state.basePlateLibrary);
  const scenicProps = useCampaignStore(state => state.propLibrary);
  const scenicMaterials = useCampaignStore(state => state.materialLibrary);
  const endpoint = useCampaignStore((state) => resolveCharacterComfyEndpoint(state.campaign.settings?.comfyUiEndpoint));
  const addTokenAsset = useCampaignStore((state) => state.addTokenAsset);
  const addCharacter = useCampaignStore((state) => state.addCharacter);
  const updateCharacter = useCampaignStore((state) => state.updateCharacter);
  const removeTokenAsset = useCampaignStore((state) => state.removeTokenAsset);
  const linkTokenCharacter = useCampaignStore((state) => state.linkTokenCharacter);
  const updateSettings = useCampaignStore((state) => state.updateSettings);
  const drawingUrl = useMemo(() => drawing ? URL.createObjectURL(drawing) : "", [drawing]);
  useEffect(() => () => { if (drawingUrl) URL.revokeObjectURL(drawingUrl); }, [drawingUrl]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      readCreatorDraftFile(campaignId, "character-drawing"),
      readCreatorDraftFile(campaignId, "character-original"),
      readCreatorDraftFile(campaignId, "character-model"),
      readCreatorDraftFile(campaignId, "character-rig"),
    ]).then(async ([savedDrawing, savedOriginal, savedModel, savedRig]) => {
      if (cancelled) return;
      if (savedDrawing) {
        setDrawing(savedDrawing);
        setOriginalDrawing(savedOriginal ?? savedDrawing);
      }
      if (savedModel) setModel(savedModel);
      if (savedRig) {
        setRiggedModel(savedRig);
        if (!savedDraft?.states?.length) setTokenStates((states) => states.map((state, index) => index === 0 ? { ...state, riggedModel: savedRig, rigSlot: `character-rig-${state.id}`, rigProfile: savedDraft?.rigProfile ?? "humanoid" } : state));
      }
      if (savedDraft?.states?.length) {
        const hydrated = await Promise.all(savedDraft.states.map(async (state, index) => ({
          id: state.id,
          formId: state.formId ?? state.id,
          name: state.name,
          styleName: state.styleName ?? "Classic",
          modelSlot: state.modelSlot,
          model: state.modelSlot ? await readCreatorDraftFile(campaignId, state.modelSlot) : null,
          riggedModel: state.rigSlot ? await readCreatorDraftFile(campaignId, state.rigSlot) : index === 0 ? savedRig : null,
          rigSlot: state.rigSlot,
          rigProfile: state.rigProfile ?? savedDraft.rigProfile ?? "humanoid",
          rigCreatedAt: state.rigCreatedAt,
          animations: await Promise.all(state.animations.map(async (animation) => ({
            ...animation,
            draftFile: animation.fileSlot ? await readCreatorDraftFile(campaignId, animation.fileSlot) : null,
          }))),
          revisions: await Promise.all((state.revisions ?? []).map(async (revision) => ({
            ...revision,
            model: await readCreatorDraftFile(campaignId, revision.fileSlot),
          }))),
        })));
        if (!cancelled) setTokenStates(hydrated);
      }
      setDraftFilesReady(true);
    });
    return () => { cancelled = true; };
  }, [campaignId]);

  useEffect(() => {
    writeCreatorDraft<CharacterForgeDraft>(campaignId, "character", {
      name, kind, provider, characterId, baseShape, baseColor, accentColor, footprint, modelScale, placementScale, targetFaces,
      previewLighting, drawingName: drawing?.name, modelName: model?.name, editPrompt, editStrength, rigProfile, rigName: riggedModel?.name, activeStateId,
      states: tokenStates.map((state, index) => ({
        id: state.id,
        formId: state.formId ?? state.id,
        name: state.name,
        styleName: state.styleName ?? "Classic",
        modelSlot: index === 0 ? undefined : state.modelSlot ?? `character-state-${state.id}`,
        modelName: state.model?.name,
        rigSlot: state.riggedModel ? state.rigSlot ?? `character-rig-${state.id}` : undefined,
        rigName: state.riggedModel?.name,
        rigProfile: state.rigProfile ?? rigProfile,
        rigCreatedAt: state.rigCreatedAt,
        animations: state.animations.map(({ draftFile, ...animation }) => ({ ...animation, fileSlot: draftFile ? animation.fileSlot ?? `character-animation-${animation.id}` : animation.fileSlot })),
        revisions: state.revisions?.map(({ model: _model, ...revision }) => revision),
      })),
      updatedAt: new Date().toISOString(),
    });
  }, [campaignId, name, kind, provider, characterId, baseShape, baseColor, accentColor, footprint, modelScale, placementScale, targetFaces, previewLighting, drawing?.name, model?.name, editPrompt, editStrength, rigProfile, riggedModel?.name, activeStateId, tokenStates]);

  useEffect(() => { if (draftFilesReady) void writeCreatorDraftFile(campaignId, "character-drawing", drawing); }, [campaignId, drawing, draftFilesReady]);
  useEffect(() => { if (draftFilesReady) void writeCreatorDraftFile(campaignId, "character-original", originalDrawing); }, [campaignId, originalDrawing, draftFilesReady]);
  useEffect(() => { if (draftFilesReady) void writeCreatorDraftFile(campaignId, "character-model", model); }, [campaignId, model, draftFilesReady]);
  useEffect(() => { if (draftFilesReady) void writeCreatorDraftFile(campaignId, "character-rig", riggedModel); }, [campaignId, riggedModel, draftFilesReady]);
  useEffect(() => {
    if (!draftFilesReady) return;
    void Promise.all(tokenStates.flatMap((state, index) => [
      ...(index > 0 ? [writeCreatorDraftFile(campaignId, state.modelSlot ?? `character-state-${state.id}`, state.model)] : []),
      ...(state.riggedModel ? [writeCreatorDraftFile(campaignId, state.rigSlot ?? `character-rig-${state.id}`, state.riggedModel)] : []),
      ...state.animations.flatMap((animation) => animation.fileSlot ? [writeCreatorDraftFile(campaignId, animation.fileSlot, animation.draftFile ?? null)] : []),
      ...(state.revisions?.map((revision) => writeCreatorDraftFile(campaignId, revision.fileSlot, revision.model)) ?? []),
    ]));
  }, [campaignId, draftFilesReady, tokenStates]);

  useEffect(() => {
    let cancelled = false;
    void loadBundledWorkflow("/workflows/pixal3d-character.json").then((preset) => {
      if (cancelled) return;
      setWorkflow(preset);
      setWorkflowName("Included Pixal3D / TRELLIS.2 workflow");
    }).catch((error) => {
      if (cancelled) return;
      setWorkflowName("Included workflow unavailable");
      setRuntimeStatus({ tone: "missing", message: error instanceof Error ? error.message : "Workflow could not be loaded" });
    });
    return () => { cancelled = true; };
  }, []);

  const checkRuntime = async (notify = false) => {
    if (!workflow) return;
    const feature: LocalRuntimeFeature = provider === "pixal3d" ? "characterPixal3d" : "characterTrellis2";
    setRuntimeStatus({ tone: "checking", message: "Checking the private local creation tools…" });
    try {
      const nativeStatus = await getLocalRuntimeStatus(feature);
      if (nativeStatus && nativeStatus.state !== "ready" && nativeStatus.state !== "external") {
        const message = nativeStatus.state === "needsStart"
          ? "Local tools are installed and start automatically when you generate"
          : `One-time ${formatRuntimeBytes(nativeStatus.requiredBytes)} setup starts automatically when you generate`;
        setRuntimeStatus({ tone: "missing", message });
        if (notify) onNotify("Nothing else to install. Press Generate and DnDRom will prepare everything automatically.", "info");
        return;
      }
      const generationEndpoint = nativeStatus?.endpoint ?? endpoint;
      const readiness = await materializeComfyWorkflow(generationEndpoint, configureCharacterPreset(workflow, provider));
      if (readiness.missingNodes.length) setRuntimeStatus({ tone: "missing", message: "Automatic tool setup is incomplete · retry Generate" });
      else if (readiness.missingModels.length) setRuntimeStatus({ tone: "missing", message: "Automatic model setup is incomplete · retry Generate" });
      else {
        setRuntimeStatus({ tone: "ready", message: `${provider === "pixal3d" ? "Pixal3D" : "TRELLIS.2"} is ready to generate` });
        if (notify) onNotify("Local character generation is ready.", "success");
      }
    } catch {
      setRuntimeStatus({ tone: "missing", message: "Local tools will be downloaded and started automatically" });
      if (notify) onNotify("Press Generate and DnDRom will prepare the private local generator automatically.", "info");
    }
  };

  useEffect(() => {
    if (workflow) void checkRuntime();
    // Runtime checks are intentionally triggered only when the workspace or lane changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow, provider]);

  const applyKind = (value: TokenKind) => {
    const defaults = roleDefaults[value];
    setKind(value);
    setFootprint(defaults.footprint);
    setPlacementScale(defaults.scale);
    setBaseColor(defaults.base);
    setAccentColor(defaults.accent);
  };

  const createAndAttachSheet = () => {
    const sheet = addCharacter();
    updateCharacter(sheet.id, {
      name: name.trim() || sheet.name,
      role: kind,
      sheetVisibility: kind === "player" ? "players" : "dm",
      playerName: kind === "player" ? sheet.playerName : "Dungeon Master",
    });
    setCharacterId(sheet.id);
    if (savedAssetId) linkTokenCharacter(savedAssetId, sheet.id);
    onNotify(`${name.trim() || sheet.name} now has an attached ${kind} sheet.`, "success");
  };

  const importSheet = async (file?: File) => {
    if (!file) return;
    setImportingSheet(true);
    try {
      setSheetImport(await importCharacterFile(file));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Character sheet import failed", "error");
    } finally {
      setImportingSheet(false);
      if (sheetFileRef.current) sheetFileRef.current.value = "";
    }
  };

  const acceptImportedSheet = () => {
    if (!sheetImport) return;
    const attached = addCharacter({
      ...sheetImport.character,
      role: kind,
      sheetVisibility: kind === "player" ? "players" : "dm",
    });
    setCharacterId(attached.id);
    if (savedAssetId) linkTokenCharacter(savedAssetId, attached.id);
    setName((current) => current === "New miniature" ? attached.name : current);
    onNotify(`${attached.name}'s reviewed sheet is attached to this ${kind}.`, "success");
    setSheetImport(null);
  };

  const resetDraftEditor = () => {
    const defaults = roleDefaults.player;
    setName("New miniature");
    setKind("player");
    setProvider("pixal3d");
    setDrawing(null);
    setOriginalDrawing(null);
    setModel(null);
    setRiggedModel(null);
    setSavedAssetId(null);
    setCharacterId("");
    setBaseShape("round");
    setBaseColor(defaults.base);
    setAccentColor(defaults.accent);
    setFootprint(defaults.footprint);
    setModelScale(1);
    setPlacementScale(defaults.scale);
    setTargetFaces(DEFAULT_MINIATURE_FACES);
    setPreviewLighting({ ...DEFAULT_SCENE_LIGHTING, mood: "warm", dynamicLights: false, depthOfField: false });
    setGenerationProgress(null);
    setEditPrompt("");
    setEditStrength(.48);
    setPreviousRevision(null);
    setStudioMode("model");
    setRigProfile("humanoid");
    const stateId = `token-state-${crypto.randomUUID()}`;
    setTokenStates([{ id: stateId, formId: stateId, name: "Default", styleName: "Classic", model: null, riggedModel: null, rigProfile: "humanoid", animations: defaultTokenAnimations(), revisions: [] }]);
    setActiveStateId(stateId);
  };

  const loadWorkflow = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as ComfyWorkflowPreset;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Workflow JSON must be a ComfyUI API object");
      setWorkflow(parsed);
      setWorkflowName(file.name);
      onNotify(`${file.name} loaded for local generation.`, "success");
    } catch (error) {
      setWorkflow(null);
      setWorkflowName("Custom workflow could not be read");
      onNotify(error instanceof Error ? error.message : "Workflow JSON could not be read", "error");
    }
  };

  const persistModelToLibrary = async (file: File, automatic = false, targetAssetId: string | null = savedAssetId, states = tokenStates) => {
    const preparedStates = await Promise.all(states.map(async (state, index) => {
      const stateFile = index === 0 ? file : state.model;
      if (!stateFile) throw new Error(`${state.name || "Alternate form"} needs a GLB before this token can be saved`);
      const animations = await Promise.all(state.animations.map(async ({ draftFile, fileSlot: _fileSlot, ...animation }) => ({
        ...animation,
        sourceFile: draftFile ? await storeTokenAnimationFile(draftFile) : animation.sourceFile,
        source: draftFile || animation.sourceFile ? animation.source : "procedural" as const,
      })));
      const rig = state.riggedModel
        ? await storeTokenRigFile(state.riggedModel, state.rigProfile ?? rigProfile, state.rigCreatedAt)
        : undefined;
      const revisions = await Promise.all((state.revisions ?? []).filter((revision) => revision.model).slice(0, 8).map((revision) => storeTokenRevisionModel(revision.model!, revision)));
      return await storeTokenStateModel(stateFile, { id: state.id, formId: state.formId ?? state.id, name: state.name, styleName: state.styleName ?? "Classic", modelScale, modelLift: .62, animations, rig, revisions });
    }));
    const created = await storeTokenModel(file, {
      name,
      kind,
      baseShape,
      baseColor,
      accentColor,
      footprint,
      modelScale,
      defaultPlacementScale: placementScale,
      characterId: characterId || undefined,
      source: drawing ? provider : "import",
      sourceImageName: drawing?.name,
      sourceImage: drawing,
      originalSourceImage: originalDrawing ?? drawing,
      states: preparedStates,
      defaultStateId: preparedStates[0]?.id,
    });
    const previous = targetAssetId ? tokenAssets.find((entry) => entry.id === targetAssetId) : undefined;
    const asset = mergeTokenAssetRevision(created, previous);
    addTokenAsset(asset);
    if (characterId) linkTokenCharacter(asset.id, characterId);
    useCampaignStore.getState().setActiveAsset(asset.id);
    setSavedAssetId(asset.id);
    if (!automatic) onNotify(`${asset.name} is in Minis and ready to place.`, "success");
    return asset;
  };

  const startNewDraft = async () => {
    if (working) return;
    if (!model && (drawing || originalDrawing)) {
      onNotify("This draft has source artwork but no saved 3D miniature yet. Generate or import its model before starting another character so the artwork cannot be lost.", "warning");
      return;
    }
    setWorking(true);
    try {
      const checkpoint = model ? await persistModelToLibrary(model, true, savedAssetId) : null;
      // Stop file-writing effects before removing only this editor draft. App
      // remounts the editor so interconnected preview state is initialized once
      // instead of being reset through a chain of state updates.
      setDraftFilesReady(false);
      await clearCreatorDraftFiles(campaignId, "character");
      clearCreatorDraft(campaignId, "character");
      useCampaignStore.getState().setActiveAsset(null);
      if (onNewDraftReady) onNewDraftReady();
      else resetDraftEditor();
      onNotify(checkpoint
        ? `${checkpoint.name} was checkpointed in the character catalogue. A new blank character is ready.`
        : "A new blank character draft is ready. Your campaign scene was left unchanged.", "success");
    } catch (error) {
      onNotify(error instanceof Error ? `Could not start a new character safely: ${error.message}` : "Could not start a new character safely. The current draft was kept.", "error");
    } finally {
      setWorking(false);
    }
  };

  const generate = async (sourceDrawing: File | null = drawing) => {
    if (!sourceDrawing || !workflow) return;
    if (!sourceDrawing.type.startsWith("image/") || sourceDrawing.size > 20 * 1024 * 1024) {
      onNotify("Use a PNG, JPEG, or WebP drawing smaller than 20 MB.", "error");
      return;
    }
    setWorking(true);
    const startedAt = Date.now();
    setGenerationProgress({ status: "running", message: "Preparing the private local generator…", percent: 2, startedAt, stageLabel: "Step 1 of 5 · Local setup" });
    try {
      const feature: LocalRuntimeFeature = provider === "pixal3d" ? "characterPixal3d" : "characterTrellis2";
      const runtime = await ensureLocalRuntime(feature, (event) => {
        const percent = runtimeProgressPercent(event);
        setGenerationProgress({
          status: "running",
          message: event.message,
          percent: Math.max(2, Math.round(percent * .2)),
          startedAt,
          stageLabel: "Step 1 of 5 · Local setup",
          detail: `${formatRuntimeBytes(event.completedBytes)} / ${formatRuntimeBytes(event.totalBytes)}`,
        });
      });
      updateSettings({ comfyUiEndpoint: runtime.endpoint });
      setRuntimeStatus({ tone: "ready", message: `${provider === "pixal3d" ? "Pixal3D" : "TRELLIS.2"} is ready to generate` });
      const updateGenerationProgress = (event: CharacterGenerationProgress) => {
        const stageLabels: Record<CharacterGenerationProgress["stage"], string> = {
          workflow: "Step 2 of 5 · Workflow check",
          upload: "Step 3 of 5 · Drawing upload",
          queued: "Step 3 of 5 · GPU startup",
          generate: "Step 4 of 5 · 3D generation",
          download: "Step 5 of 5 · Model import",
          complete: "Complete · Character ready",
        };
        setGenerationProgress({
          status: event.stage === "complete" ? "complete" : "running",
          message: event.message,
          percent: event.percent,
          startedAt,
          stageLabel: stageLabels[event.stage],
          detail: event.completedNodes !== undefined && event.totalNodes !== undefined
            ? `${event.completedNodes} of ${event.totalNodes} workflow nodes complete`
            : undefined,
          reportedByEngine: event.reportedByEngine,
        });
      };
      const result = await generateCharacterGlb(runtime.endpoint, sourceDrawing, workflow, { provider, targetFaces }, undefined, updateGenerationProgress);
      const generationStates = savedAssetId ? (() => {
        const id = `token-state-${crypto.randomUUID()}`;
        return [{ id, formId: id, name: "Default", styleName: "Classic", model: null, riggedModel: null, rigProfile: "humanoid" as const, animations: defaultTokenAnimations(), revisions: [] }];
      })() : tokenStates;
      if (savedAssetId) {
        setTokenStates(generationStates);
        setActiveStateId(generationStates[0].id);
        setRiggedModel(null);
      }
      setModel(result);
      const asset = await persistModelToLibrary(result, true, null, generationStates);
      setGenerationProgress((current) => ({
        status: "complete",
        message: "Character ready and saved to your miniature library",
        percent: 100,
        startedAt: current?.startedAt ?? startedAt,
        stageLabel: "Complete · Character ready",
        detail: `${asset.name} is selected and ready to place on the tabletop`,
      }));
      onNotify(`${asset.name} finished rendering and was added to Minis.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Character generation failed";
      onNotify(message, "error");
      setGenerationProgress((current) => ({
        status: "error",
        message,
        percent: current?.percent ?? 0,
        startedAt: current?.startedAt ?? startedAt,
        stageLabel: "Generation stopped",
        detail: "Your drawing and forge settings are still saved",
      }));
    } finally {
      setWorking(false);
    }
  };

  const promptEditCharacter = async () => {
    const activeIndex = tokenStates.findIndex((state) => state.id === activeStateId);
    const resolvedIndex = activeIndex < 0 ? 0 : activeIndex;
    const activeState = tokenStates[resolvedIndex];
    const currentModel = resolvedIndex === 0 ? model : activeState?.model;
    if (!drawing || !currentModel || !editPrompt.trim()) {
      onNotify("Load a miniature and describe the local 3D change first.", "warning");
      return;
    }
    const original = { drawing, model, assetId: savedAssetId };
    const controller = new AbortController();
    activeEditAbort.current = controller;
    setWorking(true);
    const startedAt = Date.now();
    setGenerationProgress({ status: "running", message: "Preparing the private local character editor…", percent: 2, startedAt, stageLabel: "Revision 1 of 2 · Style reference" });
    try {
      const imageRuntime = await ensureLocalRuntime("world", (event) => setGenerationProgress({
        status: "running",
        message: event.message,
        percent: Math.max(2, Math.round(runtimeProgressPercent(event) * .18)),
        startedAt,
        stageLabel: "Revision 1 of 2 · Local image editor",
        detail: `${formatRuntimeBytes(event.completedBytes)} / ${formatRuntimeBytes(event.totalBytes)}`,
      }));
      const edited = await generateCharacterEditReference(imageRuntime.endpoint, drawing, editPrompt, editStrength, controller.signal, (event) => setGenerationProgress({
        status: "running",
        message: event.message,
        percent: Math.round(18 + event.percent * .22),
        startedAt,
        stageLabel: "Revision 1 of 2 · Protected style reference",
        reportedByEngine: event.reportedByEngine,
      }));
      setGenerationProgress({ status: "running", message: "Painting the existing mesh without changing its geometry…", percent: 42, startedAt, stageLabel: "Revision 2 of 2 · Preserve mesh & rig" });
      const revisedModel = await paintExistingCharacterMesh(imageRuntime.endpoint, currentModel, edited, `${name}-${activeState?.name ?? "form"}-${activeState?.styleName ?? "style"}`, controller.signal, (event) => setGenerationProgress({
        status: "running",
        message: event.message,
        percent: Math.round(42 + event.percent * .57),
        startedAt,
        stageLabel: "Revision 2 of 2 · Existing-mesh PBR edit",
        reportedByEngine: event.reportedByEngine,
      }));
      const revisionId = `token-revision-${crypto.randomUUID()}`;
      const revision = { id: revisionId, model: currentModel, fileSlot: `character-revision-${revisionId}` as const, createdAt: new Date().toISOString(), prompt: editPrompt, source: "prompt-edit" as const };
      const nextStates = tokenStates.map((state, index) => state.id !== activeState?.id ? state : { ...state, model: index === 0 ? null : revisedModel, revisions: [revision, ...(state.revisions ?? [])].slice(0, 8) });
      setPreviousRevision(original);
      setDrawing(edited);
      setTokenStates(nextStates);
      if (resolvedIndex === 0) setModel(revisedModel);
      setStudioMode("model");
      const defaultModel = resolvedIndex === 0 ? revisedModel : model;
      if (!defaultModel) throw new Error("The default token style is unavailable");
      const asset = await persistModelToLibrary(defaultModel, true, savedAssetId, nextStates);
      setGenerationProgress({ status: "complete", message: "3D style revision saved without replacing the mesh", percent: 100, startedAt, stageLabel: "Revision complete", detail: `${asset.name} kept its geometry, forms, styles, and restore history` });
      onNotify(`${activeState?.styleName ?? "Style"} was updated as a reversible local revision.`, "success");
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      const message = cancelled ? "Character revision cancelled" : error instanceof Error ? error.message : "Character revision failed";
      setGenerationProgress({ status: "error", message, percent: 0, startedAt, stageLabel: cancelled ? "Revision cancelled" : "Revision stopped", detail: "The current miniature and revision history were not changed" });
      onNotify(message, cancelled ? "warning" : "error");
    } finally {
      if (activeEditAbort.current === controller) activeEditAbort.current = null;
      setWorking(false);
    }
  };

  const restoreTokenRevision = (stateId: string, revisionId: string) => {
    const stateIndex = tokenStates.findIndex((state) => state.id === stateId);
    const state = tokenStates[stateIndex];
    const revision = state?.revisions?.find((entry) => entry.id === revisionId);
    const currentModel = stateIndex === 0 ? model : state?.model;
    if (!state || !revision?.model || !currentModel) {
      onNotify("That local revision file is no longer available on this device.", "error");
      return;
    }
    const currentId = `token-revision-${crypto.randomUUID()}`;
    const currentRevision = { id: currentId, model: currentModel, fileSlot: `character-revision-${currentId}` as const, createdAt: new Date().toISOString(), prompt: "Before revision restore", source: "prompt-edit" as const };
    setTokenStates((states) => states.map((entry, index) => entry.id !== stateId ? entry : {
      ...entry,
      model: index === 0 ? null : revision.model,
      revisions: [currentRevision, ...(entry.revisions ?? []).filter((item) => item.id !== revisionId), revision].slice(0, 8),
    }));
    if (stateIndex === 0) setModel(revision.model);
    onNotify(`Restored ${state.styleName ?? "Classic"} to the selected local version.`, "success");
  };

  const replaceStateModel = (stateId: string, replacement: File) => {
    const stateIndex = tokenStates.findIndex((state) => state.id === stateId);
    const state = tokenStates[stateIndex];
    const currentModel = stateIndex === 0 ? model : state?.model;
    if (!state || !currentModel) return;
    const revisionId = `token-revision-${crypto.randomUUID()}`;
    const revision = { id: revisionId, model: currentModel, fileSlot: `character-revision-${revisionId}` as const, createdAt: new Date().toISOString(), prompt: `Before importing ${replacement.name}`, source: "import" as const };
    const nextStates = tokenStates.map((entry, index) => entry.id !== stateId ? entry : {
      ...entry,
      model: index === 0 ? null : replacement,
      revisions: [revision, ...(entry.revisions ?? [])].slice(0, 8),
    });
    setTokenStates(nextStates);
    if (stateIndex === 0) setModel(replacement);
    onNotify(`${state.name} · ${state.styleName ?? "Classic"} saved the previous mesh as a restore point.`, "success");
    const defaultModel = stateIndex === 0 ? replacement : model;
    if (savedAssetId && defaultModel) void persistModelToLibrary(defaultModel, true, savedAssetId, nextStates).catch((error) => onNotify(error instanceof Error ? error.message : "The catalogue update failed", "error"));
  };

  const restorePreviousRevision = () => {
    if (!previousRevision) return;
    setDrawing(previousRevision.drawing);
    setModel(previousRevision.model);
    setSavedAssetId(previousRevision.assetId);
    if (previousRevision.assetId) useCampaignStore.getState().setActiveAsset(previousRevision.assetId);
    setPreviousRevision(null);
    setGenerationProgress(null);
    onNotify("Previous character revision restored.", "success");
  };

  const rigCharacter = async () => {
    const stateIndex = tokenStates.findIndex((state) => state.id === activeStateId);
    const resolvedIndex = stateIndex < 0 ? 0 : stateIndex;
    const state = tokenStates[resolvedIndex];
    const stateModel = resolvedIndex === 0 ? model : state?.model;
    if (!state || !stateModel) return;
    const profile = state.rigProfile ?? rigProfile;
    setWorking(true);
    const startedAt = Date.now();
    setGenerationProgress({ status: "running", message: "Preparing the private auto-rig tools…", percent: 2, startedAt, stageLabel: "Rig pipeline 1 of 3 · Local setup" });
    try {
      const runtime = await ensureLocalRuntime("characterRig", (event) => setGenerationProgress({
        status: "running",
        message: event.message,
        percent: Math.max(2, Math.round(runtimeProgressPercent(event) * .22)),
        startedAt,
        stageLabel: "Rig pipeline 1 of 3 · Local setup",
        detail: `${formatRuntimeBytes(event.completedBytes)} / ${formatRuntimeBytes(event.totalBytes)}`,
      }));
      const result = await autoRigCharacter(runtime.endpoint, stateModel, `${name}-${state.name}-${state.styleName ?? "Classic"}`, profile, undefined, (event) => setGenerationProgress({
        status: "running",
        message: event.message,
        percent: Math.round(22 + event.percent * .76),
        startedAt,
        stageLabel: profile === "humanoid" ? "Rig pipeline 1 of 3 · MIA skeleton & skinning" : "Rig pipeline 1 of 3 · UniRig skeleton & skinning",
        reportedByEngine: event.reportedByEngine,
      }));
      const rigCreatedAt = new Date().toISOString();
      setTokenStates((states) => states.map((entry) => entry.id === state.id ? { ...entry, riggedModel: result, rigSlot: entry.rigSlot ?? `character-rig-${entry.id}`, rigProfile: profile, rigCreatedAt } : entry));
      if (resolvedIndex === 0) setRiggedModel(result);
      setGenerationProgress({ status: "complete", message: "Skeleton and skin weights are ready", percent: 100, startedAt, stageLabel: "Rig pipeline 1 of 3 complete", detail: "Next: describe idle, attack, transformation, or ability motions" });
      onNotify(`${state.name} · ${state.styleName ?? "Classic"} is rigged. Add or reuse motion descriptions in step 2.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auto-rig failed";
      setGenerationProgress({ status: "error", message, percent: 0, startedAt, stageLabel: "Auto-rig stopped", detail: "The original GLB is unchanged" });
      onNotify(message, "error");
    } finally {
      setWorking(false);
    }
  };

  const generateMotion = async (stateId: string, animationId: string) => {
    const state = tokenStates.find((entry) => entry.id === stateId);
    const animation = state?.animations.find((entry) => entry.id === animationId);
    const stateIndex = tokenStates.findIndex((entry) => entry.id === stateId);
    const stateRig = state?.riggedModel ?? (stateIndex === 0 ? riggedModel : null);
    const profile = state?.rigProfile ?? rigProfile;
    if (!state || !animation || !stateRig) {
      onNotify("Auto-rig this form and style before generating skeletal motion.", "warning");
      return;
    }
    if (profile !== "humanoid") {
      onNotify("HY-Motion currently supports humanoids only. This creature will use its compiled tabletop motion profile.", "warning");
      return;
    }
    setWorking(true);
    const startedAt = Date.now();
    setGenerationProgress({ status: "running", message: "Preparing descriptor-driven animation…", percent: 2, startedAt, stageLabel: "Rig pipeline 2 of 3 · Motion generation" });
    try {
      const status = await getLocalRuntimeStatus("world");
      if (status?.state === "needsInstall") throw new Error("HY-Motion is an optional high-end pack and is not installed. Attach an FBX/animated GLB, or keep the immediate compiled tabletop motion.");
      const motionEndpoint = status?.state === "needsStart"
        ? (await ensureLocalRuntime("world", (event) => setGenerationProgress({
          status: "running",
          message: event.message,
          percent: Math.max(2, Math.round(runtimeProgressPercent(event) * .15)),
          startedAt,
          stageLabel: "Rig pipeline 2 of 3 · Start optional motion tools",
          detail: `${formatRuntimeBytes(event.completedBytes)} / ${formatRuntimeBytes(event.totalBytes)}`,
        }))).endpoint
        : status?.endpoint ?? endpoint;
      const result = await generateCharacterMotion(motionEndpoint, stateRig, animation.prompt, `${name}-${state.name}-${state.styleName ?? "Classic"}-${animation.name}`, animation.duration, undefined, (event) => setGenerationProgress({
        status: "running",
        message: event.message,
        percent: Math.round(15 + event.percent * .84),
        startedAt,
        stageLabel: "Rig pipeline 2 of 3 · Generate & retarget",
        reportedByEngine: event.reportedByEngine,
      }));
      setTokenStates((current) => current.map((entry) => entry.id !== stateId ? entry : {
        ...entry,
        animations: entry.animations.map((item) => item.id === animationId ? { ...item, source: "hy-motion", draftFile: result, fileSlot: item.fileSlot ?? `character-animation-${item.id}` } : item),
      }));
      setGenerationProgress({ status: "complete", message: `${animation.name} is generated and attached`, percent: 100, startedAt, stageLabel: "Rig pipeline 2 of 3 complete", detail: "Save the miniature to attach this motion and its procedural tabletop fallback" });
      onNotify(`${animation.name} was generated from your description and attached to ${state.name}.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Motion generation failed";
      setGenerationProgress({ status: "error", message, percent: 0, startedAt, stageLabel: "Motion generation stopped", detail: "The compiled tabletop animation remains available" });
      onNotify(message.includes("Missing") || message.includes("rejected") ? `Optional HY-Motion tools are not ready. ${message}` : message, "error");
    } finally {
      setWorking(false);
    }
  };

  const downloadRig = () => {
    const stateIndex = tokenStates.findIndex((state) => state.id === activeStateId);
    const activeRig = tokenStates[stateIndex]?.riggedModel ?? (stateIndex === 0 ? riggedModel : null);
    if (!activeRig) return;
    const url = URL.createObjectURL(activeRig);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = activeRig.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const loadSavedToken = async (asset: (typeof tokenAssets)[number]) => {
    setWorking(true);
    try {
      const states = resolveTokenStates(asset);
      const hydrated = await Promise.all(states.map(async (state, index): Promise<ForgeTokenStateDraft> => {
        const bytes = await getStoredTokenModel(state.storageKey);
        const stateModel = bytes ? new File([bytes], state.filename, { type: "model/gltf-binary" }) : null;
        const rigBytes = state.rig ? await getStoredTokenModel(state.rig.storageKey) : null;
        return {
          id: state.id,
          formId: state.formId ?? state.id,
          name: state.name,
          styleName: state.styleName ?? "Classic",
          model: index === 0 ? null : stateModel,
          modelSlot: index === 0 ? undefined : `character-state-${state.id}`,
          riggedModel: rigBytes && state.rig ? new File([rigBytes], state.rig.filename, { type: state.rig.format === "glb" ? "model/gltf-binary" : "application/octet-stream" }) : null,
          rigSlot: state.rig ? `character-rig-${state.id}` : undefined,
          rigProfile: state.rig?.profile ?? "humanoid",
          rigCreatedAt: state.rig?.createdAt,
          animations: await Promise.all(state.animations.map(async (animation) => {
            const sourceBytes = animation.sourceFile ? await getStoredTokenModel(animation.sourceFile.storageKey) : null;
            return {
              ...animation,
              draftFile: sourceBytes && animation.sourceFile ? new File([sourceBytes], animation.sourceFile.filename, { type: "application/octet-stream" }) : null,
              fileSlot: animation.sourceFile ? `character-animation-${animation.id}` : undefined,
            };
          })),
          revisions: await Promise.all((state.revisions ?? []).map(async (revision) => {
            const revisionBytes = await getStoredTokenModel(revision.storageKey);
            return {
              id: revision.id,
              model: revisionBytes ? new File([revisionBytes], revision.filename, { type: "model/gltf-binary" }) : null,
              fileSlot: `character-revision-${revision.id}` as const,
              createdAt: revision.createdAt,
              prompt: revision.prompt,
              source: revision.source,
            };
          })),
        };
      }));
      const defaultBytes = await getStoredTokenModel(asset.storageKey);
      if (!defaultBytes) throw new Error("The saved token model is unavailable on this device");
      const sourceBytes = asset.sourceImage ? await getStoredTokenModel(asset.sourceImage.storageKey) : null;
      const originalBytes = asset.originalSourceImage ? await getStoredTokenModel(asset.originalSourceImage.storageKey) : null;
      setName(asset.name); setKind(asset.kind); setModel(new File([defaultBytes], asset.filename, { type: "model/gltf-binary" }));
      setDrawing(sourceBytes && asset.sourceImage ? new File([sourceBytes], asset.sourceImage.filename, { type: asset.sourceImage.mimeType }) : null);
      setOriginalDrawing(originalBytes && asset.originalSourceImage ? new File([originalBytes], asset.originalSourceImage.filename, { type: asset.originalSourceImage.mimeType }) : sourceBytes && asset.sourceImage ? new File([sourceBytes], asset.sourceImage.filename, { type: asset.sourceImage.mimeType }) : null);
      setRiggedModel(hydrated[0]?.riggedModel ?? null);
      setRigProfile(hydrated[0]?.rigProfile ?? "humanoid");
      setBaseShape(asset.base.shape); setBaseColor(asset.base.color); setAccentColor(asset.base.accentColor); setFootprint(asset.footprint); setModelScale(asset.modelScale); setPlacementScale(asset.defaultPlacementScale);
      setCharacterId(asset.characterId ?? ""); setProvider(asset.source === "trellis2" ? "trellis2" : "pixal3d"); setTokenStates(hydrated); setActiveStateId(hydrated[0]?.id ?? ""); setSavedAssetId(asset.id); setGenerationProgress(null); setStudioMode("model");
      const formCount = new Set(hydrated.map((state) => state.formId ?? state.id)).size;
      onNotify(`${asset.name} loaded into Character Forge with ${formCount} form${formCount === 1 ? "" : "s"} and ${hydrated.length} visual style${hydrated.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "The saved miniature could not be loaded", "error");
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    if (!requestedTokenId) return;
    const asset = tokenAssets.find((entry) => entry.id === requestedTokenId);
    if (!asset) return;
    void loadSavedToken(asset).finally(() => onRequestedTokenLoaded?.());
    // Load requests are edge-triggered by the catalogue button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTokenId]);

  const assistPaint = async (source: File, request: CharacterPaintRequest, onProgress: (progress: CharacterEditProgress) => void): Promise<File> => {
    setWorking(true);
    try {
      const runtime = await ensureLocalRuntime("world", (event) => onProgress({
        message: event.message,
        percent: Math.max(2, Math.round(runtimeProgressPercent(event) * .18)),
      }));
      return await generateCharacterPaintAssist(runtime.endpoint, source, request, undefined, (event) => onProgress({
        ...event,
        percent: Math.round(18 + event.percent * .82),
      }));
    } finally {
      setWorking(false);
    }
  };

  const addToLibrary = async () => {
    if (!model) return;
    setWorking(true);
    try {
      await persistModelToLibrary(model);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Token import failed", "error");
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    if (!draftFilesReady || !model || !savedDraft?.modelName || draftRecoveryAttempted.current) return;
    draftRecoveryAttempted.current = true;
    const existing = tokenAssets.find((asset) => asset.filename === model.name && asset.name === name);
    if (existing) {
      setSavedAssetId(existing.id);
      useCampaignStore.getState().setActiveAsset(existing.id);
      return;
    }
    setWorking(true);
    void persistModelToLibrary(model, true)
      .then((asset) => onNotify(`${asset.name} was recovered from your finished Forge draft and restored to Minis.`, "success"))
      .catch((error) => onNotify(error instanceof Error ? error.message : "Finished miniature recovery failed", "error"))
      .finally(() => setWorking(false));
    // Recovery runs once for the draft that existed when this page opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftFilesReady, model, savedDraft?.modelName]);

  const activeTokenState = tokenStates.find((state) => state.id === activeStateId) ?? tokenStates[0];
  const baseToken = tokenAssets.find(token => token.id === savedAssetId);
  const assignedBaseId = baseToken ? resolveBasePlateAssetId({campaign:basePlateCampaign,scene:basePlateCampaign.scenes?.find(scene => scene.id === basePlateCampaign.activeSceneId),token:baseToken,characterId,entity:{tokenStateId:activeTokenState?.id} as import('../domain/types').MapEntity}) : undefined;
  const assignedBase = basePlateLibrary.find(base => base.id === assignedBaseId);
  const activeTokenStateIndex = tokenStates.indexOf(activeTokenState);
  const previewModel = activeTokenStateIndex === 0 ? model : activeTokenState?.model;
  const activeRig = activeTokenState?.riggedModel ?? (activeTokenStateIndex === 0 ? riggedModel : null);
  const activeRigProfile = activeTokenState?.rigProfile ?? rigProfile;

  useEffect(() => {
    setRigWorkflowStep(activeRig ? 2 : 1);
  }, [activeStateId, activeRig]);

  if (basePlateStudioOpen) return <BasePlateStudio initialBasePlate={assignedBase} model={previewModel ?? null} tokenId={savedAssetId} characterId={characterId} formId={activeTokenState?.formId ?? activeTokenState?.id} characterName={name || "Untitled miniature"} kind={kind} shape={baseShape} baseColor={baseColor} accentColor={accentColor} footprint={footprint} modelScale={modelScale} placementScale={placementScale} lighting={previewLighting} onClose={() => setBasePlateStudioOpen(false)} onNotify={onNotify} />;

  return (
          <section className="creator-workspace-page token-studio-modal" aria-label="Character Forge">
            <div className="creator-page-actions"><button onClick={onBack} disabled={working}><ArrowLeft size={15} /> Tabletop</button><small>Draft autosaved locally</small><button onClick={() => setCatalogueOpen(true)} disabled={working}><Archive size={15} /> Character catalogue</button><button onClick={() => void startNewDraft()} disabled={working}><Plus size={15} /> New character</button></div>
            <span className="eyebrow"><Box size={13} /> Local miniature pipeline</span>
            <h2>Turn a drawing into a tabletop token</h2>
            <p>Choose Pixal3D or TRELLIS.2 and DnDRom handles the private local tools automatically, or import any textured GLB. DnDRom adds a selectable board-game base and keeps the mesh authoritative.</p>

            <div className="token-studio-grid">
              <aside className="token-source-column creator-sidebar creator-sidebar-left" aria-label="Character source settings">
                <label className="field-label">Token name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
                <div className="token-role-tabs" role="group" aria-label="Token role">
                  {(["player", "enemy", "boss"] as TokenKind[]).map((entry) => <button key={entry} className={kind === entry ? "active" : ""} onClick={() => applyKind(entry)}>{entry}</button>)}
                </div>
                <details className="workspace-disclosure"><summary>Character sheet</summary>
                <div className="sheet-attachment-box"><label className="field-label">Attached character sheet<select value={characterId} onChange={(event) => { const value = event.target.value; setCharacterId(value); if (savedAssetId) linkTokenCharacter(savedAssetId, value || null); }}><option value="">No attached sheet</option>{characters.map((character) => <option value={character.id} key={character.id}>{character.name} · {character.role ?? "player"}</option>)}</select></label><div><button onClick={createAndAttachSheet}><Plus size={13} /> Create sheet</button><button onClick={() => sheetFileRef.current?.click()} disabled={importingSheet}><Upload size={13} /> {importingSheet ? "Reading…" : "Import PDF/JSON"}</button>{characterId && <button onClick={() => onOpenSheet(characterId)}>Open sheet</button>}<input ref={sheetFileRef} hidden type="file" accept="application/pdf,.pdf,.json" onChange={(event) => void importSheet(event.target.files?.[0])} /></div><small>This sheet link belongs to the current campaign, so the same miniature can use another sheet elsewhere.</small></div>
                {sheetImport && <section className="inline-sheet-review"><div><strong>Review {sheetImport.character.name}</strong><small>{sheetImport.fields.length} extracted fields · nothing is attached until accepted</small></div><div className="imported-fields">{sheetImport.fields.slice(0, 8).map((field) => <span key={field.field}><small>{field.field}</small><strong>{field.value}</strong><em>{Math.round(field.confidence * 100)}%</em></span>)}</div>{sheetImport.warnings.map((warning) => <p key={warning}>{warning}</p>)}<div><button onClick={() => setSheetImport(null)}>Cancel</button><button className="primary-button" onClick={acceptImportedSheet}>Accept & attach</button></div></section>}

                </details>
                <label className={`token-dropzone ${drawing ? "has-file" : ""}`} aria-label="Character source artwork">
                  {drawingUrl ? <img src={drawingUrl} alt="Drawing preview" /> : <ImagePlus size={28} />}
                  <span><strong>{drawing?.name ?? "Choose character drawing"}</strong><small>Clean single subject · front or 3/4 view · PNG/JPEG/WebP</small></span>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0] ?? null; setDrawing(file); setOriginalDrawing(file); }} />
                </label>
                <button className="secondary-generator-button sketch-edit-button" onClick={() => setStudioMode("paint")} disabled={!drawing || working}><Palette size={15} /> Paint & shade drawing</button>

                <div className="provider-choice">
                  <label><input type="radio" checked={provider === "pixal3d"} onChange={() => setProvider("pixal3d")} /><span><strong>Pixal3D</strong><small>Recommended for 6–8 GB VRAM</small></span></label>
                  <label><input type="radio" checked={provider === "trellis2"} onChange={() => setProvider("trellis2")} /><span><strong>TRELLIS.2</strong><small>Higher-resource quality path</small></span></label>
                </div>
                <div className={`forge-readiness ${runtimeStatus.tone}`}>
                  <span>{runtimeStatus.tone === "checking" ? <LoaderCircle className="spin" size={15} /> : runtimeStatus.tone === "ready" ? <Check size={15} /> : <Cpu size={15} />}</span>
                  <div><strong>{workflowName}</strong><small>{runtimeStatus.message}</small></div>
                </div>
                <div className="automatic-setup-note"><Download size={14} /><span><strong>No manual setup</strong><small>Generate once. DnDRom downloads, verifies, installs, and starts the private local tools, then continues automatically.</small></span></div>
                <label className="workflow-picker optional-workflow"><Upload size={15} /><span>Optional workflow override</span><small>{workflowName}</small><input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadWorkflow(file); }} /></label>
                <label className="field-label mesh-target-field"><strong>Gameplay mesh target</strong><output>{targetFaces.toLocaleString()} faces</output><small>{DEFAULT_MINIATURE_PRECLUSTER_MAX_VERTICES.toLocaleString()}-vertex detail remesh before the final reduction</small><input aria-label="Gameplay mesh target" type="range" min={MIN_MINIATURE_FACES} max={MAX_MINIATURE_FACES} step="1000" value={targetFaces} onChange={(event) => setTargetFaces(clampMiniatureFaces(Number(event.target.value)))} /></label>
                <button className="primary-button" onClick={() => void generate()} disabled={working || !drawing || !workflow}>{working ? <LoaderCircle className="spin" size={17} /> : <Box size={17} />}{working ? "Generating locally…" : savedAssetId ? "Generate as a new character" : "Generate character now"}</button>
                <div className="token-or-divider"><span>or</span></div>
                <label className="workflow-picker"><Upload size={15} /><span>{model ? model.name : "Import an existing GLB"}</span><input type="file" accept=".glb,model/gltf-binary" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (model && tokenStates[0]) replaceStateModel(tokenStates[0].id, file); else { setSavedAssetId(null); setModel(file); } event.currentTarget.value = ""; }} /></label>
              </aside>

              <main className="creator-stage token-preview-stage" aria-label="Character 3D preview">
                {studioMode === "paint" && drawing
                  ? <SketchPaintStudio source={drawing} originalSource={originalDrawing} onAiAssist={assistPaint} onCancel={() => setStudioMode("model")} onApply={(file) => { setDrawing(file); setStudioMode("model"); onNotify("Painted drawing saved as a new draft revision. Your upload remains protected.", "success"); }} />
                  : <><TokenModelPreview basePlate={assignedBase} propAssets={scenicProps} materialAssets={scenicMaterials} model={previewModel ?? null} kind={kind} shape={baseShape} baseColor={baseColor} accentColor={accentColor} footprint={footprint} modelScale={modelScale} placementScale={placementScale} lighting={previewLighting} />
                    <div className="stage-caption"><strong>{name || "Untitled miniature"} · {activeTokenState?.name ?? "Default"}</strong><span>Drag-free turntable · PBR materials · live three-point lighting</span></div>
                    {generationProgress && <GenerationProgress value={generationProgress} label="Character generation progress" onCancel={activeEditAbort.current ? () => activeEditAbort.current?.abort() : undefined} />}</>}
              </main>

              <aside className="token-base-column creator-sidebar creator-sidebar-right" aria-label="Miniature and lighting settings">
                <h3>Miniature and base</h3>
                <label className="field-label">Base shape<select value={baseShape} onChange={(event) => setBaseShape(event.target.value as TokenBaseShape)}><option value="round">Round</option><option value="square">Square</option><option value="hex">Hex</option></select></label>
                <div className="token-color-row"><label>Base<input type="color" value={baseColor} onChange={(event) => setBaseColor(event.target.value)} /></label><label>Rim<input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} /></label></div>
                <label className="field-label">Base footprint <span>{footprint.toFixed(2)} m</span><input type="range" min="0.35" max="2.5" step="0.05" value={footprint} onChange={(event) => setFootprint(Number(event.target.value))} /></label>
                <button className="scenic-base-button" onClick={() => setBasePlateStudioOpen(true)}><CircleDot size={16} /><span><strong>Scenic baseplate creator</strong><small>Terrain, shallow props, ambience, forms, and scene overrides</small></span></button>
                <label className="field-label">Model normalization <span>{modelScale.toFixed(2)}×</span><input type="range" min="0.05" max="5" step="0.05" value={modelScale} onChange={(event) => setModelScale(Number(event.target.value))} /></label>
                <label className="field-label">Default tabletop scale <span>{placementScale.toFixed(2)}×</span><input type="range" min="0.25" max="3" step="0.05" value={placementScale} onChange={(event) => setPlacementScale(Number(event.target.value))} /></label>
                <button className={`primary-button add-token-button ${savedAssetId ? "saved" : ""}`} onClick={addToLibrary} disabled={working || !model || !name.trim()}><ShieldPlus size={17} /> {savedAssetId ? "Update saved miniature" : "Add imported model to library"}</button>
                {savedAssetId && <button className="forge-place-button" onClick={onBack}><Check size={15} /> Return to Build with miniature selected</button>}
                <details className="workspace-disclosure"><summary>Restyle miniature</summary>
                <div className="sidebar-section-heading"><Sparkles size={14} /><span><strong>Prompt-edit current 3D style</strong><small>Preserves the mesh and creates a restore point</small></span></div>
                <label className="field-label">Describe the change<textarea rows={4} value={editPrompt} onChange={(event) => setEditPrompt(event.target.value)} placeholder="Add a weathered red cloak and silver shoulder armor; keep the same face and pose" /></label>
                <label className="field-label">Change strength <span>{Math.round(editStrength * 100)}%</span><input type="range" min="0.2" max="0.7" step="0.01" value={editStrength} onChange={(event) => setEditStrength(Number(event.target.value))} /></label>
                <button className="primary-button magical-button" onClick={() => void promptEditCharacter()} disabled={working || !drawing || !previewModel || !editPrompt.trim()}><Sparkles size={16} /> AI edit current 3D style</button>
                {previousRevision && <button className="secondary-generator-button restore-revision-button" onClick={restorePreviousRevision} disabled={working}><RotateCcw size={15} /> Restore previous revision</button>}
                </details>
                <details className="workspace-disclosure"><summary>Rigging, animation & presentation</summary>
                <div className="sidebar-section-heading rigging-heading"><Bone size={14} /><span><strong>Skeleton & skinning</strong><small>Local MIA / UniRig workflow</small></span></div>
                <ol className={`rig-pipeline-steps active-step-${rigWorkflowStep}`} aria-label="Character rigging pipeline">
                  {([
                    { step: 1, title: "Rig style", detail: "Skeleton and skin weights" },
                    { step: 2, title: "Author motion", detail: "Idle, attacks, and abilities" },
                    { step: 3, title: "Save states", detail: "Forms, styles, and versions" },
                  ] as const).map((entry) => <li key={entry.step} className={entry.step === rigWorkflowStep ? "active" : entry.step < rigWorkflowStep ? "complete" : "collapsed"} aria-current={entry.step === rigWorkflowStep ? "step" : undefined} title={entry.step === rigWorkflowStep ? undefined : `${entry.title}: ${entry.detail}`}><span>{entry.step < rigWorkflowStep ? <Check size={12} /> : entry.step}</span><div><strong>{entry.title}</strong>{entry.step === rigWorkflowStep && <small>{entry.detail}</small>}</div></li>)}
                </ol>
                <div className={`style-rig-status ${activeRig ? "ready" : "missing"}`}><Bone size={14} /><span><strong>{activeTokenState?.name ?? "Default"} · {activeTokenState?.styleName ?? "Classic"}</strong><small>{activeRig ? `Rig ready · ${activeRig.name}` : "This style needs a rig before AI skeletal motion"}</small></span></div>
                <label className="field-label">Rig type<select value={activeRigProfile} onChange={(event) => { const profile = event.target.value as CharacterRigProfile; setRigProfile(profile); setTokenStates((states) => states.map((state) => state.id === activeTokenState?.id ? { ...state, rigProfile: profile } : state)); }}><option value="humanoid">Humanoid · fast MIA</option><option value="creature">Creature · general UniRig</option></select></label>
                <button className="primary-button" onClick={() => void rigCharacter()} disabled={working || !previewModel}><Bone size={16} /> {activeRig ? "Rebuild this style's rig" : "Auto-rig this style"}</button>
                <label className="secondary-generator-button rig-import-button"><Upload size={15} /> Attach an existing rig<input hidden type="file" accept=".fbx,.glb,model/gltf-binary" onChange={(event) => { const file = event.target.files?.[0]; if (!file || !activeTokenState) return; setTokenStates((states) => states.map((state) => state.id === activeTokenState.id ? { ...state, riggedModel: file, rigSlot: state.rigSlot ?? `character-rig-${state.id}`, rigProfile: activeRigProfile, rigCreatedAt: new Date().toISOString() } : state)); if (activeTokenStateIndex === 0) setRiggedModel(file); event.currentTarget.value = ""; onNotify(`${activeTokenState.name} · ${activeTokenState.styleName ?? "Classic"} now uses ${file.name}.`, "success"); }} /></label>
                {activeRig && <button className="secondary-generator-button" onClick={downloadRig}><Download size={15} /> Download {activeRig.name}</button>}
                <TokenStateAnimationEditor states={tokenStates} activeStateId={activeStateId} defaultModel={model} rigReady={Boolean(activeRig)} busy={working} onActiveStateChange={setActiveStateId} onStatesChange={(states) => { setTokenStates(states); if (activeRig) setRigWorkflowStep(3); }} onModelReplace={replaceStateModel} onGenerateMotion={(stateId, animationId) => { setRigWorkflowStep(3); void generateMotion(stateId, animationId); }} onRestoreRevision={restoreTokenRevision} />
                <div className="sidebar-section-heading lighting-heading"><Lightbulb size={14} /><span><strong>Preview lighting</strong><small>Matches the tabletop PBR engine</small></span></div>
                <label className="field-label">Mood<select value={previewLighting.mood} onChange={(event) => setPreviewLighting((value) => ({ ...value, mood: event.target.value as LightingMood }))}><option value="natural">Natural</option><option value="warm">Warm tavern</option><option value="moonlight">Moonlight</option><option value="crypt">Crypt</option><option value="desert">Desert</option></select></label>
                <label className="field-label">Scene quality<select value={previewLighting.quality} onChange={(event) => setPreviewLighting((value) => ({ ...value, quality: event.target.value as LightingQuality }))}><option value="performance">Performance</option><option value="balanced">Balanced</option><option value="cinematic">Cinematic</option><option value="diorama">Diorama</option></select><small>The top-bar Display setting can override this preview.</small></label>
                <label className="field-label">IBL reflections <span>{previewLighting.iblIntensity.toFixed(2)}×</span><input type="range" min="0" max="1.5" step="0.05" value={previewLighting.iblIntensity} onChange={(event) => setPreviewLighting((value) => ({ ...value, iblIntensity: Number(event.target.value) }))} /></label>
                <label className="field-label">Key light <span>{previewLighting.keyIntensity.toFixed(2)}×</span><input type="range" min="0" max="2" step="0.05" value={previewLighting.keyIntensity} onChange={(event) => setPreviewLighting((value) => ({ ...value, keyIntensity: Number(event.target.value) }))} /></label>
                <label className="field-label">Fill light <span>{previewLighting.fillIntensity.toFixed(2)}×</span><input type="range" min="0" max="2" step="0.05" value={previewLighting.fillIntensity} onChange={(event) => setPreviewLighting((value) => ({ ...value, fillIntensity: Number(event.target.value) }))} /></label>
                <label className="field-label">Rim light <span>{previewLighting.rimIntensity.toFixed(2)}×</span><input type="range" min="0" max="2" step="0.05" value={previewLighting.rimIntensity} onChange={(event) => setPreviewLighting((value) => ({ ...value, rimIntensity: Number(event.target.value) }))} /></label>
                <div className="lighting-toggle-grid compact"><label><input type="checkbox" checked={previewLighting.ssao} onChange={(event) => setPreviewLighting((value) => ({ ...value, ssao: event.target.checked }))} /><span>SSAO<small>Contact shadows</small></span></label><label><input type="checkbox" checked={previewLighting.bloom} onChange={(event) => setPreviewLighting((value) => ({ ...value, bloom: event.target.checked }))} /><span>Bloom<small>Emissive glow</small></span></label><label><input type="checkbox" checked={previewLighting.depthOfField} onChange={(event) => setPreviewLighting((value) => ({ ...value, depthOfField: event.target.checked }))} /><span>Tilt-shift<small>Miniature focus</small></span></label></div>
                </details>
              </aside>
            </div>

            <p className="local-only-note">The complete source → cleanup → 3D mesh → remesh → UV/texture → GLB workflow is included. DnDRom runs it privately on this computer and never uploads the drawing or model.</p>
            {catalogueOpen && <AssetCatalogueDialog
              ariaLabel="Character catalogue"
              eyebrow={<><Archive size={13} /> Local character catalogue</>}
              title="Choose a saved character"
              description="Preview every saved form and style, reopen one for editing, or make it the active miniature to place in the current scene."
              searchPlaceholder="Search characters, forms, or styles"
              noResultsText="Try a different name, role, form, or style."
              onClose={() => setCatalogueOpen(false)}
              empty={<div className="miniature-library-empty"><Archive size={28} /><strong>No saved characters yet</strong><small>Finish or import a 3D miniature and save it to this catalogue.</small></div>}
              items={tokenAssets.map((asset) => {
                const states = resolveTokenStates(asset);
                const inCampaign = campaignTokenAssets.some((entry) => entry.id === asset.id);
                return {
                  id: asset.id,
                  name: asset.name,
                  searchText: `${asset.kind} ${resolveTokenForms(asset).map((form) => form.name).join(" ")} ${states.map((state) => state.styleName ?? "").join(" ")}`,
                  preview: <AssetThumbnail assetId={asset.id} token={asset} />,
                  details: <>{resolveTokenForms(asset).length} forms · {states.length} styles · {states.reduce((total, state) => total + (state.revisions?.length ?? 0), 0)} restore points</>,
                  active: savedAssetId === asset.id,
                  inCampaign,
                  actions: <><button onClick={() => { setCatalogueOpen(false); void loadSavedToken(asset); }}><Edit3 size={14} /> Open in editor</button><button className="primary-button" onClick={() => { const store = useCampaignStore.getState(); store.addTokenToCampaign(asset.id); store.setActiveAsset(asset.id); setCatalogueOpen(false); onBack(); onNotify(`${asset.name} is selected. Click the board to place it in this scene.`, "success"); }}><MapPin size={14} /> Use in current scene</button><button className="catalogue-delete-button" onClick={() => removeTokenAsset(asset.id)}><Trash2 size={14} /> Delete saved character</button></>,
                  status: inCampaign ? <span className="campaign-token-status"><Check size={12} /> In campaign</span> : undefined,
                };
              })}
            />}
          </section>
  );
}
