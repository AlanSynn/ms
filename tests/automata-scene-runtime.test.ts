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
  [0, '3ff22df1685766d68050a1931d34c4f0d16c89a4eda0273cc0f3a2caef03dd72'],
  [0.37, '875e01dd65ac6938e9ba36522ff9f470b8904cbc6b023e9cbc0a98842bd9667c'],
  [1.2, 'f28116f9c8c2bff506fd27a8ea015b5a4103aa9732a9b4f2e3db3b3862e54735'],
  [3.14, '8b26c750b246a810647156512b953143be864bd09aa843389a86ca5d635ad5ab'],
  [5.9, 'e57aaa9e1065c535d888f63666d0ca0aae6b806f68ca4f70eebbc230b9cbe4df'],
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
assert(
  balancedModel.foundryPreview.pointTraces.every((trace, index) =>
    trace.points.length < (highModel.foundryPreview?.pointTraces[index]?.points.length ?? 0)),
  'Balanced reduces phase-invariant preview trace density',
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
