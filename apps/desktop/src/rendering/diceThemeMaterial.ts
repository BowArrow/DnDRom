import * as pc from "playcanvas";
import type { DiceTheme } from "../domain/types";
import { resolveDiceEffects } from "../domain/diceEffects";
import { getStoredDiceTexture } from "../persistence/diceThemes";
import type { DiceTextureFiles } from "../persistence/diceThemes";
import { createResinDiceMaterial } from "./tabletopShaders";

export interface DiceThemePbrTextures {
  albedo?: pc.Texture;
  normal?: pc.Texture;
  roughness?: pc.Texture;
  metallic?: pc.Texture;
  ambientOcclusion?: pc.Texture;
  emissive?: pc.Texture;
}

const cache = new WeakMap<pc.Application, Map<string, Promise<DiceThemePbrTextures>>>();

const loadBlobTexture = async (device: pc.GraphicsDevice, blob: Blob, name: string, srgb: boolean): Promise<pc.Texture> => {
  const url = URL.createObjectURL(blob);
  try {
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
    texture.setSource(image);
    return texture;
  } finally {
    URL.revokeObjectURL(url);
  }
};

export function loadDiceThemePbrTextures(app: pc.Application, theme: DiceTheme): Promise<DiceThemePbrTextures> {
  let appCache = cache.get(app);
  if (!appCache) { appCache = new Map(); cache.set(app, appCache); }
  const key = `${theme.id}:${theme.updatedAt}`;
  const existing = appCache.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const textures: DiceThemePbrTextures = {};
    for (const [slot, storageKey] of Object.entries(theme.maps) as [keyof DiceThemePbrTextures, string][]) {
      const blob = await getStoredDiceTexture(storageKey);
      if (blob) textures[slot] = await loadBlobTexture(app.graphicsDevice, blob, `${theme.name} ${slot}`, slot === "albedo");
    }
    return textures;
  })();
  appCache.set(key, promise);
  return promise;
}

export async function loadDicePbrFilePreviews(app: pc.Application, files: DiceTextureFiles): Promise<DiceThemePbrTextures> {
  const textures: DiceThemePbrTextures = {};
  for (const [slot, file] of Object.entries(files) as [keyof DiceThemePbrTextures, File][]) {
    textures[slot] = await loadBlobTexture(app.graphicsDevice, file, `Unsaved dice ${slot}`, slot === "albedo");
  }
  return textures;
}

const color = (value: string): [number, number, number] => {
  const normalized = value.replace("#", "").padEnd(6, "0").slice(0, 6);
  return [Number.parseInt(normalized.slice(0, 2), 16) / 255, Number.parseInt(normalized.slice(2, 4), 16) / 255, Number.parseInt(normalized.slice(4, 6), 16) / 255];
};

const energyMaskCache = new WeakMap<pc.GraphicsDevice, Map<string, pc.Texture>>();

