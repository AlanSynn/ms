import { Boxes, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { ContextHelp } from "../../ui/ContextHelp";
import type {
  AppStage,
  MechanismConfig,
  MechanismType,
  ProjectState,
} from "../../../types";
import {
  ENABLED_FOUNDRY_MECHANISM_TYPES,
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
import { resolveRenderPerformancePolicy } from "../../../utils/renderPerformancePolicy";

type MechanismPathFitState = NonNullable<
  NonNullable<MechanismConfig["fabricationMetadata"]>["pathFit"]
>["status"];

export const FoundryWorkflowPanel = ({
  project,
  goStage,
  foundry,
  foundryPhase,
  targetReady,
  fitRequired,
  fitState,
  fitBusy = false,
  fitJobError = false,
  isPickingAnchor,
  hardBlocked,
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
  fitRequired?: boolean;
  fitState?: MechanismPathFitState;
  fitError?: number;
  fitMaxError?: number;
  fitBusy?: boolean;
  fitJobError?: boolean;
  isPickingAnchor: boolean;
  hardBlocked: boolean;
  onToggleAnchorPick: () => void;
  onFitPath: () => void;
  onUseMechanism: () => void;
  onSelectMechanismType: (type: MechanismType) => void;
}) => {
  const previewResolution = resolveRenderPerformancePolicy(
    project.settings.performancePreset,
  ).interactiveDetail.mechanismTraceSamples;
  const galleryCards = useMemo(
    () => ENABLED_FOUNDRY_MECHANISM_TYPES.map((type) => {
      const mechanism = {
        ...(foundry.type === type
          ? foundry
          : createDefaultMechanism(type, `foundry-card-${type}`)),
        id: `foundry-card-${type}`,
        color: foundry.color,
      };
      const context = createMechanismFitContext(
        mechanism,
        180,
        96,
        previewResolution,
      );
      const traces = generateFoundryPlaybackPointTraces(
        mechanism,
        previewResolution,
      ).traces;
      const trace = traces.find((candidate) => candidate.primary) ?? traces[0];
      return {
        type,
        mechanism,
        context,
        pathD: trace
          ? pointsToSvgPath(trace.points.map(context.map))
          : context.pathD,
      };
    }),
    [foundry, previewResolution],
  );
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
          aria-busy={fitBusy}
          onClick={onFitPath}
        >
          <Sparkles size={16} /> {fitBusy ? "Cancel" : "Fit path"}
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
      {fitJobError && <div className="warning">Fit failed. Try again.</div>}
      {fitRequired && targetReady && (!fitState || fitState === "unfitted") && (
        <div className="warning">Fit path first.</div>
      )}
      {fitRequired && (fitState === "closest" || fitState === "rejected") && (
        <div className="warning">
          No valid fabrication fit. Try a shorter path or another mechanism.
        </div>
      )}
      <h4 className="section-title mt-4">Templates</h4>
      <div
        className="mechanism-choice-grid"
        data-testid="foundry-mechanism-gallery"
      >
        {galleryCards.map(({ type, mechanism: cardMechanism, context: cardContext, pathD: cardPathD }) => {
          const item = MECHANISM_LIBRARY[type];
          const previewPhase = foundry.type === type ? foundryPhase : 0;
          const cardSimulation = createFoundryPlaybackFrame(
            cardMechanism,
            previewPhase,
            cardContext,
          ).simulation;
          const ghostSimulations = [Math.PI * 0.65, Math.PI * 1.3].map(
            (offset) =>
              createFoundryPlaybackFrame(
                cardMechanism,
                previewPhase + offset,
                cardContext,
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
