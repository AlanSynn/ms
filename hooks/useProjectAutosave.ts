import { useEffect, useRef } from "react";
import type { ProjectState } from "../types";
import { serializeProject } from "../utils/project";
import {
  markAutosaveDirty,
  prepareAutosaveStorage,
  readAutosaveProjectAsync,
  writeAutosaveSnapshot,
} from "../utils/projectPersistence";

type PreparedAutosave = {
  serialized: string;
  revision: number;
};

type UseProjectAutosaveOptions = {
  onRestore?: (project: ProjectState, mayHaveUnsavedChanges: boolean) => void;
  onStatus?: (status: "saving" | "saved" | "failed") => void;
};

const AUTOSAVE_DEBOUNCE_MS = 250;

/**
 * Prepare serialized snapshots while the tab is active. Hidden/page-exit paths
 * only commit a prepared generation (or a tiny dirty marker), never begin a
 * potentially expensive full-project serialization.
 */
export const useProjectAutosave = (
  project: ProjectState,
  { onRestore, onStatus }: UseProjectAutosaveOptions = {},
) => {
  const initialProjectRef = useRef(project);
  const latestProjectRef = useRef(project);
  const revisionRef = useRef(0);
  const preparedRef = useRef<PreparedAutosave | undefined>(undefined);
  const readyRef = useRef(false);
  const writingRef = useRef(false);
  const prepareTimerRef = useRef<number | undefined>(undefined);
  const idleRef = useRef<number | undefined>(undefined);
  latestProjectRef.current = project;

  const clearPreparation = () => {
    if (prepareTimerRef.current !== undefined) {
      window.clearTimeout(prepareTimerRef.current);
      prepareTimerRef.current = undefined;
    }
    if (idleRef.current !== undefined && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleRef.current);
      idleRef.current = undefined;
    }
  };

  const commitPrepared = async (exit = false) => {
    const prepared = preparedRef.current;
    if (!prepared || writingRef.current) {
      // A write already in flight cannot finish synchronously during tab
      // eviction. Best-effort marker: recovery can warn if it lands.
      if (exit) {
        const dirty = await markAutosaveDirty(latestProjectRef.current);
        if (dirty.status === "failed") onStatus?.("failed");
      }
      return;
    }
    writingRef.current = true;
    onStatus?.("saving");
    const result = await writeAutosaveSnapshot(prepared.serialized);
    writingRef.current = false;
    if (result.status === "failed") {
      onStatus?.("failed");
      return;
    }
    if (preparedRef.current?.revision === prepared.revision) preparedRef.current = undefined;
    onStatus?.("saved");
    if (exit && prepared.revision < revisionRef.current) {
      const dirty = await markAutosaveDirty(latestProjectRef.current);
      if (dirty.status === "failed") onStatus?.("failed");
    }
    if (preparedRef.current) void commitPrepared();
  };

  const prepareLatest = (replacePending = true) => {
    if (!readyRef.current || !latestProjectRef.current.settings.autosave) return;
    if (
      !replacePending &&
      (prepareTimerRef.current !== undefined || idleRef.current !== undefined)
    ) return;
    clearPreparation();
    const prepare = () => {
      idleRef.current = undefined;
      // Do not start a large serialization after the browser has hidden the tab.
      if (document.hidden) {
        void markAutosaveDirty(latestProjectRef.current).then((result) => {
          if (result.status === "failed") onStatus?.("failed");
        });
        return;
      }
      try {
        preparedRef.current = {
          serialized: serializeProject(latestProjectRef.current),
          revision: revisionRef.current,
        };
        void commitPrepared();
      } catch {
        onStatus?.("failed");
      }
    };
    prepareTimerRef.current = window.setTimeout(() => {
      prepareTimerRef.current = undefined;
      if (typeof window.requestIdleCallback === "function") {
        idleRef.current = window.requestIdleCallback(prepare, { timeout: 1_000 });
      } else {
        prepare();
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  useEffect(() => {
    revisionRef.current += 1;
    if (readyRef.current) prepareLatest();
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    void prepareAutosaveStorage();
    void readAutosaveProjectAsync(initialProjectRef.current)
      .then((restored) => {
        if (cancelled || restored.status !== "loaded") return false;
        // Do not overwrite edits made while IndexedDB was opening.
        if (latestProjectRef.current !== initialProjectRef.current) return false;
        onRestore?.(restored.project, restored.mayHaveUnsavedChanges === true);
        return true;
      })
      .catch(() => false)
      .then((restored) => {
        if (cancelled) return;
        readyRef.current = true;
        if (!restored) prepareLatest();
      });
    return () => {
      cancelled = true;
      clearPreparation();
    };
  }, []);

  useEffect(() => {
    if (!project.settings.autosave) return;
    const saveSoon = () => prepareLatest(false);
    const commitExit = () => {
      clearPreparation();
      void commitPrepared(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") commitExit();
    };
    const intervalMs = Math.max(
      1_000,
      project.settings.autosaveIntervalSeconds * 1_000,
    );
    const interval = window.setInterval(saveSoon, intervalMs);
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", commitExit);
    window.addEventListener("beforeunload", commitExit);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", commitExit);
      window.removeEventListener("beforeunload", commitExit);
    };
  }, [project.settings.autosave, project.settings.autosaveIntervalSeconds]);
};
