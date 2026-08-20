import type { Dispatch, ReactNode, SetStateAction } from "react";

import { AssemblyGuide } from "./stages/assembly/AssemblyGuide";
import { BlueprintExport } from "./stages/blueprint/BlueprintExport";
import { CharacterSelection } from "./stages/character/CharacterSelection";
import { MechanismFoundry } from "./stages/foundry/MechanismFoundry";
import { MechanismDesign } from "./stages/mechanism/MechanismDesign";
import { Options } from "./stages/options/Options";
import { PathEditor } from "./stages/path/PathEditor";
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
import type { CharacterImportProgressStore } from "../runtime/ai/characterImportProgressStore";

export type AppStageRouterProps = {
  editorStage: AppStage;
  project: ProjectState;
  dispatch: (action: ProjectAction) => void;
  goStage: (stage: AppStage) => void;
  playerDock: ReactNode;
  playbackClock: PlaybackClock;

  characterImportProgress: CharacterImportProgressStore;
  onOpenGettingStarted: () => void;
  onAcceptPendingCharacter: () => void;
  onDiscardPendingCharacter: () => void;
  onProcessCharacter: (file: File) => void | Promise<void>;
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
  onFoundryDraftChange: (mechanism: MechanismConfig) => void;
  onFoundryExport: (pkg: FoundryExportPackage) => void;

  selectedMechanism?: MechanismConfig;
  updateMechanism: (id: string, updates: Partial<MechanismConfig>) => void;
  showTrace: boolean;
  setShowTrace: (v: boolean) => void;
  onOptimize: () => void | Promise<void>;
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
};

export const AppStageRouter = ({
  editorStage,
  project,
  dispatch,
  goStage,
  playerDock,
  playbackClock,
  characterImportProgress,
  onOpenGettingStarted,
  onAcceptPendingCharacter,
  onDiscardPendingCharacter,
  onProcessCharacter,
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
}: AppStageRouterProps) => (
  <div
    className="stage-body editor-workbench relative min-h-0 flex-1 overflow-hidden p-7"
    data-testid="shared-workbench"
  >
    {editorStage === "character" && (
      <CharacterSelection
        project={project}
        dispatch={dispatch}
        characterImportProgress={characterImportProgress}
        onOpenGettingStarted={onOpenGettingStarted}
        onAccept={onAcceptPendingCharacter}
        onDiscard={onDiscardPendingCharacter}
        onProcess={onProcessCharacter}
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
    {editorStage === "path" && (
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
    {editorStage === "foundry" && (
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
    {editorStage === "design" && (
      <MechanismDesign
        project={project}
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
        onApplyRecommendation={onApplyRecommendation}
        optimizerBusy={optimizerBusy}
        exportSvg={exportSvg}
        exportDxf={exportDxf}
        onBlueprint={() => goStage("blueprint")}
        goStage={goStage}
      />
    )}
    {editorStage === "blueprint" && (
      <BlueprintExport project={project} dispatch={dispatch} goStage={goStage} />
    )}
    {editorStage === "assembly" && (
      <AssemblyGuide
        project={project}
        dispatch={dispatch}
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
    {editorStage === "options" && (
      <Options project={project} dispatch={dispatch} goStage={goStage} />
    )}
    {playerDock && (
      <div
        className="stage-player-row"
        data-testid="stage-player-row"
        aria-label="Shared playback controls"
      >
        {playerDock}
      </div>
    )}
  </div>
);
