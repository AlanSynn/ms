import {
  AUTOSAVE_STORAGE_KEYS,
  LEGACY_STORAGE_KEYS,
  browserStorage,
  errorMessage,
  type AutosaveStorage,
} from "../../utils/projectAutosaveFormat";
import type {
  AutosaveRecoveryMutationPlan,
  AutosaveRecoveryStorageSnapshot,
} from "./autosaveRecoveryJob";

export const captureAutosaveRecoveryStorage = (
  storage: AutosaveStorage = browserStorage(),
): AutosaveRecoveryStorageSnapshot => {
  const metadataRaw = storage.getItem(AUTOSAVE_STORAGE_KEYS.autosaveMetadata);
  const dirtyRaw = storage.getItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty);
  const currentRaw = storage.getItem(AUTOSAVE_STORAGE_KEYS.autosave);
  return {
    currentRaw,
    previousRaw: storage.getItem(AUTOSAVE_STORAGE_KEYS.autosavePrevious),
    metadataRaw,
    dirtyRaw,
    legacyRaw:
      currentRaw === null ? storage.getItem(LEGACY_STORAGE_KEYS.autosave) : null,
  };
};

/**
 * Journal writers always publish a dirty marker before changing a generation
 * and metadata after it. Comparing those small tokens avoids rescanning a
 * multi-megabyte committed snapshot on the main thread. Journals without
 * metadata are migration inputs, so their raw values are guarded directly.
 */
export const autosaveRecoveryStorageIsCurrent = (
  snapshot: AutosaveRecoveryStorageSnapshot,
  storage: AutosaveStorage = browserStorage(),
) => {
  const metadataRaw = storage.getItem(AUTOSAVE_STORAGE_KEYS.autosaveMetadata);
  const dirtyRaw = storage.getItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty);
  if (
    metadataRaw !== snapshot.metadataRaw ||
    dirtyRaw !== snapshot.dirtyRaw
  ) return false;
  if (snapshot.metadataRaw !== null || snapshot.dirtyRaw !== null) {
    return true;
  }
  const currentRaw = storage.getItem(AUTOSAVE_STORAGE_KEYS.autosave);
  return (
    currentRaw === snapshot.currentRaw &&
    storage.getItem(AUTOSAVE_STORAGE_KEYS.autosavePrevious) ===
      snapshot.previousRaw &&
    (currentRaw !== null ||
      storage.getItem(LEGACY_STORAGE_KEYS.autosave) === snapshot.legacyRaw)
  );
};

export type AutosaveRecoveryMutationResult =
  | { status: "applied" }
  | { status: "failed"; error: string };

export const clearMigratedAutosaveStorage = (
  snapshot: AutosaveRecoveryStorageSnapshot,
  storage: AutosaveStorage = browserStorage(),
) => {
  if (
    typeof storage.removeItem !== "function" ||
    !autosaveRecoveryStorageIsCurrent(snapshot, storage)
  ) return false;
  storage.removeItem(AUTOSAVE_STORAGE_KEYS.autosave);
  storage.removeItem(AUTOSAVE_STORAGE_KEYS.autosavePrevious);
  storage.removeItem(AUTOSAVE_STORAGE_KEYS.autosaveMetadata);
  storage.removeItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty);
  storage.removeItem(LEGACY_STORAGE_KEYS.autosave);
  return true;
};

/** Apply the same ordered, recoverable migration writes as the legacy reader. */
export const applyAutosaveRecoveryMutation = (
  plan: AutosaveRecoveryMutationPlan,
  snapshot: AutosaveRecoveryStorageSnapshot,
  storage: AutosaveStorage = browserStorage(),
): AutosaveRecoveryMutationResult => {
  try {
    const serialized = plan.serializedSource === "legacy"
      ? snapshot.legacyRaw
      : snapshot.currentRaw;
    if (serialized === null) {
      throw new Error("autosave migration source is missing");
    }
    storage.setItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty, plan.dirtyRaw);
    storage.setItem(AUTOSAVE_STORAGE_KEYS.autosave, serialized);
    storage.setItem(AUTOSAVE_STORAGE_KEYS.autosaveMetadata, plan.metadataRaw);
    if (typeof storage.removeItem !== "function") {
      throw new Error("storage cannot complete autosave migration");
    }
    storage.removeItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty);
    if (plan.removeLegacy) storage.removeItem(LEGACY_STORAGE_KEYS.autosave);
    return { status: "applied" };
  } catch (error) {
    return { status: "failed", error: errorMessage(error) };
  }
};
