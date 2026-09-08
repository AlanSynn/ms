import React, {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AppStage, FabricationIssue, FabricationRecipe, ProjectAction, ProjectState } from "../../../types";
import { FinalStudyArtifactGate } from "../../../hooks/useFinalStudyArtifact";
import {
  buildBlueprintModel,
} from "../../../runtime/blueprint/BlueprintModel";
import { createBlueprintPackageWorkerClient } from "../../../runtime/blueprint/blueprintPackageWorkerClient";
import { downloadText } from "../../../utils/project";
import { downloadPdf } from "../../../utils/pdfDownload";
import { buildPlanArtworkSourceDigest, buildPlanSourceDigest } from "../../../utils/buildPlan";
import { projectContentFingerprint } from "../../../utils/projectSerialization";
import { resolvedMechanismOutputBindings } from "../../../utils/mechanismBindings";
import { playableMotionPaths } from "../../../utils/motion";
import {
  EditorStageFrame,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import { BlueprintControlPanel } from "./BlueprintControlPanel";
import { BlueprintDetailPanel } from "./BlueprintDetailPanel";
import { BlueprintBuildPreview } from "./BlueprintBuildPreview";

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
  const { validation, pkg, recipes, buildPlan } = buildBlueprintModel(project);
  const packageClient = useMemo(() => createBlueprintPackageWorkerClient(), []);
  const [packageStatus, setPackageStatus] = useState<"idle" | "running">("idle");
  const [characterTemplateStatus, setCharacterTemplateStatus] = useState<"idle" | "running">("idle");
  const [stlStatus, setStlStatus] = useState<"idle" | "running">("idle");
  const [packageError, setPackageError] = useState<string>();
  const [characterTemplateError, setCharacterTemplateError] = useState<string>();
  const [stlError, setStlError] = useState<string>();
  const latestProjectRef = useRef(project);
  latestProjectRef.current = project;
  useEffect(() => () => packageClient.dispose(), [packageClient]);
  const sourceProjectFingerprint = projectContentFingerprint(project);
  const expectedBuildPlanDigest = buildPlanSourceDigest(project);
  const expectedArtworkDigest = buildPlanArtworkSourceDigest(project);
  const expectedCharacterPlanDigest = buildPlanSourceDigest(project, "character");
  const currentPackage = pkg?.sourceProjectFingerprint === sourceProjectFingerprint &&
    pkg.buildPlanSourceDigest === expectedBuildPlanDigest &&
    pkg.buildPlanArtworkSourceDigest === expectedArtworkDigest
    ? pkg
    : undefined;
  const downloadBlueprint = (fabricationPackage: NonNullable<typeof pkg>) => {
    const pdf = fabricationPackage.buildPacketPdf;
    if (!pdf) {
      setPackageError("Build file missing. Download Build PDF again.");
      return false;
    }
    try {
      downloadPdf(`${fabricationPackage.id}-build.pdf`, pdf);
      return true;
    } catch (error) {
      setPackageError(`PDF download failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };
  const create = () => {
    if (stlStatus === "running" || characterTemplateStatus === "running") return;
    if (packageStatus === "running") {
      packageClient.cancel();
      setPackageStatus("idle");
      return;
    }
    setPackageError(undefined);
    if (currentPackage) {
      downloadBlueprint(currentPackage);
      return;
    }
    setPackageStatus("running");
    const sourceFingerprint = projectContentFingerprint(project);
    packageClient.request(project, {
      complete: ({ fabricationPackage }) => {
        setPackageStatus("idle");
        if (projectContentFingerprint(latestProjectRef.current) !== sourceFingerprint) {
          setPackageError("Project changed. Download Build PDF again.");
          return;
        }
        if (
          fabricationPackage.sourceProjectFingerprint !== sourceFingerprint ||
          fabricationPackage.buildPlanSourceDigest !== expectedBuildPlanDigest ||
          fabricationPackage.buildPlanArtworkSourceDigest !== expectedArtworkDigest
        ) {
          setPackageError("Project changed. Download Build PDF again.");
          return;
        }
        if (!downloadBlueprint(fabricationPackage)) return;
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
  const createCharacterTemplate = (format: "pdf" | "svg") => {
    if (packageStatus === "running" || stlStatus === "running") return;
    if (characterTemplateStatus === "running") {
      packageClient.cancel();
      setCharacterTemplateStatus("idle");
      return;
    }
    setCharacterTemplateError(undefined);
    setCharacterTemplateStatus("running");
    const sourceFingerprint = projectContentFingerprint(project);
    packageClient.requestCharacterTemplate(project, {
      complete: ({ characterTemplatePdf, characterTemplateSvg, buildPlanSourceDigest: digest, sourceProjectFingerprint: resultFingerprint }) => {
        setCharacterTemplateStatus("idle");
        if (
          projectContentFingerprint(latestProjectRef.current) !== sourceFingerprint ||
          resultFingerprint !== sourceFingerprint ||
          digest !== expectedCharacterPlanDigest
        ) {
          setCharacterTemplateError("Project changed. Download again.");
          return;
        }
        downloadText(
          `${project.metadata.name || "motionsmith"}-character.${format}`,
          format === "pdf" ? characterTemplatePdf : characterTemplateSvg,
          format === "pdf" ? "application/pdf" : "image/svg+xml",
        );
      },
      failed: (error) => {
        setCharacterTemplateStatus("idle");
        setCharacterTemplateError(error.message);
      },
    });
  };
  const createStl = () => {
    if (stlStatus === "running") {
      packageClient.cancel();
      setStlStatus("idle");
      return;
    }
    if (packageStatus === "running" || characterTemplateStatus === "running" || !currentPackage) return;
    setStlError(undefined);
    setStlStatus("running");
    const sourceFingerprint = projectContentFingerprint(project);
    packageClient.requestCustomPartsStl(project, {
      complete: ({ customPartsStl }) => {
        setStlStatus("idle");
        if (projectContentFingerprint(latestProjectRef.current) !== sourceFingerprint) {
          setStlError("Project changed. Download Build PDF again.");
          return;
        }
        downloadText(
          `${currentPackage.id}-custom-parts.stl`,
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
  const hasUsablePath = playableMotionPaths(project).length > 0;
  const recoverIssue = (issue: FabricationIssue) => {
    const mechanism = issue.mechanismId
      ? project.mechanisms.find((item) => item.id === issue.mechanismId)
      : undefined;
    if (mechanism) {
      dispatch({
        type: "select_mechanism",
        mechanismId: issue.mechanismId,
      });
      if (
        mechanism.targetSceneObjectId &&
        project.sceneObjects[mechanism.targetSceneObjectId]
      ) {
        dispatch({
          type: "select_scene_object",
          objectId: mechanism.targetSceneObjectId,
        });
      }
    }
    const targetPartId = issue.partId ?? mechanism?.targetPartId;
    if (targetPartId && project.parts[targetPartId]) {
      dispatch({ type: "select_part", partId: targetPartId });
    }
    const targetPathId = issue.pathId
      ?? mechanism?.targetPathId
      ?? (mechanism
        ? resolvedMechanismOutputBindings(project, mechanism).find((binding) => binding.enabled !== false)?.pathId
        : undefined);
    if (targetPathId && project.paths[targetPathId]) {
      dispatch({ type: "select_path", pathId: targetPathId });
    }
    const stage = issue.recoveryAction === "Choose target + path" && !hasUsablePath
      ? "path"
      : issue.recoveryStage;
    goStage(stage);
  };
  const recoverInactiveMechanism = (mechanismId: string) => {
    const mechanism = project.mechanisms.find((item) => item.id === mechanismId);
    if (!mechanism) return;
    dispatch({
      type: "select_mechanism",
      mechanismId,
    });
    if (
      mechanism.targetSceneObjectId &&
      project.sceneObjects[mechanism.targetSceneObjectId]
    ) {
      dispatch({
        type: "select_scene_object",
        objectId: mechanism.targetSceneObjectId,
      });
    }
    const targetPartId = mechanism.targetPartId
      ?? resolvedMechanismOutputBindings(project, mechanism).find((binding) => binding.enabled !== false)?.targetPartId;
    if (targetPartId && project.parts[targetPartId]) {
      dispatch({ type: "select_part", partId: targetPartId });
    }
    const targetPathId = mechanism.targetPathId
      ?? resolvedMechanismOutputBindings(project, mechanism).find((binding) => project.paths[binding.pathId])?.pathId;
    if (targetPathId && project.paths[targetPathId]) {
      dispatch({ type: "select_path", pathId: targetPathId });
    }
    goStage(hasUsablePath ? "design" : "path");
  };
  const selectedRecipe = selectBlueprintRecipe(recipes, selectedRecipeId, project.selectedMechanismId);
  const selectedBuildMechanism = buildPlan.mechanisms.find(
    mechanism => mechanism.sourceMechanismId === selectedRecipe?.mechanismId,
  ) ?? buildPlan.mechanisms[0];
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
            createCharacterTemplate={createCharacterTemplate}
            createStl={createStl}
            packageStatus={packageStatus}
            characterTemplateStatus={characterTemplateStatus}
            stlStatus={stlStatus}
            packageError={packageError}
            characterTemplateError={characterTemplateError}
            stlError={stlError}
            pkg={currentPackage}
            recipes={recipes}
            buildPlan={buildPlan}
            selectedRecipe={selectedRecipe}
            onSelectRecipe={setSelectedRecipeId}
            onRecoverIssue={recoverIssue}
            onRecoverMechanism={recoverInactiveMechanism}
          />,
        ),
        canvas: canvasPane(
          <div
            className="blueprint-document-preview canvas-workspace"
            data-testid="blueprint-canvas-preview"
            data-visual-level="canonical-build-plan"
          >
            <div className="blueprint-legend" data-testid="blueprint-legend" aria-label="Blueprint legend">
              <span><i className="blueprint-legend-swatch character" aria-hidden="true" />Character</span>
              <span><i className="blueprint-legend-swatch mechanism" aria-hidden="true" />Mechanism</span>
              <span><i className="blueprint-legend-swatch board" aria-hidden="true" />Board</span>
              <span><i className="blueprint-legend-swatch path" aria-hidden="true" />Motion path</span>
            </div>
            <BlueprintBuildPreview
              buildPlan={buildPlan}
              project={project}
              selectedMechanism={selectedBuildMechanism}
              onSelectMechanism={setSelectedRecipeId}
            />
            {currentPackage && exposePackageDiagnostics && (
              <pre hidden data-testid="blueprint-export-package-json">
                {JSON.stringify(currentPackage)}
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
                packageGenerated={Boolean(currentPackage)}
              />
              <BlueprintDetailPanel
                project={project}
                recipes={recipes}
                selectedRecipe={selectedRecipe}
                buildPlan={buildPlan}
                packageReady={Boolean(currentPackage)}
              />
            </>
          ) : (
            <BlueprintDetailPanel
              project={project}
              recipes={recipes}
              selectedRecipe={selectedRecipe}
              buildPlan={buildPlan}
              packageReady={Boolean(currentPackage)}
            />
          ),
        ),
      }}
    />
  );
};
