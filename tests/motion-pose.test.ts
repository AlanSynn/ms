import assert from 'node:assert/strict';
import type { BodyPartLayer, Point, StandardSkeleton } from '../types';
import {
    partWithAnimatedSegment,
    partWithTranslatedAnchor,
    propagateSolvedChainUpdates,
    type MotionJointUpdates,
} from '../utils/motionPose';

const near = (actual: number, expected: number, label: string) =>
    assert(Math.abs(actual - expected) < 1e-8, `${label}: expected ${expected}, received ${actual}`);
const nearPoint = (actual: Point, expected: Point, label: string) => {
    near(actual.x, expected.x, `${label} x`);
    near(actual.y, expected.y, `${label} y`);
};
const skeleton = (entries: Array<[id: string, parent: string | null, x: number, y: number]>): StandardSkeleton => ({
    joints: Object.fromEntries(entries.map(([id, parentId, x, y]) => [id, {
        id, name: id, parentId, position: { x, y }, locked: false, bendDirection: 1,
    }])),
    bones: entries.flatMap(([id, parent]) => parent ? [[parent, id] as [string, string]] : []),
    rootJointIds: entries.filter(([, parent]) => !parent).map(([id]) => id),
    hierarchy: Object.fromEntries(entries.map(([id]) => [id, entries.filter(([, parent]) => parent === id).map(([child]) => child)])),
    jointMap: {}, metadata: { sourceFormat: 'motion-pose-test', scale: 1 },
});
const apply = (rest: StandardSkeleton, updates: MotionJointUpdates): StandardSkeleton => ({
    ...rest,
    joints: Object.fromEntries(Object.entries(rest.joints).map(([id, joint]) => [id,
        updates[id] ? { ...joint, position: updates[id] } : joint,
    ])),
});
const worldPoint = (part: BodyPartLayer, local: Point): Point => {
    const angle = part.transform.rotation * Math.PI / 180;
    const x = local.x * part.transform.scale, y = local.y * part.transform.scale;
    return { x: part.transform.x + x * Math.cos(angle) - y * Math.sin(angle),
        y: part.transform.y + x * Math.sin(angle) + y * Math.cos(angle) };
};
const makePart = (rest: StandardSkeleton, anchorJointId: string, rotation = 30, scale = 1.75): BodyPartLayer => {
    const pivot = { x: 2, y: -3 };
    const angle = rotation * Math.PI / 180;
    const anchor = rest.joints[anchorJointId].position;
    return {
        id: `piece-${anchorJointId}`, name: anchorJointId, anchorJointId,
        transform: {
            x: anchor.x - scale * (pivot.x * Math.cos(angle) - pivot.y * Math.sin(angle)),
            y: anchor.y - scale * (pivot.x * Math.sin(angle) + pivot.y * Math.cos(angle)),
            rotation, scale,
        },
        localPivotOffset: pivot, localPivotJointId: anchorJointId,
        zIndex: 4, opacity: .8, visible: true, locked: false, selectable: true,
        bounds: { x: -4, y: -4, width: 8, height: 8 }, fillColor: '#ef476f',
        contourPoints: [{ x: -4, y: -4 }, { x: 4, y: -4 }, { x: 4, y: 4 }, { x: -4, y: 4 }],
        artwork: { version: 1, frame: { x: -4, y: -4, width: 8, height: 8 }, revision: 'pose-ink',
            operations: [{ id: 'mark', kind: 'line', from: { x: -2, y: 0 }, to: { x: 2, y: 0 }, width: 1, color: '#172033' }] },
    };
};

