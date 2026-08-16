import React, { useState } from "react";
import type { AppStage, FabricationRecipe, ProjectAction, ProjectState } from "../../../types";
import {
  buildBlueprintModel,
  createBlueprintPackage,
} from "../../../runtime/blueprint/BlueprintModel";
import {
  EditorStageFrame,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import { BlueprintControlPanel } from "./BlueprintControlPanel";
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
  const { validation, pkg, recipes, previewSvg } = buildBlueprintModel(project);
  const create = () =>
    dispatch({
      type: "set_export",
      fabricationPackage: createBlueprintPackage(project),
    });
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const selectedRecipe = selectBlueprintRecipe(recipes, selectedRecipeId, project.selectedMechanismId);
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
          />,
        ),
      }}
    />
  );
};
