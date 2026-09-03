import { BodyPartLayer, MechanismConfig, Point, ProjectMotionPath, ProjectState, SceneObject, StandardJoint, StandardSkeleton } from '../types';
import { calculateLinkage, mechanismTracePointForState } from './kinematics';
import { placeBodyPartPivotAt } from './coordinates';
import {
    mechanismMatchesPathOwner,
    mechanismPathFitBindingIssues,
    pathOwnerExists,
    type PathTargetKind,
} from './pathTargets';
import {
    mechanismOutputBindings,
    mechanismOutputPortForBinding,
    mechanismWithOutputBindings,
    resolvedMechanismOutputBindings,
} from './mechanismBindings';

export interface MotionPreview {
    parts: Record<string, BodyPartLayer>;
    sceneObjects?: Record<string, SceneObject>;
    skeleton: StandardSkeleton | null;
    target?: Point;
    targetJointId?: string;
    rootJointId?: string;
    warnings?: Record<string, string[]>;
}

export type MotionPathPreviewRuntime = {
    pointAt: (angle: number) => Point;
    previewAt: (angle: number) => MotionPreview;
};

type MotionPreviewCacheEntry = {
    angle: number;
    mechanisms: MechanismConfig[];
    preview: MotionPreview;
};

const motionPreviewCache = new WeakMap<ProjectState, MotionPreviewCacheEntry[]>();
const motionPathRuntimeCache = new WeakMap<
    ProjectState,
    WeakMap<ProjectMotionPath, Map<string, MotionPathPreviewRuntime>>
>();

const sameMechanismSet = (
    left: MechanismConfig[],
    right: MechanismConfig[],
) => left.length === right.length && left.every((mechanism, index) => mechanism === right[index]);

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

const validMotionDurationMs = (durationMs: number, fallbackDurationMs: number) =>
    Number.isFinite(durationMs) && durationMs > 0
        ? durationMs
        : Math.max(1, fallbackDurationMs);

export const motionTimelineMsForPhase = (angle: number, durationMs: number) =>
    cyclePhase(angle) * Math.max(1, durationMs);

export const motionAngleAtTimelineMs = (timelineMs: number, durationMs: number) =>
    (Math.max(0, timelineMs) / Math.max(1, durationMs)) * Math.PI * 2;

export const motionPathsInProjectOrder = (project: ProjectState) =>
    Object.values(project.paths) as ProjectMotionPath[];

export const playableMotionPaths = (
    project: ProjectState,
    paths: ProjectMotionPath[] = motionPathsInProjectOrder(project),
) => paths.filter(path =>
    path.enabled &&
    path.points.length > 1 &&
    pathOwnerExists(project, path)
);

export const sharedMotionPlaybackDurationMs = (
    project: ProjectState,
    paths: ProjectMotionPath[] = playableMotionPaths(project),
) => paths.length
    ? paths.reduce(
        (durationMs, path) => Math.max(
            durationMs,
            validMotionDurationMs(path.duration, project.settings.animationDurationMs),
        ),
        1,
    )
    : Math.max(1, project.settings.animationDurationMs);

export type MotionPathStatus = 'Ready' | 'Draw' | 'Fix' | 'Hidden' | 'Off';

export const motionPathStatus = (path: ProjectMotionPath): MotionPathStatus => {
    if (!path.enabled) return 'Off';
    if (path.points.length < 3) return 'Draw';
    if (path.warnings.length) return 'Fix';
    if (!path.visible) return 'Hidden';
    return 'Ready';
};

export const nextMotionPathId = (project: ProjectState, targetId: string) => {
    const baseId = `path-${targetId}`;
    if (!project.paths[baseId]) return baseId;
    let suffix = 2;
    while (project.paths[`${baseId}-${suffix}`]) suffix += 1;
    return `${baseId}-${suffix}`;
};

