import { createStore, get, set, del } from "idb-keyval";
import type { StateStorage } from "zustand/middleware";

export const CAMPAIGN_LARGE_MARKER = "dndrom:indexed-campaign:v1";
export function createCampaignStorage(local: Pick<Storage, "getItem" | "setItem" | "removeItem">, large: { get: (key: string) => Promise<string | undefined>; set: (key: string, value: string) => Promise<void>; remove: (key: string) => Promise<void> }, onError: (error: unknown) => void): StateStorage {
  const queues = new Map<string, { latest: string | null; saving?: Promise<void> }>();
  return {
    getItem: (name) => {
      const value = local.getItem(name);
      return value === CAMPAIGN_LARGE_MARKER ? large.get(name).then((saved) => { if (!saved) throw new Error("The saved campaign snapshot could not be loaded"); return saved; }) : value;
    },
    setItem: (name, value) => {
      // Small campaigns retain synchronous startup and backwards compatibility.
      if (value.length < 1_000_000 && local.getItem(name) !== CAMPAIGN_LARGE_MARKER && !queues.has(name)) {
        try { local.setItem(name, value); return; } catch { /* Spill to IndexedDB on quota as well as size. */ }
      }
      let queue = queues.get(name);
      if (!queue) { queue = { latest: null }; queues.set(name, queue); }
      queue.latest = value;
      if (!queue.saving) queue.saving = (async () => {
        try {
          while (queue!.latest !== null) {
            const next = queue!.latest; queue!.latest = null;
            await large.set(name, next);
            // Switch to the pointer only after the complete replacement commits.
            local.setItem(name, CAMPAIGN_LARGE_MARKER);
          }
        } catch (error) { onError(error); }
        finally { queues.delete(name); }
      })();
      return queue.saving;
    },
    removeItem: async (name) => { await queues.get(name)?.saving; local.removeItem(name); await large.remove(name); },
  };
}

let persistenceError: string | null = null;
export const getCampaignPersistenceError = () => persistenceError;
export function reportCampaignPersistenceError(error: unknown): void {
  persistenceError = error instanceof Error ? error.message : String(error);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("dndrom:campaign-storage-error", { detail: persistenceError }));
}
export function browserCampaignStorage(): StateStorage {
  const store = createStore("dndrom-campaign-snapshots-v1", "snapshots");
  return createCampaignStorage(window.localStorage, { get: (key) => get<string>(key, store), set: (key, value) => set(key, value, store), remove: (key) => del(key, store) }, reportCampaignPersistenceError);
}
