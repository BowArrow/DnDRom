import { get, set } from "idb-keyval";
import type { DicePbrMaps } from "../domain/types";
import { createAssetStore } from "./assetDatabase";

const DICE_TEXTURE_DATABASE = createAssetStore("dice-pbr-textures");
export const DICE_TEXTURE_WIDTH = 2048;
export const DICE_TEXTURE_HEIGHT = 1024;
export const MAX_DICE_TEXTURE_BYTES = 32 * 1024 * 1024;

export type DiceTextureSlot = "albedo" | "normal" | "roughness" | "metallic" | "ambientOcclusion" | "emissive";
export type DiceTextureFiles = Partial<Record<DiceTextureSlot, File>>;

const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

export async function inspectDiceTexture(file: File): Promise<{ width: number; height: number }> {
  if (!file.type.startsWith("image/") || !/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error("Dice PBR maps must be PNG, JPEG, or WebP images");
  if (!file.size || file.size > MAX_DICE_TEXTURE_BYTES) throw new Error("Each dice texture must be between 1 byte and 32 MB");
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  if (dimensions.width < 256 || dimensions.height < 128) throw new Error("Dice textures must be at least 256 × 128 pixels");
  if (dimensions.width > 4096 || dimensions.height > 2048) throw new Error("Dice textures are limited to 4096 × 2048 pixels");
  if (Math.abs(dimensions.width / dimensions.height - 2) > .03) throw new Error("Use the downloadable 2:1 dice template so face projection preserves texture scale");
  return dimensions;
}

export async function storeDiceTexture(file: File): Promise<string> {
  await inspectDiceTexture(file);
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const storageKey = `sha256:${bytesToHex(new Uint8Array(digest))}`;
  await set(storageKey, new Blob([file], { type: file.type }), DICE_TEXTURE_DATABASE);
  return storageKey;
}

export async function storeDiceTextureSet(files: DiceTextureFiles): Promise<DicePbrMaps> {
  const maps: DicePbrMaps = {};
  for (const [slot, file] of Object.entries(files) as [DiceTextureSlot, File][]) maps[slot] = await storeDiceTexture(file);
  return maps;
}

export async function getStoredDiceTexture(storageKey?: string): Promise<Blob | null> {
  if (!storageKey) return null;
  return await get<Blob>(storageKey, DICE_TEXTURE_DATABASE) ?? null;
}

const canvasFile = async (canvas: HTMLCanvasElement, name: string): Promise<File> => {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not encode dice texture")), "image/png"));
  return new File([blob], name, { type: "image/png" });
};

export async function normalizeDiceAlbedo(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = DICE_TEXTURE_WIDTH;
  canvas.height = DICE_TEXTURE_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false })!;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await canvasFile(canvas, "dice-albedo.png");
}

type Hsl = { h: number; s: number; l: number };
const hexRgb = (value: string): [number, number, number] => {
  const hex = value.replace("#", "").padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
};
const rgbHsl = (r: number, g: number, b: number): Hsl => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const l = (max + min) / 2;
  if (!delta) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  const h = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return { h: (h + 360) % 360, s, l };
};
const hslRgb = ({ h, s, l }: Hsl): [number, number, number] => {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  const sector = Math.floor(h / 60) % 6;
  const [r, g, b] = ([[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]] as [number, number, number][])[sector];
  const m = l - chroma / 2;
  return [r + m, g + m, b + m];
};
const hueDistance = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
const hueToward = (from: number, to: number, amount: number): number => (from + ((to - from + 540) % 360 - 180) * amount + 360) % 360;

/** Corrects a model's dominant off-prompt background hue while preserving motifs in other hue families. */
export async function harmonizeDiceAlbedoColor(file: File, targetColor: string): Promise<File> {
  const normalized = await normalizeDiceAlbedo(file);
  const bitmap = await createImageBitmap(normalized);
  const canvas = document.createElement("canvas");
  canvas.width = DICE_TEXTURE_WIDTH;
  canvas.height = DICE_TEXTURE_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const bins = new Float64Array(24);
  for (let index = 0; index < image.data.length; index += 16) {
    const hsl = rgbHsl(image.data[index] / 255, image.data[index + 1] / 255, image.data[index + 2] / 255);
    if (hsl.s < .16 || hsl.l < .08 || hsl.l > .92) continue;
    bins[Math.floor(hsl.h / 15) % bins.length] += hsl.s * (1 - Math.abs(hsl.l - .5) * .7);
  }
  const dominantBin = bins.reduce((best, value, index) => value > bins[best] ? index : best, 0);
  const dominantHue = dominantBin * 15 + 7.5;
  const target = rgbHsl(...hexRgb(targetColor));
  if (hueDistance(dominantHue, target.h) < 32) return normalized;
  for (let index = 0; index < image.data.length; index += 4) {
    const hsl = rgbHsl(image.data[index] / 255, image.data[index + 1] / 255, image.data[index + 2] / 255);
    const distance = hueDistance(hsl.h, dominantHue);
    if (hsl.s < .12 || distance >= 58) continue;
    const influence = Math.pow(1 - distance / 58, 1.4) * .96;
    const corrected = hslRgb({ h: hueToward(hsl.h, target.h, influence), s: Math.max(hsl.s, target.s * influence * .72), l: hsl.l });
    image.data[index] = Math.round(corrected[0] * 255);
    image.data[index + 1] = Math.round(corrected[1] * 255);
    image.data[index + 2] = Math.round(corrected[2] * 255);
  }
  context.putImageData(image, 0, 0);
  return await canvasFile(canvas, "dice-albedo.png");
}

