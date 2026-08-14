import assert from "node:assert/strict";

import {
  createFrameCommitSession,
  type FrameCommitScheduler,
} from "../utils/frameCommitQueue";

const callbacks = new Map<number, () => void>();
let nextHandle = 1;
const scheduler: FrameCommitScheduler = {
  request: (callback) => {
    const handle = nextHandle++;
    callbacks.set(handle, callback);
    return handle;
  },
  cancel: (handle) => callbacks.delete(handle),
};
const commits: number[] = [];
const session = createFrameCommitSession<number>({
  scheduler,
  commit: (value) => commits.push(value),
});

session.start();
session.move(1.1);
session.move(1.2);
session.move(1.3);
assert.equal(callbacks.size, 1, "a cam-profile burst schedules one display frame");
session.finish();
assert.deepEqual(commits, [1.3], "pointer end flushes the final accepted cam sample");

session.start();
session.move(1.4);
const staleCallback = callbacks.values().next().value as (() => void) | undefined;
session.reset();
staleCallback?.();
assert.deepEqual(
  commits,
  [1.3],
  "mechanism replacement or Reset discards stale queued profile work",
);

const source = await Bun.file(
  "components/stages/mechanism/MechanismParametricEditor.tsx",
).text();
assert(
  source.includes("useFrameCommitSession") &&
    source.includes("profileFrameSession.move"),
  "the cam profile editor queues canonical updates through the shared frame session",
);
for (const terminalRoute of [
  "onPointerUp={finishProfileDrag}",
  "onPointerCancel={finishProfileDrag}",
  "onLostPointerCapture={finishProfileDrag}",
]) {
  assert(source.includes(terminalRoute), `cam profile finalizes through ${terminalRoute}`);
}
assert(
  source.includes("profileFrameSession.finish()") &&
    source.includes("profileFrameSession.reset()"),
  "cam profile terminal routes flush while replacement and Reset cancel",
);
assert(
  source.includes("if (mechanismId !== mechanism.id) return"),
  "a queued sample cannot cross a mechanism identity replacement",
);
assert(
  source.includes("safeMechanismUpdate(mechanism, { camProfileSamples: nextProfile }, kit)"),
  "frame cadence preserves the G1 fabrication-safety acceptance boundary",
);
assert(
  !source.includes("onPointerLeave={() =>"),
  "pointer capture keeps the gesture active when the pointer leaves the SVG",
);

console.log("G3 cam profile cadence contracts passed");
