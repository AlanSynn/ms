import type { FabricationPackage, FabricationRecipe, ProjectState } from "../../../types";
import {
  pendingRecipeForMechanism,
  type AssemblyLane,
  type AssemblyPlaybackStep,
  type CharacterAssemblyPlan,
  type CharacterAssemblyStep,
} from "../../../utils/assemblyPlayback";
import {
  buildPlanSectionSteps,
  createBuildPlanV1,
  type BuildPlanMechanismV1,
  type BuildPlanStepV1,
  type BuildPlanV1,
} from "../../../utils/buildPlan";

export type AssemblyGuideMode = "mechanism" | "character";

export type AssemblyGuideModelInput = {
  project: ProjectState;
  pkg?: FabricationPackage;
  selectedRecipeId: string | null;
  assemblyMode: AssemblyGuideMode;
  lane: AssemblyLane;
  stepIndex: number;
};

export type PreparedAssemblyGuideModel = {
  buildPlan: BuildPlanV1;
  recipes: FabricationRecipe[];
  selectedRecipe?: FabricationRecipe;
  selectedBuildMechanism?: BuildPlanMechanismV1;
  characterAssemblyPlan: CharacterAssemblyPlan;
  hasCharacterAssembly: boolean;
  activeAssemblyMode: AssemblyGuideMode;
  playbackSteps: AssemblyPlaybackStep[];
  characterPlaybackSteps: CharacterAssemblyStep[];
  activePlaybackSteps: Array<AssemblyPlaybackStep | CharacterAssemblyStep>;
  activeBuildSteps: BuildPlanStepV1[];
  activeStepCount: number;
  resetKey: string;
};

const characterAssemblyPlanFromBuildPlan = (
  buildPlan: BuildPlanV1,
  steps: BuildPlanStepV1[],
): CharacterAssemblyPlan => ({
  kind: "character",
  parts: [...buildPlan.character.parts.map(
    ({ ref: _ref, sourcePartId: _sourcePartId, ...part }) => part,
  ), ...buildPlan.objects.parts.map(({ ref: _ref, sourceSceneObjectId: _sourceSceneObjectId, ...part }) => part)],
  fixedPins: buildPlan.character.fixedPins.map(({ ref: _ref, ...pin }) => pin),
  freePivots: buildPlan.character.freePivots.map(({ ref: _ref, ...pin }) => pin),
  steps: steps.map((step) => ({
    index: step.index,
    label: step.label,
    phase: step.phase as CharacterAssemblyStep["phase"],
    action: step.action,
    pinIds: step.pinIds,
    partIds: buildPlan.parts.filter(part => step.partRefs.includes(part.ref)).flatMap(part => part.sourceSceneObjectId ?? part.sourcePartId ?? []),
    instruction: step.instruction,
    check: step.check,
  })),
  mechanismAssemblySteps: [],
  boardCells: buildPlan.character.boardCells,
});

const mechanismPlaybackStepsFromBuildPlan = (
  steps: BuildPlanStepV1[],
): AssemblyPlaybackStep[] => steps.map((step) => ({
  index: step.index,
  label: step.label,
  phase: step.phase as AssemblyPlaybackStep["phase"],
  motion: step.motion,
  action: step.action,
  coords: step.coords,
  coordRoles: step.coordRoles,
  zMm: step.zMm,
  instruction: step.instruction,
  check: step.check,
  stack: step.stack.map(({ ref: _ref, partRef: _partRef, ...item }) => item),
}));

export type AssemblyGuideStepSelection = {
  currentStep?: AssemblyPlaybackStep;
  currentCharacterStep?: CharacterAssemblyStep;
  activeDisplayStep?: AssemblyPlaybackStep | CharacterAssemblyStep;
};

export type AssemblyGuideModel = PreparedAssemblyGuideModel &
  AssemblyGuideStepSelection;

