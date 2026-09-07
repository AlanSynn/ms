import type { ProjectState } from "../../types";
import {
  AUTOSAVE_FORMAT_VERSION,
  AUTOSAVE_SNAPSHOT_MAX_BYTES,
  byteLength,
  errorMessage,
  failureReason,
  fingerprint,
  loadedSnapshot,
  parseDirtyMarker,
  parseMetadata,
  type AutosaveRecovery,
  type ProjectSnapshotLoadResult,
} from "../../utils/projectAutosaveFormat";

export type AutosaveRecoveryStorageSnapshot = {
  currentRaw: string | null;
  previousRaw: string | null;
  metadataRaw: string | null;
  dirtyRaw: string | null;
  legacyRaw: string | null;
};

export type AutosaveRecoveryMigrationIdentity = {
  transactionId: string;
  writerId: string;
  timestamp: number;
};

export type AutosaveRecoveryJobInput = {
  currentProject: ProjectState;
  storage: AutosaveRecoveryStorageSnapshot;
  migration: AutosaveRecoveryMigrationIdentity;
};

export type AutosaveRecoveryMutationPlan = {
  type: "migrate-autosave";
  serializedSource: "current" | "legacy";
  dirtyRaw: string;
  metadataRaw: string;
  removeLegacy: boolean;
};

export type AutosaveProjectReadResult =
  | (Extract<ProjectSnapshotLoadResult, { status: "loaded" }> & {
      recovery: AutosaveRecovery;
      backedUpAt?: number;
    })
  | (Extract<ProjectSnapshotLoadResult, { status: "rejected" }> & {
      recovery: AutosaveRecovery;
    })
  | { status: "missing"; recovery: AutosaveRecovery };

export type AutosaveRecoveryJobOutput = {
  result: AutosaveProjectReadResult;
  mutation?: AutosaveRecoveryMutationPlan;
};

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

export const storageUnavailableRecovery = (
  error: unknown,
): AutosaveProjectReadResult => ({
  status: "missing",
  recovery: { outcome: "storage-unavailable", error: errorMessage(error) },
});

export const recoveryFromStorageReadError = (
  currentProject: ProjectState,
  error: unknown,
): AutosaveProjectReadResult =>
  failureReason(error) === "unavailable"
    ? storageUnavailableRecovery(error)
    : rejectedWithRecovery(currentProject, {
        outcome: "corrupt-generation",
        source: errorMessage(error).includes("dirty marker")
          ? "dirty-marker"
          : "metadata",
        error: errorMessage(error),
      });

const migrationMutation = (
  serialized: string,
  projectId: string,
  serializedSource: "current" | "legacy",
  removeLegacy: boolean,
  migration: AutosaveRecoveryMigrationIdentity,
): AutosaveRecoveryMutationPlan => {
  const serializedFingerprint = fingerprint(serialized);
  const bytes = byteLength(serialized);
  return {
    type: "migrate-autosave",
    serializedSource,
    removeLegacy,
    dirtyRaw: JSON.stringify({
      formatVersion: AUTOSAVE_FORMAT_VERSION,
      projectId,
      baseGeneration: 0,
      targetGeneration: 1,
      transactionId: migration.transactionId,
      writerId: migration.writerId,
      changedAt: migration.timestamp,
    }),
    metadataRaw: JSON.stringify({
      formatVersion: AUTOSAVE_FORMAT_VERSION,
      currentGeneration: 1,
      previousGeneration: null,
      currentFingerprint: serializedFingerprint,
      previousFingerprint: null,
      bytes,
      transactionId: migration.transactionId,
      writerId: migration.writerId,
      committedAt: migration.timestamp,
    }),
  };
};

