import type { ProjectState } from "../types";
import {
  AUTOSAVE_STORAGE_KEYS,
  LEGACY_STORAGE_KEYS,
  autosaveBase,
  browserStorage,
  byteLength,
  errorMessage,
  failureReason,
  fingerprint,
  inspectAutosave,
  loadedSnapshot,
  readStorageWithLegacy,
  type AutosaveRecovery,
  type AutosaveStorage,
  type ProjectSnapshotLoadResult,
} from "./projectAutosaveFormat";
import { migrateAutosaveValue } from "./projectAutosaveTransactions";

export type AutosaveProjectReadResult =
  | (Extract<ProjectSnapshotLoadResult, { status: "loaded" }> & {
      recovery: AutosaveRecovery;
    })
  | (Extract<ProjectSnapshotLoadResult, { status: "rejected" }> & {
      recovery: AutosaveRecovery;
    })
  | { status: "missing"; recovery: AutosaveRecovery };

const loadedWithRecovery = (
  result: Extract<ProjectSnapshotLoadResult, { status: "loaded" }>,
  recovery: AutosaveRecovery,
) => ({ ...result, recovery });

const rejectedWithRecovery = (
  currentProject: ProjectState,
  recovery: AutosaveRecovery,
) => ({
  status: "rejected" as const,
  project: currentProject,
  blocker: "Fix: Update project" as const,
  reason: "invalid-snapshot" as const,
  recovery,
});

export const readAutosaveProject = (
  currentProject: ProjectState,
  storage?: AutosaveStorage,
): AutosaveProjectReadResult => {
  let target: AutosaveStorage;
  try {
    target = storage ?? browserStorage();
    const stored = readStorageWithLegacy(
      AUTOSAVE_STORAGE_KEYS.autosave,
      LEGACY_STORAGE_KEYS.autosave,
      target,
    );
    const legacyRaw = target.getItem(LEGACY_STORAGE_KEYS.autosave);

    if (stored.fromLegacy && stored.value !== null) {
      const legacy = loadedSnapshot(stored.value, currentProject);
      if (legacy.status !== "loaded") {
        return rejectedWithRecovery(currentProject, {
          outcome: "corrupt-generation",
          source: "legacy",
          error: "legacy autosave is not a valid project snapshot",
        });
      }
      const migrated = migrateAutosaveValue(
        stored.value,
        legacy.project.metadata.id,
        target,
        true,
      );
      return loadedWithRecovery(legacy, {
        outcome: migrated.outcome,
        source: "legacy",
        generation: 1,
        error: migrated.error,
      });
    }

    const inspection = inspectAutosave(target);
    const { currentRaw, previousRaw, metadata, dirty } = inspection;
    if (metadata) {
      const currentMatches =
        currentRaw !== null &&
        fingerprint(currentRaw) === metadata.currentFingerprint &&
        byteLength(currentRaw) === metadata.bytes;
      const previousMatchesCurrent =
        previousRaw !== null &&
        fingerprint(previousRaw) === metadata.currentFingerprint &&
        byteLength(previousRaw) === metadata.bytes;
      const previousMatchesPrevious =
        previousRaw !== null &&
        metadata.previousFingerprint !== null &&
        fingerprint(previousRaw) === metadata.previousFingerprint;

      if (currentMatches && currentRaw !== null) {
        const current = loadedSnapshot(currentRaw, currentProject);
        if (current.status === "loaded") {
          const previousIssue =
            metadata.previousFingerprint !== null &&
            (previousRaw === null ||
              (fingerprint(previousRaw) !== metadata.previousFingerprint &&
                fingerprint(previousRaw) !== metadata.currentFingerprint));
          const sameLegacy =
            legacyRaw !== null && fingerprint(legacyRaw) === metadata.currentFingerprint;
          let legacyCleanupFailed = sameLegacy && typeof target.removeItem !== "function";
          if (sameLegacy && typeof target.removeItem === "function") {
            try {
              target.removeItem(LEGACY_STORAGE_KEYS.autosave);
            } catch {
              legacyCleanupFailed = true;
            }
          }
          return loadedWithRecovery(current, {
            outcome: dirty
              ? "interrupted-write"
              : previousIssue
                ? "corrupt-generation"
                : legacyCleanupFailed
                  ? "legacy-unmigrated"
                : sameLegacy
                  ? "legacy-migrated"
                  : "clean",
            source: "current",
            generation: metadata.currentGeneration,
            error: previousIssue
              ? "autosave previous generation is missing or corrupt"
              : legacyCleanupFailed
                ? "legacy autosave key could not be removed"
                : undefined,
          });
        }
      }

      if (previousMatchesCurrent && previousRaw !== null) {
        const previous = loadedSnapshot(previousRaw, currentProject);
        if (previous.status === "loaded") {
          return loadedWithRecovery(previous, {
            outcome: "interrupted-write",
            source: "previous",
            generation: metadata.currentGeneration,
            error: "current autosave generation is missing or corrupt",
          });
        }
      }

      if (previousMatchesPrevious && previousRaw !== null) {
        const previous = loadedSnapshot(previousRaw, currentProject);
        if (previous.status === "loaded") {
          return loadedWithRecovery(previous, {
            outcome: "corrupt-generation",
            source: "previous",
            generation: metadata.previousGeneration ?? undefined,
            error: "current autosave generation is corrupt",
          });
        }
      }

      return rejectedWithRecovery(currentProject, {
        outcome: "corrupt-generation",
        source: "metadata",
        generation: metadata.currentGeneration,
        error: "autosave generations do not match their commit metadata",
      });
    }

    if (currentRaw !== null) {
      const current = loadedSnapshot(currentRaw, currentProject);
      if (current.status === "loaded") {
        const migrated = migrateAutosaveValue(
          currentRaw,
          current.project.metadata.id,
          target,
          false,
        );
        return loadedWithRecovery(current, {
          outcome: dirty ? "interrupted-write" : migrated.outcome,
          source: "current",
          generation: 1,
          error: migrated.error,
        });
      }
    }

    if (previousRaw !== null) {
      const previous = loadedSnapshot(previousRaw, currentProject);
      if (previous.status === "loaded") {
        return loadedWithRecovery(previous, {
          outcome: dirty ? "interrupted-write" : "corrupt-generation",
          source: "previous",
          error: "current autosave generation is missing or corrupt",
        });
      }
    }

    if (currentRaw !== null || previousRaw !== null) {
      return rejectedWithRecovery(currentProject, {
        outcome: "corrupt-generation",
        source: currentRaw !== null ? "current" : "previous",
        error: "autosave snapshot is not a valid project",
      });
    }
    return {
      status: "missing",
      recovery: dirty
        ? {
            outcome: "interrupted-write",
            source: "dirty-marker",
            error: "autosave ended before a complete generation was committed",
          }
        : { outcome: "missing" },
    };
  } catch (error) {
    const reason = failureReason(error);
    return reason === "unavailable"
      ? {
          status: "missing",
          recovery: { outcome: "storage-unavailable", error: errorMessage(error) },
        }
      : rejectedWithRecovery(currentProject, {
          outcome: "corrupt-generation",
          source: errorMessage(error).includes("dirty marker") ? "dirty-marker" : "metadata",
          error: errorMessage(error),
        });
  }
};
