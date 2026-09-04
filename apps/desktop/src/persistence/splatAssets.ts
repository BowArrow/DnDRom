import { get, set } from "idb-keyval";
import type { SplatBounds, SplatFormat, SplatQualityReport, SplatScenery, Vec3 } from "../domain/types";
import { createAssetStore } from "./assetDatabase";

const SPLAT_DATABASE = createAssetStore("gaussian-splats");
export const MAX_SPLAT_IMPORT_BYTES = 512 * 1024 * 1024;

export interface SplatInspection {
  format: SplatFormat;
  splatCount?: number;
  bounds?: SplatBounds;
  quality?: SplatQualityMetrics;
}

export interface SplatQualityMetrics {
  /** Robust source-space span (1st to 99th percentile) used to ignore isolated training outliers. */
  robustSpan: number;
  medianScale: number;
  p90Scale: number;
  p99Scale: number;
  visibleP99Scale: number;
  recommendedMaxScale: number;
}

export interface GeneratedWorldQuality {
  accepted: boolean;
  /** True when the source is dense and spatially valid, but oversized
   * Gaussians must be removed before it is safe to render. */
  repairable: boolean;
  reasons: string[];
}

export const MIN_GENERATED_WORLD_SPLATS = 80_000;

export interface SplatTabletopFootprint {
  width: number;
  depth: number;
  gridSize: number;
  /** Presentation scenery may extend slightly beyond the gameplay board. */
  margin?: number;
}

interface PlyProperty {
  name: string;
  type: string;
  offset: number;
}

interface PlyElement {
  name: string;
  count: number;
  properties: PlyProperty[];
  stride: number;
}

const PLY_TYPE_BYTES: Record<string, number> = {
  char: 1, int8: 1, uchar: 1, uint8: 1,
  short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4,
  double: 8, float64: 8,
};

const readPlyScalar = (view: DataView, offset: number, type: string): number => {
  switch (type) {
    case "char": case "int8": return view.getInt8(offset);
    case "uchar": case "uint8": return view.getUint8(offset);
    case "short": case "int16": return view.getInt16(offset, true);
    case "ushort": case "uint16": return view.getUint16(offset, true);
    case "int": case "int32": return view.getInt32(offset, true);
    case "uint": case "uint32": return view.getUint32(offset, true);
    case "float": case "float32": return view.getFloat32(offset, true);
    case "double": case "float64": return view.getFloat64(offset, true);
    default: return Number.NaN;
  }
};

const findHeaderEnd = (bytes: Uint8Array): number => {
  const marker = new TextEncoder().encode("end_header");
  outer: for (let index = 0; index <= bytes.length - marker.length; index++) {
    for (let markerIndex = 0; markerIndex < marker.length; markerIndex++) {
      if (bytes[index + markerIndex] !== marker[markerIndex]) continue outer;
    }
    let end = index + marker.length;
    if (bytes[end] === 13) end++;
    if (bytes[end] === 10) end++;
    return end;
  }
  return -1;
};

const parsePlyElements = (headerText: string): PlyElement[] => {
  const elements: PlyElement[] = [];
  let current: PlyElement | null = null;
  for (const rawLine of headerText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const element = line.match(/^element\s+(\S+)\s+(\d+)$/i);
    if (element) {
      current = { name: element[1].toLowerCase(), count: Number(element[2]), properties: [], stride: 0 };
      elements.push(current);
      continue;
    }
    const property = line.match(/^property\s+(\S+)\s+(\S+)$/i);
    if (!current || !property) continue;
    const type = property[1].toLowerCase();
    const bytes = PLY_TYPE_BYTES[type];
    if (!bytes) continue;
    current.properties.push({ name: property[2].toLowerCase(), type, offset: current.stride });
    current.stride += bytes;
  }
  return elements;
};

const mergeBounds = (bounds: SplatBounds | undefined, point: Vec3): SplatBounds => bounds ? ({
  min: { x: Math.min(bounds.min.x, point.x), y: Math.min(bounds.min.y, point.y), z: Math.min(bounds.min.z, point.z) },
  max: { x: Math.max(bounds.max.x, point.x), y: Math.max(bounds.max.y, point.y), z: Math.max(bounds.max.z, point.z) },
}) : ({ min: { ...point }, max: { ...point } });

