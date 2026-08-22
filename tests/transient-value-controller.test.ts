import { strict as assert } from "node:assert";

import {
  createTransientValueController,
  type TransientFrameScheduler,
} from "../runtime/render/transientValueController";

const callbacks = new Map<number, () => void>();
let nextHandle = 1;
const scheduler: TransientFrameScheduler = {
  request(callback) {
    const handle = nextHandle;
    nextHandle += 1;
    callbacks.set(handle, callback);
    return handle;
  },
  cancel(handle) {
    callbacks.delete(handle);
  },
};
const runFrame = () => {
  const queued = [...callbacks.values()];
  callbacks.clear();
  queued.forEach((callback) => callback());
};

const activity: boolean[] = [];
const delivered: number[] = [];
const controller = createTransientValueController<number>({
  scheduler,
  onActiveChange: (active) => activity.push(active),
});
controller.subscribe((value) => delivered.push(value));

controller.begin(0);
for (let value = 1; value <= 20; value += 1) controller.update(value);
assert.equal(callbacks.size, 1, "pointermove bursts request only one visual frame");
assert.deepEqual(delivered, [], "cadenced pointermove does not synchronously enter a state/render path");
runFrame();
assert.deepEqual(delivered, [20], "one frame receives only the newest transient value");

controller.update(21);
controller.update(22);
assert.equal(controller.finish(), 22, "pointer-up returns the exact final camera value");
assert.deepEqual(
  delivered,
  [20, 22],
  "pointer-up flushes one final visual value without replaying intermediate moves",
);
assert.deepEqual(activity, [true, false], "the adaptive owner closes before final delivery");
assert.equal(callbacks.size, 0, "finish cancels the pending animation-frame callback");

controller.begin(100);
const cancelledAfterDelivery: number[] = [];
controller.update(101, (value) => cancelledAfterDelivery.push(value));
controller.restoreAndRelease(100);
assert.equal(callbacks.size, 1, "a same-frame cancellation reuses the scheduled paint boundary");
runFrame();
assert.deepEqual(
  delivered,
  [20, 22, 100],
  "a cancellation replaces an undelivered dirty value with the canonical restore",
);
assert.equal(controller.isActive(), false, "canonical restore releases transient ownership after delivery");
assert.deepEqual(
  cancelledAfterDelivery,
  [],
  "canonical restoration also discards the stale frame's post-delivery state publication",
);

controller.begin(200);
controller.update(201);
runFrame();
controller.restoreAndRelease(200);
assert.equal(callbacks.size, 1, "a delivered dirty value schedules exactly one restore frame");
runFrame();
assert.deepEqual(
  delivered,
  [20, 22, 100, 201, 200],
  "a delivered dirty frame is followed by one explicit canonical restore",
);

controller.begin(300);
controller.update(301);
assert.equal(controller.cancel(), 301, "plain cancellation reports the discarded latest value");
runFrame();
assert.deepEqual(
  delivered,
  [20, 22, 100, 201, 200],
  "plain cancellation discards pending work instead of flushing a stale frame",
);

controller.begin(400);
controller.update(401);
controller.dispose();
assert.equal(callbacks.size, 0, "dispose releases an in-flight frame");
assert.equal(controller.isActive(), false, "dispose releases gesture ownership");
assert.deepEqual(
  activity,
  [true, false, true, false, true, false, true, false, true, false],
  "every transient owner is released exactly once",
);

const deliveryOrder: string[] = [];
const orderedController = createTransientValueController<number>({ scheduler });
orderedController.subscribe((value) => deliveryOrder.push(`visual:${value}`));
orderedController.begin(500);
orderedController.update(501, (value) => deliveryOrder.push(`state:${value}`));
assert.deepEqual(deliveryOrder, [], "the pointer event itself performs no React publication");
runFrame();
assert.deepEqual(
  deliveryOrder,
  ["visual:501", "state:501"],
  "the retained-scene visual subscriber runs before post-frame React draft publication",
);
orderedController.dispose();

console.log("transient value controller contract ok");
