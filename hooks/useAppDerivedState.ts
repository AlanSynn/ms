import { useMemo } from "react";
import type {
  BodyPartLayer,
  GlobalConfig,
  MechanismConfig,
  ProjectMotionPath,
  SceneObject,
  ProjectState,
} from "../types";
import {
  motionPathsInProjectOrder,
  playableMotionPaths,
  sharedMotionPlaybackDurationMs,
} from "../utils/motion";

const isBodyPart = (part: BodyPartLayer | undefined): part is BodyPartLayer =>
  Boolean(part);

export interface AppDerivedState {
  sortedParts: BodyPartLayer[];
  motionPaths: ProjectMotionPath[];
  activeMotionPaths: ProjectMotionPath[];
  selectedPart?: BodyPartLayer;
  selectedSceneObject?: SceneObject;
  selectedPath?: ProjectMotionPath;
  selectedMechanism?: MechanismConfig;
  playbackDurationMs: number;
  mechanismConfig: GlobalConfig;
}

export const useAppDerivedState = (project: ProjectState): AppDerivedState => {
  const sortedParts = useMemo(
    () => project.partOrder.map((id) => project.parts[id]).filter(isBodyPart),
    [project.parts, project.partOrder],
  );
  const selectedSceneObject = project.selectedSceneObjectId
    ? project.sceneObjects[project.selectedSceneObjectId]
    : undefined;
  const selectedPart = project.selectedPartId
    ? project.parts[project.selectedPartId]
    : selectedSceneObject
      ? undefined
      : sortedParts[0];
  const selectedPath = useMemo(() => {
    if (selectedSceneObject) {
      const current = project.selectedPathId
        ? project.paths[project.selectedPathId]
        : undefined;
      return current?.sceneObjectId === selectedSceneObject.id
        ? current
        : (Object.values(project.paths) as ProjectMotionPath[]).find(
            (path) => path.sceneObjectId === selectedSceneObject.id,
          );
    }
    if (!selectedPart) return undefined;
    const current = project.selectedPathId
      ? project.paths[project.selectedPathId]
      : undefined;
    return !current?.sceneObjectId && current?.partId === selectedPart.id
      ? current
      : (Object.values(project.paths) as ProjectMotionPath[]).find(
          (path) => !path.sceneObjectId && path.partId === selectedPart.id,
        );
  }, [project.paths, project.selectedPathId, selectedPart, selectedSceneObject]);
  const selectedMechanism =
    project.mechanisms.find((m) => m.id === project.selectedMechanismId) ??
    project.mechanisms[0];
  const motionPaths = useMemo(
    () => motionPathsInProjectOrder(project),
    [project.paths],
  );
  const activeMotionPaths = useMemo(
    () => playableMotionPaths(project, motionPaths),
    [motionPaths, project.parts, project.sceneObjects],
  );
  const playbackDurationMs = sharedMotionPlaybackDurationMs(
    project,
    activeMotionPaths,
  );
  const mechanismConfig: GlobalConfig = useMemo(
    () => ({
      speed: project.settings.animationSpeed,
      rotation: 0,
      mechanisms: project.mechanisms,
    }),
    [project.settings.animationSpeed, project.mechanisms],
  );

  return {
    sortedParts,
    motionPaths,
    activeMotionPaths,
    selectedPart,
    selectedSceneObject,
    selectedPath,
    selectedMechanism,
    playbackDurationMs,
    mechanismConfig,
  };
};
