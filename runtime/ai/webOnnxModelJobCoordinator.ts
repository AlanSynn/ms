export const createWebOnnxModelJobCoordinator = () => {
  let activeWarm: Promise<unknown> | null = null;
  const activeInferences = new Set<Promise<unknown>>();

  const clearWarm = (job: Promise<unknown>) => {
    if (activeWarm === job) activeWarm = null;
  };

  const abortError = () =>
    new DOMException('ONNX inference cancelled', 'AbortError');

  const waitForJob = (job: Promise<unknown>, signal?: AbortSignal) => {
    if (!signal) return job.then(() => undefined, () => undefined);
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<void>((resolve, reject) => {
      const handleAbort = () => settle(() => reject(abortError()));
      const settle = (complete: () => void) => {
        signal.removeEventListener('abort', handleAbort);
        complete();
      };
      signal.addEventListener('abort', handleAbort, { once: true });
      void job.then(
        () => settle(resolve),
        () => settle(resolve),
      );
    });
  };

  return {
    runWarm<T>(start: () => Promise<T>): Promise<T> {
      if (activeWarm) return activeWarm as Promise<T>;
      const inferences = [...activeInferences];
      const job = Promise.allSettled(inferences).then(start);
      activeWarm = job;
      void job.then(
        () => clearWarm(job),
        () => clearWarm(job),
      );
      return job;
    },
    hasActiveWarm: () => activeWarm !== null,
    runInference<T>(start: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      const warm = activeWarm;
      let job!: Promise<T>;
      job = (async () => {
        if (warm) await waitForJob(warm, signal);
        if (signal?.aborted) throw abortError();
        return start();
      })();
      activeInferences.add(job);
      void job.then(
        () => activeInferences.delete(job),
        () => activeInferences.delete(job),
      );
      return job;
    },
    activeInferenceCount: () => activeInferences.size,
  };
};

export const webOnnxModelJobCoordinator = createWebOnnxModelJobCoordinator();
