import { strict as assert } from 'node:assert';

import type { ProjectMotionPath, ProjectState, SceneObject } from '../types';
import { createFabricationRecipe } from '../utils/fabricationRecipes';
import {
    allocateMechanismOutput,
    assignMechanismOutputBinding,
    mechanismBindingForPath,
    mechanismBindingsConflict,
    mechanismBindingTargetKey,
    mechanismOutputBindings,
    mechanismWithOutputBindings,
} from '../utils/mechanismBindings';
import { createMotionPathForTarget, describeMotionChain, mechanismBindingWarnings, motionPathReadiness, motionPreviewForProject } from '../utils/motion';
import { buildMechanismRecommendations } from '../utils/mechanismRecommendations';
import { createDefaultMechanism, createEmptyProject, createLessonProject, createSampleProject, loadProjectSnapshot, serializeProject } from '../utils/project';

const object = (id: string): SceneObject => ({
    id,
    name: id,
    shape: 'block',
    transform: { x: 0, y: 0, rotation: 0, scale: 1 },
    bounds: { width: 30, height: 30 },
    fillColor: '#64748b',
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 1,
});

const path = (id: string, sceneObjectId: string): ProjectMotionPath => ({
    id,
    partId: '',
    sceneObjectId,
    points: [{ x: 0, y: 0 }, { x: 20, y: 10 }, { x: 40, y: 0 }],
    duration: 1_000,
    closed: true,
    enabled: true,
    visible: true,
    source: 'drawn',
    warnings: [],
});

const project = createEmptyProject();
const objects = [object('flag'), object('cloud'), object('star')];
const paths = [path('wave', 'flag'), path('float', 'cloud'), path('spin', 'star')];
const projectWithMotions = {
    ...project,
    sceneObjects: Object.fromEntries(objects.map(item => [item.id, item])),
    sceneObjectOrder: objects.map(item => item.id),
    paths: Object.fromEntries(paths.map(item => [item.id, item])),
    pathOrder: paths.map(item => item.id),
};

const legacy = loadProjectSnapshot({
    ...projectWithMotions,
    mechanisms: [{
        ...createDefaultMechanism('4bar', 'legacy-four-bar'),
        targetSceneObjectId: 'flag',
        targetPathId: 'wave',
        fabricationMetadata: { pathFit: { status: 'fit', targetPathId: 'wave', outputTraceId: 'B' } },
    }],
});
assert.equal(mechanismOutputBindings(legacy.mechanisms[0]).length, 1, 'legacy scalar targets migrate through one binding adapter');
assert.equal(mechanismOutputBindings(legacy.mechanisms[0])[0]?.portId, 'B', 'legacy fitted trace selects its declared output port');

const fourBar = createDefaultMechanism('4bar', 'shared-four-bar');
const firstBinding = mechanismBindingForPath(projectWithMotions, fourBar, 'wave', { portId: 'B' });
assert(firstBinding);
const sharedProject = {
    ...projectWithMotions,
    mechanisms: [mechanismWithOutputBindings(fourBar, [firstBinding])],
};
const secondBinding = mechanismBindingForPath(sharedProject, sharedProject.mechanisms[0], 'float', { portId: 'C' });
assert(secondBinding);
const shared = assignMechanismOutputBinding(sharedProject, fourBar.id, secondBinding);
assert(shared.ok);
assert.strictEqual(shared.project.paths, sharedProject.paths, 'binding assignment never replaces or mutates authored paths');
assert.equal(shared.project.mechanisms.length, 1, 'compatible ports share one physical mechanism');
assert.equal(mechanismOutputBindings(shared.project.mechanisms[0]).length, 2, 'every shared output remains explicit');

const fullPortBinding = mechanismBindingForPath(shared.project, shared.project.mechanisms[0], 'spin', { portId: 'C' });
assert(fullPortBinding);
const rejectedCapacity = assignMechanismOutputBinding(shared.project, fourBar.id, fullPortBinding);
assert(!rejectedCapacity.ok && rejectedCapacity.code === 'port-capacity');
assert.strictEqual(rejectedCapacity.project, shared.project, 'over-capacity rejection is transactional');

const sameDriverDraft = { ...fourBar, id: 'independent-four-bar', driverGroupId: fourBar.driverGroupId };
const independent = allocateMechanismOutput(sharedProject, sameDriverDraft, 'float', {
    reuseMechanismId: fourBar.id,
    portId: 'B',
});
assert(independent.ok);
assert.equal(independent.project.mechanisms.length, 2, 'an occupied requested output creates an independent mechanism');
assert(independent.createdIndependent && independent.reuseRejected, 'the allocator reports the explicit reuse fallback');
assert.strictEqual(independent.project.paths, sharedProject.paths, 'reuse fallback preserves path storage');

