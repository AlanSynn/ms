import {
  AssemblyWorkbench,
  CharacterAssemblyWorkbench,
} from "./AssemblyWorkbench";
import {
  AssemblyCharacterThreePreview,
  AssemblyMechanismThreePreview,
} from "./AssemblyThreePreview";
import type {
  FabricationRecipe,
  PhysicalKitSettings,
  ProjectState,
} from "../../../types";
import type {
  AssemblyLane,
  AssemblyPlaybackStep,
  CharacterAssemblyPlan,
  CharacterAssemblyStep,
} from "../../../utils/assemblyPlayback";

type AssemblyMode = "mechanism" | "character";

export const AssemblyCanvasPane = ({
  project,
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
  project: ProjectState;
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
      <div className="assembly-simulation-stack" data-testid="assembly-character-simulation-stack">
        <AssemblyCharacterThreePreview
          project={project}
          plan={characterAssemblyPlan}
          step={currentCharacterStep}
          progress={progress}
        />
        <CharacterAssemblyWorkbench
          plan={characterAssemblyPlan}
          step={currentCharacterStep}
          kit={kit}
          progress={progress}
        />
      </div>
    ) : selectedRecipe && currentStep ? (
      <div className="assembly-simulation-stack" data-testid="assembly-mechanism-simulation-stack">
        {project.mechanisms.find(
          (mechanism) => mechanism.id === selectedRecipe.mechanismId,
        ) && (
          <AssemblyMechanismThreePreview
            project={project}
            mechanism={
              project.mechanisms.find(
                (mechanism) => mechanism.id === selectedRecipe.mechanismId,
              )!
            }
            step={currentStep}
            progress={progress}
          />
        )}
        <AssemblyWorkbench
          recipe={selectedRecipe}
          lane={lane}
          step={currentStep}
          kit={kit}
          progress={progress}
        />
      </div>
    ) : (
      <div className="blueprint-empty-state">
        {hasCharacterAssembly ? "Choose Character." : "Add a character first."}
      </div>
    )}
  </div>
);
