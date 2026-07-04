import { Boxes } from "lucide-react";
import type {
  AppStage,
  BodyPartLayer,
  MechanismConfig,
  MechanismType,
  ProjectMotionPath,
  ProjectState,
} from "../../../types";
import { fabricationStackSummary } from "../../../utils/fabrication";
import {
  FOUNDRY_MECHANISM_TYPES,
  FOUNDRY_PRESETS,
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
} from "../../../utils/mechanismTemplates";
import { fitMechanismSimulation } from "../../../utils/mechanismPreview";
import { createDefaultMechanism } from "../../../utils/project";
import { StageLeftSummary } from "../stageLayout";
import { MechanismLinkagePreview } from "./MechanismLinkagePreview";

type FoundrySensemaking =
  (typeof MECHANISM_LIBRARY)[MechanismType]["classroomSensemaking"];

export const FoundryWorkflowPanel = ({
  project,
  selectedPart,
  selectedPath,
  goStage,
  foundry,
  foundryPhase,
  landingBoardLabel,
  targetChainRootJointId,
  targetIkJointId,
  snapDistance,
  rangePercentValid,
  rangeWarning,
  feasibilityText,
  targetReady,
  isPickingAnchor,
  hasManualAnchor,
  hardBlocked,
  showSensemaking,
  classroomSensemaking,
  physicsRule,
  libraryLabel,
  onToggleAnchorPick,
  onUseMechanism,
  onSelectMechanismType,
}: {
  project: ProjectState;
  selectedPart?: BodyPartLayer;
  selectedPath?: ProjectMotionPath;
  goStage: (stage: AppStage) => void;
  foundry: MechanismConfig;
  foundryPhase: number;
  landingBoardLabel: string;
  targetChainRootJointId?: string;
  targetIkJointId?: string;
  snapDistance: number;
  rangePercentValid: number;
  rangeWarning?: string | null;
  feasibilityText: string;
  targetReady: boolean;
  isPickingAnchor: boolean;
  hasManualAnchor: boolean;
  hardBlocked: boolean;
  showSensemaking: boolean;
  classroomSensemaking: FoundrySensemaking;
  physicsRule: string;
  libraryLabel: string;
  onToggleAnchorPick: () => void;
  onUseMechanism: () => void;
  onSelectMechanismType: (type: MechanismType) => void;
}) => (
  <div className="stage-pane-stack">
    <StageLeftSummary
      project={project}
      title="Foundry"
      stage="foundry"
      goStage={goStage}
    >
      <div
        className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600"
        data-testid="foundry-target-summary"
      >
        <div className="font-bold text-slate-800">
          Target {selectedPart?.name ?? "none"} ·{" "}
          {selectedPath?.points.length ?? 0} pts
        </div>
        <div>
          Board hole {landingBoardLabel} · chain{" "}
          {targetChainRootJointId ?? "none"} → {targetIkJointId ?? "none"}
        </div>
        {snapDistance > 0.5 && (
          <div>
            Snap {snapDistance.toFixed(0)} → {landingBoardLabel}
          </div>
        )}
        <div>
          <strong>Range</strong>{" "}
          {rangePercentValid === 1 ? "360°" : feasibilityText}
        </div>
        <div data-testid="foundry-feasibility">
          <strong>Status</strong> {feasibilityText}
        </div>
        <div data-testid="foundry-anchor-status">
          {isPickingAnchor
            ? "Pick board hole."
            : hasManualAnchor
              ? "Anchor picked."
              : (foundry.recommendation ??
                FOUNDRY_PRESETS.balanced.recommendation)}
        </div>
      </div>
      <button
        type="button"
        data-testid="foundry-pick-anchor"
        className={`btn-secondary w-full ${isPickingAnchor ? "active" : ""}`}
        onClick={onToggleAnchorPick}
      >
        {isPickingAnchor ? "Cancel anchor pick" : "Pick anchor on canvas"}
      </button>
      <button
        className="btn-primary w-full"
        aria-label="Use mechanism"
        disabled={hardBlocked}
        onClick={onUseMechanism}
      >
        <Boxes size={16} /> Use mechanism
      </button>
      {!targetReady && <div className="warning">Need 3+ points.</div>}
      {rangeWarning && <div className="warning">{rangeWarning}</div>}
      <div
        className="sensemaking-cue"
        data-testid="foundry-visible-sensemaking"
        data-sensemaking-check={classroomSensemaking.studentCheck}
        data-sensemaking-answer={classroomSensemaking.expectedAnswer}
        data-sensemaking-evidence={classroomSensemaking.evidenceCue}
        data-sensemaking-clip={classroomSensemaking.clipSlot}
      >
        <span className="cue-title">Why it moves</span>
        <strong>{classroomSensemaking.directTranslation}</strong>
        <small>{classroomSensemaking.tryThis}</small>
      </div>
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
            ...createDefaultMechanism(type, `foundry-card-${type}`),
            color: foundry.color,
          };
          const cardSimulation = fitMechanismSimulation(
            cardMechanism,
            foundryPhase,
            180,
            96,
            48,
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
              </svg>
              <div className="font-bold text-slate-800">{item.label}</div>
              <div>{item.goodFor}</div>
              <small>{item.classroomSensemaking.directTranslation}</small>
            </button>
          );
        })}
      </div>
      {showSensemaking && (
        <div
          className="recommendation-card"
          data-testid="foundry-mechanism-library"
        >
          <div className="font-bold text-slate-800">{libraryLabel}</div>
          <div className="flex flex-wrap gap-2">
            <span className="blueprint-pill">{physicsRule}</span>
            <span className="blueprint-pill">
              {fabricationStackSummary(foundry)}
            </span>
            <span className="blueprint-pill">{feasibilityText}</span>
            <span className="blueprint-pill">
              {classroomSensemaking.studentCheck}
            </span>
            <span className="blueprint-pill">
              {classroomSensemaking.evidenceCue}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {classroomSensemaking.teacherTakeaway}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {classroomSensemaking.commonHint}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Answer: {classroomSensemaking.expectedAnswer}
          </p>
        </div>
      )}
    </StageLeftSummary>
  </div>
);
