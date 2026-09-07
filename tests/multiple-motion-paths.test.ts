import { strict as assert } from "node:assert";

import type { ProjectMotionPath, SceneObject } from "../types";
import {
  clearMotionPathGeometry,
  createMotionPathForTarget,
  motionPreviewForPaths,
  motionPathReadiness,
  motionPathsInProjectOrder,
  playableMotionPaths,
  sharedMotionPlaybackDurationMs,
} from "../utils/motion";
import {
  applyProjectAction,
  createDefaultMechanism,
  createEmptyProject,
  validatePath,
} from "../utils/project";
import { createPlaybackClock } from "../runtime/playback/externalPlaybackClock";

const sceneObject = (id: string, name: string): SceneObject => ({
  id,
  name,
  shape: "block",
  transform: { x: 0, y: 0, rotation: 0, scale: 1 },
  bounds: { width: 40, height: 40 },
  fillColor: "#64748b",
  opacity: 1,
  visible: true,
  locked: false,
  zIndex: 1,
});

const path = (
  id: string,
  sceneObjectId: string,
  points: ProjectMotionPath["points"],
  duration: number,
): ProjectMotionPath => ({
  id,
  partId: "",
  sceneObjectId,
  points,
  timedPoints: points.map((point, index) => ({
    ...point,
    time: (index / (points.length - 1)) * duration,
  })),
  duration,
  closed: false,
  enabled: true,
  visible: true,
  source: "drawn",
  warnings: [],
});

const base = createEmptyProject();
const firstObject = sceneObject("object-a", "Flag");
const secondObject = sceneObject("object-b", "Cloud");
const firstPath = path(
  "path-object-a",
  firstObject.id,
  [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
  1_000,
);
const secondPath = {
  ...path(
    "path-object-b",
    secondObject.id,
    [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 0, y: 100 }],
    2_000,
  ),
  visible: false,
};
const project = {
  ...base,
  sceneObjects: {
    [firstObject.id]: firstObject,
    [secondObject.id]: secondObject,
  },
  sceneObjectOrder: [firstObject.id, secondObject.id],
  paths: {
    [firstPath.id]: firstPath,
    [secondPath.id]: secondPath,
  },
  selectedSceneObjectId: firstObject.id,
  selectedPathId: firstPath.id,
};

assert.equal(
  sharedMotionPlaybackDurationMs(project),
  2_000,
  "the shared playback window covers the longest enabled motion",
);

const preview = motionPreviewForPaths(
  project,
  [firstPath, secondPath],
  500,
);
assert.equal(
  preview.sceneObjects?.[firstObject.id]?.transform.x,
  50,
  "the first motion samples its own one-second timing on the shared timeline",
);
assert.equal(
  preview.sceneObjects?.[secondObject.id]?.transform.y,
  25,
  "the second motion samples its own two-second timing on the same timeline",
);
assert(
  preview.sceneObjects?.[secondObject.id],
  "a hidden but enabled curve still participates in motion playback",
);

const nextForFirstObject = createMotionPathForTarget(
  project,
  "scene-object",
  firstObject.id,
);
assert.equal(
  nextForFirstObject?.id,
  "path-object-a-2",
  "Add Motion allocates a new stable identity instead of replacing an existing path",
);

const mechanism = {
  ...createDefaultMechanism("crank", "motion-driver"),
  targetSceneObjectId: firstObject.id,
  targetPathId: firstPath.id,
};
const cleared = applyProjectAction(
  { ...project, mechanisms: [mechanism] },
  {
    type: "upsert_path",
    path: clearMotionPathGeometry(firstPath),
  },
);
assert.equal(cleared.paths[firstPath.id]?.id, firstPath.id, "Clear preserves path identity");
assert.equal(cleared.paths[firstPath.id]?.points.length, 0, "Clear removes only path geometry");
assert.equal(
  cleared.mechanisms[0]?.targetPathId,
  firstPath.id,
  "Clear keeps the mechanism bound to the stable path identity",
);

const selected = applyProjectAction(project, {
  type: "select_path",
  pathId: secondPath.id,
});
assert.equal(selected.selectedPathId, secondPath.id, "motion selection selects the requested path");
assert.equal(
  selected.selectedSceneObjectId,
  secondObject.id,
  "motion selection also selects its owning target",
);

