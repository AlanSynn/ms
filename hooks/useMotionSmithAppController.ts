import { useRef, useState, useEffect } from "react";

import type { AppStageRouterProps } from "../components/AppStageRouter";
import type { AppWorkspaceShellProps } from "../components/AppWorkspaceShell";
import { STAGES } from "../components/AppShell";
import { STARTER_IMAGE_TEMPLATES } from "../resources/starterImageTemplates";
import type { AppStage, CanvasViewport, MechanismConfig } from "../types";
import {
  CLASSROOM_LESSONS,
  classroomLessonById,
  createDefaultMechanism,
  createEmptyProject,
} from "../utils/project";
import { DEFAULT_CANVAS_VIEWPORT } from "../utils/viewport";
import { classroomAssessmentKeyFromSearch } from "../utils/classroomContent";
import { readAutosaveProject } from "../utils/projectPersistence";
import { workflowStatusFor } from "../utils/workflowStatus";
import { createStageNavigator } from "../utils/appStageNavigation";
import { buildAppStageRouterProps } from "../utils/appStageRouterProps";
import { useAppCharacterImportActions } from "./useAppCharacterImportActions";
import { useAppCommandBindings } from "./useAppCommandBindings";
import { useAppDerivedState } from "./useAppDerivedState";
import { useAppMechanismActions } from "./useAppMechanismActions";
import { useAppOnnxBootstrap } from "./useAppOnnxBootstrap";
import { useAppPathActions } from "./useAppPathActions";
import { useAppProjectCommands } from "./useAppProjectCommands";
import { useModalInertEffect } from "./useModalInertEffect";
import { useProjectAutosave } from "./useProjectAutosave";
import { useProjectHistory } from "./useProjectHistory";
import { useWorkspacePlaybackLoop } from "./useWorkspacePlaybackLoop";
import { useWorkspacePlayerDock } from "./useWorkspacePlayerDock";
import {
  createPlaybackClock,
  type PlaybackClock,
} from "../runtime/playback/externalPlaybackClock";

type FoundryState = MechanismConfig;

const GETTING_STARTED_SESSION_KEY =
  "motionsmith.gettingStarted.hiddenSession";

const readGettingStartedHiddenForSession = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(GETTING_STARTED_SESSION_KEY) === "true";
  } catch {
    return false;
  }
};

const writeGettingStartedHiddenForSession = (hidden: boolean) => {
  if (typeof window === "undefined") return;
  try {
    if (hidden) window.sessionStorage.setItem(GETTING_STARTED_SESSION_KEY, "true");
    else window.sessionStorage.removeItem(GETTING_STARTED_SESSION_KEY);
  } catch {
    // Session-only onboarding preference is best-effort.
  }
};

const createInitialProject = () => {
  if (typeof window === "undefined") return createEmptyProject();
  try {
    const initialProject = createEmptyProject();
    const restored = readAutosaveProject(initialProject);
    return restored.status === "loaded" ? restored.project : initialProject;
  } catch {
    return createEmptyProject();
  }
};

