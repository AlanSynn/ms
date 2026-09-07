import type {
  BodyPartLayer,
  MechanismConfig,
  ProjectMotionPath,
  ProjectState,
  StandardSkeleton,
} from "../types";
import { sceneToBoardRaw, SCENE_PX_PER_MM } from "./coordinates";

import { motionChainRootJointIds, preferredMotionJointId } from "./motionChains";

export type PathTargetKind = "part" | "scene-object";

export const pathTargetKind = (path?: ProjectMotionPath): PathTargetKind =>
  path?.sceneObjectId ? "scene-object" : "part";

export const pathTargetId = (path?: ProjectMotionPath): string | undefined =>
  path?.sceneObjectId || path?.partId || undefined;

/** Authored ownership is exact; limb reachability is only a binding rule. */
export const pathHasExactOwner = (
  path: ProjectMotionPath,
  kind: PathTargetKind,
  id?: string,
) => Boolean(id) && pathTargetKind(path) === kind && pathTargetId(path) === id;

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
  const targetJointId = preferredMotionJointId(project, path.partId, path.targetAnchorJointId);
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

const pathChainRootIsValid = (project: ProjectState, path: ProjectMotionPath) =>
  Boolean(path.sceneObjectId || !path.chainRootJointId ||
    motionChainRootJointIds(project, path.partId, path.targetAnchorJointId).includes(path.chainRootJointId));

/**
 * A stored fit is usable only while its binding still describes the current
 * path, target, board profile, and physical output.  This is deliberately a
 * cheap contract check: full sweep validation belongs to the fitter and
 * fabrication validator, while this guard runs during every playback sample.
 */
export const mechanismPathFitBindingIssues = (
  project: ProjectState,
  mechanism: MechanismConfig,
) => {
  if (mechanism.type !== "4bar" || !mechanism.targetPathId || mechanism.targetSceneObjectId) return [];
  const fit = mechanism.fabricationMetadata?.pathFit;
  if (!fit || fit.status !== "fit") return [];
  const path = project.paths[mechanism.targetPathId];
  const issues: string[] = [];
  const add = (message: string) => {
    if (!issues.includes(message)) issues.push(message);
  };
  if (!path) {
    add(`Target path ${mechanism.targetPathId} is missing.`);
    return issues;
  }
  if (fit.targetPathId !== path.id) add("Fit target path is stale.");
  if (!mechanismMatchesPathOwner(mechanism, path, project)) add("Fit target owner is stale.");
  if (path.targetAnchorJointId && mechanism.targetAnchorJointId !== path.targetAnchorJointId) add("Fit target joint is stale.");
  if (!pathChainRootIsValid(project, path)) add("Fit chain root is stale.");
  if (fit.kitProfileKey !== project.settings.physicalKit.profileKey) add("Fit kit profile is stale.");
  if (mechanism.fabricationMetadata?.gridPitchMm !== project.settings.physicalKit.gridPitchMm) add("Fit grid pitch is stale.");
  const board = Number.isFinite(mechanism.anchorX) && Number.isFinite(mechanism.anchorY)
    ? sceneToBoardRaw({ x: mechanism.anchorX!, y: mechanism.anchorY! }, project.settings.physicalKit)
    : undefined;
  if (!board?.valid) add("Fit board anchor is stale.");
  if (mechanism.fabricationMetadata?.boardCoordinate !== board?.label) add("Fit board coordinate is stale.");
  if (!fit.outputTraceId) add("Fit output trace is missing.");
  if (!Number.isFinite(fit.phaseOffset) || ![1, -1].includes(fit.direction ?? 0)) add("Fit phase or direction is missing.");
  const tolerance = fit.tolerance ?? Math.max(12, project.settings.physicalKit.gridPitchMm * SCENE_PX_PER_MM * 0.75);
  if (!Number.isFinite(tolerance) || tolerance <= 0) add("Fit tolerance is missing.");
  if (!Number.isFinite(fit.error) || !Number.isFinite(fit.maxError) || fit.error! > tolerance || fit.maxError! > tolerance) add("Fit error exceeds tolerance.");
  if (!mechanism.generatedPath || mechanism.generatedPath.length < 3) add("Fit output path is missing.");
  return issues;
};
