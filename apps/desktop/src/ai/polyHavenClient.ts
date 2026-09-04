export interface PolyHavenHdri {
  id: string;
  name: string;
  description: string;
  categories: string[];
  tags: string[];
  thumbnailUrl: string;
  authors: string[];
  downloads: number;
}

interface PolyHavenAssetRecord {
  name?: unknown;
  description?: unknown;
  categories?: unknown;
  tags?: unknown;
  thumbnail_url?: unknown;
  authors?: unknown;
  download_count?: unknown;
}

interface PolyHavenFileRecord {
  tonemapped?: { url?: unknown; size?: unknown };
}

const API_ROOT = "https://api.polyhaven.com";

export function parsePolyHavenHdris(payload: unknown): PolyHavenHdri[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Poly Haven returned an invalid catalog");
  return Object.entries(payload as Record<string, PolyHavenAssetRecord>)
    .flatMap(([id, asset]) => {
      if (typeof asset?.name !== "string" || typeof asset.thumbnail_url !== "string") return [];
      return [{
        id,
        name: asset.name,
        description: typeof asset.description === "string" ? asset.description : "",
        categories: Array.isArray(asset.categories) ? asset.categories.filter((entry): entry is string => typeof entry === "string") : [],
        tags: Array.isArray(asset.tags) ? asset.tags.filter((entry): entry is string => typeof entry === "string") : [],
        thumbnailUrl: asset.thumbnail_url,
        authors: asset.authors && typeof asset.authors === "object" && !Array.isArray(asset.authors) ? Object.keys(asset.authors) : [],
        downloads: typeof asset.download_count === "number" ? asset.download_count : 0,
      }];
    })
    .sort((left, right) => right.downloads - left.downloads || left.name.localeCompare(right.name));
}

const fetchOk = async (url: string, fetcher: typeof fetch): Promise<Response> => {
  const response = await fetcher(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Poly Haven returned ${response.status} ${response.statusText}`);
  return response;
};

export async function fetchPolyHavenHdris(fetcher: typeof fetch = fetch): Promise<PolyHavenHdri[]> {
  const response = await fetchOk(`${API_ROOT}/assets?t=hdris`, fetcher);
  return parsePolyHavenHdris(await response.json());
}

export async function downloadPolyHavenPanorama(asset: PolyHavenHdri, fetcher: typeof fetch = fetch): Promise<File> {
  const filesResponse = await fetchOk(`${API_ROOT}/files/${encodeURIComponent(asset.id)}`, fetcher);
  const files = await filesResponse.json() as PolyHavenFileRecord;
  const url = files.tonemapped?.url;
  if (typeof url !== "string" || !url.startsWith("https://dl.polyhaven.org/")) {
    throw new Error("This Poly Haven HDRI does not include a tone-mapped panorama");
  }
  const imageResponse = await fetcher(url);
  if (!imageResponse.ok) throw new Error(`Poly Haven download returned ${imageResponse.status} ${imageResponse.statusText}`);
  const blob = await imageResponse.blob();
  if (!blob.size) throw new Error("Poly Haven returned an empty panorama");
  return new File([blob], `${asset.id}.jpg`, { type: blob.type || "image/jpeg" });
}
