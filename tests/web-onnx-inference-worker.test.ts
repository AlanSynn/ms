import { strict as assert } from 'node:assert';

import { runWebOnnxInferenceInWorker } from '../runtime/ai/webOnnxInference';
import { createWebOnnxModelJobCoordinator } from '../runtime/ai/webOnnxModelJobCoordinator';
import { createDistinctIntegerProgress } from '../runtime/ai/distinctProgress';

type Listener = (event: Event) => void;

class FakeWorker {
  listeners = new Map<string, Set<Listener>>();
  posted?: { message: Record<string, unknown>; transfer?: Transferable[] };
  terminateCount = 0;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const next: Listener =
      typeof listener === 'function'
        ? listener
        : (event) => listener.handleEvent(event);
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(next);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (typeof listener === 'function') this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: Record<string, unknown>, transfer?: Transferable[]) {
    this.posted = { message, transfer };
  }

  terminate() {
    this.terminateCount += 1;
  }

  emit(type: string, event: Event) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

const model = {
  url: '/onnx/pose_model.onnx',
  cacheName: 'test-model-cache',
  label: 'Test model',
  minBytes: 1,
  bytesHeader: 'x-test-model-bytes',
};
const distinctProgress = createDistinctIntegerProgress();
assert.deepEqual(
  [12, 12.1, 12.4, 12.6, 13, 13.2, 14]
    .map(distinctProgress)
    .filter((value): value is number => value !== undefined),
  [12, 13, 14],
  'model streaming publishes at most one update per integer progress step',
);
const coarseProgress = createDistinctIntegerProgress(5);
assert.deepEqual(
  [12, 13, 16, 17, 21, 22, 34, 100]
    .map(coarseProgress)
    .filter((value): value is number => value !== undefined),
  [12, 17, 22, 34, 100],
  'large model streams can coalesce progress without hiding completion',
);
const worker = new FakeWorker();
const resultPromise = runWebOnnxInferenceInWorker({
  generationId: 7,
  model,
  file: new Blob(['image']),
  wasmUrl: '/assets/ort.wasm',
  createWorker: () => worker as unknown as Worker,
});

assert.equal(worker.posted?.message.type, 'run');
assert.equal(worker.posted?.message.generationId, 7);
assert.equal(worker.posted?.transfer?.length ?? 0, 0, 'image and model inputs stay worker-owned without main-thread ArrayBuffer copies');

worker.emit(
  'message',
  new MessageEvent('message', {
    data: {
      type: 'result',
      generationId: 6,
      result: {},
    },
  }),
);
assert.equal(worker.terminateCount, 0, 'stale generations cannot settle or terminate the active run');

worker.emit(
  'message',
  new MessageEvent('message', {
    data: {
      type: 'result',
      generationId: 7,
      result: {
        skeleton: { joints: {}, bones: [], rootJointIds: [], jointMap: {}, hierarchy: {}, metadata: { sourceFormat: 'test', scale: 1, normalization: 'test' } },
        parts: [],
        textureUrl: 'data:image/png;base64,test',
        maskUrl: 'data:image/png;base64,mask',
        keypoints: [{ x: 1, y: 2, confidence: 0.75, name: 'nose' }],
      },
    },
  }),
);
const result = await resultPromise;
assert.equal(result.textureUrl, 'data:image/png;base64,test');
assert.equal(result.keypoints[0].name, 'nose');
assert.equal(worker.terminateCount, 1, 'completed inference releases its worker');

const cancelledWorker = new FakeWorker();
const abortController = new AbortController();
const cancelled = runWebOnnxInferenceInWorker({
  generationId: 8,
  model,
  file: new Blob(['image']),
  wasmUrl: '/assets/ort.wasm',
  signal: abortController.signal,
  createWorker: () => cancelledWorker as unknown as Worker,
});
abortController.abort();
await assert.rejects(cancelled, (error: unknown) => {
  assert(error instanceof DOMException);
  return error.name === 'AbortError';
});
assert.equal(cancelledWorker.terminateCount, 1, 'cancelled inference releases its worker immediately');

