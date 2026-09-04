import { useMemo, useState } from "react";
import { Archive, Boxes, Check, Edit3, Globe2, Layers3, MapPin, MinusCircle, PackageOpen, Search, ShieldPlus, Sparkles, UserRound, WandSparkles, X } from "lucide-react";
import { createStoryFirstCampaign } from "../ai/campaignDirector";
import { generateAiMap } from "../ai/mapDirector";
import { ASSET_CATALOG, ASSET_CATEGORIES } from "../domain/assets";
import { generateLocationMap } from "../domain/mapGenerator";
import { resolveTokenForms, resolveTokenStates } from "../domain/tokenAnimation";
import { useCampaignStore } from "../state/campaignStore";
import { selectMaterialAssets, selectMaterialLibrary, selectMiniatureLibrary, selectPropAssets, selectPropLibrary, selectTokenAssets } from "../state/selectors";
import { AssetThumbnail } from "./AssetThumbnail";
import { AssetCatalogueDialog } from "./AssetCatalogueDialog";
import { MaterialAssetPreview, PropAssetPreview } from "./StoredAssetPreview";

interface AssetPaletteProps {
  onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
  onOpenSceneForge: () => void;
  onOpenCharacterForge: (tokenId?: string) => void;
  onOpenPropForge: (propId?: string) => void;
}

