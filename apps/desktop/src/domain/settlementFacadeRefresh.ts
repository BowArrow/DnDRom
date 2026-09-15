import type {GameMap} from './types';
import {expandSceneRecipe} from './sceneGrammar';
import {dressSettlementSurfaces,settlementSurface} from './settlementSurfaces';
/** Upgrade disposable facade meshes from accepted recipes, preserving layout,
 * materials, transforms and every explicit authored override. */
export function refreshSettlementFacades(map:GameMap):GameMap {
  const m=map.world?.sharedWorld;if(!m)return map;
  const protectedIds=new Set([...(m.authoredEntities??[]).map(e=>e.id),...(m.removedEntityIds??[])]);
  const recipes=new Map(m.locations.flatMap(l=>[...l.settlement.buildings,...(l.settlement.structures??[])].filter(b=>b.recipe.some(p=>p.shape==='house')).map(b=>[b.id,{recipe:b.recipe,locationId:l.id}] as const)));
  let changed=false;
  const entities=map.entities.map(e=>{const entry=recipes.get(e.id);if(!entry||protectedIds.has(e.id)||e.worldGeometry?.kind!=='assembly'||e.worldGeometry.recipeId.endsWith('/surfaces-036'))return e;
    changed=true;return {...e,worldGeometry:{kind:'assembly' as const,recipeId:e.id+'/surfaces-036',parts:dressSettlementSurfaces(expandSceneRecipe(entry.recipe),settlementSurface(m,entry.locationId,e.id))}};
  });
  return changed?{...map,entities}:map;
}
