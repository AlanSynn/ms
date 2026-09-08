import { startTransition, useRef, useState, useEffect } from "react";

import type { AppStageRouterProps } from "../components/AppStageRouter";
import type { AppWorkspaceShellProps } from "../components/AppWorkspaceShell";
import { STAGES } from "../components/AppShell";
import type { AppStage, CanvasViewport, MechanismConfig } from "../types";
import {
  CLASSROOM_LESSONS,
  classroomLessonById,
  createDefaultMechanism,
  createEmptyProject,
} from "../utils/project";
import { isMechanismTypeEnabled } from "../utils/mechanismTemplates";
import { DEFAULT_CANVAS_VIEWPORT } from "../utils/viewport";
import { classroomAssessmentKeyFromSearch } from "../utils/classroomContent";
import { workflowStatusFor } from "../utils/workflowStatus";
import { createStageNavigator } from "../utils/appStageNavigation";
import { buildAppStageRouterProps } from "../utils/appStageRouterProps";
import { useAppCharacterImportActions } from "./useAppCharacterImportActions";
import { useAppCommandBindings } from "./useAppCommandBindings";
import { useAppDerivedState } from "./useAppDerivedState";
import { useAppMechanismActions } from "./useAppMechanismActions";
import { useAppPathActions } from "./useAppPathActions";
import { useAppProjectCommands } from "./useAppProjectCommands";
import { useModalInertEffect } from "./useModalInertEffect";
import { useStudentSupport } from "./useStudentSupport";
import { useReleaseNotes } from "./useReleaseNotes";
import { useStartupFlow } from "./useStartupFlow";
import { playableMotionPaths } from "../utils/motion";
import type { FoundryCamera } from "../utils/foundryCamera";
import { useProjectAutosave } from "./useProjectAutosave";
import { useColdAutosaveRecovery } from "./useColdAutosaveRecovery";
import { useProjectHistory } from "./useProjectHistory";
import { useProjectVersions } from './useProjectVersions';
import { useWorkspacePlaybackLoop } from "./useWorkspacePlaybackLoop";
import { useWorkspacePlayerDock } from "./useWorkspacePlayerDock";
import {
  createPlaybackClock,
  type PlaybackClock,
} from "../runtime/playback/externalPlaybackClock";
import {
  createCharacterImportProgressStore,
  type CharacterImportProgressStore,
} from "../runtime/import/characterImportProgressStore";

const ENABLED_GUIDED_LESSONS = CLASSROOM_LESSONS.filter((lesson) =>
  isMechanismTypeEnabled(lesson.mechanismType),
);

type FoundryState = MechanismConfig;

