import { isUnreal } from "../migration/nativeBridge";
import { NativeSceneViewport } from "../migration/NativeSceneViewport";
import { buildingAccess } from "../domain/buildingAccess";
import { resolveWorldWeather, weatherSurfaceState } from "../domain/worldWeather";
import { WorldReveal } from "../domain/worldReveal";
import { updateWorldAtmosphere } from "../rendering/worldAtmosphere";
import { generateSpaceColonizedTree } from "../domain/worldArchitecture";
import { buildTreeBarkMesh } from "../rendering/treeBarkMesh";
import { treeFoliageTexture } from "../rendering/treeFoliageTexture";
import { buildTreeImpostor } from "../rendering/treeImpostor";
import { mapHeight } from "../domain/travelWorld";
import { syncWorldHorizon, worldHeight, horizonReady } from "../rendering/worldHorizon";
import { useEffect, useRef, useState } from "react";
import * as pc from "playcanvas";
import { ASSET_BY_ID, type AssetDefinition, type AssetPart } from "../domain/assets";
import { buildSpatialHash, buildSpec, raycastAttachmentSurfaces, resolveSocketPlacement, resolveSurfacePlacement, validatePlacement, type PlacementResolution, type SpatialHash } from "../domain/buildPlacement";
import { resolvedMotionReduction } from "../domain/displaySettings";
import { LOCAL_AI_SETTINGS_EVENT, readLocalAiSettings, worldWanBudget } from "../domain/localAiSettings";
import { resolveDiceEffects } from "../domain/diceEffects";
import { MAX_PROCEDURAL_DIE_TRIANGLES } from "../domain/meshBudget";
import { tokenBaseGeometry } from "../domain/tokenGeometry";
import { normalizeTokenAnimation, resolveTokenState } from "../domain/tokenAnimation";
import { resolvePracticalLight } from "../domain/practicalLights";
import type { AppMode, BasePlateAsset, BasePlateAssignmentMap, DiceSides, DiceTheme, GameMap, MapEntity, MaterialAsset, PracticalLightBehavior, PropAsset, SplatScenery, TokenAsset, Vec3, WorldSplatTileDescriptor, WorldSplatTileIndex } from "../domain/types";
import { getStoredSplatResponse } from "../persistence/splatAssets";
import { readWorldBinary } from "../persistence/worldAssets";
import { getStoredTokenModel } from "../persistence/tokenAssets";
import { getStoredPropModel } from "../persistence/propAssets";
import { applyLightingRig, applyLightProbeToEntity, applyLightweightAmbientToMaterial, createLightingRig, destroyLightingRig, rebuildDynamicLights, rebuildEnvironment, refreshVirtualizedDynamicLights, updateLightingRig, type LightingRig } from "../rendering/lightingEngine";
import { applyHobbyPaintFinish, applyMatteFloorFinish, applyMiniatureRimFinish, applyPropPhysicalProfile, applyScannedPbrMaps, applySceneReactiveMiniatureFinish, applyTabletopFinish, loadScannedPbrMaps, proceduralSurfaceForRole, tabletopFinishForRole, type PbrMaterialRole, type TabletopFinishProfile } from "../rendering/pbrAssetLibrary";
import { simulateDicePhysics, type DicePhysicsFrame } from "../rendering/dicePhysics";
import { createThemedDiceMaterial, loadDiceThemePbrTextures, updateThemedDiceMaterial, type DiceThemePbrTextures } from "../rendering/diceThemeMaterial";
import { createDiceParticleEmitter } from "../rendering/diceParticleSystem";
import { applyMaterialAsset } from "../rendering/customMaterialAsset";
import { materialProjectionForGeometry } from "../domain/materialProcessing";
import { groundModelOnBase, tokenBaseTop } from "../rendering/modelGrounding";
import { configureWorldTerrainMaterial, configureWorldVegetationMaterial, createBlobShadowMaterial, createFlameMaterial, createFlowingWaterMaterial, createFogOfWarMaterial, createFresnelSelectionMaterial, createProceduralPbrMaps, createResinDiceMaterial, createWindGrassMaterial, createWorldGridMaterial, type ProceduralSurface } from "../rendering/tabletopShaders";
import { useDisplaySettings } from "../state/useDisplaySettings";
import { renderBasePlate, type BasePlateRenderHandle } from "../rendering/basePlateRenderer";
import { claimSharedPlayCanvas, releaseSharedPlayCanvas } from "../rendering/sharedPlayCanvas";
import { chunkIdForPosition, computeWorldVisibility, lightInfluencesVisibleChunks, shouldRenderWorldEntity, WorldChunkStreamingController, type WorldVisibilitySet } from "../domain/worldChunks";
import { createHeightfield, sampleTerrainHeight, terrainNoise, terrainSurfaceWeights } from "../domain/worldProcedural";
import { VolumetricCloudEffect } from "../rendering/volumetricClouds";
import { createWorldGpuComputeRuntime, type WorldGpuComputeRuntime } from "../rendering/worldGpuCompute";
import { buildContinuousRiverSurface } from "../rendering/riverSurfaceMesh";
import { buildAssemblyMeshes, buildingAssemblyParts } from "../rendering/sceneAssemblyMesh";
const worldGeometrySources = new WeakMap<pc.Entity, MapEntity["worldGeometry"]>();
import { isInteriorMap } from "../domain/mapClassification";

const materialForGeometry = (asset: MaterialAsset | undefined, assetId: string): MaterialAsset | undefined => asset
  ? { ...asset, projection: materialProjectionForGeometry(assetId, asset.projection) }
  : undefined;

export interface SceneViewportProps {
  map: GameMap;
  tokenAssets: TokenAsset[];
  propAssets?: PropAsset[];
  materialAssets?: MaterialAsset[];
  basePlateAssets?: BasePlateAsset[];
  campaignBasePlateAssignments?: BasePlateAssignmentMap;
  sceneBasePlateAssignments?: BasePlateAssignmentMap;
  tokenCharacterLinks?: Record<string, string>;
  selectedEntityId: string | null;
  activeAssetId: string | null;
  showGrid: boolean;
  onPlace: (placement: PlacementResolution) => void;
  onSelect: (id: string | null) => void;
  onPipette: (assetId: string) => void;
  environmentPanorama?: File | null;
  diceThemes?: DiceTheme[];
  diceThemeAssignments?: Partial<Record<`d${DiceSides}`, string>>;
  mode?: AppMode;
  /** Token asset linked to the character whose turn/sheet is active. */
  focusAssetId?: string | null;
  /** Keep every draft chunk resident while the Forge frames the full region. */
  worldOverview?: boolean;
}

const cloudCoverageForMap = (map: GameMap): number => {
  const blueprint = map.generation?.blueprint;
  if (!map.world || isInteriorMap(map)) return 0;
  if (/storm|tempest|overcast|fog|mist/i.test(blueprint?.description ?? "")) return .7;
  if (blueprint?.biome.id === "desert") return .12;
  if (blueprint?.biome.id === "snow" || blueprint?.biome.id === "coast") return .55;
  return .4;
};

interface FogMaskState {
  mapId: string;
  width: number;
  depth: number;
  size: number;
  activeCanvas: HTMLCanvasElement;
  exploredCanvas: HTMLCanvasElement;
  outputCanvas: HTMLCanvasElement;
  activeContext: CanvasRenderingContext2D;
  exploredContext: CanvasRenderingContext2D;
  outputContext: CanvasRenderingContext2D;
  lastSignature: string;
  lastUpdatedAt: number;
}

interface RuntimeScene {
  disposed: boolean;
  app: pc.Application;
  camera: pc.Entity;
  lighting: LightingRig;
  contentRoot: pc.Entity;
  selectionRoot: pc.Entity;
  previewRoot: pc.Entity;
  diceRoot: pc.Entity;
  diceEffectsRoot: pc.Entity;
  objectRoots: Map<string, pc.Entity>;
  modelAssets: Map<string, pc.Asset>;
  splatAssets: Map<string, pc.Asset>;
  sceneryRoots: Map<string, pc.Entity>;
  materials: Map<string, pc.StandardMaterial>;
  surfaceMaps: Map<ProceduralSurface, ReturnType<typeof createProceduralPbrMaps>>;
  animatedMaterials: Set<pc.Material>;
  waterMaterials: Set<pc.StandardMaterial>;
  worldWaterMaterial: pc.ShaderMaterial;
  grassMaterials: Map<string, pc.StandardMaterial>;
  gridRoot: pc.Entity;
  gridMaterial: pc.ShaderMaterial | null;
  fogRoot: pc.Entity;
  fogTexture: pc.Texture | null;
  fogMaterial: pc.ShaderMaterial | null;
  fogMaskState: FogMaskState | null;
  fogExplorationCache: Map<string, ImageData>;
  selectionMaterial: pc.ShaderMaterial | null;
  blobShadowMaterial: pc.ShaderMaterial;
  spatialHash: SpatialHash<MapEntity>;
  ghost: pc.Entity | null;
  ghostAssetId: string | null;
  ghostMaterials: { valid: pc.StandardMaterial; invalid: pc.StandardMaterial; snapping: pc.StandardMaterial };
  placementAnimations: Map<string, { startedAt: number; target: Vec3 }>;
  dust: { entity: pc.Entity; velocity: pc.Vec3; startedAt: number }[];
  diceThrows: { entity: pc.Entity; material: pc.StandardMaterial; numberMaterials: pc.StandardMaterial[]; numberTextures: pc.Texture[]; value: number; frames: DicePhysicsFrame[]; duration: number; startedAt: number; settledAt: number | null; settledPosition: pc.Vec3 | null; theme?: DiceTheme; trailMaterial?: pc.StandardMaterial; particleTrail?: pc.Entity; trail: { entity: pc.Entity; bornAt: number }[]; lastTrailAt: number; impactTriggered: boolean }[];
  diceImpacts: { ring: pc.Entity; sparks: pc.Entity[]; particleBurst?: pc.Entity; material: pc.StandardMaterial; startedAt: number; duration: number; size: number; style: string }[];
  diceThrowGeneration: number;
  diceRollDetail: PresentedDiceRoll | null;
  diceMergeStartedAt: number | null;
  diceTotalRevealed: boolean;
  onDiceSum: (presentation: DiceSumPresentation | null) => void;
  mapBounds: { width: number; depth: number };
  terrainHeight: (x: number, z: number) => number;
  diceTaaSuspended: boolean;
  reducedMotion: boolean;
  orbit: { yaw: number; pitch: number; distance: number; target: pc.Vec3 };
  basePlateHandles: Map<string, BasePlateRenderHandle>;
  mode: AppMode;
  worldVisibility: WorldVisibilitySet | null;
  worldVisibilitySignature: string;
  lastWorldVisibilityAt: number;
  worldStreaming: WorldChunkStreamingController;
  worldOverview: boolean;
  volumetricClouds: VolumetricCloudEffect | null;
  cloudsAttached: boolean;
  worldCompute: WorldGpuComputeRuntime;
}

const syncVolumetricClouds = (runtime: RuntimeScene, map: GameMap): void => {
  const coverage = cloudCoverageForMap(map);
  const camera = runtime.camera.camera;
  const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
  // CameraFrame owns SceneColor and its command encoder. PlayCanvas' legacy
  // PostEffectQueue cannot be layered over it safely on WebGPU; doing so ends
  // the SceneColor pass early and invalidates the remainder of the frame.
  // CameraFrame worlds use their environment plus height atmosphere; the
  // raymarch fallback is reserved for the direct-forward camera path.
  const legacyPostEffectAllowed = !runtime.lighting.cameraFrameRequested;
  canvas.dataset.worldCloudRendering = coverage <= 0 ? "disabled" : legacyPostEffectAllowed ? "fullscreen-perlin-worley-raymarch+beer-lighting" : "camera-frame-atmosphere";
  if (!camera) return;
  if (coverage <= 0 || !legacyPostEffectAllowed) {
    if (runtime.volumetricClouds && runtime.cloudsAttached) {
      camera.postEffects.removeEffect(runtime.volumetricClouds);
      runtime.cloudsAttached = false;
    }
    return;
  }
  if (!runtime.volumetricClouds) runtime.volumetricClouds = new VolumetricCloudEffect(runtime.app.graphicsDevice, runtime.camera);
  runtime.volumetricClouds.setCoverage(coverage);
  if (!runtime.cloudsAttached) {
    camera.postEffects.addEffect(runtime.volumetricClouds);
    runtime.cloudsAttached = true;
  }
};

interface PresentedDiceRoll {
  expression: string;
  sides: number;
  rolls: number[];
  modifier: number;
  total: number;
  terms?: { sides: number; rolls: number[] }[];
}

interface DiceSumPresentation {
  expression: string;
  total: number;
  modifier: number;
  breakdown: string;
}

interface GhostState {
  raw: Vec3 | null;
  target: PlacementResolution | null;
  rotationY: number;
  lastValidation: number;
  snappingDisabled: boolean;
  wasSnapped: boolean;
  lastRay: { origin: Vec3; direction: Vec3 } | null;
}

const makeGhostMaterial = (color: string, emissive: string): pc.StandardMaterial => {
  const material = new pc.StandardMaterial();
  material.diffuse = toColor(color);
  material.emissive = toColor(emissive);
  material.emissiveIntensity = 1.6;
  material.opacity = .46;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.update();
  return material;
};

const syncScenery = async (runtime: RuntimeScene, map: GameMap): Promise<string | null> => {
  const rejectedLegacyWorlds = (map.scenery ?? []).filter((entry) => entry.enabled && entry.source === "splatkit" && (entry.splatCount ?? 0) < 80_000);
  const scenery = (map.scenery ?? []).filter((entry) => entry.enabled && !rejectedLegacyWorlds.includes(entry));
  const desired: Array<{ key: string; name: string; entry: SplatScenery; response: Response; filename: string; byteLength: number }> = [];
  const tileIsVisible = (entry: SplatScenery, tile: WorldSplatTileDescriptor): boolean => {
    if (!runtime.worldVisibility || !map.world) return true;
    const sourceCenter = new pc.Vec3((tile.bounds.min.x + tile.bounds.max.x) / 2, (tile.bounds.min.y + tile.bounds.max.y) / 2, (tile.bounds.min.z + tile.bounds.max.z) / 2);
    sourceCenter.mul(new pc.Vec3(entry.scale.x, entry.scale.y, entry.scale.z));
    const rotation = new pc.Quat().setFromEulerAngles(entry.rotation.x, entry.rotation.y, entry.rotation.z);
    rotation.transformVector(sourceCenter, sourceCenter);
    sourceCenter.add(new pc.Vec3(entry.position.x, entry.position.y, entry.position.z));
    const radius = Math.hypot(tile.bounds.max.x - tile.bounds.min.x, tile.bounds.max.z - tile.bounds.min.z) * Math.max(Math.abs(entry.scale.x), Math.abs(entry.scale.z)) / 2;
    const camera = runtime.camera.getPosition(), forward = runtime.orbit.target.clone().sub(camera), toTile = sourceCenter.clone().sub(camera);
    const facing = forward.lengthSq() < .001 || toTile.lengthSq() < .001 ? 1 : forward.normalize().dot(toTile.clone().normalize());
    return Math.hypot(sourceCenter.x - camera.x, sourceCenter.z - camera.z) <= map.world.chunkSize * 9 + radius && facing >= -.26;
  };
  for (const entry of scenery) {
    let tiled = false;
    if (entry.chunkIndexStorageKey) {
      const indexBlob = await readWorldBinary("splat-tile", entry.chunkIndexStorageKey);
      if (indexBlob) {
        try {
          const index = JSON.parse(await indexBlob.text()) as WorldSplatTileIndex;
          for (const tile of index.tiles.filter((candidate) => tileIsVisible(entry, candidate))) {
            const blob = await readWorldBinary("splat-tile", tile.storageKey);
            if (blob) desired.push({ key: `${entry.id}:${tile.id}`, name: `${entry.name} ${tile.id}`, entry, response: new Response(blob), filename: `${tile.id}.compressed.ply`, byteLength: tile.byteLength });
          }
          tiled = index.tiles.length > 0;
        } catch { /* Fall through to the original recoverable asset. */ }
      }
    }
    if (!tiled) {
      const response = await getStoredSplatResponse(entry.storageKey);
      if (!response) return `${entry.name} is not stored on this device. Re-import its ${entry.format.toUpperCase()} file.`;
      desired.push({ key: entry.id, name: entry.name, entry, response, filename: entry.filename, byteLength: entry.byteLength });
    }
  }
  const expected = new Set(desired.map((item) => item.key));
  for (const [id, root] of runtime.sceneryRoots) {
    if (!expected.has(id)) {
      root.destroy();
      runtime.sceneryRoots.delete(id);
      const asset = runtime.splatAssets.get(id);
      if (asset) {
        asset.unload();
        runtime.app.assets.remove(asset);
        runtime.splatAssets.delete(id);
      }
    }
  }
  for (const item of desired) {
    const { entry } = item;
    let root = runtime.sceneryRoots.get(item.key);
    if (!root) {
      const concurrentlyCreated = runtime.sceneryRoots.get(item.key);
      if (concurrentlyCreated) {
        root = concurrentlyCreated;
        continue;
      }
      root = new pc.Entity(item.name);
      root.tags.add("presentation-scenery", item.key);
      runtime.contentRoot.addChild(root);
      runtime.sceneryRoots.set(item.key, root);
      const extension = item.filename.endsWith(".sog") ? "sog" : "ply";
      const asset = new pc.Asset(item.name, "gsplat", {
        url: `memory://dndrom/${item.key}.${extension}`,
        filename: item.filename,
        size: item.byteLength,
        // PlayCanvas' runtime PLY parser accepts a Response here; its AssetFile
        // declaration still types `contents` as ArrayBuffer.
        contents: item.response as unknown as ArrayBuffer,
      });
      runtime.splatAssets.set(item.key, asset);
      runtime.app.assets.add(asset);
      root.addComponent("gsplat", { asset });
      runtime.app.assets.load(asset);
    }
    root.enabled = entry.enabled;
    const transform = entry;
    root.setPosition(transform.position.x, transform.position.y, transform.position.z);
    root.setEulerAngles(transform.rotation.x, transform.rotation.y, transform.rotation.z);
    root.setLocalScale(transform.scale.x, transform.scale.y, transform.scale.z);
  }
  return rejectedLegacyWorlds.length
    ? `${rejectedLegacyWorlds.length === 1 ? rejectedLegacyWorlds[0].name : `${rejectedLegacyWorlds.length} generated worlds`} was hidden because it does not meet the playable-scene quality floor. Retry reconstruction to replace it; the saved source remains recoverable.`
    : null;
};

const toColor = (hex: string): pc.Color => {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized.length === 3 ? normalized.split("").map((entry) => entry + entry).join("") : normalized, 16);
  return new pc.Color(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
};

const materialFor = (runtime: RuntimeScene, color: string, emissive?: string, role: PbrMaterialRole = "plain", finish: TabletopFinishProfile | null = null, cacheVariant = ""): pc.StandardMaterial => {
  const key = `${color}:${emissive ?? ""}:${role}:${finish ?? "raw"}:${cacheVariant}`;
  const existing = runtime.materials.get(key);
  if (existing) return existing;
  const material = new pc.StandardMaterial();
  material.diffuse = toColor(color);
  const darkMetal = /^#(?:[0-5][0-9a-f]){3}$/i.test(color);
  material.metalness = darkMetal ? .22 : .03;
  material.gloss = emissive ? .68 : darkMetal ? .48 : .3;
  material.fresnelModel = pc.FRESNEL_SCHLICK;
  material.specular = darkMetal ? new pc.Color(.72, .7, .66) : new pc.Color(.22, .22, .22);
  material.useMetalness = true;
  let hobbySpecialty: pc.Texture | null = null;
  if (role !== "plain" && role !== "water") {
    const surface = proceduralSurfaceForRole(role);
    let maps = runtime.surfaceMaps.get(surface);
    if (!maps) {
      maps = createProceduralPbrMaps(runtime.app, surface);
      runtime.surfaceMaps.set(surface, maps);
    }
    hobbySpecialty = maps.specialty;
    material.diffuseMap = maps.albedo;
    material.normalMap = maps.normal;
    material.aoMap = maps.orm;
    material.aoMapChannel = "r";
    material.glossMap = maps.orm;
    material.glossMapChannel = "g";
    material.gloss = 1;
    material.glossInvert = true;
    material.metalnessMap = maps.orm;
    material.metalnessMapChannel = "b";
    material.heightMap = maps.height;
    material.heightMapChannel = "r";
    material.heightMapFactor = surface === "stone" ? .035 : surface === "wood" ? .022 : .012;
    material.occludeSpecular = pc.SPECOCC_AO;
    material.occludeSpecularIntensity = .72;
    material.bumpiness = surface === "stone" ? .58 : surface === "wood" ? .42 : surface === "fabric" ? .35 : .24;
    // ORM green stores roughness and is inverted by StandardMaterial; keep the
    // scalar at one so the packed texture remains authoritative.
    material.gloss = 1;
    material.metalness = surface === "metal" ? .92 : .02;
    if (surface === "wood") {
      material.clearCoat = .16;
      material.clearCoatGloss = .58;
    }
    if (surface === "flesh") {
      material.sheen = toColor("#6f332d");
      material.clearCoat = .05;
      material.clearCoatGloss = .48;
    }
    // A photographed ground tile contains recognizable debris and cannot be
    // stamped across a generated region. World terrain keeps the seamless
    // procedural macro/detail maps and vertex field weights instead.
    if (!cacheVariant.startsWith("world-terrain") && !cacheVariant.startsWith("world-bridge") && !cacheVariant.startsWith("world-rock") && !cacheVariant.startsWith("world-interior") && !cacheVariant.startsWith("world-assembly")) void loadScannedPbrMaps(runtime.app, role).then((scanned) => {
      if (scanned && !runtime.disposed && runtime.app.graphicsDevice && runtime.materials.get(key) === material) {
        applyScannedPbrMaps(material, role, scanned);
        if (finish) applyTabletopFinish(material, finish);
        applyPropPhysicalProfile(material, role);
        if (role.endsWith("floor")) applyMatteFloorFinish(material);
        applyLightweightAmbientToMaterial(runtime.lighting, material);
        if (finish === "painted-miniature") {
          applyHobbyPaintFinish(material, hobbySpecialty);
          applyMiniatureRimFinish(material);
        }
        const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
        const loaded = new Set((canvas.dataset.scannedPbr ?? "").split(",").filter(Boolean));
        loaded.add(role);
        canvas.dataset.scannedPbr = [...loaded].sort().join(",");
      }
    });
  }
  if (role === "water") {
    let waterMaps = runtime.surfaceMaps.get("water");
    if (!waterMaps) { waterMaps = createProceduralPbrMaps(runtime.app, "water"); runtime.surfaceMaps.set("water", waterMaps); }
    material.normalMap = waterMaps.normal;
    material.normalMapTiling.set(1.8, 1.8);
    material.bumpiness = .38;
    material.metalness = 0;
    material.gloss = .7;
    material.clearCoat = .38;
    material.clearCoatGloss = .76;
    material.opacity = .84;
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = false;
    material.cull = pc.CULLFACE_NONE;
    // Keep the broad sunlight response readable at an overhead tabletop angle;
    // a mirror-like clear coat becomes a map-sized white hotspot.
    material.specular = new pc.Color(.14, .23, .27);
    runtime.waterMaterials.add(material);
  } else if (role === "foliage") {
    material.sheen = toColor(color);
  } else if (role === "leather") {
    material.clearCoat = .08;
    material.clearCoatGloss = .32;
  }
  if (emissive) {
    material.emissive = toColor(emissive);
    material.emissiveIntensity = 3;
  }
  if (finish) applyTabletopFinish(material, finish);
  applyPropPhysicalProfile(material, role);
  if (role.endsWith("floor")) applyMatteFloorFinish(material);
  applyLightweightAmbientToMaterial(runtime.lighting, material);
  if (finish === "painted-miniature") {
    applyHobbyPaintFinish(material, hobbySpecialty);
    applyMiniatureRimFinish(material);
  }
  material.update();
  runtime.materials.set(key, material);
  return material;
};

