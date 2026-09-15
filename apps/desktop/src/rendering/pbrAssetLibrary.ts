import * as pc from "playcanvas";
import type { ProceduralSurface } from "./tabletopShaders";

export type PbrMaterialRole =
  | "wood-floor" | "wood-furniture" | "wood-table" | "wood-chair"
  | "wood-barrel" | "wood-crate" | "wood-chest" | "wood-structural"
  | "stone-floor" | "stone-wall" | "stone-natural"
  | "metal" | "fabric" | "leather" | "bark"
  | "grass" | "earth" | "plaster" | "roof"
  | "foliage" | "flesh" | "paper" | "water" | "plain";

export interface ScannedPbrMaps {
  albedo: pc.Texture;
  normal: pc.Texture;
  arm: pc.Texture;
}

/** Preserve hue while preventing a scanned albedo from being darkened twice. */
export const normalizeScannedAlbedoTint = (color: pc.Color, minimumPeak = .82): pc.Color => {
  const peak = Math.max(color.r, color.g, color.b);
  if (peak <= .0001 || peak >= minimumPeak) return color.clone();
  return color.clone().mulScalar(minimumPeak / peak);
};

export type TabletopFinishProfile = "printed-board" | "painted-piece" | "painted-miniature";

export interface HobbyPaintSettings {
  washColor: pc.Color;
  washIntensity: number;
  drybrushColor: pc.Color;
  drybrushIntensity: number;
  varnishRoughness: number;
  varnishStrength: number;
}

const hobbyPaintSettings = (material: pc.StandardMaterial): HobbyPaintSettings => ({
  washColor: new pc.Color(.12, .075, .045),
  washIntensity: .72,
  drybrushColor: new pc.Color(
    Math.min(1, material.diffuse.r * .58 + .42),
    Math.min(1, material.diffuse.g * .58 + .42),
    Math.min(1, material.diffuse.b * .58 + .42),
  ),
  drybrushIntensity: .2,
  varnishRoughness: .68,
  varnishStrength: .38,
});

/**
 * Applies the physical hobby-paint sequence to a standard PBR material. The
 * authored albedo remains the source color; AO only pools a translucent wash
 * in recesses, while the packed specialty red channel supplies convex edges.
 */
