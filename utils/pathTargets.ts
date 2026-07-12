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

export const partCanOwnPathTarget = (
  _project: ProjectState | undefined,
  partId: string | undefined,
  path: ProjectMotionPath,
) => Boolean(partId) && !path.sceneObjectId && path.partId === partId;

export const pathBelongsToTarget = (
  path: ProjectMotionPath,
  kind: PathTargetKind,
  id?: string,
  project?: ProjectState,
) =>
  Boolean(id) &&
  (kind === "scene-object"
    ? path.sceneObjectId === id
    : partCanOwnPathTarget(project, id, path));


export const pathOwnedTargetFields = (path: ProjectMotionPath) => ({
  targetPartId: path.sceneObjectId ? undefined : path.partId,
  targetSceneObjectId: path.sceneObjectId,
  targetPathId: path.id,
  targetAnchorJointId: path.sceneObjectId ? undefined : path.targetAnchorJointId,
  activeVisualPartIds: path.sceneObjectId ? [] : [path.partId],
});

export type MechanismTargetFields = Pick<
  MechanismConfig,
  | "targetPartId"
  | "targetSceneObjectId"
  | "targetPathId"
  | "targetAnchorJointId"
>;

export const mechanismMatchesTargetFields = (
  mechanism: MechanismConfig,
  target: MechanismTargetFields,
) =>
  mechanism.targetPartId === target.targetPartId &&
  mechanism.targetSceneObjectId === target.targetSceneObjectId &&
  mechanism.targetPathId === target.targetPathId &&
  (Boolean(target.targetSceneObjectId) ||
    mechanism.targetAnchorJointId === target.targetAnchorJointId);

export const mechanismForTargetFields = (
  project: ProjectState,
  target: MechanismTargetFields,
) =>
  project.mechanisms.find((mechanism) =>
    mechanismMatchesTargetFields(mechanism, target),
  );

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
  project?: ProjectState,
) =>
  path.sceneObjectId
    ? mechanism.targetSceneObjectId === path.sceneObjectId
    : partCanOwnPathTarget(project, mechanism.targetPartId, path);