export const inferMaterialRole = (asset: AssetDefinition, definition: AssetPart, partIndex: number): PbrMaterialRole => {
  if (definition.surface) return definition.surface === "wood" ? "wood-structural" : definition.surface === "stone" ? "stone-natural" : definition.surface;
  const id = asset.id.toLowerCase();
  if (id === "water-tile") return "water";
  if (id === "floor-wood") return "wood-floor";
  if (id === "floor-stone") return "stone-floor";
  if (id === "floor-grass") return "grass";
  if (id === "road-dirt") return "earth";
  if (id === "wall-stone") return "stone-wall";
  if (id === "wall-wood") return partIndex === 0 ? "plaster" : "wood-structural";
  if (id === "bridge-stone") return partIndex === 0 ? "stone-floor" : "stone-wall";
  if (id === "pillar") return "stone-wall";
  if (id === "rock") return "stone-natural";
  if (id === "house-small" || id === "house-large") return partIndex === 0 ? "plaster" : partIndex === 1 ? "roof" : "wood-structural";
  if (id === "tree-dead") return "bark";
  if (id.startsWith("tree-broadleaf")) return partIndex <= (id.endsWith("young") ? 0 : 2) ? "bark" : "foliage";
  if (id === "tree-cypress") return partIndex <= 1 ? "bark" : "foliage";
  if (id.startsWith("tree-pine")) return partIndex === 0 ? "bark" : "foliage";
  if (id === "shrub-broadleaf" || id === "reeds-wetland") return "foliage";
  if (id === "table-round" || id === "table-long") return "wood-table";
  if (id === "chair") return "wood-chair";
  if (id === "crate") return "wood-crate";
  if (id === "market-stall") return partIndex === 1 ? "fabric" : "wood-crate";
  if (id === "barrel") return partIndex > 0 ? "metal" : "wood-barrel";
  if (id === "chest") return partIndex === 2 ? "metal" : "wood-chest";
  if (id === "door-wood") return partIndex === 3 ? "metal" : "wood-structural";
  if (id.startsWith("token-")) {
    if (partIndex === 0) return "metal";
    if (/#(?:d0a37e|be8f6c|536b43|718755)/i.test(definition.color)) return "flesh";
    return "fabric";
  }
  if (/table|chair|crate|furniture/.test(`${id} ${asset.category}`)) return "wood-furniture";
  if (/door|fence|torch|campfire/.test(id)) return "wood-structural";
  if (id === "poi-beacon") return partIndex === 0 ? "stone-natural" : "metal";
  if (asset.category === "nature") return "foliage";
  return "plain";
};

const addPart = (runtime: RuntimeScene, parent: pc.Entity, asset: AssetDefinition, definition: AssetPart, partIndex: number): void => {
  const child = new pc.Entity();
  child.addComponent("render", { type: definition.primitive });
  child.setLocalPosition(definition.position.x, definition.position.y, definition.position.z);
  child.setLocalScale(definition.scale.x, definition.scale.y, definition.scale.z);
  if (definition.rotation) child.setLocalEulerAngles(definition.rotation.x, definition.rotation.y, definition.rotation.z);
  if (child.render) {
    if (definition.shader === "flame") {
      const material = createFlameMaterial([1, .22, .035], [1, .92, .34]);
      child.render.material = material;
      runtime.animatedMaterials.add(material);
    } else if (definition.shader === "resin") {
      const color = toColor(definition.color);
      const resinMaterial = createResinDiceMaterial([color.r, color.g, color.b], runtime.app.graphicsDevice);
      applyLightweightAmbientToMaterial(runtime.lighting, resinMaterial);
      child.render.material = resinMaterial;
    } else {
      const role = inferMaterialRole(asset, definition, partIndex);
      const worldStructure = asset.id.startsWith("bridge-") || parent.tags.has("world:bridge");
      const worldRock = asset.id === "rock" && parent.tags.has("world:vegetation");
      const worldInterior = parent.tags.has("world:interior") || parent.tags.has("scene:interior");
      const partMaterial = materialFor(
        runtime,
        definition.color,
        definition.emissive,
        role,
        asset.id.startsWith("token-") ? "painted-miniature" : worldStructure || worldRock || worldInterior ? null : tabletopFinishForRole(role),
        worldStructure ? `world-bridge-${role}` : worldRock ? `world-rock-${parent.tags.has("biome:desert") ? "desert" : "natural"}` : worldInterior ? `world-interior-${role}` : undefined,
      );
      if (worldInterior) {
        // BSP primitives are scaled to room dimensions after construction.
        // Their stock 0..1 UVs stretch a photographed scan across an entire
        // floor or wall, producing the giant glossy arcs seen in taverns.
        // Use authored albedo plus a repeating micro-normal only; no parallax,
        // ORM gloss, or clear coat is allowed on generated room shells.
        partMaterial.diffuseMap = null;
        partMaterial.aoMap = null;
        partMaterial.glossMap = null;
        partMaterial.metalnessMap = null;
        partMaterial.heightMap = null;
        partMaterial.normalMapTiling.set(3.5, 3.5);
        partMaterial.bumpiness = role.includes("wood") ? .22 : .16;
        partMaterial.clearCoat = 0;
        partMaterial.clearCoatGloss = 0;
        partMaterial.glossInvert = false;
        partMaterial.gloss = role.endsWith("floor") ? .11 : .08;
        partMaterial.metalness = 0;
        partMaterial.specular = new pc.Color(.11, .11, .1);
        partMaterial.update();
      }
      if (worldStructure) {
        // Bridges sit directly above dark water and their deck, rails, and
        // supports heavily self-shadow. Preserve a small diffuse-like ambient
        // bounce so the crossing remains readable from the tabletop camera;
        // the value is deliberately well below the authored albedo so direct
        // light and cast/received shadows still shape the structure.
        const authored = toColor(definition.color);
        // At this scale a tiled scan is mostly dark texels and the closely
        // packed planks self-occlude. Use authored bridge color plus a normal
        // response; terrain receives the bridge's shadow, while the bridge
        // avoids sampling its own low-resolution shadow map.
        partMaterial.diffuseMap = null;
        partMaterial.aoMap = null;
        partMaterial.glossMap = null;
        partMaterial.metalnessMap = null;
        partMaterial.heightMap = null;
        partMaterial.diffuse = authored;
        partMaterial.metalness = 0;
        partMaterial.gloss = asset.id === "bridge-wood" ? .24 : .36;
        partMaterial.emissive = authored;
        partMaterial.emissiveIntensity = asset.id === "bridge-wood" ? .13 : .09;
        partMaterial.update();
      }
      if (worldRock) {
        const authored = parent.tags.has("biome:desert") ? toColor("#8e704e") : toColor(definition.color);
        partMaterial.diffuseMap = null;
        partMaterial.aoMap = null;
        partMaterial.diffuse = authored;
        partMaterial.metalness = 0;
        partMaterial.gloss = .16;
        partMaterial.emissive = authored;
        partMaterial.emissiveIntensity = .28;
        partMaterial.update();
      }
      child.render.material = partMaterial;
    }
    const isGroundLayer = /^(floor-|road-|water-)/.test(asset.id);
    child.render.castShadows = definition.shader !== "flame" && !isGroundLayer;
    child.render.receiveShadows = !asset.id.startsWith("bridge-") && asset.id !== "rock";
  }
  parent.addChild(child);
};

const createFallback = (runtime: RuntimeScene, parent: pc.Entity, definition: AssetDefinition): void => {
  const child = new pc.Entity();
  child.addComponent("render", { type: "box" });
  child.setLocalPosition(0, 0.5, 0);
  child.setLocalScale(definition.footprint, 1, definition.footprint);
  if (child.render) child.render.material = materialFor(runtime, "#805b89", undefined, "plain", "painted-piece");
  parent.addChild(child);
};

interface ProceduralMeshBuffers {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  uvs?: number[];
}

const meshColor = (hex: string, shade = 1, gamma = 2.2): [number, number, number, number] => {
  const color = toColor(hex);
  // StandardMaterial consumes vertex colors as linear values. Convert the
  // authored sRGB palette so daylight preserves mid-tone paint and timber.
  const linear = (channel: number) => Math.pow(Math.max(0, Math.min(1, channel * shade)), gamma);
  return [Math.round(linear(color.r) * 255), Math.round(linear(color.g) * 255), Math.round(linear(color.b) * 255), 255];
};

const appendColor = (target: number[], color: [number, number, number, number], count: number): void => {
  for (let index = 0; index < count; index++) target.push(...color);
};

const appendQuad = (buffers: ProceduralMeshBuffers, a: pc.Vec3, b: pc.Vec3, c: pc.Vec3, d: pc.Vec3, color: [number, number, number, number]): void => {
  const base = buffers.positions.length / 3;
  const normal = new pc.Vec3().cross(new pc.Vec3().sub2(b, a), new pc.Vec3().sub2(c, a)).normalize();
  for (const point of [a, b, c, d]) buffers.positions.push(point.x, point.y, point.z);
  for (let index = 0; index < 4; index++) buffers.normals.push(normal.x, normal.y, normal.z);
  appendColor(buffers.colors, color, 4);
  buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
};

const appendTriangle = (buffers: ProceduralMeshBuffers, a: pc.Vec3, b: pc.Vec3, c: pc.Vec3, color: [number, number, number, number]): void => {
  const base = buffers.positions.length / 3;
  const normal = new pc.Vec3().cross(new pc.Vec3().sub2(b, a), new pc.Vec3().sub2(c, a)).normalize();
  for (const point of [a, b, c]) buffers.positions.push(point.x, point.y, point.z);
  for (let index = 0; index < 3; index++) buffers.normals.push(normal.x, normal.y, normal.z);
  appendColor(buffers.colors, color, 3);
  buffers.indices.push(base, base + 1, base + 2);
};

const appendOrientedBox = (buffers: ProceduralMeshBuffers, center: pc.Vec3, tangent: pc.Vec3, outward: pc.Vec3, width: number, height: number, depth: number, color: [number, number, number, number]): void => {
  const t = tangent.clone().normalize().mulScalar(width / 2), n = outward.clone().normalize().mulScalar(depth / 2), y = height / 2;
  const point = (tx: number, ny: number, oy: number) => center.clone().add(t.clone().mulScalar(tx)).add(n.clone().mulScalar(ny)).add(new pc.Vec3(0, oy * y, 0));
  const p000 = point(-1, -1, -1), p100 = point(1, -1, -1), p110 = point(1, 1, -1), p010 = point(-1, 1, -1);
  const p001 = point(-1, -1, 1), p101 = point(1, -1, 1), p111 = point(1, 1, 1), p011 = point(-1, 1, 1);
  appendQuad(buffers, p001, p101, p111, p011, color);
  appendQuad(buffers, p100, p000, p010, p110, color);
  appendQuad(buffers, p000, p001, p011, p010, color);
  appendQuad(buffers, p101, p100, p110, p111, color);
  appendQuad(buffers, p010, p011, p111, p110, color);
  appendQuad(buffers, p000, p100, p101, p001, color);
};

const appendEllipsoid = (buffers: ProceduralMeshBuffers, center: pc.Vec3, radius: pc.Vec3, color: [number, number, number, number], phase: number, segments: number, rings: number): void => {
  const base = buffers.positions.length / 3;
  for (let ring = 0; ring <= rings; ring++) {
    const latitude = ring / rings * Math.PI;
    for (let segment = 0; segment < segments; segment++) {
      const longitude = segment / segments * Math.PI * 2;
      const irregular = .83 + .17 * Math.sin(phase * 31.7 + segment * 2.17 + ring * 3.11);
      const sphere = new pc.Vec3(Math.cos(longitude) * Math.sin(latitude), Math.cos(latitude), Math.sin(longitude) * Math.sin(latitude));
      // An ellipsoid normal is the inverse-transpose of its scaled sphere
      // normal, not the original sphere vector.
      const normal = new pc.Vec3(sphere.x / Math.max(.001, radius.x), sphere.y / Math.max(.001, radius.y), sphere.z / Math.max(.001, radius.z)).normalize();
      buffers.positions.push(center.x + sphere.x * radius.x * irregular, center.y + sphere.y * radius.y * irregular, center.z + sphere.z * radius.z * irregular);
      buffers.normals.push(normal.x, normal.y, normal.z);
      buffers.uvs?.push(segment / segments, ring / rings);
    }
  }
  appendColor(buffers.colors, color, (rings + 1) * segments);
  for (let ring = 0; ring < rings; ring++) for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments, a = base + ring * segments + segment, b = base + ring * segments + next, c = a + segments, d = b + segments;
    // Outward counter-clockwise winding. With the inverse order every visible
    // canopy triangle was a backface and two-sided lighting flipped its normal.
    buffers.indices.push(a, b, c, b, d, c);
  }
};

const finishProceduralMesh = (runtime: RuntimeScene, parent: pc.Entity, buffers: ProceduralMeshBuffers, material: pc.Material, name: string, castShadows = true): void => {
  if (!buffers.indices.length) return;
  const mesh = new pc.Mesh(runtime.app.graphicsDevice);
  mesh.setPositions(buffers.positions); mesh.setNormals(buffers.normals); if (buffers.uvs?.length === buffers.positions.length / 3 * 2) mesh.setUvs(0, buffers.uvs); mesh.setColors32(buffers.colors); mesh.setIndices(buffers.indices);
  if (buffers.uvs?.length === buffers.positions.length / 3 * 2) mesh.setVertexStream(pc.SEMANTIC_TANGENT, pc.calculateTangents(buffers.positions, buffers.normals, buffers.uvs, buffers.indices), 4);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const child = new pc.Entity(name);
  child.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows, receiveShadows: true });
  parent.addChild(child);
};

const addCgaBuilding = (runtime: RuntimeScene, parent: pc.Entity, mapEntity: MapEntity): void => {
  const geometry = mapEntity.worldGeometry;
  if (geometry?.kind !== "cga-building" && geometry?.kind !== "assembly") return;
  const lod = mapEntity.chunkId ? runtime.worldStreaming.residentLod(mapEntity.chunkId) ?? runtime.worldVisibility?.lodByChunkId.get(mapEntity.chunkId) ?? 0 : 0;
  const parts = geometry.kind === "assembly" ? geometry.parts : buildingAssemblyParts(geometry);
  const roles = { ground: "earth", masonry: "stone-wall", timber: "wood-structural", roof: "roof", foliage: "foliage" } as const;
  for (const [role, buffers] of buildAssemblyMeshes(parts, lod)) {
    const material = materialFor(runtime, "#ffffff", undefined, roles[role], "printed-board", `world-assembly-${role}`);
    material.diffuseVertexColor = true; material.cull = pc.CULLFACE_NONE;
    material.heightMap = null; material.heightMapFactor = 0;
    material.update();
    finishProceduralMesh(runtime, parent, buffers, material, `${mapEntity.name} ${role} LOD ${lod}`);
    parent.children[parent.children.length - 1].tags.add(`world-material:${role}`);
  }
  parent.tags.add(`world-lod:${lod}`);
};

const treePrototypes = new Map<string, ReturnType<typeof generateSpaceColonizedTree>>();
const forestMeshes = new WeakMap<pc.Application, Map<string, Array<{mesh:pc.Mesh;material:pc.Material}>>>();

const addSpaceColonizedTree = (runtime: RuntimeScene, parent: pc.Entity, mapEntity: MapEntity, forcedLod?:0|1|2): void => {
  if (mapEntity.worldGeometry?.kind !== "space-colonized-tree") return;
  const stored = mapEntity.worldGeometry;
  const prototypeKey = stored.prototypeSeed === undefined ? "" : stored.style + ":" + stored.prototypeSeed;
  let geometry = prototypeKey ? treePrototypes.get(prototypeKey) : stored;
  if (!geometry) { geometry = generateSpaceColonizedTree(stored.prototypeSeed!, stored.style); if (treePrototypes.size > 128) treePrototypes.clear(); treePrototypes.set(prototypeKey, geometry); }
  const lod = forcedLod ?? (mapEntity.chunkId ? runtime.worldStreaming.residentLod(mapEntity.chunkId) ?? runtime.worldVisibility?.lodByChunkId.get(mapEntity.chunkId) ?? 0 : 0);
  let cache = forestMeshes.get(runtime.app);
  if (!cache) { cache = new Map(); forestMeshes.set(runtime.app, cache); const owned = cache; runtime.app.once("destroy", () => { for (const meshes of owned.values()) for (const {mesh} of meshes) { mesh.decRefCount(); if (mesh.refCount < 1) mesh.destroy(); } owned.clear(); }); }
  const cacheKey = prototypeKey + ":" + lod;
  const cached = prototypeKey ? cache.get(cacheKey) : undefined;
  const barkMaterial = materialFor(runtime, "#ffffff", undefined, "bark", null, "world-space-colonized-bark");
  const leafKey = `botanical-leaves:${geometry.style}`;
  let leafMaterial = runtime.materials.get(leafKey);
  if (!leafMaterial) {
    leafMaterial = new pc.StandardMaterial();
    const texture = treeFoliageTexture(runtime.app.graphicsDevice, geometry.style);
    leafMaterial.diffuseMap = texture; leafMaterial.opacityMap = texture; leafMaterial.opacityMapChannel = "a";
    leafMaterial.alphaTest = 90 / 255; leafMaterial.diffuseVertexColor = true;
    leafMaterial.cull = pc.CULLFACE_NONE; leafMaterial.twoSidedLighting = true;
    configureWorldVegetationMaterial(leafMaterial); runtime.animatedMaterials.add(leafMaterial);
    runtime.materials.set(leafKey, leafMaterial);
  }
  if (cached) {
    cached.forEach(({mesh,material}) => { const child = new pc.Entity("Instanced tree"); child.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: lod < 2, receiveShadows: true }); parent.addChild(child); });
  } else {
  if (lod === 2) {
    const impostor = buildTreeImpostor(runtime.app.graphicsDevice, geometry);
    finishProceduralMesh(runtime,parent,impostor.buffers,impostor.material,`${mapEntity.name} crown impostor`,false);
  } else {
  // Bark maps already contain their albedo. Multiplying them by dark brown
  // vertex albedo made trunks nearly black and hid their surface detail.
  const barkBuffers = buildTreeBarkMesh(geometry, lod, [255, 255, 255, 255]);
  const leafBuffers: ProceduralMeshBuffers = { positions: [], normals: [], colors: [], indices: [], uvs: [] };
  // Keep every crown region at all tree LODs; reduce samples inside each region.
  const clusters = geometry.leafClusters;
  clusters.forEach((cluster, index) => {
    const leaves = lod === 0 ? 40 : lod === 1 ? 20 : 10;
    const random = (i:number,k:number) => { const v=Math.sin((index*137+i*71+k*31+cluster.phase)*12.9898)*43758.5453;return v-Math.floor(v); };
    for(let leaf=0;leaf<leaves;leaf++) {
      const azimuth=random(leaf,0)*Math.PI*2, elevation=random(leaf,1)*2-1, radial=Math.sqrt(1-elevation*elevation);
      const center=new pc.Vec3(cluster.position.x+Math.cos(azimuth)*radial*cluster.radius.x*.8,cluster.position.y+elevation*cluster.radius.y*.8,cluster.position.z+Math.sin(azimuth)*radial*cluster.radius.z*.8);
      const evergreen = geometry.style === "pine" || geometry.style === "cypress";
      const length=(evergreen ? .48 : .3)*Math.sqrt(40/leaves)*( .75+random(leaf,2)*.65);
      const direction=new pc.Vec3(Math.cos(azimuth),.2+random(leaf,3)*.55,Math.sin(azimuth)).normalize();
      const side=new pc.Vec3(-Math.sin(azimuth),0,Math.cos(azimuth)).mulScalar(length*(evergreen ? .72 : .58));
      const tip=direction.clone().mulScalar(length),base=leafBuffers.positions.length/3;
      const points=[center.clone().sub(tip).sub(side),center.clone().sub(tip).add(side),center.clone().add(tip).sub(side),center.clone().add(tip).add(side)];
      const color=meshColor(geometry.leafColors[(index+leaf)%2],.7+random(leaf,4)*.35,1.45);
      const leafNormal = new pc.Vec3().cross(side, direction).normalize();
      points.forEach((p,i)=>{leafBuffers.positions.push(p.x,p.y,p.z);leafBuffers.normals.push(leafNormal.x,leafNormal.y,leafNormal.z);leafBuffers.uvs!.push(i%2,i<2?0:1);leafBuffers.colors.push(...color);});
      leafBuffers.indices.push(base,base+1,base+2,base+1,base+3,base+2);
    }
  });

  barkMaterial.diffuseVertexColor = true; barkMaterial.clearCoat = 0; barkMaterial.gloss = .08;
  leafMaterial.diffuseVertexColor = true; leafMaterial.clearCoat = 0; leafMaterial.gloss = .06; leafMaterial.cull = pc.CULLFACE_NONE; leafMaterial.twoSidedLighting = true;
  for (const material of [barkMaterial, leafMaterial]) {
    if (!runtime.animatedMaterials.has(material)) { configureWorldVegetationMaterial(material, material === barkMaterial); runtime.animatedMaterials.add(material); } else material.update();
  }
  finishProceduralMesh(runtime, parent, barkBuffers, barkMaterial, `${mapEntity.name} bark LOD ${lod}`, lod < 2);
  finishProceduralMesh(runtime, parent, leafBuffers, leafMaterial, `${mapEntity.name} leaves LOD ${lod}`, lod < 2);
  }
  if (prototypeKey) { const meshes = (parent.findComponents("render") as pc.RenderComponent[]).flatMap(render => render.meshInstances.map(instance => ({mesh:instance.mesh,material:instance.material}))); meshes.forEach(({mesh}) => mesh.incRefCount()); cache.set(cacheKey, meshes);
    while(cache.size>96){const oldest=cache.keys().next().value!;const obsolete=cache.get(oldest)!;cache.delete(oldest);for(const {mesh} of obsolete){mesh.decRefCount();if(mesh.refCount<1)mesh.destroy();}} }
  }
  if (stored.instances?.length) {
    const matrices = new Float32Array(stored.instances.length * 16), transform = new pc.Mat4(), rotation = new pc.Quat();
    const bounds = new pc.BoundingBox(), transformed = new pc.BoundingBox(); let first = true;
    stored.instances.forEach((placement, index) => {
      transform.setTRS(new pc.Vec3(placement.x - mapEntity.position.x, placement.y - mapEntity.position.y, placement.z - mapEntity.position.z), rotation.setFromEulerAngles(0, placement.rotation, 0), new pc.Vec3(placement.scale, placement.scale, placement.scale)); matrices.set(transform.data, index * 16);
      for (const render of parent.findComponents("render") as pc.RenderComponent[]) for (const instance of render.meshInstances) { transformed.setFromTransformedAabb(instance.mesh.aabb, transform); if (first) { bounds.copy(transformed); first = false; } else bounds.add(transformed); }
    });
    bounds.halfExtents.addScalar(1);
    const buffer = new pc.VertexBuffer(runtime.app.graphicsDevice, pc.VertexFormat.getDefaultInstancingFormat(runtime.app.graphicsDevice), stored.instances.length, { data: matrices.buffer });
    parent.once("destroy", () => buffer.destroy());
    for (const render of parent.findComponents("render") as pc.RenderComponent[]) for (const instance of render.meshInstances) { instance.setInstancing(buffer, true); instance.setCustomAabb(bounds); }
  }
  parent.children.forEach((child) => child.tags.add(child.name.includes("bark") ? "world-material:timber" : "world-material:foliage"));
  parent.tags.add(`world-lod:${lod}`);
};

const syncWorldLandscape = (runtime:RuntimeScene,map:GameMap):void => {
  syncWorldHorizon(runtime.app,runtime.camera,map,runtime.lighting.key,(parent,plants,lod,grass)=>{
    if(grass.length){
      const position=parent.getPosition(),instances=[];
      for(let i=0;i<grass.length;i+=5)instances.push({x:grass[i],y:grass[i+1],z:grass[i+2],rotation:grass[i+3],scale:grass[i+4]});
      const batch=new pc.Entity("Regional meadow");parent.addChild(batch);
      addProceduralGeometry(runtime,batch,{id:"atlas-grass",assetId:"shrub-broadleaf",name:"Regional meadow",position:{x:position.x,y:0,z:position.z},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},worldGeometry:{kind:"ground-cover",color:"#527d3e",instances}});
    }
    for(const species of [0,1]){
      const placements:NonNullable<import("../domain/types").WorldTreeGeometry["instances"]>=[];
      for(let i=0;i<plants.length;i+=6)if(plants[i+5]===species)placements.push({x:plants[i],y:plants[i+1],z:plants[i+2],rotation:plants[i+3],scale:plants[i+4]});
      if(!placements.length)continue;
      const style=species?"pine":"broadleaf",position=parent.getPosition();
      const entity:MapEntity={id:'atlas-forest',assetId:'tree-broadleaf',name:'Regional forest',position:{x:position.x,y:0,z:position.z},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},worldGeometry:{kind:'space-colonized-tree',style,prototypeSeed:(map.world?.seed??1)+species*7919,instances:placements,branches:[],leafClusters:[],barkColor:'#493b29',leafColors:['#3d632c','#52783b']}};
      const batch=new pc.Entity('Canopy family');parent.addChild(batch);addSpaceColonizedTree(runtime,batch,entity,lod);
    }
  });
};

