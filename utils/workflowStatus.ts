import type {
  AppStage,
  BodyPartLayer,
  ProjectMotionPath,
  ProjectState,
} from "../types";
import { validateForFabrication } from "./fabrication";

export type WorkflowStatus = {
  stageLabel: string;
  blocker: string;
  nextAction: string;
};

export const workflowStatusFor = (
  stage: AppStage,
  stageLabel: string,
  project: ProjectState,
  selectedPart?: BodyPartLayer,
  selectedPath?: ProjectMotionPath,
): WorkflowStatus => {
  const enabledMechanisms = project.mechanisms.filter(
    (mechanism) => mechanism.visible && mechanism.enabled !== false,
  );
  let blocker = "OK";
  let nextAction = "Keep going";
  if (!project.partOrder.length) {
    blocker = "No character";
    nextAction = "Load character";
  } else if (stage === "path") {
    blocker = selectedPart?.locked
      ? `${selectedPart.name} locked`
      : selectedPath && selectedPath.points.length >= 3
        ? "OK"
        : "Need 3 points";
    nextAction =
      selectedPath && selectedPath.points.length >= 3
        ? "Open Foundry"
        : "Draw path";
  } else if (stage === "foundry") {
    blocker =
      selectedPath && selectedPath.points.length >= 3 ? "OK" : "No path";
    nextAction =
      selectedPath && selectedPath.points.length >= 3
        ? "Pick one"
        : "Draw path";
  } else if (stage === "design") {
    blocker = enabledMechanisms.length ? "OK" : "No mechanism";
    nextAction = enabledMechanisms.length ? "Check target" : "Pick mechanism";
  } else if (stage === "blueprint") {
    const validation = validateForFabrication(project);
    blocker = validation.errors[0] ?? validation.warnings[0] ?? "OK";
    nextAction = validation.errors.length ? "Fix" : "Make sheets";
  } else if (stage === "assembly") {
    const validation = validateForFabrication(project);
    blocker = validation.errors[0] ?? validation.warnings[0] ?? "OK";
    nextAction = validation.errors.length ? "Fix blueprint" : "Build";
  } else if (stage === "options") {
    nextAction = "Tune settings";
  } else {
    nextAction = "Choose starter";
  }
  return { stageLabel, blocker, nextAction };
};
