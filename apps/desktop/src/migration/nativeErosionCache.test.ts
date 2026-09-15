import {afterEach,describe,it,expect,vi} from "vitest";
const {configure}=vi.hoisted(()=>({configure:vi.fn()}));
vi.mock("../domain/worldErosion",()=>({configureErosionCache:configure,erosionCachePrefix:(seed:number)=>`hydrology-22:${seed}:`}));
import {openNativeErosionCache} from "./nativeErosionCache";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();configure.mockClear();});
describe("terrain cache startup",()=>{
  it("continues without persistence when opening the database never resolves",async()=>{
    vi.useFakeTimers();vi.stubGlobal("indexedDB",{open:()=>({})});
    const ready=openNativeErosionCache(719);await vi.advanceTimersByTimeAsync(2100);await ready;
    expect(configure).toHaveBeenCalledWith(undefined);
  });
  it("lets a healthy slow field read finish instead of restarting erosion mid-read",async()=>{
    vi.useFakeTimers();vi.stubGlobal("IDBKeyRange",{bound:()=>({})});
    const key="hydrology-22:719:2048:0:0",tile={height:new Float64Array([123])};
    const database={transaction:()=>{
      const transaction:{oncomplete?:()=>void;objectStore:()=>unknown}={objectStore:()=>({
        getAllKeys:()=>{const request={result:[key],onsuccess:undefined as undefined|(()=>void)};setTimeout(()=>request.onsuccess?.(),0);return request;},
        get:()=>{const request={result:tile,onsuccess:undefined as undefined|(()=>void)};setTimeout(()=>{request.onsuccess?.();transaction.oncomplete?.();},3500);return request;},
      })};return transaction;
    }};
    vi.stubGlobal("indexedDB",{open:()=>{const request={result:database,onsuccess:undefined as undefined|(()=>void)};setTimeout(()=>request.onsuccess?.(),0);return request;}});
    const ready=openNativeErosionCache(719);await vi.advanceTimersByTimeAsync(2200);expect(configure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);await ready;
    expect(configure.mock.calls[0][0].get(key)).toBe(tile);
  });
});
