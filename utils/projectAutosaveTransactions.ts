import type { ProjectState } from "../types";
import type { VersionAuthority } from '../runtime/versions/versionTypes';
import { serializeProjectCompact } from "./projectSerialization";
import {
  AUTOSAVE_FORMAT_VERSION,
  AUTOSAVE_JOURNAL_MAX_BYTES,
  AUTOSAVE_SNAPSHOT_MAX_BYTES,
  AUTOSAVE_STORAGE_KEYS,
  LEGACY_STORAGE_KEYS,
  autosaveBase,
  autosaveWriterId,
  byteLength,
  browserStorage,
  dirtyMarker,
  errorMessage,
  failureReason,
  fingerprint,
  inspectAutosave,
  loadedSnapshot,
  metadataFor,
  nextTransactionId,
  parseMetadata,
  persistenceError,
  type AutosaveBase,
  type AutosaveFailureReason,
  type AutosaveStorage,
  type AutosaveWriteResult,
} from "./projectAutosaveFormat";

export type PreparedAutosaveSnapshot = {
  historyAuthority?: VersionAuthority;
  serialized: string;
  bytes: number;
  fingerprint: string;
  projectId: string;
  baseGeneration: number;
  baseFingerprint: string | null;
  transactionId: string;
  writerId: string;
};

export type PreparedAutosaveBase = {
  projectId: string;
  baseGeneration: number;
  baseFingerprint: string | null;
  transactionId: string;
  writerId: string;
};

export type AutosaveBasePreparationResult =
  | { status: "base-prepared"; base: PreparedAutosaveBase }
  | { status: "failed"; reason: AutosaveFailureReason; error: string };

export type AutosavePreparationResult =
  | { status: "prepared"; plan: PreparedAutosaveSnapshot }
  | { status: "failed"; reason: AutosaveFailureReason; error: string };

export type PreparedAutosaveStorageBase = {
  destination: "indexed-db" | "local-storage";
  base: PreparedAutosaveBase;
  localFallbackBase?: PreparedAutosaveBase;
};

export type AutosaveStorageBasePreparationResult =
  | { status: "base-prepared"; plan: PreparedAutosaveStorageBase }
  | { status: "failed"; reason: AutosaveFailureReason; error: string };

export type PreparedAutosaveStorageSnapshot = {
  destination: "indexed-db" | "local-storage";
  snapshot: PreparedAutosaveSnapshot;
  localFallbackSnapshot?: PreparedAutosaveSnapshot;
};

export type AutosaveDirtyResult =
  | { status: "marked"; transactionId: string; generation: number }
  | {
      status: "failed";
      reason: AutosaveFailureReason;
      error: string;
      transactionId?: string;
    };

const failedWrite = (
  reason: AutosaveFailureReason,
  error: unknown,
  transactionId?: string,
): AutosaveWriteResult => ({
  status: "failed",
  reason,
  error: errorMessage(error),
  ...(transactionId ? { transactionId } : {}),
});

const failedPreparation = (
  reason: AutosaveFailureReason,
  error: unknown,
): AutosavePreparationResult => ({
  status: "failed",
  reason,
  error: errorMessage(error),
});

type AutosaveJournalSnapshot = {
  base: AutosaveBase;
  current: string | null;
  previous: string | null;
  metadata: string | null;
};

/**
 * Recovery performs full fingerprint and JSON validation. Ordinary writes use
 * the tiny committed metadata token so they do not rescan a multi-megabyte
 * current generation on the main thread before every worker request.
 */
const readAutosaveJournalSnapshot = (
  target: AutosaveStorage,
  includeRollbackValues: boolean,
): AutosaveJournalSnapshot => {
  const metadataRaw = target.getItem(AUTOSAVE_STORAGE_KEYS.autosaveMetadata);
  if (metadataRaw !== null) {
    const metadata = parseMetadata(metadataRaw);
    const current = includeRollbackValues
      ? target.getItem(AUTOSAVE_STORAGE_KEYS.autosave)
      : null;
    const previous = includeRollbackValues
      ? target.getItem(AUTOSAVE_STORAGE_KEYS.autosavePrevious)
      : null;
    return {
      base: {
        generation: metadata.currentGeneration,
        currentRaw: current,
        currentFingerprint: metadata.currentFingerprint,
        previousRaw: previous,
      },
      current,
      previous,
      metadata: metadataRaw,
    };
  }

  const current = target.getItem(AUTOSAVE_STORAGE_KEYS.autosave);
  const previous = current === null
    ? target.getItem(AUTOSAVE_STORAGE_KEYS.autosavePrevious)
    : includeRollbackValues
      ? target.getItem(AUTOSAVE_STORAGE_KEYS.autosavePrevious)
      : null;
  const committed = current ?? previous;
  return {
    base: {
      generation: 0,
      currentRaw: committed,
      currentFingerprint: committed === null ? null : fingerprint(committed),
      previousRaw: previous,
    },
    current: committed,
    previous,
    metadata: null,
  };
};

