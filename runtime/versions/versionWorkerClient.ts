import type { VersionJobRequest, VersionJobResponse, VersionJobs } from './versionJobs';

export const createVersionWorkerClient = () => {
  let worker: Worker | undefined;
  let sequence = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const release = () => { worker?.terminate(); worker = undefined; };
  const fail = (error: Error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    release();
  };
  const request = <K extends keyof VersionJobs>(type: K, input: VersionJobs[K]['input']): Promise<VersionJobs[K]['output']> => {
    if (pending.size >= 3) return Promise.reject(new Error('Versions are busy. Wait, then try again.'));
    clearTimeout(idle);
    return new Promise((resolve, reject) => {
      try {
        if (!worker) {
          worker = new Worker(new URL('../../workers/projectVersionsWorker.ts', import.meta.url), { type: 'module', name: 'motionsmith-versions' });
          worker.onmessage = ({ data }: MessageEvent<VersionJobResponse>) => {
            const job = pending.get(data.id);
            if (!job) return;
            pending.delete(data.id);
            if (data.error) job.reject(new Error(data.error));
            else job.resolve(data.result);
            if (!pending.size) idle = setTimeout(release, 5_000);
          };
          worker.onerror = event => fail(new Error(event.message || 'Earlier versions worker failed.'));
          worker.onmessageerror = () => fail(new Error('Earlier versions returned unreadable data.'));
        }
        const id = ++sequence;
        pending.set(id, { resolve: value => resolve(value as VersionJobs[K]['output']), reject });
        worker.postMessage({ id, type, input } as VersionJobRequest);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        reject(error);
      }
    });
  };
  return {
    request,
    dispose: () => { clearTimeout(idle); fail(new Error('Earlier versions closed.')); },
  };
};
