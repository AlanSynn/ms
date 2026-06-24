import { BodyPartLayer, MechanismConfig, Point, ProjectMotionPath, ProjectState, StandardJoint, StandardSkeleton } from '../types';
import { calculateLinkage } from './kinematics';
import { placeBodyPartPivotAt } from './coordinates';

export interface MotionPreview {
    parts: Record<string, BodyPartLayer>;
    skeleton: StandardSkeleton | null;
    target?: Point;
    targetJointId?: string;
    rootJointId?: string;
    warnings?: Record<string, string[]>;
}

export const pointOnProjectPath = (path: ProjectMotionPath, angle: number): Point => {
    if (path.timedPoints?.length) {
        const timed = [...path.timedPoints].sort((a, b) => a.time - b.time);
        const duration = path.duration || timed.at(-1)?.time || 1;
        const time = (((angle / (Math.PI * 2)) % 1) + 1) % 1 * duration;
        let prev = timed[0];
        for (const next of timed.slice(1)) {
            if (time <= next.time) {
                const span = Math.max(1e-6, next.time - prev.time);
                const t = Math.max(0, Math.min(1, (time - prev.time) / span));
                return { x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t };
            }
            prev = next;
        }
        return timed.at(-1) ?? { x: 0, y: 0 };
    }
    const segments = path.points.slice(1).map((p, i) => ({ a: path.points[i], b: p, length: Math.hypot(p.x - path.points[i].x, p.y - path.points[i].y) }));
    const total = segments.reduce((sum, seg) => sum + seg.length, 0) || 1;
    let target = (((angle / (Math.PI * 2)) % 1) + 1) % 1 * total;
    for (const seg of segments) {
        if (target <= seg.length) {
            const t = target / (seg.length || 1);
            return { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t };
        }
        target -= seg.length;
    }
    return path.points.at(-1) ?? { x: 0, y: 0 };
};

