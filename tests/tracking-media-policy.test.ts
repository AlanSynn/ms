import { strict as assert } from 'node:assert';

import { createGifFrameSession } from '../runtime/media/gifFrameSession';
import {
  assertTrackingGifDecodeInput,
  fitTrackingMediaDimensions,
  planTrackingGif,
  planTrackingGifFromMetadata,
  scanTrackingGifMetadata,
  trackingGifFallbackReplayWindow,
  TRACKING_GIF_FALLBACK_MAX_RAW_FRAMES,
  TRACKING_GIF_MAX_COMPRESSED_BYTES,
  TRACKING_GIF_MAX_IN_FLIGHT_FRAMES,
  TRACKING_MEDIA_MAX_FPS,
  TRACKING_MEDIA_MAX_SAMPLED_FRAMES,
} from '../runtime/media/trackingMediaPolicy';

assert.deepEqual(
  fitTrackingMediaDimensions(4000, 2000),
  { width: 1280, height: 640 },
  'large media is scaled to a 1280px longest edge',
);

const largePlan = planTrackingGif({
  width: 2400,
  height: 1600,
  frameDelaysMs: Array.from({ length: 5_000 }, () => 10),
});
assert.equal(largePlan.fps, TRACKING_MEDIA_MAX_FPS);
assert.equal(largePlan.sampledFrames, TRACKING_MEDIA_MAX_SAMPLED_FRAMES);
assert.equal(largePlan.rawFrameIndices.at(-1), 4_999);
assert(largePlan.width <= 1280 && largePlan.height <= 1280);
assert.equal(TRACKING_GIF_MAX_IN_FLIGHT_FRAMES, 1);
assert.equal(TRACKING_GIF_MAX_COMPRESSED_BYTES, 32 * 1024 * 1024);

