import {refreshSettlementFacades} from './settlementFacadeRefresh';
import {sharedSceneMatchesLayout} from './sharedSceneLayout';
import type {Campaign,GameMap,MapEntity} from './types';
/** Keep user-authored transforms/materials in world space, outside disposable
 * scene geometry. The scene's original snapshot remains available as well. */
export function recordSharedEntityEdit(campaign:Campaign,id:string,updated?:MapEntity):Campaign{
  const m=campaign.world?.manifest,site=campaign.map.world?.site;if(!m||!site||campaign.map.world?.sharedWorld?.id!==m.id)return campaign;
  const source=updated??campaign.map.entities.find(e=>e.id===id);
  const known=m.locations.some(l=>l.settlement.buildings.some(b=>b.id===id))||m.authoredEntities?.some(e=>e.id===id)||source&&source.worldGeometry?.kind!=='terrain'&&source.worldGeometry?.kind!=='water';if(!known)return campaign;
  const manifest={...m,revision:m.revision+1,authoredEntities:(m.authoredEntities??[]).filter(e=>e.id!==id),removedEntityIds:(m.removedEntityIds??[]).filter(e=>e!==id)};
  if(updated){const e=structuredClone(updated);if(campaign.map.world?.environment?.stratum==='underground')e.tags=[...new Set([...(e.tags??[]),`world:underground:${campaign.map.locationId}`])];e.position={x:e.position.x+site.x,y:e.position.y+site.datum,z:e.position.z+site.z};if(e.worldAccess)for(const p of [e.worldAccess.entrance,e.worldAccess.anchor]){p.x+=site.x;p.y+=site.datum;p.z+=site.z;}delete e.chunkId;manifest.authoredEntities.push(e);}else manifest.removedEntityIds.push(id);
  return {...campaign,world:{...campaign.world!,manifest},map:{...campaign.map,world:{...campaign.map.world!,sharedWorld:manifest}}};
}
export function refreshSharedMap(map:GameMap,campaign:Campaign):GameMap{
  const m=campaign.world?.manifest;if(!m||map.world?.sharedWorld?.id!==m.id||!map.world.site)return map;
  // Keep archived layouts as snapshots. Labelling old positions with the new
  // revision lets the location cache select the old grid after a town rebuild.
  if(!sharedSceneMatchesLayout(map,m))return refreshSettlementFacades(map);
  const layer=map.world.environment?.stratum==='underground'?`world:underground:${map.locationId}`:undefined;
  const site=map.world.site,overrides=new Map((m.authoredEntities??[]).filter(e=>layer?e.tags?.includes(layer):!e.tags?.some(t=>t.startsWith('world:underground:'))).map(e=>[e.id,e])),removed=new Set(m.removedEntityIds??[]);
  const entities=map.entities.filter(e=>!removed.has(e.id)&&!overrides.has(e.id));
  for(const source of overrides.values()){const e=structuredClone(source);e.position={x:e.position.x-site.x,y:e.position.y-site.datum,z:e.position.z-site.z};if(Math.abs(e.position.x)>map.width/2||Math.abs(e.position.z)>map.depth/2)continue;if(e.worldAccess)for(const p of [e.worldAccess.entrance,e.worldAccess.anchor]){p.x-=site.x;p.y-=site.datum;p.z-=site.z;}entities.push(e);}
  return refreshSettlementFacades({...map,entities,world:{...map.world,sharedWorld:m,site:{...map.world.site,shared:m.terrain}}});
}

