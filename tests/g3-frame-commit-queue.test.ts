import assert from "node:assert/strict";

import {
  createFrameCommitQueue,
  type FrameCommitScheduler,
} from "../utils/frameCommitQueue";

const callbacks = new Map<number, () => void>();
const cancelled: number[] = [];
let nextHandle = 1;
const scheduler: FrameCommitScheduler = {
  request: (callback) => {
    const handle = nextHandle++;
    callbacks.set(handle, callback);
    return handle;
  },
  cancel: (handle) => {
    cancelled.push(handle);
    callbacks.delete(handle);
  },
};
const committed: number[] = [];
const queue = createFrameCommitQueue<number>({
  scheduler,
  commit: (value) => committed.push(value),
});

queue.queue(1);
queue.queue(2);
queue.queue(3);
assert.equal(callbacks.size, 1, "a burst schedules one display-frame commit");
callbacks.values().next().value?.();
assert.deepEqual(committed, [3], "the display frame commits only the latest sample");
assert.equal(queue.pending(), false, "the completed frame clears pending state");

queue.queue(4);
queue.flush();
assert.deepEqual(committed, [3, 4], "terminal gestures synchronously flush the latest sample");
assert.deepEqual(cancelled, [2], "a synchronous flush cancels its queued frame");

queue.queue(5);
const cancelledFrame = callbacks.values().next().value;
queue.cancel();
cancelledFrame?.();
assert.deepEqual(committed, [3, 4], "cancellation discards an abandoned sample");
assert.equal(queue.pending(), false, "cancellation clears pending state");

const source = await Bun.file(
  "components/ui/InspectorControls.tsx",
).text();
for (const terminalHandler of [
  "onPointerUp={flushRangeChange}",
  "onPointerCancel={flushRangeChange}",
  "onLostPointerCapture={flushRangeChange}",
  "onBlur={flushRangeChange}",
]) {
  assert(
    source.includes(terminalHandler),
    `range edits flush through ${terminalHandler}`,
  );
}
assert(
  source.includes("boundedChange(next) === false") &&
    source.includes("setNumberResetVersion"),
  "a rejected numeric edit remounts with the authoritative value",
);

const routerSource = await Bun.file("components/AppStageRouter.tsx").text();
const inspectorSource = await Bun.file(
  "components/stages/mechanism/DesignInspectorPanel.tsx",
).text();
assert(
  routerSource.includes(
    "updateMechanism: (id: string, updates: Partial<MechanismConfig>) => boolean",
  ),
  "the stage boundary preserves authoritative acceptance results",
);
assert(
  inspectorSource.includes("boardScenePitch(project.settings.physicalKit)"),
  "placement sliders advance by the active fabrication-kit hole pitch",
);

console.log("G3 frame commit queue contracts passed");
