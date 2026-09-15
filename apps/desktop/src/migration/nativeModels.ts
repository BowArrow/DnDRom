import { ASSET_BY_ID } from "../domain/assets";
import type { SceneViewportProps } from "../components/SceneViewport";
import { getStoredPropModel } from "../persistence/propAssets";
import { getStoredTokenModel } from "../persistence/tokenAssets";
import type { NativeModel, NativeGlbMaterial } from "./nativeGlb";
import { nativeUpload } from "./nativeBridge";
import { isScenicBaseSurface, sceneryHeightRatio } from "../rendering/scenicBaseGeometry";
const materialsSent = new Set<string>();
export async function loadNativeModels(props: SceneViewportProps): Promise<Record<string, NativeModel>> {
  const result: Record<string, NativeModel> = {};
  const tokenVariants = new Map<string, NativeModel>();
  for (const entity of props.map.entities.filter(e => !e.hidden)) {
    const id = entity.assetId;
    const prop = props.propAssets?.find(p => p.id === id), token = props.tokenAssets.find(t => t.id === id), builtin = ASSET_BY_ID.get(id);
    if (!token && result[id]) continue;
    if (prop) {
      const bytes = await getStoredPropModel(prop.storageKey); if (!bytes) throw new Error(`Missing local prop ${prop.name}`);
      result[id] = { bytes, yaw: Math.atan2(prop.forwardAnchor.x, -prop.forwardAnchor.z) * 180 / Math.PI, offset: { x: -prop.bottomAnchor.x, y: -prop.bounds.min.y, z: -prop.bottomAnchor.z } };
    } else if (token) {
      const state=token.states?.find(s=>s.id===entity.tokenStateId),form=state?.formId??entity.tokenStateId,character=props.tokenCharacterLinks?.[token.id]??token.characterId;
      const baseId=props.sceneBasePlateAssignments?.[`entity:${entity.id}`]??(character?props.sceneBasePlateAssignments?.[`character:${character}`]:undefined)??props.sceneBasePlateAssignments?.[`token:${id}`]??(character?props.campaignBasePlateAssignments?.[`character:${character}`]:undefined)??props.campaignBasePlateAssignments?.[`token:${id}`]??(form?token.formBasePlateAssignments?.[form]:undefined)??token.defaultBasePlateAssetId;
      const base=props.basePlateAssets?.find(b=>b.id===baseId),layer=base?.recipe.layers.find(isScenicBaseSurface);
      const cacheKey=`${id}:${state?.id??'default'}:${base?.id??'plain'}:${base?.updatedAt??''}:${JSON.stringify(token.base)}:${token.footprint}:${state?.modelScale??token.modelScale}`;
      let model=tokenVariants.get(cacheKey);
      if(!model){
        const bytes = await getStoredTokenModel(state?.storageKey??token.storageKey); if (!bytes) throw new Error(`Missing local miniature ${token.name}`);
        model={tokenBase:{shape:base?.recipe.visualShape&&base.recipe.visualShape!=="inherit"?base.recipe.visualShape:token.base.shape,diameter:token.footprint*2,height:base?.recipe.plinthHeight??token.base.height,color:base?.recipe.plinthColor??token.base.color??"#303030",rimColor:base?.recipe.rimColor??token.base.accentColor??"#8e7437"},bytes,scale:state?.modelScale??token.modelScale,ground:(base?.recipe.plinthHeight??token.base.height)+.028,cacheKey,materialNamespace:`${id}:${state?.id??'default'}`};
        if(base&&layer){const prop=props.propAssets?.find(p=>p.id===layer.propAssetId),baseBytes=prop&&await getStoredPropModel(prop.storageKey);if(!baseBytes)throw new Error(`Missing scenic base mesh for ${token.name}`);model.scenicBase={bytes:baseBytes,id:layer.propAssetId!,diameter:token.footprint*2,heightRatio:sceneryHeightRatio(base.recipe),standingPoint:base.recipe.standingPoint};}
        tokenVariants.set(cacheKey,model);
      }
      result[entity.id]=model;
    } else if (builtin?.modelUrl) {
      const response = await fetch(builtin.modelUrl); if (!response.ok) throw new Error(`Bundled model ${builtin.name} could not be loaded`);
      result[id] = { bytes: await response.arrayBuffer() };
    }
  }
  return result;
}
export async function sendNativeModelMaterials(materials: NativeGlbMaterial[]) {
  for (const material of materials) {
    if (materialsSent.has(material.id)) continue;
    const maps: Record<string, string> = {};
    for (const [slot, image] of Object.entries(material.maps)) {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(image.bytes).buffer], { type: image.mime }));
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      if (image.channel !== undefined) { const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height); for (let i = 0; i < pixels.data.length; i += 4) { const value = pixels.data[i + image.channel]; pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value; pixels.data[i + 3] = 255; } ctx.putImageData(pixels, 0, 0); }
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
      let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); maps[slot] = btoa(binary);
    }
    await nativeUpload(JSON.stringify({ id: material.id, maps, roughness: material.roughness, metallic: material.metallic, masked: material.masked }), "material", material.id);
    materialsSent.add(material.id);
  }
}
