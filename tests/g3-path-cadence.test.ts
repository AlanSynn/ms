import assert from "node:assert/strict";

import { createPathPointerFrameSession } from "../components/stages/path/pathPointerFrameSession";
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
  const commits: number[] = [];
  const session = createPathPointerFrameSession<number>({
    scheduler,
    commit: (value) => commits.push(value),
  });
  assert.equal(session.move(0), false, "a move outside an active gesture is ignored");
  session.start();
  session.move(1);
  session.move(2);
  session.move(3);
  assert.equal(callbacks.size, 1, "a Path pointer burst schedules one display-frame callback");
  assert.deepEqual(commits, [], "a Path pointer burst does not commit synchronously");
  callbacks.values().next().value?.();
  assert.deepEqual(commits, [3], "the Path display frame commits only the latest sample");
}

{
  const { callbacks, cancelled, scheduler } = createScheduler();
  const commits: number[] = [];
  const session = createPathPointerFrameSession<number>({
    scheduler,
    commit: (value) => commits.push(value),
  });
  session.start();
  session.move(4);
  const pendingHandle = callbacks.keys().next().value as number;
  assert.equal(session.finish(), true, "a terminal Path route finishes an active gesture");
  assert.deepEqual(commits, [4], "a terminal Path route flushes the latest canonical sample");
  assert(cancelled.includes(pendingHandle), "terminal flush cancels its superseded display callback");
  assert.equal(session.finish(), false, "duplicate terminal routes cannot commit twice");
}

{
  const { callbacks, scheduler } = createScheduler();
  const commits: number[] = [];
  const session = createPathPointerFrameSession<number>({
    scheduler,
    commit: (value) => commits.push(value),
  });
  session.start();
  session.move(5);
  const staleCallback = callbacks.values().next().value as (() => void) | undefined;
  session.reset();
  staleCallback?.();
  assert.deepEqual(commits, [], "identity change or cleanup cancels a stale Path callback");

  session.start();
  session.move(6);
  const replacedCallback = callbacks.values().next().value as (() => void) | undefined;
  session.start();
  replacedCallback?.();
  session.move(7);
  session.finish();
  assert.deepEqual(commits, [7], "a replacement gesture cancels stale work and retains its own sample");
}

{
  const { callbacks, scheduler } = createScheduler();
  const offsets: Array<{ x: number; y: number }> = [];
  const panSession = createPathPointerFrameSession<{ x: number; y: number }>({
    scheduler,
    commit: (offset) => offsets.push(offset),
  });
  panSession.start();
  panSession.move({ x: 10, y: 5 });
  panSession.move({ x: 20, y: 8 });
  assert.equal(callbacks.size, 1, "a pan burst schedules one display-frame callback");
  panSession.finish();
  assert.deepEqual(offsets, [{ x: 20, y: 8 }], "pan terminal finish flushes its latest offset");
}

const pathEditorSource = await Bun.file(
  "components/stages/path/PathEditor.tsx",
).text();
const sceneSketchSource = await Bun.file(
  "components/stages/path/SceneSketch.tsx",
).text();
assert(
  pathEditorSource.includes("() => () => pathFrameSession.reset()"),
  "PathEditor cleanup cancels queued canonical samples",
);
assert(
  sceneSketchSource.includes("() => () => panFrameSession.reset()"),
  "SceneSketch cleanup cancels queued pan samples",
);
for (const event of [
  "onMouseUp={finishInteraction}",
  "onMouseLeave={finishInteraction}",
  "onPointerUp={finishInteraction}",
  "onPointerCancel={finishInteraction}",
  "onLostPointerCapture={finishInteraction}",
]) {
  assert(sceneSketchSource.includes(event), `Path gestures flush through ${event}`);
}

console.log("G3 Path cadence contracts passed");
