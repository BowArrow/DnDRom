import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {WorldPlan} from '../domain/types';
import {createWorldManifest} from '../domain/worldPipeline';
const mocks=vi.hoisted(()=>({saved:undefined as unknown,commit:vi.fn(),director:vi.fn(),planner:vi.fn(),scene:vi.fn(),campaign:{id:'campaign',settings:{},world:undefined},set:vi.fn()}));
vi.mock('idb-keyval',()=>({createStore:()=>({}),get:async()=>structuredClone(mocks.saved),set:mocks.set}));
vi.mock('./campaignStore',()=>({useCampaignStore:{getState:()=>({campaign:mocks.campaign,commitSharedWorld:mocks.commit})}}));
vi.mock('./generationJobs',()=>({beginGenerationJob:()=> 'job',updateGenerationJob:vi.fn(),waitForGenerationJobTurn:async()=>true}));
vi.mock('../domain/sharedWorldClient',()=>({planSharedWorld:mocks.planner,generateSharedScene:mocks.scene}));
vi.mock('../ai/worldDirector',()=>({directWorldRequests:mocks.director}));
vi.mock('../domain/sharedWorldFiles',()=>({restoreSharedMapDetails:vi.fn()}));
const world:WorldPlan={id:'saved-world',seed:'fixture',name:'Harbor world',summary:'',widthMiles:100,depthMiles:100,roads:[],locations:[{id:'harbor',name:'Harbor',kind:'town',biome:'coast',position:{x:0,z:0},description:'Harbor town',storyBeatIds:[],pointOfInterests:[],mapSeed:'fixture'}]};
function checkpoint(){
 const m=createWorldManifest(world,{x:0,z:0});
 m.locations.push({id:'harbor',requestId:'harbor',name:'Harbor',position:{x:0,y:185,z:0},radius:180,biome:'steppe',slope:0,relief:0,settlement:{id:'harbor-settlement',buildings:[],streets:[],docks:[]}});
 m.requests[0].status='located';
 m.requests.push({...m.requests[0],id:'mainland',name:'Mainland',status:'pending'});
 return {campaignId:'campaign',world:{...world,manifest:m},requests:m.requests,status:'paused',revision:1,stage:'Sites',error:'Insufficient ferry clearance'};
}
describe('saved world recovery',()=>{
 beforeEach(()=>{vi.resetModules();vi.clearAllMocks();mocks.saved=checkpoint();mocks.planner.mockImplementation(async input=>input);mocks.scene.mockResolvedValue({});mocks.director.mockImplementation(async requests=>({requests,styles:[]}));});
 it('resumes an older accepted checkpoint without rerunning the local model',async()=>{
   const saved=structuredClone(mocks.saved),generation=await import('./worldGeneration');
   await generation.restoreWorldGeneration();await generation.resumeWorldGeneration();
   expect(mocks.director).not.toHaveBeenCalled();expect(mocks.planner).toHaveBeenCalledOnce();expect(mocks.commit).toHaveBeenCalledOnce();
   expect(mocks.saved).toEqual(saved);
 });
 it('replans explicitly edited pending requirements on resume',async()=>{
   const generation=await import('./worldGeneration');await generation.restoreWorldGeneration();
   generation.editPendingScene('mainland','A coastal village with an inn');await generation.resumeWorldGeneration();
   expect(mocks.director).toHaveBeenCalledOnce();
   expect(mocks.director.mock.calls[0][0].find((r:{id:string})=>r.id==='mainland').description).toBe('A coastal village with an inn');
 });
 it('saves a failed attempt and retries its planned requirements without committing partial results',async()=>{
   const generation=await import('./worldGeneration');await generation.restoreWorldGeneration();
   mocks.planner.mockRejectedValueOnce(new Error('No connected berth'));
   await expect(generation.resumeWorldGeneration()).rejects.toThrow('No connected berth');
   expect(mocks.commit).not.toHaveBeenCalled();
   expect(mocks.set.mock.calls.at(-1)?.[1]).toMatchObject({status:'paused',requirementsPlanned:true,error:'Error: No connected berth'});
   await generation.resumeWorldGeneration();expect(mocks.director).not.toHaveBeenCalled();expect(mocks.commit).toHaveBeenCalledOnce();
 });
});
