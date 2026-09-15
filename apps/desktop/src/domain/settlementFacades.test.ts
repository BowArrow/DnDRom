import {describe,it,expect} from 'vitest';
import {structuralPart} from './settlementBuildings';
import {expandSceneRecipe,type ScenePart} from './sceneGrammar';
import {roofWallGeometry,openingParts,buildAssemblyMeshes} from '../rendering/sceneAssemblyMesh';
import {refreshSettlementFacades} from './settlementFacadeRefresh';
import type {GameMap} from './types';

describe('finished settlement facades',()=>{
 it('closes gables and curved hip eaves with finite geometry at every detail level',()=>{
   for(const roofProfile of ['gable','hip'] as const)for(const curve of [0,.25,.65])for(const lod of [0,1,2]){
     const house=structuralPart('house',0,3.1,0,9,6.2,12,'masonry','#aaa999');
     const roof={...structuralPart('roof',0,7.45,0,10,2.5,13,'roof','#543a29'),curve,roofProfile};
     const enclosure=expandSceneRecipe([house,roof]).find(p=>p.shape==='roof-wall')!;expect(enclosure).toBeDefined();
     const mesh=roofWallGeometry(enclosure,lod);expect(mesh.indices.length).toBeGreaterThan(0);
     for(const values of Object.values(mesh))expect(values.every(Number.isFinite)).toBe(true);
     // Every top vertex lies on the roof's sampled height function, including
     // the raised curved eaves and the inset ridge of a hipped roof.
     const bands=roofProfile==='hip'&&curve===0?1:lod===2?6:lod===1?8:12;
     for(let i=0;i<mesh.positions.length;i+=3){const x=mesh.positions[i]*9/10,z=mesh.positions[i+2]*12/13,y=mesh.positions[i+1];if(y<=-.49999)continue;
       const t=roofProfile==='hip'?Math.max(Math.abs(z)*2,Math.abs(x)*4-1):Math.abs(z)*2;
       // Gable tessellation divides the full cross-section into bands.
       const steps=roofProfile==='gable'?bands/2:bands,a=Math.floor(t*steps)/steps,b=Math.min(1,a+1/steps),f=(t-a)*steps,height=(v:number)=>.5-v+curve*v**3;
       expect(y).toBeCloseTo(height(a)*(1-f)+height(b)*f,5);
     }
     for(let i=0;i<mesh.normals.length;i+=3)expect(Math.hypot(...mesh.normals.slice(i,i+3))).toBeCloseTo(1,5);
   }
 });
 it('adds visible window joinery and open door leaves with clear thresholds',()=>{
   const parts=expandSceneRecipe([{...structuralPart('house',0,1.55,0,9,3.1,10,'masonry','#aaa999'),bays:{x:3,z:2}}]);
   expect(parts.filter(p=>p.shape==='doorway')).toHaveLength(2);expect(parts.filter(p=>p.shape==='window-frame')).toHaveLength(8);
   const door=parts.find(p=>p.shape==='doorway')!,leaf=openingParts(door).find(p=>p.rotation.y===90)!;
   expect(leaf.size.y).toBeGreaterThan(2);expect(leaf.position.x).toBeLessThan(-.8);
   expect(openingParts(parts.find(p=>p.shape==='window-frame')!).length).toBeGreaterThanOrEqual(9);
   for(const mesh of buildAssemblyMeshes(parts).values())for(const values of [mesh.positions,mesh.normals,mesh.indices])expect(values.every(Number.isFinite)).toBe(true);
 });
 it('refreshes old saved meshes without moving parcels or overwriting authored buildings',()=>{
   const recipe:ScenePart[]=[structuralPart('house',0,1.55,0,9,3.1,10,'masonry','#aaa999'),structuralPart('roof',0,4.35,0,10,2.5,11,'roof','#543a29')];
   const entity:GameMap['entities'][number]={id:'home',assetId:'house-large',name:'Home',position:{x:12,y:3,z:42},rotation:{x:0,y:73,z:0},scale:{x:1,y:1,z:1},worldGeometry:{kind:'assembly',recipeId:'old',parts:[]}};
   const map={entities:[entity],world:{sharedWorld:{seed:42,requests:[],styles:[],terrain:{version:1,climate:[],edits:[]},locations:[{id:'village',position:{x:0,y:250,z:0},settlement:{buildings:[{id:'home',recipe,position:{x:0,y:250,z:0}}]}}]}}} as unknown as GameMap;
   const before=JSON.stringify(map),updated=refreshSettlementFacades(map);expect(JSON.stringify(map)).toBe(before);expect(updated.entities[0].position).toBe(entity.position);expect(updated.entities[0].rotation).toBe(entity.rotation);
   expect(updated.entities[0].worldGeometry!.kind).toBe('assembly');expect(refreshSettlementFacades(updated)).toBe(updated);
   map.world!.sharedWorld!.authoredEntities=[entity as GameMap['entities'][number]];expect(refreshSettlementFacades(map)).toBe(map);
 });
});
