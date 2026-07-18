import type { AppStage, CanvasViewport, ProjectSnapshotLoadResult, ProjectState } from "../types";
import { loadProjectSnapshot, serializeProject } from "./project";
import { normalizeCanvasViewport } from "./viewport";

export const STORAGE_KEYS = {
  autosave: "motionsmith.autosave",
  workspace: "motionsmith.workspace",
} as const;

const AUTOSAVE_DB_NAME = "motionsmith-project";
const AUTOSAVE_DB_VERSION = 1;
const AUTOSAVE_STORE = "autosave";
const AUTOSAVE_CURRENT = "current";
const AUTOSAVE_PREVIOUS = "previous";
const AUTOSAVE_DIRTY = "dirty";

const LEGACY_STORAGE_PREFIX = ["mech", "anim"].join("");
export const LEGACY_STORAGE_KEYS = {
  autosave: `${LEGACY_STORAGE_PREFIX}.autosave`,
  workspace: `${LEGACY_STORAGE_PREFIX}.workspace`,
} as const;

type StoredStorageValue = {
  value: string | null;
  fromLegacy: boolean;
};

export const readStorageWithLegacy = (
  key: string,
  legacyKey: string,
): StoredStorageValue => {
  const current = localStorage.getItem(key);
  if (current !== null) return { value: current, fromLegacy: false };
  const legacy = localStorage.getItem(legacyKey);
  return { value: legacy, fromLegacy: legacy !== null };
};

export const migrateStorageValue = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ponytail: migration is best-effort; legacy read fallback still works.
  }
};

const projectFileStem = (name: string) =>
  (name.trim() || "MotionSmith-project")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "MotionSmith-project";

export const projectSnapshotFileName = (projectName: string, suffix: string) =>
  `${projectFileStem(projectName)}${suffix}.motionsmith.json`;

export type AutosaveWriteResult =
  | { status: "saved"; bytes: number }
  | { status: "failed"; error: string };

type AutosaveGeneration = {
  id: typeof AUTOSAVE_CURRENT | typeof AUTOSAVE_PREVIOUS;
  serialized: string;
  savedAt: number;
  bytes: number;
};

type AutosaveDirtyMarker = {
  id: typeof AUTOSAVE_DIRTY;
  projectId: string;
  changedAt: number;
};

let autosaveDbPromise: Promise<IDBDatabase> | undefined;

const indexedDbAvailable = () =>
  typeof indexedDB !== "undefined" && typeof window !== "undefined";

const openAutosaveDb = () => {
  if (!indexedDbAvailable()) return Promise.reject(new Error("IndexedDB unavailable"));
  if (!autosaveDbPromise) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(AUTOSAVE_DB_NAME, AUTOSAVE_DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(AUTOSAVE_STORE)) {
          request.result.createObjectStore(AUTOSAVE_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          autosaveDbPromise = undefined;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    });
    autosaveDbPromise = opening;
    // A transient storage failure must not permanently poison this tab's
    // recovery path; later autosave attempts can reopen the database.
    void opening.catch(() => {
      if (autosaveDbPromise === opening) autosaveDbPromise = undefined;
    });
  }
  return autosaveDbPromise;
};

const transactionComplete = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });

