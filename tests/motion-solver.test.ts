import assert from 'node:assert/strict';
import type { Point, StandardSkeleton } from '../types';
import { solveChainTargets } from '../utils/motionSolver';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const rig = (points: Point[], bendDirection = 1): StandardSkeleton => ({
    joints: Object.fromEntries(points.map((position, index) => [`j${index}`, {
        id: `j${index}`, name: `Joint ${index}`, position: { ...position },
        parentId: index ? `j${index - 1}` : null, locked: index === 0, bendDirection,
    }])),
    bones: points.slice(1).map((_, index) => [`j${index}`, `j${index + 1}`]),
    rootJointIds: ['j0'], jointMap: {},
    hierarchy: Object.fromEntries(points.map((_, index) => [`j${index}`, index < points.length - 1 ? [`j${index + 1}`] : []])),
    metadata: { sourceFormat: 'motion-solver-test', scale: 1 },
});

let cases = 0;
const check = (skeleton: StandardSkeleton, target: Point, pinTarget = false) => {
    const chain = Object.keys(skeleton.joints);
    const points = chain.map(id => skeleton.joints[id].position);
    const lengths = points.slice(1).map((point, index) => distance(point, points[index]));
    const total = lengths.reduce((sum, value) => sum + value, 0);
    const minimum = Math.max(0, 2 * Math.max(...lengths) - total);
    const tolerance = Math.max(1e-12, total) * 1e-8;
    const before = JSON.stringify(skeleton);
    const updates = solveChainTargets(skeleton, chain[0], chain.at(-1)!, target, pinTarget);
    assert.equal(updates[chain[0]], undefined, 'the fixed root is never updated');
    assert.equal(JSON.stringify(skeleton), before, 'solving does not mutate the authored skeleton');
    const result = chain.map(id => updates[id] ?? skeleton.joints[id].position);
    result.forEach(point => assert(Number.isFinite(point.x) && Number.isFinite(point.y), 'all joints remain finite'));
    lengths.forEach((length, index) => assert(
        Math.abs(distance(result[index], result[index + 1]) - length) <= tolerance,
        `link ${index} stays ${length} long for target ${JSON.stringify(target)}`,
    ));
    const desired = distance(points[0], target);
    const end = result.at(-1)!;
    const expectedError = Math.max(0, minimum - desired, desired - total);
    const endpointTolerance = Math.max(tolerance, desired * Number.EPSILON * 8);
    assert(Math.abs(distance(end, target) - expectedError) <= endpointTolerance,
        `${chain.length} joints reach the closest feasible endpoint: target ${JSON.stringify(target)}, error ${distance(end, target)}, expected ${expectedError}`);
    cases += 1;
    return result;
};

const single = rig([{ x: 13, y: -7 }, { x: 13, y: 43 }]);
assert.deepEqual(check(single, { x: 13, y: -7 })[1], single.joints.j1.position,
    'a one-link target at the fixed root keeps the authored direction');
check(single, { x: 180, y: -200 }, true);
check(rig([{ x: 0, y: 0 }, { x: 0, y: 0 }]), { x: 10, y: 15 }, true);

for (const bend of [-1, -0.2, 0, 0.2, 1]) {
    const skeleton = rig([{ x: 11, y: -19 }, { x: 51, y: -19 }, { x: 76, y: -19 }], bend);
    for (const radius of [0, 1, 14.9, 15, 15.00001, 24, 40, 64.99999, 65, 100]) {
        for (let step = 0; step < 24; step += 1) {
            const angle = step * Math.PI / 12;
            const target = { x: 11 + radius * Math.cos(angle), y: -19 + radius * Math.sin(angle) };
            const result = check(skeleton, target, true);
            if (radius > 15 && radius < 65) {
                const side = (target.x - 11) * (result[1].y + 19) - (target.y + 19) * (result[1].x - 11);
                assert((bend < 0 ? -1 : 1) * side > 0, 'the analytic bend stays on the selected side');
            }
        }
    }
}

for (const points of [
    [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 60, y: 0 }],
    [{ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 0, y: 0 }],
    [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 0 }],
    [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 0 }],
    [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    [{ x: 0, y: 0 }, { x: 1e-9, y: 0 }, { x: 2e-9, y: 0 }],
]) {
    for (const target of [{ x: 0, y: 0 }, { x: 1e-10, y: 1e-10 }, { x: 10, y: -20 }, { x: 80, y: 0 }]) {
        for (const bend of [-1, 1]) check(rig(points, bend), target);
    }
}

