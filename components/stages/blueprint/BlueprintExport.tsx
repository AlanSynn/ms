import React, { useState } from "react";
import type { AppStage, ProjectAction, ProjectState } from "../../../types";
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
import { BlueprintDetailPanel } from "./BlueprintDetailPanel";

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
