import type { ProjectState } from "../types";
import { validateProjectImportShape } from "../runtime/import/projectImportPolicy";
import { loadProjectSnapshot } from "./project";
import {
  autosaveByteLength,
  autosaveFingerprint,
} from "./autosaveFingerprint";

export type ProjectSnapshotLoadResult =
  | { status: "loaded"; project: ProjectState; sourceVersion: 1 }
  | {
      status: "rejected";
      project: ProjectState;
      blocker: "Fix: Update project";
      reason: "invalid-snapshot";
    };

export const AUTOSAVE_STORAGE_KEYS = {
  autosave: "motionsmith.autosave",
  autosavePrevious: "motionsmith.autosave.previous",
  autosaveMetadata: "motionsmith.autosave.metadata",
  autosaveDirty: "motionsmith.autosave.dirty",
} as const;

const LEGACY_STORAGE_PREFIX = ["mech", "anim"].join("");
export const LEGACY_STORAGE_KEYS = {
  autosave: `${LEGACY_STORAGE_PREFIX}.autosave`,
  workspace: `${LEGACY_STORAGE_PREFIX}.workspace`,
} as const;

export type AutosaveStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

export type AutosaveFailureReason =
  | "quota"
  | "abort"
  | "stale-write"
  | "corruption"
  | "unavailable"
  | "serialization";

export type AutosaveWriteResult =
  | {
      status: "saved";
      bytes: number;
      generation: number;
      retainedGenerations: 1 | 2;
      transactionId: string;
    }
  | {
      status: "failed";
      reason: AutosaveFailureReason;
      error: string;
      transactionId?: string;
    };

export type AutosaveRecoveryOutcome =
  | "clean"
  | "interrupted-write"
  | "legacy-migrated"
  | "legacy-unmigrated"
  | "corrupt-generation"
  | "missing"
  | "storage-unavailable";

export type AutosaveRecovery = {
  outcome: AutosaveRecoveryOutcome;
  source?: "current" | "previous" | "legacy" | "metadata" | "dirty-marker";
  generation?: number;
  error?: string;
};

export type StoredStorageValue = { value: string | null; fromLegacy: boolean };
export type PersistenceError = Error & { autosaveReason?: AutosaveFailureReason };

export type AutosaveMetadata = {
  formatVersion: 1;
  currentGeneration: number;
  previousGeneration: number | null;
  currentFingerprint: string;
  previousFingerprint: string | null;
  bytes: number;
  transactionId: string;
  writerId: string;
  committedAt: number;
};

export type AutosaveDirtyMarker = {
  formatVersion: 1;
  projectId: string;
  baseGeneration: number;
  targetGeneration: number;
  transactionId: string;
  writerId: string;
  changedAt: number;
};

export type AutosaveInspection = {
  currentRaw: string | null;
  previousRaw: string | null;
  metadata: AutosaveMetadata | null;
  dirty: AutosaveDirtyMarker | null;
};

export type AutosaveBase = {
  generation: number;
  currentRaw: string | null;
  currentFingerprint: string | null;
  previousRaw: string | null;
  previousIssue?: string;
};

export const AUTOSAVE_FORMAT_VERSION = 1 as const;
export const AUTOSAVE_SNAPSHOT_MAX_BYTES = 6 * 1024 * 1024;
export const AUTOSAVE_JOURNAL_MAX_BYTES = 8 * 1024 * 1024;
let autosaveSequence = 0;
export const autosaveWriterId = `tab-${Date.now()}-${++autosaveSequence}`;

export const browserStorage = (): AutosaveStorage => {
  if (typeof localStorage === "undefined") {
    const error = new Error("localStorage unavailable") as PersistenceError;
    error.autosaveReason = "unavailable";
    throw error;
  }
  return localStorage;
};