const percentile = (values: number[], fraction: number): number => {
  if (!values.length) return 0;
  values.sort((left, right) => left - right);
  return values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * fraction)))];
};

const inspectBinaryData = async (file: Blob, headerBytes: number, elements: PlyElement[], compressed: boolean): Promise<Pick<SplatInspection, "bounds" | "quality">> => {
  const target = elements.find((element) => element.name === (compressed ? "chunk" : "vertex"));
  if (!target?.count || !target.stride) return {};
  const precedingBytes = elements.slice(0, elements.indexOf(target)).reduce((total, element) => total + element.count * element.stride, 0);
  const startOffset = headerBytes + precedingBytes;
  if (startOffset + target.count * target.stride > file.size) return {};

  const property = (name: string) => target.properties.find((entry) => entry.name === name);
  const x = property(compressed ? "min_x" : "x");
  const y = property(compressed ? "min_y" : "y");
  const z = property(compressed ? "min_z" : "z");
  const maxX = compressed ? property("max_x") : x;
  const maxY = compressed ? property("max_y") : y;
  const maxZ = compressed ? property("max_z") : z;
  if (!x || !y || !z || !maxX || !maxY || !maxZ) return {};

  const scale0 = compressed ? undefined : property("scale_0");
  const scale1 = compressed ? undefined : property("scale_1");
  const scale2 = compressed ? undefined : property("scale_2");
  const opacity = compressed ? undefined : property("opacity");
  const positions = { x: [] as number[], y: [] as number[], z: [] as number[] };
  const scales: number[] = [];
  const visibleScales: number[] = [];

  let bounds: SplatBounds | undefined;
  const recordsPerRead = Math.max(1, Math.floor((4 * 1024 * 1024) / target.stride));
  for (let first = 0; first < target.count; first += recordsPerRead) {
    const count = Math.min(recordsPerRead, target.count - first);
    const buffer = await file.slice(startOffset + first * target.stride, startOffset + (first + count) * target.stride).arrayBuffer();
    const view = new DataView(buffer);
    for (let row = 0; row < count; row++) {
      const base = row * target.stride;
      const minPoint = { x: readPlyScalar(view, base + x.offset, x.type), y: readPlyScalar(view, base + y.offset, y.type), z: readPlyScalar(view, base + z.offset, z.type) };
      const maxPoint = { x: readPlyScalar(view, base + maxX.offset, maxX.type), y: readPlyScalar(view, base + maxY.offset, maxY.type), z: readPlyScalar(view, base + maxZ.offset, maxZ.type) };
      if (Object.values(minPoint).every(Number.isFinite)) {
        bounds = mergeBounds(bounds, minPoint);
        if (!compressed) {
          positions.x.push(minPoint.x);
          positions.y.push(minPoint.y);
          positions.z.push(minPoint.z);
        }
      }
      if (Object.values(maxPoint).every(Number.isFinite)) bounds = mergeBounds(bounds, maxPoint);
      if (scale0 && scale1 && scale2) {
        const linearScale = Math.exp(Math.max(
          readPlyScalar(view, base + scale0.offset, scale0.type),
          readPlyScalar(view, base + scale1.offset, scale1.type),
          readPlyScalar(view, base + scale2.offset, scale2.type),
        ));
        if (Number.isFinite(linearScale)) {
          scales.push(linearScale);
          const rawOpacity = opacity ? readPlyScalar(view, base + opacity.offset, opacity.type) : Number.POSITIVE_INFINITY;
          const linearOpacity = 1 / (1 + Math.exp(-rawOpacity));
          if (linearOpacity >= .05) visibleScales.push(linearScale);
        }
      }
    }
  }
  if (compressed || positions.x.length < 100 || !scales.length) return { ...(bounds ? { bounds } : {}) };
  const robustBounds: SplatBounds = {
    min: { x: percentile(positions.x, .01), y: percentile(positions.y, .01), z: percentile(positions.z, .01) },
    max: { x: percentile(positions.x, .99), y: percentile(positions.y, .99), z: percentile(positions.z, .99) },
  };
  const robustSpan = Math.max(
    robustBounds.max.x - robustBounds.min.x,
    robustBounds.max.y - robustBounds.min.y,
    robustBounds.max.z - robustBounds.min.z,
  );
  return {
    bounds: robustBounds,
    quality: {
      robustSpan,
      medianScale: percentile(scales, .5),
      p90Scale: percentile(scales, .9),
      p99Scale: percentile(scales, .99),
      visibleP99Scale: percentile(visibleScales, .99),
      recommendedMaxScale: robustSpan * .035,
    },
  };
};

