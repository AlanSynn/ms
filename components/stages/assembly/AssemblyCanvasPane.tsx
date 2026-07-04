import {
  AssemblyWorkbench,
  CharacterAssemblyWorkbench,
} from "./AssemblyWorkbench";
import type { FabricationRecipe, PhysicalKitSettings } from "../../../types";
import type {
  AssemblyLane,
  AssemblyPlaybackStep,
  CharacterAssemblyPlan,
  CharacterAssemblyStep,
} from "../../../utils/assemblyPlayback";

type AssemblyMode = "mechanism" | "character";

export const AssemblyCanvasPane = ({
  activeAssemblyMode,
  characterAssemblyPlan,
  currentCharacterStep,
  selectedRecipe,
  currentStep,
  lane,
  kit,
  progress,
  hasCharacterAssembly,
}: {
  activeAssemblyMode: AssemblyMode;
  characterAssemblyPlan: CharacterAssemblyPlan;
  currentCharacterStep?: CharacterAssemblyStep;
  selectedRecipe?: FabricationRecipe;
  currentStep?: AssemblyPlaybackStep;
  lane: AssemblyLane;
  kit: PhysicalKitSettings;
  progress: number;
  hasCharacterAssembly: boolean;
}) => (
  <div
    className="assembly-canvas-document canvas-workspace"
    data-testid="assembly-canvas-preview"
  >
    {activeAssemblyMode === "character" && currentCharacterStep ? (
      <CharacterAssemblyWorkbench
        plan={characterAssemblyPlan}
        step={currentCharacterStep}
        kit={kit}
        progress={progress}
      />
    ) : selectedRecipe && currentStep ? (
      <AssemblyWorkbench
        recipe={selectedRecipe}
        lane={lane}
        step={currentStep}
        kit={kit}
        progress={progress}
      />
    ) : (
      <div className="blueprint-empty-state">
        {hasCharacterAssembly ? "Choose Character." : "Add a character first."}
      </div>
    )}
  </div>
);
