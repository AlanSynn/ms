import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  AssemblyWorkbench,
  CharacterAssemblyWorkbench,
} from "./AssemblyWorkbench";
import {
  EditorStageFrame,
  StageLeftSummary,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import type { AppStage, ProjectAction, ProjectState } from "../../../types";
import { downloadText } from "../../../utils/project";
import {
  assemblyLaneForExportMode,
  buildAssemblyPlaybackSteps,
  buildCharacterAssemblyPlan,
  pendingRecipeForMechanism,
  type AssemblyLane,
} from "../../../utils/assemblyPlayback";
import {
  createFabricationPackage,
  fabricationBoardCoordinateCallout,
  fabricationPartDisplayLabel,
  readableFabricationStackSummary,
  validateForFabrication,
} from "../../../utils/fabrication";
import {
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
} from "../../../utils/mechanismTemplates";
import { referenceRecipeForType } from "../../../utils/mechanismReference";

export const AssemblyGuide = ({
  project,
  dispatch,
  goStage,
  stepIndex,
  setStepIndex,
  stepProgress,
  setStepProgress,
  playing,
  setPlaying,
  setStepCount,
}: {
  project: ProjectState;
  dispatch: (action: ProjectAction) => void;
  goStage: (stage: AppStage) => void;
  stepIndex: number;
  setStepIndex: Dispatch<SetStateAction<number>>;
  stepProgress: number;
  setStepProgress: Dispatch<SetStateAction<number>>;
  playing: boolean;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  setStepCount: Dispatch<SetStateAction<number>>;
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
  const characterAssemblyPlan = useMemo(
    () => buildCharacterAssemblyPlan(project),
    [project],
  );
  const hasCharacterAssembly =
    characterAssemblyPlan.parts.length > 0 &&
    characterAssemblyPlan.steps.length > 0;
  const [assemblyMode, setAssemblyMode] = useState<"mechanism" | "character">(
    "mechanism",
  );
  const activeAssemblyMode: "mechanism" | "character" =
    assemblyMode === "character" && hasCharacterAssembly
      ? "character"
      : selectedRecipe
        ? "mechanism"
        : hasCharacterAssembly
          ? "character"
          : "mechanism";
  const [lane, setLane] = useState<AssemblyLane>(() =>
    assemblyLaneForExportMode(project.settings.physicalKit.exportMode),
  );
  const stepProgressRef = useRef(0);
  const playbackSteps = selectedRecipe
    ? buildAssemblyPlaybackSteps(selectedRecipe, lane)
    : [];
  const characterPlaybackSteps = characterAssemblyPlan.steps;
  const activePlaybackSteps =
    activeAssemblyMode === "character" ? characterPlaybackSteps : playbackSteps;
  const activeStepCount = activePlaybackSteps.length;
  const selectedSensemaking =
    activeAssemblyMode === "mechanism" && selectedRecipe
      ? MECHANISM_LIBRARY[selectedRecipe.type].classroomSensemaking
      : undefined;
  const currentStep =
    playbackSteps[Math.min(stepIndex, Math.max(0, playbackSteps.length - 1))];
  const currentCharacterStep =
    characterPlaybackSteps[
      Math.min(stepIndex, Math.max(0, characterPlaybackSteps.length - 1))
    ];
  const activeDisplayStep =
    activeAssemblyMode === "character" ? currentCharacterStep : currentStep;
  useEffect(() => {
    setStepCount(activeStepCount);
  }, [activeStepCount, setStepCount]);
  const goAssemblyStep = (next: number | ((index: number) => number)) => {
    stepProgressRef.current = 0;
    setStepProgress(0);
    setStepIndex((index) => {
      const nextIndex = typeof next === "function" ? next(index) : next;
      return Math.max(0, Math.min(Math.max(0, activeStepCount - 1), nextIndex));
    });
  };
  useEffect(() => {
    stepProgressRef.current = 0;
    setStepIndex(0);
    setStepProgress(0);
    setPlaying(false);
  }, [
    activeAssemblyMode,
    selectedRecipe?.mechanismId,
    lane,
    setPlaying,
    setStepIndex,
    setStepProgress,
  ]);
  useEffect(() => {
    if (!playing || activeStepCount < 2) return;
    let frame = 0;
    let last = performance.now();
    const stepMs = 1400;
    const tick = (time: number) => {
      const delta = Math.min(120, time - last);
      last = time;
      const next = stepProgressRef.current + delta / stepMs;
      if (next >= 1) {
        stepProgressRef.current = 0;
        setStepProgress(0);
        setStepIndex((index) => (index >= activeStepCount - 1 ? 0 : index + 1));
      } else {
        stepProgressRef.current = next;
        setStepProgress(next);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, activeStepCount, setStepIndex, setStepProgress]);
  const downloadAssemblyPdf = () =>
    pkg &&
    downloadText(
      `${pkg.id}-assembly.pdf`,
      pkg.assemblyGuidePdf,
      "application/pdf",
    );
  const printGuide = () => {
    if (!pkg) return;
    const popup = window.open("", "_blank");
    if (popup) {
      popup.document.write(pkg.assemblyGuideHtml);
      popup.document.close();
      popup.focus();
      popup.print();
      return;
    }
    downloadText(`${pkg.id}-assembly.html`, pkg.assemblyGuideHtml, "text/html");
  };
  return (
    <EditorStageFrame
      stage="assembly"
      className="assembly-stage-frame"
      layout={{
        workflow: workflowPane(
          <div
            className="stage-pane-stack"
            data-testid="assembly-control-panel"
          >
            <StageLeftSummary
              project={project}
              title="Assembly"
              stage="assembly"
              goStage={goStage}
            >
              <h3>Build</h3>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="btn-secondary"
                  onClick={() => goStage("blueprint")}
                >
                  Blueprint
                </button>
                <button
                  className="btn-primary"
                  aria-label={pkg ? "Print" : "Generate package"}
                  disabled={!!validation.errors.length}
                  onClick={pkg ? printGuide : create}
                >
                  {pkg ? "Print" : "Generate"}
                </button>
                {pkg && (
                  <button
                    className="btn-secondary"
                    onClick={downloadAssemblyPdf}
                  >
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
                    disabled={
                      project.settings.physicalKit.exportMode === "custom-parts"
                    }
                    onClick={() => setLane("kit")}
                  >
                    Kit
                  </button>
                  <button
                    className={lane === "custom" ? "chip active" : "chip"}
                    disabled={
                      project.settings.physicalKit.exportMode === "prefab-board"
                    }
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
                        {recipe.mechanismId} ·{" "}
                        {referenceRecipeForType(recipe.type).title}
                      </div>
                      <div className="text-sm text-slate-600">
                        Board{" "}
                        {fabricationBoardCoordinateCallout(
                          recipe.boardCoordinate,
                          recipe.board,
                        )}
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
                  <div className="section-title">Steps</div>
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
          </div>,
        ),
        canvas: canvasPane(
          <div
            className="assembly-canvas-document canvas-workspace"
            data-testid="assembly-canvas-preview"
          >
            {activeAssemblyMode === "character" && currentCharacterStep ? (
              <CharacterAssemblyWorkbench
                plan={characterAssemblyPlan}
                step={currentCharacterStep}
                kit={project.settings.physicalKit}
                progress={stepProgress}
              />
            ) : selectedRecipe && currentStep ? (
              <AssemblyWorkbench
                recipe={selectedRecipe}
                lane={lane}
                step={currentStep}
                kit={project.settings.physicalKit}
                progress={stepProgress}
              />
            ) : (
              <div className="blueprint-empty-state">
                {hasCharacterAssembly
                  ? "Choose Character."
                  : "Add a character first."}
              </div>
            )}
          </div>,
        ),
        inspector: inspectorPane(
          <section
            className="stage-pane-stack"
            data-testid="assembly-guide-preview"
          >
            <div>
              <div className="section-title">Assembly step</div>
              <h3>{activeDisplayStep?.label ?? "Assembly"}</h3>
            </div>
            {activeAssemblyMode === "character" ? (
              <article
                className="assembly-recipe-card"
                data-testid="character-assembly-inspector"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-800">
                      Character pins
                    </div>
                    <div className="text-sm text-slate-600">
                      {characterAssemblyPlan.fixedPins.length} fixed ·{" "}
                      {characterAssemblyPlan.freePivots.length} free
                    </div>
                  </div>
                  <button className="chip" onClick={() => goStage("character")}>
                    Edit
                  </button>
                </div>
                <div
                  className="mt-3 flex flex-wrap gap-2"
                  data-testid="character-fixed-pin-callouts"
                >
                  {characterAssemblyPlan.fixedPins.map((pin) => (
                    <span className="blueprint-pill" key={pin.id}>
                      {pin.label} ·{" "}
                      {pin.boardCoordinate
                        ? fabricationBoardCoordinateCallout(
                            pin.boardCoordinate,
                            pin.board,
                          )
                        : "board pin"}
                    </span>
                  ))}
                </div>
                {characterAssemblyPlan.fixedPins.some(
                  (pin) => !pin.boardCoordinate || pin.board?.valid === false,
                ) && (
                  <div
                    className="warn mt-3"
                    data-testid="character-pin-blocker"
                  >
                    Move fixed pins onto the board.
                  </div>
                )}
                <div
                  className="mt-3 flex flex-wrap gap-2"
                  data-testid="character-free-pivot-callouts"
                >
                  {characterAssemblyPlan.freePivots.slice(0, 8).map((pin) => (
                    <span className="blueprint-pill" key={pin.id}>
                      {pin.label} free
                    </span>
                  ))}
                </div>
                {currentCharacterStep && (
                  <div
                    className="mt-3 rounded-2xl bg-white p-3 shadow-sm"
                    data-testid="prefab-assembly-steps"
                  >
                    <div className="section-title">Current step</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="blueprint-pill">
                        {currentCharacterStep.phase}
                      </span>
                      <span className="blueprint-pill">
                        {currentCharacterStep.action}
                      </span>
                    </div>
                    <div className="mt-3 text-sm font-bold text-slate-700">
                      {currentCharacterStep.instruction}
                    </div>
                    {currentCharacterStep.check && (
                      <div className="ok mt-3">
                        {currentCharacterStep.check}
                      </div>
                    )}
                  </div>
                )}
              </article>
            ) : selectedRecipe ? (
              <article
                className="assembly-recipe-card"
                data-testid={`assembly-recipe-${selectedRecipe.mechanismId}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-800">
                      {selectedRecipe.mechanismId} ·{" "}
                      {referenceRecipeForType(selectedRecipe.type).title}
                    </div>
                    <div className="text-sm text-slate-600">
                      Board{" "}
                      {fabricationBoardCoordinateCallout(
                        selectedRecipe.boardCoordinate,
                        selectedRecipe.board,
                      )}
                    </div>
                  </div>
                  <button className="chip" onClick={() => goStage("design")}>
                    Edit
                  </button>
                </div>
                {selectedSensemaking && (
                  <div
                    className="sensemaking-cue mt-3"
                    data-testid="assembly-sensemaking-label"
                    data-sensemaking-check={selectedSensemaking.studentCheck}
                    data-sensemaking-answer={selectedSensemaking.expectedAnswer}
                    data-sensemaking-evidence={selectedSensemaking.evidenceCue}
                    data-sensemaking-clip={selectedSensemaking.clipSlot}
                  >
                    <span className="cue-title">Motion</span>
                    <strong>{selectedSensemaking.directTranslation}</strong>
                    <small>{selectedSensemaking.studentCheck}</small>
                  </div>
                )}
                <details className="blueprint-more-exports mt-3">
                  <summary>Parts</summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedRecipe.requiredParts.map((part) => (
                      <span
                        className="blueprint-pill"
                        key={`${selectedRecipe.mechanismId}-${part.name}`}
                      >
                        {fabricationPartDisplayLabel(part.name)} ×{" "}
                        {part.quantity}
                      </span>
                    ))}
                  </div>
                  <div
                    className="mt-3 rounded-2xl bg-slate-100 p-3 text-sm font-bold text-slate-700"
                    data-testid="assembly-stack-summary"
                  >
                    {readableFabricationStackSummary(selectedRecipe)}
                  </div>
                </details>
                {selectedRecipe.warnings.length ? (
                  <div className="warning mt-3">
                    Fix: {selectedRecipe.warnings.join("; ")}
                  </div>
                ) : (
                  <div className="ok mt-3">OK</div>
                )}
                {currentStep && (
                  <div
                    className="mt-3 rounded-2xl bg-white p-3 shadow-sm"
                    data-testid="prefab-assembly-steps"
                  >
                    <div className="section-title">Current step</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="blueprint-pill">
                        {currentStep.phase}
                      </span>
                      {currentStep.coords.map((coord, index) => (
                        <span
                          className="blueprint-pill"
                          key={`${coord}-${index}`}
                        >
                          {fabricationBoardCoordinateCallout(coord)} ·{" "}
                          {currentStep.coordRoles[index] ?? "ref"}
                        </span>
                      ))}
                      <span className="blueprint-pill">
                        Z {currentStep.zMm.toFixed(1)}mm
                      </span>
                    </div>
                    <div className="mt-3 text-sm font-bold text-slate-700">
                      {currentStep.instruction}
                    </div>
                    {currentStep.check && (
                      <div className="ok mt-3">{currentStep.check}</div>
                    )}
                  </div>
                )}
              </article>
            ) : (
              <div className="warning">Add a mechanism first.</div>
            )}
          </section>,
        ),
      }}
    />
  );
};

