import { useMemo } from "react";
import type {
  BodyPartLayer,
  MechanismConfig,
  ProjectMotionPath,
  ProjectState,
} from "../../../types";
import { mechanismWithGeneratedPath, uid } from "../../../utils/project";
import {
  buildMechanismRecommendations,
  type MechanismRecommendation,
} from "../../../utils/mechanismRecommendations";

type MechanismRecommendationSheetProps = {
  isOpen: boolean;
  project: ProjectState;
  selectedPart?: BodyPartLayer;
  selectedPath?: ProjectMotionPath;
  onClose: () => void;
  onApply: (mechanism: MechanismConfig) => void;
};

export const MechanismRecommendationSheet = ({
  isOpen,
  project,
  selectedPart,
  selectedPath,
  onClose,
  onApply,
}: MechanismRecommendationSheetProps) => {
  const recommendations = useMemo(
    () => buildMechanismRecommendations(project, selectedPart, selectedPath),
    [project, selectedPart, selectedPath],
  );

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

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal-sheet recommendation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommendation-dialog-title"
        data-testid="recommendation-sheet"
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
        {!recommendations.length ? (
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
                <svg
                  viewBox="0 0 220 120"
                  className="recommendation-preview mt-3"
                  aria-hidden="true"
                >
                  <path
                    d={option.previewPath}
                    fill="none"
                    stroke={option.mechanism.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
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
