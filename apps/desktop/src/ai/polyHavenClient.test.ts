import { describe, expect, it, vi } from "vitest";
import { downloadPolyHavenPanorama, fetchPolyHavenHdris, parsePolyHavenHdris, type PolyHavenHdri } from "./polyHavenClient";

describe("Poly Haven HDRI catalog", () => {
  it("normalizes and sorts the public catalog", () => {
    expect(parsePolyHavenHdris({
      quiet_cove: { name: "Quiet Cove", thumbnail_url: "https://cdn.polyhaven.com/cove.png", tags: ["coast"], authors: { Ana: "all" }, download_count: 10 },
      old_hall: { name: "Old Hall", thumbnail_url: "https://cdn.polyhaven.com/hall.png", categories: ["indoor"], download_count: 42 },
      broken: { description: "missing required fields" },
    }).map((asset) => asset.id)).toEqual(["old_hall", "quiet_cove"]);
  });

  it("fetches the HDRI-only endpoint", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sky: { name: "Sky", thumbnail_url: "https://cdn.polyhaven.com/sky.png" } }), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchPolyHavenHdris(fetcher)).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith("https://api.polyhaven.com/assets?t=hdris", expect.any(Object));
  });

  it("downloads the tone-mapped panorama for SplatKit", async () => {
    const asset: PolyHavenHdri = { id: "old_hall", name: "Old Hall", description: "", categories: [], tags: [], thumbnailUrl: "thumb", authors: [], downloads: 0 };
    const fetcher = vi.fn(async (url: string) => url.includes("/files/")
      ? new Response(JSON.stringify({ tonemapped: { url: "https://dl.polyhaven.org/old_hall.jpg" } }), { status: 200 })
      : new Response(new Blob(["image"], { type: "image/jpeg" }), { status: 200 })) as unknown as typeof fetch;
    const file = await downloadPolyHavenPanorama(asset, fetcher);
    expect(file.name).toBe("old_hall.jpg");
    expect(file.type).toBe("image/jpeg");
  });
});