export const applyHobbyPaintFinish = (material: pc.StandardMaterial, specialtyMap: pc.Texture | null = null, overrides: Partial<HobbyPaintSettings> = {}): void => {
  const settings = { ...hobbyPaintSettings(material), ...overrides };
  const specialtySource = specialtyMap
    ? "texture2DBias(dndrom_specialtyMap, {STD_DIFFUSE_TEXTURE_UV}, textureBias).r"
    : "clamp(length(fwidth(albedoTexture)) * 1.35, 0.0, 1.0)";
  material.shaderChunksVersion = "2.8";
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("diffusePS", `
uniform vec3 material_diffuse;
uniform vec3 dndrom_washColor;
uniform float dndrom_washIntensity;
uniform vec3 dndrom_drybrushColor;
uniform float dndrom_drybrushIntensity;
${specialtyMap ? "uniform sampler2D dndrom_specialtyMap;" : ""}
#ifdef STD_DIFFUSEDETAIL_TEXTURE
  #include "detailModesPS"
#endif
void getAlbedo() {
  dAlbedo = material_diffuse.rgb;
  #ifdef STD_DIFFUSE_TEXTURE
    vec3 albedoTexture = {STD_DIFFUSE_TEXTURE_DECODE}(texture2DBias({STD_DIFFUSE_TEXTURE_NAME}, {STD_DIFFUSE_TEXTURE_UV}, textureBias)).{STD_DIFFUSE_TEXTURE_CHANNEL};
    #ifdef STD_DIFFUSEDETAIL_TEXTURE
      vec3 albedoDetail = {STD_DIFFUSEDETAIL_TEXTURE_DECODE}(texture2DBias({STD_DIFFUSEDETAIL_TEXTURE_NAME}, {STD_DIFFUSEDETAIL_TEXTURE_UV}, textureBias)).{STD_DIFFUSEDETAIL_TEXTURE_CHANNEL};
      albedoTexture = detailMode_{STD_DIFFUSEDETAIL_DETAILMODE}(albedoTexture, albedoDetail);
    #endif
    dAlbedo *= albedoTexture;
    float hobbyAo = 1.0;
    #ifdef STD_AO_TEXTURE
      hobbyAo = texture2DBias({STD_AO_TEXTURE_NAME}, {STD_AO_TEXTURE_UV}, textureBias).{STD_AO_TEXTURE_CHANNEL};
    #endif
    float washMask = clamp((1.0 - hobbyAo) * dndrom_washIntensity, 0.0, 1.0);
    dAlbedo = mix(dAlbedo, dAlbedo * dndrom_washColor, washMask);
    float drybrushMask = clamp(${specialtySource} * dndrom_drybrushIntensity, 0.0, .35);
    dAlbedo = mix(dAlbedo, dndrom_drybrushColor, drybrushMask);
  #endif
  #ifdef STD_DIFFUSE_VERTEX
    dAlbedo *= saturate(vVertexColor.{STD_DIFFUSE_VERTEX_CHANNEL});
  #endif
}
`);
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("glossPS", `
#ifdef STD_GLOSS_CONSTANT
uniform float material_gloss;
#endif
uniform float dndrom_varnishRoughness;
uniform float dndrom_varnishStrength;
void getGlossiness() {
  dGlossiness = 1.0;
  #ifdef STD_GLOSS_CONSTANT
    dGlossiness *= material_gloss;
  #endif
  #ifdef STD_GLOSS_TEXTURE
    dGlossiness *= texture2DBias({STD_GLOSS_TEXTURE_NAME}, {STD_GLOSS_TEXTURE_UV}, textureBias).{STD_GLOSS_TEXTURE_CHANNEL};
  #endif
  #ifdef STD_GLOSS_VERTEX
    dGlossiness *= saturate(vVertexColor.{STD_GLOSS_VERTEX_CHANNEL});
  #endif
  #ifdef STD_GLOSS_INVERT
    dGlossiness = 1.0 - dGlossiness;
  #endif
  dGlossiness = mix(dGlossiness, 1.0 - dndrom_varnishRoughness, dndrom_varnishStrength) + 0.0000001;
}
`);
  material.setParameter("dndrom_washColor", [settings.washColor.r, settings.washColor.g, settings.washColor.b]);
  material.setParameter("dndrom_washIntensity", settings.washIntensity);
  material.setParameter("dndrom_drybrushColor", [settings.drybrushColor.r, settings.drybrushColor.g, settings.drybrushColor.b]);
  material.setParameter("dndrom_drybrushIntensity", settings.drybrushIntensity);
  material.setParameter("dndrom_varnishRoughness", settings.varnishRoughness);
  material.setParameter("dndrom_varnishStrength", settings.varnishStrength);
  if (specialtyMap) material.setParameter("dndrom_specialtyMap", specialtyMap);
  material.aoIntensity = Math.max(material.aoIntensity, 1.15);
  material.update();
};

/** A restrained camera-facing edge light for painted miniatures only. */
export const applyMiniatureRimFinish = (material: pc.StandardMaterial, color = new pc.Color(.72, .84, 1), strength = .22): void => {
  material.shaderChunksVersion = "2.8";
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("emissivePS", `
uniform vec3 material_emissive;
uniform float material_emissiveIntensity;
uniform vec3 dndrom_miniRimColor;
uniform float dndrom_miniRimStrength;
void getEmission() {
  dEmission = material_emissive * material_emissiveIntensity;
  #ifdef STD_EMISSIVE_TEXTURE
    dEmission *= {STD_EMISSIVE_TEXTURE_DECODE}(texture2DBias({STD_EMISSIVE_TEXTURE_NAME}, {STD_EMISSIVE_TEXTURE_UV}, textureBias)).{STD_EMISSIVE_TEXTURE_CHANNEL};
  #endif
  #ifdef STD_EMISSIVE_VERTEX
    dEmission *= saturate(vVertexColor.{STD_EMISSIVE_VERTEX_CHANNEL});
  #endif
  vec3 miniView = normalize(view_position - vPositionW);
  float miniRim = smoothstep(.6, 1.0, 1.0 - max(dot(normalize(dNormalW), miniView), 0.0));
  dEmission += dndrom_miniRimColor * miniRim * dndrom_miniRimStrength;
}
`);
  material.setParameter("dndrom_miniRimColor", [color.r, color.g, color.b]);
  material.setParameter("dndrom_miniRimStrength", strength);
  material.update();
};

