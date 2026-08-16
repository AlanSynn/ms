import type { ProjectState } from "../../types";

export type AutosaveBoundaryHandle = {
  timeoutId?: number;
  idleId?: number;
};

export type AutosaveIdleBoundary = {
  request: (callback: () => void) => AutosaveBoundaryHandle;
  cancel: (handle: AutosaveBoundaryHandle) => void;
};

export type AutosavePreparationCallbacks<P> = {
  ready: (prepared: P) => void;
  failed: (error: unknown) => void;
};

export type AutosavePreparationDriver<T, P> = {
  start: (
    value: T,
    generation: number,
    callbacks: AutosavePreparationCallbacks<P>,
  ) => void;
  cancel: () => void;
  dispose: () => void;
};

export type AutosaveTransaction<T, P> = {
  accept: (value: T) => void;
  flush: () => void;
  cancel: () => void;
  dispose: () => void;
  setSuspended: (suspended: boolean) => void;
  hasPending: () => boolean;
};

const AUTOSAVE_COALESCE_DELAY_MS = 120;
const AUTOSAVE_IDLE_TIMEOUT_MS = 500;

type IdleHost = {
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (handle: number) => void;
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const browserIdleHost = (): IdleHost | undefined => {
  if (typeof window === "undefined") return undefined;
  return window as unknown as IdleHost;
};

/**
 * Debounce accepted edits, then give the browser an idle opportunity to start
 * Worker preparation or commit already-prepared bytes. requestIdleCallback is
 * intentionally behind a timer: on a quiet device it can otherwise run
 * between pointer events and turn a drag into one preparation per event.
 */
export const browserAutosaveIdleBoundary = (): AutosaveIdleBoundary => {
  const host = browserIdleHost();
  const setTimeoutFn = host?.setTimeout.bind(host) ?? setTimeout;
  const clearTimeoutFn = host?.clearTimeout.bind(host) ?? clearTimeout;

  return {
    request: (callback) => {
      const handle: AutosaveBoundaryHandle = {};
      handle.timeoutId = setTimeoutFn(() => {
        handle.timeoutId = undefined;
        if (host?.requestIdleCallback) {
          handle.idleId = host.requestIdleCallback(() => {
            handle.idleId = undefined;
            callback();
          }, { timeout: AUTOSAVE_IDLE_TIMEOUT_MS });
        } else {
          callback();
        }
      }, AUTOSAVE_COALESCE_DELAY_MS);
      return handle;
    },
    cancel: (handle) => {
      if (handle.timeoutId !== undefined) clearTimeoutFn(handle.timeoutId);
      if (handle.idleId !== undefined) host?.cancelIdleCallback?.(handle.idleId);
      handle.timeoutId = undefined;
      handle.idleId = undefined;
    },
  };
};

type AutosaveWorkerResponse =
  | { id: number; generation: number; type: "prepared"; serialized: string }
  | { id: number; generation: number; type: "error"; message: string };

/**
 * Lazily create one module Worker for ProjectState serialization. A worker is
 * created only after an accepted edit reaches the idle boundary; no boot path
 * can instantiate it. Request ids and queue generations both reject stale
 * responses before any prepared bytes reach the journal.
 */
export const createBrowserAutosavePreparationDriver = (): AutosavePreparationDriver<
  ProjectState,
  string
> => {
  let worker: Worker | undefined;
  let nextRequestId = 1;
  let active:
    | {
        id: number;
        generation: number;
        callbacks: AutosavePreparationCallbacks<string>;
      }
    | undefined;

  const terminate = () => {
    worker?.terminate();
    worker = undefined;
    active = undefined;
  };

  const start = (
    project: ProjectState,
    generation: number,
    callbacks: AutosavePreparationCallbacks<string>,
  ) => {
    if (typeof Worker === "undefined") {
      callbacks.failed(new Error("This browser cannot prepare autosave bytes."));
      return;
    }
    try {
      worker ??= new Worker(
        new URL("./autosaveWorker.ts", import.meta.url),
        { type: "module", name: "motionsmith-autosave" },
      );
    } catch (error) {
      callbacks.failed(error);
      return;
    }
    const id = nextRequestId++;
    active = { id, generation, callbacks };
    worker.onmessage = ({ data }: MessageEvent<AutosaveWorkerResponse>) => {
      if (
        !active ||
        data.id !== active.id ||
        data.generation !== active.generation
      ) return;
      const current = active;
      active = undefined;
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
      }
      if (data.type === "prepared") current.callbacks.ready(data.serialized);
      else current.callbacks.failed(new Error(data.message));
    };
    worker.onerror = () => {
      const current = active;
      terminate();
      current?.callbacks.failed(new Error("Autosave preparation worker failed."));
    };
    try {
      worker.postMessage({ id, generation, project });
    } catch (error) {
      const current = active;
      terminate();
      current?.callbacks.failed(error);
    }
  };

  return {
    start,
    cancel: terminate,
    dispose: terminate,
  };
};

export type AutosaveTransactionOptions<T, P> = {
  boundary: AutosaveIdleBoundary;
  preparation: AutosavePreparationDriver<T, P>;
  commit: (value: T, prepared: P) => boolean;
  markDirty: (value: T) => void;
};

