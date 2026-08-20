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

/**
 * Start and release only the tiny worker entry. The expensive recommendation
 * job remains behind its first explicit build message.
 */
export const prepareMechanismRecommendationWorker = (
  workerFactory: MechanismRecommendationWorkerFactory = browserWorkerFactory,
) => {
  workerBootstrap ??= new Promise<void>((resolve) => {
    let worker: MechanismRecommendationWorkerPort;
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
      if (data.type === "ready") finish();
    };
    worker.onerror = finish;
    try {
      worker.postMessage({ type: "warm" });
    } catch {
      finish();
    }
  });
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

  const release = (worker: MechanismRecommendationWorkerPort) => {
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
    input: MechanismRecommendationJobInput,
    callbacks: MechanismRecommendationWorkerCallbacks,
  ) => {
    if (active) release(active.worker);
    const generationId = ++generationSequence;
    let worker: MechanismRecommendationWorkerPort;
    try {
      worker = workerFactory();
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
      release(worker);
      if (data.type === "result") callbacks.complete(data.recommendations);
      else callbacks.failed(new Error(data.message));
    };
    worker.onerror = (event) => {
      if (!active || active.worker !== worker) return;
      active = undefined;
      release(worker);
      callbacks.failed(
        new Error(event.message || "Recommendation worker failed."),
      );
    };
    try {
      worker.postMessage({ type: "build", generationId, input });
    } catch (error) {
      if (active?.worker === worker) active = undefined;
      release(worker);
      callbacks.failed(error instanceof Error ? error : new Error(String(error)));
    }
    return generationId;
  };

  return {
    request,
    cancel,
    dispose: cancel,
  };
};