let now = 0;
let nextHandle = 1;
const pending = new Map<number, (time: number) => void>();
const clock = createPlaybackClock({
  now: () => now,
  requestFrame: (callback) => {
    const handle = nextHandle;
    nextHandle += 1;
    pending.set(handle, callback);
    return handle;
  },
  cancelFrame: (handle) => pending.delete(handle),
});
const advanceTo = (time: number) => {
  now = time;
  const callbacks = [...pending.values()];
  pending.clear();
  callbacks.forEach((callback) => callback(time));
};
clock.setTimelineDuration(1_000);
clock.start({
  initialPhase: 0,
  advancePhase: (elapsedMs, phase) =>
    phase + (elapsedMs / 1_000) * Math.PI * 2,
});
advanceTo(400);
advanceTo(800);
advanceTo(1_200);
assert.equal(
  Math.round(clock.getTimelineMs()),
  1_200,
  "the clock timeline remains continuous when its display phase wraps",
);
clock.stop();
clock.setPhase(Math.PI);
assert.equal(
  Math.round(clock.getTimelineMs()),
  500,
  "scrubbing the shared phase resets the timeline to the matching time",
);

console.log("multiple motion path contracts ok");

// Portable Project round-trip keeps every visible body-part motion and ordering field.
import { createSampleProject as createPortableMotionProject } from '../utils/project';
import { projectStateFromPortableDocument as reopenPortableMotionProject, serializeProjectCompact as serializePortableMotionProject } from '../utils/projectSerialization';

const portableMotionBase = createPortableMotionProject({ includeMechanism: true });
const portableFirstId = (portableMotionBase.pathOrder ?? Object.keys(portableMotionBase.paths))[0];
const portableFirst = portableMotionBase.paths[portableFirstId];
if (!portableFirst) throw new Error('fixture needs a motion path');
const portableSecond = {
    ...portableFirst,
    id: `${portableFirst.id}-second`,
    points: portableFirst.points.map(point => ({ x: point.x + 12, y: point.y - 8 })),
    duration: portableFirst.duration + 375,
    closed: !portableFirst.closed,
};
const portableMulti = {
    ...portableMotionBase,
    paths: { ...portableMotionBase.paths, [portableSecond.id]: portableSecond },
    pathOrder: [...(portableMotionBase.pathOrder ?? Object.keys(portableMotionBase.paths)), portableSecond.id],
    selectedPathId: portableSecond.id,
};
const portableReopened = reopenPortableMotionProject(JSON.parse(serializePortableMotionProject(portableMulti))) as typeof portableMulti;
if (portableReopened.pathOrder.join('|') !== portableMulti.pathOrder.join('|')) throw new Error('portable Project must preserve motion order');
const reopenedSecond = portableReopened.paths[portableSecond.id];
if (!reopenedSecond) throw new Error('portable Project must retain every motion id');
if (JSON.stringify(reopenedSecond.points) !== JSON.stringify(portableSecond.points)) throw new Error('portable Project must preserve independent motion geometry');
if (reopenedSecond.duration !== portableSecond.duration || reopenedSecond.closed !== portableSecond.closed) throw new Error('portable Project must preserve independent motion timing and closure');
if (reopenedSecond.partId !== portableSecond.partId || reopenedSecond.targetAnchorJointId !== portableSecond.targetAnchorJointId) throw new Error('portable Project must preserve motion target bindings');