const addProceduralGeometry = (runtime: RuntimeScene, parent: pc.Entity, mapEntity: MapEntity, _definition?: AssetDefinition): void => {
  if (!mapEntity.worldGeometry) return;
  const lod = mapEntity.chunkId ? runtime.worldStreaming.residentLod(mapEntity.chunkId) ?? runtime.worldVisibility?.lodByChunkId.get(mapEntity.chunkId) ?? 0 : 0;
  if (mapEntity.worldGeometry.kind === "cga-building" || mapEntity.worldGeometry.kind === "assembly") { addCgaBuilding(runtime, parent, mapEntity); return; }
  if (mapEntity.worldGeometry.kind === "space-colonized-tree") { addSpaceColonizedTree(runtime, parent, mapEntity); return; }
  if (mapEntity.worldGeometry.kind === "road-ribbon" || mapEntity.worldGeometry.kind === "river-ribbon") {
    const geometry = mapEntity.worldGeometry;
    if (geometry.kind === "river-ribbon") {
      const buffers = buildContinuousRiverSurface(geometry.paths, mapEntity.position, geometry.bankDepth);
      if (!buffers.indices.length) return;
      const mesh = new pc.Mesh(runtime.app.graphicsDevice);
      mesh.setPositions(buffers.positions); mesh.setNormals(buffers.normals); mesh.setUvs(0, buffers.uvs); mesh.setColors32(buffers.colors); mesh.setIndices(buffers.indices); mesh.update(pc.PRIMITIVE_TRIANGLES);
      const child = new pc.Entity(`${mapEntity.name} continuous water LOD ${lod}`);
      child.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, runtime.worldWaterMaterial)], castShadows: false, receiveShadows: true });
      parent.tags.add(`world-lod:${lod}`); parent.addChild(child);
      return;
    }
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
    for (const path of geometry.paths) {
      if (path.length < 2) continue;
      let distance = 0;
      const base = positions.length / 3;
      for (let index = 0; index < path.length; index++) {
        const point = path[index], previous = path[Math.max(0, index - 1)], next = path[Math.min(path.length - 1, index + 1)];
        const dx = next.x - previous.x, dz = next.z - previous.z, length = Math.max(.0001, Math.hypot(dx, dz));
        const sideX = -dz / length * point.width * .5, sideZ = dx / length * point.width * .5;
        if (index) distance += Math.hypot(point.x - path[index - 1].x, point.z - path[index - 1].z);
        // Roads use a feathered six-column decal rather than one hard quad per
        // path segment. The center pair keeps wheel-worn variation while the
        // transparent shoulders visually dissolve into triplanar terrain.
        const strips = [-1, -.76, -.2, .2, .76, 1];
        for (const strip of strips) {
          positions.push(point.x - mapEntity.position.x + sideX * strip, point.y - mapEntity.position.y, point.z - mapEntity.position.z + sideZ * strip);
          normals.push(0, 1, 0);
          uvs.push((strip + 1) * .5, distance / 3);
          const edge = Math.abs(strip), wear = .84 + .12 * Math.sin(distance * .41 + point.x * .17 - point.z * .13);
          const base = geometry.surface === "stone" ? [116, 113, 104] : geometry.surface === "wood" ? [111, 76, 46] : [116, 80, 47];
          const alpha = edge >= .999 ? 0 : edge > .7 ? 150 : 245;
          colors.push(Math.round(base[0] * wear), Math.round(base[1] * wear), Math.round(base[2] * wear), alpha);
        }
      }
      for (let index = 0; index < path.length - 1; index++) {
        const stride = 6;
        const a = base + index * stride, next = a + stride;
        for (let strip = 0; strip < stride - 1; strip++) indices.push(a + strip, next + strip, a + strip + 1, a + strip + 1, next + strip, next + strip + 1);
      }
    }
    if (!indices.length) return;
    const mesh = new pc.Mesh(runtime.app.graphicsDevice);
    mesh.setPositions(positions); mesh.setNormals(normals); mesh.setUvs(0, uvs); mesh.setColors32(colors); mesh.setIndices(indices); mesh.update(pc.PRIMITIVE_TRIANGLES);
    const role: PbrMaterialRole = geometry.surface === "stone" ? "stone-floor" : geometry.surface === "wood" ? "wood-floor" : "earth";
    const color = geometry.surface === "stone" ? "#716f68" : geometry.surface === "wood" ? "#765033" : "#735536";
    const material = materialFor(runtime, color, undefined, role, null, `world-${geometry.kind}-${geometry.surface}`);
    if (material instanceof pc.StandardMaterial) {
      material.diffuseVertexColor = true;
      material.opacityVertexColor = true;
      material.opacityVertexColorChannel = "a";
      material.blendType = pc.BLEND_NORMAL;
      material.depthWrite = false;
      material.alphaTest = .025;
      material.update();
    }
    const child = new pc.Entity(`${mapEntity.name} LOD ${lod}`);
    child.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: false, receiveShadows: true });
    parent.tags.add(`world-lod:${lod}`); parent.addChild(child);
    return;
  }
  if (mapEntity.worldGeometry.kind === "ground-cover") {
    const geometry = mapEntity.worldGeometry;
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
    // Retain spatial coverage. Array-index decimation selected entire rows.
    const instances = geometry.instances;
    const baseColor = toColor(geometry.color);
    const bladeCount = lod === 0 ? 7 : lod === 1 ? 4 : 2;
    for (let blade = 0; blade < bladeCount; blade++) {
        const phase = (blade * .6180339) % 1;
        const angle = blade * 2.39996;
        const radius = blade ? .08 + (blade % 3) * .055 : 0;
        const originX = Math.cos(angle * 1.7) * radius;
        const originZ = Math.sin(angle * 1.7) * radius;
        const width = (.024 + (blade % 2) * .01) * (7 / bladeCount);
        const height = .3 + ((blade * 37) % 7) * .035;
        const dx = Math.cos(angle) * width, dz = Math.sin(angle) * width, base = positions.length / 3;
        positions.push(originX - dx, 0, originZ - dz, originX + dx, 0, originZ + dz, originX - dx * .68, height * .52, originZ - dz * .68, originX + dx * .68, height * .52, originZ + dz * .68, originX, height, originZ, originX, height, originZ);
        for (let vertex = 0; vertex < 6; vertex++) normals.push(-Math.sin(angle) * .89, .456, Math.cos(angle) * .89);
        uvs.push(0, 0, 1, 0, .15, .52, .85, .52, .48, 1, .52, 1);
        const variation = .78 + ((blade * 29) % 11) / 50;
        for (let vertex = 0; vertex < 6; vertex++) {
          const tip = vertex < 2 ? 0 : vertex < 4 ? .52 : 1;
          const rootShade = .52 + tip * .48;
          colors.push(Math.round(baseColor.r * variation * rootShade * 255), Math.round(baseColor.g * variation * rootShade * 255), Math.round(baseColor.b * variation * rootShade * 255), Math.round(phase * 255));
        }
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3, base + 2, base + 4, base + 3, base + 3, base + 4, base + 5);
    }
    if (!indices.length || !instances.length) { parent.tags.add(`world-lod:${lod}`); return; }
    const mesh = new pc.Mesh(runtime.app.graphicsDevice);
    mesh.setPositions(positions); mesh.setNormals(normals); mesh.setUvs(0, uvs); mesh.setColors32(colors); mesh.setIndices(indices); mesh.update(pc.PRIMITIVE_TRIANGLES);
    let material = runtime.grassMaterials.get(geometry.color);
    if (!material) {
      material = createWindGrassMaterial([baseColor.r, baseColor.g, baseColor.b]);
      runtime.grassMaterials.set(geometry.color, material);
      runtime.animatedMaterials.add(material);
    }
    const child = new pc.Entity(`${mapEntity.name} LOD ${lod}`);
    const meshInstance = new pc.MeshInstance(mesh, material);
    const matrices = new Float32Array(instances.length * 16);
    const transform = new pc.Mat4(), rotation = new pc.Quat();
    instances.forEach((instance, index) => {
      rotation.setFromEulerAngles(0, instance.rotation * 180 / Math.PI, 0);
      transform.setTRS(new pc.Vec3(instance.x - mapEntity.position.x, instance.y - mapEntity.position.y, instance.z - mapEntity.position.z), rotation, new pc.Vec3(instance.scale, instance.scale, instance.scale));
      matrices.set(transform.data, index * 16);
    });
    const instanceBuffer = new pc.VertexBuffer(runtime.app.graphicsDevice, pc.VertexFormat.getDefaultInstancingFormat(runtime.app.graphicsDevice), instances.length, { data: matrices.buffer });
    meshInstance.setInstancing(instanceBuffer, false);
    parent.once("destroy", () => instanceBuffer.destroy());
    const computeJob = runtime.worldCompute.createGrassCullingJob({
      meshInstance,
      matrices,
      worldOrigin: new pc.Vec3(mapEntity.position.x, mapEntity.position.y, mapEntity.position.z),
      instanceRadius: 1.1,
    });
    if (computeJob) parent.once("destroy", () => computeJob.destroy());
    child.addComponent("render", { meshInstances: [meshInstance], castShadows: false, receiveShadows: true });
    parent.tags.add(`world-lod:${lod}`); parent.addChild(child);
    return;
  }
  if (mapEntity.worldGeometry.kind === "water") {
    const geometry = mapEntity.worldGeometry;
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
    const cellSize = geometry.size / geometry.resolution;
    const centerX = geometry.originX + geometry.size / 2, centerZ = geometry.originZ + geometry.size / 2;
    const stride = geometry.resolution + 1;
    type WaterVertex = { x: number; y: number; z: number; depth: number; edge: number; flowX: number; flowZ: number };
    const sampleAt = (column: number, row: number): WaterVertex => {
      const index = row * stride + column;
      return {
        x: geometry.originX + column * cellSize - centerX,
        y: (geometry.surfaceHeights?.[index] ?? geometry.waterLevel) - geometry.waterLevel,
        z: geometry.originZ + row * cellSize - centerZ,
        depth: geometry.depthField?.[index] ?? (geometry.wetCells[index] ? .5 : -.5),
        edge: geometry.shoreline?.[index] ?? 0,
        flowX: geometry.flowVectors?.[index * 2] ?? 0,
        flowZ: geometry.flowVectors?.[index * 2 + 1] ?? 1,
      };
    };
    const midpoint = (a: WaterVertex, b: WaterVertex): WaterVertex => {
      const denominator = a.depth - b.depth;
      const t = Math.max(.06, Math.min(.94, Math.abs(denominator) > .0001 ? a.depth / denominator : .5));
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, depth: 0, edge: 1, flowX: a.flowX + (b.flowX - a.flowX) * t, flowZ: a.flowZ + (b.flowZ - a.flowZ) * t };
    };
    const emit = (polygon: WaterVertex[]) => {
      if (polygon.length < 3) return;
      const base = positions.length / 3;
      for (const vertex of polygon) {
        positions.push(vertex.x, vertex.y, vertex.z);
        normals.push(0, 1, 0);
        uvs.push((vertex.x + centerX) / 6, (vertex.z + centerZ) / 6);
        colors.push(Math.round(vertex.edge * 255), Math.round((vertex.flowX * .5 + .5) * 255), Math.round((vertex.flowZ * .5 + .5) * 255), Math.round(Math.min(1, Math.max(.04, vertex.depth) / 3.2) * 255));
      }
      for (let index = 1; index < polygon.length - 1; index++) indices.push(base, base + index + 1, base + index);
    };
    const waterStep = lod === 0 ? 1 : lod === 1 ? 2 : 4;
    for (let row = 0; row < geometry.resolution; row += waterStep) for (let column = 0; column < geometry.resolution; column += waterStep) {
      const topLeft = sampleAt(column, row), topRight = sampleAt(column + waterStep, row), bottomRight = sampleAt(column + waterStep, row + waterStep), bottomLeft = sampleAt(column, row + waterStep);
      const mask = (geometry.wetCells[row * stride + column] ? 1 : 0)
        | (geometry.wetCells[row * stride + column + waterStep] ? 2 : 0)
        | (geometry.wetCells[(row + waterStep) * stride + column + waterStep] ? 4 : 0)
        | (geometry.wetCells[(row + waterStep) * stride + column] ? 8 : 0);
      if (!mask) continue;
      const top = midpoint(topLeft, topRight), right = midpoint(topRight, bottomRight), bottom = midpoint(bottomRight, bottomLeft), left = midpoint(bottomLeft, topLeft);
      const polygons: WaterVertex[][] = mask === 1 ? [[topLeft, top, left]]
        : mask === 2 ? [[topRight, right, top]]
          : mask === 3 ? [[topLeft, topRight, right, left]]
            : mask === 4 ? [[bottomRight, bottom, right]]
              : mask === 5 ? [[topLeft, top, left], [bottomRight, bottom, right]]
                : mask === 6 ? [[topRight, bottomRight, bottom, top]]
                  : mask === 7 ? [[topLeft, topRight, bottomRight, bottom, left]]
                    : mask === 8 ? [[bottomLeft, left, bottom]]
                      : mask === 9 ? [[topLeft, top, bottom, bottomLeft]]
                        : mask === 10 ? [[topRight, right, top], [bottomLeft, left, bottom]]
                          : mask === 11 ? [[topLeft, topRight, right, bottom, bottomLeft]]
                            : mask === 12 ? [[left, right, bottomRight, bottomLeft]]
                              : mask === 13 ? [[topLeft, top, right, bottomRight, bottomLeft]]
                                : mask === 14 ? [[top, topRight, bottomRight, bottomLeft, left]]
                                  : [[topLeft, topRight, bottomRight, bottomLeft]];
      polygons.forEach(emit);
    }
    if (!indices.length) return;
    const mesh = new pc.Mesh(runtime.app.graphicsDevice);
    mesh.setPositions(positions); mesh.setNormals(normals); mesh.setUvs(0, uvs); mesh.setColors32(colors); mesh.setIndices(indices); mesh.update(pc.PRIMITIVE_TRIANGLES);
    const material = runtime.worldWaterMaterial;
    const child = new pc.Entity(`${mapEntity.name} LOD ${lod}`);
    child.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: false, receiveShadows: true });
    child.setLocalPosition(0, geometry.waterLevel - mapEntity.position.y, 0);
    // Water remains one inexpensive animated PBR material per color/profile.
    // Creating the full Water script for every streamed chunk would allocate a
    // shader controller (and potentially render cameras) per tile, defeating
    // chunk streaming and briefly rendering before all uniforms were present.
    parent.tags.add(`world-lod:${lod}`);
    parent.addChild(child);
    return;
  }
  if (mapEntity.worldGeometry.kind !== "terrain") return;
  const terrainGeometry = mapEntity.worldGeometry;
  const resolution = lod === 0 ? 33 : lod === 1 ? 17 : 9;
  const field = createHeightfield(terrainGeometry, resolution);
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
  const centerX = terrainGeometry.originX + terrainGeometry.size / 2;
  const centerZ = terrainGeometry.originZ + terrainGeometry.size / 2;
  const spacing = field.size / (field.resolution - 1);
  const at = (column: number, row: number) => field.heights[Math.max(0, Math.min(field.resolution - 1, row)) * field.resolution + Math.max(0, Math.min(field.resolution - 1, column))];
  for (let row = 0; row < field.resolution; row++) for (let column = 0; column < field.resolution; column++) {
    const worldX = field.originX + column * spacing, worldZ = field.originZ + row * spacing;
    positions.push(worldX - centerX, at(column, row), worldZ - centerZ);
    const left = at(column - 1, row), right = at(column + 1, row), down = at(column, row - 1), up = at(column, row + 1);
    const nx = left - right, ny = spacing * 2, nz = down - up, length = Math.max(.0001, Math.hypot(nx, ny, nz));
    normals.push(nx / length, ny / length, nz / length);
    // Absolute UVs continue across chunk boundaries. The old per-chunk 0..1
    // UVs stamped one recognizable grass photograph onto every 16 m tile.
    uvs.push(worldX / 7.5, worldZ / 7.5);
    const macro = terrainNoise(worldX + 311, worldZ - 179, terrainGeometry.seed + 1901, .62);
    const weights = terrainSurfaceWeights(terrainGeometry, worldX, worldZ, ny / length);
    const biome = terrainGeometry.biomeId ?? "forest";
    const palettes: Record<string, { soil: [number, number, number]; vegetation: [number, number, number]; rock: [number, number, number]; wet: [number, number, number] }> = {
      forest: { soil: [111, 84, 54], vegetation: [86, 126, 67], rock: [121, 124, 116], wet: [62, 82, 66] },
      plains: { soil: [132, 105, 65], vegetation: [132, 157, 78], rock: [145, 142, 125], wet: [72, 99, 73] },
      mountains: { soil: [105, 91, 70], vegetation: [83, 111, 69], rock: [143, 144, 139], wet: [65, 84, 81] },
      swamp: { soil: [82, 70, 47], vegetation: [75, 111, 65], rock: [105, 110, 94], wet: [47, 81, 69] },
      coast: { soil: [163, 137, 87], vegetation: [108, 135, 73], rock: [147, 145, 132], wet: [63, 104, 105] },
      desert: { soil: [184, 139, 82], vegetation: [119, 129, 66], rock: [158, 135, 105], wet: [63, 111, 113] },
      snow: { soil: [134, 135, 132], vegetation: [75, 102, 79], rock: [134, 141, 143], wet: [78, 111, 125] },
      urban: { soil: [118, 103, 82], vegetation: [91, 119, 70], rock: [139, 136, 127], wet: [66, 91, 91] },
    };
    // RGB carries the SoilMachine surface section weights into the material:
    // exposed bedrock, vegetated topsoil, and saturated/depositional ground.
    // Alpha remains the independently painted road mask. The shader can now
    // select matching albedo and normal layers instead of inferring every
    // surface from slope and giving soil and grass the same plastic response.
    colors.push(
      Math.round(Math.min(1, Math.max(0, weights.rock)) * 255),
      Math.round(Math.min(1, Math.max(0, weights.vegetation)) * 255),
      Math.round(Math.min(1, Math.max(0, weights.wet + weights.snow * .55)) * 255),
      Math.round(weights.road * 255),
    );
  }
  for (let row = 0; row < field.resolution - 1; row++) for (let column = 0; column < field.resolution - 1; column++) {
    const a = row * field.resolution + column, b = a + 1, c = a + field.resolution, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const addSkirt = (edge: number[]) => {
    const skirt: number[] = [];
    for (const top of edge) {
      const next = positions.length / 3; skirt.push(next);
      positions.push(positions[top * 3], positions[top * 3 + 1] - 1.25, positions[top * 3 + 2]);
      normals.push(normals[top * 3], normals[top * 3 + 1], normals[top * 3 + 2]);
      uvs.push(uvs[top * 2], uvs[top * 2 + 1]);
      colors.push(colors[top * 4], colors[top * 4 + 1], colors[top * 4 + 2], colors[top * 4 + 3]);
    }
    for (let index = 0; index < edge.length - 1; index++) indices.push(edge[index], skirt[index], edge[index + 1], edge[index + 1], skirt[index], skirt[index + 1]);
  };
  const last = field.resolution - 1;
  addSkirt(Array.from({ length: field.resolution }, (_, index) => index));
  addSkirt(Array.from({ length: field.resolution }, (_, index) => index * field.resolution + last));
  addSkirt(Array.from({ length: field.resolution }, (_, index) => last * field.resolution + last - index));
  addSkirt(Array.from({ length: field.resolution }, (_, index) => (last - index) * field.resolution));
  const mesh = new pc.Mesh(runtime.app.graphicsDevice);
  mesh.setPositions(positions); mesh.setNormals(normals); mesh.setUvs(0, uvs); mesh.setColors32(colors); mesh.setIndices(indices); mesh.update(pc.PRIMITIVE_TRIANGLES);
  const child = new pc.Entity(`${mapEntity.name} LOD ${lod}`);
  const terrainBiome = terrainGeometry.biomeId ?? "forest";
  const terrainMaterial = materialFor(runtime, "#ffffff", undefined, mapEntity.assetId.includes("stone") ? "stone-floor" : "grass", "printed-board", `world-terrain-${terrainBiome}`);
  configureWorldTerrainMaterial(terrainMaterial, runtime.app.graphicsDevice, terrainBiome);
  child.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, terrainMaterial)], castShadows: true, receiveShadows: true });
  parent.tags.add(`world-lod:${lod}`);
  parent.addChild(child);
};

const createTokenBase = (runtime: RuntimeScene, parent: pc.Entity, token: TokenAsset): void => {
  const addBaseRender = (entity: pc.Entity, color: string) => {
    const geometry = tokenBaseGeometry(token.base.shape);
    if (geometry.capSegments) {
      const mesh = pc.createCylinder(runtime.app.graphicsDevice, { height: 1, radius: 0.5, capSegments: geometry.capSegments });
      entity.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, materialFor(runtime, color, undefined, "plain", "painted-piece"))] });
    } else {
      entity.addComponent("render", { type: geometry.primitive });
      if (entity.render) entity.render.material = materialFor(runtime, color, undefined, "plain", "painted-piece");
    }
  };
  const base = new pc.Entity(`${token.name} base`);
  const diameter = token.footprint * 2;
  addBaseRender(base, token.base.color);
  base.setLocalPosition(0, token.base.height / 2, 0);
  base.setLocalScale(diameter, token.base.height, diameter);
  parent.addChild(base);

  const rim = new pc.Entity(`${token.name} rim`);
  addBaseRender(rim, token.base.accentColor);
  rim.setLocalPosition(0, token.base.height + 0.014, 0);
  rim.setLocalScale(diameter * 0.92, 0.018, diameter * 0.92);
  parent.addChild(rim);
};

const createTokenFallback = (runtime: RuntimeScene, parent: pc.Entity, token: TokenAsset, baseTop = tokenBaseTop(token.base.height)): pc.Entity => {
  const fallback = new pc.Entity(`${token.name} loading silhouette`);
  fallback.addComponent("render", { type: token.kind === "boss" ? "sphere" : "capsule" });
  fallback.setLocalScale(token.footprint, token.kind === "boss" ? 1.4 : 1.1, token.footprint);
  if (fallback.render) fallback.render.material = materialFor(runtime, token.base.accentColor, undefined, "plain", "painted-miniature");
  parent.addChild(fallback);
  groundModelOnBase(fallback, parent, baseTop, token.modelLift);
  return fallback;
};

const finishImportedEntity = (runtime: RuntimeScene, entity: pc.Entity, profile: TabletopFinishProfile, role: PbrMaterialRole = "plain"): void => {
  const finished = new Set<pc.Material>();
  for (const component of entity.findComponents("render") as pc.RenderComponent[]) for (const meshInstance of component.meshInstances) {
    const material = meshInstance.material;
    if (material instanceof pc.StandardMaterial && !finished.has(material)) {
      finished.add(material);
      applyTabletopFinish(material, profile);
      applyPropPhysicalProfile(material, role);
      if (role.endsWith("floor")) applyMatteFloorFinish(material);
      applyLightweightAmbientToMaterial(runtime.lighting, material);
      if (profile === "painted-miniature") {
        applySceneReactiveMiniatureFinish(material);
        applyHobbyPaintFinish(material);
        applyMiniatureRimFinish(material);
      }
    }
  }
};

const loadTokenModel = async (runtime: RuntimeScene, parent: pc.Entity, token: TokenAsset, state = resolveTokenState(token), baseTop = tokenBaseTop(token.base.height)): Promise<void> => {
  const motionRoot = new pc.Entity(`${token.name} motion root`);
  motionRoot.tags.add("token-motion-root");
  parent.addChild(motionRoot);
  const fallback = createTokenFallback(runtime, motionRoot, token, baseTop);
  const contents = await getStoredTokenModel(state.storageKey);
  if (!contents || !parent.parent) return;
  const key = `token:${state.storageKey}`;
  let asset = runtime.modelAssets.get(key);
  if (!asset) {
    asset = new pc.Asset(token.name, "container", {
      url: `memory://dndrom/${encodeURIComponent(token.id)}.glb`,
      filename: state.filename,
      size: state.byteLength,
      contents,
    });
    runtime.modelAssets.set(key, asset);
    runtime.app.assets.add(asset);
    runtime.app.assets.load(asset);
  }
  const attach = () => {
    if (!parent.parent || !asset?.resource) return;
    fallback.destroy();
    const resource = asset.resource as { instantiateRenderEntity: () => pc.Entity; animations?: pc.Asset[] };
    const instance = resource.instantiateRenderEntity();
    instance.tags.add("token-visual");
    instance.setLocalScale(state.modelScale, state.modelScale, state.modelScale);
    finishImportedEntity(runtime, instance, "painted-miniature", "fabric");
    motionRoot.addChild(instance);
    groundModelOnBase(instance, motionRoot, baseTop, state.modelLift);
    const embeddedTracks = (resource.animations ?? []).filter((entry) => entry.resource);
    if (embeddedTracks.length && state.animations.length) {
      instance.addComponent("anim", { activate: true });
      const states = state.animations.map((animation, index) => ({
        name: animation.id,
        speed: 1,
        loop: animation.loop,
        defaultState: animation.kind === "idle" || index === 0,
      }));
      const defaultState = states.find((entry) => entry.defaultState) ?? states[0];
      instance.anim?.loadStateGraph({
        layers: [{ name: "Token motion", states: [{ name: "START", speed: 1 }, ...states], transitions: [{ from: "START", to: defaultState.name }] }],
        parameters: {},
      });
      state.animations.forEach((animation, index) => {
        const named = embeddedTracks.find((track) => track.name.toLowerCase().includes(animation.name.toLowerCase()) || track.name.toLowerCase().includes(animation.kind));
        const track = named ?? embeddedTracks[index] ?? embeddedTracks[0];
        instance.anim?.assignAnimation(animation.id, track.resource as pc.AnimTrack, "Token motion", 1, animation.loop);
      });
      motionRoot.tags.add("token-skeletal-motion");
    }
    applyLightProbeToEntity(runtime.lighting, instance);
  };
  if (asset.resource) attach();
  else asset.ready(attach);
};

const addPracticalLight = (parent: pc.Entity, prop: PropAsset): void => {
  const behavior = prop.defaultBehavior;
  if (behavior.kind !== "practical-light") return;
  const light = new pc.Entity(`${prop.name} practical light`);
  light.tags.add("prop-practical-light", `light-base:${behavior.intensity}`, `light-flicker:${behavior.flicker?.enabled ? behavior.flicker.amount : 0}`, `light-speed:${behavior.flicker?.speed ?? 0}`);
  light.addComponent("light", { type: behavior.lightType === "spot" ? "spot" : "omni", color: new pc.Color().fromString(behavior.color), intensity: behavior.intensity, range: behavior.range, innerConeAngle: Math.max(1, behavior.coneAngle * .65), outerConeAngle: behavior.coneAngle, castShadows: false });
  light.setLocalPosition(behavior.anchor.x, behavior.anchor.y, behavior.anchor.z);
  if (behavior.lightType === "spot") light.lookAt(behavior.anchor.x + behavior.direction.x, behavior.anchor.y + behavior.direction.y, behavior.anchor.z + behavior.direction.z);
  parent.addChild(light);
};

const addSceneLightGizmo = (runtime: RuntimeScene, parent: pc.Entity, behavior: PracticalLightBehavior): void => {
  const color = behavior.color;
  const bulb = new pc.Entity("Build-only light gizmo");
  bulb.tags.add("scene-light-gizmo");
  bulb.addComponent("render", { type: "sphere" });
  bulb.setLocalPosition(behavior.anchor.x, behavior.anchor.y, behavior.anchor.z);
  bulb.setLocalScale(.22, .22, .22);
  if (bulb.render) {
    bulb.render.material = materialFor(runtime, color, color);
    bulb.render.castShadows = false;
    bulb.render.receiveShadows = false;
  }
  parent.addChild(bulb);
  const stem = new pc.Entity("Light gizmo stem");
  stem.addComponent("render", { type: "cylinder" });
  stem.setLocalPosition(0, behavior.anchor.y / 2, 0);
  stem.setLocalScale(.025, Math.max(.1, behavior.anchor.y), .025);
  if (stem.render) {
    stem.render.material = materialFor(runtime, "#796942", "#b89a48");
    stem.render.castShadows = false;
    stem.render.receiveShadows = false;
  }
  parent.addChild(stem);
  if (behavior.lightType === "spot") {
    const cone = new pc.Entity("Spot direction gizmo");
    cone.addComponent("render", { type: "cone" });
    const direction = new pc.Vec3(behavior.direction.x, behavior.direction.y, behavior.direction.z).normalize();
    cone.setLocalPosition(behavior.anchor.x + direction.x * .38, behavior.anchor.y + direction.y * .38, behavior.anchor.z + direction.z * .38);
    cone.setLocalScale(.18, .55, .18);
    cone.lookAt(behavior.anchor.x + behavior.direction.x, behavior.anchor.y + behavior.direction.y, behavior.anchor.z + behavior.direction.z);
    cone.rotateLocal(90, 0, 0);
    if (cone.render) {
      cone.render.material = materialFor(runtime, color, color);
      cone.render.castShadows = false;
      cone.render.receiveShadows = false;
    }
    parent.addChild(cone);
  }
};

const createMissingPropPlaceholder = (runtime: RuntimeScene, parent: pc.Entity, prop: PropAsset): void => {
  const width = Math.max(.12, prop.bounds.max.x - prop.bounds.min.x), height = Math.max(.12, prop.bounds.max.y - prop.bounds.min.y), depth = Math.max(.12, prop.bounds.max.z - prop.bounds.min.z);
  const placeholder = new pc.Entity(`${prop.name} · relink required`);
  placeholder.tags.add("missing-prop-binary");
  placeholder.addComponent("render", { type: "box" });
  placeholder.setLocalPosition(0, height / 2, 0); placeholder.setLocalScale(width, height, depth);
  if (placeholder.render) placeholder.render.material = materialFor(runtime, "#6e2432", "#d54b68");
  parent.addChild(placeholder);
};

const loadPropModel = async (runtime: RuntimeScene, parent: pc.Entity, prop: PropAsset, customMaterial?: MaterialAsset, lightManagedByScene = false): Promise<void> => {
  if (!lightManagedByScene) addPracticalLight(parent, prop);
  const contents = await getStoredPropModel(prop.storageKey);
  if (!contents || !parent.parent) { createMissingPropPlaceholder(runtime, parent, prop); return; }
  const key = `prop:${prop.storageKey}`;
  let asset = runtime.modelAssets.get(key);
  if (!asset) {
    asset = new pc.Asset(prop.name, "container", { url: `memory://dndrom/${encodeURIComponent(prop.id)}.glb`, filename: prop.filename, size: prop.byteLength, contents });
    runtime.modelAssets.set(key, asset); runtime.app.assets.add(asset); runtime.app.assets.load(asset);
  }
  const attach = () => {
    if (!parent.parent || !asset?.resource) return;
    for (const child of [...parent.children]) if (!child.tags.has("prop-practical-light")) child.destroy();
    const instance = (asset.resource as { instantiateRenderEntity: () => pc.Entity }).instantiateRenderEntity();
    instance.setLocalScale(1, 1, 1);
    instance.setLocalEulerAngles(0, Math.atan2(prop.forwardAnchor.x, -prop.forwardAnchor.z) * 180 / Math.PI, 0);
    finishImportedEntity(runtime, instance, "painted-piece", "plain");
    parent.addChild(instance);
    const low = prop.bounds.min.y;
    instance.setLocalPosition(-prop.bottomAnchor.x, -low, -prop.bottomAnchor.z);
    applyLightProbeToEntity(runtime.lighting, instance);
    if (customMaterial) void applyMaterialAsset(runtime.app, instance, customMaterial);
  };
  if (asset.resource) attach(); else asset.ready(attach);
};

