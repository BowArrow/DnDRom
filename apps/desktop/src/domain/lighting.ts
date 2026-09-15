import type { LightingMood, LightingQuality, MapTheme, SceneLightingSettings } from "./types";

export interface TabletopLightingProfile {
  ambient: [number, number, number];
  skyAmbient: [number, number, number];
  groundAmbient: [number, number, number];
  sunColor: [number, number, number];
  sunIntensity: number;
  sunElevation: number;
  sunAzimuth: number;
  shadowIntensity: number;
  shadowDistance: number;
  shadowBias: number;
  normalOffsetBias: number;
  shadowResolution: 1024 | 2048 | 4096;
  fillColor: [number, number, number];
  fillIntensity: number;
  rimColor: [number, number, number];
  rimIntensity: number;
  gradeTint: [number, number, number];
  gradeContrast: number;
  gradeSaturation: number;
  clearColor: [number, number, number];
}

export const DEFAULT_SCENE_LIGHTING: SceneLightingSettings = {
  quality: "balanced",
  mood: "natural",
  iblIntensity: 0.75,
  keyIntensity: 1,
  fillIntensity: 1,
  rimIntensity: 0.7,
  exposure: 1,
  dynamicLights: true,
  ssao: true,
  bloom: true,
  depthOfField: false,
  fogMist: true,
  fogOfWar: false,
};

export const LIGHTING_QUALITY_BUDGETS: Record<LightingQuality, { shadowResolution: 1024 | 2048 | 4096; dynamicLights: number; maxLightsPerCell: number; shadowedDynamicLights: number; iblSize: number; ssaoSamples: number; renderScale: number }> = {
  performance: { shadowResolution: 1024, dynamicLights: 254, maxLightsPerCell: 6, shadowedDynamicLights: 0, iblSize: 64, ssaoSamples: 0, renderScale: 0.82 },
  balanced: { shadowResolution: 2048, dynamicLights: 254, maxLightsPerCell: 12, shadowedDynamicLights: 0, iblSize: 128, ssaoSamples: 8, renderScale: 1 },
  cinematic: { shadowResolution: 2048, dynamicLights: 254, maxLightsPerCell: 20, shadowedDynamicLights: 0, iblSize: 256, ssaoSamples: 16, renderScale: 1 },
  diorama: { shadowResolution: 4096, dynamicLights: 254, maxLightsPerCell: 32, shadowedDynamicLights: 0, iblSize: 256, ssaoSamples: 24, renderScale: 1 },
};

/**
 * Scene documents may author any number of lights. The renderer virtualizes
 * that list into the strongest camera-relevant set supported by the clustered
 * light-index texture, without deleting or disabling authored entities.
 */
export function prioritizeVisibleLights<T>(candidates: readonly T[], maximum: number, relevance: (candidate: T) => number): T[] {
  if (candidates.length <= maximum) return [...candidates];
  return [...candidates].sort((left, right) => relevance(right) - relevance(left)).slice(0, maximum);
}

const moodProfile: Record<LightingMood, { key: [number, number, number]; fill: [number, number, number]; rim: [number, number, number]; sky: [number, number, number]; ground: [number, number, number]; tint: [number, number, number]; clear: [number, number, number]; contrast: number; saturation: number }> = {
  natural: { key: [1, .94, .84], fill: [.42, .55, .74], rim: [.62, .76, 1], sky: [.31, .36, .43], ground: [.14, .13, .11], tint: [1, 1, 1], clear: [.075, .095, .115], contrast: 1.02, saturation: 1.03 },
  warm: { key: [1, .78, .5], fill: [.38, .46, .62], rim: [.78, .68, 1], sky: [.27, .28, .3], ground: [.13, .1, .075], tint: [1, .96, .88], clear: [.07, .055, .042], contrast: 1.04, saturation: 1.05 },
  moonlight: { key: [.55, .68, 1], fill: [.2, .3, .55], rim: [.7, .83, 1], sky: [.13, .19, .35], ground: [.025, .03, .07], tint: [.8, .9, 1], clear: [.012, .018, .04], contrast: 1.12, saturation: .88 },
  crypt: { key: [.62, .92, .72], fill: [.16, .28, .3], rim: [.45, 1, .76], sky: [.1, .21, .18], ground: [.025, .06, .042], tint: [.74, .93, .82], clear: [.012, .025, .022], contrast: 1.16, saturation: .78 },
  desert: { key: [1, .82, .55], fill: [.5, .36, .28], rim: [1, .73, .48], sky: [.25, .24, .2], ground: [.17, .08, .035], tint: [1, .9, .7], clear: [.08, .047, .026], contrast: 1.1, saturation: 1.12 },
};

