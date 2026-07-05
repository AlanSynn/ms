import { Boxes } from "lucide-react";
import type {
  AppStage,
  MechanismConfig,
  MechanismType,
  ProjectState,
} from "../../../types";
import { fabricationStackSummary } from "../../../utils/fabrication";
import {
  FOUNDRY_MECHANISM_TYPES,
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
} from "../../../utils/mechanismTemplates";
import {
  createMechanismFitContext,
  fitMechanismSimulationWithContext,
} from "../../../utils/mechanismPreview";
import { createDefaultMechanism } from "../../../utils/project";
import { StageLeftSummary } from "../stageLayout";
import { MechanismLinkagePreview } from "./MechanismLinkagePreview";

export const FoundryWorkflowPanel = ({
  project,
  goStage,
  foundry,
  foundryPhase,
  rangeWarning,
  targetReady,
  isPickingAnchor,
  hardBlocked,
  onToggleAnchorPick,
  onUseMechanism,
  onSelectMechanismType,
}: {
  project: ProjectState;
  goStage: (stage: AppStage) => void;
  foundry: MechanismConfig;
  foundryPhase: number;
  rangeWarning?: string | null;
  targetReady: boolean;
  isPickingAnchor: boolean;
  hardBlocked: boolean;
  onToggleAnchorPick: () => void;
  onUseMechanism: () => void;
  onSelectMechanismType: (type: MechanismType) => void;
}) => {
  const motionWarning = rangeWarning
    ? rangeWarning.startsWith("No motion")
      ? "No full motion. Try reset or smaller links."
      : "Motion may jam. Try a smaller move."
    : null;

  return (
  <div className="stage-pane-stack">
    <StageLeftSummary
      project={project}
      title="Foundry"
      stage="foundry"
      goStage={goStage}
    >
      <button
        type="button"
        data-testid="foundry-pick-anchor"
        className={`btn-secondary w-full ${isPickingAnchor ? "active" : ""}`}
        onClick={onToggleAnchorPick}
      >
        {isPickingAnchor ? "Cancel pick" : "Pick anchor"}
      </button>
      <button
        className="btn-primary w-full"
        aria-label="Use mechanism"
        disabled={hardBlocked}
        onClick={onUseMechanism}
      >
        <Boxes size={16} /> Use mechanism
      </button>
      {!targetReady && <div className="warning">Draw a path first.</div>}
      {motionWarning && <div className="warning">{motionWarning}</div>}
      <div
        className="compact-fabrication-stack"
        data-testid="foundry-fabrication-stack"
      >
        <strong>Stack</strong>
        <span>{fabricationStackSummary(foundry)}</span>
      </div>
      <h4 className="section-title mt-4">Templates</h4>
      <div
        className="mechanism-choice-grid"
        data-testid="foundry-mechanism-gallery"
      >
        {FOUNDRY_MECHANISM_TYPES.map((type) => {
          const item = MECHANISM_LIBRARY[type];
          const cardMechanism = {
            ...(foundry.type === type
              ? foundry
              : createDefaultMechanism(type, `foundry-card-${type}`)),
            id: `foundry-card-${type}`,
            color: foundry.color,
          };
          const cardContext = createMechanismFitContext(
            cardMechanism,
            180,
            96,
            96,
          );
          const cardSimulation = fitMechanismSimulationWithContext(
            cardMechanism,
            foundryPhase,
            cardContext,
          );
          return (
            <button
              key={type}
              type="button"
              className={`recommendation-card mechanism-choice ${foundry.type === type ? "active" : ""}`}
              onClick={() => onSelectMechanismType(type)}
            >
              <svg
                viewBox="0 0 180 96"
                className="mechanism-choice-sim"
                data-testid={`foundry-mini-simulation-${type}`}
                aria-hidden="true"
              >
                <path
                  d={cardSimulation.pathD}
                  fill="none"
                  stroke={foundry.color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  opacity="0.45"
                />
                <MechanismLinkagePreview
                  mechanism={cardMechanism}
                  simulation={cardSimulation}
                  kit={project.settings.physicalKit}
                  testId={`foundry-mini-linkage-${type}`}
                  compact
                />
                <circle
                  cx={cardSimulation.state.effector.x}
                  cy={cardSimulation.state.effector.y}
                  r="4"
                  fill="#7c3aed"
                  stroke="white"
                  strokeWidth="1.5"
                />
              </svg>
              <div className="font-bold text-slate-800">{item.label}</div>
              <div>{item.goodFor}</div>
            </button>
          );
        })}
      </div>
    </StageLeftSummary>
  </div>
  );
};
