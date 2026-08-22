export type TransientFrameScheduler = {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

export type TransientValueController<Value> = {
  begin: (value: Value) => void;
  update: (value: Value, afterDelivery?: (value: Value) => void) => void;
  restoreAndRelease: (value: Value) => void;
  finish: () => Value | undefined;
  cancel: () => Value | undefined;
  current: () => Value | undefined;
  isActive: () => boolean;
  subscribe: (listener: (value: Value) => void) => () => void;
  dispose: () => void;
};

const browserFrameScheduler = (): TransientFrameScheduler => ({
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
});

/**
 * Holds gesture-only values outside React and coalesces pointermove delivery to
 * one callback per paint. The caller commits finish() exactly once so shared
 * application state still owns the durable camera value.
 */
export const createTransientValueController = <Value>({
  scheduler,
  onActiveChange,
}: {
  scheduler?: TransientFrameScheduler;
  onActiveChange?: (active: boolean) => void;
} = {}): TransientValueController<Value> => {
  const listeners = new Set<(value: Value) => void>();
  let active = false;
  let value: Value | undefined;
  let pending = false;
  let releaseAfterFlush = false;
  let afterDelivery: ((value: Value) => void) | undefined;
  let frameHandle: number | undefined;

  const getScheduler = () => scheduler ?? browserFrameScheduler();
  const cancelFrame = () => {
    if (frameHandle === undefined) return;
    getScheduler().cancel(frameHandle);
    frameHandle = undefined;
  };
  const flush = () => {
    frameHandle = undefined;
    if (!pending || value === undefined) return;
    pending = false;
    const shouldRelease = releaseAfterFlush;
    const deliveredValue = value;
    const deliveredCallback = afterDelivery;
    releaseAfterFlush = false;
    afterDelivery = undefined;
    listeners.forEach((listener) => listener(deliveredValue));
    deliveredCallback?.(deliveredValue);
    if (shouldRelease && active) {
      active = false;
      onActiveChange?.(false);
    }
  };
  const scheduleFrame = () => {
    if (frameHandle !== undefined) return;
    frameHandle = getScheduler().request(flush);
  };
  const finish = () => {
    if (!active) return value;
    cancelFrame();
    releaseAfterFlush = false;
    active = false;
    onActiveChange?.(false);
    flush();
    return value;
  };
  const cancel = () => {
    const currentValue = value;
    cancelFrame();
    pending = false;
    releaseAfterFlush = false;
    afterDelivery = undefined;
    if (active) {
      active = false;
      onActiveChange?.(false);
    }
    return currentValue;
  };

  return {
    begin(nextValue) {
      cancelFrame();
      pending = false;
      releaseAfterFlush = false;
      afterDelivery = undefined;
      value = nextValue;
      if (!active) {
        active = true;
        onActiveChange?.(true);
      }
    },
    update(nextValue, nextAfterDelivery) {
      if (!active) return;
      value = nextValue;
      pending = true;
      releaseAfterFlush = false;
      afterDelivery = nextAfterDelivery;
      scheduleFrame();
    },
    restoreAndRelease(nextValue) {
      if (!active) {
        active = true;
        onActiveChange?.(true);
      }
      value = nextValue;
      pending = true;
      releaseAfterFlush = true;
      afterDelivery = undefined;
      scheduleFrame();
    },
    finish,
    cancel,
    current: () => value,
    isActive: () => active,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      cancelFrame();
      pending = false;
      releaseAfterFlush = false;
      afterDelivery = undefined;
      listeners.clear();
      if (active) onActiveChange?.(false);
      active = false;
      value = undefined;
    },
  };
};
