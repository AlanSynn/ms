import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ProjectState } from "../types";
import { createEmptyProject } from "../utils/project";
import {
  AUTOSAVE_STORAGE_KEYS,
  AUTOSAVE_SNAPSHOT_MAX_BYTES,
  LEGACY_STORAGE_KEYS,
  autosaveWriterId,
  byteLength,
  nextTransactionId,
  type AutosaveStorage,
} from "../utils/projectAutosaveFormat";
import { serializeProjectCompact } from "../utils/projectSerialization";
import { readAutosaveProject } from "../utils/projectAutosaveRecovery";
import { writeAutosaveSnapshot } from "../utils/projectAutosaveTransactions";
import {
  runAutosaveRecoveryJob,
  type AutosaveRecoveryJobInput,
} from "../runtime/persistence/autosaveRecoveryJob";
import { captureAutosaveRecoveryStorage } from "../runtime/persistence/autosaveRecoveryStorage";
import {
  createAutosaveRecoveryWorkerClient,
  type AutosaveRecoveryFrameScheduler,
  type AutosaveRecoveryWorkerPort,
  type AutosaveRecoveryWorkerRequest,
  type AutosaveRecoveryWorkerResponse,
} from "../runtime/persistence/autosaveRecoveryWorkerClient";

const memoryStorage = (): AutosaveStorage & {
  values: Map<string, string>;
  reads: number;
} => {
  const values = new Map<string, string>();
  return {
    values,
    reads: 0,
    getItem(key) {
      this.reads += 1;
      return values.get(key) ?? null;
    },
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

const recoveryInput = (
  currentProject: ProjectState,
  storage: AutosaveStorage,
): AutosaveRecoveryJobInput => ({
  currentProject,
  storage: captureAutosaveRecoveryStorage(storage),
  migration: {
    transactionId: nextTransactionId(),
    writerId: autosaveWriterId,
    timestamp: Date.now(),
  },
});

class FakeRecoveryWorker implements AutosaveRecoveryWorkerPort {
  onmessage:
    | ((event: MessageEvent<AutosaveRecoveryWorkerResponse>) => void)
    | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: AutosaveRecoveryWorkerRequest[] = [];
  terminated = 0;

  postMessage(message: AutosaveRecoveryWorkerRequest) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated += 1;
  }

  emit(data: AutosaveRecoveryWorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<AutosaveRecoveryWorkerResponse>);
  }
}

const clientHarness = (storage: AutosaveStorage) => {
  let nextFrame = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const scheduler: AutosaveRecoveryFrameScheduler = {
    requestFrame: (callback) => {
      const handle = nextFrame++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      frames.delete(handle);
    },
  };
  const workers: FakeRecoveryWorker[] = [];
  const client = createAutosaveRecoveryWorkerClient(
    () => {
      const worker = new FakeRecoveryWorker();
      workers.push(worker);
      return worker;
    },
    scheduler,
    () => storage,
  );
  const flushFrame = () => {
    const entry = frames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    assert(entry, "autosave recovery scheduled a paint boundary");
    frames.delete(entry[0]);
    entry[1](performance.now());
  };
  return { client, workers, frames, flushFrame };
};

{
  const emptyStorage = memoryStorage();
  const harness = clientHarness(emptyStorage);
  let outcome = "pending";
  harness.client.request(createEmptyProject(), {
    complete: (result) => {
      outcome = result.recovery.outcome;
    },
    failed: (error) => assert.fail(error.message),
  });
  assert.equal(emptyStorage.reads, 0, "initial render performs no storage read");
  assert.equal(harness.workers.length, 0, "initial render creates no worker");
  harness.flushFrame();
  assert.equal(emptyStorage.reads, 0, "the first paint remains storage-free");
  harness.flushFrame();
  assert.equal(outcome, "missing");
  assert.equal(
    harness.workers.length,
    0,
    "an empty cold boot never downloads or creates the recovery worker",
  );
}

