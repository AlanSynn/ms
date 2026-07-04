import { useState, type SetStateAction } from "react";
import type { ProjectAction, ProjectState } from "../types";
import { applyProjectAction, projectSelfCheck } from "../utils/project";

const PROJECT_HISTORY_LIMIT = 80;

type ProjectHistoryState = {
  present: ProjectState;
  past: ProjectState[];
  future: ProjectState[];
};

type SetProjectOptions = {
  history?: boolean;
  resetHistory?: boolean;
};

const isUndoableProjectAction = (action: ProjectAction) =>
  ![
    "set_processing",
    "select_part",
    "set_export",
    "set_foundry_export",
  ].includes(action.type);

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

  const dispatch = (action: ProjectAction) =>
    setProject((prev) => applyProjectAction(prev, action), {
      history: isUndoableProjectAction(action),
    });

  const undoProject = () => {
    if (!projectHistory.past.length) return false;
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
