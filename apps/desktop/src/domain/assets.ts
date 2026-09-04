import type { AssetCategory, AttachmentProfile, AttachmentSurface, AttachmentSurfaceKind, PropBehavior, PropBounds, PropCollisionMode, Vec3 } from "./types";

export type PrimitiveType = "box" | "cylinder" | "cone" | "sphere" | "capsule" | "plane";

export interface AssetPart {
  primitive: PrimitiveType;
  position: Vec3;
  rotation?: Vec3;
  scale: Vec3;
  color: string;
  emissive?: string;
  surface?: "stone" | "wood" | "metal" | "flesh" | "fabric";
  shader?: "flame" | "resin";
}

export interface AssetDefinition {
  id: string;
  name: string;
  category: AssetCategory;
  icon: string;
  description: string;
  footprint: number;
  parts?: AssetPart[];
  modelUrl?: string;
  modelScale?: number;
  license: "DnDRom" | "CC0";
  source?: string;
  acceptedSurfaceTags?: AttachmentSurfaceKind[];
  providedSurfaces?: AttachmentSurface[];
  bounds?: PropBounds;
  collisionMode?: PropCollisionMode;
  bottomAnchor?: Vec3;
  forwardAnchor?: Vec3;
  attachmentProfile?: AttachmentProfile;
  defaultBehavior?: PropBehavior;
  /** Visible as an editor gizmo in Build mode, but never as scene geometry in Play. */
  editorOnly?: boolean;
}

const surface = (id: string, name: string, kind: AttachmentSurface["kind"], position: Vec3, normal: Vec3, tangent: Vec3, bitangent: Vec3, halfSize: { x: number; y: number }, accepts: AttachmentProfile[]): AttachmentSurface => ({ id, name, kind, position, normal, tangent, bitangent, halfSize, accepts });
const topSurface = (height: number, halfX: number, halfZ: number, kind: "floor" | "tabletop" | "stack-top" = "tabletop"): AttachmentSurface => surface("top", kind === "floor" ? "Walkable surface" : "Top surface", kind, { x: 0, y: height, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: halfX, y: halfZ }, kind === "floor" ? ["floor-standing", "structural", "wall-mounted"] : ["tabletop", "stackable", "floor-standing", "wall-mounted"]);

const part = (
  primitive: PrimitiveType,
  position: Vec3,
  scale: Vec3,
  color: string,
  rotation?: Vec3,
  emissive?: string,
  surface?: AssetPart["surface"],
  shader?: AssetPart["shader"],
): AssetPart => ({ primitive, position, scale, color, rotation, emissive, surface, shader });

