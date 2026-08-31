export type AppMode = "build" | "play";
export type PanelTab = "dm" | "inspect" | "characters" | "session";
export type MapTheme = "dungeon" | "tavern" | "forest" | "ruins" | "cavern" | "city" | "town" | "village" | "plains" | "mountains" | "coast" | "swamp";
export type AssetCategory = "architecture" | "furniture" | "nature" | "tokens" | "effects";
export type AbilityKey = "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MapEntity {
  id: string;
  assetId: string;
  name: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  tint?: string;
  hidden?: boolean;
  locked?: boolean;
  notes?: string;
  tags?: string[];
}

export type SplatFormat = "ply" | "compressed-ply" | "sog";

export interface SplatScenery {
  id: string;
  name: string;
  storageKey: string;
  filename: string;
  format: SplatFormat;
  byteLength: number;
  splatCount?: number;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  enabled: boolean;
  source: "splatkit" | "import";
  sourceUrl?: string;
  license?: string;
  gameplayAuthority: "presentation-only";
}

export interface GameMap {
  id: string;
  name: string;
  theme: MapTheme;
  width: number;
  depth: number;
  gridSize: number;
  ambientColor: string;
  entities: MapEntity[];
  locationId?: string;
  pointsOfInterest?: PointOfInterest[];
  scenery?: SplatScenery[];
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
  localAiEndpoint: string;
  localAiModel: string;
  whisperEndpoint: string;
  speakDmResponses: boolean;
  useLocalAiForMaps: boolean;
  comfyUiEndpoint: string;
}

export interface Campaign {
  schemaVersion: 1;
  id: string;
  name: string;
  synopsis: string;
  map: GameMap;
  characters: Character[];
  activeCharacterId: string;
  messages: DmMessage[];
  storyThreads: StoryThread[];
  campaignPlan?: CampaignPlan;
  world?: WorldPlan;
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
