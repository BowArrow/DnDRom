import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyDamage, applyHealing } from "../domain/rules";
import { longRest, resolveTypedDamage, shortRest } from "../domain/srdRules";
import { createDefaultCharacter, createStarterCampaign } from "../domain/seed";
import { attachmentLocalPosition, structuralDescendants, updateAttachmentHierarchy } from "../domain/buildPlacement";
import { DEFAULT_SCENE_LIGHTING } from "../domain/lighting";
import { basePlateDependencies, MAX_BASE_REVISIONS } from "../domain/baseplates";
import { campaignCatalog, makeCampaignScene, normalizeCampaignScenes, snapshotActiveScene } from "../domain/campaignScenes";
import { normalizeTokenAssetAnimations } from "../domain/tokenAnimation";
import type {
  AppMode,
  Campaign,
  CampaignEvent,
  CampaignPlan,
  CampaignScene,
  Character,
  DmMessage,
  GameMap,
  MapEntity,
  SplatScenery,
  TokenAsset,
  MultiplayerStatus,
  PanelTab,
  WorldPlan,
  DamageType,
  DiceSides,
  DiceTheme,
  MaterialAsset,
  PropAsset,
  BasePlateAsset,
  BasePlateAssignmentSubject,
  SceneTemplateAsset,
} from "../domain/types";

interface CampaignStore {
  campaign: Campaign;
  campaignLibrary: Campaign[];
  miniatureLibrary: TokenAsset[];
  diceThemeLibrary: DiceTheme[];
  propLibrary: PropAsset[];
  materialLibrary: MaterialAsset[];
  basePlateLibrary: BasePlateAsset[];
  sceneLibrary: SceneTemplateAsset[];
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
  updateMapLighting: (update: Partial<NonNullable<GameMap["lighting"]>>) => void;
  updateMapGridShape: (shape: NonNullable<GameMap["gridShape"]>) => void;
  addTokenAsset: (asset: TokenAsset) => void;
  addTokenToCampaign: (id: string) => boolean;
  removeTokenFromCampaign: (id: string) => boolean;
  removeTokenAsset: (id: string) => void;
  savePropAsset: (asset: PropAsset) => void;
  addPropToCampaign: (id: string) => boolean;
  removePropFromCampaign: (id: string) => boolean;
  removePropAsset: (id: string) => void;
  saveMaterialAsset: (asset: MaterialAsset) => void;
  addMaterialToCampaign: (id: string) => boolean;
  removeMaterialFromCampaign: (id: string) => boolean;
  removeMaterialAsset: (id: string) => void;
  saveBasePlateAsset: (asset: BasePlateAsset) => void;
  addBasePlateToCampaign: (id: string) => boolean;
  removeBasePlateFromCampaign: (id: string) => boolean;
  removeBasePlateAsset: (id: string) => void;
  saveSceneTemplate: (asset: SceneTemplateAsset) => void;
  addSceneTemplateToCampaign: (id: string) => boolean;
  removeSceneTemplateFromCampaign: (id: string) => boolean;
  removeSceneTemplate: (id: string) => void;
  assignBasePlate: (scope: "campaign" | "scene", subject: BasePlateAssignmentSubject, assetId: string | null) => void;
  assignTokenBasePlate: (tokenAssetId: string, assetId: string | null, formId?: string) => void;
  linkTokenCharacter: (tokenAssetId: string, characterId: string | null) => void;
  saveDiceTheme: (theme: DiceTheme) => void;
  autosaveDiceTheme: (theme: DiceTheme) => void;
  removeDiceTheme: (id: string) => void;
  assignDiceTheme: (sides: DiceSides, themeId: string | null) => void;
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
  createCampaign: (name?: string) => Campaign;
  switchCampaign: (id: string) => boolean;
  deleteCampaign: (id: string) => boolean;
  addScene: (name: string, map: GameMap, partyCharacterIds: string[], notes?: string) => CampaignScene;
  switchScene: (id: string) => boolean;
  updateScene: (id: string, update: Partial<Pick<CampaignScene, "name" | "partyCharacterIds" | "notes">>) => void;
  deleteScene: (id: string) => boolean;
  resetCampaign: () => void;
  markSaved: () => void;
}

