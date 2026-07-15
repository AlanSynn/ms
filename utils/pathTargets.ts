import type {
  MechanismConfig,
  MechanismRecoveryCandidates,
  ProjectMotionPath,
  ProjectState,
} from "../types";
import { motionAnchorJointIds } from "./motionTargetSelection";

export const MECHANISM_BINDING_BLOCKER = "Fix: Choose anchor" as const;

export type MechanismTargetBindingAssessment = {
  valid: boolean;
  blocker?: typeof MECHANISM_BINDING_BLOCKER;
  activeVisualPartIds: string[];
  driverKey?: string;
  recoveryCandidates: MechanismRecoveryCandidates;
};

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

const sortedUnique = (values: Array<string | undefined>) =>
  [...new Set(values.filter((value): value is string => Boolean(value)))].sort();

const jointChainContains = (
  project: ProjectState,
  rootJointId: string,
  targetJointId: string,
) => {
  if (!project.skeleton?.joints[rootJointId] || !project.skeleton.joints[targetJointId]) return false;
  for (let current: string | null | undefined = targetJointId; current; current = project.skeleton.joints[current]?.parentId) {
    if (current === rootJointId) return true;
  }
  return false;
};

const compatiblePaths = (project: ProjectState) =>
  Object.values(project.paths).filter((path) => {
    if (!pathOwnerExists(project, path)) return false;
    if (path.sceneObjectId) return true;
    const anchors = motionAnchorJointIds(project, path.partId);
    if (!anchors.length) return false;
    const anchor = path.targetAnchorJointId;
    if (anchor && !anchors.includes(anchor)) return false;
    return !path.chainRootJointId || jointChainContains(
      project,
      path.chainRootJointId,
      anchor ?? project.parts[path.partId]?.anchorJointId ?? "",
    );
  });

const recoveryCandidatesFor = (
  project: ProjectState,
  mechanism: MechanismConfig,
): MechanismRecoveryCandidates => {
  const paths = compatiblePaths(project);
  const targetPartIds = sortedUnique(paths.map((path) => path.sceneObjectId ? undefined : path.partId));
  const existingPartId = mechanism.targetPartId && project.parts[mechanism.targetPartId]
    ? mechanism.targetPartId
    : undefined;
  const existingObjectId = mechanism.targetSceneObjectId && project.sceneObjects[mechanism.targetSceneObjectId]
    ? mechanism.targetSceneObjectId
    : undefined;
  const ownerPaths = existingPartId
    ? paths.filter((path) => !path.sceneObjectId && path.partId === existingPartId)
    : existingObjectId
      ? paths.filter((path) => path.sceneObjectId === existingObjectId)
      : paths;
  const pathOwnerPartId = mechanism.targetPathId && project.paths[mechanism.targetPathId] && !project.paths[mechanism.targetPathId].sceneObjectId
    ? project.paths[mechanism.targetPathId].partId
    : undefined;
  const anchorPartIds = existingPartId
    ? [existingPartId]
    : pathOwnerPartId && project.parts[pathOwnerPartId]
      ? [pathOwnerPartId]
      : targetPartIds;
  return {
    targetPartIds,
    targetSceneObjectIds: sortedUnique(paths.map((path) => path.sceneObjectId)),
    targetPathIds: sortedUnique(ownerPaths.map((path) => path.id)),
    targetAnchorJointIds: sortedUnique(
      anchorPartIds.flatMap((partId) => motionAnchorJointIds(project, partId)),
    ),
  };
};

export const assessMechanismTargetBinding = (
  project: ProjectState,
  mechanism: MechanismConfig,
): MechanismTargetBindingAssessment => {
  const recoveryCandidates = recoveryCandidatesFor(project, mechanism);
  const part = mechanism.targetPartId ? project.parts[mechanism.targetPartId] : undefined;
  const object = mechanism.targetSceneObjectId
    ? project.sceneObjects[mechanism.targetSceneObjectId]
    : undefined;
  const hasPartTarget = Boolean(part) && !mechanism.targetSceneObjectId;
  const hasObjectTarget = Boolean(object) && !mechanism.targetPartId;
  const path = mechanism.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
  const reject = (): MechanismTargetBindingAssessment => ({
    valid: false,
    blocker: MECHANISM_BINDING_BLOCKER,
    activeVisualPartIds: [],
    recoveryCandidates,
  });

  if (hasPartTarget === hasObjectTarget || !path || !mechanismMatchesPathOwner(mechanism, path, project)) {
    return reject();
  }
  if (hasObjectTarget) {
    if (!path.sceneObjectId || mechanism.targetAnchorJointId) return reject();
    return {
      valid: true,
      activeVisualPartIds: [],
      driverKey: `object:${object!.id}`,
      recoveryCandidates,
    };
  }

  const anchor = mechanism.targetAnchorJointId;
  const anchors = motionAnchorJointIds(project, part!.id);
  if (
    !anchor ||
    !anchors.includes(anchor) ||
    (path.targetAnchorJointId !== undefined && path.targetAnchorJointId !== anchor) ||
    (path.chainRootJointId !== undefined && !jointChainContains(project, path.chainRootJointId, anchor))
  ) {
    return reject();
  }
  const rootJointId = path.chainRootJointId ?? part!.anchorJointId;
  return {
    valid: true,
    activeVisualPartIds: [part!.id],
    driverKey: `character:${rootJointId}:${anchor}`,
    recoveryCandidates,
  };
};
