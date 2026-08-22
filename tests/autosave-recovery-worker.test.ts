import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ProjectState } from "../types";
import { createEmptyProject } from "../utils/project";
import {
  AUTOSAVE_STORAGE_KEYS,
  AUTOSAVE_SNAPSHOT_MAX_BYTES,
  AUTOSAVE_JOURNAL_MAX_BYTES,
  LEGACY_STORAGE_KEYS,
  autosaveWriterId,
  byteLength,
  fingerprint,
  loadedSnapshot,
  metadataFor,
  nextTransactionId,
  parseMetadata,
  type AutosaveMetadata,
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
import {
  commitIndexedDbAutosaveSnapshot,
  prepareIndexedDbAutosaveBase,
  type AutosaveAtomicBackend,
  type IndexedDbAutosaveToken,
} from "../runtime/persistence/autosaveIndexedDb";
import { completeAutosaveSnapshot } from "../utils/projectAutosaveTransactions";
import { PROJECT_IMPORT_LIMITS } from "../runtime/import/projectImportPolicy";

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

{
  const currentProject = createEmptyProject();
  const corruptAutosave = {
    ...createEmptyProject(),
    mechanisms: Array.from(
      { length: PROJECT_IMPORT_LIMITS.mechanisms + 1 },
      (_, index) => ({ id: `amplified-mechanism-${index}` }),
    ),
  };
  const result = loadedSnapshot(JSON.stringify(corruptAutosave), currentProject);
  assert.equal(
    result.status,
    "rejected",
    "autosave validates bounded project shape before migration can expand collections",
  );
  assert.equal(result.project, currentProject, "a corrupt autosave cannot replace app state");
}

const atomicError = (reason: "quota" | "abort" | "stale-write", message: string) => {
  const error = new Error(message) as Error & { autosaveReason: string };
  error.autosaveReason = reason;
  return error;
};

class MemoryAtomicBackend implements AutosaveAtomicBackend {
  metadata: AutosaveMetadata | null = null;
  currentRaw: string | null = null;
  previousRaw: string | null = null;
  quotaOnRetainedCommit = false;
  failNextCommit = false;
  reads = 0;

  token(): IndexedDbAutosaveToken | null {
    return this.metadata ? {
      generation: this.metadata.currentGeneration,
      fingerprint: this.metadata.currentFingerprint,
      transactionId: this.metadata.transactionId,
    } : null;
  }

  seed(serialized: string, transactionId = "seed-transaction") {
    this.currentRaw = serialized;
    this.previousRaw = null;
    this.metadata = {
      formatVersion: 1,
      currentGeneration: 1,
      previousGeneration: null,
      currentFingerprint: fingerprint(serialized),
      previousFingerprint: null,
      bytes: byteLength(serialized),
      transactionId,
      writerId: "seed-writer",
      committedAt: 1,
    };
  }

  async readMetadata() {
    this.reads += 1;
    return this.metadata ? { ...this.metadata } : null;
  }

  async readRecoverySnapshot() {
    this.reads += 1;
    const token = this.token();
    if (!this.metadata || !token) return null;
    return {
      storage: {
        currentRaw: this.currentRaw,
        previousRaw: this.previousRaw,
        metadataRaw: JSON.stringify(this.metadata),
        dirtyRaw: null,
        legacyRaw: null,
      },
      token,
    };
  }

  async isCurrent(token: IndexedDbAutosaveToken) {
    const current = this.token();
    return Boolean(
      current &&
      current.generation === token.generation &&
      current.fingerprint === token.fingerprint &&
      current.transactionId === token.transactionId,
    );
  }

  async commit(plan: Parameters<AutosaveAtomicBackend["commit"]>[0], retainPrevious: boolean) {
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw atomicError("abort", "simulated atomic transaction failure");
    }
    if (retainPrevious && this.quotaOnRetainedCommit) {
      this.quotaOnRetainedCommit = false;
      throw atomicError("quota", "simulated retained-generation quota");
    }
    if (
      (this.metadata?.currentGeneration ?? 0) !== plan.baseGeneration ||
      (this.metadata?.currentFingerprint ?? null) !== plan.baseFingerprint
    ) {
      throw atomicError("stale-write", "simulated stale writer");
    }
    const priorMetadata = this.metadata;
    const priorRaw = this.currentRaw;
    const keepsPrevious = Boolean(
      retainPrevious &&
      priorMetadata &&
      priorRaw !== null &&
      priorMetadata.bytes + plan.bytes <= AUTOSAVE_JOURNAL_MAX_BYTES,
    );
    const base = {
      generation: priorMetadata?.currentGeneration ?? 0,
      currentRaw: null,
      currentFingerprint: priorMetadata?.currentFingerprint ?? null,
      previousRaw: null,
    };
    const metadata = metadataFor(
      base,
      plan.serialized,
      plan.transactionId,
      { bytes: plan.bytes, fingerprint: plan.fingerprint },
      keepsPrevious,
    );
    this.previousRaw = keepsPrevious ? priorRaw : null;
    this.currentRaw = plan.serialized;
    this.metadata = metadata;
    return {
      status: "saved" as const,
      bytes: plan.bytes,
      generation: metadata.currentGeneration,
      retainedGenerations: keepsPrevious ? 2 as const : 1 as const,
      transactionId: plan.transactionId,
    };
  }

  async migrate(serialized: string, metadataRaw: string) {
    if (this.metadata) throw atomicError("stale-write", "migration lost its empty-base race");
    this.metadata = parseMetadata(metadataRaw);
    this.currentRaw = serialized;
    this.previousRaw = null;
    return this.token()!;
  }

  async removeIfCurrent(token: IndexedDbAutosaveToken) {
    if (!(await this.isCurrent(token))) return;
    this.metadata = null;
    this.currentRaw = null;
    this.previousRaw = null;
  }
}