const touchCampaign = (campaign: Campaign): Campaign => ({ ...campaign, updatedAt: new Date().toISOString() });
const withoutAssignment = (assignments: Campaign["basePlateAssignments"], assetId: string) => Object.fromEntries(Object.entries(assignments ?? {}).filter(([, value]) => value !== assetId));
const updateAssignment = (assignments: Campaign["basePlateAssignments"], subject: BasePlateAssignmentSubject, assetId: string | null) => {
  const next = { ...(assignments ?? {}) };
  if (assetId) next[subject] = assetId;
  else delete next[subject];
  return next;
};
const updateFormAssignment = (assignments: Record<string, string> | undefined, formId: string, assetId: string | null) => {
  const next = { ...(assignments ?? {}) };
  if (assetId) next[formId] = assetId;
  else delete next[formId];
  return next;
};
const migratePropFields = (campaign: Campaign): Campaign => {
  const entities = campaign.map.entities;
  return {
    ...campaign,
    propAssets: campaign.propAssets ?? [],
    materialAssets: campaign.materialAssets ?? [],
    basePlateAssets: campaign.basePlateAssets ?? [],
    basePlateAssignments: campaign.basePlateAssignments ?? {},
    map: { ...campaign.map, entities: entities.map((entity) => {
      if (!entity.build || entity.build.placementVersion === 2) return entity;
      const parent = entity.build.parentId ? entities.find((entry) => entry.id === entity.build?.parentId) : undefined;
      return { ...entity, build: { placedAt: entity.build.placedAt, refundableUntil: entity.build.refundableUntil, placementVersion: 2 as const, parentId: parent?.id, surfaceId: entity.build.socketId, localPosition: parent ? attachmentLocalPosition(entity.position, parent) : { ...entity.position }, localRotation: parent ? { x: entity.rotation.x - parent.rotation.x, y: entity.rotation.y - parent.rotation.y, z: entity.rotation.z - parent.rotation.z } : { ...entity.rotation }, surfaceNormal: { x: 0, y: 1, z: 0 }, clearanceOffset: 0 } };
    }) },
  };
};
const migrateTokenAnimations = (campaign: Campaign): Campaign => ({
  ...campaign,
  tokenAssets: campaign.tokenAssets?.map(normalizeTokenAssetAnimations) ?? [],
});

