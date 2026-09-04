import type { Vec3, WorldBiomeSpec, WorldBuildingGeometry, WorldTreeGeometry } from "./types";
import { WORLD_VISUAL_CONFIG } from "./worldVisualConfig";

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

const hash01 = (seed: number, index: number, salt = 0): number => {
  let value = Math.imul((seed ^ salt) + Math.imul(index + 1, 0x9e3779b1), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 16), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
};

const normalize = (vector: Vec3): Vec3 => {
  const length = Math.max(1e-6, Math.hypot(vector.x, vector.y, vector.z));
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
};

const distance = (left: Vec3, right: Vec3): number => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);

const BUILDING_PALETTES: Record<"timber" | "stone", WorldBuildingGeometry["palette"]> = {
  timber: { foundation: "#4a443b", wall: "#b9a47d", trim: "#513824", roof: "#493229", glass: "#79a3ad", door: "#4b3020" },
  stone: { foundation: "#4f504d", wall: "#88877f", trim: "#585955", roof: "#4c3c36", glass: "#7898a4", door: "#493628" },
};

/**
 * Deterministic CGA-style building compiler. The result records each grammar
 * stage: composite footprint, vertical extrusion/floors, facade subdivisions,
 * and the structural module selected for every tile.
 */
export function generateCgaBuilding(seed: number, prominent = false, material: "timber" | "stone" = "timber"): WorldBuildingGeometry {
  const width = (prominent ? 7.2 : 4.8) + hash01(seed, 0, 17) * (prominent ? 2.2 : 1.5);
  const depth = (prominent ? 5.8 : 3.8) + hash01(seed, 1, 29) * (prominent ? 1.8 : 1.4);
  const setback = clamp(width * (.24 + hash01(seed, 2, 41) * .12), 1.2, width * .42);
  const inset = clamp(depth * (.3 + hash01(seed, 3, 53) * .14), 1.1, depth * .48);
  const lShaped = prominent || hash01(seed, 4, 67) > .46;
  const footprint = lShaped
    ? [
      { x: -width / 2, z: -depth / 2 }, { x: width / 2, z: -depth / 2 },
      { x: width / 2, z: depth / 2 - inset }, { x: width / 2 - setback, z: depth / 2 - inset },
      { x: width / 2 - setback, z: depth / 2 }, { x: -width / 2, z: depth / 2 },
    ]
    : [
      { x: -width / 2, z: -depth / 2 }, { x: width / 2, z: -depth / 2 },
      { x: width / 2, z: depth / 2 }, { x: -width / 2, z: depth / 2 },
    ];
  const floors = prominent ? 2 + Math.floor(hash01(seed, 5, 79) * 2) : 1 + Math.floor(hash01(seed, 5, 79) * 2);
  const floorHeight = 2.65 + hash01(seed, 6, 83) * .35;
  const facadeTiles: WorldBuildingGeometry["facadeTiles"] = [];
  let doorPlaced = false;
  for (let edge = 0; edge < footprint.length; edge++) {
    const start = footprint[edge], end = footprint[(edge + 1) % footprint.length];
    const edgeLength = Math.hypot(end.x - start.x, end.z - start.z);
    const tileCount = Math.max(1, Math.round(edgeLength / (1.25 + hash01(seed, edge, 97) * .35)));
    const tileWidth = edgeLength / tileCount;
    for (let floor = 0; floor < floors; floor++) for (let tile = 0; tile < tileCount; tile++) {
      const isFront = edge === 0;
      const centeredDoor = floor === 0 && isFront && tile === Math.floor(tileCount / 2);
      const windowCadence = (tile + edge + floor) % 2 === 0 || tileCount <= 2;
      const kind = centeredDoor ? "door" : windowCadence && tileWidth > .72 ? "window" : "wall";
      if (centeredDoor) doorPlaced = true;
      facadeTiles.push({ edge, floor, offset: (tile + .5) * tileWidth, width: tileWidth, kind });
    }
  }
  if (!doorPlaced && facadeTiles.length) facadeTiles[0].kind = "door";
  return {
    kind: "cga-building",
    footprint,
    floors,
    floorHeight,
    wallThickness: .18,
    roof: prominent ? (hash01(seed, 8, 101) > .45 ? "hip" : "gable") : (hash01(seed, 8, 101) > .2 ? "gable" : "hip"),
    facadeTiles,
    palette: BUILDING_PALETTES[material],
  };
}

interface ColonizationNode {
  position: Vec3;
  parent: number;
}

const canopyPoint = (style: WorldBiomeSpec["treeStyle"], seed: number, index: number, height: number): Vec3 => {
  // A low-discrepancy spherical distribution avoids obvious radial rings while
  // remaining deterministic across chunks and machines.
  const u = hash01(seed, index, 131), v = hash01(seed, index, 149), radialJitter = .72 + hash01(seed, index, 163) * .28;
  const azimuth = Math.PI * 2 * ((index * .61803398875 + u * .17) % 1);
  const vertical = v * 2 - 1;
  const belt = Math.sqrt(Math.max(0, 1 - vertical * vertical));
  const broad = style === "cypress" ? .62 * WORLD_VISUAL_CONFIG.forest.cypressCrownScale : style === "pine" ? 1.16 : 1.58;
  const verticalRadius = style === "cypress" ? 2.65 : style === "pine" ? 2.2 : 1.65;
  const cone = style === "pine" ? clamp(1.2 - (vertical * .5 + .5) * .7, .34, 1.2) : 1;
  return {
    x: Math.cos(azimuth) * belt * broad * cone * radialJitter,
    y: height * .58 + vertical * verticalRadius * radialJitter,
    z: Math.sin(azimuth) * belt * broad * cone * radialJitter,
  };
};

