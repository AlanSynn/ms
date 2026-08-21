import type {
  ProjectImportInput,
  ProjectImportWorkerRequest,
  ProjectImportWorkerResponse,
} from "./projectImportJob";

export interface ProjectImportWorkerPort {
  onmessage: ((event: MessageEvent<ProjectImportWorkerResponse>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: ProjectImportWorkerRequest): void;
  terminate(): void;
}

export type ProjectImportWorkerFactory = () => ProjectImportWorkerPort;
export type ProjectImportFrameScheduler = {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
};

const browserWorkerFactory: ProjectImportWorkerFactory = () =>
  new Worker(new URL("../../workers/projectImportWorker.ts", import.meta.url), {
    type: "module",
    name: "motionsmith-project-import",
  }) as unknown as ProjectImportWorkerPort;

const browserFrameScheduler: ProjectImportFrameScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

const releaseWorker = (worker: ProjectImportWorkerPort) => {
  worker.onmessage = null;
  worker.onmessageerror = null;
  worker.onerror = null;
  worker.terminate();
};

export const createProjectImportWorkerClient = (
  workerFactory: ProjectImportWorkerFactory = browserWorkerFactory,
  frameScheduler: ProjectImportFrameScheduler = browserFrameScheduler,
) => {
  let generationSequence = 0;
  let active:
    | {
        generationId: number;
        input: ProjectImportInput;
        firstFrame?: number;
        secondFrame?: number;
        worker?: ProjectImportWorkerPort;
      }
    | undefined;

  const releaseActive = () => {
    if (!active) return;
    if (active.firstFrame !== undefined)
      frameScheduler.cancelFrame(active.firstFrame);
    if (active.secondFrame !== undefined)
      frameScheduler.cancelFrame(active.secondFrame);
    if (active.worker) releaseWorker(active.worker);
    active = undefined;
  };

  const cancel = () => {
    generationSequence += 1;
    releaseActive();
  };

  const request = (
    input: ProjectImportInput,
    callbacks: {
      complete: (result: Extract<ProjectImportWorkerResponse, { type: "result" }>) => void;
      failed: (error: Error) => void;
    },
  ) => {
    releaseActive();
    const generationId = ++generationSequence;
    active = { generationId, input };

    const startWorker = () => {
      if (!active || active.generationId !== generationId) return;
      let worker: ProjectImportWorkerPort;
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
      worker.onmessageerror = () => fail("Import worker returned unreadable data.");
      worker.onerror = (event) => fail(event.message || "Import worker failed.");
      try {
        worker.postMessage({ type: "import", generationId, input });
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
    requestProject: (
      file: File,
      callbacks: Parameters<typeof request>[1],
    ) => request({ kind: "project", file }, callbacks),
    requestCharacterPackage: (
      files: FileList | File[],
      callbacks: Parameters<typeof request>[1],
    ) => request({ kind: "character-package", files: Array.from(files) }, callbacks),
    cancel,
    dispose: cancel,
  };
};

export type ProjectImportWorkerClient = ReturnType<
  typeof createProjectImportWorkerClient
>;
