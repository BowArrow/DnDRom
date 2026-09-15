import {configureErosionCache,erosionCachePrefix,type ErosionTile} from "../domain/worldErosion";
let preload:((x:number,z:number,size:number,detail:boolean)=>Promise<void>)|undefined;
export async function prepareNativeErosionRegion(x:number,z:number,size:number,detail:boolean){await preload?.(x,z,size,detail);}
const writes=new Set<Promise<void>>();
/** Finish transactions before the short-lived compiler worker is terminated. */
export async function flushNativeErosionCache(){await Promise.allSettled([...writes]);}

/** CEF IndexedDB stores the evolved fields locally. Reloading a campaign does
 * not need to repeat geological simulation. Failure only disables this cache. */
export async function openNativeErosionCache(seed:number,focus:{x:number;z:number}={x:0,z:0}):Promise<void>{
  try{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open("dndrom-terrain-cache",1),timer=setTimeout(()=>reject(new Error("Terrain cache open timed out")),2000);request.onupgradeneeded=()=>request.result.createObjectStore("fields");request.onsuccess=()=>{clearTimeout(timer);resolve(request.result);};request.onerror=()=>{clearTimeout(timer);reject(request.error);};});
    const prefix=erosionCachePrefix(seed),records=new Map<string,ErosionTile>();
    const priority=(key:string)=>{
      const [spacing,x,z]=key.slice(prefix.length).split(":").map(Number);
      return Math.hypot(Math.max(0,Math.abs(x*spacing-focus.x)-spacing),Math.max(0,Math.abs(z*spacing-focus.z)-spacing));
    };
    // Read keys first. Loading every distant field only to discard most of
    // them needlessly copied hundreds of MB on each campaign reopen.
    const keys=await new Promise<string[]>((resolve,reject)=>{
      const request=db.transaction("fields","readonly").objectStore("fields").getAllKeys(IDBKeyRange.bound(prefix,prefix+"\uffff"));
      request.onsuccess=()=>resolve(request.result.map(String).sort((a,b)=>priority(a)-priority(b)).slice(0,96));request.onerror=()=>reject(request.error);
    });
    await new Promise<void>((resolve,reject)=>{
      const transaction=db.transaction("fields","readonly"),store=transaction.objectStore("fields");
      for(const key of keys){const request=store.get(key);request.onsuccess=()=>{if(request.result)records.set(key,request.result as ErosionTile);};}
      transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);
    });
    preload=async(x,z,size,detail)=>{
      focus={x:x+size/2,z:z+size/2};
      const wanted:string[]=[];
      // Fine fields sample a 4 km apron of regional erosion for their base.
      for(const spacing of detail?[8192,2048]:[8192]){
        const pad=detail&&spacing===8192?4096:spacing/8;
        for(let iz=Math.floor((z-pad)/spacing);iz<=Math.ceil((z+size+pad)/spacing);iz++)for(let ix=Math.floor((x-pad)/spacing);ix<=Math.ceil((x+size+pad)/spacing);ix++)wanted.push(`${prefix}${spacing}:${ix}:${iz}`);
      }
      await new Promise<void>(resolve=>{
        const tx=db.transaction('fields','readonly');
        for(const key of wanted)if(!records.has(key)){const r=tx.objectStore('fields').get(key);r.onsuccess=()=>{if(r.result)records.set(key,r.result);};}
        tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();
      });
      for(const key of [...records.keys()].sort((a,b)=>priority(a)-priority(b)).slice(192))records.delete(key);
    };
    configureErosionCache({get:key=>records.get(key),put:(key,tile)=>{
      records.set(key,tile);if(records.size>192){const furthest=[...records.keys()].sort((a,b)=>priority(b)-priority(a))[0];records.delete(furthest);}
      try{
        const transaction=db.transaction("fields","readwrite"),store=transaction.objectStore("fields");store.put(tile,key);
        const done=new Promise<void>(resolve=>{transaction.oncomplete=()=>resolve();transaction.onabort=()=>resolve();transaction.onerror=()=>resolve();});
        writes.add(done);void done.then(()=>writes.delete(done));
        const keys=store.getAllKeys();keys.onsuccess=()=>{
          const ranked=keys.result.map(String).sort((a,b)=>{
            const ap=a.startsWith(prefix)?priority(a):Infinity,bp=b.startsWith(prefix)?priority(b):Infinity;return ap-bp;
          });
          for(const old of ranked.slice(768))store.delete(old);
        };
      }catch{/* Disk full/private storage: keep deterministic in-memory fields. */}
    }});
  }catch{preload=undefined;configureErosionCache(undefined);}
}