// The same geometric rule supports terminal hands and feet with no child joint.
for (const [root, middle, leaf] of [['shoulder', 'elbow', 'hand'], ['hip', 'knee', 'foot']]) {
    const rest = skeleton([[root, null, 0, 0], [middle, root, 10, 0], [leaf, middle, 20, 0]]);
    const posed = apply(rest, { [middle]: { x: 0, y: 10 }, [leaf]: { x: -10, y: 10 } });
    const forearm = makePart(rest, middle, 12, 2);
    const terminal = makePart(rest, leaf, 30, 1.75);
    const before = JSON.stringify({ rest, posed, forearm, terminal });
    const lowerPose = partWithAnimatedSegment(forearm, rest, posed);
    const leafPose = partWithAnimatedSegment(terminal, rest, posed);
    near(lowerPose.transform.rotation, 192, `${middle} rotates with its segment`);
    near(leafPose.transform.rotation, 210, `${leaf} inherits the incoming segment angle`);
    near(leafPose.transform.rotation - lowerPose.transform.rotation, 18, 'authored leaf angle offset remains');
    nearPoint(worldPoint(leafPose, terminal.localPivotOffset!), posed.joints[leaf].position, 'leaf pivot follows the solved endpoint');
    nearPoint(worldPoint(lowerPose, forearm.localPivotOffset!), posed.joints[middle].position, 'lower piece stays attached');
    near(leafPose.transform.scale, terminal.transform.scale, 'authored scale stays fixed');
    assert.equal(leafPose.artwork, terminal.artwork, 'motion keeps the exact artwork document');
    assert.equal(leafPose.contourPoints, terminal.contourPoints, 'motion keeps the exact cut shape');
    assert.equal(leafPose.localPivotOffset, terminal.localPivotOffset);
    assert.equal(JSON.stringify({ rest, posed, forearm, terminal }), before, 'pose derivation never mutates its inputs');
}

const rest = skeleton([
    ['shoulder', null, 0, 0], ['elbow', 'shoulder', 10, 0], ['hand', 'elbow', 20, 0],
    ['elbow-tag', 'elbow', 10, 4], ['tag-end', 'elbow-tag', 13, 7],
    ['finger', 'hand', 25, 0], ['finger-tip', 'finger', 27, 2],
    ['other-arm', 'shoulder', -10, 0], ['other-hand', 'other-arm', -20, 0],
]);
const solved = { elbow: { x: 0, y: 10 }, hand: { x: -10, y: 10 } };
const beforeBranch = JSON.stringify({ rest, solved });
const branchUpdates = propagateSolvedChainUpdates(rest, ['shoulder', 'elbow', 'hand'], solved);
const branchPose = apply(rest, branchUpdates);
nearPoint(branchUpdates['elbow-tag'], { x: -4, y: 10 }, 'elbow branch inherits the upper segment rotation');
nearPoint(branchUpdates['finger'], { x: -15, y: 10 }, 'terminal branch inherits the lower segment rotation');
for (const [a, b] of rest.bones) {
    const length = (pose: StandardSkeleton) => Math.hypot(
        pose.joints[a].position.x - pose.joints[b].position.x,
        pose.joints[a].position.y - pose.joints[b].position.y,
    );
    near(length(branchPose), length(rest), `${a}/${b} keeps its segment length`);
}
assert(!Object.hasOwn(branchUpdates, 'other-arm') && !Object.hasOwn(branchUpdates, 'other-hand'),
    'unrelated branches at the fixed chain root are not marked as moving');
assert.deepEqual(branchUpdates.elbow, solved.elbow);
assert.deepEqual(branchUpdates.hand, solved.hand);
assert.equal(JSON.stringify({ rest, solved }), beforeBranch);

// Root-only mode moves every descendant by one translation, without an angle.
const translated = propagateSolvedChainUpdates(rest, ['elbow'], { elbow: { x: 14, y: -6 } });
for (const id of ['elbow', 'hand', 'elbow-tag', 'tag-end', 'finger', 'finger-tip']) {
    nearPoint(translated[id], { x: rest.joints[id].position.x + 4, y: rest.joints[id].position.y - 6 }, `${id} shares root translation`);
}
assert(!Object.hasOwn(translated, 'shoulder') && !Object.hasOwn(translated, 'other-arm'));

