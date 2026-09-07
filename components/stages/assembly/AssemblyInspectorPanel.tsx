import type { AppStage, FabricationRecipe, MechanismConfig } from "../../../types";
import { DeferredClassroomExampleVideo } from "../../ui/DeferredClassroomExampleVideo";
import type {
  AssemblyPlaybackStep,
  CharacterAssemblyPlan,
  CharacterAssemblyStep,
} from "../../../utils/assemblyPlayback";
import {
  fabricationBoardCoordinateCallout,
  fabricationPartDisplayLabel,
  readableFabricationStackSummary,
} from "../../../utils/fabrication";
import {
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
} from "../../../utils/mechanismTemplates";
import { referenceRecipeForType } from "../../../utils/mechanismReference";
import {
  classroomAssessmentFor,
  classroomCueTitleFor,
  classroomUseExampleFor,
  formatClassroomAssessmentPrompt,
} from "../../../utils/classroomContent";

type AssemblyMode = "mechanism" | "character";
type AssemblyDisplayStep = AssemblyPlaybackStep | CharacterAssemblyStep;

export const AssemblyInspectorPanel = ({
  activeAssemblyMode,
  activeDisplayStep,
  characterAssemblyPlan,
  currentCharacterStep,
  selectedRecipe,
  selectedMechanism,
  currentStep,
  assessmentKey,
  goStage,
}: {
  activeAssemblyMode: AssemblyMode;
  activeDisplayStep?: AssemblyDisplayStep;
  characterAssemblyPlan: CharacterAssemblyPlan;
  currentCharacterStep?: CharacterAssemblyStep;
  selectedRecipe?: FabricationRecipe;
  selectedMechanism?: MechanismConfig;
  currentStep?: AssemblyPlaybackStep;
  assessmentKey: string;
  goStage: (stage: AppStage) => void;
}) => {
  const objectStep = currentCharacterStep?.phase === "cut-object" || currentCharacterStep?.phase === "place-object";
  const selectedSensemaking =
    activeAssemblyMode === "mechanism" && selectedRecipe
      ? MECHANISM_LIBRARY[selectedRecipe.type].classroomSensemaking
      : undefined;
  const selectedAssessment =
    activeAssemblyMode === "mechanism" && selectedRecipe
      ? classroomAssessmentFor(selectedRecipe.type, assessmentKey, "assembly")
      : undefined;
  const selectedUseExample =
    activeAssemblyMode === "mechanism" && selectedRecipe
      ? classroomUseExampleFor(selectedRecipe.type)
      : undefined;

  return (
    <section className="stage-pane-stack" data-testid="assembly-guide-preview">
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
              <div className="font-bold text-slate-800">{objectStep ? "Object" : "Character fasteners"}</div>
              {!objectStep && <div className="text-sm text-slate-600">
                Board pins and moving joints
              </div>}
            </div>
            <button className="chip" onClick={() => goStage("character")}>
              Edit
            </button>
          </div>
          {!objectStep && <><div
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
            <div className="warn mt-3" data-testid="character-pin-blocker">
              Move fixed pins onto the board.
            </div>
          )}
          <div
            className="mt-3 flex flex-wrap gap-2"
            data-testid="character-free-pivot-callouts"
          >
            {characterAssemblyPlan.freePivots.slice(0, 8).map((pin) => (
              <span className="blueprint-pill" key={pin.id}>
                {pin.label}
              </span>
            ))}
          </div></>}
          {currentCharacterStep && (
            <div
              className="mt-3 rounded-2xl bg-white p-3 shadow-sm"
              data-testid="prefab-assembly-steps"
            >
              <div className="section-title">Current step</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="blueprint-pill">
                  Step {currentCharacterStep.index}
                </span>
              </div>
              <div className="mt-3 text-sm font-bold text-slate-700">
                {currentCharacterStep.instruction}
              </div>
              {currentCharacterStep.check && (
                <div className="ok mt-3">{currentCharacterStep.check}</div>
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
              <span className="cue-title">{classroomCueTitleFor("assembly")}</span>
              <strong>{selectedSensemaking.directTranslation}</strong>
              <small>{selectedSensemaking.studentCheck}</small>
              {selectedAssessment && (
                <small
                  data-testid="classroom-assessment-prompt"
                  data-assessment-key={assessmentKey}
                  data-assessment-kind={selectedAssessment.kind}
                >
                  {formatClassroomAssessmentPrompt(selectedAssessment)}
                </small>
              )}
            </div>
          )}
          {selectedUseExample && (
            <DeferredClassroomExampleVideo example={selectedUseExample} />
          )}
          <details className="blueprint-more-exports mt-3">
            <summary>Parts</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedRecipe.requiredParts.map((part) => (
                <span
                  className="blueprint-pill"
                  key={`${selectedRecipe.mechanismId}-${part.name}`}
                >
                  {fabricationPartDisplayLabel(part.name)} × {part.quantity}
                </span>
              ))}
            </div>
            <div
              className="mt-3 rounded-2xl bg-slate-100 p-3 text-sm font-bold text-slate-700"
              data-testid="assembly-stack-summary"
            >
              {readableFabricationStackSummary(selectedMechanism ?? selectedRecipe)}
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
                <span className="blueprint-pill">Step {currentStep.index}</span>
                <span className="blueprint-pill">Board</span>
                {currentStep.coords.map((coord, index) => (
                  <span className="blueprint-pill" key={`${coord}-${index}`}>
                    {fabricationBoardCoordinateCallout(coord)}
                  </span>
                ))}
                <span className="blueprint-pill">
                  Layer {Math.max(1, Math.round(currentStep.zMm / 2) + 1)}
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
    </section>
  );
};
