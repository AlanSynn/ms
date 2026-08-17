import React, { useState } from "react";
import type { AppStage, FabricationRecipe, ProjectAction, ProjectState } from "../../../types";
import { FinalStudyArtifactGate } from "../../../hooks/useFinalStudyArtifact";
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
import { ThreePuppetPreview } from "../../ThreePuppetPreview";

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
  const { validation, pkg, recipes } = buildBlueprintModel(project);
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
            data-visual-level="3d-components"
          >
            <ThreePuppetPreview
              project={project}
              skeleton={project.skeleton}
              mechanisms={project.mechanisms}
              paths={Object.values(project.paths)}
              selectedPathId={project.selectedPathId}
              testId="blueprint-three-puppet"
              cameraPresets={["front", "iso"]}
              initialCameraPreset="front"
              initialLayers={{ skeleton: false }}
              onSelectMechanism={setSelectedRecipeId}
            />
            {pkg && (
              <pre hidden data-testid="blueprint-export-package-json">
                {JSON.stringify(pkg)}
              </pre>
            )}
          </div>,
        ),
        inspector: inspectorPane(
          __MOTIONSMITH_STUDY_SUMMARY_ENABLED__ ? (
            <>
              <FinalStudyArtifactGate
                project={project}
                recipes={recipes}
                readiness={validation.errors.length ? "blocked" : "ready"}
                blueprintReached
                packageGenerated={Boolean(pkg)}
              />
              <BlueprintDetailPanel
                project={project}
                recipes={recipes}
                selectedRecipe={selectedRecipe}
              />
            </>
          ) : (
            <BlueprintDetailPanel
              project={project}
              recipes={recipes}
              selectedRecipe={selectedRecipe}
            />
          ),
        ),
      }}
    />
  );
};
