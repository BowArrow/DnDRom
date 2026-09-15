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
export function generateCgaBuilding(seed: number, prominent = false, material: "timber" | "stone" = "timber", ruin = 0): WorldBuildingGeometry {
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
      const decay = hash01(seed, edge * 137 + tile, 311);
      const integrity = ruin > 0 ? clamp((1 - ruin) * 1.6 + decay * .9 - floor * .65, 0, 1) : 1;
      facadeTiles.push({ edge, floor, offset: (tile + .5) * tileWidth, width: tileWidth, kind, ...(ruin > 0 ? { integrity: centeredDoor ? 0 : integrity } : {}) });
    }
  }
  if (!doorPlaced && facadeTiles.length) facadeTiles[0].kind = "door";
  return {
    kind: "cga-building",
    footprint,
    floors,
    floorHeight,
    wallThickness: .18,
    roof: ruin > .25 ? "ruined" : prominent ? (hash01(seed, 8, 101) > .45 ? "hip" : "gable") : (hash01(seed, 8, 101) > .2 ? "gable" : "hip"),
    ...(ruin > 0 ? { ruinSeed: seed } : {}),
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
  const broad = height * (style === "cypress" ? .14 * WORLD_VISUAL_CONFIG.forest.cypressCrownScale : style === "pine" ? .23 : .36) * (.85 + hash01(seed, 0, 929) * .3);
  const verticalRadius = height * (style === "cypress" ? .38 : style === "pine" ? .36 : .29);
  const cone = style === "pine" ? clamp(1.2 - (vertical * .5 + .5) * .7, .34, 1.2) : 1;
  return {
    x: Math.cos(azimuth) * belt * broad * cone * radialJitter,
    y: height * .7 + vertical * verticalRadius * radialJitter,
    z: Math.sin(azimuth) * belt * broad * cone * radialJitter,
  };
};