/** Creates useful editable defaults; artists can replace any map independently. */
export async function deriveDicePbrMaps(albedo: File, normalStrength = 1): Promise<DiceTextureFiles> {
  const normalized = await normalizeDiceAlbedo(albedo);
  const bitmap = await createImageBitmap(normalized);
  const canvas = document.createElement("canvas");
  canvas.width = DICE_TEXTURE_WIDTH;
  canvas.height = DICE_TEXTURE_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const source = context.getImageData(0, 0, canvas.width, canvas.height);
  const normalCanvas = document.createElement("canvas");
  const roughnessCanvas = document.createElement("canvas");
  const metallicCanvas = document.createElement("canvas");
  const aoCanvas = document.createElement("canvas");
  const emissiveCanvas = document.createElement("canvas");
  for (const target of [normalCanvas, roughnessCanvas, metallicCanvas, aoCanvas, emissiveCanvas]) { target.width = canvas.width; target.height = canvas.height; }
  const normal = normalCanvas.getContext("2d")!.createImageData(canvas.width, canvas.height);
  const roughness = roughnessCanvas.getContext("2d")!.createImageData(canvas.width, canvas.height);
  const metallic = metallicCanvas.getContext("2d")!.createImageData(canvas.width, canvas.height);
  const ao = aoCanvas.getContext("2d")!.createImageData(canvas.width, canvas.height);
  const emissive = emissiveCanvas.getContext("2d")!.createImageData(canvas.width, canvas.height);
  const luminance = (x: number, y: number) => {
    const wrappedX = (x + canvas.width) % canvas.width;
    const clampedY = Math.max(0, Math.min(canvas.height - 1, y));
    const index = (clampedY * canvas.width + wrappedX) * 4;
    return source.data[index] * .2126 + source.data[index + 1] * .7152 + source.data[index + 2] * .0722;
  };
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const index = (y * canvas.width + x) * 4;
    const dx = (luminance(x + 1, y) - luminance(x - 1, y)) * .5 * normalStrength;
    const dy = (luminance(x, y + 1) - luminance(x, y - 1)) * .5 * normalStrength;
    const length = Math.hypot(dx, dy, 96) || 1;
    normal.data.set([128 - Math.round(dx / length * 127), 128 + Math.round(dy / length * 127), Math.round(96 / length * 127 + 128), 255], index);
    const local = luminance(x, y) / 255;
    const rough = Math.round(150 + (1 - local) * 55);
    roughness.data.set([rough, rough, rough, 255], index);
    metallic.data.set([0, 0, 0, 255], index);
    const cavity = Math.max(180, Math.min(255, Math.round(225 + (local - .5) * 35)));
    ao.data.set([cavity, cavity, cavity, 255], index);
    // Bright marbling and high-contrast veins become an editable energy mask.
    // The mask remains grayscale so the in-app effect color can be changed later.
    const edge = Math.min(1, Math.hypot(dx, dy) / 32);
    const brightVein = Math.max(0, (local - .52) * 2.3);
    const energy = Math.round(Math.min(1, Math.max(edge * .8, brightVein)) * 255);
    emissive.data.set([energy, energy, energy, 255], index);
  }
  normalCanvas.getContext("2d")!.putImageData(normal, 0, 0);
  roughnessCanvas.getContext("2d")!.putImageData(roughness, 0, 0);
  metallicCanvas.getContext("2d")!.putImageData(metallic, 0, 0);
  aoCanvas.getContext("2d")!.putImageData(ao, 0, 0);
  emissiveCanvas.getContext("2d")!.putImageData(emissive, 0, 0);
  return {
    albedo: normalized,
    normal: await canvasFile(normalCanvas, "dice-normal.png"),
    roughness: await canvasFile(roughnessCanvas, "dice-roughness.png"),
    metallic: await canvasFile(metallicCanvas, "dice-metallic.png"),
    ambientOcclusion: await canvasFile(aoCanvas, "dice-ao.png"),
    emissive: await canvasFile(emissiveCanvas, "dice-energy-mask.png"),
  };
}
