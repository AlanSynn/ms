import assert from 'node:assert/strict';
import type { BodyPartLayer, Point, ProjectMotionPath, ProjectState, StandardSkeleton } from '../types';
import {
    createMotionPathForTarget, describeMotionChain, motionAnchorJointIds, motionChainRootJointIds,
    motionJointChain, motionPathReadiness, motionPreviewForPath, motionPreviewForPaths,
    motionPreviewForTarget, motionPreviewForProject, pointOnProjectPath, preferredMotionJointId, type MotionPreview,
} from '../utils/motion';
import { buildSkeleton, CLASSROOM_LESSONS, createEmptyProject, createLessonProject, createSampleProject, replaceCharacterProject, loadProjectSnapshot, serializeProject } from '../utils/project';
import { isMechanismTypeEnabled } from '../utils/mechanismTemplates';

const near = (actual: number, expected: number, label: string, tolerance = 1e-6) =>
    assert(Math.abs(actual - expected) < tolerance, `${label}: ${actual} versus ${expected}`);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const freeze = <T>(value: T): T => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
};
const fresh = (project: ProjectState): ProjectState => freeze(structuredClone({
    ...project, paths: {}, pathOrder: [], mechanisms: [], selectedPathId: undefined,
    selectedMechanismId: undefined, characterPackage: undefined,
}));
const roundTrip = (project: ProjectState) => freeze(loadProjectSnapshot(JSON.parse(serializeProject(project))));
const withPath = (project: ProjectState, path: ProjectMotionPath): ProjectState =>
    freeze({ ...project, paths: { [path.id]: path }, pathOrder: [path.id], selectedPathId: path.id });
const chainForPath = (project: ProjectState, path: ProjectMotionPath) =>
    describeMotionChain(project, path.partId, path.targetAnchorJointId, { rootJointId: path.chainRootJointId });
const poseSummary = (project: ProjectState, preview: MotionPreview) => ({
    joints: Object.fromEntries(Object.entries(preview.skeleton!.joints).map(([id, joint]) => [id, joint.position])),
    parts: Object.fromEntries(Object.entries(project.parts).map(([id, part]) => [id, (preview.parts[id] ?? part).transform])),
});
const assertLengths = (rest: StandardSkeleton, posed: StandardSkeleton, label: string) => {
    for (const [a, b] of rest.bones) {
        near(distance(posed.joints[a].position, posed.joints[b].position),
            distance(rest.joints[a].position, rest.joints[b].position), `${label} preserves ${a}–${b}`);
    }
};
const pathAlong = (project: ProjectState, partId: string, chain: readonly string[], overrides: Partial<ProjectMotionPath> = {}): ProjectMotionPath => {
    const created = createMotionPathForTarget(project, 'part', partId);
    assert(created, `${partId} can own a motion`);
    const skeleton = project.skeleton!;
    const root = skeleton.joints[chain[0]].position;
    const end = skeleton.joints[chain.at(-1)!].position;
    const reach = chain.slice(1).reduce((length, id, index) =>
        length + distance(skeleton.joints[chain[index]].position, skeleton.joints[id].position), 0);
    const radius = reach * (chain.length === 2 ? 1 : .65);
    const angle = Math.atan2(end.y - root.y, end.x - root.x);
    return freeze({ ...created, closed: false, duration: 1200, points: [-.28, .12, .38].map(offset => ({
        x: root.x + Math.cos(angle + offset) * radius,
        y: root.y + Math.sin(angle + offset) * radius,
    })), ...overrides });
};

