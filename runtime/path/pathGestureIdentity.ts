import type { ProjectMotionPath, ProjectState } from "../../types";
import { pathHasExactOwner, type PathTargetKind } from "../../utils/pathTargets";

export interface PathGestureIdentity {
  project: ProjectState;
  targetKind: PathTargetKind;
  targetId: string;
  path?: ProjectMotionPath;
}

export const capturePathGestureIdentity = (
  project: ProjectState,
  targetKind: PathTargetKind,
  targetId?: string,
  path?: ProjectMotionPath,
): PathGestureIdentity | undefined => {
  if (!targetId || (path && !pathHasExactOwner(path, targetKind, targetId))) return;
  const target = targetKind === "scene-object" ? project.sceneObjects[targetId] : project.parts[targetId];
  return target && !target.locked ? { project, targetKind, targetId, path } : undefined;
};

export const pathGestureIdentityMatches = (
  identity: PathGestureIdentity | undefined,
  project: ProjectState,
  targetKind: PathTargetKind,
  targetId?: string,
  path?: ProjectMotionPath,
) => Boolean(identity && identity.project === project &&
  identity.targetKind === targetKind && identity.targetId === targetId && identity.path === path);
