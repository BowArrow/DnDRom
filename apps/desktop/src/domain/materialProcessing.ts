import type { MaterialAsset } from "./types";

export function materialProjectionForGeometry(assetId: string, fallback: MaterialAsset["projection"]): MaterialAsset["projection"] {
  const id = assetId.toLowerCase();
  if (id.startsWith("floor-") || id.includes("floor") || id.includes("ground")) return "planar-xz";
  if (id.startsWith("wall-") || id.includes("wall")) return "planar-xy";
  if (id.includes("pillar") || id.includes("column")) return "triplanar";
  return fallback;
}

export function scoreOppositeEdgeContinuity(data: Uint8ClampedArray, width: number, height: number): number {
  if (width < 2 || height < 2 || data.length < width * height * 4) return 0;
  let difference = 0, samples = 0;
  const compare = (a: number, b: number) => { for (let channel = 0; channel < 3; channel++) difference += Math.abs(data[a + channel] - data[b + channel]); samples += 3; };
  for (let y = 0; y < height; y++) compare((y * width) * 4, (y * width + width - 1) * 4);
  for (let x = 0; x < width; x++) compare(x * 4, ((height - 1) * width + x) * 4);
  return Math.max(0, 1 - difference / Math.max(1, samples * 255));
}

const canvasFile = (canvas: HTMLCanvasElement, name: string): Promise<File> => new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(new File([blob], name, { type: "image/png" })) : reject(new Error("Could not encode the material map")), "image/png"));

export async function normalizeMaterialAlbedo(file: File): Promise<{ file: File; seamScore: number }> {
  if (!file.type.startsWith("image/") || file.size <= 0 || file.size > 32 * 1024 * 1024) throw new Error("Use a PNG, JPEG, or WebP material image under 32 MB");
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 1024;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0, 1024, 1024); bitmap.close();
  const image = context.getImageData(0, 0, 1024, 1024);
  const seamScore = scoreOppositeEdgeContinuity(image.data, 1024, 1024);
  if (seamScore < .94) {
    // Offset opposite edges to the center and feather a narrow repair band.
    const source = document.createElement("canvas"); source.width = source.height = 1024; source.getContext("2d")!.putImageData(image, 0, 0);
    context.clearRect(0, 0, 1024, 1024);
    context.drawImage(source, 512, 512, 512, 512, 0, 0, 512, 512); context.drawImage(source, 0, 512, 512, 512, 512, 0, 512, 512);
    context.drawImage(source, 512, 0, 512, 512, 0, 512, 512, 512); context.drawImage(source, 0, 0, 512, 512, 512, 512, 512, 512);
    context.globalAlpha = .32;
    context.filter = "blur(12px)";
    context.drawImage(canvas, 492, 0, 40, 1024, 484, 0, 56, 1024); context.drawImage(canvas, 0, 492, 1024, 40, 0, 484, 1024, 56);
    context.filter = "none"; context.globalAlpha = 1;
  }
  return { file: await canvasFile(canvas, "material-albedo.png"), seamScore };
}

export interface DerivedMaterialMaps { albedo: File; normal: File; roughness: File; metallic: File; ambientOcclusion: File; seamScore: number }

export async function deriveMaterialMaps(file: File, materialClass: MaterialAsset["materialClass"], normalStrength = 1): Promise<DerivedMaterialMaps> {
  const normalized = await normalizeMaterialAlbedo(file);
  const bitmap = await createImageBitmap(normalized.file);
  const sourceCanvas = document.createElement("canvas"); sourceCanvas.width = sourceCanvas.height = 1024;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true })!; sourceContext.drawImage(bitmap, 0, 0); bitmap.close();
  const source = sourceContext.getImageData(0, 0, 1024, 1024);
  const canvases = Array.from({ length: 4 }, () => { const value = document.createElement("canvas"); value.width = value.height = 1024; return value; });
  const targets = canvases.map((canvas) => canvas.getContext("2d")!.createImageData(1024, 1024));
  const luminance = (x: number, y: number) => { const i = (((y + 1024) % 1024) * 1024 + ((x + 1024) % 1024)) * 4; return source.data[i] * .2126 + source.data[i + 1] * .7152 + source.data[i + 2] * .0722; };
  const classRoughness = { wood: 175, stone: 200, metal: 92, painted: 145, fabric: 220, general: 175 }[materialClass];
  const classMetallic = materialClass === "metal" ? 230 : 0;
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    const index = (y * 1024 + x) * 4, dx = (luminance(x + 1, y) - luminance(x - 1, y)) * normalStrength, dy = (luminance(x, y + 1) - luminance(x, y - 1)) * normalStrength;
    const length = Math.hypot(dx, dy, 96) || 1, local = luminance(x, y) / 255;
    targets[0].data.set([128 - Math.round(dx / length * 127), 128 + Math.round(dy / length * 127), Math.round(128 + 96 / length * 127), 255], index);
    const rough = Math.max(20, Math.min(245, Math.round(classRoughness + (local - .5) * 28))); targets[1].data.set([rough, rough, rough, 255], index);
    targets[2].data.set([classMetallic, classMetallic, classMetallic, 255], index);
    const ao = Math.max(175, Math.min(255, Math.round(228 + (local - .5) * 36))); targets[3].data.set([ao, ao, ao, 255], index);
  }
  canvases.forEach((canvas, index) => canvas.getContext("2d")!.putImageData(targets[index], 0, 0));
  return { albedo: normalized.file, normal: await canvasFile(canvases[0], "material-normal-opengl.png"), roughness: await canvasFile(canvases[1], "material-roughness.png"), metallic: await canvasFile(canvases[2], "material-metallic.png"), ambientOcclusion: await canvasFile(canvases[3], "material-ao.png"), seamScore: normalized.seamScore };
}
