import assert from 'node:assert/strict';
import { createVersionWorkerClient } from '../runtime/versions/versionWorkerClient';
import { createSampleProject } from '../utils/project';
import type { VersionJobRequest, VersionJobResponse } from '../runtime/versions/versionJobs';

const instances: ControlledWorker[] = [];
class ControlledWorker {
  onmessage?: (event: { data: VersionJobResponse }) => void;
  onerror?: (event: { message: string }) => void;
  onmessageerror?: () => void;
  requests: VersionJobRequest[] = [];
  terminated = false;
  constructor() { instances.push(this); }
  postMessage(request: VersionJobRequest) { this.requests.push(structuredClone(request)); }
  terminate() { this.terminated = true; }
  reply(index: number, result: VersionJobResponse['result'] = []) {
    this.onmessage?.({ data: { id: this.requests[index].id, result, durationMs: 4 } });
  }
}

const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
Object.defineProperty(globalThis, 'Worker', { configurable: true, value: ControlledWorker });
try {
  const client = createVersionWorkerClient();
  assert.equal(instances.length, 0, 'opening the app does not start a history Worker');
  const source = createSampleProject();
  const authority = { branchId: 'branch', ownerId: 'owner', lineageId: 'lineage', projectId: source.metadata.id, chosenAt: 1 };
  const input = { authority, source, id: 'manual-a', projectId: source.metadata.id, createdAt: 2, reason: 'manual' as const, description: 'Changed Head' };
  const completed: string[] = [];
  const a = client.request('capture', input).then(() => completed.push('A'));
  const b = client.request('capture', { ...input, id: 'protection-b', reason: 'before-restore', source: {
    ...source, parts: { ...source.parts, head: { ...source.parts.head, transform: { ...source.parts.head.transform, rotation: 44 } } },
  } }).then(() => completed.push('B'));
  const list = client.request('list', { branchId: 'branch' });
  await assert.rejects(client.request('list', { branchId: 'branch' }), /busy/);
  const worker = instances[0];
  assert.deepEqual(worker.requests.map(request => request.type), ['capture', 'capture', 'list']);
  assert.deepEqual(completed, [], 'retention does not report success before a Worker reply');
  assert.equal(worker.terminated, false, 'later requests never cancel selected historical states');
  const first = worker.requests[0];
  assert.equal(first.type, 'capture');
  if (first.type === 'capture' && typeof first.input.source !== 'string') {
    assert.equal(first.input.source.parts.head.transform.rotation, source.parts.head.transform.rotation);
  }
  worker.reply(0);
  await a;
  assert.deepEqual(completed, ['A']);
  worker.reply(1);
  await b;
  worker.reply(2);
  await list;
  assert.deepEqual(completed, ['A', 'B']);

  const failed = client.request('list', { branchId: 'branch' });
  const failedAssertion = assert.rejects(failed, /Worker unavailable/);
  worker.onerror?.({ message: 'Worker unavailable' });
  await failedAssertion;
  assert.equal(worker.terminated, true);
  const retry = client.request('list', { branchId: 'branch' });
  assert.equal(instances.length, 2, 'an explicit retry creates a new Worker');
  worker.reply(0);
  instances[1].reply(0);
  await retry;
  const interrupted = client.request('list', { branchId: 'branch' });
  const interruptedAssertion = assert.rejects(interrupted, /closed/);
  client.dispose();
  await interruptedAssertion;
  assert.equal(instances[1].terminated, true);
} finally {
  if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor);
  else Reflect.deleteProperty(globalThis, 'Worker');
}
console.log('version Worker preserves requested states, completion, backpressure, retries, and disposal');