const proceduralEnergyMask = (device: pc.GraphicsDevice, style: ReturnType<typeof resolveDiceEffects>["surface"]["style"]): pc.Texture => {
  let deviceCache = energyMaskCache.get(device);
  if (!deviceCache) { deviceCache = new Map(); energyMaskCache.set(device, deviceCache); }
  const cached = deviceCache.get(style);
  if (cached) return cached;
  const width = 256;
  const height = 128;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(width, height);
  const noise = (x: number, y: number) => {
    const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return value - Math.floor(value);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width;
    const v = y / height;
    const warp = Math.sin(v * 21 + Math.sin(u * 11) * 2.2) * .08 + Math.sin(u * 37 + v * 9) * .035;
    let strength = 0;
    if (style === "arcane-veins") strength = Math.pow(Math.max(0, 1 - Math.abs(Math.sin((u * 4.2 + v * 2.7 + warp) * Math.PI)) * 10), 1.35);
    else if (style === "lightning-cracks") strength = Math.pow(Math.max(0, 1 - Math.abs(Math.sin((u * 2.1 + warp * 4 + v * .65) * Math.PI)) * 18), 1.15);
    else if (style === "lava") strength = Math.pow(Math.max(0, Math.sin((u * 5.5 + warp + v * 3.2) * Math.PI) * .5 + .5 - .58), .55) * 1.8;
    else if (style === "frost") strength = Math.pow(Math.max(0, 1 - Math.abs(Math.sin((Math.atan2(v - .5, u - .5) * 7 + Math.hypot(u - .5, v - .5) * 32))) * 10), 1.4);
    else strength = Math.max(0, Math.cos(Math.hypot(u - .5, v - .5) * 58 + Math.atan2(v - .5, u - .5) * 5) - .84) * 4.8;
    strength = Math.min(1, Math.max(0, strength * (.94 + noise(x, y) * .12)));
    const value = Math.round(strength * 255);
    image.data.set([value, value, value, 255], (y * width + x) * 4);
  }
  context.putImageData(image, 0, 0);
  const texture = new pc.Texture(device, { name: `${style} dice energy mask`, width, height, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR });
  texture.addressU = pc.ADDRESS_REPEAT;
  texture.addressV = pc.ADDRESS_REPEAT;
  texture.anisotropy = 4;
  texture.setSource(canvas);
  deviceCache.set(style, texture);
  return texture;
};

export function createThemedDiceMaterial(theme: DiceTheme, textures: DiceThemePbrTextures, device: pc.GraphicsDevice): pc.StandardMaterial {
  const material = createResinDiceMaterial(color(theme.baseColor), device);
  material.name = `${theme.name} custom dice PBR`;
  material.metalness = Math.min(1, Math.max(0, theme.metallic));
  material.gloss = 1 - Math.min(1, Math.max(0, theme.roughness));
  material.clearCoat = Math.min(1, Math.max(0, theme.clearCoat));
  material.clearCoatGloss = Math.min(1, Math.max(0, theme.clearCoatGloss));
  if (textures.albedo) {
    material.diffuseMap = textures.albedo;
    // An authored/generated albedo already owns its hue. Multiplying it by the
    // fallback body swatch caused pink textures to render teal.
    material.diffuse = new pc.Color(1, 1, 1);
  }
  if (textures.normal) {
    material.normalMap = textures.normal;
    material.bumpiness = Math.min(2, Math.max(0, theme.normalStrength));
    material.clearCoatNormalMap = textures.normal;
  }
  if (textures.roughness) {
    material.glossMap = textures.roughness;
    material.glossMapChannel = "r";
    material.glossInvert = true;
  }
  if (textures.metallic) {
    material.metalnessMap = textures.metallic;
    material.metalnessMapChannel = "r";
  }
  if (textures.ambientOcclusion) {
    material.aoMap = textures.ambientOcclusion;
    material.aoMapChannel = "r";
    material.occludeSpecular = pc.SPECOCC_AO;
  }
  const effects = resolveDiceEffects(theme.effects);
  if (effects.surface.enabled) {
    material.emissive = new pc.Color(...color(effects.surface.color));
    material.emissiveIntensity = effects.surface.intensity;
    material.emissiveMap = textures.emissive ?? proceduralEnergyMask(device, effects.surface.style);
    material.emissiveMapChannel = "r";
    material.emissiveMapTiling = new pc.Vec2(effects.surface.style === "runes" ? 1 : 1.35, effects.surface.style === "runes" ? 1 : 1.35);
  }
  material.update();
  return material;
}

/** Advances a saved theme's surface energy without recompiling its PBR shader. */
export function updateThemedDiceMaterial(material: pc.StandardMaterial, theme: DiceTheme, seconds: number, phase = 0): void {
  const surface = resolveDiceEffects(theme.effects).surface;
  if (!surface.enabled) return;
  const wave = .5 + .5 * Math.sin(seconds * surface.speed * Math.PI * 2 + phase);
  material.emissiveIntensity = surface.intensity * (1 - surface.pulse + wave * surface.pulse);
  const drift = Math.sin(seconds * surface.speed * .45 + phase) * .018;
  material.emissiveMapOffset = new pc.Vec2(drift, -drift * .7);
}