export const useMotionSmithAppController = (): AppWorkspaceShellProps => {
  const {
    project,
    setProject,
    dispatch,
    undoProject: undoProjectHistory,
    redoProject: redoProjectHistory,
  } = useProjectHistory(createInitialProject);
  const [stage, setStage] = useState<AppStage>("character");
  const [showGettingStarted, setShowGettingStarted] = useState(
    () => !readGettingStartedHiddenForSession(),
  );
  const [hideGettingStartedThisSession, setHideGettingStartedThisSession] =
    useState(readGettingStartedHiddenForSession);
  const [angle, setAngle] = useState(0);
  const playbackClockRef = useRef<PlaybackClock | null>(null);
  if (!playbackClockRef.current) playbackClockRef.current = createPlaybackClock();
  const playbackClock = playbackClockRef.current;
  const [isPlaying, setIsPlaying] = useState(true);
  const [showTrace, setShowTrace] = useState(true);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const modalOpen = showGettingStarted || showShortcuts || showAbout;
  const [foundry, setFoundry] = useState<FoundryState>(() =>
    createDefaultMechanism("4bar", "foundry-preview"),
  );
  const [canvasViewport, setCanvasViewport] = useState<CanvasViewport>(
    DEFAULT_CANVAS_VIEWPORT,
  );
  const [commandStatus, setCommandStatus] = useState("Ready");
  const { onnxCacheStatus, setOnnxCacheStatus, cacheOnnxModel } =
    useAppOnnxBootstrap(setCommandStatus);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const assessmentQueryApplied = useRef(false);
  useProjectAutosave(project);

  useEffect(() => {
    playbackClock.setPhase(angle);
  }, [angle, playbackClock]);

  useEffect(() => {
    if (assessmentQueryApplied.current || typeof window === "undefined") return;
    assessmentQueryApplied.current = true;
    const assessmentKey = classroomAssessmentKeyFromSearch(
      window.location.search,
    );
    if (
      assessmentKey &&
      assessmentKey !== project.settings.classroomAssessmentKey
    ) {
      dispatch({
        type: "update_settings",
        settings: { classroomAssessmentKey: assessmentKey },
      });
    }
  }, [dispatch, project.settings.classroomAssessmentKey]);

  const goStage = createStageNavigator({
    project,
    dispatch,
    setStage,
    setCommandStatus,
    stageLabel: (item) =>
      STAGES.find((stageItem) => stageItem.id === item)?.label ?? item,
  });
  const {
    sortedParts,
    selectedPart,
    selectedSceneObject,
    selectedPath,
    selectedMechanism,
    playbackDurationMs,
    mechanismConfig,
  } = useAppDerivedState(project);
  const {
    drawMode,
    setDrawMode,
    showTracking,
    setPathPoints,
    openTracking,
    closeTracking,
    transferTrackedPath,
  } = useAppPathActions({
    project,
    selectedPart,
    selectedSceneObject,
    dispatch,
    setStage,
  });
  const {
    pendingCharacter,
    setPendingCharacter,
    runWebOnnx,
    importCharacterPackage,
    importProject,
    editCharacterParts,
    saveSkeleton,
    acceptPendingCharacter,
    startFromStarterImage,
    startFromPackage,
    startFromImage,
    startFromProject,
  } = useAppCharacterImportActions({
    project,
    stage,
    dispatch,
    setProject,
    setStage,
    setCommandStatus,
    setShowGettingStarted,
    setOnnxCacheStatus,
  });
  const activeClassroomLesson = classroomLessonById(
    project.metadata.classroomLessonId,
  );
  const {
    optimizerBusy,
    updateMechanism,
    optimizeSelectedMechanism,
    exportMechanismSvg,
    exportMechanismDxf,
    exportFoundryMechanism,
    commitFoundryDraft,
    applyRecommendedMechanism,
  } = useAppMechanismActions({
    project,
    dispatch,
    selectedPart,
    selectedSceneObject,
    selectedPath,
    selectedMechanism,
    foundry,
    mechanismConfig,
    angle,
    setStage,
    setCommandStatus,
    setShowRecommendations,
  });

  useWorkspacePlaybackLoop({
    stage,
    isPlaying,
    drawMode,
    optimizerBusy,
    showGettingStarted,
    playbackDurationMs,
    animationSpeed: project.settings.animationSpeed,
    timingProfile: project.settings.timingProfile,
    playbackClock,
    setAngle,
    setDrawMode,
  });

  const { commandHandlers, openClassroomLesson, openSampleProject } =
    useAppProjectCommands({
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
      openProjectPicker: () => projectInputRef.current?.click(),
      goStage,
    });
  useAppCommandBindings({ commandHandlers, disabled: modalOpen });
  const themeClass =
    project.settings.theme === "dark"
      ? "bg-slate-950 text-slate-100"
      : "bg-slate-50 text-slate-950";
  const editorStage: AppStage = stage;
  const updateGettingStartedSessionPreference = (hidden: boolean) => {
    setHideGettingStartedThisSession(hidden);
    writeGettingStartedHiddenForSession(hidden);
  };
  const closeGettingStarted = () => {
    setShowGettingStarted(false);
    setStage("character");
  };
  const openHome = () => {
    setStage("character");
    setShowGettingStarted(true);
  };
  const {
    playerDock,
    assemblyStepIndex,
    setAssemblyStepIndex,
    assemblyStepProgress,
    setAssemblyStepProgress,
    assemblyPlaying,
    setAssemblyPlaying,
    setAssemblyStepCount,
  } = useWorkspacePlayerDock({
    editorStage,
    modalOpen,
    isPlaying,
    setIsPlaying,
    angle,
    setAngle,
    playbackClock,
    speed: project.settings.animationSpeed,
    drawMode,
  });

  useModalInertEffect(appShellRef, modalOpen);

  const stageLabel =
    STAGES.find((item) => item.id === editorStage)?.label ?? editorStage;
  const workflowStatus = workflowStatusFor(
    editorStage,
    stageLabel,
    project,
    selectedPart,
    selectedPath,
  );

  const stageRouterProps: AppStageRouterProps = buildAppStageRouterProps({
    editorStage,
    project,
    dispatch,
    goStage,
    playerDock,
    playbackClock,
    character: {
      pendingCharacter,
      onOpenGettingStarted: () => setShowGettingStarted(true),
      onAcceptPendingCharacter: acceptPendingCharacter,
      onDiscardPendingCharacter: () => setPendingCharacter(null),
      onProcessCharacter: runWebOnnx,
      onPackageCharacter: importCharacterPackage,
      onImportProject: importProject,
      onEditCharacter: editCharacterParts,
      onSaveSkeleton: saveSkeleton,
      activeClassroomLesson,
      resetLesson: commandHandlers["project.resetLesson"],
    },
    selection: {
      sortedParts,
      selectedPart,
      selectedSceneObject,
      selectedPath,
      selectedMechanism,
    },
    path: {
      drawMode,
      setDrawMode,
      setPathPoints,
      openTracking,
      isPlaying,
      setIsPlaying,
      angle,
      setAngle,
    },
    viewport: {
      viewport: canvasViewport,
      setViewport: setCanvasViewport,
    },
    foundryStage: {
      foundry,
      setFoundry,
      onFoundryDraftChange: commitFoundryDraft,
      onFoundryExport: exportFoundryMechanism,
    },
    mechanism: {
      updateMechanism,
      showTrace,
      setShowTrace,
      onOptimize: optimizeSelectedMechanism,
      onRecommendations: () => setShowRecommendations(true),
      optimizerBusy,
      exportSvg: exportMechanismSvg,
      exportDxf: exportMechanismDxf,
    },
    assembly: {
      assemblyStepIndex,
      setAssemblyStepIndex,
      assemblyStepProgress,
      setAssemblyStepProgress,
      assemblyPlaying,
      setAssemblyPlaying,
      setAssemblyStepCount,
    },
  });

  return {
    themeClass,
    appShellRef,
    projectInputRef,
    project,
    stage,
    goStage,
    onHome: openHome,
    commandHandlers,
    importProject,
    stageRouterProps,
    workflowStatus,
    commandStatus,
    onnxCacheStatus,
    cacheOnnxModel,
    showGettingStarted,
    hideGettingStartedThisSession,
    starterTemplates: STARTER_IMAGE_TEMPLATES,
    guidedLessons: CLASSROOM_LESSONS,
    onLesson: openClassroomLesson,
    onStarterImage: startFromStarterImage,
    onSample: openSampleProject,
    onPackage: startFromPackage,
    onProcess: startFromImage,
    onImport: startFromProject,
    onHideGettingStartedThisSessionChange: updateGettingStartedSessionPreference,
    onCloseGettingStarted: closeGettingStarted,
    showShortcuts,
    onCloseShortcuts: () => setShowShortcuts(false),
    showAbout,
    onCloseAbout: () => setShowAbout(false),
    showRecommendations,
    onCloseRecommendations: () => setShowRecommendations(false),
    onApplyRecommendation: applyRecommendedMechanism,
    showTracking,
    onCloseTracking: closeTracking,
    onTransferTracking: transferTrackedPath,
  };
};
