import type { ProjectState, StandardSkeleton } from '../types';

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

type MotionRig = Pick<ProjectState, 'parts' | 'skeleton'>;

const childIds = (skeleton: StandardSkeleton | null | undefined, id: string) =>
    (skeleton?.hierarchy[id] ?? []).filter(child => skeleton?.joints[child]?.parentId === id);

export const descendantJoints = (skeleton: StandardSkeleton | null | undefined, rootJointId: string) => {
    const seen = new Set<string>([rootJointId]);
    const stack = [...childIds(skeleton, rootJointId)];
    while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(...childIds(skeleton, id));
    }
    return seen;
};

/** Stop at a fork: a body hub or a hand with fingers has no implicit branch. */
const distalJointId = (skeleton: StandardSkeleton | null | undefined, rootJointId: string) => {
    const seen = new Set<string>();
    let id = rootJointId;
    while (!seen.has(id)) {
        seen.add(id);
        const children = childIds(skeleton, id);
        if (children.length !== 1 || seen.has(children[0])) break;
        id = children[0];
    }
    return id;
};

export const motionAnchorJointIds = (project: MotionRig, partId: string | undefined): string[] => {
    const part = partId ? project.parts[partId] : undefined;
    if (!part) return [];
    const allowed = descendantJoints(project.skeleton, part.anchorJointId);
    const ordered = Object.keys(project.skeleton?.joints ?? {}).filter(id => allowed.has(id));
    return ordered.length ? ordered : [part.anchorJointId];
};

export const motionChainRootJointIds = (project: MotionRig, partId: string | undefined, targetJointId: string | undefined): string[] => {
    const part = partId ? project.parts[partId] : undefined;
    const skeleton = project.skeleton;
    if (!part || !skeleton) return [];
    const target = preferredMotionJointId(project, partId, targetJointId, { preferDistalWhenRoot: !targetJointId }) ?? part.anchorJointId;
    return motionRootOptionsFor(skeleton, part.anchorJointId, target);
};

export const preferredMotionJointId = (
    project: MotionRig,
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
    if (!requestedJointId || options.preferDistalWhenRoot) return distalJointId(project.skeleton, rootJointId);
    return requested ?? rootJointId;
};

export const motionJointChain = (skeleton: StandardSkeleton, rootJointId: string, targetJointId: string) => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | null | undefined = targetJointId;
    while (current && skeleton.joints[current] && !seen.has(current)) {
        seen.add(current);
        chain.push(current);
        if (current === rootJointId) return chain.reverse();
        current = skeleton.joints[current].parentId;
    }
    return [];
};

const jointDisplayName = (skeleton: StandardSkeleton | null | undefined, id?: string) =>
    id ? (skeleton?.joints[id]?.name || id).replaceAll('_', ' ') : 'none';

/** The limb begins after the nearest ancestor fork, independent of joint names. */
function motionRootOptionsFor(skeleton: StandardSkeleton, partRootJointId: string, targetJointId: string) {
    if (!motionJointChain(skeleton, partRootJointId, targetJointId).length) return [];
    let rootJointId = partRootJointId;
    const seen = new Set([rootJointId]);
    while (!skeleton.joints[rootJointId].locked) {
        const parentId = skeleton.joints[rootJointId].parentId;
        if (!parentId || !skeleton.joints[parentId] || seen.has(parentId)) break;
        if (childIds(skeleton, parentId).length > 1) break;
        rootJointId = parentId;
        seen.add(rootJointId);
    }
    // A single-joint branch still rotates at its attachment instead of detaching.
    if (rootJointId === targetJointId && !skeleton.joints[rootJointId].locked) {
        const parentId = skeleton.joints[rootJointId].parentId;
        if (parentId && skeleton.joints[parentId] && !seen.has(parentId)) rootJointId = parentId;
    }
    const chain = motionJointChain(skeleton, rootJointId, targetJointId);
    let lastLocked = -1;
    chain.forEach((id, index) => { if (skeleton.joints[id].locked) lastLocked = index; });
    return lastLocked >= 0 ? chain.slice(lastLocked) : chain;
}

/** Joints that move include every branch attached below the fixed start. */
export const motionMovingJointIds = (skeleton: StandardSkeleton, chain: readonly string[]) =>
    chain.length ? [...descendantJoints(skeleton, chain[chain.length > 1 ? 1 : 0])] : [];

export const resolveMotionRootJointId = (skeleton: StandardSkeleton, partRootJointId: string, targetJointId: string, requestedRootJointId?: string) => {
    const options = motionRootOptionsFor(skeleton, partRootJointId, targetJointId);
    return requestedRootJointId && options.includes(requestedRootJointId) ? requestedRootJointId : options[0] ?? partRootJointId;
};

export const describeMotionChain = (project: MotionRig, partId: string | undefined, targetJointId?: string, options: { rootJointId?: string } = {}): MotionChainDescriptor => {
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
    const invalidSelection = (targetJointId && !motionAnchorJointIds(project, partId).includes(targetJointId))
        || (options.rootJointId && !motionRootOptionsFor(skeleton, partRootJointId, resolvedTargetJointId).includes(options.rootJointId));
    const jointIds = invalidSelection ? [] : motionJointChain(skeleton, rootJointId, resolvedTargetJointId);
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
            warning: 'Use Automatic to restore joints'
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
            helper: 'Moves the branch freely.',
            canFold: false,
            ...(skeleton.joints[rootJointId]?.parentId ? { warning: 'Use Automatic to keep joints connected' } : {})
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
            helper: 'Rotates at the start joint.',
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
        helper: 'Connected joints follow.',
        canFold: false
    };
};

export const motionChainOptionLabel = (project: MotionRig, partId: string | undefined, jointId: string, options: { rootJointId?: string } = {}): string => {
    const rootJointId = options.rootJointId && motionChainRootJointIds(project, partId, jointId).includes(options.rootJointId)
        ? options.rootJointId : undefined;
    const descriptor = describeMotionChain(project, partId, jointId, { rootJointId });
    const jointWord = descriptor.jointCount === 1 ? 'joint' : 'joints';
    return `${jointDisplayName(project.skeleton, jointId)} · ${descriptor.jointCount || 0} ${jointWord}`;
};

