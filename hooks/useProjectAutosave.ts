import { useEffect, useRef } from "react";
import type { ProjectState } from "../types";
import type { AutosaveFailureReason } from "../utils/projectAutosaveFormat";
import {
  commitAutosaveStorageSnapshot,
  completeAutosaveStorageSnapshot,
  prepareAutosaveStorageBase,
  type PreparedAutosaveStorageSnapshot,
} from "../utils/projectAutosaveTransactions";
import {
  browserAutosaveIdleBoundary,
  createAutosaveTransaction,
  createBrowserAutosavePreparationDriver,
  type AutosaveSerializedSnapshot,
  type AutosaveTransaction,
} from "../runtime/persistence/autosaveTransaction";
import {
  browserAutosaveAtomicBackend,
  commitIndexedDbAutosaveSnapshot,
  markIndexedDbAutosaveDirty,
  prepareIndexedDbAutosaveBase,
} from "../runtime/persistence/autosaveIndexedDb";

type ProjectAutosaveTransaction = AutosaveTransaction<
  ProjectState,
  PreparedAutosaveStorageSnapshot
>;

export type AutosaveLifecycleDisposal = {
  setup: (transaction: ProjectAutosaveTransaction) => void;
  cleanup: (transaction: ProjectAutosaveTransaction) => void;
};

/**
 * React StrictMode may run an effect as setup -> cleanup -> setup in one task.
 * Flush at every cleanup boundary, but defer disposal until the task ends so
 * the immediate replay setup can cancel disposal of the still-live transaction.
 * A WeakMap keeps runtime replacement disposal independent and bounded.
 */
export const createAutosaveLifecycleDisposal = (
  scheduleMicrotask: (callback: () => void) => void = queueMicrotask,
): AutosaveLifecycleDisposal => {
  let generation = 0;
  const pending = new WeakMap<ProjectAutosaveTransaction, number>();
  return {
    setup: (transaction) => {
      pending.delete(transaction);
    },
    cleanup: (transaction) => {
      transaction.flush();
      const token = ++generation;
      pending.set(transaction, token);
      scheduleMicrotask(() => {
        if (pending.get(transaction) !== token) return;
        pending.delete(transaction);
        transaction.dispose();
      });
    },
  };
};

export type ProjectAutosaveOptions = {
  suspended?: boolean;
  recoveredBaseline?: ProjectState;
  onFailure?: (status: string) => void;
};

export const autosaveFailureStatus = (reason: AutosaveFailureReason) => {
  if (reason === "quota") return "Autosave failed: Storage full";
  if (reason === "unavailable") return "Autosave failed: Storage unavailable";
  if (reason === "corruption") return "Autosave failed: Recover snapshot";
  return "Autosave failed: Download snapshot";
};

export const useProjectAutosave = (
  project: ProjectState,
  options: ProjectAutosaveOptions = {},
) => {
  const latestProjectRef = useRef<ProjectState>(project);
  const initialProjectRef = useRef<ProjectState>(project);
  const failureCallbackRef = useRef(options.onFailure);
  failureCallbackRef.current = options.onFailure;
  const reportFailure = (reason: AutosaveFailureReason) =>
    failureCallbackRef.current?.(autosaveFailureStatus(reason));

  const transactionRef = useRef<ProjectAutosaveTransaction | null>(null);
  const lifecycleDisposalRef = useRef<AutosaveLifecycleDisposal | null>(null);
  if (transactionRef.current === null) {
    const preparation = createBrowserAutosavePreparationDriver();
    const backend = browserAutosaveAtomicBackend();
    let baseRequestGeneration = 0;
    transactionRef.current = createAutosaveTransaction<ProjectState, PreparedAutosaveStorageSnapshot>({
      boundary: browserAutosaveIdleBoundary(),
      preparation: {
        start: (nextProject, _generation, callbacks) => {
          const baseRequest = ++baseRequestGeneration;
          void prepareAutosaveStorageBase(
            nextProject,
            (candidate) => prepareIndexedDbAutosaveBase(candidate, backend),
          ).then((base) => {
            if (baseRequest !== baseRequestGeneration) return;
            if (base.status !== "base-prepared") {
              reportFailure(base.reason);
              callbacks.failed(base.error);
              return;
            }
            preparation.start(nextProject, _generation, {
              ready: (prepared: AutosaveSerializedSnapshot) =>
                callbacks.ready(
                  completeAutosaveStorageSnapshot(
                    base.plan,
                    prepared.serialized,
                    prepared,
                  ),
                ),
              failed: (error) => {
                reportFailure("serialization");
                callbacks.failed(error);
              },
            });
          }, (error) => {
            if (baseRequest !== baseRequestGeneration) return;
            reportFailure("unavailable");
            callbacks.failed(error);
          });
        },
        cancel: () => {
          baseRequestGeneration += 1;
          preparation.cancel();
        },
        dispose: () => {
          baseRequestGeneration += 1;
          preparation.dispose();
        },
      },
      commit: async (_nextProject, plan) => {
        const result = await commitAutosaveStorageSnapshot(
          plan,
          (snapshot) => commitIndexedDbAutosaveSnapshot(snapshot, backend),
        );
        if (result.status === "failed") reportFailure(result.reason);
        return result.status === "saved";
      },
      markDirty: (nextProject) => {
        const result = markIndexedDbAutosaveDirty(nextProject);
        if (result.status === "failed") reportFailure(result.reason);
      },
    });
  }
  const transaction = transactionRef.current;
  lifecycleDisposalRef.current ??= createAutosaveLifecycleDisposal();
  const lifecycleDisposal = lifecycleDisposalRef.current;

  useEffect(() => {
    transaction.setSuspended(options.suspended === true);
  }, [options.suspended, transaction]);

  useEffect(() => {
    latestProjectRef.current = project;
    if (!project.settings.autosave) {
      transaction.cancel();
      return;
    }
    if (
      project === initialProjectRef.current ||
      project === options.recoveredBaseline
    ) return;
    // Accepted ProjectState updates only enqueue the latest value. Worker
    // preparation and the eventual journal write remain outside the gesture
    // and playback hot path.
    transaction.accept(project);
  }, [options.recoveredBaseline, project, transaction]);

  useEffect(() => {
    if (typeof window === "undefined" || !project.settings.autosave) {
      return;
    }
    const intervalMs = Math.max(
      1000,
      project.settings.autosaveIntervalSeconds * 1000,
    );
    const interval = window.setInterval(() => {
      transaction.accept(latestProjectRef.current);
    }, intervalMs);
    const flushAutosave = () => transaction.flush();
    window.addEventListener("pagehide", flushAutosave);
    window.addEventListener("beforeunload", flushAutosave);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", flushAutosave);
      window.removeEventListener("beforeunload", flushAutosave);
    };
  }, [project.settings.autosave, project.settings.autosaveIntervalSeconds, transaction]);

  // A normal editor teardown is another safe lifecycle boundary. Flush first
  // so prepared bytes or a dirty marker survive, then release the Worker after
  // the StrictMode replay window closes.
  useEffect(() => {
    lifecycleDisposal.setup(transaction);
    return () => lifecycleDisposal.cleanup(transaction);
  }, [lifecycleDisposal, transaction]);
};
