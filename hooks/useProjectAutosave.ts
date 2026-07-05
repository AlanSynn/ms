import { useEffect, useRef } from "react";
import type { ProjectState } from "../types";
import { writeAutosaveSnapshot } from "../utils/projectPersistence";

export const useProjectAutosave = (project: ProjectState) => {
  const latestProjectRef = useRef<ProjectState>(project);

  useEffect(() => {
    latestProjectRef.current = project;
  }, [project]);

  useEffect(() => {
    if (!project.settings.autosave) return;
    const writeAutosave = () => writeAutosaveSnapshot(latestProjectRef.current);
    writeAutosave();
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
  }, [project.settings.autosave, project.settings.autosaveIntervalSeconds]);
};