export const useMotionSmithAppController = (): AppWorkspaceShellProps => {
  const {
    project,
    setProject,
    dispatch,
    undoProject: undoProjectHistory,
    redoProject: redoProjectHistory,
  } = useProjectHistory(createEmptyProject);
  const autosaveRecovery = useColdAutosaveRecovery({ project });
  const notes = useReleaseNotes();
  const startup = useStartupFlow(notes.hasNew);
  const { showGettingStarted, setShowGettingStarted } = startup;
  const [stage, setStage] = useState<AppStage>("project");
  const [angle, setAngle] = useState(0);
  const playbackClockRef = useRef<PlaybackClock | null>(null);
  if (!playbackClockRef.current) playbackClockRef.current = createPlaybackClock();
  const playbackClock = playbackClockRef.current;
  const characterImportProgressRef = useRef<CharacterImportProgressStore | null>(null);
  characterImportProgressRef.current ??= createCharacterImportProgressStore();
  const characterImportProgress = characterImportProgressRef.current;
  const [isPlaying, setIsPlaying] = useState(false);
  const [showTrace, setShowTrace] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const modalOpen = startup.booting || startup.showAnnouncement || showGettingStarted || showShortcuts || showAbout;
  const [foundry, setFoundry] = useState<FoundryState>(() =>
    createDefaultMechanism("4bar", "foundry-preview"),
  );
  const [canvasViewport, setCanvasViewport] = useState<CanvasViewport>(
    DEFAULT_CANVAS_VIEWPORT,
  );
  const [workingCamera, setWorkingCamera] = useState<FoundryCamera>();
  useEffect(() => setWorkingCamera(undefined), [project.metadata.id]);
  const [commandStatus, setCommandStatus] = useState("Ready");
  const projectInputRef = useRef<HTMLInputElement>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const assessmentQueryApplied = useRef(false);
  const currentOnlySaveRef = useRef<() => void>(() => undefined);
  const versions = useProjectVersions({
    project, decision: autosaveRecovery.decision, setProject, onStatus: setCommandStatus,
    showProject: () => setStage('project'),
    saveCurrentOnly: () => currentOnlySaveRef.current(),
    onRestored: restored => {
      setIsPlaying(false);
      playbackClock.setPhase(0);
      setAngle(0);
      characterImportProgress.publishPending(null);
      characterImportProgress.publishProgress(null);
      setFoundry(restored.mechanisms[0] ? { ...restored.mechanisms[0], id: 'foundry-preview' } : createDefaultMechanism('4bar', 'foundry-preview'));
    },
  });
  useEffect(() => { if (stage !== 'project') versions.view.close(); }, [stage]);
  const projectBackup = useProjectAutosave(project, {
    projectDecision: autosaveRecovery.decision,
    onFailure: setCommandStatus,
    historyAuthority: versions.authority,
    onPrepared: versions.prepared,
    suspended: autosaveRecovery.decision.isAuthorized() && !versions.storageReady,
  });
  const recoveryCandidate = autosaveRecovery.candidate ?? projectBackup.candidate;

  useEffect(() => {
    if (playbackClock.getPhase() !== angle) playbackClock.setPhase(angle);
  }, [angle, playbackClock]);

  useEffect(() => {
    if (
      autosaveRecovery.pending ||
      assessmentQueryApplied.current ||
      typeof window === "undefined"
    ) return;
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
  }, [
    autosaveRecovery.pending,
    dispatch,
    project.settings.classroomAssessmentKey,
  ]);

  const goStage = createStageNavigator({
    project,
    dispatch,
    setStage: (nextStage) => startTransition(() => setStage(nextStage)),
    setCommandStatus,
    stageLabel: (item) =>
      STAGES.find((stageItem) => stageItem.id === item)?.label ?? item,
  });
  const support = useStudentSupport({
    rootRef: appShellRef, project, stage, goStage, onStatus: setCommandStatus,
    notes, startupAnnouncement: startup.showAnnouncement, onDismissStartup: startup.dismissAnnouncement,
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
    setPendingCharacter,
    importCharacterPackage,
    importProject,
    editCharacterParts,
    saveSkeleton,
    acceptPendingCharacter,
    discardPendingCharacter,
    startFromPackage,
  } = useAppCharacterImportActions({
    versions,
    project,
    dispatch,
    setProject,
    setFoundry,
    setStage,
    setCommandStatus,
    setShowGettingStarted,
    characterImportProgress,
    projectDecision: autosaveRecovery.decision,
  });
  const activeClassroomLesson = classroomLessonById(
    project.metadata.classroomLessonId,
  );
  const {
    optimizerBusy,
    cancelMechanismOptimization,
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
  });

  useWorkspacePlaybackLoop({
    stage,
    isPlaying,
    drawMode,
    optimizerBusy,
    showGettingStarted: modalOpen || !!support.surface || Boolean(versions.view.preview),
    playbackDurationMs,
    animationSpeed: project.settings.animationSpeed,
    timingProfile: project.settings.timingProfile,
    playbackClock,
    setAngle,
    setDrawMode,
  });

  const { commandHandlers, openClassroomLesson, openSampleProject } =
    useAppProjectCommands({
      versions,
      project,
      projectDecision: autosaveRecovery.decision,
      stage,
      canvasViewport,
      setProject,
      dispatch,
      undoProjectHistory,
      redoProjectHistory,
      setStage,
      setFoundry,
      setAngle: next => {
        const phase = typeof next === 'function' ? next(playbackClock.getPhase()) : next;
        playbackClock.setPhase(phase);
        setAngle(phase);
      },
      setIsPlaying,
      setCanvasViewport,
      setPendingCharacter,
      setShowGettingStarted,
      setShowAbout,
      setShowShortcuts,
      setCommandStatus,
      openProjectPicker: () => projectInputRef.current?.click(),
      goStage,
      openFindFeature: () => support.open('search'),
      openFeedback: () => support.open('feedback'),
      openWhatsNew: () => support.open('whatsNew'),
    });
  currentOnlySaveRef.current = commandHandlers['project.saveCurrentOnly'];
  useAppCommandBindings({ commandHandlers, disabled: modalOpen || !!support.surface || Boolean(versions.view.preview) });
  const themeClass =
    project.settings.theme === "dark"
      ? "bg-slate-950 text-slate-100"
      : "bg-slate-50 text-slate-950";
  const editorStage: AppStage = stage;
  const closeGettingStarted = () => {
    setShowGettingStarted(false);
  };
  const openHome = () => {
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
    projectHasMotion: project.mechanisms.some(item => item.enabled !== false) || playableMotionPaths(project).length > 0,
    modalOpen: modalOpen || !!support.surface,
    isPlaying,
    setIsPlaying,
    angle,
    setAngle,
    playbackClock,
    speed: project.settings.animationSpeed,
    drawMode,
  });

  useModalInertEffect(appShellRef, modalOpen || !!support.surface);

  const stageLabel =
    STAGES.find((item) => item.id === editorStage)?.label ?? editorStage;
  const workflowStatus = workflowStatusFor(
    editorStage,
    stageLabel,
    project,
    selectedSceneObject ?? selectedPart,
    selectedPath,
  );

  const stageRouterProps: AppStageRouterProps = buildAppStageRouterProps({
    editorStage,
    project,
    dispatch,
    goStage,
    playerDock: versions.view.preview ? null : playerDock,
    playbackClock,
    commandHandlers,
    projectVersions: versions.view,
    projectBackup,
    recoveryCandidate,
    workingCamera,
    onWorkingCameraChange: setWorkingCamera,
    character: {
      characterImportProgress,
      onOpenGettingStarted: () => setShowGettingStarted(true),
      onAcceptPendingCharacter: acceptPendingCharacter,
      onDiscardPendingCharacter: discardPendingCharacter,
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
      onCancelOptimize: cancelMechanismOptimization,
      onApplyRecommendation: applyRecommendedMechanism,
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
    support,
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
    booting: startup.booting,
    recoveryCandidate,
    showGettingStarted,
    hideGettingStartedThisSession: startup.hideForSession,
    guidedLessons: ENABLED_GUIDED_LESSONS,
    onLesson: openClassroomLesson,
    onSample: openSampleProject,
    onPackage: startFromPackage,
    onHideGettingStartedThisSessionChange: startup.setHideForSession,
    onCloseGettingStarted: closeGettingStarted,
    showShortcuts,
    onCloseShortcuts: () => setShowShortcuts(false),
    showAbout,
    onCloseAbout: () => setShowAbout(false),
    showTracking,
    onCloseTracking: closeTracking,
    onTransferTracking: transferTrackedPath,
  };
};