const loadModel = (runtime: RuntimeScene, parent: pc.Entity, definition: AssetDefinition, customMaterial?: MaterialAsset): void => {
  if (!definition.modelUrl) return;
  let asset = runtime.modelAssets.get(definition.modelUrl);
  if (!asset) {
    asset = new pc.Asset(definition.name, "container", { url: definition.modelUrl });
    runtime.modelAssets.set(definition.modelUrl, asset);
    runtime.app.assets.add(asset);
    runtime.app.assets.load(asset);
  }
  const attach = () => {
    if (!parent.parent || !asset?.resource) return;
    const resource = asset.resource as { instantiateRenderEntity: () => pc.Entity };
    const instance = resource.instantiateRenderEntity();
    const scale = definition.modelScale ?? 1;
    instance.setLocalScale(scale, scale, scale);
    const role: PbrMaterialRole = definition.id.includes("barrel") ? "wood-barrel"
      : definition.id.includes("chair") ? "wood-chair"
      : definition.id.includes("table") ? "wood-table"
      : definition.id.includes("chest") ? "wood-chest"
      : definition.id.includes("rocks") ? "stone-natural"
      : definition.id.includes("column") || definition.id.includes("wall") || definition.id.includes("gate") || definition.id.includes("stairs") ? "stone-wall"
      : definition.category === "tokens" ? "fabric"
      : "plain";
    finishImportedEntity(runtime, instance, definition.category === "tokens" ? "painted-miniature" : "painted-piece", role);
    parent.addChild(instance);
    applyLightProbeToEntity(runtime.lighting, instance);
    if (customMaterial) void applyMaterialAsset(runtime.app, instance, customMaterial);
  };
  if (asset.resource) attach();
  else {
    createFallback(runtime, parent, definition);
    asset.ready(() => {
      for (const child of [...parent.children]) if (child.name !== "Miniature contact shadow") child.destroy();
      attach();
    });
    asset.on("error", () => {
      if (parent.children.length === 0) createFallback(runtime, parent, definition);
    });
  }
};

const addMiniatureBlobShadow = (runtime: RuntimeScene, parent: pc.Entity, footprint: number): void => {
  const shadow = new pc.Entity("Miniature contact shadow");
  shadow.tags.add("contact-shadow");
  shadow.addComponent("render", { type: "plane" });
  shadow.setLocalPosition(0, .012, 0);
  shadow.setLocalScale(footprint * 2.15, 1, footprint * 1.82);
  if (shadow.render) {
    shadow.render.material = runtime.blobShadowMaterial;
    shadow.render.castShadows = false;
    shadow.render.receiveShadows = false;
  }
  parent.addChild(shadow);
};

interface BasePlateSceneContext {
  assets: BasePlateAsset[];
  campaignAssignments?: BasePlateAssignmentMap;
  sceneAssignments?: BasePlateAssignmentMap;
  tokenCharacterLinks?: Record<string, string>;
}

const addProceduralVegetation = (runtime: RuntimeScene, parent: pc.Entity, mapEntity: MapEntity): void => {
  const lod = mapEntity.chunkId ? runtime.worldStreaming.residentLod(mapEntity.chunkId) ?? runtime.worldVisibility?.lodByChunkId.get(mapEntity.chunkId) ?? 0 : 0;
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const color = (hex: string, shade = 1): [number, number, number, number] => {
    const value = toColor(hex);
    return [Math.round(value.r * shade * 255), Math.round(value.g * shade * 255), Math.round(value.b * shade * 255), 255];
  };
  const pushColor = (entry: [number, number, number, number], count: number) => { for (let index = 0; index < count; index++) colors.push(...entry); };
  const cylinder = (start: pc.Vec3, end: pc.Vec3, bottomRadius: number, topRadius: number, tint: [number, number, number, number], sides = lod === 0 ? 7 : 5) => {
    const direction = end.clone().sub(start).normalize();
    const reference = Math.abs(direction.y) > .92 ? new pc.Vec3(1, 0, 0) : new pc.Vec3(0, 1, 0);
    const side = new pc.Vec3().cross(direction, reference).normalize();
    const forward = new pc.Vec3().cross(direction, side).normalize();
    const base = positions.length / 3;
    for (let ring = 0; ring < 2; ring++) for (let segment = 0; segment < sides; segment++) {
      const angle = segment / sides * Math.PI * 2, radius = ring ? topRadius : bottomRadius, center = ring ? end : start;
      positions.push(center.x + side.x * Math.cos(angle) * radius + forward.x * Math.sin(angle) * radius, center.y + side.y * Math.cos(angle) * radius + forward.y * Math.sin(angle) * radius, center.z + side.z * Math.cos(angle) * radius + forward.z * Math.sin(angle) * radius);
    }
    pushColor(tint, sides * 2);
    for (let segment = 0; segment < sides; segment++) {
      const next = (segment + 1) % sides;
      indices.push(base + segment, base + sides + segment, base + next, base + next, base + sides + segment, base + sides + next);
    }
  };
  const canopy = (center: pc.Vec3, radius: pc.Vec3, tint: [number, number, number, number], seed: number) => {
    const segments = lod === 0 ? 8 : lod === 1 ? 6 : 5, rings = lod === 0 ? 5 : 3, base = positions.length / 3;
    for (let ring = 0; ring <= rings; ring++) {
      const latitude = ring / rings * Math.PI;
      for (let segment = 0; segment < segments; segment++) {
        const longitude = segment / segments * Math.PI * 2;
        const irregular = .82 + .18 * Math.sin(seed * 1.73 + segment * 2.17 + ring * 3.11);
        const belt = Math.sin(latitude);
        positions.push(center.x + Math.cos(longitude) * belt * radius.x * irregular, center.y + Math.cos(latitude) * radius.y * irregular, center.z + Math.sin(longitude) * belt * radius.z * irregular);
      }
    }
    pushColor(tint, (rings + 1) * segments);
    for (let ring = 0; ring < rings; ring++) for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments, a = base + ring * segments + segment, b = base + ring * segments + next, c = a + segments, d = b + segments;
      indices.push(a, c, b, b, c, d);
    }
  };
  const seed = [...mapEntity.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  const bark = color("#4d3927", .82 + (seed % 7) * .025);
  const darkLeaf = color("#244f31", .86 + (seed % 5) * .035);
  const lightLeaf = color("#477b42", .84 + (seed % 3) * .045);
  const id = mapEntity.assetId;
  if (id === "reeds-wetland") {
    for (let reed = 0; reed < (lod === 0 ? 13 : 7); reed++) {
      const angle = reed * 2.39996 + seed, radius = .08 + (reed % 4) * .055;
      cylinder(new pc.Vec3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius), new pc.Vec3(Math.cos(angle) * radius + Math.sin(angle) * .08, .72 + (reed % 5) * .09, Math.sin(angle) * radius), .018, .007, reed % 2 ? lightLeaf : darkLeaf, 4);
    }
  } else if (id === "shrub-broadleaf") {
    for (let cluster = 0; cluster < (lod === 0 ? 7 : 4); cluster++) {
      const angle = cluster * 2.39996 + seed, radius = cluster ? .28 : 0;
      canopy(new pc.Vec3(Math.cos(angle) * radius, .38 + (cluster % 3) * .1, Math.sin(angle) * radius), new pc.Vec3(.34, .28, .32), cluster % 2 ? lightLeaf : darkLeaf, seed + cluster);
    }
  } else {
    const young = id.endsWith("young"), dead = id === "tree-dead", pine = id.startsWith("tree-pine"), cypress = id === "tree-cypress";
    const height = young ? 3.2 : cypress ? 6.1 : pine ? 6.3 : 5.5;
    cylinder(new pc.Vec3(0, 0, 0), new pc.Vec3(.06 * Math.sin(seed), height * .76, .04 * Math.cos(seed)), young ? .13 : .24, young ? .055 : .085, bark);
    const branchCount = lod === 0 ? (pine ? 17 : 9) : lod === 1 ? (pine ? 11 : 7) : 6;
    for (let branch = 0; branch < branchCount; branch++) {
      const angle = branch * 2.39996 + seed * .17;
      const level = pine ? .8 + branch / branchCount * height * .64 : height * (.43 + (branch % 4) * .085);
      const length = pine ? (1.25 - branch / branchCount * .65) : .62 + (branch % 3) * .16;
      const start = new pc.Vec3(0, level, 0), end = new pc.Vec3(Math.cos(angle) * length, level + (pine ? -.08 : .32 + (branch % 2) * .16), Math.sin(angle) * length);
      cylinder(start, end, young ? .035 : .065, .018, bark, lod === 0 ? 6 : 4);
      if (!dead) {
        const radii = pine ? new pc.Vec3(.68, .25, .34) : cypress ? new pc.Vec3(.7, .92, .64) : new pc.Vec3(.82, .62, .76);
        canopy(end.clone().add(new pc.Vec3(0, pine ? .05 : .18, 0)), radii, branch % 2 ? lightLeaf : darkLeaf, seed + branch * 13);
      }
    }
    if (!dead && !pine) {
      const crownCount = lod === 0 ? 6 : lod === 1 ? 4 : 2;
      for (let crown = 0; crown < crownCount; crown++) {
        const angle = crown * 2.39996 + seed, radius = crown ? .48 : 0;
        canopy(new pc.Vec3(Math.cos(angle) * radius, height * (.72 + (crown % 2) * .08), Math.sin(angle) * radius), cypress ? new pc.Vec3(.92, 1.28, .84) : new pc.Vec3(1.2, .82, 1.08), crown % 2 ? lightLeaf : darkLeaf, seed + crown * 29);
      }
    }
  }
  if (!indices.length) return;
  const mesh = new pc.Mesh(runtime.app.graphicsDevice);
  mesh.setPositions(positions);
  mesh.setNormals(pc.calculateNormals(positions, indices));
  mesh.setColors32(colors);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const material = materialFor(runtime, "#ffffff", undefined, "foliage", "printed-board", "world-procedural-vegetation");
  material.diffuseVertexColor = true;
  if (!runtime.animatedMaterials.has(material)) {
    configureWorldVegetationMaterial(material);
    runtime.animatedMaterials.add(material);
  } else material.update();
  const child = new pc.Entity(`${mapEntity.name} procedural botanical LOD ${lod}`);
  child.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: true, receiveShadows: true });
  parent.addChild(child);
};

const resolveSceneBasePlate = (mapEntity: MapEntity, token: TokenAsset, context?: BasePlateSceneContext): BasePlateAsset | undefined => {
  if (!context) return undefined;
  const characterId = context.tokenCharacterLinks?.[token.id] ?? token.characterId;
  const formId = token.states?.find((state) => state.id === mapEntity.tokenStateId)?.formId ?? mapEntity.tokenStateId;
  const assetId = context.sceneAssignments?.[`entity:${mapEntity.id}`]
    ?? (characterId ? context.sceneAssignments?.[`character:${characterId}`] : undefined)
    ?? context.sceneAssignments?.[`token:${token.id}`]
    ?? (characterId ? context.campaignAssignments?.[`character:${characterId}`] : undefined)
    ?? context.campaignAssignments?.[`token:${token.id}`]
    ?? (formId ? token.formBasePlateAssignments?.[formId] : undefined)
    ?? token.defaultBasePlateAssetId;
  return context.assets.find((asset) => asset.id === assetId);
};

const createMapObject = (runtime: RuntimeScene, mapEntity: MapEntity, tokenAssets: TokenAsset[], propAssets: PropAsset[] = [], materialAssets: MaterialAsset[] = [], parent = runtime.contentRoot, baseContext?: BasePlateSceneContext, sceneInterior = false): pc.Entity => {
  const root = new pc.Entity(mapEntity.name);
  root.tags.add("map-object", mapEntity.id);
  if (sceneInterior) root.tags.add("scene:interior");
  for (const tag of mapEntity.tags ?? []) root.tags.add(tag);
  const definition = ASSET_BY_ID.get(mapEntity.assetId);
  const token = tokenAssets.find((entry) => entry.id === mapEntity.assetId);
  const prop = propAssets.find((entry) => entry.id === mapEntity.assetId);
  const customMaterial = materialForGeometry(materialAssets.find((entry) => entry.id === mapEntity.materialAssetId), mapEntity.assetId);
  if (mapEntity.worldGeometry) addProceduralGeometry(runtime, root, mapEntity, definition);
  else if (definition?.editorOnly && (mapEntity.light ?? definition.defaultBehavior)?.kind === "practical-light") {
    const behavior = (mapEntity.light ?? definition.defaultBehavior) as PracticalLightBehavior;
    root.tags.add(`editor-light:${JSON.stringify(behavior)}`);
    addSceneLightGizmo(runtime, root, behavior);
  }
  else if (definition?.parts && mapEntity.tags?.includes("world:vegetation") && /^(tree-|shrub-broadleaf|reeds-wetland)/.test(definition.id)) addProceduralVegetation(runtime, root, mapEntity);
  else if (definition?.parts) definition.parts.forEach((part, partIndex) => addPart(runtime, root, definition, part, partIndex));
  else if (definition?.modelUrl) loadModel(runtime, root, definition, customMaterial);
  else if (definition) createFallback(runtime, root, definition);
  else if (token) {
    const state = resolveTokenState(token, mapEntity.tokenStateId);
    root.tags.add(`token-state:${state.id}`);
    const baseAsset = resolveSceneBasePlate(mapEntity, token, baseContext);
    const miniatureRoot = new pc.Entity(`${token.name} miniature root`);
    root.addChild(miniatureRoot);
    let initialAnchor = 0;
    const baseHandle = renderBasePlate({ app: runtime.app, parent: root, token, asset: baseAsset, quality: callbacksQuality(runtime), reducedMotion: runtime.reducedMotion, propAssets, materialAssets, onAnchorTopChanged: (height, offset) => miniatureRoot.setLocalPosition(offset.x, height - initialAnchor, offset.z) });
    initialAnchor = baseHandle.anchorTop;
    runtime.basePlateHandles.set(mapEntity.id, baseHandle);
    root.tags.add(`baseplate:${baseAsset?.id ?? "legacy"}:${baseAsset?.updatedAt ?? token.base.color}`);
    void loadTokenModel(runtime, miniatureRoot, token, state, baseHandle.anchorTop);
  } else if (prop) void loadPropModel(runtime, root, prop, customMaterial, Boolean(mapEntity.light));
  if (mapEntity.id !== "build-ghost" && (token || definition?.id.startsWith("token-"))) {
    addMiniatureBlobShadow(runtime, root, token?.footprint ?? definition?.footprint ?? .65);
  }
  root.enabled = !mapEntity.hidden && (!definition?.editorOnly || runtime.mode === "build");
  parent.addChild(root);
  return root;
};

const setGhostMaterial = (root: pc.Entity, material: pc.StandardMaterial): void => {
  for (const component of root.findComponents("render")) {
    const render = component as pc.RenderComponent;
    render.castShadows = false;
    render.receiveShadows = false;
    for (const meshInstance of render.meshInstances) meshInstance.material = material;
  }
};

const rebuildGhost = (runtime: RuntimeScene, assetId: string | null, tokenAssets: TokenAsset[], propAssets: PropAsset[] = []): void => {
  runtime.ghost?.destroy();
  runtime.ghost = null;
  runtime.ghostAssetId = assetId;
  if (!assetId) return;
  const definition = ASSET_BY_ID.get(assetId);
  const token = tokenAssets.find((entry) => entry.id === assetId);
  const prop = propAssets.find((entry) => entry.id === assetId);
  if (!definition && !token && !prop) return;
  runtime.ghost = createMapObject(runtime, {
    id: "build-ghost",
    assetId,
    name: `${definition?.name ?? token?.name ?? prop?.name ?? "Asset"} preview`,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: token?.defaultPlacementScale ?? prop?.defaultPlacementScale ?? 1, y: token?.defaultPlacementScale ?? prop?.defaultPlacementScale ?? 1, z: token?.defaultPlacementScale ?? prop?.defaultPlacementScale ?? 1 },
  }, tokenAssets, propAssets, [], runtime.previewRoot);
  runtime.ghost.enabled = false;
  setGhostMaterial(runtime.ghost, runtime.ghostMaterials.valid);
};

const callbacksQuality = (runtime: RuntimeScene) => ((runtime.app.graphicsDevice.canvas as HTMLCanvasElement).dataset.lightingQuality ?? "balanced") as "performance" | "balanced" | "cinematic" | "diorama";

const syncObjects = (runtime: RuntimeScene, map: GameMap, tokenAssets: TokenAsset[], propAssets: PropAsset[] = [], materialAssets: MaterialAsset[] = [], baseContext?: BasePlateSceneContext): void => {
  const expected = new Set(map.entities.map((entry) => entry.id));
  const sceneInterior = isInteriorMap(map);
  for (const [id, root] of runtime.objectRoots) {
    if (!expected.has(id)) {
      root.destroy();
      runtime.objectRoots.delete(id);
      runtime.basePlateHandles.get(id)?.destroy();
      runtime.basePlateHandles.delete(id);
    }
  }
  for (const mapEntity of map.entities) {
    let root = runtime.objectRoots.get(mapEntity.id);
    const token = tokenAssets.find((entry) => entry.id === mapEntity.assetId);
    const dynamicWorldEntity = Boolean(token) || (!mapEntity.tags?.some((tag) => tag.startsWith("world:")) && !mapEntity.worldGeometry);
    const effectiveChunkId = dynamicWorldEntity && map.world ? chunkIdForPosition(map.world, mapEntity.position) ?? mapEntity.chunkId : mapEntity.chunkId;
    let chunkVisible = shouldRenderWorldEntity(effectiveChunkId, runtime.worldVisibility);
    if (!chunkVisible && mapEntity.light && map.world && runtime.worldVisibility) {
      const anchor = mapEntity.light.anchor;
      chunkVisible = lightInfluencesVisibleChunks({ x: mapEntity.position.x + anchor.x, y: mapEntity.position.y + anchor.y, z: mapEntity.position.z + anchor.z }, mapEntity.light.range, map.world, runtime.worldVisibility);
    }
    const resident = !effectiveChunkId || dynamicWorldEntity || runtime.worldStreaming.isResident(effectiveChunkId);
    const desiredState = token ? resolveTokenState(token, mapEntity.tokenStateId) : null;
    const desiredBase = token ? resolveSceneBasePlate(mapEntity, token, baseContext) : undefined;
    const definition = ASSET_BY_ID.get(mapEntity.assetId);
    const editorLightTag = definition?.editorOnly ? `editor-light:${JSON.stringify(mapEntity.light ?? definition.defaultBehavior)}` : "";
    const baseTag = token ? `baseplate:${desiredBase?.id ?? "legacy"}:${desiredBase?.updatedAt ?? token.base.color}` : "";
    if (root && root.tags.has("scene:interior") !== sceneInterior) {
      runtime.basePlateHandles.get(mapEntity.id)?.destroy();
      runtime.basePlateHandles.delete(mapEntity.id);
      root.destroy();
      runtime.objectRoots.delete(mapEntity.id);
      root = undefined;
    }
    if (root && desiredState && (!root.tags.has(`token-state:${desiredState.id}`) || !root.tags.has(baseTag))) {
      runtime.basePlateHandles.get(mapEntity.id)?.destroy();
      runtime.basePlateHandles.delete(mapEntity.id);
      root.destroy();
      runtime.objectRoots.delete(mapEntity.id);
      root = undefined;
    }
    if (root && editorLightTag && !root.tags.has(editorLightTag)) {
      root.destroy();
      runtime.objectRoots.delete(mapEntity.id);
      root = undefined;
    }
    const surfaceTag = `world-surfaces:${JSON.stringify(mapEntity.materialSlots ?? {})}:${mapEntity.materialAssetId ?? ""}`;
    if (root && mapEntity.worldGeometry && worldGeometrySources.get(root) !== mapEntity.worldGeometry) { root.destroy(); runtime.objectRoots.delete(mapEntity.id); root = undefined; }
    if (root && !root.tags.has(surfaceTag)) { root.destroy(); runtime.objectRoots.delete(mapEntity.id); root = undefined; }
    const desiredLod = effectiveChunkId ? runtime.worldStreaming.residentLod(effectiveChunkId) ?? runtime.worldVisibility?.lodByChunkId.get(effectiveChunkId) ?? 0 : 0;
    if (root && mapEntity.worldGeometry && !root.tags.has(`world-lod:${desiredLod}`)) {
      root.destroy(); runtime.objectRoots.delete(mapEntity.id); root = undefined;
    }
    if (!root && !resident) continue;
    if (!root && !chunkVisible && !effectiveChunkId) continue;
    if (!root) {
      root = createMapObject(runtime, mapEntity, tokenAssets, propAssets, materialAssets, runtime.contentRoot, baseContext, sceneInterior);
      runtime.objectRoots.set(mapEntity.id, root);
      worldGeometrySources.set(root, mapEntity.worldGeometry);
      root.tags.add(surfaceTag);
      for (const [role, materialId] of Object.entries(mapEntity.materialSlots ?? {})) {
        const surface = materialAssets.find((asset) => asset.id === materialId);
        if (!surface) continue;
        for (const target of root.findByTag(`world-material:${role}`)) {
          void applyMaterialAsset(runtime.app, target as pc.Entity, surface).catch(() => { if (!runtime.disposed) target.tags.add("missing-material-binary"); });
        }
      }
      if (mapEntity.build && Date.now() - Date.parse(mapEntity.build.placedAt) < 1_000) {
        runtime.placementAnimations.set(mapEntity.id, { startedAt: performance.now(), target: { ...mapEntity.scale } });
      }
    }
    if (mapEntity.id === map.journey?.activeBuildingId) for (const roof of root.findByTag("world-material:roof")) roof.enabled = false;
    root.enabled = chunkVisible && !mapEntity.hidden && (!definition?.editorOnly || runtime.mode === "build");
    root.setPosition(mapEntity.position.x, mapEntity.position.y, mapEntity.position.z);
    root.setEulerAngles(mapEntity.rotation.x, mapEntity.rotation.y, mapEntity.rotation.z);
    root.setLocalScale(mapEntity.scale.x, mapEntity.scale.y, mapEntity.scale.z);
    const customMaterial = materialForGeometry(materialAssets.find((entry) => entry.id === mapEntity.materialAssetId), mapEntity.assetId);
    if (customMaterial && !root.tags.has(`material:${customMaterial.id}:${customMaterial.updatedAt}`)) void applyMaterialAsset(runtime.app, root, customMaterial).then((loaded) => { if (loaded && !runtime.disposed && root.parent) root.tags.add(`material:${customMaterial.id}:${customMaterial.updatedAt}`); });
    applyLightProbeToEntity(runtime.lighting, root);
  }
  runtime.spatialHash = buildSpatialHash(map.entities, tokenAssets, propAssets);
  const contactShadowCount = map.entities.filter((entity) => tokenAssets.some((token) => token.id === entity.assetId) || ASSET_BY_ID.get(entity.assetId)?.id.startsWith("token-")).length;
  const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
  canvas.dataset.miniatureContactShadows = String(contactShadowCount);
  canvas.dataset.sceneClassification = sceneInterior ? "interior-direct-forward" : "exterior-camera-frame";
  canvas.dataset.miniatureContactShadowPolicy = "soft-radial-floor-decal";
  canvas.dataset.miniatureRimLighting = "fresnel-painted-miniatures";
  canvas.dataset.worldTerrainPipeline = map.world?.generatorRevision && map.world.generatorRevision >= 16 && map.generation?.blueprint.biome.id === "desert" ? "multi-band-seed+dune-initial-condition+particle-aeolian+mass-transport+localized-one-meter-tiers" : map.world?.generatorRevision && map.world.generatorRevision >= 16 ? "multi-band-seed+particle-hydraulic+thermal-settling+soil-layers+localized-one-meter-tiers" : map.world?.generatorRevision && map.world.generatorRevision >= 15 && map.generation?.blueprint.biome.id === "desert" ? "warped-fbm+particle-aeolian+deflation+abrasion+saltation+cascade+one-meter-terraces" : map.world?.generatorRevision && map.world.generatorRevision >= 14 ? "warped-fbm+particle-hydraulic+thermal-settling+soil-layers+one-meter-terraces" : map.world?.generatorRevision && map.world.generatorRevision >= 5 ? "warped-fbm+thermal-erosion+one-meter-terraces+catmull-road-deformation" : map.world?.generatorRevision && map.world.generatorRevision >= 4 ? "one-meter-rounded-terraces+painted-road-weight" : "legacy";
  canvas.dataset.worldRoadRendering = map.world?.generatorRevision && map.world.generatorRevision >= 14 ? "grade-limited-spline+single-terrain-weightmap" : map.entities.some((entity) => entity.worldGeometry?.kind === "road-ribbon") ? "terrain-weightmap+feathered-spline-decal" : map.world ? "terrain-weightmap" : "none";
  canvas.dataset.worldWaterRendering = map.entities.some((entity) => entity.tags?.includes("world:water")) ? "gerstner+dual-normal+depth-beer+probe-reflection+shore-foam" : "none";
  canvas.dataset.worldGrassRendering = map.entities.some((entity) => entity.worldGeometry?.kind === "ground-cover") ? "heightfield-root-locked+pbr-shadow-receiver+gpu-instanced-wind" : "none";
  canvas.dataset.worldFoliageRendering = map.entities.some((entity) => entity.worldGeometry?.kind === "space-colonized-tree") ? "space-colonization+separate-bark-leaf-pbr+animated-shadow-casters+lod" : map.entities.some((entity) => entity.assetId === "rock" && entity.tags?.includes("world:vegetation")) ? "biome-masked-rock-scatter" : map.entities.some((entity) => entity.tags?.includes("world:vegetation")) ? "procedural-branched-lod" : "none";
  canvas.dataset.worldTerrainNormals = map.world ? map.generation?.blueprint.biome.id === "desert" ? "sand-ripple+rock+road-weighted-normal-maps" : "grass+dirt+rock+snow+road-weighted-normal-maps" : "none";
  canvas.dataset.worldWaterTopology = map.entities.some((entity) => entity.worldGeometry?.kind === "water") ? "particle-discharge+momentum+shared-contour-surface" : "none";
  canvas.dataset.worldBuildingRendering = map.entities.some((entity) => entity.worldGeometry?.kind === "assembly") ? "ai-construction-recipes+structural-frames+curved-roofs" : map.entities.some((entity) => entity.worldGeometry?.kind === "cga-building") ? "cga-footprint+floors+facade-modules" : "none";
  canvas.dataset.worldTerrainShadows = map.world ? "cast-and-receive" : "legacy";
  canvas.dataset.worldVegetationWind = map.entities.some((entity) => entity.worldGeometry?.kind === "space-colonized-tree" || entity.worldGeometry?.kind === "ground-cover") ? "pbr-vertex-wind+player-bend+animated-shadow" : "none";
  canvas.dataset.worldBridgeCount = String(map.entities.filter((entity) => entity.tags?.includes("world:bridge")).length);
  const renderedRoots = [...runtime.objectRoots.values()].filter((root) => root.enabled);
  const terrainRoots = map.entities
    .filter((entity) => entity.worldGeometry?.kind === "terrain")
    .map((entity) => runtime.objectRoots.get(entity.id))
    .filter((root): root is pc.Entity => Boolean(root));
  const renderComponents = renderedRoots.flatMap((root) => root.findComponents("render") as pc.RenderComponent[]);
  const meshInstances = renderComponents.flatMap((component) => component.meshInstances ?? []);
  const finiteBounds = meshInstances.map((instance) => instance.aabb).filter((bounds) => {
    const center = bounds.center, half = bounds.halfExtents;
    return [center.x, center.y, center.z, half.x, half.y, half.z].every(Number.isFinite);
  });
  if (finiteBounds.length) {
    const minX = Math.min(...finiteBounds.map((bounds) => bounds.center.x - bounds.halfExtents.x));
    const minY = Math.min(...finiteBounds.map((bounds) => bounds.center.y - bounds.halfExtents.y));
    const minZ = Math.min(...finiteBounds.map((bounds) => bounds.center.z - bounds.halfExtents.z));
    const maxX = Math.max(...finiteBounds.map((bounds) => bounds.center.x + bounds.halfExtents.x));
    const maxY = Math.max(...finiteBounds.map((bounds) => bounds.center.y + bounds.halfExtents.y));
    const maxZ = Math.max(...finiteBounds.map((bounds) => bounds.center.z + bounds.halfExtents.z));
    canvas.dataset.worldRenderBounds = [minX, minY, minZ, maxX, maxY, maxZ].map((value) => value.toFixed(2)).join(",");
  } else canvas.dataset.worldRenderBounds = "none";
  canvas.dataset.worldObjectRoots = String(runtime.objectRoots.size);
  canvas.dataset.worldEnabledRoots = String(renderedRoots.length);
  canvas.dataset.worldTerrainRoots = String(terrainRoots.length);
  canvas.dataset.worldRenderComponents = String(renderComponents.length);
  canvas.dataset.worldMeshInstances = String(meshInstances.length);
  canvas.dataset.worldFiniteBounds = String(finiteBounds.length);
  const cameraPosition = runtime.camera.getPosition();
  canvas.dataset.worldCamera = [cameraPosition.x, cameraPosition.y, cameraPosition.z, runtime.orbit.target.x, runtime.orbit.target.y, runtime.orbit.target.z].map((value) => value.toFixed(2)).join(",");
  canvas.dataset.customMaterialProjections = map.entities.flatMap((entity) => {
    const material = materialAssets.find((entry) => entry.id === entity.materialAssetId);
    return material ? [`${entity.assetId}:${materialProjectionForGeometry(entity.assetId, material.projection)}`] : [];
  }).join(",");
};

