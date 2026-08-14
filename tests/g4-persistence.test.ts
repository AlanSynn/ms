import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ProjectState } from "../types";
import { createSampleProject, serializeProject } from "../utils/project";
import {
  LEGACY_STORAGE_KEYS,
  STORAGE_KEYS,
  type AutosaveStorage,
  commitAutosaveSnapshot,
  markAutosaveDirty,
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
  const log: string[] = [];
  let activeFault = fault;
  const storage: AutosaveStorage & {
    values: Map<string, string>;
    log: string[];
  } = {
    values,
    log,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      log.push(`set:${key}`);
      if (activeFault?.operation === "set" && activeFault.key === key) {
        const error = activeFault.error;
        activeFault = undefined;
        throw error;
      }
      values.set(key, value);
    },
    removeItem: (key) => {
      log.push(`remove:${key}`);
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

const projectNamed = (project: ProjectState, name: string): ProjectState => ({
  ...project,
  metadata: { ...project.metadata, name },
});

const loadedProject = (storage: AutosaveStorage, current: ProjectState) => {
  const result = readAutosaveProject(current, storage);
  assert.equal(result.status, "loaded");
  if (result.status !== "loaded") throw new Error("expected a loaded project");
  return result;
};

const base = createSampleProject();
const first = projectNamed(base, "First generation");
const second = projectNamed(base, "Second generation");
const third = projectNamed(base, "Third generation");

// A normal write leaves two raw, independently parseable generations and no
// marker. The saved result is returned after the final marker removal.
{
  const storage = makeStorage();
  const firstWrite = writeAutosaveSnapshot(first, storage);
  assert.equal(firstWrite.status, "saved");
  const secondWrite = writeAutosaveSnapshot(second, storage);
  assert.equal(secondWrite.status, "saved");
  if (firstWrite.status !== "saved" || secondWrite.status !== "saved") {
    throw new Error("expected complete writes");
  }
  assert.equal(secondWrite.generation, firstWrite.generation + 1);
  assert.equal(storage.values.get(STORAGE_KEYS.autosave), serializeProject(second));
  assert.equal(storage.values.get(STORAGE_KEYS.autosavePrevious), serializeProject(first));
  assert.equal(storage.values.has(STORAGE_KEYS.autosaveDirty), false);
  assert.equal(storage.log.at(-1), `remove:${STORAGE_KEYS.autosaveDirty}`);
  assert.equal(loadedProject(storage, base).recovery.outcome, "clean");
}

// A forced abort after the previous generation is copied never claims saved;
// recovery keeps the committed current generation and exposes interruption.
{
  const values = new Map<string, string>();
  const seeded = makeStorage(values);
  assert.equal(writeAutosaveSnapshot(first, seeded).status, "saved");
  assert.equal(writeAutosaveSnapshot(second, seeded).status, "saved");
  const aborted = makeStorage(
    values,
    { operation: "set", key: STORAGE_KEYS.autosave, error: namedError("AbortError", "forced abort") },
  );
  const result = writeAutosaveSnapshot(third, aborted);
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.reason, "abort");
  const recovered = loadedProject(makeStorage(values), base);
  assert.equal(recovered.project.metadata.name, second.metadata.name);
  assert.equal(values.get(STORAGE_KEYS.autosavePrevious), serializeProject(first));
  assert.equal(loadedProject(makeStorage(values), base).recovery.outcome, "interrupted-write");
  assert.equal(values.get(STORAGE_KEYS.autosave), serializeProject(second));
  assert(values.has(STORAGE_KEYS.autosaveDirty), "an interrupted transaction leaves a dirty marker");
}

// Quota is a distinct outcome and also preserves the old generation.
{
  const values = new Map<string, string>();
  const seeded = makeStorage(values);
  assert.equal(writeAutosaveSnapshot(first, seeded).status, "saved");
  const quota = makeStorage(
    values,
    { operation: "set", key: STORAGE_KEYS.autosave, error: namedError("QuotaExceededError", "quota") },
  );
  const result = writeAutosaveSnapshot(second, quota);
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.reason, "quota");
  assert.equal(loadedProject(makeStorage(values), base).project.metadata.name, first.metadata.name);
}

