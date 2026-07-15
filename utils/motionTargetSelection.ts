import type { ProjectState, StandardSkeleton } from '../types';

export const descendantJoints = (
  skeleton: StandardSkeleton | null | undefined,
  rootJointId: string,
) => {
  const seen = new Set<string>([rootJointId]);
  const stack = [...(skeleton?.hierarchy[rootJointId] ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(skeleton?.hierarchy[id] ?? []));
  }
  return seen;
};

const deepestDescendantJointId = (
  skeleton: StandardSkeleton | null | undefined,
  rootJointId: string,
) => {
  let best = rootJointId;
  let bestDepth = 0;
  const walk = (id: string, depth: number) => {
    if (depth > bestDepth) {
      best = id;
      bestDepth = depth;
    }
    (skeleton?.hierarchy[id] ?? []).forEach(child => walk(child, depth + 1));
  };
  walk(rootJointId, 0);
  return best;
};

export const motionAnchorJointIds = (
  project: ProjectState,
  partId: string | undefined,
): string[] => {
  const part = partId ? project.parts[partId] : undefined;
  if (!part) return [];
  const allowed = descendantJoints(project.skeleton, part.anchorJointId);
  const ordered = Object.keys(project.skeleton?.joints ?? {}).filter(id => allowed.has(id));
  return ordered.length ? ordered : [part.anchorJointId];
};

export const preferredMotionJointId = (
  project: ProjectState,
  partId: string | undefined,
  requestedJointId?: string,
  options: { preferDistalWhenRoot?: boolean } = {},
) => {
  const part = partId ? project.parts[partId] : undefined;
  if (!part) return requestedJointId;
  const rootJointId = part.anchorJointId;
  const allowed = new Set(motionAnchorJointIds(project, partId));
  const requested = requestedJointId && allowed.has(requestedJointId) ? requestedJointId : undefined;
  if (requested && (!options.preferDistalWhenRoot || requested !== rootJointId)) return requested;
  if (options.preferDistalWhenRoot) return deepestDescendantJointId(project.skeleton, rootJointId);
  return requested ?? rootJointId;
};
