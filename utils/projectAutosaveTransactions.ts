import type { ProjectState } from "../types";
import { serializeProject } from "./project";
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
  persistenceError,
  type AutosaveFailureReason,
  type AutosaveStorage,
  type AutosaveWriteResult,
} from "./projectAutosaveFormat";

export type PreparedAutosaveSnapshot = {
  serialized: string;
  bytes: number;
  projectId: string;
  baseGeneration: number;
  baseFingerprint: string | null;
  transactionId: string;
  writerId: string;
};

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

/** Serialize and capture the committed generation token before any write. */
export const prepareAutosaveSnapshot = (
  project: ProjectState,
  storage?: AutosaveStorage,
): AutosavePreparationResult => {
  let serialized: string;
  try {
    serialized = serializeProject(project);
  } catch (error) {
    return failedPreparation("serialization", error);
  }

  try {
    const target = storage ?? browserStorage();
    const base = autosaveBase(inspectAutosave(target));
    if (base.previousIssue) return failedPreparation("corruption", base.previousIssue);
    if (base.currentRaw !== null && loadedSnapshot(base.currentRaw, project).status !== "loaded") {
      return failedPreparation("corruption", "autosave generation is not a valid project snapshot");
    }
    return {
      status: "prepared",
      plan: {
        serialized,
        bytes: byteLength(serialized),
        projectId: project.metadata.id,
        baseGeneration: base.generation,
        baseFingerprint: base.currentFingerprint,
        transactionId: nextTransactionId(),
        writerId: autosaveWriterId,
      },
    };
  } catch (error) {
    return failedPreparation(failureReason(error), error);
  }
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
  let before:
    | {
        current: string | null;
        previous: string | null;
        metadata: string | null;
      }
    | undefined;
  try {
    const target = storage ?? browserStorage();
    if (typeof target.removeItem !== "function") {
      return failedWrite(
        "abort",
        "storage cannot complete the autosave transaction",
        plan.transactionId,
      );
    }
    const inspection = inspectAutosave(target);
    const base = autosaveBase(inspection);
    if (base.previousIssue) return failedWrite("corruption", base.previousIssue, plan.transactionId);
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

    const metadata = metadataFor(base, plan.serialized, plan.transactionId);
    before = {
      current: inspection.currentRaw,
      previous: inspection.previousRaw,
      metadata: target.getItem(AUTOSAVE_STORAGE_KEYS.autosaveMetadata),
    };
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
    if (base.currentRaw !== null) {
      target.setItem(AUTOSAVE_STORAGE_KEYS.autosavePrevious, base.currentRaw);
    }
    target.setItem(AUTOSAVE_STORAGE_KEYS.autosave, plan.serialized);
    target.setItem(AUTOSAVE_STORAGE_KEYS.autosaveMetadata, JSON.stringify(metadata));
    target.removeItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty);
    return {
      status: "saved",
      bytes: plan.bytes,
      generation: metadata.currentGeneration,
      transactionId: plan.transactionId,
    };
  } catch (error) {
    // localStorage has no native transaction. The marker makes an interrupted
    // attempt visible; rollback keeps both committed generations intact when
    // the failure permits ordinary recovery writes.
    try {
      const target = storage ?? browserStorage();
      if (before && typeof target.removeItem === "function") {
        const restore = (key: string, value: string | null) => {
          if (value === null) target.removeItem!(key);
          else target.setItem(key, value);
        };
        restore(AUTOSAVE_STORAGE_KEYS.autosave, before.current);
        restore(AUTOSAVE_STORAGE_KEYS.autosavePrevious, before.previous);
        restore(AUTOSAVE_STORAGE_KEYS.autosaveMetadata, before.metadata);
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
