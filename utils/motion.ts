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

export type MotionChainKind = 'invalid' | 'root-only' | 'two-joint-direct' | 'three-joint-ik' | 'multi-joint';

export interface MotionChainDescriptor {
    kind: MotionChainKind;
    rootJointId?: string;
    targetJointId?: string;
    foldJointId?: string;
    jointIds: string[];
    jointCount: number;
    segmentCount: number;
    label: string;
    helper: string;
    canFold: boolean;
    warning?: string;
}

const cyclePhase = (angle: number) => (((angle / (Math.PI * 2)) % 1) + 1) % 1;

const pointBetween = (a: Point, b: Point, t: number): Point => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
});

const projectPathSegments = (points: Point[], closed: boolean) => {
    const segments = points.slice(1).map((p, i) => ({
        a: points[i],
        b: p,
        length: Math.hypot(p.x - points[i].x, p.y - points[i].y)
    }));
    if (closed && points.length > 2) {
        const first = points[0];
        const last = points.at(-1)!;
        const length = Math.hypot(first.x - last.x, first.y - last.y);
        if (length > 1e-6) segments.push({ a: last, b: first, length });
    }
    return segments;
};

const pointOnGeneratedMechanismPath = (points: Point[], angle: number): Point | undefined => {
    if (points.length < 2) return points[0];
    const segments = projectPathSegments(points, true);
    const total = segments.reduce((sum, seg) => sum + seg.length, 0) || 1;
    let target = cyclePhase(angle) * total;
    for (const seg of segments) {
        if (target <= seg.length) return pointBetween(seg.a, seg.b, target / (seg.length || 1));
        target -= seg.length;
    }
    return points[0];
};

