// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {streamNativeWorld,type WorldStream} from './nativeWorld';
import {selectAtlasTiles,tileKey} from '../domain/worldAtlas';
import type {GameMap} from '../domain/types';

const state=vi.hoisted(()=>({ready:new Set<string>(),importing:new Map<string,number>(),visible:[] as string[],requested:[] as string[],cameraX:0,cameraZ:0,complete:false,radius:0,hold:'',errors:[] as string[]}));
vi.mock('../domain/sharedWorld',async importOriginal=>({...await importOriginal<typeof import('../domain/sharedWorld')>(),worldRegionFingerprint:()=> 'fixture-v1'}));
vi.mock('./nativeModels',()=>({sendNativeModelMaterials:async()=>{}}));
vi.mock('./nativeBridge',()=>({nativeTransferStatistics:{},nativeUpload:async(_json:string,_kind:string,id:string)=>{state.importing.set(id,2);},nativeCall:async(method:string,params:{visible?:string[];remove?:string[];revealComplete?:boolean;revealRadius?:number}={})=>{
 if(method==='world.clear'){state.ready.clear();return {};}
 for(const id of params.remove??[])state.ready.delete(id);
 if(params.visible){state.visible=params.visible;state.complete=!!params.revealComplete;state.radius=params.revealRadius??0;}
 // Upload completion precedes native mesh/instance readiness by two polls.
 for(const [id,ticks] of state.importing)if(id!==state.hold){if(ticks===0){state.ready.add(id);state.importing.delete(id);}else state.importing.set(id,ticks-1);}
 return {cameraX:state.cameraX,cameraZ:state.cameraZ,readyTiles:[...state.ready],importComplete:true,worldSync:true};
}}));
const map={id:'harbor',width:256,depth:256,world:{seed:42,sharedWorld:{}},entities:[{worldGeometry:{kind:'terrain'}}]} as unknown as GameMap;
let stream:WorldStream;
beforeEach(()=>{
 Object.assign(state,{ready:new Set(),importing:new Map(),visible:[],requested:[],cameraX:0,cameraZ:0,complete:false,radius:0,hold:'',errors:[]});vi.useFakeTimers();
 vi.stubGlobal('Worker',class{onmessage?: (e:unknown)=>void;postMessage(p:{tile?:{level:number;x:number;z:number};signature:string}){if(!p.tile)return;const id=tileKey(p.tile);state.requested.push(id);Promise.resolve().then(()=>this.onmessage?.({data:{id,signature:p.signature,json:'{}',materials:[]}}));}terminate(){}});
});
afterEach(()=>{stream?.();vi.useRealTimers();vi.unstubAllGlobals();});
const tick=()=>vi.advanceTimersByTimeAsync(200);

it('finishes the real atlas selection under continual camera rotation, after native readiness',async()=>{
 const desired=selectAtlasTiles(0,0,map).desired.map(tileKey);
 stream=streamNativeWorld(map,error=>state.errors.push(error),'world/test');await tick();
 for(let i=0;i<500&&!state.complete;i++){state.cameraX=Math.cos(i*.13)*300;state.cameraZ=Math.sin(i*.13)*300;await tick();}
 expect(state.errors).toEqual([]);expect(state.complete).toBe(true);
 expect(desired.every(id=>state.visible.includes(id))).toBe(true);
 expect(state.radius).toBeGreaterThan(60000);
 const count=state.requested.length;
 // Ordinary LOD selection resumes after the one-time initial reveal.
 state.cameraX=1400;await vi.advanceTimersByTimeAsync(3000);
 expect(state.requested.length).toBeGreaterThan(count);expect(state.complete).toBe(true);
});

it('holds the last unfinished distant tile and completes after its native acknowledgement',async()=>{
 const desired=selectAtlasTiles(0,0,map).desired;
 state.hold=tileKey(desired.reduce((a,b)=>b.level>a.level?b:a));
 stream=streamNativeWorld(map,error=>state.errors.push(error),'world/test');
 await vi.advanceTimersByTimeAsync(90000);
 expect(state.errors).toEqual([]);expect(state.importing.has(state.hold)).toBe(true);expect(state.complete).toBe(false);
 expect(state.visible.includes(state.hold)).toBe(false);
 state.hold='';await vi.advanceTimersByTimeAsync(2000);
 expect(state.complete).toBe(true);
});
