import { useSyncExternalStore } from 'react';
import {createStore,get,set} from 'idb-keyval';
import { useCampaignStore } from './campaignStore';
import {beginGenerationJob,updateGenerationJob,waitForGenerationJobTurn} from './generationJobs';
import {planSharedWorld,generateSharedScene,rebuildSharedSettlement} from '../domain/sharedWorldClient';
import {requestForLocation} from '../domain/worldPipeline';
import {directWorldRequests} from '../ai/worldDirector';
import type {WorldPlan,CampaignPlan,WorldBlueprintV1} from '../domain/types';
import type {SceneRequest} from '../domain/sharedWorld';
import {restoreSharedMapDetails} from '../domain/sharedWorldFiles';
import {sharedSceneMatchesLayout} from '../domain/sharedSceneLayout';

interface PendingWorld {campaignId:string;world:WorldPlan;plan?:CampaignPlan;requests:SceneRequest[];stage:string;error?:string;status:'running'|'paused'|'complete';revision:number;requirementsPlanned?:boolean}
let snapshot:PendingWorld|null=null,controller:AbortController|undefined;
const listeners=new Set<()=>void>(),db=()=>createStore('dndrom-world-pipeline-v1','checkpoints');
const publish=()=>{listeners.forEach(l=>l());};
let writes=Promise.resolve();
const checkpoint=()=>{const value=structuredClone(snapshot);writes=writes.then(()=>set('pending',value,db())).catch(error=>{if(snapshot){snapshot={...snapshot,error:`Could not save generation checkpoint: ${String(error)}`};publish();}});publish();return writes;};
export const useWorldGeneration=()=>useSyncExternalStore(callback=>{listeners.add(callback);return()=>listeners.delete(callback);},()=>snapshot,()=>null);
export async function restoreWorldGeneration(){if(snapshot)return;const saved=await get<PendingWorld>('pending',db());if(saved&&saved.status!=='complete'){snapshot={...saved,status:'paused',stage:'Ready to resume'};publish();}}
export function cancelWorldGeneration(){controller?.abort();if(snapshot){snapshot={...snapshot,status:'paused',stage:'Paused'};void checkpoint();}}
export function editPendingScene(id:string,description:string){
  if(!snapshot)return;
  if(snapshot.world.manifest?.locations.some(l=>l.id===id))throw new Error('This location is already accepted. Create a separate world revision to change its geography.');
  cancelWorldGeneration();
  const requests=snapshot.requests.map(r=>r.id===id?{...requestForLocation({id:r.id,name:r.name,description,kind:r.scale==='wilderness'?'wilderness':r.scale,biome:'plains',position:{x:0,z:0},storyBeatIds:[],pointOfInterests:[],mapSeed:snapshot!.world.seed}),connectsTo:r.connectsTo,modes:r.modes,styleId:r.styleId}:r);
  snapshot={...snapshot,requests,revision:snapshot.revision+1,requirementsPlanned:false};void checkpoint();
}
export async function resumeWorldGeneration(){if(snapshot)await generateWorld(snapshot.world,snapshot.plan,snapshot.requests,undefined,snapshot.requirementsPlanned??!!snapshot.world.manifest?.locations.length);}
export async function generateWorld(input:WorldPlan,plan?:CampaignPlan,requests?:SceneRequest[],signal?:AbortSignal,requirementsPlanned=false):Promise<void>{
  controller?.abort();const abort=new AbortController();controller=abort;
  signal?.throwIfAborted();const forwardAbort=()=>abort.abort();signal?.addEventListener('abort',forwardAbort,{once:true});
  const start=useCampaignStore.getState().campaign,world=structuredClone(input),revision=(snapshot?.revision??0)+1;
  snapshot={campaignId:start.id,world,plan,requests:requests??world.manifest?.requests??world.locations.map(requestForLocation),stage:requirementsPlanned?'Resuming saved world plan':'Planning scene requirements',status:'running',revision,requirementsPlanned};await checkpoint();
  const jobId=beginGenerationJob({kind:'scene',label:world.name,message:'Planning shared world',stageLabel:'World',indeterminate:true,onCancel:()=>abort.abort()});
  try{
    if(!await waitForGenerationJobTurn(jobId)){abort.abort();throw new DOMException('Cancelled','AbortError');}
    const directed=requirementsPlanned?{requests:snapshot.requests,styles:world.generationStyles??world.manifest?.styles??[],warning:undefined}:await directWorldRequests(snapshot.requests,start.settings,abort.signal,(stage,message,detail)=>{if(abort.signal.aborted||snapshot?.revision!==revision)return;snapshot={...snapshot,stage:message};publish();updateGenerationJob(jobId,{stageLabel:stage,message,detail,indeterminate:true});});
    abort.signal.throwIfAborted();
    // Requirements are carried independently until terrain ownership exists.
    world.generationRequests=directed.requests;world.generationStyles=directed.styles;
    snapshot={...snapshot,requests:directed.requests,error:directed.warning,requirementsPlanned:true};await checkpoint();
    updateGenerationJob(jobId,{stageLabel:'Terrain search',message:'Measuring terrain for the requested locations',detail:'Cold terrain and erosion can take several minutes. Your current scene stays available.',indeterminate:true});
    const accepted=await planSharedWorld(world,abort.signal,p=>{if(snapshot?.revision!==revision)return;snapshot={...snapshot,world:p.checkpoint??snapshot.world,stage:p.message,requests:p.requests};updateGenerationJob(jobId,{message:p.message,stageLabel:p.stage,indeterminate:false,reportedByEngine:true,detail:undefined,percent:Math.min(75,10+p.completed.length/Math.max(1,p.requests.length)*60)});void checkpoint();});
    abort.signal.throwIfAborted();snapshot={...snapshot!,world:accepted,stage:'Building the starting scene'};await checkpoint();updateGenerationJob(jobId,{message:'Building the starting scene',stageLabel:'Playable scene',percent:80,indeterminate:true});
    const map=await generateSharedScene(accepted,accepted.manifest!.locations[0].id,abort.signal);
    abort.signal.throwIfAborted();const current=useCampaignStore.getState();if(current.campaign.id!==start.id||snapshot?.revision!==revision||current.campaign.world?.id!==start.world?.id||current.campaign.world?.manifest?.revision!==start.world?.manifest?.revision)throw new Error('Campaign geography changed during generation. The checkpoint is saved; resume to review a new revision.');
    if(plan)current.installGeneratedCampaign(plan,accepted,map);else current.commitSharedWorld(accepted,map);
    snapshot={...snapshot,status:'complete',stage:'World ready'};await checkpoint();updateGenerationJob(jobId,{status:'complete',percent:100,message:'Connected world ready'});
  }catch(error){if(snapshot?.revision===revision){snapshot={...snapshot,status:'paused',stage:abort.signal.aborted?'Paused':'Generation needs attention',error:abort.signal.aborted?undefined:String(error)};await checkpoint();}updateGenerationJob(jobId,{status:'error',message:abort.signal.aborted?'World generation paused':String(error),indeterminate:false,reportedByEngine:false,detail:'Resume from Connected world; completed locations are retained.'});if(!abort.signal.aborted)throw error;}finally{signal?.removeEventListener('abort',forwardAbort);}
}
export function worldFromBlueprint(bp:WorldBlueprintV1):WorldPlan {
  const existing=useCampaignStore.getState().campaign.world;
  const world:WorldPlan=existing?.manifest?structuredClone(existing):{id:crypto.randomUUID(),seed:String(bp.seed),name:`${bp.name} world`,summary:bp.description,widthMiles:124,depthMiles:124,locations:[],roads:[]};
  const id=bp.id,location={id,name:bp.name,kind:bp.kind==='settlement'?'town' as const:'wilderness' as const,biome:bp.theme,position:{x:0,z:0},description:bp.description,storyBeatIds:[],pointOfInterests:[],mapSeed:world.seed};
  if(!world.locations.some(l=>l.id===id))world.locations.push(location);
  if(world.manifest&&!world.manifest.requests.some(r=>r.id===id)){world.manifest.requests.push(requestForLocation(location));world.manifest.revision++;}
  return world;
}
let travelController:AbortController|undefined;
export async function enterWorldLocation(locationId?:string,signal?:AbortSignal){
  travelController?.abort();const abort=new AbortController();travelController=abort;
  signal?.throwIfAborted();
  const state=useCampaignStore.getState(),start=state.campaign,world=start.world;if(!world?.manifest)return false;
  const existing=start.scenes?.find(s=>s.map.world?.sharedWorld?.id===world.id&&s.map.world.sharedWorld.revision===world.manifest!.revision&&sharedSceneMatchesLayout(s.map,world.manifest!)&&(locationId?s.map.locationId===locationId:s.map.journey?.level==='travel'));
  if(existing&&!existing.map.sharedCacheOmitted){state.switchScene(existing.id);return true;}
  signal?.throwIfAborted();const forwardAbort=()=>abort.abort();signal?.addEventListener('abort',forwardAbort,{once:true});
  const jobId=beginGenerationJob({kind:'scene',label:'Entering location',message:'Loading shared geography',stageLabel:'Scene',onCancel:()=>abort.abort()});
  try{if(!await waitForGenerationJobTurn(jobId))return true;const map=await generateSharedScene(world,locationId,abort.signal);abort.signal.throwIfAborted();if(useCampaignStore.getState().campaign.id!==start.id)throw new Error('Campaign changed');const current=useCampaignStore.getState();if(existing){current.switchScene(existing.id);current.replaceMap(restoreSharedMapDetails(existing.map,map),'Rebuilt local scene cache');}else if(start.map.sharedCacheOmitted&&start.map.locationId===locationId){current.replaceMap(restoreSharedMapDetails(start.map,map),'Rebuilt local scene cache');}else current.addScene(map.name,map,start.characters.map(c=>c.id),'Shared world location');updateGenerationJob(jobId,{status:'complete',percent:100,message:'Location ready'});return true;}
  catch(error){updateGenerationJob(jobId,{status:'error',message:String(error)});if(!abort.signal.aborted)throw error;return true;}
  finally{signal?.removeEventListener('abort',forwardAbort);}
}


