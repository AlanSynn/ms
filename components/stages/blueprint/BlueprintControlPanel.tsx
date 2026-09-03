import React from "react";
import type {
  AppStage,
  FabricationIssue,
  FabricationPackage,
  FabricationRecipe,
  ProjectState,
} from "../../../types";
import { fabricationBoardCoordinateCallout } from "../../../utils/fabrication";
import { referenceRecipeForType } from "../../../utils/mechanismReference";
import { downloadText } from "../../../utils/project";
import { StageLeftSummary } from "../stageLayout";
import { ContextHelp } from "../../ui/ContextHelp";
import type { BuildPlanV1 } from "../../../utils/buildPlan";

type BlueprintValidation = {
  issues: FabricationIssue[];
  errors: string[];
  warnings: string[];
};

export const BlueprintControlPanel = ({
  project,
  goStage,
  validation,
  create,
  createCharacterTemplate,
  createStl,
  packageStatus,
  characterTemplateStatus,
  stlStatus,
  packageError,
  characterTemplateError,
  stlError,
  pkg,
  recipes,
  buildPlan,
  selectedRecipe,
  onSelectRecipe,
}: {
  project: ProjectState;
  goStage: (stage: AppStage) => void;
  validation: BlueprintValidation;
  create: () => void;
  createCharacterTemplate: (format: "pdf" | "svg") => void;
  createStl: () => void;
  packageStatus: "idle" | "running";
  characterTemplateStatus: "idle" | "running";
  stlStatus: "idle" | "running";
  packageError?: string;
  characterTemplateError?: string;
  stlError?: string;
  pkg?: FabricationPackage;
  recipes: FabricationRecipe[];
  buildPlan: BuildPlanV1;
  selectedRecipe?: FabricationRecipe;
  onSelectRecipe: (mechanismId: string) => void;
}) => {
  const recipeTitle = (recipe: FabricationRecipe) =>
    referenceRecipeForType(recipe.type).title;
  const downloadSvg = () =>
    pkg && downloadText(`${pkg.id}.svg`, pkg.svg, "image/svg+xml");
  const hasCharacter = project.partOrder.some((partId) => {
    const part = project.parts[partId];
    return Boolean(part && part.visible !== false);
  });

  return (
    <div className="stage-pane-stack" data-testid="blueprint-control-panel">
      <StageLeftSummary
        project={project}
        title="Blueprint"
        stage="blueprint"
        goStage={goStage}
      >
        <div className="flex items-center gap-2">
          <h3>Build outputs</h3>
          <ContextHelp helpId="blueprint.boardPreview" />
        </div>
        <div className="mt-4 space-y-2">
          {validation.issues.map((issue, index) => (
            <div
              className={issue.severity === "error" ? "error" : "warning"}
              key={`${issue.message}-${index}`}
            >
              <div>{issue.message}</div>
              <button
                className="mt-2 underline"
                onClick={() => goStage(issue.recoveryStage)}
              >
                {issue.recoveryAction}
              </button>
            </div>
          ))}
          {!validation.errors.length && !validation.warnings.length && (
            <div className="ok">Ready.</div>
          )}
        </div>
        <div className="mt-5 grid gap-2">
          <button
            className="btn-primary"
            aria-label={packageStatus === "running" ? "Cancel Blueprint PDF" : "Download Blueprint PDF"}
            data-testid="blueprint-build-print"
            disabled={
              packageStatus !== "running" &&
              (!!validation.errors.length || stlStatus === "running" || characterTemplateStatus === "running")
            }
            onClick={create}
            aria-busy={packageStatus === "running"}
            data-blueprint-package-worker="on-demand"
          >
            {packageStatus === "running" ? "Cancel" : "Download Blueprint PDF"}
          </button>
          {packageError && <div className="error">{packageError}</div>}
          <div className="grid gap-1">
            <button
              className="btn-secondary justify-start"
              data-testid="blueprint-character-template"
              aria-label={characterTemplateStatus === "running" ? "Cancel character output" : "Download Character PDF"}
              aria-busy={characterTemplateStatus === "running"}
              disabled={
                characterTemplateStatus !== "running" &&
                (!hasCharacter || packageStatus === "running" || stlStatus === "running")
              }
              onClick={() => createCharacterTemplate("pdf")}
            >
              {characterTemplateStatus === "running" ? "Cancel" : "Download Character PDF"}
            </button>
            <button
              className="btn-secondary justify-start"
              aria-label="Download Character SVG"
              disabled={!hasCharacter || packageStatus === "running" || stlStatus === "running" || characterTemplateStatus === "running"}
              onClick={() => createCharacterTemplate("svg")}
            >
              Download Character SVG
            </button>
            {characterTemplateError && <div className="error">{characterTemplateError}</div>}
          </div>
          {pkg && (
            <details className="advanced-panel rounded-2xl bg-white p-3 text-sm text-slate-600 shadow-sm">
              <summary className="font-bold text-slate-800">Other cut files</summary>
              <div className="mt-3 grid gap-3">
                <div data-testid="prefab-board-export-lane">
                  <div className="font-bold text-slate-800">Mechanism drawing</div>
                  <div className="mt-2 grid gap-2">
                    <button
                      className="btn-secondary justify-start"
                      aria-label="Download SVG default"
                      onClick={downloadSvg}
                    >
                      Mechanism SVG
                    </button>
                  </div>
                </div>
                <div data-testid="custom-parts-export-lane">
                  <div className="font-bold text-slate-800">3D file</div>
                  <div className="mt-2 grid gap-2">
                    <button
                      className="btn-secondary justify-start"
                      aria-label="Download character STL"
                      aria-busy={stlStatus === "running"}
                      disabled={
                        packageStatus === "running" ||
                        characterTemplateStatus === "running" ||
                        (!!validation.errors.length && stlStatus !== "running")
                      }
                      onClick={createStl}
                      data-blueprint-stl-worker="on-demand"
                    >
                      {stlStatus === "running" ? "Cancel STL" : "Character STL"}
                    </button>
                  </div>
                  {stlError && <div className="error mt-2">{stlError}</div>}
                </div>
              </div>
            </details>
          )}
        </div>
        <div className="mt-5">
          <h4 className="section-title">Motions</h4>
          <div className="mt-2 text-xs font-bold text-slate-500" data-testid="blueprint-motion-count">
            {buildPlan.motions.length} motion{buildPlan.motions.length === 1 ? "" : "s"} / {recipes.length} mechanism{recipes.length === 1 ? "" : "s"}
          </div>
          <div className="mt-3 grid gap-2">
            {recipes.map((recipe) => (
              <button
                key={recipe.mechanismId}
                type="button"
                className={`assembly-recipe-card text-left ${selectedRecipe?.mechanismId === recipe.mechanismId ? "ring-2 ring-inset" : ""}`}
                onClick={() => onSelectRecipe(recipe.mechanismId)}
              >
                <div className="font-bold text-slate-800">
                  {recipeTitle(recipe)}
                </div>
                <div className="text-sm text-slate-600">
                  {(recipe.outputBindings.map(binding => binding.targetName).filter(Boolean).join(", ") || recipe.targetPartName || recipe.targetSceneObjectName || "No target")} / Board {fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board).split(" · ")[0]}
                </div>
              </button>
            ))}
            {buildPlan.motions.filter(motion => !motion.mechanismRefs.length).map(motion => (
              <div key={motion.ref} className="warning" data-testid={`blueprint-unassigned-${motion.id}`}>
                {motion.label}: No mechanism
              </div>
            ))}
          </div>
        </div>
      </StageLeftSummary>
    </div>
  );
};
