/** Regenerable render payloads only. Never stores or replaces campaign plans. */
let connection:Promise<IDBDatabase|undefined>|undefined;
function database(){return connection??=new Promise(resolve=>{
 if(typeof indexedDB==='undefined'){resolve(undefined);return;}
 const request=indexedDB.open('dndrom-native-render-cache',1),timer=setTimeout(()=>resolve(undefined),1500);
 request.onupgradeneeded=()=>{request.result.createObjectStore('payloads');request.result.createObjectStore('metadata');};
 request.onsuccess=()=>{clearTimeout(timer);resolve(request.result);};request.onerror=()=>{clearTimeout(timer);resolve(undefined);};
});}
async function unpack(value:any){
 if(!value?.packedGeometry)return value;
 const encoded=await new Response(value.packedGeometry.stream().pipeThrough(new DecompressionStream('gzip'))).text();
 const {packedGeometry,...rest}=value;return {...rest,...JSON.parse(encoded)};
}
export async function readRenderCache<T>(key:string):Promise<T|undefined>{
 const db=await database();if(!db)return;
 return new Promise(resolve=>{const timer=setTimeout(()=>resolve(undefined),2000);try{const r=db.transaction('payloads').objectStore('payloads').get(key);r.onsuccess=()=>{clearTimeout(timer);void unpack(r.result).then(resolve).catch(()=>resolve(undefined));};r.onerror=()=>{clearTimeout(timer);resolve(undefined);};}catch{clearTimeout(timer);resolve(undefined);}});
}
export async function writeRenderCache(key:string,payload:unknown,bytes:number){
 // Compress geometry strings; material buffers retain their structured types.
 // Keep local payloads in a separate budget so atlas churn cannot evict the town.
 if(bytes>256*1024*1024)return;
 if(typeof CompressionStream!=='undefined'&&payload&&typeof payload==='object'){
  const original=payload as any;const geometry=original.json?{json:original.json}:original.batches?{batches:original.batches}:undefined;
  if(geometry){try{const packedGeometry=await new Response(new Blob([JSON.stringify(geometry)]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
   const {json,batches,...rest}=original;payload={...rest,packedGeometry};bytes=packedGeometry.size+(original.materials??[]).reduce((n:number,m:any)=>n+Object.values(m.maps??{}).reduce((v:number,b:any)=>v+(b.bytes?.byteLength??0),0),0);
  }catch{/* Retain the original payload when compression is unavailable. */}}
 }
 const db=await database();if(!db)return;
 await new Promise<void>(resolve=>{try{
  const tx=db.transaction(['payloads','metadata'],'readwrite'),data=tx.objectStore('payloads'),meta=tx.objectStore('metadata');
  data.put(payload,key);meta.put({key,bytes,used:Date.now()},key);
  const all=meta.getAll();all.onsuccess=()=>{let localBytes=0,atlasBytes=0;for(const entry of all.result.sort((a,b)=>b.used-a.used)){const local=entry.key.startsWith('local-');if(local)localBytes+=entry.bytes;else atlasBytes+=entry.bytes;if(local?localBytes>384*1024*1024:atlasBytes>768*1024*1024){data.delete(entry.key);meta.delete(entry.key);}}};
  tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();
 }catch{resolve();}});
}