const nearLimitStorage = memoryStorage();
const nearLimitProject = createEmptyProject();
nearLimitProject.metadata.name = `near-limit-${"n".repeat(5 * 1024 * 1024)}`;
const nearLimitSerialized = serializeProjectCompact(nearLimitProject);
assert(byteLength(nearLimitSerialized) > 5 * 1024 * 1024);
assert(byteLength(nearLimitSerialized) < AUTOSAVE_SNAPSHOT_MAX_BYTES);
assert.equal(writeAutosaveSnapshot(nearLimitProject, nearLimitStorage).status, "saved");

{
  const initialProject = createEmptyProject();
  const harness = clientHarness(nearLimitStorage);
  let recovered: ProjectState | undefined;
  harness.client.request(initialProject, {
    complete: (result) => {
      assert.equal(result.status, "loaded");
      if (result.status === "loaded") recovered = result.project;
    },
    failed: (error) => assert.fail(error.message),
  });
  const readsBeforePaint = nearLimitStorage.reads;
  harness.flushFrame();
  assert.equal(
    nearLimitStorage.reads,
    readsBeforePaint,
    "the near-limit localStorage read starts only after a paint",
  );
  harness.flushFrame();
  assert.equal(harness.workers.length, 1);
  const request = harness.workers[0].posted[0];
  assert.equal(request.input.currentProject.metadata.id, initialProject.metadata.id);
  assert.equal(request.input.storage.currentRaw, nearLimitSerialized);
  harness.workers[0].emit({
    type: "result",
    generationId: request.generationId,
    output: runAutosaveRecoveryJob(request.input),
  });
  assert.equal(recovered?.metadata.id, nearLimitProject.metadata.id);
  assert.equal(recovered?.metadata.name.length, nearLimitProject.metadata.name.length);
  assert.equal(harness.workers[0].terminated, 1);
}

{
  const storage = memoryStorage();
  const previous = createEmptyProject();
  previous.metadata.name = "Previous good generation";
  const current = createEmptyProject();
  current.metadata.name = "Current generation";
  assert.equal(writeAutosaveSnapshot(previous, storage).status, "saved");
  assert.equal(writeAutosaveSnapshot(current, storage).status, "saved");
  storage.values.set(AUTOSAVE_STORAGE_KEYS.autosave, "{corrupt");
  const output = runAutosaveRecoveryJob(recoveryInput(createEmptyProject(), storage));
  assert.equal(output.result.status, "loaded");
  if (output.result.status === "loaded") {
    assert.equal(output.result.project.metadata.id, previous.metadata.id);
    assert.equal(output.result.recovery.source, "previous");
    assert.equal(output.result.recovery.outcome, "corrupt-generation");
  }
}

{
  const storage = memoryStorage();
  const legacyProject = createEmptyProject();
  legacyProject.metadata.name = "Legacy classroom project";
  storage.values.set(
    LEGACY_STORAGE_KEYS.autosave,
    serializeProjectCompact(legacyProject),
  );
  const harness = clientHarness(storage);
  let recoveryOutcome = "pending";
  harness.client.request(createEmptyProject(), {
    complete: (result) => {
      recoveryOutcome = result.recovery.outcome;
    },
    failed: (error) => assert.fail(error.message),
  });
  harness.flushFrame();
  harness.flushFrame();
  const request = harness.workers[0].posted[0];
  harness.workers[0].emit({
    type: "result",
    generationId: request.generationId,
    output: runAutosaveRecoveryJob(request.input),
  });
  assert.equal(recoveryOutcome, "legacy-migrated");
  assert(storage.values.has(AUTOSAVE_STORAGE_KEYS.autosave));
  assert(storage.values.has(AUTOSAVE_STORAGE_KEYS.autosaveMetadata));
  assert.equal(storage.values.has(AUTOSAVE_STORAGE_KEYS.autosaveDirty), false);
  assert.equal(storage.values.has(LEGACY_STORAGE_KEYS.autosave), false);
}