export function assessGeneratedWorldSplat(inspection: SplatInspection): GeneratedWorldQuality {
  const fatalReasons: string[] = [];
  const repairableReasons: string[] = [];
  const count = inspection.splatCount ?? 0;
  if (count < MIN_GENERATED_WORLD_SPLATS) fatalReasons.push(`only ${count.toLocaleString()} Gaussians were trained (${MIN_GENERATED_WORLD_SPLATS.toLocaleString()} minimum)`);
  const metrics = inspection.quality;
  if (!metrics || metrics.robustSpan <= 0) {
    fatalReasons.push("Gaussian scale distribution could not be validated");
  } else {
    const p90Ratio = metrics.p90Scale / metrics.robustSpan;
    const p99Ratio = metrics.p99Scale / metrics.robustSpan;
    const visibleRatio = metrics.visibleP99Scale / metrics.robustSpan;
    if (p90Ratio > .02 || p99Ratio > .05 || visibleRatio > .05) {
      repairableReasons.push("oversized Gaussian outliers must be removed before rendering");
    }
  }
  const reasons = [...fatalReasons, ...repairableReasons];
  return {
    accepted: reasons.length === 0,
    repairable: fatalReasons.length === 0 && repairableReasons.length > 0,
    reasons,
  };
}

export function assertGeneratedWorldSplatQuality(inspection: SplatInspection): void {
  const result = assessGeneratedWorldSplat(inspection);
  if (!result.accepted) {
    throw new Error(`World reconstruction failed the playable-scene quality check: ${result.reasons.join("; ")}. The camera dataset was preserved for a true retry and the broken result was not added to the scene.`);
  }
}

export function fitSplatBoundsToTabletop(bounds: SplatBounds, footprint: SplatTabletopFootprint): Pick<SplatScenery, "position" | "rotation" | "scale"> {
  const spanX = Math.max(1e-6, bounds.max.x - bounds.min.x);
  const spanZ = Math.max(1e-6, bounds.max.z - bounds.min.z);
  const margin = Math.max(1, footprint.margin ?? 1.2);
  const worldWidth = Math.max(1, footprint.width * footprint.gridSize) * margin;
  const worldDepth = Math.max(1, footprint.depth * footprint.gridSize) * margin;
  const scalar = Math.min(worldWidth / spanX, worldDepth / spanZ);
  const centerX = (bounds.min.x + bounds.max.x) * .5;
  const centerZ = (bounds.min.z + bounds.max.z) * .5;
  // Brush exports Y-up. The existing 180 degree correction flips Y and Z, so
  // the source maximum Y becomes the rendered ground and Z centering changes sign.
  return {
    position: { x: -centerX * scalar, y: bounds.max.y * scalar, z: centerZ * scalar },
    rotation: { x: 180, y: 0, z: 0 },
    scale: { x: scalar, y: scalar, z: scalar },
  };
}

/** Preserve reconstruction scale and align its ground instead of stretching
 * an uncertain point cloud across the authoritative tabletop. */
