import * as pc from "playcanvas";
import type { MaterialAsset } from "../domain/types";
import { getStoredMaterialMap } from "../persistence/materialAssets";

interface LoadedMaterialMaps { albedo?: pc.Texture; normal?: pc.Texture; roughness?: pc.Texture; metallic?: pc.Texture; ambientOcclusion?: pc.Texture }
const cache = new WeakMap<pc.Application, Map<string, Promise<LoadedMaterialMaps>>>();

const triplanarFrontEnd = {
  diffusePS: `
uniform vec3 material_diffuse;
uniform sampler2D texture_dndromAlbedo;
uniform sampler2D texture_dndromNormal;
uniform sampler2D texture_dndromRoughness;
uniform sampler2D texture_dndromMetallic;
uniform sampler2D texture_dndromAo;
uniform float dndrom_materialScale;
uniform float dndrom_materialRotation;
uniform float dndrom_normalStrength;
uniform float dndrom_roughness;
uniform float dndrom_metallic;
vec2 dndromRotateUv(vec2 uv) {
  float c = cos(dndrom_materialRotation), s = sin(dndrom_materialRotation);
  return mat2(c, -s, s, c) * uv * dndrom_materialScale;
}
vec3 dndromWeights() {
  vec3 weights = pow(abs(normalize(dVertexNormalW)), vec3(8.0));
  return weights / max(weights.x + weights.y + weights.z, 0.0001);
}
vec4 dndromSample(sampler2D map) {
  vec3 weights = dndromWeights();
  vec4 x = texture2DBias(map, dndromRotateUv(vPositionW.zy), textureBias);
  vec4 y = texture2DBias(map, dndromRotateUv(vPositionW.xz), textureBias);
  vec4 z = texture2DBias(map, dndromRotateUv(vPositionW.xy), textureBias);
  return x * weights.x + y * weights.y + z * weights.z;
}
void getAlbedo() { dAlbedo = material_diffuse.rgb * dndromSample(texture_dndromAlbedo).rgb; }
`,
  normalMapPS: `
void getNormal() {
  vec3 weights = dndromWeights();
  vec3 tx = texture2DBias(texture_dndromNormal, dndromRotateUv(vPositionW.zy), textureBias).xyz * 2.0 - 1.0;
  vec3 ty = texture2DBias(texture_dndromNormal, dndromRotateUv(vPositionW.xz), textureBias).xyz * 2.0 - 1.0;
  vec3 tz = texture2DBias(texture_dndromNormal, dndromRotateUv(vPositionW.xy), textureBias).xyz * 2.0 - 1.0;
  vec3 mapped = vec3(tx.z, tx.y, tx.x) * weights.x + vec3(ty.x, ty.z, ty.y) * weights.y + tz * weights.z;
  dNormalW = normalize(mix(dVertexNormalW, mapped, dndrom_normalStrength));
}
`,
  glossPS: `void getGlossiness() { dGlossiness = clamp(1.0 - dndromSample(texture_dndromRoughness).r * dndrom_roughness, 0.0000001, 1.0); }`,
  metalnessPS: `void getMetalness() { dMetalness = clamp(dndromSample(texture_dndromMetallic).r * dndrom_metallic, 0.0, 1.0); }`,
  aoPS: `void getAO() { dAo = dndromSample(texture_dndromAo).r; }`,
};

const loadTexture = async (device: pc.GraphicsDevice, blob: Blob, name: string, srgb: boolean): Promise<pc.Texture> => {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.decoding = "async"; image.src = url; await image.decode();
    const texture = new pc.Texture(device, { name, width: image.naturalWidth, height: image.naturalHeight, format: srgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR });
    texture.addressU = pc.ADDRESS_REPEAT; texture.addressV = pc.ADDRESS_REPEAT; texture.anisotropy = 8;
    (texture as pc.Texture & { setSource(source: ImageBitmap): void }).setSource(await createImageBitmap(image)); return texture;
  } finally { URL.revokeObjectURL(url); }
};

