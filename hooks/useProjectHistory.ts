import { useState, type SetStateAction } from "react";
import type { ProjectAction, ProjectState } from "../types";
import { applyProjectAction, projectSelfCheck } from "../utils/project";
import { recordProjectAction } from "../utils/performanceAudit";
import { AUTHORED_SETTINGS, restoreAuthoredSettings } from '../runtime/versions/versionPolicy';
import {
  boundProjectHistory,
  createProjectHistoryEntry,
  type ProjectHistoryEntry,
} from "../runtime/persistence/projectHistoryPolicy";

type ProjectHistoryState = {
  present: ProjectState;
  past: ProjectHistoryEntry<ProjectState>[];
  future: ProjectHistoryEntry<ProjectState>[];
};

type SetProjectOptions = {
  history?: boolean;
  resetHistory?: boolean;
};

export const isUndoableProjectAction = (action: ProjectAction) =>
  (action.type !== 'update_settings' || AUTHORED_SETTINGS.some(key => key in action.settings)) &&
  ![
    "set_processing",
    "select_part",
    "select_path",
    "select_scene_object",
    "select_mechanism",
    "set_export",
    "set_foundry_export",
  ].includes(action.type);

export const useProjectHistory = (createInitialProject: () => ProjectState) => {
  const [projectHistory, setProjectHistory] = useState<ProjectHistoryState>(
    () => {
      if (import.meta.env.DEV) projectSelfCheck();
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
      if (options.history) {
        const bounded = boundProjectHistory(
          [...prev.past, createProjectHistoryEntry(prev.present, next)],
          [],
          "past",
        );
        return {
          present: next,
          past: bounded.past,
          future: bounded.future,
        };
      }
      return { ...prev, present: next };
    });
  };

  const dispatch = (action: ProjectAction) => {
    recordProjectAction(action.type);
    setProject((prev) => applyProjectAction(prev, action), {
      history: isUndoableProjectAction(action),
    });
  };

  const undoProject = () => {
    if (!projectHistory.past.length) return false;
    setProjectHistory((prev) => {
      if (!prev.past.length) return prev;
      const previous = prev.past[prev.past.length - 1].project;
      const bounded = boundProjectHistory(
        prev.past.slice(0, -1),
        [createProjectHistoryEntry(prev.present, previous), ...prev.future],
        "future",
      );
      return {
        present: { ...previous, settings: restoreAuthoredSettings(prev.present.settings, previous.settings) },
        past: bounded.past,
        future: bounded.future,
      };
    });
    return true;
  };

  const redoProject = () => {
    if (!projectHistory.future.length) return false;
    setProjectHistory((prev) => {
      if (!prev.future.length) return prev;
      const [nextEntry, ...future] = prev.future;
      const next = nextEntry.project;
      const bounded = boundProjectHistory(
        [...prev.past, createProjectHistoryEntry(prev.present, next)],
        future,
        "past",
      );
      return {
        present: { ...next, settings: restoreAuthoredSettings(prev.present.settings, next.settings) },
        past: bounded.past,
        future: bounded.future,
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
