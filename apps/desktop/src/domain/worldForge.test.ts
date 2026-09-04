import { describe, expect, it } from "vitest";
import { compileWorldBlueprint, createFallbackWorldBlueprints, createSceneTemplate, fractalWorldNoise, worldBlueprintSchema } from "./worldForge";
import { buildAnisotropicRoadNetwork, buildHydrologyField, buildNavigationGrid, buildWorldFieldSet, cornerCutPolyline, createHeightfield, distanceToSegment, fillDepressionsWangLiu, generateBspRooms, noiseWeightedPoissonPoints, poissonPoints, roadSurfaceWeight, roundedTerraceHeight, sampleCatmullRomSpline, sampleTerrainHeight, sampleWorldField, simplexNoise2D, terrainGeometryForChunk, terrainSurfaceWeights, traceDownhillFlow } from "./worldProcedural";
import { generateCgaBuilding, generateSpaceColonizedTree } from "./worldArchitecture";
import { denseGroundCoverPoints } from "./worldScatter";

const request = {
  description: "A misty swamp settlement with raised paths and a ruined bell tower",
  kind: "auto" as const,
  size: "small" as const,
  gridShape: "square" as const,
  seed: 7241,
  background: "splat" as const,
};

describe("AI-directed procedural world compiler", () => {
  it("creates two deterministic, schema-valid concepts", () => {
    const first = createFallbackWorldBlueprints(request);
    const second = createFallbackWorldBlueprints(request);
    expect(second).toEqual(first);
    expect(first[0].id).not.toBe(first[1].id);
    expect(first.map((concept) => worldBlueprintSchema.parse(concept))).toEqual(first);
  });

  it("rejects unrestricted or disconnected blueprint references", () => {
    const [blueprint] = createFallbackWorldBlueprints(request);
    const broken = structuredClone(blueprint);
    broken.zones[0].requiredConnections = ["missing-zone"];
    expect(() => worldBlueprintSchema.parse(broken)).toThrow(/Unknown zone connection/);
  });

  it("compiles the seed into complete 16-meter chunks without mutating the blueprint", () => {
    const [blueprint] = createFallbackWorldBlueprints(request);
    const before = structuredClone(blueprint);
    const compiled = compileWorldBlueprint(blueprint);
    expect(blueprint).toEqual(before);
    expect(compiled.validation.valid).toBe(true);
    expect(compiled.map.world?.chunks).toHaveLength(16);
    expect(compiled.map.entities.every((entity) => entity.chunkId?.startsWith("chunk-"))).toBe(true);
    expect(compiled.map.entities.filter((entity) => entity.tags?.includes("world:terrain")).every((entity) => entity.scale.y === 1)).toBe(true);
    expect(compiled.map.spawnZones?.map((zone) => zone.kind)).toEqual(["party", "enemy", "exit"]);
    expect(compiled.map.entities.filter((entity) => entity.tags?.includes("world:invisible-fill")).length).toBeGreaterThan(0);
    expect(compiled.map.entities.some((entity) => entity.tags?.includes("layout:road-parcel") && entity.tags?.includes("facade:constrained-modules"))).toBe(true);
    const lakeMasks = compiled.map.entities.filter((entity) => entity.worldGeometry?.kind === "water");
    expect(lakeMasks.length).toBeGreaterThan(0);
    expect(lakeMasks.every((entity) => entity.worldGeometry?.kind === "water" && entity.worldGeometry.wetCells.length === 4225 && entity.worldGeometry.depthField?.length === 4225 && entity.worldGeometry.shoreline?.length === 4225 && entity.worldGeometry.flowVectors?.length === 8450)).toBe(true);
    const wetCells = lakeMasks.reduce((sum, entity) => sum + (entity.worldGeometry?.kind === "water" ? entity.worldGeometry.wetCells.filter(Boolean).length : 0), 0);
    expect(wetCells / (16 * 4225)).toBeLessThan(.3);
    for (const water of lakeMasks) {
      if (water.worldGeometry?.kind !== "water") continue;
      const terrainOwner = compiled.map.entities.find((entry) => entry.chunkId === water.chunkId && entry.worldGeometry?.kind === "terrain");
      expect(terrainOwner?.worldGeometry?.kind).toBe("terrain");
      if (terrainOwner?.worldGeometry?.kind !== "terrain") continue;
      const stride = water.worldGeometry.resolution + 1;
      for (let index = 0; index < water.worldGeometry.wetCells.length; index += 19) {
        if (!water.worldGeometry.wetCells[index]) continue;
        const x = water.worldGeometry.originX + (index % stride) * water.worldGeometry.size / water.worldGeometry.resolution;
        const z = water.worldGeometry.originZ + Math.floor(index / stride) * water.worldGeometry.size / water.worldGeometry.resolution;
        expect(sampleTerrainHeight(terrainOwner.worldGeometry, x, z)).toBeLessThan(water.worldGeometry.waterLevel - .04);
      }
    }
    expect(compiled.map.world?.fieldSet).toMatchObject({ authority: "global-region", cellSize: .5 });
    expect(compiled.map.world?.generatorRevision).toBe(8);
    const terrain = compiled.map.entities.filter((entity) => entity.worldGeometry?.kind === "terrain");
    expect(terrain.every((entity) => entity.worldGeometry?.kind === "terrain" && entity.worldGeometry.heightfield?.resolution === 33)).toBe(true);
    const elevation = terrain.flatMap((entity) => entity.worldGeometry?.kind === "terrain" ? entity.worldGeometry.heightfield?.heights ?? [] : []);
    expect(Math.max(...elevation) - Math.min(...elevation)).toBeGreaterThan(.35);
    const roadDecals = compiled.map.entities.filter((entity) => entity.worldGeometry?.kind === "road-ribbon");
    expect(roadDecals.length).toBeGreaterThan(0);
    expect(roadDecals.every((entity) => entity.tags?.includes("render:spline-decal"))).toBe(true);
    expect(roadDecals.some((entity) => entity.worldGeometry?.kind === "road-ribbon" && entity.worldGeometry.paths.some((path) => path.length > 8))).toBe(true);
    expect(terrain.some((entity) => entity.worldGeometry?.kind === "terrain" && entity.worldGeometry.heightfield?.roadWeights?.some((weight) => weight > .5))).toBe(true);
    expect(compiled.map.world?.hydrology?.riverSegments).toBeGreaterThan(0);
    expect(compiled.map.entities.some((entity) => ["bridge-stone", "bridge-wood"].includes(entity.assetId) && entity.tags?.includes("world:road-crossing"))).toBe(true);
    expect(compiled.map.entities.some((entity) => entity.tags?.includes("ecology:understory"))).toBe(true);
    expect(compiled.map.entities.some((entity) => entity.worldGeometry?.kind === "ground-cover" && entity.tags?.includes("render:gpu-instanced"))).toBe(true);
    const grassClusters = compiled.map.entities.reduce((sum, entity) => sum + (entity.worldGeometry?.kind === "ground-cover" ? entity.worldGeometry.instances.length : 0), 0);
    expect(grassClusters).toBeGreaterThan(10_000);
    expect(compiled.map.entities.some((entity) => entity.worldGeometry?.kind === "space-colonized-tree" && entity.worldGeometry.branches.length > 20)).toBe(true);
    expect(compiled.map.entities.some((entity) => entity.worldGeometry?.kind === "cga-building" && entity.worldGeometry.facadeTiles.some((tile) => tile.kind === "door"))).toBe(true);
  }, 15_000);

  it("honors an explicit biome while preserving deterministic procedural authority", () => {
    const [blueprint] = createFallbackWorldBlueprints({ ...request, biome: "snow" });
    expect(blueprint.biome).toMatchObject({ id: "snow", treeStyle: "pine" });
  });

  it("renders flowing river ribbons outside standing-water basins", () => {
    const [blueprint] = createFallbackWorldBlueprints({ ...request, description: "A forest valley crossed by a flowing river", biome: "forest" });
    const compiled = compileWorldBlueprint(blueprint);
    expect(compiled.map.entities.some((entity) => entity.worldGeometry?.kind === "river-ribbon")).toBe(true);
  });

  it("does not mistake sunlit daylight for the desert lighting mood", () => {
    const [blueprint] = createFallbackWorldBlueprints({ ...request, description: "A bright sunlit cypress swamp" });
    expect(blueprint.mood).toBe("natural");
  });

  it("keeps terrain sampling deterministic at shared world coordinates", () => {
    expect(fractalWorldNoise(16, 32, 91)).toBe(fractalWorldNoise(16, 32, 91));
    expect(fractalWorldNoise(16, 32, 91)).not.toBe(fractalWorldNoise(16, 32, 92));
  });

  it("creates seamless heightfield borders and connected navigation from the same authority", () => {
    const [blueprint] = createFallbackWorldBlueprints(request);
    const leftGeometry = terrainGeometryForChunk(blueprint, -32, -32);
    const rightGeometry = terrainGeometryForChunk(blueprint, -16, -32);
    const left = createHeightfield(leftGeometry, 17);
    const right = createHeightfield(rightGeometry, 17);
    const leftEdge = Array.from({ length: 17 }, (_, row) => left.heights[row * 17 + 16]);
    const rightEdge = Array.from({ length: 17 }, (_, row) => right.heights[row * 17]);
    expect(rightEdge).toEqual(leftEdge);
    const navigation = buildNavigationGrid(leftGeometry);
    expect(navigation.walkableCells + navigation.blockedCells).toBe(256);
    expect(navigation.walkableCells).toBeGreaterThan(0);
  });

  it("uses stable boundary-safe Poisson placement and connected BSP interiors", () => {
    const points = poissonPoints(-32, -32, 16, 4, 91, .8);
    expect(poissonPoints(-32, -32, 16, 4, 91, .8)).toEqual(points);
    for (let index = 0; index < points.length; index++) for (let other = index + 1; other < points.length; other++) {
      expect(Math.hypot(points[index].x - points[other].x, points[index].z - points[other].z)).toBeGreaterThanOrEqual(4);
    }
    const rooms = generateBspRooms(48, 48, 17, 10);
    const visited = new Set<string>(), pending = [rooms[0].id];
    while (pending.length) {
      const id = pending.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      pending.push(...(rooms.find((room) => room.id === id)?.connections ?? []));
    }
    expect(visited.size).toBe(rooms.length);
  });

  it("uses noise-weighted variable-radius Poisson ecology without overlaps", () => {
    const density = (x: number, z: number) => .35 + (Math.sin(x * .2) * Math.cos(z * .2) + 1) * .3;
    const points = noiseWeightedPoissonPoints(-16, -16, 32, .8, 2.4, 771, density);
    expect(noiseWeightedPoissonPoints(-16, -16, 32, .8, 2.4, 771, density)).toEqual(points);
    expect(points.length).toBeGreaterThan(20);
    for (let index = 0; index < points.length; index++) for (let other = index + 1; other < points.length; other++) {
      expect(Math.hypot(points[index].x - points[other].x, points[index].z - points[other].z)).toBeGreaterThanOrEqual(.8);
    }
  });

  it("provides deterministic bounded simplex density noise", () => {
    const samples = Array.from({ length: 64 }, (_, index) => simplexNoise2D(index * .17, index * -.11, 771));
    expect(samples.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(new Set(samples.map((value) => value.toFixed(3))).size).toBeGreaterThan(30);
    expect(samples).toEqual(Array.from({ length: 64 }, (_, index) => simplexNoise2D(index * .17, index * -.11, 771)));
  });

  it("passes Catmull-Rom roads through every control point with continuous samples", () => {
    const controls = [{ x: 0, z: 0 }, { x: 4, z: 1 }, { x: 7, z: 6 }, { x: 12, z: 7 }];
    const curve = sampleCatmullRomSpline(controls, 5);
    expect(curve).toHaveLength(16);
    controls.forEach((control, index) => expect(curve[index * 5]).toEqual(control));
    expect(Math.max(...curve.slice(1).map((point, index) => Math.hypot(point.x - curve[index].x, point.z - curve[index].z)))).toBeLessThan(2);
  });

  it("removes right-angle routing corners before spline fitting", () => {
    const controls = cornerCutPolyline([{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 8 }, { x: 16, z: 8 }], 3);
    const curve = sampleCatmullRomSpline(controls, 5);
    const maximumTurn = Math.max(...curve.slice(1, -1).map((point, index) => {
      const previous = curve[index], next = curve[index + 2];
      const incoming = Math.atan2(point.z - previous.z, point.x - previous.x);
      const outgoing = Math.atan2(next.z - point.z, next.x - point.x);
      return Math.abs(Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming)));
    }));
    expect(maximumTurn).toBeLessThan(Math.PI / 4);
  });

  it("builds deterministic dense ground cover without a quadratic neighbor search", () => {
    const first = denseGroundCoverPoints(-8, -8, 16, .46, 91, () => .9);
    const second = denseGroundCoverPoints(-8, -8, 16, .46, 91, () => .9);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(900);
    expect(first.every((point) => point.x >= -8 && point.x < 8 && point.z >= -8 && point.z < 8)).toBe(true);
  });

  it("places one bridge per true water crossing without stacked duplicates", () => {
    const [blueprint] = createFallbackWorldBlueprints(request);
    const { map } = compileWorldBlueprint(blueprint);
    const bridges = map.entities.filter((entity) => entity.tags?.includes("world:bridge"));
    const riverSegments = map.entities.flatMap((entity) => entity.worldGeometry?.kind === "river-ribbon"
      ? entity.worldGeometry.paths.flatMap((path) => path.slice(0, -1).map((point, index) => ({ a: point, b: path[index + 1], width: (point.width + path[index + 1].width) * .5 })))
      : []);
    expect(bridges.length).toBeGreaterThan(0);
    const riverBridges = bridges.filter((bridge) => bridge.tags?.includes("world:river-crossing"));
    expect(riverBridges.every((bridge) => riverSegments.some((river) => distanceToSegment(bridge.position.x, bridge.position.z, river.a.x, river.a.z, river.b.x, river.b.z) <= river.width + 1.5))).toBe(true);
    expect(bridges.every((bridge) => bridge.tags?.includes("world:river-crossing") || bridge.tags?.includes("world:lake-crossing"))).toBe(true);
    for (let index = 0; index < bridges.length; index++) for (let other = index + 1; other < bridges.length; other++) {
      expect(Math.hypot(bridges[index].position.x - bridges[other].position.x, bridges[index].position.z - bridges[other].position.z)).toBeGreaterThanOrEqual(4);
    }
  });

  it("compiles CGA facade modules and organic space-colonized tree graphs deterministically", () => {
    const building = generateCgaBuilding(991, true, "timber");
    expect(generateCgaBuilding(991, true, "timber")).toEqual(building);
    expect(building.footprint.length).toBeGreaterThan(4);
    expect(new Set(building.facadeTiles.map((tile) => tile.floor)).size).toBe(building.floors);
    expect(building.facadeTiles.some((tile) => tile.kind === "door")).toBe(true);
    expect(building.facadeTiles.some((tile) => tile.kind === "window")).toBe(true);
    const tree = generateSpaceColonizedTree(441, "broadleaf");
    expect(generateSpaceColonizedTree(441, "broadleaf")).toEqual(tree);
    expect(tree.branches.length).toBeGreaterThan(30);
    expect(tree.leafClusters.length).toBeGreaterThan(4);
    expect(tree.branches.some((branch) => Math.abs(branch.end.x - branch.start.x) > .03 && Math.abs(branch.end.z - branch.start.z) > .03)).toBe(true);
    expect(tree.branches.every((branch) => branch.endRadius <= branch.startRadius)).toBe(true);
  });

  it("traces water monotonically downhill", () => {
    const [blueprint] = createFallbackWorldBlueprints(request);
    const flow = traceDownhillFlow(terrainGeometryForChunk(blueprint, -32, -32), -24, -24, 32);
    expect(flow.length).toBeGreaterThan(0);
    for (let index = 1; index < flow.length; index++) expect(flow[index].y).toBeLessThanOrEqual(flow[index - 1].y);
  });

  it("fills drainage sinks before carving deterministic accumulated rivers", () => {
    const [blueprint] = createFallbackWorldBlueprints(request);
    const first = buildHydrologyField(blueprint, 3);
    const second = buildHydrologyField(blueprint, 3);
    expect(second).toEqual(first);
    expect(first.maximumAccumulation).toBeGreaterThan(1);
    expect(first.riverSegments.length).toBeGreaterThan(0);
    expect(first.flowDirection.every((next, index) => next < 0 || first.filledHeights[next] <= first.filledHeights[index])).toBe(true);
    expect(first.filledCellCount).toBeGreaterThanOrEqual(0);
    for (let start = 0; start < first.flowDirection.length; start++) {
      let current = start;
      const visited = new Set<number>();
      while (first.flowDirection[current] >= 0) {
        expect(visited.has(current)).toBe(false);
        visited.add(current);
        current = first.flowDirection[current];
        expect(visited.size).toBeLessThan(first.flowDirection.length);
      }
      const x = current % first.resolution, z = Math.floor(current / first.resolution);
      expect(x === 0 || z === 0 || x === first.resolution - 1 || z === first.resolution - 1).toBe(true);
    }
  });

  it("builds one deterministic multi-layer world field with meaningful relief", () => {
    const [blueprint] = createFallbackWorldBlueprints(request);
    const first = buildWorldFieldSet(blueprint, 1);
    const second = buildWorldFieldSet(blueprint, 1);
    expect(second).toEqual(first);
    expect(first.elevation).toHaveLength(65 * 65);
    expect(Math.max(...first.elevation) - Math.min(...first.elevation)).toBeGreaterThan(.35);
    expect(first.slope.some((value) => value > .02)).toBe(true);
    expect(first.moisture.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(sampleWorldField(first, "elevation", 0, 0)).toBeGreaterThanOrEqual(Math.min(...first.elevation));
  });

  it("implements exact Wang-Liu spillway filling without epsilon elevation drift", () => {
    const bowl = [
      5, 5, 5, 5, 5,
      5, 1, 1, 1, 5,
      5, 1, 0, 1, 5,
      5, 1, 1, 1, 5,
      5, 5, 5, 5, 5,
    ];
    const result = fillDepressionsWangLiu(bowl, 5);
    expect(result.filledHeights).toEqual(new Array(25).fill(5));
    expect(result.filledCellCount).toBe(9);
    expect(result.maximumFillDepth).toBe(5);
    expect(result.drainageParent[12]).toBeGreaterThanOrEqual(0);
    expect(result.outletIndices).toHaveLength(16);
  });

  it("creates rounded one-meter terraces and soft road paint shoulders", () => {
    expect(roundedTerraceHeight(2.2)).toBe(2);
    expect(roundedTerraceHeight(2.99)).toBeGreaterThan(2.9);
    const [blueprint] = createFallbackWorldBlueprints(request);
    const geometry = terrainGeometryForChunk(blueprint, -32, -32, [{ ax: -32, az: -24, bx: -16, bz: -24, width: 2, fromZoneId: "a", toZoneId: "b" }]);
    expect(roadSurfaceWeight(geometry, -24, -24)).toBe(1);
    expect(roadSurfaceWeight(geometry, -24, -22.5)).toBeGreaterThan(0);
    expect(roadSurfaceWeight(geometry, -24, -20)).toBe(0);
  });

  it("routes infrastructure as terrain-aware segments and marks river crossings", () => {
    const [blueprint] = createFallbackWorldBlueprints(request);
    const hydrology = buildHydrologyField(blueprint, 3);
    const roads = buildAnisotropicRoadNetwork(blueprint, hydrology.riverSegments, 3);
    expect(roads.length).toBeGreaterThan(blueprint.zones.length - 1);
    expect(roads.every((road) => Number.isFinite(road.ax + road.az + road.bx + road.bz))).toBe(true);
  });

  it("normalizes biome terrain weights without baking props into a terrain tile", () => {
    const [blueprint] = createFallbackWorldBlueprints({ ...request, biome: "snow" });
    const weights = terrainSurfaceWeights(terrainGeometryForChunk(blueprint, -32, -32), -24, -24, .96);
    expect(Object.values(weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
    expect(weights.snow).toBeGreaterThan(0);
  });

  it("repairs a directionally disconnected valid zone graph without mutating the source", () => {
    const [blueprint] = createFallbackWorldBlueprints(request);
    const disconnected = structuredClone(blueprint);
    disconnected.zones.forEach((zone) => { zone.requiredConnections = []; });
    const before = structuredClone(disconnected);
    const compiled = compileWorldBlueprint(disconnected);
    expect(disconnected).toEqual(before);
    expect(compiled.validation.valid).toBe(true);
    expect(compiled.validation.repairPasses).toBe(1);
  });

  it("retains no more than eight recoverable scene revisions", () => {
    const [blueprint] = createFallbackWorldBlueprints(request);
    const { map } = compileWorldBlueprint(blueprint);
    let template = createSceneTemplate(map);
    for (let revision = 0; revision < 12; revision++) template = createSceneTemplate({ ...map, name: `Revision ${revision}` }, undefined, template);
    expect(template.revisions).toHaveLength(8);
    expect(template.map.name).toBe("Revision 11");
  });
});
