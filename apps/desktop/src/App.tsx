import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Box,
  Check,
  CircleUserRound,
  CloudOff,
  Dices,
  Grid3X3,
  Hammer,
  Heart,
  Hexagon,
  Menu,
  MapPin,
  PackageOpen,
  PanelRight,
  Play,
  RotateCw,
  Save,
  Settings,
  Shield,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { ASSET_BY_ID } from "./domain/assets";
import type { PlacementResolution } from "./domain/buildPlacement";
import type { MapEntity, PanelTab } from "./domain/types";
import { useCampaignStore } from "./state/campaignStore";
import { EMPTY_MATERIAL_ASSETS, EMPTY_PROP_ASSETS, EMPTY_TOKEN_ASSETS, selectMaterialAssets, selectPropAssets } from "./state/selectors";
import { AssetPalette } from "./components/AssetPalette";
import { AssetThumbnail } from "./components/AssetThumbnail";
import { SceneViewport } from "./components/SceneViewport";
import { EntityInspector } from "./components/EntityInspector";
import { CharacterPanel } from "./components/CharacterPanel";
import { DungeonMasterPanel } from "./components/DungeonMasterPanel";
import { SessionPanel } from "./components/SessionPanel";
import { LocalSetupBanner } from "./components/LocalSetupBanner";
import { CharacterTokenStudio } from "./components/CharacterTokenStudio";
import { WorldSplatPanel } from "./components/WorldSplatPanel";
import { DiceFace } from "./components/DiceFace";
import { DiceForge } from "./components/DiceForge";
import { DisplaySettingsDialog } from "./components/DisplaySettingsDialog";
import { GenerationActivityCenter } from "./components/GenerationActivityCenter";
import { PropForge } from "./components/PropForge";
import { saveCampaignNative } from "./persistence/campaignFiles";
import { generateLocationMap } from "./domain/mapGenerator";
import { canViewCharacterSheet, visibleCharacterSheets } from "./domain/characterVisibility";
import { CampaignNavigator, SceneNavigator } from "./components/CampaignNavigator";
import { selectTokenAssets } from "./state/selectors";
import { useDisplaySettings } from "./state/useDisplaySettings";
import { resolvedMotionReduction } from "./domain/displaySettings";

interface Toast {
  id: string;
  message: string;
  title?: string;
  tone: "info" | "success" | "warning" | "error" | "roll";
  dice?: { sides: number; value: number };
}

const tabs: { id: PanelTab; label: string; icon: typeof Bot }[] = [
  { id: "dm", label: "DM", icon: Bot },
  { id: "inspect", label: "Object", icon: Box },
  { id: "characters", label: "Party", icon: Users },
  { id: "session", label: "Session", icon: Settings },
];

function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  const renderToast = (toast: Toast) => <div className={`toast ${toast.tone}`} key={toast.id}>{toast.dice ? <DiceFace sides={toast.dice.sides} value={toast.dice.value} compact /> : toast.tone === "success" ? <Check size={16} /> : toast.tone === "warning" ? <Sparkles size={16} /> : toast.tone === "roll" ? <Dices size={16} /> : <span className="toast-dot" />}<div className="toast-copy">{toast.title && <b>{toast.title}</b>}<p>{toast.message}</p></div><button onClick={() => dismiss(toast.id)} aria-label="Dismiss notification"><X size={14} /></button></div>;
  const diceToasts = toasts.filter((toast) => toast.tone === "roll");
  const standardToasts = toasts.filter((toast) => toast.tone !== "roll");
  return <><div className="toast-stack toast-stack-dice">{diceToasts.map(renderToast)}</div><div className="toast-stack">{standardToasts.map(renderToast)}</div></>;
}

