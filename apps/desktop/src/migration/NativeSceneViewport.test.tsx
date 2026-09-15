// @vitest-environment jsdom
import{beforeEach,afterEach,it,expect,vi}from'vitest';import{render,waitFor,cleanup,fireEvent}from'@testing-library/react';import{NativeSceneViewport}from'./NativeSceneViewport';import type{SceneViewportProps}from'../components/SceneViewport';
const state=vi.hoisted(()=>({id:'',ready:[]as string[],order:[]as string[],fail:false,calls:[] as Array<{method:string;params:any}>,pick:{hit:true,position:{x:2,y:4,z:6}},stream:vi.fn(()=>vi.fn())}));
vi.mock('./nativeWorld',()=>({streamNativeWorld:state.stream}));
vi.mock('./nativeNavigation',()=>({bindNativeNavigation:()=>()=>{}}));
vi.mock('./nativeModels',()=>({loadNativeModels:async()=>({}),sendNativeModelMaterials:async()=>{}}));
vi.mock('./nativeMaterials',()=>({sendNativeMaterials:async()=>{}}));
vi.mock('./nativeBridge',()=>({nativeCall:async(method:string,params:any)=>{state.calls.push({method,params});return method==='app.diagnostics'?{streamId:state.id,importComplete:true,readyTiles:state.ready}:method==='scene.input'?state.pick:{};},nativeUpload:async(_text:string,kind:string,name:string)=>{state.order.push(kind);if(state.fail)throw new Error('Import rejected');if(kind==='tile')state.ready.push(name);return {};}}));
const props={map:{id:'world/harbor',width:256,depth:256,theme:'coast',world:{},entities:[{id:'terrain',worldGeometry:{kind:'terrain'}}]},tokenAssets:[],onSelect:vi.fn(),onPlace:vi.fn()} as unknown as SceneViewportProps;
beforeEach(()=>{state.id='';state.ready=[];state.calls=[];state.order=[];state.fail=false;state.stream.mockClear();vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.stubGlobal('Worker',class{onmessage?: (e:unknown)=>void;postMessage(p:{streamId:string}){state.id=p.streamId;queueMicrotask(()=>this.onmessage?.({data:{batches:['terrain','detail'],playablePart:1}}));}terminate(){}});});afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('starts distant streaming only after native local imports acknowledge completion',async()=>{render(<NativeSceneViewport {...props}/>);await waitFor(()=>expect(state.stream).toHaveBeenCalledOnce());expect(state.order).toEqual(['scene','tile']);expect(state.ready).toHaveLength(1);});
it('never exposes a distant-only world when the local import fails',async()=>{const view=render(<NativeSceneViewport {...props}/>);state.fail=true;await waitFor(()=>expect(view.getByText('Import rejected')).toBeTruthy());expect(state.stream).not.toHaveBeenCalled();});
it('invalidates the previous scene readiness while a replacement is being built',async()=>{
 const imported=()=> (window as unknown as {dndromSceneImport:{mapId:string;streamId:string;cacheReady:boolean}}).dndromSceneImport;
 const view=render(<NativeSceneViewport {...props}/>);await waitFor(()=>expect(imported().cacheReady).toBe(true));const previous=imported().streamId;
 view.rerender(<NativeSceneViewport {...props} map={{...props.map,id:'world/revised-town'}}/>);
 expect(imported().cacheReady).toBe(false);expect(imported().streamId).not.toBe(previous);
 await waitFor(()=>expect(imported().cacheReady).toBe(true));expect(imported().mapId).toBe('world/revised-town');expect(imported().streamId).toBe(state.id);
});

it('preserves reveal identity and distant streaming when a token changes',async()=>{
 const view=render(<NativeSceneViewport {...props}/>);await waitFor(()=>expect(state.stream).toHaveBeenCalledOnce());
 const identity=state.calls.find(c=>c.method==='world.reveal')!.params.identity;
 view.rerender(<NativeSceneViewport {...props} map={{...props.map,entities:[...props.map.entities,{id:'new-token',assetId:'token'} as any]}}/>);
 await waitFor(()=>expect(state.ready).toContain('edit:new-token'));
 expect(state.order.filter(v=>v==='scene')).toHaveLength(1);
 expect(state.stream).toHaveBeenCalledOnce();
 expect(state.calls.filter(c=>c.method==='world.reveal'&&c.params.identity).every(c=>c.params.identity===identity)).toBe(true);
});
it('places the active token on the returned terrain surface',async()=>{
 const place=vi.fn(),view=render(<NativeSceneViewport {...props} activeAssetId="token" onPlace={place}/>);
 fireEvent.click(view.getByLabelText('3D scene viewport'),{clientX:300,clientY:200});
 await waitFor(()=>expect(place).toHaveBeenCalledWith({position:{x:2,y:4,z:6},rotationY:0,snapped:false,valid:true}));
});

it('moves and removes an object without re-uploading geometry or resetting reveal',async()=>{
 const entity={id:'token',assetId:'token',position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}} as any;
 const map={...props.map,entities:[...props.map.entities,entity]},view=render(<NativeSceneViewport {...props} map={map}/>);
 await waitFor(()=>expect(state.stream).toHaveBeenCalledOnce());const uploads=state.order.length;
 view.rerender(<NativeSceneViewport {...props} map={{...map,entities:[map.entities[0],{...entity,position:{x:3,y:0,z:2}}]}}/>);
 await waitFor(()=>expect(state.calls.some(c=>c.params?.kind==='entities'&&c.params.transforms[0]?.after.position.x===3)).toBe(true));
 view.rerender(<NativeSceneViewport {...props}/>);
 await waitFor(()=>expect(state.calls.some(c=>c.params?.remove?.includes('token'))).toBe(true));
 expect(state.order).toHaveLength(uploads);expect(state.calls.filter(c=>c.method==='world.reveal')).toHaveLength(1);
});