const limbs = [
    { chain: ['left_shoulder', 'left_elbow', 'left_hand'], parts: ['left_arm_upper', 'left_arm_lower', 'left_hand_part'], opposite: ['right_arm_upper', 'right_arm_lower', 'right_hand_part'] },
    { chain: ['right_shoulder', 'right_elbow', 'right_hand'], parts: ['right_arm_upper', 'right_arm_lower', 'right_hand_part'], opposite: ['left_arm_upper', 'left_arm_lower', 'left_hand_part'] },
    { chain: ['left_hip', 'left_knee', 'left_foot'], parts: ['left_leg_upper', 'left_leg_lower', 'left_foot_part'], opposite: ['right_leg_upper', 'right_leg_lower', 'right_foot_part'] },
    { chain: ['right_hip', 'right_knee', 'right_foot'], parts: ['right_leg_upper', 'right_leg_lower', 'right_foot_part'], opposite: ['left_leg_upper', 'left_leg_lower', 'left_foot_part'] },
];
const expectedChains: Record<string, string[]> = Object.fromEntries([
    ['torso', ['hip', 'torso']], ['head', ['neck', 'head_top']],
    ...limbs.flatMap(limb => limb.parts.map(id => [id, limb.chain])),
]);
const cases: Array<[string, () => void]> = [];
const check = (label: string, run: () => void) => cases.push([label, run]);

for (const [fixtureName, create] of [
    ['sample', () => createSampleProject()], ['waving lesson', () => createLessonProject('waving-arm')],
] as const) {
    for (const [partId, expected] of Object.entries(expectedChains)) check(`${fixtureName}: ${partId}`, () => {
        const project = fresh(create());
        assert.equal(project.partOrder.length, 14, 'both real starters exercise every body piece');
        const before = JSON.stringify(project);
        const descriptor = describeMotionChain(project, partId);
        assert.deepEqual(descriptor.jointIds, expected, `${partId} chooses its connected limb`);
        assert.equal(preferredMotionJointId(project, partId), expected.at(-1));
        const path = pathAlong(project, partId, expected);
        assert.equal(path.targetAnchorJointId, descriptor.targetJointId, 'Add Motion persists the displayed handle');
        assert.equal(path.chainRootJointId, descriptor.rootJointId, 'Add Motion persists the displayed start');
        assert.deepEqual(chainForPath(project, path), descriptor, 'new-path and selection summaries agree');
        const authored = withPath(project, path);
        const legacy = freeze({ ...path, targetAnchorJointId: undefined, chainRootJointId: undefined });
        const legacyProject = withPath(project, legacy);
        const reopened = roundTrip(authored);
        const reopenedLegacy = roundTrip(legacyProject);
        assert.deepEqual(chainForPath(reopened, reopened.paths[path.id]), descriptor, 'saved choices reopen unchanged');
        assert.deepEqual(chainForPath(reopenedLegacy, reopenedLegacy.paths[path.id]), descriptor, 'missing legacy choices use the same defaults');
        assert.deepEqual(chainForPath(project, legacy), descriptor);
        assert.equal(motionPathReadiness(authored, path).playable, true);

        const limb = limbs.find(candidate => candidate.parts.includes(partId));
        for (const phase of [0, 1.2, 3.9]) {
            const preview = motionPreviewForPath(authored, path, phase);
            assert.equal(preview.rootJointId, expected[0]);
            assert.equal(preview.targetJointId, expected.at(-1));
            assertLengths(project.skeleton!, preview.skeleton!, `${fixtureName}/${partId}`);
            assert.deepEqual(preview.skeleton!.joints[expected[0]].position, project.skeleton!.joints[expected[0]].position);
            for (const [otherProject, otherPath] of [[legacyProject, legacy], [reopened, reopened.paths[path.id]], [reopenedLegacy, reopenedLegacy.paths[path.id]]] as const) {
                assert.deepEqual(poseSummary(otherProject, motionPreviewForPath(otherProject, otherPath, phase)), poseSummary(authored, preview),
                    'new, legacy and reopened paths produce the same pose');
            }
            if (limb) {
                near(distance(preview.skeleton!.joints[expected.at(-1)!].position, pointOnProjectPath(path, phase)), 0, 'reachable handle follows the drawn curve');
                const [upperId, lowerId, leafId] = limb.parts;
                assert(preview.parts[upperId], 'the connected upper piece participates for every limb selection');
                assert(Math.abs(preview.parts[upperId].transform.rotation - project.parts[upperId].transform.rotation) > .1,
                    'moving a lower part or endpoint also moves the upper segment');
                const lowerDelta = preview.parts[lowerId].transform.rotation - project.parts[lowerId].transform.rotation;
                const leafDelta = preview.parts[leafId].transform.rotation - project.parts[leafId].transform.rotation;
                near(Math.sin((leafDelta - lowerDelta) * Math.PI / 180), 0, 'leaf orientation follows the incoming segment');
                near(Math.cos((leafDelta - lowerDelta) * Math.PI / 180), 1, 'leaf preserves its authored angular offset');
                for (const id of limb.opposite) {
                    assert.deepEqual((preview.parts[id] ?? project.parts[id]).transform, project.parts[id].transform, 'opposite limb stays still');
                    const jointId = project.parts[id].anchorJointId;
                    assert.deepEqual(preview.skeleton!.joints[jointId].position, project.skeleton!.joints[jointId].position);
                }
            }
        }
        assert.equal(JSON.stringify(project), before, 'defaults, serialization and playback leave the authored fixture intact');
    });
}

