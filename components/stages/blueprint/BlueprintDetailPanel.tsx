import type { FabricationRecipe, ProjectState } from "../../../types";
import type { MechanismSceneContract } from "../../../utils/mechanismSceneContract";
import {
  fabricationBoardCoordinateCallout,
  fabricationPartDisplayLabel,
  fabricationRecipeSensemakingType,
  fabricationRecipeTitle,
} from "../../../utils/fabrication";
import { MECHANISM_TEMPLATE_LIBRARY } from "../../../utils/mechanismTemplates";

export const BlueprintDetailPanel = ({
  project,
  recipes,
  selectedRecipe,
  selectedMechanismContract,
}: {
  project: ProjectState;
  recipes: FabricationRecipe[];
  selectedRecipe: FabricationRecipe | undefined;
  selectedMechanismContract?: MechanismSceneContract;
}) => {
  const selectedSensemakingType = selectedRecipe
    ? fabricationRecipeSensemakingType(selectedRecipe)
    : undefined;
  const selectedSensemaking = selectedSensemakingType
    ? MECHANISM_TEMPLATE_LIBRARY[selectedSensemakingType].classroomSensemaking
    : undefined;
  const recipeTitle = (recipe: FabricationRecipe) => fabricationRecipeTitle(recipe);
  const boardCallout = selectedRecipe
    ? fabricationBoardCoordinateCallout(
        selectedRecipe.boardCoordinate,
        selectedRecipe.board,
      )
    : "";
  const [boardLabel, ...boardDetails] = boardCallout.split(" · ");
  const boardPosition = boardDetails.length
    ? `${boardLabel} · ${boardDetails.join(" · ")}`
    : boardLabel;
  const requiredPartCount = selectedRecipe
    ? selectedRecipe.requiredParts.reduce((sum, part) => sum + part.quantity, 0)
    : 0;

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
          data-mechanism-scene-contract-version={selectedMechanismContract?.version ?? ""}
          data-mechanism-graph-ir-version={selectedMechanismContract?.graphCompiler.irVersion ?? ""}
          data-mechanism-graph-id={selectedMechanismContract?.graphCompiler.graphId ?? ""}
          data-mechanism-graph-diagnostics={selectedMechanismContract?.graphCompiler.diagnosticCount ?? 0}
        >
          <div className="font-bold text-slate-800">Build at {boardLabel}</div>
          <ol
            aria-label="Build spot steps"
            className="mt-2 grid gap-2 text-sm text-slate-600"
          >
            <li>1. Find {boardPosition} on the board.</li>
            <li>2. Cut the parts below.</li>
            <li>3. Build, then test.</li>
          </ol>
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
          <div className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            Parts to cut
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
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
            {requiredPartCount} parts total · Board {boardLabel}
          </div>
          {selectedRecipe.warnings.length ? (
            <div className="warning mt-3">
              Fix: {selectedRecipe.warnings.join("; ")}
            </div>
          ) : (
            <div className="ok mt-3">Ready</div>
          )}
        </article>
      ) : (
        <div className="warning">Add a mechanism.</div>
      )}
      {project.lastExport && (
        <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 shadow-sm">
          Build sheet ready · {recipes.length} recipe
          {recipes.length === 1 ? "" : "s"}
        </div>
      )}
    </section>
  );
};
