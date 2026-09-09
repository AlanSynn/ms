import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type {
  BodyPartLayer,
  MechanismConfig,
  ProjectMotionPath,
  ProjectState,
} from "../../../types";
import { mechanismWithGeneratedPath, uid } from "../../../utils/project";
import type { MechanismRecommendation } from "../../../utils/mechanismRecommendations";
import { MECHANISM_TEMPLATE_LIBRARY } from "../../../utils/mechanismTemplates";
import { ContextHelp } from "../../ui/ContextHelp";
import {
  createMechanismRecommendationJobInput,
} from "../../../runtime/recommendations/mechanismRecommendationJob";
import type { MechanismRecommendationWorkerClient } from "../../../runtime/recommendations/mechanismRecommendationWorkerClient";
import {
  createMechanismFitContext,
  fitMechanismSimulationWithContext,
  pointsToSvgPath,
} from "../../../utils/mechanismPreview";
import { MechanismLinkagePreview } from "../foundry/MechanismLinkagePreview";
import { resolveRenderPerformancePolicy } from "../../../utils/renderPerformancePolicy";
import { sampleIndexedValues } from "../../../utils/interactiveSampling";
import { RecommendationMechanismSketch } from "./RecommendationMechanismSketch";

type MechanismRecommendationSheetProps = {
  isOpen: boolean;
  project: ProjectState;
  selectedPart?: BodyPartLayer;
  selectedPath?: ProjectMotionPath;
  onClose: () => void;
  onApply: (mechanism: MechanismConfig) => void;
  workerClient: MechanismRecommendationWorkerClient;
};

const RecommendationFitPreview = ({
  option,
  project,
  selectedPath,
}: {
  option: MechanismRecommendation;
  project: ProjectState;
  selectedPath?: ProjectMotionPath;
}) => {
  const renderPolicy = resolveRenderPerformancePolicy(
    project.settings.performancePreset,
  );
  const previewTraceSamples = renderPolicy.overlayQuality === "full"
    ? renderPolicy.interactiveDetail.mechanismTraceSamples
    : 12;
  const previewPathPoints = useMemo(
    () =>
      sampleIndexedValues(
        selectedPath?.points ?? [],
        renderPolicy.interactiveDetail.maxPathHandles,
      ).map(({ value }) => value),
    [renderPolicy.interactiveDetail.maxPathHandles, selectedPath?.points],
  );
  const context = useMemo(
    () =>
      createMechanismFitContext(
        option.mechanism,
        220,
        136,
        previewTraceSamples,
        previewPathPoints,
      ),
    [
      option.mechanism,
      previewTraceSamples,
      previewPathPoints,
    ],
  );
  const current = useMemo(
    () => fitMechanismSimulationWithContext(option.mechanism, 0, context),
    [context, option.mechanism],
  );
  const showGhostFrames = renderPolicy.overlayQuality === "full";
  const ghost = useMemo(
    () => {
      if (!showGhostFrames) return [];
      return [Math.PI * 0.65, Math.PI * 1.3].map((phase) =>
        fitMechanismSimulationWithContext(option.mechanism, phase, context),
      );
    },
    [context, option.mechanism, showGhostFrames],
  );
  const userPathD = useMemo(() => {
    if (previewPathPoints.length < 2) return "";
    return pointsToSvgPath(
      previewPathPoints.map((point) => context.map(point)),
    );
  }, [context, previewPathPoints]);

  return (
    <svg
      viewBox="0 0 220 136"
      className="recommendation-preview mt-3"
      aria-hidden="true"
      data-testid={`recommendation-fit-preview-${option.type}`}
      data-board-cells={project.settings.physicalKit.boardCells}
      data-user-path-preview={userPathD ? "shown" : "hidden"}
      data-mechanism-path-preview={current.pathD ? "shown" : "hidden"}
      data-ghost-preview={showGhostFrames ? "shown" : "hidden"}
      data-trace-samples={previewTraceSamples}
    >
      <text x="10" y="18" fill="#64748b" fontSize="10" fontWeight="900">
        {project.settings.physicalKit.boardCells}×
        {project.settings.physicalKit.boardCells} board
      </text>
      {userPathD && (
        <path
          d={userPathD}
          fill="none"
          stroke="#10b981"
          strokeWidth="3"
          strokeDasharray="7 6"
          strokeLinecap="round"
          opacity="0.85"
        />
      )}
      <path
        d={current.pathD}
        fill="none"
        stroke={option.mechanism.color}
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.65"
      />
      <g className="mechanism-choice-sim">
        {ghost.map((simulation, index) => (
          <g
            key={index}
            opacity={index === 0 ? 0.2 : 0.13}
            className="mechanism-choice-ghost"
          >
            <MechanismLinkagePreview
              mechanism={option.mechanism}
              simulation={simulation}
              kit={project.settings.physicalKit}
              testId={`recommendation-ghost-${option.type}-${index}`}
              compact
            />
          </g>
        ))}
        {showGhostFrames ? (
          <MechanismLinkagePreview
            mechanism={option.mechanism}
            simulation={current}
            kit={project.settings.physicalKit}
            testId={`recommendation-linkage-${option.type}`}
            compact
          />
        ) : (
          <RecommendationMechanismSketch
            mechanism={option.mechanism}
            simulation={current}
            testId={`recommendation-linkage-${option.type}`}
          />
        )}
      </g>
      <circle
        cx={current.state.effector.x}
        cy={current.state.effector.y}
        r="4"
        fill="#2563eb"
        stroke="white"
        strokeWidth="1.5"
      />
    </svg>
  );
};