check('all starter limb targets preserve their authored rest pose', () => {
    const starters = [() => createSampleProject(), ...CLASSROOM_LESSONS.map(lesson => () => createLessonProject(lesson.id))];
    for (const create of starters) {
        const project = fresh(create());
        for (const limb of limbs) for (const partId of limb.parts) {
            const target = project.skeleton!.joints[limb.chain.at(-1)!].position;
            const path = pathAlong(project, partId, limb.chain, { points: [target, { x: target.x + 2, y: target.y }, { x: target.x, y: target.y + 2 }] });
            const active = withPath(project, path);
            const direct = motionPreviewForTarget(active, partId, undefined, target);
            const reopened = roundTrip(active);
            for (const preview of [direct, motionPreviewForPath(active, path, 0), motionPreviewForPath(reopened, reopened.paths[path.id], 0)]) {
                for (const [id, joint] of Object.entries(project.skeleton!.joints)) {
                    near(distance(preview.skeleton!.joints[id].position, joint.position), 0, `${partId}: ${id} stays in its rest pose`);
                }
                for (const [id, part] of Object.entries(project.parts)) {
                    const posed = preview.parts[id] ?? part;
                    near(distance(posed.transform, part.transform), 0, `${partId}: ${id} keeps its authored origin`);
                    near(posed.transform.rotation, part.transform.rotation, `${partId}: ${id} keeps its authored rotation`);
                    assert.equal(posed.transform.scale, part.transform.scale);
                }
            }
        }
    }
    const project = fresh(createSampleProject());
    const authored = freeze({ ...project, skeleton: buildSkeleton(Object.values(project.skeleton!.joints).map(joint =>
        joint.id === 'left_elbow' || joint.id === 'right_knee' ? { ...joint, bendDirection: 1 } : joint)) });
    const imported = roundTrip(authored);
    for (const id of ['left_elbow', 'right_knee']) {
        assert.equal(imported.skeleton!.joints[id].bendDirection, 1, 'loading a deliberate fold direction never reapplies starter defaults');
    }
    const target = imported.skeleton!.joints.left_hand.position;
    const folded = motionPreviewForTarget(imported, 'left_hand_part', undefined, target);
    assert(distance(folded.skeleton!.joints.left_elbow.position, imported.skeleton!.joints.left_elbow.position) > 1,
        'an explicitly authored opposite fold remains effective after reopening');
});

