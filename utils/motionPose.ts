import type { BodyPartLayer, Point, StandardSkeleton } from '../types';
import { localPivotOffsetForScene, placeBodyPartPivotAt } from './coordinates';

export type MotionJointUpdates = Record<string, Point>;

const segmentRotation = (beforeA: Point, beforeB: Point, afterA: Point, afterB: Point) => {
    if (Math.hypot(beforeB.x - beforeA.x, beforeB.y - beforeA.y) <= 1e-6
        || Math.hypot(afterB.x - afterA.x, afterB.y - afterA.y) <= 1e-6) return undefined;
    return Math.atan2(afterB.y - afterA.y, afterB.x - afterA.x)
        - Math.atan2(beforeB.y - beforeA.y, beforeB.x - beforeA.x);
};

/**
 * Off-chain branches inherit their attachment joint's incoming segment rotation.
 * Every point in a branch gets the same rigid transform. A fixed chain root has
 * no inherited rotation, so its unrelated branches stay still. A one-joint chain
 * translates the whole root subtree. Supplied solved points remain authoritative;
 * this helper does not solve reachability or change the chain's segment lengths.
 */
export const propagateSolvedChainUpdates = (
    rest: StandardSkeleton,
    chain: readonly string[],
    solved: Readonly<Record<string, Readonly<Point>>>,
): MotionJointUpdates => {
    const updates = Object.fromEntries(Object.entries(solved).map(([id, point]) => [id, { ...point }]));
    const chainIds = new Set(chain);
    const visited = new Set<string>();
    chain.forEach((jointId, index) => {
        const before = rest.joints[jointId]?.position;
        if (!before) return;
        const after = solved[jointId] ?? before;
        const parentId = chain[index - 1];
        const beforeParent = parentId ? rest.joints[parentId]?.position : undefined;
        const afterParent = parentId ? solved[parentId] ?? beforeParent : undefined;
        const rotation = beforeParent && afterParent
            ? segmentRotation(beforeParent, before, afterParent, after) ?? 0
            : 0;
        if (before.x === after.x && before.y === after.y && rotation === 0) return;
        const cos = Math.cos(rotation), sin = Math.sin(rotation);
        const pending = [...(rest.hierarchy[jointId] ?? [])];
        while (pending.length) {
            const id = pending.pop()!;
            if (chainIds.has(id) || visited.has(id)) continue;
            visited.add(id);
            const point = rest.joints[id]?.position;
            if (!point) continue;
            if (!Object.hasOwn(solved, id)) {
                const x = point.x - before.x, y = point.y - before.y;
                updates[id] = { x: after.x + x * cos - y * sin, y: after.y + x * sin + y * cos };
            }
            pending.push(...(rest.hierarchy[id] ?? []));
        }
    });
    return updates;
};

/** Bind legacy pivots against the authored pose before moving any part. */
const partWithRestPivot = (part: BodyPartLayer, rest: StandardSkeleton): BodyPartLayer => {
    const anchor = rest.joints[part.anchorJointId]?.position;
    if (!anchor) return part;
    const matchingPivot = part.localPivotOffset
        && (!part.localPivotJointId || part.localPivotJointId === part.anchorJointId);
    if (matchingPivot && part.localPivotJointId === part.anchorJointId) return part;
    return {
        ...part,
        localPivotOffset: matchingPivot ? part.localPivotOffset : localPivotOffsetForScene(part, anchor),
        localPivotJointId: part.anchorJointId,
    };
};

/** Root-only motion translates an authored piece without changing its angle. */
export const partWithTranslatedAnchor = (
    part: BodyPartLayer,
    rest: StandardSkeleton,
    target: Point,
): BodyPartLayer => placeBodyPartPivotAt(partWithRestPivot(part, rest), target, rest);

/**
 * Derive a rigid piece from its canonical part/rest skeleton and the final pose.
 * Preserve outgoing-segment orientation for existing pieces. Leaf hands/feet
 * inherit the incoming segment's rotation, retaining their authored angle offset.
 * Always pass the canonical rest skeleton, even after combining multiple motions.
 */
export const partWithAnimatedSegment = (
    part: BodyPartLayer,
    rest: StandardSkeleton,
    posed: StandardSkeleton | null | undefined,
): BodyPartLayer => {
    const beforeAnchor = rest.joints[part.anchorJointId]?.position;
    const afterAnchor = posed?.joints[part.anchorJointId]?.position;
    if (!beforeAnchor || !afterAnchor || !posed) return part;
    let rotation: number | undefined;
    for (const id of rest.hierarchy[part.anchorJointId] ?? []) {
        const beforeChild = rest.joints[id]?.position;
        const afterChild = posed.joints[id]?.position;
        if (!beforeChild || !afterChild) continue;
        rotation = segmentRotation(beforeAnchor, beforeChild, afterAnchor, afterChild);
        if (rotation !== undefined) break;
    }
    if (rotation === undefined) {
        const parentId = rest.joints[part.anchorJointId]?.parentId;
        const beforeParent = parentId ? rest.joints[parentId]?.position : undefined;
        const afterParent = parentId ? posed.joints[parentId]?.position : undefined;
        if (beforeParent && afterParent) rotation = segmentRotation(beforeParent, beforeAnchor, afterParent, afterAnchor);
    }
    const base = partWithRestPivot(part, rest);
    const rotated = rotation ? {
        ...base,
        transform: { ...base.transform, rotation: base.transform.rotation + rotation * 180 / Math.PI },
    } : base;
    return placeBodyPartPivotAt(rotated, afterAnchor, posed);
};
