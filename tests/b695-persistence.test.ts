import { strict as assert } from "node:assert";
import {
  createDefaultSceneObject,
  createEmptyProject,
  loadProjectSnapshot,
} from "../utils/project";
import {
  AUTOSAVE_STORAGE_KEYS,
  AUTOSAVE_SNAPSHOT_MAX_BYTES,
  byteLength,
  fingerprint,
  type AutosaveStorage,
} from "../utils/projectAutosaveFormat";
import {
  readAutosaveProject,
} from "../utils/projectAutosaveRecovery";
import {
  writeAutosaveSnapshot,
} from "../utils/projectAutosaveTransactions";
import {
  serializeProject,
  serializeProjectCompact,
} from "../utils/projectSerialization";
import {
  createAutosaveTransaction,
  createBrowserAutosavePreparationDriver,
  type AutosaveIdleBoundary,
  type AutosavePreparationCallbacks,
  type AutosavePreparationDriver,
  type AutosaveWorkerPort,
} from "../runtime/persistence/autosaveTransaction";
import type { ProjectState } from "../types";
import {
  PROJECT_HISTORY_BYTE_BUDGET,
  PROJECT_HISTORY_LIMIT,
  boundProjectHistory,
  createProjectHistoryEntry,
  estimateExclusiveHistoryBytes,
} from "../runtime/persistence/projectHistoryPolicy";
import { createFabricationPackage } from "../utils/fabrication";
import { createFabricationReadyFourBarProject } from "./fixtures/fabricationProject";
import { createPortableProjectBlob } from "../runtime/persistence/projectDownloadJob";
import {
  createProjectDownloadWorkerClient,
  type ProjectDownloadFrameScheduler,
  type ProjectDownloadWorkerPort,
  type ProjectDownloadWorkerRequest,
} from "../runtime/persistence/projectDownloadWorkerClient";

const memoryStorage = (): AutosaveStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

const quotaStorage = (maxCharacters: number) => {
  const storage = memoryStorage();
  return {
    ...storage,
    setItem: (key: string, value: string) => {
      const previousLength = storage.values.get(key)?.length ?? 0;
      const nextLength =
        [...storage.values.values()].reduce((sum, item) => sum + item.length, 0) -
        previousLength +
        value.length;
      if (nextLength > maxCharacters) {
        const error = new Error("quota exceeded");
        error.name = "QuotaExceededError";
        throw error;
      }
      storage.values.set(key, value);
    },
  } satisfies AutosaveStorage & { values: Map<string, string> };
};

const manualBoundary = () => {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  const boundary: AutosaveIdleBoundary = {
    request: (callback) => {
      const timeoutId = nextId++;
      callbacks.set(timeoutId, callback);
      return { timeoutId };
    },
    cancel: (handle) => {
      if (handle.timeoutId !== undefined) callbacks.delete(handle.timeoutId);
    },
  };
  return {
    boundary,
    pending: () => callbacks.size,
    runNext: () => {
      const next = callbacks.entries().next().value as
        | [number, () => void]
        | undefined;
      if (!next) return false;
      callbacks.delete(next[0]);
      next[1]();
      return true;
    },
  };
};

type PendingPreparation<T> = {
  value: T;
  generation: number;
  callbacks: AutosavePreparationCallbacks<string>;
};

const manualPreparation = <T>(): {
  driver: AutosavePreparationDriver<T, string>;
  pending: PendingPreparation<T>[];
  starts: PendingPreparation<T>[];
  cancels: number;
} => {
  const pending: PendingPreparation<T>[] = [];
  const starts: PendingPreparation<T>[] = [];
  let cancels = 0;
  const driver: AutosavePreparationDriver<T, string> = {
    start: (value, generation, callbacks) => {
      const request = { value, generation, callbacks };
      pending.push(request);
      starts.push(request);
    },
    cancel: () => {
      cancels += 1;
    },
    dispose: () => undefined,
  };
  return {
    driver,
    pending,
    starts,
    get cancels() {
      return cancels;
    },
  };
};

const transactionFixture = () => {
  const clock = manualBoundary();
  const preparation = manualPreparation<ProjectState>();
  const commits: Array<{ value: ProjectState; payload: string }> = [];
  const dirty: ProjectState[] = [];
  const transaction = createAutosaveTransaction<ProjectState, string>({
    boundary: clock.boundary,
    preparation: preparation.driver,
    commit: (value, payload) => {
      commits.push({ value, payload });
      return true;
    },
    markDirty: (value) => dirty.push(value),
  });
  return { clock, preparation, transaction, commits, dirty };
};

const projectA = createEmptyProject();
const projectB = createEmptyProject();