// Legacy pieces may have no pivot metadata after a valid project-file round trip.
const legacy = { ...makePart(rest, 'elbow', 37, 1.5),
    transform: { x: 3, y: 4, rotation: 37, scale: 1.5 },
    localPivotOffset: undefined, localPivotJointId: undefined };
const legacyBefore = JSON.stringify(legacy);
const legacyPose = partWithAnimatedSegment(legacy, rest, branchPose);
nearPoint(worldPoint(legacy, legacyPose.localPivotOffset!), rest.joints.elbow.position, 'legacy pivot is measured in the authored pose');
nearPoint(worldPoint(legacyPose, legacyPose.localPivotOffset!), branchPose.joints.elbow.position, 'legacy piece follows the moved joint');
near(legacyPose.transform.rotation, 217, 'legacy authored angle survives the segment rotation');
nearPoint(legacyPose.transform, { x: 7, y: 6 }, 'legacy origin receives the same rigid transform');
const translatedLegacy = partWithTranslatedAnchor(legacy, rest, translated.elbow);
nearPoint(translatedLegacy.transform, { x: 7, y: -2 }, 'root-only legacy translation uses its rest pivot');
near(translatedLegacy.transform.rotation, 37, 'root-only translation preserves the authored angle');
near(translatedLegacy.transform.scale, 1.5, 'root-only translation preserves scale');
assert.equal(JSON.stringify(legacy), legacyBefore);
const unnamedPivot = { ...makePart(rest, 'hand'), localPivotJointId: undefined };
const namedPose = partWithTranslatedAnchor(unnamedPivot, rest, { x: 23, y: 6 });
assert.equal(namedPose.localPivotOffset, unnamedPivot.localPivotOffset, 'an existing legacy offset remains authoritative when only its joint id is missing');

// Main motion integration must merge joint updates, then derive parts from rest.
// Reversing independent bindings cannot reset a previously posed sibling.
const twoArms = skeleton([
    ['torso', null, 0, 0], ['left-shoulder', 'torso', -10, 0], ['left-elbow', 'left-shoulder', -20, 0], ['left-hand', 'left-elbow', -30, 0],
    ['right-shoulder', 'torso', 10, 0], ['right-elbow', 'right-shoulder', 20, 0], ['right-hand', 'right-elbow', 30, 0],
]);
const leftUpdates = propagateSolvedChainUpdates(twoArms, ['torso', 'left-shoulder', 'left-elbow', 'left-hand'], {
    'left-elbow': { x: -10, y: -10 }, 'left-hand': { x: -10, y: -20 },
});
const rightUpdates = propagateSolvedChainUpdates(twoArms, ['torso', 'right-shoulder', 'right-elbow', 'right-hand'], {
    'right-elbow': { x: 10, y: 10 }, 'right-hand': { x: 10, y: 20 },
});
const pieces = ['left-elbow', 'left-hand', 'right-elbow', 'right-hand'].map(id => makePart(twoArms, id));
const derive = (posed: StandardSkeleton) => pieces.map(part => partWithAnimatedSegment(part, twoArms, posed));
const forward = derive(apply(apply(twoArms, leftUpdates), rightUpdates));
const reverse = derive(apply(apply(twoArms, rightUpdates), leftUpdates));
assert.deepEqual(forward, reverse, 'independent limb pose results do not depend on binding order');
const firstRight = derive(apply(twoArms, rightUpdates));
assert.deepEqual(forward.slice(2), firstRight.slice(2), 'adding the other arm never resets the first arm pose');
for (const [index, part] of forward.entries()) {
    assert.equal(part.artwork, pieces[index].artwork);
    assert.equal(part.contourPoints, pieces[index].contourPoints);
}

console.log('motion pose preserves leaf orientation, rigid branches, rest pivots and independent limbs');
