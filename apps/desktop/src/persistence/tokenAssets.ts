import { del, get, set } from "idb-keyval";
import type { TokenAnimation, TokenAsset, TokenBaseShape, TokenKind, TokenModelRevision, TokenRigFile, TokenSourceImage, TokenVisualState } from "../domain/types";
import { MAX_MINIATURE_FACES } from "../domain/meshBudget";
import { createAssetStore } from "./assetDatabase";

const TOKEN_DATABASE = createAssetStore("mesh-tokens");
export const MAX_TOKEN_MODEL_BYTES = 128 * 1024 * 1024;

export interface TokenAssetOptions {
  name: string;
  kind: TokenKind;
  baseShape: TokenBaseShape;
  baseColor: string;
  accentColor: string;
  footprint: number;
  modelScale: number;
  modelLift?: number;
  defaultPlacementScale: number;
  characterId?: string;
  source: TokenAsset["source"];
  sourceImageName?: string;
  sourceImage?: File | null;
  originalSourceImage?: File | null;
  states?: TokenVisualState[];
  defaultStateId?: string;
}

/** Revisions keep catalogue identity and assignments that are not part of a regenerated GLB. */
export function mergeTokenAssetRevision(created: TokenAsset, previous?: TokenAsset): TokenAsset {
  return previous ? {
    ...created,
    id: previous.id,
    createdAt: previous.createdAt,
    defaultBasePlateAssetId: previous.defaultBasePlateAssetId,
    formBasePlateAssignments: previous.formBasePlateAssignments,
  } : created;
}

const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

interface GlbDocument {
  images?: { uri?: string }[];
  buffers?: { uri?: string }[];
  accessors?: { count?: number }[];
  meshes?: { primitives?: { mode?: number; indices?: number; attributes?: { POSITION?: number } }[] }[];
}

function countTriangleFaces(document: GlbDocument): number {
  return (document.meshes ?? []).reduce((total, mesh) => total + (mesh.primitives ?? []).reduce((meshTotal, primitive) => {
    const mode = primitive.mode ?? 4;
    if (![4, 5, 6].includes(mode)) return meshTotal;
    const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
    const elementCount = accessorIndex === undefined ? 0 : document.accessors?.[accessorIndex]?.count ?? 0;
    const faceCount = mode === 4 ? Math.floor(elementCount / 3) : Math.max(0, elementCount - 2);
    return meshTotal + faceCount;
  }, 0), 0);
}

export async function inspectTokenModel(file: Blob & { name?: string }): Promise<void> {
  if (file.size <= 0) throw new Error("The 3D token file is empty");
  if (file.size > MAX_TOKEN_MODEL_BYTES) throw new Error("Token models are limited to 128 MB. Decimate the mesh and reduce its texture size first.");
  if (!file.name?.toLowerCase().endsWith(".glb")) throw new Error("Import a binary glTF .glb model");
  if (file.size < 20) throw new Error("This is not a valid GLB file");
  const header = new DataView(await file.slice(0, 12).arrayBuffer());
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2) {
    throw new Error("This is not a valid glTF 2.0 GLB file");
  }
  if (header.getUint32(8, true) !== file.size) throw new Error("The GLB length header does not match the file size");
  if (file.size >= 20) {
    const chunkHeader = new DataView(await file.slice(12, 20).arrayBuffer());
    const jsonLength = chunkHeader.getUint32(0, true);
    const jsonType = chunkHeader.getUint32(4, true);
    if (jsonType === 0x4e4f534a && jsonLength > 0 && 20 + jsonLength <= file.size) {
      try {
        const document = JSON.parse(new TextDecoder().decode(await file.slice(20, 20 + jsonLength).arrayBuffer()).trim()) as GlbDocument;
        const externalUris = [...(document.images ?? []), ...(document.buffers ?? [])]
          .map((entry) => entry.uri)
          .filter((uri): uri is string => Boolean(uri && !uri.startsWith("data:")));
        if (externalUris.length) throw new Error(`This GLB references external files (${externalUris.slice(0, 3).join(", ")}). Export a self-contained GLB with textures and buffers embedded.`);
        const faceCount = countTriangleFaces(document);
        if (faceCount > MAX_MINIATURE_FACES) {
          throw new Error(`Miniatures are limited to ${MAX_MINIATURE_FACES.toLocaleString()} triangle faces. This model contains ${faceCount.toLocaleString()}; decimate it before importing.`);
        }
      } catch (error) {
        if (error instanceof Error && (error.message.includes("references external files") || error.message.includes("triangle faces"))) throw error;
        throw new Error("The GLB contains an unreadable glTF document");
      }
    }
  }
}

