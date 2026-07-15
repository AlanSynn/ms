import type {
  AppStage,
  BodyPartLayer,
  ProjectMotionPath,
  ProjectState,
} from "../types";
import { projectMechanismReadiness } from "./mechanismReadiness";
import { hasHardReadinessBlockers } from "./fabricationReadiness";

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
  const readiness = stage === "blueprint" || stage === "assembly"
    ? projectMechanismReadiness(project)
    : undefined;
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
    blocker = readiness?.blockers[0] ?? "OK";
    const isHardBlocker = readiness?.status === "blocked" &&
      hasHardReadinessBlockers(readiness.blockers);
    nextAction = isHardBlocker ? "Fix" : "Make sheets";
  } else if (stage === "assembly") {
    blocker = readiness?.blockers[0] ?? "OK";
    const isHardBlocker = readiness?.status === "blocked" &&
      hasHardReadinessBlockers(readiness.blockers);
    nextAction = isHardBlocker ? "Fix blueprint" : "Build";
  } else if (stage === "options") {
    nextAction = "Tune settings";
  } else {
    nextAction = "Choose starter";
  }
  return { stageLabel, blocker, nextAction };
};
