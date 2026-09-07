import { useCallback, useState } from "react";
import type {
  AppStage,
  BodyPartLayer,
  Point,
  ProjectAction,
  ProjectMotionPath,
  SceneObject,
  ProjectState,
} from "../types";
import { motionPathWithPoints } from "../utils/pathEditing";

type UseAppPathActionsParams = {
  project: ProjectState;
  selectedPart?: BodyPartLayer;
  selectedSceneObject?: SceneObject;
  dispatch: (action: ProjectAction) => void;
  setStage: (stage: AppStage) => void;
};

export const useAppPathActions = ({
  project,
  selectedPart,
  selectedSceneObject,
  dispatch,
  setStage,
}: UseAppPathActionsParams) => {
  const [drawMode, setDrawMode] = useState(false);
  const [showTracking, setShowTracking] = useState(false);

  const setPathPoints = useCallback(
    (
      points: Point[],
      source: ProjectMotionPath["source"] = "drawn",
      timedPoints?: ProjectMotionPath["timedPoints"],
      pathId?: string,
    ) => {
      const targetKind = selectedSceneObject ? "scene-object" : "part";
      const targetId = selectedSceneObject?.id ?? selectedPart?.id;
      if (!targetId) return;
      const path = motionPathWithPoints(project, targetKind, targetId, points, source, timedPoints, pathId);
      if (path) dispatch({ type: "upsert_path", path });
    },
    [dispatch, project, selectedPart?.id, selectedSceneObject?.id],
  );

  const transferTrackedPath = useCallback(
    (path: Point[]) => {
      setPathPoints(path, "tracked");
      setShowTracking(false);
      setStage("path");
    },
    [setPathPoints, setStage],
  );

  return {
    drawMode,
    setDrawMode,
    showTracking,
    setShowTracking,
    setPathPoints,
    openTracking: () => setShowTracking(true),
    closeTracking: () => setShowTracking(false),
    transferTrackedPath,
  };
};
