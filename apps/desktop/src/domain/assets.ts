import type { AssetCategory, Vec3 } from "./types";

export type PrimitiveType = "box" | "cylinder" | "cone" | "sphere" | "capsule" | "plane";

export interface AssetPart {
  primitive: PrimitiveType;
  position: Vec3;
  rotation?: Vec3;
  scale: Vec3;
  color: string;
  emissive?: string;
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
}

const part = (
  primitive: PrimitiveType,
  position: Vec3,
  scale: Vec3,
  color: string,
  rotation?: Vec3,
  emissive?: string,
): AssetPart => ({ primitive, position, scale, color, rotation, emissive });

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
      part("box", { x: -0.87, y: 1, z: -0.16 }, { x: 0.16, y: 2.1, z: 0.16 }, "#3f2b1e"),
      part("box", { x: 0.87, y: 1, z: -0.16 }, { x: 0.16, y: 2.1, z: 0.16 }, "#3f2b1e"),
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
      part("cylinder", { x: 0, y: 0.65, z: 0 }, { x: 0.09, y: 1.2, z: 0.09 }, "#51351f", { x: 18, y: 0, z: 0 }),
      part("sphere", { x: 0, y: 1.3, z: -0.18 }, { x: 0.3, y: 0.42, z: 0.3 }, "#ff9f2f", undefined, "#ff8a20"),
    ],
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
      part("cone", { x: 0, y: 0.55, z: 0 }, { x: 0.7, y: 1.1, z: 0.7 }, "#ff9b2f", undefined, "#ff7b19"),
    ],
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
    parts: [part("box", { x: 0, y: -0.04, z: 0 }, { x: 2, y: 0.08, z: 4 }, "#765d43")],
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
    id: "bridge-stone",
    name: "Stone Bridge",
    category: "architecture",
    icon: "⌒",
    description: "A short bridge for river and ravine crossings.",
    footprint: 1.8,
    license: "DnDRom",
    parts: [
      part("box", { x: 0, y: 0.32, z: 0 }, { x: 3.2, y: 0.42, z: 4 }, "#73716b"),
      part("box", { x: -1.45, y: 0.75, z: 0 }, { x: 0.22, y: 1, z: 4 }, "#575754"),
      part("box", { x: 1.45, y: 0.75, z: 0 }, { x: 0.22, y: 1, z: 4 }, "#575754"),
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

const kenney = (file: string, name: string, category: AssetCategory, icon: string, footprint = 0.65, modelScale = 1): AssetDefinition => ({
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
});

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
