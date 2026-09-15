import { prepareWorldSiteAsync } from "../domain/worldSiteClient";
import { useEffect, useRef, useState } from "react";
import { useCampaignStore } from "../state/campaignStore";
import { beginGenerationJob, updateGenerationJob, waitForGenerationJobTurn } from "../state/generationJobs";
import { compileWorldBlueprintAsync } from "../domain/worldForgeWorkerClient";
import { finalizeSettlementMap, finalizeTravelMap, settlementBlueprint, travelBlueprint } from "../domain/travelWorld";
import { directSceneComposition } from "../ai/sceneDirector";
import {enterWorldLocation} from '../state/worldGeneration';

export function WorldJourneyPanel({ onNotify }: { onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void }) {
  const campaign = useCampaignStore(state => state.campaign), selectedId = useCampaignStore(state => state.selectedEntityId);
  const [busy, setBusy] = useState(false), abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const world = campaign.world;
  if (!world) return null;
  const open = async (locationId?: string) => {
    if(world.manifest){if(busy)return;const controller=new AbortController();abort.current=controller;setBusy(true);try{await enterWorldLocation(locationId,controller.signal);}catch(e){if(!controller.signal.aborted)onNotify(String(e),'error');}finally{setBusy(false);abort.current=null;}return;}
    if (busy) return;
    const state = useCampaignStore.getState(), start = state.campaign;
    const existing = start.scenes?.find(scene => locationId ? scene.map.locationId === locationId && scene.map.journey?.level === "settlement" : scene.map.journey?.worldId === world.id && scene.map.journey.level === "travel");
    if (existing) { state.switchScene(existing.id); return; }
    const controller = new AbortController(); abort.current = controller; setBusy(true);
    const jobId = beginGenerationJob({ kind: "scene", label: locationId ? "Entering location" : "Travel world", message: "Preparing persistent geography", stageLabel: "World", onCancel: () => controller.abort() });
    try {
      if (!await waitForGenerationJobTurn(jobId)) return;
      let map;
      if (locationId) {
        const location = world.locations.find(location => location.id === locationId);
        if (!location) throw new Error("This location is no longer in the campaign");
        updateGenerationJob(jobId, { message: `Designing ${location.name}`, percent: 10 });
        const directed = await directSceneComposition(await prepareWorldSiteAsync(settlementBlueprint(location, start.campaignPlan), controller.signal), start.settings, controller.signal);
        if (directed.warning) onNotify(directed.warning, "warning");
        map = finalizeSettlementMap((await compileWorldBlueprintAsync(directed.blueprint, controller.signal)).map, location, world, start.campaignPlan);
      } else map = finalizeTravelMap((await compileWorldBlueprintAsync(travelBlueprint(world), controller.signal)).map, world);
      controller.signal.throwIfAborted();
      if (useCampaignStore.getState().campaign.id !== start.id) throw new Error("Campaign changed while the location was being built");
      useCampaignStore.getState().addScene(map.name, map, start.characters.map(character => character.id), locationId ? "Persistent detailed location" : "Regional travel map");
      updateGenerationJob(jobId, { status: "complete", percent: 100, message: `${map.name} is ready` });
    } catch (error) {
      updateGenerationJob(jobId, { status: "error", message: error instanceof Error ? error.message : String(error) });
      if (!controller.signal.aborted) onNotify(error instanceof Error ? error.message : String(error), "error");
    } finally { setBusy(false); abort.current = null; }
  };
  const selectedSite = campaign.map.entities.find(entity => entity.id === selectedId)?.tags?.find(tag => tag.startsWith("location:"))?.slice(9) ?? world.manifest?.locations.find(l=>l.settlement.buildings.some(b=>b.id===selectedId))?.id;
  const interior = campaign.map.journey?.interiors?.find(interior => interior.entityId === (campaign.map.journey?.activeBuildingId ?? selectedId));
  const enter = (entityId?: string) => {
    const state = useCampaignStore.getState(), map = state.campaign.map;
    if (!map.journey) return;
    state.replaceMap({ ...map, journey: { ...map.journey, activeBuildingId: entityId } }, entityId ? `Entered ${interior?.name ?? "building"}` : "Returned to the street");
    if (entityId) window.dispatchEvent(new CustomEvent("dndrom:focus-building", { detail: { entityId } }));
  };
  return <section className="world-locations" aria-label="World travel">
    <strong>{world.name}</strong><small>{campaign.map.journey?.level === "travel" ? "Regional travel" : "Detailed location"}</small>
    <button disabled={busy || campaign.map.journey?.level === "travel"} onClick={() => void open()}>Return to travel map</button>
    <label>Enter location<select value="" disabled={busy} onChange={event => void open(event.target.value)}><option value="">Choose a settlement or story location</option>{world.locations.map(location => <option key={location.id} value={location.id}>{location.name} · {location.kind}</option>)}</select></label>
    {selectedSite && <button disabled={busy} onClick={() => void open(selectedSite)}>Enter selected location</button>}
    {busy && <button onClick={() => abort.current?.abort()}>Cancel generation</button>}
    {interior && <button onClick={() => enter(campaign.map.journey?.activeBuildingId ? undefined : interior.entityId)}>{campaign.map.journey?.activeBuildingId ? "Leave building" : `Enter ${interior.name}`}</button>}
    {campaign.map.journey?.activeBuildingId && (campaign.map.pointsOfInterest ?? []).filter(point => point.discovered && (!interior || interior.pointOfInterestIds.includes(point.id))).map(point => <button key={point.id} onClick={() => window.dispatchEvent(new CustomEvent("dndrom:dm-action", { detail: { action: `In ${interior?.name ?? campaign.map.name}, I investigate ${point.name}.` } }))}>{point.name}</button>)}
  </section>;
}
