import type { Dispatch, SetStateAction } from "react";
import type {
  AppStage,
  CanvasViewport,
  MechanismConfig,
  ProjectAction,
  ProjectState,
} from "../types";
import type { PendingCharacterReview } from "../components/stages/character/CharacterImportOverlays";
import type { AppCommandHandlerMap } from "../utils/appCommands";
import { createAppCommandHandlers } from "../utils/appCommandHandlers";
import {
  classroomLessonById,
  createEmptyProject,
  createLessonProject,
  createSampleProject,
  downloadText,
  resetProjectToLessonBaseline,
  serializeProject,
} from "../utils/project";
import { foundryPreviewFromProject } from "../utils/mechanismDefaults";
import {
  projectSnapshotFileName,
  readAutosaveProject,
  readWorkspaceLayoutSnapshot,
  writeWorkspaceLayoutSnapshot,
} from "../utils/projectPersistence";
import { clampCanvasZoom, DEFAULT_CANVAS_VIEWPORT } from "../utils/viewport";

const APP_STAGE_IDS: AppStage[] = [
  "character",
  "path",
  "foundry",
  "design",
  "blueprint",
  "assembly",
  "options",
];

const isAppStage = (value: unknown): value is AppStage =>
  typeof value === "string" && APP_STAGE_IDS.includes(value as AppStage);

const projectHasUserWork = (project: ProjectState) =>
  project.partOrder.length > 0 ||
  project.sceneObjectOrder.length > 0 ||
  Object.keys(project.sceneObjects).length > 0 ||
  Object.keys(project.paths).length > 0 ||
  project.mechanisms.length > 0;

type SetProject = (
  update: SetStateAction<ProjectState>,
  options?: { history?: boolean; resetHistory?: boolean },
) => void;

type UseAppProjectCommandsOptions = {
  project: ProjectState;
  stage: AppStage;
  canvasViewport: CanvasViewport;
  setProject: SetProject;
  dispatch: (action: ProjectAction) => void;
  undoProjectHistory: () => boolean;
  redoProjectHistory: () => boolean;
  setStage: Dispatch<SetStateAction<AppStage>>;
  setFoundry: Dispatch<SetStateAction<MechanismConfig>>;
  setAngle: Dispatch<SetStateAction<number>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setCanvasViewport: Dispatch<SetStateAction<CanvasViewport>>;
  setPendingCharacter: Dispatch<SetStateAction<PendingCharacterReview | null>>;
  setShowGettingStarted: Dispatch<SetStateAction<boolean>>;
  setShowAbout: Dispatch<SetStateAction<boolean>>;
  setShowShortcuts: Dispatch<SetStateAction<boolean>>;
  setCommandStatus: (message: string) => void;
  openProjectPicker: () => void;
  goStage: (stage: AppStage) => void;
};

export type AppProjectCommands = {
  commandHandlers: AppCommandHandlerMap;
  openClassroomLesson: (lessonId: string) => void;
  openSampleProject: () => void;
};

