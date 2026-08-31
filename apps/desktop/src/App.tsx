import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Box,
  Check,
  ChevronDown,
  CircleUserRound,
  CloudOff,
  Grid3X3,
  Hammer,
  Heart,
  Menu,
  MapPin,
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
import type { MapEntity, PanelTab, Vec3 } from "./domain/types";
import { useCampaignStore } from "./state/campaignStore";
import { AssetPalette } from "./components/AssetPalette";
import { SceneViewport } from "./components/SceneViewport";
import { EntityInspector } from "./components/EntityInspector";
import { CharacterPanel } from "./components/CharacterPanel";
import { DungeonMasterPanel } from "./components/DungeonMasterPanel";
import { SessionPanel } from "./components/SessionPanel";
import { saveCampaignNative } from "./persistence/campaignFiles";
import { generateLocationMap } from "./domain/mapGenerator";

interface Toast {
  id: string;
  message: string;
  tone: "info" | "success" | "warning" | "error";
}

const tabs: { id: PanelTab; label: string; icon: typeof Bot }[] = [
  { id: "dm", label: "DM", icon: Bot },
  { id: "inspect", label: "Object", icon: Box },
  { id: "characters", label: "Party", icon: Users },
  { id: "session", label: "Session", icon: Settings },
];

function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  return <div className="toast-stack">{toasts.map((toast) => <div className={`toast ${toast.tone}`} key={toast.id}>{toast.tone === "success" ? <Check size={16} /> : toast.tone === "warning" ? <Sparkles size={16} /> : <span className="toast-dot" />}<p>{toast.message}</p><button onClick={() => dismiss(toast.id)}><X size={14} /></button></div>)}</div>;
}

