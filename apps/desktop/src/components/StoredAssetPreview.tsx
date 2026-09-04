import { CircleDot, Dices, PackageOpen } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { BasePlateAsset, DiceTheme, MaterialAsset, PropAsset } from "../domain/types";
import { getBasePlateBinary } from "../persistence/basePlateAssets";
import { getStoredDiceTexture } from "../persistence/diceThemes";
import { getStoredPropSource } from "../persistence/propAssets";
import { getStoredMaterialMap } from "../persistence/materialAssets";

const loadBasePlateSource = (key: string) => getBasePlateBinary(key, "source");
const loadBasePlateThumbnail = (key: string) => getBasePlateBinary(key, "thumbnail");

function StoredBlobPreview({ storageKey, load, alt, fallback }: { storageKey?: string; load: (key: string) => Promise<Blob | null>; alt: string; fallback: ReactNode }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let disposed = false;
    let objectUrl = "";
    if (!storageKey) { setUrl(""); return; }
    void load(storageKey).then((blob) => {
      if (!blob || disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => !disposed && setUrl(""));
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [load, storageKey]);
  return <figure className="asset-preview stored-asset-preview">{url ? <img src={url} alt={alt} /> : fallback}</figure>;
}

export function BasePlateAssetPreview({ asset }: { asset: BasePlateAsset }) {
  const key = asset.thumbnailStorageKey ?? asset.sourceImageStorageKey;
  const load = asset.thumbnailStorageKey ? loadBasePlateThumbnail : loadBasePlateSource;
  return <StoredBlobPreview storageKey={key} load={load} alt={`Preview of ${asset.name}`} fallback={<span className="baseplate-preview-fallback" style={{ "--plinth": asset.recipe.plinthColor, "--rim": asset.recipe.rimColor } as CSSProperties}><CircleDot size={38} /><small>{asset.recipe.preset}</small></span>} />;
}

export function DiceThemeAssetPreview({ theme }: { theme: DiceTheme }) {
  return <StoredBlobPreview storageKey={theme.maps.albedo} load={getStoredDiceTexture} alt={`Surface preview of ${theme.name}`} fallback={<span className="dice-preview-fallback" style={{ "--dice-body": theme.baseColor, "--dice-number": theme.numberColor } as CSSProperties}><Dices size={42} /><strong>20</strong></span>} />;
}

export function PropAssetPreview({ asset }: { asset: PropAsset }) {
  return <StoredBlobPreview storageKey={asset.sourceImage?.storageKey} load={getStoredPropSource} alt={`Reference preview of ${asset.name}`} fallback={<span className="prop-preview-fallback"><PackageOpen size={42} /><small>{asset.profile}</small></span>} />;
}

export function MaterialAssetPreview({ asset }: { asset: MaterialAsset }) {
  return <StoredBlobPreview storageKey={asset.maps.albedo} load={getStoredMaterialMap} alt={`Albedo preview of ${asset.name}`} fallback={<span className="material-preview-fallback" style={{ "--material-roughness": asset.roughness } as CSSProperties}><span /><small>{asset.materialClass}</small></span>} />;
}
