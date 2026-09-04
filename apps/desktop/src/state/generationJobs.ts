import { useSyncExternalStore } from "react";

export type GenerationJobKind = "scene" | "character" | "prop" | "dice" | "baseplate" | "runtime";
export type GenerationJobStatus = "queued" | "running" | "complete" | "error";

export interface GenerationJob {
  id: string;
  kind: GenerationJobKind;
  label: string;
  status: GenerationJobStatus;
  message: string;
  stageLabel: string;
  percent: number;
  startedAt: number;
  updatedAt: number;
  detail?: string;
  reportedByEngine?: boolean;
}

const STORAGE_KEY = "dndrom.generationJobs.v1";
export const COMPLETED_JOB_TTL_MS = 3_500;
const listeners = new Set<() => void>();
const cancelHandlers = new Map<string, () => void>();
const completionTimers = new Map<string, number>();

const readStoredJobs = (): GenerationJob[] => {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as GenerationJob[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((job) => job.status !== "complete").slice(0, 8).map((job) => job.status === "running" || job.status === "queued" ? {
      ...job,
      status: "error",
      message: "Generation stopped when the previous DnDRom session closed",
      detail: "Start it again; saved inputs and completed source assets are still available.",
      updatedAt: Date.now(),
    } : job);
  } catch {
    return [];
  }
};

let snapshot = readStoredJobs();
let lastStartedAt = snapshot.reduce((latest, job) => Math.max(latest, job.startedAt), 0);

const clearCompletionTimer = (id: string): void => {
  const timer = completionTimers.get(id);
  if (timer !== undefined && typeof window !== "undefined") window.clearTimeout(timer);
  completionTimers.delete(id);
};

const promoteNextQueued = (): void => {
  if (snapshot.some((job) => job.status === "running")) return;
  const next = snapshot.filter((job) => job.status === "queued").sort((left, right) => left.startedAt - right.startedAt)[0];
  if (!next) return;
  snapshot = snapshot.map((job) => job.id === next.id ? { ...job, status: "running", updatedAt: Date.now() } : job);
};

const publish = (): void => {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot.slice(0, 8)));
  listeners.forEach((listener) => listener());
};

export const beginGenerationJob = (job: Omit<GenerationJob, "id" | "status" | "percent" | "startedAt" | "updatedAt"> & { percent?: number; onCancel?: () => void }): string => {
  const id = crypto.randomUUID();
  // Date.now() commonly returns the same millisecond for several UI actions.
  // A monotonic stamp preserves true FIFO order instead of relying on the
  // current (newest-first) array order when timestamps tie.
  const now = Math.max(Date.now(), lastStartedAt + 1);
  lastStartedAt = now;
  const { onCancel, ...stored } = job;
  const created: GenerationJob = { ...stored, id, status: snapshot.some((entry) => entry.status === "running") ? "queued" : "running", percent: Math.min(99, Math.max(0, job.percent ?? 0)), startedAt: now, updatedAt: now };
  snapshot = [created, ...snapshot].slice(0, 8);
  if (onCancel) cancelHandlers.set(id, onCancel);
  publish();
  return id;
};

export const updateGenerationJob = (id: string, patch: Partial<Omit<GenerationJob, "id" | "kind" | "startedAt">>): void => {
  snapshot = snapshot.map((job) => {
    if (job.id !== id) return job;
    const status = patch.status ?? job.status;
    const requested = patch.percent ?? job.percent;
    const percent = status === "complete" ? 100 : status === "running" ? Math.min(99, Math.max(job.percent, requested)) : Math.min(99, Math.max(0, requested));
    return { ...job, ...patch, status, percent, updatedAt: Date.now() };
  });
  if (patch.status && patch.status !== "running" && patch.status !== "queued") {
    cancelHandlers.delete(id);
    promoteNextQueued();
  }
  publish();
  if (patch.status === "complete" && typeof window !== "undefined") {
    clearCompletionTimer(id);
    completionTimers.set(id, window.setTimeout(() => dismissGenerationJob(id), COMPLETED_JOB_TTL_MS));
  }
};

export const cancelGenerationJob = (id: string): void => {
  const job = snapshot.find((entry) => entry.id === id);
  cancelHandlers.get(id)?.();
  if (job?.status === "queued") dismissGenerationJob(id);
};

export const dismissGenerationJob = (id: string): void => {
  const wasRunning = snapshot.some((job) => job.id === id && job.status === "running");
  clearCompletionTimer(id);
  cancelHandlers.delete(id);
  snapshot = snapshot.filter((job) => job.id !== id);
  if (wasRunning) promoteNextQueued();
  publish();
};

/** Resolves only when this job owns the single local generation slot. */
export const waitForGenerationJobTurn = (id: string): Promise<boolean> => {
  const current = snapshot.find((job) => job.id === id);
  if (current?.status === "running") return Promise.resolve(true);
  if (current?.status !== "queued") return Promise.resolve(false);
  return new Promise((resolve) => {
    const listener = () => {
      const job = snapshot.find((entry) => entry.id === id);
      if (job?.status === "queued") return;
      listeners.delete(listener);
      resolve(job?.status === "running");
    };
    listeners.add(listener);
  });
};

export const dismissFailedGenerationJobs = (kind: GenerationJobKind): void => {
  const removed = snapshot.filter((job) => job.kind === kind && job.status === "error");
  removed.forEach((job) => cancelHandlers.delete(job.id));
  snapshot = snapshot.filter((job) => job.kind !== kind || job.status !== "error");
  publish();
};

export const generationJobsSnapshot = (): GenerationJob[] => snapshot;
export const subscribeGenerationJobs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useGenerationJobs = (): GenerationJob[] => useSyncExternalStore(subscribeGenerationJobs, generationJobsSnapshot, generationJobsSnapshot);