const fromLengths = (lengths: number[], curved = false) => {
    const points: Point[] = [{ x: -23, y: 17 }];
    lengths.forEach((length, index) => {
        const angle = curved ? Math.sin(index * 1.7) * 1.8 : 0;
        const previous = points.at(-1)!;
        points.push({ x: previous.x + length * Math.cos(angle), y: previous.y + length * Math.sin(angle) });
    });
    return points;
};
for (const points of [
    fromLengths([40, 30, 20]),
    fromLengths([100, 5, 7]),
    fromLengths([0, 40, 0, 30, 0, 20, 0]),
    fromLengths([0, 0, 0, 0]),
    fromLengths([0, 0, 20, 0]),
    [{ x: 0, y: 0 }, { x: 1e-9, y: 0 }, { x: 2e-9, y: 0 }, { x: 3e-9, y: 0 }],
    [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 30 }],
    ...[5, 11, 47].flatMap(count => [false, true].map(curved =>
        fromLengths(Array.from({ length: count }, (_, index) => 5 + (index * 7) % 19), curved))),
]) {
    const skeleton = rig(points);
    const lengths = points.slice(1).map((point, index) => distance(point, points[index]));
    const maximum = lengths.reduce((sum, value) => sum + value, 0);
    const minimum = Math.max(0, 2 * Math.max(...lengths) - maximum);
    for (const radius of [0, minimum / 2, minimum, ...[0.001, 0.1, 0.45, 0.8, 0.999999].map(t => minimum + (maximum - minimum) * t), maximum, maximum * 1.3]) {
        for (let step = 0; step < 20; step += 1) {
            const angle = step * Math.PI / 10;
            check(skeleton, { x: points[0].x + radius * Math.cos(angle), y: points[0].y + radius * Math.sin(angle) });
        }
    }
    const target = { x: points[0].x + maximum * 0.4, y: points[0].y + maximum * 0.2 };
    const chain = Object.keys(skeleton.joints);
    assert.deepEqual(
        solveChainTargets(skeleton, chain[0], chain.at(-1)!, target),
        solveChainTargets(skeleton, chain[0], chain.at(-1)!, target, true, chain),
        'prepared-chain and legacy pin callers get the same deterministic fixed-length pose',
    );
}

let seed = 17;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
for (let index = 0; index < 100; index += 1) {
    const lengths = Array.from({ length: 3 + index % 31 }, () => random() < 0.15 ? 0 : 2 ** (random() * 12 - 6));
    const points = fromLengths(lengths, index % 2 === 0);
    const skeleton = rig(points);
    const total = lengths.reduce((sum, length) => sum + length, 0);
    for (let sample = 0; sample < 10; sample += 1) {
        const angle = random() * Math.PI * 2, radius = sample ? total * random() : 0;
        check(skeleton, { x: points[0].x + radius * Math.cos(angle), y: points[0].y + radius * Math.sin(angle) });
    }
}

assert.deepEqual(solveChainTargets(single, 'j0', 'j1', { x: NaN, y: 1 }), {}, 'invalid targets do not publish invalid poses');
assert.deepEqual(solveChainTargets(single, 'j0', 'j1', { x: 1, y: Infinity }), {});
assert.deepEqual(solveChainTargets(single, 'j0', 'missing', { x: 0, y: 0 }), {});
assert.deepEqual(solveChainTargets(single, 'j0', 'j0', { x: 0, y: 0 }), {});
assert.deepEqual(solveChainTargets(single, 'j0', 'j1', { x: 0, y: 0 }, false, ['j1', 'j0']), {});
const invalid = rig([{ x: 0, y: 0 }, { x: NaN, y: 1 }]);
assert.deepEqual(solveChainTargets(invalid, 'j0', 'j1', { x: 1, y: 1 }), {});
const branched = rig([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }, { x: 10, y: 10 }]);
branched.joints.j3.parentId = 'j0';
branched.hierarchy = { j0: ['j1', 'j3'], j1: ['j2'], j2: [], j3: [] };
assert.deepEqual(Object.keys(solveChainTargets(branched, 'j0', 'j2', { x: 20, y: 20 })), ['j1', 'j2'],
    'the solver publishes only its selected chain; attached branch propagation belongs to the pose helper');
assert.deepEqual(solveChainTargets(branched, 'j1', 'j3', { x: 20, y: 20 }), {}, 'a disconnected target leaves the rig intact');

console.log(`motion solver contracts ok: ${cases} fixed-length reach cases`);
