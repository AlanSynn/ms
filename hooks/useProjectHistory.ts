import { useState, type SetStateAction } from "react";
import type { ProjectAction, ProjectState } from "../types";
import { applyProjectAction, projectSelfCheck } from "../utils/project";
import {
  recordStudyEvent,
  recordStudyProjectAction,
  recordStudyProjectReplace,
} from "../utils/studyTelemetry";

const PROJECT_HISTORY_LIMIT = 80;

type ProjectHistoryState = {
  present: ProjectState;
  past: ProjectState[];
  future: ProjectState[];
};

type SetProjectOptions = {
  history?: boolean;
  resetHistory?: boolean;
  telemetrySource?: "action";
};

const isUndoableProjectAction = (action: ProjectAction) =>
  !["set_processing", "select_part", "set_export"].includes(action.type);

export const useProjectHistory = (createInitialProject: () => ProjectState) => {
  const [projectHistory, setProjectHistory] = useState<ProjectHistoryState>(
    () => {
      projectSelfCheck();
      return { present: createInitialProject(), past: [], future: [] };
    },
  );

  const setProject = (
    update: SetStateAction<ProjectState>,
    options: SetProjectOptions = {},
  ) => {
    if (options.telemetrySource !== "action") {
      recordStudyProjectReplace(options);
    }
    setProjectHistory((prev) => {
      const next =
        typeof update === "function"
          ? (update as (previous: ProjectState) => ProjectState)(prev.present)
          : update;
      if (next === prev.present) return prev;
      if (options.resetHistory) return { present: next, past: [], future: [] };
      if (options.history)
        return {
          present: next,
          past: [
            ...prev.past.slice(-(PROJECT_HISTORY_LIMIT - 1)),
            prev.present,
          ],
          future: [],
        };
      return { ...prev, present: next };
    });
  };

  const dispatch = (action: ProjectAction) => {
    recordStudyProjectAction(action);
    setProject((prev) => {
      const next = applyProjectAction(prev, action);
      return next;
    }, {
      history: isUndoableProjectAction(action),
      telemetrySource: "action",
    });
  };

  const undoProject = () => {
    if (!projectHistory.past.length) return false;
    recordStudyEvent("project.undo", undefined, { level: "replay", immediate: true });
    setProjectHistory((prev) => {
      if (!prev.past.length) return prev;
      const previous = prev.past[prev.past.length - 1];
      return {
        present: previous,
        past: prev.past.slice(0, -1),
        future: [prev.present, ...prev.future].slice(0, PROJECT_HISTORY_LIMIT),
      };
    });
    return true;
  };

  const redoProject = () => {
    if (!projectHistory.future.length) return false;
    recordStudyEvent("project.redo", undefined, { level: "replay", immediate: true });
    setProjectHistory((prev) => {
      if (!prev.future.length) return prev;
      const [next, ...future] = prev.future;
      return {
        present: next,
        past: [...prev.past.slice(-(PROJECT_HISTORY_LIMIT - 1)), prev.present],
        future,
      };
    });
    return true;
  };

  return {
    project: projectHistory.present,
    setProject,
    dispatch,
    undoProject,
    redoProject,
  };
};