export function resolveSceneLighting(settings?: Partial<SceneLightingSettings>): SceneLightingSettings {
  return { ...DEFAULT_SCENE_LIGHTING, ...settings };
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

export function shadowCoverageDistance(width: number, depth: number, quality: LightingQuality): number {
  const diagonal = Math.hypot(width, depth);
  const coverage = {
    performance: { multiplier: 1.65, minimum: 38, maximum: 72 },
    balanced: { multiplier: 2.3, minimum: 52, maximum: 96 },
    cinematic: { multiplier: 2.8, minimum: 64, maximum: 128 },
    diorama: { multiplier: 3.1, minimum: 72, maximum: 144 },
  }[quality];
  return clamp(diagonal * coverage.multiplier, coverage.minimum, coverage.maximum);
}

/**
 * First-order spherical-harmonic coefficients for a sky/ground hemisphere.
 * PlayCanvas evaluates c0 + c2 * normal.y, which is exactly the inexpensive
 * mix(ground, sky, normal.y * .5 + .5) used by the lightweight forward path.
 */
export function hemisphereAmbientCoefficients(sky: [number, number, number], ground: [number, number, number]): Float32Array {
  const coefficients = new Float32Array(27);
  for (let channel = 0; channel < 3; channel++) {
    coefficients[channel] = (sky[channel] + ground[channel]) * .5;
    coefficients[6 + channel] = (sky[channel] - ground[channel]) * .5;
  }
  return coefficients;
}

export function tabletopLightingProfile(theme: MapTheme, width: number, depth: number, settings?: Partial<SceneLightingSettings>, generatedWorld = false): TabletopLightingProfile {
  const indoor = ["tavern", "dungeon", "cavern", "ruins"].includes(theme);
  const resolved = resolveSceneLighting(settings);
  const mood = moodProfile[resolved.mood];
  const budget = LIGHTING_QUALITY_BUDGETS[resolved.quality];
  const base = indoor ? {
    ambient: [0.3, 0.28, 0.25] as [number, number, number],
    sunColor: [1, 0.9, 0.78],
    sunIntensity: 1.05,
    sunElevation: 72,
    sunAzimuth: 28,
    shadowIntensity: 0.3,
    shadowDistance: shadowCoverageDistance(width, depth, resolved.quality),
    shadowBias: 0.28,
    normalOffsetBias: 0.18,
    shadowResolution: budget.shadowResolution,
    fillColor: [0.35, 0.48, 0.68],
    fillIntensity: 0.62,
  } : {
    ambient: [0.2, 0.22, 0.25] as [number, number, number],
    sunColor: [1, 0.91, 0.8],
    sunIntensity: 1.25,
    sunElevation: 60,
    sunAzimuth: 34,
    shadowIntensity: 0.46,
    shadowDistance: shadowCoverageDistance(width, depth, resolved.quality),
    shadowBias: 0.24,
    normalOffsetBias: 0.15,
    shadowResolution: budget.shadowResolution,
    fillColor: [0.3, 0.44, 0.68],
    fillIntensity: 0.4,
  };
  const profile: TabletopLightingProfile = {
    ...base,
    ambient: mood.sky.map((value, channel) => (value + mood.ground[channel]) * .5) as [number, number, number],
    skyAmbient: mood.sky,
    groundAmbient: mood.ground,
    sunColor: mood.key,
    sunIntensity: base.sunIntensity * resolved.keyIntensity,
    fillColor: mood.fill,
    fillIntensity: base.fillIntensity * resolved.fillIntensity,
    rimColor: mood.rim,
    rimIntensity: .42 * resolved.rimIntensity,
    gradeTint: mood.tint,
    gradeContrast: mood.contrast,
    gradeSaturation: mood.saturation,
    clearColor: mood.clear,
  };
  if (!generatedWorld) return profile;
  const nocturnal = resolved.mood === "moonlight" || resolved.mood === "crypt";
  // Wide generated regions must be readable before any local torch is placed.
  // Mood changes the color of the key and sky, never whether terrain is visible.
  profile.ambient = profile.ambient.map((value) => nocturnal ? Math.max(value, .15) : clamp(value * .82, .15, .21)) as [number, number, number];
  profile.skyAmbient = profile.skyAmbient.map((value) => nocturnal ? Math.max(value, .18) : clamp(value * .72, .18, .29)) as [number, number, number];
  profile.groundAmbient = profile.groundAmbient.map((value) => nocturnal ? Math.max(value, .065) : clamp(value * .72, .055, .1)) as [number, number, number];
  profile.sunIntensity = Math.max(profile.sunIntensity, nocturnal ? .95 : 1.48);
  profile.sunElevation = Math.min(profile.sunElevation, nocturnal ? 50 : 39);
  profile.fillIntensity = nocturnal ? Math.max(profile.fillIntensity, .34) : Math.min(profile.fillIntensity, .32);
  profile.shadowIntensity = Math.max(profile.shadowIntensity, nocturnal ? .68 : .86);
  // Directional shadow distance is measured from the camera, not the world
  // center. The overview camera can sit beyond the old quality cap and leave
  // an otherwise correctly configured generated region entirely unshadowed.
  profile.shadowDistance = Math.max(profile.shadowDistance, Math.hypot(width, depth) * 1.35);
  return profile;
}
