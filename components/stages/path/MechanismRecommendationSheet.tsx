import { useEffect, useMemo, useState } from "react";
import type {
  BodyPartLayer,
  MechanismConfig,
  ProjectMotionPath,
  ProjectState,
} from "../../../types";
import { mechanismWithGeneratedPath, uid } from "../../../utils/project";
import type { MechanismRecommendation } from "../../../utils/mechanismRecommendations";
import {
  createMechanismRecommendationJobInput,
} from "../../../runtime/recommendations/mechanismRecommendationJob";
import { createMechanismRecommendationWorkerClient } from "../../../runtime/recommendations/mechanismRecommendationWorkerClient";
import {
  createMechanismFitContext,
  fitMechanismSimulationWithContext,
  pointsToSvgPath,
} from "../../../utils/mechanismPreview";
import { MechanismLinkagePreview } from "../foundry/MechanismLinkagePreview";

type MechanismRecommendationSheetProps = {
  isOpen: boolean;
  project: ProjectState;
  selectedPart?: BodyPartLayer;
  selectedPath?: ProjectMotionPath;
  onClose: () => void;
  onApply: (mechanism: MechanismConfig) => void;
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
  const context = useMemo(
    () =>
      createMechanismFitContext(
        option.mechanism,
        220,
        136,
        96,
        selectedPath?.points ?? [],
      ),
    [option.mechanism, selectedPath?.points],
  );
  const current = useMemo(
    () => fitMechanismSimulationWithContext(option.mechanism, 0, context),
    [context, option.mechanism],
  );
  const ghost = useMemo(
    () =>
      [Math.PI * 0.65, Math.PI * 1.3].map((phase) =>
        fitMechanismSimulationWithContext(option.mechanism, phase, context),
      ),
    [context, option.mechanism],
  );
  const userPathD = useMemo(() => {
    if (!selectedPath || selectedPath.points.length < 2) return "";
    return pointsToSvgPath(selectedPath.points.map(context.map));
  }, [context, selectedPath]);

  return (
    <svg
      viewBox="0 0 220 136"
      className="recommendation-preview mt-3"
      aria-hidden="true"
      data-testid={`recommendation-fit-preview-${option.type}`}
      data-board-cells={project.settings.physicalKit.boardCells}
      data-user-path-preview={userPathD ? "shown" : "hidden"}
      data-mechanism-path-preview={current.pathD ? "shown" : "hidden"}
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
        <MechanismLinkagePreview
          mechanism={option.mechanism}
          simulation={current}
          kit={project.settings.physicalKit}
          testId={`recommendation-linkage-${option.type}`}
          compact
        />
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
  inputFingerprint: string;
  status: "loading" | "ready" | "error";
  recommendations: MechanismRecommendation[];
  error?: string;
};

const OpenMechanismRecommendationSheet = ({
  project,
  selectedPart,
  selectedPath,
  onClose,
  onApply,
}: Omit<MechanismRecommendationSheetProps, "isOpen">) => {
  const input = useMemo(
    () =>
      createMechanismRecommendationJobInput(
        project,
        selectedPart,
        selectedPath?.id,
      ),
    [project, selectedPart, selectedPath?.id],
  );
  const workerClient = useMemo(
    () => createMechanismRecommendationWorkerClient(),
    [],
  );
  const [loadState, setLoadState] = useState<RecommendationLoadState>(() => ({
    inputFingerprint: input.inputFingerprint,
    status: "loading",
    recommendations: [],
  }));

  useEffect(() => {
    setLoadState({
      inputFingerprint: input.inputFingerprint,
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
        workerClient.request(input, {
          complete: (recommendations) =>
            setLoadState({
              inputFingerprint: input.inputFingerprint,
              status: "ready",
              recommendations,
            }),
          failed: (error) =>
            setLoadState({
              inputFingerprint: input.inputFingerprint,
              status: "error",
              recommendations: [],
              error: error.message,
            }),
        });
      });
    });
    return () => {
      cancelled = true;
      if (firstFrame) cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
      workerClient.cancel();
    };
  }, [input, workerClient]);

  useEffect(() => () => workerClient.dispose(), [workerClient]);

  const currentState =
    loadState.inputFingerprint === input.inputFingerprint
      ? loadState
      : {
          inputFingerprint: input.inputFingerprint,
          status: "loading" as const,
          recommendations: [],
        };
  const recommendations = currentState.recommendations;

  const apply = (option: MechanismRecommendation) => {
    onApply(
      mechanismWithGeneratedPath({
        ...option.mechanism,
        id: uid("mech"),
        presetId: `recommendation-${option.type}`,
        recommendation: `${option.reason} Score ${option.score}/100.`,
        warnings: option.mechanism.warnings,
      }),
    );
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal-sheet recommendation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommendation-dialog-title"
        data-testid="recommendation-sheet"
        data-recommendation-state={currentState.status}
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
            {recommendations.map((option) => (
              <article
                key={option.type}
                className="recommendation-card recommendation-option"
                data-testid={`recommendation-card-${option.type}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-800">
                      {option.label}
                    </div>
                    <div className="text-xs font-black uppercase tracking-wider text-slate-500">
                      Fit score {option.score}/100
                    </div>
                  </div>
                  <span className="recommendation-score">{option.score}</span>
                </div>
                <RecommendationFitPreview
                  option={option}
                  project={project}
                  selectedPath={selectedPath}
                />
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

export const MechanismRecommendationSheet = ({
  isOpen,
  ...openProps
}: MechanismRecommendationSheetProps) => {
  if (!isOpen) return null;
  return <OpenMechanismRecommendationSheet {...openProps} />;
};
