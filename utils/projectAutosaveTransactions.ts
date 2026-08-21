import type { ProjectState } from "../types";
import { serializeProjectCompact } from "./projectSerialization";
import {
  AUTOSAVE_FORMAT_VERSION,
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

const restoreJournalSnapshot = (
  target: AutosaveStorage,
  before: AutosaveJournalSnapshot,
) => {
  const restore = (key: string, value: string | null) => {
    if (value === null) target.removeItem!(key);
    else target.setItem(key, value);
  };
  restore(AUTOSAVE_STORAGE_KEYS.autosave, before.current);
  restore(AUTOSAVE_STORAGE_KEYS.autosavePrevious, before.previous);
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

/**
 * Commit the current generation, then metadata, then clear the dirty marker.
 * A caller sees `saved` only after every step has completed. A changed base
 * token makes a late completion stale and writes nothing.
 */
export const commitAutosaveSnapshot = (
  plan: PreparedAutosaveSnapshot,
  storage?: AutosaveStorage,
): AutosaveWriteResult => {
  let target: AutosaveStorage;
  let before: AutosaveJournalSnapshot | undefined;
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
      const keepsPrevious = retainPrevious && journal.current !== null;
      const metadata = metadataFor(
        base,
        plan.serialized,
        plan.transactionId,
        { bytes: plan.bytes, fingerprint: plan.fingerprint },
        keepsPrevious,
      );
      target.setItem(
        AUTOSAVE_STORAGE_KEYS.autosaveDirty,
        JSON.stringify(
          dirtyMarker(
            plan.projectId,
            base.generation,
            metadata.currentGeneration,
            plan.transactionId,
          ),
        ),
      );
      if (keepsPrevious && journal.current !== null) {
        target.setItem(AUTOSAVE_STORAGE_KEYS.autosavePrevious, journal.current);
      } else {
        target.removeItem!(AUTOSAVE_STORAGE_KEYS.autosavePrevious);
      }
      target.setItem(AUTOSAVE_STORAGE_KEYS.autosave, plan.serialized);
      target.setItem(
        AUTOSAVE_STORAGE_KEYS.autosaveMetadata,
        JSON.stringify(metadata),
      );
      target.removeItem!(AUTOSAVE_STORAGE_KEYS.autosaveDirty);
      return {
        status: "saved",
        bytes: plan.bytes,
        generation: metadata.currentGeneration,
        retainedGenerations: keepsPrevious ? 2 : 1,
        transactionId: plan.transactionId,
      };
    };

    try {
      return write(true);
    } catch (error) {
      try {
        restoreJournalSnapshot(target, before);
      } catch {
        // Quota recovery below starts by dropping the optional generation.
      }
      if (failureReason(error) !== "quota") throw error;
      try {
        target.removeItem(AUTOSAVE_STORAGE_KEYS.autosavePrevious);
        return write(false);
      } catch (fallbackError) {
        try {
          restoreJournalSnapshot(target, before);
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
      if (before && typeof target!.removeItem === "function") {
        restoreJournalSnapshot(target!, before);
      }
    } catch {
      // Keep the dirty marker and the best available generation evidence.
    }
    return failedWrite(failureReason(error), error, plan.transactionId);
  }
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
    storage.removeItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty);
    if (removeLegacy) storage.removeItem(LEGACY_STORAGE_KEYS.autosave);
    return { outcome: "legacy-migrated" };
  } catch (error) {
    return { outcome: "legacy-unmigrated", error: errorMessage(error) };
  }
};