check('renaming and reordering every joint preserves all fourteen topology defaults', () => {
    const base = fresh(createSampleProject());
    const names = Object.fromEntries(Object.keys(base.skeleton!.joints).map((id, index) => [id, `node-${(index * 37) % 97}`]));
    const ids = Object.fromEntries(Object.keys(base.parts).map((id, index) => [id, `piece-${index}`]));
    const skeleton = buildSkeleton(Object.values(base.skeleton!.joints).reverse().map(joint => ({
        ...joint, id: names[joint.id], name: `Point ${names[joint.id]}`, parentId: joint.parentId ? names[joint.parentId] : null,
    })));
    const project = freeze({ ...base, skeleton, selectedPartId: undefined,
        parts: Object.fromEntries(Object.values(base.parts).reverse().map(part => [ids[part.id], {
            ...part, id: ids[part.id], name: `Piece ${ids[part.id]}`, anchorJointId: names[part.anchorJointId], localPivotJointId: names[part.anchorJointId],
        }])), partOrder: base.partOrder.map(id => ids[id]).reverse() });
    for (const [oldPartId, chain] of Object.entries(expectedChains)) {
        const partId = ids[oldPartId];
        const expected = chain.map(id => names[id]);
        assert.deepEqual(describeMotionChain(project, partId).jointIds, expected);
        const path = pathAlong(project, partId, expected);
        assert.equal(path.chainRootJointId, expected[0]);
        assert.equal(path.targetAnchorJointId, expected.at(-1));
        const opened = roundTrip(withPath(project, path));
        assert.deepEqual(chainForPath(opened, opened.paths[path.id]).jointIds, expected);
        assertLengths(skeleton, motionPreviewForPath(opened, opened.paths[path.id], 1).skeleton!, 'generic renamed rig');
    }
});

type JointEntry = [id: string, parent: string | null, x: number, y: number, locked?: boolean];
const rig = (entries: JointEntry[], anchors: string[]): ProjectState => {
    const skeleton = buildSkeleton(entries.map(([id, parentId, x, y, locked = false]) => ({
        id, name: id, parentId, position: { x, y }, locked, bendDirection: 1,
    })));
    const parts: BodyPartLayer[] = anchors.map(id => ({
        id: `piece-${id}`, name: `Piece ${id}`, anchorJointId: id,
        transform: { ...skeleton.joints[id].position, rotation: 17, scale: 1.3 },
        localPivotOffset: { x: 0, y: 0 }, localPivotJointId: id, zIndex: 0,
        opacity: 1, visible: true, locked: false, selectable: true, fillColor: '#94a3b8',
        bounds: { x: -2, y: -2, width: 4, height: 4 },
        contourPoints: [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }],
    }));
    return freeze({ ...createEmptyProject(), skeleton, parts: Object.fromEntries(parts.map(part => [part.id, part])), partOrder: parts.map(part => part.id) });
};

check('long linear branches use their full connected chain', () => {
    const project = rig([
        ['hub', null, 0, 0], ['a', 'hub', 10, 0], ['b', 'a', 20, 0], ['c', 'b', 30, 0],
        ['d', 'c', 40, 0], ['e', 'd', 50, 0], ['neighbor', 'hub', -10, 0],
    ], ['a', 'c', 'e', 'neighbor']);
    for (const partId of ['piece-a', 'piece-c', 'piece-e']) {
        assert.deepEqual(describeMotionChain(project, partId).jointIds, ['a', 'b', 'c', 'd', 'e']);
        assert.equal(describeMotionChain(project, partId).kind, 'multi-joint');
        const path = pathAlong(project, partId, ['a', 'b', 'c', 'd', 'e']);
        const active = withPath(project, path);
        assert.equal(motionPathReadiness(active, path).playable, true);
        const preview = motionPreviewForPath(active, path, 0);
        assertLengths(project.skeleton!, preview.skeleton!, 'long chain');
        near(distance(preview.skeleton!.joints.e.position, path.points[0]), 0, 'long chain reaches a feasible point', .1);
        assert.deepEqual(preview.skeleton!.joints.neighbor.position, project.skeleton!.joints.neighbor.position);
    }
});

