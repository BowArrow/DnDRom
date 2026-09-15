import { WorldWeatherPanel } from "./WorldWeatherPanel";
import { WorldJourneyPanel } from "./WorldJourneyPanel";
import { SharedWorldPanel } from './SharedWorldPanel';
import {generateWorld,enterWorldLocation} from '../state/worldGeneration';
import { compileWorldBlueprintAsync } from "../domain/worldForgeWorkerClient";
import { travelBlueprint, finalizeTravelMap } from "../domain/travelWorld";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
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
  const [section, setSection] = useState<"assets" | "world" | "environment">("assets");
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(()=>{if(!createOpen)return;const previous=document.activeElement as HTMLElement|null;
    const handle=(e:KeyboardEvent)=>{if(e.key==='Escape'){setCreateOpen(false);return;}if(e.key!=='Tab')return;
      const items=Array.from(document.querySelectorAll<HTMLButtonElement>('.palette-create-dialog button:not(:disabled)'));const first=items[0],last=items.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};
    document.addEventListener('keydown',handle);return()=>{document.removeEventListener('keydown',handle);previous?.focus();};
  },[createOpen]);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [mapPrompt, setMapPrompt] = useState("A frontier realm where roads and entire towns are being erased from memory, with mystery, political choices, wilderness travel, and a climactic observatory");
  const [generating, setGenerating] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [catalogueTab, setCatalogueTab] = useState(() => { const saved = localStorage.getItem("dndrom.catalogueTab.v1"); return saved && ["starter", "props", "characters", "materials"].includes(saved) ? saved : "props"; });
  const chooseCatalogue = (id: string) => { setCatalogueTab(id); localStorage.setItem("dndrom.catalogueTab.v1", id); };
  const catalogueNavigation = { tabs: [{ id: "starter", label: "Starter assets" }, { id: "props", label: "Props" }, { id: "characters", label: "Characters" }, { id: "materials", label: "Materials" }], activeTab: catalogueTab, onTabChange: chooseCatalogue };
  const showTokenLibrary = catalogueOpen && catalogueTab === "characters", showPropLibrary = catalogueOpen && catalogueTab === "props", showMaterialLibrary = catalogueOpen && catalogueTab === "materials";
  const setShowTokenLibrary = setCatalogueOpen, setShowPropLibrary = setCatalogueOpen, setShowMaterialLibrary = setCatalogueOpen;
  const [cardSize, setCardSize] = useState(() => Math.max(76, Math.min(140, Number(localStorage.getItem("dndrom.assetCardSize.v1")) || 98)));
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
      await generateWorld(result.world,result.plan);
      setShowGenerator(false);
      onNotify(result.warning ?? `${result.plan.title} is ready: ${result.plan.acts.length} acts, ${result.plan.beats.length} story beats, and ${result.world.locations.length} generated locations.`, result.warning ? "warning" : "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Campaign generation failed", "error");
    } finally {
      setGenerating(false);
    }
  };

  const travel = (locationId: string) => {
    if(world?.manifest){void enterWorldLocation(locationId).catch(e=>onNotify(String(e),'error'));return;}
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

      <div className="palette-actions">
        <button className="catalogue-launch-button" onClick={() => setCatalogueOpen(true)}><Archive size={17} /> Catalogue</button>
        <button className="palette-create-button" onClick={() => setCreateOpen(true)}><Sparkles size={15} /> Create</button>
      </div>
      <div className="workspace-section-tabs" role="tablist" aria-label="Build workspace">
        {([['assets','Assets'],['world','World'],['environment','Environment']] as const).map(([id,label]) => <button key={id} role="tab" id={`build-tab-${id}`} aria-controls={`build-panel-${id}`} aria-selected={section===id} tabIndex={section===id?0:-1} onKeyDown={e=>{const tabs=['assets','world','environment'] as const;const n=tabs.indexOf(id);const next=e.key==='ArrowRight'?tabs[(n+1)%3]:e.key==='ArrowLeft'?tabs[(n+2)%3]:e.key==='Home'?tabs[0]:e.key==='End'?tabs[2]:undefined;if(next){e.preventDefault();setSection(next);document.getElementById(`build-tab-${next}`)?.focus();}}} onClick={()=>setSection(id)}>{label}</button>)}
      </div>
      {section==='world' && <div className="palette-section-scroll" role="tabpanel" id="build-panel-world" aria-labelledby="build-tab-world"><SharedWorldPanel /><WorldJourneyPanel onNotify={onNotify} /></div>}
      {section==='environment' && <div className="palette-section-scroll" role="tabpanel" id="build-panel-environment" aria-labelledby="build-tab-environment"><h3>Scene environment</h3><WorldWeatherPanel /></div>}
      <div className="palette-assets-section" role="tabpanel" id="build-panel-assets" aria-labelledby="build-tab-assets" hidden={section!=='assets'}>
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

      <label className="asset-size-control">Preview size<input aria-label="Asset preview size" type="range" min="76" max="140" step="4" value={cardSize} onChange={event => { const value = Number(event.target.value); setCardSize(value); localStorage.setItem("dndrom.assetCardSize.v1", String(value)); }} /></label>
      <div className="asset-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))`, gridAutoRows: `${cardSize + 18}px` }}>
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

      </div>
      {createOpen && createPortal(<div className="modal-backdrop palette-create-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCreateOpen(false);}} onKeyDown={e=>{if(e.key==='Escape')setCreateOpen(false);}}>
        <section className="palette-create-dialog panel-surface" role="dialog" aria-modal="true" aria-label="Create something new">
          <div className="panel-title-row"><h2>Create something new</h2><button autoFocus aria-label="Close create menu" onClick={()=>setCreateOpen(false)}><X size={18}/></button></div>
          <div onClick={()=>setCreateOpen(false)}>
            <button onClick={()=>setShowGenerator(true)}><Globe2/><span><strong>Campaign</strong><small>Plan a connected world and its adventures</small></span></button>
            <button onClick={onOpenSceneForge}><Sparkles/><span><strong>Scene</strong><small>Create a location or change its surroundings</small></span></button>
            <button onClick={()=>onOpenPropForge()}><PackageOpen/><span><strong>Prop or material</strong><small>Make an object or surface for your library</small></span></button>
            <button onClick={()=>onOpenCharacterForge()}><UserRound/><span><strong>Character</strong><small>Create a miniature, baseplate, and character sheet</small></span></button>
          </div>
        </section>
      </div>,document.body)}
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
      {catalogueOpen && catalogueTab === "starter" && <AssetCatalogueDialog {...catalogueNavigation} ariaLabel="Asset catalogue" eyebrow={<><Archive size={13} /> Catalogue</>} title="Starter assets" description="Choose an asset, then click the scene to place it. Saved props, characters and materials are in the neighbouring tabs." searchPlaceholder="Search starter assets" onClose={() => setCatalogueOpen(false)} empty={<p>No starter assets.</p>} items={ASSET_CATALOG.map(asset => ({ id: asset.id, name: asset.name, searchText: `${asset.category} ${asset.description}`, preview: <AssetThumbnail assetId={asset.id} />, details: asset.description, active: activeAssetId === asset.id, actions: <button className="primary-button" onClick={() => { setActiveAsset(asset.id); setCatalogueOpen(false); }}><Check size={14} /> Place in scene</button> }))} />}
      {showTokenLibrary && <AssetCatalogueDialog {...catalogueNavigation} ariaLabel="Character catalogue" eyebrow={<><Archive size={13} /> Local character catalogue</>} title="Choose this campaign's character miniatures" description="Search reusable characters, preview their current model and base, reopen one in Character Forge, or control campaign membership." searchPlaceholder="Search characters, forms, or styles" onClose={() => setShowTokenLibrary(false)} empty={<div className="miniature-library-empty"><UserRound size={28} /><strong>No saved miniatures yet</strong><small>Create or import one in Character Forge and it will appear here automatically.</small><button className="primary-button" onClick={() => { setShowTokenLibrary(false); onOpenCharacterForge(); }}><ShieldPlus size={15} /> Open Character Forge</button></div>} items={miniatureLibrary.map((token) => { const inCampaign = tokenAssets.some((entry) => entry.id === token.id); const placed = useCampaignStore.getState().campaign.map.entities.filter((entry) => entry.assetId === token.id).length; return { id: token.id, name: token.name, searchText: `${token.kind} ${resolveTokenForms(token).map((form) => form.name).join(" ")} ${resolveTokenStates(token).map((state) => state.styleName ?? "").join(" ")}`, preview: <AssetThumbnail assetId={token.id} token={token} />, details: <>{token.kind} · {resolveTokenForms(token).length} forms · {resolveTokenStates(token).length} styles · {placed} placed</>, inCampaign, actions: <><button onClick={() => { setShowTokenLibrary(false); onOpenCharacterForge(token.id); }}><Edit3 size={14} /> Open in Forge</button>{inCampaign ? <button className="remove-campaign-token" onClick={() => { removeTokenFromCampaign(token.id); onNotify(`${token.name} was removed from this campaign${placed ? ` with ${placed} placed ${placed === 1 ? "copy" : "copies"}` : ""}. The library model is still saved.`, "success"); }}><MinusCircle size={14} /> Remove from campaign</button> : <button className="primary-button" onClick={() => { addTokenToCampaign(token.id); onNotify(`${token.name} is now available in this campaign's Minis.`, "success"); }}><ShieldPlus size={14} /> Add to campaign</button>}</>, status: inCampaign ? <span className="campaign-token-status"><Check size={12} /> Available in Minis</span> : undefined }; })} />}
      {showPropLibrary && <AssetCatalogueDialog {...catalogueNavigation} ariaLabel="Prop catalogue" eyebrow={<><Archive size={13} /> Local prop catalogue</>} title="Choose this campaign's props" description="Search the reusable device catalogue, inspect each approved reference, and control campaign membership without deleting the saved model." searchPlaceholder="Search props, placement types, or descriptions" onClose={() => setShowPropLibrary(false)} empty={<div className="miniature-library-empty"><PackageOpen size={28} /><strong>No saved props yet</strong><small>Create or import one in Prop Forge.</small><button className="primary-button" onClick={() => { setShowPropLibrary(false); onOpenPropForge(); }}><WandSparkles size={15} /> Open Prop Forge</button></div>} items={propLibrary.map((prop) => { const inCampaign = propAssets.some((entry) => entry.id === prop.id); const placed = useCampaignStore.getState().campaign.map.entities.filter((entry) => entry.assetId === prop.id).length; return { id: prop.id, name: prop.name, searchText: `${prop.description} ${prop.profile} ${prop.source}`, preview: <PropAssetPreview asset={prop} />, details: <>{prop.profile} · {prop.triangleCount.toLocaleString()} triangles · {placed} placed</>, inCampaign, actions: <><button onClick={() => { setShowPropLibrary(false); onOpenPropForge(prop.id); }}><Edit3 size={14} /> Open in Forge</button>{inCampaign ? <button className="remove-campaign-token" onClick={() => { removePropFromCampaign(prop.id); onNotify(`${prop.name} was removed from this campaign. The catalogue copy remains saved.`, "success"); }}><MinusCircle size={14} /> Remove from campaign</button> : <button className="primary-button" onClick={() => { addPropToCampaign(prop.id); onNotify(`${prop.name} is ready in this campaign's Props.`, "success"); }}><Check size={14} /> Add to campaign</button>}</>, status: inCampaign ? <span className="campaign-token-status"><Check size={12} /> In campaign</span> : undefined }; })} />}
      {showMaterialLibrary && <AssetCatalogueDialog {...catalogueNavigation} ariaLabel="Material catalogue" eyebrow={<><Layers3 size={13} /> Local material catalogue</>} title="Choose reusable PBR materials" description="Search material themes, preview their albedo, and add them to the current campaign for floors, walls, pillars, or props." searchPlaceholder="Search materials, surfaces, or mapping modes" onClose={() => setShowMaterialLibrary(false)} empty={<div className="miniature-library-empty"><Layers3 size={28} /><strong>No saved materials yet</strong><small>Create one in the Material mode of Prop Forge.</small><button className="primary-button" onClick={() => { setShowMaterialLibrary(false); onOpenPropForge(); }}><WandSparkles size={15} /> Open Prop Forge</button></div>} items={materialLibrary.map((material) => { const inCampaign = materialAssets.some((entry) => entry.id === material.id); return { id: material.id, name: material.name, searchText: `${material.description} ${material.target} ${material.materialClass} ${material.projection}`, preview: <MaterialAssetPreview asset={material} />, details: <>{material.target} · {material.projection} · seam {Math.round((material.seamScore ?? 0) * 100)}%</>, inCampaign, actions: inCampaign ? <button className="remove-campaign-token" onClick={() => removeMaterialFromCampaign(material.id)}><MinusCircle size={14} /> Remove from campaign</button> : <button className="primary-button" onClick={() => addMaterialToCampaign(material.id)}><Check size={14} /> Add to campaign</button>, status: inCampaign ? <span className="campaign-token-status"><Check size={12} /> In campaign</span> : undefined }; })} />}
    </aside>
  );
}