/**
 * Keep one latest ProjectState and at most one preparation in flight. Worker
 * results are converted into a ready payload, then committed at a later idle
 * boundary. Lifecycle flushes never prepare or serialize: they commit the
 * ready payload or mark the latest value dirty for recovery.
 */
export const createAutosaveTransaction = <T, P>(
  options: AutosaveTransactionOptions<T, P>,
): AutosaveTransaction<T, P> => {
  let latest: T | undefined;
  let hasLatest = false;
  let latestGeneration = 0;
  let committed: T | undefined;
  let hasCommitted = false;
  let scheduled: AutosaveBoundaryHandle | undefined;
  let preparingGeneration: number | undefined;
  let preparingValue: T | undefined;
  let prepared:
    | { generation: number; value: T; payload: P }
    | undefined;
  let suspended = false;
  let disposed = false;

  const safeMarkDirty = (value: T) => {
    try {
      options.markDirty(value);
    } catch {
      // Best-effort recovery marker cannot break editing or lifecycle teardown.
    }
  };

  const schedule = () => {
    if (disposed || suspended) return;
    if (scheduled) options.boundary.cancel(scheduled);
    scheduled = options.boundary.request(run);
  };

  const clearLatest = () => {
    latest = undefined;
    hasLatest = false;
  };

  const commitReady = () => {
    const candidate = prepared;
    prepared = undefined;
    if (!candidate) return false;
    if (
      candidate.generation !== latestGeneration ||
      !hasLatest ||
      candidate.value !== latest
    ) {
      if (hasLatest && preparingGeneration === undefined) schedule();
      return false;
    }
    let didCommit = false;
    try {
      didCommit = options.commit(candidate.value, candidate.payload);
    } catch {
      didCommit = false;
    }
    clearLatest();
    if (didCommit) {
      committed = candidate.value;
      hasCommitted = true;
    } else {
      safeMarkDirty(candidate.value);
    }
    return true;
  };

  const run = () => {
    scheduled = undefined;
    if (disposed || suspended) return;
    if (prepared) {
      commitReady();
      return;
    }
    if (!hasLatest || preparingGeneration !== undefined) return;
    const value = latest as T;
    const generation = latestGeneration;
    preparingGeneration = generation;
    preparingValue = value;
    options.preparation.start(value, generation, {
      ready: (payload) => {
        if (preparingGeneration === generation) {
          preparingGeneration = undefined;
          preparingValue = undefined;
        }
        if (disposed || suspended) return;
        if (generation !== latestGeneration || value !== latest) {
          if (hasLatest && preparingGeneration === undefined) schedule();
          return;
        }
        prepared = { generation, value, payload };
        schedule();
      },
      failed: () => {
        if (preparingGeneration === generation) {
          preparingGeneration = undefined;
          preparingValue = undefined;
        }
        if (disposed || suspended) return;
        if (generation !== latestGeneration || value !== latest) {
          if (hasLatest && preparingGeneration === undefined) schedule();
          return;
        }
        safeMarkDirty(value);
      },
    });
  };

  const accept = (value: T) => {
    if (disposed) return;
    if (hasLatest && value === latest) return;
    if (
      hasCommitted &&
      !hasLatest &&
      preparingGeneration === undefined &&
      !prepared &&
      value === committed
    ) return;
    latest = value;
    hasLatest = true;
    latestGeneration += 1;
    prepared = undefined;
    if (!suspended) schedule();
  };

  const setSuspended = (nextSuspended: boolean) => {
    if (disposed || suspended === nextSuspended) return;
    suspended = nextSuspended;
    if (suspended) {
      const hadPreparation = preparingGeneration !== undefined;
      if (scheduled) options.boundary.cancel(scheduled);
      scheduled = undefined;
      options.preparation.cancel();
      preparingGeneration = undefined;
      preparingValue = undefined;
      if (hadPreparation) latestGeneration += 1;
      return;
    }
    if (hasLatest) schedule();
  };

  const flush = () => {
    if (disposed) return;
    if (scheduled) options.boundary.cancel(scheduled);
    scheduled = undefined;
    if (prepared) {
      const committedReady = commitReady();
      if (committedReady) {
        preparingGeneration = undefined;
        preparingValue = undefined;
        return;
      }
    }
    if (hasLatest || preparingGeneration !== undefined) {
      const value = hasLatest ? latest : preparingValue;
      if (value !== undefined) safeMarkDirty(value as T);
    }
    options.preparation.cancel();
    preparingGeneration = undefined;
    preparingValue = undefined;
    prepared = undefined;
    clearLatest();
    latestGeneration += 1;
  };

  const cancel = () => {
    if (scheduled) options.boundary.cancel(scheduled);
    scheduled = undefined;
    options.preparation.cancel();
    preparingGeneration = undefined;
    preparingValue = undefined;
    prepared = undefined;
    clearLatest();
    latestGeneration += 1;
  };

  const dispose = () => {
    if (disposed) return;
    cancel();
    disposed = true;
    options.preparation.dispose();
  };

  return {
    accept,
    flush,
    cancel,
    dispose,
    setSuspended,
    hasPending: () => hasLatest || preparingGeneration !== undefined || prepared !== undefined,
  };
};