// Readiness is the same source for inventory, fitting, and combined playback.
const twoArmsBase = createPortableMotionProject({ includeMechanism: false });
const armA = Object.values(twoArmsBase.paths)[0];
const armB: ProjectMotionPath = {
  ...armA, id: "path-left-arm", partId: "left_arm_lower",
  targetAnchorJointId: "left_hand", chainRootJointId: "left_shoulder",
  points: armA.points.map(point => ({ x: -point.x, y: point.y })),
};
const twoArms = { ...twoArmsBase, paths: { [armA.id]: armA, [armB.id]: armB }, pathOrder: [armB.id, armA.id] };
assert.deepEqual(motionPathsInProjectOrder(twoArms).map(path => path.id), [armB.id, armA.id]);
assert.equal(playableMotionPaths(twoArms).length, 2);
const authoredArms = JSON.stringify(twoArms);
const armSamples = [0, 300, 650].map(time => motionPreviewForPaths(twoArms, motionPathsInProjectOrder(twoArms), time));
for (const partId of ["left_arm_lower", "right_arm_lower"]) {
  assert(armSamples.every(sample => sample.parts[partId]), `${partId} receives a real body-part pose`);
  const transforms = armSamples.map(sample => sample.parts[partId].transform);
  assert(new Set(transforms.map(transform => transform.rotation.toFixed(4))).size > 1, `${partId} rotates across time`);
  assert(new Set(transforms.map(transform => `${transform.x.toFixed(4)},${transform.y.toFixed(4)}`)).size > 1, `${partId} moves across time`);
}
assert.equal(JSON.stringify(twoArms), authoredArms, "combined playback cannot mutate authored transforms or path geometry");
const duplicate = { ...armA, id: "overlapping-right-arm" };
const conflicting = { ...twoArms, paths: { ...twoArms.paths, [duplicate.id]: duplicate } };
assert.equal(motionPathReadiness(conflicting, armA).status, "Conflict");
assert.equal(motionPathReadiness(conflicting, duplicate).status, "Conflict");
assert.deepEqual(playableMotionPaths(conflicting).map(path => path.id), [armB.id], "an independent limb still plays while both conflicting paths are excluded");
const conflictPreview = motionPreviewForPaths(conflicting, Object.values(conflicting.paths), 300);
assert(conflictPreview.warnings?.[armA.id]);
assert(conflictPreview.parts.left_arm_lower);
assert.equal(conflictPreview.parts.right_arm_lower, undefined, "conflicting paths cannot silently choose a winner");
for (const skipped of [{ ...duplicate, enabled: false }, { ...duplicate, points: duplicate.points.slice(0, 2) }]) {
  const isolated = { ...twoArms, paths: { ...twoArms.paths, [skipped.id]: skipped } };
  assert.equal(playableMotionPaths(isolated).length, 2, "disabled or incomplete paths do not block valid independent paths");
  assert.equal(motionPathReadiness(isolated, skipped).playable, false);
}
for (const broken of [
  { ...armA, partId: "missing" },
  { ...armA, targetAnchorJointId: "missing" },
  { ...armA, chainRootJointId: "left_shoulder" },
  { ...armA, points: armA.points.map(() => ({ x: 0, y: 0 })) },
]) {
  const invalid = { ...twoArms, paths: { ...twoArms.paths, [broken.id]: broken } };
  assert.equal(motionPathReadiness(invalid, broken).status, "Fix");
  assert.equal(playableMotionPaths(invalid).length, 1);
}
const reenabled = validatePath({ ...validatePath({ ...armA, enabled: false }), enabled: true });
assert.deepEqual(reenabled.warnings, [], "validation removes obsolete derived disabled warnings");
assert.equal(motionPathReadiness({ ...twoArms, paths: { ...twoArms.paths, [reenabled.id]: reenabled } }, reenabled).playable, true);

// Both chains can share an unmoving root without overwriting sibling transforms.
const sharedA = { ...armA, partId: "torso", chainRootJointId: "torso" };
const sharedB = { ...armB, partId: "torso", chainRootJointId: "torso" };
const sharedRoot = { ...twoArms, paths: { [sharedA.id]: sharedA, [sharedB.id]: sharedB } };
assert.equal(playableMotionPaths(sharedRoot).length, 2, "a shared fixed root is not a moving-chain conflict");
const forward = motionPreviewForPaths(sharedRoot, [sharedA, sharedB], 420);
const reverse = motionPreviewForPaths(sharedRoot, [sharedB, sharedA], 420);
for (const id of ["left_arm_lower", "right_arm_lower"]) assert.deepEqual(forward.parts[id].transform, reverse.parts[id].transform, "independent shared-root playback is order invariant");
assert.deepEqual(forward.skeleton?.joints.torso.position, sharedRoot.skeleton?.joints.torso.position);

