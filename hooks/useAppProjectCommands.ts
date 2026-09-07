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
import { confirmProjectReplacement } from "../runtime/persistence/projectReplacementSafety";
import { projectHasStudentWork, type ProjectDecisionBoundary } from "../runtime/persistence/projectDecisionBoundary";

const APP_STAGE_IDS: AppStage[] = [
  "project",
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

type SetProject = (
  update: SetStateAction<ProjectState>,
  options?: { history?: boolean; resetHistory?: boolean },
) => void;

type UseAppProjectCommandsOptions = {
  project: ProjectState;
  projectDecision: ProjectDecisionBoundary;
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
  openFindFeature?: () => void;
  openFeedback?: () => void;
  openWhatsNew?: () => void;
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
  projectDecision,
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
  openFindFeature,
  openFeedback,
  openWhatsNew,
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
    const sourceProject = project;
    const filename = projectSnapshotFileName(sourceProject.metadata.name, suffix);
    const finish = (blob: Blob) => {
      try {
        if (latestProjectRef.current !== sourceProject) {
          setCommandStatus("Project changed. Save again.");
          return;
        }
        downloadBlob(filename, blob);
        setCommandStatus(`${status}: ${filename}`);
      } catch (error) {
        setCommandStatus(
          `Project save failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    projectDownloadClient.request(sourceProject, {
      complete: finish,
      unavailable: () => {
        try {
          finish(createPortableProjectBlob(sourceProject));
        } catch (error) {
          setCommandStatus(
            `Project save failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
      failed: (error) => setCommandStatus(`Project save failed: ${error.message}`),
    });
  };

  const confirmReplacement = (label: string, source = latestProjectRef.current) => {
    try {
      const accepted = confirmProjectReplacement(source, label);
      if (!accepted) setCommandStatus("Project unchanged");
      return accepted;
    } catch (error) {
      setCommandStatus(
        `Recovery copy failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
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
    decisionToken: number,
  ) => {
    if (!projectDecision.complete(decisionToken)) return;
    setPendingCharacter(null);
    setProject((current) => projectDecision.isCurrent(decisionToken) ? lessonProject : current, { resetHistory: true });
    setFoundry(foundryPreviewFromProject(lessonProject));
    setAngle(0);
    setIsPlaying(false);
    setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
    setShowGettingStarted(false);
    setStage(startStage);
  };

  const saveProject = () => downloadProjectSnapshot("", "Download started");
  const saveProjectAs = () =>
    downloadProjectSnapshot(`-${Date.now()}`, "Download started");
  const exportProjectCopy = () =>
    downloadProjectSnapshot("-copy", "Download started");

  const newProject = () => {
    const token = projectDecision.begin();
    if (!confirmReplacement("Start a new project")) return;
    if (!projectDecision.complete(token)) return;
    setCommandStatus("New project");
    const next = createEmptyProject();
    startTransition(() => {
      setPendingCharacter(null);
      setProject((current) => projectDecision.isCurrent(token) ? next : current, { resetHistory: true });
      setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
      setShowGettingStarted(false);
      setStage("character");
    });
  };

  const openClassroomLesson = (
    lessonId: string,
    preparedProject?: ProjectState,
  ) => {
    const token = projectDecision.begin();
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
    if (!confirmReplacement("Open this guide")) return;
    openLessonProject(lessonProject, lesson.startStage, token);
    setCommandStatus(`${lesson.outcome ?? lessonProject.metadata.name} ready`);
  };

  const openSampleProject = (preparedProject?: ProjectState) => {
    const token = projectDecision.begin();
    const next = preparedProject ?? createSampleProject();
    if (!confirmReplacement("Open the starter rig")) return;
    if (!projectDecision.complete(token)) return;
    setPendingCharacter(null);
    setProject((current) => projectDecision.isCurrent(token) ? next : current, { resetHistory: true });
    setShowGettingStarted(false);
    setStage("character");
  };

  const resetLesson = () => {
    const token = projectDecision.begin();
    const lesson = classroomLessonById(project.metadata.classroomLessonId);
    const resetProject = resetProjectToLessonBaseline(project);
    if (!lesson || !resetProject) {
      setCommandStatus("No lesson");
      return;
    }
    if (!confirmReplacement("Reset this lesson")) {
      return;
    }
    openLessonProject(resetProject, lesson.startStage, token);
    setCommandStatus("Lesson reset");
  };

  const recoverAutosave = () => {
    const requestedProject = latestProjectRef.current;
    const token = projectDecision.begin();
    const shouldApply = () =>
      projectDecision.isCurrent(token) &&
      latestProjectRef.current === requestedProject &&
      latestProjectRef.current.metadata.id === requestedProject.metadata.id;
    setCommandStatus("Checking browser backup…");
    autosaveRecoveryClient.request(requestedProject, {
      complete: (recovered) => {
        if (recovered.status === "rejected") {
          setCommandStatus(recovered.blocker);
          return;
        }
        if (recovered.status === "missing") {
          setCommandStatus(
            recovered.recovery.outcome === "storage-unavailable"
              ? "Browser backup unavailable"
              : "No browser backup found",
          );
          return;
        }
        const recoveredProject = recovered.project;
        if (
          !projectHasStudentWork(recoveredProject) &&
          projectHasStudentWork(requestedProject)
        ) {
          setCommandStatus("No browser backup found");
          return;
        }
        if (!shouldApply() || !projectDecision.complete(token)) return;
        setProject((current) => current === requestedProject && projectDecision.isCurrent(token)
          ? recoveredProject : current, { resetHistory: true });
        setPendingCharacter(null);
        setFoundry(foundryPreviewFromProject(recoveredProject));
        setShowGettingStarted(false);
        setCommandStatus("Recovered browser backup");
        setStage("path");
      },
      failed: (error) => setCommandStatus(
        `Browser recovery failed: ${error.message}`,
      ),
      superseded: () => setCommandStatus("Project or backup changed. Try again."),
    }, shouldApply, {
      accept: ({ project: candidate }) => {
        if (!projectHasStudentWork(candidate) && projectHasStudentWork(requestedProject)) {
          setCommandStatus("No browser backup found");
          return false;
        }
        return confirmReplacement("Recover browser backup", requestedProject);
      },
    });
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
    openFindFeature,
    openFeedback,
    openWhatsNew,
  }) satisfies AppCommandHandlerMap;

  return { commandHandlers, openClassroomLesson, openSampleProject };
};
