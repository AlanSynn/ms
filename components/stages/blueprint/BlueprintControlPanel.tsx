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
import { mechanismTemplateLabel } from "../../../utils/mechanismTemplates";
import { resolvedMechanismOutputBindings } from "../../../utils/mechanismBindings";
import { playableMotionPaths } from "../../../utils/motion";
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
  onRecoverIssue,
  onRecoverMechanism,
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
  onRecoverIssue: (issue: FabricationIssue) => void;
  onRecoverMechanism: (mechanismId: string) => void;
}) => {
  const recipeTitle = (recipe: FabricationRecipe) =>
    referenceRecipeForType(recipe.type).title;
  const downloadSvg = () =>
    pkg && downloadText(`${pkg.id}.svg`, pkg.svg, "image/svg+xml");
  const hasCharacter = project.partOrder.some((partId) => {
    const part = project.parts[partId];
    return Boolean(part && part.visible !== false);
  });
  const usablePathIds = new Set(playableMotionPaths(project).map((path) => path.id));
  const hasUsablePath = usablePathIds.size > 0;
  const inactiveMechanisms = project.mechanisms.filter((mechanism) => {
    if (mechanism.visible === false || mechanism.enabled !== false) return false;
    const bindings = resolvedMechanismOutputBindings(project, mechanism);
    const hasUsableBinding = bindings.some((binding) =>
      binding.enabled !== false && usablePathIds.has(binding.pathId),
    );
    const hasDetachedWarning = mechanism.warnings?.some((warning) =>
      warning.startsWith("Output detached:"),
    ) ?? false;
    return hasDetachedWarning || !hasUsableBinding;
  });
  const recoveryLabel = (issue: FabricationIssue) =>
    issue.recoveryAction === "Choose target + path"
      ? hasUsablePath ? "Connect path" : "Draw path"
      : issue.recoveryAction
        .replace(/^Rebind mechanism target$/, "Connect target")
        .replace(/^Rebind target path$/, "Choose target path")
        .replace(/^Choose existing part$/, "Choose part")
        .replace(/^Choose existing object$/, "Choose object")
        .replace(/^Choose valid path$/, "Choose path")
        .replace(/^Review item$/, "Review")
        .replace(/\s*\+\s*/g, " and ");
  const issueMechanismLabel = (issue: FabricationIssue) => {
    const mechanism = issue.mechanismId
      ? project.mechanisms.find((item) => item.id === issue.mechanismId)
      : undefined;
    return mechanism ? mechanismTemplateLabel(mechanism.type) : undefined;
  };
  const issueTargetLabel = (issue: FabricationIssue) => {
    const path = issue.pathId ? project.paths[issue.pathId] : undefined;
    const target = issue.partId
      ? project.parts[issue.partId]?.name
      : path?.sceneObjectId
        ? project.sceneObjects[path.sceneObjectId]?.name
        : path
          ? project.parts[path.partId]?.name
          : undefined;
    return target ? `${target} path` : undefined;
  };
  const humanIssueMessage = (issue: FabricationIssue) => {
    const mechanismLabel = issueMechanismLabel(issue);
    const prefix = issue.mechanismId ? `${issue.mechanismId}: ` : "";
    let detail = issue.message.startsWith(prefix)
      ? issue.message.slice(prefix.length)
      : issue.message;
    detail = detail
      .replace(/^choose target \+ path\.?$/i, "Choose a target and motion path.")
      .replace(/^missing path [^.]+\.?$/i, "Motion path is missing.")
      .replace(/^path belongs to [^.]+\.?$/i, "Motion path belongs to another target.")
      .replace(/^target path [^ ]+ is missing\.?$/i, "Motion path is missing.")
      .replace(/^target path [^ ]+ belongs to .+$/i, "Motion path belongs to another target.")
      .replace(/^target part [^ ]+ is missing\.?$/i, "Target part is missing.")
      .replace(/^target object [^ ]+ is missing\.?$/i, "Target object is missing.");
    if (!mechanismLabel) return detail;
    const target = issueTargetLabel(issue);
    return `${mechanismLabel}: ${detail}${target ? ` · ${target}` : ""}`;
  };
  const recoveryAriaLabel = (issue: FabricationIssue) => {
    const mechanismLabel = issueMechanismLabel(issue);
    const action = recoveryLabel(issue);
    return `${action}${mechanismLabel ? ` for ${mechanismLabel}` : ""}`;
  };

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
              <div>{humanIssueMessage(issue)}</div>
              <button
                type="button"
                className="mt-2 underline"
                data-testid={`blueprint-recovery-${issue.mechanismId ?? issue.pathId ?? index}`}
                data-fabrication-recovery={issue.mechanismId ?? issue.pathId ?? "issue"}
                onClick={() => onRecoverIssue(issue)}
                aria-label={recoveryAriaLabel(issue)}
              >
                {recoveryLabel(issue)}
              </button>
            </div>
          ))}
          {inactiveMechanisms.map((mechanism) => {
            const label = mechanismTemplateLabel(mechanism.type);
            const action = hasUsablePath ? "Connect path" : "Draw path";
            const bindings = resolvedMechanismOutputBindings(project, mechanism);
            const hasKnownBindingPath = bindings.some((binding) => Boolean(project.paths[binding.pathId]));
            const status = hasKnownBindingPath ? "Check paths" : "No path";
            return (
              <div
                className="warning"
                key={`inactive-${mechanism.id}`}
                data-blueprint-inactive-mechanism={mechanism.id}
              >
                <div>{label} · {status} · Off</div>
                <button
                  type="button"
                  className="mt-2 underline"
                  data-testid={`blueprint-inactive-recovery-${mechanism.id}`}
                  onClick={() => onRecoverMechanism(mechanism.id)}
                  aria-label={`${action} for ${label}`}
                >
                  {action}
                </button>
              </div>
            );
          })}
          {!validation.errors.length && !validation.warnings.length && !inactiveMechanisms.length && (
            <div className="ok">Ready.</div>
          )}
        </div>
        <div className="mt-5 grid gap-2">
          <button
            className="btn-primary"
            aria-label={packageStatus === "running" ? "Cancel Build PDF" : "Download Build PDF"}
            data-testid="blueprint-build-print"
            data-feature-id="blueprint.pdf"
            data-feature-blocker={validation.errors.length ? "Fix the Blueprint warnings first." : "Wait for the current download."}
            disabled={
              packageStatus !== "running" &&
              (!!validation.errors.length || stlStatus === "running" || characterTemplateStatus === "running")
            }
            onClick={create}
            aria-busy={packageStatus === "running"}
            data-blueprint-package-worker="on-demand"
          >
            {packageStatus === "running" ? "Cancel" : "Download Build PDF"}
          </button>
          {packageError && <div className="error">{packageError}</div>}
          <div className="grid gap-1">
            <button
              className="btn-secondary justify-start"
              data-testid="blueprint-character-template"
              data-feature-id="blueprint.customParts"
              data-feature-blocker={!hasCharacter ? "Show a character part first." : "Wait for the current download."}
              aria-label={characterTemplateStatus === "running" ? "Cancel character output" : "Download Character Outlines PDF"}
              aria-busy={characterTemplateStatus === "running"}
              disabled={
                characterTemplateStatus !== "running" &&
                (!hasCharacter || packageStatus === "running" || stlStatus === "running")
              }
              onClick={() => createCharacterTemplate("pdf")}
            >
              {characterTemplateStatus === "running" ? "Cancel" : "Character outlines PDF"}
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
                  <button
                    className="btn-secondary justify-start mb-3"
                    onClick={() => downloadText(`${pkg.id}-cut-pieces.svg`, pkg.customPartsSvg, 'image/svg+xml')}
                  >
                    Cut pieces SVG
                  </button>
                  <div className="font-bold text-slate-800">3D file</div>
                  <div className="mt-2 grid gap-2">
                    <button
                      className="btn-secondary justify-start"
                      aria-label="Download character STL"
                      aria-busy={stlStatus === "running"}
                      disabled={
                        !hasCharacter ||
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