type RecommendationLoadState = {
  requestFingerprint: string;
  status: "loading" | "ready" | "error";
  recommendations: MechanismRecommendation[];
  error?: string;
};

const OpenMechanismRecommendationSheet = ({
  isOpen,
  project,
  selectedPart,
  selectedPath,
  onClose,
  onApply,
  workerClient,
}: MechanismRecommendationSheetProps) => {
  const sheetRef = useRef<HTMLElement>(null);
  const input = useMemo(
    () =>
      createMechanismRecommendationJobInput(
        project,
        selectedPart,
        selectedPath?.id,
      ),
    [project, selectedPart, selectedPath?.id],
  );
  const [loadState, setLoadState] = useState<RecommendationLoadState>(() => ({
    requestFingerprint: input.requestFingerprint,
    status: "loading",
    recommendations: [],
  }));

  useEffect(() => {
    if (!isOpen) {
      if (sheetRef.current) {
        sheetRef.current.dataset.recommendationWorkerRequest = "idle";
      }
      workerClient.cancel();
      return;
    }
    setLoadState({
      requestFingerprint: input.requestFingerprint,
      status: "loading",
      recommendations: [],
    });
    let cancelled = false;
    let secondFrame = 0;
    let firstFrame = requestAnimationFrame(() => {
      firstFrame = 0;
      secondFrame = requestAnimationFrame(() => {
        secondFrame = 0;
        if (cancelled) return;
        if (sheetRef.current) {
          sheetRef.current.dataset.recommendationWorkerRequest = "active";
        }
        workerClient.request(input, {
          complete: (recommendations) => {
            if (sheetRef.current) {
              sheetRef.current.dataset.recommendationWorkerRequest = "settled";
            }
            startTransition(() => {
              setLoadState({
                requestFingerprint: input.requestFingerprint,
                status: "ready",
                recommendations,
              });
            });
          },
          failed: (error) => {
            if (sheetRef.current) {
              sheetRef.current.dataset.recommendationWorkerRequest = "settled";
            }
            setLoadState({
              requestFingerprint: input.requestFingerprint,
              status: "error",
              recommendations: [],
              error: error.message,
            });
          },
        });
      });
    });
    return () => {
      cancelled = true;
      if (firstFrame) cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
      if (sheetRef.current) {
        sheetRef.current.dataset.recommendationWorkerRequest = "cancelled";
      }
      workerClient.cancel();
    };
  }, [input, isOpen, workerClient]);

  const currentState =
    loadState.requestFingerprint === input.requestFingerprint
      ? loadState
      : {
          requestFingerprint: input.requestFingerprint,
          status: "loading" as const,
          recommendations: [],
        };
  const recommendations = currentState.recommendations;
  const [visibleRecommendationStep, setVisibleRecommendationStep] = useState(0);
  const visibleRecommendationCount = Math.min(
    visibleRecommendationStep,
    recommendations.length,
  );
  const visiblePreviewCount = Math.max(
    0,
    visibleRecommendationStep - recommendations.length,
  );
  const finalRecommendationStep = recommendations.length * 2;

  useEffect(() => {
    if (!isOpen || currentState.status !== "ready") {
      if (visibleRecommendationStep !== 0) setVisibleRecommendationStep(0);
      return;
    }
    if (visibleRecommendationStep >= finalRecommendationStep) return;
    const frame = requestAnimationFrame(() => {
      startTransition(() => {
        setVisibleRecommendationStep((step) =>
          Math.min(step + 1, finalRecommendationStep),
        );
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    currentState.status,
    finalRecommendationStep,
    isOpen,
    visibleRecommendationStep,
  ]);

  const apply = (option: MechanismRecommendation) => {
    onApply(
      mechanismWithGeneratedPath({
        ...option.mechanism,
        id: uid("mech"),
        presetId: `recommendation-${option.type}`,
        recommendation: `${option.reason} Recommendation score ${option.score}.`,
        warnings: option.mechanism.warnings,
      }),
    );
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      hidden={!isOpen}
      style={isOpen ? undefined : { display: "none" }}
    >
      <section
        ref={sheetRef}
        className="modal-sheet recommendation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommendation-dialog-title"
        data-testid="recommendation-sheet"
        data-recommendation-state={currentState.status}
        data-recommendation-worker-request="idle"
        data-visible-recommendations={visibleRecommendationCount}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="section-title">Recommendations</div>
            <h3 id="recommendation-dialog-title">Recommended mechanisms</h3>
          </div>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        {currentState.status === "loading" ? (
          <div
            className="recommendation-empty"
            data-testid="recommendation-loading"
          >
            Finding fits…
          </div>
        ) : currentState.status === "error" ? (
          <div
            className="recommendation-empty"
            data-testid="recommendation-error"
            title={currentState.error}
          >
            Recommendations unavailable.
          </div>
        ) : !recommendations.length ? (
          <div
            className="recommendation-empty"
            data-testid="recommendation-empty"
          >
            Draw more path.
          </div>
        ) : (
          <div className="recommendation-grid mt-5">
            {recommendations
              .slice(0, visibleRecommendationCount)
              .map((option, index) => (
                <article
                  key={option.type}
                  className="recommendation-card recommendation-option"
                  data-testid={`recommendation-card-${option.type}`}
                >
                  <div data-testid="recommendation-summary">
                    <div className="font-bold text-slate-800" data-testid="recommendation-name">
                      {option.label}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-600" data-testid="recommendation-motion">
                      {MECHANISM_TEMPLATE_LIBRARY[option.type].classroomSensemaking.directTranslation}
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-xs font-bold text-slate-500">
                      <span data-testid="recommendation-score">Recommendation score {option.score}</span>
                      <ContextHelp helpId="path.recommendationScore" />
                    </div>
                  </div>
                  {index < visiblePreviewCount ? (
                    <RecommendationFitPreview
                      option={option}
                      project={project}
                      selectedPath={selectedPath}
                    />
                  ) : (
                    <div
                      className="recommendation-preview mt-3"
                      aria-hidden="true"
                    />
                  )}
                  <p className="mt-3">{option.reason}</p>
                  <p
                    className={`mt-2 text-xs ${option.fabricationErrors.length ? "font-bold text-amber-700" : "text-slate-500"}`}
                  >
                    {option.feasibility}
                  </p>
                  <button
                    className="btn-primary mt-4"
                    disabled={!!option.fabricationErrors.length}
                    onClick={() => apply(option)}
                  >
                    Use
                  </button>
                </article>
              ))}
          </div>
        )}
      </section>
    </div>
  );
};

export const MechanismRecommendationSheet = (
  props: MechanismRecommendationSheetProps,
) => {
  if (!props.isOpen) return null;
  return <OpenMechanismRecommendationSheet {...props} />;
};
