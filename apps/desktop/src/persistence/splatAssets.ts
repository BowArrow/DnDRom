import { createStore, get, set } from "idb-keyval";
import type { SplatFormat, SplatScenery } from "../domain/types";

const SPLAT_DATABASE = createStore("dndrom-assets-v1", "gaussian-splats");
export const MAX_SPLAT_IMPORT_BYTES = 512 * 1024 * 1024;

export interface SplatInspection {
  format: SplatFormat;
  splatCount?: number;
}

const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

export async function inspectSplatFile(file: Blob & { name?: string }): Promise<SplatInspection> {
  const filename = file.name?.toLowerCase() ?? "";
  if (file.size <= 0) throw new Error("The splat file is empty");
  if (file.size > MAX_SPLAT_IMPORT_BYTES) throw new Error("Splat imports are limited to 512 MB. Compress or crop the scene first.");
  if (filename.endsWith(".sog")) return { format: "sog" };
  if (!filename.endsWith(".ply")) throw new Error("Import a Gaussian .ply, .compressed.ply, or bundled .sog file");

  const header = await file.slice(0, Math.min(file.size, 256 * 1024)).text();
  const end = header.indexOf("end_header");
  if (!header.startsWith("ply") || end < 0) throw new Error("This is not a valid PLY file");
  const headerText = header.slice(0, end);
  const vertexMatch = headerText.match(/element\s+vertex\s+(\d+)/i);
  const splatCount = vertexMatch ? Number(vertexMatch[1]) : undefined;
  const standard = ["x", "y", "z", "scale_0", "rot_0", "f_dc_0", "opacity"].every((property) => new RegExp(`property\\s+\\w+\\s+${property}(?:\\s|$)`, "m").test(headerText));
  const compressed = /property\s+\w+\s+packed_position(?:\s|$)/m.test(headerText);
  if (!standard && !compressed) throw new Error("The PLY does not contain Gaussian-splat properties. Export a trained 3DGS PLY, not a mesh PLY.");
  return { format: compressed || filename.endsWith(".compressed.ply") ? "compressed-ply" : "ply", splatCount };
}

export async function storeSplatFile(file: File, source: SplatScenery["source"] = "import"): Promise<SplatScenery> {
  const inspection = await inspectSplatFile(file);
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const storageKey = `sha256:${bytesToHex(new Uint8Array(digest))}`;
  await set(storageKey, new Blob([file], { type: file.type || "application/octet-stream" }), SPLAT_DATABASE);
  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.(compressed\.)?(ply|sog)$/i, "") || "Generated scenery",
    storageKey,
    filename: file.name,
    format: inspection.format,
    byteLength: file.size,
    splatCount: inspection.splatCount,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: inspection.format === "sog" ? 0 : 180, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    enabled: true,
    source,
    sourceUrl: source === "splatkit" ? "https://github.com/mickmumpitz/ComfyUI-SplatKit" : undefined,
    license: source === "splatkit" ? "MIT pipeline; generated asset terms follow selected models" : undefined,
    gameplayAuthority: "presentation-only",
  };
}

export async function getStoredSplatResponse(storageKey: string): Promise<Response | null> {
  const blob = await get<Blob>(storageKey, SPLAT_DATABASE);
  if (!blob) return null;
  return new Response(blob, { headers: { "content-length": String(blob.size), "content-type": blob.type || "application/octet-stream" } });
}
