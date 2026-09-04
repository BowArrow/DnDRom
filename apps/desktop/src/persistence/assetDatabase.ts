import type { UseStore } from "idb-keyval";

const DATABASE_NAME = "dndrom-assets-v1";
const STORE_NAMES = ["gaussian-splats", "mesh-tokens", "dice-pbr-textures", "mesh-props", "prop-source-images", "prop-pbr-textures", "baseplate-source-images", "baseplate-masks", "baseplate-thumbnails", "baseplate-pbr-maps", "baseplate-height-data", "world-blueprints", "world-chunk-meshes", "world-heightfields", "world-navigation", "world-splat-tiles", "scene-thumbnails", "world-generation-checkpoints"] as const;
export type AssetStoreName = typeof STORE_NAMES[number];

let databasePromise: Promise<IDBDatabase> | undefined;

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const initial = indexedDB.open(DATABASE_NAME);
  initial.onerror = () => reject(initial.error);
  initial.onupgradeneeded = () => {
    for (const name of STORE_NAMES) if (!initial.result.objectStoreNames.contains(name)) initial.result.createObjectStore(name);
  };
  initial.onsuccess = () => {
    const database = initial.result;
    if (STORE_NAMES.every((name) => database.objectStoreNames.contains(name))) { resolve(database); return; }
    const nextVersion = database.version + 1;
    database.close();
    const upgrade = indexedDB.open(DATABASE_NAME, nextVersion);
    upgrade.onerror = () => reject(upgrade.error);
    upgrade.onupgradeneeded = () => {
      for (const name of STORE_NAMES) if (!upgrade.result.objectStoreNames.contains(name)) upgrade.result.createObjectStore(name);
    };
    upgrade.onsuccess = () => resolve(upgrade.result);
  };
});

const database = (): Promise<IDBDatabase> => {
  if (!databasePromise) {
    databasePromise = openDatabase().then((value) => {
      value.onversionchange = () => { value.close(); databasePromise = undefined; };
      value.onclose = () => { databasePromise = undefined; };
      return value;
    }, (error) => { databasePromise = undefined; throw error; });
  }
  return databasePromise;
};

/** One upgraded database owns every binary asset store, including profiles created by early builds. */
export const createAssetStore = (storeName: AssetStoreName): UseStore => async (mode, callback) => {
  const db = await database();
  return await callback(db.transaction(storeName, mode).objectStore(storeName));
};
