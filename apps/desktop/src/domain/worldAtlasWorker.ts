import {buildAtlasMesh,createAtlasSampler,type AtlasContext,type AtlasTile} from "./worldAtlas";
let context:AtlasContext, sample:ReturnType<typeof createAtlasSampler>;
self.onmessage=(event:MessageEvent<{context?:AtlasContext;tile?:AtlasTile}>)=>{
  if(event.data.context){context=event.data.context;sample=createAtlasSampler(context);return;}
  if(!event.data.tile || !context)return;
  const mesh=buildAtlasMesh(event.data.tile,context,sample);
  self.postMessage(mesh,{transfer:[mesh.positions.buffer,mesh.parentHeights.buffer,mesh.vegetation.buffer,mesh.grass.buffer,mesh.normals.buffer,mesh.colors.buffer,mesh.indices.buffer]});
};
