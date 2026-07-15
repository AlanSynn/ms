import { EditorStageFrame, canvasPane, inspectorPane, workflowPane } from "../stageLayout";
import type { AppStage, MechanismConfig, MechanismEditFeedback, ProjectAction, ProjectState } from "../../../types";
import { DesignFoundryPreview } from "./DesignFoundryPreview";
import { DesignInspectorPanel } from "./DesignInspectorPanel";
import { DesignWorkflowPanel } from "./DesignWorkflowPanel";

export const MechanismDesign = ({
  project,
  selectedMechanism,
  updateMechanism,
  mechanismEditFeedback,
  dispatch,
  showTrace,
  setShowTrace,
  angle,
  setIsPlaying,
  onOptimize,
  onRecommendations,
  optimizerBusy,
  exportSvg,
  exportDxf,
  onBlueprint,
  goStage,
}: {
  project: ProjectState;
  selectedMechanism?: MechanismConfig;
  updateMechanism: (id: string, updates: Partial<MechanismConfig>) => void;
  mechanismEditFeedback: MechanismEditFeedback | null;
  dispatch: (action: ProjectAction) => void;
  showTrace: boolean;
  setShowTrace: (v: boolean) => void;
  angle: number;
  setIsPlaying: (v: boolean) => void;
  onOptimize: () => void;
  onRecommendations: () => void;
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
          selectedMechanism={selectedMechanism}
          showTrace={showTrace}
          setShowTrace={setShowTrace}
          onRecommendations={onRecommendations}
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
          setIsPlaying={setIsPlaying}
          showTrace={showTrace}
          dispatch={dispatch}
          updateMechanism={updateMechanism}
          mechanismEditFeedback={mechanismEditFeedback}
        />,
      ),
      inspector: inspectorPane(
        <DesignInspectorPanel
          project={project}
          selectedMechanism={selectedMechanism}
          updateMechanism={updateMechanism}
          mechanismEditFeedback={mechanismEditFeedback}
          dispatch={dispatch}
          optimizerBusy={optimizerBusy}
          onOptimize={onOptimize}
          exportSvg={exportSvg}
          exportDxf={exportDxf}
          onBlueprint={onBlueprint}
        />,
      ),
    }}
  />
);
