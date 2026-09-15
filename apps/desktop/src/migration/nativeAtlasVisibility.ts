import {tileChildren,tileKey,type AtlasTile} from "../domain/worldAtlas";

/** Index resident subtrees, so coarsening can retain finer coverage without
 * expanding an empty distant tile into millions of level-zero cells. */
export function visibleAtlasTiles(roots:AtlasTile[],desired:Set<string>,ready:Set<string>,local:(tile:AtlasTile)=>boolean):string[] {
  const ancestors=new Set<string>();
  for(const id of ready){
    let [level,x,z]=id.split("/").map(Number);
    if(!Number.isInteger(level)||level<0||level>10||!Number.isInteger(x)||!Number.isInteger(z))continue;
    while(level<10){level++;x=Math.floor(x/2);z=Math.floor(z/2);ancestors.add(`${level}/${x}/${z}`);}
  }
  const memo=new Map<string,boolean>();
  const covered=(tile:AtlasTile):boolean=>{
    const id=tileKey(tile),cached=memo.get(id);if(cached!==undefined)return cached;
    const result=local(tile)||ready.has(id)||(ancestors.has(id)&&tile.level>0&&tileChildren(tile).every(covered));memo.set(id,result);return result;
  };
  const visible:string[]=[];
  const visit=(tile:AtlasTile)=>{
    if(local(tile))return;
    const id=tileKey(tile),split=ancestors.has(id)&&tile.level>0;
    if(split&&!desired.has(id)&&tileChildren(tile).every(covered))tileChildren(tile).forEach(visit);
    else if(ready.has(id))visible.push(id);
    else if(split)tileChildren(tile).forEach(visit);
  };
  roots.forEach(visit);return visible;
}