{
  const sharedTexture = `data:image/png;base64,${"a".repeat(512 * 1024)}`;
  const older = { stable: { texture: sharedTexture }, changed: { x: 1 } };
  const successor = { stable: older.stable, changed: { x: 2 } };
  assert(
    estimateExclusiveHistoryBytes(older, successor) < 1024,
    "history accounting skips structurally shared image data",
  );
  assert(
    estimateExclusiveHistoryBytes(
      { texture: `data:image/png;base64,${"a".repeat(5 * 1024 * 1024)}` },
      { texture: "" },
    ) > PROJECT_HISTORY_BYTE_BUDGET,
    "a replaced multi-megabyte data URL exceeds the retained-memory budget",
  );
  const entries = Array.from({ length: PROJECT_HISTORY_LIMIT + 8 }, (_, index) =>
    createProjectHistoryEntry({ value: index }, { value: index + 1 }),
  );
  const bounded = boundProjectHistory(entries, [], "past");
  assert.equal(bounded.past.length, PROJECT_HISTORY_LIMIT);
  assert(bounded.retainedBytes <= PROJECT_HISTORY_BYTE_BUDGET);
}

{
  const fixture = transactionFixture();
  fixture.transaction.accept(projectA);
  fixture.transaction.accept(projectB);
  assert.equal(fixture.preparation.starts.length, 0, "accepted edits wait for the idle boundary");
  assert.equal(fixture.clock.pending(), 1, "a burst has one coalesced boundary");

  fixture.clock.runNext();
  assert.equal(fixture.preparation.starts.length, 1);
  assert.equal(fixture.preparation.starts[0].value, projectB, "the latest edit wins");
  fixture.preparation.starts[0].callbacks.ready("prepared-b");
  assert.equal(fixture.commits.length, 0, "preparation does not commit in the worker callback");
  fixture.clock.runNext();
  assert.deepEqual(fixture.commits, [{ value: projectB, payload: "prepared-b" }]);
  assert.equal(fixture.transaction.hasPending(), false);
}