const syntheticGif = (frames: number, width = 4000, height = 2000) => {
  const bytes: number[] = [
    ...Array.from('GIF89a', character => character.charCodeAt(0)),
    width & 0xff,
    (width >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
    0,
    0,
    0,
  ];
  for (let index = 0; index < frames; index += 1) {
    bytes.push(
      0x21, 0xf9, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00,
      0x2c,
      0x00, 0x00,
      0x00, 0x00,
      0x01, 0x00,
      0x01, 0x00,
      0x00,
      0x02,
      0x02, 0x44, 0x01,
      0x00,
    );
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
};

const scannedLargeGif = scanTrackingGifMetadata(syntheticGif(5_000));
assert.deepEqual(scannedLargeGif, {
  width: 4000,
  height: 2000,
  rawFrames: 5_000,
  durationMs: 50_000,
});
assert.throws(
  () => assertTrackingGifDecodeInput(scannedLargeGif),
  /600 frames or fewer/,
  'metadata-only scanning rejects oversized raw timelines before a decoder sees them',
);
const scannedLargePlan = planTrackingGifFromMetadata({
  ...scannedLargeGif,
  rawFrames: TRACKING_MEDIA_MAX_SAMPLED_FRAMES,
  durationMs: 30_000,
});
assert.equal(
  scannedLargePlan.rawFrameIndices.length,
  TRACKING_MEDIA_MAX_SAMPLED_FRAMES,
  'metadata-only scanning exposes no more than 600 decode targets',
);
assert.equal(scannedLargePlan.rawFrameIndices.at(-1), 599);
assert.deepEqual(
  { width: scannedLargePlan.width, height: scannedLargePlan.height },
  { width: 1280, height: 640 },
  'the decoder receives the bounded target dimensions before allocating canvases',
);

const forwardReplay = trackingGifFallbackReplayWindow(
  -1,
  TRACKING_GIF_FALLBACK_MAX_RAW_FRAMES - 1,
  TRACKING_GIF_FALLBACK_MAX_RAW_FRAMES,
);
assert.equal(forwardReplay.decodeFrames, TRACKING_GIF_FALLBACK_MAX_RAW_FRAMES);
const backwardReplay = trackingGifFallbackReplayWindow(
  TRACKING_GIF_FALLBACK_MAX_RAW_FRAMES - 1,
  12,
  TRACKING_GIF_FALLBACK_MAX_RAW_FRAMES,
);
assert.deepEqual(
  backwardReplay,
  { reset: true, start: 0, end: 12, decodeFrames: 13 },
  'backward fallback scrub resets into a replay capped by the 600-frame input budget',
);
assert.throws(
  () => trackingGifFallbackReplayWindow(0, 600, 601),
  /raw-frame budget/,
);

const slowPlan = planTrackingGif({
  width: 320,
  height: 240,
  frameDelaysMs: Array.from({ length: 10 }, () => 100),
});
assert.equal(slowPlan.fps, 10);
assert.equal(slowPlan.sampledFrames, 10);

type Listener = (event: Event) => void;
class FakeWorker {
  listeners = new Map<string, Set<Listener>>();
  posts: Array<{ message: Record<string, unknown>; transfer?: Transferable[] }> = [];
  terminated = 0;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const next: Listener = typeof listener === 'function'
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
    this.posts.push({ message, transfer });
  }

  terminate() {
    this.terminated += 1;
  }

  emit(data: Record<string, unknown>) {
    const event = new MessageEvent('message', { data });
    this.listeners.get('message')?.forEach((listener) => listener(event));
  }
}

const worker = new FakeWorker();
const rendered: number[] = [];
const session = createGifFrameSession({
  generationId: 12,
  buffer: new ArrayBuffer(4),
  onReady: () => {},
  onFrame: (index, bitmap) => {
    rendered.push(index);
    bitmap.close();
  },
  onError: (message) => assert.fail(message),
  createWorker: () => worker as unknown as Worker,
});
assert.equal(worker.posts[0].message.type, 'load');
assert.equal(worker.posts[0].transfer?.length, 1, 'compressed GIF bytes transfer to the worker');

worker.emit({ type: 'ready', generationId: 12, plan: slowPlan });
assert.equal(session.requestFrame(1), true);
assert.equal(session.requestFrame(2), true);
assert.equal(session.requestFrame(3), true);
assert.deepEqual(
  worker.posts.filter((post) => post.message.type === 'frame').map((post) => post.message.index),
  [1],
  'only one decoded bitmap is in flight',
);
assert.deepEqual(
  rendered,
  [],
  'requesting or coalescing a frame does not advance the delivered timeline',
);

const firstBitmap = { close: () => {} } as ImageBitmap;
worker.emit({
  type: 'frame',
  generationId: 12,
  requestId: 1,
  index: 1,
  bitmap: firstBitmap,
});
assert.deepEqual(rendered, [1]);
assert.deepEqual(
  worker.posts.filter((post) => post.message.type === 'frame').map((post) => post.message.index),
  [1, 3],
  'rapid scrubs coalesce to the newest pending frame',
);

worker.emit({
  type: 'frame',
  generationId: 12,
  requestId: 2,
  index: 3,
  bitmap: { close: () => {} } as ImageBitmap,
});
assert.deepEqual(
  rendered,
  [1, 3],
  'the delivered callback advances only when each matching bitmap arrives',
);

let staleClosed = 0;
worker.emit({
  type: 'frame',
  generationId: 11,
  requestId: 99,
  index: 9,
  bitmap: { close: () => { staleClosed += 1; } } as ImageBitmap,
});
assert.equal(staleClosed, 1, 'stale generation bitmaps are closed immediately');

session.close();
assert.equal(worker.posts.at(-1)?.message.type, 'dispose');
assert.equal(worker.terminated, 1, 'closing the modal releases its GIF worker');

const failedTransferWorker = new FakeWorker();
failedTransferWorker.postMessage = () => {
  throw new Error('GIF transfer failed');
};
assert.throws(
  () => createGifFrameSession({
    generationId: 13,
    buffer: new ArrayBuffer(4),
    onReady: () => {},
    onFrame: () => {},
    onError: () => {},
    createWorker: () => failedTransferWorker as unknown as Worker,
  }),
  /GIF transfer failed/,
);
assert.equal(
  failedTransferWorker.terminated,
  1,
  'a failed structured-clone transfer releases its GIF worker',
);

console.log('tracking media policy contract ok');
