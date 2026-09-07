import type {
  SceneObjectImageWorkerRequest,
  SceneObjectImageWorkerResponse,
} from "./sceneObjectImageJob";
import type { ProjectState } from "../../types";

export interface SceneObjectImageWorkerPort {
  onmessage: ((event: MessageEvent<SceneObjectImageWorkerResponse>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: SceneObjectImageWorkerRequest): void;
  terminate(): void;
}

export type SceneObjectImageWorkerFactory = () => SceneObjectImageWorkerPort;
export type SceneObjectImageFrameScheduler = {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
};

const browserWorkerFactory: SceneObjectImageWorkerFactory = () =>
  new Worker(new URL("../../workers/sceneObjectImageWorker.ts", import.meta.url), {
    type: "module",
    name: "motionsmith-scene-object-image",
  }) as unknown as SceneObjectImageWorkerPort;

const browserFrameScheduler: SceneObjectImageFrameScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

const releaseWorker = (worker: SceneObjectImageWorkerPort) => {
  worker.onmessage = null;
  worker.onmessageerror = null;
  worker.onerror = null;
  worker.terminate();
};

export const createSceneObjectImageWorkerClient = (
  workerFactory: SceneObjectImageWorkerFactory = browserWorkerFactory,
  frameScheduler: SceneObjectImageFrameScheduler = browserFrameScheduler,
) => {
  let generationSequence = 0;
  let active:
    | {
        generationId: number;
        file: File;
        objectId: string;
        project?: ProjectState;
        firstFrame?: number;
        secondFrame?: number;
        worker?: SceneObjectImageWorkerPort;
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
    file: File,
    objectId: string,
    callbacks: {
      complete: (
        result: Extract<SceneObjectImageWorkerResponse, { type: "result" }>,
      ) => void;
      failed: (error: Error) => void;
    },
    project?: ProjectState,
  ) => {
    releaseActive();
    const generationId = ++generationSequence;
    active = { generationId, file, objectId, project };

    const startWorker = () => {
      if (!active || active.generationId !== generationId) return;
      let worker: SceneObjectImageWorkerPort;
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
      worker.onmessageerror = () => fail("Object image worker returned unreadable data.");
      worker.onerror = (event) => fail(event.message || "Object image worker failed.");
      try {
        worker.postMessage({
          type: "create-object",
          generationId,
          file: active.file,
          objectId: active.objectId,
          project: active.project ? { ...active.project, lastExport: undefined } : undefined,
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

export type SceneObjectImageWorkerClient = ReturnType<
  typeof createSceneObjectImageWorkerClient
>;
