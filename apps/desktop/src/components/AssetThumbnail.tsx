import { useEffect, useRef } from "react";
import { ASSET_BY_ID, type AssetDefinition, type AssetPart, type PrimitiveType } from "../domain/assets";
import type { TokenAsset, Vec3 } from "../domain/types";
import { TokenAssetThumbnail3d } from "./TokenAssetThumbnail3d";

interface AssetThumbnailProps { assetId: string | null; token?: TokenAsset; }
const part = (primitive: PrimitiveType, position: Vec3, scale: Vec3, color: string): AssetPart => ({ primitive, position, scale, color });

const modelPreviewParts = (asset: AssetDefinition): AssetPart[] => {
  const name = asset.name.toLowerCase();
  if (name.includes("barrel")) return [part("cylinder", { x: 0, y: .55, z: 0 }, { x: .75, y: 1.1, z: .75 }, "#704525")];
  if (name.includes("chair")) return [part("box", { x: 0, y: .45, z: 0 }, { x: .7, y: .12, z: .7 }, "#78502d"), part("box", { x: 0, y: 1, z: .28 }, { x: .7, y: 1.1, z: .12 }, "#6a4326")];
  if (name.includes("chest")) return [part("box", { x: 0, y: .45, z: 0 }, { x: 1.2, y: .8, z: .8 }, "#79502b"), part("box", { x: 0, y: .6, z: -.41 }, { x: .18, y: .28, z: .05 }, "#c9a227")];
  if (name.includes("column")) return [part("cylinder", { x: 0, y: .9, z: 0 }, { x: .55, y: 1.8, z: .55 }, "#898782")];
  if (name.includes("gate")) return [part("box", { x: -.7, y: 1, z: 0 }, { x: .18, y: 2, z: .25 }, "#6c6a65"), part("box", { x: .7, y: 1, z: 0 }, { x: .18, y: 2, z: .25 }, "#6c6a65"), part("box", { x: 0, y: 1.7, z: 0 }, { x: 1.5, y: .18, z: .25 }, "#6c6a65")];
  if (name.includes("rock")) return [part("sphere", { x: -.25, y: .35, z: .1 }, { x: .8, y: .7, z: .7 }, "#706d67"), part("sphere", { x: .35, y: .25, z: -.1 }, { x: .55, y: .5, z: .6 }, "#85817a")];
  if (name.includes("stairs")) return [0, 1, 2].map((index) => part("box", { x: 0, y: .12 + index * .2, z: .45 - index * .35 }, { x: 1.2, y: .22 + index * .03, z: .4 }, "#797771"));
  if (name.includes("table")) return [part("box", { x: 0, y: .75, z: 0 }, { x: 1.4, y: .15, z: .8 }, "#79502b"), part("cylinder", { x: 0, y: .38, z: 0 }, { x: .2, y: .75, z: .2 }, "#5f3c24")];
  if (name.includes("trap")) return [-.35, 0, .35].map((x) => part("cone", { x, y: .32, z: 0 }, { x: .25, y: .65, z: .25 }, "#8b8983"));
  if (name.includes("wall")) return [part("box", { x: 0, y: .65, z: 0 }, { x: 1.7, y: 1.3, z: .25 }, "#777570")];
  if (name.includes("human")) return [part("capsule", { x: 0, y: .75, z: 0 }, { x: .42, y: 1.25, z: .42 }, "#7891a8"), part("sphere", { x: 0, y: 1.45, z: 0 }, { x: .38, y: .38, z: .38 }, "#c49a78")];
  if (name.includes("orc")) return [part("capsule", { x: 0, y: .78, z: 0 }, { x: .5, y: 1.35, z: .5 }, "#69845d"), part("sphere", { x: 0, y: 1.52, z: 0 }, { x: .42, y: .42, z: .42 }, "#769366")];
  return [part("box", { x: 0, y: .5, z: 0 }, { x: 1, y: 1, z: 1 }, "#805b89")];
};

const shade = (hex: string, amount: number): string => {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const channel = (shift: number) => Math.max(0, Math.min(255, ((value >> shift) & 255) + amount));
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
};

const drawBox = (context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, depth: number, color: string) => {
  const skew = Math.min(depth * .42, 13);
  context.beginPath(); context.moveTo(x - width / 2, y); context.lineTo(x, y - skew); context.lineTo(x + width / 2, y); context.lineTo(x, y + skew); context.closePath(); context.fillStyle = shade(color, 28); context.fill();
  context.beginPath(); context.moveTo(x - width / 2, y); context.lineTo(x, y + skew); context.lineTo(x, y + skew + height); context.lineTo(x - width / 2, y + height); context.closePath(); context.fillStyle = shade(color, -18); context.fill();
  context.beginPath(); context.moveTo(x + width / 2, y); context.lineTo(x, y + skew); context.lineTo(x, y + skew + height); context.lineTo(x + width / 2, y + height); context.closePath(); context.fillStyle = shade(color, -34); context.fill();
};