check('a forked distal hand stops at its hub and carries both fingers', () => {
    const project = rig([
        ['hub', null, 0, 0], ['a', 'hub', 10, 0], ['b', 'a', 20, 0], ['palm', 'b', 30, 0],
        ['finger-a', 'palm', 34, 3], ['finger-b', 'palm', 34, -3], ['neighbor', 'hub', -10, 0],
    ], ['a', 'b', 'palm']);
    for (const id of project.partOrder) {
        assert.equal(preferredMotionJointId(project, id), 'palm', 'no finger is chosen from insertion order');
        assert.deepEqual(describeMotionChain(project, id).jointIds, ['a', 'b', 'palm']);
        const path = pathAlong(project, id, ['a', 'b', 'palm']);
        const preview = motionPreviewForPath(withPath(project, path), path, 0);
        assertLengths(project.skeleton!, preview.skeleton!, 'forked hand');
        for (const finger of ['finger-a', 'finger-b']) assert(distance(preview.skeleton!.joints[finger].position, project.skeleton!.joints[finger].position) > 1);
    }
});

check('one-joint branches rotate at their parent and whole-root mode translates a rig', () => {
    const branch = rig([['hub', null, 0, 0], ['leaf', 'hub', 10, 0], ['neighbor', 'hub', -10, 0]], ['leaf']);
    assert.deepEqual(describeMotionChain(branch, 'piece-leaf').jointIds, ['hub', 'leaf']);
    const path = pathAlong(branch, 'piece-leaf', ['hub', 'leaf']);
    const preview = motionPreviewForPath(withPath(branch, path), path, 0);
    assertLengths(branch.skeleton!, preview.skeleton!, 'one segment');
    assert.deepEqual(preview.skeleton!.joints.neighbor.position, branch.skeleton!.joints.neighbor.position);
    const project = rig([['a', null, 0, 0], ['b', 'a', 10, 0], ['c', 'b', 20, 0]], ['a', 'b', 'c']);
    const whole = freeze({ ...createMotionPathForTarget(project, 'part', 'piece-a')!, targetAnchorJointId: 'a', chainRootJointId: 'a',
        points: [{ x: 4, y: 7 }, { x: 6, y: 10 }, { x: 8, y: 7 }] });
    assert.equal(chainForPath(project, whole).kind, 'root-only');
    const wholePose = motionPreviewForPath(withPath(project, whole), whole, 0);
    assertLengths(project.skeleton!, wholePose.skeleton!, 'whole rig');
    for (const [id, joint] of Object.entries(project.skeleton!.joints)) {
        assert.deepEqual(wholePose.skeleton!.joints[id].position, { x: joint.position.x + 4, y: joint.position.y + 7 });
        assert.equal(wholePose.parts[`piece-${id}`].transform.rotation, 17);
        assert.equal(wholePose.parts[`piece-${id}`].transform.scale, 1.3);
    }
    const single = rig([['only', null, 0, 0]], ['only']);
    assert.equal(describeMotionChain(single, 'piece-only').kind, 'root-only');
});

check('explicit elbow and hand roots survive new defaults and file reopening', () => {
    const project = fresh(createSampleProject());
    for (const root of ['right_elbow', 'right_hand']) {
        const chain = root === 'right_elbow' ? ['right_elbow', 'right_hand'] : ['right_hand'];
        const path = pathAlong(project, 'right_hand_part', chain, { chainRootJointId: root, targetAnchorJointId: 'right_hand',
            ...(root === 'right_hand' ? { points: [{ x: 130, y: -30 }, { x: 135, y: -25 }, { x: 140, y: -30 }] } : {}) });
        assert.deepEqual(chainForPath(project, path).jointIds, chain);
        const reopened = roundTrip(withPath(project, path));
        assert.equal(reopened.paths[path.id].chainRootJointId, root);
        assert.deepEqual(chainForPath(reopened, reopened.paths[path.id]).jointIds, chain);
        const preview = motionPreviewForPath(reopened, reopened.paths[path.id], 0);
        assert.equal(preview.rootJointId, root);
        assert.deepEqual((preview.parts.right_arm_upper ?? reopened.parts.right_arm_upper).transform, reopened.parts.right_arm_upper.transform);
        assert.deepEqual(preview.skeleton!.joints.right_elbow.position, reopened.skeleton!.joints.right_elbow.position);
        if (root === 'right_elbow') assertLengths(reopened.skeleton!, preview.skeleton!, 'explicit one-segment start');
    }
});

