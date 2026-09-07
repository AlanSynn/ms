import { solveChainTargets } from './motionSolver';
import { BodyPartLayer, MechanismConfig, MechanismOutputBinding, Point, ProjectMotionPath, ProjectState, SceneObject, StandardJoint, StandardSkeleton } from '../types';
import { calculateLinkage, mechanismTracePointForState } from './kinematics';
import { partWithAnimatedSegment, partWithTranslatedAnchor, propagateSolvedChainUpdates } from './motionPose';
import {
    mechanismMatchesPathOwner,
    mechanismPathFitBindingIssues,
    pathOwnerExists,
    type PathTargetKind,
} from './pathTargets';
import {
    mechanismBindingsConflict,
    mechanismOutputBindings,
    mechanismOutputPortForBinding,
    mechanismWithOutputBindings,
    resolvedMechanismOutputBindings,
} from './mechanismBindings';

import {
    descendantJoints, describeMotionChain, motionAnchorJointIds, motionChainRootJointIds,
    motionMovingJointIds, preferredMotionJointId,
} from './motionChains';
export {
    describeMotionChain, motionAnchorJointIds, motionChainOptionLabel,
    motionChainRootJointIds, motionJointChain, preferredMotionJointId,
    type MotionChainKind, type MotionChainDescriptor,
} from './motionChains';

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
    [...new Set([...(project.pathOrder ?? []), ...Object.keys(project.paths)])]
        .map(id => project.paths[id]).filter((path): path is ProjectMotionPath => Boolean(path));

export const playableMotionPaths = (
    project: ProjectState,
    paths: ProjectMotionPath[] = motionPathsInProjectOrder(project),
) => paths.filter(path => motionPathReadiness(project, path).playable);

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

export type MotionPathStatus = 'Ready' | 'Draw' | 'Fix' | 'Hidden' | 'Off' | 'Conflict';

export const motionPathStatus = (project: ProjectState, path: ProjectMotionPath): MotionPathStatus =>
    motionPathReadiness(project, path).status;

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
    const chain = targetKind === 'part' ? describeMotionChain(project, targetId) : undefined;
    return {
        id: nextMotionPathId(project, targetId),
        partId: targetKind === 'part' ? targetId : '',
        sceneObjectId: targetKind === 'scene-object' ? targetId : undefined,
        targetAnchorJointId: chain?.targetJointId,
        chainRootJointId: chain?.rootJointId,
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

export interface MotionPathReadiness {
    status: MotionPathStatus;
    playable: boolean;
    reason?: string;
    conflictPathIds: string[];
    movingJointIds: string[];
    targetJointId?: string;
    fixedRootJointId?: string;
}

const readinessCache = new WeakMap<ProjectState, Map<string, MotionPathReadiness>>();

const baseMotionPathReadiness = (project: ProjectState, path: ProjectMotionPath): MotionPathReadiness => {
    const result: MotionPathReadiness = {
        status: path.visible ? 'Ready' : 'Hidden', playable: true,
        conflictPathIds: [], movingJointIds: [],
    };
    const blocked = (status: MotionPathStatus, reason: string) => ({ ...result, status, playable: false, reason });
    if (!path.enabled) return blocked('Off', 'Enable path');
    if (!pathOwnerExists(project, path)) return blocked('Fix', 'Choose a target');
    if (path.points.length < 3) return blocked('Draw', 'Draw 3 points');
    if (path.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)) ||
        !path.points.some(point => Math.hypot(point.x - path.points[0].x, point.y - path.points[0].y) > 1e-6)) {
        return blocked('Fix', 'Redraw path');
    }
    if (!Number.isFinite(path.duration) || path.duration <= 0) return blocked('Fix', 'Set duration');
    if (path.warnings.some(warning => !['Path needs at least 3 points', 'Path disabled or empty'].includes(warning))) {
        return blocked('Fix', 'Check path warning');
    }
    if (path.sceneObjectId) return result;
    const part = project.parts[path.partId];
    const skeleton = project.skeleton;
    if (!skeleton?.joints[part.anchorJointId]) return blocked('Fix', 'Add target joints');
    const allowedTargets = motionAnchorJointIds(project, path.partId);
    if (path.targetAnchorJointId && !allowedTargets.includes(path.targetAnchorJointId)) return blocked('Fix', 'Choose a handle');
    const targetJointId = preferredMotionJointId(project, path.partId, path.targetAnchorJointId, {
        preferDistalWhenRoot: !path.targetAnchorJointId,
    });
    if (!targetJointId || !skeleton.joints[targetJointId]) return blocked('Fix', 'Choose a handle');
    if (path.chainRootJointId && !motionChainRootJointIds(project, path.partId, targetJointId).includes(path.chainRootJointId)) {
        return blocked('Fix', 'Choose a start joint');
    }
    const chain = describeMotionChain(project, path.partId, targetJointId, { rootJointId: path.chainRootJointId });
    if (chain.kind === 'invalid' || chain.jointIds.some(id => !skeleton.joints[id])) return blocked('Fix', 'Choose a reachable handle');
    result.targetJointId = targetJointId;
    result.fixedRootJointId = chain.jointCount > 1 ? chain.rootJointId : undefined;
    result.movingJointIds = motionMovingJointIds(skeleton, chain.jointIds);
    if (result.movingJointIds.some(id => skeleton.joints[id]?.locked)) return blocked('Fix', 'Unlock moving joints');
    return result;
};

