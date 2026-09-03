import type { FabricationRecipe, ProjectState } from "../../../types";
import {
  fabricationBoardCoordinateCallout,
  fabricationPartDisplayLabel,
} from "../../../utils/fabrication";
import { referenceRecipeForType } from "../../../utils/mechanismReference";
import { MECHANISM_TEMPLATE_LIBRARY } from "../../../utils/mechanismTemplates";
import type { BuildPlanV1 } from "../../../utils/buildPlan";

export const BlueprintDetailPanel = ({
  project,
  recipes,
  selectedRecipe,
  buildPlan,
  packageReady,
}: {
  project: ProjectState;
  recipes: FabricationRecipe[];
  selectedRecipe: FabricationRecipe | undefined;
  buildPlan: BuildPlanV1;
  packageReady: boolean;
}) => {
  const selectedSensemaking = selectedRecipe
    ? MECHANISM_TEMPLATE_LIBRARY[selectedRecipe.type].classroomSensemaking
    : undefined;
  const recipeTitle = (recipe: FabricationRecipe) =>
    referenceRecipeForType(recipe.type).title;
  const boardLabel = selectedRecipe
    ? fabricationBoardCoordinateCallout(
        selectedRecipe.boardCoordinate,
        selectedRecipe.board,
      ).split(" · ")[0]
    : "";
  const requiredPartCount = selectedRecipe
    ? selectedRecipe.requiredParts.reduce((sum, part) => sum + part.quantity, 0)
    : 0;
  const selectedBuildMechanism = buildPlan.mechanisms.find(
    mechanism => mechanism.sourceMechanismId === selectedRecipe?.mechanismId,
  );
  const selectedMotions = selectedBuildMechanism
    ? buildPlan.motions.filter(motion => motion.mechanismRefs.includes(selectedBuildMechanism.ref))
    : [];

  return (
    <section
      className="stage-pane-stack"
      data-testid="blueprint-detail-preview"
    >
      <div>
        <div className="section-title">Build spot</div>
        <h3>{selectedRecipe ? recipeTitle(selectedRecipe) : "Board"}</h3>
      </div>
      {selectedRecipe ? (
        <article
          className="assembly-recipe-card"
          data-testid={`blueprint-recipe-${selectedRecipe.mechanismId}`}
        >
          <div className="font-bold text-slate-800">Board {boardLabel}</div>
          <div className="mt-1 text-sm text-slate-600">
            {selectedMotions.map(motion => `${motion.label} / ${motion.id}`).join(", ") || "No motion assigned"}
          </div>
          {selectedSensemaking && (
            <div
              className="sensemaking-cue mt-3"
              data-testid="blueprint-sensemaking-label"
              data-sensemaking-check={selectedSensemaking.studentCheck}
              data-sensemaking-answer={selectedSensemaking.expectedAnswer}
              data-sensemaking-evidence={selectedSensemaking.evidenceCue}
              data-sensemaking-clip={selectedSensemaking.clipSlot}
            >
              <span className="cue-title">Check</span>
              <strong>{selectedSensemaking.directTranslation}</strong>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedRecipe.requiredParts.slice(0, 4).map((part) => (
              <span
                className="blueprint-pill"
                key={`${selectedRecipe.mechanismId}-${part.name}`}
              >
                {fabricationPartDisplayLabel(part.name)} × {part.quantity}
              </span>
            ))}
            {selectedRecipe.requiredParts.length > 4 && (
              <span className="blueprint-pill">+{selectedRecipe.requiredParts.length - 4}</span>
            )}
          </div>
          <div
            className="mt-3 rounded-2xl bg-slate-100 p-3 text-sm font-bold text-slate-700"
            data-testid="blueprint-stack-summary"
          >
            {requiredPartCount} parts · Board {boardLabel}
          </div>
          {selectedBuildMechanism && (
            <div className="mt-3 text-xs font-bold text-slate-500" data-testid="blueprint-geometry-summary">
              12 x 12 in / 100% scale / {selectedBuildMechanism.geometry.points.length} pivots / {selectedBuildMechanism.geometry.signature}
            </div>
          )}
          {selectedRecipe.warnings.length ? (
            <div className="warning mt-3">
              Fix: {selectedRecipe.warnings.join("; ")}
            </div>
          ) : (
            <div className="ok mt-3">OK</div>
          )}
        </article>
      ) : (
        <div className="warning">Add a mechanism.</div>
      )}
      {packageReady && (
        <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 shadow-sm">
          Blueprint PDF ready · {recipes.length} mechanism
          {recipes.length === 1 ? "" : "s"}
        </div>
      )}
    </section>
  );
};
