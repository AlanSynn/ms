import type { ProjectState } from "../../types";
import { projectForPersistence } from "../../utils/projectSerialization";

export type ProjectDownloadWorkerRequest = {
  type: "serialize-portable-project";
  generationId: number;
  project: ProjectState;
};

export type ProjectDownloadWorkerResponse =
  | {
      type: "result";
      generationId: number;
      blob: Blob;
    }
  | { type: "error"; generationId: number; message: string };

export type ProjectDownloadWorkerPort = {
  onmessage: ((event: MessageEvent<ProjectDownloadWorkerResponse>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: (message: ProjectDownloadWorkerRequest) => void;
  terminate: () => void;
};

export type ProjectDownloadWorkerFactory = () => ProjectDownloadWorkerPort;
export type ProjectDownloadFrameScheduler = {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
};

const browserWorkerFactory: ProjectDownloadWorkerFactory = () =>
  new Worker(new URL("../../workers/projectDownloadWorker.ts", import.meta.url), {
    type: "module",
    name: "motionsmith-project-download",
  }) as unknown as ProjectDownloadWorkerPort;

const browserFrameScheduler: ProjectDownloadFrameScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

const releaseWorker = (worker: ProjectDownloadWorkerPort) => {
  worker.onmessage = null;
  worker.onmessageerror = null;
  worker.onerror = null;
  worker.terminate();
};

export const createProjectDownloadWorkerClient = (
  workerFactory: ProjectDownloadWorkerFactory = browserWorkerFactory,
  frameScheduler: ProjectDownloadFrameScheduler = browserFrameScheduler,
) => {
  let generationSequence = 0;
  let active:
    | {
        generationId: number;
        project: ProjectState;
        firstFrame?: number;
        secondFrame?: number;
        worker?: ProjectDownloadWorkerPort;
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
      complete: (blob: Blob) => void;
      unavailable: () => void;
      failed: (error: Error) => void;
    },
  ) => {
    releaseActive();
    const generationId = ++generationSequence;
    active = {
      generationId,
      project: projectForPersistence(project),
    };

    const startWorker = () => {
      if (!active || active.generationId !== generationId) return;
      if (
        typeof Worker === "undefined" &&
        workerFactory === browserWorkerFactory
      ) {
        active = undefined;
        callbacks.unavailable();
        return;
      }
      let worker: ProjectDownloadWorkerPort;
      try {
        worker = workerFactory();
      } catch {
        active = undefined;
        callbacks.unavailable();
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
        if (data.type === "result") callbacks.complete(data.blob);
        else callbacks.failed(new Error(data.message));
      };
      worker.onmessageerror = () =>
        fail("Project save worker returned unreadable data.");
      worker.onerror = (event) =>
        fail(event.message || "Project save worker failed.");
      try {
        worker.postMessage({
          type: "serialize-portable-project",
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

export type ProjectDownloadWorkerClient = ReturnType<
  typeof createProjectDownloadWorkerClient
>;
