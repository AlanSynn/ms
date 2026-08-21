import type {
  MechanismFitJobInput,
  MechanismFitJobResult,
  MechanismFitWorkerRequest,
  MechanismFitWorkerResponse,
} from './mechanismFitJob';

export interface MechanismFitWorkerPort {
  onmessage: ((event: MessageEvent<MechanismFitWorkerResponse>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: MechanismFitWorkerRequest): void;
  terminate(): void;
}

export type MechanismFitWorkerFactory = () => MechanismFitWorkerPort;

export type MechanismFitFrameScheduler = {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
};

const browserWorkerFactory: MechanismFitWorkerFactory = () =>
  new Worker(new URL('../../workers/mechanismFitWorker.ts', import.meta.url), {
    type: 'module',
    name: 'motionsmith-mechanism-fit',
  }) as unknown as MechanismFitWorkerPort;

const browserFrameScheduler: MechanismFitFrameScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

const releaseWorker = (worker: MechanismFitWorkerPort) => {
  worker.onmessage = null;
  worker.onmessageerror = null;
  worker.onerror = null;
  worker.terminate();
};

export const createMechanismFitWorkerClient = (
  workerFactory: MechanismFitWorkerFactory = browserWorkerFactory,
  frameScheduler: MechanismFitFrameScheduler = browserFrameScheduler,
) => {
  let generationSequence = 0;
  let active:
    | {
        generationId: number;
        inputFingerprint: string;
        firstFrame?: number;
        secondFrame?: number;
        worker?: MechanismFitWorkerPort;
      }
    | undefined;

  const releaseActive = () => {
    if (!active) return;
    if (active.firstFrame !== undefined) {
      frameScheduler.cancelFrame(active.firstFrame);
    }
    if (active.secondFrame !== undefined) {
      frameScheduler.cancelFrame(active.secondFrame);
    }
    if (active.worker) releaseWorker(active.worker);
    active = undefined;
  };

  const cancel = () => {
    generationSequence += 1;
    releaseActive();
  };

  const request = (
    input: MechanismFitJobInput,
    callbacks: {
      complete: (result: MechanismFitJobResult) => void;
      failed: (error: Error) => void;
    },
  ) => {
    releaseActive();
    const generationId = ++generationSequence;
    active = { generationId, inputFingerprint: input.inputFingerprint };

    const startWorker = () => {
      if (!active || active.generationId !== generationId) return;
      let worker: MechanismFitWorkerPort;
      try {
        worker = workerFactory();
      } catch (error) {
        active = undefined;
        callbacks.failed(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      active.worker = worker;
      const fail = (message: string) => {
        if (!active || active.worker !== worker) return;
        active = undefined;
        releaseWorker(worker);
        callbacks.failed(new Error(message));
      };
      worker.onmessage = ({ data }) => {
        if (
          !active ||
          active.worker !== worker ||
          data.generationId !== generationId ||
          data.inputFingerprint !== input.inputFingerprint
        ) return;
        active = undefined;
        releaseWorker(worker);
        if (data.type === 'result') callbacks.complete(data.result);
        else callbacks.failed(new Error(data.message));
      };
      worker.onmessageerror = () => fail('Fit worker returned unreadable data.');
      worker.onerror = (event) => fail(event.message || 'Fit worker failed.');
      try {
        worker.postMessage({ type: 'fit', generationId, input });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    };

    active.firstFrame = frameScheduler.requestFrame(() => {
      if (!active || active.generationId !== generationId) return;
      active.firstFrame = undefined;
      active.secondFrame = frameScheduler.requestFrame(() => {
        if (!active || active.generationId !== generationId) return;
        active.secondFrame = undefined;
        startWorker();
      });
    });
    return generationId;
  };

  return {
    request,
    cancel,
    dispose: cancel,
  };
};

export type MechanismFitWorkerClient = ReturnType<
  typeof createMechanismFitWorkerClient
>;