class AwaitedMigrationBackend extends MemoryAtomicBackend {
  private signalMigrationStarted!: () => void;
  private releasePendingMigration!: () => void;
  private signalMigrationSettled!: () => void;
  readonly migrationStarted = new Promise<void>((resolve) => {
    this.signalMigrationStarted = resolve;
  });
  readonly migrationSettled = new Promise<void>((resolve) => {
    this.signalMigrationSettled = resolve;
  });
  private readonly migrationRelease = new Promise<void>((resolve) => {
    this.releasePendingMigration = resolve;
  });

  releaseMigration() {
    this.releasePendingMigration();
  }

  async migrate(serialized: string, metadataRaw: string) {
    this.signalMigrationStarted();
    await this.migrationRelease;
    try {
      return await super.migrate(serialized, metadataRaw);
    } finally {
      this.signalMigrationSettled();
    }
  }
}

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

const clientHarness = (
  storage: AutosaveStorage,
  backend = new MemoryAtomicBackend(),
) => {
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
    () => backend,
  );
  const flushFrame = () => {
    const entry = frames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    assert(entry, "autosave recovery scheduled a paint boundary");
    frames.delete(entry[0]);
    entry[1](performance.now());
  };
  return { client, workers, frames, flushFrame, backend };
};

const settleAsyncRecovery = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const atomicPlan = async (
  project: ProjectState,
  backend: AutosaveAtomicBackend,
) => {
  const base = await prepareIndexedDbAutosaveBase(project, backend);
  if (base.status !== "base-prepared") throw new Error(base.error);
  assert.equal(base.status, "base-prepared");
  const serialized = serializeProjectCompact(project);
  return completeAutosaveSnapshot(base.base, serialized, {
    bytes: byteLength(serialized),
    fingerprint: fingerprint(serialized),
  });
};

