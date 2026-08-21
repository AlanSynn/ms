import type { FabricationPackage, FabricationRecipe, ProjectState } from "../../../types";
import {
  buildAssemblyPlaybackSteps,
  buildCharacterAssemblyPlan,
  pendingRecipeForMechanism,
  type AssemblyLane,
  type AssemblyPlaybackStep,
  type CharacterAssemblyPlan,
  type CharacterAssemblyStep,
} from "../../../utils/assemblyPlayback";

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
  recipes: FabricationRecipe[];
  selectedRecipe?: FabricationRecipe;
  characterAssemblyPlan: CharacterAssemblyPlan;
  hasCharacterAssembly: boolean;
  activeAssemblyMode: AssemblyGuideMode;
  playbackSteps: AssemblyPlaybackStep[];
  characterPlaybackSteps: CharacterAssemblyStep[];
  activePlaybackSteps: Array<AssemblyPlaybackStep | CharacterAssemblyStep>;
  activeStepCount: number;
  resetKey: string;
};

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
  const recipes = liveRecipes.length ? liveRecipes : (pkg?.recipes ?? []);
  const selectedRecipe =
    recipes.find((recipe) => recipe.mechanismId === selectedRecipeId) ??
    recipes.find((recipe) => recipe.mechanismId === project.selectedMechanismId) ??
    recipes[0];
  const characterAssemblyPlan = buildCharacterAssemblyPlan(project);
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
  const playbackSteps = selectedRecipe
    ? buildAssemblyPlaybackSteps(selectedRecipe, lane)
    : [];
  const characterPlaybackSteps = characterAssemblyPlan.steps;
  const activePlaybackSteps =
    activeAssemblyMode === "character" ? characterPlaybackSteps : playbackSteps;
  const activeStepCount = activePlaybackSteps.length;

  return {
    recipes,
    selectedRecipe,
    characterAssemblyPlan,
    hasCharacterAssembly,
    activeAssemblyMode,
    playbackSteps,
    characterPlaybackSteps,
    activePlaybackSteps,
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
