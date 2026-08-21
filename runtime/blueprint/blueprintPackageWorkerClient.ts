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

const projectForWorker = (
  project: ProjectState,
  requestType: BlueprintPackageWorkerRequest["type"],
): ProjectState => {
  const base = {
    ...project,
    lastExport: undefined,
    lastFoundryExport: undefined,
    characterPackage: undefined,
  };
  if (requestType === "create-package") return base;
  return {
    ...base,
    parts: Object.fromEntries(Object.entries(project.parts).map(([id, part]) => {
      const geometryPart = { ...part };
      delete geometryPart.textureUrl;
      delete geometryPart.maskUrl;
      delete geometryPart.originalSvgPath;
      delete geometryPart.enhancedSvgPath;
      return [id, geometryPart];
    })),
    sceneObjects: Object.fromEntries(
      Object.entries(project.sceneObjects).map(([id, sceneObject]) => {
        const geometryObject = { ...sceneObject };
        delete geometryObject.textureUrl;
        return [id, geometryObject];
      }),
    ),
  };
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

  const requestJob = (
    requestType: BlueprintPackageWorkerRequest["type"],
    project: ProjectState,
    callbacks: {
      complete: (
        result: Exclude<BlueprintPackageWorkerResponse, { type: "error" }>,
      ) => void;
      failed: (error: Error) => void;
    },
  ) => {
    releaseActive();
    const generationId = ++generationSequence;
    active = {
      generationId,
      project: projectForWorker(project, requestType),
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
        if (data.type === "error") callbacks.failed(new Error(data.message));
        else callbacks.complete(data);
      };
      worker.onmessageerror = () => fail("Blueprint worker returned unreadable data.");
      worker.onerror = (event) => fail(event.message || "Blueprint worker failed.");
      try {
        worker.postMessage(requestType === "create-package" ? {
          type: "create-package",
          generationId,
          project: active.project,
        } : {
          type: "create-custom-parts-stl",
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

  const request = (
    project: ProjectState,
    callbacks: {
      complete: (
        result: Extract<BlueprintPackageWorkerResponse, { type: "result" }>,
      ) => void;
      failed: (error: Error) => void;
    },
  ) => requestJob("create-package", project, {
    complete: (result) => {
      if (result.type === "result") callbacks.complete(result);
      else callbacks.failed(new Error("Blueprint worker returned an unexpected STL result."));
    },
    failed: callbacks.failed,
  });

  const requestCustomPartsStl = (
    project: ProjectState,
    callbacks: {
      complete: (
        result: Extract<BlueprintPackageWorkerResponse, { type: "stl-result" }>,
      ) => void;
      failed: (error: Error) => void;
    },
  ) => requestJob("create-custom-parts-stl", project, {
    complete: (result) => {
      if (result.type === "stl-result") callbacks.complete(result);
      else callbacks.failed(new Error("Blueprint worker returned an unexpected package result."));
    },
    failed: callbacks.failed,
  });

  return { request, requestCustomPartsStl, cancel, dispose: cancel };
};

export type BlueprintPackageWorkerClient = ReturnType<
  typeof createBlueprintPackageWorkerClient
>;
