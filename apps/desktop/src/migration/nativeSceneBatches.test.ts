import{describe,it,expect}from'vitest';import{nativeSceneBatches}from'./nativeSceneBatches';import type{UnrealScene}from'./unrealScene';
const mesh=(id:string,material='terrain')=>({id,material,collision:material==='terrain',lods:[{positions:[0,0,0,1,0,0,0,0,1],normals:[0,1,0,0,1,0,0,1,0],uvs:[0,0,1,0,0,1],colors:Array(12).fill(255),indices:[0,1,2]}]});
describe('bounded local scene imports',()=>{
 it('preserves every placement and geometry while excluding authored payload from runtime transport',()=>{
 const scene={format:'dndrom.scene',version:1,coordinates:'right-handed-y-up-metres',name:'Harbor',source:{map:{id:'harbor',entities:[{privateAuthoringData:'x'.repeat(100000)}]}},warnings:[],meshes:[mesh('leaves','leaves-broadleaf'),mesh('terrain')],instances:Array.from({length:500},(_,i)=>({entityId:'tree-'+i,meshId:i===0?'terrain':'leaves',position:{x:i,y:0,z:0},rotation:[0,0,0,1],scale:{x:1,y:1,z:1}}))} as unknown as UnrealScene;
 const parts=nativeSceneBatches(scene,'revision',16000).map(s=>{expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(16000);return JSON.parse(s);});
 expect(parts.length).toBeGreaterThan(1);expect(parts[0].meshes[0].material).toBe('terrain');
 expect(parts.flatMap(p=>p.instances).sort((a,b)=>a.position.x-b.position.x)).toEqual(scene.instances);
 for(const p of parts){expect(p.source.map).toEqual({id:'harbor'});expect(p.streamId).toBe('revision');for(const i of p.instances)expect(p.meshes.some((m:{id:string})=>m.id===i.meshId)).toBe(true);}
 });
});
