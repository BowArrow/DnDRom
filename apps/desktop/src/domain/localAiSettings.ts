export type LocalAiMemoryProfile = "maximum" | "balanced" | "conservative";

export interface LocalAiSettings {
  memoryProfile: LocalAiMemoryProfile;
}

export interface WorldWanBudget {
  width: number;
  height: number;
  length: number;
  supplementalLength: number;
  steps: number;
  compositeFrames: string;
  supplementalCompositeFrames: string;
  vramReserveGb: number;
  outputWidth: number;
  proxyWidth: number;
  geometryScale: number;
  compositePrefetch: boolean;
  toneWorkWidth: number;
  maxTrajectories: number;
  sfmMaxFrames: number;
  sfmMaxFeatures: number;
  sfmFaceSize: number;
  trainingSteps: number;
  trainingMaxFrames: number;
  maxSplats: number;
  runtimeSplatBudget: number;
  useLearnedUpscaler: boolean;
}

export const LOCAL_AI_SETTINGS_KEY = "dndrom.localAiSettings.v1";
export const LOCAL_AI_SETTINGS_EVENT = "dndrom:local-ai-settings";

export const DEFAULT_LOCAL_AI_SETTINGS: LocalAiSettings = {
  memoryProfile: "balanced",
};

const profiles = new Set<LocalAiMemoryProfile>(["maximum", "balanced", "conservative"]);

export function normalizeLocalAiSettings(value?: Partial<LocalAiSettings> | null): LocalAiSettings {
  return {
    memoryProfile: profiles.has(value?.memoryProfile as LocalAiMemoryProfile)
      ? value!.memoryProfile as LocalAiMemoryProfile
      : DEFAULT_LOCAL_AI_SETTINGS.memoryProfile,
  };
}

export function worldWanBudget(profile: LocalAiMemoryProfile): WorldWanBudget {
  if (profile === "maximum") {
    return {
      width: 1440, height: 720, length: 81, supplementalLength: 81, steps: 4,
      // Reference quality preserves the included workflow's complete coverage
      // and every-second-frame high-resolution panorama anchor.
      compositeFrames: "0-80/2", supplementalCompositeFrames: "0-80/2", vramReserveGb: 0.6,
      outputWidth: 8192, proxyWidth: 1440, maxTrajectories: 4,
      geometryScale: 2, compositePrefetch: true, toneWorkWidth: 1024,
      sfmMaxFrames: 324, sfmMaxFeatures: 8192, sfmFaceSize: 1024,
      trainingSteps: 6000, trainingMaxFrames: 324, maxSplats: 750_000,
      runtimeSplatBudget: 850_000, useLearnedUpscaler: true,
    };
  }
  if (profile === "conservative") {
    return {
      width: 640, height: 320, length: 81, supplementalLength: 81, steps: 4,
      compositeFrames: "0-80/4", supplementalCompositeFrames: "0-80/4", vramReserveGb: 1.75,
      outputWidth: 2048, proxyWidth: 640, maxTrajectories: 4,
      geometryScale: 1, compositePrefetch: false, toneWorkWidth: 512,
      sfmMaxFrames: 324, sfmMaxFeatures: 4096, sfmFaceSize: 640,
      trainingSteps: 3000, trainingMaxFrames: 324, maxSplats: 100_000,
      runtimeSplatBudget: 150_000, useLearnedUpscaler: false,
    };
  }
  // Game quality retains all continuous camera rails for reconstruction. It
  // saves work by sampling fewer high-resolution panorama anchors, not by
  // removing the viewpoints SphereSfM needs to preserve geometry.
  return {
    width: 960, height: 480, length: 81, supplementalLength: 81, steps: 4,
    compositeFrames: "0-80/4", supplementalCompositeFrames: "0-80/4", vramReserveGb: 1.25,
    outputWidth: 4096, proxyWidth: 960, maxTrajectories: 4,
    geometryScale: 1, compositePrefetch: false, toneWorkWidth: 512,
    sfmMaxFrames: 324, sfmMaxFeatures: 8192, sfmFaceSize: 768,
    trainingSteps: 4500, trainingMaxFrames: 324, maxSplats: 400_000,
    runtimeSplatBudget: 450_000, useLearnedUpscaler: false,
  };
}

export function readLocalAiSettings(): LocalAiSettings {
  if (typeof window === "undefined") return DEFAULT_LOCAL_AI_SETTINGS;
  try {
    const stored = window.localStorage.getItem(LOCAL_AI_SETTINGS_KEY);
    return normalizeLocalAiSettings(stored ? JSON.parse(stored) as Partial<LocalAiSettings> : null);
  } catch {
    return DEFAULT_LOCAL_AI_SETTINGS;
  }
}

export function writeLocalAiSettings(value: LocalAiSettings): LocalAiSettings {
  const normalized = normalizeLocalAiSettings(value);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LOCAL_AI_SETTINGS_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent<LocalAiSettings>(LOCAL_AI_SETTINGS_EVENT, { detail: normalized }));
  }
  return normalized;
}
