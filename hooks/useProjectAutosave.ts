import { useEffect, useRef } from "react";
import type { ProjectState } from "../types";
import {
  writeAutosaveSnapshot,
  type AutosaveWriteResult,
} from "../utils/projectPersistence";

type AutosaveWriteObserver = (
  result: AutosaveWriteResult,
  durationMs: number,
) => void;

export const useProjectAutosave = (
  project: ProjectState,
  onWrite?: AutosaveWriteObserver,
) => {
  const latestProjectRef = useRef<ProjectState>(project);
  const writeProject = (nextProject: ProjectState) => {
    if (!onWrite) return writeAutosaveSnapshot(nextProject);
    const startedAt = performance.now();
    const result = writeAutosaveSnapshot(nextProject);
    try {
      onWrite(result, performance.now() - startedAt);
    } catch {
      // Observation cannot change the completed local write result.
    }
    return result;
  };

  useEffect(() => {
    latestProjectRef.current = project;
    if (project.settings.autosave) writeProject(project);
  }, [project, onWrite]);

  useEffect(() => {
    if (!project.settings.autosave) return;
    const writeAutosave = () => writeProject(latestProjectRef.current);
    const intervalMs = Math.max(
      1000,
      project.settings.autosaveIntervalSeconds * 1000,
    );
    const interval = window.setInterval(writeAutosave, intervalMs);
    window.addEventListener("pagehide", writeAutosave);
    window.addEventListener("beforeunload", writeAutosave);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", writeAutosave);
      window.removeEventListener("beforeunload", writeAutosave);
    };
  }, [
    onWrite,
    project.settings.autosave,
    project.settings.autosaveIntervalSeconds,
  ]);
};
