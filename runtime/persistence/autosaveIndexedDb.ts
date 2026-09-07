import type { ProjectState } from "../../types";
import {
  AUTOSAVE_JOURNAL_MAX_BYTES,
  AUTOSAVE_SNAPSHOT_MAX_BYTES,
  AUTOSAVE_STORAGE_KEYS,
  autosaveWriterId,
  browserStorage,
  dirtyMarker,
  errorMessage,
  failureReason,
  metadataFor,
  nextTransactionId,
  parseDirtyMarker,
  parseMetadata,
  persistenceError,
  type AutosaveBase,
  type AutosaveMetadata,
  type AutosaveStorage,
  type AutosaveWriteResult,
} from "../../utils/projectAutosaveFormat";
import type {
  AutosaveBasePreparationResult,
  AutosaveDirtyResult,
  PreparedAutosaveBase,
  PreparedAutosaveSnapshot,
} from "../../utils/projectAutosaveTransactions";
import type { AutosaveRecoveryStorageSnapshot } from "./autosaveRecoveryJob";

export const AUTOSAVE_INDEXED_DB_NAME = "motionsmith-persistence";
const DATABASE_VERSION = 1;
export const AUTOSAVE_INDEXED_DB_STORE = "autosave-journal";
export const AUTOSAVE_INDEXED_DB_METADATA_KEY = "metadata";
const SNAPSHOT_KEY_PREFIX = "snapshot:";
const RECORD_FORMAT_VERSION = 1;

type StoredAutosaveMetadata = AutosaveMetadata & {
  recordFormatVersion: 1;
  currentKey: string;
  previousKey: string | null;
  previousBytes: number | null;
};

export type IndexedDbAutosaveToken = {
  generation: number;
  fingerprint: string;
  transactionId: string;
};

export type IndexedDbAutosaveRecoverySnapshot = {
  storage: AutosaveRecoveryStorageSnapshot;
  token: IndexedDbAutosaveToken;
};

export interface AutosaveAtomicBackend {
  readMetadata(): Promise<AutosaveMetadata | null>;
  readRecoverySnapshot(): Promise<IndexedDbAutosaveRecoverySnapshot | null>;
  isCurrent(token: IndexedDbAutosaveToken): Promise<boolean>;
  commit(
    plan: PreparedAutosaveSnapshot,
    retainPrevious: boolean,
  ): Promise<Extract<AutosaveWriteResult, { status: "saved" }>>;
  migrate(
    serialized: string,
    metadataRaw: string,
  ): Promise<IndexedDbAutosaveToken>;
  removeIfCurrent(token: IndexedDbAutosaveToken): Promise<void>;
}

const publicMetadata = (stored: StoredAutosaveMetadata): AutosaveMetadata => ({
  formatVersion: stored.formatVersion,
  currentGeneration: stored.currentGeneration,
  previousGeneration: stored.previousGeneration,
  currentFingerprint: stored.currentFingerprint,
  previousFingerprint: stored.previousFingerprint,
  bytes: stored.bytes,
  transactionId: stored.transactionId,
  writerId: stored.writerId,
  committedAt: stored.committedAt,
});

const storedMetadata = (value: unknown): StoredAutosaveMetadata => {
  if (!value || typeof value !== "object") {
    throw persistenceError("corruption", "autosave database metadata is missing");
  }
  const raw = value as Partial<StoredAutosaveMetadata>;
  const metadata = parseMetadata(JSON.stringify({
    formatVersion: raw.formatVersion,
    currentGeneration: raw.currentGeneration,
    previousGeneration: raw.previousGeneration,
    currentFingerprint: raw.currentFingerprint,
    previousFingerprint: raw.previousFingerprint,
    bytes: raw.bytes,
    transactionId: raw.transactionId,
    writerId: raw.writerId,
    committedAt: raw.committedAt,
  }));
  if (
    raw.recordFormatVersion !== RECORD_FORMAT_VERSION ||
    typeof raw.currentKey !== "string" ||
    raw.currentKey.length === 0 ||
    !(raw.previousKey === null || typeof raw.previousKey === "string") ||
    !(
      raw.previousBytes === null ||
      (Number.isInteger(raw.previousBytes) && Number(raw.previousBytes) >= 0)
    )
  ) {
    throw persistenceError("corruption", "autosave database metadata is invalid");
  }
  return { ...metadata, ...raw } as StoredAutosaveMetadata;
};

