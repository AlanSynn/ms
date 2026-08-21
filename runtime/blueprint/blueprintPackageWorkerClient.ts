import type { ProjectState } from "../../types";
import type {
  BlueprintPackageWorkerRequest,
  BlueprintPackageWorkerResponse,
} from "./blueprintPackageJob";

export interface BlueprintPackageWorkerPort {
  onmessage: ((event: MessageEvent<BlueprintPackageWorkerResponse>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: BlueprintPackageWorkerRequest): void;
  terminate(): void;
}

export type BlueprintPackageWorkerFactory = () => BlueprintPackageWorkerPort;
export type BlueprintPackageFrameScheduler = {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
};

const browserWorkerFactory: BlueprintPackageWorkerFactory = () =>
  new Worker(new URL("../../workers/blueprintPackageWorker.ts", import.meta.url), {
    type: "module",
    name: "motionsmith-blueprint-package",
  }) as unknown as BlueprintPackageWorkerPort;

const browserFrameScheduler: BlueprintPackageFrameScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

const releaseWorker = (worker: BlueprintPackageWorkerPort) => {
  worker.onmessage = null;
  worker.onmessageerror = null;
  worker.onerror = null;
  worker.terminate();
};

export const createBlueprintPackageWorkerClient = (
  workerFactory: BlueprintPackageWorkerFactory = browserWorkerFactory,
  frameScheduler: BlueprintPackageFrameScheduler = browserFrameScheduler,
) => {
  let generationSequence = 0;
  let active:
    | {
        generationId: number;
        project: ProjectState;
        firstFrame?: number;
        secondFrame?: number;
        worker?: BlueprintPackageWorkerPort;
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
    project: ProjectState,
    callbacks: {
      complete: (
        result: Extract<BlueprintPackageWorkerResponse, { type: "result" }>,
      ) => void;
      failed: (error: Error) => void;
    },
  ) => {
    releaseActive();
    const generationId = ++generationSequence;
    active = {
      generationId,
      project: { ...project, lastExport: undefined },
    };

    const startWorker = () => {
      if (!active || active.generationId !== generationId) return;
      let worker: BlueprintPackageWorkerPort;
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
          data.generationId !== generationId
        ) return;
        active = undefined;
        releaseWorker(worker);
        if (data.type === "result") callbacks.complete(data);
        else callbacks.failed(new Error(data.message));
      };
      worker.onmessageerror = () => fail("Blueprint worker returned unreadable data.");
      worker.onerror = (event) => fail(event.message || "Blueprint worker failed.");
      try {
        worker.postMessage({
          type: "create-package",
          generationId,
          project: active.project,
        });
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

  return { request, cancel, dispose: cancel };
};

export type BlueprintPackageWorkerClient = ReturnType<
  typeof createBlueprintPackageWorkerClient
>;