export const createMotionPathForTarget = (
    project: ProjectState,
    targetKind: PathTargetKind,
    targetId: string,
): ProjectMotionPath | undefined => {
    const targetExists = targetKind === 'scene-object'
        ? Boolean(project.sceneObjects[targetId])
        : Boolean(project.parts[targetId]);
    if (!targetExists) return undefined;
    return {
        id: nextMotionPathId(project, targetId),
        partId: targetKind === 'part' ? targetId : '',
        sceneObjectId: targetKind === 'scene-object' ? targetId : undefined,
        smoothness: 0,
        points: [],
        timedPoints: [],
        duration: Math.max(1, project.settings.animationDurationMs),
        closed: true,
        enabled: true,
        visible: true,
        source: 'drawn',
        warnings: [],
    };
};

export const clearMotionPathGeometry = (
    path: ProjectMotionPath,
): ProjectMotionPath => ({
    ...path,
    points: [],
    timedPoints: [],
    warnings: [],
});

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

type MotionPathSampler = (angle: number) => Point;

const motionPathSamplerCache = new WeakMap<ProjectMotionPath, MotionPathSampler>();

const pathSamplerFor = (path: ProjectMotionPath): MotionPathSampler => {
    const cached = motionPathSamplerCache.get(path);
    if (cached) return cached;

    const timedPoints = path.timedPoints?.length
        ? [...path.timedPoints].sort((a, b) => a.time - b.time)
        : undefined;
    const timedDuration = path.duration || timedPoints?.at(-1)?.time || 1;
    const timedLast = timedPoints?.at(-1);
    const usesTimedClosedDistance = Boolean(
        timedPoints &&
        timedPoints.length > 1 &&
        path.closed &&
        timedLast &&
        timedLast.time >= timedDuration - 1e-6,
    );
    const timedDistanceSegments = usesTimedClosedDistance
        ? projectPathSegments(timedPoints!, true)
        : [];
    const timedDistanceTotal = timedDistanceSegments.reduce(
        (sum, segment) => sum + segment.length,
        0,
    ) || 1;
    const pointSegments = projectPathSegments(path.points, path.closed);
    const pointTotal = pointSegments.reduce(
        (sum, segment) => sum + segment.length,
        0,
    ) || 1;

    const sampler: MotionPathSampler = (angle) => {
        const phase = cyclePhase(angle);
        if (timedPoints?.length) {
            if (usesTimedClosedDistance) {
                let target = phase * timedDistanceTotal;
                for (const segment of timedDistanceSegments) {
                    if (target <= segment.length) {
                        return pointBetween(segment.a, segment.b, target / (segment.length || 1));
                    }
                    target -= segment.length;
                }
                return timedPoints[0] ?? { x: 0, y: 0 };
            }

            const time = phase * timedDuration;
            let previous = timedPoints[0];
            for (let index = 1; index < timedPoints.length; index += 1) {
                const next = timedPoints[index];
                if (time <= next.time) {
                    const span = Math.max(1e-6, next.time - previous.time);
                    const t = Math.max(0, Math.min(1, (time - previous.time) / span));
                    return pointBetween(previous, next, t);
                }
                previous = next;
            }
            if (path.closed && timedPoints.length > 1) {
                const last = timedPoints[timedPoints.length - 1];
                const returnDuration = timedDuration - last.time;
                if (returnDuration > 1e-6) {
                    const t = Math.max(0, Math.min(1, (time - last.time) / returnDuration));
                    return pointBetween(last, timedPoints[0], t);
                }
            }
            return timedPoints[timedPoints.length - 1] ?? { x: 0, y: 0 };
        }

        let target = phase * pointTotal;
        for (const segment of pointSegments) {
            if (target <= segment.length) {
                return pointBetween(segment.a, segment.b, target / (segment.length || 1));
            }
            target -= segment.length;
        }
        return path.points[path.points.length - 1] ?? { x: 0, y: 0 };
    };
    motionPathSamplerCache.set(path, sampler);
    return sampler;
};