check('a locked ancestor becomes the fixed start', () => {
    const base = fresh(createSampleProject());
    const project: ProjectState = freeze({ ...base, skeleton: { ...base.skeleton!, joints: { ...base.skeleton!.joints,
        right_elbow: { ...base.skeleton!.joints.right_elbow, locked: true },
    } } });
    for (const partId of ['right_arm_upper', 'right_arm_lower', 'right_hand_part']) {
        assert.deepEqual(describeMotionChain(project, partId).jointIds, ['right_elbow', 'right_hand']);
        const path = pathAlong(project, partId, ['right_elbow', 'right_hand']);
        const active = withPath(project, path);
        assert.equal(motionPathReadiness(active, path).playable, true, 'a fixed start is allowed to anchor the moving segment');
        const preview = motionPreviewForPath(active, path, 0);
        assertLengths(project.skeleton!, preview.skeleton!, 'locked start');
        assert.deepEqual(preview.skeleton!.joints.right_elbow.position, project.skeleton!.joints.right_elbow.position);
        assert.deepEqual(preview.skeleton!.joints.right_shoulder.position, project.skeleton!.joints.right_shoulder.position);
    }
});

check('a locked moving side branch blocks readiness and both preview entry points', () => {
    const project = rig([
        ['hub', null, 0, 0], ['a', 'hub', 10, 0], ['b', 'a', 20, 0], ['end', 'b', 30, 0],
        ['tag', 'b', 20, 5, true], ['tag-end', 'tag', 23, 8], ['neighbor', 'hub', -10, 0, true],
    ], ['a', 'b', 'end', 'tag']);
    const path = pathAlong(project, 'piece-a', ['a', 'b', 'end'], { targetAnchorJointId: 'end', chainRootJointId: 'a' });
    const unlocked: ProjectState = freeze({ ...project, skeleton: { ...project.skeleton!, joints: {
        ...project.skeleton!.joints, tag: { ...project.skeleton!.joints.tag, locked: false },
    } } });
    const movable = withPath(unlocked, path);
    assert.equal(motionPathReadiness(movable, path).playable, true, 'the unrelated locked branch stays at the fixed hub');
    for (const preview of [motionPreviewForPath(movable, path, 0), motionPreviewForPaths(movable, [path], 0)]) {
        assertLengths(unlocked.skeleton!, preview.skeleton!, 'moving intermediate side branch');
        assert(distance(preview.skeleton!.joints.tag.position, unlocked.skeleton!.joints.tag.position) > 1);
        assert.deepEqual(preview.skeleton!.joints.neighbor.position, unlocked.skeleton!.joints.neighbor.position);
    }
    const active = withPath(project, path);
    const readiness = motionPathReadiness(active, path);
    assert.equal(readiness.playable, false);
    assert.equal(readiness.status, 'Fix');
    assert.match(readiness.reason ?? '', /unlock|locked/i, 'the blocker identifies the action needed');
    const rest = poseSummary(project, { parts: {}, skeleton: project.skeleton });
    assert.deepEqual(poseSummary(project, motionPreviewForPaths(active, [path], 0)), rest);
    assert.deepEqual(poseSummary(project, motionPreviewForPath(active, path, 0)), rest);
    assert.deepEqual(poseSummary(project, motionPreviewForTarget(active, 'piece-a', 'end', path.points[0], undefined, { rootJointId: 'a' })), rest);
});

