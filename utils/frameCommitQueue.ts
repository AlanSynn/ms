export type FrameCommitScheduler = {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

export type FrameCommitQueue<Value> = {
  queue: (value: Value) => void;
  flush: () => void;
  cancel: () => void;
  pending: () => boolean;
};

export type FrameCommitSession<Value> = {
  start: () => void;
  move: (value: Value) => boolean;
  finish: () => boolean;
  reset: () => void;
};

const browserFrameCommitScheduler = (): FrameCommitScheduler => ({
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
});

/** Commit only the latest sampled value per display frame. */
export const createFrameCommitQueue = <Value>({
  commit,
  scheduler = browserFrameCommitScheduler(),
}: {
  commit: (value: Value) => void;
  scheduler?: FrameCommitScheduler;
}): FrameCommitQueue<Value> => {
  let pendingValue: Value | undefined;
  let hasPendingValue = false;
  let frameHandle: number | undefined;

  const commitPending = () => {
    frameHandle = undefined;
    if (!hasPendingValue) return;
    const value = pendingValue as Value;
    pendingValue = undefined;
    hasPendingValue = false;
    commit(value);
  };

  const cancel = () => {
    if (frameHandle !== undefined) scheduler.cancel(frameHandle);
    frameHandle = undefined;
    pendingValue = undefined;
    hasPendingValue = false;
  };

  return {
    queue: (value) => {
      pendingValue = value;
      hasPendingValue = true;
      if (frameHandle !== undefined) return;
      frameHandle = scheduler.request(commitPending);
    },
    flush: () => {
      if (frameHandle !== undefined) scheduler.cancel(frameHandle);
      commitPending();
    },
    cancel,
    pending: () => hasPendingValue,
  };
};

/** Bound a latest-only frame queue to one pointer gesture lifecycle. */
export const createFrameCommitSession = <Value>({
  commit,
  scheduler,
}: {
  commit: (value: Value) => void;
  scheduler?: FrameCommitScheduler;
}): FrameCommitSession<Value> => {
  let active = false;
  const frameQueue = createFrameCommitQueue({ commit, scheduler });

  const reset = () => {
    frameQueue.cancel();
    active = false;
  };

  return {
    start: () => {
      frameQueue.cancel();
      active = true;
    },
    move: (value) => {
      if (!active) return false;
      frameQueue.queue(value);
      return true;
    },
    finish: () => {
      if (!active) return false;
      frameQueue.flush();
      active = false;
      return true;
    },
    reset,
  };
};
