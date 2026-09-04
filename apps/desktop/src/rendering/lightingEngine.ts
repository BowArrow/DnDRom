import * as pc from "playcanvas";
import { ASSET_BY_ID } from "../domain/assets";
import { getDisplaySettings, type DisplaySettings } from "../domain/displaySettings";
import { hemisphereAmbientCoefficients, LIGHTING_QUALITY_BUDGETS, prioritizeVisibleLights, resolveSceneLighting, tabletopLightingProfile } from "../domain/lighting";
import { resolvePracticalLight } from "../domain/practicalLights";
import type { GameMap, LightingQuality, SceneLightingSettings } from "../domain/types";
import { bakeLightProbeGrid, sampleLightProbe, type LightProbeGrid, type ProbeBounceSource } from "./lightProbeGrid";

export interface LightingRig {
  destroyed: boolean;
  app: pc.Application;
  camera: pc.Entity;
  key: pc.Entity;
  fill: pc.Entity;
  rim: pc.Entity;
  hemisphereAmbient: Float32Array;
  probeGrid: LightProbeGrid | null;
  dynamicLights: pc.Entity[];
  dynamicLightBaseIntensity: number[];
  dynamicLightFlicker: { amount: number; speed: number }[];
  dynamicLightSelectionOrigin: pc.Vec3 | null;
  cameraFrame: pc.CameraFrame | null;
  lut: pc.Texture | null;
  lutMood: string | null;
  environment: { source?: pc.Texture; skybox?: pc.Texture; lightingSource?: pc.Texture; atlas?: pc.Texture; asset?: pc.Asset; objectUrl?: string };
}

export interface DepthOfFieldTarget {
  position: { x: number; y: number; z: number };
  radius?: number;
}

export interface DepthOfFieldFocus {
  distance: number;
  range: number;
  count: number;
}

/** Keeps gameplay subjects inside one depth band instead of focusing on world origin. */
export const resolveDepthOfFieldFocus = (
  cameraPosition: { x: number; y: number; z: number },
  cameraForward: { x: number; y: number; z: number },
  targets: DepthOfFieldTarget[],
  broadScene = false,
): DepthOfFieldFocus => {
  const depths = targets.map((target) => {
    const x = target.position.x - cameraPosition.x;
    const y = target.position.y - cameraPosition.y;
    const z = target.position.z - cameraPosition.z;
    const depth = x * cameraForward.x + y * cameraForward.y + z * cameraForward.z;
    return { near: depth - (target.radius ?? .8), far: depth + (target.radius ?? .8) };
  }).filter((entry) => entry.far > .1);
  if (!depths.length) {
    const fallback = Math.max(2, Math.hypot(cameraPosition.x, cameraPosition.y, cameraPosition.z));
    return { distance: fallback, range: broadScene ? 18 : 7, count: 0 };
  }
  const near = Math.max(.1, Math.min(...depths.map((entry) => entry.near)));
  const far = Math.max(near + .1, Math.max(...depths.map((entry) => entry.far)));
  const padding = broadScene ? 5 : 2.6;
  return {
    distance: (near + far) * .5,
    range: Math.max(broadScene ? 14 : 6, far - near + padding * 2),
    count: depths.length,
  };
};

const effectiveLightingSettings = (map: GameMap, display = getDisplaySettings()): SceneLightingSettings => {
  const scene = resolveSceneLighting(map.lighting);
  return {
    ...scene,
    quality: display.quality === "scene" ? scene.quality : display.quality,
    ssao: display.ambientOcclusion,
    bloom: display.bloom,
    depthOfField: display.depthOfField,
    fogMist: display.atmosphere,
  };
};

const CLUSTERED_LIGHTING_CELLS = {
  performance: [8, 3, 8],
  balanced: [12, 4, 12],
  cinematic: [16, 6, 16],
  diorama: [20, 8, 20],
} satisfies Record<LightingQuality, [number, number, number]>;

const clusteredLightingCells = (quality: LightingQuality): [number, number, number] => CLUSTERED_LIGHTING_CELLS[quality];

const configureClusteredLighting = (rig: LightingRig, quality: LightingQuality): [number, number, number] => {
  const cells = clusteredLightingCells(quality);
  const budget = LIGHTING_QUALITY_BUDGETS[quality];
  rig.app.scene.clusteredLightingEnabled = true;
  rig.app.scene.lighting.cells = new pc.Vec3(cells[0], cells[1], cells[2]);
  rig.app.scene.lighting.maxLightsPerCell = budget.maxLightsPerCell;
  // Practical lights are deliberately unshadowed. One high-quality directional
  // caster plus contact/ambient occlusion grounds the scene without multiplying
  // shadow-map passes as authors add lights.
  rig.app.scene.lighting.shadowsEnabled = false;
  rig.app.scene.lighting.cookiesEnabled = false;
  rig.app.scene.lighting.areaLightsEnabled = false;
  return cells;
};

