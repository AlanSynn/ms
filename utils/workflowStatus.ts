import type {
  AppStage,
  BodyPartLayer,
  ProjectMotionPath,
  ProjectState,
} from "../types";
import { validateForFabrication } from "./fabricationValidation";
import { resolvedMechanismOutputBindings } from "./mechanismBindings";

export type WorkflowStatus = {
  stageLabel: string;
  blocker: string;
  nextAction: string;
};

export const workflowStatusFor = (
  stage: AppStage,
  stageLabel: string,
  project: ProjectState,
  selectedTarget?: Pick<BodyPartLayer, "name" | "locked">,
  selectedPath?: ProjectMotionPath,
): WorkflowStatus => {
  const enabledMechanisms = project.mechanisms.filter(
    (mechanism) => mechanism.visible && mechanism.enabled !== false,
  );
  let blocker = "OK";
  let nextAction = "Keep going";
  if (stage === "project") {
    nextAction = "Save or open";
  } else if (!project.partOrder.length && !project.sceneObjectOrder.some(id => project.sceneObjects[id])) {
    blocker = "No character";
    nextAction = "Load character";
  } else if (stage === "path") {
    blocker = selectedTarget?.locked
      ? `${selectedTarget.name} locked`
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
    const bindingIssue = enabledMechanisms
      .map((mechanism) => {
        const bindings = resolvedMechanismOutputBindings(project, mechanism)
          .filter((binding) => binding.enabled !== false);
        if (!bindings.some((binding) => Boolean(project.paths[binding.pathId]))) {
          return "No path";
        }
        const hasTarget = bindings.some((binding) =>
          binding.targetSceneObjectId
            ? Boolean(project.sceneObjects[binding.targetSceneObjectId])
            : binding.targetPartId
              ? Boolean(project.parts[binding.targetPartId])
              : false,
        );
        return hasTarget ? undefined : "No target";
      })
      .find((issue) => issue !== undefined);
    if (!enabledMechanisms.length) {
      blocker = "No mechanism";
      nextAction = "Pick mechanism";
    } else if (bindingIssue) {
      blocker = bindingIssue;
      nextAction = bindingIssue === "No path" ? "Choose path" : "Choose target";
    } else {
      blocker = "OK";
      nextAction = "Tune motion";
    }
  } else if (stage === "blueprint") {
    const validation = validateForFabrication(project);
    blocker = validation.errors[0] ?? validation.warnings[0] ?? "OK";
    nextAction = validation.errors.length ? "Fix" : "Download PDF";
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
