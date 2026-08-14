(() => {
  const run = async () => {
    const warmupCount = 500;
    const sampleCount = 1000;
    const input = document.querySelector('input[aria-label="Foundry phase"]');
    const playhead = document.querySelector('[data-testid="foundry-playhead"]');
    const rig = document.querySelector(
      '[data-testid="foundry-camera-rig"][data-viewer-tab="foundry"]',
    );
    if (!(input instanceof HTMLInputElement) || !playhead || !rig)
      throw new Error('Foundry input probe targets are unavailable');

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    if (!valueSetter) throw new Error('Native input value setter is unavailable');

    let sequence = 0;
    const driveOne = () =>
      new Promise((resolve, reject) => {
        const prior = `${playhead.getAttribute('cx')}|${playhead.getAttribute('cy')}`;
        const current = Number(input.value);
        const next = (current + 37 + (sequence % 11)) % 360;
        sequence += 1;
        let dispatchAt = 0;
        const observer = new MutationObserver(() => {
          const changed = `${playhead.getAttribute('cx')}|${playhead.getAttribute('cy')}`;
          if (changed === prior) return;
          clearTimeout(timeout);
          observer.disconnect();
          resolve(performance.now() - dispatchAt);
        });
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error(`No visual mutation for interaction ${sequence}`));
        }, 2_000);
        observer.observe(playhead, {
          attributes: true,
          attributeFilter: ['cx', 'cy'],
        });
        valueSetter.call(input, String(next));
        dispatchAt = performance.now();
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });

    for (let index = 0; index < warmupCount; index += 1) await driveOne();

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

    const latencies = [];
    const startedAt = performance.now();
    const structuralBuildsBefore = Number(
      rig.getAttribute('data-three-dynamic-build-count') ?? '0',
    );
    try {
      for (let index = 0; index < sampleCount; index += 1)
        latencies.push(await driveOne());
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    } finally {
      for (const { prototype, original, replacement } of clearPatches) {
        if (prototype.clear === replacement) prototype.clear = original;
      }
      longTaskObserver?.disconnect();
    }

    const endedAt = performance.now();
    const sorted = [...latencies].sort((left, right) => left - right);
    const percentile = (fraction) =>
      sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
    const structuralBuildsAfter = Number(
      rig.getAttribute('data-three-dynamic-build-count') ?? '0',
    );
    const latencyBands = [32, 36, 40, 48].map(
      (upperBoundMs) => ({
        upperBoundMs,
        count: latencies.filter((value) => value <= upperBoundMs).length,
      }),
    );
    latencyBands.push({
      upperBoundMs: null,
      count: latencies.filter((value) => value > 48).length,
    });
    return {
      protocol: 'warm-500-measure-1000',
      warmupCount,
      sampleCount,
      visualChanges: sampleCount,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      meanMs: latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
      maxMs: sorted.at(-1) ?? null,
      latencyBands,
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

  window.__motionsmithAbInputFinalResult = null;
  run().then(
    (result) => {
      window.__motionsmithAbInputFinalResult = result;
    },
    (error) => {
      window.__motionsmithAbInputFinalResult = {
        error: error instanceof Error ? error.message : String(error),
      };
    },
  );
  return 'started';
})()
