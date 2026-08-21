import { EditorStageFrame, canvasPane, inspectorPane, workflowPane } from "../stageLayout";
import type {
  AppStage,
  BodyPartLayer,
  MechanismConfig,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
} from "../../../types";
import { DesignFoundryPreview } from "./DesignFoundryPreview";
import { DesignInspectorPanel } from "./DesignInspectorPanel";
import { DesignWorkflowPanel } from "./DesignWorkflowPanel";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";

export const MechanismDesign = ({
  project,
  selectedPart,
  selectedPath,
  selectedMechanism,
  updateMechanism,
  dispatch,
  showTrace,
  setShowTrace,
  isPlaying,
  angle,
  playbackClock,
  onOptimize,
  onCancelOptimize,
  onApplyRecommendation,
  optimizerBusy,
  exportSvg,
  exportDxf,
  onBlueprint,
  goStage,
}: {
  project: ProjectState;
  selectedPart?: BodyPartLayer;
  selectedPath?: ProjectMotionPath;
  selectedMechanism?: MechanismConfig;
  updateMechanism: (id: string, updates: Partial<MechanismConfig>) => void;
  dispatch: (action: ProjectAction) => void;
  showTrace: boolean;
  setShowTrace: (v: boolean) => void;
  isPlaying: boolean;
  angle: number;
  playbackClock: PlaybackClock;
  onOptimize: () => void;
  onCancelOptimize: () => void;
  onApplyRecommendation: (mechanism: MechanismConfig) => void;
  optimizerBusy: boolean;
  exportSvg: () => void;
  exportDxf: () => void;
  onBlueprint: () => void;
  goStage: (stage: AppStage) => void;
}) => (
  <EditorStageFrame
    stage="design"
    className="design-stage-frame"
    layout={{
      workflow: workflowPane(
        <DesignWorkflowPanel
          project={project}
          selectedPart={selectedPart}
          selectedPath={selectedPath}
          selectedMechanism={selectedMechanism}
          showTrace={showTrace}
          setShowTrace={setShowTrace}
          onApplyRecommendation={onApplyRecommendation}
          onBlueprint={onBlueprint}
          goStage={goStage}
          dispatch={dispatch}
        />,
      ),
      canvas: canvasPane(
        <DesignFoundryPreview
          project={project}
          mechanism={selectedMechanism}
          angle={angle}
          playbackClock={playbackClock}
          isPlaying={isPlaying}
          showTrace={showTrace}
          dispatch={dispatch}
        />,
      ),
      inspector: inspectorPane(
        <DesignInspectorPanel
          project={project}
          selectedMechanism={selectedMechanism}
          updateMechanism={updateMechanism}
          dispatch={dispatch}
          optimizerBusy={optimizerBusy}
          onOptimize={onOptimize}
          onCancelOptimize={onCancelOptimize}
          exportSvg={exportSvg}
          exportDxf={exportDxf}
          onBlueprint={onBlueprint}
        />,
      ),
    }}
  />
);