const refreshWorldVisibility = (runtime: RuntimeScene, map: GameMap, selectedEntityId?: string | null): boolean => {
  if (!map.world) {
    const changed = runtime.worldVisibility !== null;
    runtime.worldVisibility = null;
    runtime.worldVisibilitySignature = "legacy";
    runtime.worldStreaming.reset();
    return changed;
  }
  const selected = selectedEntityId ? map.entities.find((entry) => entry.id === selectedEntityId)?.chunkId : undefined;
  const selectedChunkIds = new Set(selected ? [selected] : []);
  const interior = isInteriorMap(map)
    ? chunkIdForPosition(map.world, { x: runtime.orbit.target.x, y: runtime.orbit.target.y, z: runtime.orbit.target.z })
    : undefined;
  const next = computeWorldVisibility({
    manifest: map.world,
    cameraPosition: { x: runtime.camera.getPosition().x, y: runtime.camera.getPosition().y, z: runtime.camera.getPosition().z },
    cameraTarget: { x: runtime.orbit.target.x, y: runtime.orbit.target.y, z: runtime.orbit.target.z },
    quality: callbacksQuality(runtime), interiorChunkId: interior, selectedChunkIds, overview: runtime.worldOverview,
    verticalFovDegrees: runtime.camera.camera?.fov ?? 52,
    aspectRatio: Math.max(.25, runtime.app.graphicsDevice.width / Math.max(1, runtime.app.graphicsDevice.height)),
    farClip: Math.min(runtime.camera.camera?.farClip ?? 250, map.world.chunkSize * 12),
  });
  const signature = [...next.visibleChunkIds].sort().map((id) => `${id}:${next.lodByChunkId.get(id) ?? 2}`).join(",");
  const changed = signature !== runtime.worldVisibilitySignature;
  runtime.worldVisibility = next;
  runtime.worldVisibilitySignature = signature;
  const evicted = runtime.worldStreaming.update(map.world, next, performance.now());
  if (evicted.length) {
    const evictedSet = new Set(evicted);
    for (const entity of map.entities) if (entity.chunkId && evictedSet.has(entity.chunkId) && entity.tags?.some((tag) => tag.startsWith("world:"))) {
      runtime.objectRoots.get(entity.id)?.destroy(); runtime.objectRoots.delete(entity.id);
    }
  }
  const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
  canvas.dataset.visibleWorldChunks = String(next.visibleChunkIds.size);
  canvas.dataset.preloadedWorldChunks = String(next.preloadChunkIds.size);
  canvas.dataset.worldChunkBytes = String(next.estimatedBytes);
  canvas.dataset.worldChunkIds = signature;
  canvas.dataset.residentWorldChunks = String(runtime.worldStreaming.snapshot().filter((entry) => entry.resident).length);
  return changed;
};

const updateTokenMotions = (runtime: RuntimeScene, map: GameMap, tokenAssets: TokenAsset[], now: number): void => {
  let animated = 0;
  let stateful = 0;
  let skeletal = 0;
  let staticWithoutClip = 0;
  for (const mapEntity of map.entities) {
    const token = tokenAssets.find((entry) => entry.id === mapEntity.assetId);
    const root = runtime.objectRoots.get(mapEntity.id);
    if (!token || !root) continue;
    const state = resolveTokenState(token, mapEntity.tokenStateId);
    if ((token.states?.length ?? 0) > 1) stateful++;
    const requestedSource = state.animations.find((animation) => animation.id === mapEntity.tokenAnimationId);
    const idleSource = state.animations.find((animation) => animation.kind === "idle");
    const requested = requestedSource ? normalizeTokenAnimation(requestedSource) : undefined;
    const idle = idleSource ? normalizeTokenAnimation(idleSource) : undefined;
    let animation = requested ?? idle;
    if (!animation) continue;
    const startedAt = Date.parse(mapEntity.tokenAnimationStartedAt ?? "");
    const elapsed = animation.kind === "idle"
      ? now / 1000
      : Number.isFinite(startedAt) ? Math.max(0, (Date.now() - startedAt) / 1000) : animation.duration + 1;
    if (!animation.loop && elapsed >= animation.duration && idle && idle.id !== animation.id) {
      animation = idle;
    }
    const motionRoot = root.findByTag("token-motion-root")[0] as pc.Entity | undefined;
    if (!motionRoot) continue;
    const animComponent = (motionRoot.findComponents("anim")[0] as pc.AnimComponent | undefined);
    // Board placement owns the miniature's facing. Never synthesize yaw, pitch,
    // or roll for an unanimated GLB; only a real embedded skeletal clip may
    // animate the character itself.
    motionRoot.setLocalPosition(0, 0, 0);
    motionRoot.setLocalEulerAngles(0, 0, 0);
    motionRoot.setLocalScale(1, 1, 1);
    if (animComponent?.baseLayer?.states.includes(animation.id)) {
      if (animComponent.baseLayer.activeState !== animation.id) animComponent.baseLayer.play(animation.id);
      skeletal++;
      animated++;
    } else {
      if (animComponent?.baseLayer?.states.includes("START") && animComponent.baseLayer.activeState !== "START") animComponent.baseLayer.play("START");
      staticWithoutClip++;
    }
  }
  const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
  canvas.dataset.animatedTokens = String(animated);
  canvas.dataset.statefulTokens = String(stateful);
  canvas.dataset.skeletalAnimatedTokens = String(skeletal);
  canvas.dataset.staticTokensWithoutAnimationClip = String(staticWithoutClip);
  canvas.dataset.syntheticTokenRotation = "0";
  canvas.dataset.proceduralMotionFallback = "disabled";
  canvas.dataset.tokenRotationPolicy = "placed-facing-or-embedded-skeleton";
  canvas.dataset.tokenAnimationRuntime = "embedded-glb-skeletal-only-static-without-clip";
};

const spawnDust = (runtime: RuntimeScene, position: Vec3): void => {
  const dustMaterial = materialFor(runtime, "#9b7650");
  dustMaterial.opacity = .62;
  dustMaterial.blendType = pc.BLEND_NORMAL;
  dustMaterial.update();
  for (let index = 0; index < 8; index++) {
    const particle = new pc.Entity("Placement dust");
    particle.addComponent("render", { type: "sphere" });
    if (particle.render) particle.render.material = dustMaterial;
    const angle = index / 8 * Math.PI * 2;
    particle.setPosition(position.x, position.y + .04, position.z);
    particle.setLocalScale(.08, .04, .08);
    runtime.previewRoot.addChild(particle);
    runtime.dust.push({ entity: particle, velocity: new pc.Vec3(Math.cos(angle) * .75, .34 + index % 2 * .08, Math.sin(angle) * .75), startedAt: performance.now() });
  }
};

const playBuildSound = (kind: "snap" | "place" | "invalid", assetId?: string): void => {
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  const material = assetId?.includes("stone") ? "stone" : assetId?.includes("metal") ? "metal" : "wood";
  oscillator.type = kind === "invalid" ? "triangle" : kind === "snap" ? "sine" : "square";
  const startFrequency = kind === "snap" ? 980 : kind === "invalid" ? 105 : material === "stone" ? 72 : material === "metal" ? 138 : 92;
  oscillator.frequency.setValueAtTime(startFrequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(48, startFrequency * .55), now + (kind === "place" ? .14 : .055));
  gain.gain.setValueAtTime(kind === "place" ? .08 : .035, now);
  gain.gain.exponentialRampToValueAtTime(.0001, now + (kind === "place" ? .16 : .07));
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + (kind === "place" ? .17 : .08));
  oscillator.addEventListener("ended", () => void context.close());
};

interface DieGeometry {
  vertices: pc.Vec3[];
  faces: number[][];
}

const orientDieFaces = (geometry: DieGeometry): DieGeometry => ({
  vertices: geometry.vertices,
  faces: geometry.faces.map((source) => {
    const face = [...source];
    const a = geometry.vertices[face[0]];
    const b = geometry.vertices[face[1]];
    const c = geometry.vertices[face[2]];
    const normal = new pc.Vec3().cross(new pc.Vec3().sub2(b, a), new pc.Vec3().sub2(c, a));
    const centroid = face.reduce((sum, index) => sum.add(geometry.vertices[index]), new pc.Vec3()).mulScalar(1 / face.length);
    if (normal.dot(centroid) < 0) face.reverse();
    return face;
  }),
});

const normalizedDieGeometry = (vertices: number[][], faces: number[][], radius = .66): DieGeometry => {
  const vectors = vertices.map(([x, y, z]) => new pc.Vec3(x, y, z));
  const maximum = Math.max(...vectors.map((vertex) => vertex.length()));
  vectors.forEach((vertex) => vertex.mulScalar(radius / maximum));
  return orientDieFaces({ vertices: vectors, faces });
};

const icosahedronGeometry = (): DieGeometry => {
  const phi = (1 + Math.sqrt(5)) / 2;
  return normalizedDieGeometry([
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ], [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ]);
};

const dodecahedronGeometry = (): DieGeometry => {
  const source = icosahedronGeometry();
  const vertices = source.faces.map((face) => face.reduce((sum, index) => sum.add(source.vertices[index]), new pc.Vec3()).mulScalar(1 / face.length).normalize().mulScalar(.66));
  const faces = source.vertices.map((vertex, vertexIndex) => {
    const adjacent = source.faces.map((face, faceIndex) => face.includes(vertexIndex) ? faceIndex : -1).filter((faceIndex) => faceIndex >= 0);
    const axis = vertex.clone().normalize();
    const reference = Math.abs(axis.y) < .9 ? pc.Vec3.UP : pc.Vec3.RIGHT;
    const tangent = reference.clone().sub(axis.clone().mulScalar(reference.dot(axis))).normalize();
    const bitangent = new pc.Vec3().cross(axis, tangent).normalize();
    return adjacent.sort((left, right) => {
      const leftDirection = vertices[left].clone().sub(axis.clone().mulScalar(vertices[left].dot(axis)));
      const rightDirection = vertices[right].clone().sub(axis.clone().mulScalar(vertices[right].dot(axis)));
      return Math.atan2(leftDirection.dot(bitangent), leftDirection.dot(tangent)) - Math.atan2(rightDirection.dot(bitangent), rightDirection.dot(tangent));
    });
  });
  return orientDieFaces({ vertices, faces });
};

const trapezohedronGeometry = (): DieGeometry => {
  const vertices: number[][] = [[0, .92, 0], [0, -.92, 0]];
  for (let index = 0; index < 10; index++) {
    const angle = index * Math.PI / 5;
    vertices.push([Math.cos(angle), index % 2 === 0 ? .16 : -.16, Math.sin(angle)]);
  }
  const faces: number[][] = [];
  for (let index = 0; index < 10; index += 2) {
    faces.push([0, 2 + index, 2 + (index + 1) % 10, 2 + (index + 2) % 10]);
    faces.push([1, 2 + (index + 1) % 10, 2 + (index + 2) % 10, 2 + (index + 3) % 10]);
  }
  return normalizedDieGeometry(vertices, faces);
};

export const dieGeometry = (sides: number): DieGeometry => {
  if (sides === 4) return normalizedDieGeometry([[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]], [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]);
  if (sides === 6) return normalizedDieGeometry([
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ], [[3, 2, 1, 0], [4, 5, 6, 7], [7, 6, 2, 3], [0, 1, 5, 4], [1, 2, 6, 5], [4, 7, 3, 0]]);
  if (sides === 8) return normalizedDieGeometry([[0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]], [[0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 2], [1, 3, 2], [1, 4, 3], [1, 5, 4], [1, 2, 5]]);
  if (sides === 10 || sides === 100) return trapezohedronGeometry();
  if (sides === 12) return dodecahedronGeometry();
  return icosahedronGeometry();
};

export interface RoundedDieMeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export const roundedDieMeshData = (geometry: DieGeometry, bevel = .14): RoundedDieMeshData => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const insetByFace = new Map<number, Map<number, pc.Vec3>>();
  const faceNormals = geometry.faces.map((face) => faceNormal(geometry, face));
  const addTriangle = (a: pc.Vec3, b: pc.Vec3, c: pc.Vec3, na: pc.Vec3, nb: pc.Vec3, nc: pc.Vec3) => {
    const base = positions.length / 3;
    const outward = new pc.Vec3().cross(b.clone().sub(a), c.clone().sub(a)).dot(a.clone().add(b).add(c));
    const vertices = outward >= 0 ? [a, b, c] : [a, c, b];
    const vertexNormals = outward >= 0 ? [na, nb, nc] : [na, nc, nb];
    const projectionNormal = new pc.Vec3().cross(vertices[1].clone().sub(vertices[0]), vertices[2].clone().sub(vertices[0])).normalize();
    const reference = Math.abs(projectionNormal.y) < .82 ? pc.Vec3.UP : Math.abs(projectionNormal.x) < .82 ? pc.Vec3.RIGHT : pc.Vec3.FORWARD;
    const tangent = new pc.Vec3().cross(reference, projectionNormal).normalize();
    const bitangent = new pc.Vec3().cross(projectionNormal, tangent).normalize();
    // U receives half the normalized range because the source contains twice
    // as many horizontal pixels. This preserves isotropic texel density.
    const textureScale = 1.2;
    vertices.forEach((vertex, index) => {
      positions.push(vertex.x, vertex.y, vertex.z);
      const normal = vertexNormals[index];
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(.5 + vertex.dot(tangent) * textureScale * .5, .5 + vertex.dot(bitangent) * textureScale);
    });
    indices.push(base, base + 1, base + 2);
  };

  geometry.faces.forEach((face, faceIndex) => {
    const centroid = face.reduce((sum, index) => sum.add(geometry.vertices[index]), new pc.Vec3()).mulScalar(1 / face.length);
    const inset = new Map<number, pc.Vec3>();
    face.forEach((vertexIndex) => inset.set(vertexIndex, new pc.Vec3().lerp(geometry.vertices[vertexIndex], centroid, bevel)));
    insetByFace.set(faceIndex, inset);
    for (let index = 1; index < face.length - 1; index++) {
      addTriangle(inset.get(face[0])!, inset.get(face[index])!, inset.get(face[index + 1])!, faceNormals[faceIndex], faceNormals[faceIndex], faceNormals[faceIndex]);
    }
  });

  const edges = new Map<string, { faceIndex: number; start: number; end: number }[]>();
  geometry.faces.forEach((face, faceIndex) => face.forEach((start, index) => {
    const end = face[(index + 1) % face.length];
    const key = start < end ? `${start}:${end}` : `${end}:${start}`;
    const entries = edges.get(key) ?? [];
    entries.push({ faceIndex, start, end });
    edges.set(key, entries);
  }));
  edges.forEach((entries) => {
    if (entries.length !== 2) return;
    const first = entries[0];
    const second = entries[1];
    const firstInset = insetByFace.get(first.faceIndex)!;
    const secondInset = insetByFace.get(second.faceIndex)!;
    const a = firstInset.get(first.start)!;
    const b = firstInset.get(first.end)!;
    const c = secondInset.get(first.end)!;
    const d = secondInset.get(first.start)!;
    const na = faceNormals[first.faceIndex];
    const nb = faceNormals[second.faceIndex];
    addTriangle(a, b, c, na, na, nb);
    addTriangle(a, c, d, na, nb, nb);
  });

  geometry.vertices.forEach((vertex, vertexIndex) => {
    const incident = geometry.faces.flatMap((face, faceIndex) => face.includes(vertexIndex) ? [{ point: insetByFace.get(faceIndex)!.get(vertexIndex)!, normal: faceNormals[faceIndex] }] : []);
    if (incident.length < 3) return;
    const axis = vertex.clone().normalize();
    const reference = Math.abs(axis.y) < .9 ? pc.Vec3.UP : pc.Vec3.RIGHT;
    const tangent = reference.clone().sub(axis.clone().mulScalar(reference.dot(axis))).normalize();
    const bitangent = new pc.Vec3().cross(axis, tangent).normalize();
    incident.sort((left, right) => {
      const leftOffset = left.point.clone().sub(vertex);
      const rightOffset = right.point.clone().sub(vertex);
      return Math.atan2(leftOffset.dot(bitangent), leftOffset.dot(tangent)) - Math.atan2(rightOffset.dot(bitangent), rightOffset.dot(tangent));
    });
    const corner = vertex.clone().mulScalar(1 - bevel * .34);
    for (let index = 0; index < incident.length; index++) {
      const current = incident[index];
      const next = incident[(index + 1) % incident.length];
      addTriangle(corner, current.point, next.point, axis, current.point.clone().normalize(), next.point.clone().normalize());
    }
  });
  const triangleCount = indices.length / 3;
  if (triangleCount > MAX_PROCEDURAL_DIE_TRIANGLES) {
    throw new Error(`Procedural die geometry exceeded its ${MAX_PROCEDURAL_DIE_TRIANGLES}-triangle budget`);
  }
  return { positions, normals, uvs, indices };
};

const createDieMesh = (runtime: RuntimeScene, geometry: DieGeometry): pc.Mesh => {
  const data = roundedDieMeshData(geometry);
  const mesh = new pc.Mesh(runtime.app.graphicsDevice);
  mesh.setPositions(data.positions);
  mesh.setNormals(data.normals);
  mesh.setUvs(0, data.uvs);
  mesh.setIndices(data.indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
};

const faceNormal = (geometry: DieGeometry, face: number[]): pc.Vec3 => {
  const a = geometry.vertices[face[0]];
  return new pc.Vec3().cross(new pc.Vec3().sub2(geometry.vertices[face[1]], a), new pc.Vec3().sub2(geometry.vertices[face[2]], a)).normalize();
};

const addDieNumber = (runtime: RuntimeScene, die: pc.Entity, geometry: DieGeometry, face: number[], value: string, scale: number, inkColor = "#ead9aa", outlineColor = "#0d0805"): { material: pc.StandardMaterial; textures: pc.Texture[] } => {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, 128, 128);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `bold ${value.length >= 3 ? 46 : value.length >= 2 ? 61 : 72}px Georgia`;
  context.lineWidth = 6;
  context.strokeStyle = outlineColor;
  context.strokeText(String(value), 64, 66);
  context.fillStyle = inkColor;
  context.fillText(String(value), 64, 66);
  const texture = new pc.Texture(runtime.app.graphicsDevice, { name: `d${value}-number`, width: 128, height: 128, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR });
  texture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
  texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
  texture.anisotropy = 4;
  texture.setSource(canvas);
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = 128;
  maskCanvas.height = 128;
  const maskContext = maskCanvas.getContext("2d")!;
  maskContext.textAlign = "center";
  maskContext.textBaseline = "middle";
  maskContext.font = context.font;
  maskContext.lineWidth = 8;
  maskContext.strokeStyle = "white";
  maskContext.fillStyle = "white";
  maskContext.strokeText(String(value), 64, 66);
  maskContext.fillText(String(value), 64, 66);
  const mask = maskContext.getImageData(0, 0, 128, 128).data;
  const normalCanvas = document.createElement("canvas");
  normalCanvas.width = 128;
  normalCanvas.height = 128;
  const normalContext = normalCanvas.getContext("2d")!;
  const normalImage = normalContext.createImageData(128, 128);
  const heightAt = (x: number, y: number) => mask[(Math.max(0, Math.min(127, y)) * 128 + Math.max(0, Math.min(127, x))) * 4 + 3] / 255;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const dx = (heightAt(x + 2, y) - heightAt(x - 2, y)) * 72;
    const dy = (heightAt(x, y + 2) - heightAt(x, y - 2)) * 72;
    const index = (y * 128 + x) * 4;
    normalImage.data.set([128 - Math.round(dx), 128 + Math.round(dy), 250, 255], index);
  }
  normalContext.putImageData(normalImage, 0, 0);
  const normalTexture = new pc.Texture(runtime.app.graphicsDevice, { name: `d${value}-engraving-normal`, width: 128, height: 128, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR });
  normalTexture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
  normalTexture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
  normalTexture.anisotropy = 4;
  normalTexture.setSource(normalCanvas);
  const material = new pc.StandardMaterial();
  material.name = `Inlaid die number ${value}`;
  material.useLighting = true;
  material.diffuse = pc.Color.WHITE;
  material.diffuseMap = texture;
  material.normalMap = normalTexture;
  material.bumpiness = 1.35;
  material.gloss = .28;
  material.specularityFactor = .25;
  material.opacityMap = texture;
  material.opacityMapChannel = "a";
  material.alphaTest = .18;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  const normal = faceNormal(geometry, face);
  const centroid = face.reduce((sum, vertexIndex) => sum.add(geometry.vertices[vertexIndex]), new pc.Vec3()).mulScalar(1 / face.length);
  const reference = Math.abs(normal.y) < .88 ? pc.Vec3.UP : pc.Vec3.FORWARD;
  const vertical = reference.clone().sub(normal.clone().mulScalar(reference.dot(normal))).normalize();
  const horizontal = new pc.Vec3().cross(vertical, normal).normalize();
  const center = centroid.clone().add(normal.clone().mulScalar(.008));
  const positions = [
    center.clone().sub(horizontal.clone().mulScalar(scale)).add(vertical.clone().mulScalar(scale)),
    center.clone().add(horizontal.clone().mulScalar(scale)).add(vertical.clone().mulScalar(scale)),
    center.clone().add(horizontal.clone().mulScalar(scale)).sub(vertical.clone().mulScalar(scale)),
    center.clone().sub(horizontal.clone().mulScalar(scale)).sub(vertical.clone().mulScalar(scale)),
  ];
  const mesh = new pc.Mesh(runtime.app.graphicsDevice);
  mesh.setPositions(positions.flatMap((position) => [position.x, position.y, position.z]));
  mesh.setNormals(Array.from({ length: 4 }, () => [normal.x, normal.y, normal.z]).flat());
  mesh.setUvs(0, [0, 0, 1, 0, 1, 1, 0, 1]);
  mesh.setIndices([0, 1, 2, 0, 2, 3]);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const label = new pc.Entity(`Engraved die face ${value}`);
  label.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: false, receiveShadows: false });
  die.addChild(label);
  return { material, textures: [texture, normalTexture] };
};

const addDieNumbers = (runtime: RuntimeScene, die: pc.Entity, geometry: DieGeometry, sides: number, result: number, resultFaceIndex?: number, theme?: DiceTheme): { material: pc.StandardMaterial; textures: pc.Texture[] }[] => {
  const fallbackOrder = geometry.faces.map((_, index) => index).sort((left, right) => faceNormal(geometry, geometry.faces[right]).y - faceNormal(geometry, geometry.faces[left]).y);
  const selected = resultFaceIndex ?? fallbackOrder[0];
  const orderedFaces = [selected, ...fallbackOrder.filter((index) => index !== selected)].map((index) => geometry.faces[index]);
  const ordinary = sides === 100 ? ["00", "10", "20", "30", "40", "50", "60", "70", "80", "90"] : Array.from({ length: sides }, (_, index) => String(index + 1));
  const resultLabel = sides === 100 ? String(result).padStart(2, "0") : String(result);
  const remaining = ordinary.filter((value) => value !== resultLabel);
  const values = [resultLabel, ...remaining];
  const scale = sides >= 20 ? .14 : sides >= 12 ? .16 : sides >= 10 ? .18 : sides >= 8 ? .2 : .235;
  return orderedFaces.map((face, index) => addDieNumber(runtime, die, geometry, face, values[index] ?? ordinary[index % ordinary.length], scale, theme?.numberColor, theme?.numberOutlineColor));
};

