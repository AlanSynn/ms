import assert from 'node:assert/strict';

import {
  createPathGestureDraft,
  type PathGestureDraftScheduler,
} from '../runtime/path/pathGestureDraft';

let now = 0;
let nextHandle = 1;
const pendingFrames = new Map<number, (time: number) => void>();
const scheduler: PathGestureDraftScheduler = {
  now: () => now,
  requestFrame: (callback) => {
    const handle = nextHandle;
    nextHandle += 1;
    pendingFrames.set(handle, callback);
    return handle;
  },
  cancelFrame: (handle) => pendingFrames.delete(handle),
};
const advance = (time: number) => {
  now = time;
  const callbacks = [...pendingFrames.values()];
  pendingFrames.clear();
  callbacks.forEach((callback) => callback(time));
};

const draft = createPathGestureDraft({ minFrameIntervalMs: 1000 / 30, scheduler });
const emissions: Array<number | null> = [];
draft.subscribe((snapshot) => emissions.push(snapshot?.points.at(-1)?.x ?? null));

draft.publish({ pathId: 'path-arm', points: [{ x: 0, y: 0 }], closed: false }, true);
now = 4;
for (let x = 1; x <= 20; x += 1) {
  draft.publish({ pathId: 'path-arm', points: [{ x, y: 0 }], closed: false });
}
assert.deepEqual(emissions, [null, 0], 'the first draft point paints immediately');
assert.equal(pendingFrames.size, 1, 'dense pointer updates coalesce behind one frame');

advance(16);
assert.deepEqual(emissions, [null, 0], 'the draft respects the 30 Hz visual cadence');
assert.equal(pendingFrames.size, 1, 'an early frame keeps one pending visual update');
advance(34);
assert.deepEqual(emissions, [null, 0, 20], 'the latest pointer position wins at the cadence boundary');

now = 36;
draft.publish({ pathId: 'path-arm', points: [{ x: 21, y: 0 }], closed: false });
assert.equal(draft.flush()?.points[0]?.x, 21, 'pointerup flushes the latest point synchronously');
assert.equal(pendingFrames.size, 0, 'flush cancels the pending animation frame');
draft.clear();
assert.equal(draft.getSnapshot(), null, 'clear releases the transient gesture snapshot');
assert.equal(emissions.at(-1), null, 'subscribers restore the canonical path after the gesture');
draft.dispose();

console.log('path gesture draft contract ok');
