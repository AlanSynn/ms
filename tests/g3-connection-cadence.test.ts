import assert from "node:assert/strict";

import {
  createMechanismConnectionDragSession,
  type DraggingMechanismConnectionSelection,
} from "../components/stages/mechanism/MechanismConnectionOverlay";
import type { FrameCommitScheduler } from "../utils/frameCommitQueue";

const role = "4bar.input-joint" as const;

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

const start = (
  session: ReturnType<typeof createMechanismConnectionDragSession>,
  pointerId = 7,
  identity = "start",
) => {
  session.start({
    pointerId,
    role,
    startX: 10,
    startY: 10,
    startIdentity: identity,
    startHoleIndex: 0,
  });
};

const sample = (
  identity: string,
  targetIdentity = identity,
): {
  dragging: DraggingMechanismConnectionSelection;
  targetIdentity?: string;
} => ({
  dragging: { role, identity, holeIndex: 1 },
  targetIdentity,
});

{
  const { callbacks, scheduler } = createScheduler();
  const frames: string[] = [];
  const session = createMechanismConnectionDragSession({
    scheduler,
    onTransientFrame: (value) => frames.push(value.identity),
  });
  start(session);
  session.move(7, sample("candidate-a"));
  session.move(7, sample("candidate-b"));
  assert.equal(callbacks.size, 1, "a pointer burst schedules one display-frame callback");
  assert.deepEqual(frames, [], "pointer moves do not commit transient React state immediately");
  const callback = callbacks.values().next().value as (() => void) | undefined;
  callbacks.clear();
  callback?.();
  assert.deepEqual(frames, ["candidate-b"], "the frame commits only the latest target");
}

{
  const { callbacks, cancelled, scheduler } = createScheduler();
  const frames: string[] = [];
  const authoritativeCommits: string[] = [];
  const session = createMechanismConnectionDragSession({
    scheduler,
    onTransientFrame: (value) => frames.push(value.identity),
  });
  start(session);
  session.move(7, sample("terminal-target"));
  const pendingHandle = callbacks.keys().next().value as number;
  const completed = session.finish(7);
  assert.deepEqual(frames, ["terminal-target"], "pointer-up flushes the latest transient target synchronously");
  assert(cancelled.includes(pendingHandle), "pointer-up cancels the superseded display callback");
  if (completed?.targetIdentity) authoritativeCommits.push(completed.targetIdentity);
  assert.deepEqual(
    authoritativeCommits,
    ["terminal-target"],
    "pointer-up resolves exactly one latest target through the authoritative commit boundary",
  );
  assert.equal(session.finish(7), undefined, "a terminal pointer-up cannot commit twice");
}

{
  const { callbacks, scheduler } = createScheduler();
  const frames: string[] = [];
  const session = createMechanismConnectionDragSession({
    scheduler,
    onTransientFrame: (value) => frames.push(value.identity),
  });
  start(session, 9);
  session.move(9, sample("cancelled-target"));
  const cancelledCallback = callbacks.values().next().value as (() => void) | undefined;
  session.cancel(9);
  cancelledCallback?.();
  assert.deepEqual(frames, [], "pointer-cancel discards a queued target even if its callback runs later");
  assert.equal(session.finish(9), undefined, "pointer-cancel performs no authoritative commit");
}

{
  const { callbacks, scheduler } = createScheduler();
  const frames: string[] = [];
  const session = createMechanismConnectionDragSession({
    scheduler,
    onTransientFrame: (value) => frames.push(value.identity),
  });
  start(session, 11);
  session.move(11, sample("reset-target"));
  const resetCallback = callbacks.values().next().value as (() => void) | undefined;
  session.reset();
  resetCallback?.();
  assert.deepEqual(frames, [], "mechanism identity/type reset suppresses stale callbacks");

  // React StrictMode may replay an effect cleanup before the same mounted
  // instance is used again. Cleanup is therefore a reset, never a terminal
  // disposal state.
  session.reset();
  start(session, 12, "strict-reuse-start");
  session.move(12, sample("strict-reuse-target"));
  const reuseCallback = callbacks.values().next().value as (() => void) | undefined;
  const completed = session.finish(12);
  reuseCallback?.();
  assert.deepEqual(frames, ["strict-reuse-target"], "StrictMode cleanup reset permits reuse without stale callbacks");
  assert.equal(completed?.targetIdentity, "strict-reuse-target", "reset-then-reuse preserves the authoritative terminal target");
}

console.log("G3 connection cadence contracts passed");
