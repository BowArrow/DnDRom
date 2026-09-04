import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readLocalAiSettings, worldWanBudget } from "../domain/localAiSettings";

export type LocalRuntimeFeature = "characterPixal3d" | "characterTrellis2" | "characterRig" | "propImageLite" | "propImageKrea" | "world";

export interface LocalRuntimeStatus {
  state: "ready" | "external" | "needsStart" | "needsInstall";
  endpoint: string;
  feature: LocalRuntimeFeature;
  installedBytes: number;
  totalBytes: number;
  requiredBytes: number;
  message: string;
}

export interface LocalRuntimeProgress {
  feature: LocalRuntimeFeature;
  stage: "runtime" | "extracting" | "downloading" | "verifying" | "nodes" | "dependencies" | "trainer" | "starting" | "ready" | "training";
  completedBytes: number;
  totalBytes: number;
  message: string;
}

export interface TrainedWorld {
  path: string;
  filename: string;
}

export const formatRuntimeBytes = (bytes: number): string => bytes >= 1024 ** 3
  ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
  : `${Math.max(1, Math.ceil(bytes / 1024 ** 2))} MB`;

export const runtimeProgressPercent = (progress: Pick<LocalRuntimeProgress, "completedBytes" | "totalBytes"> & Partial<Pick<LocalRuntimeProgress, "stage">>): number => {
  if (progress.stage === "ready") return 100;
  if (progress.totalBytes <= 0) return 0;
  // Download bytes can be complete while extraction, dependency installation,
  // verification, or server startup is still running. Reserve 100% for the
  // native ready event so the bar never promises completion prematurely.
  return Math.min(99, Math.max(0, Math.round(progress.completedBytes / progress.totalBytes * 100)));
};

export async function getLocalRuntimeStatus(feature: LocalRuntimeFeature): Promise<LocalRuntimeStatus | null> {
  if (!isTauri()) return null;
  return await invoke<LocalRuntimeStatus>("local_runtime_status", { feature });
}

export async function ensureLocalRuntime(feature: LocalRuntimeFeature, onProgress?: (progress: LocalRuntimeProgress) => void): Promise<LocalRuntimeStatus> {
  if (!isTauri()) throw new Error("Automatic local creation setup is available in the installed DnDRom desktop app.");
  const unlisten = await listen<LocalRuntimeProgress>("local-runtime-progress", ({ payload }) => {
    if (payload.feature === feature) onProgress?.(payload);
  });
  try {
    const budget = worldWanBudget(readLocalAiSettings().memoryProfile);
    return await invoke<LocalRuntimeStatus>("ensure_local_runtime", { feature, vramReserveGb: budget.vramReserveGb });
  } finally {
    unlisten();
  }
}

export async function restartLocalRuntime(feature: LocalRuntimeFeature, onProgress?: (progress: LocalRuntimeProgress) => void): Promise<LocalRuntimeStatus> {
  if (!isTauri()) throw new Error("Automatic local creation recovery is available in the installed DnDRom desktop app.");
  const unlisten = await listen<LocalRuntimeProgress>("local-runtime-progress", ({ payload }) => {
    if (payload.feature === feature) onProgress?.(payload);
  });
  try {
    const budget = worldWanBudget(readLocalAiSettings().memoryProfile);
    return await invoke<LocalRuntimeStatus>("restart_local_runtime", { feature, vramReserveGb: budget.vramReserveGb });
  } finally {
    unlisten();
  }
}

export async function provisionLocalCreationSuite(onProgress?: (progress: LocalRuntimeProgress) => void): Promise<LocalRuntimeStatus | null> {
  if (!isTauri()) return null;
  const unlisten = await listen<LocalRuntimeProgress>("local-runtime-progress", ({ payload }) => onProgress?.(payload));
  try {
    const budget = worldWanBudget(readLocalAiSettings().memoryProfile);
    return await invoke<LocalRuntimeStatus>("provision_local_creation_suite", { vramReserveGb: budget.vramReserveGb });
  } finally {
    unlisten();
  }
}

export async function trainLocalWorld(datasetPath: string, onProgress?: (progress: LocalRuntimeProgress) => void): Promise<TrainedWorld> {
  const unlisten = await listen<LocalRuntimeProgress>("local-runtime-progress", ({ payload }) => {
    if (payload.feature === "world") onProgress?.(payload);
  });
  try {
    const budget = worldWanBudget(readLocalAiSettings().memoryProfile);
    return await invoke<TrainedWorld>("train_local_world", {
      datasetPath,
      totalSteps: budget.trainingSteps,
      maxSplats: budget.maxSplats,
      maxFrames: budget.trainingMaxFrames,
    });
  } finally {
    unlisten();
  }
}

/** Returns only a recently completed, structurally validated COLMAP dataset
 * inside DnDRom's managed runtime. Used after the UI misses Comfy's path text. */
export async function findLatestLocalWorldDataset(): Promise<string | null> {
  if (!isTauri()) return null;
  return await invoke<string | null>("find_latest_local_world_dataset");
}

/** Recovers Brush output that completed before a late validation/import error,
 * allowing Retry to resume at 98% rather than training the same dataset again. */
export async function findLatestLocalTrainedWorld(): Promise<TrainedWorld | null> {
  if (!isTauri()) return null;
  return await invoke<TrainedWorld | null>("find_latest_local_trained_world");
}

export async function readLocalRuntimeFile(path: string, filename: string): Promise<File> {
  const response = await invoke<ArrayBuffer | Uint8Array | number[]>("read_local_runtime_file", { path });
  const bytes = response instanceof ArrayBuffer ? new Uint8Array(response) : response instanceof Uint8Array ? response : new Uint8Array(response);
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return new File([owned.buffer], filename, { type: "application/octet-stream" });
}
