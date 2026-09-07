import type { Point, StandardSkeleton } from '../types';
import { motionJointChain } from './motionChains';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const difference = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const finite = (point: Point | undefined): point is Point => Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));

/** Coincident points use an authored direction; a zero-length link stays zero. */
const atDistance = (anchor: Point, toward: Point, length: number, fallback: Point): Point => {
    let dx = toward.x - anchor.x, dy = toward.y - anchor.y;
    let magnitude = Math.hypot(dx, dy);
    if (!magnitude) {
        dx = fallback.x; dy = fallback.y;
        magnitude = Math.hypot(dx, dy);
    }
    return magnitude ? { x: anchor.x + dx / magnitude * length, y: anchor.y + dy / magnitude * length }
        : { x: anchor.x + length, y: anchor.y };
};

/** Intersect a link circle with a remaining-reach circle, preserving the chosen side. */
const trianglePoint = (root: Point, end: Point, length: number, remaining: number, hint: Point, bend?: number): Point => {
    if (!length) return { ...root };
    const desired = distance(root, end);
    if (!desired) return atDistance(root, hint, length, { x: 1, y: 0 });
    const scale = Math.max(length, remaining, desired);
    const a = length / scale, b = remaining / scale, c = desired / scale;
    const cosine = clamp(((a - b) * (a + b) + c * c) / (2 * a * c), -1, 1);
    const dx = (end.x - root.x) / desired, dy = (end.y - root.y) / desired;
    const side = bend === undefined ? dx * (hint.y - root.y) - dy * (hint.x - root.x) : bend;
    const sine = Math.sqrt(Math.max(0, (1 - cosine) * (1 + cosine))) * (side < 0 ? -1 : 1);
    return { x: root.x + length * (dx * cosine - dy * sine), y: root.y + length * (dy * cosine + dx * sine) };
};

const solveLongChain = (positions: Point[], lengths: number[], end: Point, tolerance: number): Point[] => {
    const next = positions.map(point => ({ ...point }));
    const directions = positions.slice(1).map((point, index) => difference(point, positions[index]));
    let previousError = Infinity;
    // FABRIK keeps the authored pose where possible. Each forward pass fixes the root and every length.
    for (let iteration = 0; iteration < 64; iteration += 1) {
        next[next.length - 1] = { ...end };
        for (let index = next.length - 2; index >= 0; index -= 1) {
            const direction = directions[index];
            next[index] = atDistance(next[index + 1], next[index], lengths[index], { x: -direction.x, y: -direction.y });
        }
        next[0] = { ...positions[0] };
        for (let index = 1; index < next.length; index += 1) {
            next[index] = atDistance(next[index - 1], next[index], lengths[index - 1], directions[index - 1]);
        }
        const error = distance(next[next.length - 1], end);
        if (error <= tolerance) return next;
        if (Math.abs(previousError - error) <= tolerance * 0.01) break;
        previousError = error;
    }

    // Straight or fully folded poses can stall. Place each link inside the rest of the chain's
    // reachable annulus, using the same circle intersection as the two-link solver.
    const reach = Array(lengths.length + 1).fill(0) as number[];
    const longest = [...reach];
    for (let index = lengths.length - 1; index >= 0; index -= 1) {
        reach[index] = lengths[index] + reach[index + 1];
        longest[index] = Math.max(lengths[index], longest[index + 1]);
    }
    for (let index = 0; index < lengths.length - 1; index += 1) {
        const desired = distance(next[index], end), length = lengths[index];
        const lower = Math.max(0, 2 * longest[index + 1] - reach[index + 1], Math.abs(desired - length));
        const upper = Math.min(reach[index + 1], desired + length);
        const remaining = clamp(distance(next[index + 1], end), lower, upper);
        next[index + 1] = trianglePoint(next[index], end, length, remaining, next[index + 1]);
    }
    next[next.length - 1] = { ...end };
    return next;
};

/** pinTarget remains a compatibility argument; fixed-length joints never stretch to a target. */
export const solveChainTargets = (skeleton: StandardSkeleton, rootJointId: string, targetJointId: string, target: Point, _pinTarget = false, preparedChain?: string[]): Record<string, Point> => {
    const chain = preparedChain ?? motionJointChain(skeleton, rootJointId, targetJointId);
    if (!finite(target) || chain.length < 2 || chain[0] !== rootJointId || chain[chain.length - 1] !== targetJointId) return {};
    const positions = chain.map(id => skeleton.joints[id]?.position);
    if (!positions.every(finite) || new Set(chain).size !== chain.length) return {};
    const root = positions[0], oldTarget = positions[positions.length - 1];
    const lengths = positions.slice(1).map((point, index) => distance(point, positions[index]));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    const desired = distance(root, target);
    if (!Number.isFinite(total) || !Number.isFinite(desired)) return {};
    const longest = lengths.reduce((maximum, length) => Math.max(maximum, length), 0);
    const minimum = Math.max(0, 2 * longest - total);
    const direction = difference(distance(root, oldTarget) ? oldTarget : positions[lengths.indexOf(longest) + 1], root);
    const end = desired >= minimum && desired <= total ? { ...target }
        : atDistance(root, target, clamp(desired, minimum, total), direction);
    let next: Point[];
    if (chain.length === 2) next = [root, atDistance(root, target, total, difference(oldTarget, root))];
    else if (chain.length === 3) next = [root,
        trianglePoint(root, end, lengths[0], lengths[1], positions[1], skeleton.joints[chain[1]].bendDirection), end];
    else if (!total) next = positions.map(() => ({ ...root }));
    else if (desired >= total || (minimum > 0 && desired <= minimum)) {
        const longestIndex = lengths.indexOf(longest);
        const axis = difference(end, root);
        next = [{ ...root }];
        lengths.forEach((length, index) => {
            const sign = desired < total && index !== longestIndex ? -1 : 1;
            next.push(atDistance(next[index], { x: next[index].x + axis.x * sign, y: next[index].y + axis.y * sign }, length, direction));
        });
    } else next = solveLongChain(positions, lengths, end, total * 1e-10);
    if (!next.every(finite)) return {};
    return Object.fromEntries(chain.slice(1).map((id, index) => [id, next[index + 1]]));
};
