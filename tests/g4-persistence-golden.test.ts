import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ProjectState } from "../types";
import { createSampleProject, serializeProject } from "../utils/project";
import {
  LEGACY_STORAGE_KEYS,
  STORAGE_KEYS,
  type AutosaveStorage,
  commitAutosaveSnapshot,
  prepareAutosaveSnapshot,
  readAutosaveProject,
  writeAutosaveSnapshot,
} from "../utils/projectPersistence";

type Fault = {
  operation: "set" | "remove";
  key: string;
  error: Error;
};

const makeStorage = (
  values = new Map<string, string>(),
  fault?: Fault,
) => {
  let activeFault = fault;
  const storage: AutosaveStorage & { values: Map<string, string> } = {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (activeFault?.operation === "set" && activeFault.key === key) {
        const error = activeFault.error;
        activeFault = undefined;
        throw error;
      }
      values.set(key, value);
    },
    removeItem: (key) => {
      if (activeFault?.operation === "remove" && activeFault.key === key) {
        const error = activeFault.error;
        activeFault = undefined;
        throw error;
      }
      values.delete(key);
    },
  };
  return storage;
};

const namedError = (name: string, message: string) => {
  const error = new Error(message);
  error.name = name;
  return error;
};

const fixedProject = (): ProjectState => {
  const project = createSampleProject();
  return {
    ...project,
    metadata: {
      ...project.metadata,
      id: "golden-project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    characterPackage: project.characterPackage
      ? {
          ...project.characterPackage,
          createdAt: "2026-01-01T00:00:00.000Z",
        }
      : undefined,
  };
};

const volatileKeys = new Set([
  "changedAt",
  "committedAt",
  "createdAt",
  "transactionId",
  "updatedAt",
  "writerId",
]);

const compareStableKeys = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

const stable = (value: unknown, key?: string): unknown => {
  if (key && volatileKeys.has(key)) return "<volatile>";
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Number(value.toFixed(12));
    return Object.is(normalized, -0) ? 0 : normalized;
  }
  if (Array.isArray(value)) return value.map((item) => stable(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareStableKeys(left, right))
        .map(([entryKey, entryValue]) => [entryKey, stable(entryValue, entryKey)]),
    );
  }
  return value;
};

const stableResult = (result: unknown) => stable(result);

const stableStorage = (values: Map<string, string>) =>
  [...values.entries()]
    .sort(([left], [right]) => compareStableKeys(left, right))
    .map(([key, value]) => {
      if (
        key === STORAGE_KEYS.autosaveMetadata ||
        key === STORAGE_KEYS.autosaveDirty
      ) {
        return [key, stable(JSON.parse(value))];
      }
      return [key, value];
    });

const readSummary = (storage: AutosaveStorage, current: ProjectState) => {
  const result = readAutosaveProject(current, storage);
  return stableResult({
    status: result.status,
    project: "project" in result ? result.project : undefined,
    sourceVersion: "sourceVersion" in result ? result.sourceVersion : undefined,
    migrated: "migrated" in result ? result.migrated : undefined,
    blocker: "blocker" in result ? result.blocker : undefined,
    reason: "reason" in result ? result.reason : undefined,
    recovery: result.recovery,
  });
};

const base = fixedProject();
const first = { ...base, metadata: { ...base.metadata, name: "First" } };
const second = { ...base, metadata: { ...base.metadata, name: "Second" } };
const third = { ...base, metadata: { ...base.metadata, name: "Third" } };

const normalStorage = makeStorage();
const prepared = prepareAutosaveSnapshot(first, normalStorage);
assert.equal(prepared.status, "prepared");
if (prepared.status !== "prepared") throw new Error("expected prepared plan");
const firstCommit = commitAutosaveSnapshot(prepared.plan, normalStorage);
const secondCommit = writeAutosaveSnapshot(second, normalStorage);

const staleValues = new Map<string, string>();
const staleA = makeStorage(staleValues);
const staleB = makeStorage(staleValues);
const oldPlan = prepareAutosaveSnapshot(first, staleA);
const newPlan = prepareAutosaveSnapshot(second, staleB);
assert.equal(oldPlan.status, "prepared");
assert.equal(newPlan.status, "prepared");
if (oldPlan.status !== "prepared" || newPlan.status !== "prepared") {
  throw new Error("expected stale test plans");
}
const newerCommit = commitAutosaveSnapshot(newPlan.plan, staleB);
const staleCommit = commitAutosaveSnapshot(oldPlan.plan, staleA);

const interruptedValues = new Map<string, string>();
const interruptedSeed = makeStorage(interruptedValues);
assert.equal(writeAutosaveSnapshot(first, interruptedSeed).status, "saved");
assert.equal(writeAutosaveSnapshot(second, interruptedSeed).status, "saved");
const interruptedWrite = writeAutosaveSnapshot(
  third,
  makeStorage(interruptedValues, {
    operation: "set",
    key: STORAGE_KEYS.autosave,
    error: namedError("AbortError", "forced abort"),
  }),
);

const legacyStorage = makeStorage();
legacyStorage.values.set(LEGACY_STORAGE_KEYS.autosave, serializeProject(first));
const legacyRead = readSummary(legacyStorage, base);

const corruptStorage = makeStorage();
assert.equal(writeAutosaveSnapshot(first, corruptStorage).status, "saved");
assert.equal(writeAutosaveSnapshot(second, corruptStorage).status, "saved");
const corruptCurrent = JSON.parse(
  corruptStorage.values.get(STORAGE_KEYS.autosave)!,
) as ProjectState;
corruptCurrent.metadata.name = "Corrupted";
corruptStorage.values.set(
  STORAGE_KEYS.autosave,
  JSON.stringify(corruptCurrent, null, 2),
);
const corruptRead = readSummary(corruptStorage, base);
corruptStorage.values.set(STORAGE_KEYS.autosaveMetadata, "{bad metadata");
const corruptMetadataRead = readSummary(corruptStorage, base);

const golden = stable({
  normal: {
    prepared,
    firstCommit,
    secondCommit,
    storage: stableStorage(normalStorage.values),
    recovery: readSummary(normalStorage, base),
  },
  stale: {
    newerCommit,
    staleCommit,
    storage: stableStorage(staleValues),
    recovery: readSummary(staleA, base),
  },
  interrupted: {
    interruptedWrite,
    storage: stableStorage(interruptedValues),
    recovery: readSummary(makeStorage(interruptedValues), base),
  },
  legacy: {
    read: legacyRead,
    storage: stableStorage(legacyStorage.values),
  },
  corruption: {
    current: corruptRead,
    metadata: corruptMetadataRead,
  },
});
const goldenJson = JSON.stringify(golden, null, 2);
const digest = createHash("sha256").update(goldenJson).digest("hex");

assert.equal(
  digest,
  "fae54ed110cf3c28123f8aafcdfa93cac463ad8785348a7f69b35a606afdb7c9",
  `G4 autosave golden changed: ${digest}\n${goldenJson}`,
);