const descendantJoints = (skeleton: StandardSkeleton | null | undefined, rootJointId: string) => {
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

const deepestDescendantJointId = (skeleton: StandardSkeleton | null | undefined, rootJointId: string) => {
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

export const motionAnchorJointIds = (project: ProjectState, partId: string | undefined): string[] => {
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
    options: { preferDistalWhenRoot?: boolean } = {}
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

const visualPartIdsForJoints = (project: ProjectState, targetPartId: string, jointIds: Set<string>, explicitIds: string[] = []) => {
    const ids = new Set([targetPartId, ...explicitIds]);
    project.partOrder.forEach(id => {
        const part = project.parts[id];
        if (part && jointIds.has(part.anchorJointId)) ids.add(id);
    });
    return [...ids].filter(id => project.parts[id]);
};

const withJointUpdates = (skeleton: StandardSkeleton | null | undefined, updates: Record<string, Point>): StandardSkeleton | null => {
    if (!skeleton) return null;
    const joints = Object.fromEntries(Object.entries(skeleton.joints).map(([id, joint]) => [
        id,
        updates[id] ? { ...joint, position: updates[id] } as StandardJoint : joint
    ]));
    return { ...skeleton, joints };
};

const rotateAround = (point: Point, center: Point, radians: number): Point => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos
    };
};

const jointChain = (skeleton: StandardSkeleton, rootJointId: string, targetJointId: string) => {
    const chain = [targetJointId];
    let current = skeleton.joints[targetJointId]?.parentId ?? null;
    while (current) {
        chain.push(current);
        if (current === rootJointId) return chain.reverse();
        current = skeleton.joints[current]?.parentId ?? null;
    }
    return targetJointId === rootJointId ? [rootJointId] : [];
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const solveChainTargets = (skeleton: StandardSkeleton, rootJointId: string, targetJointId: string, target: Point): Record<string, Point> => {
    const root = skeleton.joints[rootJointId]?.position;
    const oldTarget = skeleton.joints[targetJointId]?.position;
    if (!root || !oldTarget || targetJointId === rootJointId) return {};

    const chain = jointChain(skeleton, rootJointId, targetJointId);
    if (chain.length >= 3) {
        const midId = chain[chain.length - 2];
        const mid = skeleton.joints[midId]?.position;
        if (mid) {
            const upper = Math.hypot(mid.x - root.x, mid.y - root.y);
            const lower = Math.hypot(oldTarget.x - mid.x, oldTarget.y - mid.y);
            const desired = Math.hypot(target.x - root.x, target.y - root.y);
            if (upper > 1e-6 && lower > 1e-6 && desired > 1e-6) {
                const reachable = clamp(desired, Math.abs(upper - lower) + 1e-6, upper + lower - 1e-6);
                const direction = Math.atan2(target.y - root.y, target.x - root.x);
                const bend = skeleton.joints[midId]?.bendDirection || 1;
                const cosAtRoot = clamp((upper ** 2 + reachable ** 2 - lower ** 2) / (2 * upper * reachable), -1, 1);
                const midAngle = direction + bend * Math.acos(cosAtRoot);
                const end = desired < Math.abs(upper - lower) || desired > upper + lower
                    ? { x: root.x + Math.cos(direction) * reachable, y: root.y + Math.sin(direction) * reachable }
                    : target;
                return {
                    [midId]: { x: root.x + Math.cos(midAngle) * upper, y: root.y + Math.sin(midAngle) * upper },
                    [targetJointId]: end
                };
            }
        }
    }

    const currentAngle = Math.atan2(oldTarget.y - root.y, oldTarget.x - root.x);
    const nextAngle = Math.atan2(target.y - root.y, target.x - root.x);
    const delta = nextAngle - currentAngle;
    const updates: Record<string, Point> = {};
    descendantJoints(skeleton, rootJointId).forEach(id => {
        if (id !== rootJointId && skeleton.joints[id]) updates[id] = rotateAround(skeleton.joints[id].position, root, delta);
    });
    return updates;
};

export const motionPreviewForTarget = (
    project: ProjectState,
    targetPartId: string | undefined,
    targetJointId: string | undefined,
    target: Point,
    existing: MotionPreview = { parts: {}, skeleton: project.skeleton }
): MotionPreview => {
    const targetPart = targetPartId ? project.parts[targetPartId] : undefined;
    const skeleton = existing.skeleton ?? project.skeleton;
    if (!targetPart) return existing;

    const rootJointId = targetPart.anchorJointId;
    const resolvedTargetJointId = preferredMotionJointId(project, targetPartId, targetJointId) ?? rootJointId;
    const rootJoint = skeleton?.joints[rootJointId];
    const targetJoint = skeleton?.joints[resolvedTargetJointId];

    if (!skeleton || !rootJoint || !targetJoint || resolvedTargetJointId === rootJointId) {
        const anchorPart = { ...targetPart, anchorJointId: resolvedTargetJointId };
        const placedTarget = placeBodyPartPivotAt(anchorPart, target, skeleton);
        const dx = placedTarget.transform.x - targetPart.transform.x;
        const dy = placedTarget.transform.y - targetPart.transform.y;
        const affectedJoints = descendantJoints(skeleton, resolvedTargetJointId);
        const jointUpdates: Record<string, Point> = {};
        affectedJoints.forEach(id => {
            const joint = skeleton?.joints[id];
            if (joint) jointUpdates[id] = { x: joint.position.x + dx, y: joint.position.y + dy };
        });
        const nextSkeleton = withJointUpdates(skeleton, jointUpdates);
        const parts = { ...existing.parts };
        visualPartIdsForJoints(project, targetPart.id, affectedJoints).forEach(partId => {
            const part = project.parts[partId];
            parts[partId] = partId === targetPart.id
                ? placedTarget
                : { ...part, transform: { ...part.transform, x: part.transform.x + dx, y: part.transform.y + dy } };
        });
        return { parts, skeleton: nextSkeleton, target, targetJointId: resolvedTargetJointId, rootJointId };
    }

    const jointUpdates = solveChainTargets(skeleton, rootJointId, resolvedTargetJointId, target);
    const solvedTarget = jointUpdates[resolvedTargetJointId] ?? targetJoint.position;
    const endDx = solvedTarget.x - targetJoint.position.x;
    const endDy = solvedTarget.y - targetJoint.position.y;
    descendantJoints(skeleton, resolvedTargetJointId).forEach(id => {
        if (!jointUpdates[id] && skeleton.joints[id]) {
            jointUpdates[id] = { x: skeleton.joints[id].position.x + endDx, y: skeleton.joints[id].position.y + endDy };
        }
    });
    const nextSkeleton = withJointUpdates(skeleton, jointUpdates);
    const oldVector = { x: targetJoint.position.x - rootJoint.position.x, y: targetJoint.position.y - rootJoint.position.y };
    const newVector = { x: solvedTarget.x - rootJoint.position.x, y: solvedTarget.y - rootJoint.position.y };
    const rotationDelta = Math.atan2(newVector.y, newVector.x) - Math.atan2(oldVector.y, oldVector.x);
    const rotatedTarget = {
        ...targetPart,
        transform: { ...targetPart.transform, rotation: targetPart.transform.rotation + rotationDelta * 180 / Math.PI }
    };
    const placedTarget = placeBodyPartPivotAt(rotatedTarget, rootJoint.position, nextSkeleton);
    const affectedJoints = descendantJoints(skeleton, rootJointId);
    const parts = { ...existing.parts };
    visualPartIdsForJoints(project, targetPart.id, affectedJoints).forEach(partId => {
        const part = project.parts[partId];
        if (partId === targetPart.id) {
            parts[partId] = placedTarget;
            return;
        }
        const anchor = nextSkeleton?.joints[part.anchorJointId]?.position;
        parts[partId] = anchor ? placeBodyPartPivotAt(part, anchor, nextSkeleton) : part;
    });
    return { parts, skeleton: nextSkeleton, target: solvedTarget, targetJointId: resolvedTargetJointId, rootJointId };
};

export const motionPreviewForPath = (
    project: ProjectState,
    path: ProjectMotionPath,
    angle: number,
    targetJointId = preferredMotionJointId(project, path.partId, path.targetAnchorJointId, { preferDistalWhenRoot: !path.targetAnchorJointId })
): MotionPreview => motionPreviewForTarget(project, path.partId, targetJointId, pointOnProjectPath(path, angle));

export const mechanismBindingWarnings = (project: ProjectState, mechanisms: MechanismConfig[] = project.mechanisms) => {
    const warnings: Record<string, string[]> = {};
    const add = (mechanismId: string, message: string) => {
        warnings[mechanismId] = [...(warnings[mechanismId] ?? []), message];
    };
    const drivenTargets = new Map<string, string>();
    mechanisms.filter(m => m.visible && m.enabled !== false).forEach(m => {
        if (!m.targetPartId) return;
        const part = project.parts[m.targetPartId];
        if (!part) {
            add(m.id, `Target part ${m.targetPartId} is missing.`);
            return;
        }
        if (m.targetPathId) {
            const path = project.paths[m.targetPathId];
            if (!path) add(m.id, `Target path ${m.targetPathId} is missing.`);
            else if (path.partId !== m.targetPartId) add(m.id, `Target path ${m.targetPathId} belongs to ${path.partId}, not ${m.targetPartId}.`);
        }
        if (m.targetAnchorJointId && !motionAnchorJointIds(project, m.targetPartId).includes(m.targetAnchorJointId)) {
            add(m.id, `Target anchor ${m.targetAnchorJointId} is outside ${m.targetPartId}'s skeleton chain.`);
        }
        const targetJointId = preferredMotionJointId(project, m.targetPartId, m.targetAnchorJointId);
        const key = `${m.targetPartId}:${targetJointId ?? part.anchorJointId}`;
        const owner = drivenTargets.get(key);
        if (owner) {
            add(owner, `${m.id} also drives ${key}; only one mechanism can own a target anchor.`);
            add(m.id, `${owner} also drives ${key}; only one mechanism can own a target anchor.`);
        } else {
            drivenTargets.set(key, m.id);
        }
    });
    return warnings;
};

export const motionPreviewForProject = (project: ProjectState, mechanisms: MechanismConfig[], angle: number): MotionPreview => {
    const warnings = mechanismBindingWarnings(project, mechanisms);
    const drivenTargets = new Set<string>();
    let preview: MotionPreview = { parts: {}, skeleton: project.skeleton, warnings };
    mechanisms.filter(m => m.visible && m.enabled !== false).forEach(m => {
        if (!m.targetPartId || !project.parts[m.targetPartId]) return;
        const state = calculateLinkage(m, angle);
        if (!state.isValid) {
            warnings[m.id] = [...(warnings[m.id] ?? []), 'Current mechanism angle is outside the valid motion range.'];
            return;
        }
        const targetJointId = preferredMotionJointId(project, m.targetPartId, m.targetAnchorJointId);
        const key = `${m.targetPartId}:${targetJointId ?? project.parts[m.targetPartId].anchorJointId}`;
        if (drivenTargets.has(key)) return;
        drivenTargets.add(key);
        preview = motionPreviewForTarget(project, m.targetPartId, targetJointId, state.effector, preview);
    });
    return { ...preview, warnings };
};

export const animatedPartsForProject = (project: ProjectState, mechanisms: MechanismConfig[], angle: number): Record<string, BodyPartLayer> => {
    return motionPreviewForProject(project, mechanisms, angle).parts;
};
