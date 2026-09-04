import type { ComfyWorkflowPreset } from "./comfyWorkflowPreset";
import { generateCharacterGlb, type CharacterGenerationProgress } from "./character3dClient";

export const BASE_PLATE_TARGET_FACES = 6_000;

/**
 * Converts an approved full-base concept into the one authoritative scenic
 * topper mesh. It deliberately reuses the pinned local Pixal3D graph used by
 * Character Forge, while giving the result its own output namespace and mesh
 * budget. No procedural scenery is introduced by this path.
 */
export function generateBasePlateGlb(
  baseUrl: string,
  approvedConcept: File,
  workflow: ComfyWorkflowPreset,
  signal?: AbortSignal,
  onProgress?: (progress: CharacterGenerationProgress) => void,
): Promise<File> {
  return generateCharacterGlb(baseUrl, approvedConcept, workflow, {
    provider: "pixal3d",
    targetFaces: BASE_PLATE_TARGET_FACES,
    outputPrefix: "dndrom/baseplate",
    assetLabel: "scenic baseplate",
  }, signal, onProgress);
}