export const pointOnProjectPath = (path: ProjectMotionPath, angle: number): Point => {
    const phase = cyclePhase(angle);
    if (path.timedPoints?.length) {
        const timed = [...path.timedPoints].sort((a, b) => a.time - b.time);
        const duration = path.duration || timed.at(-1)?.time || 1;
        const lastTimed = timed.at(-1);
        if (path.closed && timed.length > 1 && lastTimed && lastTimed.time >= duration - 1e-6) {
            const segments = projectPathSegments(timed, true);
            const total = segments.reduce((sum, seg) => sum + seg.length, 0) || 1;
            let target = phase * total;
            for (const seg of segments) {
                if (target <= seg.length) {
                    return pointBetween(seg.a, seg.b, target / (seg.length || 1));
                }
                target -= seg.length;
            }
            return timed[0] ?? { x: 0, y: 0 };
        }
        const time = phase * duration;
        let prev = timed[0];
        for (const next of timed.slice(1)) {
            if (time <= next.time) {
                const span = Math.max(1e-6, next.time - prev.time);
                const t = Math.max(0, Math.min(1, (time - prev.time) / span));
                return pointBetween(prev, next, t);
            }
            prev = next;
        }
        if (path.closed && timed.length > 1) {
            const last = lastTimed!;
            const returnDuration = duration - last.time;
            if (returnDuration > 1e-6) {
                const t = Math.max(0, Math.min(1, (time - last.time) / returnDuration));
                return pointBetween(last, timed[0], t);
            }
        }
        return timed.at(-1) ?? { x: 0, y: 0 };
    }
    const segments = projectPathSegments(path.points, path.closed);
    const total = segments.reduce((sum, seg) => sum + seg.length, 0) || 1;
    let target = phase * total;
    for (const seg of segments) {
        if (target <= seg.length) {
            const t = target / (seg.length || 1);
            return pointBetween(seg.a, seg.b, t);
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

export const motionChainRootJointIds = (project: ProjectState, partId: string | undefined, targetJointId: string | undefined): string[] => {
    const part = partId ? project.parts[partId] : undefined;
    const skeleton = project.skeleton;
    if (!part || !skeleton) return [];
    const target = preferredMotionJointId(project, partId, targetJointId, { preferDistalWhenRoot: !targetJointId }) ?? part.anchorJointId;
    return motionRootOptionsFor(skeleton, part.anchorJointId, target);
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

export const motionJointChain = (skeleton: StandardSkeleton, rootJointId: string, targetJointId: string) => {
    const chain = [targetJointId];
    let current = skeleton.joints[targetJointId]?.parentId ?? null;
    while (current) {
        chain.push(current);
        if (current === rootJointId) return chain.reverse();
        current = skeleton.joints[current]?.parentId ?? null;
    }
    return targetJointId === rootJointId ? [rootJointId] : [];
};

const jointDisplayName = (skeleton: StandardSkeleton | null | undefined, id?: string) =>
    id ? (skeleton?.joints[id]?.name || id).replaceAll('_', ' ') : 'none';

const coreBodyRootIds = new Set(['root', 'hip', 'torso', 'neck']);
const uniqueIds = (ids: string[]) => [...new Set(ids)];

function motionRootOptionsFor(skeleton: StandardSkeleton, partRootJointId: string, targetJointId: string) {
    if (!skeleton.joints[partRootJointId] || !skeleton.joints[targetJointId]) return [];
    const directChain = motionJointChain(skeleton, partRootJointId, targetJointId);
    const parentJointId = skeleton.joints[partRootJointId]?.parentId ?? undefined;
    const parentChain = parentJointId && !coreBodyRootIds.has(parentJointId)
        ? motionJointChain(skeleton, parentJointId, targetJointId)
        : [];
    const chain = parentChain.length ? parentChain : directChain;
    return uniqueIds(chain.length ? chain : [partRootJointId]);
}

const resolveMotionRootJointId = (skeleton: StandardSkeleton, partRootJointId: string, targetJointId: string, requestedRootJointId?: string) => {
    const options = motionRootOptionsFor(skeleton, partRootJointId, targetJointId);
    return requestedRootJointId && options.includes(requestedRootJointId) ? requestedRootJointId : partRootJointId;
};

export const describeMotionChain = (project: ProjectState, partId: string | undefined, targetJointId?: string, options: { rootJointId?: string } = {}): MotionChainDescriptor => {
    const part = partId ? project.parts[partId] : undefined;
    const skeleton = project.skeleton;
    if (!part || !skeleton) {
        return {
            kind: 'invalid',
            jointIds: [],
            jointCount: 0,
            segmentCount: 0,
            label: 'No limb',
            helper: 'Pick a part with joints.',
            canFold: false,
            warning: 'Missing part or skeleton'
        };
    }
    const partRootJointId = part.anchorJointId;
    const resolvedTargetJointId = preferredMotionJointId(project, partId, targetJointId) ?? partRootJointId;
    const rootJointId = resolveMotionRootJointId(skeleton, partRootJointId, resolvedTargetJointId, options.rootJointId);
    const jointIds = motionJointChain(skeleton, rootJointId, resolvedTargetJointId);
    const jointCount = jointIds.length;
    const segmentCount = Math.max(0, jointCount - 1);
    if (!jointCount) {
        return {
            kind: 'invalid',
            rootJointId,
            targetJointId: resolvedTargetJointId,
            jointIds: [],
            jointCount: 0,
            segmentCount: 0,
            label: 'Can’t reach',
            helper: `${jointDisplayName(skeleton, resolvedTargetJointId)} is outside this limb.`,
            canFold: false,
            warning: 'Target joint is outside this part chain'
        };
    }
    if (jointCount === 1) {
        return {
            kind: 'root-only',
            rootJointId,
            targetJointId: resolvedTargetJointId,
            jointIds,
            jointCount,
            segmentCount,
            label: 'Whole part',
            helper: 'Pick a farther handle to bend.',
            canFold: false
        };
    }
    if (jointCount === 2) {
        return {
            kind: 'two-joint-direct',
            rootJointId,
            targetJointId: resolvedTargetJointId,
            jointIds,
            jointCount,
            segmentCount,
            label: '1 segment',
            helper: 'Straight move.',
            canFold: false
        };
    }
    const foldJointId = jointIds[jointIds.length - 2];
    if (jointCount === 3) {
        return {
            kind: 'three-joint-ik',
            rootJointId,
            targetJointId: resolvedTargetJointId,
            foldJointId,
            jointIds,
            jointCount,
            segmentCount,
            label: '3 joints',
            helper: `${jointDisplayName(skeleton, foldJointId)} bends.`,
            canFold: true
        };
    }
    return {
        kind: 'multi-joint',
        rootJointId,
        targetJointId: resolvedTargetJointId,
        foldJointId,
        jointIds,
        jointCount,
        segmentCount,
        label: `${jointCount} joints`,
        helper: `${jointDisplayName(skeleton, foldJointId)} bends; extra joints follow.`,
        canFold: true,
        warning: 'Multi-joint chains currently use the distal bend joint as the solver control.'
    };
};

export const motionChainOptionLabel = (project: ProjectState, partId: string | undefined, jointId: string): string => {
    const descriptor = describeMotionChain(project, partId, jointId);
    const jointWord = descriptor.jointCount === 1 ? 'joint' : 'joints';
    return `${jointDisplayName(project.skeleton, jointId)} · ${descriptor.jointCount || 0} ${jointWord}`;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const angleBetween = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);

const firstChildJointId = (skeleton: StandardSkeleton | null | undefined, jointId: string) =>
    (skeleton?.hierarchy[jointId] ?? []).find(id => Boolean(skeleton?.joints[id]));

const solveLongChainTargets = (skeleton: StandardSkeleton, chain: string[], target: Point): Record<string, Point> => {
    const points = chain.map(id => skeleton.joints[id]?.position);
    if (points.some(point => !point)) return {};
    const positions = points as Point[];
    const lengths = positions.slice(1).map((point, index) => distance(point, positions[index]));
    const totalLength = lengths.reduce((sum, length) => sum + length, 0);
    const root = positions[0];
    if (totalLength <= 1e-6 || distance(root, target) <= 1e-6) return {};

    const next = positions.map(point => ({ ...point }));
    if (distance(root, target) >= totalLength) {
        const direction = angleBetween(root, target);
        for (let index = 1; index < next.length; index += 1) {
            next[index] = {
                x: next[index - 1].x + Math.cos(direction) * lengths[index - 1],
                y: next[index - 1].y + Math.sin(direction) * lengths[index - 1]
            };
        }
    } else {
        for (let iteration = 0; iteration < 12; iteration += 1) {
            next[next.length - 1] = { ...target };
            for (let index = next.length - 2; index >= 0; index -= 1) {
                const nextLength = Math.max(1e-6, distance(next[index], next[index + 1]));
                const ratio = lengths[index] / nextLength;
                next[index] = {
                    x: next[index + 1].x + (next[index].x - next[index + 1].x) * ratio,
                    y: next[index + 1].y + (next[index].y - next[index + 1].y) * ratio
                };
            }
            next[0] = { ...root };
            for (let index = 1; index < next.length; index += 1) {
                const nextLength = Math.max(1e-6, distance(next[index], next[index - 1]));
                const ratio = lengths[index - 1] / nextLength;
                next[index] = {
                    x: next[index - 1].x + (next[index].x - next[index - 1].x) * ratio,
                    y: next[index - 1].y + (next[index].y - next[index - 1].y) * ratio
                };
            }
        }
    }

    return Object.fromEntries(chain.slice(1).map((id, index) => [id, next[index + 1]]));
};

const partWithAnimatedSegment = (part: BodyPartLayer, before: StandardSkeleton, after: StandardSkeleton | null): BodyPartLayer => {
    if (!after) return part;
    const childId = firstChildJointId(before, part.anchorJointId);
    const beforeAnchor = before.joints[part.anchorJointId]?.position;
    const beforeChild = childId ? before.joints[childId]?.position : undefined;
    const afterAnchor = after.joints[part.anchorJointId]?.position;
    const afterChild = childId ? after.joints[childId]?.position : undefined;
    const segmentChanged = beforeAnchor && beforeChild && afterAnchor && afterChild;
    const rotated = segmentChanged
        ? {
            ...part,
            transform: {
                ...part.transform,
                rotation: part.transform.rotation + (angleBetween(afterAnchor, afterChild) - angleBetween(beforeAnchor, beforeChild)) * 180 / Math.PI
            }
        }
        : part;
    const anchor = after.joints[part.anchorJointId]?.position;
    return anchor ? placeBodyPartPivotAt(rotated, anchor, after) : rotated;
};

const solveChainTargets = (skeleton: StandardSkeleton, rootJointId: string, targetJointId: string, target: Point, pinTarget = false): Record<string, Point> => {
    const root = skeleton.joints[rootJointId]?.position;
    const oldTarget = skeleton.joints[targetJointId]?.position;
    if (!root || !oldTarget || targetJointId === rootJointId) return {};

    const chain = motionJointChain(skeleton, rootJointId, targetJointId);
    if (chain.length === 2) {
        const length = Math.hypot(oldTarget.x - root.x, oldTarget.y - root.y);
        const direction = Math.atan2(target.y - root.y, target.x - root.x);
        return {
            [targetJointId]: pinTarget
                ? target
                : { x: root.x + Math.cos(direction) * length, y: root.y + Math.sin(direction) * length }
        };
    }
    if (chain.length > 3) return solveLongChainTargets(skeleton, chain, target);
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
                const clampedEnd = desired < Math.abs(upper - lower) || desired > upper + lower
                    ? { x: root.x + Math.cos(direction) * reachable, y: root.y + Math.sin(direction) * reachable }
                    : target;
                return {
                    [midId]: { x: root.x + Math.cos(midAngle) * upper, y: root.y + Math.sin(midAngle) * upper },
                    [targetJointId]: pinTarget ? target : clampedEnd
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
    existing: MotionPreview = { parts: {}, skeleton: project.skeleton },
    options: { pinTarget?: boolean; rootJointId?: string } = {}
): MotionPreview => {
    const targetPart = targetPartId ? project.parts[targetPartId] : undefined;
    const skeleton = existing.skeleton ?? project.skeleton;
    if (!targetPart) return existing;

    const partRootJointId = targetPart.anchorJointId;
    const resolvedTargetJointId = preferredMotionJointId(project, targetPartId, targetJointId) ?? partRootJointId;
    const rootJointId = skeleton ? resolveMotionRootJointId(skeleton, partRootJointId, resolvedTargetJointId, options.rootJointId) : partRootJointId;
    const rootJoint = skeleton?.joints[rootJointId];
    const targetJoint = skeleton?.joints[resolvedTargetJointId];

    if (!skeleton || !rootJoint || !targetJoint) return existing;
    if (resolvedTargetJointId === rootJointId) {
        const dx = target.x - rootJoint.position.x;
        const dy = target.y - rootJoint.position.y;
        const affectedJoints = descendantJoints(skeleton, rootJointId);
        const jointUpdates: Record<string, Point> = {};
        affectedJoints.forEach(id => {
            const joint = skeleton.joints[id];
            if (joint) jointUpdates[id] = { x: joint.position.x + dx, y: joint.position.y + dy };
        });
        const nextSkeleton = withJointUpdates(skeleton, jointUpdates);
        const parts = { ...existing.parts };
        visualPartIdsForJoints(project, targetPart.id, affectedJoints).forEach(partId => {
            const part = project.parts[partId];
            const anchor = nextSkeleton?.joints[part.anchorJointId]?.position;
            parts[partId] = anchor ? placeBodyPartPivotAt(part, anchor, nextSkeleton) : part;
        });
        return { parts, skeleton: nextSkeleton, target, targetJointId: resolvedTargetJointId, rootJointId };
    }

    const jointUpdates = solveChainTargets(skeleton, rootJointId, resolvedTargetJointId, target, options.pinTarget === true);
    const solvedTarget = jointUpdates[resolvedTargetJointId] ?? targetJoint.position;
    const endDx = solvedTarget.x - targetJoint.position.x;
    const endDy = solvedTarget.y - targetJoint.position.y;
    descendantJoints(skeleton, resolvedTargetJointId).forEach(id => {
        if (!jointUpdates[id] && skeleton.joints[id]) {
            jointUpdates[id] = { x: skeleton.joints[id].position.x + endDx, y: skeleton.joints[id].position.y + endDy };
        }
    });
    const nextSkeleton = withJointUpdates(skeleton, jointUpdates);
    const affectedJoints = descendantJoints(skeleton, rootJointId);
    const parts = { ...existing.parts };
    visualPartIdsForJoints(project, targetPart.id, affectedJoints).forEach(partId => {
        const part = project.parts[partId];
        parts[partId] = partWithAnimatedSegment(part, skeleton, nextSkeleton);
    });
    return { parts, skeleton: nextSkeleton, target: solvedTarget, targetJointId: resolvedTargetJointId, rootJointId };
};

export const motionPreviewForPath = (
    project: ProjectState,
    path: ProjectMotionPath,
    angle: number,
    targetJointId = preferredMotionJointId(project, path.partId, path.targetAnchorJointId, { preferDistalWhenRoot: !path.targetAnchorJointId })
): MotionPreview => motionPreviewForTarget(project, path.partId, targetJointId, pointOnProjectPath(path, angle), { parts: {}, skeleton: project.skeleton }, { rootJointId: path.chainRootJointId });

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
        const path = m.targetPathId ? project.paths[m.targetPathId] : undefined;
        const targetJointId = preferredMotionJointId(project, m.targetPartId, m.targetAnchorJointId ?? path?.targetAnchorJointId);
        const rootOptions = motionChainRootJointIds(project, m.targetPartId, targetJointId);
        if (path?.chainRootJointId && !rootOptions.includes(path.chainRootJointId)) add(m.id, `Chain root ${path.chainRootJointId} is outside ${m.targetPartId}'s IK path.`);
        const rootJointId = path?.chainRootJointId && rootOptions.includes(path.chainRootJointId) ? path.chainRootJointId : part.anchorJointId;
        const key = `${m.targetPartId}:${rootJointId}:${targetJointId ?? part.anchorJointId}`;
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
        const generatedTarget = pointOnGeneratedMechanismPath(m.generatedPath ?? [], angle);
        if (!state.isValid && !generatedTarget) {
            warnings[m.id] = [...(warnings[m.id] ?? []), 'Current mechanism angle is outside the valid motion range.'];
            return;
        }
        if (!state.isValid) warnings[m.id] = [...(warnings[m.id] ?? []), 'Current mechanism angle is outside the valid motion range.'];
        const path = m.targetPathId ? project.paths[m.targetPathId] : undefined;
        const targetJointId = preferredMotionJointId(project, m.targetPartId, m.targetAnchorJointId ?? path?.targetAnchorJointId);
        const rootOptions = motionChainRootJointIds(project, m.targetPartId, targetJointId);
        const rootJointId = path?.chainRootJointId && rootOptions.includes(path.chainRootJointId) ? path.chainRootJointId : undefined;
        const key = `${m.targetPartId}:${rootJointId ?? project.parts[m.targetPartId].anchorJointId}:${targetJointId ?? project.parts[m.targetPartId].anchorJointId}`;
        if (drivenTargets.has(key)) return;
        drivenTargets.add(key);
        preview = motionPreviewForTarget(project, m.targetPartId, targetJointId, generatedTarget ?? state.effector, preview, { pinTarget: true, rootJointId });
    });
    return { ...preview, warnings };
};

export const animatedPartsForProject = (project: ProjectState, mechanisms: MechanismConfig[], angle: number): Record<string, BodyPartLayer> => {
    return motionPreviewForProject(project, mechanisms, angle).parts;
};