{
  const storage = memoryStorage();
  const backend = new MemoryAtomicBackend();
  const first = createEmptyProject();
  first.metadata.name = "Atomic first";
  const second = { ...first, metadata: { ...first.metadata, name: "Atomic second" } };
  const firstWrite = await commitIndexedDbAutosaveSnapshot(
    await atomicPlan(first, backend),
    backend,
    storage,
  );
  const secondWrite = await commitIndexedDbAutosaveSnapshot(
    await atomicPlan(second, backend),
    backend,
    storage,
  );
  assert.equal(firstWrite.status, "saved");
  assert.equal(secondWrite.status, "saved");
  if (secondWrite.status === "saved") assert.equal(secondWrite.retainedGenerations, 2);
  const recovery = await backend.readRecoverySnapshot();
  assert.equal(recovery?.storage.currentRaw, serializeProjectCompact(second));
  assert.equal(recovery?.storage.previousRaw, serializeProjectCompact(first));

  backend.currentRaw = "{corrupt";
  const rollback = runAutosaveRecoveryJob({
    currentProject: createEmptyProject(),
    storage: recovery
      ? { ...recovery.storage, currentRaw: backend.currentRaw }
      : assert.fail("atomic recovery snapshot exists"),
    migration: {
      transactionId: "rollback-check",
      writerId: "test",
      timestamp: 1,
    },
  });
  assert.equal(rollback.result.status, "loaded");
  if (rollback.result.status === "loaded") {
    assert.equal(rollback.result.project.metadata.name, "Atomic first");
    assert.equal(rollback.result.recovery.source, "previous");
  }
}

{
  const storage = memoryStorage();
  const backend = new MemoryAtomicBackend();
  const first = createEmptyProject();
  first.metadata.name = `First ${"a".repeat(3 * 1024 * 1024)}`;
  backend.seed(serializeProjectCompact(first));
  const second = { ...first, metadata: { ...first.metadata, name: `Second ${"b".repeat(3 * 1024 * 1024)}` } };
  backend.quotaOnRetainedCommit = true;
  const result = await commitIndexedDbAutosaveSnapshot(
    await atomicPlan(second, backend),
    backend,
    storage,
  );
  assert.equal(result.status, "saved", "quota retry commits the newest generation atomically");
  if (result.status === "saved") assert.equal(result.retainedGenerations, 1);
  assert.equal(backend.currentRaw, serializeProjectCompact(second));
  assert.equal(backend.previousRaw, null);
}

{
  const storage = memoryStorage();
  const backend = new MemoryAtomicBackend();
  const first = createEmptyProject();
  backend.seed(serializeProjectCompact(first));
  const second = { ...first, metadata: { ...first.metadata, name: "Failed replacement" } };
  const plan = await atomicPlan(second, backend);
  const before = backend.currentRaw;
  backend.failNextCommit = true;
  const failed = await commitIndexedDbAutosaveSnapshot(plan, backend, storage);
  assert.equal(failed.status, "failed");
  assert.equal(backend.currentRaw, before, "an aborted atomic transaction retains committed bytes");
  assert(storage.values.has(AUTOSAVE_STORAGE_KEYS.autosaveDirty));

  const concurrent = createEmptyProject();
  concurrent.metadata.name = "Concurrent winner";
  backend.seed(serializeProjectCompact(concurrent), "concurrent-winner");
  const stale = await commitIndexedDbAutosaveSnapshot(plan, backend, storage);
  assert.equal(stale.status, "failed");
  if (stale.status === "failed") assert.equal(stale.reason, "stale-write");
  assert.equal(backend.currentRaw, serializeProjectCompact(concurrent));
}

{
  const backend = new MemoryAtomicBackend();
  const project = createEmptyProject();
  project.metadata.name = "Marker failure still commits";
  const markerFailureStorage: AutosaveStorage = {
    getItem: () => null,
    setItem: () => { throw atomicError("abort", "marker unavailable"); },
    removeItem: () => undefined,
  };
  const result = await commitIndexedDbAutosaveSnapshot(
    await atomicPlan(project, backend),
    backend,
    markerFailureStorage,
  );
  assert.equal(result.status, "saved", "small marker failure does not discard an atomic commit");
  assert.equal(backend.currentRaw, serializeProjectCompact(project));
}

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
  await settleAsyncRecovery();
  assert.equal(outcome, "missing");
  assert.equal(
    harness.workers.length,
    0,
    "an empty cold boot never downloads or creates the recovery worker",
  );
}