const tokenFor = (metadata: AutosaveMetadata): IndexedDbAutosaveToken => ({
  generation: metadata.currentGeneration,
  fingerprint: metadata.currentFingerprint,
  transactionId: metadata.transactionId,
});

const sameToken = (
  left: IndexedDbAutosaveToken,
  right: IndexedDbAutosaveToken,
) => left.generation === right.generation &&
  left.fingerprint === right.fingerprint &&
  left.transactionId === right.transactionId;

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(
      transaction.error ?? new DOMException("IndexedDB transaction aborted", "AbortError"),
    );
    transaction.onerror = () => {
      // onabort owns rejection after IndexedDB has rolled the transaction back.
    };
  });

let databasePromise: Promise<IDBDatabase> | undefined;

const openAutosaveDatabase = () => {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      persistenceError("unavailable", "IndexedDB unavailable"),
    );
  }
  databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(AUTOSAVE_INDEXED_DB_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(AUTOSAVE_INDEXED_DB_STORE)) {
        request.result.createObjectStore(AUTOSAVE_INDEXED_DB_STORE);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(
      request.error ?? persistenceError("unavailable", "IndexedDB open failed"),
    );
    request.onblocked = () => reject(
      persistenceError("unavailable", "IndexedDB upgrade is blocked"),
    );
  }).catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
};

const readStoredMetadata = async (
  store: IDBObjectStore,
): Promise<StoredAutosaveMetadata | null> => {
  const value = await requestResult(store.get(AUTOSAVE_INDEXED_DB_METADATA_KEY));
  return value === undefined ? null : storedMetadata(value);
};

const metadataRaw = (metadata: AutosaveMetadata) => JSON.stringify(metadata);

