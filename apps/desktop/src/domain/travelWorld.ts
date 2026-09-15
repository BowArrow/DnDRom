import { buildingAccess } from "./buildingAccess";
import { createFallbackWorldBlueprints } from "./worldForge";
import { sampleTerrainHeight } from "./worldProcedural";
import type { GameMap, MapEntity, WorldPlan, WorldLocation, CampaignPlan, WorldBiomeSpec } from "./types";
import type { JourneySite, WorldJourney } from "./worldGeography";
import type { ScenePart } from "./sceneGrammar";
import { mapPlacementSurface, placeOnDryGround, footprintSamples } from "./worldPlacement";

export const worldSeed = (text: string) => [...text].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261) >>> 1;
export function worldSites(world: WorldPlan): JourneySite[] {
  return world.locations.slice(0, 24).map(location => ({ locationId: location.id, name: location.name, kind: location.kind, description: location.description, biome: ["forest", "plains", "mountains", "coast", "swamp"].includes(location.biome) ? location.biome as WorldBiomeSpec["id"] : "plains", x: Math.max(-108, Math.min(108, location.position.x * 256 / Math.max(1, world.widthMiles))), z: Math.max(-108, Math.min(108, location.position.z * 256 / Math.max(1, world.depthMiles))) }));
}
export function travelBlueprint(world: WorldPlan) {
  const [blueprint] = createFallbackWorldBlueprints({ description: world.summary, kind: "exterior", size: "large", biome: "plains", gridShape: "square", seed: worldSeed(world.seed), background: "none" });
  blueprint.id = `travel-${world.id}`; blueprint.name = `${world.name} · Travel`; blueprint.terrain.relief = 8;
  const sites = worldSites(world);
  blueprint.biomeRegions = sites.map(site => {
    const [local] = createFallbackWorldBlueprints({ description: site.description, kind: "exterior", size: "small", biome: site.biome, gridShape: "square", seed: blueprint.seed, background: "none" });
    return { id: site.locationId, x: site.x, z: site.z, radius: 35, biome: { ...local.biome, vegetationDensity: local.biome.vegetationDensity }, elevation: site.biome === "mountains" ? 25 : site.biome === "coast" ? -3 : 0 };
  });
  blueprint.zones = sites.map(site => ({ id: site.locationId, name: site.name, purpose: "landmark" as const, center: { x: site.x, y: 0, z: site.z }, radius: 7, requiredConnections: world.roads.filter(road => road.fromLocationId === site.locationId || road.toLocationId === site.locationId).map(road => road.fromLocationId === site.locationId ? road.toLocationId : road.fromLocationId).filter(id => sites.some(site => site.locationId === id)).slice(0, 12) }));
  if (blueprint.zones.length < 2) blueprint.zones.push({ id: "travel-entry", name: "Road into the region", purpose: "entry", center: { x: -100, y: 0, z: -100 }, radius: 5, requiredConnections: blueprint.zones.map(zone => zone.id) });
  blueprint.assetRequests = [];
  blueprint.zones[0].purpose = "entry";
  blueprint.zones[blueprint.zones.length - 1].purpose = "exit";
  return blueprint;
}
export function mapHeight(map: GameMap, x: number, z: number): number {
  const terrain = map.entities.find(entity => entity.worldGeometry?.kind === "terrain" && x >= entity.worldGeometry.originX && x <= entity.worldGeometry.originX + entity.worldGeometry.size && z >= entity.worldGeometry.originZ && z <= entity.worldGeometry.originZ + entity.worldGeometry.size)?.worldGeometry;
  return terrain?.kind === "terrain" ? sampleTerrainHeight(terrain, x, z) : 0;
}
const part = (shape: ScenePart["shape"], x: number, y: number, z: number, width: number, height: number, depth: number, material: ScenePart["material"], color: string): ScenePart => ({ shape, position: { x, y, z }, size: { x: width, y: height, z: depth }, rotation: { x: 0, y: 0, z: 0 }, material, color });
export function finalizeTravelMap(map: GameMap, world: WorldPlan): GameMap {
  const sites = worldSites(world), blueprint = travelBlueprint(world);
  const surface=mapPlacementSurface(map),occupied:MapEntity[]=[];
  // Settlements are compact silhouettes at travel scale, with a stable link to
  // the detailed location. Each cluster is one merged procedural assembly.
  const entities = map.entities.filter(entity => !entity.tags?.includes("world:landmark") && !entity.tags?.includes("world:placeholder") && !(entity.tags?.includes("world:vegetation") && !((entity.worldGeometry?.kind === "space-colonized-tree") && entity.worldGeometry.instances) && sites.some(site => Math.hypot(entity.position.x - site.x, entity.position.z - site.z) < 9)));
  for (const entity of entities) if (entity.worldGeometry?.kind === "space-colonized-tree" && entity.worldGeometry.instances) entity.worldGeometry = { ...entity.worldGeometry, instances: entity.worldGeometry.instances.filter(p => !sites.some(site => Math.hypot(p.x - site.x, p.z - site.z) < 9)) };
  for (const site of sites) {
    const parts: ScenePart[] = [];
    const count = site.kind === "capital" || site.kind === "city" ? 28 : site.kind === "town" ? 18 : site.kind === "village" ? 10 : 4;
    for (let i = 0; i < count; i++) {
      const angle = i * 2.399963, radius = Math.sqrt(i) * 1.3, x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      const height = .8 + (i % 4) * .23;
      const house:MapEntity={id:`${site.locationId}-${i}`,assetId:"house-small",name:site.name,position:{x:site.x+x,y:0,z:site.z+z},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},worldGeometry:{kind:"assembly",recipeId:"travel-house",parts:[part("box",0,height/2,0,1.3,height,1.6,"masonry","#ada086"),part("roof",0,height+.35,0,1.55,.7,1.9,"roof","#6f5044")]}};
      if(!placeOnDryGround(house,surface,occupied,24))continue;
      occupied.push(house);
      if(house.worldGeometry?.kind==="assembly")for(const p of house.worldGeometry.parts)parts.push({...p,position:{x:p.position.x+house.position.x-site.x,y:p.position.y+house.position.y-mapHeight(map,site.x,site.z),z:p.position.z+house.position.z-site.z}});
    }
    // The travel cluster follows individual dry parcels and their terrain
    // heights; a single centre height used to float entire towns over rivers.
    const chunk = map.world?.chunks.find(chunk => site.x >= chunk.bounds.min.x && site.x < chunk.bounds.max.x && site.z >= chunk.bounds.min.z && site.z < chunk.bounds.max.z);
    entities.push({ id: `site-${site.locationId}`, assetId: "wall-stone", name: site.name, position: { x: site.x, y: mapHeight(map, site.x, site.z), z: site.z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, chunkId: chunk?.id, tags: ["world:travel-site", `location:${site.locationId}`], notes: site.description, worldGeometry: { kind: "assembly", recipeId: `site-${site.locationId}`, parts } });
  }
  const clearings=new Set(occupied.flatMap(e=>footprintSamples(e,1,1.5)).map(p=>`${Math.floor(p.x/2)}:${Math.floor(p.z/2)}`));
  const inClearing=(x:number,z:number)=>{
    const cx=Math.floor(x/2),cz=Math.floor(z/2);
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)if(clearings.has(`${cx+dx}:${cz+dz}`))return true;
    return false;
  };
  for(const e of entities){
    const g=e.worldGeometry;
    if(g?.kind==="ground-cover" || (g?.kind==="space-colonized-tree"&&g.instances))e.worldGeometry={...g,instances:g.instances!.filter(p=>!inClearing(p.x,p.z))};
  }
  const journey: WorldJourney = { worldId: world.id, level: "travel", sites, biomes: blueprint.biomeRegions ?? [], origin: { x: 0, z: 0 }, metersPerUnit: world.widthMiles * 1609.344 / 256 };
  return { ...map, id: `travel-${world.id}`, journey, entities, pointsOfInterest: sites.map(site => ({ id: site.locationId, name: site.name, kind: "settlement", description: site.description, position: { x: site.x, y: mapHeight(map, site.x, site.z), z: site.z }, storyBeatIds: world.locations.find(location => location.id === site.locationId)?.storyBeatIds ?? [], discovered: true, tags: ["travel-destination"] })), world: map.world ? { ...map.world, chunks: map.world.chunks.map(chunk => ({ ...chunk, entityIds: entities.filter(entity => entity.chunkId === chunk.id).map(entity => entity.id) })) } : undefined };
}
export function settlementBlueprint(location: WorldLocation, plan?: CampaignPlan) {
  const beats = plan?.beats.filter(beat => beat.locationId === location.id) ?? [];
  const [blueprint] = createFallbackWorldBlueprints({ description: `${location.name}. ${location.description}. ${beats.map(beat => `${beat.encounterType}: ${beat.summary}`).join(". ")}`.slice(0, 2000), kind: location.kind === "dungeon" ? "dungeon" : "settlement", size: "medium", gridShape: "square", seed: worldSeed(location.mapSeed), background: "none" });
  blueprint.name = location.name; blueprint.architecture = { ...blueprint.architecture!, density: .95 };
  return blueprint;
}
export function finalizeSettlementMap(map: GameMap, location: WorldLocation, world: WorldPlan, plan?: CampaignPlan): GameMap {
  const sites = worldSites(world), site = sites.find(site => site.locationId === location.id)!;
  const buildings = map.entities.filter(entity => buildingAccess(entity));
  const points = location.pointOfInterests.map((point, index) => {
    const building = buildings[index % Math.max(1, buildings.length)];
    return { ...point, position: building ? buildingAccess(building)!.anchor : point.position, tags: [...point.tags, ...(building ? [`building:${building.id}`] : [])] };
  });
  const beats = plan?.beats.filter(beat => beat.locationId === location.id) ?? [];
  for (const beat of beats) if (!points.some(point => point.storyBeatIds.includes(beat.id))) points.push({ id: `beat-${beat.id}`, name: beat.title, kind: "story", description: beat.summary, position: buildings[0] ? buildingAccess(buildings[0])!.anchor : { x: 0, y: 0, z: 0 }, storyBeatIds: [beat.id], discovered: beat.status !== "locked", tags: [beat.encounterType, ...(buildings[0] ? [`building:${buildings[0].id}`] : [])] });
  const markers: MapEntity[] = points.filter(point => point.storyBeatIds.length > 0).map((point, index) => ({
    id: "story-" + point.id, assetId: point.tags.includes("mystery") ? "chest" : "token-hero", name: point.name,
    position: { ...point.position }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: .8, y: .8, z: .8 },
    hidden: !point.discovered, notes: point.description, tags: ["story:interaction", "poi:" + point.id, ...point.tags],
  }));
  return { ...map, entities: [...map.entities, ...markers], locationId: location.id, pointsOfInterest: points, journey: { worldId: world.id, level: "settlement", sites, biomes: travelBlueprint(world).biomeRegions ?? [], origin: { x: site?.x ?? 0, z: site?.z ?? 0 }, metersPerUnit: 1, interiors: buildings.map(entity => ({ entityId: entity.id, name: entity.name, entrance: buildingAccess(entity)!.entrance, pointOfInterestIds: points.filter(point => point.tags.includes(`building:${entity.id}`)).map(point => point.id) })) } };
}
