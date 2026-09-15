import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({build:vi.fn(),open:vi.fn(),flush:vi.fn()}));
vi.mock('./worldPipeline',()=>({buildSharedWorld:mocks.build}));
vi.mock('./sharedWorldScene',()=>({compileSharedScene:vi.fn()}));
vi.mock('../migration/nativeErosionCache',()=>({openNativeErosionCache:mocks.open,flushNativeErosionCache:mocks.flush}));
vi.mock('./sharedWorld',()=>({sharedWorldSeed:()=>7}));
describe('failed planning worker cache persistence',()=>{
 beforeEach(()=>{vi.resetModules();vi.clearAllMocks();});afterEach(()=>vi.unstubAllGlobals());
 it('finishes terrain cache writes before sending an error that terminates the worker',async()=>{
   const worker={onmessage:undefined as undefined|((event:unknown)=>Promise<void>),postMessage:vi.fn()};vi.stubGlobal('self',worker);
   let finish!:()=>void;mocks.open.mockResolvedValue(undefined);mocks.flush.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));mocks.build.mockImplementation(()=>{throw new Error('No safe berth');});
   await import('./sharedWorld.worker');
   const pending=worker.onmessage!({data:{id:'attempt',operation:'plan',world:{seed:'7'}}});
   await vi.waitFor(()=>expect(mocks.flush).toHaveBeenCalledOnce());expect(worker.postMessage).not.toHaveBeenCalled();
   finish();await pending;expect(worker.postMessage).toHaveBeenCalledWith({id:'attempt',error:'No safe berth'});
 });
});