const restoreJournalSnapshotIfOwned = (
  target: AutosaveStorage,
  before: AutosaveJournalSnapshot,
  dirtyRaw: string,
) => {
  const ownsJournal = () =>
    target.getItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty) === dirtyRaw;
  const restore = (key: string, value: string | null) => {
    if (!ownsJournal()) return false;
    if (value === null) target.removeItem!(key);
    else target.setItem(key, value);
    return ownsJournal();
  };
  return restore(AUTOSAVE_STORAGE_KEYS.autosave, before.current) &&
    restore(AUTOSAVE_STORAGE_KEYS.autosavePrevious, before.previous) &&
    restore(AUTOSAVE_STORAGE_KEYS.autosaveMetadata, before.metadata);
};

/**
 * Capture only the durable journal token. This boundary intentionally does
 * not serialize ProjectState; callers may hand the state to a Worker and
 * complete the plan after its bytes return.
 */
export const prepareAutosaveBase = (
  project: ProjectState,
  storage?: AutosaveStorage,
): AutosaveBasePreparationResult => {
  try {
    const target = storage ?? browserStorage();
    const base = readAutosaveJournalSnapshot(target, false).base;
    if (
      base.generation === 0 &&
      base.currentRaw !== null &&
      loadedSnapshot(base.currentRaw, project).status !== "loaded"
    ) {
      return {
        status: "failed",
        reason: "corruption",
        error: "autosave generation is not a valid project snapshot",
      };
    }
    return {
      status: "base-prepared",
      base: {
        projectId: project.metadata.id,
        baseGeneration: base.generation,
        baseFingerprint: base.currentFingerprint,
        transactionId: nextTransactionId(),
        writerId: autosaveWriterId,
      },
    };
  } catch (error) {
    return {
      status: "failed",
      reason: failureReason(error),
      error: errorMessage(error),
    };
  }
};

/** Complete a previously tokenized plan with bytes prepared off-thread. */
export const completeAutosaveSnapshot = (
  base: PreparedAutosaveBase,
  serialized: string,
  prepared?: { bytes: number; fingerprint: string },
): PreparedAutosaveSnapshot => ({
  serialized,
  bytes: prepared?.bytes ?? byteLength(serialized),
  fingerprint: prepared?.fingerprint ?? fingerprint(serialized),
  ...base,
});

/** Serialize and capture the committed generation token before any write. */
export const prepareAutosaveSnapshot = (
  project: ProjectState,
  storage?: AutosaveStorage,
): AutosavePreparationResult => {
  let serialized: string;
  try {
    serialized = serializeProjectCompact(project);
  } catch (error) {
    return failedPreparation("serialization", error);
  }

  const base = prepareAutosaveBase(project, storage);
  return base.status === "base-prepared"
    ? { status: "prepared", plan: completeAutosaveSnapshot(base.base, serialized) }
    : failedPreparation(base.reason, base.error);
};

const supportsLocalAutosaveFallback = (reason: AutosaveFailureReason) =>
  reason === "unavailable" || reason === "abort" || reason === "quota";

/**
 * Capture the local journal token before awaiting IndexedDB. If the atomic
 * backend later fails, this original token makes the bounded local commit
 * reject rather than overwrite a generation another tab wrote meanwhile.
 */
export const prepareAutosaveStorageBase = async (
  project: ProjectState,
  prepareIndexedDb: (
    project: ProjectState,
  ) => Promise<AutosaveBasePreparationResult>,
  storage?: AutosaveStorage,
): Promise<AutosaveStorageBasePreparationResult> => {
  const local = prepareAutosaveBase(project, storage);
  let indexedDb: AutosaveBasePreparationResult;
  try {
    indexedDb = await prepareIndexedDb(project);
  } catch (error) {
    indexedDb = {
      status: "failed",
      reason: failureReason(error),
      error: errorMessage(error),
    };
  }
  if (indexedDb.status === "base-prepared") {
    return {
      status: "base-prepared",
      plan: {
        destination: "indexed-db",
        base: indexedDb.base,
        ...(local.status === "base-prepared"
          ? { localFallbackBase: local.base }
          : {}),
      },
    };
  }
  if (supportsLocalAutosaveFallback(indexedDb.reason)) {
    return local.status === "base-prepared"
      ? {
          status: "base-prepared",
          plan: { destination: "local-storage", base: local.base },
        }
      : local;
  }
  return indexedDb;
};

