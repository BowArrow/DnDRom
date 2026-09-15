import type { WorldBiomeSpec, WorldBlueprintV1 } from "./types";

export interface BiomeRegion { id: string; biome: WorldBiomeSpec; x: number; z: number; radius: number; elevation: number }
export interface JourneySite { locationId: string; name: string; kind: string; x: number; z: number; biome: WorldBiomeSpec["id"]; description: string }
export interface WorldJourney {
  worldId: string; level: "travel" | "settlement"; sites: JourneySite[]; biomes: BiomeRegion[];
  origin: { x: number; z: number }; metersPerUnit: number;
  activeBuildingId?: string;
  interiors?: Array<{ entityId: string; name: string; entrance: { x: number; y: number; z: number }; pointOfInterestIds: string[] }>;
}

export function biomeWeights(regions: BiomeRegion[], x: number, z: number): Array<{ region: BiomeRegion; weight: number }> {
  const ranked = regions.map(region => ({ region, weight: 1 / Math.max(1, Math.hypot(x - region.x, z - region.z) / Math.max(1, region.radius)) ** 6 }));
  const total = ranked.reduce((sum, item) => sum + item.weight, 0);
  return ranked.map(item => ({ ...item, weight: item.weight / Math.max(.0001, total) }));
}
export function biomeAt(blueprint: WorldBlueprintV1, x: number, z: number): WorldBiomeSpec {
  const weights = biomeWeights(blueprint.biomeRegions ?? [], x, z);
  return weights.sort((a, b) => b.weight - a.weight)[0]?.region.biome ?? blueprint.biome;
}
export function regionalElevation(regions: BiomeRegion[], x: number, z: number): number {
  return biomeWeights(regions, x, z).reduce((sum, item) => sum + item.weight * item.region.elevation, 0);
}
