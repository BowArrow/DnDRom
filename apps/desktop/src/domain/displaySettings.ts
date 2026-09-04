import type { LightingQuality } from "./types";

export type DisplayQuality = "scene" | LightingQuality;
export type DisplayAntialiasing = "auto" | "off" | "msaa" | "taa";
export type DisplayShadowQuality = "auto" | "off" | "low" | "high" | "ultra";
export type DisplayMotion = "system" | "full" | "reduced";

export interface DisplaySettings {
  quality: DisplayQuality;
  resolutionScale: number;
  antialiasing: DisplayAntialiasing;
  shadowQuality: DisplayShadowQuality;
  ambientOcclusion: boolean;
  depthOfField: boolean;
  bloom: boolean;
  atmosphere: boolean;
  motion: DisplayMotion;
}

export const DISPLAY_SETTINGS_KEY = "dndrom.displaySettings.v1";
export const DISPLAY_SETTINGS_EVENT = "dndrom:display-settings";

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  quality: "balanced",
  resolutionScale: 1,
  antialiasing: "auto",
  shadowQuality: "auto",
  ambientOcclusion: true,
  depthOfField: true,
  bloom: true,
  atmosphere: true,
  motion: "system",
};

const qualities = new Set<DisplayQuality>(["scene", "performance", "balanced", "cinematic", "diorama"]);
const antialiasingModes = new Set<DisplayAntialiasing>(["auto", "off", "msaa", "taa"]);
const shadowModes = new Set<DisplayShadowQuality>(["auto", "off", "low", "high", "ultra"]);
const motionModes = new Set<DisplayMotion>(["system", "full", "reduced"]);
const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

export function normalizeDisplaySettings(value?: Partial<DisplaySettings> | null): DisplaySettings {
  const source = value ?? {};
  return {
    quality: qualities.has(source.quality as DisplayQuality) ? source.quality as DisplayQuality : DEFAULT_DISPLAY_SETTINGS.quality,
    resolutionScale: clamp(Number.isFinite(source.resolutionScale) ? Number(source.resolutionScale) : DEFAULT_DISPLAY_SETTINGS.resolutionScale, .5, 1.25),
    antialiasing: antialiasingModes.has(source.antialiasing as DisplayAntialiasing) ? source.antialiasing as DisplayAntialiasing : DEFAULT_DISPLAY_SETTINGS.antialiasing,
    shadowQuality: shadowModes.has(source.shadowQuality as DisplayShadowQuality) ? source.shadowQuality as DisplayShadowQuality : DEFAULT_DISPLAY_SETTINGS.shadowQuality,
    ambientOcclusion: source.ambientOcclusion ?? DEFAULT_DISPLAY_SETTINGS.ambientOcclusion,
    depthOfField: source.depthOfField ?? DEFAULT_DISPLAY_SETTINGS.depthOfField,
    bloom: source.bloom ?? DEFAULT_DISPLAY_SETTINGS.bloom,
    atmosphere: source.atmosphere ?? DEFAULT_DISPLAY_SETTINGS.atmosphere,
    motion: motionModes.has(source.motion as DisplayMotion) ? source.motion as DisplayMotion : DEFAULT_DISPLAY_SETTINGS.motion,
  };
}

export function displayPreset(quality: LightingQuality): DisplaySettings {
  const shared = { ...DEFAULT_DISPLAY_SETTINGS, quality };
  if (quality === "performance") return { ...shared, resolutionScale: .8, antialiasing: "msaa", shadowQuality: "low", ambientOcclusion: false, depthOfField: false, bloom: false, atmosphere: false };
  if (quality === "balanced") return { ...shared, resolutionScale: 1, antialiasing: "taa", shadowQuality: "high", depthOfField: false, atmosphere: false };
  if (quality === "cinematic") return { ...shared, resolutionScale: 1, antialiasing: "taa", shadowQuality: "high" };
  return { ...shared, resolutionScale: 1.1, antialiasing: "taa", shadowQuality: "ultra" };
}

export function readDisplaySettings(): DisplaySettings {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_SETTINGS;
  try {
    const stored = window.localStorage.getItem(DISPLAY_SETTINGS_KEY);
    return normalizeDisplaySettings(stored ? JSON.parse(stored) as Partial<DisplaySettings> : null);
  } catch {
    return DEFAULT_DISPLAY_SETTINGS;
  }
}

let currentSettings = readDisplaySettings();

export function getDisplaySettings(): DisplaySettings {
  return currentSettings;
}

export function writeDisplaySettings(value: DisplaySettings): DisplaySettings {
  currentSettings = normalizeDisplaySettings(value);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(currentSettings));
    window.dispatchEvent(new CustomEvent<DisplaySettings>(DISPLAY_SETTINGS_EVENT, { detail: currentSettings }));
  }
  return currentSettings;
}

export function subscribeDisplaySettings(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const update = () => {
    currentSettings = readDisplaySettings();
    onChange();
  };
  window.addEventListener(DISPLAY_SETTINGS_EVENT, update);
  window.addEventListener("storage", update);
  return () => {
    window.removeEventListener(DISPLAY_SETTINGS_EVENT, update);
    window.removeEventListener("storage", update);
  };
}

export function resolvedMotionReduction(settings = currentSettings): boolean {
  if (settings.motion === "reduced") return true;
  if (settings.motion === "full") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
