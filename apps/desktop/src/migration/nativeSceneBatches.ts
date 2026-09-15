import type {UnrealScene} from './unrealScene';
/** Runtime transport has no campaign payload. Authored data stays in persistence
 * and the full downloadable export. Bound each independently validated import. */
export function nativeSceneBatches(scene:UnrealScene,streamId:string,limit=16*1024*1024):string[] & {playablePart:number}{
  const groups=new Map<string,UnrealScene['instances']>();
  for(const i of scene.instances){const list=groups.get(i.meshId)??[];list.push(i);groups.set(i.meshId,list);}
  const header={format:scene.format,version:scene.version,coordinates:scene.coordinates,name:scene.name,source:{map:{id:scene.source.map.id}},streamId,warnings:scene.warnings};
  const batches=Object.assign([] as string[],{playablePart:0});let meshes:UnrealScene['meshes']=[],instances:UnrealScene['instances']=[],bytes=1024,vertices=0;
  const flush=()=>{if(!meshes.length)return;const json=JSON.stringify({...header,meshes,instances,...(!batches.length?{waterFields:scene.waterFields}: {})});if(new TextEncoder().encode(json).length>limit)throw new Error('A native scene batch exceeds its transfer budget');if(meshes.some(m=>m.material!=='grass-blades'))batches.playablePart=batches.length;batches.push(json);meshes=[];instances=[];bytes=1024;vertices=0;};
  const priority=(m:UnrealScene['meshes'][number])=>m.material==='terrain'?0:m.material==='water'?1:m.collision?2:m.material==='grass-blades'?4:3;
  bytes+=JSON.stringify(scene.waterFields??[]).length+JSON.stringify(header).length;
  for(const mesh of [...scene.meshes].sort((a,b)=>priority(a)-priority(b))){
    const size=new TextEncoder().encode(JSON.stringify(mesh)).length+2,count=mesh.lods.reduce((n,l)=>n+l.positions.length/3,0);
    if(size>limit/2||count>1000000)throw new Error(`Mesh ${mesh.id} exceeds the native per-mesh budget`);
    let added=false;
    for(const instance of groups.get(mesh.id)??[]){const n=new TextEncoder().encode(JSON.stringify(instance)).length+2;
      if(bytes+n+(added?0:size)>limit-4096||instances.length>=60000||(!added&&vertices+count>1000000)){flush();added=false;}
      if(!added){meshes.push(mesh);bytes+=size;vertices+=count;added=true;}instances.push(instance);bytes+=n;
    }
  }
  flush();if(!batches.length)batches.push(JSON.stringify({...header,meshes:[],instances:[]}));return batches;
}
