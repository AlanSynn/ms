import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { AssemblyCanvasPane } from "./AssemblyCanvasPane";
import { AssemblyControlPanel } from "./AssemblyControlPanel";
import { AssemblyInspectorPanel } from "./AssemblyInspectorPanel";
import {
  prepareAssemblyGuideModel,
  selectAssemblyGuideStep,
  type AssemblyGuideMode,
} from "./assemblyGuideModel";
import { useAssemblyGuidePlayback } from "./useAssemblyGuidePlayback";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";
import {
  EditorStageFrame,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import type { AppStage, ProjectState } from "../../../types";
import { buildPlanSourceDigest } from "../../../utils/buildPlan";
import { projectContentFingerprint } from "../../../utils/projectSerialization";
import {
  assemblyLaneForExportMode,
  type AssemblyLane,
} from "../../../utils/assemblyPlayback";

export const AssemblyGuide = ({
  project,
  goStage,
  stepIndex,
  setStepIndex,
  stepProgress,
  setStepProgress,
  playing,
  setPlaying,
  setStepCount,
  playbackClock,
}: {
  project: ProjectState;
  goStage: (stage: AppStage) => void;
  stepIndex: number;
  setStepIndex: Dispatch<SetStateAction<number>>;
  stepProgress: number;
  setStepProgress: Dispatch<SetStateAction<number>>;
  playing: boolean;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  setStepCount: Dispatch<SetStateAction<number>>;
  playbackClock: PlaybackClock;
}) => {
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [assemblyMode, setAssemblyMode] =
    useState<AssemblyGuideMode>("mechanism");
  const [lane, setLane] = useState<AssemblyLane>(() =>
    assemblyLaneForExportMode(project.settings.physicalKit.exportMode),
  );
  const sourceProjectFingerprint = projectContentFingerprint(project);
  const expectedBuildPlanDigest = buildPlanSourceDigest(project, "complete", lane);
  const pkg = project.lastExport?.sourceProjectFingerprint === sourceProjectFingerprint &&
    project.lastExport.buildPlanSourceDigest === expectedBuildPlanDigest
    ? project.lastExport
    : undefined;
  const preparedModel = useMemo(
    () =>
      prepareAssemblyGuideModel({
        project,
        pkg,
        selectedRecipeId,
        assemblyMode,
        lane,
      }),
    [project, pkg, selectedRecipeId, assemblyMode, lane],
  );
  const {
    recipes,
    selectedRecipe,
    selectedBuildMechanism,
    buildPlan,
    characterAssemblyPlan,
    hasCharacterAssembly,
    activeAssemblyMode,
    activePlaybackSteps,
    activeStepCount,
    resetKey,
  } = preparedModel;
  const { currentStep, currentCharacterStep, activeDisplayStep } = useMemo(
    () => selectAssemblyGuideStep(preparedModel, stepIndex),
    [preparedModel, stepIndex],
  );
  const { goAssemblyStep } = useAssemblyGuidePlayback({
    activeStepCount,
    resetKey,
    playing,
    setPlaying,
    setStepCount,
    setStepIndex,
    setStepProgress,
    playbackClock,
  });

  return (
    <EditorStageFrame
      stage="assembly"
      className="assembly-stage-frame"
      layout={{
        workflow: workflowPane(
          <AssemblyControlPanel
            project={project}
            goStage={goStage}
            activeAssemblyMode={activeAssemblyMode}
            setAssemblyMode={setAssemblyMode}
            hasCharacterAssembly={hasCharacterAssembly}
            recipes={recipes}
            selectedRecipe={selectedRecipe}
            setSelectedRecipeId={setSelectedRecipeId}
            lane={lane}
            setLane={setLane}
            activePlaybackSteps={activePlaybackSteps}
            stepIndex={stepIndex}
            goAssemblyStep={goAssemblyStep}
          />,
        ),
        canvas: canvasPane(
          <AssemblyCanvasPane
            project={project}
            activeAssemblyMode={activeAssemblyMode}
            characterAssemblyPlan={characterAssemblyPlan}
            currentCharacterStep={currentCharacterStep}
            selectedRecipe={selectedRecipe}
            selectedBuildMechanism={selectedBuildMechanism}
            buildPlanDigest={buildPlan.sourceDigest}
            currentStep={currentStep}
            lane={lane}
            kit={project.settings.physicalKit}
            progress={stepProgress}
            playing={playing}
            hasCharacterAssembly={hasCharacterAssembly}
            playbackClock={playbackClock}
          />,
        ),
        inspector: inspectorPane(
          <AssemblyInspectorPanel
            activeAssemblyMode={activeAssemblyMode}
            activeDisplayStep={activeDisplayStep}
            characterAssemblyPlan={characterAssemblyPlan}
            currentCharacterStep={currentCharacterStep}
            selectedRecipe={selectedRecipe}
            selectedMechanism={selectedBuildMechanism?.mechanism}
            currentStep={currentStep}
            assessmentKey={project.settings.classroomAssessmentKey}
            goStage={goStage}
          />,
        ),
      }}
    />
  );
};
