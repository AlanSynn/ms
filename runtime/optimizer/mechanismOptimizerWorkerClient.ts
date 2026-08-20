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
let preparedWorker: MechanismOptimizerWorkerPort | undefined;

const releaseWorker = (worker: MechanismOptimizerWorkerPort) => {
  worker.onmessage = null;
  worker.onerror = null;
  worker.terminate();
};

const retainPreparedWorker = (worker: MechanismOptimizerWorkerPort) => {
  worker.onmessage = null;
  worker.onerror = null;
  if (preparedWorker) {
    releaseWorker(worker);
    return;
  }
  preparedWorker = worker;
  workerBootstrap = Promise.resolve();
};

const takePreparedWorker = (workerFactory: MechanismOptimizerWorkerFactory) => {
  if (workerFactory !== browserWorkerFactory || !preparedWorker) return undefined;
  const worker = preparedWorker;
  preparedWorker = undefined;
  workerBootstrap = undefined;
  return worker;
};

export const disposePreparedMechanismOptimizerWorker = () => {
  if (preparedWorker) releaseWorker(preparedWorker);
  preparedWorker = undefined;
  workerBootstrap = undefined;
};

/** Prepare one tiny worker entry without importing the optimizer job. */
export const prepareMechanismOptimizerWorker = (
  workerFactory: MechanismOptimizerWorkerFactory = browserWorkerFactory,
) => {
  const warmWorker = (retain: boolean) => new Promise<void>((resolve) => {
    let worker: MechanismOptimizerWorkerPort;
    let settled = false;
    const finish = (ready = false) => {
      if (settled) return;
      settled = true;
      if (ready && retain) {
        retainPreparedWorker(worker);
      } else {
        releaseWorker(worker);
      }
      resolve();
    };
    try {
      worker = workerFactory();
    } catch {
      resolve();
      return;
    }
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') finish(true);
    };
    worker.onerror = () => finish();
    try {
      worker.postMessage({ type: 'warm' });
    } catch {
      finish();
    }
  });

  if (workerFactory !== browserWorkerFactory) return warmWorker(false);
  if (preparedWorker) return Promise.resolve();
  if (!workerBootstrap) {
    const bootstrap = warmWorker(true);
    workerBootstrap = bootstrap;
    void bootstrap.then(() => {
      if (!preparedWorker && workerBootstrap === bootstrap) {
        workerBootstrap = undefined;
      }
    });
  }
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

  const keepsPreparedWorker = workerFactory === browserWorkerFactory;
  const cancel = () => {
    generationSequence += 1;
    if (active) releaseWorker(active.worker);
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
    if (active) releaseWorker(active.worker);
    const generationId = ++generationSequence;
    let worker: MechanismOptimizerWorkerPort;
    try {
      worker = takePreparedWorker(workerFactory) ?? workerFactory();
    } catch (error) {
      callbacks.failed(error instanceof Error ? error : new Error(String(error)));
      return generationId;
    }
    active = {
      generationId,
      inputFingerprint: input.inputFingerprint,
      worker,
    };
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
      if (keepsPreparedWorker && data.type === 'result') {
        retainPreparedWorker(worker);
      } else {
        releaseWorker(worker);
      }
      if (data.type === 'result') callbacks.complete(data.result);
      else callbacks.failed(new Error(data.message));
    };
    worker.onerror = (event) => {
      if (!active || active.worker !== worker) return;
      active = undefined;
      releaseWorker(worker);
      callbacks.failed(new Error(event.message || 'Optimizer worker failed.'));
    };
    try {
      worker.postMessage({ type: 'optimize', generationId, input });
    } catch (error) {
      if (active?.worker === worker) active = undefined;
      releaseWorker(worker);
      callbacks.failed(error instanceof Error ? error : new Error(String(error)));
    }
    return generationId;
  };
  return {
    request,
    cancel,
    dispose: () => {
      generationSequence += 1;
      if (active) releaseWorker(active.worker);
      active = undefined;
    },
  };
};