// Two tabs may prepare against the same generation, but the later completion
// invalidates the stale plan before it can overwrite the newer snapshot.
{
  const values = new Map<string, string>();
  const tabA = makeStorage(values);
  const tabB = makeStorage(values);
  const oldPlan = prepareAutosaveSnapshot(first, tabA);
  const newPlan = prepareAutosaveSnapshot(second, tabB);
  assert.equal(oldPlan.status, "prepared");
  assert.equal(newPlan.status, "prepared");
  if (oldPlan.status !== "prepared" || newPlan.status !== "prepared") {
    throw new Error("expected prepared tab plans");
  }
  assert.equal(commitAutosaveSnapshot(newPlan.plan, tabB).status, "saved");
  const stale = commitAutosaveSnapshot(oldPlan.plan, tabA);
  assert.equal(stale.status, "failed");
  if (stale.status === "failed") assert.equal(stale.reason, "stale-write");
  assert.equal(loadedProject(tabA, base).project.metadata.name, second.metadata.name);
}

// A reload/discard boundary is represented by a new storage view over the
// same durable map. A dirty marker is deterministic and does not change which
// complete generation is recovered.
{
  const values = new Map<string, string>();
  const firstTab = makeStorage(values);
  assert.equal(writeAutosaveSnapshot(first, firstTab).status, "saved");
  assert.equal(markAutosaveDirty(first, firstTab).status, "marked");
  const reloaded = loadedProject(makeStorage(values), base);
  assert.equal(reloaded.project.metadata.name, first.metadata.name);
  assert.equal(reloaded.recovery.outcome, "interrupted-write");
  assert.equal(writeAutosaveSnapshot(second, firstTab).status, "saved");
  assert.equal(loadedProject(makeStorage(values), base).recovery.outcome, "clean");
}

// Legacy migration copies the complete project into the canonical journal,
// removes the old key only after completion, and is idempotent on the next read.
{
  const storage = makeStorage();
  storage.values.set(LEGACY_STORAGE_KEYS.autosave, serializeProject(first));
  const migrated = loadedProject(storage, base);
  assert.equal(migrated.project.metadata.name, first.metadata.name);
  assert.equal(migrated.recovery.outcome, "legacy-migrated");
  assert.equal(storage.values.has(LEGACY_STORAGE_KEYS.autosave), false);
  const again = loadedProject(storage, base);
  assert.equal(again.recovery.outcome, "clean");
  assert.equal(storage.values.get(STORAGE_KEYS.autosave), serializeProject(first));
}

// A corrupt current value falls back to the previous complete generation;
// corrupt metadata is rejected explicitly rather than silently repaired.
{
  const storage = makeStorage();
  assert.equal(writeAutosaveSnapshot(first, storage).status, "saved");
  assert.equal(writeAutosaveSnapshot(second, storage).status, "saved");
  const corruptCurrent = JSON.parse(storage.values.get(STORAGE_KEYS.autosave)!);
  corruptCurrent.metadata.name = "Corrupted current";
  storage.values.set(STORAGE_KEYS.autosave, JSON.stringify(corruptCurrent));
  const recovered = loadedProject(storage, base);
  assert.equal(recovered.project.metadata.name, first.metadata.name);
  assert.equal(recovered.recovery.outcome, "corrupt-generation");
  storage.values.set(STORAGE_KEYS.autosaveMetadata, "{bad metadata");
  const rejected = readAutosaveProject(base, storage);
  assert.equal(rejected.status, "rejected");
  if (rejected.status === "rejected") {
    assert.equal(rejected.recovery.outcome, "corrupt-generation");
    assert.equal(rejected.recovery.source, "metadata");
  }
}

// A large image payload either commits fully or returns an explicit quota
// result; it is never reported as a successful best-effort autosave.
{
  const large = {
    ...first,
    parts: {
      ...first.parts,
      [first.partOrder[0]!]: {
        ...first.parts[first.partOrder[0]!]!,
        textureUrl: `data:image/png;base64,${"A".repeat(100_000)}`,
      },
    },
  } satisfies ProjectState;
  const storage = makeStorage();
  const result = writeAutosaveSnapshot(large, {
    ...storage,
    setItem: (key, value) => {
      if (key === STORAGE_KEYS.autosave && value.length > 10_000) {
        throw namedError("QuotaExceededError", "image project exceeds quota");
      }
      storage.setItem(key, value);
    },
  });
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.reason, "quota");
}

// Autosave remains usable when no telemetry module, global, or lifecycle is
// present; the owned persistence paths contain no telemetry dependency.
{
  const hookSource = readFileSync("hooks/useProjectAutosave.ts", "utf8");
  const persistenceSource = readFileSync("utils/projectPersistence.ts", "utf8");
  assert.equal(/telemetry|study/i.test(hookSource), false);
  assert.equal(/telemetry|study/i.test(persistenceSource), false);
  const storage = makeStorage();
  assert.equal(writeAutosaveSnapshot(third, storage).status, "saved");
}

// Storage absence is explicit too; callers never receive a false saved result.
{
  const result = writeAutosaveSnapshot(first);
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.reason, "unavailable");
}
