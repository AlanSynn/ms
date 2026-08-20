export type TopologyFrameScheduler = {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

const browserFrameScheduler: TopologyFrameScheduler = {
  request: (callback) => window.requestAnimationFrame(() => callback()),
  cancel: (handle) => window.cancelAnimationFrame(handle),
};

export const scheduleIncrementalTopologyBuild = <Item>(
  items: readonly Item[],
  build: (item: Item, index: number) => void,
  options: {
    scheduler?: TopologyFrameScheduler;
    onComplete?: () => void;
    initialDelayFrames?: number;
  } = {},
) => {
  const scheduler = options.scheduler ?? browserFrameScheduler;
  let cancelled = false;
  let frameHandle: number | undefined;
  let nextIndex = 0;
  let initialDelayFrames = Math.max(0, Math.floor(options.initialDelayFrames ?? 0));

  const scheduleStep = () => {
    frameHandle = scheduler.request(step);
  };

  function step() {
    frameHandle = undefined;
    if (cancelled) return;
    if (initialDelayFrames > 0) {
      initialDelayFrames -= 1;
      scheduleStep();
      return;
    }
    if (nextIndex >= items.length) {
      options.onComplete?.();
      return;
    }

    const index = nextIndex;
    nextIndex += 1;
    build(items[index], index);
    if (cancelled) return;

    if (nextIndex < items.length) {
      scheduleStep();
    } else {
      options.onComplete?.();
    }
  }

  if (items.length) {
    scheduleStep();
  } else {
    options.onComplete?.();
  }

  return () => {
    cancelled = true;
    if (frameHandle !== undefined) scheduler.cancel(frameHandle);
    frameHandle = undefined;
  };
};
