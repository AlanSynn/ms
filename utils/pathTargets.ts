import type {
  MechanismConfig,
  ProjectMotionPath,
  ProjectState,
} from "../types";

export type PathTargetKind = "part" | "scene-object";

export const pathTargetKind = (path?: ProjectMotionPath): PathTargetKind =>
  path?.sceneObjectId ? "scene-object" : "part";

export const pathTargetId = (path?: ProjectMotionPath): string | undefined =>
  path?.sceneObjectId || path?.partId || undefined;

export const pathBelongsToTarget = (
  path: ProjectMotionPath,
  kind: PathTargetKind,
  id?: string,
) =>
  Boolean(id) &&
  (kind === "scene-object"
    ? path.sceneObjectId === id
    : !path.sceneObjectId && path.partId === id);

export const pathOwnerExists = (project: ProjectState, path: ProjectMotionPath) =>
  path.sceneObjectId
    ? Boolean(project.sceneObjects[path.sceneObjectId])
    : Boolean(project.parts[path.partId]);

export const pathOwnerLabel = (project: ProjectState, path: ProjectMotionPath) =>
  path.sceneObjectId
    ? (project.sceneObjects[path.sceneObjectId]?.name ?? "Object")
    : (project.parts[path.partId]?.name ?? "Part");

export const mechanismTargetKind = (
  mechanism?: MechanismConfig,
): PathTargetKind =>
  mechanism?.targetSceneObjectId ? "scene-object" : "part";

export const mechanismTargetId = (
  mechanism?: MechanismConfig,
): string | undefined =>
  mechanism?.targetSceneObjectId || mechanism?.targetPartId || undefined;

export const mechanismMatchesPathOwner = (
  mechanism: MechanismConfig,
  path: ProjectMotionPath,
) =>
  path.sceneObjectId
    ? mechanism.targetSceneObjectId === path.sceneObjectId
    : mechanism.targetPartId === path.partId;
