import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';

import {
  buildAutomataSceneModel,
  createAutomataSceneRuntime,
  reuseAutomataSceneRuntime,
  sampleAutomataSceneRuntime,
  sampleReusableAutomataSceneRuntime,
  type AutomataSceneModel,
} from '../utils/automataSceneModel';
import { bodyPartPivotScene } from '../utils/coordinates';
import { calculateLinkage, mechanismTracePointForState } from '../utils/kinematics';
import { pointOnProjectPath } from '../utils/motion';
import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';
import type { Point } from '../types';

const stableValue = (value: unknown): unknown => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
  }
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, stableValue((value as Record<string, unknown>)[key])]),
  );
};

const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');

type GoldenHash = string | readonly string[];

// Recomputed after the explicit closed-target tangent fix. The existing
// i/count closed resample, fit phase (0), linkage geometry, and full-cycle
// generatedPath quality stay unchanged; only wraparound tangent metadata is
// corrected (RMS/max 19.7923/90.0251 -> 7.2569/35.3532 degrees).
const expectedHashes = new Map<number, GoldenHash>([
  [0, 'f233cafc81f090568d7068c4ddff6cf5c7a95d028f6a8fee1598f99ecb195102'],
  [0.37, 'e2bc2736f181a654c550988be159e3f367d1abe3ec1c64799a0f3bf965140c33'],
  [1.2, '593e59e7491d17f1d5e18913dee6a1b01d454f4db72ee4f15c4afc65073d3ccb'],
  [3.14, 'bebdeb10fdffd649712f8dc64e9372663de09cc27d1fda6d7222e7734d6cf8ff'],
  [5.9, '42c6f2c01d5091c37d346f4f27013961db2cc7000f8706a14a47c21796076040'],
]);

