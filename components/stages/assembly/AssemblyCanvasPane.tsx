import { AssemblySceneFrame } from "./AssemblySceneFrame";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";
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
  playing,
  hasCharacterAssembly,
  playbackClock,
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
  playbackClock: PlaybackClock;
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
            step={currentCharacterStep}
            progress={progress}
            playing={playing}
            sceneFrame={characterFrame}
            playbackClock={playbackClock}
          />
          <AssemblySceneFrame frame={characterFrame} playbackClock={playbackClock} />
        </div>
      ) : selectedRecipe && currentStep && selectedMechanism && mechanismFrame ? (
        <div className="assembly-simulation-stack" data-testid="assembly-mechanism-simulation-stack">
          <AssemblyMechanismThreePreview
            project={project}
            mechanism={selectedMechanism}
            step={currentStep}
            progress={progress}
            playing={playing}
            sceneFrame={mechanismFrame}
            playbackClock={playbackClock}
          />
          <AssemblySceneFrame frame={mechanismFrame} playbackClock={playbackClock} />
        </div>
      ) : (
        <div className="blueprint-empty-state">
          {hasCharacterAssembly ? "Choose Character." : "Add a character first."}
        </div>
      )}
    </div>
  );
};