const proceduralAssets: AssetDefinition[] = [
  {
    id: "floor-stone",
    name: "Stone Floor",
    category: "architecture",
    icon: "▦",
    description: "A two-meter stone floor tile.",
    footprint: 1.4,
    license: "DnDRom",
    parts: [part("box", { x: 0, y: -0.08, z: 0 }, { x: 2, y: 0.16, z: 2 }, "#5b5a57")],
    attachmentProfile: "structural", acceptedSurfaceTags: ["floor"], providedSurfaces: [topSurface(0, 1, 1, "floor")], collisionMode: "clearance",
  },
  {
    id: "floor-wood",
    name: "Wood Floor",
    category: "architecture",
    icon: "▥",
    description: "Warm planked floor tile.",
    footprint: 1.4,
    license: "DnDRom",
    parts: [part("box", { x: 0, y: -0.07, z: 0 }, { x: 2, y: 0.14, z: 2 }, "#6c482c")],
    attachmentProfile: "structural", acceptedSurfaceTags: ["floor"], providedSurfaces: [topSurface(0, 1, 1, "floor")], collisionMode: "clearance",
  },
  {
    id: "floor-grass",
    name: "Grass Tile",
    category: "nature",
    icon: "⌁",
    description: "Soft terrain for forest encounters.",
    footprint: 1.4,
    license: "DnDRom",
    parts: [part("box", { x: 0, y: -0.08, z: 0 }, { x: 2, y: 0.16, z: 2 }, "#355c3a")],
    attachmentProfile: "structural", acceptedSurfaceTags: ["floor"], providedSurfaces: [topSurface(0, 1, 1, "floor")], collisionMode: "clearance",
  },
  {
    id: "wall-stone",
    name: "Stone Wall",
    category: "architecture",
    icon: "▤",
    description: "A modular dungeon wall.",
    footprint: 1.1,
    license: "DnDRom",
    parts: [
      part("box", { x: 0, y: 1, z: 0 }, { x: 2, y: 2, z: 0.28 }, "#686866"),
      part("box", { x: 0, y: 2.05, z: 0 }, { x: 2.12, y: 0.16, z: 0.38 }, "#4d4d4b"),
    ],
    attachmentProfile: "structural", acceptedSurfaceTags: ["structural-edge"], collisionMode: "solid",
    providedSurfaces: [
      surface("inward", "Inward face", "wall", { x: 0, y: 1, z: -0.15 }, { x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1 }, ["wall-mounted"]),
      surface("outward", "Outward face", "wall", { x: 0, y: 1, z: 0.15 }, { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1 }, ["wall-mounted"]),
    ],
  },
  {
    id: "wall-wood",
    name: "Timber Wall",
    category: "architecture",
    icon: "▥",
    description: "Tavern wall with timber frame.",
    footprint: 1.1,
    license: "DnDRom",
    parts: [
      part("box", { x: 0, y: 1, z: 0 }, { x: 2, y: 2, z: 0.24 }, "#8a745d"),
      part("box", { x: -0.87, y: 1, z: 0 }, { x: 0.16, y: 2.1, z: 0.3 }, "#3f2b1e"),
      part("box", { x: 0.87, y: 1, z: 0 }, { x: 0.16, y: 2.1, z: 0.3 }, "#3f2b1e"),
    ],
    attachmentProfile: "structural", acceptedSurfaceTags: ["structural-edge"], collisionMode: "solid",
    providedSurfaces: [
      surface("inward", "Inward face", "wall", { x: 0, y: 1, z: -0.14 }, { x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1 }, ["wall-mounted"]),
      surface("outward", "Outward face", "wall", { x: 0, y: 1, z: 0.14 }, { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1 }, ["wall-mounted"]),
    ],
  },
  {
    id: "door-wood",
    name: "Wooden Door",
    category: "architecture",
    icon: "▯",
    description: "An interactive-looking framed door.",
    footprint: 1,
    license: "DnDRom",
    parts: [
      part("box", { x: 0, y: 1, z: 0 }, { x: 1.2, y: 2, z: 0.16 }, "#5a3621"),
      part("box", { x: -0.7, y: 1.1, z: 0 }, { x: 0.16, y: 2.3, z: 0.32 }, "#2d211a"),
      part("box", { x: 0.7, y: 1.1, z: 0 }, { x: 0.16, y: 2.3, z: 0.32 }, "#2d211a"),
      part("sphere", { x: 0.38, y: 1, z: -0.13 }, { x: 0.09, y: 0.09, z: 0.09 }, "#d2ad58"),
    ],
  },
  {
    id: "pillar",
    name: "Stone Pillar",
    category: "architecture",
    icon: "▥",
    description: "A heavy carved pillar.",
    footprint: 0.7,
    license: "DnDRom",
    parts: [
      part("box", { x: 0, y: 0.12, z: 0 }, { x: 0.9, y: 0.24, z: 0.9 }, "#777672"),
      part("cylinder", { x: 0, y: 1.2, z: 0 }, { x: 0.55, y: 2.2, z: 0.55 }, "#8b8983"),
      part("box", { x: 0, y: 2.32, z: 0 }, { x: 0.85, y: 0.22, z: 0.85 }, "#6e6d69"),
    ],
  },
  {
    id: "table-round",
    name: "Round Table",
    category: "furniture",
    icon: "◉",
    description: "A tavern table for rumors and trouble.",
    footprint: 0.9,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 0.78, z: 0 }, { x: 1.4, y: 0.14, z: 1.4 }, "#6d4226"),
      part("cylinder", { x: 0, y: 0.38, z: 0 }, { x: 0.22, y: 0.75, z: 0.22 }, "#3e281a"),
    ],
    attachmentProfile: "floor-standing", acceptedSurfaceTags: ["floor"], providedSurfaces: [topSurface(.86, .66, .66)], collisionMode: "solid",
  },
  {
    id: "table-long",
    name: "Long Table",
    category: "furniture",
    icon: "▬",
    description: "A sturdy rectangular table.",
    footprint: 1.3,
    license: "DnDRom",
    parts: [
      part("box", { x: 0, y: 0.8, z: 0 }, { x: 2.2, y: 0.16, z: 1.05 }, "#765034"),
      part("box", { x: -0.8, y: 0.4, z: 0 }, { x: 0.14, y: 0.8, z: 0.75 }, "#432d1d"),
      part("box", { x: 0.8, y: 0.4, z: 0 }, { x: 0.14, y: 0.8, z: 0.75 }, "#432d1d"),
    ],
    attachmentProfile: "floor-standing", acceptedSurfaceTags: ["floor"], providedSurfaces: [topSurface(.89, 1.06, .49)], collisionMode: "solid",
  },
  {
    id: "chair",
    name: "Chair",
    category: "furniture",
    icon: "♧",
    description: "A low-poly wooden chair.",
    footprint: 0.45,
    license: "DnDRom",
    parts: [
      part("box", { x: 0, y: 0.45, z: 0 }, { x: 0.65, y: 0.12, z: 0.65 }, "#765034"),
      part("box", { x: 0, y: 0.95, z: 0.28 }, { x: 0.65, y: 0.95, z: 0.12 }, "#5a3a24"),
    ],
  },
  {
    id: "crate",
    name: "Crate",
    category: "furniture",
    icon: "▧",
    description: "Stackable wooden cargo.",
    footprint: 0.55,
    license: "DnDRom",
    parts: [
      part("box", { x: 0, y: 0.45, z: 0 }, { x: 0.9, y: 0.9, z: 0.9 }, "#755134"),
      part("box", { x: 0, y: 0.45, z: -0.47 }, { x: 0.12, y: 0.92, z: 0.08 }, "#3c2a1c", { x: 0, y: 0, z: 35 }),
      part("box", { x: 0, y: 0.45, z: -0.47 }, { x: 0.12, y: 0.92, z: 0.08 }, "#3c2a1c", { x: 0, y: 0, z: -35 }),
    ],
    attachmentProfile: "stackable", acceptedSurfaceTags: ["floor", "stack-top", "tabletop"], providedSurfaces: [topSurface(.91, .43, .43, "stack-top")], collisionMode: "solid",
  },
  {
    id: "barrel",
    name: "Barrel",
    category: "furniture",
    icon: "◍",
    description: "A banded storage barrel.",
    footprint: 0.5,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 0.55, z: 0 }, { x: 0.75, y: 1.1, z: 0.75 }, "#6a4328"),
      part("cylinder", { x: 0, y: 0.25, z: 0 }, { x: 0.79, y: 0.08, z: 0.79 }, "#323437"),
      part("cylinder", { x: 0, y: 0.83, z: 0 }, { x: 0.79, y: 0.08, z: 0.79 }, "#323437"),
    ],
  },
  {
    id: "chest",
    name: "Treasure Chest",
    category: "furniture",
    icon: "▣",
    description: "A tempting locked chest.",
    footprint: 0.65,
    license: "DnDRom",
    parts: [
      part("box", { x: 0, y: 0.35, z: 0 }, { x: 1.2, y: 0.65, z: 0.72 }, "#6e4728"),
      part("cylinder", { x: 0, y: 0.72, z: 0 }, { x: 0.72, y: 1.2, z: 0.72 }, "#8a5a31", { x: 0, y: 0, z: 90 }),
      part("box", { x: 0, y: 0.52, z: -0.39 }, { x: 0.16, y: 0.34, z: 0.08 }, "#d6b45c"),
    ],
  },
  {
    id: "torch",
    name: "Torch",
    category: "effects",
    icon: "✦",
    description: "An emissive wall torch.",
    footprint: 0.35,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 0.68, z: 0 }, { x: 0.09, y: 1.2, z: 0.09 }, "#51351f"),
      part("cone", { x: 0, y: 1.38, z: 0 }, { x: 0.34, y: 0.52, z: 0.34 }, "#ff9f2f", undefined, "#ff8a20", undefined, "flame"),
    ],
    attachmentProfile: "wall-mounted", acceptedSurfaceTags: ["wall", "floor", "tabletop", "stack-top"], collisionMode: "solid", bottomAnchor: { x: 0, y: .08, z: 0 }, forwardAnchor: { x: 0, y: 0, z: -1 },
    defaultBehavior: { kind: "practical-light", lightType: "point", color: "#ff8a20", intensity: 2.1, range: 7, coneAngle: 55, anchor: { x: 0, y: 1.4, z: -.18 }, direction: { x: 0, y: 0, z: -1 }, flicker: { enabled: true, amount: .18, speed: 8 } },
  },
  {
    id: "tree-pine",
    name: "Pine Tree",
    category: "nature",
    icon: "♠",
    description: "A tall conifer for wilderness maps.",
    footprint: 1.1,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 1.2, z: 0 }, { x: 0.36, y: 2.4, z: 0.36 }, "#573b24"),
      part("cone", { x: 0, y: 2.2, z: 0 }, { x: 2.2, y: 2.6, z: 2.2 }, "#244832"),
      part("cone", { x: 0, y: 3.15, z: 0 }, { x: 1.55, y: 2.2, z: 1.55 }, "#2e5a3b"),
    ],
  },
  {
    id: "tree-dead",
    name: "Dead Tree",
    category: "nature",
    icon: "⌇",
    description: "Twisted branches for a darker scene.",
    footprint: 0.9,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 1.35, z: 0 }, { x: 0.42, y: 2.7, z: 0.42 }, "#514234", { x: 0, y: 0, z: -4 }),
      part("cylinder", { x: 0.35, y: 2.5, z: 0 }, { x: 0.18, y: 1.5, z: 0.18 }, "#514234", { x: 0, y: 0, z: -48 }),
      part("cylinder", { x: -0.38, y: 2.25, z: 0.05 }, { x: 0.16, y: 1.25, z: 0.16 }, "#514234", { x: 0, y: 0, z: 52 }),
    ],
  },
  {
    id: "tree-broadleaf",
    name: "Broadleaf Tree",
    category: "nature",
    icon: "♣",
    description: "An irregular layered deciduous canopy with visible branching.",
    footprint: 1.35,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 1.55, z: 0 }, { x: .42, y: 3.1, z: .42 }, "#4b3525", { x: 0, y: 0, z: -3 }),
      part("cylinder", { x: .35, y: 2.5, z: .05 }, { x: .18, y: 1.25, z: .18 }, "#4b3525", { x: 0, y: 0, z: -38 }),
      part("cylinder", { x: -.35, y: 2.35, z: -.08 }, { x: .16, y: 1.1, z: .16 }, "#4b3525", { x: 0, y: 0, z: 42 }),
      part("sphere", { x: 0, y: 3.25, z: 0 }, { x: 2.5, y: 1.65, z: 2.25 }, "#315b35"),
      part("sphere", { x: -.9, y: 3.05, z: .2 }, { x: 1.45, y: 1.25, z: 1.35 }, "#3b6b3b"),
      part("sphere", { x: .85, y: 3.2, z: -.25 }, { x: 1.55, y: 1.35, z: 1.45 }, "#284f31"),
      part("sphere", { x: .15, y: 3.75, z: .35 }, { x: 1.65, y: 1.2, z: 1.55 }, "#477846"),
    ],
  },
  {
    id: "tree-broadleaf-young",
    name: "Young Broadleaf Tree",
    category: "nature",
    icon: "♧",
    description: "A young layered deciduous tree for varied forest age structure.",
    footprint: .85,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 1, z: 0 }, { x: .23, y: 2, z: .23 }, "#573b27"),
      part("sphere", { x: 0, y: 2.05, z: 0 }, { x: 1.35, y: 1.15, z: 1.25 }, "#3f7040"),
      part("sphere", { x: .4, y: 2.35, z: -.12 }, { x: .8, y: .7, z: .8 }, "#2f5d37"),
    ],
  },
  {
    id: "tree-pine-young",
    name: "Young Pine",
    category: "nature",
    icon: "♠",
    description: "A narrow juvenile conifer that breaks up repeated silhouettes.",
    footprint: .75,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: .85, z: 0 }, { x: .2, y: 1.7, z: .2 }, "#503722"),
      part("cone", { x: 0, y: 1.35, z: 0 }, { x: 1.25, y: 1.45, z: 1.05 }, "#2c5537"),
      part("cone", { x: .06, y: 2, z: -.03 }, { x: .9, y: 1.25, z: .78 }, "#376640"),
    ],
  },
  {
    id: "tree-cypress",
    name: "Cypress Tree",
    category: "nature",
    icon: "♣",
    description: "A buttressed wetland tree with an asymmetric crown.",
    footprint: 1.2,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 1.5, z: 0 }, { x: .48, y: 3, z: .48 }, "#4a3b2c"),
      part("cone", { x: -.22, y: .35, z: .1 }, { x: .55, y: .7, z: .48 }, "#59452f", { x: 0, y: 0, z: -18 }),
      part("sphere", { x: 0, y: 2.8, z: 0 }, { x: 1.45, y: 2.25, z: 1.3 }, "#284c38"),
      part("sphere", { x: .35, y: 3.45, z: -.12 }, { x: 1.05, y: 1.55, z: .95 }, "#345d40"),
    ],
  },
  {
    id: "shrub-broadleaf",
    name: "Broadleaf Shrub",
    category: "nature",
    icon: "❧",
    description: "Layered understory foliage for ecological ground cover.",
    footprint: .55,
    license: "DnDRom",
    parts: [
      part("sphere", { x: 0, y: .38, z: 0 }, { x: .95, y: .65, z: .85 }, "#315b35"),
      part("sphere", { x: .28, y: .48, z: -.16 }, { x: .65, y: .55, z: .65 }, "#477847"),
    ],
  },
  {
    id: "reeds-wetland",
    name: "Wetland Reeds",
    category: "nature",
    icon: "≋",
    description: "A varied cluster of reeds for wet banks and marsh margins.",
    footprint: .45,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: -.18, y: .52, z: .08 }, { x: .04, y: 1.05, z: .04 }, "#68804a", { x: 0, y: 0, z: -5 }),
      part("cylinder", { x: .02, y: .65, z: -.12 }, { x: .045, y: 1.3, z: .045 }, "#7c9252", { x: 0, y: 0, z: 3 }),
      part("cylinder", { x: .2, y: .48, z: .12 }, { x: .035, y: .96, z: .035 }, "#526d41", { x: 0, y: 0, z: 7 }),
    ],
  },
  {
    id: "rock",
    name: "Rock",
    category: "nature",
    icon: "◆",
    description: "A rough terrain rock.",
    footprint: 0.7,
    license: "DnDRom",
    parts: [part("sphere", { x: 0, y: 0.45, z: 0 }, { x: 1.2, y: 0.75, z: 0.95 }, "#5a5d5d", { x: 12, y: 20, z: -8 })],
  },
  {
    id: "campfire",
    name: "Campfire",
    category: "effects",
    icon: "✺",
    description: "A glowing gathering point.",
    footprint: 0.75,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 0.12, z: 0 }, { x: 0.18, y: 1.2, z: 0.18 }, "#493121", { x: 0, y: 0, z: 90 }),
      part("cylinder", { x: 0, y: 0.12, z: 0 }, { x: 0.18, y: 1.2, z: 0.18 }, "#493121", { x: 0, y: 90, z: 90 }),
      part("cone", { x: 0, y: 0.55, z: 0 }, { x: 0.7, y: 1.1, z: 0.7 }, "#ff9b2f", undefined, "#ff7b19", undefined, "flame"),
    ],
    attachmentProfile: "floor-standing", acceptedSurfaceTags: ["floor"], collisionMode: "solid",
    defaultBehavior: { kind: "practical-light", lightType: "point", color: "#ff7b19", intensity: 2.5, range: 8, coneAngle: 70, anchor: { x: 0, y: .65, z: 0 }, direction: { x: 0, y: 1, z: 0 }, flicker: { enabled: true, amount: .2, speed: 7 } },
  },
  {
    id: "scene-light-point",
    name: "Scene Point Light",
    category: "effects",
    icon: "✦",
    description: "An invisible, editable omnidirectional scene light. Its gizmo is only visible in Build mode.",
    footprint: .28,
    license: "DnDRom",
    attachmentProfile: "floor-standing",
    acceptedSurfaceTags: ["floor", "tabletop", "stack-top"],
    collisionMode: "none",
    editorOnly: true,
    defaultBehavior: { kind: "practical-light", lightType: "point", color: "#ffd7a0", intensity: 1.6, range: 8, coneAngle: 55, anchor: { x: 0, y: 2.4, z: 0 }, direction: { x: 0, y: -1, z: 0 }, flicker: { enabled: false, amount: .08, speed: 5 } },
  },
  {
    id: "scene-light-spot",
    name: "Scene Spot Light",
    category: "effects",
    icon: "◁",
    description: "An invisible, editable directional scene light. Its gizmo is only visible in Build mode.",
    footprint: .28,
    license: "DnDRom",
    attachmentProfile: "floor-standing",
    acceptedSurfaceTags: ["floor", "tabletop", "stack-top"],
    collisionMode: "none",
    editorOnly: true,
    defaultBehavior: { kind: "practical-light", lightType: "spot", color: "#fff0cf", intensity: 2.2, range: 12, coneAngle: 42, anchor: { x: 0, y: 3.2, z: 0 }, direction: { x: 0, y: -1, z: -.35 }, flicker: { enabled: false, amount: .08, speed: 5 } },
  },
  {
    id: "resin-die",
    name: "Resin Die",
    category: "effects",
    icon: "◆",
    description: "A translucent clearcoat die for tabletop rolls.",
    footprint: 0.45,
    license: "DnDRom",
    parts: [part("box", { x: 0, y: 0.42, z: 0 }, { x: 0.72, y: 0.72, z: 0.72 }, "#248f80", { x: 18, y: 28, z: 8 }, undefined, undefined, "resin")],
  },
  {
    id: "token-hero",
    name: "Hero Miniature",
    category: "tokens",
    icon: "♙",
    description: "A customizable player miniature.",
    footprint: 0.55,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 0.08, z: 0 }, { x: 0.95, y: 0.16, z: 0.95 }, "#1c222b"),
      part("capsule", { x: 0, y: 0.85, z: 0 }, { x: 0.58, y: 1.35, z: 0.58 }, "#4776b7"),
      part("sphere", { x: 0, y: 1.65, z: 0 }, { x: 0.48, y: 0.48, z: 0.48 }, "#d0a37e"),
      part("cone", { x: 0, y: 1.88, z: 0 }, { x: 0.58, y: 0.5, z: 0.58 }, "#343036"),
    ],
  },
  {
    id: "token-rogue",
    name: "Rogue Miniature",
    category: "tokens",
    icon: "♟",
    description: "A hooded adventurer miniature.",
    footprint: 0.55,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 0.08, z: 0 }, { x: 0.95, y: 0.16, z: 0.95 }, "#1c222b"),
      part("capsule", { x: 0, y: 0.82, z: 0 }, { x: 0.56, y: 1.3, z: 0.56 }, "#3f4450"),
      part("sphere", { x: 0, y: 1.58, z: 0 }, { x: 0.45, y: 0.45, z: 0.45 }, "#be8f6c"),
      part("cone", { x: 0, y: 1.78, z: 0.05 }, { x: 0.75, y: 0.8, z: 0.75 }, "#242a32"),
    ],
  },
  {
    id: "token-orc",
    name: "Orc Miniature",
    category: "tokens",
    icon: "♞",
    description: "A broad hostile or allied orc.",
    footprint: 0.65,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 0.08, z: 0 }, { x: 1.05, y: 0.16, z: 1.05 }, "#261f1c"),
      part("capsule", { x: 0, y: 0.88, z: 0 }, { x: 0.78, y: 1.45, z: 0.72 }, "#536b43"),
      part("sphere", { x: 0, y: 1.7, z: 0 }, { x: 0.58, y: 0.52, z: 0.52 }, "#718755"),
    ],
  },
  {
    id: "token-monster",
    name: "Monster Miniature",
    category: "tokens",
    icon: "♜",
    description: "A generic large creature marker.",
    footprint: 0.85,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 0.08, z: 0 }, { x: 1.35, y: 0.16, z: 1.35 }, "#241b1b"),
      part("sphere", { x: 0, y: 0.85, z: 0 }, { x: 1.25, y: 1.35, z: 1.05 }, "#713d42"),
      part("cone", { x: -0.42, y: 1.7, z: 0 }, { x: 0.3, y: 0.8, z: 0.3 }, "#d1c3a3", { x: 0, y: 0, z: -12 }),
      part("cone", { x: 0.42, y: 1.7, z: 0 }, { x: 0.3, y: 0.8, z: 0.3 }, "#d1c3a3", { x: 0, y: 0, z: 12 }),
    ],
  },
  {
    id: "road-dirt",
    name: "Dirt Road",
    category: "architecture",
    icon: "═",
    description: "A broad road segment for towns and wilderness travel.",
    footprint: 1.5,
    license: "DnDRom",
    parts: [part("box", { x: 0, y: 0.012, z: 0 }, { x: 2, y: 0.08, z: 4 }, "#765d43")],
  },
  {
    id: "water-tile",
    name: "Water Tile",
    category: "nature",
    icon: "≈",
    description: "Low-cost water for rivers, coasts, and marshes.",
    footprint: 1.5,
    license: "DnDRom",
    parts: [part("box", { x: 0, y: -0.12, z: 0 }, { x: 2, y: 0.08, z: 2 }, "#294c61", undefined, "#102b3b")],
  },
  {
    id: "house-small",
    name: "Town House",
    category: "architecture",
    icon: "⌂",
    description: "A compact timber-and-plaster settlement building.",
    footprint: 1.6,
    license: "DnDRom",
    parts: [
      part("box", { x: 0, y: 1.2, z: 0 }, { x: 3, y: 2.4, z: 2.6 }, "#9a8469"),
      part("box", { x: 0, y: 2.65, z: 0 }, { x: 3.5, y: 0.35, z: 3.1 }, "#55372a", { x: 0, y: 0, z: 8 }),
      part("box", { x: 0, y: 1, z: -1.34 }, { x: 0.7, y: 1.8, z: 0.12 }, "#513421"),
    ],
  },
  {
    id: "house-large",
    name: "Guild Hall",
    category: "architecture",
    icon: "▤",
    description: "A prominent civic, guild, or noble building.",
    footprint: 2.4,
    license: "DnDRom",
    parts: [
      part("box", { x: 0, y: 1.45, z: 0 }, { x: 5, y: 2.9, z: 3.5 }, "#877865"),
      part("box", { x: 0, y: 3.1, z: 0 }, { x: 5.6, y: 0.45, z: 4.1 }, "#4b3530", { x: 0, y: 0, z: 7 }),
      part("box", { x: 0, y: 1.1, z: -1.81 }, { x: 1.1, y: 2.1, z: 0.14 }, "#402b21"),
    ],
  },
  {
    id: "market-stall",
    name: "Market Stall",
    category: "furniture",
    icon: "▥",
    description: "A colorful market vendor stall.",
    footprint: 1,
    license: "DnDRom",
    parts: [
      part("box", { x: 0, y: 0.55, z: 0 }, { x: 2, y: 1.1, z: 1.2 }, "#6c472a"),
      part("box", { x: 0, y: 1.75, z: 0 }, { x: 2.3, y: 0.16, z: 1.6 }, "#a34f45", { x: 0, y: 0, z: -5 }),
    ],
  },
  {
    id: "fence-wood",
    name: "Wood Fence",
    category: "architecture",
    icon: "╫",
    description: "A settlement, farm, or roadside fence segment.",
    footprint: 1,
    license: "DnDRom",
    parts: [
      part("box", { x: -0.9, y: 0.65, z: 0 }, { x: 0.14, y: 1.3, z: 0.14 }, "#60462f"),
      part("box", { x: 0.9, y: 0.65, z: 0 }, { x: 0.14, y: 1.3, z: 0.14 }, "#60462f"),
      part("box", { x: 0, y: 0.45, z: 0 }, { x: 2, y: 0.13, z: 0.13 }, "#765739"),
      part("box", { x: 0, y: 0.9, z: 0 }, { x: 2, y: 0.13, z: 0.13 }, "#765739"),
    ],
  },
  {
    id: "bridge-wood",
    name: "Timber Bridge",
    category: "architecture",
    icon: "=",
    description: "A modular timber crossing with visible planks, rails, and supports.",
    footprint: 1.8,
    license: "DnDRom",
    parts: [
      ...Array.from({ length: 8 }, (_, index) => part("box", { x: 0, y: .3, z: -1.75 + index * .5 }, { x: 3.2, y: .18, z: .43 }, index % 2 ? "#4e3824" : "#5a4229", undefined, undefined, "wood")),
      part("box", { x: -1.48, y: .72, z: 0 }, { x: .16, y: .15, z: 4 }, "#342519", undefined, undefined, "wood"),
      part("box", { x: 1.48, y: .72, z: 0 }, { x: .16, y: .15, z: 4 }, "#342519", undefined, undefined, "wood"),
      part("box", { x: -1.48, y: .43, z: -1.7 }, { x: .18, y: .85, z: .18 }, "#2e2117", undefined, undefined, "wood"),
      part("box", { x: 1.48, y: .43, z: -1.7 }, { x: .18, y: .85, z: .18 }, "#2e2117", undefined, undefined, "wood"),
      part("box", { x: -1.48, y: .43, z: 1.7 }, { x: .18, y: .85, z: .18 }, "#2e2117", undefined, undefined, "wood"),
      part("box", { x: 1.48, y: .43, z: 1.7 }, { x: .18, y: .85, z: .18 }, "#2e2117", undefined, undefined, "wood"),
    ],
  },
  {
    id: "bridge-stone",
    name: "Stone Bridge",
    category: "architecture",
    icon: "⌒",
    description: "A short bridge for river and ravine crossings.",
    footprint: 1.8,
    license: "DnDRom",
    parts: [
      part("box", { x: 0, y: 0.32, z: 0 }, { x: 3.2, y: 0.42, z: 4 }, "#73716b", undefined, undefined, "stone"),
      part("box", { x: -1.45, y: 0.75, z: 0 }, { x: 0.22, y: 1, z: 4 }, "#575754", undefined, undefined, "stone"),
      part("box", { x: 1.45, y: 0.75, z: 0 }, { x: 0.22, y: 1, z: 4 }, "#575754", undefined, undefined, "stone"),
    ],
  },
  {
    id: "poi-beacon",
    name: "Story Beacon",
    category: "effects",
    icon: "✧",
    description: "A visible marker for story-linked points of interest.",
    footprint: 0.45,
    license: "DnDRom",
    parts: [
      part("cylinder", { x: 0, y: 0.1, z: 0 }, { x: 0.75, y: 0.18, z: 0.75 }, "#40372a"),
      part("sphere", { x: 0, y: 1, z: 0 }, { x: 0.42, y: 0.42, z: 0.42 }, "#e4c269", undefined, "#d7a94f"),
    ],
  },
];

