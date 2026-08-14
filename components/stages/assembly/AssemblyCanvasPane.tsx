import { useMemo } from "react";
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
  withAssemblySceneProgress,
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
  playing,
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
  playing: boolean;
  hasCharacterAssembly: boolean;
}) => {
  const selectedMechanism = useMemo(
    () =>
      selectedRecipe
        ? project.mechanisms.find(
            (mechanism) => mechanism.id === selectedRecipe.mechanismId,
          )
        : undefined,
    [project.mechanisms, selectedRecipe],
  );
  const characterFrameBase = useMemo(
    () =>
      currentCharacterStep
        ? buildCharacterAssemblySceneFrame({
            plan: characterAssemblyPlan,
            step: currentCharacterStep,
            kit,
            progress: 0,
          })
        : undefined,
    [characterAssemblyPlan, currentCharacterStep, kit],
  );
  const mechanismFrameBase = useMemo(
    () =>
      selectedRecipe && currentStep && selectedMechanism
        ? buildMechanismAssemblySceneFrame({
            recipe: selectedRecipe,
            mechanism: selectedMechanism,
            project,
            step: currentStep,
            lane,
            kit,
            progress: 0,
          })
        : undefined,
    [selectedRecipe, currentStep, selectedMechanism, project, lane, kit],
  );
  const characterFrame = useMemo(
    () => withAssemblySceneProgress(characterFrameBase, progress),
    [characterFrameBase, progress],
  );
  const mechanismFrame = useMemo(
    () => withAssemblySceneProgress(mechanismFrameBase, progress),
    [mechanismFrameBase, progress],
  );

  return (
    <div
      className="assembly-canvas-document canvas-workspace"
      data-testid="assembly-canvas-preview"
    >
      {activeAssemblyMode === "character" && currentCharacterStep && characterFrameBase && characterFrame ? (
        <div className="assembly-simulation-stack" data-testid="assembly-character-simulation-stack">
          <AssemblyCharacterThreePreview
            project={project}
            step={currentCharacterStep}
            progress={progress}
            playing={playing}
            sceneFrame={characterFrameBase}
          />
          <AssemblySceneFrame frame={characterFrame} />
        </div>
      ) : selectedRecipe && currentStep && selectedMechanism && mechanismFrameBase && mechanismFrame ? (
        <div className="assembly-simulation-stack" data-testid="assembly-mechanism-simulation-stack">
          <AssemblyMechanismThreePreview
            project={project}
            mechanism={selectedMechanism}
            step={currentStep}
            progress={progress}
            playing={playing}
            sceneFrame={mechanismFrameBase}
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