export const pointOnGeneratedMechanismPath = (points: Point[], angle: number): Point | undefined => {
    if (points.length < 2) return points[0];
    const scaled = cyclePhase(angle) * points.length;
    const index = Math.floor(scaled) % points.length;
    return pointBetween(points[index], points[(index + 1) % points.length], scaled - Math.floor(scaled));
};

export const pointOnProjectPath = (path: ProjectMotionPath, angle: number): Point => {
    return pathSamplerFor(path)(angle);
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
    let rootJointId = partRootJointId;
    for (let parentJointId = skeleton.joints[rootJointId]?.parentId; parentJointId && !coreBodyRootIds.has(parentJointId); parentJointId = skeleton.joints[rootJointId]?.parentId) {
        rootJointId = parentJointId;
    }
    const ancestorChain = rootJointId !== partRootJointId ? motionJointChain(skeleton, rootJointId, targetJointId) : [];
    const chain = ancestorChain.length ? ancestorChain : directChain;
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

const solveChainTargets = (skeleton: StandardSkeleton, rootJointId: string, targetJointId: string, target: Point, pinTarget = false, preparedChain?: string[]): Record<string, Point> => {
    const root = skeleton.joints[rootJointId]?.position;
    const oldTarget = skeleton.joints[targetJointId]?.position;
    if (!root || !oldTarget || targetJointId === rootJointId) return {};

    const chain = preparedChain ?? motionJointChain(skeleton, rootJointId, targetJointId);
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
    existing: MotionPreview = { parts: {}, sceneObjects: {}, skeleton: project.skeleton },
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
        return { ...existing, parts, skeleton: nextSkeleton, target, targetJointId: resolvedTargetJointId, rootJointId };
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
    return { ...existing, parts, skeleton: nextSkeleton, target: solvedTarget, targetJointId: resolvedTargetJointId, rootJointId };
};

export const motionPreviewForSceneObject = (
    project: ProjectState,
    sceneObjectId: string | undefined,
    target: Point,
    existing: MotionPreview = { parts: {}, sceneObjects: {}, skeleton: project.skeleton }
): MotionPreview => {
    const object = sceneObjectId ? project.sceneObjects[sceneObjectId] : undefined;
    if (!object) return existing;
    return {
        ...existing,
        sceneObjects: {
            ...(existing.sceneObjects ?? {}),
            [object.id]: {
                ...object,
                transform: {
                    ...object.transform,
                    x: target.x,
                    y: target.y
                }
            }
        },
        target
    };
};

type PreparedMotionPathTarget = {
    skeleton: StandardSkeleton;
    targetJointId: string;
    rootJointId: string;
    chain: string[];
    rootDescendantIds: string[];
    targetDescendantIds: string[];
    affectedPartIds: string[];
};

export const createMotionPathPreviewRuntime = (
    project: ProjectState,
    path: ProjectMotionPath,
    targetJointId?: string,
): MotionPathPreviewRuntime => {
    let projectCache = motionPathRuntimeCache.get(project);
    if (!projectCache) {
        projectCache = new WeakMap();
        motionPathRuntimeCache.set(project, projectCache);
    }
    let pathCache = projectCache.get(path);
    if (!pathCache) {
        pathCache = new Map();
        projectCache.set(path, pathCache);
    }
    const cacheKey = targetJointId ?? "\u0000default";
    const cached = pathCache.get(cacheKey);
    if (cached) return cached;

    const pointAt = pathSamplerFor(path);
    const targetPart = path.partId ? project.parts[path.partId] : undefined;
    const skeleton = project.skeleton;
    let prepared: PreparedMotionPathTarget | undefined;
    if (!path.sceneObjectId && targetPart && skeleton) {
        const resolvedTargetJointId = targetJointId
            ?? preferredMotionJointId(
                project,
                path.partId,
                path.targetAnchorJointId,
                { preferDistalWhenRoot: !path.targetAnchorJointId },
            )
            ?? targetPart.anchorJointId;
        const rootJointId = resolveMotionRootJointId(
            skeleton,
            targetPart.anchorJointId,
            resolvedTargetJointId,
            path.chainRootJointId,
        );
        const rootJoint = skeleton.joints[rootJointId];
        const targetJoint = skeleton.joints[resolvedTargetJointId];
        if (rootJoint && targetJoint) {
            const rootDescendantSet = descendantJoints(skeleton, rootJointId);
            prepared = {
                skeleton,
                targetJointId: resolvedTargetJointId,
                rootJointId,
                chain: motionJointChain(skeleton, rootJointId, resolvedTargetJointId),
                rootDescendantIds: [...rootDescendantSet],
                targetDescendantIds: [...descendantJoints(skeleton, resolvedTargetJointId)],
                affectedPartIds: visualPartIdsForJoints(project, targetPart.id, rootDescendantSet),
            };
        }
    }

    const runtime: MotionPathPreviewRuntime = {
        pointAt,
        previewAt: (angle) => {
            const target = pointAt(angle);
            if (path.sceneObjectId) {
                return motionPreviewForSceneObject(
                    project,
                    path.sceneObjectId,
                    target,
                    { parts: {}, sceneObjects: {}, skeleton: project.skeleton },
                );
            }
            if (!prepared || !targetPart) {
                const fallbackTargetJointId = targetJointId
                    ?? preferredMotionJointId(
                        project,
                        path.partId,
                        path.targetAnchorJointId,
                        { preferDistalWhenRoot: !path.targetAnchorJointId },
                    );
                return motionPreviewForTarget(
                    project,
                    path.partId,
                    fallbackTargetJointId,
                    target,
                    { parts: {}, sceneObjects: {}, skeleton: project.skeleton },
                    { rootJointId: path.chainRootJointId },
                );
            }

            const {
                skeleton: preparedSkeleton,
                targetJointId: preparedTargetJointId,
                rootJointId,
                chain,
                rootDescendantIds,
                targetDescendantIds,
                affectedPartIds,
            } = prepared;
            const rootJoint = preparedSkeleton.joints[rootJointId];
            const targetJoint = preparedSkeleton.joints[preparedTargetJointId];
            if (!rootJoint || !targetJoint) {
                return motionPreviewForTarget(
                    project,
                    path.partId,
                    preparedTargetJointId,
                    target,
                    { parts: {}, sceneObjects: {}, skeleton: preparedSkeleton },
                    { rootJointId },
                );
            }

            if (preparedTargetJointId === rootJointId) {
                const dx = target.x - rootJoint.position.x;
                const dy = target.y - rootJoint.position.y;
                const jointUpdates: Record<string, Point> = {};
                rootDescendantIds.forEach((id) => {
                    const joint = preparedSkeleton.joints[id];
                    if (joint) jointUpdates[id] = { x: joint.position.x + dx, y: joint.position.y + dy };
                });
                const nextSkeleton = withJointUpdates(preparedSkeleton, jointUpdates);
                const parts: Record<string, BodyPartLayer> = {};
                affectedPartIds.forEach((partId) => {
                    const part = project.parts[partId];
                    const anchor = nextSkeleton?.joints[part.anchorJointId]?.position;
                    parts[partId] = anchor
                        ? placeBodyPartPivotAt(part, anchor, nextSkeleton)
                        : part;
                });
                return {
                    parts,
                    sceneObjects: {},
                    skeleton: nextSkeleton,
                    target,
                    targetJointId: preparedTargetJointId,
                    rootJointId,
                };
            }

            const jointUpdates = solveChainTargets(
                preparedSkeleton,
                rootJointId,
                preparedTargetJointId,
                target,
                false,
                chain,
            );
            const solvedTarget = jointUpdates[preparedTargetJointId] ?? targetJoint.position;
            const endDx = solvedTarget.x - targetJoint.position.x;
            const endDy = solvedTarget.y - targetJoint.position.y;
            targetDescendantIds.forEach((id) => {
                if (!jointUpdates[id] && preparedSkeleton.joints[id]) {
                    jointUpdates[id] = {
                        x: preparedSkeleton.joints[id].position.x + endDx,
                        y: preparedSkeleton.joints[id].position.y + endDy,
                    };
                }
            });
            const nextSkeleton = withJointUpdates(preparedSkeleton, jointUpdates);
            const parts: Record<string, BodyPartLayer> = {};
            affectedPartIds.forEach((partId) => {
                const part = project.parts[partId];
                parts[partId] = partWithAnimatedSegment(part, preparedSkeleton, nextSkeleton);
            });
            return {
                parts,
                sceneObjects: {},
                skeleton: nextSkeleton,
                target: solvedTarget,
                targetJointId: preparedTargetJointId,
                rootJointId,
            };
        },
    };
    pathCache.set(cacheKey, runtime);
    return runtime;
};

export const motionPreviewForPath = (
    project: ProjectState,
    path: ProjectMotionPath,
    angle: number,
    targetJointId?: string,
): MotionPreview => createMotionPathPreviewRuntime(project, path, targetJointId).previewAt(angle);

export const motionPreviewForPaths = (
    project: ProjectState,
    paths: ProjectMotionPath[],
    timelineMs: number,
): MotionPreview => {
    let preview: MotionPreview = {
        parts: {},
        sceneObjects: {},
        skeleton: project.skeleton,
    };
    playableMotionPaths(project, paths).forEach(path => {
        const pathAngle = motionAngleAtTimelineMs(
            timelineMs,
            validMotionDurationMs(path.duration, project.settings.animationDurationMs),
        );
        const target = pointOnProjectPath(path, pathAngle);
        if (path.sceneObjectId) {
            preview = motionPreviewForSceneObject(
                project,
                path.sceneObjectId,
                target,
                preview,
            );
            return;
        }
        const pathMechanism = project.mechanisms.flatMap(mechanism =>
            resolvedMechanismOutputBindings(project, mechanism)
                .filter(binding => binding.pathId === path.id)
                .map(binding => ({ mechanism, binding }))
        )[0];
        const targetJointId = preferredMotionJointId(
            project,
            path.partId,
            pathMechanism?.binding.targetAnchorJointId ?? path.targetAnchorJointId,
            { preferDistalWhenRoot: !path.targetAnchorJointId },
        );
        preview = motionPreviewForTarget(
            project,
            path.partId,
            targetJointId,
            target,
            preview,
            { rootJointId: path.chainRootJointId },
        );
    });
    return preview;
};

export const mechanismPathFitIsUsable = (project: ProjectState, mechanism: MechanismConfig) =>
    mechanism.type !== '4bar' ||
    !mechanismOutputBindings(mechanism).length ||
    resolvedMechanismOutputBindings(project, mechanism).every(binding => {
        if (binding.targetSceneObjectId) return true;
        const boundMechanism = mechanismWithOutputBindings(mechanism, [binding]);
        const fit = binding.fit ?? boundMechanism.fabricationMetadata?.pathFit;
        return fit?.status === 'fit' && mechanismPathFitBindingIssues(project, boundMechanism).length === 0;
    });

export const mechanismBindingWarnings = (project: ProjectState, mechanisms: MechanismConfig[] = project.mechanisms) => {
    const warnings: Record<string, string[]> = {};
    const add = (mechanismId: string, message: string) => {
        warnings[mechanismId] = [...(warnings[mechanismId] ?? []), message];
    };
    const drivenTargets = new Map<string, { mechanismId: string; bindingId: string }>();
    const drivenPaths = new Map<string, { mechanismId: string; bindingId: string }>();
    mechanisms.filter(m => m.visible && m.enabled !== false).forEach(m => {
        resolvedMechanismOutputBindings(project, m).filter(binding => binding.enabled !== false).forEach(binding => {
        const boundMechanism = mechanismWithOutputBindings(m, [binding]);
        const pathFit = binding.fit ?? boundMechanism.fabricationMetadata?.pathFit;
        if (!mechanismOutputPortForBinding(m, binding)) {
            add(m.id, `Output ${binding.portId} is unavailable.`);
        }
        const pathOwner = drivenPaths.get(binding.pathId);
        if (pathOwner) {
            add(pathOwner.mechanismId, `${m.id} also drives path ${binding.pathId}; each motion can have only one output.`);
            add(m.id, `${pathOwner.mechanismId} also drives path ${binding.pathId}; each motion can have only one output.`);
        } else {
            drivenPaths.set(binding.pathId, { mechanismId: m.id, bindingId: binding.id });
        }
        if (m.type === '4bar' && binding.pathId && !binding.targetSceneObjectId && pathFit?.status !== 'fit') {
            add(
                m.id,
                pathFit?.status === 'rejected' || pathFit?.status === 'closest'
                    ? 'No fabrication-valid path fit.'
                    : 'Fit path first.',
            );
        } else if (mechanismPathFitBindingIssues(project, boundMechanism).length) {
            add(m.id, 'No fabrication-valid path fit.');
        } else if (pathFit?.status === 'rejected' || pathFit?.status === 'closest') {
            add(m.id, 'No fabrication-valid path fit.');
        } else if (pathFit?.status === 'unfitted') {
            add(m.id, 'Fit path first.');
        }
        if (binding.targetSceneObjectId) {
            const object = project.sceneObjects[binding.targetSceneObjectId];
            if (!object) {
                add(m.id, `Target object ${binding.targetSceneObjectId} is missing.`);
                return;
            }
            const path = project.paths[binding.pathId];
            if (!path) add(m.id, `Target path ${binding.pathId} is missing.`);
            else if (path.sceneObjectId !== binding.targetSceneObjectId) add(m.id, `Target path ${binding.pathId} belongs to ${path.sceneObjectId ?? path.partId}, not ${binding.targetSceneObjectId}.`);
            const key = `object:${binding.targetSceneObjectId}`;
            const owner = drivenTargets.get(key);
            if (owner) {
                add(owner.mechanismId, `${m.id} also drives ${key}; only one mechanism can own a target.`);
                add(m.id, `${owner.mechanismId} also drives ${key}; only one mechanism can own a target.`);
            } else {
                drivenTargets.set(key, { mechanismId: m.id, bindingId: binding.id });
            }
            return;
        }
        if (!binding.targetPartId) return;
        const part = project.parts[binding.targetPartId];
        if (!part) {
            add(m.id, `Target part ${binding.targetPartId} is missing.`);
            return;
        }
        const path = project.paths[binding.pathId];
        if (!path) add(m.id, `Target path ${binding.pathId} is missing.`);
        else if (!mechanismMatchesPathOwner(boundMechanism, path, project)) add(m.id, `Target path ${binding.pathId} belongs to ${path.sceneObjectId ?? path.partId}, not ${binding.targetPartId}.`);
        if (binding.targetAnchorJointId && !motionAnchorJointIds(project, binding.targetPartId).includes(binding.targetAnchorJointId)) {
            add(m.id, `Target anchor ${binding.targetAnchorJointId} is outside ${binding.targetPartId}'s skeleton chain.`);
        }
        const targetJointId = preferredMotionJointId(project, binding.targetPartId, binding.targetAnchorJointId ?? path?.targetAnchorJointId);
        const rootOptions = motionChainRootJointIds(project, binding.targetPartId, targetJointId);
        if (path?.chainRootJointId && !rootOptions.includes(path.chainRootJointId)) add(m.id, `Chain root ${path.chainRootJointId} is outside ${binding.targetPartId}'s IK path.`);
        const rootJointId = path?.chainRootJointId && rootOptions.includes(path.chainRootJointId) ? path.chainRootJointId : part.anchorJointId;
        const key = `${binding.targetPartId}:${rootJointId}:${targetJointId ?? part.anchorJointId}`;
        const owner = drivenTargets.get(key);
        if (owner) {
            add(owner.mechanismId, `${m.id} also drives ${key}; only one mechanism can own a target chain.`);
            add(m.id, `${owner.mechanismId} also drives ${key}; only one mechanism can own a target chain.`);
        } else {
            drivenTargets.set(key, { mechanismId: m.id, bindingId: binding.id });
        }
        });
    });
    return warnings;
};

export const motionPreviewForProject = (project: ProjectState, mechanisms: MechanismConfig[], angle: number): MotionPreview => {
    const cached = motionPreviewCache.get(project)?.find(
        (entry) => entry.angle === angle && sameMechanismSet(entry.mechanisms, mechanisms),
    );
    if (cached) return cached.preview;

    const warnings = mechanismBindingWarnings(project, mechanisms);
    const drivenTargets = new Set<string>();
    let preview: MotionPreview = { parts: {}, sceneObjects: {}, skeleton: project.skeleton, warnings };
    // A rejected authored-path fit still has a real mechanism output. Keep the
    // fabrication/export blocker, but preview that physical output so Design
    // never disconnects a valid target binding from the moving mechanism.
    mechanisms.filter(m => m.visible && m.enabled !== false).forEach(m => {
        resolvedMechanismOutputBindings(project, m).filter(binding => binding.enabled !== false).forEach(binding => {
        if (binding.targetSceneObjectId) {
            const object = project.sceneObjects[binding.targetSceneObjectId];
            if (!object) return;
            const state = calculateLinkage(m, angle);
            if (!state.isValid) {
                warnings[m.id] = [...(warnings[m.id] ?? []), 'Current mechanism angle is outside the valid motion range.'];
                return;
            }
            const physicalTarget = mechanismTracePointForState(
                m.type,
                state,
                binding.outputTraceId ?? binding.fit?.outputTraceId,
            );
            const key = `object:${binding.targetSceneObjectId}`;
            if (drivenTargets.has(key)) return;
            drivenTargets.add(key);
            preview = motionPreviewForSceneObject(project, binding.targetSceneObjectId, physicalTarget, preview);
            return;
        }
        if (!binding.targetPartId || !project.parts[binding.targetPartId]) return;
        const state = calculateLinkage(m, angle);
        if (!state.isValid) {
            warnings[m.id] = [...(warnings[m.id] ?? []), 'Current mechanism angle is outside the valid motion range.'];
            return;
        }
        const physicalTarget = mechanismTracePointForState(
            m.type,
            state,
            binding.outputTraceId ?? binding.fit?.outputTraceId,
        );
        const path = project.paths[binding.pathId];
        const targetJointId = preferredMotionJointId(project, binding.targetPartId, binding.targetAnchorJointId ?? path?.targetAnchorJointId);
        const rootOptions = motionChainRootJointIds(project, binding.targetPartId, targetJointId);
        const rootJointId = path?.chainRootJointId && rootOptions.includes(path.chainRootJointId) ? path.chainRootJointId : undefined;
        const key = `${binding.targetPartId}:${rootJointId ?? project.parts[binding.targetPartId].anchorJointId}:${targetJointId ?? project.parts[binding.targetPartId].anchorJointId}`;
        if (drivenTargets.has(key)) return;
        drivenTargets.add(key);
        preview = motionPreviewForTarget(project, binding.targetPartId, targetJointId, physicalTarget, preview, { pinTarget: true, rootJointId });
        });
    });
    const result = { ...preview, warnings };
    const entries = motionPreviewCache.get(project) ?? [];
    entries.push({ angle, mechanisms: [...mechanisms], preview: result });
    if (entries.length > 8) entries.splice(0, entries.length - 8);
    motionPreviewCache.set(project, entries);
    return result;
};

export const animatedPartsForProject = (project: ProjectState, mechanisms: MechanismConfig[], angle: number): Record<string, BodyPartLayer> => {
    return motionPreviewForProject(project, mechanisms, angle).parts;
};

export const animatedSceneObjectsForProject = (project: ProjectState, mechanisms: MechanismConfig[], angle: number): Record<string, SceneObject> => {
    return motionPreviewForProject(project, mechanisms, angle).sceneObjects ?? {};
};
