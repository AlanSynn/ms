import type { Point, ProjectMotionPath, ProjectState } from "../types";
import { validatePath } from "./project";
import { nextMotionPathId } from "./motion";
import { pathHasExactOwner, type PathTargetKind } from "./pathTargets";

/** Resolve a point edit without borrowing a reachable ancestor's authored path. */
export const motionPathWithPoints = (
  project: ProjectState,
  targetKind: PathTargetKind,
  targetId: string,
  points: Point[],
  source: ProjectMotionPath["source"] = "drawn",
  timedPoints?: ProjectMotionPath["timedPoints"],
  pathId?: string,
): ProjectMotionPath | undefined => {
  const target = targetKind === "scene-object" ? project.sceneObjects[targetId] : project.parts[targetId];
  if (!target || target.locked) return;
  const requested = pathId ? project.paths[pathId] : undefined;
  if (pathId && (!requested || !pathHasExactOwner(requested, targetKind, targetId))) return;
  const selected = project.selectedPathId ? project.paths[project.selectedPathId] : undefined;
  const current = requested ?? (selected && pathHasExactOwner(selected, targetKind, targetId)
    ? selected
    : Object.values(project.paths).find(path => pathHasExactOwner(path, targetKind, targetId)));
  const duration = current?.duration ?? project.settings.animationDurationMs;
  return validatePath({
    ...current,
    id: current?.id ?? nextMotionPathId(project, targetId),
    partId: targetKind === "part" ? targetId : "",
    sceneObjectId: targetKind === "scene-object" ? targetId : undefined,
    smoothness: current?.smoothness ?? 0,
    points,
    timedPoints: timedPoints ?? points.map((point, index) => ({
      ...point,
      time: points.length <= 1 ? 0 : (index / (points.length - 1)) * duration,
    })),
    duration,
    closed: current?.closed ?? true,
    enabled: current?.enabled ?? true,
    visible: current?.visible ?? true,
    source,
    warnings: [],
  });
};