function ProceduralAssetThumbnail({ assetId }: { assetId: string | null }) {
  const asset = assetId ? ASSET_BY_ID.get(assetId) : undefined;
  const selectTool = assetId === null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current, context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = 128 * ratio; canvas.height = 82 * ratio; context.scale(ratio, ratio); context.clearRect(0, 0, 128, 82);
    const glow = context.createRadialGradient(64, 58, 2, 64, 58, 48); glow.addColorStop(0, "rgba(201,162,39,.16)"); glow.addColorStop(1, "rgba(201,162,39,0)"); context.fillStyle = glow; context.fillRect(0, 0, 128, 82);
    if (selectTool) { context.strokeStyle = "#f3dda0"; context.lineWidth = 2; context.beginPath(); context.moveTo(43, 20); context.lineTo(78, 50); context.lineTo(61, 53); context.lineTo(69, 69); context.lineTo(59, 73); context.lineTo(51, 56); context.lineTo(39, 68); context.closePath(); context.stroke(); return; }
    if (!asset) return;
    if (asset.editorOnly && asset.defaultBehavior?.kind === "practical-light") {
      const color = asset.defaultBehavior.color;
      const glow = context.createRadialGradient(64, 40, 2, 64, 40, 31);
      glow.addColorStop(0, `${color}cc`); glow.addColorStop(.24, `${color}55`); glow.addColorStop(1, `${color}00`);
      context.fillStyle = glow; context.fillRect(28, 4, 72, 72);
      context.strokeStyle = color; context.lineWidth = 2; context.beginPath(); context.arc(64, 39, 9, 0, Math.PI * 2); context.stroke();
      context.beginPath();
      for (let index = 0; index < 8; index++) { const angle = index * Math.PI / 4; context.moveTo(64 + Math.cos(angle) * 14, 39 + Math.sin(angle) * 14); context.lineTo(64 + Math.cos(angle) * 21, 39 + Math.sin(angle) * 21); }
      context.stroke();
      context.strokeStyle = "#8b7340"; context.lineWidth = 1; context.setLineDash([2, 3]); context.beginPath(); context.moveTo(64, 50); context.lineTo(64, 77); context.stroke(); context.setLineDash([]);
      return;
    }
    const parts = asset.parts?.length ? asset.parts : modelPreviewParts(asset);
    const extent = Math.max(1, ...parts.map((entry) => Math.max(Math.abs(entry.position.x) + entry.scale.x / 2, Math.abs(entry.position.z) + entry.scale.z / 2, entry.position.y + entry.scale.y / 2)));
    const scale = Math.min(1.8, 1.35 / extent);
    for (const item of [...parts].sort((left, right) => left.position.y - right.position.y || right.position.z - left.position.z)) {
      const x = 64 + (item.position.x - item.position.z) * 23 * scale, y = 61 - item.position.y * 25 * scale + (item.position.x + item.position.z) * 7 * scale;
      const width = Math.max(4, item.scale.x * 27 * scale), height = Math.max(3, item.scale.y * 22 * scale), depth = Math.max(4, item.scale.z * 25 * scale);
      if (item.primitive === "box") drawBox(context, x, y - height, width, height, depth, item.color);
      else if (item.primitive === "sphere" || item.primitive === "capsule") { const gradient = context.createRadialGradient(x - width * .2, y - height * .72, 1, x, y - height * .5, Math.max(width, height) * .65); gradient.addColorStop(0, shade(item.color, 45)); gradient.addColorStop(1, shade(item.color, -30)); context.fillStyle = gradient; context.beginPath(); context.ellipse(x, y - height / 2, width / 2, height / 2, 0, 0, Math.PI * 2); context.fill(); }
      else { context.fillStyle = shade(item.color, -18); context.fillRect(x - width / 2, y - height, width, height); context.fillStyle = shade(item.color, 24); context.beginPath(); context.ellipse(x, y - height, width / 2, Math.max(2, depth * .18), 0, 0, Math.PI * 2); context.fill(); context.fillStyle = shade(item.color, -30); context.beginPath(); context.ellipse(x, y, width / 2, Math.max(2, depth * .18), 0, 0, Math.PI * 2); context.fill(); }
      if (item.emissive) { context.shadowColor = item.emissive; context.shadowBlur = 12; context.fillStyle = item.emissive; context.beginPath(); context.arc(x, y - height / 2, 3, 0, Math.PI * 2); context.fill(); context.shadowBlur = 0; }
    }
  }, [asset, selectTool]);
  return <figure className="asset-preview"><canvas ref={canvasRef} aria-hidden="true" /></figure>;
}

export function AssetThumbnail({ assetId, token }: AssetThumbnailProps) {
  return token ? <TokenAssetThumbnail3d token={token} /> : <ProceduralAssetThumbnail assetId={assetId} />;
}
