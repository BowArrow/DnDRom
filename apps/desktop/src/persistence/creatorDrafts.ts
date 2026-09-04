import { del, get, set } from "idb-keyval";
import type { Character3dProvider } from "../ai/character3dClient";
import type { SceneLightingSettings, TokenAnimation, TokenBaseShape, TokenKind, WorldBlueprintV1, WorldForgeQuality, WorldRegionKind, WorldRegionSize } from "../domain/types";
import type { CharacterRigProfile } from "../ai/characterRigClient";

export interface CharacterForgeDraft {
  name: string;
  kind: TokenKind;
  provider: Character3dProvider;
  characterId: string;
  baseShape: TokenBaseShape;
  baseColor: string;
  accentColor: string;
  footprint: number;
  modelScale: number;
  placementScale: number;
  targetFaces: number;
  previewLighting?: Partial<SceneLightingSettings>;
  drawingName?: string;
  modelName?: string;
  editPrompt?: string;
  editStrength?: number;
  rigProfile?: CharacterRigProfile;
  rigName?: string;
  activeStateId?: string;
  states?: Array<{
    id: string;
    formId?: string;
    name: string;
    styleName?: string;
    modelSlot?: `character-state-${string}`;
    modelName?: string;
    rigSlot?: `character-rig-${string}`;
    rigName?: string;
    rigProfile?: CharacterRigProfile;
    rigCreatedAt?: string;
    animations: Array<TokenAnimation & { fileSlot?: `character-animation-${string}` }>;
    revisions?: Array<{
      id: string;
      fileSlot: `character-revision-${string}`;
      createdAt: string;
      prompt?: string;
      source: "generated" | "prompt-edit" | "paint" | "import";
    }>;
  }>;
  updatedAt: string;
}

export interface SceneForgeDraft {
  sourceMode: "prompt" | "library" | "upload";
  description: string;
  selectedHdriId: string;
  panoramaName?: string;
  retryWorldFromPanorama?: boolean;
  regionKind?: WorldRegionKind | "auto";
  biome?: import("../domain/types").WorldBiomeSpec["id"] | "auto";
  useAdventureContext?: boolean;
  regionSize?: WorldRegionSize;
  gridShape?: "square" | "hex";
  worldQuality?: WorldForgeQuality;
  seed?: number;
  concepts?: WorldBlueprintV1[];
  selectedConceptId?: string;
  updatedAt: string;
}

const metadataKey = (campaignId: string, kind: "character" | "scene") => `dndrom.creator.${campaignId}.${kind}.v1`;
const fileKey = (campaignId: string, slot: string) => `dndrom:creator:${campaignId}:${slot}:v1`;
export type CreatorDraftFileSlot = "character-drawing" | "character-original" | "character-model" | "character-rig" | "scene-panorama" | "scene-world-draft" | `character-state-${string}` | `character-rig-${string}` | `character-animation-${string}` | `character-revision-${string}`;

export function readCreatorDraft<T>(campaignId: string, kind: "character" | "scene"): T | null {
  try {
    const value = window.localStorage.getItem(metadataKey(campaignId, kind));
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

export function writeCreatorDraft<T>(campaignId: string, kind: "character" | "scene", value: T): void {
  window.localStorage.setItem(metadataKey(campaignId, kind), JSON.stringify(value));
}

export function clearCreatorDraft(campaignId: string, kind: "character" | "scene"): void {
  window.localStorage.removeItem(metadataKey(campaignId, kind));
}

export async function readCreatorDraftFile(campaignId: string, slot: CreatorDraftFileSlot): Promise<File | null> {
  if (typeof indexedDB === "undefined") return null;
  const value = await get<Blob | File>(fileKey(campaignId, slot));
  if (!value) return null;
  return value instanceof File ? value : new File([value], slot, { type: value.type });
}

export async function writeCreatorDraftFile(campaignId: string, slot: CreatorDraftFileSlot, file: File | null): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  if (file) await set(fileKey(campaignId, slot), file);
  else await del(fileKey(campaignId, slot));
}

export async function clearCreatorDraftFiles(campaignId: string, kind: "character" | "scene"): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const draft = kind === "character" ? readCreatorDraft<CharacterForgeDraft>(campaignId, "character") : null;
  const dynamicSlots = draft?.states?.flatMap((state) => [
    ...(state.modelSlot ? [state.modelSlot] : []),
    ...(state.rigSlot ? [state.rigSlot] : []),
    ...state.animations.flatMap((animation) => animation.fileSlot ? [animation.fileSlot] : []),
    ...(state.revisions?.map((revision) => revision.fileSlot) ?? []),
  ]) ?? [];
  const slots: CreatorDraftFileSlot[] = kind === "character"
    ? ["character-drawing", "character-original", "character-model", "character-rig", ...dynamicSlots]
    : ["scene-panorama", "scene-world-draft"];
  await Promise.all(slots.map((slot) => del(fileKey(campaignId, slot))));
}