const kenney = (file: string, name: string, category: AssetCategory, icon: string, footprint = 0.65, modelScale = 1): AssetDefinition => {
  const wall = file === "wall" || file === "wall-half";
  return {
    id: `kenney-${file}`,
    name,
    category,
    icon,
    description: `${name} from Kenney's CC0 Mini Dungeon pack.`,
    footprint,
    modelUrl: `/assets/kenney/mini-dungeon/${file}.glb`,
    modelScale,
    license: "CC0",
    source: "https://kenney.nl/assets/mini-dungeon",
    ...(wall ? { attachmentProfile: "structural" as const, acceptedSurfaceTags: ["structural-edge" as const], collisionMode: "solid" as const, bounds: { min: { x: -1, y: 0, z: -.16 }, max: { x: 1, y: file === "wall-half" ? 1 : 2, z: .16 } } } : {}),
  };
};

const kenneyAssets: AssetDefinition[] = [
  kenney("barrel", "Kenney Barrel", "furniture", "◍"),
  kenney("chair", "Kenney Chair", "furniture", "♧"),
  kenney("chest", "Kenney Chest", "furniture", "▣"),
  kenney("column", "Kenney Column", "architecture", "▥"),
  kenney("gate", "Kenney Gate", "architecture", "▯", 1.1),
  kenney("rocks", "Kenney Rocks", "nature", "◆", 0.8),
  kenney("stairs", "Kenney Stairs", "architecture", "▱", 1),
  kenney("table", "Kenney Table", "furniture", "▬", 0.9),
  kenney("trap", "Kenney Trap", "furniture", "⌄", 0.75),
  kenney("wall", "Kenney Wall", "architecture", "▤", 1.1),
  kenney("wall-half", "Kenney Half Wall", "architecture", "▥", 1.1),
  kenney("character-human", "Kenney Human", "tokens", "♙", 0.6),
  kenney("character-orc", "Kenney Orc", "tokens", "♞", 0.65),
];

export const ASSET_CATALOG: AssetDefinition[] = [...proceduralAssets, ...kenneyAssets];
export const ASSET_BY_ID = new Map(ASSET_CATALOG.map((asset) => [asset.id, asset]));

export const ASSET_CATEGORIES: { id: AssetCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "architecture", label: "Build" },
  { id: "furniture", label: "Props" },
  { id: "nature", label: "Nature" },
  { id: "tokens", label: "Minis" },
  { id: "effects", label: "Effects" },
];
