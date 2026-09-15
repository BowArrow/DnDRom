export type AppMode = "build" | "play";
export type PanelTab = "dm" | "inspect" | "characters" | "session";
export type MapTheme = "dungeon" | "tavern" | "forest" | "ruins" | "cavern" | "city" | "town" | "village" | "plains" | "mountains" | "coast" | "swamp";
export type LightingQuality = "performance" | "balanced" | "cinematic" | "diorama";
export type LightingMood = "natural" | "warm" | "moonlight" | "crypt" | "desert";
export type AssetCategory = "architecture" | "furniture" | "nature" | "tokens" | "effects";
export type AbilityKey = "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type AttachmentProfile = "tabletop" | "floor-standing" | "wall-mounted" | "ceiling-hanging" | "stackable" | "structural";
export type AttachmentSurfaceKind = "floor" | "tabletop" | "wall" | "ceiling" | "stack-top" | "structural-edge";
export type PropCollisionMode = "solid" | "clearance" | "none";

export interface PropBounds {
  min: Vec3;
  max: Vec3;
}

export interface AttachmentSurface {
  id: string;
  name: string;
  kind: AttachmentSurfaceKind;
  /** Surface origin and basis in the asset's local space. */
  position: Vec3;
  normal: Vec3;
  tangent: Vec3;
  bitangent: Vec3;
  halfSize: { x: number; y: number };
  accepts: AttachmentProfile[];
  hidden?: boolean;
}

export interface PracticalLightBehavior {
  kind: "practical-light";
  lightType: "point" | "spot";
  color: string;
  intensity: number;
  range: number;
  coneAngle: number;
  anchor: Vec3;
  direction: Vec3;
  flicker?: { enabled: boolean; amount: number; speed: number };
}

export type PropBehavior = { kind: "static" } | PracticalLightBehavior;

export interface PropAssetRevision {
  id: string;
  storageKey: string;
  filename: string;
  byteLength: number;
  createdAt: string;
  prompt?: string;
}

export interface PropAsset {
  id: string;
  name: string;
  description: string;
  storageKey: string;
  filename: string;
  byteLength: number;
  triangleCount: number;
  source: "pixal3d" | "trellis2" | "import";
  sourceImage?: TokenSourceImage;
  profile: AttachmentProfile;
  acceptedSurfaceTags: AttachmentSurfaceKind[];
  providedSurfaces: AttachmentSurface[];
  bounds: PropBounds;
  collisionMode: PropCollisionMode;
  bottomAnchor: Vec3;
  forwardAnchor: Vec3;
  defaultBehavior: PropBehavior;
  defaultPlacementScale: number;
  revisions: PropAssetRevision[];
  createdAt: string;
  updatedAt: string;
  gameplayAuthority: "mesh-prop";
}

export type MaterialTarget = "floor" | "wall" | "pillar" | "general";
export type MaterialProjection = "planar-xz" | "planar-xy" | "triplanar" | "uv";

export interface MaterialMapSet {
  albedo?: string;
  normal?: string;
  roughness?: string;
  metallic?: string;
  ambientOcclusion?: string;
}

export interface MaterialAssetRevision {
  id: string;
  maps: MaterialMapSet;
  createdAt: string;
  prompt?: string;
}

