import { useEffect, useMemo, useState } from "react";
import type { TokenAsset } from "../domain/types";
import { getStoredTokenModel } from "../persistence/tokenAssets";

const thumbnailCache = new Map<string, string>();

const fallbackThumbnail = (token: TokenAsset): string => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 164;
  const context = canvas.getContext("2d")!;
  const glow = context.createRadialGradient(128, 82, 8, 128, 82, 126);
  glow.addColorStop(0, `${token.base.accentColor}73`);
  glow.addColorStop(1, "#090807");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = token.base.color;
  context.strokeStyle = token.base.accentColor;
  context.lineWidth = 4;
  context.beginPath();
  context.ellipse(128, 130, 56, 18, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#57756e";
  context.fillRect(108, 57, 40, 53);
  context.beginPath();
  context.arc(128, 48, 19, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f4e3b0";
  context.font = "18px serif";
  context.textAlign = "center";
  context.fillText(token.name.trim().slice(0, 1).toUpperCase() || "?", 128, 158);
  return canvas.toDataURL("image/png");
};

const toThumbnailDataUrl = async (blob: Blob): Promise<string> => {
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.src = objectUrl;
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not decode character artwork"));
    });
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 164;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#0d0c0a";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = Math.max(1, image.naturalWidth * scale);
  const height = Math.max(1, image.naturalHeight * scale);
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  URL.revokeObjectURL(objectUrl);
  return canvas.toDataURL("image/png");
};

/**
 * Catalogue cards intentionally use the protected source artwork instead of a
 * live PlayCanvas renderer. Live 3D remains in Forge and on the tabletop; this
 * keeps catalogue size independent from WebView2's finite WebGL context budget.
 */
export function TokenAssetThumbnail3d({ token }: { token: TokenAsset }) {
  const source = token.sourceImage ?? token.originalSourceImage;
  const cacheKey = `${token.id}:${source?.storageKey ?? token.storageKey}:${token.base.color}:${token.base.accentColor}`;
  const fallback = useMemo(() => fallbackThumbnail(token), [token]);
  const [snapshot, setSnapshot] = useState(() => thumbnailCache.get(cacheKey) ?? fallback);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    const cached = thumbnailCache.get(cacheKey);
    if (cached) { setSnapshot(cached); setFailed(false); return; }
    if (!source) { setSnapshot(fallback); setFailed(false); return; }
    void getStoredTokenModel(source.storageKey)
      .then((contents) => contents ? toThumbnailDataUrl(new Blob([contents], { type: source.mimeType })) : Promise.reject(new Error("Character artwork is missing")))
      .then((image) => {
        thumbnailCache.set(cacheKey, image);
        if (!disposed) { setSnapshot(image); setFailed(false); }
      })
      .catch(() => { if (!disposed) { setSnapshot(fallback); setFailed(true); } });
    return () => { disposed = true; };
  }, [cacheKey, fallback, source]);

  return (
    <figure className={`asset-preview token-asset-preview ${failed ? "failed" : ""}`} data-render-policy="stored-source-image" data-preview-source={source ? "character-art" : "catalogue-fallback"}>
      <img src={snapshot} alt={`Preview of ${token.name}`} />
      {failed ? <span>Source artwork needs relinking</span> : null}
    </figure>
  );
}
