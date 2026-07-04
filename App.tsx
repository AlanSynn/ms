import React, { useRef, useState } from "react";
import { AppWorkspaceShell } from "./components/AppWorkspaceShell";
import type { AppStageRouterProps } from "./components/AppStageRouter";
import { STAGES } from "./components/AppShell";
import { STARTER_IMAGE_TEMPLATES } from "./resources/starterImageTemplates";
import { AppStage, CanvasViewport, MechanismConfig } from "./types";
import {
  CLASSROOM_LESSONS,
  classroomLessonById,
  createDefaultMechanism,
  createEmptyProject,
  handoffGate,
} from "./utils/project";
import { DEFAULT_CANVAS_VIEWPORT } from "./utils/viewport";
import { useAppCommandBindings } from "./hooks/useAppCommandBindings";
import { useAppOnnxBootstrap } from "./hooks/useAppOnnxBootstrap";
import { useProjectAutosave } from "./hooks/useProjectAutosave";
import { useProjectHistory } from "./hooks/useProjectHistory";
import { useAppProjectCommands } from "./hooks/useAppProjectCommands";
import { useAppDerivedState } from "./hooks/useAppDerivedState";
import { useWorkspacePlayerDock } from "./hooks/useWorkspacePlayerDock";
import { useWorkspacePlaybackLoop } from "./hooks/useWorkspacePlaybackLoop";
import { useModalInertEffect } from "./hooks/useModalInertEffect";
import { useAppPathActions } from "./hooks/useAppPathActions";
import { useAppCharacterImportActions } from "./hooks/useAppCharacterImportActions";
import { workflowStatusFor } from "./utils/workflowStatus";
import { useAppMechanismActions } from "./hooks/useAppMechanismActions";

type FoundryState = MechanismConfig;

const App: React.FC = () => {
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

  const goStage = (target: AppStage) => {
    const gate = handoffGate(project, target);
    if (!gate.ok && "recoveryStage" in gate) {
      dispatch({
        type: "set_processing",
        processing: {
          stage: "error",
          message: gate.message,
          progress: 0,
          error: gate.message,
        },
      });
      setCommandStatus(gate.message);
      setStage(gate.recoveryStage);
    } else {
      setCommandStatus(
        `Opened ${STAGES.find((s) => s.id === target)?.label ?? target}`,
      );
      setStage(target);
    }
  };
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

  const stageRouterProps: AppStageRouterProps = {
    editorStage,
    project,
    dispatch,
    goStage,
    playerDock,
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
    sortedParts,
    selectedPart,
    selectedPath,
    drawMode,
    setDrawMode,
    setPathPoints,
    openTracking,
    isPlaying,
    setIsPlaying,
    angle,
    setAngle,
    viewport: canvasViewport,
    setViewport: setCanvasViewport,
    foundry,
    setFoundry,
    onFoundryExport: exportFoundryMechanism,
    selectedMechanism,
    updateMechanism,
    showTrace,
    setShowTrace,
    onOptimize: optimizeSelectedMechanism,
    onRecommendations: () => setShowRecommendations(true),
    optimizerBusy,
    exportSvg: exportMechanismSvg,
    exportDxf: exportMechanismDxf,
    assemblyStepIndex,
    setAssemblyStepIndex,
    assemblyStepProgress,
    setAssemblyStepProgress,
    assemblyPlaying,
    setAssemblyPlaying,
    setAssemblyStepCount,
  };

  return (
    <AppWorkspaceShell
      themeClass={themeClass}
      appShellRef={appShellRef}
      projectInputRef={projectInputRef}
      project={project}
      stage={stage}
      goStage={goStage}
      commandHandlers={commandHandlers}
      importProject={importProject}
      stageRouterProps={stageRouterProps}
      workflowStatus={workflowStatus}
      commandStatus={commandStatus}
      onnxCacheStatus={onnxCacheStatus}
      cacheOnnxModel={cacheOnnxModel}
      showGettingStarted={showGettingStarted}
      starterTemplates={STARTER_IMAGE_TEMPLATES}
      guidedLessons={CLASSROOM_LESSONS}
      onLesson={openClassroomLesson}
      onStarterImage={startFromStarterImage}
      onSample={openSampleProject}
      onPackage={startFromPackage}
      onProcess={startFromImage}
      onImport={startFromProject}
      onCloseGettingStarted={closeGettingStarted}
      showShortcuts={showShortcuts}
      onCloseShortcuts={() => setShowShortcuts(false)}
      showAbout={showAbout}
      onCloseAbout={() => setShowAbout(false)}
      showRecommendations={showRecommendations}
      onCloseRecommendations={() => setShowRecommendations(false)}
      onApplyRecommendation={applyRecommendedMechanism}
      showTracking={showTracking}
      onCloseTracking={closeTracking}
      onTransferTracking={transferTrackedPath}
    />
  );
};

export default App;
