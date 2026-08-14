import assert from "node:assert/strict";

import { createFoundryParamDragSession } from "../components/stages/foundry/foundryParamDragSession";
import type { FrameCommitScheduler } from "../utils/frameCommitQueue";

const createScheduler = () => {
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
  return { callbacks, cancelled, scheduler };
};

{
  const { callbacks, scheduler } = createScheduler();
  const commits: Array<{ handle: string; x: number }> = [];
  const session = createFoundryParamDragSession({
    scheduler,
    commit: ({ handle, point }) => commits.push({ handle, x: point.x }),
  });
  session.start(7, "A");
  session.move(7, { x: 1, y: 0 });
  session.move(7, { x: 2, y: 0 });
  assert.equal(callbacks.size, 1, "a pointer burst schedules one display-frame callback");
  assert.deepEqual(commits, [], "pointer moves do not commit project state immediately");
  callbacks.values().next().value?.();
  assert.deepEqual(commits, [{ handle: "A", x: 2 }], "the frame commits only the latest sample");
}

{
  const { callbacks, cancelled, scheduler } = createScheduler();
  const commits: number[] = [];
  const session = createFoundryParamDragSession({
    scheduler,
    commit: ({ point }) => commits.push(point.x),
  });
  session.start(8, "D");
  session.move(8, { x: 3, y: 0 });
  const pendingHandle = callbacks.keys().next().value as number;
  assert.equal(session.finish(8), true, "the matching pointer finishes the drag");
  assert.deepEqual(commits, [3], "pointer-up synchronously flushes the latest sample");
  assert(cancelled.includes(pendingHandle), "pointer-up cancels the superseded display callback");
  assert.equal(session.finish(8), false, "a terminal pointer-up cannot commit twice");
}

{
  const { callbacks, scheduler } = createScheduler();
  const commits: number[] = [];
  const session = createFoundryParamDragSession({
    scheduler,
    commit: ({ point }) => commits.push(point.x),
  });
  session.start(9, "M");
  session.move(9, { x: 4, y: 0 });
  const cancelledCallback = callbacks.values().next().value as (() => void) | undefined;
  assert.equal(session.cancel(10), false, "a nonmatching pointer cannot cancel the drag");
  assert.equal(session.cancel(9), true, "the matching pointer cancels the drag");
  cancelledCallback?.();
  assert.deepEqual(commits, [], "pointer-cancel discards queued project updates");
}

{
  const { callbacks, scheduler } = createScheduler();
  const commits: number[] = [];
  const session = createFoundryParamDragSession({
    scheduler,
    commit: ({ point }) => commits.push(point.x),
  });
  session.start(11, "A");
  session.move(12, { x: 5, y: 0 });
  assert.equal(callbacks.size, 0, "a nonmatching pointer move is a no-op");
  assert.equal(session.finish(12), false, "a nonmatching pointer-up is a no-op");
  session.move(11, { x: 6, y: 0 });
  const resetCallback = callbacks.values().next().value as (() => void) | undefined;
  session.reset();
  resetCallback?.();
  assert.deepEqual(commits, [], "cleanup reset suppresses a stale queued callback");
}

{
  const { callbacks, scheduler } = createScheduler();
  const commits: number[] = [];
  const session = createFoundryParamDragSession({
    scheduler,
    commit: ({ point }) => commits.push(point.x),
  });
  session.start(13, "A");
  session.move(13, { x: 7, y: 0 });
  const staleCallback = callbacks.values().next().value as (() => void) | undefined;
  session.start(14, "D");
  staleCallback?.();
  assert.deepEqual(commits, [], "a new drag start cancels stale queued work");
  session.move(14, { x: 8, y: 0 });
  session.finish(14);
  assert.deepEqual(commits, [8], "the replacement drag retains its own terminal sample");
}

const source = await Bun.file(
  "components/stages/foundry/MechanismFoundry.tsx",
).text();
assert(
  source.includes("onParamPointerCancel={handleFoundryParamPointerCancel}"),
  "Foundry routes cancellation through a distinct discard handler",
);
assert(
  source.includes("() => () => foundryParamDragSession.reset()"),
  "Foundry cancels queued drag work during effect cleanup",
);

console.log("G3 Foundry parameter cadence contracts passed");