export const completeAutosaveStorageSnapshot = (
  plan: PreparedAutosaveStorageBase,
  serialized: string,
  prepared?: { bytes: number; fingerprint: string },
): PreparedAutosaveStorageSnapshot => ({
  destination: plan.destination,
  snapshot: completeAutosaveSnapshot(plan.base, serialized, prepared),
  ...(plan.localFallbackBase
    ? {
        localFallbackSnapshot: completeAutosaveSnapshot(
          plan.localFallbackBase,
          serialized,
          prepared,
        ),
      }
    : {}),
});

/**
 * Commit the current generation, then metadata, then clear the dirty marker.
 * A caller sees `saved` only after every step has completed. A changed base
 * token makes a late completion stale and writes nothing.
 */
export const commitAutosaveSnapshot = (
  plan: PreparedAutosaveSnapshot,
  storage?: AutosaveStorage,
): AutosaveWriteResult => {
  if (plan.bytes > AUTOSAVE_SNAPSHOT_MAX_BYTES) {
    return failedWrite(
      "serialization",
      "autosave exceeds the 6 MB classroom memory budget",
      plan.transactionId,
    );
  }
  let target: AutosaveStorage;
  let before: AutosaveJournalSnapshot | undefined;
  let ownedDirtyRaw: string | undefined;
  try {
    target = storage ?? browserStorage();
    if (typeof target.removeItem !== "function") {
      return failedWrite(
        "abort",
        "storage cannot complete the autosave transaction",
        plan.transactionId,
      );
    }
    const journal = readAutosaveJournalSnapshot(target, true);
    before = journal;
    const { base } = journal;
    if (
      base.generation !== plan.baseGeneration ||
      base.currentFingerprint !== plan.baseFingerprint
    ) {
      return failedWrite(
        "stale-write",
        "autosave write completed after a newer generation",
        plan.transactionId,
      );
    }

    const write = (retainPrevious: boolean): AutosaveWriteResult => {
      const currentBytes = journal.current === null
        ? 0
        : byteLength(journal.current);
      const keepsPrevious =
        retainPrevious &&
        journal.current !== null &&
        currentBytes + plan.bytes <= AUTOSAVE_JOURNAL_MAX_BYTES;
      const metadata = metadataFor(
        base,
        plan.serialized,
        plan.transactionId,
        { bytes: plan.bytes, fingerprint: plan.fingerprint },
        keepsPrevious,
      );
      if (plan.historyAuthority) {
        metadata.historyBranchId = plan.historyAuthority.branchId;
        metadata.previousHistoryBranchId = keepsPrevious && journal.metadata
          ? parseMetadata(journal.metadata).historyBranchId : undefined;
      }
      const dirtyRaw = JSON.stringify(
        dirtyMarker(
          plan.projectId,
          base.generation,
          metadata.currentGeneration,
          plan.transactionId,
        ),
      );
      const requireOwnership = () => {
        if (target.getItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty) !== dirtyRaw) {
          throw persistenceError(
            "stale-write",
            "autosave journal ownership changed during localStorage commit",
          );
        }
      };
      target.setItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty, dirtyRaw);
      requireOwnership();
      ownedDirtyRaw = dirtyRaw;
      if (keepsPrevious && journal.current !== null) {
        target.setItem(AUTOSAVE_STORAGE_KEYS.autosavePrevious, journal.current);
      } else {
        target.removeItem!(AUTOSAVE_STORAGE_KEYS.autosavePrevious);
      }
      requireOwnership();
      target.setItem(AUTOSAVE_STORAGE_KEYS.autosave, plan.serialized);
      requireOwnership();
      target.setItem(
        AUTOSAVE_STORAGE_KEYS.autosaveMetadata,
        JSON.stringify(metadata),
      );
      requireOwnership();
      target.removeItem!(AUTOSAVE_STORAGE_KEYS.autosaveDirty);
      ownedDirtyRaw = undefined;
      return {
        status: "saved",
        bytes: plan.bytes,
        generation: metadata.currentGeneration,
        retainedGenerations: keepsPrevious ? 2 : 1,
        transactionId: plan.transactionId,
        committedAt: metadata.committedAt,
      };
    };

    try {
      return write(true);
    } catch (error) {
      let restored = false;
      if (ownedDirtyRaw) {
        try {
          restored = restoreJournalSnapshotIfOwned(target, before, ownedDirtyRaw);
        } catch {
          // The outer failure path leaves recovery evidence intact.
        }
      }
      if (failureReason(error) !== "quota") throw error;
      if (!ownedDirtyRaw) throw error;
      if (!restored) {
        throw persistenceError(
          "stale-write",
          "autosave journal ownership changed before quota retry",
        );
      }
      try {
        return write(false);
      } catch (fallbackError) {
        try {
          if (ownedDirtyRaw) {
            restoreJournalSnapshotIfOwned(target, before, ownedDirtyRaw);
          }
        } catch {
          // Keep the dirty marker and best available generation evidence.
        }
        throw fallbackError;
      }
    }
  } catch (error) {
    // localStorage has no native transaction. The marker makes an interrupted
    // attempt visible; rollback keeps both committed generations intact when
    // the failure permits ordinary recovery writes.
    try {
      if (
        before &&
        ownedDirtyRaw &&
        typeof target!.removeItem === "function"
      ) {
        restoreJournalSnapshotIfOwned(target!, before, ownedDirtyRaw);
      }
    } catch {
      // Keep the dirty marker and the best available generation evidence.
    }
    return failedWrite(failureReason(error), error, plan.transactionId);
  }
};