export function loadMaterialAssetMaps(app: pc.Application, asset: MaterialAsset): Promise<LoadedMaterialMaps> {
  let appCache = cache.get(app); if (!appCache) { appCache = new Map(); cache.set(app, appCache); }
  const key = `${asset.id}:${asset.updatedAt}`, existing = appCache.get(key); if (existing) return existing;
  const promise = (async () => { const result: LoadedMaterialMaps = {}; for (const [slot, storageKey] of Object.entries(asset.maps) as [keyof LoadedMaterialMaps, string][]) { const blob = await getStoredMaterialMap(storageKey); if (blob) result[slot] = await loadTexture(app.graphicsDevice, blob, `${asset.name} ${slot}`, slot === "albedo"); } return result; })();
  appCache.set(key, promise); return promise;
}

export async function applyMaterialAsset(app: pc.Application, root: pc.Entity, asset: MaterialAsset): Promise<boolean> {
  const maps = await loadMaterialAssetMaps(app, asset);
  if (!root.parent) return false;
  if (!maps.albedo) { root.tags.add("missing-material-binary"); return false; }
  const radians = asset.rotation * Math.PI / 180, tiling = Math.max(.01, asset.scale);
  for (const component of root.findComponents("render") as pc.RenderComponent[]) for (const mesh of component.meshInstances) {
    const material = mesh.material instanceof pc.StandardMaterial ? mesh.material.clone() : new pc.StandardMaterial();
    material.name = `${asset.name} · ${asset.projection}`;
    material.diffuse.set(1, 1, 1); material.diffuseVertexColor = false;
    material.heightMap = null; material.heightMapFactor = 0;
    material.diffuseMap = maps.albedo; material.normalMap = maps.normal ?? null; material.glossMap = maps.roughness ?? null; material.metalnessMap = maps.metallic ?? null; material.aoMap = maps.ambientOcclusion ?? null;
    material.useMetalness = true; material.metalness = asset.metallic;
    material.gloss = maps.roughness ? asset.roughness : 1 - asset.roughness; material.glossInvert = Boolean(maps.roughness); material.bumpiness = asset.normalStrength;
    material.glossMapChannel = "r"; material.metalnessMapChannel = "r"; material.aoMapChannel = "r";
    // Keep procedural wind/vertex motion, but let the newly authored surface
    // own its albedo and PBR response on terrain as well as buildings.
    for (const language of [pc.SHADERLANGUAGE_GLSL, pc.SHADERLANGUAGE_WGSL]) {
      const chunks = material.getShaderChunks(language);
      for (const name of ["diffusePS", "normalMapPS", "glossPS", "metalnessPS", "aoPS"]) chunks.delete(name);
    }
    material.diffuseMapTiling.set(tiling, tiling); material.diffuseMapOffset.set((1 - Math.cos(radians)) * .5, Math.sin(radians) * .5);
    material.normalMapTiling.copy(material.diffuseMapTiling); material.glossMapTiling.copy(material.diffuseMapTiling); material.metalnessMapTiling.copy(material.diffuseMapTiling); material.aoMapTiling.copy(material.diffuseMapTiling);
    if (asset.projection === "triplanar" && maps.normal && maps.roughness && maps.metallic && maps.ambientOcclusion) {
      const chunks = material.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
      for (const [name, source] of Object.entries(triplanarFrontEnd)) chunks.set(name, source);
      material.shaderChunksVersion = "2.21";
      material.setParameter("texture_dndromAlbedo", maps.albedo);
      material.setParameter("texture_dndromNormal", maps.normal);
      material.setParameter("texture_dndromRoughness", maps.roughness);
      material.setParameter("texture_dndromMetallic", maps.metallic);
      material.setParameter("texture_dndromAo", maps.ambientOcclusion);
      material.setParameter("dndrom_materialScale", tiling);
      material.setParameter("dndrom_materialRotation", radians);
      material.setParameter("dndrom_normalStrength", asset.normalStrength);
      material.setParameter("dndrom_roughness", asset.roughness);
      material.setParameter("dndrom_metallic", asset.metallic);
    }
    material.update(); mesh.material = material;
    root.once("destroy", () => material.destroy());
  }
  root.tags.add(`material-projection:${asset.projection}`); return true;
}