const screenGroundPoint = (runtime: RuntimeScene, xRatio: number, yRatio: number): pc.Vec3 => {
  const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
  const near = runtime.camera.camera?.screenToWorld(canvas.offsetWidth * xRatio, canvas.offsetHeight * yRatio, .1);
  const far = runtime.camera.camera?.screenToWorld(canvas.offsetWidth * xRatio, canvas.offsetHeight * yRatio, 1000);
  if (!near || !far) return runtime.orbit.target.clone();
  const direction = far.clone().sub(near);
  if (Math.abs(direction.y) < .0001) return runtime.orbit.target.clone();
  const distance = -near.y / direction.y;
  return distance > 0 ? near.clone().add(direction.mulScalar(distance)) : runtime.orbit.target.clone();
};

const diceLandingCenter = (runtime: RuntimeScene): pc.Vec3 => {
  const center = screenGroundPoint(runtime, .44, .52);
  const candidates = [
    center,
    center.clone().add(new pc.Vec3(1.4, 0, 0)),
    center.clone().add(new pc.Vec3(-1.4, 0, 0)),
    center.clone().add(new pc.Vec3(0, 0, 1.4)),
    center.clone().add(new pc.Vec3(0, 0, -1.4)),
    center.clone().add(new pc.Vec3(1.8, 0, 1.2)),
    center.clone().add(new pc.Vec3(-1.8, 0, -1.2)),
  ];
  return candidates.find((candidate) => runtime.spatialHash.query(candidate, 1.3).every((entity) => {
    const spec = buildSpec(entity.assetId);
    if (!spec || spec.shape === "floor" || spec.shape === "wall") return true;
    return Math.hypot(entity.position.x - candidate.x, entity.position.z - candidate.z) > Math.max(1.1, spec.footprint * .8);
  })) ?? center;
};

const disposeDieThrow = (die: RuntimeScene["diceThrows"][number]): void => {
  die.trail.forEach((segment) => segment.entity.destroy());
  die.trailMaterial?.destroy();
  die.particleTrail?.destroy();
  die.entity.destroy();
  die.material.destroy();
  die.numberMaterials.forEach((material) => material.destroy());
  die.numberTextures.forEach((texture) => texture.destroy());
};

const createDiceEffectMaterial = (color: string, intensity: number): pc.StandardMaterial => {
  const material = new pc.StandardMaterial();
  const tint = toColor(color);
  material.diffuse = tint;
  material.emissive = tint;
  material.emissiveIntensity = intensity * 2;
  material.opacity = .82;
  material.blendType = pc.BLEND_ADDITIVE;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
};

const spawnDiceImpact = (runtime: RuntimeScene, position: pc.Vec3, theme?: DiceTheme): void => {
  const impact = resolveDiceEffects(theme?.effects).impact;
  const particles = resolveDiceEffects(theme?.effects).particles;
  if (!impact.enabled && !(particles.enabled && ["impact", "both"].includes(particles.emission))) return;
  const material = createDiceEffectMaterial(impact.color, impact.intensity);
  const ring = new pc.Entity(`${impact.style} dice landing ring`);
  ring.addComponent("render", { meshInstances: [new pc.MeshInstance(pc.createTorus(runtime.app.graphicsDevice, { tubeRadius: .035, ringRadius: .42, segments: 40, sides: 8 }), material)], castShadows: false, receiveShadows: false });
  ring.setPosition(position.x, .055, position.z);
  runtime.diceEffectsRoot.addChild(ring);
  const sparks: pc.Entity[] = [];
  const count = impact.style === "shockwave" ? 6 : impact.style === "rune-burst" ? 10 : 12;
  for (let index = 0; index < count; index++) {
    const spark = new pc.Entity(`${impact.style} impact mote ${index + 1}`);
    spark.addComponent("render", { type: impact.style === "shards" ? "cone" : impact.style === "rune-burst" ? "box" : "sphere" });
    if (spark.render) { spark.render.material = material; spark.render.castShadows = false; spark.render.receiveShadows = false; }
    spark.setPosition(position.x, .075, position.z);
    const width = impact.style === "shards" ? .055 : .045;
    spark.setLocalScale(width, impact.style === "shards" ? .2 : width, width);
    runtime.diceEffectsRoot.addChild(spark);
    sparks.push(spark);
  }
  ring.enabled = impact.enabled;
  sparks.forEach((spark) => { spark.enabled = impact.enabled; });
  const particleEmitter = createDiceParticleEmitter(runtime.app, particles, "impact", `${particles.style} dice impact particles`);
  if (particleEmitter) {
    particleEmitter.entity.setPosition(position.x, .075, position.z);
    runtime.diceEffectsRoot.addChild(particleEmitter.entity);
  }
  runtime.diceImpacts.push({ ring, sparks, particleBurst: particleEmitter?.entity, material, startedAt: performance.now(), duration: Math.max(impact.enabled ? impact.duration : 0, particleEmitter?.duration ?? 0), size: impact.size, style: impact.style });
  const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
  canvas.dataset.diceImpactEffect = impact.style;
};

const setDiceTaaSuspended = (runtime: RuntimeScene, suspended: boolean): void => {
  if (runtime.diceTaaSuspended === suspended) return;
  runtime.diceTaaSuspended = suspended;
  const frame = runtime.lighting.cameraFrame;
  if (!frame) return;
  const antialiasing = (runtime.app.graphicsDevice.canvas as HTMLCanvasElement).dataset.antialiasing;
  frame.taa.enabled = suspended ? false : antialiasing === "taa";
  frame.updateOptions();
};

const throwPhysicalDice = async (runtime: RuntimeScene, detail: PresentedDiceRoll, diceThemes: DiceTheme[], assignments: Partial<Record<`d${DiceSides}`, string>>): Promise<void> => {
  const generation = ++runtime.diceThrowGeneration;
  const throwCanvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
  throwCanvas.dataset.diceThrowGeneration = String(generation);
  throwCanvas.dataset.diceRollProgress = "0";
  throwCanvas.dataset.diceObservedMotion = "false";
  runtime.diceThrows.forEach(disposeDieThrow);
  runtime.diceThrows = [];
  runtime.diceRollDetail = detail;
  runtime.diceMergeStartedAt = null;
  runtime.diceTotalRevealed = false;
  runtime.onDiceSum(null);
  const palette: [number, number, number][] = [[.15, .55, .48], [.35, .26, .64], [.63, .28, .2], [.18, .42, .68], [.58, .4, .12]];
  const center = diceLandingCenter(runtime);
  const sourceTerms = detail.terms ?? [{ sides: detail.sides, rolls: detail.rolls }];
  const physicalRolls = sourceTerms.flatMap((term) => term.sides === 100
    ? term.rolls.flatMap((roll) => {
        const percentile = roll === 100 ? 0 : roll;
        return [{ roll: Math.floor(percentile / 10) * 10, sides: 100 }, { roll: percentile % 10 || 10, sides: 10 }];
      })
    : term.rolls.map((roll) => ({ roll, sides: term.sides })));
  const visibleRolls = physicalRolls.slice(0, 12);
  const themeFor = (sides: number): DiceTheme | undefined => diceThemes.find((theme) => theme.id === assignments[`d${sides}` as `d${DiceSides}`]);
  const startBase = screenGroundPoint(runtime, .96, .5);
  const prepared = visibleRolls.map(({ roll, sides }, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const lateral = (column - (Math.min(visibleRolls.length, 4) - 1) / 2) * 1.28;
    const depth = (row - Math.floor((visibleRolls.length - 1) / 4) / 2) * 1.28;
    const landing = new pc.Vec3(center.x + lateral, .7, center.z + depth);
    const spawn = new pc.Vec3(startBase.x - row * .18, 2.35 + row * .14, startBase.z + (column - 1.5) * .92);
    return { roll, sides, geometry: dieGeometry(sides), landing, spawn, theme: themeFor(sides) };
  });
  const themeTextures = new Map<string, DiceThemePbrTextures>();
  await Promise.all([...new Map(prepared.filter((entry) => entry.theme).map((entry) => [entry.theme!.id, entry.theme!])).values()].map(async (theme) => {
    themeTextures.set(theme.id, await loadDiceThemePbrTextures(runtime.app, theme));
  }));
  const trajectories = await simulateDicePhysics(prepared.map((entry) => ({
    vertices: entry.geometry.vertices,
    faces: entry.geometry.faces,
    spawn: entry.spawn,
    landingHint: entry.landing,
  })), runtime.mapBounds);
  if (generation !== runtime.diceThrowGeneration) return;
  setDiceTaaSuspended(runtime, true);
  const batchStartedAt = performance.now();
  prepared.forEach(({ roll, sides, geometry, theme }, index) => {
    const trajectory = trajectories[index];
    const entity = new pc.Entity(`${detail.expression} physical die ${index + 1}`);
    const color = palette[(sides + index) % palette.length];
    const material = theme
      ? createThemedDiceMaterial(theme, themeTextures.get(theme.id) ?? {}, runtime.app.graphicsDevice)
      : createResinDiceMaterial(color, runtime.app.graphicsDevice);
    applyLightweightAmbientToMaterial(runtime.lighting, material);
    const effects = resolveDiceEffects(theme?.effects);
    const trailMaterial = effects.trail.enabled ? createDiceEffectMaterial(effects.trail.color, effects.trail.intensity) : undefined;
    const particleTrail = createDiceParticleEmitter(runtime.app, effects.particles, "trail", `${effects.particles.style} physical dice trail`);
    if (particleTrail) runtime.diceEffectsRoot.addChild(particleTrail.entity);
    entity.addComponent("render", { meshInstances: [new pc.MeshInstance(createDieMesh(runtime, geometry), material)] });
    const numberAssets = addDieNumbers(runtime, entity, geometry, sides, roll, trajectory.topFaceIndex, theme);
    const first = trajectory.frames[0];
    entity.setPosition(first.position.x, first.position.y, first.position.z);
    entity.setRotation(first.rotation.x, first.rotation.y, first.rotation.z, first.rotation.w);
    if (entity.render) {
      entity.render.castShadows = true;
      // Convex dice are fully shaded by the PBR lights and only need to cast a
      // contact shadow onto the board. Disabling self-sampling prevents the
      // same striped shadow acne removed from the Dice Forge preview.
      entity.render.receiveShadows = false;
    }
    runtime.diceRoot.addChild(entity);
    runtime.diceThrows.push({
      entity,
      material,
      numberMaterials: numberAssets.map((asset) => asset.material),
      numberTextures: numberAssets.flatMap((asset) => asset.textures),
      value: roll,
      frames: trajectory.frames,
      duration: Math.max(1 / 60, (trajectory.frames.length - 1) / 60),
      startedAt: batchStartedAt,
      settledAt: null,
      settledPosition: null,
      theme,
      trailMaterial,
      particleTrail: particleTrail?.entity,
      trail: [],
      lastTrailAt: 0,
      impactTriggered: false,
    });
  });
  const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
  canvas.dataset.diceThrows = String(runtime.diceThrows.length);
  canvas.dataset.lastDiceTotal = String(detail.total);
  canvas.dataset.diceNumbered = "true";
  canvas.dataset.diceThrowZone = "right-to-inner-board";
  canvas.dataset.diceBatchSize = String(visibleRolls.length);
  canvas.dataset.diceMotion = "rapier-rigid-body-random-toss";
  canvas.dataset.dicePhysics = "convex-hull-friction-restitution-collisions";
  canvas.dataset.diceThemes = [...new Set(prepared.map((entry) => entry.theme?.name).filter(Boolean))].join(",") || "default";
  canvas.dataset.diceSurfaceEffects = prepared.some((entry) => resolveDiceEffects(entry.theme?.effects).surface.enabled) ? "animated" : "off";
  canvas.dataset.diceTrailEffects = prepared.some((entry) => resolveDiceEffects(entry.theme?.effects).trail.enabled) ? "active" : "off";
  canvas.dataset.diceParticleSystem = prepared.some((entry) => resolveDiceEffects(entry.theme?.effects).particles.enabled) ? "gpu-bounded-billboards" : "off";
  canvas.dataset.resinTransmission = "thickness-map-clearcoat-attenuation";
  const actualSpawn = trajectories[0]?.frames[0]?.position;
  const spawnScreen = actualSpawn ? runtime.camera.camera?.worldToScreen(new pc.Vec3(actualSpawn.x, actualSpawn.y, actualSpawn.z)) : null;
  if (spawnScreen) canvas.dataset.diceSpawnScreenX = String(spawnScreen.x / canvas.offsetWidth);
};

const rebuildGrid = (runtime: RuntimeScene, map: GameMap, showGrid: boolean): void => {
  for (const child of [...runtime.gridRoot.children]) child.destroy();
  runtime.gridMaterial?.destroy();
  runtime.gridMaterial = null;
  runtime.gridRoot.enabled = showGrid;
  const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
  canvas.dataset.gridVisible = String(showGrid);
  canvas.dataset.gridShape = map.gridShape ?? "square";
  canvas.dataset.gridProjection = "world-space-derivative-aa";
  if (!showGrid) return;
  const width = Math.min(60, Math.max(8, map.width));
  const depth = Math.min(60, Math.max(8, map.depth));
  const overlay = new pc.Entity("World-space grid shader");
  overlay.addComponent("render", { type: "plane" });
  overlay.setLocalPosition(0, .038, 0);
  overlay.setLocalScale(width, 1, depth);
  const gridMaterial = createWorldGridMaterial(map.gridSize, runtime.camera.getPosition(), map.gridShape ?? "square");
  if (overlay.render) {
    overlay.render.material = gridMaterial;
    overlay.render.castShadows = false;
    overlay.render.receiveShadows = false;
  }
  runtime.gridRoot.addChild(overlay);
  runtime.gridMaterial = gridMaterial;
};

const fogRevealers = (map: GameMap, tokenAssets: TokenAsset[]) => {
  const tokenIds = new Set(tokenAssets.filter((token) => token.kind === "player").map((token) => token.id));
  const revealers = map.entities
    .filter((entity) => entity.assetId === "token-hero" || entity.assetId === "token-rogue" || tokenIds.has(entity.assetId))
    .map((entity) => ({ x: entity.position.x, z: entity.position.z, radius: 4.5 * Math.max(entity.scale.x, entity.scale.z) }));
  for (const point of map.pointsOfInterest?.filter((entry) => entry.discovered) ?? []) revealers.push({ x: point.position.x, z: point.position.z, radius: 3.2 });
  if (!revealers.length) revealers.push({ x: 0, z: 0, radius: Math.min(map.width, map.depth) * .18 });
  return revealers;
};

const paintFogReveal = (context: CanvasRenderingContext2D, map: GameMap, size: number, reveal: { x: number; z: number; radius: number }): void => {
  const centerX = (reveal.x / map.width + .5) * size;
  const centerY = (reveal.z / map.depth + .5) * size;
  const radiusX = Math.max(1, reveal.radius / map.width * size);
  const radiusY = Math.max(1, reveal.radius / map.depth * size);
  context.save();
  context.translate(centerX, centerY);
  context.scale(radiusX, radiusY);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(.78, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, 1, 0, Math.PI * 2);
  context.fill();
  context.restore();
};

const updateFogOfWarMask = (runtime: RuntimeScene, map: GameMap, tokenAssets: TokenAsset[], force = false): void => {
  const state = runtime.fogMaskState;
  if (!state || !runtime.fogTexture || state.mapId !== map.id) return;
  const now = performance.now();
  const revealers = fogRevealers(map, tokenAssets);
  const signature = revealers.map((entry) => `${entry.x.toFixed(2)},${entry.z.toFixed(2)},${entry.radius.toFixed(2)}`).join("|");
  if (!force && (signature === state.lastSignature || now - state.lastUpdatedAt < 100)) return;
  state.lastSignature = signature;
  state.lastUpdatedAt = now;
  state.activeContext.clearRect(0, 0, state.size, state.size);
  for (const reveal of revealers) {
    paintFogReveal(state.activeContext, map, state.size, reveal);
    paintFogReveal(state.exploredContext, map, state.size, reveal);
  }
  const active = state.activeContext.getImageData(0, 0, state.size, state.size);
  const explored = state.exploredContext.getImageData(0, 0, state.size, state.size);
  const output = state.outputContext.createImageData(state.size, state.size);
  for (let index = 0; index < output.data.length; index += 4) {
    output.data[index] = active.data[index + 3];
    output.data[index + 1] = explored.data[index + 3];
    output.data[index + 2] = 0;
    output.data[index + 3] = 255;
  }
  state.outputContext.putImageData(output, 0, 0);
  runtime.fogTexture.setSource(state.outputCanvas);
  const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
  canvas.dataset.fogMaskPipeline = "webgl2-render-texture-10hz";
  canvas.dataset.fogMaskChannels = "red-current-green-explored";
  canvas.dataset.fogRevealerCount = String(revealers.length);
};

const rebuildFogOfWar = (runtime: RuntimeScene, map: GameMap, tokenAssets: TokenAsset[]): void => {
  if (!map.lighting?.fogOfWar) {
    if (runtime.fogMaskState) runtime.fogExplorationCache.set(runtime.fogMaskState.mapId, runtime.fogMaskState.exploredContext.getImageData(0, 0, runtime.fogMaskState.size, runtime.fogMaskState.size));
    for (const child of [...runtime.fogRoot.children]) child.destroy();
    runtime.fogTexture?.destroy();
    runtime.fogMaterial?.destroy();
    runtime.fogTexture = null;
    runtime.fogMaterial = null;
    runtime.fogMaskState = null;
    return;
  }
  const existing = runtime.fogMaskState;
  if (existing?.mapId === map.id && existing.width === map.width && existing.depth === map.depth) {
    updateFogOfWarMask(runtime, map, tokenAssets, true);
    return;
  }
  if (existing) runtime.fogExplorationCache.set(existing.mapId, existing.exploredContext.getImageData(0, 0, existing.size, existing.size));
  for (const child of [...runtime.fogRoot.children]) child.destroy();
  runtime.fogTexture?.destroy();
  runtime.fogMaterial?.destroy();
  const size = 256;
  const makeCanvas = () => { const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size; return canvas; };
  const activeCanvas = makeCanvas();
  const exploredCanvas = makeCanvas();
  const outputCanvas = makeCanvas();
  const activeContext = activeCanvas.getContext("2d", { willReadFrequently: true })!;
  const exploredContext = exploredCanvas.getContext("2d", { willReadFrequently: true })!;
  const outputContext = outputCanvas.getContext("2d", { willReadFrequently: true })!;
  const cached = runtime.fogExplorationCache.get(map.id);
  if (cached?.width === size && cached.height === size) exploredContext.putImageData(cached, 0, 0);
  runtime.fogMaskState = { mapId: map.id, width: map.width, depth: map.depth, size, activeCanvas, exploredCanvas, outputCanvas, activeContext, exploredContext, outputContext, lastSignature: "", lastUpdatedAt: 0 };
  const texture = new pc.Texture(runtime.app.graphicsDevice, { name: "Dynamic fog of war mask", width: size, height: size, format: pc.PIXELFORMAT_RGBA8, mipmaps: false, minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR });
  texture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
  texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
  runtime.fogTexture = texture;
  updateFogOfWarMask(runtime, map, tokenAssets, true);
  const material = createFogOfWarMaterial(texture);
  material.setParameter("uMapMin", [-map.width / 2, -map.depth / 2]);
  material.setParameter("uMapMax", [map.width / 2, map.depth / 2]);
  const veil = new pc.Entity("Fog of war veil");
  veil.addComponent("render", { type: "plane" });
  veil.setLocalPosition(0, .068, 0);
  veil.setLocalScale(map.width, 1, map.depth);
  if (veil.render) {
    veil.render.material = material;
    veil.render.castShadows = false;
    veil.render.receiveShadows = false;
  }
  runtime.fogRoot.addChild(veil);
  runtime.fogMaterial = material;
};

const updateCamera = (runtime: RuntimeScene): void => {
  const { yaw, pitch, distance, target } = runtime.orbit;
  const yawRadians = yaw * pc.math.DEG_TO_RAD;
  const pitchRadians = pitch * pc.math.DEG_TO_RAD;
  const horizontal = distance * Math.cos(pitchRadians);
  runtime.camera.setPosition(
    target.x + Math.sin(yawRadians) * horizontal,
    target.y + Math.sin(pitchRadians) * distance,
    target.z + Math.cos(yawRadians) * horizontal,
  );
  const proposed = runtime.camera.getPosition();
  runtime.camera.setPosition(proposed.x, Math.max(proposed.y, (worldHeight(runtime.app, proposed.x, proposed.z) ?? runtime.terrainHeight(proposed.x, proposed.z)) + 1.6), proposed.z);
  runtime.camera.lookAt(target);
  const cameraPosition = runtime.camera.getPosition();
  runtime.gridMaterial?.setParameter("uCameraPosition", [cameraPosition.x, cameraPosition.y, cameraPosition.z]);
};

const groundPoint = (runtime: RuntimeScene, map: GameMap, canvas: HTMLCanvasElement, clientX: number, clientY: number): pc.Vec3 | null => {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * canvas.offsetWidth;
  const y = ((clientY - rect.top) / rect.height) * canvas.offsetHeight;
  const near = runtime.camera.camera?.screenToWorld(x, y, 0.1);
  const far = runtime.camera.camera?.screenToWorld(x, y, 1000);
  if (!near || !far) return null;
  const direction = far.clone().sub(near).normalize();
  const terrain = map.entities.filter((entry) => entry.worldGeometry?.kind === "terrain");
  let previousDistance = 0, previousDelta = Number.POSITIVE_INFINITY;
  for (let distance = 0; distance <= 1000; distance += 1.5) {
    const x = near.x + direction.x * distance, y = near.y + direction.y * distance, z = near.z + direction.z * distance;
    const owner = terrain.find((entry) => entry.worldGeometry?.kind === "terrain" && x >= entry.worldGeometry.originX && x <= entry.worldGeometry.originX + entry.worldGeometry.size && z >= entry.worldGeometry.originZ && z <= entry.worldGeometry.originZ + entry.worldGeometry.size);
    if (!owner || owner.worldGeometry?.kind !== "terrain") { previousDistance = distance; previousDelta = Number.POSITIVE_INFINITY; continue; }
    const delta = y - sampleTerrainHeight(owner.worldGeometry, x, z);
    if (delta <= 0 && previousDelta > 0 && Number.isFinite(previousDelta)) {
      let low = previousDistance, high = distance;
      for (let pass = 0; pass < 10; pass++) {
        const middle = (low + high) * .5, mx = near.x + direction.x * middle, mz = near.z + direction.z * middle;
        const middleOwner = terrain.find((entry) => entry.worldGeometry?.kind === "terrain" && mx >= entry.worldGeometry.originX && mx <= entry.worldGeometry.originX + entry.worldGeometry.size && mz >= entry.worldGeometry.originZ && mz <= entry.worldGeometry.originZ + entry.worldGeometry.size);
        const terrainY = middleOwner?.worldGeometry?.kind === "terrain" ? sampleTerrainHeight(middleOwner.worldGeometry, mx, mz) : 0;
        if (near.y + direction.y * middle > terrainY) low = middle; else high = middle;
      }
      const hitDistance = (low + high) * .5, hitX = near.x + direction.x * hitDistance, hitZ = near.z + direction.z * hitDistance;
      return new pc.Vec3(hitX, near.y + direction.y * hitDistance, hitZ);
    }
    previousDistance = distance; previousDelta = delta;
  }
  if (Math.abs(direction.y) < 0.0001) return null;
  const distance = -near.y / direction.y;
  if (distance < 0) return null;
  return near.clone().add(direction.mulScalar(distance));
};

const screenRay = (runtime: RuntimeScene, canvas: HTMLCanvasElement, clientX: number, clientY: number): { origin: Vec3; direction: Vec3 } | null => {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * canvas.offsetWidth, y = ((clientY - rect.top) / rect.height) * canvas.offsetHeight;
  const near = runtime.camera.camera?.screenToWorld(x, y, .1), far = runtime.camera.camera?.screenToWorld(x, y, 1000);
  if (!near || !far) return null;
  const direction = far.clone().sub(near).normalize();
  return { origin: { x: near.x, y: near.y, z: near.z }, direction: { x: direction.x, y: direction.y, z: direction.z } };
};

