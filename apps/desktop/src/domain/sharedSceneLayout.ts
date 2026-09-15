import type {GameMap} from './types';
import type {WorldManifest} from './sharedWorld';

/** A revision number alone cannot certify disposable scene geometry. Older
 * releases sometimes attached a newer manifest to an older building grid. */
export function sharedSceneMatchesLayout(map:GameMap,manifest:WorldManifest):boolean {
 const site=map.world?.site;if(!site||map.world?.sharedWorld?.id!==manifest.id)return false;
 if(map.world.environment?.stratum==='underground')return true;
 const protectedIds=new Set([...(manifest.authoredEntities??[]).map(e=>e.id),...(manifest.removedEntityIds??[])]);
 const expected=new Map(manifest.locations.flatMap(l=>[...l.settlement.buildings,...(l.settlement.structures??[])])
  .filter(b=>b.position.x-site.x>=-map.width/2&&b.position.x-site.x<map.width/2&&b.position.z-site.z>=-map.depth/2&&b.position.z-site.z<map.depth/2&&!protectedIds.has(b.id)).map(b=>[b.id,b]));
 const actual=new Map(map.entities.filter(e=>!protectedIds.has(e.id)&&(expected.has(e.id)||e.tags?.includes('world:building'))).map(e=>[e.id,e]));
 if(actual.size!==expected.size)return false;
 for(const [id,b] of expected){const e=actual.get(id);if(!e||Math.abs(e.position.x-(b.position.x-site.x))>.01||Math.abs(e.position.z-(b.position.z-site.z))>.01||Math.abs(e.position.y-(b.position.y-site.datum))>.01||Math.abs(Math.sin((e.rotation.y-b.yaw)*Math.PI/360))>1e-5)return false;}
 return true;
}