export async function rebuildCurrentSettlement(){
  const start=useCampaignStore.getState().campaign,locationId=start.map.locationId,world=start.world;
  if(!world?.manifest||!locationId)throw new Error('Enter a settlement before rebuilding it');
  const abort=new AbortController(),jobId=beginGenerationJob({kind:'scene',label:'Settlement revision',message:'Planning new streets and buildings',stageLabel:'Settlement',indeterminate:true,onCancel:()=>abort.abort()});
  try{
    if(!await waitForGenerationJobTurn(jobId))return;
    const revised=await rebuildSharedSettlement(world,locationId,abort.signal,p=>updateGenerationJob(jobId,{message:p.message,stageLabel:p.stage}));
    updateGenerationJob(jobId,{message:'Building the revised settlement',stageLabel:'Playable scene'});
    const map=await generateSharedScene(revised,locationId,abort.signal);abort.signal.throwIfAborted();
    const current=useCampaignStore.getState();
    if(current.campaign.id!==start.id||current.campaign.world!==world)throw new Error('The world changed while rebuilding. The proposed revision was discarded.');
    current.commitSharedWorld(revised,{...map,lighting:start.map.lighting??map.lighting,weather:start.map.weather??map.weather,gridShape:start.map.gridShape,gridSize:start.map.gridSize});
    updateGenerationJob(jobId,{status:'complete',percent:100,message:'Settlement rebuilt; previous scene retained'});
  }catch(error){updateGenerationJob(jobId,{status:'error',message:abort.signal.aborted?'Settlement rebuild cancelled':String(error)});if(!abort.signal.aborted)throw error;}
}