export function App() {
  const campaign = useCampaignStore((state) => state.campaign);
  const mode = useCampaignStore((state) => state.mode);
  const panelTab = useCampaignStore((state) => state.panelTab);
  const selectedEntityId = useCampaignStore((state) => state.selectedEntityId);
  const activeAssetId = useCampaignStore((state) => state.activeAssetId);
  const setMode = useCampaignStore((state) => state.setMode);
  const setPanelTab = useCampaignStore((state) => state.setPanelTab);
  const selectEntity = useCampaignStore((state) => state.selectEntity);
  const setActiveAsset = useCampaignStore((state) => state.setActiveAsset);
  const addEntity = useCampaignStore((state) => state.addEntity);
  const updateEntity = useCampaignStore((state) => state.updateEntity);
  const renameCampaign = useCampaignStore((state) => state.renameCampaign);
  const markSaved = useCampaignStore((state) => state.markSaved);
  const travelToLocation = useCampaignStore((state) => state.travelToLocation);
  const [showGrid, setShowGrid] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "local">("local");

  const selectedEntity = useMemo(() => campaign.map.entities.find((entity) => entity.id === selectedEntityId) ?? null, [campaign.map.entities, selectedEntityId]);
  const activeCharacter = campaign.characters.find((character) => character.id === campaign.activeCharacterId) ?? campaign.characters[0];

  const notify = (message: string, tone: Toast["tone"] = "info") => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, tone }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6500);
  };

  const place = (position: Vec3) => {
    if (!activeAssetId) return;
    const asset = ASSET_BY_ID.get(activeAssetId);
    if (!asset) return;
    const mapEntity: MapEntity = {
      id: crypto.randomUUID(),
      assetId: asset.id,
      name: asset.name,
      position,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    addEntity(mapEntity);
  };

  const rotateSelected = () => {
    if (selectedEntity) updateEntity(selectedEntity.id, { rotation: { ...selectedEntity.rotation, y: (selectedEntity.rotation.y + 90) % 360 } });
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

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if (event.key.toLowerCase() === "r") rotateSelected();
      if ((event.key === "Delete" || event.key === "Backspace") && selectedEntityId) useCampaignStore.getState().removeEntity(selectedEntityId);
      if (event.key === "Escape") { setActiveAsset(null); selectEntity(null); }
      if (event.key.toLowerCase() === "g") setShowGrid((value) => !value);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [selectedEntityId, selectedEntity]);

  return (
    <div className={`app-shell mode-${mode} ${leftOpen ? "left-open" : "left-closed"} ${rightOpen ? "right-open" : "right-closed"}`}>
      <header className="app-header">
        <div className="brand-lockup"><div className="brand-mark"><span>D</span><i /></div><div><strong>DnDRom</strong><small>AI tabletop</small></div></div>
        <span className="header-divider" />
        <button className="panel-toggle" onClick={() => setLeftOpen((value) => !value)} title="Toggle asset library"><Menu size={18} /></button>
        <div className="campaign-title-wrap">
          <span className="eyebrow">Campaign</span>
          <div><input value={campaign.name} onChange={(event) => renameCampaign(event.target.value)} /><ChevronDown size={14} /></div>
        </div>
        <div className="header-center">
          <div className="mode-switcher">
            <button className={mode === "build" ? "active" : ""} onClick={() => setMode("build")}><Hammer size={15} />Build</button>
            <button className={mode === "play" ? "active" : ""} onClick={() => setMode("play")}><Play size={15} />Play</button>
          </div>
        </div>
        <div className="header-actions">
          <div className="local-status"><CloudOff size={14} /><span>Local-first</span></div>
          <button className="save-button" onClick={save}><Save size={15} /><span>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save"}</span></button>
          <button className="panel-toggle" onClick={() => setRightOpen((value) => !value)} title="Toggle side panel"><PanelRight size={18} /></button>
          <div className="avatar-mini">{activeCharacter?.portrait ? <img src={activeCharacter.portrait} alt="" /> : <CircleUserRound size={21} />}</div>
        </div>
      </header>

      <main className="workspace">
        {leftOpen && mode === "build" && <AssetPalette onNotify={notify} />}
        {leftOpen && mode === "play" && (
          <aside className="play-party panel-surface">
            <div className="panel-title-row"><div><span className="eyebrow">At the table</span><h2>Party</h2></div><Users size={18} /></div>
            {campaign.characters.map((character) => <button key={character.id} className={character.id === campaign.activeCharacterId ? "active" : ""} onClick={() => useCampaignStore.getState().setActiveCharacter(character.id)}><span className="party-avatar">{character.portrait ? <img src={character.portrait} alt="" /> : character.name[0]}</span><span><strong>{character.name}</strong><small>{character.className} · level {character.level}</small><i><b style={{ width: `${Math.round(character.hitPoints.current / character.hitPoints.maximum * 100)}%` }} /></i></span><em>{character.hitPoints.current}/{character.hitPoints.maximum}</em></button>)}
            <div className="story-ledger">
              <span className="eyebrow">Campaign progress</span>
              {campaign.storyThreads.filter((thread) => thread.status === "open").map((thread) => <div key={thread.id}><strong>{thread.title}</strong><span>{Array.from({ length: thread.clockMax }, (_, index) => <i className={index < thread.clock ? "filled" : ""} key={index} />)}</span></div>)}
              {campaign.campaignPlan?.beats.filter((beat) => ["available", "active"].includes(beat.status)).slice(0, 3).map((beat) => <button className="story-beat-card" key={beat.id} onClick={() => { const location = campaign.world?.locations.find((entry) => entry.id === beat.locationId); if (location) travelToLocation(location.id, generateLocationMap(location, beat.summary)); }}><MapPin size={11} /><span><strong>{beat.title}</strong><small>{campaign.world?.locations.find((entry) => entry.id === beat.locationId)?.name ?? beat.encounterType}</small></span></button>)}
            </div>
          </aside>
        )}

        <section className="tabletop-area">
          <div className="map-toolbar panel-surface">
            <div className="map-name"><span className="map-theme-dot" /><div><strong>{campaign.map.name}</strong><small>{campaign.map.width} × {campaign.map.depth} m · {campaign.map.theme}</small></div></div>
            {campaign.world && <label className="location-switcher"><MapPin size={13} /><select value={campaign.activeLocationId ?? ""} onChange={(event) => { const location = campaign.world?.locations.find((entry) => entry.id === event.target.value); if (location) travelToLocation(location.id, generateLocationMap(location)); }}>{campaign.world.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
            <span className="toolbar-divider" />
            <button className={showGrid ? "active" : ""} onClick={() => setShowGrid((value) => !value)}><Grid3X3 size={15} /> Grid <kbd>G</kbd></button>
            <button disabled={!selectedEntity} onClick={rotateSelected}><RotateCw size={15} /> Rotate <kbd>R</kbd></button>
            {activeAssetId && <div className="placing-pill"><span>{ASSET_BY_ID.get(activeAssetId)?.icon}</span>Placing {ASSET_BY_ID.get(activeAssetId)?.name}<button onClick={() => setActiveAsset(null)}><X size={13} /></button></div>}
          </div>
          <SceneViewport map={campaign.map} selectedEntityId={selectedEntityId} activeAssetId={mode === "build" ? activeAssetId : null} showGrid={showGrid} onPlace={place} onSelect={(id) => { selectEntity(id); if (id && mode === "build") setPanelTab("inspect"); }} />
          {mode === "play" && activeCharacter && (
            <div className="play-hud panel-surface">
              <div className="hud-character"><span>{activeCharacter.portrait ? <img src={activeCharacter.portrait} alt="" /> : activeCharacter.name[0]}</span><div><strong>{activeCharacter.name}</strong><small>{activeCharacter.ancestry} {activeCharacter.className}</small></div></div>
              <div className="hud-stat hp"><Heart size={16} /><span><small>HP</small><strong>{activeCharacter.hitPoints.current}/{activeCharacter.hitPoints.maximum}</strong></span></div>
              <div className="hud-stat"><Shield size={16} /><span><small>AC</small><strong>{activeCharacter.armorClass}</strong></span></div>
              <div className="hud-actions">{activeCharacter.actions.slice(0, 3).map((action) => <button key={action.id} onClick={() => { setPanelTab("dm"); setRightOpen(true); notify(`Describe how ${activeCharacter.name} uses ${action.name}; the DM will resolve intent and rules.`, "info"); }}><strong>{action.name}</strong><small>{action.damage || action.range || "action"}</small></button>)}</div>
            </div>
          )}
        </section>

        {rightOpen && (
          <aside className="right-panel panel-surface">
            <nav className="panel-tabs">
              {tabs.map((tab) => { const Icon = tab.icon; return <button key={tab.id} className={panelTab === tab.id ? "active" : ""} onClick={() => setPanelTab(tab.id)}><Icon size={15} /><span>{tab.label}</span></button>; })}
            </nav>
            <div className="right-panel-content">
              {panelTab === "dm" && <DungeonMasterPanel onNotify={notify} />}
              {panelTab === "inspect" && <EntityInspector entity={selectedEntity} />}
              {panelTab === "characters" && <CharacterPanel onNotify={notify} />}
              {panelTab === "session" && <SessionPanel onNotify={notify} />}
            </div>
          </aside>
        )}
      </main>
      <Toasts toasts={toasts} dismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
