import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
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
  createDefaultMechanism,
  createEmptyProject,
  createLessonProject,
  createSampleProject,
  downloadBlob,
  resetProjectToLessonBaseline,
} from "../utils/project";
import { isMechanismTypeEnabled } from "../utils/mechanismTemplates";
import {
  projectSnapshotFileName,
  readWorkspaceLayoutSnapshot,
  writeWorkspaceLayoutSnapshot,
} from "../utils/projectPersistence";
import { clampCanvasZoom, DEFAULT_CANVAS_VIEWPORT } from "../utils/viewport";
import { createPortableProjectBlob } from "../runtime/persistence/projectDownloadJob";
import { createProjectDownloadWorkerClient } from "../runtime/persistence/projectDownloadWorkerClient";
import { createAutosaveRecoveryWorkerClient } from "../runtime/persistence/autosaveRecoveryWorkerClient";

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
  setPendingCharacter: (pending: PendingCharacterReview | null) => void;
  setShowGettingStarted: Dispatch<SetStateAction<boolean>>;
  setShowAbout: Dispatch<SetStateAction<boolean>>;
  setShowShortcuts: Dispatch<SetStateAction<boolean>>;
  setCommandStatus: (message: string) => void;
  openProjectPicker: () => void;
  goStage: (stage: AppStage) => void;
};

export type AppProjectCommands = {
  commandHandlers: AppCommandHandlerMap;
  openClassroomLesson: (
    lessonId: string,
    preparedProject?: ProjectState,
  ) => void;
  openSampleProject: (preparedProject?: ProjectState) => void;
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
  const projectDownloadClient = useMemo(
    () => createProjectDownloadWorkerClient(),
    [],
  );
  const autosaveRecoveryClient = useMemo(
    () => createAutosaveRecoveryWorkerClient(),
    [],
  );
  const latestProjectRef = useRef(project);
  latestProjectRef.current = project;
  useEffect(
    () => () => {
      projectDownloadClient.dispose();
      autosaveRecoveryClient.dispose();
    },
    [autosaveRecoveryClient, projectDownloadClient],
  );
  const downloadProjectSnapshot = (suffix: string, status: string) => {
    const filename = projectSnapshotFileName(project.metadata.name, suffix);
    const finish = (blob: Blob) => {
      try {
        downloadBlob(filename, blob);
        setCommandStatus(status);
      } catch (error) {
        setCommandStatus(
          `Project save failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    projectDownloadClient.request(project, {
      complete: finish,
      unavailable: () => {
        try {
          finish(createPortableProjectBlob(project));
        } catch (error) {
          setCommandStatus(
            `Project save failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
      failed: (error) => setCommandStatus(`Project save failed: ${error.message}`),
    });
  };

  const foundryPreviewFromProject = (lessonProject: ProjectState) => {
    const mechanism = lessonProject.mechanisms[0];
    return mechanism
      ? { ...mechanism, id: "foundry-preview" }
      : createDefaultMechanism("4bar", "foundry-preview");
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
    setCommandStatus("New project");
    startTransition(() => {
      setPendingCharacter(null);
      setProject(createEmptyProject(), { resetHistory: true });
      setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
      setShowGettingStarted(false);
      setStage("character");
    });
  };

  const openClassroomLesson = (
    lessonId: string,
    preparedProject?: ProjectState,
  ) => {
    const lesson = classroomLessonById(lessonId);
    if (!lesson || !isMechanismTypeEnabled(lesson.mechanismType)) {
      setCommandStatus("Lesson unavailable");
      return;
    }
    const lessonProjectBase = preparedProject ?? createLessonProject(lesson.id);
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

  const openSampleProject = (preparedProject?: ProjectState) => {
    setPendingCharacter(null);
    setProject(preparedProject ?? createSampleProject(), { resetHistory: true });
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
    const requestedProject = project;
    const shouldApply = () =>
      latestProjectRef.current === requestedProject &&
      latestProjectRef.current.metadata.id === requestedProject.metadata.id;
    setCommandStatus("Recovering autosave");
    autosaveRecoveryClient.request(requestedProject, {
      complete: (recovered) => {
        if (recovered.status === "rejected") {
          setCommandStatus(recovered.blocker);
          return;
        }
        if (recovered.status === "missing") {
          setCommandStatus(
            recovered.recovery.outcome === "storage-unavailable"
              ? "Autosave unavailable"
              : "No autosave found",
          );
          return;
        }
        const recoveredProject = recovered.project;
        if (
          !projectHasUserWork(recoveredProject) &&
          projectHasUserWork(requestedProject)
        ) {
          setCommandStatus("No autosave found");
          return;
        }
        setProject(recoveredProject, { resetHistory: true });
        setCommandStatus("Recovered browser autosave snapshot");
        setStage("path");
      },
      failed: (error) => setCommandStatus(
        `Autosave recovery failed: ${error.message}`,
      ),
      superseded: () => setCommandStatus("Autosave changed. Try again."),
    }, shouldApply);
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
