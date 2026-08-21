import type { ProjectState } from "../../types";
import {
  autosaveWriterId,
  browserStorage,
  nextTransactionId,
  type AutosaveStorage,
} from "../../utils/projectAutosaveFormat";
import {
  recoveryAfterMutationFailure,
  recoveryFromStorageReadError,
  type AutosaveProjectReadResult,
  type AutosaveRecoveryJobInput,
  type AutosaveRecoveryJobOutput,
  type AutosaveRecoveryStorageSnapshot,
} from "./autosaveRecoveryJob";
import {
  applyAutosaveRecoveryMutation,
  autosaveRecoveryStorageIsCurrent,
  captureAutosaveRecoveryStorage,
} from "./autosaveRecoveryStorage";

export type AutosaveRecoveryWorkerRequest = {
  type: "recover-autosave";
  generationId: number;
  input: AutosaveRecoveryJobInput;
};

export type AutosaveRecoveryWorkerResponse =
  | {
      type: "result";
      generationId: number;
      output: AutosaveRecoveryJobOutput;
    }
  | { type: "error"; generationId: number; message: string };

export type AutosaveRecoveryWorkerPort = {
  onmessage:
    | ((event: MessageEvent<AutosaveRecoveryWorkerResponse>) => void)
    | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: (message: AutosaveRecoveryWorkerRequest) => void;
  terminate: () => void;
};

export type AutosaveRecoveryWorkerFactory = () => AutosaveRecoveryWorkerPort;
export type AutosaveRecoveryFrameScheduler = {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
};

const browserWorkerFactory: AutosaveRecoveryWorkerFactory = () =>
  new Worker(new URL("../../workers/autosaveRecoveryWorker.ts", import.meta.url), {
    type: "module",
    name: "motionsmith-autosave-recovery",
  }) as unknown as AutosaveRecoveryWorkerPort;

const browserFrameScheduler: AutosaveRecoveryFrameScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

const releaseWorker = (worker: AutosaveRecoveryWorkerPort) => {
  worker.onmessage = null;
  worker.onmessageerror = null;
  worker.onerror = null;
  worker.terminate();
};

const storageHasRecoveryData = (snapshot: AutosaveRecoveryStorageSnapshot) =>
  snapshot.currentRaw !== null ||
  snapshot.previousRaw !== null ||
  snapshot.metadataRaw !== null ||
  snapshot.dirtyRaw !== null ||
  snapshot.legacyRaw !== null;

export const createAutosaveRecoveryWorkerClient = (
  workerFactory: AutosaveRecoveryWorkerFactory = browserWorkerFactory,
  frameScheduler: AutosaveRecoveryFrameScheduler = browserFrameScheduler,
  storageFactory: () => AutosaveStorage = browserStorage,
) => {
  let generationSequence = 0;
  let active:
    | {
        generationId: number;
        currentProject: ProjectState;
        callbacks: {
          complete: (result: AutosaveProjectReadResult) => void;
          failed: (error: Error) => void;
          superseded?: () => void;
        };
        shouldApply: () => boolean;
        firstFrame?: number;
        secondFrame?: number;
        worker?: AutosaveRecoveryWorkerPort;
      }
    | undefined;

  const releaseActive = () => {
    if (!active) return;
    if (active.firstFrame !== undefined) {
      frameScheduler.cancelFrame(active.firstFrame);
    }
    if (active.secondFrame !== undefined) {
      frameScheduler.cancelFrame(active.secondFrame);
    }
    if (active.worker) releaseWorker(active.worker);
    active = undefined;
  };

  const cancel = () => {
    generationSequence += 1;
    releaseActive();
  };

  const request = (
    currentProject: ProjectState,
    callbacks: {
      complete: (result: AutosaveProjectReadResult) => void;
      failed: (error: Error) => void;
      superseded?: () => void;
    },
    shouldApply: () => boolean = () => true,
  ) => {
    releaseActive();
    const generationId = ++generationSequence;
    active = { generationId, currentProject, callbacks, shouldApply };

    const startWorker = () => {
      if (!active || active.generationId !== generationId) return;
      const requestState = active;
      let storage: AutosaveStorage;
      let snapshot: AutosaveRecoveryStorageSnapshot;
      try {
        storage = storageFactory();
        snapshot = captureAutosaveRecoveryStorage(storage);
      } catch (error) {
        active = undefined;
        callbacks.complete(recoveryFromStorageReadError(currentProject, error));
        return;
      }
      if (!storageHasRecoveryData(snapshot)) {
        active = undefined;
        callbacks.complete({ status: "missing", recovery: { outcome: "missing" } });
        return;
      }

      let worker: AutosaveRecoveryWorkerPort;
      try {
        worker = workerFactory();
      } catch (error) {
        active = undefined;
        callbacks.failed(
          error instanceof Error ? error : new Error(String(error)),
        );
        return;
      }
      requestState.worker = worker;
      const fail = (message: string) => {
        if (!active || active.worker !== worker) return;
        active = undefined;
        releaseWorker(worker);
        callbacks.failed(new Error(message));
      };
      worker.onmessage = ({ data }) => {
        if (
          !active ||
          active.worker !== worker ||
          data.generationId !== generationId
        ) return;
        if (data.type === "error") {
          fail(data.message);
          return;
        }
        if (!requestState.shouldApply()) {
          active = undefined;
          releaseWorker(worker);
          callbacks.superseded?.();
          return;
        }
        let storageIsCurrent: boolean;
        try {
          storageIsCurrent = autosaveRecoveryStorageIsCurrent(snapshot, storage);
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
          return;
        }
        if (!storageIsCurrent) {
          active = undefined;
          releaseWorker(worker);
          callbacks.superseded?.();
          return;
        }

        let result = data.output.result;
        if (data.output.mutation) {
          const mutation = applyAutosaveRecoveryMutation(
            data.output.mutation,
            snapshot,
            storage,
          );
          if (mutation.status === "failed") {
            result = recoveryAfterMutationFailure(data.output, mutation.error);
          }
        }
        active = undefined;
        releaseWorker(worker);
        callbacks.complete(result);
      };
      worker.onmessageerror = () =>
        fail("Autosave recovery worker returned unreadable data.");
      worker.onerror = (event) =>
        fail(event.message || "Autosave recovery worker failed.");
      try {
        worker.postMessage({
          type: "recover-autosave",
          generationId,
          input: {
            currentProject: requestState.currentProject,
            storage: snapshot,
            migration: {
              transactionId: nextTransactionId(),
              writerId: autosaveWriterId,
              timestamp: Date.now(),
            },
          },
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    };

    active.firstFrame = frameScheduler.requestFrame(() => {
      if (!active || active.generationId !== generationId) return;
      active.firstFrame = undefined;
      active.secondFrame = frameScheduler.requestFrame(() => {
        if (!active || active.generationId !== generationId) return;
        active.secondFrame = undefined;
        startWorker();
      });
    });
    return generationId;
  };

  return { request, cancel, dispose: cancel };
};

export type AutosaveRecoveryWorkerClient = ReturnType<
  typeof createAutosaveRecoveryWorkerClient
>;