export const readStorageWithLegacy = (
  key: string,
  legacyKey: string,
  storage: AutosaveStorage = browserStorage(),
): StoredStorageValue => {
  const current = storage.getItem(key);
  if (current !== null) return { value: current, fromLegacy: false };
  const legacy = storage.getItem(legacyKey);
  return { value: legacy, fromLegacy: legacy !== null };
};

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const failureReason = (error: unknown): AutosaveFailureReason => {
  if (error && typeof error === "object") {
    const named = error as { name?: unknown; autosaveReason?: unknown };
    if (
      named.autosaveReason === "quota" ||
      named.autosaveReason === "abort" ||
      named.autosaveReason === "stale-write" ||
      named.autosaveReason === "corruption" ||
      named.autosaveReason === "unavailable" ||
      named.autosaveReason === "serialization"
    ) {
      return named.autosaveReason;
    }
    if (
      named.name === "QuotaExceededError" ||
      named.name === "NS_ERROR_DOM_QUOTA_REACHED"
    ) {
      return "quota";
    }
    if (
      named.name === "AbortError" ||
      named.name === "InvalidStateError" ||
      named.name === "TransactionInactiveError"
    ) {
      return "abort";
    }
  }
  return errorMessage(error).includes("localStorage unavailable")
    ? "unavailable"
    : "abort";
};

export const persistenceError = (
  reason: AutosaveFailureReason,
  message: string,
): PersistenceError => {
  const error = new Error(message) as PersistenceError;
  error.autosaveReason = reason;
  return error;
};

export const byteLength = autosaveByteLength;
export const fingerprint = autosaveFingerprint;

