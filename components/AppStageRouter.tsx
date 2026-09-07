import {
  startTransition,
  Suspense,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type {
  AppStage,
  BodyPartLayer,
  CanvasViewport,
  FoundryExportPackage,
  MechanismConfig,
  Point,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
  SceneObject,
} from "../types";
import type { ClassroomLessonTemplate } from "../utils/project";
import type { PlaybackClock } from "../runtime/playback/externalPlaybackClock";
import type { CharacterImportProgressStore } from "../runtime/import/characterImportProgressStore";
import type { MechanismUpdateCallbacks } from "../hooks/useAppMechanismActions";
import {
  resolveAssemblyStage,
  resolveBlueprintStage,
  resolveDesignStage,
  resolveFoundryStage,
  resolveOptionsStage,
  resolvePathStage,
  useAdjacentClassroomStagePreload,
} from "./classroomStageModules";
import { CharacterSelection } from "./stages/character/CharacterSelection";
import { ProjectStage } from "./stages/project/ProjectStage";
import type { AppCommandHandlerMap } from "../utils/appCommands";
import type { FoundryCamera } from "../utils/foundryCamera";
import type { BrowserRecoveryCandidate, ProjectBackupStatus } from "../runtime/persistence/projectDecisionBoundary";

export type AppStageRouterProps = {
  editorStage: AppStage;
  project: ProjectState;
  dispatch: (action: ProjectAction) => void;
  goStage: (stage: AppStage) => void;
  playerDock: ReactNode;
  playbackClock: PlaybackClock;
  commandHandlers: AppCommandHandlerMap;
  projectBackup?: ProjectBackupStatus;
  recoveryCandidate?: BrowserRecoveryCandidate;
  workingCamera?: FoundryCamera;
  onWorkingCameraChange?: (camera: FoundryCamera) => void;

  characterImportProgress: CharacterImportProgressStore;
  onOpenGettingStarted: () => void;
  onAcceptPendingCharacter: () => void;
  onDiscardPendingCharacter: () => void;
  onPackageCharacter: (files: FileList | File[]) => void | Promise<void>;
  onImportProject: (file: File) => void | Promise<void>;
  onEditCharacter: () => void;
  onSaveSkeleton: () => void;
  activeClassroomLesson?: ClassroomLessonTemplate;
  resetLesson: () => void;

  sortedParts: BodyPartLayer[];
  selectedPart?: BodyPartLayer;
  selectedSceneObject?: SceneObject;
  selectedPath?: ProjectMotionPath;
  drawMode: boolean;
  setDrawMode: (v: boolean) => void;
  setPathPoints: (
    points: Point[],
    source?: ProjectMotionPath["source"],
    timedPoints?: ProjectMotionPath["timedPoints"],
  ) => void;
  openTracking: () => void;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  angle: number;
  setAngle: Dispatch<SetStateAction<number>>;
  viewport: CanvasViewport;
  setViewport: Dispatch<SetStateAction<CanvasViewport>>;

  foundry: MechanismConfig;
  setFoundry: (mechanism: MechanismConfig) => void;
  onFoundryDraftChange: (mechanism: MechanismConfig) => boolean | void;
  onFoundryExport: (pkg: FoundryExportPackage) => void;

  selectedMechanism?: MechanismConfig;
  updateMechanism: (
    id: string,
    updates: Partial<MechanismConfig>,
    callbacks?: MechanismUpdateCallbacks,
  ) => void;
  showTrace: boolean;
  setShowTrace: (v: boolean) => void;
  onOptimize: () => void | Promise<void>;
  onCancelOptimize: () => void;
  onApplyRecommendation: (mechanism: MechanismConfig) => void;
  optimizerBusy: boolean;
  exportSvg: () => void;
  exportDxf: () => void;

  assemblyStepIndex: number;
  setAssemblyStepIndex: Dispatch<SetStateAction<number>>;
  assemblyStepProgress: number;
  setAssemblyStepProgress: Dispatch<SetStateAction<number>>;
  assemblyPlaying: boolean;
  setAssemblyPlaying: Dispatch<SetStateAction<boolean>>;
  setAssemblyStepCount: Dispatch<SetStateAction<number>>;
  suspendStageContent?: boolean;
};

const useDeferredStageMount = (
  editorStage: AppStage,
  suspendStageContent: boolean,
) => {
  const [mountedStage, setMountedStage] = useState<AppStage | null>(() =>
    suspendStageContent ? null : editorStage,
  );
  useEffect(() => {
    if (suspendStageContent) {
      if (mountedStage !== null) setMountedStage(null);
      return;
    }
    if (mountedStage === editorStage) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        startTransition(() => setMountedStage(editorStage));
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [editorStage, mountedStage, suspendStageContent]);
  return !suspendStageContent && mountedStage === editorStage
    ? editorStage
    : null;
};

const StageTransitionFrame = () => (
  <div
    className="editor-stage-frame stage-transition-frame"
    data-testid="stage-transition-frame"
    aria-busy="true"
  >
    <aside className="stage-left-pane workspace" />
    <section className="stage-canvas-pane canvas-workspace" />
    <aside className="stage-right-inspector workspace" />
  </div>
);

export const AppStageRouter = ({
  editorStage,
  project,
  dispatch,
  goStage,
  playerDock,
  playbackClock,
  commandHandlers,
  projectBackup,
  recoveryCandidate,
  workingCamera,
  onWorkingCameraChange,
  characterImportProgress,
  onOpenGettingStarted,
  onAcceptPendingCharacter,
  onDiscardPendingCharacter,
  onPackageCharacter,
  onImportProject,
  onEditCharacter,
  onSaveSkeleton,
  activeClassroomLesson,
  resetLesson,
  sortedParts,
  selectedPart,
  selectedSceneObject,
  selectedPath,
  drawMode,
  setDrawMode,
  setPathPoints,
  openTracking,
  isPlaying,
  setIsPlaying,
  angle,
  setAngle,
  viewport,
  setViewport,
  foundry,
  setFoundry,
  onFoundryDraftChange,
  onFoundryExport,
  selectedMechanism,
  updateMechanism,
  showTrace,
  setShowTrace,
  onOptimize,
  onCancelOptimize,
  onApplyRecommendation,
  optimizerBusy,
  exportSvg,
  exportDxf,
  assemblyStepIndex,
  setAssemblyStepIndex,
  assemblyStepProgress,
  setAssemblyStepProgress,
  assemblyPlaying,
  setAssemblyPlaying,
  setAssemblyStepCount,
  suspendStageContent = false,
}: AppStageRouterProps) => {
  const AssemblyGuide = resolveAssemblyStage();
  const BlueprintExport = resolveBlueprintStage();
  const MechanismFoundry = resolveFoundryStage();
  const MechanismDesign = resolveDesignStage();
  const Options = resolveOptionsStage();
  const PathEditor = resolvePathStage();
  const mountedStage = useDeferredStageMount(
    editorStage,
    suspendStageContent,
  );
  useAdjacentClassroomStagePreload(mountedStage, suspendStageContent);

  return <div
    className="stage-body editor-workbench relative min-h-0 flex-1 overflow-hidden p-7"
    data-testid="shared-workbench"
  >
    {mountedStage === null && (
      <StageTransitionFrame />
    )}
    <Suspense fallback={mountedStage === null ? null : <StageTransitionFrame />}>
    {mountedStage === "project" && (
      <ProjectStage project={project} commandHandlers={commandHandlers} goStage={goStage}
        angle={angle} isPlaying={isPlaying} playbackClock={playbackClock}
        viewport={viewport} setViewport={setViewport}
        camera={workingCamera} onCameraChange={onWorkingCameraChange}
        backup={projectBackup} recoveryCandidate={recoveryCandidate} />
    )}
    {mountedStage === "character" && (
      <CharacterSelection
        project={project}
        dispatch={dispatch}
        characterImportProgress={characterImportProgress}
        onOpenGettingStarted={onOpenGettingStarted}
        onAccept={onAcceptPendingCharacter}
        onDiscard={onDiscardPendingCharacter}
        onPackage={onPackageCharacter}
        onImport={onImportProject}
        onEditCharacter={onEditCharacter}
        onSaveSkeleton={onSaveSkeleton}
        activeClassroomLesson={activeClassroomLesson}
        resetLesson={resetLesson}
        goStage={goStage}
        viewport={viewport}
        setViewport={setViewport}
      />
    )}
    {mountedStage === "path" && (
      <PathEditor
        project={project}
        sortedParts={sortedParts}
        selectedPart={selectedPart}
        selectedSceneObject={selectedSceneObject}
        selectedPath={selectedPath}
        drawMode={drawMode}
        setDrawMode={setDrawMode}
        dispatch={dispatch}
        setPathPoints={setPathPoints}
        openTracking={openTracking}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        angle={angle}
        setAngle={setAngle}
        playbackClock={playbackClock}
        goStage={goStage}
        viewport={viewport}
        setViewport={setViewport}
      />
    )}
    {mountedStage === "foundry" && (
      <MechanismFoundry
        project={project}
        foundry={foundry}
        setFoundry={setFoundry}
        onDraftChange={onFoundryDraftChange}
        selectedPart={selectedPart}
        selectedSceneObject={selectedSceneObject}
        selectedPath={selectedPath}
        playbackClock={playbackClock}
        goStage={goStage}
        onExport={onFoundryExport}
      />
    )}
    {mountedStage === "design" && (
      <MechanismDesign
        project={project}
        camera={workingCamera}
        onCameraChange={onWorkingCameraChange}
        selectedPart={selectedPart}
        selectedPath={selectedPath}
        selectedMechanism={selectedMechanism}
        updateMechanism={updateMechanism}
        dispatch={dispatch}
        showTrace={showTrace}
        setShowTrace={setShowTrace}
        isPlaying={isPlaying}
        angle={angle}
        playbackClock={playbackClock}
        onOptimize={onOptimize}
        onCancelOptimize={onCancelOptimize}
        onApplyRecommendation={onApplyRecommendation}
        optimizerBusy={optimizerBusy}
        exportSvg={exportSvg}
        exportDxf={exportDxf}
        onBlueprint={() => goStage("blueprint")}
        goStage={goStage}
      />
    )}
    {mountedStage === "blueprint" && (
      <BlueprintExport project={project} dispatch={dispatch} goStage={goStage} />
    )}
    {mountedStage === "assembly" && (
      <AssemblyGuide
        project={project}
        goStage={goStage}
        stepIndex={assemblyStepIndex}
        setStepIndex={setAssemblyStepIndex}
        stepProgress={assemblyStepProgress}
        setStepProgress={setAssemblyStepProgress}
        playing={assemblyPlaying}
        setPlaying={setAssemblyPlaying}
        setStepCount={setAssemblyStepCount}
        playbackClock={playbackClock}
      />
    )}
    {mountedStage === "options" && (
      <Options project={project} dispatch={dispatch} goStage={goStage} />
    )}
    </Suspense>
    {playerDock && (
      <div
        className="stage-player-row"
        data-testid="stage-player-row"
        aria-label="Shared playback controls"
      >
        {playerDock}
      </div>
    )}
  </div>;
};