export function alignGeneratedSplatToWorld(bounds: SplatBounds): Pick<SplatScenery, "position" | "rotation" | "scale"> {
  const centerX = (bounds.min.x + bounds.max.x) * .5;
  const centerZ = (bounds.min.z + bounds.max.z) * .5;
  return { position: { x: -centerX, y: bounds.max.y, z: centerZ }, rotation: { x: 180, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
}

export function assessSplatReconstructionQuality(report: Omit<SplatQualityReport, "accepted" | "reasons">): SplatQualityReport {
  const reasons: string[] = [];
  if (report.registeredCameraRatio < .8) reasons.push("fewer than 80% of cameras registered");
  if (report.railRegistrationRatios.length < 4 || report.railRegistrationRatios.some((ratio) => ratio < .5)) reasons.push("every camera rail must contribute at least 50% of its views");
  if (report.largestComponentRatio < .85) reasons.push("the largest reconstructed component contains less than 85% of points");
  if (report.gaussianCount < MIN_GENERATED_WORLD_SPLATS) reasons.push(`fewer than ${MIN_GENERATED_WORLD_SPLATS.toLocaleString()} readable Gaussians remain`);
  if (report.groundPlaneSupport < .6) reasons.push("the reconstructed ground plane is not reliable");
  if (!Number.isFinite(report.boundsToRailRatio) || report.boundsToRailRatio < .5 || report.boundsToRailRatio > 20) reasons.push("reconstruction scale is implausible relative to its camera rails");
  if (report.oversizedGaussianSheetDetected) reasons.push("an oversized Gaussian sheet or cloud was detected");
  if (report.gameplayVolumeIntersection) reasons.push("presentation Gaussians intersect the protected gameplay volume");
  return { ...report, accepted: reasons.length === 0, reasons };
}

const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

export async function inspectSplatFile(file: Blob & { name?: string }): Promise<SplatInspection> {
  const filename = file.name?.toLowerCase() ?? "";
  if (file.size <= 0) throw new Error("The splat file is empty");
  if (file.size > MAX_SPLAT_IMPORT_BYTES) throw new Error("Splat imports are limited to 512 MB. Compress or crop the scene first.");
  if (filename.endsWith(".sog")) return { format: "sog" };
  if (!filename.endsWith(".ply")) throw new Error("Import a Gaussian .ply, .compressed.ply, or bundled .sog file");

  const prefix = new Uint8Array(await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer());
  const headerBytes = findHeaderEnd(prefix);
  const header = new TextDecoder().decode(prefix.slice(0, Math.max(0, headerBytes)));
  if (!header.startsWith("ply") || headerBytes < 0) throw new Error("This is not a valid PLY file");
  const headerText = header.slice(0, header.indexOf("end_header"));
  const vertexMatch = headerText.match(/element\s+vertex\s+(\d+)/i);
  const splatCount = vertexMatch ? Number(vertexMatch[1]) : undefined;
  const standard = ["x", "y", "z", "scale_0", "rot_0", "f_dc_0", "opacity"].every((property) => new RegExp(`property\\s+\\w+\\s+${property}(?:\\s|$)`, "m").test(headerText));
  const compressed = /property\s+\w+\s+packed_position(?:\s|$)/m.test(headerText);
  if (!standard && !compressed) throw new Error("The PLY does not contain Gaussian-splat properties. Export a trained 3DGS PLY, not a mesh PLY.");
  const isBinaryLittleEndian = /format\s+binary_little_endian\s+1\.0/i.test(headerText);
  const spatial = isBinaryLittleEndian ? await inspectBinaryData(file, headerBytes, parsePlyElements(headerText), compressed) : {};
  return { format: compressed || filename.endsWith(".compressed.ply") ? "compressed-ply" : "ply", splatCount, ...spatial };
}

export async function storeSplatFile(
  file: File,
  source: SplatScenery["source"] = "import",
  options?: { sourceInspection?: SplatInspection; tabletop?: SplatTabletopFootprint; qualityReport?: SplatQualityReport; chunkIndexStorageKey?: string },
): Promise<SplatScenery> {
  const inspection = await inspectSplatFile(file);
  const spatialInspection = options?.sourceInspection?.bounds ? options.sourceInspection : inspection;
  const fitted = source === "splatkit" && spatialInspection.bounds
    ? alignGeneratedSplatToWorld(spatialInspection.bounds)
    : null;
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
    splatCount: inspection.splatCount ?? options?.sourceInspection?.splatCount,
    bounds: spatialInspection.bounds,
    qualityReport: options?.qualityReport,
    chunkIndexStorageKey: options?.chunkIndexStorageKey,
    clipBounds: source === "splatkit" && options?.tabletop ? {
      min: { x: -options.tabletop.width * options.tabletop.gridSize / 2 - 2, y: -10, z: -options.tabletop.depth * options.tabletop.gridSize / 2 - 2 },
      max: { x: options.tabletop.width * options.tabletop.gridSize / 2 + 2, y: 30, z: options.tabletop.depth * options.tabletop.gridSize / 2 + 2 },
    } : undefined,
    fitMode: "manual",
    position: fitted?.position ?? { x: 0, y: 0, z: 0 },
    rotation: fitted?.rotation ?? { x: inspection.format === "sog" ? 0 : 180, y: 0, z: 0 },
    scale: fitted?.scale ?? { x: 1, y: 1, z: 1 },
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
