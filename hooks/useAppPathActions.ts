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
import { validatePath } from "../utils/project";
import { pathBelongsToTarget } from "../utils/pathTargets";
import { nextMotionPathId } from "../utils/motion";

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
      if (
        targetKind === "scene-object"
          ? project.sceneObjects[targetId]?.locked
          : project.parts[targetId]?.locked
      )
        return;
      const requested = pathId ? project.paths[pathId] : undefined;
      if (
        pathId &&
        (!requested || !pathBelongsToTarget(requested, targetKind, targetId, project))
      ) return;
      const existing = requested ?? (
        Object.values(project.paths) as ProjectMotionPath[]
      ).find((path) => pathBelongsToTarget(path, targetKind, targetId, project));
      const id =
        requested?.id ?? (project.selectedPathId &&
        project.paths[project.selectedPathId] &&
        pathBelongsToTarget(
          project.paths[project.selectedPathId],
          targetKind,
          targetId,
          project,
        )
          ? project.selectedPathId
          : (existing?.id ?? nextMotionPathId(project, targetId)));
      const current = project.paths[id];
      dispatch({
        type: "upsert_path",
        path: validatePath({
          id,
          partId: current?.partId ?? selectedPart?.id ?? "",
          sceneObjectId: current?.sceneObjectId ?? selectedSceneObject?.id,
          targetAnchorJointId: selectedSceneObject ? undefined : current?.targetAnchorJointId,
          chainRootJointId: selectedSceneObject ? undefined : current?.chainRootJointId,
          smoothness: current?.smoothness ?? 0,
          points,
          timedPoints:
            timedPoints ??
            points.map((p, i) => ({
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
