import { useState, useRef, type SetStateAction } from "react";
import type { ProjectAction, ProjectState } from "../types";
import { applyProjectActionResult, projectSelfCheck } from "../utils/project";
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

  // Tracks action objects already recorded in the current update so the
  // StrictMode double-invoke of the state updater does not double-record.
  const appliedActionRefs = useRef(new WeakSet<ProjectAction>());

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
    setProject((prev) => {
      const result = applyProjectActionResult(prev, action);
      // Record exactly once per action object: React StrictMode double-invokes
      // state updaters in development, so without this guard one dispatch would
      // emit two project.action records. `applied` is computed here against the
      // true previous state, so the replay projection can trust the flag
      // instead of re-deriving applied-ness from its own guards (which could
      // drift from applyProjectAction's). Rejected actions (applied:false) are
      // recorded without a coalesce key so they can never overwrite a real edit.
      if (!appliedActionRefs.current.has(action)) {
        appliedActionRefs.current.add(action);
        recordStudyProjectAction(action, result.applied);
      }
      return result.state;
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
