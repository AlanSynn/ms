import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';

import {
  buildAutomataSceneModel,
  createAutomataSceneRuntime,
  reuseAutomataSceneRuntime,
  sampleAutomataSceneRuntime,
  sampleReusableAutomataSceneRuntime,
} from '../utils/automataSceneModel';
import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';

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

const expectedHashes = new Map<number, string>([
  [0, '9b7d95cb02c37503479d3aceb49523c5fb6d7a11680c524c61653f909eb2eef7'],
  [0.37, '53964403bfa8eda2dcd0e481b63892d1fd68d4ae0f4b80dce60af6e0f38f4951'],
  [1.2, '459fd066f12bf94d58d72311b52fb1504801c4dac52d004124837b227b03c779'],
  [3.14, 'f388ffa1561dbcbaa58ef760fb89fc857d6b3593bc363d8b5c9f93d1a9c4b1d7'],
  [5.9, '3c7c14e32a464a284933d3ddab74102ae9b5a65b4004531ea173e29ece30873e'],
]);

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
  assert.equal(
    hash(model),
    expectedHashes.get(angle),
    `runtime sampling preserves the pre-extraction automata golden at ${angle}`,
  );
  assert.equal(
    hash(buildAutomataSceneModel(project, mechanism, angle, 'design-live')),
    expectedHashes.get(angle),
    `compatibility builder preserves the same automata golden at ${angle}`,
  );
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
