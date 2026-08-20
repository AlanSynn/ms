import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';

import {
  buildAutomataSceneModel,
  createAutomataSceneRuntime,
  sampleAutomataSceneRuntime,
} from '../utils/automataSceneModel';
import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';

const stableValue = (value: unknown): unknown => {
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
  [0, '6c95c595657e3cd184b7795e5b5dc4ed7a9c6bf5469dd1deb3e0dc784de20538'],
  [0.37, '04b765eb69119c88b4646a03f9a1b551bd9bfc9abfbc2bb46501cdf72a63cb89'],
  [1.2, '34750c20370fbac50b869950280e25c45683fbe701b60a2eca80a142819013da'],
  [3.14, 'e70d56f914a9a57f44b5014d765db5f013c9ed9cebec8bfaf5f9da8512c8ee10'],
  [5.9, 'ca4897f9d6e342f84c078e42c84e46d99e76c403a7ef98e173a31cc855a98c3b'],
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
