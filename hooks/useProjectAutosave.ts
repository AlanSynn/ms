import { useEffect, useRef, useState } from "react";
import type { ProjectState } from "../types";
import type { VersionAuthority } from '../runtime/versions/versionTypes';
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
import type { ProjectBackupStatus, ProjectDecisionBoundary } from "../runtime/persistence/projectDecisionBoundary";
export type { ProjectBackupStatus } from "../runtime/persistence/projectDecisionBoundary";

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
  canFlush: () => boolean = () => true,
): AutosaveLifecycleDisposal => {
  let generation = 0;
  const pending = new WeakMap<ProjectAutosaveTransaction, number>();
  return {
    setup: (transaction) => {
      pending.delete(transaction);
    },
    cleanup: (transaction) => {
      if (canFlush()) transaction.flush();
      else transaction.cancel();
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
  historyAuthority?: VersionAuthority;
  onPrepared?: (project: ProjectState, snapshot: AutosaveSerializedSnapshot) => void;
  projectDecision: ProjectDecisionBoundary;
  suspended?: boolean;
  onFailure?: (status: string) => void;
};

export const autosaveFailureStatus = (reason: AutosaveFailureReason) => {
  if (reason === "quota") return "Autosave failed: Storage full";
  if (reason === "unavailable") return "Autosave failed: Storage unavailable";
  if (reason === "corruption") return "Autosave failed: Recover snapshot";
  return "Browser backup unavailable. Save Project.";
};

export const useProjectAutosave = (
  project: ProjectState,
  options: ProjectAutosaveOptions,
): ProjectBackupStatus => {
  const latestProjectRef = useRef<ProjectState>(project);
  latestProjectRef.current = project;
  const versionOptionsRef = useRef(options);
  versionOptionsRef.current = options;
  const authorized = options.projectDecision.isAuthorized();
  const allowed = authorized && !options.suspended && project.settings.autosave;
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const [backupStatus, setBackupStatus] = useState<ProjectBackupStatus>({ state: "waiting" });
  const failureCallbackRef = useRef(options.onFailure);
  failureCallbackRef.current = options.onFailure;
  const reportFailure = (reason: AutosaveFailureReason) => {
    if (!allowedRef.current) return;
    const message = autosaveFailureStatus(reason);
    setBackupStatus((previous) => ({ ...previous, state: "failed", message }));
    failureCallbackRef.current?.(message);
  };

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
          const historyAuthority = versionOptionsRef.current.historyAuthority;
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
              ready: (prepared: AutosaveSerializedSnapshot) => {
                versionOptionsRef.current.onPrepared?.(nextProject, prepared);
                const complete = completeAutosaveStorageSnapshot(
                    base.plan,
                    prepared.serialized,
                    prepared,
                  );
                complete.snapshot.historyAuthority = historyAuthority;
                if (complete.localFallbackSnapshot) complete.localFallbackSnapshot.historyAuthority = historyAuthority;
                callbacks.ready(complete);
              },
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
      commit: async (nextProject, plan) => {
        if (!allowedRef.current) return false;
        const expectedAuthority = versionOptionsRef.current.historyAuthority;
        if (plan.snapshot.historyAuthority?.ownerId !== expectedAuthority?.ownerId ||
          plan.snapshot.historyAuthority?.branchId !== expectedAuthority?.branchId ||
          plan.snapshot.historyAuthority?.lineageId !== expectedAuthority?.lineageId) return false;
        const result = await commitAutosaveStorageSnapshot(
          plan,
          (snapshot) => commitIndexedDbAutosaveSnapshot(snapshot, backend),
        );
        if (result.status === "failed") reportFailure(result.reason);
        if (result.status === "saved") {
          const savedAt = result.committedAt;
          setBackupStatus({
            state: allowedRef.current
              ? nextProject === latestProjectRef.current ? "saved" : "saving"
              : latestProjectRef.current.settings.autosave ? "waiting" : "off",
            savedAt,
            candidate: {
              projectId: nextProject.metadata.id,
              projectName: nextProject.metadata.name,
              backedUpAt: savedAt,
            },
          });
        }
        return result.status === "saved";
      },
      markDirty: (nextProject) => {
        if (!allowedRef.current) return;
        const result = markIndexedDbAutosaveDirty(nextProject);
        if (result.status === "failed") reportFailure(result.reason);
      },
    });
  }
  const transaction = transactionRef.current;
  lifecycleDisposalRef.current ??= createAutosaveLifecycleDisposal(queueMicrotask, () => allowedRef.current);
  const lifecycleDisposal = lifecycleDisposalRef.current;

  useEffect(() => {
    transaction.setSuspended(!allowed);
    if (!allowed) {
      transaction.cancel();
      setBackupStatus((previous) => ({
        ...previous,
        state: project.settings.autosave ? "waiting" : "off",
        message: undefined,
      }));
    }
  }, [allowed, options.historyAuthority?.ownerId, project.settings.autosave, transaction]);

  useEffect(() => {
    if (!allowed) return;
    // Accepted ProjectState updates only enqueue the latest value. Worker
    // preparation and the eventual journal write remain outside the gesture
    // and playback hot path.
    transaction.accept(project);
    setBackupStatus((previous) => ({ ...previous, state: "saving", message: undefined }));
  }, [allowed, options.historyAuthority?.ownerId, project, transaction]);

  useEffect(() => {
    if (typeof window === "undefined" || !allowed) {
      return;
    }
    const intervalMs = Math.max(
      1000,
      project.settings.autosaveIntervalSeconds * 1000,
    );
    const interval = window.setInterval(() => {
      if (allowedRef.current) transaction.accept(latestProjectRef.current);
    }, intervalMs);
    const flushAutosave = () => {
      if (allowedRef.current) transaction.flush();
      else transaction.cancel();
    };
    window.addEventListener("pagehide", flushAutosave);
    window.addEventListener("beforeunload", flushAutosave);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", flushAutosave);
      window.removeEventListener("beforeunload", flushAutosave);
    };
  }, [allowed, project.settings.autosaveIntervalSeconds, transaction]);

  // A normal editor teardown is another safe lifecycle boundary. Flush first
  // so prepared bytes or a dirty marker survive, then release the Worker after
  // the StrictMode replay window closes.
  useEffect(() => {
    lifecycleDisposal.setup(transaction);
    return () => lifecycleDisposal.cleanup(transaction);
  }, [lifecycleDisposal, transaction]);
  return backupStatus;
};
