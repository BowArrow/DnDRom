/** Private UObject bridge. No HTTP control endpoint or separately installed AI server. */
declare global { interface Window { ue?: { dndrom?: { dispatch: (json: string) => Promise<string> } }; } }
export const isUnreal = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("native") === "1";
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const early = new Map<string, Record<string, unknown>>();
let initialized = false;
export const nativeSceneStatistics={sceneUploads:0,objectUploads:0,revealRequests:0,entityUpdates:0,transforms:[] as unknown[]};

function settle(message: Record<string, unknown>) {
  const id = String(message.id), request = pending.get(id);
  if (!request) { if (early.size < 100) early.set(id, message); return; }
  clearTimeout(request.timer); pending.delete(id);
  if (message.ok) request.resolve(message.result); else request.reject(new Error(String(message.error)));
}
export async function nativeCall<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!initialized) {
    initialized = true;
    window.addEventListener("dndrom:native", event => {
      const message = (event as CustomEvent).detail;
      if (typeof message?.ok === "boolean") settle(message);
    });
  }
  const deadline = Date.now() + 15_000;
  while (!window.ue?.dndrom) { if (Date.now() >= deadline) throw new Error("The native app bridge did not start."); await new Promise(resolve => setTimeout(resolve, 25)); }
  Object.assign(window,{dndromNativeStatistics:nativeSceneStatistics});
  if((method==='upload.inline'||method==='upload.begin')&&params.kind==='scene')nativeSceneStatistics.sceneUploads++;
  if((method==='upload.inline'||method==='upload.begin')&&params.kind==='tile'&&String(params.name).startsWith('edit:'))nativeSceneStatistics.objectUploads++;
  if(method==='world.reveal')nativeSceneStatistics.revealRequests++;
  if(method==='scene.input'&&params.kind==='entities'){nativeSceneStatistics.entityUpdates++;if(Array.isArray(params.transforms)){nativeSceneStatistics.transforms.push(...params.transforms);nativeSceneStatistics.transforms=nativeSceneStatistics.transforms.slice(-32);}}
  const value = JSON.parse(await window.ue.dndrom.dispatch(JSON.stringify({ method, params })));
  if (value.error) throw new Error(value.error);
  if (!value.requestId) return value as T;
  return new Promise<T>((resolve, reject) => {
    const id = value.requestId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("The local runtime request timed out.")); }, 30 * 60_000);
    pending.set(id, { resolve: result => resolve(result as T), reject, timer });
    const message = early.get(id); if (message) { early.delete(id); settle(message); }
  });
}

// One active transfer, with acknowledgements and UTF-16 surrogate-safe splitting.
export const nativeTransferStatistics={jsonCharacters:0,wireCharacters:0,chunks:0,compressedTransfers:0,nativeCacheHits:0};
let inlineSupported=false;
let transfers: Promise<unknown> = Promise.resolve();
export function nativeUpload(text: string, kind: "scene" | "download" | "tile" | "material", name = "", signal?: AbortSignal): Promise<Record<string, unknown>> {
  const run = transfers.catch(() => {}).then(async () => {
    signal?.throwIfAborted();
    let cacheKey:string|undefined;
    if((kind==='scene'||kind==='tile')&&text.length>1_000_000){
      const streamId=text.match(/"streamId":"([^"]*)"/)?.[1]??'';
      const stable=text.replace(/"streamId":"[^"]*"/,'"streamId":""');
      cacheKey=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable))),v=>v.toString(16).padStart(2,'0')).join('');
      try{const hit=await nativeCall<{hit:boolean}>('upload.cached',{kind,name,cacheKey,streamId});if(hit.hit){nativeTransferStatistics.nativeCacheHits++;return {loaded:true};}}catch{/* Earlier native hosts still accept normal uploads. */}
    }
    let compressed:string|undefined,uncompressedBytes=0;
    if((kind==="scene"||kind==="tile")&&text.length>64000&&typeof CompressionStream!=="undefined"){
      const raw=new TextEncoder().encode(text);uncompressedBytes=raw.length;
      if(uncompressedBytes>128*1024*1024)throw new Error("Scene exceeds 128 MiB transfer limit");
      const data=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
      let binary="";for(let i=0;i<data.length;i+=16384)binary+=String.fromCharCode(...data.subarray(i,i+16384));
      const encoded=btoa(binary);if(encoded.length<text.length*.9)compressed=encoded;
    }
    signal?.throwIfAborted();
    const inlineParams={kind,name,cacheKey,text:compressed??text,...(compressed?{encoding:"gzip-base64",uncompressedBytes}:{})};
    if(inlineSupported&&(kind==="tile"||kind==="scene")&&JSON.stringify(inlineParams).length<480000){
      nativeTransferStatistics.jsonCharacters+=text.length;nativeTransferStatistics.wireCharacters+=(compressed??text).length;nativeTransferStatistics.chunks++;
      if(compressed)nativeTransferStatistics.compressedTransfers++;
      return nativeCall("upload.inline",inlineParams);
    }
    const { id, encoding, inline } = await nativeCall<{ id: string; encoding?:string; inline?:boolean }>("upload.begin", { kind, name, cacheKey, ...(compressed?{acceptEncoding:"gzip-base64",uncompressedBytes}:{}) });
    inlineSupported=inline===true;
    // Older native hosts decline the encoding and receive the original JSON.
    const payload=compressed&&encoding==="gzip-base64"?compressed:text;
    nativeTransferStatistics.jsonCharacters+=text.length;nativeTransferStatistics.wireCharacters+=payload.length;
    if(payload!==text)nativeTransferStatistics.compressedTransfers++;
    try {
    for (let offset = 0; offset < payload.length;) {
      signal?.throwIfAborted();
      let end = Math.min(payload.length, offset + 384_000);
      // Native requests permit 512 Ki UTF-16 units. Size the encoded payload,
      // since quotes/control characters expand when the chunk is serialized.
      // Larger numeric mesh chunks avoid hundreds of CEF round trips per world.
      while(JSON.stringify({id,text:payload.slice(offset,end)}).length>480_000)end=offset+Math.floor((end-offset)/2);
      if (end < payload.length && /[\uD800-\uDBFF]/.test(payload[end - 1])) end--;
      nativeTransferStatistics.chunks++;
      await nativeCall("upload.chunk", { id, text: payload.slice(offset, end) }); offset = end;
    }
    signal?.throwIfAborted();
    return nativeCall("upload.commit", { id });
    } catch (error) { await nativeCall("upload.abort", { id }).catch(() => {}); throw error; }
  });
  transfers = run; return run;
}
