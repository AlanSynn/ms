import { useRef, useState } from "react";

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
import { workflowStatusFor } from "../utils/workflowStatus";
import { navigateAppStage } from "../utils/appStageNavigation";
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

type FoundryState = MechanismConfig;

export const useMotionSmithAppController = (): AppWorkspaceShellProps => {
  const {
    project,
    setProject,
    dispatch,
    undoProject: undoProjectHistory,
    redoProject: redoProjectHistory,
  } = useProjectHistory(createEmptyProject);
  const [stage, setStage] = useState<AppStage>("character");
  const [showGettingStarted, setShowGettingStarted] = useState(false);
  const [angle, setAngle] = useState(0);
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
  useProjectAutosave(project);

  const goStage = (target: AppStage) =>
    navigateAppStage({
      project,
      target,
      dispatch,
      setStage,
      setCommandStatus,
      stageLabel: (item) =>
        STAGES.find((stageItem) => stageItem.id === item)?.label ?? item,
    });
  const {
    sortedParts,
    selectedPart,
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
    dispatch,
    setStage,
  });
  const {
    pendingCharacter,
    setPendingCharacter,
    replaceCharacter,
    setReplaceCharacter,
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
    applyRecommendedMechanism,
  } = useAppMechanismActions({
    project,
    dispatch,
    selectedPart,
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
  const closeGettingStarted = () => {
    setShowGettingStarted(false);
    setStage("character");
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
    character: {
      pendingCharacter,
      replaceCharacter,
      setReplaceCharacter,
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
    commandHandlers,
    importProject,
    stageRouterProps,
    workflowStatus,
    commandStatus,
    onnxCacheStatus,
    cacheOnnxModel,
    showGettingStarted,
    starterTemplates: STARTER_IMAGE_TEMPLATES,
    guidedLessons: CLASSROOM_LESSONS,
    onLesson: openClassroomLesson,
    onStarterImage: startFromStarterImage,
    onSample: openSampleProject,
    onPackage: startFromPackage,
    onProcess: startFromImage,
    onImport: startFromProject,
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
