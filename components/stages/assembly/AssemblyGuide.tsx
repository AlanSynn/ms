import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { AssemblyCanvasPane } from "./AssemblyCanvasPane";
import { AssemblyControlPanel } from "./AssemblyControlPanel";
import { AssemblyInspectorPanel } from "./AssemblyInspectorPanel";
import { useAssemblyGuidePlayback } from "./useAssemblyGuidePlayback";
import {
  EditorStageFrame,
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
  validateForFabrication,
} from "../../../utils/fabrication";

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
  const playbackSteps = selectedRecipe
    ? buildAssemblyPlaybackSteps(selectedRecipe, lane)
    : [];
  const characterPlaybackSteps = characterAssemblyPlan.steps;
  const activePlaybackSteps =
    activeAssemblyMode === "character" ? characterPlaybackSteps : playbackSteps;
  const activeStepCount = activePlaybackSteps.length;
  const currentStep =
    playbackSteps[Math.min(stepIndex, Math.max(0, playbackSteps.length - 1))];
  const currentCharacterStep =
    characterPlaybackSteps[
      Math.min(stepIndex, Math.max(0, characterPlaybackSteps.length - 1))
    ];
  const activeDisplayStep =
    activeAssemblyMode === "character" ? currentCharacterStep : currentStep;
  const { goAssemblyStep } = useAssemblyGuidePlayback({
    activeStepCount,
    resetKey: `${activeAssemblyMode}:${selectedRecipe?.mechanismId ?? "none"}:${lane}`,
    playing,
    setPlaying,
    setStepCount,
    setStepIndex,
    setStepProgress,
  });

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
          <AssemblyControlPanel
            project={project}
            goStage={goStage}
            validationErrorCount={validation.errors.length}
            packageReady={!!pkg}
            onCreate={create}
            onPrint={printGuide}
            onDownloadPdf={downloadAssemblyPdf}
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
            activeAssemblyMode={activeAssemblyMode}
            characterAssemblyPlan={characterAssemblyPlan}
            currentCharacterStep={currentCharacterStep}
            selectedRecipe={selectedRecipe}
            currentStep={currentStep}
            lane={lane}
            kit={project.settings.physicalKit}
            progress={stepProgress}
            hasCharacterAssembly={hasCharacterAssembly}
          />,
        ),
        inspector: inspectorPane(
          <AssemblyInspectorPanel
            activeAssemblyMode={activeAssemblyMode}
            activeDisplayStep={activeDisplayStep}
            characterAssemblyPlan={characterAssemblyPlan}
            currentCharacterStep={currentCharacterStep}
            selectedRecipe={selectedRecipe}
            currentStep={currentStep}
            goStage={goStage}
          />,
        ),
      }}
    />
  );
};
