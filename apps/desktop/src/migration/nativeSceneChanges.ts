import type { GameMap, MapEntity } from '../domain/types';

const terrainKind=(e:MapEntity)=>['terrain','water','river-ribbon','road-ribbon'].includes(e.worldGeometry?.kind??'');
const shape=(e:MapEntity)=>{const {position,rotation,scale,build,...rest}=e;return JSON.stringify(rest);};
/** Ordinary editing never invalidates the terrain import or its reveal. */
export function nativeSceneChanges(before:GameMap,after:GameMap,refreshAssets=false){
 const old=new Map(before.entities.map(e=>[e.id,e]));
 const replace:MapEntity[]=[],transforms:Array<{id:string;before:MapEntity;after:MapEntity}>=[];
 let rebuild=before.id!==after.id||before.width!==after.width||before.depth!==after.depth;
 for(const entity of after.entities){const previous=old.get(entity.id);old.delete(entity.id);
  if(previous===entity&&(!refreshAssets||entity.worldGeometry))continue;
  if(!previous||shape(previous)!==shape(entity)||refreshAssets&&!entity.worldGeometry){replace.push(entity);if(terrainKind(entity))rebuild=true;}
  else if(JSON.stringify([previous.position,previous.rotation,previous.scale])!==JSON.stringify([entity.position,entity.rotation,entity.scale])){transforms.push({id:entity.id,before:previous,after:entity});if(terrainKind(entity))rebuild=true;}
 }
 if([...old.values()].some(terrainKind))rebuild=true;
 return {rebuild,replace,transforms,remove:[...old.keys()]};
}
