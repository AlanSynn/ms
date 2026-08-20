import type { MechanismRecommendation } from "../../utils/mechanismRecommendations";
import type {
  MechanismRecommendationJobInput,
  MechanismRecommendationWorkerRequest,
  MechanismRecommendationWorkerResponse,
} from "./mechanismRecommendationJob";

export interface MechanismRecommendationWorkerPort {
  onmessage:
    | ((event: MessageEvent<MechanismRecommendationWorkerResponse>) => void)
    | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: MechanismRecommendationWorkerRequest): void;
  terminate(): void;
}

export type MechanismRecommendationWorkerFactory =
  () => MechanismRecommendationWorkerPort;

export type MechanismRecommendationWorkerCallbacks = {
  complete: (recommendations: MechanismRecommendation[]) => void;
  failed: (error: Error) => void;
};

const browserWorkerFactory: MechanismRecommendationWorkerFactory = () =>
  new Worker(
    new URL("../../workers/mechanismRecommendationWorker.ts", import.meta.url),
    { type: "module", name: "motionsmith-mechanism-recommendations" },
  ) as unknown as MechanismRecommendationWorkerPort;

let workerBootstrap: Promise<void> | undefined;
let preparedWorker: MechanismRecommendationWorkerPort | undefined;

const releaseWorker = (worker: MechanismRecommendationWorkerPort) => {
  worker.onmessage = null;
  worker.onerror = null;
  worker.terminate();
};

const retainPreparedWorker = (worker: MechanismRecommendationWorkerPort) => {
  worker.onmessage = null;
  worker.onerror = null;
  if (preparedWorker) {
    releaseWorker(worker);
    return;
  }
  preparedWorker = worker;
  workerBootstrap = Promise.resolve();
};

const takePreparedWorker = (
  workerFactory: MechanismRecommendationWorkerFactory,
) => {
  if (workerFactory !== browserWorkerFactory || !preparedWorker) return undefined;
  const worker = preparedWorker;
  preparedWorker = undefined;
  workerBootstrap = undefined;
  return worker;
};

export const disposePreparedMechanismRecommendationWorker = () => {
  if (preparedWorker) releaseWorker(preparedWorker);
  preparedWorker = undefined;
  workerBootstrap = undefined;
};

/**
 * Prepare one tiny worker entry for the Design surface. The expensive
 * recommendation job remains behind its first explicit build message.
 */
export const prepareMechanismRecommendationWorker = (
  workerFactory: MechanismRecommendationWorkerFactory = browserWorkerFactory,
) => {
  const warmWorker = (retain: boolean) => new Promise<void>((resolve) => {
    let worker: MechanismRecommendationWorkerPort;
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
      if (data.type === "ready") finish(true);
    };
    worker.onerror = () => finish();
    try {
      worker.postMessage({ type: "warm" });
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

/** One active worker means superseding a synchronous fit can cancel immediately. */
export const createMechanismRecommendationWorkerClient = (
  workerFactory: MechanismRecommendationWorkerFactory = browserWorkerFactory,
) => {
  let generationSequence = 0;
  let active:
    | {
        generationId: number;
        inputFingerprint: string;
        worker: MechanismRecommendationWorkerPort;
      }
    | undefined;

  const keepsPreparedWorker = workerFactory === browserWorkerFactory;

  const cancel = () => {
    generationSequence += 1;
    if (active) releaseWorker(active.worker);
    active = undefined;
  };

  const request = (
    input: MechanismRecommendationJobInput,
    callbacks: MechanismRecommendationWorkerCallbacks,
  ) => {
    if (active) releaseWorker(active.worker);
    const generationId = ++generationSequence;
    let worker: MechanismRecommendationWorkerPort;
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
      if (data.type === "ready") return;
      if (
        !active ||
        active.worker !== worker ||
        data.generationId !== active.generationId ||
        data.inputFingerprint !== active.inputFingerprint
      ) return;
      active = undefined;
      if (keepsPreparedWorker && data.type === "result") {
        retainPreparedWorker(worker);
      } else {
        releaseWorker(worker);
      }
      if (data.type === "result") callbacks.complete(data.recommendations);
      else callbacks.failed(new Error(data.message));
    };
    worker.onerror = (event) => {
      if (!active || active.worker !== worker) return;
      active = undefined;
      releaseWorker(worker);
      callbacks.failed(
        new Error(event.message || "Recommendation worker failed."),
      );
    };
    try {
      worker.postMessage({ type: "build", generationId, input });
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

export type MechanismRecommendationWorkerClient = ReturnType<
  typeof createMechanismRecommendationWorkerClient
>;