/**
 * Pixal3D/TRELLIS exports can retain an unlit preview flag or an overly bright
 * constant emissive channel. Those settings look acceptable in the generator
 * viewer but prevent torches and authored scene lights from shaping the model
 * on the board. Keep real emissive maps, while making ordinary painted areas
 * participate in PlayCanvas clustered PBR lighting.
 */
export const applySceneReactiveMiniatureFinish = (material: pc.StandardMaterial): void => {
  material.useLighting = true;
  material.useSkybox = true;
  if (!material.emissiveMap) material.emissiveIntensity = Math.min(material.emissiveIntensity, .12);
  material.occludeSpecular = pc.SPECOCC_AO;
  material.occludeSpecularIntensity = Math.max(material.occludeSpecularIntensity, .65);
  material.update();
};

/** Material-scale behavior for props; these values complement, not replace, maps. */
export const applyPropPhysicalProfile = (material: pc.StandardMaterial, role: PbrMaterialRole): void => {
  if (role.startsWith("wood") || role === "bark") {
    material.enableGGXSpecular = true;
    material.anisotropyIntensity = Math.max(material.anisotropyIntensity, .28);
    material.anisotropyRotation = 90;
    material.bumpiness = Math.max(material.bumpiness, .62);
    material.metalness = Math.min(material.metalness, .025);
  } else if (role === "foliage" || role === "grass") {
    material.useSheen = true;
    material.sheen = material.diffuse.clone().mulScalar(.34);
    // Runtime supports sheenGloss; PlayCanvas 2.21's declaration omits it.
    (material as pc.StandardMaterial & { sheenGloss: number }).sheenGloss = .24;
    material.twoSidedLighting = true;
  } else if (role === "paper") {
    const volume = material as pc.StandardMaterial & { thickness: number; attenuation: pc.Color; attenuationDistance: number };
    material.cull = pc.CULLFACE_NONE;
    material.twoSidedLighting = true;
    material.useMetalness = true;
    material.metalness = 0;
    material.gloss = .18;
    material.refraction = .035;
    volume.thickness = .045;
    volume.attenuation = new pc.Color(1, .78, .48);
    volume.attenuationDistance = .42;
  }
  material.update();
};

/**
 * Adds the coherent satin/painted response of physical board-game components
 * without replacing any authored albedo, normal, ARM, or emissive maps.
 */
export const applyTabletopFinish = (material: pc.StandardMaterial, profile: TabletopFinishProfile): void => {
  const finish = profile === "printed-board"
    ? { coat: .12, coatGloss: .46, glossFloor: .24, specularity: .34 }
    : profile === "painted-miniature"
      ? { coat: .24, coatGloss: .58, glossFloor: .36, specularity: .48 }
      : { coat: .18, coatGloss: .52, glossFloor: .3, specularity: .4 };
  material.fresnelModel = pc.FRESNEL_SCHLICK;
  material.clearCoat = Math.max(material.clearCoat ?? 0, finish.coat);
  material.clearCoatGloss = Math.max(material.clearCoatGloss ?? 0, finish.coatGloss);
  material.gloss = Math.max(material.gloss ?? 0, finish.glossFloor);
  material.specularityFactor = Math.max(material.specularityFactor ?? 0, finish.specularity);
  material.update();
};

/**
 * Floors keep their authored roughness map, but never become glossier than a
 * matte physical board surface. This removes the wet-sheet highlight without
 * flattening albedo, normal, or AO detail.
 */
