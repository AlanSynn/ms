import React, { useState } from "react";
import type { AppStage, ProjectAction, ProjectState } from "../../../types";
import { pendingRecipeForMechanism } from "../../../utils/assemblyPlayback";
import {
  createFabricationPackage,
  fabricationBoardCoordinateCallout,
  fabricationPartDisplayLabel,
  makeBlueprintPreviewSvg,
  readableFabricationStackSummary,
  validateForFabrication,
} from "../../../utils/fabrication";
import { referenceRecipeForType } from "../../../utils/mechanismReference";
import { MECHANISM_TEMPLATE_LIBRARY } from "../../../utils/mechanismTemplates";
import {
  EditorStageFrame,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import { BlueprintControlPanel } from "./BlueprintControlPanel";

export const BlueprintExport = ({
  project,
  dispatch,
  goStage,
}: {
  project: ProjectState;
  dispatch: (action: ProjectAction) => void;
  goStage: (stage: AppStage) => void;
}) => {
  const validation = validateForFabrication(project);
  const create = () =>
    dispatch({
      type: "set_export",
      fabricationPackage: createFabricationPackage(project),
    });
  const pkg = project.lastExport;
  const activeMechanisms = project.mechanisms.filter(
    (m) => m.visible && m.enabled !== false,
  );
  const liveRecipes = activeMechanisms.map((mechanism) =>
    pendingRecipeForMechanism(project, mechanism),
  );
  const recipes = liveRecipes.length ? liveRecipes : (pkg?.recipes ?? []);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const selectedRecipe =
    recipes.find((recipe) => recipe.mechanismId === selectedRecipeId) ??
    recipes[0];
  const previewSvg = makeBlueprintPreviewSvg(project, recipes);
  const selectedSensemaking = selectedRecipe
    ? MECHANISM_TEMPLATE_LIBRARY[selectedRecipe.type].classroomSensemaking
    : undefined;
  const recipeTitle = (recipe: (typeof recipes)[number]) =>
    referenceRecipeForType(recipe.type).title;
  return (
    <EditorStageFrame
      stage="blueprint"
      className="blueprint-stage-frame"
      layout={{
        workflow: workflowPane(
          <BlueprintControlPanel
            project={project}
            goStage={goStage}
            validation={validation}
            create={create}
            pkg={pkg}
            recipes={recipes}
            selectedRecipe={selectedRecipe}
            onSelectRecipe={setSelectedRecipeId}
          />,
        ),
        canvas: canvasPane(
          <div
            className="blueprint-document-preview canvas-workspace"
            data-testid="blueprint-canvas-preview"
            data-visual-level="board-hero"
          >
            <div
              data-testid="blueprint-svg-preview"
              className="blueprint-svg-preview"
              role="img"
              aria-label="Blueprint board preview"
              dangerouslySetInnerHTML={{ __html: previewSvg }}
            />
          </div>,
        ),
        inspector: inspectorPane(
          <section
            className="stage-pane-stack"
            data-testid="blueprint-detail-preview"
          >
            <div>
              <div className="section-title">Detail</div>
              <h3>Board preview</h3>
            </div>
            {selectedRecipe ? (
              <article
                className="assembly-recipe-card"
                data-testid={`blueprint-recipe-${selectedRecipe.mechanismId}`}
              >
                <div className="font-bold text-slate-800">
                  {selectedRecipe.mechanismId} · {recipeTitle(selectedRecipe)}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Board{" "}
                  {fabricationBoardCoordinateCallout(
                    selectedRecipe.boardCoordinate,
                    selectedRecipe.board,
                  )}
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
                    <span className="cue-title">Motion</span>
                    <strong>{selectedSensemaking.directTranslation}</strong>
                    <small>{selectedSensemaking.studentCheck}</small>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedRecipe.requiredParts.map((part) => (
                    <span
                      className="blueprint-pill"
                      key={`${selectedRecipe.mechanismId}-${part.name}`}
                    >
                      {fabricationPartDisplayLabel(part.name)} × {part.quantity}
                    </span>
                  ))}
                </div>
                <div
                  className="mt-3 rounded-2xl bg-slate-100 p-3 text-sm font-bold text-slate-700"
                  data-testid="blueprint-stack-summary"
                >
                  {readableFabricationStackSummary(selectedRecipe)}
                </div>
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
            {pkg && (
              <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 shadow-sm">
                Grid {project.settings.physicalKit.gridPitchMm}mm · holes{" "}
                {project.settings.physicalKit.holeDiameterMm}mm ·{" "}
                {recipes.length} recipe{recipes.length === 1 ? "" : "s"}
              </div>
            )}
          </section>,
        ),
      }}
    />
  );
};
