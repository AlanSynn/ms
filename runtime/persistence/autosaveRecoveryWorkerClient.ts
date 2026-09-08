import type { ProjectState } from "../../types";
import {
  AUTOSAVE_STORAGE_KEYS,
  autosaveWriterId,
  browserStorage,
  failureReason,
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
  autosaveRecoveryStorageIsCurrent,
  captureAutosaveRecoveryStorage,
  clearMigratedAutosaveStorage,
} from "./autosaveRecoveryStorage";
import {
  browserAutosaveAtomicBackend,
  type AutosaveAtomicBackend,
  type IndexedDbAutosaveToken,
} from "./autosaveIndexedDb";

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
  backendFactory: () => AutosaveAtomicBackend = browserAutosaveAtomicBackend,
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
        settling?: boolean;
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
    options: {
      readOnly?: boolean;
      accept?: (candidate: Extract<AutosaveProjectReadResult, { status: "loaded" }>) => boolean | Promise<boolean>;
    } = {},
  ) => {
    releaseActive();
    const generationId = ++generationSequence;
    active = { generationId, currentProject, callbacks, shouldApply };

    const startWorker = async () => {
      if (!active || active.generationId !== generationId) return;
      const requestState = active;
      let storage: AutosaveStorage | undefined;
      let snapshot: AutosaveRecoveryStorageSnapshot;
      let backend: AutosaveAtomicBackend | undefined;
      let indexedDbToken: IndexedDbAutosaveToken | undefined;
      let indexedDbReadError: unknown;
      try {
        backend = backendFactory();
        const indexedDbSnapshot = await backend.readRecoverySnapshot();
        if (!active || active !== requestState) return;
        if (indexedDbSnapshot) {
          indexedDbToken = indexedDbSnapshot.token;
          try {
            storage = storageFactory();
            snapshot = {
              ...indexedDbSnapshot.storage,
              dirtyRaw: storage.getItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty),
            };
          } catch {
            snapshot = indexedDbSnapshot.storage;
          }
        } else {
          storage = storageFactory();
          snapshot = captureAutosaveRecoveryStorage(storage);
        }
      } catch (error) {
        indexedDbReadError = error;
        try {
          backend ??= backendFactory();
          storage = storageFactory();
          snapshot = captureAutosaveRecoveryStorage(storage);
        } catch (storageError) {
          active = undefined;
          callbacks.complete(
            recoveryFromStorageReadError(
              currentProject,
              indexedDbReadError ?? storageError,
            ),
          );
          return;
        }
      }
      if (!backend) {
        active = undefined;
        callbacks.complete(
          recoveryFromStorageReadError(
            currentProject,
            indexedDbReadError ?? new Error("Autosave database unavailable"),
          ),
        );
        return;
      }
      if (!storageHasRecoveryData(snapshot)) {
        active = undefined;
        callbacks.complete(
          indexedDbReadError
            ? recoveryFromStorageReadError(currentProject, indexedDbReadError)
            : { status: "missing", recovery: { outcome: "missing" } },
        );
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
          data.generationId !== generationId ||
          active.settling
        ) return;
        active.settling = true;
        if (data.type === "error") {
          fail(data.message);
          return;
        }
        void (async () => {
          const supersede = () => {
            if (active !== requestState) return;
            active = undefined;
            releaseWorker(worker);
            callbacks.superseded?.();
          };
          if (!requestState.shouldApply()) {
            supersede();
            return;
          }
          let storageIsCurrent = true;
          try {
            if (indexedDbToken) {
              storageIsCurrent = await backend.isCurrent(indexedDbToken);
              if (
                storageIsCurrent &&
                storage &&
                storage.getItem(AUTOSAVE_STORAGE_KEYS.autosaveDirty) !==
                  snapshot.dirtyRaw
              ) storageIsCurrent = false;
            } else if (storage) {
              storageIsCurrent = autosaveRecoveryStorageIsCurrent(snapshot, storage);
            }
          } catch (error) {
            fail(error instanceof Error ? error.message : String(error));
            return;
          }
          if (
            !active ||
            active !== requestState ||
            !storageIsCurrent ||
            !requestState.shouldApply()
          ) {
            supersede();
            return;
          }

          if (data.output.result.status === "loaded" && options.accept) {
            const accepted = await options.accept(data.output.result);
            if (active !== requestState || !requestState.shouldApply()) { supersede(); return; }
            if (!accepted) {
              active = undefined;
              releaseWorker(worker);
              return;
            }
            const unchanged = indexedDbToken ? await backend.isCurrent(indexedDbToken)
              : storage ? autosaveRecoveryStorageIsCurrent(snapshot, storage) : false;
            if (!unchanged || active !== requestState) { supersede(); return; }
          }
          if (!requestState.shouldApply()) {
            supersede();
            return;
          }
          let result = data.output.result;
          if (data.output.mutation && !options.readOnly) {
            const serialized = data.output.mutation.serializedSource === "legacy"
              ? snapshot.legacyRaw
              : snapshot.currentRaw;
            if (serialized === null || !storage) {
              result = recoveryAfterMutationFailure(
                data.output,
                "autosave migration source is missing",
              );
            } else {
              let migratedToken: IndexedDbAutosaveToken | undefined;
              try {
                migratedToken = await backend.migrate(
                  serialized,
                  data.output.mutation.metadataRaw,
                );
              } catch (error) {
                if (failureReason(error) === "stale-write") {
                  supersede();
                  return;
                }
                result = recoveryAfterMutationFailure(data.output, error);
              }
              if (migratedToken) {
                let migratedTokenIsCurrent = false;
                try {
                  migratedTokenIsCurrent = await backend.isCurrent(migratedToken);
                } catch {
                  supersede();
                  return;
                }
                const legacyStillCurrent =
                  active === requestState &&
                  requestState.shouldApply() &&
                  autosaveRecoveryStorageIsCurrent(snapshot, storage);
                if (!legacyStillCurrent || !migratedTokenIsCurrent) {
                  if (migratedTokenIsCurrent) {
                    try {
                      await backend.removeIfCurrent(migratedToken);
                    } catch {
                      // Ownership is already lost. Never publish the stale
                      // recovery result even when best-effort cleanup fails.
                    }
                  }
                  supersede();
                  return;
                }
                try {
                  if (!clearMigratedAutosaveStorage(snapshot, storage)) {
                    result = recoveryAfterMutationFailure(
                      data.output,
                      "legacy autosave could not be cleared after migration",
                    );
                  }
                } catch (error) {
                  result = recoveryAfterMutationFailure(data.output, error);
                }
              }
            }
          }
          if (
            !active ||
            active !== requestState ||
            !requestState.shouldApply()
          ) {
            supersede();
            return;
          }
          active = undefined;
          releaseWorker(worker);
          callbacks.complete(result);
        })().catch(error => fail(error instanceof Error ? error.message : String(error)));
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
        void startWorker();
      });
    });
    return generationId;
  };

  return { request, cancel, dispose: cancel };
};

export type AutosaveRecoveryWorkerClient = ReturnType<
  typeof createAutosaveRecoveryWorkerClient
>;
