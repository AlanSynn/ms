import type { Page } from "@playwright/test";
import type { ProjectState } from "../../types";
import {
  AUTOSAVE_INDEXED_DB_METADATA_KEY,
  AUTOSAVE_INDEXED_DB_NAME,
  AUTOSAVE_INDEXED_DB_STORE,
} from "../../runtime/persistence/autosaveIndexedDb";

export type BrowserAutosaveProbe = {
  project: ProjectState | null;
  currentRaw: string | null;
  previousRaw: string | null;
  metadata: {
    currentGeneration: number;
    previousGeneration: number | null;
    currentKey: string;
    previousKey: string | null;
  } | null;
};

const databaseIdentity = {
  databaseName: AUTOSAVE_INDEXED_DB_NAME,
  storeName: AUTOSAVE_INDEXED_DB_STORE,
  metadataKey: AUTOSAVE_INDEXED_DB_METADATA_KEY,
};

export const readBrowserAutosaveProbe = (page: Page) =>
  page.evaluate(async (identity): Promise<BrowserAutosaveProbe> =>
    new Promise((resolve, reject) => {
      const open = indexedDB.open(identity.databaseName, 1);
      open.onerror = () => reject(open.error ?? new Error("IndexedDB open failed"));
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(identity.storeName)) {
          open.result.createObjectStore(identity.storeName);
        }
      };
      open.onsuccess = () => {
        const database = open.result;
        const transaction = database.transaction(identity.storeName, "readonly");
        const store = transaction.objectStore(identity.storeName);
        const metadataRequest = store.get(identity.metadataKey);
        let currentRaw: string | null = null;
        let previousRaw: string | null = null;
        let metadata: BrowserAutosaveProbe["metadata"] = null;
        metadataRequest.onerror = () => reject(
          metadataRequest.error ?? new Error("Autosave metadata read failed"),
        );
        metadataRequest.onsuccess = () => {
          const value = metadataRequest.result as BrowserAutosaveProbe["metadata"];
          if (!value?.currentKey) return;
          metadata = value;
          const currentRequest = store.get(value.currentKey);
          currentRequest.onsuccess = () => {
            currentRaw = typeof currentRequest.result === "string"
              ? currentRequest.result
              : null;
          };
          if (value.previousKey) {
            const previousRequest = store.get(value.previousKey);
            previousRequest.onsuccess = () => {
              previousRaw = typeof previousRequest.result === "string"
                ? previousRequest.result
                : null;
            };
          }
        };
        transaction.onerror = () => reject(
          transaction.error ?? new Error("Autosave transaction failed"),
        );
        transaction.oncomplete = () => {
          database.close();
          let project: ProjectState | null = null;
          try {
            project = currentRaw ? JSON.parse(currentRaw) as ProjectState : null;
          } catch {
            project = null;
          }
          resolve({ project, currentRaw, previousRaw, metadata });
        };
      };
    }), databaseIdentity);

export const readBrowserAutosaveProject = async (page: Page) =>
  (await readBrowserAutosaveProbe(page)).project;

export const clearBrowserAutosave = (page: Page) =>
  page.evaluate(async (identity) =>
    new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(identity.databaseName, 1);
      open.onerror = () => reject(open.error ?? new Error("IndexedDB open failed"));
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(identity.storeName)) {
          open.result.createObjectStore(identity.storeName);
        }
      };
      open.onsuccess = () => {
        const database = open.result;
        const transaction = database.transaction(identity.storeName, "readwrite");
        const store = transaction.objectStore(identity.storeName);
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          for (const key of keys.result) {
            if (key === identity.metadataKey || (typeof key === 'string' && key.startsWith('snapshot:'))) store.delete(key);
          }
        };
        transaction.onerror = () => reject(
          transaction.error ?? new Error("Autosave clear failed"),
        );
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
      };
    }), databaseIdentity);

export const moveBrowserAutosaveToLegacyStorage = async (page: Page) => {
  const probe = await readBrowserAutosaveProbe(page);
  if (!probe.currentRaw) throw new Error("No IndexedDB autosave to migrate");
  await clearBrowserAutosave(page);
  await page.evaluate((serialized) => {
    const legacyPrefix = ["mech", "anim"].join("");
    for (const key of [
      "motionsmith.autosave",
      "motionsmith.autosave.previous",
      "motionsmith.autosave.metadata",
      "motionsmith.autosave.dirty",
    ]) localStorage.removeItem(key);
    localStorage.setItem(`${legacyPrefix}.autosave`, serialized);
  }, probe.currentRaw);
};