export const nextTransactionId = () => {
  autosaveSequence += 1;
  return `${Date.now()}-${autosaveSequence}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parseMetadata = (raw: string): AutosaveMetadata => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw persistenceError("corruption", "autosave metadata is not valid JSON");
  }
  if (
    !isRecord(value) ||
    value.formatVersion !== AUTOSAVE_FORMAT_VERSION ||
    !Number.isInteger(value.currentGeneration) ||
    Number(value.currentGeneration) < 1 ||
    !(
      value.previousGeneration === null ||
      (Number.isInteger(value.previousGeneration) &&
        Number(value.previousGeneration) >= 1 &&
        Number(value.previousGeneration) < Number(value.currentGeneration))
    ) ||
    typeof value.currentFingerprint !== "string" ||
    value.currentFingerprint.length === 0 ||
    !(value.previousFingerprint === null || typeof value.previousFingerprint === "string") ||
    !Number.isInteger(value.bytes) ||
    Number(value.bytes) < 0 ||
    typeof value.transactionId !== "string" ||
    value.transactionId.length === 0 ||
    typeof value.writerId !== "string" ||
    value.writerId.length === 0 ||
    !Number.isFinite(value.committedAt)
  ) {
    throw persistenceError("corruption", "autosave metadata is invalid");
  }
  return value as unknown as AutosaveMetadata;
};

export const parseDirtyMarker = (raw: string): AutosaveDirtyMarker => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw persistenceError("corruption", "autosave dirty marker is not valid JSON");
  }
  if (
    !isRecord(value) ||
    value.formatVersion !== AUTOSAVE_FORMAT_VERSION ||
    typeof value.projectId !== "string" ||
    !Number.isInteger(value.baseGeneration) ||
    Number(value.baseGeneration) < 0 ||
    !Number.isInteger(value.targetGeneration) ||
    Number(value.targetGeneration) < 1 ||
    typeof value.transactionId !== "string" ||
    value.transactionId.length === 0 ||
    typeof value.writerId !== "string" ||
    value.writerId.length === 0 ||
    !Number.isFinite(value.changedAt)
  ) {
    throw persistenceError("corruption", "autosave dirty marker is invalid");
  }
  return value as unknown as AutosaveDirtyMarker;
};

export const inspectAutosave = (storage: AutosaveStorage): AutosaveInspection => {
  const metadata = storage.getItem(AUTOSAVE_STORAGE_KEYS.autosaveMetadata);
  const dirty = storage.getItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty);
  return {
    currentRaw: storage.getItem(AUTOSAVE_STORAGE_KEYS.autosave),
    previousRaw: storage.getItem(AUTOSAVE_STORAGE_KEYS.autosavePrevious),
    metadata: metadata === null ? null : parseMetadata(metadata),
    dirty: dirty === null ? null : parseDirtyMarker(dirty),
  };
};

export const autosaveBase = (inspection: AutosaveInspection): AutosaveBase => {
  const { currentRaw, previousRaw, metadata } = inspection;
  if (!metadata) {
    const raw = currentRaw ?? previousRaw;
    return {
      generation: 0,
      currentRaw: raw,
      currentFingerprint: raw === null ? null : fingerprint(raw),
      previousRaw: currentRaw === null ? null : previousRaw,
    };
  }

  const currentMatches =
    currentRaw !== null &&
    fingerprint(currentRaw) === metadata.currentFingerprint &&
    byteLength(currentRaw) === metadata.bytes;
  const previousMatchesCurrent =
    previousRaw !== null &&
    fingerprint(previousRaw) === metadata.currentFingerprint &&
    byteLength(previousRaw) === metadata.bytes;
  const raw = currentMatches ? currentRaw : previousMatchesCurrent ? previousRaw : null;
  if (raw === null) {
    return {
      generation: metadata.currentGeneration,
      currentRaw: null,
      currentFingerprint: metadata.currentFingerprint,
      previousRaw,
      previousIssue: "autosave current generation is missing or corrupt",
    };
  }

  let previousIssue: string | undefined;
  if (metadata.previousFingerprint !== null) {
    if (previousRaw === null) {
      previousIssue = "autosave previous generation is missing";
    } else {
      const previousFingerprint = fingerprint(previousRaw);
      if (
        previousFingerprint !== metadata.previousFingerprint &&
        previousFingerprint !== metadata.currentFingerprint
      ) {
        previousIssue = "autosave previous generation is corrupt";
      }
    }
  } else if (
    previousRaw !== null &&
    fingerprint(previousRaw) !== metadata.currentFingerprint
  ) {
    previousIssue = "autosave previous generation is corrupt";
  }

  return {
    generation: metadata.currentGeneration,
    currentRaw: raw,
    currentFingerprint: metadata.currentFingerprint,
    previousRaw,
    previousIssue,
  };
};

export const loadedSnapshot = (
  serialized: string,
  currentProject: ProjectState,
): ProjectSnapshotLoadResult => {
  try {
    const raw = JSON.parse(serialized) as unknown;
    if (!raw || typeof raw !== "object" || !("metadata" in raw) || !("settings" in raw)) {
      throw new Error("autosave snapshot is missing project state");
    }
    validateProjectImportShape(raw);
    return {
      status: "loaded",
      project: loadProjectSnapshot(raw),
      sourceVersion: 1,
    };
  } catch {
    return {
      status: "rejected",
      project: currentProject,
      blocker: "Fix: Update project",
      reason: "invalid-snapshot",
    };
  }
};

export const dirtyMarker = (
  projectId: string,
  baseGeneration: number,
  targetGeneration: number,
  transactionId: string,
): AutosaveDirtyMarker => ({
  formatVersion: AUTOSAVE_FORMAT_VERSION,
  projectId,
  baseGeneration,
  targetGeneration,
  transactionId,
  writerId: autosaveWriterId,
  changedAt: Date.now(),
});

export const metadataFor = (
  base: AutosaveBase,
  serialized: string,
  transactionId: string,
  prepared?: { bytes: number; fingerprint: string },
  retainPrevious = true,
): AutosaveMetadata => ({
  formatVersion: AUTOSAVE_FORMAT_VERSION,
  currentGeneration: base.generation + 1,
  previousGeneration:
    retainPrevious && base.currentFingerprint !== null ? base.generation : null,
  currentFingerprint: prepared?.fingerprint ?? fingerprint(serialized),
  previousFingerprint: retainPrevious ? base.currentFingerprint : null,
  bytes: prepared?.bytes ?? byteLength(serialized),
  transactionId,
  writerId: autosaveWriterId,
  committedAt: Date.now(),
});
