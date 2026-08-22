import type { MechanismRecommendation } from "../../utils/mechanismRecommendations";
import type {
  MechanismRecommendationJobInput,
  MechanismRecommendationWorkerRequest,
  MechanismRecommendationWorkerResponse,
} from "./mechanismRecommendationJob";
import { recommendationProjectSnapshotChunked } from "./mechanismRecommendationJob";

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

export type MechanismRecommendationProjector = (
  input: MechanismRecommendationJobInput,
  shouldContinue: () => boolean,
) => Promise<MechanismRecommendationJobInput>;

const defaultProjector: MechanismRecommendationProjector = async (
  input,
  shouldContinue,
) => ({
  ...input,
  project: await recommendationProjectSnapshotChunked(input.project, {
    shouldContinue,
  }),
});

const browserWorkerFactory: MechanismRecommendationWorkerFactory = () =>
  new Worker(
    new URL("../../workers/mechanismRecommendationWorker.ts", import.meta.url),
    { type: "module", name: "motionsmith-mechanism-recommendations" },
  ) as unknown as MechanismRecommendationWorkerPort;

const releaseWorker = (worker: MechanismRecommendationWorkerPort) => {
  worker.onmessage = null;
  worker.onerror = null;
  worker.terminate();
};

/** One active projection/worker means superseding work can cancel immediately. */
export const createMechanismRecommendationWorkerClient = (
  workerFactory: MechanismRecommendationWorkerFactory = browserWorkerFactory,
  projector: MechanismRecommendationProjector = defaultProjector,
) => {
  let generationSequence = 0;
  let active:
    | {
        generationId: number;
        requestFingerprint: string;
        worker?: MechanismRecommendationWorkerPort;
      }
    | undefined;

  const cancel = () => {
    generationSequence += 1;
    if (active?.worker) releaseWorker(active.worker);
    active = undefined;
  };

  const request = (
    input: MechanismRecommendationJobInput,
    callbacks: MechanismRecommendationWorkerCallbacks,
  ) => {
    if (active?.worker) releaseWorker(active.worker);
    const generationId = ++generationSequence;
    active = {
      generationId,
      requestFingerprint: input.requestFingerprint,
    };
    const requestState = active;
    const isCurrent = () =>
      active === requestState &&
      active.generationId === generationId &&
      active.requestFingerprint === input.requestFingerprint;
    void projector(input, isCurrent).then((workerInput) => {
      if (!isCurrent()) return;
      let worker: MechanismRecommendationWorkerPort;
      try {
        worker = workerFactory();
      } catch (error) {
        if (!isCurrent()) return;
        active = undefined;
        callbacks.failed(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      requestState.worker = worker;
      worker.onmessage = ({ data }) => {
        if (
          !isCurrent() ||
          requestState.worker !== worker ||
          data.generationId !== requestState.generationId ||
          data.requestFingerprint !== requestState.requestFingerprint
        ) return;
        active = undefined;
        releaseWorker(worker);
        if (data.type === "result") callbacks.complete(data.recommendations);
        else callbacks.failed(new Error(data.message));
      };
      worker.onerror = (event) => {
        if (!isCurrent() || requestState.worker !== worker) return;
        active = undefined;
        releaseWorker(worker);
        callbacks.failed(
          new Error(event.message || "Recommendation worker failed."),
        );
      };
      try {
        worker.postMessage({ type: "build", generationId, input: workerInput });
      } catch (error) {
        if (isCurrent()) active = undefined;
        releaseWorker(worker);
        callbacks.failed(error instanceof Error ? error : new Error(String(error)));
      }
    }).catch((error) => {
      if (!isCurrent()) return;
      active = undefined;
      callbacks.failed(error instanceof Error ? error : new Error(String(error)));
    });
    return generationId;
  };

  return {
    request,
    cancel,
    dispose: () => {
      generationSequence += 1;
      if (active?.worker) releaseWorker(active.worker);
      active = undefined;
    },
  };
};

export type MechanismRecommendationWorkerClient = ReturnType<
  typeof createMechanismRecommendationWorkerClient
>;
