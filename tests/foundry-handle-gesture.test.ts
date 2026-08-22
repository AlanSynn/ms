import assert from 'node:assert/strict';

import {
  captureFoundryGesturePlayback,
  createPostPaintFoundryGestureCommit,
  foundryMechanismForHandleGesture,
  isExpectedFoundryGestureProjectChange,
  retainFoundryGestureAnalysis,
  settleExternalFoundryFrame,
  shouldCommitFoundryGesture,
  shouldForceFirstFoundryGestureMove,
  type FoundryGestureCommitFrameScheduler,
} from '../components/stages/foundry/foundryHandleGesture';
import { calculateLinkage } from '../utils/kinematics';
import { createDefaultMechanism } from '../utils/project';
import { defaultPhysicalKit, sceneToBoardRaw } from '../utils/coordinates';

const mechanism = {
  ...createDefaultMechanism('4bar', 'foundry-gesture'),
  anchorX: 0,
  anchorY: 0,
};
const simulation = {
  state: calculateLinkage(mechanism, 0),
  scale: 1,
};
const kit = defaultPhysicalKit();

const crank = foundryMechanismForHandleGesture({
  mechanism,
  handle: 'B',
  point: { x: simulation.state.p1.x + 120, y: simulation.state.p1.y },
  simulation,
  landing: { x: 0, y: 0 },
  kit,
});
assert.equal(crank.crankLength, 120, 'B changes only the bounded crank length');
assert.equal(crank.groundLength, mechanism.groundLength);

const ground = foundryMechanismForHandleGesture({
  mechanism,
  handle: 'D',
  point: { x: simulation.state.p1.x, y: simulation.state.p1.y + 160 },
  simulation,
  landing: { x: 0, y: 0 },
  kit,
});
assert.equal(ground.groundLength, 160, 'D changes the ground-link length');
assert.equal(ground.groundAngle, 90, 'D changes the ground-link angle');

const snappedGround = foundryMechanismForHandleGesture({
  mechanism,
  handle: 'D',
  point: {
    x: simulation.state.p1.x + 73,
    y: simulation.state.p1.y + 91,
  },
  simulation,
  landing: { x: 0, y: 0 },
  kit,
});
const snappedGroundRadians = ((snappedGround.groundAngle ?? 0) * Math.PI) / 180;
const snappedFixedPivot = {
  x: (snappedGround.anchorX ?? 0) +
    snappedGround.groundLength * Math.cos(snappedGroundRadians),
  y: (snappedGround.anchorY ?? 0) +
    snappedGround.groundLength * Math.sin(snappedGroundRadians),
};
assert.equal(
  sceneToBoardRaw(snappedFixedPivot, kit).valid,
  true,
  'D keeps the second fixed pivot on the 15x15 board',
);
const snappedBoard = sceneToBoardRaw(snappedFixedPivot, kit);
assert(Math.abs(snappedBoard.xMm / kit.gridPitchMm - Math.round(snappedBoard.xMm / kit.gridPitchMm)) < 1e-9);
assert(Math.abs(snappedBoard.yMm / kit.gridPitchMm - Math.round(snappedBoard.yMm / kit.gridPitchMm)) < 1e-9);

const coupler = foundryMechanismForHandleGesture({
  mechanism,
  handle: 'C',
  point: {
    x: simulation.state.j1.x + 80,
    y: simulation.state.j1.y,
  },
  simulation,
  landing: { x: 0, y: 0 },
  kit,
});
assert.equal(coupler.couplerLength, 80, 'C changes the coupler length');
assert(Number.isFinite(coupler.rockerLength), 'C keeps a finite rocker length');

const moved = foundryMechanismForHandleGesture({
  mechanism,
  handle: 'M',
  point: {
    x: simulation.state.p1.x + kit.gridPitchMm * 2,
    y: simulation.state.p1.y,
  },
  simulation,
  landing: { x: 0, y: 0 },
  kit,
});
assert.equal(moved.anchorX, moved.sceneAnchor?.x, 'M keeps anchor and scene anchor aligned');
assert.equal(moved.anchorY, moved.sceneAnchor?.y, 'M keeps anchor and scene anchor aligned');
assert.equal(moved.transform?.x, moved.anchorX, 'M keeps the transform on the snapped anchor');