{
  const clock = manualBoundary();
  const preparation = manualPreparation<ProjectState>();
  const committed: ProjectState[] = [];
  const dirty: ProjectState[] = [];
  let finishFirstCommit: (saved: boolean) => void = () => undefined;
  const transaction = createAutosaveTransaction<ProjectState, string>({
    boundary: clock.boundary,
    preparation: preparation.driver,
    commit: (value) => {
      committed.push(value);
      if (committed.length > 1) return true;
      return new Promise<boolean>((resolve) => {
        finishFirstCommit = resolve;
      });
    },
    markDirty: (value) => dirty.push(value),
  });
  transaction.accept(projectA);
  clock.runNext();
  preparation.starts[0].callbacks.ready("prepared-a");
  clock.runNext();
  assert.equal(transaction.hasPending(), true, "an IndexedDB commit remains pending until its transaction settles");

  transaction.accept(projectB);
  assert.equal(clock.pending(), 0, "a newer edit waits behind the atomic commit");
  finishFirstCommit(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(clock.pending(), 1, "the newest edit is scheduled after the atomic commit");
  clock.runNext();
  preparation.starts[1].callbacks.ready("prepared-b");
  clock.runNext();
  assert.deepEqual(committed, [projectA, projectB]);
  assert.deepEqual(dirty, []);
  assert.equal(transaction.hasPending(), false);
}

{
  const fixture = transactionFixture();
  fixture.transaction.accept(projectA);
  fixture.clock.runNext();
  const stale = fixture.preparation.starts[0];
  fixture.transaction.accept(projectB);
  stale.callbacks.ready("stale-a");
  assert.equal(fixture.commits.length, 0, "a stale preparation cannot commit");
  fixture.clock.runNext();
  const current = fixture.preparation.starts[1];
  current.callbacks.ready("current-b");
  fixture.clock.runNext();
  assert.deepEqual(fixture.commits, [{ value: projectB, payload: "current-b" }]);
}

{
  const fixture = transactionFixture();
  fixture.transaction.accept(projectA);
  fixture.transaction.flush();
  assert.deepEqual(fixture.dirty, [projectA], "flush marks an unprepared edit dirty");
  assert.equal(fixture.preparation.starts.length, 0, "flush never starts fresh preparation");

  fixture.transaction.accept(projectB);
  fixture.clock.runNext();
  fixture.preparation.starts[0].callbacks.ready("prepared-b");
  fixture.transaction.flush();
  assert.deepEqual(fixture.commits, [{ value: projectB, payload: "prepared-b" }]);
  assert.equal(fixture.dirty.length, 1, "prepared flush does not add a dirty marker");
}

{
  const fixture = transactionFixture();
  fixture.transaction.setSuspended(true);
  fixture.transaction.accept(projectA);
  assert.equal(fixture.clock.pending(), 0, "playback suspension does not schedule autosave");
  fixture.transaction.setSuspended(false);
  assert.equal(fixture.clock.pending(), 1, "resume schedules the latest accepted project");
  fixture.clock.runNext();
  assert.equal(fixture.preparation.starts[0].value, projectA);
  fixture.transaction.flush();
  assert.equal(fixture.preparation.cancels, 2, "flush cancels an in-flight preparation");
  assert.deepEqual(fixture.dirty, [projectA]);
}

{
  const storage = memoryStorage();
  const first = createEmptyProject();
  const second = createEmptyProject();
  assert.equal(writeAutosaveSnapshot(first, storage).status, "saved");
  assert.equal(writeAutosaveSnapshot(second, storage).status, "saved");
  assert(storage.values.has(AUTOSAVE_STORAGE_KEYS.autosavePrevious));
  const recovered = readAutosaveProject(first, storage);
  assert.equal(recovered.status, "loaded");
  if (recovered.status === "loaded") {
    assert.equal(recovered.project.metadata.id, second.metadata.id);
    assert.equal(recovered.recovery.outcome, "clean");
  }
}

{
  const storage = memoryStorage();
  const oversized = createEmptyProject();
  oversized.metadata.name = "x".repeat(6 * 1024 * 1024 + 1);
  const write = writeAutosaveSnapshot(oversized, storage);
  assert.equal(write.status, "failed", "oversized autosave never reaches localStorage");
  if (write.status === "failed") {
    assert.equal(write.reason, "serialization");
    assert.match(write.error, /6 MB classroom memory budget/);
  }
  assert.equal(storage.values.has(AUTOSAVE_STORAGE_KEYS.autosave), false);
}

{
  const unicode = "ASCII · café · \uD55C\uAE00 · 🤖";
  assert.equal(byteLength(unicode), Buffer.byteLength(unicode, "utf8"));
  assert.equal(fingerprint(unicode), fingerprint(unicode));
  assert(
    serializeProjectCompact(projectA).length < serializeProject(projectA).length,
    "autosave uses the same schema without portable-file whitespace",
  );
}

{
  const project = createFabricationReadyFourBarProject();
  const object = {
    ...createDefaultSceneObject("block", "large-raster-object"),
    textureUrl:
      `data:image/png;base64,serialization-raster-marker-${"a".repeat(4 * 1024 * 1024)}`,
  };
  project.sceneObjects = { [object.id]: object };
  project.sceneObjectOrder = [object.id];
  const lastExport = createFabricationPackage(project);
  const exportedProject = { ...project, lastExport };
  assert(
    JSON.stringify(exportedProject).length > AUTOSAVE_SNAPSHOT_MAX_BYTES,
    "the fixture proves canonical artwork plus generated files exceed autosave",
  );

  const compact = serializeProjectCompact(exportedProject);
  const portable = serializeProject(exportedProject);
  for (const serialized of [compact, portable]) {
    const parsed = JSON.parse(serialized) as ProjectState;
    assert.equal(parsed.lastExport, undefined, "transient generated files are not persisted");
    assert.equal(
      serialized.split("serialization-raster-marker-").length - 1,
      1,
      "the canonical scene raster is serialized exactly once",
    );
    assert(
      byteLength(serialized) < AUTOSAVE_SNAPSHOT_MAX_BYTES,
      "a 4 MB canonical raster stays inside the autosave snapshot budget",
    );
    const restored = loadProjectSnapshot(parsed);
    assert.equal(restored.metadata.id, project.metadata.id);
    assert.equal(restored.sceneObjects[object.id].textureUrl, object.textureUrl);
    assert.equal(restored.mechanisms.length, project.mechanisms.length);
    assert.equal(restored.selectedMechanismId, project.selectedMechanismId);
  }

  const posted: unknown[] = [];
  let terminated = 0;
  const fakeWorker: AutosaveWorkerPort = {
    onmessage: null,
    onerror: null,
    postMessage: (message) => posted.push(message),
    terminate: () => {
      terminated += 1;
    },
  };
  const preparation = createBrowserAutosavePreparationDriver(() => fakeWorker);
  preparation.start(exportedProject, 1, {
    ready: () => assert.fail("fake worker should not complete"),
    failed: (error) => assert.fail(String(error)),
  });
  const postedProject = (posted[0] as { project: ProjectState }).project;
  assert.equal(
    postedProject.lastExport,
    undefined,
    "autosave removes generated files before the structured clone",
  );
  assert.equal(
    postedProject.sceneObjects[object.id].textureUrl,
    object.textureUrl,
    "autosave worker input retains canonical scene artwork",
  );
  preparation.dispose();
  assert.equal(terminated, 1, "disposing autosave releases the injected worker");

  const directBlob = createPortableProjectBlob(exportedProject);
  assert.match(directBlob.type, /^application\/json(?:;|$)/);
  const directSnapshot = JSON.parse(await directBlob.text()) as ProjectState;
  assert.equal(directSnapshot.lastExport, undefined);
  assert.equal(directSnapshot.sceneObjects[object.id].textureUrl, object.textureUrl);

  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  const frameScheduler: ProjectDownloadFrameScheduler = {
    requestFrame: (callback) => {
      const handle = nextFrame++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      frames.delete(handle);
    },
  };
  const flushFrame = () => {
    const entry = frames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    assert(entry, "portable save scheduled a frame");
    frames.delete(entry[0]);
    entry[1](performance.now());
  };
  type FakeDownloadWorker = ProjectDownloadWorkerPort & {
    posted: ProjectDownloadWorkerRequest[];
    terminated: number;
  };
  const downloadWorkers: FakeDownloadWorker[] = [];
  const downloadClient = createProjectDownloadWorkerClient(() => {
    const worker: FakeDownloadWorker = {
      onmessage: null,
      onmessageerror: null,
      onerror: null,
      posted: [],
      terminated: 0,
      postMessage(message) {
        this.posted.push(message);
      },
      terminate() {
        this.terminated += 1;
      },
    };
    downloadWorkers.push(worker);
    return worker;
  }, frameScheduler);
  const completedBlobs: Blob[] = [];
  const downloadCallbacks = {
    complete: (blob: Blob) => completedBlobs.push(blob),
    unavailable: () => assert.fail("fake worker is available"),
    failed: (error: Error) => assert.fail(error.message),
  };
  const firstGeneration = downloadClient.request(exportedProject, downloadCallbacks);
  assert.equal(downloadWorkers.length, 0, "portable save waits for two paints");
  flushFrame();
  flushFrame();
  assert.equal(downloadWorkers.length, 1);
  assert.equal(downloadWorkers[0].posted[0].project.lastExport, undefined);
  assert.equal(
    downloadWorkers[0].posted[0].project.sceneObjects[object.id].textureUrl,
    object.textureUrl,
  );
  const staleHandler = downloadWorkers[0].onmessage;
  const secondGeneration = downloadClient.request(project, downloadCallbacks);
  assert.equal(downloadWorkers[0].terminated, 1, "new Save cancels the older worker");
  flushFrame();
  flushFrame();
  staleHandler?.({
    data: { type: "result", generationId: firstGeneration, blob: directBlob },
  } as MessageEvent);
  assert.equal(completedBlobs.length, 0, "superseded Save cannot download");
  const secondBlob = createPortableProjectBlob(project);
  downloadWorkers[1].onmessage?.({
    data: { type: "result", generationId: secondGeneration, blob: secondBlob },
  } as MessageEvent);
  assert.deepEqual(completedBlobs, [secondBlob]);
  assert.equal(downloadWorkers[1].terminated, 1, "completed Save releases its worker");

  let unavailable = 0;
  const fallbackClient = createProjectDownloadWorkerClient(
    () => {
      throw new Error("Worker unavailable");
    },
    frameScheduler,
  );
  fallbackClient.request(project, {
    complete: () => assert.fail("fallback does not produce a worker result"),
    unavailable: () => {
      unavailable += 1;
    },
    failed: (error) => assert.fail(error.message),
  });
  flushFrame();
  flushFrame();
  assert.equal(unavailable, 1, "no-worker fallback begins after two paints");
}

{
  const storage = quotaStorage(4 * 1024 * 1024);
  const first = createEmptyProject();
  first.metadata.name = `A${"a".repeat(3 * 1024 * 1024)}`;
  const second = { ...first, metadata: { ...first.metadata, name: `B${"b".repeat(3 * 1024 * 1024)}` } };
  const firstWrite = writeAutosaveSnapshot(first, storage);
  const secondWrite = writeAutosaveSnapshot(second, storage);
  assert.equal(firstWrite.status, "saved");
  assert.equal(secondWrite.status, "saved", "quota pressure keeps the newest generation");
  if (secondWrite.status === "saved") {
    assert.equal(secondWrite.retainedGenerations, 1, "optional previous bytes are dropped only after quota pressure");
  }
  assert.equal(storage.values.has(AUTOSAVE_STORAGE_KEYS.autosavePrevious), false);
  const recovered = readAutosaveProject(first, storage);
  assert.equal(recovered.status, "loaded");
  if (recovered.status === "loaded") {
    assert(recovered.project.metadata.name.startsWith("B"));
  }
}

console.log("b695 persistence ok");
