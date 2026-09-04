import { del, get, set } from "idb-keyval";
import type { AttachmentProfile, AttachmentSurface, PropAsset, PropBehavior, PropBounds, PropCollisionMode, TokenSourceImage } from "../domain/types";
import { createAssetStore } from "./assetDatabase";

const PROP_DATABASE = createAssetStore("mesh-props");
const SOURCE_DATABASE = createAssetStore("prop-source-images");
export const MAX_PROP_TRIANGLES = 20_000;
export const DEFAULT_PROP_TRIANGLES = 8_000;
export const MAX_PROP_MODEL_BYTES = 128 * 1024 * 1024;

interface GlbDocument {
  images?: { uri?: string }[];
  buffers?: { uri?: string }[];
  accessors?: { count?: number; min?: number[]; max?: number[] }[];
  meshes?: { primitives?: { mode?: number; indices?: number; attributes?: { POSITION?: number } }[] }[];
}

const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
const storageKey = async (blob: Blob): Promise<string> => `sha256:${bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())))}`;

export async function inspectPropModel(file: Blob & { name?: string }): Promise<{ triangleCount: number; bounds: PropBounds }> {
  if (!file.name?.toLowerCase().endsWith(".glb") || file.size < 20 || file.size > MAX_PROP_MODEL_BYTES) throw new Error("Import a self-contained GLB smaller than 128 MB");
  const header = new DataView(await file.slice(0, 20).arrayBuffer());
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== file.size || header.getUint32(16, true) !== 0x4e4f534a) throw new Error("This is not a valid glTF 2.0 GLB file");
  const jsonLength = header.getUint32(12, true);
  const document = JSON.parse(new TextDecoder().decode(await file.slice(20, 20 + jsonLength).arrayBuffer()).trim()) as GlbDocument;
  const external = [...(document.images ?? []), ...(document.buffers ?? [])].map((entry) => entry.uri).filter((uri): uri is string => Boolean(uri && !uri.startsWith("data:")));
  if (external.length) throw new Error("Props must embed every texture and buffer in the GLB");
  let triangleCount = 0;
  const bounds: PropBounds = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
  for (const mesh of document.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    const mode = primitive.mode ?? 4;
    const count = document.accessors?.[primitive.indices ?? primitive.attributes?.POSITION ?? -1]?.count ?? 0;
    triangleCount += mode === 4 ? Math.floor(count / 3) : [5, 6].includes(mode) ? Math.max(0, count - 2) : 0;
    const positions = primitive.attributes?.POSITION === undefined ? undefined : document.accessors?.[primitive.attributes.POSITION];
    if (positions?.min?.length === 3 && positions.max?.length === 3) {
      bounds.min = { x: Math.min(bounds.min.x, positions.min[0]), y: Math.min(bounds.min.y, positions.min[1]), z: Math.min(bounds.min.z, positions.min[2]) };
      bounds.max = { x: Math.max(bounds.max.x, positions.max[0]), y: Math.max(bounds.max.y, positions.max[1]), z: Math.max(bounds.max.z, positions.max[2]) };
    }
  }
  if (triangleCount > MAX_PROP_TRIANGLES) throw new Error(`Props are limited to ${MAX_PROP_TRIANGLES.toLocaleString()} triangles. This GLB contains ${triangleCount.toLocaleString()}.`);
  if (!Number.isFinite(bounds.min.x)) throw new Error("The GLB has no bounded mesh position data");
  return { triangleCount, bounds };
}

export interface StorePropOptions {
  name: string; description: string; source: PropAsset["source"]; profile: AttachmentProfile;
  acceptedSurfaceTags: PropAsset["acceptedSurfaceTags"]; providedSurfaces: AttachmentSurface[];
  collisionMode: PropCollisionMode; forwardAnchor: PropAsset["forwardAnchor"]; behavior: PropBehavior;
  defaultPlacementScale?: number; sourceImage?: File | null; prompt?: string;
}

export async function storePropModel(file: File, options: StorePropOptions): Promise<PropAsset> {
  const inspected = await inspectPropModel(file);
  const key = await storageKey(file);
  await set(key, new Blob([file], { type: "model/gltf-binary" }), PROP_DATABASE);
  const now = new Date().toISOString();
  const bottomAnchor = { x: (inspected.bounds.min.x + inspected.bounds.max.x) / 2, y: inspected.bounds.min.y, z: (inspected.bounds.min.z + inspected.bounds.max.z) / 2 };
  let sourceImage: TokenSourceImage | undefined;
  if (options.sourceImage) {
    if (!options.sourceImage.type.startsWith("image/") || options.sourceImage.size > 20 * 1024 * 1024) throw new Error("Reference images must be PNG, JPEG, or WebP under 20 MB");
    const imageKey = await storageKey(options.sourceImage);
    await set(imageKey, new Blob([options.sourceImage], { type: options.sourceImage.type }), SOURCE_DATABASE);
    sourceImage = { storageKey: imageKey, filename: options.sourceImage.name, byteLength: options.sourceImage.size, mimeType: options.sourceImage.type };
  }
  return { id: `prop-custom-${crypto.randomUUID()}`, name: options.name.trim() || file.name.replace(/\.glb$/i, ""), description: options.description.trim(), storageKey: key, filename: file.name, byteLength: file.size, triangleCount: inspected.triangleCount, source: options.source, sourceImage, profile: options.profile, acceptedSurfaceTags: options.acceptedSurfaceTags, providedSurfaces: options.providedSurfaces, bounds: inspected.bounds, collisionMode: options.collisionMode, bottomAnchor, forwardAnchor: options.forwardAnchor, defaultBehavior: options.behavior, defaultPlacementScale: Math.min(4, Math.max(.05, options.defaultPlacementScale ?? 1)), revisions: [{ id: crypto.randomUUID(), storageKey: key, filename: file.name, byteLength: file.size, createdAt: now, prompt: options.prompt }], createdAt: now, updatedAt: now, gameplayAuthority: "mesh-prop" };
}

export async function getStoredPropModel(key: string): Promise<ArrayBuffer | null> { const blob = await get<Blob>(key, PROP_DATABASE); return blob ? blob.arrayBuffer() : null; }
export async function getStoredPropSource(key: string): Promise<Blob | null> { return (await get<Blob>(key, SOURCE_DATABASE)) ?? null; }
export async function deleteStoredPropModel(key: string): Promise<void> { await del(key, PROP_DATABASE); }
