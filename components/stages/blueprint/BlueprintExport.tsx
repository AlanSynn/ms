import React, {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AppStage, FabricationRecipe, ProjectAction, ProjectState } from "../../../types";
import { FinalStudyArtifactGate } from "../../../hooks/useFinalStudyArtifact";
import {
  buildBlueprintModel,
} from "../../../runtime/blueprint/BlueprintModel";
import { createBlueprintPackageWorkerClient } from "../../../runtime/blueprint/blueprintPackageWorkerClient";
import { downloadText } from "../../../utils/project";
import { buildPlanSourceDigest } from "../../../utils/buildPlan";
import { projectContentFingerprint } from "../../../utils/projectSerialization";
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
  const expectedCharacterPlanDigest = buildPlanSourceDigest(project, "character");
  const currentPackage = pkg?.sourceProjectFingerprint === sourceProjectFingerprint &&
    pkg.buildPlanSourceDigest === expectedBuildPlanDigest
    ? pkg
    : undefined;
  const downloadBlueprint = (fabricationPackage: NonNullable<typeof pkg>) => {
    const pdf = fabricationPackage.blueprintPdf ?? fabricationPackage.cutSheetPdf;
    if (!pdf) return false;
    downloadText(
      `${fabricationPackage.id}-blueprint.pdf`,
      pdf,
      "application/pdf",
    );
    return true;
  };
  const create = () => {
    if (stlStatus === "running" || characterTemplateStatus === "running") return;
    if (packageStatus === "running") {
      packageClient.cancel();
      setPackageStatus("idle");
      return;
    }
    if (currentPackage && downloadBlueprint(currentPackage)) return;
    setPackageError(undefined);
    setPackageStatus("running");
    const sourceFingerprint = projectContentFingerprint(project);
    packageClient.request(project, {
      complete: ({ fabricationPackage }) => {
        setPackageStatus("idle");
        if (projectContentFingerprint(latestProjectRef.current) !== sourceFingerprint) {
          setPackageError("Project changed. Download Blueprint PDF again.");
          return;
        }
        if (
          fabricationPackage.sourceProjectFingerprint !== sourceFingerprint ||
          fabricationPackage.buildPlanSourceDigest !== expectedBuildPlanDigest ||
          !downloadBlueprint(fabricationPackage)
        ) {
          setPackageError("Project changed. Download Blueprint PDF again.");
          return;
        }
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
          setStlError("Project changed. Download Blueprint PDF again.");
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