const makeGradientEnvironment = (app: pc.Application, map: GameMap): pc.Texture => {
  const settings = resolveSceneLighting(map.lighting);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const palettes = {
    natural: ["#263849", "#6d7b81", "#11171c"],
    warm: ["#4a2418", "#93603d", "#160d09"],
    moonlight: ["#0b1432", "#405681", "#050813"],
    crypt: ["#0b211e", "#385a49", "#050d0c"],
    desert: ["#63321f", "#a96f42", "#26150f"],
  } as const;
  const palette = palettes[settings.mood];
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, palette[0]);
  gradient.addColorStop(.48, palette[1]);
  gradient.addColorStop(1, palette[2]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const glow = context.createRadialGradient(190, 48, 2, 190, 48, 42);
  glow.addColorStop(0, "rgba(255,236,188,.62)");
  glow.addColorStop(1, "rgba(255,236,188,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new pc.Texture(app.graphicsDevice, {
    name: `DnDRom ${settings.mood} procedural IBL`,
    width: canvas.width,
    height: canvas.height,
    format: pc.PIXELFORMAT_SRGBA8,
    projection: pc.TEXTUREPROJECTION_EQUIRECT,
    mipmaps: true,
  });
  texture.setSource(canvas);
  return texture;
};

const createMoodLut = (app: pc.Application, map: GameMap): pc.Texture => {
  const mood = resolveSceneLighting(map.lighting).mood;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 16;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(canvas.width, canvas.height);
  const transforms = {
    natural: { lift: [1, 1, 1], contrast: 1.02 },
    warm: { lift: [1.08, .97, .83], contrast: 1.07 },
    moonlight: { lift: [.78, .9, 1.13], contrast: 1.11 },
    crypt: { lift: [.75, 1.04, .82], contrast: 1.14 },
    desert: { lift: [1.12, .98, .74], contrast: 1.09 },
  } as const;
  const transform = transforms[mood];
  const encode = (value: number, channel: number) => pc.math.clamp(((value - .5) * transform.contrast + .5) * transform.lift[channel], 0, 1);
  for (let blue = 0; blue < 16; blue++) for (let green = 0; green < 16; green++) for (let red = 0; red < 16; red++) {
    const x = blue * 16 + red;
    // Canvas-backed textures use a top-left source origin while the LUT shader
    // samples increasing green along V. Keeping green in ascending row order
    // prevents the inverted-green identity transform seen once CameraFrame was
    // actually enabled.
    const y = green;
    const index = (y * canvas.width + x) * 4;
    image.data.set([
      Math.round(encode(red / 15, 0) * 255),
      Math.round(encode(green / 15, 1) * 255),
      Math.round(encode(blue / 15, 2) * 255),
      255,
    ], index);
  }
  context.putImageData(image, 0, 0);
  const texture = new pc.Texture(app.graphicsDevice, {
    name: `DnDRom ${mood} color LUT`,
    width: canvas.width,
    height: canvas.height,
    format: pc.PIXELFORMAT_SRGBA8,
    srgb: true,
    mipmaps: false,
    minFilter: pc.FILTER_LINEAR,
    magFilter: pc.FILTER_LINEAR,
  });
  texture.setSource(canvas);
  return texture;
};

const releaseEnvironment = (rig: LightingRig): void => {
  const environment = rig.environment;
  rig.app.scene.skybox = null;
  rig.app.scene.envAtlas = null;
  environment.asset?.unload();
  if (environment.asset) rig.app.assets.remove(environment.asset);
  if (environment.objectUrl) URL.revokeObjectURL(environment.objectUrl);
  environment.atlas?.destroy();
  environment.lightingSource?.destroy();
  environment.skybox?.destroy();
  environment.source?.destroy();
  rig.environment = {};
};

const installEnvironment = (rig: LightingRig, source: pc.Texture, map: GameMap, display = getDisplaySettings(), asset?: pc.Asset, objectUrl?: string): void => {
  const settings = effectiveLightingSettings(map, display);
  const budget = LIGHTING_QUALITY_BUDGETS[settings.quality];
  configureClusteredLighting(rig, settings.quality);
  const skybox = pc.EnvLighting.generateSkyboxCubemap(source, budget.iblSize);
  const lightingSource = pc.EnvLighting.generateLightingSource(source, { size: budget.iblSize });
  const atlas = pc.EnvLighting.generateAtlas(lightingSource, {
    size: Math.max(128, budget.iblSize * 2),
    numReflectionSamples: settings.quality === "diorama" ? 384 : settings.quality === "cinematic" ? 256 : 64,
    numAmbientSamples: settings.quality === "diorama" ? 768 : settings.quality === "cinematic" ? 512 : 128,
  });
  rig.environment = { source, skybox, lightingSource, atlas, asset, objectUrl };
  rig.app.scene.skybox = skybox;
  rig.app.scene.envAtlas = atlas;
  rig.app.scene.skyboxIntensity = settings.iblIntensity * (settings.quality === "diorama" ? 1.08 : 1);
  rig.app.scene.skyboxMip = 1;
};

