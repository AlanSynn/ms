import { runVersionJob, type VersionJobRequest, type VersionJobResponse } from '../runtime/versions/versionJobs';

// Retention has a FIFO job queue. Autosave's latest-value cancellation cannot discard it.
let tail = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<VersionJobRequest>) => {
  tail = tail.then(async () => {
    const start = performance.now();
    try {
      const result = await runVersionJob(data);
      self.postMessage({ id: data.id, result, durationMs: performance.now() - start } satisfies VersionJobResponse);
    } catch (error) {
      self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error), durationMs: performance.now() - start } satisfies VersionJobResponse);
    }
  });
};
