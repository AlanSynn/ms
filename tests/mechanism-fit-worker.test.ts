import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createMechanismFitJobInput,
  runMechanismFitJob,
  type MechanismFitWorkerResponse,
} from '../runtime/fitting/mechanismFitJob';
import {
  createMechanismFitWorkerClient,
  type MechanismFitFrameScheduler,
  type MechanismFitWorkerPort,
} from '../runtime/fitting/mechanismFitWorkerClient';
import { createDefaultMechanism, createSampleProject } from '../utils/project';

const project = createSampleProject();
const pathId = project.selectedPathId ?? Object.keys(project.paths)[0];
const selectedPath = project.paths[pathId];
assert(pathId && selectedPath);
const mechanism = {
  ...createDefaultMechanism('gear_linkage', 'fit-worker-test'),
  targetPathId: pathId,
  targetPartId: selectedPath.partId,
};

const input = createMechanismFitJobInput(project, mechanism, 'path', pathId);
assert.doesNotThrow(() => structuredClone(input));
assert.deepEqual(
  runMechanismFitJob(input),
  runMechanismFitJob(input),
  'serialized fit jobs remain deterministic',
);

class FakeWorker implements MechanismFitWorkerPort {
  onmessage: MechanismFitWorkerPort['onmessage'] = null;
  onmessageerror: MechanismFitWorkerPort['onmessageerror'] = null;
  onerror: MechanismFitWorkerPort['onerror'] = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(response: MechanismFitWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<MechanismFitWorkerResponse>);
  }
}

const frameCallbacks = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;
const scheduler: MechanismFitFrameScheduler = {
  requestFrame(callback) {
    const id = ++nextFrameId;
    frameCallbacks.set(id, callback);
    return id;
  },
  cancelFrame(handle) {
    frameCallbacks.delete(handle);
  },
};
const runFrame = () => {
  const entry = frameCallbacks.entries().next().value as
    | [number, FrameRequestCallback]
    | undefined;
  assert(entry, 'a deferred frame is scheduled');
  frameCallbacks.delete(entry[0]);
  entry[1](0);
};

const workers: FakeWorker[] = [];
const completions: string[] = [];
const client = createMechanismFitWorkerClient(() => {
  const worker = new FakeWorker();
  workers.push(worker);
  return worker;
}, scheduler);

client.request(input, {
  complete: () => completions.push('cancelled'),
  failed: (error) => assert.fail(error.message),
});
assert.equal(workers.length, 0, 'fit waits for two paints before constructing a worker');
runFrame();
client.cancel();
assert.equal(frameCallbacks.size, 0, 'cancellation clears a deferred second frame');
assert.equal(workers.length, 0, 'cancel-before-start allocates no worker heap');

client.request(input, {
  complete: () => completions.push('first'),
  failed: (error) => assert.fail(error.message),
});
runFrame();
runFrame();
assert.equal(workers.length, 1);
const staleHandler = workers[0].onmessage;
client.request(input, {
  complete: () => completions.push('second'),
  failed: (error) => assert.fail(error.message),
});
assert(workers[0].terminated, 'superseding a running fit releases its worker');
runFrame();
runFrame();
const activeWorker = workers[1];
activeWorker.respond({
  type: 'result',
  generationId: 4,
  inputFingerprint: input.inputFingerprint,
  result: runMechanismFitJob(input),
});
assert(activeWorker.terminated, 'successful fit releases the heavy worker heap');
assert.deepEqual(completions, ['second']);
staleHandler?.({
  data: {
    type: 'error',
    generationId: 3,
    inputFingerprint: input.inputFingerprint,
    message: 'stale',
  },
} as MessageEvent<MechanismFitWorkerResponse>);
assert.deepEqual(completions, ['second'], 'stale generations cannot update UI');
client.dispose();

const workerSource = readFileSync(
  join(process.cwd(), 'workers/mechanismFitWorker.ts'),
  'utf8',
);
assert(workerSource.includes('await import('), 'the heavy fit job loads inside its worker');

console.log('mechanism fit worker contract ok');