/** Space-colonization tree growth using attraction, kill, and influence radii. */
export function generateSpaceColonizedTree(seed: number, style: WorldBiomeSpec["treeStyle"], scale = 1): WorldTreeGeometry {
  const resolvedStyle = style === "none" ? "dead" : style;
  const height = (resolvedStyle === "cypress" ? 7 : resolvedStyle === "pine" ? 6.5 : resolvedStyle === "dead" ? 5.4 : 5.8) * scale;
  const attractionCount = resolvedStyle === "dead" ? 34 : resolvedStyle === "broadleaf" ? 148 : 124;
  let attractionPoints = Array.from({ length: attractionCount }, (_, index) => canopyPoint(resolvedStyle, seed, index, height));
  const nodes: ColonizationNode[] = [{ position: { x: 0, y: 0, z: 0 }, parent: -1 }];
  const stepLength = .32 * scale, influenceRadius = 2.2 * scale, killDistance = .38 * scale;

  // Grow a trunk until it enters the canopy's influence volume.
  while (nodes[nodes.length - 1].position.y < height * .48) {
    const previous = nodes.length - 1;
    const sway = (hash01(seed, previous, 211) - .5) * .028;
    nodes.push({ position: { x: nodes[previous].position.x + sway, y: nodes[previous].position.y + stepLength, z: nodes[previous].position.z - sway * .6 }, parent: previous });
  }

  for (let iteration = 0; iteration < 72 && attractionPoints.length; iteration++) {
    const influences = new Map<number, Vec3[]>(), survivors: Vec3[] = [];
    for (const point of attractionPoints) {
      let nearest = -1, nearestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < nodes.length; index++) {
        const candidateDistance = distance(point, nodes[index].position);
        if (candidateDistance < nearestDistance) { nearest = index; nearestDistance = candidateDistance; }
      }
      if (nearestDistance <= killDistance) continue;
      survivors.push(point);
      if (nearestDistance <= influenceRadius) influences.set(nearest, [...(influences.get(nearest) ?? []), point]);
    }
    attractionPoints = survivors;
    if (!influences.size) break;
    const additions: ColonizationNode[] = [];
    for (const [parent, points] of [...influences.entries()].sort((left, right) => left[0] - right[0])) {
      const origin = nodes[parent].position;
      let direction = { x: 0, y: .12, z: 0 };
      for (const point of points) {
        const toward = normalize({ x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z });
        direction = { x: direction.x + toward.x, y: direction.y + toward.y, z: direction.z + toward.z };
      }
      direction = normalize(direction);
      const position = { x: origin.x + direction.x * stepLength, y: origin.y + direction.y * stepLength, z: origin.z + direction.z * stepLength };
      if (!nodes.some((node) => distance(node.position, position) < stepLength * .55) && !additions.some((node) => distance(node.position, position) < stepLength * .55)) additions.push({ position, parent });
    }
    nodes.push(...additions);
    if (!additions.length) break;
  }

  const childCounts = new Array(nodes.length).fill(1);
  for (let index = nodes.length - 1; index > 0; index--) childCounts[nodes[index].parent] += childCounts[index];
  const branches = nodes.slice(1).map((node, branchIndex) => {
    const nodeIndex = branchIndex + 1, parent = nodes[node.parent];
    const startRadius = clamp(.018 + Math.pow(childCounts[node.parent], .46) * .018, .025, .27 * scale);
    const endRadius = clamp(.012 + Math.pow(childCounts[nodeIndex], .44) * .014, .012, startRadius * .82);
    return { parent: node.parent, start: parent.position, end: node.position, startRadius, endRadius };
  });
  const hasChild = new Set(nodes.slice(1).map((node) => node.parent));
  const terminals = nodes.map((node, index) => ({ node, index })).filter(({ node, index }) => index > 0 && !hasChild.has(index) && node.position.y > height * .42);
  const crownNodes = nodes.map((node, index) => ({ node, index })).filter(({ node, index }) => index > 0 && node.position.y > height * .57 && (index % 7 === 0 || !hasChild.has(index)));
  const leafClusters = resolvedStyle === "dead" ? [] : [...terminals, ...crownNodes]
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.index === entry.index) === index)
    .filter((_, index, entries) => index % Math.max(1, Math.floor(entries.length / 42)) === 0)
    .slice(0, 52)
    .map(({ node }, index) => ({
      position: node.position,
      radius: resolvedStyle === "cypress" ? { x: .96 * scale, y: 1.28 * scale, z: .96 * scale } : resolvedStyle === "pine" ? { x: .96 * scale, y: .54 * scale, z: .96 * scale } : { x: 1.18 * scale, y: .82 * scale, z: 1.08 * scale },
      phase: hash01(seed, index, 251),
    }));
  return {
    kind: "space-colonized-tree",
    style: resolvedStyle,
    branches,
    leafClusters,
    barkColor: resolvedStyle === "dead" ? "#4b4035" : "#493623",
    leafColors: resolvedStyle === "pine" || resolvedStyle === "cypress" ? ["#245b32", "#438547"] : ["#2d653d", "#559653"],
  };
}
