import {afterEach,describe,expect,it,vi} from 'vitest';
import {planSharedWorld} from './sharedWorldClient';
import type {WorldPlan} from './types';
class PlanningWorker {
 static latest:PlanningWorker;
 onmessage?: (event:{data:Record<string,unknown>})=>void;
 onerror?: (event:{message:string})=>void;
 terminate=vi.fn();postMessage=vi.fn();
 constructor(){PlanningWorker.latest=this;}
}
const world:WorldPlan={id:'world',seed:'1',name:'Test',summary:'Test',widthMiles:124,depthMiles:124,locations:[],roads:[]};
afterEach(()=>vi.unstubAllGlobals());
describe('shared-world worker lifecycle',()=>{
 it('terminates cancelled work without accepting a late result',async()=>{vi.stubGlobal('Worker',PlanningWorker);const abort=new AbortController(),result=planSharedWorld(world,abort.signal),worker=PlanningWorker.latest,id=worker.postMessage.mock.calls[0][0].id;const rejected=expect(result).rejects.toMatchObject({name:'AbortError'});abort.abort();worker.onmessage?.({data:{id,result:world}});await rejected;expect(worker.terminate).toHaveBeenCalled();});
 it('ignores results from another request and accepts the matching checkpoint',async()=>{vi.stubGlobal('Worker',PlanningWorker);const progress=vi.fn(),result=planSharedWorld(world,undefined,progress),worker=PlanningWorker.latest,id=worker.postMessage.mock.calls[0][0].id;worker.onmessage?.({data:{id:'old-worker',result:{id:'wrong'}}});expect(worker.terminate).not.toHaveBeenCalled();worker.onmessage?.({data:{id,progress:{stage:'Checkpoint',checkpoint:world}}});expect(progress).toHaveBeenCalledOnce();worker.onmessage?.({data:{id,result:world}});expect(await result).toEqual(world);expect(worker.terminate).toHaveBeenCalledOnce();});
});