const preview = motionPreviewForProject(shared.project, shared.project.mechanisms, Math.PI / 3);
assert(preview.sceneObjects?.flag, 'the first mechanism binding is sampled');
assert(preview.sceneObjects?.cloud, 'the second mechanism binding is sampled');
assert.notDeepEqual(
    preview.sceneObjects?.flag?.transform,
    preview.sceneObjects?.cloud?.transform,
    'distinct physical output ports produce distinct target samples',
);

const recipe = createFabricationRecipe(shared.project, shared.project.mechanisms[0]);
assert.equal(recipe.outputBindings.length, 2, 'one physical recipe declares all output attachments');
assert.equal(recipe.assemblySteps.filter(step => step.role === 'attach-output').length, 2, 'assembly includes one attachment step per binding');

const rig = createSampleProject({ includeMechanism: false });
const limbPath = (partId: string): ProjectMotionPath => {
    const created = createMotionPathForTarget(rig, 'part', partId);
    assert(created);
    const handle = rig.skeleton!.joints[created.targetAnchorJointId!].position;
    return { ...created, points: [handle, { x: handle.x - 20, y: handle.y + 20 }, { x: handle.x + 10, y: handle.y + 30 }] };
};
const lowerArmPath = { ...limbPath('right_arm_lower'), enabled: false };
const handPath = limbPath('right_hand_part');
const leftHandPath = limbPath('left_hand_part');
const limbProject: ProjectState = {
    ...rig,
    paths: Object.fromEntries([lowerArmPath, handPath, leftHandPath].map(item => [item.id, item])),
    pathOrder: [lowerArmPath.id, handPath.id, leftHandPath.id],
    mechanisms: [createDefaultMechanism('crank', 'old-arm-output'), createDefaultMechanism('crank', 'new-hand-output')],
};
const oldArmBinding = mechanismBindingForPath(limbProject, limbProject.mechanisms[0], lowerArmPath.id)!;
const oldArmAssignment = assignMechanismOutputBinding(limbProject, 'old-arm-output', oldArmBinding);
assert(oldArmAssignment.ok);
const boundArmProject = oldArmAssignment.project;
const newHandBinding = mechanismBindingForPath(boundArmProject, boundArmProject.mechanisms[1], handPath.id)!;
assert(motionPathReadiness(boundArmProject, handPath).playable, 'disabling the old authored path leaves the new hand path ready');
assert.equal(mechanismBindingTargetKey(boundArmProject, oldArmBinding), mechanismBindingTargetKey(boundArmProject, newHandBinding), 'lower arm and hand owners resolve to the same physical chain');
assert(mechanismBindingsConflict(boundArmProject, oldArmBinding, newHandBinding), 'an enabled physical output still owns the chain of a disabled authored path');
const conflictingHand = assignMechanismOutputBinding(boundArmProject, 'new-hand-output', newHandBinding);
assert(!conflictingHand.ok && conflictingHand.code === 'target-conflict', 'a new hand output cannot silently overwrite the existing arm output');
assert.strictEqual(conflictingHand.project, boundArmProject, 'chain conflict leaves committed mechanisms and paths untouched');
const restoredConflict = loadProjectSnapshot({
    ...boundArmProject,
    mechanisms: [boundArmProject.mechanisms[0], mechanismWithOutputBindings({
        ...boundArmProject.mechanisms[1], anchorX: 320, anchorY: 160, sceneAnchor: { x: 320, y: 160 },
    }, [newHandBinding])],
});
const conflictWarnings = mechanismBindingWarnings(restoredConflict);
for (const driver of restoredConflict.mechanisms) {
    assert(conflictWarnings[driver.id]?.some(message => message.includes('also drives')), 'restored cross-owner conflicts warn both physical drivers');
}
const firstArmPose = motionPreviewForProject(restoredConflict, [restoredConflict.mechanisms[0]], .6);
const secondArmPose = motionPreviewForProject(restoredConflict, [restoredConflict.mechanisms[1]], .6);
const conflictingPose = motionPreviewForProject(restoredConflict, restoredConflict.mechanisms, .6);
assert.notDeepEqual(secondArmPose.skeleton, firstArmPose.skeleton, 'the fixture gives the competing output a different physical position');
assert.deepEqual(conflictingPose.skeleton, firstArmPose.skeleton, 'preview keeps the first solved skeleton instead of applying a second conflicting output');
assert.deepEqual(conflictingPose.parts, firstArmPose.parts, 'preview keeps every first-driver piece transform under the same conflict');

