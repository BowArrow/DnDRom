import { describe, expect, it, vi } from "vitest";
import { CAMPAIGN_LARGE_MARKER, createCampaignStorage } from "./campaignStorage";

function fixture() {
  const small = new Map<string, string>(), snapshots = new Map<string, string>();
  const local = { getItem: (key: string) => small.get(key) ?? null, setItem: (key: string, value: string) => { small.set(key, value); }, removeItem: (key: string) => { small.delete(key); } };
  const large = { get: async (key: string) => snapshots.get(key), set: vi.fn(async (key: string, value: string) => { snapshots.set(key, value); }), remove: async (key: string) => { snapshots.delete(key); } };
  const errors = vi.fn();
  return { local, large, errors, storage: createCampaignStorage(local, large, errors) };
}
describe("large generated campaign persistence", () => {
  it("loads existing saves synchronously and moves a complete large world into IndexedDB", async () => {
    const { storage, local, large } = fixture();
    storage.setItem("campaign", "legacy");
    expect(storage.getItem("campaign")).toBe("legacy");
    const world = JSON.stringify({ terrain: "a".repeat(9_000_000), assembly: "courtyard" });
    await storage.setItem("campaign", world);
    expect(local.getItem("campaign")).toBe(CAMPAIGN_LARGE_MARKER);
    const reopened = createCampaignStorage(local, large, vi.fn());
    expect(await reopened.getItem("campaign")).toBe(world);
    await reopened.removeItem("campaign");
    expect(await reopened.getItem("campaign")).toBeNull();
    expect(await large.get("campaign")).toBeUndefined();
  });
  it("coalesces rapid world updates and persists the newest one before settling", async () => {
    const { storage, large } = fixture();
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const write = large.set.getMockImplementation()!;
    large.set.mockImplementationOnce(async (key, value) => { await first; await write(key, value); });
    const saving = storage.setItem("campaign", "x".repeat(1_000_001));
    storage.setItem("campaign", "intermediate");
    storage.setItem("campaign", "newest");
    release(); await saving;
    expect(await storage.getItem("campaign")).toBe("newest");
    expect(large.set).toHaveBeenCalledTimes(2);
    await storage.setItem("campaign", "after-completion");
    expect(await storage.getItem("campaign")).toBe("after-completion");
  });
  it("retains the previous save if the first IndexedDB commit fails and permits retry", async () => {
    const { storage, large, errors } = fixture();
    storage.setItem("campaign", "previous");
    large.set.mockRejectedValueOnce(new Error("Disk full"));
    await storage.setItem("campaign", "x".repeat(1_000_001));
    expect(storage.getItem("campaign")).toBe("previous");
    expect(errors).toHaveBeenCalledOnce();
    await storage.setItem("campaign", "y".repeat(1_000_001));
    expect(await storage.getItem("campaign")).toHaveLength(1_000_001);
  });
});