const capturedLanding = { x: 0, y: 0 };
const firstMoveAcrossPublication = foundryMechanismForHandleGesture({
  mechanism,
  handle: 'M',
  point: {
    x: simulation.state.p1.x + kit.gridPitchMm * 2,
    y: simulation.state.p1.y,
  },
  simulation,
  landing: capturedLanding,
  kit,
});
const secondMoveAcrossPublication = foundryMechanismForHandleGesture({
  mechanism: firstMoveAcrossPublication,
  handle: 'M',
  point: {
    x: simulation.state.p1.x + kit.gridPitchMm * 3,
    y: simulation.state.p1.y,
  },
  simulation,
  landing: capturedLanding,
  kit,
});
const secondMoveWithAdvancedReactLanding = foundryMechanismForHandleGesture({
  mechanism: firstMoveAcrossPublication,
  handle: 'M',
  point: {
    x: simulation.state.p1.x + kit.gridPitchMm * 3,
    y: simulation.state.p1.y,
  },
  simulation,
  landing: firstMoveAcrossPublication.sceneAnchor ?? capturedLanding,
  kit,
});
assert.equal(
  secondMoveAcrossPublication.anchorX,
  80,
  'a second M move stays relative to the pointerdown landing after React publishes the first draft',
);
assert.equal(
  secondMoveWithAdvancedReactLanding.anchorX,
  120,
  'using the advanced React landing would double-add the first move displacement',
);

const createFrameHarness = () => {
  let sequence = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const scheduler: FoundryGestureCommitFrameScheduler = {
    requestFrame: (callback) => {
      const handle = ++sequence;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      callbacks.delete(handle);
    },
  };
  return {
    scheduler,
    runFrame: () => {
      const queued = [...callbacks.entries()];
      callbacks.clear();
      queued.forEach(([, callback]) => callback(sequence * 16.67));
    },
    pendingFrames: () => callbacks.size,
  };
};

const frameHarness = createFrameHarness();
const deferredCommit = createPostPaintFoundryGestureCommit<{ id: string }>(
  frameHarness.scheduler,
);
const commitOrder: string[] = [];
deferredCommit.schedule(
  { id: 'final-draft' },
  {
    present: ({ id }) => commitOrder.push(`present:${id}`),
    commit: ({ id }) => commitOrder.push(`commit:${id}`),
    release: () => commitOrder.push('release:final-draft'),
  },
);
assert.deepEqual(
  commitOrder,
  ['present:final-draft', 'commit:final-draft'],
  'pointerup presents and canonically commits the exact final handle draft synchronously',
);
assert.equal(
  commitOrder.filter((entry) => entry === 'commit:final-draft').length,
  1,
  'pointerup queues the durable canonical action exactly once',
);
assert.equal(frameHarness.pendingFrames(), 1, 'pointerup schedules one post-paint boundary');
frameHarness.runFrame();
assert.deepEqual(
  commitOrder,
  ['present:final-draft', 'commit:final-draft'],
  'the first animation frame retains the lightweight final draft',
);
assert.equal(frameHarness.pendingFrames(), 1, 'draft release waits for the second frame boundary');
frameHarness.runFrame();
assert.deepEqual(
  commitOrder,
  ['present:final-draft', 'commit:final-draft', 'release:final-draft'],
  'the full canonical view is released only after the final draft has had a paint opportunity',
);
assert.equal(
  commitOrder.filter((entry) => entry === 'commit:final-draft').length,
  1,
  'post-paint release never repeats the durable action',
);
assert.equal(deferredCommit.hasPending(), false, 'the delivered draft release is not retained');

deferredCommit.schedule(
  { id: 'stale' },
  {
    present: ({ id }) => commitOrder.push(`present:${id}`),
    commit: ({ id }) => commitOrder.push(`commit:${id}`),
    release: () => commitOrder.push('release:stale'),
  },
);
deferredCommit.schedule(
  { id: 'latest' },
  {
    present: ({ id }) => commitOrder.push(`present:${id}`),
    commit: ({ id }) => commitOrder.push(`commit:${id}`),
    release: () => commitOrder.push('release:latest'),
  },
);
frameHarness.runFrame();
frameHarness.runFrame();
assert(commitOrder.includes('commit:stale'), 'every completed pointerup is canonical before supersession');
assert(!commitOrder.includes('release:stale'), 'a superseded gesture cannot clear a newer draft');
assert.equal(commitOrder.at(-1), 'release:latest', 'only the newest gesture releases its draft');

deferredCommit.schedule(
  { id: 'cancelled' },
  {
    present: ({ id }) => commitOrder.push(`present:${id}`),
    commit: ({ id }) => commitOrder.push(`commit:${id}`),
    release: () => commitOrder.push('release:cancelled'),
  },
);
assert.equal(deferredCommit.cancel(), true, 'cancellation reports a queued draft release');
frameHarness.runFrame();
frameHarness.runFrame();
assert(commitOrder.includes('commit:cancelled'), 'stage-switch disposal cannot lose a completed gesture');
assert(!commitOrder.includes('release:cancelled'), 'cancelled or unmounted drafts do not release later');

