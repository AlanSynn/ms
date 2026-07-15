import { Boxes, Sparkles } from "lucide-react";
import { ContextHelp } from "../../ui/ContextHelp";
import type {
  AppStage,
  MechanismConfig,
  MechanismType,
  ProjectState,
} from "../../../types";
import {
  FOUNDRY_MECHANISM_TYPES,
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
} from "../../../utils/mechanismTemplates";
import {
  createFoundryPlaybackFrame,
  generateFoundryPlaybackPointTraces,
} from "../../../utils/foundryPlayback";
import {
  createMechanismFitContext,
  pointsToSvgPath,
} from "../../../utils/mechanismPreview";
import { createDefaultMechanism } from "../../../utils/project";
import { StageLeftSummary } from "../stageLayout";
import { MechanismLinkagePreview } from "./MechanismLinkagePreview";

export const FoundryWorkflowPanel = ({
  project,
  goStage,
  foundry,
  foundryPhase,
  targetReady,
  isPickingAnchor,
  hardBlocked,
  transactionBlocker,
  onToggleAnchorPick,
  onFitPath,
  onUseMechanism,
  onSelectMechanismType,
}: {
  project: ProjectState;
  goStage: (stage: AppStage) => void;
  foundry: MechanismConfig;
  foundryPhase: number;
  targetReady: boolean;
  isPickingAnchor: boolean;
  hardBlocked: boolean;
  transactionBlocker?: string;
  onToggleAnchorPick: () => void;
  onFitPath: () => void;
  onUseMechanism: () => void;
  onSelectMechanismType: (type: MechanismType) => void;
}) => {
  return (
  <div className="stage-pane-stack">
    <StageLeftSummary
      project={project}
      title="Foundry"
      stage="foundry"
      goStage={goStage}
    >
      <div className="flex items-center gap-2" data-testid="foundry-fit-path-row">
        <button
          type="button"
          data-testid="foundry-fit-path"
          className="btn-primary flex-1"
          disabled={!targetReady}
          onClick={onFitPath}
        >
          <Sparkles size={16} /> Fit path
        </button>
        <ContextHelp helpId="foundry.fitPath" />
      </div>
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
      {targetReady && transactionBlocker && (
        <div className="warning">
          {/^Fix:/i.test(transactionBlocker)
            ? transactionBlocker
            : `Fix: ${transactionBlocker}`}
        </div>
      )}
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
            [],
            project.settings.physicalKit,
          );
          const cardSimulation = createFoundryPlaybackFrame(
            cardMechanism,
            foundryPhase,
            cardContext,
            project.settings.physicalKit,
          ).simulation;
          const cardPlaybackTraces = generateFoundryPlaybackPointTraces(
            cardMechanism,
            96,
            project.settings.physicalKit,
          ).traces;
          const cardPlaybackTrace =
            cardPlaybackTraces.find((trace) => trace.primary) ??
            cardPlaybackTraces[0];
          const cardPathD = cardPlaybackTrace
            ? pointsToSvgPath(cardPlaybackTrace.points.map(cardContext.map))
            : cardSimulation.pathD;
          const ghostSimulations = [Math.PI * 0.65, Math.PI * 1.3].map(
            (offset) =>
              createFoundryPlaybackFrame(
                cardMechanism,
                foundryPhase + offset,
                cardContext,
                project.settings.physicalKit,
              ).simulation,
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
                  d={cardPathD}
                  fill="none"
                  stroke={foundry.color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  opacity="0.45"
                />
                {ghostSimulations.map((simulation, index) => (
                  <g
                    key={index}
                    opacity={index === 0 ? 0.22 : 0.14}
                    className="mechanism-choice-ghost"
                  >
                    <MechanismLinkagePreview
                      mechanism={cardMechanism}
                      simulation={simulation}
                      kit={project.settings.physicalKit}
                      testId={`foundry-mini-ghost-${type}-${index}`}
                      compact
                    />
                  </g>
                ))}
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