const saveSerializedAutosave = async (serialized: string): Promise<AutosaveWriteResult> => {
  try {
    const db = await openAutosaveDb();
    const transaction = db.transaction(AUTOSAVE_STORE, "readwrite");
    const store = transaction.objectStore(AUTOSAVE_STORE);
    const currentRequest = store.get(AUTOSAVE_CURRENT);
    currentRequest.onsuccess = () => {
      const current = currentRequest.result as AutosaveGeneration | undefined;
      if (current?.id === AUTOSAVE_CURRENT && typeof current.serialized === "string") {
        store.put({ ...current, id: AUTOSAVE_PREVIOUS } satisfies AutosaveGeneration);
      }
      store.put({
        id: AUTOSAVE_CURRENT,
        serialized,
        savedAt: Date.now(),
        bytes: new Blob([serialized]).size,
      } satisfies AutosaveGeneration);
      store.delete(AUTOSAVE_DIRTY);
    };
    await transactionComplete(transaction);
    return { status: "saved", bytes: new Blob([serialized]).size };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Serializing belongs in a normal idle/debounced path. Supplying an already
 * prepared string limits hidden-tab work to one best-effort IndexedDB transaction.
 */
export const writeAutosaveSnapshot = (
  projectOrSerialized: ProjectState | string,
): Promise<AutosaveWriteResult> => {
  try {
    const serialized = typeof projectOrSerialized === "string"
      ? projectOrSerialized
      : serializeProject(projectOrSerialized);
    return saveSerializedAutosave(serialized);
  } catch (error) {
    return Promise.resolve({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const markAutosaveDirty = async (project: ProjectState): Promise<AutosaveWriteResult> => {
  try {
    const db = await openAutosaveDb();
    const transaction = db.transaction(AUTOSAVE_STORE, "readwrite");
    transaction.objectStore(AUTOSAVE_STORE).put({
      id: AUTOSAVE_DIRTY,
      projectId: project.metadata.id,
      changedAt: Date.now(),
    } satisfies AutosaveDirtyMarker);
    await transactionComplete(transaction);
    return { status: "saved", bytes: 0 };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export type AutosaveStorageStatus = {
  usage?: number;
  quota?: number;
  persistent?: boolean;
};

/** Request best-effort durable browser storage without making autosave depend on it. */
export const prepareAutosaveStorage = async (): Promise<AutosaveStorageStatus> => {
  if (typeof navigator === "undefined" || !navigator.storage) return {};
  try {
    const [estimate, persistent] = await Promise.all([
      navigator.storage.estimate?.(),
      navigator.storage.persist?.(),
    ]);
    return {
      usage: estimate?.usage,
      quota: estimate?.quota,
      persistent,
    };
  } catch {
    return {};
  }
};

type AutosaveLoadedProjectResult = Extract<
  ProjectSnapshotLoadResult,
  { status: "loaded" }
> & {
  mayHaveUnsavedChanges?: boolean;
};

export type AutosaveProjectReadResult =
  | AutosaveLoadedProjectResult
  | Exclude<ProjectSnapshotLoadResult, { status: "loaded" }>
  | { status: "missing" };

export const readAutosaveProject = (
  currentProject: ProjectState,
): AutosaveProjectReadResult => {
  const stored = readStorageWithLegacy(
    STORAGE_KEYS.autosave,
    LEGACY_STORAGE_KEYS.autosave,
  );
  if (!stored.value) return { status: "missing" };
  let raw: unknown;
  try {
    raw = JSON.parse(stored.value);
  } catch {
    return loadProjectSnapshot(undefined, currentProject);
  }
  const loaded = loadProjectSnapshot(raw, currentProject);
  if (loaded.status === "loaded" && stored.fromLegacy) {
    migrateStorageValue(STORAGE_KEYS.autosave, stored.value);
  }
  return loaded;
};

const loadSerializedAutosave = (
  serialized: string,
  currentProject: ProjectState,
): AutosaveProjectReadResult => {
  try {
    return loadProjectSnapshot(JSON.parse(serialized), currentProject);
  } catch {
    return loadProjectSnapshot(undefined, currentProject);
  }
};

const clearLegacyAutosave = () => {
  try {
    localStorage.removeItem(STORAGE_KEYS.autosave);
    localStorage.removeItem(LEGACY_STORAGE_KEYS.autosave);
  } catch {
    // A successful IndexedDB copy is already present; stale localStorage is harmless.
  }
};

/**
 * Asynchronous recovery prefers the two durable generations, then imports the
 * old localStorage value once. The synchronous reader remains as a startup
 * fallback for browsers where IndexedDB is disabled.
 */
export const readAutosaveProjectAsync = async (
  currentProject: ProjectState,
): Promise<AutosaveProjectReadResult> => {
  let mayHaveUnsavedChanges = false;
  if (indexedDbAvailable()) {
    try {
      const db = await openAutosaveDb();
      const transaction = db.transaction(AUTOSAVE_STORE, "readonly");
      const store = transaction.objectStore(AUTOSAVE_STORE);
      const [current, previous, dirty] = await Promise.all([
        requestResult(store.get(AUTOSAVE_CURRENT)) as Promise<AutosaveGeneration | undefined>,
        requestResult(store.get(AUTOSAVE_PREVIOUS)) as Promise<AutosaveGeneration | undefined>,
        requestResult(store.get(AUTOSAVE_DIRTY)) as Promise<AutosaveDirtyMarker | undefined>,
      ]);
      await transactionComplete(transaction);
      mayHaveUnsavedChanges = dirty?.id === AUTOSAVE_DIRTY;
      for (const generation of [current, previous]) {
        if (!generation || typeof generation.serialized !== "string") continue;
        const loaded = loadSerializedAutosave(generation.serialized, currentProject);
        if (loaded.status === "loaded") {
          return mayHaveUnsavedChanges
            ? { ...loaded, mayHaveUnsavedChanges: true }
            : loaded;
        }
      }
    } catch {
      // Fall through to the legacy synchronous store when IndexedDB is unavailable.
    }
  }

  const legacy = readStorageWithLegacy(
    STORAGE_KEYS.autosave,
    LEGACY_STORAGE_KEYS.autosave,
  );
  if (!legacy.value) return { status: "missing" };
  const loaded = loadSerializedAutosave(legacy.value, currentProject);
  if (loaded.status !== "loaded") return loaded;
  const migrated = await saveSerializedAutosave(legacy.value);
  if (migrated.status === "saved") clearLegacyAutosave();
  return mayHaveUnsavedChanges
    ? { ...loaded, mayHaveUnsavedChanges: true }
    : loaded;
};

export type WorkspaceLayoutSnapshot = {
  stage: AppStage;
  viewport: CanvasViewport;
  toolbarVisible: boolean;
  partPanelVisible: boolean;
};

export const writeWorkspaceLayoutSnapshot = (
  snapshot: WorkspaceLayoutSnapshot,
) => {
  localStorage.setItem(STORAGE_KEYS.workspace, JSON.stringify(snapshot));
};

type WorkspaceLayoutStorage = Partial<{
  stage: unknown;
  viewport: unknown;
  toolbarVisible: unknown;
  partPanelVisible: unknown;
}>;

export type RestoredWorkspaceLayout = {
  stage?: AppStage;
  viewport?: CanvasViewport;
  visibility?: {
    toolbarVisible: boolean;
    partPanelVisible: boolean;
  };
  warnings: string[];
};

type ReadWorkspaceLayoutOptions = {
  isAppStage: (value: unknown) => value is AppStage;
  currentToolbarVisible: boolean;
  currentPartPanelVisible: boolean;
};

export const readWorkspaceLayoutSnapshot = ({
  isAppStage,
  currentToolbarVisible,
  currentPartPanelVisible,
}: ReadWorkspaceLayoutOptions): RestoredWorkspaceLayout | null => {
  const stored = readStorageWithLegacy(
    STORAGE_KEYS.workspace,
    LEGACY_STORAGE_KEYS.workspace,
  );
  if (!stored.value) return null;

  const layout = JSON.parse(stored.value) as WorkspaceLayoutStorage;
  if (stored.fromLegacy) migrateStorageValue(STORAGE_KEYS.workspace, stored.value);

  const warnings: string[] = [];
  const restored: RestoredWorkspaceLayout = { warnings };

  if (layout.viewport !== undefined) {
    const viewport = normalizeCanvasViewport(layout.viewport);
    if (viewport) restored.viewport = viewport;
    else warnings.push("ignored invalid workspace viewport");
  }

  if (
    layout.toolbarVisible !== undefined ||
    layout.partPanelVisible !== undefined
  ) {
    const toolbarVisible =
      typeof layout.toolbarVisible === "boolean"
        ? layout.toolbarVisible
        : currentToolbarVisible;
    const partPanelVisible =
      typeof layout.partPanelVisible === "boolean"
        ? layout.partPanelVisible
        : currentPartPanelVisible;
    if (
      layout.toolbarVisible !== undefined &&
      typeof layout.toolbarVisible !== "boolean"
    ) {
      warnings.push("ignored invalid toolbar visibility");
    }
    if (
      layout.partPanelVisible !== undefined &&
      typeof layout.partPanelVisible !== "boolean"
    ) {
      warnings.push("ignored invalid panel visibility");
    }
    restored.visibility = { toolbarVisible, partPanelVisible };
  }

  if (layout.stage !== undefined) {
    if (isAppStage(layout.stage)) restored.stage = layout.stage;
    else warnings.push("ignored invalid workspace stage");
  }

  return restored;
};
