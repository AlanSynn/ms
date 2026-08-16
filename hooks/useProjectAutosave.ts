import { useEffect, useRef } from "react";
import type { ProjectState } from "../types";
import {
  commitAutosaveSnapshot,
  completeAutosaveSnapshot,
  markAutosaveDirty,
  prepareAutosaveBase,
  type PreparedAutosaveSnapshot,
} from "../utils/projectAutosaveTransactions";
import {
  browserAutosaveIdleBoundary,
  createAutosaveTransaction,
  createBrowserAutosavePreparationDriver,
  type AutosaveTransaction,
} from "../runtime/persistence/autosaveTransaction";

type ProjectAutosaveTransaction = AutosaveTransaction<
  ProjectState,
  PreparedAutosaveSnapshot
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
};

export const useProjectAutosave = (
  project: ProjectState,
  options: ProjectAutosaveOptions = {},
) => {
  const latestProjectRef = useRef<ProjectState>(project);

  const transactionRef = useRef<ProjectAutosaveTransaction | null>(null);
  const lifecycleDisposalRef = useRef<AutosaveLifecycleDisposal | null>(null);
  if (transactionRef.current === null) {
    const preparation = createBrowserAutosavePreparationDriver();
    transactionRef.current = createAutosaveTransaction<ProjectState, PreparedAutosaveSnapshot>({
      boundary: browserAutosaveIdleBoundary(),
      preparation: {
        start: (nextProject, _generation, callbacks) => {
          const base = prepareAutosaveBase(nextProject);
          if (base.status !== "base-prepared") {
            callbacks.failed(base.error);
            return;
          }
          preparation.start(nextProject, _generation, {
            ready: (serialized) =>
              callbacks.ready(completeAutosaveSnapshot(base.base, serialized)),
            failed: callbacks.failed,
          });
        },
        cancel: preparation.cancel,
        dispose: preparation.dispose,
      },
      commit: (nextProject, plan) => {
        const result = commitAutosaveSnapshot(plan);
        return result.status === "saved";
      },
      markDirty: (nextProject) => {
        markAutosaveDirty(nextProject);
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
    // Accepted ProjectState updates only enqueue the latest value. Worker
    // preparation and the eventual journal write remain outside the gesture
    // and playback hot path.
    transaction.accept(project);
  }, [project, transaction]);

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
