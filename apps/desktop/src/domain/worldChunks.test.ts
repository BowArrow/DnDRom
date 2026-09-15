import { describe, expect, it } from "vitest";
import type { WorldChunkDescriptor, WorldRegionManifest } from "./types";
import { chunkIdForPosition, computeWorldVisibility, lightInfluencesVisibleChunks, queryWorldQuadtree, shouldRenderWorldEntity, WORLD_CHUNK_CACHE_BUDGETS, WorldChunkStreamingController } from "./worldChunks";

const chunk = (x: number, z: number, bytes = 1024): WorldChunkDescriptor => ({
  id: `chunk-${x}-${z}`, x, z,
  bounds: { min: { x: x * 16, y: -2, z: z * 16 }, max: { x: x * 16 + 16, y: 8, z: z * 16 + 16 } },
  entityIds: [], lods: [{ level: 0, triangleCount: 100, byteLength: bytes }, { level: 1, triangleCount: 40, byteLength: bytes / 2 }, { level: 2, triangleCount: 10, byteLength: bytes / 4 }],
  generationHash: `hash-${x}-${z}`,
});
const manifest = (chunks: WorldChunkDescriptor[]): WorldRegionManifest => ({ version: 1, blueprintId: "blueprint", seed: 1, chunkSize: 16, chunks, generatedAt: "now" });

describe("world chunk spatial streaming", () => {
  const region = manifest(Array.from({ length: 16 }, (_, index) => chunk(index % 4, Math.floor(index / 4))));

  it("budgets actual uploads and waits for presentation before revealing", () => {
    const visibility=computeWorldVisibility({manifest:region,cameraPosition:{x:8,y:8,z:8},cameraTarget:{x:32,y:0,z:32},quality:"balanced"});
    const controller=new WorldChunkStreamingController();controller.update(region,visibility,0);
    let clock=0;
    const uploaded=controller.takeUploads(8,4,()=>clock,()=>{clock+=6;});
    expect(uploaded).toHaveLength(1);
    expect(controller.isResident(uploaded[0])).toBe(true);
    expect(controller.isPresented(uploaded[0])).toBe(false);
    controller.markPresented(uploaded);expect(controller.isPresented(uploaded[0])).toBe(true);
    controller.reset();controller.markPresented(uploaded);expect(controller.isPresented(uploaded[0])).toBe(false);
  });

  it("rolls back failed uploads so a retry cannot expose an incomplete tile",()=>{
    const visibility=computeWorldVisibility({manifest:region,cameraPosition:{x:8,y:8,z:8},cameraTarget:{x:32,y:0,z:32},quality:"balanced"});
    const controller=new WorldChunkStreamingController();controller.update(region,visibility,0);
    expect(()=>controller.takeUploads(1,4,()=>0,()=>{throw new Error("Upload failed");})).toThrow("Upload failed");
    expect(controller.snapshot().some(s=>s.resident)).toBe(false);
    expect(controller.takeUploads(1,4,()=>0)).toHaveLength(1);
  });

  it("uses conservative quadtree candidates without losing nearby chunks", () => {
    const candidates = queryWorldQuadtree(region, { x: 8, y: 8, z: 8 }, { x: 32, y: 0, z: 32 });
    expect(candidates.some((entry) => entry.id === "chunk-0-0")).toBe(true);
  });

  it("uploads at most one chunk per frame and evicts only after hysteresis", () => {
    const visibility = computeWorldVisibility({ manifest: region, cameraPosition: { x: 8, y: 8, z: 8 }, cameraTarget: { x: 32, y: 0, z: 32 }, quality: "balanced" });
    const controller = new WorldChunkStreamingController(5_000);
    controller.update(region, visibility, 1_000);
    expect(controller.takeUploads(1, 4, () => 1_000)).toHaveLength(1);
    expect(controller.snapshot().filter((state) => state.resident)).toHaveLength(1);
    const empty = { visibleChunkIds: new Set<string>(), preloadChunkIds: new Set<string>(), lodByChunkId: new Map(), estimatedBytes: 0 };
    expect(controller.update(region, empty, 5_999)).toHaveLength(0);
    expect(controller.update(region, empty, 6_001)).toHaveLength(1);
  });

  it("retains off-screen lights only when their influence reaches a visible chunk", () => {
    const visibility = { visibleChunkIds: new Set(["chunk-0-0"]), preloadChunkIds: new Set<string>(), lodByChunkId: new Map(), estimatedBytes: 0 };
    expect(lightInfluencesVisibleChunks({ x: 18, y: 0, z: 8 }, 3, region, visibility)).toBe(true);
    expect(lightInfluencesVisibleChunks({ x: 60, y: 0, z: 60 }, 3, region, visibility)).toBe(false);
  });
});