export const applyMatteFloorFinish = (material: pc.StandardMaterial, minimumRoughness = .86): void => {
  const maximumGloss = Math.max(.02, Math.min(.3, 1 - minimumRoughness));
  material.shaderChunksVersion = "2.8";
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("glossPS", `
#ifdef STD_GLOSS_CONSTANT
uniform float material_gloss;
#endif
uniform float dndrom_floorMaxGloss;
void getGlossiness() {
  dGlossiness = 1.0;
  #ifdef STD_GLOSS_CONSTANT
    dGlossiness *= material_gloss;
  #endif
  #ifdef STD_GLOSS_TEXTURE
    dGlossiness *= texture2DBias({STD_GLOSS_TEXTURE_NAME}, {STD_GLOSS_TEXTURE_UV}, textureBias).{STD_GLOSS_TEXTURE_CHANNEL};
  #endif
  #ifdef STD_GLOSS_VERTEX
    dGlossiness *= saturate(vVertexColor.{STD_GLOSS_VERTEX_CHANNEL});
  #endif
  #ifdef STD_GLOSS_INVERT
    dGlossiness = 1.0 - dGlossiness;
  #endif
  dGlossiness = min(dGlossiness, dndrom_floorMaxGloss) + 0.0000001;
}
`);
  material.setParameter("dndrom_floorMaxGloss", maximumGloss);
  material.update();
};

export const tabletopFinishForRole = (role: PbrMaterialRole): TabletopFinishProfile =>
  role.endsWith("floor") || role === "grass" || role === "earth" || role === "water" ? "printed-board" : "painted-piece";

interface ScannedPbrDefinition {
  id: string;
  repeat: [number, number];
  albedoFile?: string;
  normalStrength: number;
}

export const SCANNED_PBR_ASSETS: Partial<Record<PbrMaterialRole, ScannedPbrDefinition>> = {
  "wood-floor": { id: "plank_flooring_04", repeat: [1, 1], normalStrength: .72 },
  "wood-furniture": { id: "wood_table_001", repeat: [1.15, 1.15], normalStrength: .58 },
  "wood-table": { id: "wood_table_001", repeat: [.9, .9], normalStrength: .54 },
  "wood-chair": { id: "coated_pine", repeat: [1.25, 1.25], normalStrength: .48 },
  "wood-barrel": { id: "weathered_planks", repeat: [1.35, 1.65], normalStrength: .82 },
  "wood-crate": { id: "wooden_planks", repeat: [1.25, 1.25], normalStrength: .74 },
  "wood-chest": { id: "wooden_panels", repeat: [1.1, 1.1], normalStrength: .68 },
  "wood-structural": { id: "dark_wood", repeat: [1.35, 1.35], normalStrength: .62 },
  "stone-floor": { id: "monastery_stone_floor", repeat: [1, 1], normalStrength: .86 },
  "stone-wall": { id: "medieval_blocks_03", repeat: [1, 1], normalStrength: .9 },
  "stone-natural": { id: "rock_boulder_dry", repeat: [1.25, 1.25], normalStrength: 1 },
  metal: { id: "metal_plate", repeat: [1.4, 1.4], normalStrength: .5 },
  fabric: { id: "cotton_jersey", repeat: [2.2, 2.2], normalStrength: .62 },
  leather: { id: "brown_leather", repeat: [1.8, 1.8], albedoFile: "brown_leather_albedo_1k.jpg", normalStrength: .68 },
  bark: { id: "bark_brown_01", repeat: [1.1, 1.7], normalStrength: .92 },
  grass: { id: "sparse_grass", repeat: [1, 1], normalStrength: .88 },
  earth: { id: "brown_mud", repeat: [1, 1.4], normalStrength: .86 },
  plaster: { id: "plastered_wall", repeat: [1.1, 1.1], normalStrength: .72 },
  roof: { id: "roof_tiles", repeat: [1.2, 1.2], normalStrength: .9 },
};