const shorterHandPath = { ...handPath, chainRootJointId: 'right_elbow' };
const shorterProject = { ...boundArmProject, paths: { ...boundArmProject.paths, [handPath.id]: shorterHandPath } };
assert.notEqual(mechanismBindingTargetKey(shorterProject, oldArmBinding), mechanismBindingTargetKey(shorterProject, newHandBinding));
assert(mechanismBindingsConflict(shorterProject, oldArmBinding, newHandBinding), 'custom shorter chains conflict when their actual moving joints overlap');
const attachedParentPath = { ...lowerArmPath, chainRootJointId: 'right_shoulder', targetAnchorJointId: 'right_elbow' };
const attachedParentProject = { ...shorterProject, paths: { ...shorterProject.paths, [lowerArmPath.id]: attachedParentPath } };
const parentBinding = { ...oldArmBinding, targetAnchorJointId: 'right_elbow' };
assert(mechanismBindingsConflict(attachedParentProject, parentBinding, newHandBinding), 'a second output cannot move another chain’s fixed start');

const reassignedHand = assignMechanismOutputBinding(boundArmProject, 'old-arm-output', { ...newHandBinding, id: oldArmBinding.id });
assert(reassignedHand.ok, 'an explicit replacement may keep the same output while changing its selected owner');
assert.strictEqual(reassignedHand.project.paths, boundArmProject.paths, 'reassignment preserves both authored paths');
assert.equal(reassignedHand.binding.targetPartId, 'right_hand_part', 'canonical identity does not rewrite the serializable selected part');
assert.equal(reassignedHand.binding.pathId, handPath.id);
const independentLeft = mechanismBindingForPath(reassignedHand.project, reassignedHand.project.mechanisms[1], leftHandPath.id)!;
assert(!mechanismBindingsConflict(reassignedHand.project, reassignedHand.binding, independentLeft), 'left and right arms remain independent');
const bothArms = assignMechanismOutputBinding(reassignedHand.project, 'new-hand-output', independentLeft);
assert(bothArms.ok);
const independentArmPose = motionPreviewForProject(bothArms.project, bothArms.project.mechanisms, .6);
for (const side of ['left', 'right']) {
    assert.notDeepEqual(independentArmPose.skeleton!.joints[`${side}_hand`].position, rig.skeleton!.joints[`${side}_hand`].position, 'independent left and right mechanism outputs both move their own limbs');
    assert.notEqual(independentArmPose.parts[`${side}_hand_part`].transform.rotation, rig.parts[`${side}_hand_part`].transform.rotation, 'both leaf hands rotate with their own driven limbs');
}
const reopenedArms = loadProjectSnapshot(JSON.parse(serializeProject(bothArms.project)));
assert.deepEqual(reopenedArms.mechanisms.map(item => mechanismOutputBindings(item).map(binding => ({
    partId: binding.targetPartId, pathId: binding.pathId, handle: binding.targetAnchorJointId,
}))), bothArms.project.mechanisms.map(item => mechanismOutputBindings(item).map(binding => ({
    partId: binding.targetPartId, pathId: binding.pathId, handle: binding.targetAnchorJointId,
}))), 'Save/Open retains exact output owner, path and handle fields');

const lockedElbowRig = {
    ...boundArmProject,
    skeleton: { ...boundArmProject.skeleton!, joints: { ...boundArmProject.skeleton!.joints,
        right_elbow: { ...boundArmProject.skeleton!.joints.right_elbow, locked: true },
    } },
    paths: { ...boundArmProject.paths, [handPath.id]: { ...handPath, chainRootJointId: undefined } },
};
const lockedDescriptor = describeMotionChain(lockedElbowRig, handPath.partId, handPath.targetAnchorJointId);
assert.deepEqual(lockedDescriptor.jointIds, ['right_elbow', 'right_hand']);
assert.equal(mechanismBindingTargetKey(lockedElbowRig, newHandBinding), `chain:${lockedDescriptor.rootJointId}:${lockedDescriptor.targetJointId}`, 'binding identity follows the shared locked-joint topology instead of an owner-specific root rule');
assert(mechanismBindingsConflict(projectWithMotions, firstBinding, { ...firstBinding, id: 'another-output' }), 'scene object target conflicts retain their existing identity');
assert(!mechanismBindingsConflict(projectWithMotions, firstBinding, secondBinding), 'different scene object targets remain independent');

