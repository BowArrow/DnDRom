import { buildSharedWorld, reviseSettlement } from './worldPipeline';
import { compileSharedScene } from './sharedWorldScene';
import type { WorldPlan } from './types';
import {openNativeErosionCache,flushNativeErosionCache} from '../migration/nativeErosionCache';
import {sharedWorldSeed} from './sharedWorld';
self.onmessage=async(event:MessageEvent<{id:string;world:WorldPlan;operation:'plan'|'scene'|'settlement';locationId?:string}>)=>{
  const {id,world,operation,locationId}=event.data;
  try{await openNativeErosionCache(world.manifest?.seed??sharedWorldSeed(world.seed),world.manifest?.origin);const result=operation==='plan'?buildSharedWorld(world,progress=>self.postMessage({id,progress})):operation==='settlement'?reviseSettlement(world,locationId!,progress=>self.postMessage({id,progress})):compileSharedScene(world,locationId);await flushNativeErosionCache();self.postMessage({id,result});}
  catch(error){await flushNativeErosionCache();self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
