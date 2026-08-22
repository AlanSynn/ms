import { startTransition, useEffect, useMemo, useState } from "react";
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

const FoundryGalleryPreview = ({
  type,
  foundry,
  foundryPhase,
  previewResolution,
  project,
}: {
  type: MechanismType;
  foundry: MechanismConfig;
  foundryPhase: number;
  previewResolution: number;
  project: ProjectState;
}) => {
  const [ghostsReady, setGhostsReady] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => setGhostsReady(true), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);
  const preview = useMemo(() => {
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
    const phase = foundry.type === type ? foundryPhase : 0;
    return {
      mechanism,
      pathD: trace
        ? pointsToSvgPath(trace.points.map(context.map))
        : context.pathD,
      simulation: createFoundryPlaybackFrame(
        mechanism,
        phase,
        context,
      ).simulation,
      ghostSimulations: [Math.PI * 0.65, Math.PI * 1.3].map(
        (offset) =>
          createFoundryPlaybackFrame(
            mechanism,
            phase + offset,
            context,
          ).simulation,
      ),
    };
  }, [foundry, foundryPhase, previewResolution, type]);

  return (
    <svg
      viewBox="0 0 180 96"
      className="mechanism-choice-sim"
      data-testid={`foundry-mini-simulation-${type}`}
      aria-hidden="true"
    >
      <path
        d={preview.pathD}
        fill="none"
        stroke={foundry.color}
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.45"
      />
      {ghostsReady &&
        preview.ghostSimulations.map((simulation, index) => (
          <g
            key={index}
            opacity={index === 0 ? 0.22 : 0.14}
            className="mechanism-choice-ghost"
          >
            <MechanismLinkagePreview
              mechanism={preview.mechanism}
              simulation={simulation}
              kit={project.settings.physicalKit}
              testId={`foundry-mini-ghost-${type}-${index}`}
              compact
            />
          </g>
        ))}
      <MechanismLinkagePreview
        mechanism={preview.mechanism}
        simulation={preview.simulation}
        kit={project.settings.physicalKit}
        testId={`foundry-mini-linkage-${type}`}
        compact
      />
      <circle
        cx={preview.simulation.state.effector.x}
        cy={preview.simulation.state.effector.y}
        r="4"
        fill="#7c3aed"
        stroke="white"
        strokeWidth="1.5"
      />
    </svg>
  );
};

const FoundryMechanismGallery = ({
  project,
  foundry,
  foundryPhase,
  previewResolution,
  onSelectMechanismType,
}: {
  project: ProjectState;
  foundry: MechanismConfig;
  foundryPhase: number;
  previewResolution: number;
  onSelectMechanismType: (type: MechanismType) => void;
}) => {
  const [visiblePreviewCount, setVisiblePreviewCount] = useState(0);

  useEffect(() => {
    if (visiblePreviewCount >= ENABLED_FOUNDRY_MECHANISM_TYPES.length) return;
    const frame = requestAnimationFrame(() => {
      startTransition(() => {
        setVisiblePreviewCount((count) =>
          Math.min(count + 1, ENABLED_FOUNDRY_MECHANISM_TYPES.length),
        );
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [visiblePreviewCount]);

  return (
    <div
      className="mechanism-choice-grid"
      data-testid="foundry-mechanism-gallery"
      data-visible-previews={visiblePreviewCount}
    >
      {ENABLED_FOUNDRY_MECHANISM_TYPES.map((type, index) => {
        const item = MECHANISM_LIBRARY[type];
        return (
          <button
            key={type}
            type="button"
            className={`recommendation-card mechanism-choice ${foundry.type === type ? "active" : ""}`}
            onClick={() => onSelectMechanismType(type)}
          >
            {index < visiblePreviewCount ? (
              <FoundryGalleryPreview
                type={type}
                foundry={foundry}
                foundryPhase={foundryPhase}
                previewResolution={previewResolution}
                project={project}
              />
            ) : (
              <svg
                viewBox="0 0 180 96"
                className="mechanism-choice-sim"
                data-testid={`foundry-mini-placeholder-${type}`}
                aria-hidden="true"
              />
            )}
            <div className="font-bold text-slate-800">{item.label}</div>
            <div>{item.goodFor}</div>
          </button>
        );
      })}
    </div>
  );
};

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
          {fitBusy ? "Cancel" : "Fit path"}
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
        Use mechanism
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
      <FoundryMechanismGallery
        project={project}
        foundry={foundry}
        foundryPhase={foundryPhase}
        previewResolution={previewResolution}
        onSelectMechanismType={onSelectMechanismType}
      />
    </StageLeftSummary>
  </div>
  );
};