/** Shared by inventory, fitting, and playback. Visibility never disables motion. */
export const motionPathReadiness = (project: ProjectState, path: ProjectMotionPath): MotionPathReadiness => {
    let results = readinessCache.get(project);
    if (!results) {
        const paths = motionPathsInProjectOrder(project);
        results = new Map(paths.map(candidate => [candidate.id, baseMotionPathReadiness(project, candidate)]));
        const eligible = paths.filter(candidate => results!.get(candidate.id)!.playable);
        eligible.forEach((left, index) => eligible.slice(index + 1).forEach(right => {
            const a = results!.get(left.id)!;
            const b = results!.get(right.id)!;
            const conflicts = left.sceneObjectId && right.sceneObjectId
                ? left.sceneObjectId === right.sceneObjectId
                : !left.sceneObjectId && !right.sceneObjectId && (
                    a.movingJointIds.some(id => b.movingJointIds.includes(id) || b.fixedRootJointId === id) ||
                    b.movingJointIds.some(id => a.fixedRootJointId === id)
                );
            if (!conflicts) return;
            a.conflictPathIds.push(right.id);
            b.conflictPathIds.push(left.id);
        }));
        results.forEach(result => {
            if (!result.conflictPathIds.length) return;
            result.playable = false;
            result.status = 'Conflict';
            result.reason = 'Disable an overlapping path';
        });
        readinessCache.set(project, results);
    }
    return results.get(path.id) ?? baseMotionPathReadiness(project, path);
};

const firstChildJointId = (skeleton: StandardSkeleton | null | undefined, jointId: string) =>
    (skeleton?.hierarchy[jointId] ?? []).find(id => Boolean(skeleton?.joints[id]));