assert.equal(
  shouldCommitFoundryGesture('pointerup', false),
  false,
  'a no-op pointerup does not create a canonical action',
);
assert.equal(
  shouldCommitFoundryGesture('pointercancel', true),
  false,
  'pointercancel discards an in-progress gesture',
);
assert.equal(
  shouldCommitFoundryGesture('lostpointercapture', true),
  true,
  'unexpected capture loss preserves the last visible dirty draft',
);
assert.equal(
  shouldForceFirstFoundryGestureMove(false),
  true,
  'the first changed handle sample bypasses the cadence consumed by pointerdown',
);
assert.equal(
  shouldForceFirstFoundryGestureMove(true),
  false,
  'later handle samples remain coalesced by the configured gesture cadence',
);
const playbackCaptureOrder: string[] = [];
const capturedPlayback = captureFoundryGesturePlayback(
  {
    getPhase: () => {
      playbackCaptureOrder.push('getPhase');
      return 1.234;
    },
    stop: () => playbackCaptureOrder.push('stop'),
  },
  (phase) => {
    playbackCaptureOrder.push(`sample:${phase}`);
    return { sampledPhase: phase };
  },
);
assert.deepEqual(
  capturedPlayback,
  { phase: 1.234, simulation: { sampledPhase: 1.234 } },
  'drag math and its retained-scene restore share the exact live playback phase',
);
assert.deepEqual(
  playbackCaptureOrder,
  ['getPhase', 'stop', 'sample:1.234'],
  'pointerdown captures the external phase before synchronously stopping playback',
);
const oldDragFrame = { id: 'old-drag' };
const newProjectFrame = { id: 'new-project-canonical' };
const externalFrameCalls: Array<
  { type: 'cancel' } | { type: 'restore'; frame: typeof newProjectFrame }
> = [];
const externalFrameController = {
  active: true,
  isActive() {
    return this.active;
  },
  cancel() {
    externalFrameCalls.push({ type: 'cancel' });
    this.active = false;
    return oldDragFrame;
  },
  restoreAndRelease(frame: typeof newProjectFrame) {
    externalFrameCalls.push({ type: 'restore', frame });
  },
};
assert.equal(
  settleExternalFoundryFrame(
    externalFrameController,
    false,
    newProjectFrame,
  ),
  'restored-canonical',
  'an external revision that raced the first draft delivery schedules a canonical replacement',
);
assert.deepEqual(
  externalFrameCalls,
  [{ type: 'restore', frame: newProjectFrame }],
  'the new ProjectState frame wins instead of replaying the old drag restore',
);
externalFrameCalls.length = 0;
externalFrameController.active = true;
assert.equal(
  settleExternalFoundryFrame(
    externalFrameController,
    true,
    newProjectFrame,
  ),
  'cancelled-for-react-release',
  'an already-rendered React draft releases through the canonical prop rerender',
);
assert.deepEqual(
  externalFrameCalls,
  [{ type: 'cancel' }],
  'the stale transient owner is cancelled without replaying either old frame',
);
externalFrameCalls.length = 0;
assert.equal(
  settleExternalFoundryFrame(
    externalFrameController,
    false,
    newProjectFrame,
  ),
  'inactive',
  'an inactive renderer owner leaves the normal canonical prop render untouched',
);
assert.deepEqual(externalFrameCalls, []);
const retainedAnalysis = { current: null as { revision: number } | null };
let analysisBuilds = 0;
const calculateAnalysis = () => ({ revision: ++analysisBuilds });
assert.equal(
  retainFoundryGestureAnalysis(false, retainedAnalysis, calculateAnalysis).revision,
  1,
  'canonical Foundry state builds the current analysis',
);
assert.equal(
  retainFoundryGestureAnalysis(true, retainedAnalysis, calculateAnalysis).revision,
  1,
  'a gesture reuses the last canonical analysis instead of rebuilding nonvisual plans',
);
assert.equal(analysisBuilds, 1, 'dense gesture samples perform no hidden analysis work');
assert.equal(
  retainFoundryGestureAnalysis(false, retainedAnalysis, calculateAnalysis).revision,
  2,
  'draft release rebuilds exact canonical validation and fabrication analysis',
);

const expectedProjectCommit = { id: 'expected' };
assert.equal(
  isExpectedFoundryGestureProjectChange(true, expectedProjectCommit, expectedProjectCommit),
  true,
  'the ProjectState revision caused by the immediate gesture commit preserves its pending release',
);
assert.equal(
  isExpectedFoundryGestureProjectChange(true, null, expectedProjectCommit),
  false,
  'a later ProjectState revision with the same Foundry prop is external and cancels the draft',
);
assert.equal(
  isExpectedFoundryGestureProjectChange(
    true,
    expectedProjectCommit,
    { id: 'external' },
  ),
  false,
  'a replacement Foundry prop is never mistaken for the expected gesture commit',
);

console.log('Foundry handle gesture contract ok');