{
  const values = new Map<string, string>();
  const storageWithoutRemove: AutosaveStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const legacyProject = createEmptyProject();
  values.set(
    LEGACY_STORAGE_KEYS.autosave,
    serializeProjectCompact(legacyProject),
  );
  const recovered = readAutosaveProject(createEmptyProject(), storageWithoutRemove);
  assert.equal(recovered.status, "loaded");
  assert.equal(recovered.recovery.outcome, "legacy-unmigrated");
  assert.match(recovered.recovery.error ?? "", /cannot complete autosave migration/);
  assert(values.has(AUTOSAVE_STORAGE_KEYS.autosave));
  assert(values.has(AUTOSAVE_STORAGE_KEYS.autosaveMetadata));
  assert(
    values.has(AUTOSAVE_STORAGE_KEYS.autosaveDirty),
    "a failed ordered migration keeps its dirty marker as recovery evidence",
  );
  assert(values.has(LEGACY_STORAGE_KEYS.autosave));
}

{
  const storage = memoryStorage();
  const project = createEmptyProject();
  assert.equal(writeAutosaveSnapshot(project, storage).status, "saved");
  const initialProject = createEmptyProject();
  let currentProject = initialProject;
  const harness = clientHarness(storage);
  let completed = 0;
  let superseded = 0;
  harness.client.request(
    initialProject,
    {
      complete: () => {
        completed += 1;
      },
      failed: (error) => assert.fail(error.message),
      superseded: () => {
        superseded += 1;
      },
    },
    () => currentProject === initialProject,
  );
  harness.flushFrame();
  harness.flushFrame();
  const request = harness.workers[0].posted[0];
  currentProject = createEmptyProject();
  harness.workers[0].emit({
    type: "result",
    generationId: request.generationId,
    output: runAutosaveRecoveryJob(request.input),
  });
  assert.equal(completed, 0, "a user-selected project is never overwritten");
  assert.equal(superseded, 1);
  assert.equal(harness.workers[0].terminated, 1);
}

{
  const storage = memoryStorage();
  const legacyProject = createEmptyProject();
  storage.values.set(
    LEGACY_STORAGE_KEYS.autosave,
    serializeProjectCompact(legacyProject),
  );
  const harness = clientHarness(storage);
  let completed = 0;
  let superseded = 0;
  harness.client.request(createEmptyProject(), {
    complete: () => {
      completed += 1;
    },
    failed: (error) => assert.fail(error.message),
    superseded: () => {
      superseded += 1;
    },
  });
  harness.flushFrame();
  harness.flushFrame();
  const request = harness.workers[0].posted[0];
  storage.values.set(LEGACY_STORAGE_KEYS.autosave, "newer-tab-value");
  harness.workers[0].emit({
    type: "result",
    generationId: request.generationId,
    output: runAutosaveRecoveryJob(request.input),
  });
  assert.equal(completed, 0);
  assert.equal(superseded, 1, "stale storage cannot receive worker mutations");
  assert.equal(storage.values.get(LEGACY_STORAGE_KEYS.autosave), "newer-tab-value");
  assert.equal(storage.values.has(AUTOSAVE_STORAGE_KEYS.autosave), false);
}

const controllerSource = readFileSync(
  join(process.cwd(), "hooks/useMotionSmithAppController.ts"),
  "utf8",
);
const recoveryHookSource = readFileSync(
  join(process.cwd(), "hooks/useColdAutosaveRecovery.ts"),
  "utf8",
);
const workerSource = readFileSync(
  join(process.cwd(), "workers/autosaveRecoveryWorker.ts"),
  "utf8",
);
assert(controllerSource.includes("useProjectHistory(createEmptyProject)"));
assert(controllerSource.includes("suspended: autosaveRecovery.pending"));
assert(!controllerSource.includes("readAutosaveProject(initialProject)"));
assert(recoveryHookSource.includes("latestProjectRef.current === initialProject"));
assert(recoveryHookSource.includes("client.dispose()"));
assert(workerSource.includes("await import("));

console.log("autosave recovery worker contract ok");
