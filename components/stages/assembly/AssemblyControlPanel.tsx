import type { Dispatch, SetStateAction } from "react";

import { StageLeftSummary } from "../stageLayout";
import type { AppStage, FabricationRecipe, ProjectState } from "../../../types";
import {
  type AssemblyLane,
  type AssemblyPlaybackStep,
  type CharacterAssemblyPlan,
  type CharacterAssemblyStep,
} from "../../../utils/assemblyPlayback";
import { fabricationBoardCoordinateCallout } from "../../../utils/fabrication";
import {
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
} from "../../../utils/mechanismTemplates";
import { referenceRecipeForType } from "../../../utils/mechanismReference";
import { ContextHelp } from "../../ui/ContextHelp";

type AssemblyMode = "mechanism" | "character";
type AssemblyStepItem = Pick<
  AssemblyPlaybackStep | CharacterAssemblyStep,
  "phase" | "index" | "label"
>;

export const AssemblyControlPanel = ({
  project,
  goStage,
  validationErrorCount,
  packageReady,
  onCreate,
  onPrint,
  onDownloadPdf,
  activeAssemblyMode,
  setAssemblyMode,
  hasCharacterAssembly,
  recipes,
  selectedRecipe,
  setSelectedRecipeId,
  lane,
  setLane,
  activePlaybackSteps,
  stepIndex,
  goAssemblyStep,
}: {
  project: ProjectState;
  goStage: (stage: AppStage) => void;
  validationErrorCount: number;
  packageReady: boolean;
  onCreate: () => void;
  onPrint: () => void;
  onDownloadPdf: () => void;
  activeAssemblyMode: AssemblyMode;
  setAssemblyMode: Dispatch<SetStateAction<AssemblyMode>>;
  hasCharacterAssembly: boolean;
  recipes: FabricationRecipe[];
  selectedRecipe?: FabricationRecipe;
  setSelectedRecipeId: Dispatch<SetStateAction<string | null>>;
  lane: AssemblyLane;
  setLane: Dispatch<SetStateAction<AssemblyLane>>;
  activePlaybackSteps: AssemblyStepItem[];
  stepIndex: number;
  goAssemblyStep: (next: number | ((index: number) => number)) => void;
}) => (
  <div className="stage-pane-stack" data-testid="assembly-control-panel">
    <StageLeftSummary
      project={project}
      title="Assembly"
      stage="assembly"
      goStage={goStage}
    >
      <h3>Build</h3>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={() => goStage("blueprint")}>
          Blueprint
        </button>
        <button
          className="btn-primary"
          aria-label={packageReady ? "Print" : "Generate package"}
          disabled={!!validationErrorCount}
          onClick={packageReady ? onPrint : onCreate}
        >
          {packageReady ? "Print" : "Generate"}
        </button>
        {packageReady && (
          <button className="btn-secondary" onClick={onDownloadPdf}>
            PDF
          </button>
        )}
      </div>
      {activeAssemblyMode === "mechanism" && (
        <div
          className="mt-4 flex flex-wrap gap-2"
          data-testid="assembly-lane-switch"
        >
          <button
            className={lane === "kit" ? "chip active" : "chip"}
            disabled={project.settings.physicalKit.exportMode === "custom-parts"}
            onClick={() => setLane("kit")}
          >
            Kit
          </button>
          <button
            className={lane === "custom" ? "chip active" : "chip"}
            disabled={project.settings.physicalKit.exportMode === "prefab-board"}
            onClick={() => setLane("custom")}
          >
            Custom
          </button>
        </div>
      )}
      <div
        className="mt-4 flex flex-wrap gap-2"
        data-testid="assembly-mode-switch"
      >
        <button
          className={
            activeAssemblyMode === "mechanism" ? "chip active" : "chip"
          }
          disabled={!recipes.length}
          onClick={() => setAssemblyMode("mechanism")}
        >
          Mechanism
        </button>
        <button
          className={
            activeAssemblyMode === "character" ? "chip active" : "chip"
          }
          disabled={!hasCharacterAssembly}
          onClick={() => setAssemblyMode("character")}
        >
          Character
        </button>
      </div>
      {activeAssemblyMode === "mechanism" && (
        <div className="mt-5 grid gap-2">
          {recipes.map((recipe) => (
            <button
              key={recipe.mechanismId}
              type="button"
              className={`assembly-recipe-card text-left ${selectedRecipe?.mechanismId === recipe.mechanismId ? "ring-2 ring-inset" : ""}`}
              onClick={() => setSelectedRecipeId(recipe.mechanismId)}
            >
              <div className="font-bold text-slate-800">
                {recipe.mechanismId} · {referenceRecipeForType(recipe.type).title}
              </div>
              <div className="text-sm text-slate-600">
                Board {fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board)}
              </div>
              <div className="mt-2">
                <span className="blueprint-pill">
                  {
                    MECHANISM_LIBRARY[recipe.type].classroomSensemaking
                      .directTranslation
                  }
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
      {activePlaybackSteps.length > 0 && (
        <div
          className="mt-4 rounded-2xl bg-white p-3 shadow-sm"
          data-testid="assembly-step-list"
        >
          <div className="flex items-center gap-2">
            <div className="section-title">Steps</div>
            <ContextHelp helpId="assembly.steps" />
          </div>
          <div className="mt-2 grid gap-1">
            {activePlaybackSteps.map((step, index) => (
              <button
                key={`${step.phase}-${step.index}`}
                className={`assembly-step-button ${index === stepIndex ? "active" : ""}`}
                onClick={() => goAssemblyStep(index)}
              >
                <span>{step.index}</span>
                {step.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </StageLeftSummary>
  </div>
);
