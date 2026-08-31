import { useMemo, useState } from "react";
import { Boxes, Globe2, MapPin, Search, Sparkles, WandSparkles, X } from "lucide-react";
import { createStoryFirstCampaign } from "../ai/campaignDirector";
import { generateAiMap } from "../ai/mapDirector";
import { ASSET_CATALOG, ASSET_CATEGORIES } from "../domain/assets";
import { generateLocationMap } from "../domain/mapGenerator";
import { useCampaignStore } from "../state/campaignStore";
import { WorldSplatPanel } from "./WorldSplatPanel";

interface AssetPaletteProps {
  onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
}

export function AssetPalette({ onNotify }: AssetPaletteProps) {
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [mapPrompt, setMapPrompt] = useState("A frontier realm where roads and entire towns are being erased from memory, with mystery, political choices, wilderness travel, and a climactic observatory");
  const [generating, setGenerating] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const activeAssetId = useCampaignStore((state) => state.activeAssetId);
  const setActiveAsset = useCampaignStore((state) => state.setActiveAsset);
  const settings = useCampaignStore((state) => state.campaign.settings);
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

      <button className="generate-map-button" onClick={() => setShowGenerator(true)}>
        <WandSparkles size={17} />
        <span><strong>Generate campaign</strong><small>Story first, then world and maps</small></span>
        <Sparkles size={14} />
      </button>
      <WorldSplatPanel onNotify={onNotify} />

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
          <span className="asset-icon">↖</span>
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
            <span className="asset-icon">{asset.icon}</span>
            <span>{asset.name}</span>
            <small>{asset.license === "CC0" ? "CC0" : asset.category}</small>
          </button>
        ))}
      </div>

      <div className="palette-footer">
        <span>{ASSET_CATALOG.length} starter assets</span>
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
    </aside>
  );
}