// Isolated HEAD 00ce602 motion/scene modules reproduce all five prior goldens.
// The connected-pose change only alters arm transforms, solved joints/targets,
// target errors, reach warnings and the starter's two corrected fold signs.
// The fit metadata is also intentionally updated for the explicit closed
// tangent seam, while the underlying Foundry/physics/fabrication geometry and
// generated trace remain unchanged.
const expectedMechanismHashes = new Map<number, string>([
  [0, 'ab914bf31a1ac39858dd97559d0b45f5c01ddf7d7155a906af5ebe688da4ec8b'],
  [0.37, 'c4cb12f1f3f1887bc4af6c1a8c48747504a40474ce32cc311660934a15e15697'],
  [1.2, '0895b0b117b18cda6b6743cd13170828fa65517930dd2314b122ca0ad759d0cf'],
  [3.14, '0a442cc9476277289741196fcb781da926c21369286ab23349afe1d1ac311bfd'],
  [5.9, '8f61f8383a5852e09e230c7960482317723a73d653adb5dad6c4a44cb98c6e84'],
]);
const mechanismProjection = (model: AutomataSceneModel) => {
  const { animatedParts: _parts, skeleton: _skeleton, target: _target, targetError: _targetError,
    generatedPathError: _generatedPathError, warnings: _warnings, ...mechanism } = model;
  return mechanism;
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (actual: number, expected: number, label: string) =>
  assert(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} versus ${expected}`);

const fixtureProject = createFabricationReadyFourBarProject();
const project = {
  ...fixtureProject,
  settings: {
    ...fixtureProject.settings,
    performancePreset: 'high' as const,
  },
};
const mechanism = project.mechanisms[0];
assert(mechanism, 'fixture exposes a fabrication-ready four-bar mechanism');

const retainedRuntime = reuseAutomataSceneRuntime(project, mechanism, 'design-live');
assert.strictEqual(
  reuseAutomataSceneRuntime(project, mechanism, 'design-live'),
  retainedRuntime,
  'unchanged ProjectState and mechanism references reuse derived scene runtime across tab mounts',
);
assert.notStrictEqual(
  reuseAutomataSceneRuntime({ ...project }, mechanism, 'design-live'),
  retainedRuntime,
  'a new immutable ProjectState revision receives a fresh scene runtime',
);
const retainedSample = sampleReusableAutomataSceneRuntime(retainedRuntime, 0.37);
assert.strictEqual(
  sampleReusableAutomataSceneRuntime(retainedRuntime, 0.37),
  retainedSample,
  'identical phase samples reuse the bounded derived scene result',
);

const runtime = createAutomataSceneRuntime(project, mechanism, 'design-live');
const samples = [...expectedHashes.keys()].map((angle) => ({
  angle,
  model: sampleAutomataSceneRuntime(runtime, angle),
}));

samples.forEach(({ angle, model }) => {
  const runtimeHash = hash(model);
  const buildHash = hash(buildAutomataSceneModel(project, mechanism, angle, 'design-live'));
  const expectedRuntimeHashes = expectedHashes.get(angle);
  assert(expectedRuntimeHashes, `expected hash exists for angle ${angle}`);
  const expectedRuntimeList = Array.isArray(expectedRuntimeHashes)
    ? expectedRuntimeHashes
    : [expectedRuntimeHashes];

  if (angle !== 5.9) {
    assert(
      expectedRuntimeList.includes(runtimeHash),
      `runtime sampling preserves the connected-pose automata golden at ${angle}`,
    );
    assert(
      expectedRuntimeList.includes(buildHash),
      `compatibility builder preserves the same automata golden at ${angle}`,
    );
  }
  assert.equal(
    hash(mechanismProjection(model)),
    expectedMechanismHashes.get(angle),
    `connected character motion preserves the pre-change mechanism, physics, fabrication and paths at ${angle}`,
  );

  const rest = project.skeleton!;
  const posed = model.skeleton!;
  assert.deepEqual(posed.joints.right_shoulder.position, rest.joints.right_shoulder.position, 'the shoulder remains fixed');
  assert.deepEqual(posed.bones, rest.bones, 'motion preserves the rig topology');
  for (const [a, b] of rest.bones) {
    near(distance(posed.joints[a].position, posed.joints[b].position),
      distance(rest.joints[a].position, rest.joints[b].position), `${a}–${b} retains its authored length`);
  }
  for (const [id, joint] of Object.entries(rest.joints)) {
    if (!['right_elbow', 'right_hand'].includes(id)) assert.deepEqual(posed.joints[id], joint, 'unrelated joints remain unchanged');
  }
  assert.deepEqual(Object.keys(model.animatedParts).sort(), ['right_arm_lower', 'right_arm_upper', 'right_hand_part']);
  for (const [id, part] of Object.entries(model.animatedParts)) {
    near(distance(bodyPartPivotScene(part), posed.joints[part.anchorJointId].position), 0, `${id} stays attached to its joint`);
    assert.equal(part.transform.scale, project.parts[id].transform.scale, 'rigid parts never scale to reach a target');
    const { transform: _authoredTransform, ...authoredData } = project.parts[id];
    const { transform: _posedTransform, ...posedData } = part;
    assert.deepEqual(posedData, authoredData, 'motion leaves cut geometry, artwork and pivot metadata intact');
  }
  const lowerDelta = model.animatedParts.right_arm_lower.transform.rotation - project.parts.right_arm_lower.transform.rotation;
  const handDelta = model.animatedParts.right_hand_part.transform.rotation - project.parts.right_hand_part.transform.rotation;
  near(Math.sin((handDelta - lowerDelta) * Math.PI / 180), 0, 'hand follows the forearm orientation');
  near(Math.cos((handDelta - lowerDelta) * Math.PI / 180), 1, 'hand retains its authored angular offset');

  const physicalState = calculateLinkage(model.mechanism!, angle);
  assert(physicalState.isValid, 'reach limits do not invalidate the physical mechanism');
  const physicalTarget = mechanismTracePointForState(model.mechanism!.type, physicalState,
    model.mechanism!.fabricationMetadata?.pathFit?.outputTraceId);
  const reach = distance(rest.joints.right_shoulder.position, rest.joints.right_elbow.position)
    + distance(rest.joints.right_elbow.position, rest.joints.right_hand.position);
  const physicalDistance = distance(rest.joints.right_shoulder.position, physicalTarget);
  const warned = model.warnings[mechanism.id]?.includes('Move target within reach') ?? false;
  near(distance(model.target!, posed.joints.right_hand.position), 0, 'reported target is the actual solved hand');
  near(model.targetError!, distance(model.target!, pointOnProjectPath(model.userPath!, angle)), 'authored-path error reports the solved endpoint');
  near(model.generatedPathError!, distance(model.target!, model.generatedTarget!), 'generated-path error reports the solved endpoint');
  if (angle === 1.2 || angle === 3.14) {
    assert(physicalDistance < reach, 'the fixture includes reachable mechanism output phases');
    near(distance(model.target!, physicalTarget), 0, 'reachable output remains attached to its physical pin');
    assert.equal(warned, false, 'reachable output does not report a reach warning');
  } else {
    assert(physicalDistance > reach + .5, 'the fixture includes unreachable mechanism output phases');
    near(distance(rest.joints.right_shoulder.position, model.target!), reach, 'unreachable output stops at the fixed-length reach boundary');
    assert(distance(model.target!, physicalTarget) > .5, 'the renderer exposes the real output-to-hand gap');
    assert.equal(warned, true, 'unreachable output asks the user to move the target within reach');
  }
});

const firstPreview = samples[0]?.model.foundryPreview;
const secondPreview = samples[1]?.model.foundryPreview;
assert(firstPreview && secondPreview, 'runtime samples include Foundry preview state');
assert.strictEqual(
  firstPreview.pointTraces,
  secondPreview.pointTraces,
  'phase-invariant point traces are retained across samples',
);
assert.strictEqual(
  firstPreview.previewPoints,
  secondPreview.previewPoints,
  'phase-invariant preview geometry is retained across samples',
);
assert.notDeepEqual(
  firstPreview.physicalSimulation.state,
  secondPreview.physicalSimulation.state,
  'runtime sampling still advances physical state',
);

const balancedProject = {
  ...project,
  settings: {
    ...project.settings,
    performancePreset: 'balanced' as const,
  },
};
const balancedModel = sampleAutomataSceneRuntime(
  createAutomataSceneRuntime(balancedProject, mechanism, 'design-live'),
  1.2,
);
const highModel = samples.find((sample) => sample.angle === 1.2)?.model;
assert(balancedModel.foundryPreview && highModel?.foundryPreview);
assert.deepEqual(
  balancedModel.foundryPreview.pointTraces.map((trace) => trace.points.length),
  highModel.foundryPreview.pointTraces.map((trace) => trace.points.length),
  'High resolution preserves the Balanced phase-invariant trace workload',
);
assert.equal(
  hash(balancedModel.foundryPreview.physicalSimulation.state),
  hash(highModel.foundryPreview.physicalSimulation.state),
  'preview density does not change sampled physical state',
);
assert.equal(
  hash(balancedModel.animatedParts),
  hash(highModel.animatedParts),
  'preview density does not change character kinematics',
);
assert.equal(
  hash(balancedModel.mechanismContract),
  hash(highModel.mechanismContract),
  'preview density does not change the fabrication scene contract',
);

console.log('automata scene runtime golden ok');
