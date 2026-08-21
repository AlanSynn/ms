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
  packageStatus,
  packageError,
  pkg,
  recipes,
  selectedRecipe,
  onSelectRecipe,
}: {
  project: ProjectState;
  goStage: (stage: AppStage) => void;
  validation: BlueprintValidation;
  create: () => void;
  packageStatus: "idle" | "running";
  packageError?: string;
  pkg?: FabricationPackage;
  recipes: FabricationRecipe[];
  selectedRecipe?: FabricationRecipe;
  onSelectRecipe: (mechanismId: string) => void;
}) => {
  const recipeTitle = (recipe: FabricationRecipe) =>
    referenceRecipeForType(recipe.type).title;
  const downloadSvg = () =>
    pkg && downloadText(`${pkg.id}.svg`, pkg.svg, "image/svg+xml");
  const downloadCutSheetPdf = () =>
    pkg &&
    downloadText(`${pkg.id}-cut-sheet.pdf`, pkg.cutSheetPdf, "application/pdf");
  const downloadCustomSvg = () =>
    pkg &&
    downloadText(
      `${pkg.id}-custom-parts.svg`,
      pkg.customPartsSvg,
      "image/svg+xml",
    );
  const downloadCustomPdf = () =>
    pkg &&
    downloadText(
      `${pkg.id}-custom-parts.pdf`,
      pkg.customPartsPdf,
      "application/pdf",
    );

  return (
    <div className="stage-pane-stack" data-testid="blueprint-control-panel">
      <StageLeftSummary
        project={project}
        title="Blueprint"
        stage="blueprint"
        goStage={goStage}
      >
        <div className="flex items-center gap-2">
          <h3>Board preview</h3>
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
            aria-label="Generate package"
            disabled={!!validation.errors.length}
            onClick={create}
            aria-busy={packageStatus === "running"}
            data-blueprint-package-worker="on-demand"
          >
            {packageStatus === "running" ? "Cancel" : "Make files"}
          </button>
          {packageError && <div className="error">{packageError}</div>}
          {pkg && (
            <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 shadow-sm">
              <div className="font-bold text-slate-800">Files</div>
              <div className="mt-3 grid gap-3">
                <div data-testid="prefab-board-export-lane">
                  <div className="font-bold text-slate-800">Mechanism</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      className="btn-primary justify-start"
                      aria-label="Download PDF cut sheet default"
                      onClick={downloadCutSheetPdf}
                    >
                      Mechanism PDF
                    </button>
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
                  <div className="font-bold text-slate-800">Character</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      className="btn-secondary justify-start"
                      onClick={downloadCustomPdf}
                    >
                      Character PDF
                    </button>
                    <button
                      className="btn-secondary justify-start"
                      onClick={downloadCustomSvg}
                    >
                      Character SVG
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="mt-5">
          <h4 className="section-title">Mechanisms</h4>
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
                  Board {fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board).split(" · ")[0]}
                </div>
              </button>
            ))}
          </div>
        </div>
      </StageLeftSummary>
    </div>
  );
};