export interface MaterialAsset {
  id: string;
  name: string;
  description: string;
  target: MaterialTarget;
  materialClass: "wood" | "stone" | "metal" | "painted" | "fabric" | "general";
  maps: MaterialMapSet;
  projection: MaterialProjection;
  scale: number;
  rotation: number;
  normalStrength: number;
  roughness: number;
  metallic: number;
  seamScore?: number;
  source: "local-ai" | "cloud-ai" | "import";
  prompt?: string;
  revisions: MaterialAssetRevision[];
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentTransformV2 {
  placementVersion: 2;
  parentId?: string;
  surfaceId?: string;
  localPosition: Vec3;
  localRotation: Vec3;
  surfaceNormal: Vec3;
  clearanceOffset: number;
}

export interface MapEntity {
  worldAccess?: { entrance: Vec3; anchor: Vec3 };
  routeMotion?: { points: Vec3[]; speed: number; dwell: number };
  id: string;
  assetId: string;
  name: string;
  /** Streaming ownership. Legacy entities without a chunk remain globally visible. */
  chunkId?: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  tint?: string;
  materialAssetId?: string;
  materialSlots?: Partial<Record<WorldMaterialRole, string>>;
  /** Per-instance practical-light settings. Scene lights use this without rendering gameplay geometry. */
  light?: PracticalLightBehavior;
  hidden?: boolean;
  locked?: boolean;
  notes?: string;
  tags?: string[];
  /** Deterministic geometry rebuilt from the world blueprint at the requested LOD. */
  worldGeometry?: WorldProceduralGeometry;
  /** Per-placed-copy visual form, so one reusable token can shapeshift independently. */
  tokenStateId?: string;
  /** Active authored motion. Idle motions loop; action motions use tokenAnimationStartedAt. */
  tokenAnimationId?: string;
  tokenAnimationStartedAt?: string;
  build?: {
    placedAt: string;
    refundableUntil: string;
    parentId?: string;
    socketId?: string;
    placementVersion: 1;
  } | ({
    placedAt: string;
    refundableUntil: string;
  } & AttachmentTransformV2);
}

export interface WorldTerrainGeometry {
  worldSite?:import("./worldSite").WorldSite;
  kind: "terrain";
  seed: number;
  originX: number;
  originZ: number;
  size: number;
  baseHeight: number;
  relief: number;
  roughness: number;
  erosion: number;
  biomeId?: WorldBiomeSpec["id"];
  waterLevel?: number;
  /** Connected paths that are graded into the heightfield. */
  paths: Array<{ ax: number; az: number; bx: number; bz: number; width: number; bridge?: boolean }>;
  /** Sink-filled D8 drainage paths carved before roads and settlements. */
  rivers?: Array<{ ax: number; az: number; bx: number; bz: number; width: number; depth: number; flow: number }>;
  /** Optional authoritative row-major samples. These are cut from the global
   * region field, including erosion, drainage carving, and road grading. */
  heightfield?: {
    resolution: number;
    heights: number[];
    /** Soft terrain-paint weight for the compiled road surface. */
    roadWeights?: number[];
    /** Integer one-meter gameplay level nearest each visual sample. */
    terraceLevels?: number[];
    /** SoilMachine-inspired compact surface sections sampled from the global
     * layer map. Values are meters except saturation, which is normalized. */
    soilDepth?: number[];
    screeDepth?: number[];
    bedrockExposure?: number[];
    saturation?: number[];
    /** Desert-only movable sediment and particle diagnostics. */
    aeolianSediment?: number[];
    windPath?: number[];
    abrasion?: number[];
  };
}

export interface WorldWaterGeometry {
  kind: "water";
  originX: number;
  originZ: number;
  size: number;
  waterLevel: number;
  resolution: number;
  /** Row-major (resolution + 1)^2 corner samples for marching squares. */
  wetCells: boolean[];
  /** Signed distance-like elevation delta. Positive values are submerged and
   * let contour vertices interpolate within a cell instead of snapping to its midpoint. */
  depthField?: number[];
  /** Row-major 0..1 bank proximity used by the foam shader. */
  shoreline?: number[];
  /** Absolute row-major water-surface elevation. This allows independently
   * elevated filled basins instead of forcing every lake to global sea level. */
  surfaceHeights?: number[];
  /** Row-major normalized X/Z downstream vectors, two numbers per cell. */
  flowVectors?: number[];
}

export interface WorldRibbonGeometry {
  kind: "road-ribbon" | "river-ribbon";
  /** World-space centerline. Short, smoothed spans make curves continuous
   * without storing unrestricted generated mesh data. */
  paths: Array<Array<{
    x: number;
    y: number;
    z: number;
    width: number;
    /** Region-space tangent evaluated before chunk clipping. Keeping it with
     * the sample prevents adjacent chunks from deriving different bank
     * frames at the same spline point. */
    tangentX?: number;
    tangentZ?: number;
  }>>;
  surface: "dirt" | "stone" | "wood" | "water";
  bankDepth?: number;
  flowSpeed?: number;
  bridge?: boolean;
}

export interface WorldGroundCoverGeometry {
  kind: "ground-cover";
  instances: Array<{ x: number; y: number; z: number; scale: number; rotation: number }>;
  color: string;
}

export interface WorldBuildingFacadeTile {
  edge: number;
  floor: number;
  offset: number;
  width: number;
  kind: "wall" | "door" | "window";
  /** Remaining wall fraction; zero is a collapsed opening. */
  integrity?: number;
}

/** Compact, rule-derived CGA description. The renderer rebuilds the structural
 * mesh from these rules instead of persisting unrestricted vertex buffers. */
export interface WorldBuildingGeometry {
  kind: "cga-building";
  /** Clockwise local X/Z footprint, including optional L-shaped setbacks. */
  footprint: Array<{ x: number; z: number }>;
  floors: number;
  floorHeight: number;
  wallThickness: number;
  roof: "gable" | "hip" | "flat" | "ruined";
  ruinSeed?: number;
  facadeTiles: WorldBuildingFacadeTile[];
  palette: { foundation: string; wall: string; trim: string; roof: string; glass: string; door: string };
}

export interface WorldTreeBranch {
  parent: number;
  start: Vec3;
  end: Vec3;
  startRadius: number;
  endRadius: number;
}

/** Output of deterministic space colonization. Branches remain authoritative;
 * leaf clusters are presentation hints rebuilt per LOD. */
export interface WorldTreeGeometry {
  kind: "space-colonized-tree";
  /** Seeded prototypes are reconstructed once; batches store only placements. */
  prototypeSeed?: number;
  instances?: Array<{ x: number; y: number; z: number; rotation: number; scale: number }>;
  style: WorldBiomeSpec["treeStyle"];
  branches: WorldTreeBranch[];
  leafClusters: Array<{ position: Vec3; radius: Vec3; phase: number }>;
  barkColor: string;
  leafColors: [string, string];
}

export interface WorldAssemblyGeometry { kind: "assembly"; recipeId: string; parts: import("./sceneGrammar").ScenePart[] }
export type WorldProceduralGeometry = WorldTerrainGeometry | WorldWaterGeometry | WorldRibbonGeometry | WorldGroundCoverGeometry | WorldBuildingGeometry | WorldTreeGeometry | WorldAssemblyGeometry;

export type TokenKind = "player" | "enemy" | "boss";
export type TokenBaseShape = "round" | "square" | "hex";
export type TokenAnimationKind = "idle" | "attack" | "ability" | "reaction" | "transform";
export type TokenMotionProfile = "breathe" | "hover" | "prowl" | "lunge" | "slash" | "slam" | "spin" | "cast" | "roar" | "burst";

export interface TokenAnimation {
  id: string;
  name: string;
  kind: TokenAnimationKind;
  prompt: string;
  motion: TokenMotionProfile;
  loop: boolean;
  duration: number;
  intensity: number;
  source: "procedural" | "hy-motion" | "import";
  sourceFile?: {
    storageKey: string;
    filename: string;
    byteLength: number;
    format: "fbx" | "glb";
  };
}

export interface TokenModelRevision {
  id: string;
  storageKey: string;
  filename: string;
  byteLength: number;
  createdAt: string;
  prompt?: string;
  source: "generated" | "prompt-edit" | "paint" | "import";
}

export interface TokenRigFile {
  storageKey: string;
  filename: string;
  byteLength: number;
  format: "fbx" | "glb";
  profile: "humanoid" | "creature";
  createdAt: string;
}

export interface TokenSourceImage {
  storageKey: string;
  filename: string;
  byteLength: number;
  mimeType: string;
}

export interface TokenVisualState {
  id: string;
  /** Styles with the same formId are alternate looks for one gameplay form. */
  formId?: string;
  name: string;
  styleName?: string;
  storageKey: string;
  filename: string;
  byteLength: number;
  modelScale: number;
  modelLift: number;
  animations: TokenAnimation[];
  /** Rig owned by this form/style. Styles may reuse the same content-addressed rig. */
  rig?: TokenRigFile;
  /** Most recent local model snapshots, newest first. */
  revisions?: TokenModelRevision[];
  createdAt: string;
}

export type BasePlateShape = TokenBaseShape | "inherit";
export type BasePlatePreset = "pond" | "grass" | "forest" | "stone" | "snow" | "sand" | "swamp" | "volcanic" | "tavern" | "dungeon" | "arcane";
export type BasePlateLayerKind = "plinth" | "surface" | "decoration" | "prop" | "effect";
export type BasePlateEffectKind = "water" | "foliage" | "motes" | "petals" | "glow";

export interface BasePlateEffect {
  kind: BasePlateEffectKind;
  enabled: boolean;
  color: string;
  intensity: number;
  speed: number;
  particleCount?: number;
}

export interface BasePlateLayer {
  id: string;
  name: string;
  kind: BasePlateLayerKind;
  enabled: boolean;
  order: number;
  materialAssetId?: string;
  propAssetId?: string;
  role?: "base-surface";
  color?: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  density?: number;
  relief?: number;
  /** Visual foliage and water may extend no farther than 8 percent beyond the rules footprint. */
  overhang?: number;
  solid?: boolean;
  triangleCount?: number;
  effect?: BasePlateEffect;
  customMaps?: MaterialMapSet;
  heightStorageKey?: string;
}

export interface BasePlateRecipe {
  version: 1;
  preset: BasePlatePreset;
  description: string;
  visualShape: BasePlateShape;
  plinthColor: string;
  rimColor: string;
  plinthHeight: number;
  surfaceRelief: number;
  /** Maximum scenic mesh height as a fraction of the base diameter. */
  sceneryHeightRatio?: number;
  /** Optional standing position in fractions of the base width. */
  standingPoint?: { x: number; z: number };
  footClearance: {
    source: "mesh-lowest-12" | "fallback-ellipse" | "manual";
    radius: number;
    dilation: number;
    maskStorageKey?: string;
  };
  layers: BasePlateLayer[];
}

export interface BasePlateRevision {
  id: string;
  recipe: BasePlateRecipe;
  createdAt: string;
  prompt?: string;
}

export interface BasePlateAsset {
  id: string;
  name: string;
  description: string;
  recipe: BasePlateRecipe;
  source: "procedural" | "local-ai" | "cloud-ai" | "import";
  sourceImageStorageKey?: string;
  thumbnailStorageKey?: string;
  revisions: BasePlateRevision[];
  createdAt: string;
  updatedAt: string;
}

export type BasePlateAssignmentSubject = `character:${string}` | `token:${string}` | `entity:${string}`;
export type BasePlateAssignmentMap = Partial<Record<BasePlateAssignmentSubject, string>>;
export type DiceSides = 4 | 6 | 8 | 10 | 12 | 20 | 100;

export interface DicePbrMaps {
  albedo?: string;
  normal?: string;
  roughness?: string;
  metallic?: string;
  ambientOcclusion?: string;
  /** Grayscale mask used by animated surface-energy effects. */
  emissive?: string;
}

export type DiceEnergyStyle = "arcane-veins" | "lightning-cracks" | "lava" | "frost" | "runes";
export type DiceTrailStyle = "wisps" | "sparks" | "embers";
export type DiceImpactStyle = "shockwave" | "rune-burst" | "shards";
export type DiceParticleStyle = "soft-motes" | "sparks" | "embers" | "snow" | "smoke" | "stars";
export type DiceParticleEmission = "trail" | "impact" | "both";

export interface DiceEffects {
  surface: {
    enabled: boolean;
    style: DiceEnergyStyle;
    color: string;
    intensity: number;
    speed: number;
    pulse: number;
  };
  trail: {
    enabled: boolean;
    style: DiceTrailStyle;
    color: string;
    intensity: number;
    length: number;
    width: number;
  };
  impact: {
    enabled: boolean;
    style: DiceImpactStyle;
    color: string;
    intensity: number;
    size: number;
    duration: number;
  };
  particles: {
    enabled: boolean;
    style: DiceParticleStyle;
    emission: DiceParticleEmission;
    color: string;
    secondaryColor: string;
    count: number;
    lifetime: number;
    size: number;
    speed: number;
    gravity: number;
    spread: number;
    turbulence: number;
  };
}

export interface DiceTheme {
  id: string;
  name: string;
  description: string;
  baseColor: string;
  numberColor: string;
  numberOutlineColor: string;
  roughness: number;
  metallic: number;
  clearCoat: number;
  clearCoatGloss: number;
  normalStrength: number;
  maps: DicePbrMaps;
  /** Optional for backwards compatibility with themes saved before effects. */
  effects?: DiceEffects;
  /** User-authored direction used by the local AI VFX designer. */
  effectPrompt?: string;
  source: "painted" | "local-ai" | "cloud-ai" | "import";
  createdAt: string;
  updatedAt: string;
}

export interface TokenAsset {
  id: string;
  name: string;
  kind: TokenKind;
  storageKey: string;
  filename: string;
  byteLength: number;
  footprint: number;
  modelScale: number;
  modelLift: number;
  defaultPlacementScale: number;
  base: {
    shape: TokenBaseShape;
    color: string;
    accentColor: string;
    height: number;
  };
  characterId?: string;
  source: "pixal3d" | "trellis2" | "import";
  sourceImageName?: string;
  /** Editable reference and protected upload retained with the local catalogue entry. */
  sourceImage?: TokenSourceImage;
  originalSourceImage?: TokenSourceImage;
  /** Optional for tokens saved before multi-form support. The root model remains the default fallback. */
  states?: TokenVisualState[];
  defaultStateId?: string;
  defaultBasePlateAssetId?: string;
  /** A form owns its scenic base; alternate visual styles inherit through formId. */
  formBasePlateAssignments?: Record<string, string>;
  createdAt: string;
  gameplayAuthority: "mesh-token";
}

export type SplatFormat = "ply" | "compressed-ply" | "sog";

export interface SplatBounds {
  min: Vec3;
  max: Vec3;
}

export interface WorldSplatTileDescriptor {
  id: string;
  storageKey: string;
  bounds: SplatBounds;
  byteLength: number;
  lod: 0 | 1 | 2;
}

export interface WorldSplatTileIndex {
  version: 1;
  sourceBounds: SplatBounds;
  tileSize: number;
  tiles: WorldSplatTileDescriptor[];
}

export interface SplatScenery {
  id: string;
  name: string;
  storageKey: string;
  filename: string;
  format: SplatFormat;
  byteLength: number;
  splatCount?: number;
  /** Source-space bounds retained so generated scenery can be fitted to the
   * authoritative tabletop without changing the splat binary. */
  bounds?: SplatBounds;
  /** Optional content-addressed spatial index for independently streamed background tiles. */
  chunkIndexStorageKey?: string;
  /** World-space gameplay volume which presentation scenery must not cover. */
  clipBounds?: SplatBounds;
  /** Import-time quality evidence retained for diagnostics and safe retries. */
  qualityReport?: SplatQualityReport;
  fitMode?: "tabletop" | "manual";
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  enabled: boolean;
  source: "splatkit" | "import";
  sourceUrl?: string;
  license?: string;
  gameplayAuthority: "presentation-only";
}

export type WorldRegionKind = "interior" | "exterior" | "settlement" | "dungeon";
export type WorldRegionSize = "small" | "medium" | "large";
export type WorldForgeQuality = "quick" | "complete" | "showpiece";
export type WorldChunkLodLevel = 0 | 1 | 2;

export interface WorldZone {
  id: string;
  name: string;
  purpose: "entry" | "encounter" | "landmark" | "settlement" | "wilderness" | "interior" | "secret" | "exit";
  center: Vec3;
  radius: number;
  requiredConnections: string[];
}

export interface WorldTerrainSpec {
  baseHeight: number;
  relief: number;
  roughness: number;
  erosion: number;
  moisture: number;
  waterLevel?: number;
  roadMaterial: "stone" | "wood" | "dirt";
}

export interface WorldBiomeSpec {
  id: "forest" | "plains" | "mountains" | "coast" | "swamp" | "desert" | "snow" | "urban" | "dungeon" | "cavern";
  vegetationDensity: number;
  treeStyle: "pine" | "dead" | "broadleaf" | "cypress" | "none";
  palette: { ground: string; accent: string; water: string };
}

export interface WorldAssetRequest {
  id: string;
  name: string;
  category: AssetCategory;
  description: string;
  importance: "structural" | "repeated" | "hero";
  resolvedAssetId?: string;
  status: "resolved" | "placeholder" | "pending-review" | "approved";
}

export interface WorldBlueprintV1 {
  version: 1;
  id: string;
  name: string;
  description: string;
  seed: number;
  kind: WorldRegionKind;
  size: WorldRegionSize;
  width: 64 | 128 | 256;
  depth: 64 | 128 | 256;
  chunkSize: 16;
  gridShape: "square" | "hex";
  theme: MapTheme;
  mood: LightingMood;
  biome: WorldBiomeSpec;
  biomeRegions?: import("./worldGeography").BiomeRegion[];
  weather?: import("./worldWeather").WorldWeather;
  terrain: WorldTerrainSpec;
  siteIntent?: import("./worldSite").SiteIntent;
  site?: import("./worldSite").WorldSite;
  architecture?: { material: "timber" | "stone"; ruin: number; density: number };
  composition?: import("./sceneGrammar").SceneComposition;
  zones: WorldZone[];
  assetRequests: WorldAssetRequest[];
  presentation: { background: "none" | "panorama" | "splat"; prompt: string };
}

export type WorldMaterialRole = "ground" | "masonry" | "timber" | "roof" | "foliage";

export interface WorldChunkBounds {
  min: Vec3;
  max: Vec3;
}

export interface WorldChunkLOD {
  level: WorldChunkLodLevel;
  meshStorageKey?: string;
  triangleCount: number;
  byteLength: number;
}

export interface WorldChunkDescriptor {
  id: string;
  x: number;
  z: number;
  bounds: WorldChunkBounds;
  entityIds: string[];
  lods: WorldChunkLOD[];
  heightfieldStorageKey?: string;
  navigationStorageKey?: string;
  navigationSummary?: { resolution: number; walkableCells: number; blockedCells: number; connected: boolean };
  roomIds?: string[];
  portalChunkIds?: string[];
  lightEntityIds?: string[];
  splatTileIds?: string[];
  landmark?: boolean;
  generationHash: string;
}

export interface WorldRegionManifest {
  environment?: import('./sharedWorld').SceneEnvironment;
  sharedWorld?: import("./sharedWorld").WorldManifest;
  version: 1;
  site?: import("./worldSite").WorldSite;
  /** Visual compiler revision. Missing means the legacy flat-tile pipeline. */
  generatorRevision?: number;
  blueprintId: string;
  seed: number;
  chunkSize: 16;
  chunks: WorldChunkDescriptor[];
  hydrology?: {
    resolution: number;
    cellSize: number;
    riverSegments: number;
    maximumAccumulation: number;
    sinkFilled: boolean;
    filledCellCount?: number;
    maximumFillDepth?: number;
  };
  fieldSet?: {
    resolution: number;
    cellSize: number;
    layers: Array<"elevation" | "waterMask" | "waterSurface" | "waterDepth" | "filledElevation" | "poolDepth" | "streamMap" | "momentumX" | "momentumZ" | "soilDepth" | "screeDepth" | "bedrockExposure" | "saturation" | "flowDirection" | "accumulation" | "slope" | "curvature" | "moisture" | "sediment" | "aeolianSediment" | "windPath" | "abrasion">;
    erosionPasses: number;
    authority: "global-region";
  };
  generatedAt: string;
}

export interface WorldGenerationProvenance {
  blueprint: WorldBlueprintV1;
  provider: "local-ai" | "procedural";
  quality: WorldForgeQuality;
  revision: number;
  generatedAt: string;
}

export interface WorldPendingRefinement {
  id: string;
  assetRequestId: string;
  kind: "prop" | "material";
  prompt: string;
  status: "needs-review" | "catalogue-match" | "approved" | "applied";
  resolvedAssetId?: string;
  source: "campaign" | "device" | "procedural" | "ai-request";
  createdAt: string;
}

export interface WorldSpawnZone {
  id: string;
  kind: "party" | "enemy" | "neutral" | "exit";
  center: Vec3;
  radius: number;
}

export interface WorldValidationReport {
  valid: boolean;
  repairPasses: number;
  reachableZoneIds: string[];
  warnings: string[];
  errors: string[];
}

export interface SplatQualityReport {
  registeredCameraRatio: number;
  railRegistrationRatios: number[];
  largestComponentRatio: number;
  gaussianCount: number;
  groundPlaneSupport: number;
  boundsToRailRatio: number;
  oversizedGaussianSheetDetected?: boolean;
  gameplayVolumeIntersection?: boolean;
  accepted: boolean;
  reasons: string[];
}

export type SplatReconstructionMetrics = Omit<SplatQualityReport, "gaussianCount" | "accepted" | "reasons" | "oversizedGaussianSheetDetected" | "gameplayVolumeIntersection">;

export interface SceneTemplateRevision {
  id: string;
  map: GameMap;
  createdAt: string;
  summary: string;
}

export interface SceneTemplateAsset {
  id: string;
  name: string;
  description: string;
  map: GameMap;
  thumbnailStorageKey?: string;
  propAssetIds: string[];
  materialAssetIds: string[];
  revisions: SceneTemplateRevision[];
  createdAt: string;
  updatedAt: string;
}

export interface WorldGenerationCheckpoint {
  id: string;
  campaignId: string;
  blueprintId: string;
  stage: "blueprint" | "concept" | "structure" | "validation" | "assets" | "lighting" | "reconstruction" | "complete";
  completedChunkIds: string[];
  completedAssetRequestIds: string[];
  retryable: boolean;
  reconstructionMetrics?: SplatReconstructionMetrics;
  updatedAt: string;
}

export interface GameMap {
  sharedCacheOmitted?: boolean;
  weather?: import("./worldWeather").WorldWeather;
  journey?: import("./worldGeography").WorldJourney;
  id: string;
  name: string;
  theme: MapTheme;
  width: number;
  depth: number;
  gridSize: number;
  gridShape?: "square" | "hex";
  ambientColor: string;
  lighting?: SceneLightingSettings;
  entities: MapEntity[];
  locationId?: string;
  pointsOfInterest?: PointOfInterest[];
  scenery?: SplatScenery[];
  world?: WorldRegionManifest;
  generation?: WorldGenerationProvenance;
  spawnZones?: WorldSpawnZone[];
  validation?: WorldValidationReport;
  pendingRefinements?: WorldPendingRefinement[];
}

export interface CampaignScene {
  id: string;
  name: string;
  map: GameMap;
  partyCharacterIds: string[];
  notes: string;
  basePlateAssignments?: BasePlateAssignmentMap;
  createdAt: string;
  updatedAt: string;
}

export interface SceneLightingSettings {
  quality: LightingQuality;
  mood: LightingMood;
  iblIntensity: number;
  keyIntensity: number;
  fillIntensity: number;
  rimIntensity: number;
  exposure: number;
  dynamicLights: boolean;
  ssao: boolean;
  bloom: boolean;
  depthOfField: boolean;
  fogMist: boolean;
  fogOfWar: boolean;
}

export type LocationKind = "capital" | "city" | "town" | "village" | "wilderness" | "dungeon" | "landmark";
export type StoryBeatStatus = "locked" | "available" | "active" | "resolved" | "failed" | "skipped";

export interface PointOfInterest {
  id: string;
  name: string;
  kind: "story" | "settlement" | "landmark" | "danger" | "resource" | "secret";
  description: string;
  position: Vec3;
  storyBeatIds: string[];
  discovered: boolean;
  tags: string[];
}

export interface WorldLocation {
  id: string;
  name: string;
  kind: LocationKind;
  biome: MapTheme;
  position: { x: number; z: number };
  population?: number;
  description: string;
  storyBeatIds: string[];
  pointOfInterests: PointOfInterest[];
  mapSeed: string;
}

export interface WorldRoad {
  id: string;
  fromLocationId: string;
  toLocationId: string;
  name: string;
  danger: number;
}

export interface WorldPlan {
  generationRequests?: import('./sharedWorld').SceneRequest[];
  generationStyles?: import('./sharedWorld').RegionalStyle[];
  manifest?: import("./sharedWorld").WorldManifest;
  id: string;
  name: string;
  seed: string;
  widthMiles: number;
  depthMiles: number;
  summary: string;
  locations: WorldLocation[];
  roads: WorldRoad[];
}

export interface StoryBeat {
  id: string;
  actId: string;
  title: string;
  summary: string;
  locationId?: string;
  encounterType: "social" | "exploration" | "combat" | "mystery" | "downtime";
  status: StoryBeatStatus;
  prerequisites: string[];
  successOutcome: string;
  failureOutcome: string;
  clues: string[];
}

export interface CampaignAct {
  id: string;
  title: string;
  purpose: string;
  levelStart: number;
  levelEnd: number;
  beatIds: string[];
}

export interface CampaignPlan {
  id: string;
  title: string;
  premise: string;
  incitingIncident: string;
  centralConflict: string;
  antagonist: string;
  antagonistGoal: string;
  stakes: string;
  finale: string;
  epilogue: string;
  acts: CampaignAct[];
  beats: StoryBeat[];
  createdAt: string;
}

export interface AbilityScores {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export interface ResourcePool {
  id: string;
  name: string;
  current: number;
  maximum: number;
  recharge: "none" | "shortRest" | "longRest";
}

export interface CharacterAction {
  id: string;
  name: string;
  description: string;
  ability?: AbilityKey;
  attackBonus?: number;
  damage?: string;
  range?: string;
  resourceId?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  equipped?: boolean;
  notes?: string;
}

export interface Character {
  id: string;
  name: string;
  playerName: string;
  ancestry: string;
  className: string;
  level: number;
  armorClass: number;
  speed: number;
  proficiencyBonus: number;
  hitPoints: {
    current: number;
    maximum: number;
    temporary: number;
  };
  abilities: AbilityScores;
  proficientSkills: string[];
  resources: ResourcePool[];
  actions: CharacterAction[];
  inventory: InventoryItem[];
  conditions: string[];
  exhaustion?: number;
  deathSaves?: { successes: number; failures: number; stable: boolean; dead: boolean };
  hitDice?: { die: number; current: number; maximum: number };
  savingThrowProficiencies?: AbilityKey[];
  damageResistances?: DamageType[];
  damageVulnerabilities?: DamageType[];
  damageImmunities?: DamageType[];
  portrait?: string;
  tokenAssetId: string;
  notes: string;
  importProvenance?: string;
  role?: "player" | "npc" | "enemy" | "boss";
  sheetVisibility?: "players" | "dm";
}

export type DamageType = "acid" | "bludgeoning" | "cold" | "fire" | "force" | "lightning" | "necrotic" | "piercing" | "poison" | "psychic" | "radiant" | "slashing" | "thunder";

export type DmMessageRole = "player" | "dm" | "system" | "roll";

export interface DmMessage {
  id: string;
  role: DmMessageRole;
  content: string;
  speaker?: string;
  createdAt: string;
  metadata?: {
    total?: number;
    dc?: number;
    success?: boolean;
    rolls?: number[];
    expression?: string;
    modifier?: number;
  };
}

export interface StoryThread {
  id: string;
  title: string;
  status: "open" | "resolved" | "failed";
  clock: number;
  clockMax: number;
  notes: string;
}

export interface CampaignEvent {
  id: string;
  revision: number;
  type: string;
  summary: string;
  actorId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface CampaignSettings {
  ruleset: "srd-5.2.1";
  tone: "heroic" | "dark" | "whimsical" | "mystery";
  contentIntensity: "gentle" | "standard" | "gritty";
  lines: string[];
  localAiRuntime?: "managed" | "external" | "disabled";
  localAiEndpoint: string;
  localAiModel: string;
  whisperEndpoint: string;
  localTtsEndpoint?: string;
  localTtsVoice?: string;
  speakDmResponses: boolean;
  useLocalAiForMaps: boolean;
  comfyUiEndpoint: string;
  dungeonMasterMode: "ai" | "player";
  propImageProvider?: "sana-local" | "krea-local" | "krea-cloud";
  kreaCommunityLicenseAcceptedAt?: string;
}

export interface Campaign {
  schemaVersion: 1;
  id: string;
  name: string;
  synopsis: string;
  map: GameMap;
  characters: Character[];
  tokenAssets?: TokenAsset[];
  propAssets?: PropAsset[];
  materialAssets?: MaterialAsset[];
  basePlateAssets?: BasePlateAsset[];
  sceneTemplates?: SceneTemplateAsset[];
  basePlateAssignments?: BasePlateAssignmentMap;
  /** Campaign-specific links let one reusable miniature represent different sheets in different campaigns. */
  tokenCharacterLinks?: Record<string, string>;
  scenes?: CampaignScene[];
  activeSceneId?: string;
  diceThemes?: DiceTheme[];
  diceThemeAssignments?: Partial<Record<`d${DiceSides}`, string>>;
  activeCharacterId: string;
  messages: DmMessage[];
  storyThreads: StoryThread[];
  campaignPlan?: CampaignPlan;
  world?: WorldPlan;
  archivedWorlds?: WorldPlan[];
  activeLocationId?: string;
  events: CampaignEvent[];
  revision: number;
  settings: CampaignSettings;
  createdAt: string;
  updatedAt: string;
}

export interface RollRequest {
  label: string;
  ability: AbilityKey;
  difficultyClass: number;
  proficient?: boolean;
  advantage?: "normal" | "advantage" | "disadvantage";
}

export interface RollResult {
  id: string;
  label: string;
  rolls: number[];
  kept: number;
  modifier: number;
  total: number;
  difficultyClass: number;
  success: boolean;
  naturalOne: boolean;
  naturalTwenty: boolean;
}

export interface DmResponse {
  narration: string;
  speaker?: string;
  check?: RollRequest;
  suggestedActions?: string[];
  memory?: string;
  sceneCue?: "danger" | "mystery" | "calm" | "triumph";
  storyProgress?: {
    beatId: string;
    outcome: "activate" | "success" | "failure";
    reason: string;
  };
}

export interface MultiplayerStatus {
  mode: "offline" | "host" | "client" | "server";
  connected: boolean;
  roomCode: string;
  peerCount: number;
  route: "none" | "direct" | "relay" | "server";
  message?: string;
}