export const useCampaignStore = create<CampaignStore>()(
  persist(
    (set, get) => ({
      campaign: createStarterCampaign(),
      campaignLibrary: [],
      miniatureLibrary: [],
      diceThemeLibrary: [],
      propLibrary: [],
      materialLibrary: [],
      basePlateLibrary: [],
      sceneLibrary: [],
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
        campaign: touchCampaign({ ...state.campaign, map: { ...state.campaign.map, entities: updateAttachmentHierarchy(state.campaign.map.entities, id, update) } }),
      })),
      removeEntity: (id) => {
        const target = get().campaign.map.entities.find((entry) => entry.id === id);
        const dependents = structuralDescendants(get().campaign.map.entities, id);
        const removedIds = new Set([id, ...dependents]);
        const refundEligible = Boolean(target?.build && Date.now() <= Date.parse(target.build.refundableUntil));
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, map: { ...state.campaign.map, entities: state.campaign.map.entities.filter((entity) => !removedIds.has(entity.id)) } }), selectedEntityId: state.selectedEntityId && removedIds.has(state.selectedEntityId) ? null : state.selectedEntityId }));
        if (target) get().addEvent("map.entity_removed", `Removed ${target.name}${dependents.length ? ` and collapsed ${dependents.length} unsupported piece${dependents.length === 1 ? "" : "s"}` : ""}${refundEligible ? " with a full build refund" : ""}`, { entityId: id, refundEligible, structuralDependents: dependents });
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
      updateMapLighting: (update) => set((state) => ({
        campaign: touchCampaign({
          ...state.campaign,
          map: { ...state.campaign.map, lighting: { ...DEFAULT_SCENE_LIGHTING, ...state.campaign.map.lighting, ...update } },
        }),
      })),
      updateMapGridShape: (gridShape) => set((state) => ({
        campaign: touchCampaign({ ...state.campaign, map: { ...state.campaign.map, gridShape } }),
      })),
      addTokenAsset: (asset) => {
        set((state) => {
          const inCampaign = state.campaign.tokenAssets ?? [];
          const inLibrary = state.miniatureLibrary;
          const tokenCharacterLinks = { ...(state.campaign.tokenCharacterLinks ?? {}) };
          if (asset.characterId) tokenCharacterLinks[asset.id] = asset.characterId;
          return {
            campaign: touchCampaign({
              ...state.campaign,
              tokenAssets: inCampaign.some((entry) => entry.id === asset.id) ? inCampaign.map((entry) => entry.id === asset.id ? asset : entry) : [...inCampaign, asset],
              tokenCharacterLinks,
            }),
            miniatureLibrary: inLibrary.some((entry) => entry.id === asset.id) ? inLibrary.map((entry) => entry.id === asset.id ? asset : entry) : [...inLibrary, asset],
          };
        });
        if (asset.characterId) get().updateCharacter(asset.characterId, { tokenAssetId: asset.id });
        get().addEvent("token.asset_added", `Created ${asset.name} ${asset.kind} token`, { tokenAssetId: asset.id, kind: asset.kind, source: asset.source });
      },
      addTokenToCampaign: (id) => {
        const asset = get().miniatureLibrary.find((entry) => entry.id === id);
        if (!asset) return false;
        if (get().campaign.tokenAssets?.some((entry) => entry.id === id)) return true;
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, tokenAssets: [...(state.campaign.tokenAssets ?? []), asset] }) }));
        get().addEvent("token.campaign_added", `Added ${asset.name} to this campaign`, { tokenAssetId: id });
        return true;
      },
      removeTokenFromCampaign: (id) => {
        const asset = get().campaign.tokenAssets?.find((entry) => entry.id === id);
        if (!asset) return false;
        set((state) => ({
          campaign: touchCampaign({
            ...state.campaign,
            tokenAssets: (state.campaign.tokenAssets ?? []).filter((entry) => entry.id !== id),
            tokenCharacterLinks: Object.fromEntries(Object.entries(state.campaign.tokenCharacterLinks ?? {}).filter(([tokenId]) => tokenId !== id)),
            map: { ...state.campaign.map, entities: state.campaign.map.entities.filter((entry) => entry.assetId !== id) },
            characters: state.campaign.characters.map((character) => character.tokenAssetId === id ? { ...character, tokenAssetId: "token-hero" } : character),
          }),
          selectedEntityId: state.campaign.map.entities.some((entry) => entry.id === state.selectedEntityId && entry.assetId === id) ? null : state.selectedEntityId,
          activeAssetId: state.activeAssetId === id ? null : state.activeAssetId,
        }));
        get().addEvent("token.campaign_removed", `Removed ${asset.name} from this campaign and cleared its placed copies`, { tokenAssetId: id });
        return true;
      },
      removeTokenAsset: (id) => {
        const target = get().campaign.tokenAssets?.find((entry) => entry.id === id);
        set((state) => ({ campaign: touchCampaign({
          ...state.campaign,
          tokenAssets: (state.campaign.tokenAssets ?? []).filter((entry) => entry.id !== id),
          tokenCharacterLinks: Object.fromEntries(Object.entries(state.campaign.tokenCharacterLinks ?? {}).filter(([tokenId]) => tokenId !== id)),
          map: { ...state.campaign.map, entities: state.campaign.map.entities.filter((entry) => entry.assetId !== id) },
          characters: state.campaign.characters.map((character) => character.tokenAssetId === id ? { ...character, tokenAssetId: "token-hero" } : character),
        }), miniatureLibrary: state.miniatureLibrary.filter((entry) => entry.id !== id), selectedEntityId: state.campaign.map.entities.some((entry) => entry.id === state.selectedEntityId && entry.assetId === id) ? null : state.selectedEntityId }));
        if (target) get().addEvent("token.asset_removed", `Removed ${target.name} and its placed copies`, { tokenAssetId: id });
      },
      savePropAsset: (asset) => {
        const bounded = { ...asset, revisions: asset.revisions.slice(0, 8) };
        set((state) => ({
          campaign: touchCampaign({ ...state.campaign, propAssets: (state.campaign.propAssets ?? []).some((entry) => entry.id === asset.id) ? (state.campaign.propAssets ?? []).map((entry) => entry.id === asset.id ? bounded : entry) : [...(state.campaign.propAssets ?? []), bounded] }),
          propLibrary: state.propLibrary.some((entry) => entry.id === asset.id) ? state.propLibrary.map((entry) => entry.id === asset.id ? bounded : entry) : [...state.propLibrary, bounded],
        }));
        get().addEvent("prop.asset_saved", `Saved prop ${asset.name}`, { propAssetId: asset.id, source: asset.source });
      },
      addPropToCampaign: (id) => {
        const asset = get().propLibrary.find((entry) => entry.id === id);
        if (!asset) return false;
        if (get().campaign.propAssets?.some((entry) => entry.id === id)) return true;
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, propAssets: [...(state.campaign.propAssets ?? []), asset] }) }));
        return true;
      },
      removePropFromCampaign: (id) => {
        if (!get().campaign.propAssets?.some((entry) => entry.id === id)) return false;
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, propAssets: (state.campaign.propAssets ?? []).filter((entry) => entry.id !== id), map: { ...state.campaign.map, entities: state.campaign.map.entities.filter((entry) => entry.assetId !== id) } }), activeAssetId: state.activeAssetId === id ? null : state.activeAssetId }));
        return true;
      },
      removePropAsset: (id) => set((state) => ({ campaign: touchCampaign({ ...state.campaign, propAssets: (state.campaign.propAssets ?? []).filter((entry) => entry.id !== id), map: { ...state.campaign.map, entities: state.campaign.map.entities.filter((entry) => entry.assetId !== id) } }), propLibrary: state.propLibrary.filter((entry) => entry.id !== id), activeAssetId: state.activeAssetId === id ? null : state.activeAssetId })),
      saveMaterialAsset: (asset) => {
        const bounded = { ...asset, revisions: asset.revisions.slice(0, 8) };
        set((state) => ({
          campaign: touchCampaign({ ...state.campaign, materialAssets: (state.campaign.materialAssets ?? []).some((entry) => entry.id === asset.id) ? (state.campaign.materialAssets ?? []).map((entry) => entry.id === asset.id ? bounded : entry) : [...(state.campaign.materialAssets ?? []), bounded] }),
          materialLibrary: state.materialLibrary.some((entry) => entry.id === asset.id) ? state.materialLibrary.map((entry) => entry.id === asset.id ? bounded : entry) : [...state.materialLibrary, bounded],
        }));
        get().addEvent("material.asset_saved", `Saved material ${asset.name}`, { materialAssetId: asset.id, source: asset.source });
      },
      addMaterialToCampaign: (id) => {
        const asset = get().materialLibrary.find((entry) => entry.id === id);
        if (!asset) return false;
        if (get().campaign.materialAssets?.some((entry) => entry.id === id)) return true;
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, materialAssets: [...(state.campaign.materialAssets ?? []), asset] }) }));
        return true;
      },
      removeMaterialFromCampaign: (id) => {
        if (!get().campaign.materialAssets?.some((entry) => entry.id === id)) return false;
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, materialAssets: (state.campaign.materialAssets ?? []).filter((entry) => entry.id !== id), map: { ...state.campaign.map, entities: state.campaign.map.entities.map((entry) => entry.materialAssetId === id ? { ...entry, materialAssetId: undefined } : entry) } }) }));
        return true;
      },
      removeMaterialAsset: (id) => set((state) => ({ campaign: touchCampaign({ ...state.campaign, materialAssets: (state.campaign.materialAssets ?? []).filter((entry) => entry.id !== id), map: { ...state.campaign.map, entities: state.campaign.map.entities.map((entry) => entry.materialAssetId === id ? { ...entry, materialAssetId: undefined } : entry) } }), materialLibrary: state.materialLibrary.filter((entry) => entry.id !== id) })),
      saveBasePlateAsset: (asset) => {
        const bounded = { ...asset, revisions: asset.revisions.slice(0, MAX_BASE_REVISIONS) };
        const dependencies = basePlateDependencies(bounded);
        set((state) => ({
          campaign: touchCampaign({
            ...state.campaign,
            basePlateAssets: (state.campaign.basePlateAssets ?? []).some((entry) => entry.id === bounded.id) ? (state.campaign.basePlateAssets ?? []).map((entry) => entry.id === bounded.id ? bounded : entry) : [...(state.campaign.basePlateAssets ?? []), bounded],
            propAssets: [...new Map([...(state.campaign.propAssets ?? []), ...state.propLibrary.filter((entry) => dependencies.propAssetIds.includes(entry.id))].map((entry) => [entry.id, entry])).values()],
            materialAssets: [...new Map([...(state.campaign.materialAssets ?? []), ...state.materialLibrary.filter((entry) => dependencies.materialAssetIds.includes(entry.id))].map((entry) => [entry.id, entry])).values()],
          }),
          basePlateLibrary: state.basePlateLibrary.some((entry) => entry.id === bounded.id) ? state.basePlateLibrary.map((entry) => entry.id === bounded.id ? bounded : entry) : [...state.basePlateLibrary, bounded],
        }));
        get().addEvent("baseplate.asset_saved", `Saved scenic base ${bounded.name}`, { basePlateAssetId: bounded.id });
      },
      addBasePlateToCampaign: (id) => {
        const asset = get().basePlateLibrary.find((entry) => entry.id === id);
        if (!asset) return false;
        if (get().campaign.basePlateAssets?.some((entry) => entry.id === id)) return true;
        const dependencies = basePlateDependencies(asset);
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, basePlateAssets: [...(state.campaign.basePlateAssets ?? []), asset], propAssets: [...new Map([...(state.campaign.propAssets ?? []), ...state.propLibrary.filter((entry) => dependencies.propAssetIds.includes(entry.id))].map((entry) => [entry.id, entry])).values()], materialAssets: [...new Map([...(state.campaign.materialAssets ?? []), ...state.materialLibrary.filter((entry) => dependencies.materialAssetIds.includes(entry.id))].map((entry) => [entry.id, entry])).values()] }) }));
        return true;
      },
      removeBasePlateFromCampaign: (id) => {
        if (!get().campaign.basePlateAssets?.some((entry) => entry.id === id)) return false;
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, basePlateAssets: (state.campaign.basePlateAssets ?? []).filter((entry) => entry.id !== id), basePlateAssignments: withoutAssignment(state.campaign.basePlateAssignments, id), scenes: state.campaign.scenes?.map((scene) => ({ ...scene, basePlateAssignments: withoutAssignment(scene.basePlateAssignments, id) })), tokenAssets: state.campaign.tokenAssets?.map((token) => ({ ...token, defaultBasePlateAssetId: token.defaultBasePlateAssetId === id ? undefined : token.defaultBasePlateAssetId, formBasePlateAssignments: Object.fromEntries(Object.entries(token.formBasePlateAssignments ?? {}).filter(([, value]) => value !== id)) })) }) }));
        return true;
      },
      removeBasePlateAsset: (id) => {
        get().removeBasePlateFromCampaign(id);
        set((state) => ({ basePlateLibrary: state.basePlateLibrary.filter((entry) => entry.id !== id) }));
      },
      saveSceneTemplate: (asset) => {
        const bounded = { ...asset, revisions: asset.revisions.slice(0, 8) };
        set((state) => ({
          campaign: touchCampaign({
            ...state.campaign,
            sceneTemplates: (state.campaign.sceneTemplates ?? []).some((entry) => entry.id === bounded.id)
              ? (state.campaign.sceneTemplates ?? []).map((entry) => entry.id === bounded.id ? bounded : entry)
              : [...(state.campaign.sceneTemplates ?? []), bounded],
            propAssets: [...new Map([...(state.campaign.propAssets ?? []), ...state.propLibrary.filter((entry) => bounded.propAssetIds.includes(entry.id))].map((entry) => [entry.id, entry])).values()],
            materialAssets: [...new Map([...(state.campaign.materialAssets ?? []), ...state.materialLibrary.filter((entry) => bounded.materialAssetIds.includes(entry.id))].map((entry) => [entry.id, entry])).values()],
          }),
          sceneLibrary: state.sceneLibrary.some((entry) => entry.id === bounded.id) ? state.sceneLibrary.map((entry) => entry.id === bounded.id ? bounded : entry) : [...state.sceneLibrary, bounded],
        }));
        get().addEvent("scene.template_saved", `Saved ${bounded.name} to the scene catalogue`, { sceneTemplateId: bounded.id });
      },
      addSceneTemplateToCampaign: (id) => {
        const asset = get().sceneLibrary.find((entry) => entry.id === id);
        if (!asset) return false;
        if (get().campaign.sceneTemplates?.some((entry) => entry.id === id)) return true;
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, sceneTemplates: [...(state.campaign.sceneTemplates ?? []), asset] }) }));
        return true;
      },
      removeSceneTemplateFromCampaign: (id) => {
        if (!get().campaign.sceneTemplates?.some((entry) => entry.id === id)) return false;
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, sceneTemplates: (state.campaign.sceneTemplates ?? []).filter((entry) => entry.id !== id) }) }));
        return true;
      },
      removeSceneTemplate: (id) => set((state) => ({ campaign: touchCampaign({ ...state.campaign, sceneTemplates: (state.campaign.sceneTemplates ?? []).filter((entry) => entry.id !== id) }), sceneLibrary: state.sceneLibrary.filter((entry) => entry.id !== id) })),
      assignBasePlate: (scope, subject, assetId) => set((state) => {
        if (assetId && !(state.campaign.basePlateAssets ?? []).some((entry) => entry.id === assetId)) return state;
        if (scope === "scene") {
          const active = state.campaign.activeSceneId;
          return { campaign: touchCampaign({ ...state.campaign, scenes: state.campaign.scenes?.map((scene) => scene.id !== active ? scene : { ...scene, basePlateAssignments: updateAssignment(scene.basePlateAssignments, subject, assetId) }) }) };
        }
        return { campaign: touchCampaign({ ...state.campaign, basePlateAssignments: updateAssignment(state.campaign.basePlateAssignments, subject, assetId) }) };
      }),
      assignTokenBasePlate: (tokenAssetId, assetId, formId) => set((state) => ({ campaign: touchCampaign({ ...state.campaign, tokenAssets: state.campaign.tokenAssets?.map((token) => token.id !== tokenAssetId ? token : formId ? { ...token, formBasePlateAssignments: updateFormAssignment(token.formBasePlateAssignments, formId, assetId) } : { ...token, defaultBasePlateAssetId: assetId || undefined }) }), miniatureLibrary: state.miniatureLibrary.map((token) => token.id !== tokenAssetId ? token : formId ? { ...token, formBasePlateAssignments: updateFormAssignment(token.formBasePlateAssignments, formId, assetId) } : { ...token, defaultBasePlateAssetId: assetId || undefined }) })),
      linkTokenCharacter: (tokenAssetId, characterId) => {
        set((state) => {
          const links = { ...(state.campaign.tokenCharacterLinks ?? {}) };
          if (characterId) links[tokenAssetId] = characterId;
          else delete links[tokenAssetId];
          return { campaign: touchCampaign({
            ...state.campaign,
            tokenCharacterLinks: links,
            characters: state.campaign.characters.map((character) => character.id === characterId
              ? { ...character, tokenAssetId }
              : character.tokenAssetId === tokenAssetId ? { ...character, tokenAssetId: "token-hero" } : character),
          }) };
        });
        get().addEvent("character.token_linked", characterId ? "Attached a campaign sheet to a reusable miniature" : "Detached a campaign sheet from a reusable miniature", { tokenAssetId, characterId });
      },
      autosaveDiceTheme: (theme) => {
        set((state) => {
          const themes = state.campaign.diceThemes ?? [];
          const exists = themes.some((entry) => entry.id === theme.id);
          const libraryExists = state.diceThemeLibrary.some((entry) => entry.id === theme.id);
          return {
            campaign: touchCampaign({
              ...state.campaign,
              diceThemes: exists ? themes.map((entry) => entry.id === theme.id ? theme : entry) : [...themes, theme],
            }),
            diceThemeLibrary: libraryExists ? state.diceThemeLibrary.map((entry) => entry.id === theme.id ? theme : entry) : [...state.diceThemeLibrary, theme],
          };
        });
      },
      saveDiceTheme: (theme) => {
        get().autosaveDiceTheme(theme);
        get().addEvent("dice.theme_saved", `Saved dice theme ${theme.name}`, { diceThemeId: theme.id, source: theme.source });
      },
      removeDiceTheme: (id) => {
        const target = get().campaign.diceThemes?.find((entry) => entry.id === id);
        set((state) => ({
          campaign: touchCampaign({
            ...state.campaign,
            diceThemes: (state.campaign.diceThemes ?? []).filter((entry) => entry.id !== id),
            diceThemeAssignments: Object.fromEntries(Object.entries(state.campaign.diceThemeAssignments ?? {}).filter(([, themeId]) => themeId !== id)),
          }),
          diceThemeLibrary: state.diceThemeLibrary.filter((entry) => entry.id !== id),
        }));
        if (target) get().addEvent("dice.theme_removed", `Removed dice theme ${target.name}`, { diceThemeId: id });
      },
      assignDiceTheme: (sides, themeId) => {
        const key = `d${sides}` as const;
        set((state) => {
          const assignments = { ...(state.campaign.diceThemeAssignments ?? {}) };
          if (themeId) assignments[key] = themeId;
          else delete assignments[key];
          const libraryTheme = state.diceThemeLibrary.find((entry) => entry.id === themeId);
          const themes = state.campaign.diceThemes ?? [];
          return { campaign: touchCampaign({
            ...state.campaign,
            diceThemeAssignments: assignments,
            diceThemes: libraryTheme && !themes.some((entry) => entry.id === libraryTheme.id) ? [...themes, libraryTheme] : themes,
          }) };
        });
        get().addEvent("dice.theme_assigned", themeId ? `Assigned a custom theme to d${sides}` : `Restored the default d${sides} theme`, { sides, themeId });
      },
      replaceMap: (map, summary = `Generated ${map.name}`) => {
        set((state) => ({ campaign: touchCampaign({ ...state.campaign, map }), selectedEntityId: null, activeAssetId: null }));
        get().addEvent("map.replaced", summary, { mapId: map.id, theme: map.theme, entityCount: map.entities.length });
      },
      installGeneratedCampaign: (plan, world, map) => {
        const scene = makeCampaignScene(map.name, map, get().campaign.characters.map((character) => character.id), plan.incitingIncident);
        set((state) => ({
          campaign: touchCampaign({
            ...state.campaign,
            name: plan.title,
            synopsis: plan.premise,
            campaignPlan: plan,
            world,
            activeLocationId: map.locationId ?? world.locations[0]?.id,
            map: scene.map,
            scenes: [scene],
            activeSceneId: scene.id,
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
        set((state) => {
          const current = snapshotActiveScene(state.campaign);
          const existing = current.scenes?.find((scene) => scene.map.locationId === locationId);
          if (existing) return { campaign: touchCampaign({ ...current, activeLocationId: locationId, activeSceneId: existing.id, map: structuredClone(existing.map) }), selectedEntityId: null, activeAssetId: null };
          const scene = makeCampaignScene(location?.name ?? map.name, map, current.scenes?.find((entry) => entry.id === current.activeSceneId)?.partyCharacterIds ?? current.characters.map((character) => character.id), `World location: ${location?.name ?? map.name}`);
          return { campaign: touchCampaign({ ...current, activeLocationId: locationId, activeSceneId: scene.id, scenes: [...(current.scenes ?? []), scene], map: structuredClone(scene.map) }), selectedEntityId: null, activeAssetId: null };
        });
        get().addEvent("world.travelled", `Travelled to ${location?.name ?? map.name}`, { locationId, mapId: map.id });
      },
      renameCampaign: (name) => set((state) => ({ campaign: touchCampaign({ ...state.campaign, name }) })),

      addCharacter: (provided) => {
        const character = provided ?? { ...createDefaultCharacter(), id: crypto.randomUUID(), name: "New Adventurer", playerName: "" };
        set((state) => ({ campaign: touchCampaign({
          ...state.campaign,
          characters: [...state.campaign.characters, character],
          activeCharacterId: character.id,
          scenes: state.campaign.scenes?.map((scene) => scene.id === state.campaign.activeSceneId ? { ...scene, partyCharacterIds: [...new Set([...scene.partyCharacterIds, character.id])] } : scene),
        }) }));
        get().addEvent("character.added", `Added ${character.name}`, { characterId: character.id });
        return character;
      },
      updateCharacter: (id, update) => set((state) => ({
        campaign: touchCampaign({ ...state.campaign, characters: state.campaign.characters.map((character) => character.id === id ? { ...character, ...update } : character) }),
      })),
      removeCharacter: (id) => set((state) => {
        const characters = state.campaign.characters.filter((character) => character.id !== id);
        return { campaign: touchCampaign({
          ...state.campaign,
          characters,
          activeCharacterId: state.campaign.activeCharacterId === id ? characters[0]?.id ?? "" : state.campaign.activeCharacterId,
          tokenCharacterLinks: Object.fromEntries(Object.entries(state.campaign.tokenCharacterLinks ?? {}).filter(([, characterId]) => characterId !== id)),
          scenes: state.campaign.scenes?.map((scene) => ({ ...scene, partyCharacterIds: scene.partyCharacterIds.filter((characterId) => characterId !== id) })),
        }) };
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
      replaceCampaign: (campaign) => set((state) => ({
        campaign: touchCampaign(normalizeCampaignScenes(migratePropFields(campaign))),
        campaignLibrary: campaignCatalog(state.campaign, state.campaignLibrary).filter((entry) => entry.id !== campaign.id),
        miniatureLibrary: [...new Map([...state.miniatureLibrary, ...(campaign.tokenAssets ?? [])].map((asset) => [asset.id, asset])).values()],
        propLibrary: [...new Map([...state.propLibrary, ...(campaign.propAssets ?? [])].map((asset) => [asset.id, asset])).values()],
        materialLibrary: [...new Map([...state.materialLibrary, ...(campaign.materialAssets ?? [])].map((asset) => [asset.id, asset])).values()],
        basePlateLibrary: [...new Map([...state.basePlateLibrary, ...(campaign.basePlateAssets ?? [])].map((asset) => [asset.id, asset])).values()],
        sceneLibrary: [...new Map([...state.sceneLibrary, ...(campaign.sceneTemplates ?? [])].map((asset) => [asset.id, asset])).values()],
        selectedEntityId: null,
        activeAssetId: null,
      })),
      createCampaign: (name = "New Campaign") => {
        const campaign = createStarterCampaign();
        campaign.name = name.trim() || "New Campaign";
        campaign.synopsis = "A new locally saved campaign waiting for its first adventure.";
        set((state) => ({
          campaign,
          campaignLibrary: campaignCatalog(state.campaign, state.campaignLibrary),
          selectedEntityId: null,
          activeAssetId: null,
          mode: "build",
          panelTab: "dm",
        }));
        return campaign;
      },
      switchCampaign: (id) => {
        const state = get();
        if (id === state.campaign.id) return true;
        const target = state.campaignLibrary.find((entry) => entry.id === id);
        if (!target) return false;
        const current = snapshotActiveScene(state.campaign);
        set({
          campaign: normalizeCampaignScenes(migratePropFields(target)),
          campaignLibrary: [current, ...state.campaignLibrary.filter((entry) => entry.id !== id && entry.id !== current.id)],
          miniatureLibrary: [...new Map([...state.miniatureLibrary, ...(target.tokenAssets ?? [])].map((asset) => [asset.id, asset])).values()],
          propLibrary: [...new Map([...state.propLibrary, ...(target.propAssets ?? [])].map((asset) => [asset.id, asset])).values()],
          materialLibrary: [...new Map([...state.materialLibrary, ...(target.materialAssets ?? [])].map((asset) => [asset.id, asset])).values()],
          basePlateLibrary: [...new Map([...state.basePlateLibrary, ...(target.basePlateAssets ?? [])].map((asset) => [asset.id, asset])).values()],
          sceneLibrary: [...new Map([...state.sceneLibrary, ...(target.sceneTemplates ?? [])].map((asset) => [asset.id, asset])).values()],
          selectedEntityId: null,
          activeAssetId: null,
          mode: "build",
          panelTab: "dm",
        });
        return true;
      },
      deleteCampaign: (id) => {
        const state = get();
        if (id === state.campaign.id) return false;
        if (!state.campaignLibrary.some((entry) => entry.id === id)) return false;
        set({ campaignLibrary: state.campaignLibrary.filter((entry) => entry.id !== id) });
        return true;
      },
      addScene: (name, map, partyCharacterIds, notes = "") => {
        const scene = makeCampaignScene(name, map, partyCharacterIds, notes);
        set((state) => {
          const campaign = snapshotActiveScene(state.campaign);
          return { campaign: touchCampaign({ ...campaign, scenes: [...(campaign.scenes ?? []), scene], activeSceneId: scene.id, map: structuredClone(scene.map), activeLocationId: scene.map.locationId }), selectedEntityId: null, activeAssetId: null };
        });
        get().addEvent("scene.created", `Created scene ${scene.name}`, { sceneId: scene.id, partyCharacterIds });
        return scene;
      },
      switchScene: (id) => {
        const current = snapshotActiveScene(get().campaign);
        const target = current.scenes?.find((scene) => scene.id === id);
        if (!target) return false;
        set({ campaign: touchCampaign({ ...current, activeSceneId: id, activeLocationId: target.map.locationId, map: structuredClone(target.map) }), selectedEntityId: null, activeAssetId: null });
        get().addEvent("scene.switched", `Switched to ${target.name}`, { sceneId: id, partyCharacterIds: target.partyCharacterIds });
        return true;
      },
      updateScene: (id, update) => set((state) => {
        const campaign = snapshotActiveScene(state.campaign);
        const now = new Date().toISOString();
        return { campaign: touchCampaign({
          ...campaign,
          scenes: campaign.scenes?.map((scene) => scene.id === id ? { ...scene, ...update, updatedAt: now } : scene),
          map: id === campaign.activeSceneId && update.name ? { ...campaign.map, name: update.name } : campaign.map,
        }) };
      }),
      deleteScene: (id) => {
        const state = get();
        const current = snapshotActiveScene(state.campaign);
        if (!current.scenes || current.scenes.length <= 1) return false;
        const remaining = current.scenes.filter((scene) => scene.id !== id);
        if (remaining.length === current.scenes.length) return false;
        const next = id === current.activeSceneId ? remaining[0] : remaining.find((scene) => scene.id === current.activeSceneId);
        if (!next) return false;
        set({ campaign: touchCampaign({ ...current, scenes: remaining, activeSceneId: next.id, activeLocationId: next.map.locationId, map: structuredClone(next.map) }), selectedEntityId: null, activeAssetId: null });
        return true;
      },
      resetCampaign: () => {
        const campaign = createStarterCampaign();
        set((state) => ({ campaign, campaignLibrary: campaignCatalog(state.campaign, state.campaignLibrary), selectedEntityId: null, activeAssetId: null, mode: "build", panelTab: "dm" }));
      },
      markSaved: () => set({ lastSavedAt: new Date().toISOString() }),
    }),
    {
      name: "dndrom-campaign-v1",
      version: 9,
      migrate: (persistedState) => {
        const persisted = persistedState as { campaign?: Campaign; campaignLibrary?: Campaign[]; miniatureLibrary?: TokenAsset[]; diceThemeLibrary?: DiceTheme[]; propLibrary?: PropAsset[]; materialLibrary?: MaterialAsset[]; basePlateLibrary?: BasePlateAsset[]; sceneLibrary?: SceneTemplateAsset[] };
        if (!persisted.campaign) return persistedState as CampaignStore;
        const defaults = createStarterCampaign();
        return {
          ...persistedState as object,
          campaign: normalizeCampaignScenes(migrateTokenAnimations(migratePropFields({
            ...persisted.campaign,
            settings: { ...defaults.settings, ...persisted.campaign.settings },
            tokenAssets: persisted.campaign.tokenAssets ?? [],
            propAssets: persisted.campaign.propAssets ?? [],
            materialAssets: persisted.campaign.materialAssets ?? [],
            basePlateAssets: persisted.campaign.basePlateAssets ?? [],
            sceneTemplates: persisted.campaign.sceneTemplates ?? [],
            basePlateAssignments: persisted.campaign.basePlateAssignments ?? {},
            tokenCharacterLinks: persisted.campaign.tokenCharacterLinks ?? Object.fromEntries((persisted.campaign.tokenAssets ?? []).filter((asset) => asset.characterId).map((asset) => [asset.id, asset.characterId!])),
          }))),
          campaignLibrary: (persisted.campaignLibrary ?? []).map(migratePropFields).map(migrateTokenAnimations).map(normalizeCampaignScenes),
          miniatureLibrary: [...new Map([...(persisted.miniatureLibrary ?? []), ...(persisted.campaign.tokenAssets ?? [])].map(normalizeTokenAssetAnimations).map((asset) => [asset.id, asset])).values()],
          propLibrary: [...new Map([...(persisted.propLibrary ?? []), ...(persisted.campaign.propAssets ?? [])].map((asset) => [asset.id, asset])).values()],
          materialLibrary: [...new Map([...(persisted.materialLibrary ?? []), ...(persisted.campaign.materialAssets ?? [])].map((asset) => [asset.id, asset])).values()],
          basePlateLibrary: [...new Map([...(persisted.basePlateLibrary ?? []), ...(persisted.campaign.basePlateAssets ?? [])].map((asset) => [asset.id, asset])).values()],
          sceneLibrary: [...new Map([...(persisted.sceneLibrary ?? []), ...(persisted.campaign.sceneTemplates ?? [])].map((asset) => [asset.id, asset])).values()],
          diceThemeLibrary: [...new Map([...(persisted.diceThemeLibrary ?? []), ...(persisted.campaign.diceThemes ?? [])].map((theme) => [theme.id, theme])).values()],
        } as CampaignStore;
      },
      partialize: (state) => ({ campaign: state.campaign, campaignLibrary: state.campaignLibrary, miniatureLibrary: state.miniatureLibrary, diceThemeLibrary: state.diceThemeLibrary, propLibrary: state.propLibrary, materialLibrary: state.materialLibrary, basePlateLibrary: state.basePlateLibrary, sceneLibrary: state.sceneLibrary, mode: state.mode, panelTab: state.panelTab, lastSavedAt: state.lastSavedAt }),
    },
  ),
);
