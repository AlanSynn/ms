import { strict as assert } from "node:assert";

import type { ProjectMotionPath, SceneObject } from "../types";
import {
  clearMotionPathGeometry,
  createMotionPathForTarget,
  motionPreviewForPaths,
  sharedMotionPlaybackDurationMs,
} from "../utils/motion";
import {
  applyProjectAction,
  createDefaultMechanism,
  createEmptyProject,
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
    time: index === 0 ? 0 : duration,
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
  [{ x: 0, y: 0 }, { x: 100, y: 0 }],
  1_000,
);
const secondPath = {
  ...path(
    "path-object-b",
    secondObject.id,
    [{ x: 0, y: 0 }, { x: 0, y: 100 }],
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
