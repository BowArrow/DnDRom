import { del, get, set } from "idb-keyval";
import type { WorldBlueprintV1, WorldGenerationCheckpoint } from "../domain/types";
import { createAssetStore } from "./assetDatabase";

const blueprintStore = createAssetStore("world-blueprints");
const chunkMeshStore = createAssetStore("world-chunk-meshes");
const heightfieldStore = createAssetStore("world-heightfields");
const navigationStore = createAssetStore("world-navigation");
const splatTileStore = createAssetStore("world-splat-tiles");
const sceneThumbnailStore = createAssetStore("scene-thumbnails");
const checkpointStore = createAssetStore("world-generation-checkpoints");

const digest = async (value: Blob | ArrayBuffer | string): Promise<string> => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Blob ? await value.arrayBuffer() : value;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((entry) => entry.toString(16).padStart(2, "0")).join("");
};

export async function storeWorldBlueprint(blueprint: WorldBlueprintV1): Promise<string> {
  const json = JSON.stringify(blueprint);
  const key = `world-blueprint:${await digest(json)}`;
  await set(key, blueprint, blueprintStore);
  return key;
}

export const readWorldBlueprint = (key: string): Promise<WorldBlueprintV1 | undefined> => get<WorldBlueprintV1>(key, blueprintStore);

export async function storeWorldBinary(kind: "chunk" | "heightfield" | "navigation" | "splat-tile" | "thumbnail", value: Blob): Promise<string> {
  const key = `world-${kind}:${await digest(value)}`;
  const store = kind === "chunk" ? chunkMeshStore : kind === "heightfield" ? heightfieldStore : kind === "navigation" ? navigationStore : kind === "splat-tile" ? splatTileStore : sceneThumbnailStore;
  await set(key, value, store);
  return key;
}

export async function readWorldBinary(kind: "chunk" | "heightfield" | "navigation" | "splat-tile" | "thumbnail", key: string): Promise<Blob | undefined> {
  const store = kind === "chunk" ? chunkMeshStore : kind === "heightfield" ? heightfieldStore : kind === "navigation" ? navigationStore : kind === "splat-tile" ? splatTileStore : sceneThumbnailStore;
  return get<Blob>(key, store);
}

export async function writeWorldGenerationCheckpoint(checkpoint: WorldGenerationCheckpoint): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await set(`world-checkpoint:${checkpoint.campaignId}`, checkpoint, checkpointStore);
}

export const readWorldGenerationCheckpoint = (campaignId: string): Promise<WorldGenerationCheckpoint | undefined> => typeof indexedDB === "undefined" ? Promise.resolve(undefined) : get(`world-checkpoint:${campaignId}`, checkpointStore);
export const clearWorldGenerationCheckpoint = (campaignId: string): Promise<void> => typeof indexedDB === "undefined" ? Promise.resolve() : del(`world-checkpoint:${campaignId}`, checkpointStore);