/**
 * IndexedDB failures are safe to route to localStorage because its transaction
 * is atomic on rejection. A successful primary commit returns immediately;
 * stale/corrupt/serialization failures never cross stores.
 */
export const commitAutosaveStorageSnapshot = async (
  plan: PreparedAutosaveStorageSnapshot,
  commitIndexedDb: (
    snapshot: PreparedAutosaveSnapshot,
  ) => Promise<AutosaveWriteResult>,
  storage?: AutosaveStorage,
): Promise<AutosaveWriteResult> => {
  if (plan.destination === "local-storage") {
    if (plan.snapshot.historyAuthority) return failedWrite('unavailable', 'Browser storage authority could not be verified. Save Project.', plan.snapshot.transactionId);
    return commitAutosaveSnapshot(plan.snapshot, storage);
  }
  let result: AutosaveWriteResult;
  try {
    result = await commitIndexedDb(plan.snapshot);
  } catch (error) {
    result = failedWrite(
      failureReason(error),
      error,
      plan.snapshot.transactionId,
    );
  }
  if (result.status === "saved") return result;
  if (
    plan.snapshot.historyAuthority ||
    !supportsLocalAutosaveFallback(result.reason) ||
    !plan.localFallbackSnapshot
  ) return result;
  return commitAutosaveSnapshot(plan.localFallbackSnapshot, storage);
};

export const writeAutosaveSnapshot = (
  project: ProjectState,
  storage?: AutosaveStorage,
): AutosaveWriteResult => {
  try {
    const prepared = prepareAutosaveSnapshot(project, storage);
    return prepared.status === "prepared"
      ? commitAutosaveSnapshot(prepared.plan, storage)
      : prepared;
  } catch (error) {
    return failedWrite(failureReason(error), error);
  }
};

export const markAutosaveDirty = (
  project: ProjectState,
  storage?: AutosaveStorage,
): AutosaveDirtyResult => {
  const transactionId = nextTransactionId();
  try {
    const target = storage ?? browserStorage();
    const base = autosaveBase(inspectAutosave(target));
    if (base.previousIssue) {
      return {
        status: "failed",
        reason: "corruption",
        error: base.previousIssue,
        transactionId,
      };
    }
    target.setItem(
      AUTOSAVE_STORAGE_KEYS.autosaveDirty,
      JSON.stringify(
        dirtyMarker(
          project.metadata.id,
          base.generation,
          base.generation + 1,
          transactionId,
        ),
      ),
    );
    return { status: "marked", transactionId, generation: base.generation };
  } catch (error) {
    return {
      status: "failed",
      reason: failureReason(error),
      error: errorMessage(error),
      transactionId,
    };
  }
};

export const migrateAutosaveValue = (
  serialized: string,
  projectId: string,
  storage: AutosaveStorage,
  removeLegacy: boolean,
): { outcome: "legacy-migrated" | "legacy-unmigrated"; error?: string } => {
  const transactionId = nextTransactionId();
  try {
    const metadata = {
      formatVersion: AUTOSAVE_FORMAT_VERSION,
      currentGeneration: 1,
      previousGeneration: null,
      currentFingerprint: fingerprint(serialized),
      previousFingerprint: null,
      bytes: byteLength(serialized),
      transactionId,
      writerId: autosaveWriterId,
      committedAt: Date.now(),
    };
    storage.setItem(
      AUTOSAVE_STORAGE_KEYS.autosaveDirty,
      JSON.stringify(dirtyMarker(projectId, 0, 1, transactionId)),
    );
    storage.setItem(AUTOSAVE_STORAGE_KEYS.autosave, serialized);
    storage.setItem(AUTOSAVE_STORAGE_KEYS.autosaveMetadata, JSON.stringify(metadata));
    if (typeof storage.removeItem !== "function") {
      throw persistenceError("abort", "storage cannot complete autosave migration");
    }
    storage.removeItem(AUTOSAVE_STORAGE_KEYS.autosavePrevious);
    storage.removeItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty);
    if (removeLegacy) storage.removeItem(LEGACY_STORAGE_KEYS.autosave);
    return { outcome: "legacy-migrated" };
  } catch (error) {
    return { outcome: "legacy-unmigrated", error: errorMessage(error) };
  }
};
