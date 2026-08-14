(() => {
  const run = async () => {
    const warmupCount = 120;
    const sampleCount = 360;
    const rig = document.querySelector(
      '[data-testid="foundry-camera-rig"][data-viewer-tab="foundry"]',
    );
    const toolbar = document.querySelector('[data-testid="foundry-toolbar"]');
    if (!rig || !toolbar)
      throw new Error('Foundry playback probe targets are unavailable');
    const button = (label) =>
      [...toolbar.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
    button('Pause')?.click();
    button('Reset')?.click();
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));

    const sampleFrames = (count) =>
      new Promise((resolve) => {
        const intervals = [];
        let prior;
        const sample = (timestamp) => {
          if (prior !== undefined) intervals.push(timestamp - prior);
          prior = timestamp;
          if (intervals.length >= count) {
            resolve(intervals);
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });

    button('Play')?.click();
    await sampleFrames(warmupCount);

    const longTasks = [];
    const longTaskSupported =
      'PerformanceObserver' in window &&
      PerformanceObserver.supportedEntryTypes?.includes('longtask');
    const longTaskObserver = longTaskSupported
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        })
      : null;
    longTaskObserver?.observe({ type: 'longtask', buffered: false });

    let clearCount = 0;
    const clearPatches = [];
    for (const constructorName of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
      const Context = window[constructorName];
      const prototype = Context?.prototype;
      if (!prototype || typeof prototype.clear !== 'function') continue;
      const original = prototype.clear;
      const replacement = function (...args) {
        clearCount += 1;
        return original.apply(this, args);
      };
      prototype.clear = replacement;
      clearPatches.push({ prototype, original, replacement });
    }

    const structuralBuildsBefore = Number(
      rig.getAttribute('data-three-dynamic-build-count') ?? '0',
    );
    const startedAt = performance.now();
    let intervals;
    try {
      intervals = await sampleFrames(sampleCount);
    } finally {
      button('Pause')?.click();
      for (const { prototype, original, replacement } of clearPatches) {
        if (prototype.clear === replacement) prototype.clear = original;
      }
      longTaskObserver?.disconnect();
    }
    const endedAt = performance.now();
    const sorted = [...intervals].sort((left, right) => left - right);
    const percentile = (fraction) =>
      sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
    const structuralBuildsAfter = Number(
      rig.getAttribute('data-three-dynamic-build-count') ?? '0',
    );
    return {
      protocol: 'warm-120-measure-360',
      warmupCount,
      sampleCount,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      meanMs: intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
      maxMs: sorted.at(-1) ?? null,
      clearCount,
      structuralBuildDelta: structuralBuildsAfter - structuralBuildsBefore,
      longTaskSupported,
      longTasks: longTasks.filter(
        (entry) =>
          entry.startTime < endedAt &&
          entry.startTime + entry.duration > startedAt &&
          entry.duration > 50,
      ),
    };
  };

  window.__motionsmithAbPlaybackFinalResult = null;
  run().then(
    (result) => {
      window.__motionsmithAbPlaybackFinalResult = result;
    },
    (error) => {
      window.__motionsmithAbPlaybackFinalResult = {
        error: error instanceof Error ? error.message : String(error),
      };
    },
  );
  return 'started';
})()