const failedTransferWorker = new FakeWorker();
failedTransferWorker.postMessage = () => {
  throw new Error('ONNX transfer failed');
};
await assert.rejects(
  runWebOnnxInferenceInWorker({
    generationId: 9,
    model,
    file: new Blob(['image']),
    wasmUrl: '/assets/ort.wasm',
    createWorker: () => failedTransferWorker as unknown as Worker,
  }),
  /ONNX transfer failed/,
);
assert.equal(
  failedTransferWorker.terminateCount,
  1,
  'a failed structured-clone transfer releases its inference worker',
);

const coordinator = createWebOnnxModelJobCoordinator();
let warmStarts = 0;
let finishWarm!: () => void;
const warmGate = new Promise<void>((resolve) => {
  finishWarm = resolve;
});
const firstWarm = coordinator.runWarm(async () => {
  warmStarts += 1;
  await warmGate;
  return 'cached';
});
const repeatedWarm = coordinator.runWarm(async () => {
  warmStarts += 1;
  return 'duplicate';
});
assert.equal(firstWarm, repeatedWarm, 'concurrent model warm requests share one worker job');
assert.equal(warmStarts, 0, 'warm job starts in a microtask without blocking its caller');
await Promise.resolve();
assert.equal(warmStarts, 1);
let inferenceStarted = false;
const waitBeforeInference = coordinator.runInference(async () => {
  inferenceStarted = true;
  return 'inferred';
});
await Promise.resolve();
assert.equal(inferenceStarted, false, 'inference waits instead of downloading beside an active warm');
finishWarm();
assert.equal(await waitBeforeInference, 'inferred');
assert.equal(await firstWarm, 'cached');
assert.equal(inferenceStarted, true);
assert.equal(coordinator.hasActiveWarm(), false);
assert.equal(coordinator.activeInferenceCount(), 0);

const inferenceFirstCoordinator = createWebOnnxModelJobCoordinator();
let finishInference!: () => void;
const inferenceGate = new Promise<void>((resolve) => {
  finishInference = resolve;
});
let inferenceFirstStarts = 0;
const inferenceFirst = inferenceFirstCoordinator.runInference(async () => {
  inferenceFirstStarts += 1;
  await inferenceGate;
  return 'inferred-first';
});
assert.equal(inferenceFirstStarts, 1);
let warmAfterInferenceStarts = 0;
const warmAfterInference = inferenceFirstCoordinator.runWarm(async () => {
  warmAfterInferenceStarts += 1;
  return 'checked-cache';
});
await Promise.resolve();
assert.equal(
  warmAfterInferenceStarts,
  0,
  'Get AI waits instead of starting a second model job beside inference',
);
finishInference();
assert.equal(await inferenceFirst, 'inferred-first');
assert.equal(await warmAfterInference, 'checked-cache');
assert.equal(warmAfterInferenceStarts, 1);

const abortCoordinator = createWebOnnxModelJobCoordinator();
let releaseAbortWarm!: () => void;
const abortWarmGate = new Promise<void>((resolve) => {
  releaseAbortWarm = resolve;
});
const abortWarm = abortCoordinator.runWarm(async () => {
  await abortWarmGate;
  return 'cached';
});
const waitingAbortController = new AbortController();
let abortedInferenceStarts = 0;
const abortedWhileWaiting = abortCoordinator.runInference(async () => {
  abortedInferenceStarts += 1;
  return 'should-not-run';
}, waitingAbortController.signal);
waitingAbortController.abort();
await assert.rejects(abortedWhileWaiting, (error: unknown) => {
  assert(error instanceof DOMException);
  return error.name === 'AbortError';
});
assert.equal(abortedInferenceStarts, 0, 'aborted imports release their file closure before warm completes');
assert.equal(abortCoordinator.activeInferenceCount(), 0);
releaseAbortWarm();
await abortWarm;

console.log('web ONNX inference worker contract ok');