export async function storeTokenModel(file: File, options: TokenAssetOptions): Promise<TokenAsset> {
  await inspectTokenModel(file);
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const storageKey = `sha256:${bytesToHex(new Uint8Array(digest))}`;
  await set(storageKey, new Blob([file], { type: "model/gltf-binary" }), TOKEN_DATABASE);
  return {
    id: `token-custom-${crypto.randomUUID()}`,
    name: options.name.trim() || file.name.replace(/\.glb$/i, "") || "Custom miniature",
    kind: options.kind,
    storageKey,
    filename: file.name,
    byteLength: file.size,
    footprint: Math.min(3, Math.max(0.35, options.footprint)),
    modelScale: Math.min(20, Math.max(0.01, options.modelScale)),
    modelLift: Math.min(5, Math.max(-2, options.modelLift ?? 0.62)),
    defaultPlacementScale: Math.min(4, Math.max(0.25, options.defaultPlacementScale)),
    base: {
      shape: options.baseShape,
      color: options.baseColor,
      accentColor: options.accentColor,
      height: options.kind === "boss" ? 0.18 : 0.14,
    },
    characterId: options.characterId,
    source: options.source,
    sourceImageName: options.sourceImageName,
    sourceImage: options.sourceImage ? await storeTokenSourceImage(options.sourceImage) : undefined,
    originalSourceImage: options.originalSourceImage ? await storeTokenSourceImage(options.originalSourceImage) : undefined,
    states: options.states,
    defaultStateId: options.defaultStateId,
    createdAt: new Date().toISOString(),
    gameplayAuthority: "mesh-token",
  };
}

async function storeTokenBlob(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const storageKey = `sha256:${bytesToHex(new Uint8Array(digest))}`;
  await set(storageKey, new Blob([file], { type: file.type || "application/octet-stream" }), TOKEN_DATABASE);
  return storageKey;
}

async function storeTokenSourceImage(file: File): Promise<TokenSourceImage> {
  if (!file.type.startsWith("image/") || file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error("Character reference images must be PNG, JPEG, or WebP files smaller than 20 MB");
  return { storageKey: await storeTokenBlob(file), filename: file.name, byteLength: file.size, mimeType: file.type };
}

export async function storeTokenStateModel(file: File, options: { id?: string; formId?: string; name: string; styleName?: string; modelScale: number; modelLift: number; animations?: TokenAnimation[]; rig?: TokenRigFile; revisions?: TokenModelRevision[] }): Promise<TokenVisualState> {
  await inspectTokenModel(file);
  return {
    id: options.id ?? `token-state-${crypto.randomUUID()}`,
    formId: options.formId,
    name: options.name.trim() || file.name.replace(/\.glb$/i, "") || "Alternate form",
    styleName: options.styleName?.trim() || "Classic",
    storageKey: await storeTokenBlob(file),
    filename: file.name,
    byteLength: file.size,
    modelScale: Math.min(20, Math.max(.01, options.modelScale)),
    modelLift: Math.min(5, Math.max(-2, options.modelLift)),
    animations: options.animations ?? [],
    rig: options.rig,
    revisions: options.revisions ?? [],
    createdAt: new Date().toISOString(),
  };
}

export async function storeTokenRevisionModel(file: File, options: { id?: string; createdAt?: string; prompt?: string; source: TokenModelRevision["source"] }): Promise<TokenModelRevision> {
  await inspectTokenModel(file);
  return {
    id: options.id ?? `token-revision-${crypto.randomUUID()}`,
    storageKey: await storeTokenBlob(file),
    filename: file.name,
    byteLength: file.size,
    createdAt: options.createdAt ?? new Date().toISOString(),
    prompt: options.prompt,
    source: options.source,
  };
}

export async function storeTokenAnimationFile(file: File): Promise<NonNullable<TokenAnimation["sourceFile"]>> {
  const extension = file.name.toLowerCase().endsWith(".glb") ? "glb" : file.name.toLowerCase().endsWith(".fbx") ? "fbx" : null;
  if (!extension) throw new Error("Animation files must be FBX or animated GLB files");
  if (file.size <= 0 || file.size > MAX_TOKEN_MODEL_BYTES) throw new Error("Animation files must be between 1 byte and 128 MB");
  return { storageKey: await storeTokenBlob(file), filename: file.name, byteLength: file.size, format: extension };
}

export async function storeTokenRigFile(file: File, profile: TokenRigFile["profile"], createdAt = new Date().toISOString()): Promise<TokenRigFile> {
  const extension = file.name.toLowerCase().endsWith(".glb") ? "glb" : file.name.toLowerCase().endsWith(".fbx") ? "fbx" : null;
  if (!extension) throw new Error("Rig files must be FBX or animated GLB files");
  if (file.size <= 0 || file.size > MAX_TOKEN_MODEL_BYTES) throw new Error("Rig files must be between 1 byte and 128 MB");
  return { storageKey: await storeTokenBlob(file), filename: file.name, byteLength: file.size, format: extension, profile, createdAt };
}

export async function getStoredTokenModel(storageKey: string): Promise<ArrayBuffer | null> {
  const blob = await get<Blob>(storageKey, TOKEN_DATABASE);
  return blob ? await blob.arrayBuffer() : null;
}

export async function deleteStoredTokenModel(storageKey: string): Promise<void> {
  await del(storageKey, TOKEN_DATABASE);
}