const nearLimitStorage = memoryStorage();
const nearLimitProject = createEmptyProject();
nearLimitProject.metadata.name = "Near-limit IndexedDB recovery";
nearLimitProject.characterPackage = {
  id: "near-limit-package",
  createdAt: new Date(0).toISOString(),
  sourceImageName: "near-limit.png",
  outputDir: "portable",
  partsInfo: { padding: "n".repeat(5 * 1024 * 1024) },
  charCfg: {},
};
const nearLimitSerialized = serializeProjectCompact(nearLimitProject);
assert(byteLength(nearLimitSerialized) > 5 * 1024 * 1024);
assert(byteLength(nearLimitSerialized) < AUTOSAVE_SNAPSHOT_MAX_BYTES);
const nearLimitBackend = new MemoryAtomicBackend();
nearLimitBackend.seed(nearLimitSerialized);

{
  const initialProject = createEmptyProject();
  const harness = clientHarness(nearLimitStorage, nearLimitBackend);
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
  await settleAsyncRecovery();
  assert.equal(harness.workers.length, 1);
  const request = harness.workers[0].posted[0];
  assert.equal(request.input.currentProject.metadata.id, initialProject.metadata.id);
  assert.equal(request.input.storage.currentRaw, nearLimitSerialized);
  harness.workers[0].emit({
    type: "result",
    generationId: request.generationId,
    output: runAutosaveRecoveryJob(request.input),
  });
  await settleAsyncRecovery();
  assert.equal(recovered?.metadata.id, nearLimitProject.metadata.id);
  assert.equal(
    (recovered?.characterPackage?.partsInfo as { padding?: string })?.padding?.length,
    5 * 1024 * 1024,
  );
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
  await settleAsyncRecovery();
  const request = harness.workers[0].posted[0];
  harness.workers[0].emit({
    type: "result",
    generationId: request.generationId,
    output: runAutosaveRecoveryJob(request.input),
  });
  await settleAsyncRecovery();
  await settleAsyncRecovery();
  assert.equal(recoveryOutcome, "legacy-migrated");
  assert(harness.backend.metadata, "validated legacy bytes commit to IndexedDB");
  assert.equal(harness.backend.currentRaw, serializeProjectCompact(legacyProject));
  assert.equal(storage.values.has(AUTOSAVE_STORAGE_KEYS.autosave), false);
  assert.equal(storage.values.has(AUTOSAVE_STORAGE_KEYS.autosaveMetadata), false);
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
  await settleAsyncRecovery();
  const request = harness.workers[0].posted[0];
  currentProject = createEmptyProject();
  harness.workers[0].emit({
    type: "result",
    generationId: request.generationId,
    output: runAutosaveRecoveryJob(request.input),
  });
  await settleAsyncRecovery();
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
  await settleAsyncRecovery();
  const request = harness.workers[0].posted[0];
  storage.values.set(LEGACY_STORAGE_KEYS.autosave, "newer-tab-value");
  harness.workers[0].emit({
    type: "result",
    generationId: request.generationId,
    output: runAutosaveRecoveryJob(request.input),
  });
  await settleAsyncRecovery();
  assert.equal(completed, 0);
  assert.equal(superseded, 1, "stale storage cannot receive worker mutations");
  assert.equal(storage.values.get(LEGACY_STORAGE_KEYS.autosave), "newer-tab-value");
  assert.equal(storage.values.has(AUTOSAVE_STORAGE_KEYS.autosave), false);
}

