export type GestureDraftScheduler = {
  now: () => number;
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (handle: number) => void;
};

export type CadencedGestureDraftOptions = {
  minFrameIntervalMs?: number;
  scheduler?: GestureDraftScheduler;
};

const browserScheduler = (): GestureDraftScheduler => ({
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
});

export const createCadencedGestureDraft = <Snapshot>({
  minFrameIntervalMs = 1000 / 30,
  scheduler = browserScheduler(),
}: CadencedGestureDraftOptions = {}) => {
  const listeners = new Set<(snapshot: Snapshot | null) => void>();
  let current: Snapshot | null = null;
  let pending: Snapshot | null = null;
  let frameHandle: number | null = null;
  let lastEmitTime = Number.NEGATIVE_INFINITY;
  let emissionCount = 0;

  const emit = (snapshot: Snapshot | null, time: number) => {
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

  const publish = (snapshot: Snapshot, force = false) => {
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

  const subscribe = (listener: (snapshot: Snapshot | null) => void) => {
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
