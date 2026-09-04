export const runtimeSplatFilename = (filename: string): string => filename
  .replace(/(?:\.compressed)?\.ply$/i, "") + ".compressed.ply";

export const needsRuntimeSplatCompression = (file: Pick<File, "name">): boolean => /\.ply$/i.test(file.name)
  && !/\.compressed\.ply$/i.test(file.name);

/**
 * Converts Brush's editable training PLY into PlayCanvas' compact runtime PLY.
 * The transform library works in chunks, so compression does not create a
 * second decoded copy of every Gaussian. SOG remains accepted for imported
 * worlds; compressed PLY is used here because it is deterministic and does not
 * compete with ComfyUI for a WebGPU device immediately after generation.
 */
export async function optimizeWorldSplatForRuntime(
  file: File,
  onProgress?: (message: string, percent: number) => void,
  options?: { maxGaussianScale?: number },
): Promise<File> {
  if (!needsRuntimeSplatCompression(file)) return file;
  onProgress?.("Reading trained Gaussian world…", 10);
  const {
    MemoryFileSystem,
    MemoryReadFileSystem,
    createChunkDataPool,
    getInputFormat,
    getOutputFormat,
    processSource,
    readFile,
    writeSource,
  } = await import("@playcanvas/splat-transform");
  const inputBytes = new Uint8Array(await file.arrayBuffer());
  const inputFs = new MemoryReadFileSystem();
  inputFs.set(file.name, inputBytes);
  const pool = createChunkDataPool();
  const sources = await readFile({
    filename: file.name,
    inputFormat: getInputFormat(file.name),
    fileSystem: inputFs,
  });
  const source = sources[0];
  if (!source) throw new Error("The trained world did not contain Gaussian splat data");
  const actions = [
    { kind: "filterNaN" as const },
    // splat-transform accepts user-facing linear values for scale_* and
    // converts them to Brush's logarithmic storage space internally.
    ...(options?.maxGaussianScale && Number.isFinite(options.maxGaussianScale)
      ? (["scale_0", "scale_1", "scale_2"] as const).map((columnName) => ({
          kind: "filterByValue" as const,
          columnName,
          comparator: "lt" as const,
          value: options.maxGaussianScale!,
        }))
      : []),
    { kind: "mortonOrder" as const },
  ];
  const processed = await processSource(source, actions, pool);
  const filename = runtimeSplatFilename(file.name);
  const outputFs = new MemoryFileSystem();
  try {
    onProgress?.("Compressing splats for real-time play…", 45);
    await writeSource({
      filename,
      outputFormat: getOutputFormat(filename, {}),
      source: processed,
      pool,
      options: {},
    }, outputFs);
  } finally {
    await processed.close();
  }
  const output = outputFs.results.get(filename);
  if (!output?.byteLength) throw new Error("Runtime splat compression completed without an output file");
  const owned = new Uint8Array(output.byteLength);
  owned.set(output);
  onProgress?.("Runtime splat asset ready", 100);
  return new File([owned.buffer], filename, { type: "application/octet-stream" });
}

export interface SplatTileOutput { id: string; file: File; bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }; lod: 0 | 1 | 2 }

/** Splits a trained PLY into independently loadable Morton-ordered tiles. */
export async function partitionWorldSplatForStreaming(
  file: File,
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
  tileSize = 32,
  onProgress?: (message: string, percent: number) => void,
  options?: { maxGaussianScale?: number },
): Promise<SplatTileOutput[]> {
  if (!/\.ply$/i.test(file.name) || /\.compressed\.ply$/i.test(file.name)) return [];
  const bytes = new Uint8Array(await file.arrayBuffer());
  const marker = new TextEncoder().encode("end_header");
  let headerEnd = -1;
  outer: for (let index = 0; index <= bytes.length - marker.length; index++) {
    for (let offset = 0; offset < marker.length; offset++) if (bytes[index + offset] !== marker[offset]) continue outer;
    headerEnd = index + marker.length; if (bytes[headerEnd] === 13) headerEnd++; if (bytes[headerEnd] === 10) headerEnd++; break;
  }
  if (headerEnd < 0) throw new Error("Cannot spatially tile a PLY without a complete header");
  const header = new TextDecoder().decode(bytes.slice(0, headerEnd));
  if (!/format\s+binary_little_endian\s+1\.0/i.test(header)) throw new Error("Spatial tiling requires Brush's binary little-endian PLY output");
  const lines = header.split(/\r?\n/); let inVertex = false, vertexCount = 0, stride = 0, xOffset = -1, zOffset = -1;
  const byteSizes: Record<string, number> = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  for (const line of lines) {
    const element = line.match(/^element\s+(\S+)\s+(\d+)/i);
    if (element) { inVertex = element[1].toLowerCase() === "vertex"; if (inVertex) vertexCount = Number(element[2]); continue; }
    const property = inVertex ? line.match(/^property\s+(\S+)\s+(\S+)/i) : null;
    if (!property) continue;
    const size = byteSizes[property[1].toLowerCase()] ?? 0;
    if (property[2].toLowerCase() === "x") xOffset = stride;
    if (property[2].toLowerCase() === "z") zOffset = stride;
    stride += size;
  }
  if (!vertexCount || !stride || xOffset < 0 || zOffset < 0 || headerEnd + vertexCount * stride > bytes.length) throw new Error("Spatial tiling could not read the Brush vertex records");
  const view = new DataView(bytes.buffer, bytes.byteOffset + headerEnd, vertexCount * stride);
  const columns = Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) / tileSize));
  const rows = Math.max(1, Math.ceil((bounds.max.z - bounds.min.z) / tileSize));
  const outputs: SplatTileOutput[] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const min = { x: bounds.min.x + column * tileSize, y: bounds.min.y, z: bounds.min.z + row * tileSize };
    const max = { x: Math.min(bounds.max.x, min.x + tileSize), y: bounds.max.y, z: Math.min(bounds.max.z, min.z + tileSize) };
    const selected: Uint8Array[] = [];
    for (let index = 0; index < vertexCount; index++) {
      const x = view.getFloat32(index * stride + xOffset, true), z = view.getFloat32(index * stride + zOffset, true);
      const lastColumn = column === columns - 1, lastRow = row === rows - 1;
      if (x >= min.x && (x < max.x || lastColumn && x <= max.x) && z >= min.z && (z < max.z || lastRow && z <= max.z)) selected.push(bytes.slice(headerEnd + index * stride, headerEnd + (index + 1) * stride));
    }
    if (selected.length) {
      const tileHeader = header.replace(/element\s+vertex\s+\d+/i, `element vertex ${selected.length}`);
      const rawParts: BlobPart[] = [tileHeader, ...selected.map((record) => { const owned = new Uint8Array(record.byteLength); owned.set(record); return owned.buffer; })];
      const raw = new File(rawParts, `tile-${column}-${row}.ply`, { type: "application/octet-stream" });
      const compressed = await optimizeWorldSplatForRuntime(raw, undefined, options);
      outputs.push({ id: `splat-${column}-${row}`, file: compressed, bounds: { min, max }, lod: 0 });
    }
    onProgress?.(`Partitioning background tile ${row * columns + column + 1} of ${rows * columns}`, Math.round(((row * columns + column + 1) / (rows * columns)) * 100));
  }
  return outputs;
}
