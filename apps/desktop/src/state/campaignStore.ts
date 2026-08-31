import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyDamage, applyHealing } from "../domain/rules";
import { longRest, resolveTypedDamage, shortRest } from "../domain/srdRules";
import { createDefaultCharacter, createStarterCampaign } from "../domain/seed";
import type {
  AppMode,
  Campaign,
  CampaignEvent,
  CampaignPlan,
  Character,
  DmMessage,
  GameMap,
  MapEntity,
  SplatScenery,
  MultiplayerStatus,
  PanelTab,
  WorldPlan,
  DamageType,
} from "../domain/types";

interface CampaignStore {
  campaign: Campaign;
  mode: AppMode;
  panelTab: PanelTab;
  selectedEntityId: string | null;
  activeAssetId: string | null;
  multiplayer: MultiplayerStatus;
  isDmThinking: boolean;
  lastSavedAt: string | null;
  setMode: (mode: AppMode) => void;
  setPanelTab: (tab: PanelTab) => void;
  selectEntity: (id: string | null) => void;
  setActiveAsset: (id: string | null) => void;
  addEntity: (entity: MapEntity) => void;
  updateEntity: (id: string, update: Partial<MapEntity>) => void;
  removeEntity: (id: string) => void;
  addScenery: (scenery: SplatScenery) => void;
  removeScenery: (id: string) => void;
  replaceMap: (map: GameMap, summary?: string) => void;
  installGeneratedCampaign: (plan: CampaignPlan, world: WorldPlan, map: GameMap) => void;
  travelToLocation: (locationId: string, map: GameMap) => void;
  renameCampaign: (name: string) => void;
  addCharacter: (character?: Character) => Character;
  updateCharacter: (id: string, update: Partial<Character>) => void;
  removeCharacter: (id: string) => void;
  setActiveCharacter: (id: string) => void;
  damageCharacter: (id: string, amount: number, damageType?: DamageType) => void;
  healCharacter: (id: string, amount: number) => void;
  restCharacter: (id: string, kind: "short" | "long", hitDice?: number) => void;
  addMessage: (message: Omit<DmMessage, "id" | "createdAt">) => DmMessage;
  addEvent: (type: string, summary: string, payload?: Record<string, unknown>) => CampaignEvent;
  setDmThinking: (thinking: boolean) => void;
  progressStoryBeat: (beatId: string, outcome: "activate" | "success" | "failure", reason: string) => boolean;
  updateSettings: (update: Partial<Campaign["settings"]>) => void;
  setMultiplayer: (update: Partial<MultiplayerStatus>) => void;
  replaceCampaign: (campaign: Campaign) => void;
  resetCampaign: () => void;
  markSaved: () => void;
}

const touchCampaign = (campaign: Campaign): Campaign => ({ ...campaign, updatedAt: new Date().toISOString() });