const migratedOutput = (
  loaded: Extract<ProjectSnapshotLoadResult, { status: "loaded" }>,
  serialized: string,
  serializedSource: "current" | "legacy",
  removeLegacy: boolean,
  recovery: AutosaveRecovery,
  migration: AutosaveRecoveryMigrationIdentity,
): AutosaveRecoveryJobOutput => ({
  result: loadedWithRecovery(loaded, {
    ...recovery,
  }),
  mutation: migrationMutation(
    serialized,
    loaded.project.metadata.id,
    serializedSource,
    removeLegacy,
    migration,
  ),
});

export const recoveryAfterMutationFailure = (
  output: AutosaveRecoveryJobOutput,
  error: unknown,
): AutosaveProjectReadResult => {
  if (!output.mutation || output.result.status !== "loaded") {
    return output.result;
  }
  return {
    ...output.result,
    recovery: {
      ...output.result.recovery,
      outcome:
        output.result.recovery.outcome === "interrupted-write"
          ? "interrupted-write"
          : "legacy-unmigrated",
      error: errorMessage(error),
    },
  };
};

export const runAutosaveRecoveryJob = ({
  currentProject,
  storage,
  migration,
}: AutosaveRecoveryJobInput): AutosaveRecoveryJobOutput => {
  try {
    const stored = storage.currentRaw !== null
      ? { value: storage.currentRaw, fromLegacy: false as const }
      : { value: storage.legacyRaw, fromLegacy: storage.legacyRaw !== null };
    if (
      stored.value !== null &&
      (stored.value.length > AUTOSAVE_SNAPSHOT_MAX_BYTES ||
        (stored.fromLegacy &&
          byteLength(stored.value) > AUTOSAVE_SNAPSHOT_MAX_BYTES))
    ) {
      return {
        result: rejectedWithRecovery(currentProject, {
          outcome: "corrupt-generation",
          source: stored.fromLegacy ? "legacy" : "current",
          error: "autosave exceeds the 6 MB classroom memory budget",
        }),
      };
    }
    const legacyRaw = stored.fromLegacy ? stored.value : null;

    if (stored.fromLegacy && stored.value !== null) {
      const legacy = loadedSnapshot(stored.value, currentProject);
      if (legacy.status !== "loaded") {
        return {
          result: rejectedWithRecovery(currentProject, {
            outcome: "corrupt-generation",
            source: "legacy",
            error: "legacy autosave is not a valid project snapshot",
          }),
        };
      }
      return migratedOutput(
        legacy,
        stored.value,
        "legacy",
        true,
        { outcome: "legacy-migrated", source: "legacy", generation: 1 },
        migration,
      );
    }

    const metadata = storage.metadataRaw === null
      ? null
      : parseMetadata(storage.metadataRaw);
    const dirty = storage.dirtyRaw === null
      ? null
      : parseDirtyMarker(storage.dirtyRaw);
    const { currentRaw, previousRaw } = storage;
    if (
      [currentRaw, previousRaw].some(
        (value) =>
          value !== null &&
          (value.length > AUTOSAVE_SNAPSHOT_MAX_BYTES ||
            byteLength(value) > AUTOSAVE_SNAPSHOT_MAX_BYTES),
      )
    ) {
      return {
        result: rejectedWithRecovery(currentProject, {
          outcome: "corrupt-generation",
          source: currentRaw !== null ? "current" : "previous",
          error: "autosave exceeds the 6 MB classroom memory budget",
        }),
      };
    }

    const currentFingerprint = currentRaw === null ? null : fingerprint(currentRaw);
    const previousFingerprint = previousRaw === null
      ? null
      : fingerprint(previousRaw);
    const currentBytes = currentRaw === null ? null : byteLength(currentRaw);
    if (metadata) {
      const currentMatches =
        currentRaw !== null &&
        currentFingerprint === metadata.currentFingerprint &&
        currentBytes === metadata.bytes;
      const previousMatchesCurrent =
        previousRaw !== null &&
        previousFingerprint === metadata.currentFingerprint &&
        byteLength(previousRaw) === metadata.bytes;
      const previousMatchesPrevious =
        previousRaw !== null &&
        metadata.previousFingerprint !== null &&
        previousFingerprint === metadata.previousFingerprint;

      if (currentMatches && currentRaw !== null) {
        const current = loadedSnapshot(currentRaw, currentProject);
        if (current.status === "loaded") {
          const previousIssue =
            metadata.previousFingerprint !== null &&
            (previousRaw === null ||
              (previousFingerprint !== metadata.previousFingerprint &&
                previousFingerprint !== metadata.currentFingerprint));
          const legacyFingerprint = legacyRaw === null
            ? null
            : fingerprint(legacyRaw);
          const sameLegacy =
            legacyRaw !== null &&
            legacyFingerprint === metadata.currentFingerprint;
          return {
            result: { ...loadedWithRecovery(current, {
              outcome: dirty
                ? "interrupted-write"
                : previousIssue
                  ? "corrupt-generation"
                  : sameLegacy
                    ? "legacy-migrated"
                    : "clean",
              source: "current",
              generation: metadata.currentGeneration,
              error: previousIssue
                ? "autosave previous generation is missing or corrupt"
                : undefined,
            }), backedUpAt: metadata.committedAt },
          };
        }
      }

      if (previousMatchesCurrent && previousRaw !== null) {
        const previous = loadedSnapshot(previousRaw, currentProject);
        if (previous.status === "loaded") {
          return {
            result: { ...loadedWithRecovery(previous, {
              outcome: "interrupted-write",
              source: "previous",
              generation: metadata.currentGeneration,
              error: "current autosave generation is missing or corrupt",
            }), backedUpAt: metadata.committedAt },
          };
        }
      }

      if (previousMatchesPrevious && previousRaw !== null) {
        const previous = loadedSnapshot(previousRaw, currentProject);
        if (previous.status === "loaded") {
          return {
            result: loadedWithRecovery(previous, {
              outcome: "corrupt-generation",
              source: "previous",
              generation: metadata.previousGeneration ?? undefined,
              error: "current autosave generation is corrupt",
            }),
          };
        }
      }

      return {
        result: rejectedWithRecovery(currentProject, {
          outcome: "corrupt-generation",
          source: "metadata",
          generation: metadata.currentGeneration,
          error: "autosave generations do not match their commit metadata",
        }),
      };
    }

    if (currentRaw !== null) {
      const current = loadedSnapshot(currentRaw, currentProject);
      if (current.status === "loaded") {
        return migratedOutput(
          current,
          currentRaw,
          "current",
          false,
          {
            outcome: dirty ? "interrupted-write" : "legacy-migrated",
            source: "current",
            generation: 1,
          },
          migration,
        );
      }
    }

    if (previousRaw !== null) {
      const previous = loadedSnapshot(previousRaw, currentProject);
      if (previous.status === "loaded") {
        return {
          result: loadedWithRecovery(previous, {
            outcome: dirty ? "interrupted-write" : "corrupt-generation",
            source: "previous",
            error: "current autosave generation is missing or corrupt",
          }),
        };
      }
    }

    if (currentRaw !== null || previousRaw !== null) {
      return {
        result: rejectedWithRecovery(currentProject, {
          outcome: "corrupt-generation",
          source: currentRaw !== null ? "current" : "previous",
          error: "autosave snapshot is not a valid project",
        }),
      };
    }
    return {
      result: {
        status: "missing",
        recovery: dirty
          ? {
              outcome: "interrupted-write",
              source: "dirty-marker",
              error: "autosave ended before a complete generation was committed",
            }
          : { outcome: "missing" },
      },
    };
  } catch (error) {
    return {
      result: rejectedWithRecovery(currentProject, {
        outcome: "corrupt-generation",
        source: errorMessage(error).includes("dirty marker")
          ? "dirty-marker"
          : "metadata",
        error: errorMessage(error),
      }),
    };
  }
};