check('independent limb paths and sequential bindings keep the same pose in either order', () => {
    const base = fresh(createSampleProject());
    const left = pathAlong(base, 'left_hand_part', limbs[0].chain);
    const right = pathAlong(base, 'right_hand_part', limbs[1].chain);
    const project = freeze({ ...base, paths: { [left.id]: left, [right.id]: right }, pathOrder: [left.id, right.id] });
    assert.equal(motionPathReadiness(project, left).playable, true);
    assert.equal(motionPathReadiness(project, right).playable, true);
    const forward = motionPreviewForPaths(project, [left, right], 0);
    const backward = motionPreviewForPaths(project, [right, left], 0);
    assert.deepEqual(poseSummary(project, forward), poseSummary(project, backward));
    for (const paths of [[left, right], [right, left]]) {
        let preview: MotionPreview = { parts: {}, skeleton: project.skeleton };
        for (const path of paths) preview = motionPreviewForTarget(project, path.partId, path.targetAnchorJointId, path.points[0], preview, { rootJointId: path.chainRootJointId });
        assert.deepEqual(poseSummary(project, preview), poseSummary(project, forward), 'mechanism-style sequential bindings match the shared path pose');
        assertLengths(project.skeleton!, preview.skeleton!, 'independent motions');
    }
});

check('character replacement preserves both legacy automatic limbs and explicit shorter starts', () => {
    const base = fresh(createSampleProject());
    for (const root of [undefined, 'right_elbow', 'right_hand']) {
        const path = { ...pathAlong(base, 'right_hand_part', limbs[1].chain), targetAnchorJointId: undefined, chainRootJointId: root };
        const prior = roundTrip(withPath(base, path));
        const replaced = replaceCharacterProject(fresh(createSampleProject()), prior);
        const restored = replaced.paths[path.id];
        assert.equal(restored.targetAnchorJointId, 'right_hand');
        assert.equal(restored.chainRootJointId, root ?? 'right_shoulder');
        assert.equal(chainForPath(replaced, restored).rootJointId, root ?? 'right_shoulder');
    }
});

check('public topology traversal terminates on a cyclic legacy skeleton', () => {
    const project = rig([['a', 'c', 0, 0], ['b', 'a', 10, 0], ['c', 'b', 20, 0]], ['a']);
    assert.deepEqual(new Set(motionAnchorJointIds(project, 'piece-a')), new Set(['a', 'b', 'c']));
    assert.deepEqual(motionJointChain(project.skeleton!, 'a', 'c'), ['a', 'b', 'c']);
    assert.deepEqual(motionJointChain(project.skeleton!, 'missing', 'c'), []);
    const descriptor = describeMotionChain(project, 'piece-a');
    assert(descriptor.jointCount <= 3);
    assert.equal(new Set(descriptor.jointIds).size, descriptor.jointCount);
    assert(motionChainRootJointIds(project, 'piece-a', 'c').length <= 3);
    assert(['a', 'b', 'c'].includes(preferredMotionJointId(project, 'piece-a')!));
});

check('every available classroom template moves within its connected rig reach', () => {
    for (const lesson of CLASSROOM_LESSONS.filter(value => isMechanismTypeEnabled(value.mechanismType))) {
        const project = freeze(createLessonProject(lesson.id));
        for (let index = 0; index < 96; index += 1) {
            const phase = index * Math.PI * 2 / 96;
            for (const path of Object.values(project.paths)) {
                const pose = motionPreviewForPath(project, path, phase);
                assertLengths(project.skeleton!, pose.skeleton!, `${lesson.id} authored path`);
                assert(!Object.values(pose.warnings ?? {}).flat().includes('Move target within reach'), `${lesson.id} path stays reachable at ${index}`);
            }
            const pose = motionPreviewForProject(project, project.mechanisms, phase);
            assertLengths(project.skeleton!, pose.skeleton!, `${lesson.id} mechanism`);
            assert(!Object.values(pose.warnings ?? {}).flat().includes('Move target within reach'), `${lesson.id} output stays reachable at ${index}`);
        }
    }
});

const failures: Error[] = [];
for (const [label, run] of cases) {
    try { run(); }
    catch (cause) { failures.push(new Error(label, { cause })); }
}
assert.equal(failures.length, 0, failures.map(error => `${error.message}: ${String(error.cause)}`).join('\n'));
console.log(`motion chains: ${cases.length} public-API cases preserve connected poses and durable defaults`);