export const createLightingRig = (app: pc.Application, camera: pc.Entity): LightingRig => {
  const key = new pc.Entity("Warm key light");
  key.addComponent("light", { type: "directional", castShadows: true });
  app.root.addChild(key);
  const fill = new pc.Entity("Cool fill light");
  fill.addComponent("light", { type: "directional", castShadows: false });
  app.root.addChild(fill);
  const rim = new pc.Entity("Camera rim light");
  rim.addComponent("light", { type: "directional", castShadows: false });
  app.root.addChild(rim);
  let cameraFrame: pc.CameraFrame | null = null;
  try {
    if (camera.camera) cameraFrame = new pc.CameraFrame(app, camera.camera);
  } catch {
    cameraFrame = null;
  }
  return { destroyed: false, app, camera, key, fill, rim, hemisphereAmbient: new Float32Array(27), probeGrid: null, dynamicLights: [], dynamicLightBaseIntensity: [], dynamicLightFlicker: [], dynamicLightSelectionOrigin: null, cameraFrame, lut: null, lutMood: null, environment: {} };
};

/** Keeps authored PBR/reflection maps while replacing flat diffuse ambient with a two-color hemisphere. */
export const applyLightweightAmbientToMaterial = (rig: LightingRig, material: pc.StandardMaterial): void => {
  if (rig.destroyed) return;
  // LitMaterial supports per-material SH at runtime; the generated
  // StandardMaterial declaration currently omits the inherited field.
  (material as pc.StandardMaterial & { ambientSH: Float32Array }).ambientSH = rig.hemisphereAmbient;
  material.update();
};

export const applyLightProbeToEntity = (rig: LightingRig, entity: pc.Entity): void => {
  if (rig.destroyed) return;
  for (const render of entity.findComponents("render") as pc.RenderComponent[]) {
    for (const meshInstance of render.meshInstances) {
      const material = meshInstance.material;
      if (!(material instanceof pc.StandardMaterial)) continue;
      applyLightweightAmbientToMaterial(rig, material);
      const position = meshInstance.node.getPosition();
      const coefficients = rig.probeGrid ? sampleLightProbe(rig.probeGrid, position.x, position.z) : rig.hemisphereAmbient;
      meshInstance.setParameter("ambientSH", coefficients);
    }
  }
};

const applyLightweightAmbientToScene = (rig: LightingRig): void => {
  applyLightProbeToEntity(rig, rig.app.root);
};

