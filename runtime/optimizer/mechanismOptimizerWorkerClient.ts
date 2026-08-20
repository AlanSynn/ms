import type {
  MechanismOptimizerJobInput,
  MechanismOptimizerJobResult,
  MechanismOptimizerWorkerRequest,
  MechanismOptimizerWorkerResponse,
} from './mechanismOptimizerJob';

export interface MechanismOptimizerWorkerPort {
  onmessage: ((event: MessageEvent<MechanismOptimizerWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: MechanismOptimizerWorkerRequest): void;
  terminate(): void;
}

export type MechanismOptimizerWorkerFactory = () => MechanismOptimizerWorkerPort;

const browserWorkerFactory: MechanismOptimizerWorkerFactory = () =>
  new Worker(
    new URL('../../workers/mechanismOptimizerWorker.ts', import.meta.url),
    { type: 'module', name: 'motionsmith-mechanism-optimizer' },
  ) as unknown as MechanismOptimizerWorkerPort;

let workerBootstrap: Promise<void> | undefined;

/** Prepare and release the tiny worker entry without importing the optimizer job. */
export const prepareMechanismOptimizerWorker = (
  workerFactory: MechanismOptimizerWorkerFactory = browserWorkerFactory,
) => {
  workerBootstrap ??= new Promise<void>((resolve) => {
    let worker: MechanismOptimizerWorkerPort;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      resolve();
    };
    try {
      worker = workerFactory();
    } catch {
      resolve();
      return;
    }
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') finish();
    };
    worker.onerror = finish;
    try {
      worker.postMessage({ type: 'warm' });
    } catch {
      finish();
    }
  });
  return workerBootstrap;
};

export const createMechanismOptimizerWorkerClient = (
  workerFactory: MechanismOptimizerWorkerFactory = browserWorkerFactory,
) => {
  let generationSequence = 0;
  let active:
    | {
        generationId: number;
        inputFingerprint: string;
        worker: MechanismOptimizerWorkerPort;
      }
    | undefined;

  const release = (worker: MechanismOptimizerWorkerPort) => {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  };
  const cancel = () => {
    generationSequence += 1;
    if (active) release(active.worker);
    active = undefined;
  };
  const request = (
    input: MechanismOptimizerJobInput,
    callbacks: {
      progress?: (progress: number) => void;
      complete: (result: MechanismOptimizerJobResult) => void;
      failed: (error: Error) => void;
    },
  ) => {
    if (active) release(active.worker);
    const generationId = ++generationSequence;
    let worker: MechanismOptimizerWorkerPort;
    try {
      worker = workerFactory();
    } catch (error) {
      callbacks.failed(error instanceof Error ? error : new Error(String(error)));
      return generationId;
    }
    active = { generationId, inputFingerprint: input.inputFingerprint, worker };
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') return;
      if (
        !active ||
        active.worker !== worker ||
        data.generationId !== generationId ||
        data.inputFingerprint !== input.inputFingerprint
      ) return;
      if (data.type === 'progress') {
        callbacks.progress?.(data.progress);
        return;
      }
      active = undefined;
      release(worker);
      if (data.type === 'result') callbacks.complete(data.result);
      else callbacks.failed(new Error(data.message));
    };
    worker.onerror = (event) => {
      if (!active || active.worker !== worker) return;
      active = undefined;
      release(worker);
      callbacks.failed(new Error(event.message || 'Optimizer worker failed.'));
    };
    try {
      worker.postMessage({ type: 'optimize', generationId, input });
    } catch (error) {
      if (active?.worker === worker) active = undefined;
      release(worker);
      callbacks.failed(error instanceof Error ? error : new Error(String(error)));
    }
    return generationId;
  };
  return { request, cancel, dispose: cancel };
};
