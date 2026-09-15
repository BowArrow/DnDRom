import {tileKey,tileSize,tileChildren,type AtlasTile} from '../domain/worldAtlas';
/** Exact distance to the nearest uncovered quadtree rectangle, from the fixed
 * scene origin. During reveal only the selected detail is complete: a coarse
 * placeholder must not uncover vegetation/buildings still being imported. */
export function readyRevealRadius(roots:AtlasTile[],desired:Set<string>,ready:Set<string>,width:number,depth:number):number{
 const missing=(t:AtlasTile):number=>{const s=tileSize(t),x=t.x*s,z=t.z*s;if(x>=-width/2&&x+s<=width/2&&z>=-depth/2&&z+s<=depth/2||ready.has(tileKey(t)))return Infinity;
 if(t.level>0&&!desired.has(tileKey(t)))return Math.min(...tileChildren(t).map(missing));return Math.hypot(Math.max(x,0,-x-s),Math.max(z,0,-z-s));};
 const minX=Math.min(...roots.map(t=>t.x*tileSize(t))),maxX=Math.max(...roots.map(t=>(t.x+1)*tileSize(t))),minZ=Math.min(...roots.map(t=>t.z*tileSize(t))),maxZ=Math.max(...roots.map(t=>(t.z+1)*tileSize(t)));
 return Math.max(0,Math.min(-minX,maxX,-minZ,maxZ,...roots.map(missing))-48);
}

/** Native ready IDs are acknowledged only after every mesh/instance is built. */
export function revealCoverageComplete(desired:Set<string>,ready:Set<string>):boolean {
 return desired.size>0&&[...desired].every(id=>ready.has(id));
}

/** Loading mist covers nearby visible scenery, not an entire 160 km atlas.
 * A covering parent is sufficient; its later refinements do not restart reveal.
 * The test is fixed to the scene origin so orbiting cannot move the finish line.
 */
export function revealVisibleCoverageComplete(roots:AtlasTile[],desired:Set<string>,visible:Set<string>,width:number,depth:number,radius:number):boolean {
 const covered=(t:AtlasTile):boolean=>{
  const s=tileSize(t),x=t.x*s,z=t.z*s;
  if(Math.hypot(Math.max(x,0,-x-s),Math.max(z,0,-z-s))>=radius)return true;
  if(x>=-width/2&&x+s<=width/2&&z>=-depth/2&&z+s<=depth/2||visible.has(tileKey(t)))return true;
  return t.level>0&&!desired.has(tileKey(t))&&tileChildren(t).every(covered);
 };
 return roots.length>0&&roots.every(covered);
}