{
  const storage = memoryStorage();
  const legacyProject = createEmptyProject();
  legacyProject.metadata.name = "Legacy recovery candidate";
  storage.values.set(
    LEGACY_STORAGE_KEYS.autosave,
    serializeProjectCompact(legacyProject),
  );
  const backend = new AwaitedMigrationBackend();
  const harness = clientHarness(storage, backend);
  let completed = 0;
  let superseded = 0;
  harness.client.request(createEmptyProject(), {
    complete: () => { completed += 1; },
    failed: (error) => assert.fail(error.message),
    superseded: () => { superseded += 1; },
  });
  harness.flushFrame();
  harness.flushFrame();
  await settleAsyncRecovery();
  const request = harness.workers[0].posted[0];
  harness.workers[0].emit({
    type: "result",
    generationId: request.generationId,
    output: runAutosaveRecoveryJob(request.input),
  });
  await backend.migrationStarted;

  const concurrentProject = createEmptyProject();
  concurrentProject.metadata.name = "Concurrent IndexedDB winner";
  const concurrentSerialized = serializeProjectCompact(concurrentProject);
  backend.seed(concurrentSerialized, "concurrent-migration-winner");
  backend.releaseMigration();
  await backend.migrationSettled;
  await settleAsyncRecovery();

  assert.equal(
    completed,
    0,
    "a legacy result that loses its awaited migration race is never applied",
  );
  assert.equal(superseded, 1, "the stale migration is superseded");
  assert.equal(backend.currentRaw, concurrentSerialized);
  assert.equal(harness.workers[0].terminated, 1);
}

{
  const storage = memoryStorage();
  const backend = new MemoryAtomicBackend();
  const recoveredProject = createEmptyProject();
  backend.seed(serializeProjectCompact(recoveredProject), "recovery-read");
  const harness = clientHarness(storage, backend);
  let completed = 0;
  let superseded = 0;
  harness.client.request(createEmptyProject(), {
    complete: () => { completed += 1; },
    failed: (error) => assert.fail(error.message),
    superseded: () => { superseded += 1; },
  });
  harness.flushFrame();
  harness.flushFrame();
  await settleAsyncRecovery();
  const request = harness.workers[0].posted[0];
  const newerProject = createEmptyProject();
  newerProject.metadata.name = "Newer IndexedDB generation";
  backend.seed(serializeProjectCompact(newerProject), "newer-recovery-write");
  harness.workers[0].emit({
    type: "result",
    generationId: request.generationId,
    output: runAutosaveRecoveryJob(request.input),
  });
  await settleAsyncRecovery();
  assert.equal(completed, 0);
  assert.equal(superseded, 1, "a newer IndexedDB token supersedes recovery output");
  assert.equal(backend.currentRaw, serializeProjectCompact(newerProject));
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
const autosaveHookSource = readFileSync(
  join(process.cwd(), "hooks/useProjectAutosave.ts"),
  "utf8",
);
const projectCommandsSource = readFileSync(
  join(process.cwd(), "hooks/useAppProjectCommands.ts"),
  "utf8",
);
const recoveryClientSource = readFileSync(
  join(process.cwd(), "runtime/persistence/autosaveRecoveryWorkerClient.ts"),
  "utf8",
);
assert(controllerSource.includes("useProjectHistory(createEmptyProject)"));
assert(controllerSource.includes("suspended: autosaveRecovery.pending"));
assert(!controllerSource.includes("readAutosaveProject(initialProject)"));
assert(recoveryHookSource.includes("latestProjectRef.current === initialProject"));
assert(recoveryHookSource.includes("client.dispose()"));
assert(workerSource.includes("await import("));
assert(autosaveHookSource.includes("prepareIndexedDbAutosaveBase"));
assert(autosaveHookSource.includes("commitIndexedDbAutosaveSnapshot"));
assert(!autosaveHookSource.includes("commitAutosaveSnapshot("));
assert(projectCommandsSource.includes("createAutosaveRecoveryWorkerClient"));
assert(!projectCommandsSource.includes("readAutosaveProject("));
assert(recoveryClientSource.includes("backend.readRecoverySnapshot()"));
assert(recoveryClientSource.includes("await backend.migrate("));
assert(recoveryClientSource.includes("await backend.isCurrent("));

console.log("autosave recovery worker contract ok");