function PlayCanvasSceneViewport({ map, tokenAssets, propAssets = [], materialAssets = [], basePlateAssets = [], campaignBasePlateAssignments, sceneBasePlateAssignments, tokenCharacterLinks, selectedEntityId, activeAssetId, showGrid, onPlace, onSelect, onPipette, environmentPanorama = null, diceThemes = [], diceThemeAssignments = {}, mode = "build", focusAssetId = null, worldOverview = false }: SceneViewportProps) {
  const displaySettings = useDisplaySettings();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RuntimeScene | null>(null);
  const callbacksRef = useRef({ onPlace, onSelect, onPipette, activeAssetId, selectedEntityId, focusAssetId, mode, map, tokenAssets, propAssets, materialAssets, basePlateAssets, campaignBasePlateAssignments, sceneBasePlateAssignments, tokenCharacterLinks, diceThemes, diceThemeAssignments, displaySettings, worldOverview });
  const ghostStateRef = useRef<GhostState>({ raw: null, target: null, rotationY: 0, lastValidation: 0, snappingDisabled: false, wasSnapped: false, lastRay: null });
  const [ready, setReady] = useState(false);
  const [splatIssue, setSplatIssue] = useState<string | null>(null);
  const [placementFeedback, setPlacementFeedback] = useState<{ valid: boolean; snapped: boolean; reason?: string; parent?: string; surface?: string } | null>(null);
  const [placementError, setPlacementError] = useState(false);
  const [diceSumPresentation, setDiceSumPresentation] = useState<DiceSumPresentation | null>(null);

  callbacksRef.current = { onPlace, onSelect, onPipette, activeAssetId, selectedEntityId, focusAssetId, mode, map, tokenAssets, propAssets, materialAssets, basePlateAssets, campaignBasePlateAssignments, sceneBasePlateAssignments, tokenCharacterLinks, diceThemes, diceThemeAssignments, displaySettings, worldOverview };

  useEffect(() => {
    const canvasElementHost = canvasHostRef.current;
    if (!canvasElementHost) return;
    const canvas = claimSharedPlayCanvas(canvasElementHost, "3D tabletop map");
    canvasRef.current = canvas;
    let cancelled = false;
    let teardown: (() => void) | undefined;
    void (async () => {
    const graphicsDevice = await pc.createGraphicsDevice(canvas, {
      deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2],
      antialias: true,
      powerPreference: "high-performance",
      glslangUrl: "/wasm/glslang/glslang.js",
      twgslUrl: "/wasm/twgsl/twgsl.js",
    });
    if (cancelled) { graphicsDevice.destroy(); return; }
    const app = new pc.Application(canvas, {
      keyboard: new pc.Keyboard(window),
      mouse: new pc.Mouse(canvas),
      touch: "ontouchstart" in window ? new pc.TouchDevice(canvas) : undefined,
      graphicsDevice,
    });
    app.setCanvasFillMode(pc.FILLMODE_NONE);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    const applyWorldSplatBudget = () => {
      app.scene.gsplat.splatBudget = worldWanBudget(readLocalAiSettings().memoryProfile).runtimeSplatBudget;
    };
    applyWorldSplatBudget();
    window.addEventListener(LOCAL_AI_SETTINGS_EVENT, applyWorldSplatBudget);

    const camera = new pc.Entity("Camera");
    camera.addComponent("camera", { clearColor: new pc.Color(0.035, 0.04, 0.045), farClip: 250, fov: 52 });
    if (camera.camera) {
      camera.camera.gammaCorrection = pc.GAMMA_SRGB;
      camera.camera.toneMapping = pc.TONEMAP_ACES;
      // Water refraction/depth attenuation and the cloud compositor share the
      // scene grabs instead of allocating one capture per streamed water tile.
      camera.camera.requestSceneColorMap(true);
      camera.camera.requestSceneDepthMap(true);
    }
    app.root.addChild(camera);

    const lighting = createLightingRig(app, camera);

    const contentRoot = new pc.Entity("Map Content");
    const gridRoot = new pc.Entity("Grid");
    const selectionRoot = new pc.Entity("Selection");
    const previewRoot = new pc.Entity("Build Preview");
    const diceRoot = new pc.Entity("Physical Dice");
    const diceEffectsRoot = new pc.Entity("Dice Effects");
    const fogRoot = new pc.Entity("Dynamic Fog of War");
    app.root.addChild(contentRoot);
    app.root.addChild(gridRoot);
    app.root.addChild(selectionRoot);
    app.root.addChild(previewRoot);
    app.root.addChild(diceRoot);
    app.root.addChild(diceEffectsRoot);
    app.root.addChild(fogRoot);

    const worldCompute = createWorldGpuComputeRuntime(app.graphicsDevice);
    canvas.dataset.graphicsBackend = app.graphicsDevice.isWebGPU ? "webgpu" : "webgl2";
    canvas.dataset.worldCompute = worldCompute.backend;
    const worldWaterMaterial = createFlowingWaterMaterial(app.graphicsDevice);
    const runtime: RuntimeScene = {
      disposed: false,
      app,
      camera,
      lighting,
      contentRoot,
      selectionRoot,
      previewRoot,
      diceRoot,
      diceEffectsRoot,
      gridRoot,
      fogRoot,
      gridMaterial: null,
      fogTexture: null,
      fogMaterial: null,
      fogMaskState: null,
      fogExplorationCache: new Map(),
      selectionMaterial: null,
      blobShadowMaterial: createBlobShadowMaterial(),
      objectRoots: new Map(),
      modelAssets: new Map(),
      splatAssets: new Map(),
      sceneryRoots: new Map(),
      materials: new Map(),
      surfaceMaps: new Map(),
      animatedMaterials: new Set(),
      waterMaterials: new Set(),
      worldWaterMaterial,
      grassMaterials: new Map(),
      spatialHash: buildSpatialHash(callbacksRef.current.map.entities, callbacksRef.current.tokenAssets, callbacksRef.current.propAssets),
      ghost: null,
      ghostAssetId: null,
      ghostMaterials: {
        valid: makeGhostMaterial("#58c6b3", "#48e1c5"),
        invalid: makeGhostMaterial("#e04f52", "#ff3038"),
        snapping: makeGhostMaterial("#6e9cff", "#8d76ff"),
      },
      placementAnimations: new Map(),
      dust: [],
      diceThrows: [],
      diceImpacts: [],
      diceThrowGeneration: 0,
      diceRollDetail: null,
      diceMergeStartedAt: null,
      diceTotalRevealed: false,
      onDiceSum: setDiceSumPresentation,
      mapBounds: { width: callbacksRef.current.map.width, depth: callbacksRef.current.map.depth },
      terrainHeight: (x, z) => mapHeight(callbacksRef.current.map, x, z),
      diceTaaSuspended: false,
      reducedMotion: resolvedMotionReduction(displaySettings),
      orbit: { yaw: 38, pitch: 52, distance: Math.max(25, Math.max(callbacksRef.current.map.width, callbacksRef.current.map.depth) * 1.05), target: new pc.Vec3(0, 0, 0) },
      basePlateHandles: new Map(),
      mode: callbacksRef.current.mode,
      worldVisibility: null,
      worldVisibilitySignature: "",
      lastWorldVisibilityAt: 0,
      worldStreaming: new WorldChunkStreamingController(),
      worldOverview: callbacksRef.current.worldOverview,
      volumetricClouds: null,
      cloudsAttached: false,
      worldCompute,
    };
    runtime.animatedMaterials.add(worldWaterMaterial);
    runtimeRef.current = runtime;
    (app.graphicsDevice.canvas as HTMLCanvasElement).dataset.lightingQuality = callbacksRef.current.map.lighting?.quality ?? "balanced";
    (app.graphicsDevice.canvas as HTMLCanvasElement).dataset.tabletopMaterialPolicy = "authored-pbr-plus-profiled-finish";
    (app.graphicsDevice.canvas as HTMLCanvasElement).dataset.miniatureMaterialPipeline = "orm-specialty-wash-drybrush-varnish";
    (app.graphicsDevice.canvas as HTMLCanvasElement).dataset.propMaterialPipeline = "paper-transmission,wood-anisotropy,foliage-flocking";
    applyLightingRig(runtime.lighting, callbacksRef.current.map);
    rebuildEnvironment(runtime.lighting, callbacksRef.current.map, environmentPanorama);
    rebuildDynamicLights(runtime.lighting, callbacksRef.current.map);
    updateCamera(runtime);
    refreshWorldVisibility(runtime, callbacksRef.current.map, callbacksRef.current.selectedEntityId);
    syncObjects(runtime, callbacksRef.current.map, callbacksRef.current.tokenAssets, callbacksRef.current.propAssets, callbacksRef.current.materialAssets, { assets: callbacksRef.current.basePlateAssets, campaignAssignments: callbacksRef.current.campaignBasePlateAssignments, sceneAssignments: callbacksRef.current.sceneBasePlateAssignments, tokenCharacterLinks: callbacksRef.current.tokenCharacterLinks });
    void syncScenery(runtime, callbacksRef.current.map).then(setSplatIssue).catch((error) => setSplatIssue(error instanceof Error ? error.message : "Splat scenery failed to load"));
    rebuildGrid(runtime, callbacksRef.current.map, showGrid);
    rebuildFogOfWar(runtime, callbacksRef.current.map, callbacksRef.current.tokenAssets);
    rebuildGhost(runtime, callbacksRef.current.activeAssetId, callbacksRef.current.tokenAssets, callbacksRef.current.propAssets);
    let revealMapId = "", reveal = new WorldReveal();
    const updateScene = (dt: number) => {
      if (runtime.disposed) return;
      for (const base of runtime.basePlateHandles.values()) base.update(dt);
      const ghostState = ghostStateRef.current;
      if (runtime.ghost && ghostState.target) {
        runtime.ghost.enabled = true;
        const current = runtime.ghost.getPosition();
        const target = ghostState.target.position;
        const blend = 1 - Math.exp(-dt * (ghostState.target.snapped ? 18 : 34));
        runtime.ghost.setPosition(pc.math.lerp(current.x, target.x, blend), pc.math.lerp(current.y, target.y, blend), pc.math.lerp(current.z, target.z, blend));
        const angles = runtime.ghost.getEulerAngles();
        let angleDelta = ((ghostState.target.rotationY - angles.y + 540) % 360) - 180;
        if (Math.abs(angleDelta) < .05) angleDelta = 0;
        const targetRotation = ghostState.target.rotation ?? { x: 0, y: ghostState.target.rotationY, z: 0 };
        runtime.ghost.setEulerAngles(pc.math.lerp(angles.x, targetRotation.x, blend), angles.y + angleDelta * blend, pc.math.lerp(angles.z, targetRotation.z, blend));
        setGhostMaterial(runtime.ghost, ghostState.target.valid ? (ghostState.target.snapped ? runtime.ghostMaterials.snapping : runtime.ghostMaterials.valid) : runtime.ghostMaterials.invalid);
      }
      const now = performance.now();
      if (now - runtime.lastWorldVisibilityAt >= 250) {
        runtime.lastWorldVisibilityAt = now;
        if (refreshWorldVisibility(runtime, callbacksRef.current.map, callbacksRef.current.selectedEntityId)) {
          syncObjects(runtime, callbacksRef.current.map, callbacksRef.current.tokenAssets, callbacksRef.current.propAssets, callbacksRef.current.materialAssets, { assets: callbacksRef.current.basePlateAssets, campaignAssignments: callbacksRef.current.campaignBasePlateAssignments, sceneAssignments: callbacksRef.current.sceneBasePlateAssignments, tokenCharacterLinks: callbacksRef.current.tokenCharacterLinks });
          void syncScenery(runtime, callbacksRef.current.map).then(setSplatIssue).catch((error) => setSplatIssue(error instanceof Error ? error.message : "Splat tile streaming failed"));
        }
      }
      const uploadedChunks = runtime.worldStreaming.takeUploads(1, 4, () => performance.now(), () => {
        syncObjects(runtime, callbacksRef.current.map, callbacksRef.current.tokenAssets, callbacksRef.current.propAssets, callbacksRef.current.materialAssets, { assets: callbacksRef.current.basePlateAssets, campaignAssignments: callbacksRef.current.campaignBasePlateAssignments, sceneAssignments: callbacksRef.current.sceneBasePlateAssignments, tokenCharacterLinks: callbacksRef.current.tokenCharacterLinks });
      });
      if (uploadedChunks.length) {
        const uploadedMapId = callbacksRef.current.map.id;
        runtime.app.once("frameend", () => { if (!runtime.disposed && callbacksRef.current.map.id === uploadedMapId) runtime.worldStreaming.markPresented(uploadedChunks); });
        (runtime.app.graphicsDevice.canvas as HTMLCanvasElement).dataset.residentWorldChunks = String(runtime.worldStreaming.snapshot().filter((entry) => entry.resident).length);
      }
      const seconds = now / 1000;
      const atmosphereMap = callbacksRef.current.map;
      if (revealMapId !== atmosphereMap.id) { revealMapId = atmosphereMap.id; reveal = new WorldReveal(); }
      const revealCamera=runtime.orbit.target;
      if(Math.abs(revealCamera.x)>atmosphereMap.width/2+32 || Math.abs(revealCamera.z)>atmosphereMap.depth/2+32) reveal.follow(revealCamera.x,revealCamera.z);
      const radius = atmosphereMap.world ? reveal.update(dt, atmosphereMap.world, id => runtime.worldStreaming.isPresented(id), horizonReady(runtime.app)) : 60000;
      updateWorldAtmosphere(runtime.app, runtime.camera, runtime.lighting.key, seconds, radius, Boolean(atmosphereMap.world) && !isInteriorMap(atmosphereMap), atmosphereMap.weather, reveal.center);
      (runtime.app.graphicsDevice.canvas as HTMLCanvasElement).dataset.worldRevealRadius = radius.toFixed(1);
      runtime.volumetricClouds?.setTime(seconds);
      for (const lightEntity of runtime.contentRoot.findByTag("prop-practical-light") as pc.Entity[]) {
        const base = Number(lightEntity.tags.list().find((tag) => tag.startsWith("light-base:"))?.split(":")[1] ?? 1);
        const amount = Number(lightEntity.tags.list().find((tag) => tag.startsWith("light-flicker:"))?.split(":")[1] ?? 0);
        const speed = Number(lightEntity.tags.list().find((tag) => tag.startsWith("light-speed:"))?.split(":")[1] ?? 0);
        if (lightEntity.light) lightEntity.light.intensity = base * (1 + amount * (Math.sin(seconds * speed) * .55 + Math.sin(seconds * speed * 2.17) * .25));
      }
      const focusMap = callbacksRef.current.map;
      const focusTokenIds = new Set(callbacksRef.current.tokenAssets.map((token) => token.id));
      const tokens = focusMap.entities.filter((entity) => focusTokenIds.has(entity.assetId) || ASSET_BY_ID.get(entity.assetId)?.category === "tokens");
      const selected = tokens.find((entity) => entity.id === callbacksRef.current.selectedEntityId);
      const activeTurnToken = tokens.find((entity) => entity.assetId === callbacksRef.current.focusAssetId);
      const focusAnchor = selected ?? activeTurnToken;
      const playerAnchor = tokens.find((entity) => callbacksRef.current.tokenAssets.find((token) => token.id === entity.assetId)?.kind === "player") ?? focusAnchor;
      const focusedTokens = focusAnchor && callbacksRef.current.mode === "play"
        ? tokens.filter((entity) => entity.id === focusAnchor.id || Math.hypot(entity.position.x - focusAnchor.position.x, entity.position.z - focusAnchor.position.z) <= 10)
        : tokens;
      const focusTargets = focusedTokens.map((entity) => ({
        position: { x: entity.position.x, y: entity.position.y + .9 * entity.scale.y, z: entity.position.z },
        radius: Math.max(.75, (ASSET_BY_ID.get(entity.assetId)?.footprint ?? callbacksRef.current.tokenAssets.find((token) => token.id === entity.assetId)?.footprint ?? .65) * Math.max(entity.scale.x, entity.scale.z)),
      }));
      if (callbacksRef.current.mode === "build") {
        // A builder needs the entire board plane readable, not only whichever
        // miniatures happen to be present. The corners establish the true near
        // and far depth extents as the orbit camera moves around the room.
        const halfWidth = focusMap.width * .5;
        const halfDepth = focusMap.depth * .5;
        focusTargets.push(
          { position: { x: -halfWidth, y: 1, z: -halfDepth }, radius: 2.5 },
          { position: { x: halfWidth, y: 1, z: -halfDepth }, radius: 2.5 },
          { position: { x: -halfWidth, y: 1, z: halfDepth }, radius: 2.5 },
          { position: { x: halfWidth, y: 1, z: halfDepth }, radius: 2.5 },
        );
      }
      if (!focusTargets.length) focusTargets.push({ position: { x: runtime.orbit.target.x, y: runtime.orbit.target.y, z: runtime.orbit.target.z }, radius: 2 });
      updateLightingRig(runtime.lighting, seconds, focusTargets, callbacksRef.current.mode === "build");
      refreshVirtualizedDynamicLights(runtime.lighting, callbacksRef.current.map, callbacksRef.current.displaySettings);
      runtime.fogMaterial?.setParameter("uTime", seconds);
      updateFogOfWarMask(runtime, callbacksRef.current.map, callbacksRef.current.tokenAssets);
      runtime.selectionMaterial?.setParameter("uTime", seconds);
      const grassTarget = callbacksRef.current.mode === "play" && playerAnchor ? [playerAnchor.position.x, playerAnchor.position.y, playerAnchor.position.z] : [100000, 100000, 100000];
      for (const material of runtime.grassMaterials.values()) { material.setParameter("uPlayerPosition", grassTarget); const view = runtime.camera.getPosition(); material.setParameter("uGrassViewPosition", [view.x, view.y, view.z]); }
      const wind = weatherSurfaceState(resolveWorldWeather(atmosphereMap.weather));
      for (const material of runtime.animatedMaterials) { material.setParameter("uTime", seconds); material.setParameter("uWorldWind", [wind.windX / 3, wind.windZ / 3]); }
      const renderCanvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
      renderCanvas.dataset.animatedShaderTime = seconds.toFixed(2);
      renderCanvas.dataset.animatedShaderCount = String(runtime.animatedMaterials.size);
      for (const material of runtime.waterMaterials) material.normalMapOffset.set((seconds * .018) % 1, (seconds * -.011) % 1);
      updateTokenMotions(runtime, callbacksRef.current.map, callbacksRef.current.tokenAssets, now);
      for (const [id, animation] of runtime.placementAnimations) {
        const object = runtime.objectRoots.get(id);
        if (!object) { runtime.placementAnimations.delete(id); continue; }
        const progress = runtime.reducedMotion ? 1 : Math.min(1, (now - animation.startedAt) / 150);
        const elastic = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress) * Math.cos(progress * Math.PI * 2.2);
        const scale = .8 + .2 * elastic;
        object.setLocalScale(animation.target.x * scale, animation.target.y * scale, animation.target.z * scale);
        if (progress === 1) runtime.placementAnimations.delete(id);
      }
      runtime.dust = runtime.dust.filter((particle) => {
        const age = (now - particle.startedAt) / 1000;
        if (age >= .34 || !particle.entity.parent) { particle.entity.destroy(); return false; }
        const position = particle.entity.getPosition();
        particle.entity.setPosition(position.x + particle.velocity.x * dt, position.y + particle.velocity.y * dt, position.z + particle.velocity.z * dt);
        particle.velocity.y -= 1.9 * dt;
        particle.entity.setLocalScale(.08 * (1 - age / .34), .04 * (1 - age / .34), .08 * (1 - age / .34));
        return true;
      });
      const settledDice = runtime.diceThrows.filter((die) => die.settledAt !== null && die.settledPosition);
      if (settledDice.length === runtime.diceThrows.length && settledDice.length > 0 && runtime.diceMergeStartedAt === null) {
        const latestSettledAt = Math.max(...settledDice.map((die) => die.settledAt ?? now));
        if (now - latestSettledAt >= 1_150) runtime.diceMergeStartedAt = now;
      }
      const mergeCenter = settledDice.length ? settledDice.reduce((center, die) => center.add(die.settledPosition!), new pc.Vec3()).mulScalar(1 / settledDice.length) : null;
      runtime.diceThrows = runtime.diceThrows.filter((die) => {
        if (!die.entity.parent) return false;
        const age = (now - die.startedAt) / 1000;
        if (die.theme) updateThemedDiceMaterial(die.material, die.theme, seconds, die.value * .37);
        if (die.settledAt === null) {
          const framePosition = Math.min(die.frames.length - 1, age * 60);
          const frameIndex = Math.floor(framePosition);
          const nextIndex = Math.min(die.frames.length - 1, frameIndex + 1);
          const blend = framePosition - frameIndex;
          const current = die.frames[frameIndex];
          const next = die.frames[nextIndex];
          const position = new pc.Vec3().lerp(new pc.Vec3(current.position.x, current.position.y, current.position.z), new pc.Vec3(next.position.x, next.position.y, next.position.z), blend);
          const rotation = new pc.Quat().slerp(new pc.Quat(current.rotation.x, current.rotation.y, current.rotation.z, current.rotation.w), new pc.Quat(next.rotation.x, next.rotation.y, next.rotation.z, next.rotation.w), blend);
          const progress = Math.min(1, age / die.duration);
          die.entity.setPosition(position);
          die.entity.setRotation(rotation);
          die.particleTrail?.setPosition(position);
          const trailEffect = resolveDiceEffects(die.theme?.effects).trail;
          if (trailEffect.enabled && die.trailMaterial && now - die.lastTrailAt >= 52) {
            die.lastTrailAt = now;
            const segment = new pc.Entity(`${trailEffect.style} dice trail`);
            segment.addComponent("render", { type: trailEffect.style === "sparks" ? "box" : "sphere" });
            if (segment.render) { segment.render.material = die.trailMaterial; segment.render.castShadows = false; segment.render.receiveShadows = false; }
            segment.setPosition(position.x, position.y, position.z);
            segment.setLocalScale(trailEffect.width, trailEffect.width, trailEffect.width);
            runtime.diceEffectsRoot.addChild(segment);
            die.trail.push({ entity: segment, bornAt: now });
            if (die.trail.length > 18) die.trail.shift()?.entity.destroy();
          }
          if (die === runtime.diceThrows[0]) {
            const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
            canvas.dataset.diceRollProgress = progress.toFixed(4);
            canvas.dataset.diceRollQuaternion = [rotation.x, rotation.y, rotation.z, rotation.w].map((value) => value.toFixed(4)).join(",");
            if (progress > 0 && progress < 1) canvas.dataset.diceObservedMotion = "true";
          }
          if (progress >= 1) {
            die.settledAt = now;
            die.settledPosition = position.clone();
            die.particleTrail?.particlesystem?.stop();
            const winningNumber = die.numberMaterials[0];
            if (winningNumber) {
              winningNumber.emissive = toColor(die.theme?.numberColor ?? "#ead9aa");
              winningNumber.emissiveIntensity = 2.4;
              winningNumber.gloss = .62;
              winningNumber.update();
            }
            if (!die.impactTriggered) {
              die.impactTriggered = true;
              spawnDiceImpact(runtime, position, die.theme);
            }
            const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
            canvas.dataset.diceWinningNumber = String(die.value);
            canvas.dataset.diceWinningFaceGlow = "emissive-inlay";
            canvas.dataset.diceResultPresentation = "camera-lift-scale";
            const screen = runtime.camera.camera?.worldToScreen(position);
            if (screen) {
              canvas.dataset.diceScreenX = String(screen.x / canvas.offsetWidth);
              canvas.dataset.diceScreenY = String(screen.y / canvas.offsetHeight);
            }
          }
        } else {
          const settledAge = now - die.settledAt;
          const revealProgress = Math.min(1, settledAge / 320);
          const revealEase = 1 - Math.pow(1 - revealProgress, 3);
          let presentationScale = 1 + .14 * revealEase;
          if (die.settledPosition) {
            const towardCamera = runtime.camera.getPosition().clone().sub(die.settledPosition).normalize().mulScalar(.22 * revealEase);
            const readablePosition = die.settledPosition.clone().add(towardCamera);
            if (runtime.diceMergeStartedAt !== null && mergeCenter) {
              const mergeProgress = Math.min(1, (now - runtime.diceMergeStartedAt) / 520);
              const mergeEase = mergeProgress * mergeProgress * (3 - 2 * mergeProgress);
              const sumLift = runtime.camera.getPosition().clone().sub(mergeCenter).normalize().mulScalar(.4);
              die.entity.setPosition(new pc.Vec3().lerp(readablePosition, mergeCenter.clone().add(sumLift), mergeEase));
              presentationScale *= 1 - .52 * mergeEase;
              die.entity.enabled = mergeProgress < .98;
            } else {
              die.entity.enabled = true;
              die.entity.setPosition(readablePosition);
            }
          }
          if (settledAge > 4_600) {
            const fade = Math.min(1, (settledAge - 4_600) / 300);
            const scale = presentationScale * (1 - fade);
            die.entity.setLocalScale(scale, scale, scale);
            if (fade >= 1) {
              disposeDieThrow(die);
              return false;
            }
          } else die.entity.setLocalScale(presentationScale, presentationScale, presentationScale);
        }
        const trailEffect = resolveDiceEffects(die.theme?.effects).trail;
        die.trail = die.trail.filter((segment) => {
          const trailAge = (now - segment.bornAt) / 1000;
          if (trailAge >= trailEffect.length || !segment.entity.parent) { segment.entity.destroy(); return false; }
          const fade = 1 - trailAge / trailEffect.length;
          const width = trailEffect.width * fade;
          segment.entity.setLocalScale(width, trailEffect.style === "wisps" ? width * 1.55 : width, width);
          if (trailEffect.style === "embers") {
            const position = segment.entity.getPosition();
            segment.entity.setPosition(position.x, position.y - dt * (.14 + trailAge * .4), position.z);
          }
          return true;
        });
        return true;
      });
      if (runtime.diceMergeStartedAt !== null && !runtime.diceTotalRevealed && now - runtime.diceMergeStartedAt >= 520 && runtime.diceRollDetail) {
        runtime.diceTotalRevealed = true;
        const rolledValues = (runtime.diceRollDetail.terms ?? [{ sides: runtime.diceRollDetail.sides, rolls: runtime.diceRollDetail.rolls }]).flatMap((term) => term.rolls);
        const modifier = runtime.diceRollDetail.modifier;
        const breakdown = `${rolledValues.join(" + ")}${modifier ? ` ${modifier > 0 ? "+" : "−"} ${Math.abs(modifier)}` : ""}`;
        runtime.onDiceSum({ expression: runtime.diceRollDetail.expression, total: runtime.diceRollDetail.total, modifier, breakdown });
        const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
        canvas.dataset.diceSumMerge = "complete";
        canvas.dataset.diceMergedTotal = String(runtime.diceRollDetail.total);
      }
      if (runtime.diceThrows.length === 0 && runtime.diceTotalRevealed) {
        runtime.onDiceSum(null);
        runtime.diceTotalRevealed = false;
        runtime.diceMergeStartedAt = null;
        runtime.diceRollDetail = null;
      }
      runtime.diceImpacts = runtime.diceImpacts.filter((impact) => {
        const progress = (now - impact.startedAt) / (impact.duration * 1000);
        if (progress >= 1) {
          impact.ring.destroy();
          impact.sparks.forEach((spark) => spark.destroy());
          impact.particleBurst?.destroy();
          impact.material.destroy();
          return false;
        }
        const eased = 1 - Math.pow(1 - progress, 3);
        const ringScale = impact.size * (.2 + eased * .8);
        impact.ring.setLocalScale(ringScale, ringScale, ringScale);
        impact.material.opacity = .82 * (1 - progress);
        impact.sparks.forEach((spark, index) => {
          const angle = index / impact.sparks.length * Math.PI * 2 + (impact.style === "rune-burst" ? progress * .55 : 0);
          const radius = impact.size * eased * (impact.style === "shockwave" ? .52 : .72);
          const origin = impact.ring.getPosition();
          const lift = impact.style === "shards" ? Math.sin(progress * Math.PI) * .55 : .06 + Math.sin(progress * Math.PI) * .18;
          spark.setPosition(origin.x + Math.cos(angle) * radius, lift, origin.z + Math.sin(angle) * radius);
          if (impact.style === "rune-burst") spark.setEulerAngles(0, -angle * pc.math.RAD_TO_DEG, 45);
          const fade = Math.max(.01, 1 - progress);
          spark.setLocalScale(fade * .06, impact.style === "shards" ? fade * .24 : fade * .06, fade * .06);
        });
        return true;
      });
      if (runtime.diceTaaSuspended && runtime.diceThrows.every((die) => die.settledAt !== null)) setDiceTaaSuspended(runtime, false);
      (runtime.app.graphicsDevice.canvas as HTMLCanvasElement).dataset.diceThrows = String(runtime.diceThrows.length);
    };
    const canvasHost = canvas.parentElement ?? canvas;
    const resizeToHost = () => {
      const bounds = canvasHost.getBoundingClientRect();
      app.resizeCanvas(Math.max(1, Math.round(bounds.width)), Math.max(1, Math.round(bounds.height)));
    };
    const resizeObserver = new ResizeObserver(resizeToHost);
    resizeObserver.observe(canvasHost);
    resizeToHost();
    const dispatchWorldCompute = () => {
      if (!runtime.disposed && camera.camera) runtime.worldCompute.dispatch(camera.camera);
    };
    app.on("update", updateScene);
    // Submit compute before PlayCanvas opens the frame's SceneColor render
    // encoder. `prerender` fires once per render pass, including while
    // CameraFrame owns an active encoder; dispatching there invalidates the
    // parent render pass on WebGPU and can leave generated interiors black.
    app.on("update", dispatchWorldCompute);
    app.start();
    setReady(true);
    // Post-effect targets inherit the current canvas dimensions when they are
    // allocated. Attach after the first host resize so the compositor never
    // captures into the canvas's zero/placeholder startup target.
    syncVolumetricClouds(runtime, callbacksRef.current.map);

    let pointerStart: { x: number; y: number } | null = null;
    let lastPointer: { x: number; y: number } | null = null;
    let orbiting = false;
    let panning = false;

    const nearestObject = (point: pc.Vec3): MapEntity | null => {
      let nearest: { entity: MapEntity; distance: number } | null = null;
      let floorPanel: { entity: MapEntity; distance: number } | null = null;
      const nearby = runtime.spatialHash.query(point, 3);
      const terrainAtPoint = callbacksRef.current.map.entities.filter((entry) => entry.worldGeometry?.kind === "terrain" && point.x >= entry.worldGeometry.originX && point.x <= entry.worldGeometry.originX + entry.worldGeometry.size && point.z >= entry.worldGeometry.originZ && point.z <= entry.worldGeometry.originZ + entry.worldGeometry.size);
      for (const entry of [...new Map([...nearby, ...terrainAtPoint].map((candidate) => [candidate.id, candidate])).values()]) {
        if (callbacksRef.current.mode !== "build" && ASSET_BY_ID.get(entry.assetId)?.editorOnly) continue;
        const spec = buildSpec(entry.assetId, callbacksRef.current.tokenAssets, callbacksRef.current.propAssets);
        if (entry.worldGeometry?.kind === "terrain") {
          const geometry = entry.worldGeometry;
          const inside = point.x >= geometry.originX && point.x <= geometry.originX + geometry.size && point.z >= geometry.originZ && point.z <= geometry.originZ + geometry.size;
          if (inside) {
            const distance = Math.abs(point.y - sampleTerrainHeight(geometry, point.x, point.z));
            if (!floorPanel || distance < floorPanel.distance) floorPanel = { entity: entry, distance };
          }
          continue;
        }
        if (spec?.shape === "floor") {
          const angle = -entry.rotation.y * pc.math.DEG_TO_RAD;
          const dx = point.x - entry.position.x, dz = point.z - entry.position.z;
          const localX = dx * Math.cos(angle) - dz * Math.sin(angle);
          const localZ = dx * Math.sin(angle) + dz * Math.cos(angle);
          const inside = Math.abs(localX) <= spec.halfX * entry.scale.x + .04 && Math.abs(localZ) <= spec.halfZ * entry.scale.z + .04;
          const distance = Math.hypot(localX, localZ);
          if (inside && (!floorPanel || distance < floorPanel.distance)) floorPanel = { entity: entry, distance };
          continue;
        }
        const distance = Math.hypot(entry.position.x - point.x, entry.position.z - point.z);
        const footprint = spec?.footprint ?? .7;
        if (distance <= footprint * Math.max(entry.scale.x, entry.scale.z) + .45 && (!nearest || distance < nearest.distance)) nearest = { entity: entry, distance };
      }
      return nearest?.entity ?? floorPanel?.entity ?? null;
    };

    const nearestObjectOnRay = (ray: { origin: Vec3; direction: Vec3 }): MapEntity | null => {
      let nearest: { entity: MapEntity; score: number; distance: number } | null = null;
      for (const entry of callbacksRef.current.map.entities) {
        if (entry.hidden || (callbacksRef.current.mode !== "build" && ASSET_BY_ID.get(entry.assetId)?.editorOnly)) continue;
        const spec = buildSpec(entry.assetId, callbacksRef.current.tokenAssets, callbacksRef.current.propAssets);
        if (!spec || spec.shape === "floor") continue;
        if (spec.shape === "wall") {
          // A broad sphere around a wall steals clicks from the board in front of
          // it. Intersect the panel's actual rotated bounds instead.
          const radians = -entry.rotation.y * pc.math.DEG_TO_RAD;
          const cosine = Math.cos(radians), sine = Math.sin(radians);
          const deltaX = ray.origin.x - entry.position.x, deltaZ = ray.origin.z - entry.position.z;
          const localOrigin = {
            x: (deltaX * cosine - deltaZ * sine) / Math.max(.0001, entry.scale.x),
            y: (ray.origin.y - entry.position.y) / Math.max(.0001, entry.scale.y),
            z: (deltaX * sine + deltaZ * cosine) / Math.max(.0001, entry.scale.z),
          };
          const localDirection = {
            x: (ray.direction.x * cosine - ray.direction.z * sine) / Math.max(.0001, entry.scale.x),
            y: ray.direction.y / Math.max(.0001, entry.scale.y),
            z: (ray.direction.x * sine + ray.direction.z * cosine) / Math.max(.0001, entry.scale.z),
          };
          let nearDistance = 0, farDistance = Number.POSITIVE_INFINITY;
          for (const axis of ["x", "y", "z"] as const) {
            const origin = localOrigin[axis], direction = localDirection[axis];
            const minimum = spec.bounds.min[axis] - .06, maximum = spec.bounds.max[axis] + .06;
            if (Math.abs(direction) < 1e-6) {
              if (origin < minimum || origin > maximum) { nearDistance = Number.POSITIVE_INFINITY; break; }
              continue;
            }
            const first = (minimum - origin) / direction, second = (maximum - origin) / direction;
            nearDistance = Math.max(nearDistance, Math.min(first, second));
            farDistance = Math.min(farDistance, Math.max(first, second));
            if (nearDistance > farDistance) break;
          }
          if (nearDistance <= farDistance && Number.isFinite(nearDistance) && (!nearest || nearDistance < nearest.distance)) {
            nearest = { entity: entry, score: 0, distance: nearDistance };
          }
          continue;
        }
        const practical = resolvePracticalLight(entry);
        const center = practical?.position ?? {
          x: entry.position.x,
          y: entry.position.y + (spec.bounds.min.y + spec.bounds.max.y) * .5 * entry.scale.y,
          z: entry.position.z,
        };
        const relative = { x: center.x - ray.origin.x, y: center.y - ray.origin.y, z: center.z - ray.origin.z };
        const distance = relative.x * ray.direction.x + relative.y * ray.direction.y + relative.z * ray.direction.z;
        if (distance < 0) continue;
        const closest = { x: ray.origin.x + ray.direction.x * distance, y: ray.origin.y + ray.direction.y * distance, z: ray.origin.z + ray.direction.z * distance };
        const miss = Math.hypot(center.x - closest.x, center.y - closest.y, center.z - closest.z);
        const extent = Math.max(spec.bounds.max.x - spec.bounds.min.x, spec.bounds.max.y - spec.bounds.min.y, spec.bounds.max.z - spec.bounds.min.z) * .5 * Math.max(entry.scale.x, entry.scale.y, entry.scale.z);
        const hitRadius = practical ? .58 : Math.max(.34, Math.min(1.35, extent + .18));
        if (miss > hitRadius) continue;
        const score = miss / hitRadius;
        if (!nearest || score < nearest.score - .08 || (Math.abs(score - nearest.score) <= .08 && distance < nearest.distance)) nearest = { entity: entry, score, distance };
      }
      return nearest?.entity ?? null;
    };

    const updateGhost = (point: pc.Vec3 | null, snappingDisabled: boolean, ray?: { origin: Vec3; direction: Vec3 } | null) => {
      const assetId = callbacksRef.current.activeAssetId;
      const spec = assetId ? buildSpec(assetId, callbacksRef.current.tokenAssets, callbacksRef.current.propAssets) : null;
      if (!spec || !runtime.ghost) return;
      const state = ghostStateRef.current;
      if (ray) state.lastRay = ray;
      const surfaceHit = !snappingDisabled && state.lastRay ? raycastAttachmentSurfaces(state.lastRay.origin, state.lastRay.direction, callbacksRef.current.map.entities, spec, callbacksRef.current.tokenAssets, callbacksRef.current.propAssets) : null;
      if (!point && !surfaceHit) return;
      const terrainClip = spec.shape === "wall" ? Math.min(.18, spec.footprint * .12) : spec.shape === "floor" ? .025 : 0;
      const fallback = point ?? surfaceHit!.point;
      const raw = { x: fallback.x, y: fallback.y - terrainClip, z: fallback.z };
      state.raw = raw;
      state.snappingDisabled = snappingDisabled;
      const nearby = runtime.spatialHash.query(raw, Math.max(3, spec.footprint * 2.5));
      const surfaceParent = surfaceHit ? callbacksRef.current.map.entities.find((entry) => entry.id === surfaceHit.surface.ownerId) : undefined;
      const socket = surfaceHit && surfaceParent
        ? resolveSurfacePlacement(surfaceHit, state.rotationY, spec, surfaceParent)
        : resolveSocketPlacement(raw, state.rotationY, spec, nearby, callbacksRef.current.tokenAssets, !snappingDisabled, 1.15, callbacksRef.current.propAssets);
      const now = performance.now();
      const validationDue = now - state.lastValidation >= 50;
      const snapChanged = state.target?.snapped !== socket.snapped;
      const previousValidity = state.target ? { valid: state.target.valid, reason: state.target.reason } : { valid: true, reason: undefined };
      const canFallBackToFloor = spec.acceptedSurfaceTags.includes("floor");
      const requiredSurfaceMissing = !snappingDisabled && (["ceiling-hanging", "tabletop"].includes(spec.profile) || (spec.profile === "wall-mounted" && !canFallBackToFloor)) && !surfaceHit;
      const validation = validationDue
        ? requiredSurfaceMissing ? { valid: false, reason: `Point at a compatible ${spec.profile.replace("-", " ")} surface` } : validatePlacement(socket.position, socket.rotationY, spec, runtime.spatialHash.query(socket.position, Math.max(3, spec.footprint * 2.5)), callbacksRef.current.map, callbacksRef.current.tokenAssets, socket.parentId, callbacksRef.current.propAssets, socket.surfaceId)
        : previousValidity;
      if (validationDue) state.lastValidation = now;
      state.target = { ...socket, ...validation };
      if (state.target.snapped && !state.wasSnapped) playBuildSound("snap", assetId ?? undefined);
      state.wasSnapped = state.target.snapped;
      runtime.ghost.enabled = true;
      if (validationDue || snapChanged) setPlacementFeedback({ valid: state.target.valid, snapped: state.target.snapped, reason: state.target.reason, parent: surfaceHit?.surface.ownerName, surface: surfaceHit?.surface.name });
    };

    const pointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      pointerStart = { x: event.clientX, y: event.clientY };
      lastPointer = { ...pointerStart };
      orbiting = event.button === 2 || (event.button === 0 && event.altKey && !callbacksRef.current.activeAssetId);
      panning = event.button === 1 || (event.button === 0 && event.shiftKey);
    };
    const pointerMove = (event: PointerEvent) => {
      const point = groundPoint(runtime, callbacksRef.current.map, canvas, event.clientX, event.clientY);
      const ray = screenRay(runtime, canvas, event.clientX, event.clientY);
      if ((point || ray) && callbacksRef.current.activeAssetId && !orbiting && !panning) updateGhost(point, event.altKey, ray);
      if (!lastPointer) return;
      const dx = event.clientX - lastPointer.x;
      const dy = event.clientY - lastPointer.y;
      if (orbiting) {
        runtime.orbit.yaw -= dx * 0.35;
        runtime.orbit.pitch = pc.math.clamp(runtime.orbit.pitch + dy * 0.28, callbacksRef.current.map.world ? 2 : 22, 82);
        updateCamera(runtime);
      } else if (panning) {
        const scale = runtime.orbit.distance * 0.0025;
        const yaw = runtime.orbit.yaw * pc.math.DEG_TO_RAD;
        runtime.orbit.target.x -= (Math.cos(yaw) * dx + Math.sin(yaw) * dy) * scale;
        runtime.orbit.target.z -= (-Math.sin(yaw) * dx + Math.cos(yaw) * dy) * scale;
        updateCamera(runtime);
      }
      lastPointer = { x: event.clientX, y: event.clientY };
    };
    const pointerUp = (event: PointerEvent) => {
      const moved = pointerStart ? Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) : 999;
      if (!orbiting && !panning && moved < 5 && event.button === 0) {
        const point = groundPoint(runtime, callbacksRef.current.map, canvas, event.clientX, event.clientY);
        const ray = screenRay(runtime, canvas, event.clientX, event.clientY);
        if (callbacksRef.current.activeAssetId && (point || ray)) {
            ghostStateRef.current.lastValidation = 0;
            updateGhost(point, event.altKey, ray);
            const placement = ghostStateRef.current.target;
            if (placement?.valid) {
              callbacksRef.current.onPlace(placement);
              spawnDust(runtime, placement.position);
              playBuildSound("place", callbacksRef.current.activeAssetId);
            } else {
              playBuildSound("invalid", callbacksRef.current.activeAssetId);
              setPlacementError(true);
              window.setTimeout(() => setPlacementError(false), 260);
            }
        }
        else if (point || ray) {
            callbacksRef.current.onSelect((ray ? nearestObjectOnRay(ray) : null)?.id ?? (point ? nearestObject(point)?.id : null) ?? null);
        }
      }
      if (moved < 5 && event.button === 1) {
        const point = groundPoint(runtime, callbacksRef.current.map, canvas, event.clientX, event.clientY);
        const ray = screenRay(runtime, canvas, event.clientX, event.clientY);
        const picked = (ray ? nearestObjectOnRay(ray) : null) ?? (point ? nearestObject(point) : null);
        if (picked) {
          callbacksRef.current.onPipette(picked.assetId);
          playBuildSound("snap", picked.assetId);
        }
      }
      pointerStart = null;
      lastPointer = null;
      orbiting = false;
      panning = false;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const assetId = callbacksRef.current.activeAssetId;
      if (assetId) {
        const spec = buildSpec(assetId, callbacksRef.current.tokenAssets, callbacksRef.current.propAssets);
        if (spec) {
          ghostStateRef.current.rotationY = (ghostStateRef.current.rotationY + (event.deltaY > 0 ? spec.rotationStep : -spec.rotationStep) + 360) % 360;
          const raw = ghostStateRef.current.raw;
          if (raw) updateGhost(new pc.Vec3(raw.x, raw.y, raw.z), ghostStateRef.current.snappingDisabled, ghostStateRef.current.lastRay);
        }
        return;
      }
      runtime.orbit.distance = pc.math.clamp(runtime.orbit.distance * (1 + event.deltaY * 0.001), 2, Math.max(90, callbacksRef.current.map.width * 1.6));
      updateCamera(runtime);
    };
    const pointerLeave = () => { if (runtime.ghost) runtime.ghost.enabled = false; };
    const rotateGhost = () => {
      const assetId = callbacksRef.current.activeAssetId;
      const spec = assetId ? buildSpec(assetId, callbacksRef.current.tokenAssets, callbacksRef.current.propAssets) : null;
      if (!spec) return;
      ghostStateRef.current.rotationY = (ghostStateRef.current.rotationY + spec.rotationStep) % 360;
      const raw = ghostStateRef.current.raw;
      if (raw) updateGhost(new pc.Vec3(raw.x, raw.y, raw.z), ghostStateRef.current.snappingDisabled, ghostStateRef.current.lastRay);
    };
    const contextMenu = (event: MouseEvent) => event.preventDefault();
    const diceRoll = (event: Event) => {
      void throwPhysicalDice(runtime, (event as CustomEvent<PresentedDiceRoll>).detail, callbacksRef.current.diceThemes, callbacksRef.current.diceThemeAssignments).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        canvas.dataset.dicePhysicsError = message;
        setDiceTaaSuspended(runtime, false);
        console.error("DnDRom dice physics failed", error);
      });
    };

    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointerleave", pointerLeave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("contextmenu", contextMenu);
    window.addEventListener("dndrom:rotate-ghost", rotateGhost);
    window.addEventListener("dndrom:dice-roll", diceRoll);

    let teardownStarted = false;
    teardown = () => {
      if (teardownStarted) return;
      teardownStarted = true;
      runtime.disposed = true;
      app.off("update", updateScene);
      app.off("update", dispatchWorldCompute);
      runtime.diceThrowGeneration += 1;
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointerleave", pointerLeave);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", contextMenu);
      window.removeEventListener("dndrom:rotate-ghost", rotateGhost);
      window.removeEventListener("dndrom:dice-roll", diceRoll);
      window.removeEventListener(LOCAL_AI_SETTINGS_EVENT, applyWorldSplatBudget);
      canvasRef.current = null;
      runtimeRef.current = null;
      // PlayCanvas can defer destruction when navigation lands during its frame
      // update. Dispose dependent GPU resources from its destroy event so they
      // cannot be invalidated while the current command buffer is still built.
      app.once("destroy", () => {
        destroyLightingRig(runtime.lighting);
        if (runtime.volumetricClouds && runtime.cloudsAttached && camera.camera) camera.camera.postEffects.removeEffect(runtime.volumetricClouds);
        runtime.volumetricClouds?.destroy();
        runtime.worldCompute.destroy();
        runtime.gridMaterial?.destroy();
        runtime.fogTexture?.destroy();
        runtime.fogMaterial?.destroy();
        runtime.selectionMaterial?.destroy();
        runtime.blobShadowMaterial.destroy();
        for (const base of runtime.basePlateHandles.values()) base.destroy();
        runtime.basePlateHandles.clear();
        for (const material of runtime.animatedMaterials) material.destroy();
        for (const die of runtime.diceThrows) disposeDieThrow(die);
        for (const impact of runtime.diceImpacts) {
          impact.ring.destroy();
          impact.sparks.forEach((spark) => spark.destroy());
          impact.particleBurst?.destroy();
          impact.material.destroy();
        }
        for (const maps of runtime.surfaceMaps.values()) Object.values(maps).forEach((texture) => texture.destroy());
        releaseSharedPlayCanvas(canvasElementHost, canvas);
      });
      if (app.graphicsDevice) app.destroy();
    };
    })().catch((error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      canvas.dataset.rendererStartupError = message;
      console.error("DnDRom renderer startup failed", error);
      releaseSharedPlayCanvas(canvasElementHost, canvas);
      canvasRef.current = null;
    });
    return () => { cancelled = true; teardown?.(); };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime) {
      runtime.mapBounds = { width: map.width, depth: map.depth };
      applyLightingRig(runtime.lighting, map);
      syncVolumetricClouds(runtime, map);
      syncWorldLandscape(runtime,map);
      (runtime.app.graphicsDevice.canvas as HTMLCanvasElement).dataset.lightingQuality = map.lighting?.quality ?? "balanced";
      runtime.orbit.target.set(0, 0, 0);
      runtime.orbit.distance = Math.max(25, Math.max(map.width, map.depth) * 1.05);
      updateCamera(runtime);
      runtime.worldVisibility = null;
      runtime.worldVisibilitySignature = "";
      runtime.worldStreaming.reset();
      refreshWorldVisibility(runtime, map, selectedEntityId);
      syncObjects(runtime, map, tokenAssets, propAssets, materialAssets, { assets: basePlateAssets, campaignAssignments: campaignBasePlateAssignments, sceneAssignments: sceneBasePlateAssignments, tokenCharacterLinks });
      rebuildEnvironment(runtime.lighting, map, environmentPanorama);
      rebuildDynamicLights(runtime.lighting, map);
      rebuildFogOfWar(runtime, map, tokenAssets);
    }
  }, [map.id]);

  useEffect(() => {
    const focus = (event: Event) => {
      const runtime = runtimeRef.current, id = (event as CustomEvent<{ entityId: string }>).detail?.entityId;
      const entity = callbacksRef.current.map.entities.find(entity => entity.id === id);
      if (!runtime || !entity) return;
      const access = buildingAccess(entity), target = access?.anchor ?? entity.position;
      runtime.orbit.target.set(target.x, target.y + 1, target.z);
      runtime.orbit.distance = 14; runtime.orbit.pitch = 48; updateCamera(runtime);
    };
    window.addEventListener("dndrom:focus-building", focus);
    return () => window.removeEventListener("dndrom:focus-building", focus);
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime) {
      (runtime.app.graphicsDevice.canvas as HTMLCanvasElement).dataset.lightingQuality = map.lighting?.quality ?? "balanced";
      refreshWorldVisibility(runtime, map, selectedEntityId);
      syncObjects(runtime, map, tokenAssets, propAssets, materialAssets, { assets: basePlateAssets, campaignAssignments: campaignBasePlateAssignments, sceneAssignments: sceneBasePlateAssignments, tokenCharacterLinks });
      applyLightingRig(runtime.lighting, map);
      syncVolumetricClouds(runtime, map);
      syncWorldLandscape(runtime,map);
      rebuildDynamicLights(runtime.lighting, map);
      rebuildFogOfWar(runtime, map, tokenAssets);
    }
    if (runtime) for (const entity of map.entities) {
      const root = runtime.objectRoots.get(entity.id);
      if (root) for (const roof of root.findByTag("world-material:roof")) roof.enabled = entity.id !== map.journey?.activeBuildingId;
    }
  }, [map.journey?.activeBuildingId, map.entities, map.ambientColor, map.lighting, tokenAssets, propAssets, materialAssets, basePlateAssets, campaignBasePlateAssignments, sceneBasePlateAssignments, tokenCharacterLinks]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.mode = mode;
    for (const entity of map.entities) {
      const root = runtime.objectRoots.get(entity.id);
      if (root) root.enabled = shouldRenderWorldEntity(entity.chunkId, runtime.worldVisibility) && !entity.hidden && (!ASSET_BY_ID.get(entity.assetId)?.editorOnly || mode === "build");
    }
  }, [mode, map.entities]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.reducedMotion = resolvedMotionReduction(displaySettings);
    applyLightingRig(runtime.lighting, map, displaySettings);
    syncVolumetricClouds(runtime, map);
      syncWorldLandscape(runtime,map);
    rebuildEnvironment(runtime.lighting, map, environmentPanorama, displaySettings);
    rebuildDynamicLights(runtime.lighting, map, displaySettings);
    const canvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
    canvas.dataset.motion = runtime.reducedMotion ? "reduced" : "full";
    refreshWorldVisibility(runtime, map, selectedEntityId);
    syncObjects(runtime, map, tokenAssets, propAssets, materialAssets, { assets: basePlateAssets, campaignAssignments: campaignBasePlateAssignments, sceneAssignments: sceneBasePlateAssignments, tokenCharacterLinks });
  }, [displaySettings]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime) rebuildEnvironment(runtime.lighting, map, environmentPanorama);
  }, [environmentPanorama]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    ghostStateRef.current = { raw: null, target: null, rotationY: 0, lastValidation: 0, snappingDisabled: false, wasSnapped: false, lastRay: null };
    rebuildGhost(runtime, activeAssetId, tokenAssets, propAssets);
    setPlacementFeedback(null);
  }, [activeAssetId, tokenAssets, propAssets]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    void syncScenery(runtime, map).then(setSplatIssue).catch((error) => setSplatIssue(error instanceof Error ? error.message : "Splat scenery failed to load"));
  }, [map.id, map.scenery]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime) rebuildGrid(runtime, map, showGrid);
  }, [map.width, map.depth, map.gridSize, map.gridShape, showGrid]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    for (const child of [...runtime.selectionRoot.children]) child.destroy();
    runtime.selectionMaterial?.destroy();
    runtime.selectionMaterial = null;
    const selectionCanvas = runtime.app.graphicsDevice.canvas as HTMLCanvasElement;
    selectionCanvas.dataset.selectionStyle = "none";
    selectionCanvas.dataset.selectedAssetId = "";
    if (!selectedEntityId) return;
    const selected = map.entities.find((entry) => entry.id === selectedEntityId);
    if (!selected) return;
    selectionCanvas.dataset.selectedAssetId = selected.assetId;
    const source = runtime.objectRoots.get(selected.id);
    if (source && (mode === "build" || !ASSET_BY_ID.get(selected.assetId)?.editorOnly)) {
      const highlight = source.clone();
      const highlightMaterial = createFresnelSelectionMaterial();
      for (const component of highlight.findComponents("render") as pc.RenderComponent[]) {
        if (component.entity.name === "Miniature contact shadow") {
          component.entity.enabled = false;
          continue;
        }
        component.castShadows = false;
        component.receiveShadows = false;
        for (const meshInstance of component.meshInstances) meshInstance.material = highlightMaterial;
      }
      const selectedSpec = buildSpec(selected.assetId, tokenAssets, propAssets);
      const floorLift = selectedSpec?.shape === "floor" ? .012 : 0;
      highlight.setLocalPosition(selected.position.x, selected.position.y + floorLift, selected.position.z);
      highlight.setLocalEulerAngles(selected.rotation.x, selected.rotation.y, selected.rotation.z);
      highlight.setLocalScale(selected.scale.x * (selectedSpec?.shape === "floor" ? 1.003 : 1.018), selected.scale.y * 1.018, selected.scale.z * (selectedSpec?.shape === "floor" ? 1.003 : 1.018));
      runtime.selectionRoot.addChild(highlight);
      runtime.selectionMaterial = highlightMaterial;
    }
    selectionCanvas.dataset.selectionStyle = "subtle-green-object-overlay";
  }, [selectedEntityId, map.entities, tokenAssets, propAssets, mode]);

  return (
    <div className={`scene-viewport scene-lens-${displaySettings.quality} ${placementError ? "placement-error" : ""}`}>
      <div ref={canvasHostRef} className="shared-playcanvas-host" />
      {!ready && <div className="scene-loading">Lighting the table…</div>}
      {splatIssue && <div className="scene-splat-warning">{splatIssue}</div>}
      {diceSumPresentation && <div className="dice-sum-reveal" role="status" aria-live="polite" aria-label={`Dice total ${diceSumPresentation.total}`}>
        <span>{diceSumPresentation.breakdown}</span>
        <strong>{diceSumPresentation.total}</strong>
        <small>{diceSumPresentation.expression} total</small>
      </div>}
      {activeAssetId && placementFeedback && <div className={`ghost-status ${placementFeedback.valid ? (placementFeedback.snapped ? "snapped" : "valid") : "invalid"}`}><i /><span>{placementFeedback.valid ? (placementFeedback.snapped ? `${placementFeedback.surface ?? "Snap"} on ${placementFeedback.parent ?? "support"}` : "Ready to place") : placementFeedback.reason}</span></div>}
      <div className="scene-help">Right drag: orbit · Shift drag: pan · {activeAssetId ? "Wheel: rotate · Alt: free place · Middle click: pipette" : "Wheel: zoom · Middle click: pipette"} · Click: {activeAssetId ? "place" : "select"}</div>
      <div className="scene-badge">{map.theme} · {map.entities.length} objects{map.scenery?.some((entry) => entry.enabled) ? ` · ${map.scenery.filter((entry) => entry.enabled).length} splat` : ""}</div>
    </div>
  );
}

export function SceneViewport(props: SceneViewportProps) { return isUnreal() ? <NativeSceneViewport {...props} /> : <PlayCanvasSceneViewport {...props} />; }
