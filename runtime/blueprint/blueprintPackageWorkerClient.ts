import type { ProjectState } from "../../types";
import type { BuildPlanLaneV1 } from "../../utils/buildPlan";
import { projectContentFingerprint } from "../../utils/projectSerialization";
import type {
  BlueprintPackageWorkerRequest,
  BlueprintPackageWorkerResponse,
} from "./blueprintPackageJob";
import {
  projectWithoutBlueprintArtwork,
  restoreBlueprintPackageSceneArtwork,
} from "./blueprintPackageTransfer";

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
): ProjectState => {
  const base = {
    ...project,
    lastExport: undefined,
    lastFoundryExport: undefined,
    characterPackage: undefined,
  };
  return projectWithoutBlueprintArtwork(base);
};

export const createBlueprintPackageWorkerClient = (
  workerFactory: BlueprintPackageWorkerFactory = browserWorkerFactory,
  frameScheduler: BlueprintPackageFrameScheduler = browserFrameScheduler,
) => {
  let generationSequence = 0;
  let active:
    | {
        generationId: number;
        sourceProject: ProjectState;
        sourceProjectFingerprint: string;
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
    options: { lane?: BuildPlanLaneV1 } = {},
  ) => {
    releaseActive();
    const generationId = ++generationSequence;
    const sourceProjectFingerprint = projectContentFingerprint(project);
    active = {
      generationId,
      sourceProject: project,
      sourceProjectFingerprint,
      project: projectForWorker(project),
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
        const sourceProject = active.sourceProject;
        active = undefined;
        releaseWorker(worker);
        if (data.type === "error") callbacks.failed(new Error(data.message));
        else if (data.type === "result") callbacks.complete({
          ...data,
          fabricationPackage: restoreBlueprintPackageSceneArtwork(
            data.fabricationPackage,
            sourceProject,
          ),
        });
        else callbacks.complete(data);
      };
      worker.onmessageerror = () => fail("Blueprint worker returned unreadable data.");
      worker.onerror = (event) => fail(event.message || "Blueprint worker failed.");
      try {
        const request: BlueprintPackageWorkerRequest = requestType === "create-package"
          ? {
              type: "create-package",
              generationId,
              project: active.project,
              lane: options.lane,
              sourceProjectFingerprint: active.sourceProjectFingerprint,
            }
          : requestType === "create-character-template"
            ? {
                type: "create-character-template",
                generationId,
                project: active.project,
                sourceProjectFingerprint: active.sourceProjectFingerprint,
              }
            : {
                type: "create-custom-parts-stl",
                generationId,
                project: active.project,
                sourceProjectFingerprint: active.sourceProjectFingerprint,
              };
        worker.postMessage(request);
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
    options: { lane?: BuildPlanLaneV1 } = {},
  ) => requestJob("create-package", project, {
    complete: (result) => {
      if (result.type === "result") callbacks.complete(result);
      else callbacks.failed(new Error("Blueprint worker returned an unexpected STL result."));
    },
    failed: callbacks.failed,
  }, options);

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

  const requestCharacterTemplate = (
    project: ProjectState,
    callbacks: {
      complete: (
        result: Extract<BlueprintPackageWorkerResponse, { type: "character-template-result" }>,
      ) => void;
      failed: (error: Error) => void;
    },
  ) => requestJob("create-character-template", project, {
    complete: (result) => {
      if (result.type === "character-template-result") callbacks.complete(result);
      else callbacks.failed(new Error("Blueprint worker returned an unexpected result."));
    },
    failed: callbacks.failed,
  });

  return { request, requestCustomPartsStl, requestCharacterTemplate, cancel, dispose: cancel };
};

export type BlueprintPackageWorkerClient = ReturnType<
  typeof createBlueprintPackageWorkerClient
>;