export const useCampaignStore = create<CampaignStore>()(
  persist(
    (set, get) => ({
      campaign: createStarterCampaign(),
      mode: "build",
      panelTab: "dm",
      selectedEntityId: null,
      activeAssetId: null,
      multiplayer: { mode: "offline", connected: false, roomCode: "", peerCount: 0, route: "none" },
      isDmThinking: false,
      lastSavedAt: null,

      setMode: (mode) => set({ mode, activeAssetId: mode === "play" ? null : get().activeAssetId }),
      setPanelTab: (panelTab) => set({ panelTab }),
      selectEntity: (selectedEntityId) => set({ selectedEntityId }),
      setActiveAsset: (activeAssetId) => set({ activeAssetId, selectedEntityId: null }),

      addEntity: (entity) => {
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, map: { ...state.campaign.map, entities: [...state.campaign.map.entities, entity] } }), selectedEntityId: entity.id }));
        get().addEvent("map.entity_added", `Placed ${entity.name}`, { entityId: entity.id, assetId: entity.assetId });
      },
      updateEntity: (id, update) => set((state) => ({
        campaign: touchCampaign({ ...state.campaign, map: { ...state.campaign.map, entities: state.campaign.map.entities.map((entity) => entity.id === id ? { ...entity, ...update } : entity) } }),
      })),
      removeEntity: (id) => {
        const target = get().campaign.map.entities.find((entry) => entry.id === id);
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, map: { ...state.campaign.map, entities: state.campaign.map.entities.filter((entity) => entity.id !== id) } }), selectedEntityId: state.selectedEntityId === id ? null : state.selectedEntityId }));
        if (target) get().addEvent("map.entity_removed", `Removed ${target.name}`, { entityId: id });
      },
      addScenery: (scenery) => {
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, map: { ...state.campaign.map, scenery: [...(state.campaign.map.scenery ?? []), scenery] } }) }));
        get().addEvent("map.scenery_added", `Added ${scenery.name} as presentation scenery`, { sceneryId: scenery.id, storageKey: scenery.storageKey, byteLength: scenery.byteLength });
      },
      removeScenery: (id) => {
        const target = get().campaign.map.scenery?.find((entry) => entry.id === id);
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, map: { ...state.campaign.map, scenery: (state.campaign.map.scenery ?? []).filter((entry) => entry.id !== id) } }) }));
        if (target) get().addEvent("map.scenery_removed", `Removed ${target.name} from this map`, { sceneryId: id, storageKey: target.storageKey });
      },
      replaceMap: (map, summary = `Generated ${map.name}`) => {
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, map }), selectedEntityId: null, activeAssetId: null }));
        get().addEvent("map.replaced", summary, { mapId: map.id, theme: map.theme, entityCount: map.entities.length });
      },
      installGeneratedCampaign: (plan, world, map) => {
        set((state) => ({
          campaign: touchCampaign({
            ...state.campaign,
            name: plan.title,
            synopsis: plan.premise,
            campaignPlan: plan,
            world,
            activeLocationId: map.locationId ?? world.locations[0]?.id,
            map,
            storyThreads: plan.acts.map((act) => ({
              id: act.id,
              title: act.title,
              status: "open" as const,
              clock: plan.beats.filter((beat) => act.beatIds.includes(beat.id) && beat.status === "resolved").length,
              clockMax: act.beatIds.length,
              notes: act.purpose,
            })),
            messages: [{
              id: crypto.randomUUID(),
              role: "dm" as const,
              speaker: "Dungeon Master",
              content: plan.incitingIncident,
              createdAt: new Date().toISOString(),
            }],
          }),
          selectedEntityId: null,
          activeAssetId: null,
        }));
        get().addEvent("campaign.generated", `Created ${plan.title} with ${plan.acts.length} acts and ${world.locations.length} locations`, { planId: plan.id, worldId: world.id });
      },
      travelToLocation: (locationId, map) => {
        const location = get().campaign.world?.locations.find((entry) => entry.id === locationId);
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, activeLocationId: locationId, map }), selectedEntityId: null, activeAssetId: null }));
        get().addEvent("world.travelled", `Travelled to ${location?.name ?? map.name}`, { locationId, mapId: map.id });
      },
      renameCampaign: (name) => set((state) => ({ campaign: touchCampaign({ ...state.campaign, name }) })),

      addCharacter: (provided) => {
        const character = provided ?? { ...createDefaultCharacter(), id: crypto.randomUUID(), name: "New Adventurer", playerName: "" };
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, characters: [...state.campaign.characters, character], activeCharacterId: character.id }) }));
        get().addEvent("character.added", `Added ${character.name}`, { characterId: character.id });
        return character;
      },
      updateCharacter: (id, update) => set((state) => ({
        campaign: touchCampaign({ ...state.campaign, characters: state.campaign.characters.map((character) => character.id === id ? { ...character, ...update } : character) }),
      })),
      removeCharacter: (id) => set((state) => {
        const characters = state.campaign.characters.filter((character) => character.id !== id);
        return { campaign: touchCampaign({ ...state.campaign, characters, activeCharacterId: state.campaign.activeCharacterId === id ? characters[0]?.id ?? "" : state.campaign.activeCharacterId }) };
      }),
      setActiveCharacter: (activeCharacterId) => set((state) => ({ campaign: { ...state.campaign, activeCharacterId } })),
      damageCharacter: (id, amount, damageType) => {
        const target = get().campaign.characters.find((character) => character.id === id);
        if (!target) return;
        const resolved = damageType ? resolveTypedDamage(amount, damageType, { resistances: target.damageResistances, vulnerabilities: target.damageVulnerabilities, immunities: target.damageImmunities }) : undefined;
        const finalDamage = resolved?.finalDamage ?? amount;
        get().updateCharacter(id, applyDamage(target, finalDamage));
        get().addEvent("character.damaged", `${target.name} took ${finalDamage}${damageType ? ` ${damageType}` : ""} damage`, { characterId: id, amount, finalDamage, damageType, resolution: resolved });
      },
      healCharacter: (id, amount) => {
        const target = get().campaign.characters.find((character) => character.id === id);
        if (!target) return;
        get().updateCharacter(id, applyHealing(target, amount));
        get().addEvent("character.healed", `${target.name} recovered ${amount} hit points`, { characterId: id, amount });
      },
      restCharacter: (id, kind, hitDice = 1) => {
        const target = get().campaign.characters.find((character) => character.id === id);
        if (!target || target.hitPoints.current <= 0) return;
        get().updateCharacter(id, kind === "long" ? longRest(target) : shortRest(target, hitDice));
        get().addEvent(`character.${kind}_rest`, `${target.name} completed a ${kind} rest`, { characterId: id, hitDice: kind === "short" ? hitDice : undefined });
      },

      addMessage: (input) => {
        const message: DmMessage = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, messages: [...state.campaign.messages, message].slice(-200) }) }));
        return message;
      },
      addEvent: (type, summary, payload) => {
        const current = get().campaign;
        const event: CampaignEvent = { id: crypto.randomUUID(), revision: current.revision + 1, type, summary, payload, createdAt: new Date().toISOString() };
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, revision: event.revision, events: [...state.campaign.events, event].slice(-1000) }) }));
        return event;
      },
      setDmThinking: (isDmThinking) => set({ isDmThinking }),
      progressStoryBeat: (beatId, outcome, reason) => {
        const plan = get().campaign.campaignPlan;
        const target = plan?.beats.find((beat) => beat.id === beatId);
        if (!plan || !target) return false;
        const completed = new Set(plan.beats.filter((beat) => beat.status === "resolved" || beat.status === "failed" || beat.status === "skipped").map((beat) => beat.id));
        if (outcome !== "activate" && target.prerequisites.some((id) => !completed.has(id))) return false;
        const nextStatus = outcome === "activate" ? "active" : outcome === "success" ? "resolved" : "failed";
        const updatedBeats = plan.beats.map((beat) => beat.id === beatId ? { ...beat, status: nextStatus as typeof beat.status } : beat);
        if (outcome !== "activate") {
          for (const beat of updatedBeats) {
            if (beat.status === "locked" && beat.prerequisites.every((id) => id === beatId || updatedBeats.some((candidate) => candidate.id === id && ["resolved", "failed", "skipped"].includes(candidate.status)))) beat.status = "available";
          }
        }
        const updatedPlan = { ...plan, beats: updatedBeats };
        set((state) => ({ campaign: touchCampaign({
          ...state.campaign,
          campaignPlan: updatedPlan,
          storyThreads: state.campaign.storyThreads.map((thread) => {
            const act = updatedPlan.acts.find((entry) => entry.id === thread.id);
            if (!act) return thread;
            const resolved = updatedBeats.filter((beat) => act.beatIds.includes(beat.id) && ["resolved", "failed", "skipped"].includes(beat.status)).length;
            return { ...thread, clock: resolved, status: resolved >= act.beatIds.length ? "resolved" : "open" };
          }),
        }) }));
        get().addEvent("story.beat_progressed", `${target.title}: ${outcome}`, { beatId, outcome, reason });
        return true;
      },
      updateSettings: (update) => set((state) => ({ campaign: touchCampaign({ ...state.campaign, settings: { ...state.campaign.settings, ...update } }) })),
      setMultiplayer: (update) => set((state) => ({ multiplayer: { ...state.multiplayer, ...update } })),
      replaceCampaign: (campaign) => set({ campaign: touchCampaign(campaign), selectedEntityId: null, activeAssetId: null }),
      resetCampaign: () => set({ campaign: createStarterCampaign(), selectedEntityId: null, activeAssetId: null, mode: "build", panelTab: "dm" }),
      markSaved: () => set({ lastSavedAt: new Date().toISOString() }),
    }),
    {
      name: "dndrom-campaign-v1",
      version: 1,
      partialize: (state) => ({ campaign: state.campaign, mode: state.mode, panelTab: state.panelTab, lastSavedAt: state.lastSavedAt }),
    },
  ),
);