export function AssetPalette({ onNotify, onOpenSceneForge, onOpenCharacterForge, onOpenPropForge }: AssetPaletteProps) {
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [mapPrompt, setMapPrompt] = useState("A frontier realm where roads and entire towns are being erased from memory, with mystery, political choices, wilderness travel, and a climactic observatory");
  const [generating, setGenerating] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [showTokenLibrary, setShowTokenLibrary] = useState(false);
  const [showPropLibrary, setShowPropLibrary] = useState(false);
  const [showMaterialLibrary, setShowMaterialLibrary] = useState(false);
  const activeAssetId = useCampaignStore((state) => state.activeAssetId);
  const setActiveAsset = useCampaignStore((state) => state.setActiveAsset);
  const settings = useCampaignStore((state) => state.campaign.settings);
  const tokenAssets = useCampaignStore(selectTokenAssets);
  const miniatureLibrary = useCampaignStore(selectMiniatureLibrary);
  const propAssets = useCampaignStore(selectPropAssets);
  const propLibrary = useCampaignStore(selectPropLibrary);
  const materialAssets = useCampaignStore(selectMaterialAssets);
  const materialLibrary = useCampaignStore(selectMaterialLibrary);
  const addPropToCampaign = useCampaignStore((state) => state.addPropToCampaign);
  const removePropFromCampaign = useCampaignStore((state) => state.removePropFromCampaign);
  const addMaterialToCampaign = useCampaignStore((state) => state.addMaterialToCampaign);
  const removeMaterialFromCampaign = useCampaignStore((state) => state.removeMaterialFromCampaign);
  const addTokenToCampaign = useCampaignStore((state) => state.addTokenToCampaign);
  const removeTokenFromCampaign = useCampaignStore((state) => state.removeTokenFromCampaign);
  const world = useCampaignStore((state) => state.campaign.world);
  const activeLocationId = useCampaignStore((state) => state.campaign.activeLocationId);
  const replaceMap = useCampaignStore((state) => state.replaceMap);
  const installGeneratedCampaign = useCampaignStore((state) => state.installGeneratedCampaign);
  const travelToLocation = useCampaignStore((state) => state.travelToLocation);

  const assets = useMemo(() => ASSET_CATALOG.filter((asset) => {
    const inCategory = category === "all" || asset.category === category;
    const query = search.trim().toLowerCase();
    return inCategory && (!query || `${asset.name} ${asset.description}`.toLowerCase().includes(query));
  }), [category, search]);
  const customTokens = useMemo(() => tokenAssets.filter((asset) => {
    const query = search.trim().toLowerCase();
    return (category === "all" || category === "tokens") && (!query || `${asset.name} ${asset.kind} custom miniature`.toLowerCase().includes(query));
  }), [category, search, tokenAssets]);
  const customProps = useMemo(() => propAssets.filter((asset) => { const query = search.trim().toLowerCase(); return (category === "all" || category === "furniture" || category === "effects") && (!query || `${asset.name} ${asset.description} ${asset.profile}`.toLowerCase().includes(query)); }), [category, propAssets, search]);

  const generateScene = async () => {
    if (!mapPrompt.trim()) return;
    setGenerating(true);
    try {
      const result = await generateAiMap(mapPrompt, settings);
      replaceMap(result.map, `${result.provider === "local-ai" ? "AI" : "Local generator"} created ${result.map.name}`);
      setShowGenerator(false);
      onNotify(result.warning ?? `${result.map.name} is ready with ${result.map.entities.length} placed objects.`, result.warning ? "warning" : "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Map generation failed", "error");
    } finally {
      setGenerating(false);
    }
  };

  const generateCampaign = async () => {
    if (!mapPrompt.trim()) return;
    setGenerating(true);
    try {
      const result = await createStoryFirstCampaign(mapPrompt, settings);
      const firstLocation = result.world.locations.find((location) => location.storyBeatIds.some((beatId) => result.plan.beats.find((beat) => beat.id === beatId)?.status === "available")) ?? result.world.locations[0];
      if (!firstLocation) throw new Error("Campaign generation did not create a starting location");
      installGeneratedCampaign(result.plan, result.world, generateLocationMap(firstLocation, result.plan.incitingIncident));
      setShowGenerator(false);
      onNotify(result.warning ?? `${result.plan.title} is ready: ${result.plan.acts.length} acts, ${result.plan.beats.length} story beats, and ${result.world.locations.length} generated locations.`, result.warning ? "warning" : "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Campaign generation failed", "error");
    } finally {
      setGenerating(false);
    }
  };

  const travel = (locationId: string) => {
    const location = world?.locations.find((entry) => entry.id === locationId);
    if (!location) return;
    travelToLocation(location.id, generateLocationMap(location));
    onNotify(`${location.name} generated from its world seed with ${location.pointOfInterests.length} points of interest.`, "success");
  };

  return (
    <aside className="asset-palette panel-surface">
      <div className="panel-title-row">
        <div>
          <span className="eyebrow">Creator</span>
          <h2>Asset library</h2>
        </div>
        <Boxes size={18} />
      </div>

      <button className="creator-launch-button generate-map-button" onClick={() => setShowGenerator(true)}>
        <WandSparkles size={17} />
        <span><strong>Generate campaign</strong><small>Story first, then world and maps</small></span>
        <Sparkles size={14} />
      </button>
      <button className="creator-launch-button splat-studio-button arcane-action" onClick={onOpenSceneForge}><Sparkles size={17} /><span><strong>AI scenery studio</strong><small>Open persistent scene workspace</small></span><WandSparkles size={14} /></button>
      <button className="creator-launch-button token-studio-button" onClick={() => onOpenCharacterForge()}><UserRound size={17} /><span><strong>Character Forge</strong><small>Open persistent miniature workspace</small></span><ShieldPlus size={14} /></button>
      <button className="creator-launch-button miniature-library-button" onClick={() => setShowTokenLibrary(true)}><Archive size={17} /><span><strong>Character catalogue</strong><small>Load saved tokens into this campaign or reopen them in Forge</small></span><span className="library-count">{tokenAssets.length}/{miniatureLibrary.length}</span></button>
      <button className="creator-launch-button prop-studio-button" onClick={() => onOpenPropForge()}><PackageOpen size={17} /><span><strong>Prop Forge</strong><small>Create reviewed props and seamless PBR materials</small></span><WandSparkles size={14} /></button>
      <button className="creator-launch-button prop-library-button" onClick={() => setShowPropLibrary(true)}><Archive size={17} /><span><strong>Prop catalogue</strong><small>Choose reusable props for this campaign</small></span><span className="library-count">{propAssets.length}/{propLibrary.length}</span></button>
      <button className="creator-launch-button material-library-button" onClick={() => setShowMaterialLibrary(true)}><Layers3 size={17} /><span><strong>Material catalogue</strong><small>Reusable floor, wall, pillar, and general PBR themes</small></span><span className="library-count">{materialAssets.length}/{materialLibrary.length}</span></button>

      {world && (
        <section className="world-locations">
          <div><Globe2 size={13} /><strong>{world.name}</strong><small>{world.locations.length} locations</small></div>
          <select value={activeLocationId ?? ""} onChange={(event) => travel(event.target.value)} aria-label="Travel to generated location">
            {world.locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.kind}</option>)}
          </select>
        </section>
      )}

      <label className="search-box">
        <Search size={15} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets" />
        {search && <button aria-label="Clear search" onClick={() => setSearch("")}><X size={13} /></button>}
      </label>

      <div className="category-tabs" role="tablist" aria-label="Asset categories">
        {ASSET_CATEGORIES.map((entry) => (
          <button key={entry.id} className={category === entry.id ? "active" : ""} onClick={() => setCategory(entry.id)}>{entry.label}</button>
        ))}
      </div>

      <div className="asset-grid">
        <button className={`asset-card select-tool ${activeAssetId === null ? "active" : ""}`} onClick={() => setActiveAsset(null)} title="Select and inspect objects">
          <AssetThumbnail assetId={null} />
          <span>Select</span>
          <small>Inspect</small>
        </button>
        {assets.map((asset) => (
          <button
            key={asset.id}
            className={`asset-card ${activeAssetId === asset.id ? "active" : ""}`}
            onClick={() => setActiveAsset(activeAssetId === asset.id ? null : asset.id)}
            title={asset.description}
          >
            <AssetThumbnail assetId={asset.id} />
            <span>{asset.name}</span>
            <small>{asset.license === "CC0" ? "CC0" : asset.category}</small>
          </button>
        ))}
        {customTokens.map((asset) => (
          <button
            key={asset.id}
            className={`asset-card custom-token-card ${activeAssetId === asset.id ? "active" : ""}`}
            onClick={() => setActiveAsset(activeAssetId === asset.id ? null : asset.id)}
            title={`${asset.name} · ${asset.kind} · local GLB`}
          >
            <AssetThumbnail assetId={asset.id} token={asset} />
            <span>{asset.name}</span>
            <small>{asset.kind} · local</small>
          </button>
        ))}
        {customProps.map((asset) => <button key={asset.id} className={`asset-card custom-prop-card ${activeAssetId === asset.id ? "active" : ""}`} onClick={() => setActiveAsset(activeAssetId === asset.id ? null : asset.id)} title={`${asset.name} · ${asset.profile} · ${asset.triangleCount.toLocaleString()} triangles`}><span className="asset-prop-glyph"><PackageOpen size={28} /></span><span>{asset.name}</span><small>{asset.profile}</small></button>)}
      </div>

      <div className="palette-footer">
        <span>{ASSET_CATALOG.length} starter + {tokenAssets.length + propAssets.length} custom</span>
        <span>Procedural + CC0</span>
      </div>

      {showGenerator && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowGenerator(false)}>
          <section className="map-generator-modal" role="dialog" aria-modal="true" aria-label="AI map generator">
            <button className="modal-close" onClick={() => setShowGenerator(false)} aria-label="Close"><X size={18} /></button>
            <span className="eyebrow"><Sparkles size={13} /> Campaign and world director</span>
            <h2>What campaign should the DM run?</h2>
            <p>The DM creates a complete, choice-aware campaign scaffold first. DnDRom then derives regions, cities, towns, wilderness, roads, story points of interest, and a playable starting map from it.</p>
            <textarea value={mapPrompt} onChange={(event) => setMapPrompt(event.target.value)} rows={5} autoFocus />
            <div className="prompt-chips">
              {[
                "A fallen sky-city whose pieces are awakening across a coastal kingdom",
                "A frontier war where both rulers are being manipulated by an ancient oracle",
                "A mystery campaign about towns disappearing from maps and memory",
                "A heroic expedition through mountain settlements to seal a storm titan's prison",
              ].map((prompt) => <button key={prompt} onClick={() => setMapPrompt(prompt)}>{prompt}</button>)}
            </div>
            <div className="generator-options">
              <span className={`provider-dot ${settings.useLocalAiForMaps ? "online" : ""}`} />
              {settings.localAiEndpoint ? "Local AI story planning available" : "Complete offline story and world generator"}
            </div>
            <button className="primary-button" onClick={generateCampaign} disabled={generating || !mapPrompt.trim()}>
              <Globe2 size={17} /> {generating ? "Writing story, world, and locations…" : "Create campaign and world"}
            </button>
            <button className="secondary-generator-button" onClick={generateScene} disabled={generating || !mapPrompt.trim()}><MapPin size={15} /> Generate only the current scene</button>
          </section>
        </div>
      )}
      {showTokenLibrary && <AssetCatalogueDialog ariaLabel="Character catalogue" eyebrow={<><Archive size={13} /> Local character catalogue</>} title="Choose this campaign's character miniatures" description="Search reusable characters, preview their current model and base, reopen one in Character Forge, or control campaign membership." searchPlaceholder="Search characters, forms, or styles" onClose={() => setShowTokenLibrary(false)} empty={<div className="miniature-library-empty"><UserRound size={28} /><strong>No saved miniatures yet</strong><small>Create or import one in Character Forge and it will appear here automatically.</small><button className="primary-button" onClick={() => { setShowTokenLibrary(false); onOpenCharacterForge(); }}><ShieldPlus size={15} /> Open Character Forge</button></div>} items={miniatureLibrary.map((token) => { const inCampaign = tokenAssets.some((entry) => entry.id === token.id); const placed = useCampaignStore.getState().campaign.map.entities.filter((entry) => entry.assetId === token.id).length; return { id: token.id, name: token.name, searchText: `${token.kind} ${resolveTokenForms(token).map((form) => form.name).join(" ")} ${resolveTokenStates(token).map((state) => state.styleName ?? "").join(" ")}`, preview: <AssetThumbnail assetId={token.id} token={token} />, details: <>{token.kind} · {resolveTokenForms(token).length} forms · {resolveTokenStates(token).length} styles · {placed} placed</>, inCampaign, actions: <><button onClick={() => { setShowTokenLibrary(false); onOpenCharacterForge(token.id); }}><Edit3 size={14} /> Open in Forge</button>{inCampaign ? <button className="remove-campaign-token" onClick={() => { removeTokenFromCampaign(token.id); onNotify(`${token.name} was removed from this campaign${placed ? ` with ${placed} placed ${placed === 1 ? "copy" : "copies"}` : ""}. The library model is still saved.`, "success"); }}><MinusCircle size={14} /> Remove from campaign</button> : <button className="primary-button" onClick={() => { addTokenToCampaign(token.id); onNotify(`${token.name} is now available in this campaign's Minis.`, "success"); }}><ShieldPlus size={14} /> Add to campaign</button>}</>, status: inCampaign ? <span className="campaign-token-status"><Check size={12} /> Available in Minis</span> : undefined }; })} />}
      {showPropLibrary && <AssetCatalogueDialog ariaLabel="Prop catalogue" eyebrow={<><Archive size={13} /> Local prop catalogue</>} title="Choose this campaign's props" description="Search the reusable device catalogue, inspect each approved reference, and control campaign membership without deleting the saved model." searchPlaceholder="Search props, placement types, or descriptions" onClose={() => setShowPropLibrary(false)} empty={<div className="miniature-library-empty"><PackageOpen size={28} /><strong>No saved props yet</strong><small>Create or import one in Prop Forge.</small><button className="primary-button" onClick={() => { setShowPropLibrary(false); onOpenPropForge(); }}><WandSparkles size={15} /> Open Prop Forge</button></div>} items={propLibrary.map((prop) => { const inCampaign = propAssets.some((entry) => entry.id === prop.id); const placed = useCampaignStore.getState().campaign.map.entities.filter((entry) => entry.assetId === prop.id).length; return { id: prop.id, name: prop.name, searchText: `${prop.description} ${prop.profile} ${prop.source}`, preview: <PropAssetPreview asset={prop} />, details: <>{prop.profile} · {prop.triangleCount.toLocaleString()} triangles · {placed} placed</>, inCampaign, actions: <><button onClick={() => { setShowPropLibrary(false); onOpenPropForge(prop.id); }}><Edit3 size={14} /> Open in Forge</button>{inCampaign ? <button className="remove-campaign-token" onClick={() => { removePropFromCampaign(prop.id); onNotify(`${prop.name} was removed from this campaign. The catalogue copy remains saved.`, "success"); }}><MinusCircle size={14} /> Remove from campaign</button> : <button className="primary-button" onClick={() => { addPropToCampaign(prop.id); onNotify(`${prop.name} is ready in this campaign's Props.`, "success"); }}><Check size={14} /> Add to campaign</button>}</>, status: inCampaign ? <span className="campaign-token-status"><Check size={12} /> In campaign</span> : undefined }; })} />}
      {showMaterialLibrary && <AssetCatalogueDialog ariaLabel="Material catalogue" eyebrow={<><Layers3 size={13} /> Local material catalogue</>} title="Choose reusable PBR materials" description="Search material themes, preview their albedo, and add them to the current campaign for floors, walls, pillars, or props." searchPlaceholder="Search materials, surfaces, or mapping modes" onClose={() => setShowMaterialLibrary(false)} empty={<div className="miniature-library-empty"><Layers3 size={28} /><strong>No saved materials yet</strong><small>Create one in the Material mode of Prop Forge.</small><button className="primary-button" onClick={() => { setShowMaterialLibrary(false); onOpenPropForge(); }}><WandSparkles size={15} /> Open Prop Forge</button></div>} items={materialLibrary.map((material) => { const inCampaign = materialAssets.some((entry) => entry.id === material.id); return { id: material.id, name: material.name, searchText: `${material.description} ${material.target} ${material.materialClass} ${material.projection}`, preview: <MaterialAssetPreview asset={material} />, details: <>{material.target} · {material.projection} · seam {Math.round((material.seamScore ?? 0) * 100)}%</>, inCampaign, actions: inCampaign ? <button className="remove-campaign-token" onClick={() => removeMaterialFromCampaign(material.id)}><MinusCircle size={14} /> Remove from campaign</button> : <button className="primary-button" onClick={() => addMaterialToCampaign(material.id)}><Check size={14} /> Add to campaign</button>, status: inCampaign ? <span className="campaign-token-status"><Check size={12} /> In campaign</span> : undefined }; })} />}
    </aside>
  );
}