const colorTuple = (hex: string): [number, number, number] => {
  const value = Number.parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

const bakeSceneProbeGrid = (map: GameMap, base: Float32Array): LightProbeGrid => {
  const bounceTint: Record<GameMap["theme"], [number, number, number]> = {
    tavern: [.42, .19, .07], dungeon: [.12, .14, .18], cavern: [.14, .13, .12], ruins: [.21, .18, .14],
    forest: [.12, .24, .1], plains: [.2, .25, .12], village: [.34, .2, .1], town: [.3, .18, .1], city: [.22, .2, .18],
    coast: [.12, .22, .3], mountains: [.2, .2, .22], swamp: [.1, .19, .13],
  };
  const sources: ProbeBounceSource[] = [];
  for (const entity of map.entities) {
    const practical = resolvePracticalLight(entity);
    if (practical) {
      sources.push({
        x: practical.position.x,
        y: practical.position.y,
        z: practical.position.z,
        radius: practical.behavior.range,
        intensity: practical.behavior.intensity,
        color: colorTuple(practical.behavior.color),
      });
      continue;
    }
    const definition = ASSET_BY_ID.get(entity.assetId);
    const source = definition?.parts?.find((part) => part.emissive);
    if (!definition || !source?.emissive) continue;
    const yaw = entity.rotation.y * pc.math.DEG_TO_RAD;
    const offsetX = source.position.x * Math.cos(yaw) + source.position.z * Math.sin(yaw);
    const offsetZ = -source.position.x * Math.sin(yaw) + source.position.z * Math.cos(yaw);
    sources.push({
      x: entity.position.x + offsetX,
      y: entity.position.y + source.position.y,
      z: entity.position.z + offsetZ,
      radius: Math.max(3.5, definition.footprint * 7),
      intensity: entity.assetId === "torch" ? 1.35 : 1.08,
      color: colorTuple(source.emissive),
    });
  }
  return bakeLightProbeGrid({ width: map.width, depth: map.depth, base, bounceTint: bounceTint[map.theme], sources });
};

export const applyLightingRig = (rig: LightingRig, map: GameMap, display = getDisplaySettings()): void => {
  if (rig.destroyed) return;
  const settings = effectiveLightingSettings(map, display);
  const isDiorama = settings.quality === "diorama";
  const profile = tabletopLightingProfile(map.theme, map.width, map.depth, settings, Boolean(map.world));
  const budget = LIGHTING_QUALITY_BUDGETS[settings.quality];
  const clusterCells = configureClusteredLighting(rig, settings.quality);
  const maximumPixelRatio = settings.quality === "performance" ? 1 : settings.quality === "balanced" ? 1.5 : 2;
  // Resolution scale is applied to the canvas pixel ratio so Diorama can
  // genuinely supersample above native DPR. CameraFrame itself intentionally
  // caps its internal render-target scale at 1.
  rig.app.graphicsDevice.maxPixelRatio = Math.min((window.devicePixelRatio || 1) * display.resolutionScale, maximumPixelRatio);
  rig.hemisphereAmbient = hemisphereAmbientCoefficients(profile.skyAmbient, profile.groundAmbient);
  rig.probeGrid = bakeSceneProbeGrid(map, rig.hemisphereAmbient);
  // This remains a compatibility fallback for custom/unlit materials. Standard
  // PBR materials use the normal-dependent SH hemisphere installed below.
  rig.app.scene.ambientLight = new pc.Color(...profile.ambient);
  // Diorama deliberately increases directional separation instead of tinting
  // or replacing authored material maps. This remains visible even on WebViews
  // where an individual CameraFrame post effect is unavailable.
  const postExposure = settings.quality === "performance" ? 1.16 : settings.quality === "balanced" ? 1.24 : settings.quality === "cinematic" ? 1.34 : 1.42;
  const resolvedExposure = map.world ? 1.08 : postExposure;
  rig.app.scene.exposure = Math.max(settings.exposure * resolvedExposure, map.world ? 1.08 : 0);
  if (rig.camera.camera) rig.camera.camera.clearColor = new pc.Color(...profile.clearColor);
  rig.key.setEulerAngles(profile.sunElevation, profile.sunAzimuth, 0);
  if (rig.key.light) {
    const shadowQuality = display.shadowQuality === "auto"
      ? settings.quality === "diorama" ? "ultra" : settings.quality === "performance" ? "low" : "high"
      : display.shadowQuality;
    const shadowResolution = shadowQuality === "ultra" ? 4096 : shadowQuality === "high" ? 2048 : 1024;
    const highQualityShadows = shadowQuality === "high" || shadowQuality === "ultra";
    rig.key.light.color = new pc.Color(...profile.sunColor);
    rig.key.light.intensity = profile.sunIntensity * (isDiorama ? 1.12 : 1);
    rig.key.light.castShadows = shadowQuality !== "off";
    rig.key.light.shadowIntensity = profile.shadowIntensity;
    rig.key.light.shadowDistance = profile.shadowDistance;
    rig.key.light.shadowResolution = shadowResolution;
    rig.key.light.shadowType = highQualityShadows ? pc.SHADOW_PCF5 : pc.SHADOW_PCF3;
    rig.key.light.shadowBias = profile.shadowBias;
    rig.key.light.normalOffsetBias = profile.normalOffsetBias;
    // Fewer, higher-resolution cascades avoid cascade boundary crosses and the
    // repetitive self-shadow bands seen on broad walls and floors.
    rig.key.light.numCascades = highQualityShadows ? 3 : 2;
    rig.key.light.cascadeDistribution = .68;
    rig.key.light.cascadeBlend = .5;
  }
  rig.fill.setEulerAngles(35, -135, 0);
  if (rig.fill.light) {
    rig.fill.light.color = new pc.Color(...profile.fillColor);
    rig.fill.light.intensity = profile.fillIntensity * (isDiorama ? .9 : 1);
  }
  if (rig.rim.light) {
    rig.rim.light.color = new pc.Color(...profile.rimColor);
    rig.rim.light.intensity = profile.rimIntensity * (isDiorama ? 1.28 : 1);
    rig.rim.enabled = settings.rimIntensity > 0;
  }
  rig.rim.setEulerAngles(52, profile.sunAzimuth + 168, 0);
  rig.app.scene.skyboxIntensity = settings.iblIntensity * (isDiorama ? 1.08 : 1);
  applyLightweightAmbientToScene(rig);

  const frame = rig.cameraFrame;
  if (frame) {
    const antialiasing = display.antialiasing === "auto" ? (settings.quality === "performance" ? "msaa" : "taa") : display.antialiasing;
    // CameraFrame render targets support 1-4 samples. TAA should use a single
    // sample HDR target; asking for 8x here could fall back to RGBA8 and silently
    // disable HDR-only bloom.
    const sampleCount = antialiasing === "off" || antialiasing === "taa" ? 1 : settings.quality === "performance" ? 2 : 4;
    frame.rendering.renderTargetScale = pc.math.clamp(budget.renderScale, .5, 1);
    frame.rendering.toneMapping = pc.TONEMAP_ACES2;
    frame.rendering.samples = sampleCount;
    frame.rendering.sharpness = settings.quality === "performance" ? .2 : settings.quality === "diorama" ? .32 : settings.quality === "cinematic" ? .28 : .22;
    frame.taa.enabled = antialiasing === "taa";
    frame.taa.jitter = settings.quality === "diorama" ? .7 : settings.quality === "cinematic" ? .62 : .42;
    frame.ssao.type = settings.ssao && budget.ssaoSamples ? pc.SSAOTYPE_LIGHTING : pc.SSAOTYPE_NONE;
    frame.ssao.samples = Math.max(1, budget.ssaoSamples);
    frame.ssao.intensity = settings.quality === "diorama" ? .9 : settings.quality === "cinematic" ? .7 : .62;
    frame.ssao.radius = settings.quality === "diorama" ? 4.2 : settings.quality === "cinematic" ? 4.8 : 3.8;
    frame.ssao.power = settings.quality === "diorama" ? 3.65 : 3.2;
    frame.ssao.minAngle = 8;
    frame.ssao.scale = .5;
    frame.ssao.blurEnabled = true;
    frame.ssao.randomize = settings.quality !== "performance";
    frame.bloom.intensity = settings.bloom ? (settings.quality === "diorama" ? .035 : .028) : 0;
    frame.bloom.blurLevel = settings.quality === "diorama" ? 6 : settings.quality === "cinematic" ? 5 : 3;
    frame.grading.enabled = true;
    frame.grading.brightness = 1;
    frame.grading.contrast = profile.gradeContrast + (settings.quality === "diorama" ? .035 : 0);
    frame.grading.saturation = profile.gradeSaturation + (settings.quality === "diorama" ? .025 : 0);
    frame.grading.tint = new pc.Color(...profile.gradeTint);
    if (rig.lutMood !== settings.mood) {
      rig.lut?.destroy();
      rig.lut = createMoodLut(rig.app, map);
      rig.lutMood = settings.mood;
    }
    frame.colorLUT.texture = rig.lut;
    frame.colorLUT.intensity = settings.quality === "performance" ? .14 : settings.quality === "diorama" ? .32 : settings.quality === "cinematic" ? .28 : .22;
    frame.colorEnhance.enabled = true;
    frame.colorEnhance.shadows = settings.quality === "diorama" ? .16 : .12;
    frame.colorEnhance.highlights = settings.quality === "diorama" ? -.11 : -.08;
    frame.colorEnhance.vibrance = settings.quality === "diorama" ? .12 : .08;
    frame.colorEnhance.midtones = settings.quality === "diorama" ? .045 : .03;
    frame.colorEnhance.dehaze = settings.quality === "diorama" ? .065 : .04;
    frame.vignette.intensity = settings.quality === "diorama" ? .22 : .14;
    frame.vignette.inner = settings.quality === "diorama" ? .48 : .55;
    frame.vignette.outer = 1.2;
    frame.dof.enabled = settings.depthOfField && settings.quality !== "performance";
    frame.dof.nearBlur = settings.quality === "diorama";
    frame.dof.focusDistance = Math.max(2, rig.camera.getPosition().length());
    frame.dof.focusRange = settings.quality === "diorama"
      ? Math.max(1.35, Math.min(map.width, map.depth) * .13)
      : settings.quality === "cinematic"
        ? Math.max(3, Math.min(map.width, map.depth) * .28)
        : Math.max(4, Math.min(map.width, map.depth) * .42);
    // Diorama keeps a macro-camera falloff, but the focused gameplay band must
    // remain readable. A 4+ pixel kernel smeared even the active miniature.
    frame.dof.blurRadius = settings.quality === "diorama" ? 2.35 : settings.quality === "cinematic" ? 1.85 : 1.5;
    frame.dof.highQuality = settings.quality === "cinematic" || settings.quality === "diorama";
    frame.volumetricFog.enabled = settings.fogMist && (settings.quality === "cinematic" || settings.quality === "diorama");
    frame.volumetricFog.light = rig.key.light ?? null;
    frame.volumetricFog.tint = new pc.Color(...profile.fillColor);
    frame.volumetricFog.density = settings.quality === "diorama" ? .0045 : .0035;
    frame.volumetricFog.heightBase = .1;
    frame.volumetricFog.heightFalloff = .22;
    frame.volumetricFog.anisotropy = .58;
    frame.volumetricFog.intensity = settings.quality === "diorama" ? .55 : .45;
    frame.volumetricFog.ambientColor = new pc.Color(...profile.fillColor);
    frame.volumetricFog.ambientIntensity = .08;
    frame.volumetricFog.maxDistance = Math.max(map.width, map.depth) * 1.8;
    frame.volumetricFog.steps = settings.quality === "diorama" ? 24 : 16;
    frame.volumetricFog.scale = settings.quality === "diorama" ? .67 : .5;
    frame.updateOptions();
    frame.enabled = true;
    // CameraFrame is deliberately explicit: property changes are inert until
    // update() rebuilds and configures its render-pass graph.
    frame.update();
  }
  const canvas = rig.app.graphicsDevice.canvas as HTMLCanvasElement;
  const resolvedShadowQuality = display.shadowQuality === "auto" ? (settings.quality === "diorama" ? "ultra" : settings.quality === "performance" ? "low" : "high") : display.shadowQuality;
  const resolvedAntialiasing = display.antialiasing === "auto" ? (settings.quality === "performance" ? "msaa" : "taa") : display.antialiasing;
  canvas.dataset.lightingQuality = settings.quality;
  canvas.dataset.displayQuality = display.quality;
  canvas.dataset.shadowFiltering = resolvedShadowQuality === "high" || resolvedShadowQuality === "ultra" ? "pcf5" : resolvedShadowQuality === "off" ? "off" : "pcf3";
  canvas.dataset.shadowResolution = resolvedShadowQuality === "ultra" ? "4096" : resolvedShadowQuality === "high" ? "2048" : resolvedShadowQuality === "off" ? "0" : "1024";
  canvas.dataset.shadowBias = profile.shadowBias.toFixed(2);
  canvas.dataset.shadowNormalOffset = profile.normalOffsetBias.toFixed(2);
  canvas.dataset.shadowDistance = profile.shadowDistance.toFixed(2);
  canvas.dataset.shadowCascades = resolvedShadowQuality === "high" || resolvedShadowQuality === "ultra" ? "3" : resolvedShadowQuality === "off" ? "0" : "2";
  canvas.dataset.antialiasing = resolvedAntialiasing;
  canvas.dataset.renderScale = (frame ? frame.rendering.renderTargetScale * display.resolutionScale : display.resolutionScale).toFixed(2);
  canvas.dataset.depthOfField = frame?.dof.enabled ? (settings.quality === "diorama" ? "macro-near-and-far" : "far-field") : "off";
  canvas.dataset.depthOfFieldRange = frame?.dof.focusRange.toFixed(2) ?? "0";
  canvas.dataset.volumetricFog = frame?.volumetricFog.enabled ? `${frame.volumetricFog.steps}-step` : "off";
  const passGraph = (frame as unknown as { renderPassCamera?: { ssaoPass?: unknown; bloomPass?: unknown; dofPass?: unknown; volumetricFogPass?: unknown } } | null)?.renderPassCamera;
  canvas.dataset.postProcessGraph = passGraph
    ? [passGraph.ssaoPass && "ssao", passGraph.bloomPass && "bloom", passGraph.dofPass && "dof", passGraph.volumetricFogPass && "fog"].filter(Boolean).join("+") || "compose"
    : "off";
  canvas.dataset.cleanShadowPolicy = "one-directional-caster-high-resolution-biased-cascades";
  canvas.dataset.ambientModel = "sky-ground-spherical-harmonics";
  canvas.dataset.skyAmbient = profile.skyAmbient.join(",");
  canvas.dataset.worldSun = map.world ? "directional-readability-floor" : "tabletop-key";
  canvas.dataset.worldSunIntensity = profile.sunIntensity.toFixed(3);
  canvas.dataset.groundAmbient = profile.groundAmbient.join(",");
  canvas.dataset.practicalLightFalloff = "inverse-square-smooth-window";
  canvas.dataset.practicalShadowCasters = "0";
  canvas.dataset.clusteredLighting = "enabled";
  canvas.dataset.clusteredLightCells = clusterCells.join("x");
  canvas.dataset.clusteredMaxLightsPerCell = String(budget.maxLightsPerCell);
  canvas.dataset.lightProbeGrid = `${rig.probeGrid.columns}x${rig.probeGrid.rows}`;
  canvas.dataset.lightProbeCoefficients = "9-rgb-bilinear";
  canvas.dataset.ssaoPipeline = settings.ssao && budget.ssaoSamples ? "half-resolution-lighting-space-blurred" : "off";
};

export const rebuildEnvironment = (rig: LightingRig, map: GameMap, panorama?: File | null, display = getDisplaySettings()): void => {
  if (rig.destroyed) return;
  releaseEnvironment(rig);
  if (!panorama) {
    installEnvironment(rig, makeGradientEnvironment(rig.app, map), map, display);
    return;
  }
  const objectUrl = URL.createObjectURL(panorama);
  const asset = new pc.Asset(panorama.name, "texture", { url: objectUrl, filename: panorama.name }, {
    type: panorama.name.toLowerCase().endsWith(".hdr") ? pc.TEXTURETYPE_RGBE : pc.TEXTURETYPE_DEFAULT,
    projection: pc.TEXTUREPROJECTION_EQUIRECT,
    mipmaps: true,
  });
  rig.app.assets.add(asset);
  asset.ready(() => {
    if (rig.destroyed || !asset.resource || !asset.registry) return;
    const source = asset.resource as pc.Texture;
    source.projection = pc.TEXTUREPROJECTION_EQUIRECT;
    installEnvironment(rig, source, map, display, asset, objectUrl);
  });
  asset.on("error", () => {
    if (rig.destroyed) return;
    rig.app.assets.remove(asset);
    URL.revokeObjectURL(objectUrl);
    installEnvironment(rig, makeGradientEnvironment(rig.app, map), map, display);
  });
  rig.app.assets.load(asset);
};

export const rebuildDynamicLights = (rig: LightingRig, map: GameMap, display = getDisplaySettings()): void => {
  if (rig.destroyed) return;
  for (const light of rig.dynamicLights) light.destroy();
  rig.dynamicLights = [];
  rig.dynamicLightBaseIntensity = [];
  rig.dynamicLightFlicker = [];
  rig.dynamicLightSelectionOrigin = rig.camera.getPosition().clone();
  const settings = effectiveLightingSettings(map, display);
  const canvas = rig.app.graphicsDevice.canvas as HTMLCanvasElement;
  if (!settings.dynamicLights) {
    canvas.dataset.dynamicLightCount = "0";
    canvas.dataset.authoredDynamicLightCount = "0";
    canvas.dataset.dynamicLightsDropped = "0";
    return;
  }
  const budget = LIGHTING_QUALITY_BUDGETS[settings.quality];
  const allCandidates = map.entities.filter((entity) => !entity.hidden).flatMap((entity) => {
    const practical = resolvePracticalLight(entity);
    if (practical) return [{ entity, practical }];
    // Procedural surfaces may use emissive tinting for readable water or lava,
    // but they are not discrete luminaires. Treating every streamed water tile
    // as a point light overflowed clustered-light cells in wet biomes.
    if (entity.worldGeometry) return [];
    const definition = ASSET_BY_ID.get(entity.assetId);
    const source = definition?.parts?.find((part) => part.emissive);
    if (!definition || !source) return [];
    const yaw = entity.rotation.y * pc.math.DEG_TO_RAD;
    const offsetX = source.position.x * Math.cos(yaw) + source.position.z * Math.sin(yaw);
    const offsetZ = -source.position.x * Math.sin(yaw) + source.position.z * Math.cos(yaw);
    return [{ entity, practical: {
      behavior: { kind: "practical-light" as const, lightType: "point" as const, color: source.emissive ?? "#89b8ff", intensity: 1.08, range: Math.max(3.5, definition.footprint * 7), coneAngle: 55, anchor: source.position, direction: { x: 0, y: -1, z: 0 } },
      position: { x: entity.position.x + offsetX, y: entity.position.y + source.position.y, z: entity.position.z + offsetZ },
      direction: { x: 0, y: -1, z: 0 },
    } }];
  });
  const authoredLightFamilies = new Map<string, number>();
  for (const { entity } of allCandidates) authoredLightFamilies.set(entity.assetId, (authoredLightFamilies.get(entity.assetId) ?? 0) + 1);
  canvas.dataset.authoredDynamicLightFamilies = [...authoredLightFamilies.entries()].sort((left, right) => right[1] - left[1]).map(([assetId, count]) => `${assetId}:${count}`).join(",");
  const cameraPosition = rig.camera.getPosition();
  const relevance = ({ entity, practical }: typeof allCandidates[number]): number => {
    const distanceSquared = (practical.position.x - cameraPosition.x) ** 2 + (practical.position.y - cameraPosition.y) ** 2 + (practical.position.z - cameraPosition.z) ** 2;
    const contribution = practical.behavior.intensity * practical.behavior.range ** 2 / Math.max(1, distanceSquared);
    return contribution * (entity.assetId.startsWith("scene-light-") ? 1.08 : 1);
  };
  const candidates = prioritizeVisibleLights(allCandidates, budget.dynamicLights, relevance);
  candidates.forEach(({ entity, practical }, index) => {
    const behavior = practical.behavior;
    const light = new pc.Entity(`${entity.name} practical light`);
    const tint = new pc.Color().fromString(behavior.color);
    const qualityScale = settings.quality === "performance" ? .75 : settings.quality === "diorama" ? 1.08 : 1;
    const baseIntensity = behavior.intensity * qualityScale;
    light.addComponent("light", {
      type: behavior.lightType === "spot" ? "spot" : "omni",
      color: tint,
      intensity: baseIntensity,
      range: behavior.range,
      innerConeAngle: Math.max(1, behavior.coneAngle * .65),
      outerConeAngle: behavior.coneAngle,
      falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED,
      castShadows: false,
      shadowResolution: 512,
      shadowType: pc.SHADOW_PCF3,
      shadowBias: .22,
      normalOffsetBias: .16,
    });
    light.setPosition(practical.position.x, practical.position.y, practical.position.z);
    if (behavior.lightType === "spot") light.lookAt(practical.position.x + practical.direction.x, practical.position.y + practical.direction.y, practical.position.z + practical.direction.z);
    rig.app.root.addChild(light);
    rig.dynamicLights.push(light);
    rig.dynamicLightBaseIntensity.push(baseIntensity);
    rig.dynamicLightFlicker.push({ amount: behavior.flicker?.enabled ? behavior.flicker.amount : 0, speed: behavior.flicker?.speed ?? 0 });
  });
  canvas.dataset.dynamicLightCount = String(candidates.length);
  canvas.dataset.authoredDynamicLightCount = String(allCandidates.length);
  canvas.dataset.dynamicLightLimit = `${budget.dynamicLights}-visible`;
  canvas.dataset.dynamicLightsDropped = String(Math.max(0, allCandidates.length - candidates.length));
};

/** Re-ranks a virtualized light set only after meaningful camera travel. */
export const refreshVirtualizedDynamicLights = (rig: LightingRig, map: GameMap, display = getDisplaySettings()): void => {
  if (rig.destroyed) return;
  const budget = LIGHTING_QUALITY_BUDGETS[effectiveLightingSettings(map, display).quality];
  const canvas = rig.app.graphicsDevice.canvas as HTMLCanvasElement;
  if (Number(canvas.dataset.authoredDynamicLightCount ?? 0) <= budget.dynamicLights) return;
  const origin = rig.dynamicLightSelectionOrigin;
  if (!origin || origin.distance(rig.camera.getPosition()) >= 2) rebuildDynamicLights(rig, map, display);
};

export const updateLightingRig = (rig: LightingRig, timeSeconds: number, focusTargets: DepthOfFieldTarget[] = [], broadScene = false): void => {
  if (rig.destroyed) return;
  // Applies per-frame CameraFrame values (TAA jitter, DoF focus/blur, SSAO,
  // grading, bloom, fog and compose settings). Without this call the public
  // settings change while the rendered pass graph remains at its defaults.
  if (rig.cameraFrame?.dof.enabled) {
    const focus = resolveDepthOfFieldFocus(rig.camera.getPosition(), rig.camera.forward, focusTargets, broadScene);
    const canvas = rig.app.graphicsDevice.canvas as HTMLCanvasElement;
    const quality = canvas.dataset.lightingQuality;
    rig.cameraFrame.dof.focusDistance = focus.distance;
    rig.cameraFrame.dof.focusRange = focus.range;
    rig.cameraFrame.dof.nearBlur = !broadScene && quality === "diorama";
    rig.cameraFrame.dof.blurRadius = broadScene ? (quality === "diorama" ? .9 : .6) : quality === "diorama" ? 2.35 : quality === "cinematic" ? 1.85 : 1.5;
    canvas.dataset.depthOfFieldFocusDistance = focus.distance.toFixed(2);
    canvas.dataset.depthOfFieldRange = focus.range.toFixed(2);
    canvas.dataset.depthOfFieldTargets = String(focus.count);
    canvas.dataset.depthOfFieldFocusMode = broadScene ? "build-wide" : focus.count > 1 ? "combat-group" : focus.count === 1 ? "active-miniature" : "scene-center";
    canvas.dataset.depthOfFieldBlurRadius = rig.cameraFrame.dof.blurRadius.toFixed(2);
    canvas.dataset.depthOfFieldNearBlur = String(rig.cameraFrame.dof.nearBlur);
  }
  rig.cameraFrame?.update();
  rig.dynamicLights.forEach((light, index) => {
    if (!light.light) return;
    const flicker = rig.dynamicLightFlicker[index];
    const slow = flicker?.amount ? Math.sin(timeSeconds * flicker.speed + index * 2.17) * flicker.amount * .68 : 0;
    const fast = flicker?.amount ? Math.sin(timeSeconds * flicker.speed * 2.29 + index * 5.31) * flicker.amount * .32 : 0;
    light.light.intensity = (rig.dynamicLightBaseIntensity[index] ?? 1) * (1 + slow + fast);
  });
};

export const destroyLightingRig = (rig: LightingRig): void => {
  if (rig.destroyed) return;
  rig.destroyed = true;
  releaseEnvironment(rig);
  rig.lut?.destroy();
  rig.lut = null;
  rig.cameraFrame?.destroy();
  rig.cameraFrame = null;
  for (const light of rig.dynamicLights) light.destroy();
  rig.dynamicLights = [];
  rig.dynamicLightBaseIntensity = [];
  rig.dynamicLightFlicker = [];
};
