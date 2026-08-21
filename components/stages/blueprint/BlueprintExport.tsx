import React, {
  startTransition,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AppStage, FabricationRecipe, ProjectAction, ProjectState } from "../../../types";
import { FinalStudyArtifactGate } from "../../../hooks/useFinalStudyArtifact";
import {
  buildBlueprintModel,
} from "../../../runtime/blueprint/BlueprintModel";
import { createBlueprintPackageWorkerClient } from "../../../runtime/blueprint/blueprintPackageWorkerClient";
import { downloadText } from "../../../utils/project";
import {
  EditorStageFrame,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import { BlueprintControlPanel } from "./BlueprintControlPanel";
import { BlueprintDetailPanel } from "./BlueprintDetailPanel";
import { DeferredThreePuppetPreview } from "../../DeferredThreePuppetPreview";

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
  const packageClient = useMemo(() => createBlueprintPackageWorkerClient(), []);
  const [packageStatus, setPackageStatus] = useState<"idle" | "running">("idle");
  const [stlStatus, setStlStatus] = useState<"idle" | "running">("idle");
  const [packageError, setPackageError] = useState<string>();
  const [stlError, setStlError] = useState<string>();
  useEffect(() => () => packageClient.dispose(), [packageClient]);
  const create = () => {
    if (stlStatus === "running") return;
    if (packageStatus === "running") {
      packageClient.cancel();
      setPackageStatus("idle");
      return;
    }
    setPackageError(undefined);
    setPackageStatus("running");
    packageClient.request(project, {
      complete: ({ fabricationPackage }) => {
        setPackageStatus("idle");
        startTransition(() => dispatch({
          type: "set_export",
          fabricationPackage,
        }));
      },
      failed: (error) => {
        setPackageStatus("idle");
        setPackageError(error.message);
      },
    });
  };
  const createStl = () => {
    if (stlStatus === "running") {
      packageClient.cancel();
      setStlStatus("idle");
      return;
    }
    if (packageStatus === "running" || !pkg) return;
    setStlError(undefined);
    setStlStatus("running");
    packageClient.requestCustomPartsStl(project, {
      complete: ({ customPartsStl }) => {
        setStlStatus("idle");
        downloadText(
          `${pkg.id}-custom-parts.stl`,
          customPartsStl,
          "model/stl",
        );
      },
      failed: (error) => {
        setStlStatus("idle");
        setStlError(error.message);
      },
    });
  };
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const selectedRecipe = selectBlueprintRecipe(recipes, selectedRecipeId, project.selectedMechanismId);
  const exposePackageDiagnostics = __MOTIONSMITH_E2E_DIAGNOSTICS__ && !(
    window as Window & { __MOTIONSMITH_CHROMEBOOK_AUDIT__?: unknown }
  ).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
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
            createStl={createStl}
            packageStatus={packageStatus}
            stlStatus={stlStatus}
            packageError={packageError}
            stlError={stlError}
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
            <div className="blueprint-legend" data-testid="blueprint-legend" aria-label="Blueprint legend">
              <span><i className="blueprint-legend-swatch character" aria-hidden="true" />Character</span>
              <span><i className="blueprint-legend-swatch mechanism" aria-hidden="true" />Mechanism</span>
              <span><i className="blueprint-legend-swatch board" aria-hidden="true" />Board</span>
              <span><i className="blueprint-legend-swatch path" aria-hidden="true" />Motion path</span>
            </div>
            <DeferredThreePuppetPreview
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
            {pkg && exposePackageDiagnostics && (
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