/** Both cached Path playback and mechanism output use the same pose application. */
const applyMotionTargetPose = (
    project: ProjectState,
    targetPartId: string,
    skeleton: StandardSkeleton,
    chain: string[],
    target: Point,
    existing: MotionPreview,
    affectedPartIds: string[],
    warningId = targetPartId,
): MotionPreview => {
    const rootJointId = chain[0], targetJointId = chain.at(-1);
    if (!rootJointId || !targetJointId) return existing;
    const moving = motionMovingJointIds(skeleton, chain);
    if (moving.some(id => skeleton.joints[id]?.locked)) return {
        ...existing,
        warnings: { ...existing.warnings, [warningId]: ['Unlock moving joints'] },
    };
    const solved = chain.length === 1 ? { [rootJointId]: target }
        : solveChainTargets(skeleton, rootJointId, targetJointId, target, false, chain);
    const updates = propagateSolvedChainUpdates(skeleton, chain, solved);
    const nextSkeleton = withJointUpdates(skeleton, updates)!;
    const parts = { ...existing.parts };
    const rest = project.skeleton ?? skeleton;
    affectedPartIds.forEach(id => {
        const part = project.parts[id];
        const anchor = nextSkeleton.joints[part.anchorJointId]?.position;
        parts[id] = chain.length === 1 && anchor
            ? partWithTranslatedAnchor(existing.parts[id] ?? part, rest, anchor)
            : partWithAnimatedSegment(part, rest, nextSkeleton);
    });
    const solvedTarget = nextSkeleton.joints[targetJointId].position;
    const unreachable = Math.hypot(solvedTarget.x - target.x, solvedTarget.y - target.y) > 0.5;
    const warnings = { ...existing.warnings };
    delete warnings[warningId];
    if (unreachable) warnings[warningId] = ['Move target within reach'];
    return {
        ...existing, parts, skeleton: nextSkeleton, target: solvedTarget, targetJointId, rootJointId,
        ...(Object.keys(warnings).length ? { warnings } : existing.warnings ? { warnings: {} } : {}),
    };
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
    if (!targetPart || !skeleton) return existing;
    const descriptor = describeMotionChain(project, targetPartId, targetJointId, options);
    if (!descriptor.rootJointId || descriptor.kind === 'invalid') return existing;
    const affected = visualPartIdsForJoints(project, targetPart.id, descendantJoints(skeleton, descriptor.rootJointId));
    return applyMotionTargetPose(project, targetPart.id, skeleton, descriptor.jointIds, target, existing, affected);
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
        const descriptor = describeMotionChain(project, path.partId, targetJointId ?? path.targetAnchorJointId, { rootJointId: path.chainRootJointId });
        const resolvedTargetJointId = descriptor.targetJointId ?? targetPart.anchorJointId;
        const rootJointId = descriptor.rootJointId ?? targetPart.anchorJointId;
        const rootJoint = skeleton.joints[rootJointId];
        const targetJoint = skeleton.joints[resolvedTargetJointId];
        if (rootJoint && targetJoint && descriptor.kind !== 'invalid') {
            const rootDescendantSet = descendantJoints(skeleton, rootJointId);
            prepared = {
                skeleton,
                targetJointId: resolvedTargetJointId,
                rootJointId,
                chain: descriptor.jointIds,
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

            return applyMotionTargetPose(
                project, targetPart.id, prepared.skeleton, prepared.chain, target,
                { parts: {}, sceneObjects: {}, skeleton: prepared.skeleton },
                prepared.affectedPartIds, path.id,
            );
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
    paths.forEach(path => {
        const readiness = motionPathReadiness(project, path);
        if (!readiness.playable && readiness.reason) {
            preview.warnings = { ...preview.warnings, [path.id]: [readiness.reason] };
        }
    });
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
        const readiness = motionPathReadiness(project, path);
        // Sample each independent limb against its authored rest pose. Merge only
        // its moving joints/segments, so a shared fixed root cannot reset a sibling.
        const sampled = motionPreviewForPath(project, path, pathAngle, readiness.targetJointId);
        if (sampled.warnings) preview.warnings = { ...preview.warnings, ...sampled.warnings };
        const moving = new Set(readiness.movingJointIds);
        const jointUpdates = Object.fromEntries(readiness.movingJointIds.flatMap(id => {
            const joint = sampled.skeleton?.joints[id];
            return joint ? [[id, joint.position]] : [];
        }));
        preview.skeleton = withJointUpdates(preview.skeleton, jointUpdates);
        Object.entries(sampled.parts).forEach(([id, part]) => {
            const child = firstChildJointId(project.skeleton, part.anchorJointId);
            if (moving.has(part.anchorJointId) || (child && moving.has(child))) preview.parts[id] = part;
        });
        preview.target = sampled.target;
        preview.targetJointId = sampled.targetJointId;
        preview.rootJointId = sampled.rootJointId;
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
    const drivers: { mechanismId: string; binding: MechanismOutputBinding }[] = [];
    const registerDriver = (mechanismId: string, binding: MechanismOutputBinding, label: string) => {
        drivers.forEach(prior => {
            if (!mechanismBindingsConflict(project, prior.binding, binding)) return;
            add(prior.mechanismId, `${mechanismId} also drives ${label}; only one mechanism can own a target chain.`);
            add(mechanismId, `${prior.mechanismId} also drives ${label}; only one mechanism can own a target chain.`);
        });
        drivers.push({ mechanismId, binding });
    };
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
            registerDriver(m.id, binding, `object:${binding.targetSceneObjectId}`);
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
        const rootJointId = path?.chainRootJointId && rootOptions.includes(path.chainRootJointId) ? path.chainRootJointId : rootOptions[0];
        const descriptor = describeMotionChain(project, binding.targetPartId, targetJointId, { rootJointId });
        if (project.skeleton && motionMovingJointIds(project.skeleton, descriptor.jointIds).some(id => project.skeleton!.joints[id]?.locked)) add(m.id, 'Unlock moving joints');
        registerDriver(m.id, binding, `${binding.targetPartId}:${rootJointId}:${targetJointId ?? part.anchorJointId}`);
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
    const drivenTargets: MechanismOutputBinding[] = [];
    let preview: MotionPreview = { parts: {}, sceneObjects: {}, skeleton: project.skeleton, warnings };
    // A rejected authored-path fit still has a real mechanism output. Keep the
    // fabrication/export blocker, but preview that physical output so Design
    // never disconnects a valid target binding from the moving mechanism.
    mechanisms.filter(m => m.visible && m.enabled !== false).forEach(m => {
        resolvedMechanismOutputBindings(project, m).filter(binding => binding.enabled !== false).forEach(binding => {
        if (drivenTargets.some(prior => mechanismBindingsConflict(project, prior, binding))) return;
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
            drivenTargets.push(binding);
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
        const rootJointId = path?.chainRootJointId ?? rootOptions[0];
        if (binding.targetAnchorJointId && !motionAnchorJointIds(project, binding.targetPartId).includes(binding.targetAnchorJointId)) return;
        drivenTargets.push(binding);
        preview = motionPreviewForTarget(project, binding.targetPartId, targetJointId, physicalTarget, preview, { rootJointId });
        const poseWarning = preview.warnings?.[binding.targetPartId];
        if (poseWarning?.length) warnings[m.id] = [...new Set([...(warnings[m.id] ?? []), ...poseWarning])];
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
