import type { AppStage, ProjectAction, ProjectState } from "../types";
import { handoffGate } from "./project";
import { projectMechanismReadiness } from "./mechanismReadiness";
import { hasHardReadinessBlockers } from "./fabricationReadiness";
import { recordStudyEvent } from "./studyTelemetry";

type NavigateAppStageOptions = {
  project: ProjectState;
  target: AppStage;
  dispatch: (action: ProjectAction) => void;
  setStage: (stage: AppStage) => void;
  setCommandStatus: (status: string) => void;
  stageLabel: (stage: AppStage) => string;
};

type StageNavigatorOptions = Omit<NavigateAppStageOptions, "target">;

// Project loads and recovery replace the aggregate before React can rebuild the
// gated navigator. Keep their telemetry in the same event family without
// evaluating the stale project's handoff gate.
export const recordStageNavigationOpened = (target: AppStage, source?: string) =>
  recordStudyEvent(
    "stage.navigation",
    { target, outcome: "opened", ...(source ? { source } : {}) },
    { level: "metrics", immediate: true },
  );

export const createStageNavigator =
  (options: StageNavigatorOptions) => (target: AppStage) =>
    navigateAppStage({ ...options, target });

export const navigateAppStage = ({
  project,
  target,
  dispatch,
  setStage,
  setCommandStatus,
  stageLabel,
}: NavigateAppStageOptions) => {
  const readiness = target === "blueprint" || target === "assembly"
    ? projectMechanismReadiness(project)
    : undefined;
  const blockedBlueprintOrAssembly =
    readiness?.status === "blocked" &&
    (target === "blueprint" || target === "assembly") &&
    hasHardReadinessBlockers(readiness.blockers);
  const gate = blockedBlueprintOrAssembly
    ? { ok: false as const, message: readiness.blockers[0], recoveryStage: "design" as const }
    : handoffGate(project, target);
  if (!gate.ok && "recoveryStage" in gate) {
    recordStudyEvent(
      "stage.navigation",
      { target, outcome: "blocked", recoveryStage: gate.recoveryStage },
      { level: "metrics", immediate: true },
    );
    dispatch({
      type: "set_processing",
      processing: {
        stage: "error",
        message: gate.message,
        progress: 0,
        error: gate.message,
      },
    });
    setCommandStatus(gate.message);
    setStage(gate.recoveryStage);
    return gate;
  }
  recordStageNavigationOpened(target);
  setCommandStatus(`Opened ${stageLabel(target)}`);
  setStage(target);
  return gate;
};
