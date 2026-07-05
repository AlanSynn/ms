import type { AppStage, ProjectAction, ProjectState } from "../types";
import { handoffGate } from "./project";

type NavigateAppStageOptions = {
  project: ProjectState;
  target: AppStage;
  dispatch: (action: ProjectAction) => void;
  setStage: (stage: AppStage) => void;
  setCommandStatus: (status: string) => void;
  stageLabel: (stage: AppStage) => string;
};

type StageNavigatorOptions = Omit<NavigateAppStageOptions, "target">;

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
  const gate = handoffGate(project, target);
  if (!gate.ok && "recoveryStage" in gate) {
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
  setCommandStatus(`Opened ${stageLabel(target)}`);
  setStage(target);
  return gate;
};
