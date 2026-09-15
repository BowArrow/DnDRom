import * as pc from "playcanvas";
import type { WorldTreeGeometry } from "../domain/types";

const textures = new WeakMap<pc.GraphicsDevice, Map<string, pc.Texture>>();
/** Locally generated branchlet/leaf cutouts. Meshes and all LODs use the same
 * silhouette; the alpha mip chain is coverage corrected to avoid distant loss. */
export function treeFoliageTexture(device: pc.GraphicsDevice, style: WorldTreeGeometry["style"]): pc.Texture {
  let cache = textures.get(device);
  if (!cache) { cache = new Map(); textures.set(device, cache); device.once("destroy", () => { for (const texture of cache!.values()) texture.destroy(); cache!.clear(); }); }
  const existing = cache.get(style); if (existing) return existing;
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const evergreen = style === "pine" || style === "cypress";
  if (evergreen) {
    ctx.strokeStyle = "#c5c7bc"; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(64, 122); ctx.quadraticCurveTo(59, 58, 66, 5); ctx.stroke();
    // Several needle lengths and insertion angles within a branch spray.
    for (let i = 0; i < 36; i++) for (const sign of [-1, 1]) {
      const y = 116 - i * 2.95, spread = (14 + 24 * Math.sin(i * .14)) * (style === "cypress" ? .65 : 1);
      ctx.strokeStyle = `rgb(${178 + i % 5 * 13},${183 + i % 5 * 12},${164 + i % 5 * 14})`;
      ctx.lineWidth = style === "cypress" ? 3.5 : 1.9;
      ctx.beginPath(); ctx.moveTo(63 + Math.sin(i) * 2, y); ctx.lineTo(64 + sign * spread, y - 12 - (i % 4) * 2); ctx.stroke();
    }
  } else {
    // A card is a twig with small leaves, not a single half-metre leaf.
    ctx.strokeStyle = "#adb394"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(64, 123); ctx.quadraticCurveTo(55, 60, 67, 7); ctx.stroke();
    for (let i = 0; i < 10; i++) {
      const sign = i % 2 ? 1 : -1, y = 113 - i * 9.5, x = 63 + Math.sin(i * .7) * 3;
      ctx.save(); ctx.translate(x, y); ctx.rotate(sign * (.6 + (i % 3) * .13));
      const length = 24 + (i % 4) * 3, width = 10 + (i % 3);
      const gradient = ctx.createLinearGradient(-width, 0, width, 0); gradient.addColorStop(0, "#b6b9a9"); gradient.addColorStop(.5, "#f1f2dc"); gradient.addColorStop(1, "#c6c9b4");
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-width, -length*.35, -width, -length*.7, 0, -length); ctx.bezierCurveTo(width, -length*.7, width, -length*.35, 0, 0); ctx.fill();
      ctx.strokeStyle = "#9caa86"; ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -length+2); ctx.stroke(); ctx.restore();
    }
  }
  const rgba = ctx.getImageData(0, 0, 128, 128).data;
  const texture = new pc.Texture(device, { name: `Procedural ${style} foliage`, width: 128, height: 128, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
  const coverage = Array.from({ length: 128 * 128 }, (_, i) => rgba[i * 4 + 3] >= 90 ? 1 : 0).reduce<number>((a, b) => a + b, 0) / (128 * 128);
  let previous = new Uint8Array(rgba), size = 128;
  for (let level = 0; ; level++) {
    const target = texture.lock({ level }) as Uint8Array; target.set(previous); texture.unlock();
    if (size === 1) break;
    const nextSize = size / 2, next = new Uint8Array(nextSize * nextSize * 4);
    for (let y = 0; y < nextSize; y++) for (let x = 0; x < nextSize; x++) {
      let alpha = 0; const rgb = [0, 0, 0];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const index = ((y * 2 + dy) * size + x * 2 + dx) * 4, a = previous[index + 3]; alpha += a; for (let c = 0; c < 3; c++) rgb[c] += previous[index + c] * a; }
      const index = (y * nextSize + x) * 4; for (let c = 0; c < 3; c++) next[index + c] = alpha ? Math.round(rgb[c] / alpha) : 200; next[index + 3] = Math.round(alpha / 4);
    }
    // Match alpha-test coverage, not average opacity. Without this thin needles
    // disappear in the first few mips even though their parent crown is visible.
    const alphas = Array.from({ length: nextSize * nextSize }, (_, i) => next[i * 4 + 3]).sort((a, b) => b - a);
    const cutoff = alphas[Math.min(alphas.length - 1, Math.max(0, Math.round(coverage * alphas.length) - 1))];
    const factor = cutoff > 0 ? Math.min(4, 91 / cutoff) : 1;
    for (let i = 3; i < next.length; i += 4) next[i] = Math.min(255, Math.round(next[i] * factor));
    previous = next; size = nextSize;
  }
  cache.set(style, texture); return texture;
}