export const proceduralSurfaceForRole = (role: PbrMaterialRole): ProceduralSurface => {
  if (role.startsWith("wood") || role === "bark") return "wood";
  if (role.startsWith("stone") || role === "earth" || role === "plaster" || role === "roof") return "stone";
  if (role === "metal") return "metal";
  if (role === "flesh") return "flesh";
  if (role === "foliage" || role === "grass") return "foliage";
  if (role === "paper") return "paper";
  return "fabric";
};

const cache = new WeakMap<pc.Application, Map<PbrMaterialRole, Promise<ScannedPbrMaps | null>>>();

const loadTexture = async (device: pc.GraphicsDevice, url: string, name: string, srgb: boolean): Promise<pc.Texture> => {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  const texture = new pc.Texture(device, {
    name,
    width: image.naturalWidth,
    height: image.naturalHeight,
    format: srgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
  });
  texture.addressU = pc.ADDRESS_REPEAT;
  texture.addressV = pc.ADDRESS_REPEAT;
  texture.anisotropy = 8;
  // WebGPU's PlayCanvas uploader accepts ImageBitmap/canvas, not HTMLImageElement.
  // Passing the decoded <img> silently leaves the GPU texture black.
  // PlayCanvas 2.21 supports ImageBitmap at runtime but omits it in this declaration.
  (texture as pc.Texture & { setSource(source: ImageBitmap): void }).setSource(await createImageBitmap(image));
  return texture;
};

export const loadScannedPbrMaps = (app: pc.Application, role: PbrMaterialRole): Promise<ScannedPbrMaps | null> => {
  const definition = SCANNED_PBR_ASSETS[role];
  if (!definition) return Promise.resolve(null);
  let appCache = cache.get(app);
  if (!appCache) {
    appCache = new Map();
    cache.set(app, appCache);
  }
  const existing = appCache.get(role);
  if (existing) return existing;
  const directory = `${import.meta.env.BASE_URL}materials/polyhaven/${definition.id}/`;
  const albedo = definition.albedoFile ?? `${definition.id}_diff_1k.jpg`;
  const promise = Promise.all([
    loadTexture(app.graphicsDevice, `${directory}${albedo}`, `${definition.id} albedo`, true),
    loadTexture(app.graphicsDevice, `${directory}${definition.id}_nor_gl_1k.jpg`, `${definition.id} OpenGL normal`, false),
    loadTexture(app.graphicsDevice, `${directory}${definition.id}_arm_1k.jpg`, `${definition.id} AO roughness metalness`, false),
  ]).then(([albedoMap, normal, arm]) => ({ albedo: albedoMap, normal, arm })).catch(() => null);
  appCache.set(role, promise);
  return promise;
};

export const applyScannedPbrMaps = (material: pc.StandardMaterial, role: PbrMaterialRole, maps: ScannedPbrMaps): void => {
  const definition = SCANNED_PBR_ASSETS[role];
  const repeat = definition?.repeat ?? [1, 1];
  const tiling = new pc.Vec2(repeat[0], repeat[1]);
  const original = material.diffuse;
  // Scanned albedo already carries physical luminance. Normalize only the
  // authored tint's peak so hue remains distinct without multiplying a dark
  // terrain/floor color by a second dark photograph.
  material.diffuse = normalizeScannedAlbedoTint(original);
  material.diffuseMap = maps.albedo;
  material.diffuseMapTiling = tiling;
  material.normalMap = maps.normal;
  material.normalMapTiling = tiling;
  material.bumpiness = definition?.normalStrength ?? .65;
  material.aoMap = maps.arm;
  material.aoMapChannel = "r";
  material.aoMapTiling = tiling;
  material.glossMap = maps.arm;
  material.glossMapChannel = "g";
  material.glossMapTiling = tiling;
  material.gloss = 1;
  material.glossInvert = true;
  material.metalnessMap = maps.arm;
  material.metalnessMapChannel = "b";
  material.metalnessMapTiling = tiling;
  material.heightMap = null;
  material.occludeSpecular = pc.SPECOCC_AO;
  material.occludeSpecularIntensity = .8;
  material.update();
};
