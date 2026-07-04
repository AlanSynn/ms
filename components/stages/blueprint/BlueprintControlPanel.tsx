import React from "react";
import { FileJson } from "lucide-react";
import type {
  AppStage,
  FabricationIssue,
  FabricationPackage,
  FabricationRecipe,
  ProjectState,
} from "../../../types";
import { fabricationBoardCoordinateCallout } from "../../../utils/fabrication";
import { referenceRecipeForType } from "../../../utils/mechanismReference";
import { MECHANISM_TEMPLATE_LIBRARY } from "../../../utils/mechanismTemplates";
import { downloadText } from "../../../utils/project";
import { StageLeftSummary } from "../stageLayout";

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
  pkg,
  recipes,
  selectedRecipe,
  onSelectRecipe,
}: {
  project: ProjectState;
  goStage: (stage: AppStage) => void;
  validation: BlueprintValidation;
  create: () => void;
  pkg?: FabricationPackage;
  recipes: FabricationRecipe[];
  selectedRecipe?: FabricationRecipe;
  onSelectRecipe: (mechanismId: string) => void;
}) => {
  const exportMode = project.settings.physicalKit.exportMode;
  const defaultFormat = project.settings.physicalKit.defaultExportFormat;
  const cutSheetFileType = project.settings.physicalKit.cutSheetFileType;
  const recipeTitle = (recipe: FabricationRecipe) =>
    referenceRecipeForType(recipe.type).title;
  const downloadJson = () =>
    pkg && downloadText(`${pkg.id}.json`, JSON.stringify(pkg, null, 2));
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
  const downloadCustomStl = () =>
    pkg &&
    downloadText(`${pkg.id}-custom-parts.stl`, pkg.customPartsStl, "model/stl");
  const downloadAssemblyPdf = () =>
    pkg &&
    downloadText(
      `${pkg.id}-assembly.pdf`,
      pkg.assemblyGuidePdf,
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
        <h3>Board preview</h3>
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
          >
            <FileJson size={16} /> Generate
          </button>
          {pkg && (
            <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 shadow-sm">
              <div className="flex flex-wrap gap-2">
                {cutSheetFileType === "pdf" ? (
                  <button
                    className="btn-primary"
                    aria-label="Download PDF cut sheet default"
                    onClick={downloadCutSheetPdf}
                  >
                    PDF
                  </button>
                ) : (
                  <button
                    className="btn-primary"
                    aria-label="Download SVG cut sheet default"
                    onClick={downloadSvg}
                  >
                    SVG
                  </button>
                )}
                <button className="btn-secondary" onClick={() => goStage("assembly")}>
                  Assembly
                </button>
              </div>
              <details className="blueprint-more-exports mt-3">
                <summary>More files</summary>
                <div className="mt-2 grid gap-3">
                  <div className="flex flex-wrap gap-2">
                    {defaultFormat !== "svg" && (
                      <button
                        className="btn-secondary"
                        aria-label="Download JSON default"
                        onClick={downloadJson}
                      >
                        JSON
                      </button>
                    )}
                    {defaultFormat !== "json" && (
                      <button
                        className="btn-secondary"
                        aria-label="Download SVG default"
                        onClick={downloadSvg}
                      >
                        SVG
                      </button>
                    )}
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        downloadText(
                          `${pkg.id}-assembly.html`,
                          pkg.assemblyGuideHtml,
                          "text/html",
                        )
                      }
                    >
                      HTML
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        downloadText(`${pkg.id}-metadata.json`, pkg.metadataJson)
                      }
                    >
                      Metadata
                    </button>
                    <button className="btn-secondary" onClick={downloadAssemblyPdf}>
                      Assembly PDF
                    </button>
                  </div>
                  {exportMode !== "prefab-board" && (
                    <div data-testid="custom-parts-export-lane">
                      <div className="font-bold text-slate-800">Custom parts</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button className="btn-secondary" onClick={downloadCustomSvg}>
                          SVG
                        </button>
                        <button className="btn-secondary" onClick={downloadCustomPdf}>
                          PDF
                        </button>
                        <button
                          className="btn-secondary"
                          data-testid="download-custom-stl"
                          onClick={downloadCustomStl}
                        >
                          STL
                        </button>
                      </div>
                    </div>
                  )}
                  {exportMode !== "custom-parts" && (
                    <div data-testid="prefab-board-export-lane">
                      <div className="font-bold text-slate-800">Prefab kit</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          className="btn-secondary"
                          aria-label="Assembly guide"
                          onClick={() => goStage("assembly")}
                        >
                          Guide
                        </button>
                        <button className="btn-secondary" onClick={downloadAssemblyPdf}>
                          PDF
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </details>
            </div>
          )}
        </div>
        <div className="mt-5">
          <h4 className="section-title">Recipes</h4>
          <div className="mt-3 grid gap-2">
            {recipes.map((recipe) => (
              <button
                key={recipe.mechanismId}
                type="button"
                className={`assembly-recipe-card text-left ${selectedRecipe?.mechanismId === recipe.mechanismId ? "ring-2 ring-inset" : ""}`}
                onClick={() => onSelectRecipe(recipe.mechanismId)}
              >
                <div className="font-bold text-slate-800">
                  {recipe.mechanismId} · {recipeTitle(recipe)}
                </div>
                <div className="text-sm text-slate-600">
                  Anchor {fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board)}
                </div>
                <div className="mt-2">
                  <span className="blueprint-pill">
                    {
                      MECHANISM_TEMPLATE_LIBRARY[recipe.type].classroomSensemaking
                        .directTranslation
                    }
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </StageLeftSummary>
    </div>
  );
};