export const createBrowserAutosaveAtomicBackend = (): AutosaveAtomicBackend => ({
  async readMetadata() {
    const database = await openAutosaveDatabase();
    const transaction = database.transaction(AUTOSAVE_INDEXED_DB_STORE, "readonly");
    const done = transactionDone(transaction);
    const metadata = await readStoredMetadata(transaction.objectStore(AUTOSAVE_INDEXED_DB_STORE));
    await done;
    return metadata ? publicMetadata(metadata) : null;
  },

  async readRecoverySnapshot() {
    const database = await openAutosaveDatabase();
    const transaction = database.transaction(AUTOSAVE_INDEXED_DB_STORE, "readonly");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(AUTOSAVE_INDEXED_DB_STORE);
    const metadata = await readStoredMetadata(store);
    if (!metadata) {
      await done;
      return null;
    }
    const currentRaw = await requestResult(store.get(metadata.currentKey));
    const previousRaw = metadata.previousKey === null
      ? null
      : await requestResult(store.get(metadata.previousKey));
    await done;
    return {
      storage: {
        currentRaw: typeof currentRaw === "string" ? currentRaw : null,
        previousRaw: typeof previousRaw === "string" ? previousRaw : null,
        metadataRaw: metadataRaw(publicMetadata(metadata)),
        dirtyRaw: null,
        legacyRaw: null,
      },
      token: tokenFor(metadata),
    };
  },

  async isCurrent(token) {
    const metadata = await this.readMetadata();
    return metadata !== null && sameToken(tokenFor(metadata), token);
  },

  async commit(plan, retainPrevious) {
    const database = await openAutosaveDatabase();
    const transaction = database.transaction(AUTOSAVE_INDEXED_DB_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(AUTOSAVE_INDEXED_DB_STORE);
    try {
      const prior = await readStoredMetadata(store);
      const baseGeneration = prior?.currentGeneration ?? 0;
      const baseFingerprint = prior?.currentFingerprint ?? null;
      if (
        baseGeneration !== plan.baseGeneration ||
        baseFingerprint !== plan.baseFingerprint
      ) {
        throw persistenceError(
          "stale-write",
          "autosave write completed after a newer generation",
        );
      }
      const keepsPrevious = Boolean(
        retainPrevious &&
        prior &&
        prior.bytes + plan.bytes <= AUTOSAVE_JOURNAL_MAX_BYTES,
      );
      const base: AutosaveBase = {
        generation: baseGeneration,
        currentRaw: null,
        currentFingerprint: baseFingerprint,
        previousRaw: null,
      };
      const nextMetadata = metadataFor(
        base,
        plan.serialized,
        plan.transactionId,
        { bytes: plan.bytes, fingerprint: plan.fingerprint },
        keepsPrevious,
      );
      const nextKey = `${SNAPSHOT_KEY_PREFIX}${plan.transactionId}`;
      const nextStored: StoredAutosaveMetadata = {
        ...nextMetadata,
        recordFormatVersion: RECORD_FORMAT_VERSION,
        currentKey: nextKey,
        previousKey: keepsPrevious ? prior!.currentKey : null,
        previousBytes: keepsPrevious ? prior!.bytes : null,
      };
      store.put(plan.serialized, nextKey);
      store.put(nextStored, AUTOSAVE_INDEXED_DB_METADATA_KEY);
      if (prior?.previousKey && prior.previousKey !== nextStored.previousKey) {
        store.delete(prior.previousKey);
      }
      if (prior?.currentKey && !keepsPrevious && prior.currentKey !== nextKey) {
        store.delete(prior.currentKey);
      }
      await done;
      return {
        status: "saved",
        bytes: plan.bytes,
        generation: nextMetadata.currentGeneration,
        retainedGenerations: keepsPrevious ? 2 : 1,
        transactionId: plan.transactionId,
        committedAt: nextMetadata.committedAt,
      };
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The request failure may already have rolled the transaction back.
      }
      await done.catch(() => undefined);
      throw error;
    }
  },

  async migrate(serialized, rawMetadata) {
    const metadata = parseMetadata(rawMetadata);
    if (metadata.bytes > AUTOSAVE_SNAPSHOT_MAX_BYTES) {
      throw persistenceError(
        "serialization",
        "autosave exceeds the 6 MB classroom memory budget",
      );
    }
    const database = await openAutosaveDatabase();
    const transaction = database.transaction(AUTOSAVE_INDEXED_DB_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(AUTOSAVE_INDEXED_DB_STORE);
    try {
      const prior = await readStoredMetadata(store);
      if (prior !== null) {
        throw persistenceError(
          "stale-write",
          "autosave changed before legacy migration completed",
        );
      }
      const currentKey = `${SNAPSHOT_KEY_PREFIX}${metadata.transactionId}`;
      const nextStored: StoredAutosaveMetadata = {
        ...metadata,
        recordFormatVersion: RECORD_FORMAT_VERSION,
        currentKey,
        previousKey: null,
        previousBytes: null,
      };
      store.put(serialized, currentKey);
      store.put(nextStored, AUTOSAVE_INDEXED_DB_METADATA_KEY);
      await done;
      return tokenFor(metadata);
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The request failure may already have rolled the transaction back.
      }
      await done.catch(() => undefined);
      throw error;
    }
  },

  async removeIfCurrent(token) {
    const database = await openAutosaveDatabase();
    const transaction = database.transaction(AUTOSAVE_INDEXED_DB_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(AUTOSAVE_INDEXED_DB_STORE);
    try {
      const metadata = await readStoredMetadata(store);
      if (metadata && sameToken(tokenFor(metadata), token)) {
        store.delete(metadata.currentKey);
        if (metadata.previousKey) store.delete(metadata.previousKey);
        store.delete(AUTOSAVE_INDEXED_DB_METADATA_KEY);
      }
      await done;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The request failure may already have rolled the transaction back.
      }
      await done.catch(() => undefined);
      throw error;
    }
  },
});

