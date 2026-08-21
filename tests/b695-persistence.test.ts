import { strict as assert } from "node:assert";
import { createEmptyProject } from "../utils/project";
import {
  AUTOSAVE_STORAGE_KEYS,
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
  type AutosaveIdleBoundary,
  type AutosavePreparationCallbacks,
  type AutosavePreparationDriver,
} from "../runtime/persistence/autosaveTransaction";
import type { ProjectState } from "../types";

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
  const unicode = "ASCII · café · \uD55C\uAE00 · 🤖";
  assert.equal(byteLength(unicode), Buffer.byteLength(unicode, "utf8"));
  assert.equal(fingerprint(unicode), fingerprint(unicode));
  assert(
    serializeProjectCompact(projectA).length < serializeProject(projectA).length,
    "autosave uses the same schema without portable-file whitespace",
  );
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