export const prepareAssemblyGuideModel = ({
  project,
  pkg,
  selectedRecipeId,
  assemblyMode,
  lane,
}: Omit<AssemblyGuideModelInput, "stepIndex">): PreparedAssemblyGuideModel => {
  const activeMechanisms = project.mechanisms.filter(
    (mechanism) => mechanism.visible && mechanism.enabled !== false,
  );
  const liveRecipes = activeMechanisms.map((mechanism) =>
    pendingRecipeForMechanism(project, mechanism),
  );
  const sourceRecipes = liveRecipes.length ? liveRecipes : (pkg?.recipes ?? []);
  const buildPlan = createBuildPlanV1(project, {
    lane,
    recipes: sourceRecipes,
    includeDetachedRecipes: !liveRecipes.length && sourceRecipes.length > 0,
  });
  const recipes = buildPlan.mechanisms.map((mechanism) => mechanism.recipe);
  const selectedRecipe =
    recipes.find((recipe) => recipe.mechanismId === selectedRecipeId) ??
    recipes.find((recipe) => recipe.mechanismId === project.selectedMechanismId) ??
    recipes[0];
  const selectedBuildMechanism = selectedRecipe
    ? buildPlan.mechanisms.find(
        (mechanism) => mechanism.sourceMechanismId === selectedRecipe.mechanismId,
      )
    : undefined;
  const characterBuildSteps = [
    ...buildPlanSectionSteps(buildPlan, buildPlan.character.id),
    ...buildPlanSectionSteps(buildPlan, buildPlan.objects.id),
  ].map((step, index) => ({ ...step, index: index + 1 }));
  const characterAssemblyPlan = characterAssemblyPlanFromBuildPlan(
    buildPlan,
    characterBuildSteps,
  );
  const hasCharacterAssembly =
    characterAssemblyPlan.parts.length > 0 &&
    characterAssemblyPlan.steps.length > 0;
  const activeAssemblyMode: AssemblyGuideMode =
    assemblyMode === "character" && hasCharacterAssembly
      ? "character"
      : selectedRecipe
        ? "mechanism"
        : hasCharacterAssembly
          ? "character"
          : "mechanism";
  const mechanismBuildSteps = selectedBuildMechanism
    ? buildPlanSectionSteps(buildPlan, selectedBuildMechanism.sectionId)
    : [];
  const playbackSteps = mechanismPlaybackStepsFromBuildPlan(mechanismBuildSteps);
  const characterPlaybackSteps = characterAssemblyPlan.steps;
  const activeBuildSteps =
    activeAssemblyMode === "character" ? characterBuildSteps : mechanismBuildSteps;
  const activePlaybackSteps =
    activeAssemblyMode === "character" ? characterPlaybackSteps : playbackSteps;
  const activeStepCount = activePlaybackSteps.length;

  return {
    buildPlan,
    recipes,
    selectedRecipe,
    selectedBuildMechanism,
    characterAssemblyPlan,
    hasCharacterAssembly,
    activeAssemblyMode,
    playbackSteps,
    characterPlaybackSteps,
    activePlaybackSteps,
    activeBuildSteps,
    activeStepCount,
    resetKey: `${activeAssemblyMode}:${selectedRecipe?.mechanismId ?? "none"}:${lane}`,
  };
};

export const selectAssemblyGuideStep = (
  prepared: PreparedAssemblyGuideModel,
  stepIndex: number,
): AssemblyGuideStepSelection => {
  const { playbackSteps, characterPlaybackSteps, activeAssemblyMode } = prepared;
  const currentStep =
    playbackSteps[Math.min(stepIndex, Math.max(0, playbackSteps.length - 1))];
  const currentCharacterStep =
    characterPlaybackSteps[
      Math.min(stepIndex, Math.max(0, characterPlaybackSteps.length - 1))
    ];
  const activeDisplayStep =
    activeAssemblyMode === "character" ? currentCharacterStep : currentStep;

  return {
    currentStep,
    currentCharacterStep,
    activeDisplayStep,
  };
};

export const buildAssemblyGuideModel = ({
  stepIndex,
  ...input
}: AssemblyGuideModelInput): AssemblyGuideModel => {
  const prepared = prepareAssemblyGuideModel(input);
  return {
    ...prepared,
    ...selectAssemblyGuideStep(prepared, stepIndex),
  };
};