/** Space-colonization tree growth using attraction, kill, and influence radii. */
export function generateSpaceColonizedTree(seed: number, style: WorldBiomeSpec["treeStyle"], scale = 1): WorldTreeGeometry {
  const resolvedStyle = style === "none" ? "dead" : style;
  const height = (resolvedStyle === "cypress" ? 9 : resolvedStyle === "pine" ? 10 : resolvedStyle === "dead" ? 6.5 : 8) * scale * (.82 + hash01(seed, 0, 919) * .36);
  const conifer = resolvedStyle === "pine" || resolvedStyle === "cypress";
  const attractionCount = resolvedStyle === "dead" ? 34 : resolvedStyle === "broadleaf" ? 148 : 124;
  let attractionPoints = Array.from({ length: attractionCount }, (_, index) => canopyPoint(resolvedStyle, seed, index, height));
  const nodes: ColonizationNode[] = [{ position: { x: 0, y: 0, z: 0 }, parent: -1 }];
  const stepLength = .32 * scale, influenceRadius = 2.2 * scale, killDistance = .38 * scale;

  // Grow a trunk until it enters the canopy's influence volume.
  while (nodes[nodes.length - 1].position.y < height * (conifer ? 1 : .36)) {
    const previous = nodes.length - 1;
    const sway = (hash01(seed, previous, 211) - .5) * .028;
    nodes.push({ position: { x: nodes[previous].position.x + sway, y: nodes[previous].position.y + stepLength, z: nodes[previous].position.z - sway * .6 }, parent: previous });
  }

  if (conifer) {
    // Excurrent architecture: a persistent leader, lateral whorls and secondary
    // branchlets. Broadleaf attraction envelopes cannot produce this topology.
    const trunkCount = nodes.length;
    for (let level = 4; level < trunkCount - 2; level += 3) {
      const origin = nodes[level].position, fraction = origin.y / height;
      const spread = height * (resolvedStyle === "cypress" ? .13 : .28) * (1 - fraction) ** .8;
      const count = 4 + Math.floor(hash01(seed, level, 1013) * 3);
      for (let limb = 0; limb < count; limb++) {
        const azimuth = limb / count * Math.PI * 2 + level * 2.39996 + hash01(seed, level * 7 + limb, 1021) * .5;
        const reach = spread * (.75 + hash01(seed, level * 7 + limb, 1031) * .4);
        let parent = level;
        const steps = Math.max(3, Math.ceil(reach / stepLength));
        for (let step = 1; step <= steps; step++) {
          const t = step / steps;
          const position = { x: origin.x + Math.cos(azimuth) * reach * t, y: origin.y + reach * (-.18 * t + .38 * t ** 3), z: origin.z + Math.sin(azimuth) * reach * t };
          nodes.push({ position, parent }); parent = nodes.length - 1;
          if (step > 1 && step % 2 === 0) for (const sign of [-1, 1]) {
            const lateral = azimuth + sign * .72, twigLength = reach * .32 * (1 - t * .6);
            nodes.push({ parent, position: { x: position.x + Math.cos(lateral) * twigLength, y: position.y + twigLength * .18, z: position.z + Math.sin(lateral) * twigLength } });
          }
        }
      }
    }
  }
  for (let iteration = 0; !conifer && iteration < 90 && attractionPoints.length; iteration++) {
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

  // A node owns one radius. Adjacent trunk segments must meet at that radius,
  // rather than independently shrinking and restarting as stacked cones.
  // Supported twig length approximates sapwood area (a pipe-model heuristic).
  const support = new Array<number>(nodes.length).fill(.08 * scale);
  const mainChild = new Array<number>(nodes.length).fill(-1);
  for (let index = nodes.length - 1; index > 0; index--) {
    const parent = nodes[index].parent;
    support[parent] += support[index] + distance(nodes[parent].position, nodes[index].position);
    if (mainChild[parent] < 0 || support[index] > support[mainChild[parent]]) mainChild[parent] = index;
  }
  const basalRadius = height * (.034 + hash01(seed, 0, 947) * .009);
  const radii = nodes.map((node, index) => {
    const pipe = Math.sqrt(support[index] / support[0]);
    const flare = 1 + .55 * Math.exp(-node.position.y / (.28 * scale));
    return Math.max(.008 * scale, basalRadius * pipe) * flare;
  });
  const branches = nodes.slice(1).map((node, branchIndex) => {
    const nodeIndex = branchIndex + 1, parent = nodes[node.parent];
    const endRadius = radii[nodeIndex];
    // A lateral starts inside its supporting limb; it does not inherit the
    // full trunk diameter. The dominant continuation shares the exact ring.
    const startRadius = mainChild[node.parent] === nodeIndex ? radii[node.parent]
      : Math.min(radii[node.parent], endRadius * 1.12);
    return { parent: node.parent, start: parent.position, end: node.position, startRadius, endRadius };
  });
  const hasChild = new Set(nodes.slice(1).map((node) => node.parent));
  const terminals = nodes.map((node, index) => ({ node, index })).filter(({ node, index }) => index > 0 && !hasChild.has(index) && node.position.y > height * (conifer ? .12 : .42));
  const crownNodes = nodes.map((node, index) => ({ node, index })).filter(({ node, index }) => index > 0 && node.position.y > height * .57 && (index % 7 === 0 || !hasChild.has(index)));
  const leafClusters = resolvedStyle === "dead" ? [] : [...terminals, ...crownNodes]
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.index === entry.index) === index)
    .filter((_, index, entries) => index % Math.max(1, Math.ceil(entries.length / (conifer ? 100 : 60))) === 0)
    .map(({ node }, index) => ({
      position: node.position,
      radius: resolvedStyle === "cypress" ? { x: .48 * scale, y: .7 * scale, z: .48 * scale } : resolvedStyle === "pine" ? { x: .65 * scale, y: .26 * scale, z: .65 * scale } : { x: 1.02 * scale, y: .68 * scale, z: .96 * scale },
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