export const useAppProjectCommands = ({
  project,
  stage,
  canvasViewport,
  setProject,
  dispatch,
  undoProjectHistory,
  redoProjectHistory,
  setStage,
  setFoundry,
  setAngle,
  setIsPlaying,
  setCanvasViewport,
  setPendingCharacter,
  setShowGettingStarted,
  setShowAbout,
  setShowShortcuts,
  setCommandStatus,
  openProjectPicker,
  goStage,
}: UseAppProjectCommandsOptions): AppProjectCommands => {
  const downloadProjectSnapshot = (suffix: string, status: string) => {
    downloadText(
      projectSnapshotFileName(project.metadata.name, suffix),
      serializeProject(project),
    );
    setCommandStatus(status);
  };

  const openLessonProject = (
    lessonProject: ProjectState,
    startStage: AppStage,
  ) => {
    setPendingCharacter(null);
    setProject(lessonProject, { resetHistory: true });
    setFoundry(foundryPreviewFromProject(lessonProject));
    setAngle(0);
    setIsPlaying(false);
    setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
    setShowGettingStarted(false);
    setStage(startStage);
  };

  const saveProject = () => downloadProjectSnapshot("", "Project saved");
  const saveProjectAs = () =>
    downloadProjectSnapshot(`-${Date.now()}`, "Project saved");
  const exportProjectCopy = () =>
    downloadProjectSnapshot("-copy", "Project copied");

  const newProject = () => {
    if (
      projectHasUserWork(project) &&
      !window.confirm("Discard current project and start new?")
    ) {
      setCommandStatus("Cancelled");
      return;
    }
    setPendingCharacter(null);
    setProject(createEmptyProject(), { resetHistory: true });
    setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
    setCommandStatus("New project");
    setShowGettingStarted(false);
    setStage("character");
  };

  const openClassroomLesson = (lessonId: string) => {
    const lesson = classroomLessonById(lessonId);
    if (!lesson) {
      setCommandStatus("Lesson unavailable");
      return;
    }
    const lessonProjectBase = createLessonProject(lesson.id);
    const lessonProject = {
      ...lessonProjectBase,
      settings: {
        ...lessonProjectBase.settings,
        classroomAssessmentKey: project.settings.classroomAssessmentKey,
      },
    };
    openLessonProject(lessonProject, lesson.startStage);
    setCommandStatus(`${lesson.outcome ?? lessonProject.metadata.name} ready`);
  };

  const openSampleProject = () => {
    setPendingCharacter(null);
    setProject(createSampleProject(), { resetHistory: true });
    setShowGettingStarted(false);
    setStage("character");
  };

  const resetLesson = () => {
    const lesson = classroomLessonById(project.metadata.classroomLessonId);
    const resetProject = resetProjectToLessonBaseline(project);
    if (!lesson || !resetProject) {
      setCommandStatus("No lesson");
      return;
    }
    openLessonProject(resetProject, lesson.startStage);
    setCommandStatus("Lesson reset");
  };

  const recoverAutosave = () => {
    try {
      const recoveredProject = readAutosaveProject();
      if (
        !recoveredProject ||
        (!projectHasUserWork(recoveredProject) && projectHasUserWork(project))
      ) {
        setCommandStatus("No autosave found");
        return;
      }
      setProject(recoveredProject, { resetHistory: true });
      setCommandStatus("Recovered browser autosave snapshot");
      setStage("path");
    } catch (error) {
      setCommandStatus(
        `Autosave recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const saveWorkspaceLayout = () => {
    writeWorkspaceLayoutSnapshot({
      stage,
      viewport: canvasViewport,
      toolbarVisible: project.settings.toolbarVisible,
      partPanelVisible: project.settings.partPanelVisible,
    });
    setCommandStatus("Workspace layout saved");
  };

  const restoreWorkspaceLayout = () => {
    try {
      const layout = readWorkspaceLayoutSnapshot({
        isAppStage,
        currentToolbarVisible: project.settings.toolbarVisible,
        currentPartPanelVisible: project.settings.partPanelVisible,
      });
      if (!layout) {
        setCommandStatus("No workspace layout saved");
        return;
      }
      if (layout.viewport) setCanvasViewport(layout.viewport);
      if (layout.visibility) {
        dispatch({
          type: "update_settings",
          settings: layout.visibility,
        });
      }
      if (layout.stage) goStage(layout.stage);
      setCommandStatus(
        layout.warnings.length
          ? `Workspace layout restored; ${layout.warnings.join("; ")}`
          : "Workspace layout restored",
      );
    } catch (error) {
      setCommandStatus(
        `Workspace restore failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const resetWorkspaceLayout = () => {
    setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
    dispatch({
      type: "update_settings",
      settings: { toolbarVisible: true, partPanelVisible: true },
    });
    setCommandStatus("Workspace layout reset");
  };

  const zoomCanvas = (factor: number) => {
    const nextZoom = clampCanvasZoom(canvasViewport.zoom * factor);
    setCanvasViewport((prev) => ({
      ...prev,
      zoom: clampCanvasZoom(prev.zoom * factor),
    }));
    setCommandStatus(`Canvas zoom ${Math.round(nextZoom * 100)}%`);
  };

  const fitCanvas = () => {
    setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
    setCommandStatus("Canvas fitted to sheet");
  };

  const undoProject = () => {
    setCommandStatus(undoProjectHistory() ? "Undo applied" : "Nothing to undo");
  };

  const redoProject = () => {
    setCommandStatus(redoProjectHistory() ? "Redo applied" : "Nothing to redo");
  };

  const commandHandlers = createAppCommandHandlers({
    newProject,
    openProject: openProjectPicker,
    recoverAutosave,
    saveProject,
    saveProjectAs,
    exportProjectCopy,
    resetLesson,
    undoProject,
    redoProject,
    zoomCanvas,
    fitCanvas,
    saveWorkspaceLayout,
    restoreWorkspaceLayout,
    resetWorkspaceLayout,
    goStage,
    openShortcuts: () => setShowShortcuts(true),
    openAbout: () => setShowAbout(true),
  }) satisfies AppCommandHandlerMap;

  return { commandHandlers, openClassroomLesson, openSampleProject };
};
