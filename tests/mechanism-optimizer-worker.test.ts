import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createMechanismOptimizerJobInput,
  runMechanismOptimizerSearch,
  type MechanismOptimizerWorkerResponse,
} from '../runtime/optimizer/mechanismOptimizerJob';
import {
  createMechanismOptimizerWorkerClient,
  type MechanismOptimizerWorkerPort,
} from '../runtime/optimizer/mechanismOptimizerWorkerClient';
import { createDefaultMechanism, createSampleProject } from '../utils/project';

const path = Array.from({ length: 12 }, (_, index) => ({
  x: Math.cos((index / 11) * Math.PI * 2) * 40,
  y: Math.sin((index / 11) * Math.PI * 2) * 24,
}));
const firstSearch = runMechanismOptimizerSearch({
  path,
  type: 'gear_linkage',
  iterations: 6,
  seed: 1234,
});
const repeatedSearch = runMechanismOptimizerSearch({
  path,
  type: 'gear_linkage',
  iterations: 6,
  seed: 1234,
});
assert.deepEqual(
  repeatedSearch,
  firstSearch,
  'optimizer search is deterministic for one serialized seed',
);

const project = createSampleProject();
const pathId = project.selectedPathId ?? Object.keys(project.paths)[0];
const selectedPath = project.paths[pathId];
assert(selectedPath);
const mechanism = {
  ...createDefaultMechanism('gear_linkage', 'optimizer-test'),
  targetPathId: pathId,
  targetPartId: selectedPath.partId,
};
const optimizerProject = {
  ...project,
  mechanisms: [mechanism],
  selectedMechanismId: mechanism.id,
};
const input = createMechanismOptimizerJobInput(optimizerProject, mechanism, pathId, 260);
assert.equal(input.iterations, 260);
assert.doesNotThrow(() => structuredClone(input));

class FakeWorker implements MechanismOptimizerWorkerPort {
  onmessage: MechanismOptimizerWorkerPort['onmessage'] = null;
  onerror: MechanismOptimizerWorkerPort['onerror'] = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(response: MechanismOptimizerWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<MechanismOptimizerWorkerResponse>);
  }
}

const workers: FakeWorker[] = [];
const completed: string[] = [];
const client = createMechanismOptimizerWorkerClient(() => {
  const worker = new FakeWorker();
  workers.push(worker);
  return worker;
});
const generation = client.request(input, {
  complete: () => completed.push('first'),
  failed: (error) => assert.fail(error.message),
});
const staleHandler = workers[0].onmessage;
client.request(input, {
  complete: () => completed.push('second'),
  failed: (error) => assert.fail(error.message),
});
assert(workers[0].terminated, 'superseding optimization terminates the active worker');
staleHandler?.({
  data: {
    type: 'error',
    generationId: generation,
    inputFingerprint: input.inputFingerprint,
    message: 'stale',
  },
} as MessageEvent<MechanismOptimizerWorkerResponse>);
assert.deepEqual(completed, [], 'stale optimizer generations cannot update UI');
client.dispose();
assert(workers[1].terminated, 'unmount releases optimizer worker memory');

const hookSource = readFileSync(
  join(process.cwd(), 'hooks/useAppMechanismActions.ts'),
  'utf8',
);
const workerSource = readFileSync(
  join(process.cwd(), 'workers/mechanismOptimizerWorker.ts'),
  'utf8',
);
assert(hookSource.includes('createMechanismOptimizerWorkerClient'));
assert(!hookSource.includes('for (let i = 0; i < iterations; i++)'));
assert(workerSource.includes('runMechanismOptimizerJob(data.input'));
assert(
  workerSource.includes('await import('),
  'the worker entry stays small and loads the optimizer job after it owns the request',
);

console.log('mechanism optimizer worker contract ok');
