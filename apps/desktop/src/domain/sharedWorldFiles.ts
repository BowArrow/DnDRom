import type {Campaign,GameMap} from './types';
/** Portable campaigns own plans and edits; disposable terrain and scatter
 * arrays can be rebuilt locally instead of multiplying the save-file size. */
export function compactSharedMap(map:GameMap):GameMap{
 if(!map.world?.sharedWorld)return map;
 const entities=map.entities.filter(e=>e.worldGeometry?.kind!=='terrain'&&e.worldGeometry?.kind!=='water'&&e.worldGeometry?.kind!=='ground-cover'&&!e.tags?.includes('world:vegetation')&&!e.tags?.includes('ecology:understory'));
 return {...map,entities,sharedCacheOmitted:true};
}
export function compactSharedCampaign(campaign:Campaign):Campaign{return {...campaign,map:compactSharedMap(campaign.map),scenes:campaign.scenes?.map(scene=>({...scene,map:compactSharedMap(scene.map)}))};}
export function restoreSharedMapDetails(saved:GameMap,generated:GameMap):GameMap{
 const ids=new Set(generated.entities.map(e=>e.id)),removed=new Set(generated.world?.sharedWorld?.removedEntityIds??[]);
 return {...generated,id:saved.id,name:saved.name,lighting:saved.lighting,weather:saved.weather,pointsOfInterest:saved.pointsOfInterest,scenery:saved.scenery,sharedCacheOmitted:undefined,entities:[...generated.entities,...saved.entities.filter(e=>!ids.has(e.id)&&!removed.has(e.id)&&!e.tags?.includes('world:building'))]};
}