const legacyTorsoPath = {
    ...limbPath('torso'), targetAnchorJointId: undefined, chainRootJointId: undefined,
    points: [{ x: 0, y: 200 }, { x: 30, y: 220 }, { x: 50, y: 200 }, { x: 20, y: 180 }],
};
const legacyTorsoProject = loadProjectSnapshot({
    ...rig, mechanisms: [], paths: { [legacyTorsoPath.id]: legacyTorsoPath }, pathOrder: [legacyTorsoPath.id],
});
const torsoBeforeRecommendation = structuredClone(legacyTorsoProject);
const torsoRecommendations = buildMechanismRecommendations(legacyTorsoProject, legacyTorsoProject.parts.torso, legacyTorsoProject.paths[legacyTorsoPath.id], { random: () => .5 });
assert(torsoRecommendations.length > 0, 'the actual recommendation pipeline returns candidates for a legacy torso path');
assert(torsoRecommendations.every(candidate => candidate.mechanism.targetPartId === 'torso' && candidate.mechanism.targetAnchorJointId === 'torso'), 'missing legacy handles use the canonical hip-to-torso chain instead of an arbitrary hand branch');
assert.deepEqual(legacyTorsoProject, torsoBeforeRecommendation, 'resolving recommendation defaults does not rewrite the legacy authored path');

const explicitTorsoPath = { ...legacyTorsoPath, targetAnchorJointId: 'right_elbow', chainRootJointId: 'right_shoulder' };
const explicitTorsoProject = { ...legacyTorsoProject, paths: { [explicitTorsoPath.id]: explicitTorsoPath } };
const occupiedTorsoDriver = createDefaultMechanism('crank', 'occupied-authored-handle');
const occupiedTorso = { ...explicitTorsoProject, mechanisms: [mechanismWithOutputBindings(occupiedTorsoDriver, [mechanismBindingForPath(explicitTorsoProject, occupiedTorsoDriver, explicitTorsoPath.id)!])] };
const explicitRecommendations = buildMechanismRecommendations(occupiedTorso, occupiedTorso.parts.torso, explicitTorsoPath, { random: () => .5 });
assert(explicitRecommendations.length > 0);
assert(explicitRecommendations.every(candidate => candidate.mechanism.targetPartId === 'torso' && candidate.mechanism.targetAnchorJointId === 'right_elbow'), 'recommendations preserve an intentionally authored handle and owner even when its current output is occupied');
assert(explicitRecommendations.every(candidate => candidate.mechanism.targetPathId === explicitTorsoPath.id), 'occupancy cannot redirect a recommendation to a different limb or authored path');

const occupiedWave = createLessonProject('waving-arm');
const wavePath = occupiedWave.paths['path-right-arm'];
const waveRecommendations = (project: ProjectState) => buildMechanismRecommendations(project, project.parts[wavePath.partId], wavePath, { random: () => .5 });
const otherWaveFamilies = waveRecommendations(occupiedWave);
assert(!otherWaveFamilies.some(candidate => candidate.type === '4bar'), 'an enabled four-bar output on this path suppresses a redundant same-family recommendation');
assert(otherWaveFamilies.some(candidate => candidate.type !== '4bar'), 'other mechanism families remain available as replacements');
assert(otherWaveFamilies.every(candidate => candidate.mechanism.targetPartId === wavePath.partId && candidate.mechanism.targetAnchorJointId === wavePath.targetAnchorJointId), 'family filtering preserves the authored owner and handle');
const disabledWaveDriver = { ...occupiedWave, mechanisms: occupiedWave.mechanisms.map(mechanism => ({ ...mechanism, enabled: false })) };
assert(waveRecommendations(disabledWaveDriver).some(candidate => candidate.type === '4bar'), 'a disabled mechanism does not suppress its family');
const disabledWaveOutput = { ...occupiedWave, mechanisms: occupiedWave.mechanisms.map(mechanism => mechanismWithOutputBindings(mechanism, mechanismOutputBindings(mechanism).map(binding => ({ ...binding, enabled: false })))) };
assert(waveRecommendations(disabledWaveOutput).some(candidate => candidate.type === '4bar'), 'a disabled output does not suppress its family');

console.log('mechanism binding contracts ok');
