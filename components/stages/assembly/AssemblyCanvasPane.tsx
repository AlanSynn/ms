import { AssemblySceneFrame } from "./AssemblySceneFrame";
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
import {
  buildCharacterAssemblySceneFrame,
  buildMechanismAssemblySceneFrame,
} from "../../../utils/assemblySceneFrame";

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
}) => {
  const selectedMechanism = selectedRecipe
    ? project.mechanisms.find(
        (mechanism) => mechanism.id === selectedRecipe.mechanismId,
      )
    : undefined;
  const characterFrame = currentCharacterStep
    ? buildCharacterAssemblySceneFrame({
        plan: characterAssemblyPlan,
        step: currentCharacterStep,
        kit,
        progress,
      })
    : undefined;
  const mechanismFrame =
    selectedRecipe && currentStep && selectedMechanism
      ? buildMechanismAssemblySceneFrame({
          recipe: selectedRecipe,
          mechanism: selectedMechanism,
          step: currentStep,
          lane,
          kit,
          progress,
        })
      : undefined;

  return (
    <div
      className="assembly-canvas-document canvas-workspace"
      data-testid="assembly-canvas-preview"
    >
      {activeAssemblyMode === "character" && currentCharacterStep && characterFrame ? (
        <div className="assembly-simulation-stack" data-testid="assembly-character-simulation-stack">
          <AssemblyCharacterThreePreview
            project={project}
            plan={characterAssemblyPlan}
            step={currentCharacterStep}
            progress={progress}
            sceneFrame={characterFrame}
          />
          <AssemblySceneFrame frame={characterFrame} />
        </div>
      ) : selectedRecipe && currentStep && selectedMechanism && mechanismFrame ? (
        <div className="assembly-simulation-stack" data-testid="assembly-mechanism-simulation-stack">
          <AssemblyMechanismThreePreview
            project={project}
            mechanism={selectedMechanism}
            step={currentStep}
            progress={progress}
            sceneFrame={mechanismFrame}
          />
          <AssemblySceneFrame frame={mechanismFrame} />
        </div>
      ) : (
        <div className="blueprint-empty-state">
          {hasCharacterAssembly ? "Choose Character." : "Add a character first."}
        </div>
      )}
    </div>
  );
};