let browserBackend: AutosaveAtomicBackend | undefined;

export const browserAutosaveAtomicBackend = () =>
  browserBackend ??= createBrowserAutosaveAtomicBackend();

export const prepareIndexedDbAutosaveBase = async (
  project: ProjectState,
  backend: AutosaveAtomicBackend = browserAutosaveAtomicBackend(),
): Promise<AutosaveBasePreparationResult> => {
  try {
    const metadata = await backend.readMetadata();
    const base: PreparedAutosaveBase = {
      projectId: project.metadata.id,
      baseGeneration: metadata?.currentGeneration ?? 0,
      baseFingerprint: metadata?.currentFingerprint ?? null,
      transactionId: nextTransactionId(),
      writerId: autosaveWriterId,
    };
    return { status: "base-prepared", base };
  } catch (error) {
    return {
      status: "failed",
      reason: failureReason(error),
      error: errorMessage(error),
    };
  }
};

const dirtyStorage = (storage?: AutosaveStorage) => {
  try {
    return storage ?? browserStorage();
  } catch {
    return undefined;
  }
};

const clearOwnedDirtyMarker = (
  transactionId: string,
  storage?: AutosaveStorage,
) => {
  const target = dirtyStorage(storage);
  if (!target?.removeItem) return;
  try {
    const raw = target.getItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty);
    if (raw !== null && parseDirtyMarker(raw).transactionId === transactionId) {
      target.removeItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty);
    }
  } catch {
    // A malformed or unavailable marker remains visible to recovery.
  }
};

const writeIndexedDbAutosaveDirty = (
  projectId: string,
  baseGeneration = 0,
  transactionId = nextTransactionId(),
  storage?: AutosaveStorage,
): AutosaveDirtyResult => {
  try {
    const target = storage ?? browserStorage();
    target.setItem(
      AUTOSAVE_STORAGE_KEYS.autosaveDirty,
      JSON.stringify(
        dirtyMarker(projectId, baseGeneration, baseGeneration + 1, transactionId),
      ),
    );
    return { status: "marked", transactionId, generation: baseGeneration };
  } catch (error) {
    return {
      status: "failed",
      reason: failureReason(error),
      error: errorMessage(error),
      transactionId,
    };
  }
};

export const markIndexedDbAutosaveDirty = (
  project: ProjectState,
  baseGeneration = 0,
  transactionId = nextTransactionId(),
  storage?: AutosaveStorage,
) => writeIndexedDbAutosaveDirty(
  project.metadata.id,
  baseGeneration,
  transactionId,
  storage,
);

export const commitIndexedDbAutosaveSnapshot = async (
  plan: PreparedAutosaveSnapshot,
  backend: AutosaveAtomicBackend = browserAutosaveAtomicBackend(),
  storage?: AutosaveStorage,
): Promise<AutosaveWriteResult> => {
  if (plan.bytes > AUTOSAVE_SNAPSHOT_MAX_BYTES) {
    return {
      status: "failed",
      reason: "serialization",
      error: "autosave exceeds the 6 MB classroom memory budget",
      transactionId: plan.transactionId,
    };
  }
  writeIndexedDbAutosaveDirty(
    plan.projectId,
    plan.baseGeneration,
    plan.transactionId,
    storage,
  );
  try {
    let result: Extract<AutosaveWriteResult, { status: "saved" }>;
    try {
      result = await backend.commit(plan, true);
    } catch (error) {
      if (failureReason(error) !== "quota") throw error;
      result = await backend.commit(plan, false);
    }
    clearOwnedDirtyMarker(plan.transactionId, storage);
    return result;
  } catch (error) {
    return {
      status: "failed",
      reason: failureReason(error),
      error: errorMessage(error),
      transactionId: plan.transactionId,
    };
  }
};
