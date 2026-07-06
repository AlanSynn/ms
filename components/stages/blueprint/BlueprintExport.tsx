import React, { useState } from "react";
import type { AppStage, FabricationRecipe, ProjectAction, ProjectState } from "../../../types";
import { pendingRecipeForMechanism } from "../../../utils/assemblyPlayback";
import {
  createFabricationPackage,
  makeBlueprintPreviewSvg,
  validateForFabrication,
} from "../../../utils/fabrication";
import {
  EditorStageFrame,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import { BlueprintControlPanel } from "./BlueprintControlPanel";
import { buildMechanismSceneContract } from "../../../utils/mechanismSceneContract";
import { BlueprintDetailPanel } from "./BlueprintDetailPanel";

export const selectBlueprintRecipe = (
  recipes: FabricationRecipe[],
  selectedRecipeId: string | null,
  selectedMechanismId: string | null | undefined,
) =>
  recipes.find((recipe) => recipe.mechanismId === selectedRecipeId) ??
  recipes.find((recipe) => recipe.mechanismId === selectedMechanismId) ??
  recipes[0];

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
  const selectedRecipe = selectBlueprintRecipe(recipes, selectedRecipeId, project.selectedMechanismId);
  const selectedMechanism = selectedRecipe
    ? project.mechanisms.find((mechanism) => mechanism.id === selectedRecipe.mechanismId)
    : undefined;
  const selectedMechanismContract = selectedMechanism && selectedRecipe
    ? buildMechanismSceneContract(selectedMechanism, selectedRecipe)
    : undefined;
  const previewSvg = makeBlueprintPreviewSvg(project, recipes);
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
            data-visual-level="print-sheet-hero"
          >
            <div
              data-testid="blueprint-svg-preview"
              className="blueprint-svg-preview"
              role="img"
              aria-label="Printable character and mechanism sheets"
              dangerouslySetInnerHTML={{ __html: previewSvg }}
            />
            {pkg && (
              <pre hidden data-testid="blueprint-export-package-json">
                {JSON.stringify(pkg)}
              </pre>
            )}
          </div>,
        ),
        inspector: inspectorPane(
          <BlueprintDetailPanel
            project={project}
            recipes={recipes}
            selectedRecipe={selectedRecipe}
            selectedMechanismContract={selectedMechanismContract}
          />,
        ),
      }}
    />
  );
};