export function App() {
  const campaign = useCampaignStore((state) => state.campaign);
  const mode = useCampaignStore((state) => state.mode);
  const panelTab = useCampaignStore((state) => state.panelTab);
  const selectedEntityId = useCampaignStore((state) => state.selectedEntityId);
  const activeAssetId = useCampaignStore((state) => state.activeAssetId);
  const tokenAssets = useCampaignStore(selectTokenAssets);
  const propAssets = useCampaignStore(selectPropAssets);
  const materialAssets = useCampaignStore(selectMaterialAssets);
  const setMode = useCampaignStore((state) => state.setMode);
  const setPanelTab = useCampaignStore((state) => state.setPanelTab);
  const selectEntity = useCampaignStore((state) => state.selectEntity);
  const setActiveAsset = useCampaignStore((state) => state.setActiveAsset);
  const addEntity = useCampaignStore((state) => state.addEntity);
  const addTokenAsset = useCampaignStore((state) => state.addTokenAsset);
  const updateEntity = useCampaignStore((state) => state.updateEntity);
  const markSaved = useCampaignStore((state) => state.markSaved);
  const travelToLocation = useCampaignStore((state) => state.travelToLocation);
  const updateMapGridShape = useCampaignStore((state) => state.updateMapGridShape);
  const [showGrid, setShowGrid] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "local">("local");
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false);
  const [playHudCharacterId, setPlayHudCharacterId] = useState<string | null>(null);
  const displaySettings = useDisplaySettings();
  const [creatorPage, setCreatorPage] = useState<"table" | "scene" | "character" | "dice" | "prop">(() => {
    const saved = window.localStorage.getItem("dndrom.creatorPage.v1");
    return saved === "scene" || saved === "character" || saved === "dice" || saved === "prop" ? saved : "table";
  });
  const [requestedForgeTokenId, setRequestedForgeTokenId] = useState<string | null>(null);
  const [requestedForgePropId, setRequestedForgePropId] = useState<string | null>(null);
  const [requestedWorldAsset, setRequestedWorldAsset] = useState<{ name: string; description: string; kind: "object" | "material" } | null>(null);
  const [propForgeReturnPage, setPropForgeReturnPage] = useState<"table" | "scene">("table");
  const [characterDraftSession, setCharacterDraftSession] = useState(0);

  const selectedEntity = useMemo(() => campaign.map.entities.find((entity) => entity.id === selectedEntityId) ?? null, [campaign.map.entities, selectedEntityId]);
  const activeCustomToken = tokenAssets.find((asset) => asset.id === activeAssetId);
  const canViewPrivateSheets = mode === "build" || campaign.settings.dungeonMasterMode === "player";
  const activeScene = campaign.scenes?.find((scene) => scene.id === campaign.activeSceneId);
  const sceneParty = new Set(activeScene?.partyCharacterIds ?? campaign.characters.map((character) => character.id));
  const visiblePlayCharacters = visibleCharacterSheets(campaign.characters, mode, campaign.settings.dungeonMasterMode).filter((character) => sceneParty.has(character.id));
  const activeCharacter = visiblePlayCharacters.find((character) => character.id === campaign.activeCharacterId) ?? visiblePlayCharacters[0];
  const playHudCharacter = visiblePlayCharacters.find((character) => character.id === playHudCharacterId) ?? null;

  const openSheet = (characterId: string) => {
    useCampaignStore.getState().setActiveCharacter(characterId);
    if (mode === "play") setPlayHudCharacterId(characterId);
    setCreatorPage("table");
    setPanelTab("characters");
    setRightOpen(true);
  };

  const notify = (message: string, tone: Toast["tone"] = "info", title?: string, dice?: Toast["dice"]) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, tone, title, dice }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6500);
  };

  const place = (placement: PlacementResolution) => {
    if (!activeAssetId) return;
    const asset = ASSET_BY_ID.get(activeAssetId);
    const customToken = tokenAssets.find((entry) => entry.id === activeAssetId);
    const customProp = propAssets.find((entry) => entry.id === activeAssetId);
    if (!asset && !customToken && !customProp) return;
    const defaultBehavior = asset?.defaultBehavior ?? customProp?.defaultBehavior;
    const initialScale = customToken?.defaultPlacementScale ?? customProp?.defaultPlacementScale ?? 1;
    if (customToken && !campaign.tokenAssets?.some((entry) => entry.id === customToken.id)) addTokenAsset(customToken);
    const placedAt = new Date();
    const mapEntity: MapEntity = {
      id: crypto.randomUUID(),
      assetId: asset?.id ?? customToken?.id ?? customProp!.id,
      name: asset?.name ?? customToken?.name ?? customProp!.name,
      position: placement.position,
      rotation: placement.rotation ?? { x: 0, y: placement.rotationY, z: 0 },
      scale: { x: initialScale, y: initialScale, z: initialScale },
      tags: customToken ? ["token", customToken.kind] : customProp ? ["prop", customProp.profile] : undefined,
      light: defaultBehavior?.kind === "practical-light" ? { ...defaultBehavior, anchor: { ...defaultBehavior.anchor }, direction: { ...defaultBehavior.direction }, flicker: defaultBehavior.flicker ? { ...defaultBehavior.flicker } : undefined } : undefined,
      build: {
        placedAt: placedAt.toISOString(),
        refundableUntil: new Date(placedAt.getTime() + 60_000).toISOString(),
        parentId: placement.parentId,
        surfaceId: placement.surfaceId ?? placement.socketId,
        localPosition: placement.localPosition ?? placement.position,
        localRotation: placement.localRotation ?? { x: 0, y: placement.rotationY, z: 0 },
        surfaceNormal: placement.surfaceNormal ?? { x: 0, y: 1, z: 0 },
        clearanceOffset: placement.clearanceOffset ?? 0,
        placementVersion: 2,
      },
    };
    addEntity(mapEntity);
  };

  const rotateSelected = () => {
    if (activeAssetId) window.dispatchEvent(new Event("dndrom:rotate-ghost"));
    else if (selectedEntity) updateEntity(selectedEntity.id, { rotation: { ...selectedEntity.rotation, y: (selectedEntity.rotation.y + 90) % 360 } });
  };

  const save = async () => {
    setSaveState("saving");
    try {
      const path = await saveCampaignNative(campaign);
      markSaved();
      setSaveState("saved");
      notify(path ? "Campaign saved to the desktop campaign folder." : "Campaign is autosaved in this browser. Use Session → Export for a portable file.", "success");
    } catch (error) {
      setSaveState("local");
      notify(error instanceof Error ? error.message : "Save failed", "error");
    }
  };

  useEffect(() => {
    setSaveState("local");
    const timer = window.setTimeout(async () => {
      try {
        if ("__TAURI_INTERNALS__" in window) await saveCampaignNative(useCampaignStore.getState().campaign);
        markSaved();
        setSaveState("saved");
      } catch {
        setSaveState("local");
      }
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [campaign.updatedAt]);

  useEffect(() => window.localStorage.setItem("dndrom.creatorPage.v1", creatorPage), [creatorPage]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if (event.key.toLowerCase() === "r") rotateSelected();
      if ((event.key === "Delete" || event.key === "Backspace") && selectedEntityId) useCampaignStore.getState().removeEntity(selectedEntityId);
      if (event.key === "Escape") { setActiveAsset(null); selectEntity(null); }
      if (event.key.toLowerCase() === "g" && mode === "build") setShowGrid((value) => !value);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [selectedEntityId, selectedEntity, mode]);

  return (
    <div className={`app-shell app-grain mode-${mode} ${leftOpen ? "left-open" : "left-closed"} ${rightOpen ? "right-open" : "right-closed"} ${resolvedMotionReduction(displaySettings) ? "motion-reduced" : "motion-full"}`}>
      <header className="app-header">
        <div className="brand-lockup"><div className="brand-mark"><span>D</span><i /></div><div><strong>DnDRom</strong><small>AI tabletop</small></div></div>
        <span className="header-divider" />
        <button className="panel-toggle" onClick={() => setLeftOpen((value) => !value)} title="Toggle asset library"><Menu size={18} /></button>
        <CampaignNavigator onNotify={notify} />
        <div className="header-center">
          <div className="mode-switcher">
            <button className={creatorPage === "table" && mode === "build" ? "active" : ""} onClick={() => { setCreatorPage("table"); setMode("build"); setPlayHudCharacterId(null); }}><Hammer size={15} /><span>Build</span></button>
            <button className={creatorPage === "table" && mode === "play" ? "active" : ""} onClick={() => { setCreatorPage("table"); setMode("play"); setActiveAsset(null); selectEntity(null); setPlayHudCharacterId(null); }}><Play size={15} /><span>Play</span></button>
            <button className={creatorPage === "scene" ? "active" : ""} onClick={() => setCreatorPage("scene")}><Sparkles size={15} /><span>Scene</span></button>
            <button className={creatorPage === "prop" ? "active" : ""} onClick={() => setCreatorPage("prop")}><PackageOpen size={15} /><span>Prop</span></button>
            <button className={creatorPage === "character" ? "active" : ""} onClick={() => setCreatorPage("character")}><CircleUserRound size={15} /><span>Character</span></button>
            <button className={creatorPage === "dice" ? "active" : ""} onClick={() => setCreatorPage("dice")}><Dices size={15} /><span>Dice</span></button>
          </div>
        </div>
        <div className="header-actions">
          <div className="local-status"><CloudOff size={14} /><span>Local-first</span></div>
          <button className="save-button" onClick={save}><Save size={15} /><span>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save"}</span></button>
          <button className="panel-toggle" onClick={() => setRightOpen((value) => !value)} title="Toggle side panel"><PanelRight size={18} /></button>
          <div className="avatar-mini">{activeCharacter?.portrait ? <img src={activeCharacter.portrait} alt="" /> : <CircleUserRound size={21} />}</div>
          <button className="panel-toggle display-settings-trigger" onClick={() => setDisplaySettingsOpen(true)} title={`Display settings · ${displaySettings.quality}`} aria-label="Open display settings"><Settings size={18} /></button>
        </div>
      </header>

      <main className={`workspace ${creatorPage !== "table" ? "creator-page-active" : ""}`}>
        {creatorPage === "scene" && <div className="creator-page-host"><WorldSplatPanel onNotify={notify} onBack={() => setCreatorPage("table")} onOpenPropForge={(request) => { setRequestedForgePropId(null); setRequestedWorldAsset(request); setPropForgeReturnPage("scene"); setCreatorPage("prop"); }} /></div>}
        {creatorPage === "character" && <div className="creator-page-host"><CharacterTokenStudio key={`character-forge-${campaign.id}-${characterDraftSession}`} onNotify={notify} onBack={() => setCreatorPage("table")} onOpenSheet={openSheet} requestedTokenId={requestedForgeTokenId} onRequestedTokenLoaded={() => setRequestedForgeTokenId(null)} onNewDraftReady={() => { setRequestedForgeTokenId(null); setCharacterDraftSession((value) => value + 1); }} /></div>}
        {creatorPage === "dice" && <div className="creator-page-host"><DiceForge onNotify={notify} onBack={() => setCreatorPage("table")} /></div>}
        {creatorPage === "prop" && <div className="creator-page-host"><PropForge onNotify={notify} onBack={() => { setRequestedWorldAsset(null); setCreatorPage(propForgeReturnPage); }} requestedAssetId={requestedForgePropId} initialRequest={requestedWorldAsset} /></div>}
        {creatorPage === "table" && leftOpen && mode === "build" && <AssetPalette onNotify={notify} onOpenSceneForge={() => setCreatorPage("scene")} onOpenPropForge={(propId) => { setRequestedForgePropId(propId ?? null); setRequestedWorldAsset(null); setPropForgeReturnPage("table"); setCreatorPage("prop"); }} onOpenCharacterForge={(tokenId) => { setRequestedForgeTokenId(tokenId ?? null); setCreatorPage("character"); }} />}
        {creatorPage === "table" && leftOpen && mode === "play" && (
          <aside className="play-party panel-surface">
            <div className="panel-title-row"><div><span className="eyebrow">At the table</span><h2>Party</h2></div><Users size={18} /></div>
            {visiblePlayCharacters.map((character) => <button key={character.id} className={character.id === campaign.activeCharacterId ? "active" : ""} onClick={() => openSheet(character.id)}><span className="party-avatar">{character.portrait ? <img src={character.portrait} alt="" /> : character.name[0]}</span><span><strong>{character.name}</strong><small>{character.role ?? "player"} · {character.className} · level {character.level}</small><i><b style={{ width: `${Math.round(character.hitPoints.current / character.hitPoints.maximum * 100)}%` }} /></i></span><em>{character.hitPoints.current}/{character.hitPoints.maximum}</em></button>)}
            <div className="story-ledger">
              <span className="eyebrow">Campaign progress</span>
              {campaign.storyThreads.filter((thread) => thread.status === "open").map((thread) => <div key={thread.id}><strong>{thread.title}</strong><span>{Array.from({ length: thread.clockMax }, (_, index) => <i className={index < thread.clock ? "filled" : ""} key={index} />)}</span></div>)}
              {campaign.campaignPlan?.beats.filter((beat) => ["available", "active"].includes(beat.status)).slice(0, 3).map((beat) => <button className="story-beat-card" key={beat.id} onClick={() => { const location = campaign.world?.locations.find((entry) => entry.id === beat.locationId); if (location) travelToLocation(location.id, generateLocationMap(location, beat.summary)); }}><MapPin size={11} /><span><strong>{beat.title}</strong><small>{campaign.world?.locations.find((entry) => entry.id === beat.locationId)?.name ?? beat.encounterType}</small></span></button>)}
            </div>
          </aside>
        )}

        {creatorPage === "table" && <section className="tabletop-area">
          <div className="map-toolbar panel-surface">
            <SceneNavigator onNotify={notify} />
            <div className="map-name"><span className="map-theme-dot" /><div><strong>{campaign.map.name}</strong><small>{campaign.map.width} × {campaign.map.depth} m · {campaign.map.theme}</small></div></div>
            {campaign.world && <label className="location-switcher"><MapPin size={13} /><select value={campaign.activeLocationId ?? ""} onChange={(event) => { const location = campaign.world?.locations.find((entry) => entry.id === event.target.value); if (location) travelToLocation(location.id, generateLocationMap(location)); }}>{campaign.world.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
            {mode === "build" && <><span className="toolbar-divider" />
              <button className={showGrid ? "active" : ""} onClick={() => setShowGrid((value) => !value)}><Grid3X3 size={15} /> Grid <kbd>G</kbd></button>
              <button className={campaign.map.gridShape === "hex" ? "active" : ""} onClick={() => updateMapGridShape(campaign.map.gridShape === "hex" ? "square" : "hex")} title="Switch between square and hexagonal world-space grids"><Hexagon size={15} /> {campaign.map.gridShape === "hex" ? "Hex" : "Square"}</button>
              <button disabled={!selectedEntity && !activeAssetId} onClick={rotateSelected}><RotateCw size={15} /> Rotate <kbd>R</kbd></button>
              {activeAssetId && <div className="placing-pill"><AssetThumbnail assetId={activeAssetId} token={activeCustomToken} />Placing {ASSET_BY_ID.get(activeAssetId)?.name ?? activeCustomToken?.name}<button onClick={() => setActiveAsset(null)}><X size={13} /></button></div>}
            </>}
          </div>
          <SceneViewport map={campaign.map} tokenAssets={tokenAssets.length ? tokenAssets : EMPTY_TOKEN_ASSETS} propAssets={propAssets.length ? propAssets : EMPTY_PROP_ASSETS} materialAssets={materialAssets.length ? materialAssets : EMPTY_MATERIAL_ASSETS} basePlateAssets={campaign.basePlateAssets} campaignBasePlateAssignments={campaign.basePlateAssignments} sceneBasePlateAssignments={activeScene?.basePlateAssignments} tokenCharacterLinks={campaign.tokenCharacterLinks} diceThemes={campaign.diceThemes} diceThemeAssignments={campaign.diceThemeAssignments} selectedEntityId={selectedEntityId} activeAssetId={mode === "build" ? activeAssetId : null} focusAssetId={mode === "play" ? activeCharacter?.tokenAssetId ?? null : null} showGrid={mode === "build" && showGrid} mode={mode} onPlace={place} onSelect={(id) => { selectEntity(id); if (!id) { if (mode === "play") setPlayHudCharacterId(null); return; } if (mode === "build") setPanelTab("inspect"); else { const entity = campaign.map.entities.find((entry) => entry.id === id); const token = tokenAssets.find((entry) => entry.id === entity?.assetId); const characterId = token ? campaign.tokenCharacterLinks?.[token.id] ?? token.characterId : undefined; const sheet = campaign.characters.find((entry) => entry.id === characterId); if (sheet && canViewCharacterSheet(sheet, mode, campaign.settings.dungeonMasterMode)) openSheet(sheet.id); else setPlayHudCharacterId(null); } }} onPipette={(assetId) => { setActiveAsset(assetId); notify(`Pipette selected ${ASSET_BY_ID.get(assetId)?.name ?? tokenAssets.find((entry) => entry.id === assetId)?.name ?? propAssets.find((entry) => entry.id === assetId)?.name ?? "asset"}.`, "success"); }} />
          {mode === "play" && playHudCharacter && (
            <div className="play-hud panel-surface">
              <div className="hud-character"><span>{playHudCharacter.portrait ? <img src={playHudCharacter.portrait} alt="" /> : playHudCharacter.name[0]}</span><div><strong>{playHudCharacter.name}</strong><small>{playHudCharacter.ancestry} {playHudCharacter.className}</small></div></div>
              <div className="hud-stat hp"><Heart size={16} /><span><small>HP</small><strong>{playHudCharacter.hitPoints.current}/{playHudCharacter.hitPoints.maximum}</strong></span></div>
              <div className="hud-stat"><Shield size={16} /><span><small>AC</small><strong>{playHudCharacter.armorClass}</strong></span></div>
              <div className="hud-actions">{playHudCharacter.actions.slice(0, 3).map((action) => <button key={action.id} onClick={() => { setPanelTab("dm"); setRightOpen(true); notify(`Describe how ${playHudCharacter.name} uses ${action.name}; the DM will resolve intent and rules.`, "info"); }}><strong>{action.name}</strong><small>{action.damage || action.range || "action"}</small></button>)}</div>
              <button className="hud-close" onClick={() => setPlayHudCharacterId(null)} aria-label="Close selected character bar"><X size={15} /></button>
            </div>
          )}
        </section>}

        {creatorPage === "table" && rightOpen && (
          <aside className="right-panel panel-surface">
            <nav className="panel-tabs">
              {tabs.map((tab) => { const Icon = tab.icon; return <button key={tab.id} className={panelTab === tab.id ? "active" : ""} onClick={() => setPanelTab(tab.id)}><Icon size={15} /><span>{tab.label}</span></button>; })}
            </nav>
            <div className="right-panel-content">
              {panelTab === "dm" && <DungeonMasterPanel onNotify={notify} onOpenDiceForge={() => setCreatorPage("dice")} />}
              {panelTab === "inspect" && <EntityInspector entity={selectedEntity} tokenAsset={tokenAssets.find((asset) => asset.id === selectedEntity?.assetId)} />}
              {panelTab === "characters" && <CharacterPanel onNotify={notify} showPrivate={canViewPrivateSheets} />}
              {panelTab === "session" && <SessionPanel onNotify={notify} />}
            </div>
          </aside>
        )}
      </main>
      <Toasts toasts={toasts} dismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
      <GenerationActivityCenter />
      <LocalSetupBanner onNotify={notify} />
      <DisplaySettingsDialog open={displaySettingsOpen} onClose={() => setDisplaySettingsOpen(false)} />
    </div>
  );
}
