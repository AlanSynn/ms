import { useCallback, useState } from "react";
import type {
  AppStage,
  BodyPartLayer,
  Point,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
} from "../types";
import { validatePath } from "../utils/project";

type UseAppPathActionsParams = {
  project: ProjectState;
  selectedPart?: BodyPartLayer;
  dispatch: (action: ProjectAction) => void;
  setStage: (stage: AppStage) => void;
};

export const useAppPathActions = ({
  project,
  selectedPart,
  dispatch,
  setStage,
}: UseAppPathActionsParams) => {
  const [drawMode, setDrawMode] = useState(false);
  const [showTracking, setShowTracking] = useState(false);

  const setPathPoints = useCallback(
    (points: Point[], source: ProjectMotionPath["source"] = "drawn") => {
      const partId = selectedPart?.id;
      if (!partId || project.parts[partId]?.locked) return;
      const existing = (
        Object.values(project.paths) as ProjectMotionPath[]
      ).find((path) => path.partId === partId);
      const id =
        project.selectedPathId &&
        project.paths[project.selectedPathId]?.partId === partId
          ? project.selectedPathId
          : (existing?.id ?? `path-${partId}`);
      const current = project.paths[id];
      dispatch({
        type: "upsert_path",
        path: validatePath({
          id,
          partId,
          targetAnchorJointId: current?.targetAnchorJointId,
          chainRootJointId: current?.chainRootJointId,
          smoothness: current?.smoothness ?? 0,
          points,
          timedPoints: points.map((p, i) => ({
            ...p,
            time:
              points.length <= 1
                ? 0
                : (i / (points.length - 1)) *
                  (current?.duration ?? project.settings.animationDurationMs),
          })),
          duration: current?.duration ?? project.settings.animationDurationMs,
          closed: current?.closed ?? true,
          enabled: current?.enabled ?? true,
          visible: current?.visible ?? true,
          source,
          warnings: [],
        }),
      });
    },
    [dispatch, project, selectedPart?.id],
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
