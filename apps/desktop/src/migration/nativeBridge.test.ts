import {afterEach,describe,expect,it,vi} from "vitest";
afterEach(()=>vi.unstubAllGlobals());
describe("bounded native mesh transfers",()=>{
  it("uses one bounded call for later small tiles after host negotiation",async()=>{
    vi.resetModules();const methods:string[]=[];
    vi.stubGlobal("window",{addEventListener:()=>{},ue:{dndrom:{dispatch:async(json:string)=>{
      const request=JSON.parse(json);methods.push(request.method);expect(json.length).toBeLessThan(512*1024);
      return JSON.stringify(request.method==="upload.begin"?{id:"transfer",inline:true}:{});
    }}}});
    const {nativeUpload}=await import("./nativeBridge");
    await nativeUpload('{"first":1}',"tile");methods.length=0;
    await nativeUpload('{"next":2}',"tile");expect(methods).toEqual(["upload.inline"]);
  });
  it("negotiates gzip and recovers the exact UTF-8 scene",async()=>{
    vi.resetModules();const chunks:string[]=[];let bytes=0;
    vi.stubGlobal("window",{addEventListener:()=>{},ue:{dndrom:{dispatch:async(json:string)=>{
      const request=JSON.parse(json);expect(json.length).toBeLessThan(512*1024);
      if(request.method==="upload.begin"){bytes=request.params.uncompressedBytes;expect(request.params.acceptEncoding).toBe("gzip-base64");return JSON.stringify({id:"compressed",encoding:"gzip-base64"});}
      if(request.method==="upload.chunk")chunks.push(request.params.text);
      return "{}";
    }}}});
    const {nativeUpload}=await import("./nativeBridge"),text=JSON.stringify({name:"森林 🌲",positions:Array(50000).fill(123.456)});
    await nativeUpload(text,"tile");
    const {gunzipSync}=await import("node:zlib");const raw=gunzipSync(Buffer.from(chunks.join(""),"base64"));
    expect(raw.length).toBe(bytes);expect(raw.toString("utf8")).toBe(text);expect(chunks.join("").length).toBeLessThan(text.length/5);
  });
  it("uses larger numeric chunks without exceeding the native request limit",async()=>{
    vi.resetModules();const chunks:string[]=[];
    vi.stubGlobal("window",{addEventListener:()=>{},ue:{dndrom:{dispatch:async(json:string)=>{
      expect(json.length).toBeLessThan(512*1024);const request=JSON.parse(json);
      if(request.method==="upload.chunk")chunks.push(request.params.text);
      return JSON.stringify(request.method==="upload.begin"?{id:"transfer"}:{});
    }}}});
    const {nativeUpload}=await import("./nativeBridge"),text="123.456,".repeat(150000);
    await nativeUpload(text,"tile","0/0/0");expect(chunks.join("")).toBe(text);expect(chunks.length).toBeLessThan(5);
  });
  it("accounts for JSON escaping and preserves surrogate pairs",async()=>{
    vi.resetModules();const chunks:string[]=[];
    vi.stubGlobal("window",{addEventListener:()=>{},ue:{dndrom:{dispatch:async(json:string)=>{
      expect(json.length).toBeLessThan(512*1024);const request=JSON.parse(json);
      if(request.method==="upload.chunk"){const chunk=request.params.text;expect(/[\uD800-\uDBFF]$/.test(chunk)).toBe(false);chunks.push(chunk);}
      return JSON.stringify(request.method==="upload.begin"?{id:"transfer"}:{});
    }}}});
    const {nativeUpload}=await import("./nativeBridge"),text=('"\u0001\n🌲').repeat(180000);
    await nativeUpload(text,"download");expect(chunks.join("")).toBe(text);
  });
});