describe("streaming world visibility", () => {
  it("assigns positions on either side of a chunk boundary deterministically", () => {
    const world = manifest([chunk(0, 0), chunk(1, 0)]);
    expect(chunkIdForPosition(world, { x: 15.999, y: 0, z: 4 })).toBe("chunk-0-0");
    expect(chunkIdForPosition(world, { x: 16, y: 0, z: 4 })).toBe("chunk-1-0");
  });

  it("selects LODs, culls distant rear chunks, and preloads a one-chunk margin", () => {
    const chunks = Array.from({ length: 12 }, (_, x) => chunk(x, 0));
    const visible = computeWorldVisibility({ manifest: manifest(chunks), cameraPosition: { x: 8, y: 10, z: 8 }, cameraTarget: { x: 160, y: 0, z: 8 }, quality: "balanced" });
    expect(visible.lodByChunkId.get("chunk-0-0")).toBe(0);
    expect(visible.lodByChunkId.get("chunk-4-0")).toBe(1);
    expect(visible.lodByChunkId.get("chunk-8-0")).toBe(2);
    expect(visible.visibleChunkIds.has("chunk-11-0")).toBe(false);
    expect(visible.preloadChunkIds.has("chunk-10-0")).toBe(true);
    expect(shouldRenderWorldEntity("chunk-11-0", visible)).toBe(false);
    expect(shouldRenderWorldEntity(undefined, visible)).toBe(true);
  });

  it("keeps every bounds-intersecting chunk resident for a high tabletop camera", () => {
    const chunks = [chunk(0, 0), chunk(1, 0), chunk(0, 1), chunk(1, 1)];
    const visible = computeWorldVisibility({
      manifest: manifest(chunks),
      cameraPosition: { x: 16, y: 70, z: 45 },
      cameraTarget: { x: 16, y: 0, z: 16 },
      quality: "balanced",
    });
    expect([...visible.visibleChunkIds].sort()).toEqual(chunks.map((entry) => entry.id).sort());
  });

  it("uses the camera frustum rather than a camera-centered nine-chunk circle", () => {
    const chunks = Array.from({ length: 14 }, (_, x) => chunk(x, 0));
    const visible = computeWorldVisibility({
      manifest: manifest(chunks), cameraPosition: { x: -20, y: 24, z: 8 }, cameraTarget: { x: 160, y: 0, z: 8 },
      quality: "balanced", verticalFovDegrees: 60, aspectRatio: 16 / 9, farClip: 260,
    });
    expect(visible.visibleChunkIds.has("chunk-12-0")).toBe(true);
  });

  it("keeps the complete draft resident in the Forge overview", () => {
    const chunks = Array.from({ length: 64 }, (_, index) => chunk(index % 8 - 4, Math.floor(index / 8) - 4));
    const visible = computeWorldVisibility({
      manifest: manifest(chunks),
      cameraPosition: { x: 110, y: 110, z: 110 },
      cameraTarget: { x: 0, y: 0, z: 0 },
      quality: "balanced",
      overview: true,
      interiorChunkId: chunks[0].id,
    });
    expect(visible.visibleChunkIds.size).toBe(chunks.length);
  });

  it("limits an interior view to portal-reachable chunks", () => {
    const rooms = [chunk(0, 0), chunk(1, 0), chunk(2, 0), chunk(3, 0), chunk(4, 0)];
    rooms.forEach((entry, index) => { entry.portalChunkIds = index < rooms.length - 1 ? [rooms[index + 1].id] : []; });
    const visible = computeWorldVisibility({ manifest: manifest(rooms), cameraPosition: { x: 8, y: 4, z: 8 }, cameraTarget: { x: 100, y: 0, z: 8 }, quality: "balanced", interiorChunkId: rooms[0].id });
    expect(visible.visibleChunkIds.has(rooms[3].id)).toBe(true);
    expect(visible.visibleChunkIds.has(rooms[4].id)).toBe(false);
  });

  it("uses the requested GPU cache profile", () => {
    expect(WORLD_CHUNK_CACHE_BUDGETS.performance).toBe(256 * 1024 * 1024);
    expect(WORLD_CHUNK_CACHE_BUDGETS.balanced).toBe(512 * 1024 * 1024);
    expect(WORLD_CHUNK_CACHE_BUDGETS.cinematic).toBe(1024 * 1024 * 1024);
  });
});
