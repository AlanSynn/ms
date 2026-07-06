import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { AssemblyCanvasPane } from "./AssemblyCanvasPane";
import { AssemblyControlPanel } from "./AssemblyControlPanel";
import { AssemblyInspectorPanel } from "./AssemblyInspectorPanel";
import {
  buildAssemblyGuideModel,
  type AssemblyGuideMode,
} from "./assemblyGuideModel";
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
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [assemblyMode, setAssemblyMode] =
    useState<AssemblyGuideMode>("mechanism");
  const [lane, setLane] = useState<AssemblyLane>(() =>
    assemblyLaneForExportMode(project.settings.physicalKit.exportMode),
  );
  const {
    recipes,
    selectedRecipe,
    characterAssemblyPlan,
    hasCharacterAssembly,
    activeAssemblyMode,
    activePlaybackSteps,
    activeStepCount,
    currentStep,
    currentCharacterStep,
    activeDisplayStep,
    resetKey,
  } = useMemo(
    () =>
      buildAssemblyGuideModel({
        project,
        pkg,
        selectedRecipeId,
        assemblyMode,
        lane,
        stepIndex,
      }),
    [project, pkg, selectedRecipeId, assemblyMode, lane, stepIndex],
  );
  const { goAssemblyStep } = useAssemblyGuidePlayback({
    activeStepCount,
    resetKey,
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
  const downloadCharacterPdf = () =>
    pkg &&
    downloadText(
      `${pkg.id}-character-sheet.pdf`,
      pkg.customPartsPdf,
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
            onDownloadCharacterPdf={downloadCharacterPdf}
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
            currentStep={currentStep}
            lane={lane}
            kit={project.settings.physicalKit}
            progress={stepProgress}
            playing={playing}
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
            assessmentKey={project.settings.classroomAssessmentKey}
            goStage={goStage}
          />,
        ),
      }}
    />
  );
};