import { motionPathWithPoints } from "../utils/pathEditing";
import { pathHasExactOwner, pathBelongsToTarget } from "../utils/pathTargets";
import { isUndoableProjectAction } from "../hooks/useProjectHistory";
import { replacedMechanismPathIds, replacePrimaryMechanismOutputBinding, mechanismOwnerForDraft } from "../utils/mechanismBindings";
assert(pathBelongsToTarget(armA, "part", "torso", twoArms), "mechanism reachability remains supported");
assert(!pathHasExactOwner(armA, "part", "torso"), "authoring ownership does not inherit mechanism reachability");
const torsoEdit = motionPathWithPoints(twoArms, "part", "torso", armA.points);
assert.equal(torsoEdit?.partId, "torso");
assert.notEqual(torsoEdit?.id, armA.id, "drawing on an ancestor creates its own path");
assert.equal(motionPathWithPoints(twoArms, "part", "torso", armA.points, "drawn", undefined, armA.id), undefined, "an explicit foreign path edit is rejected");
const bEdited = motionPathWithPoints(twoArms, "part", armB.partId, armB.points.slice().reverse(), "drawn", undefined, armB.id)!;
const isolatedB = applyProjectAction(twoArms, { type: "upsert_path", path: bEdited });
assert.equal(isolatedB.paths[armA.id], armA, "editing B retains A by identity");
assert.equal(bEdited.targetAnchorJointId, armB.targetAnchorJointId);
assert.equal(bEdited.chainRootJointId, armB.chainRootJointId);
for (const action of [{ type: "select_path", pathId: armB.id }, { type: "select_part", partId: armB.partId }, { type: "select_scene_object", objectId: firstObject.id }] as const) {
  assert.equal(isUndoableProjectAction(action), false, "selection neither consumes edit history nor clears redo");
}
assert.equal(isUndoableProjectAction({ type: "upsert_path", path: bEdited }), true);
const boundA = replacePrimaryMechanismOutputBinding(twoArms, createDefaultMechanism("crank", "single-driver"), armA.id);
const boundProject = { ...twoArms, mechanisms: [boundA] };
const boundB = replacePrimaryMechanismOutputBinding(boundProject, boundA, armB.id);
const previewClone = { ...boundA, id: 'foundry-preview' };
assert.equal(mechanismOwnerForDraft(boundProject, previewClone)?.id, boundA.id, 'Foundry preview identity still resolves its canonical binding owner');
assert.equal(mechanismOwnerForDraft({ ...boundProject, mechanisms: [{ ...boundA, outputs: undefined }] }, { ...previewClone, outputs: undefined })?.id, boundA.id, 'legacy preview clones resolve by their original path binding');
assert.deepEqual(replacedMechanismPathIds(boundProject, boundB), [armA.id], "fitting B identifies the A binding that requires explicit replacement");
assert.deepEqual(replacedMechanismPathIds(boundProject, { ...boundB, id: mechanismOwnerForDraft(boundProject, previewClone)!.id }), [armA.id]);
assert.deepEqual(replacedMechanismPathIds(boundProject, boundA), [], "editing the existing fit requires no replacement");
const replaced = applyProjectAction(boundProject, { type: "upsert_mechanism", mechanism: boundB });
assert.equal(replaced.mechanisms.length, 1, "confirmed replacement reuses the existing mechanism");
assert.equal(replaced.paths[armA.id], armA);
assert.equal(replaced.paths[armB.id], armB);
console.log("independent body path readiness, identity, and binding contracts ok");

import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';
import { fitMechanismToTargetPath } from '../utils/mechanismRecommendations';
import { loadProjectSnapshot, serializeProject } from '../utils/project';
const fitSource = createFabricationReadyFourBarProject();
const fitA = Object.values(fitSource.paths)[0];
const fitB = { ...fitA, id: 'fit-left-arm', partId: 'left_arm_lower', targetAnchorJointId: 'left_hand', chainRootJointId: 'left_shoulder' };
const reopenedFitSource = loadProjectSnapshot(JSON.parse(serializeProject({ ...fitSource, paths: { [fitA.id]: fitA, [fitB.id]: fitB } })));
const beforeCandidateFit = JSON.stringify(reopenedFitSource);
const candidateB = fitMechanismToTargetPath(reopenedFitSource, {
  ...reopenedFitSource.mechanisms[0], id: 'foundry-preview', targetPathId: fitB.id,
  targetPartId: fitB.partId, targetAnchorJointId: fitB.targetAnchorJointId,
}, fitB.id);
assert.equal(candidateB.fabricationMetadata?.pathFit?.status, 'fit', 'the same accepted trace remains fabricable when fitting B from a reopened A mechanism');
assert.equal(candidateB.outputs?.[0].pathId, fitB.id, 'candidate output binding follows requested B before physical fitting');
assert.equal(candidateB.outputs?.[0].targetPartId, fitB.partId);
assert.equal(JSON.stringify(reopenedFitSource), beforeCandidateFit, 'computing a successful B candidate keeps canonical A untouched until explicit replacement');
assert.equal(reopenedFitSource.mechanisms[0].outputs?.[0].pathId, fitA.id);
const disabledFitPath = { ...fitB, enabled: false };
const disabledFitProject = { ...reopenedFitSource, paths: { ...reopenedFitSource.paths, [fitB.id]: disabledFitPath } };
assert.equal(fitMechanismToTargetPath(disabledFitProject, reopenedFitSource.mechanisms[0], fitB.id).fabricationMetadata?.pathFit?.status, 'rejected', 'fitter uses the same disabled-path readiness blocker as inventory and playback');
