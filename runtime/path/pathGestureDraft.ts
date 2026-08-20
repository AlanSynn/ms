import type { Point } from '../../types';

export type PathGestureDraftSnapshot = {
  pathId: string;
  points: Point[];
  closed: boolean;
  selectedPointIndex?: number | null;
};

export type PathGestureDraftScheduler = {
  now: () => number;
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (handle: number) => void;
};

type PathGestureDraftOptions = {
  minFrameIntervalMs?: number;
  scheduler?: PathGestureDraftScheduler;
};

const browserScheduler = (): PathGestureDraftScheduler => ({
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
});

export const createPathGestureDraft = ({
  minFrameIntervalMs = 1000 / 30,
  scheduler = browserScheduler(),
}: PathGestureDraftOptions = {}) => {
  const listeners = new Set<(
    snapshot: PathGestureDraftSnapshot | null,
  ) => void>();
  let current: PathGestureDraftSnapshot | null = null;
  let pending: PathGestureDraftSnapshot | null = null;
  let frameHandle: number | null = null;
  let lastEmitTime = Number.NEGATIVE_INFINITY;
  let emissionCount = 0;

  const emit = (snapshot: PathGestureDraftSnapshot | null, time: number) => {
    current = snapshot;
    pending = null;
    lastEmitTime = time;
    emissionCount += 1;
    listeners.forEach((listener) => listener(snapshot));
  };

  const cancelPendingFrame = () => {
    if (frameHandle === null) return;
    scheduler.cancelFrame(frameHandle);
    frameHandle = null;
  };

  const schedulePending = () => {
    if (frameHandle !== null || !pending) return;
    frameHandle = scheduler.requestFrame((time) => {
      frameHandle = null;
      if (!pending) return;
      if (time - lastEmitTime + Number.EPSILON < minFrameIntervalMs) {
        schedulePending();
        return;
      }
      emit(pending, time);
    });
  };

  const publish = (snapshot: PathGestureDraftSnapshot, force = false) => {
    pending = snapshot;
    const now = scheduler.now();
    if (
      force ||
      !Number.isFinite(lastEmitTime) ||
      now - lastEmitTime + Number.EPSILON >= minFrameIntervalMs
    ) {
      cancelPendingFrame();
      emit(snapshot, now);
      return;
    }
    schedulePending();
  };

  const flush = () => {
    if (!pending) return current;
    cancelPendingFrame();
    emit(pending, scheduler.now());
    return current;
  };

  const clear = () => {
    cancelPendingFrame();
    pending = null;
    if (current) emit(null, scheduler.now());
    lastEmitTime = Number.NEGATIVE_INFINITY;
  };

  const subscribe = (
    listener: (snapshot: PathGestureDraftSnapshot | null) => void,
  ) => {
    listeners.add(listener);
    listener(current);
    return () => {
      listeners.delete(listener);
    };
  };

  const dispose = () => {
    cancelPendingFrame();
    pending = null;
    current = null;
    listeners.clear();
  };

  return {
    publish,
    flush,
    clear,
    subscribe,
    dispose,
    getSnapshot: () => current,
    getEmissionCount: () => emissionCount,
  };
};

export type PathGestureDraft = ReturnType<typeof createPathGestureDraft>;
