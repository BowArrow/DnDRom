import { get, set } from "idb-keyval";
import type { MaterialMapSet } from "../domain/types";
import { createAssetStore } from "./assetDatabase";

const MATERIAL_DATABASE = createAssetStore("prop-pbr-textures");
const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

export async function storeMaterialMap(blob: Blob): Promise<string> {
  if (!blob.type.startsWith("image/") || blob.size <= 0 || blob.size > 32 * 1024 * 1024) throw new Error("PBR maps must be valid images under 32 MB");
  const key = `sha256:${bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())))}`;
  await set(key, blob, MATERIAL_DATABASE);
  return key;
}

export async function getStoredMaterialMap(key: string): Promise<Blob | null> { return (await get<Blob>(key, MATERIAL_DATABASE)) ?? null; }

export async function materialMapsAvailable(maps: MaterialMapSet): Promise<boolean> {
  const keys = Object.values(maps).filter((value): value is string => Boolean(value));
  return (await Promise.all(keys.map((key) => getStoredMaterialMap(key)))).every(Boolean);
}
