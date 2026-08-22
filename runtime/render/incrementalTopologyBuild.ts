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
    onBatchComplete?: (progress: {
      builtThisFrame: number;
      builtTotal: number;
      remaining: number;
      complete: boolean;
    }) => void;
    initialDelayFrames?: number;
    interBatchDelayFrames?: number;
    maxItemsPerFrame?: number;
    frameBudgetMs?: number;
    now?: () => number;
  } = {},
) => {
  const scheduler = options.scheduler ?? browserFrameScheduler;
  const maxItemsPerFrame = Math.max(
    1,
    Math.floor(options.maxItemsPerFrame ?? 1),
  );
  const frameBudgetMs = Math.max(0, options.frameBudgetMs ?? Infinity);
  const now = options.now ?? (() => performance.now());
  let cancelled = false;
  let frameHandle: number | undefined;
  let nextIndex = 0;
  let initialDelayFrames = Math.max(0, Math.floor(options.initialDelayFrames ?? 0));
  let interBatchDelayFrames = 0;
  const requestedInterBatchDelayFrames = Math.max(
    0,
    Math.floor(options.interBatchDelayFrames ?? 0),
  );

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
    if (interBatchDelayFrames > 0) {
      interBatchDelayFrames -= 1;
      scheduleStep();
      return;
    }
    if (nextIndex >= items.length) {
      options.onComplete?.();
      return;
    }

    const startedAt = now();
    let builtThisFrame = 0;
    while (nextIndex < items.length && builtThisFrame < maxItemsPerFrame) {
      const index = nextIndex;
      nextIndex += 1;
      build(items[index], index);
      builtThisFrame += 1;
      if (cancelled) return;
      if (now() - startedAt >= frameBudgetMs) break;
    }

    const complete = nextIndex >= items.length;
    options.onBatchComplete?.({
      builtThisFrame,
      builtTotal: nextIndex,
      remaining: items.length - nextIndex,
      complete,
    });
    if (nextIndex < items.length) {
      interBatchDelayFrames = requestedInterBatchDelayFrames;
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
