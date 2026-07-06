import type {
  BodyPartLayer,
  MechanismConfig,
  ProjectMotionPath,
  ProjectState,
  StandardSkeleton,
} from "../types";

export type PathTargetKind = "part" | "scene-object";

export const pathTargetKind = (path?: ProjectMotionPath): PathTargetKind =>
  path?.sceneObjectId ? "scene-object" : "part";

export const pathTargetId = (path?: ProjectMotionPath): string | undefined =>
  path?.sceneObjectId || path?.partId || undefined;

const partCanReachJoint = (
  part: BodyPartLayer | undefined,
  jointId: string | undefined,
  skeleton: StandardSkeleton | null | undefined,
) => {
  if (!part || !jointId) return false;
  if (part.anchorJointId === jointId) return true;
  const descendants = new Set<string>();
  const visit = (id: string) => {
    (skeleton?.hierarchy[id] ?? []).forEach((childId) => {
      if (!descendants.has(childId)) {
        descendants.add(childId);
        visit(childId);
      }
    });
  };
  visit(part.anchorJointId);
  return descendants.has(jointId);
};

export const partCanOwnPathTarget = (
  project: ProjectState | undefined,
  partId: string | undefined,
  path: ProjectMotionPath,
) => {
  if (!partId) return false;
  if (path.partId === partId) return true;
  if (!project) return false;
  const targetJointId = path.targetAnchorJointId ?? project.parts[path.partId]?.anchorJointId;
  return partCanReachJoint(project.parts[partId], targetJointId, project.skeleton);
};

export const pathBelongsToTarget = (
  path: ProjectMotionPath,
  kind: PathTargetKind,
  id?: string,
  project?: ProjectState,
) =>
  Boolean(id) &&
  (kind === "scene-object"
    ? path.sceneObjectId === id
    : !path.sceneObjectId && partCanOwnPathTarget(project, id, path));

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
