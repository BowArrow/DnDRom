import { del, get, set } from "idb-keyval";
import type { AssetStoreName } from "./assetDatabase";
import { createAssetStore } from "./assetDatabase";

const stores: Record<"source" | "mask" | "thumbnail" | "map" | "height", AssetStoreName> = {
  source: "baseplate-source-images",
  mask: "baseplate-masks",
  thumbnail: "baseplate-thumbnails",
  map: "baseplate-pbr-maps",
  height: "baseplate-height-data",
};

export type BasePlateBinaryKind = keyof typeof stores;

const hex = (bytes: Uint8Array): string => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

export async function storeBasePlateBinary(blob: Blob, kind: BasePlateBinaryKind): Promise<string> {
  if (!blob.size) throw new Error("The baseplate asset is empty");
  if (blob.size > 32 * 1024 * 1024) throw new Error("Baseplate images and maps are limited to 32 MB each");
  const key = `sha256:${hex(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())))}`;
  await set(key, blob, createAssetStore(stores[kind]));
  return key;
}

export async function getBasePlateBinary(key: string, kind: BasePlateBinaryKind): Promise<Blob | null> {
  return await get<Blob>(key, createAssetStore(stores[kind])) ?? null;
}

export async function deleteBasePlateBinary(key: string, kind: BasePlateBinaryKind): Promise<void> {
  await del(key, createAssetStore(stores[kind]));
}

