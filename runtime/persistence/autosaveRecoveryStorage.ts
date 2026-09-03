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

const RECOVERY_STORAGE_KEYS = {
  currentRaw: AUTOSAVE_STORAGE_KEYS.autosave,
  previousRaw: AUTOSAVE_STORAGE_KEYS.autosavePrevious,
  metadataRaw: AUTOSAVE_STORAGE_KEYS.autosaveMetadata,
  dirtyRaw: AUTOSAVE_STORAGE_KEYS.autosaveDirty,
  legacyRaw: LEGACY_STORAGE_KEYS.autosave,
} satisfies Record<keyof AutosaveRecoveryStorageSnapshot, string>;

const RECOVERY_STORAGE_FIELDS = Object.keys(
  RECOVERY_STORAGE_KEYS,
) as Array<keyof AutosaveRecoveryStorageSnapshot>;

/**
 * localStorage has atomic individual calls but no atomic compare-and-swap or
 * multi-key transaction. Recovery therefore compares the complete captured
 * journal before and after every individual mutation. This closes every race
 * observable between calls; another browser process can still race inside the
 * irreducible getItem/removeItem gap, so IndexedDB remains the atomic store.
 */
const createAutosaveRecoveryStorageGuard = (
  snapshot: AutosaveRecoveryStorageSnapshot,
  storage: AutosaveStorage,
) => {
  const expected = { ...snapshot };
  const legacyWasCaptured = snapshot.currentRaw === null;
  const isCurrent = () => RECOVERY_STORAGE_FIELDS.every((field) =>
    (field === "legacyRaw" && !legacyWasCaptured) ||
    storage.getItem(RECOVERY_STORAGE_KEYS[field]) === expected[field]
  );
  const replace = (
    field: keyof AutosaveRecoveryStorageSnapshot,
    value: string | null,
  ) => {
    if (!isCurrent()) return false;
    if (expected[field] === value) return true;
    const key = RECOVERY_STORAGE_KEYS[field];
    if (value === null) storage.removeItem!(key);
    else storage.setItem(key, value);
    expected[field] = value;
    return isCurrent();
  };
  return { isCurrent, replace, legacyWasCaptured };
};

/**
 * Recovery is cold-path work, so compare all captured journal values rather
 * than relying only on metadata tokens. That prevents cleanup from acting on
 * bytes replaced by another tab without a completed metadata publication.
 */
export const autosaveRecoveryStorageIsCurrent = (
  snapshot: AutosaveRecoveryStorageSnapshot,
  storage: AutosaveStorage = browserStorage(),
) => createAutosaveRecoveryStorageGuard(snapshot, storage).isCurrent();

export type AutosaveRecoveryMutationResult =
  | { status: "applied" }
  | { status: "failed"; error: string };

export const clearMigratedAutosaveStorage = (
  snapshot: AutosaveRecoveryStorageSnapshot,
  storage: AutosaveStorage = browserStorage(),
) => {
  if (typeof storage.removeItem !== "function") return false;
  const guard = createAutosaveRecoveryStorageGuard(snapshot, storage);
  if (!guard.isCurrent()) return false;
  // Remove metadata first so an interrupted cleanup cannot leave metadata
  // pointing at bytes this cleanup already removed.
  if (!guard.replace("metadataRaw", null)) return false;
  if (!guard.replace("previousRaw", null)) return false;
  if (!guard.replace("currentRaw", null)) return false;
  if (!guard.replace("dirtyRaw", null)) return false;
  if (
    guard.legacyWasCaptured &&
    !guard.replace("legacyRaw", null)
  ) return false;
  return guard.isCurrent();
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
    const guard = createAutosaveRecoveryStorageGuard(snapshot, storage);
    const requireCurrent = (current: boolean) => {
      if (!current) throw new Error("autosave changed during recovery migration");
    };
    requireCurrent(guard.replace("dirtyRaw", plan.dirtyRaw));
    requireCurrent(guard.replace("currentRaw", serialized));
    requireCurrent(guard.replace("metadataRaw", plan.metadataRaw));
    if (typeof storage.removeItem !== "function") {
      throw new Error("storage cannot complete autosave migration");
    }
    // Migration metadata has no previous generation. Remove stale compatibility
    // bytes before declaring the ordered migration complete.
    requireCurrent(guard.replace("previousRaw", null));
    if (plan.removeLegacy && guard.legacyWasCaptured) {
      requireCurrent(guard.replace("legacyRaw", null));
    }
    requireCurrent(guard.replace("dirtyRaw", null));
    return { status: "applied" };
  } catch (error) {
    return { status: "failed", error: errorMessage(error) };
  }
};
