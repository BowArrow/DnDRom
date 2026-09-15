import type { MaterialAsset } from "../domain/types";
import { getStoredMaterialMap } from "../persistence/materialAssets";
import { nativeUpload } from "./nativeBridge";
const uploaded = new Map<string, string>();
export async function sendNativeMaterials(assets: MaterialAsset[]) {
  for (const asset of assets) {
    if (uploaded.get(asset.id) === asset.updatedAt) continue;
    const maps: Record<string, string> = {};
    for (const [slot, key] of Object.entries(asset.maps)) {
      const blob = await getStoredMaterialMap(key); if (!blob) throw new Error(`Missing ${slot} texture for ${asset.name}`);
      const bitmap = await createImageBitmap(blob), size = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * size)), Math.max(1, Math.round(bitmap.height * size)));
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      const png = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
      let binary = ""; for (let offset = 0; offset < png.length; offset += 8192) binary += String.fromCharCode(...png.subarray(offset, offset + 8192));
      maps[slot] = btoa(binary);
    }
    await nativeUpload(JSON.stringify({ id: asset.id, maps, scale: asset.scale, rotation: asset.rotation, normalStrength: asset.normalStrength, roughness: asset.roughness, metallic: asset.metallic }), "material", asset.id);
    uploaded.set(asset.id, asset.updatedAt);
  }
}
