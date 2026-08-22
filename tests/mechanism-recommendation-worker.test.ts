import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createMechanismRecommendationJobInput,
  createRecommendationRandom,
  recommendationProjectSnapshot,
  recommendationProjectSnapshotChunked,
  runMechanismRecommendationJob,
  type MechanismRecommendationWorkerResponse,
} from "../runtime/recommendations/mechanismRecommendationJob";
import {
  createMechanismRecommendationWorkerClient,
  type MechanismRecommendationWorkerPort,
} from "../runtime/recommendations/mechanismRecommendationWorkerClient";
import { generateSmartConfig } from "../utils/optimizer";
import { createSampleProject } from "../utils/project";

const project = createSampleProject();
const selectedPathId = project.selectedPathId ?? Object.keys(project.paths)[0];
const selectedPath = project.paths[selectedPathId];
assert(selectedPath, "sample project exposes a recommendation path");
const selectedPart = project.parts[selectedPath.partId];
assert(selectedPart, "sample recommendation path owns a body part");

const projectWithMedia = {
  ...project,
  parts: {
    ...project.parts,
    [selectedPart.id]: {
      ...selectedPart,
      textureUrl: "data:image/png;base64,retained-texture",
      maskUrl: "data:image/png;base64,retained-mask",
    },
  },
};
const firstInput = createMechanismRecommendationJobInput(
  projectWithMedia,
  projectWithMedia.parts[selectedPart.id],
  selectedPathId,
);
const repeatedInput = createMechanismRecommendationJobInput(
  projectWithMedia,
  projectWithMedia.parts[selectedPart.id],
  selectedPathId,
);

assert.equal(
  firstInput.project,
  projectWithMedia,
  "creating a request performs no eager projection or domain sort",
);
assert.doesNotThrow(
  () => structuredClone(firstInput),
  "recommendation input is serializable with structured clone",
);
assert.equal(
  repeatedInput.requestFingerprint,
  firstInput.requestFingerprint,
  "one ProjectState reference keeps one stable request identity",
);

const movedPathProject = {
  ...projectWithMedia,
  paths: {
    ...projectWithMedia.paths,
    [selectedPathId]: {
      ...selectedPath,
      points: selectedPath.points.map((point, index) =>
        index === 0 ? { ...point, x: point.x + 1 } : point,
      ),
    },
  },
};
const movedInput = createMechanismRecommendationJobInput(
  movedPathProject,
  movedPathProject.parts[selectedPart.id],
  selectedPathId,
);
assert.notEqual(
  movedInput.requestFingerprint,
  firstInput.requestFingerprint,
  "a replacement ProjectState receives a distinct stale-result identity",
);

let projectionClock = 0;
let projectionYields = 0;
const projectedInput = {
  ...firstInput,
  project: await recommendationProjectSnapshotChunked(firstInput.project, {
    now: () => projectionClock++,
    yieldToMain: async () => {
      projectionYields += 1;
    },
  }),
};
assert(projectionYields > 0, "near-bound projection yields at the 8 ms budget");
assert.equal(
  projectedInput.project.parts[selectedPart.id].textureUrl,
  undefined,
  "chunked worker snapshots omit retained part texture bytes",
);
assert.equal(projectedInput.project.parts[selectedPart.id].maskUrl, undefined);
assert.equal(projectedInput.project.lastExport, undefined);
assert.equal(projectedInput.project.lastFoundryExport, undefined);
assert.equal(projectedInput.project.characterPackage, undefined);

const firstJob = runMechanismRecommendationJob(projectedInput);
const repeatedJob = runMechanismRecommendationJob(projectedInput);
assert.equal(
  repeatedJob.inputFingerprint,
  firstJob.inputFingerprint,
  "the worker derives a deterministic domain fingerprint",
);
assert.deepEqual(
  repeatedJob.recommendations,
  firstJob.recommendations,
  "the worker-owned fingerprint seeds deterministic recommendation fitting",
);
const movedJob = runMechanismRecommendationJob({
  ...movedInput,
  project: recommendationProjectSnapshot(movedInput.project),
});
assert.notEqual(
  movedJob.inputFingerprint,
  firstJob.inputFingerprint,
  "path coordinates participate in the worker-owned fingerprint",
);

const sequence = (seed: number) => {
  const random = createRecommendationRandom(seed);
  return Array.from({ length: 8 }, () => random());
};
assert.deepEqual(sequence(12345), sequence(12345));
assert.notDeepEqual(sequence(12345), sequence(54321));
assert.deepEqual(
  generateSmartConfig(
    selectedPath.points,
    "gear_linkage",
    undefined,
    createRecommendationRandom(42),
  ),
  generateSmartConfig(
    selectedPath.points,
    "gear_linkage",
    undefined,
    createRecommendationRandom(42),
  ),
  "recommendation config generation is deterministic when given a seeded source",
);

class FakeRecommendationWorker implements MechanismRecommendationWorkerPort {
  onmessage: MechanismRecommendationWorkerPort["onmessage"] = null;
  onerror: MechanismRecommendationWorkerPort["onerror"] = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(response: MechanismRecommendationWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<MechanismRecommendationWorkerResponse>);
  }
}

const workers: FakeRecommendationWorker[] = [];
const completed: string[] = [];
const failed: string[] = [];
const client = createMechanismRecommendationWorkerClient(() => {
  const worker = new FakeRecommendationWorker();
  workers.push(worker);
  return worker;
}, async (input) => ({
  ...input,
  project: recommendationProjectSnapshot(input.project),
}));
const callbacks = (label: string) => ({
  complete: () => completed.push(label),
  failed: (error: Error) => failed.push(error.message),
});

const firstGeneration = client.request(firstInput, callbacks("stale"));
await Promise.resolve();
const firstWorker = workers[0];
const staleHandler = firstWorker.onmessage;
const secondGeneration = client.request(movedInput, callbacks("latest"));
await Promise.resolve();
const secondWorker = workers[1];
assert(firstWorker.terminated, "superseding input terminates the active fit worker");
assert(secondGeneration > firstGeneration, "request generations increase monotonically");

staleHandler?.({
  data: {
    type: "result",
    generationId: firstGeneration,
    requestFingerprint: firstInput.requestFingerprint,
    inputFingerprint: firstJob.inputFingerprint,
    recommendations: [],
  },
} as unknown as MessageEvent<MechanismRecommendationWorkerResponse>);
assert.deepEqual(completed, [], "a terminated stale generation cannot update UI state");

secondWorker.respond({
  type: "result",
  generationId: secondGeneration,
  requestFingerprint: firstInput.requestFingerprint,
  inputFingerprint: movedJob.inputFingerprint,
  recommendations: [],
});
assert.deepEqual(completed, [], "a mismatched request fingerprint is ignored");
assert.equal(secondWorker.terminated, false, "ignored messages do not release the current job");

secondWorker.respond({
  type: "result",
  generationId: secondGeneration,
  requestFingerprint: movedInput.requestFingerprint,
  inputFingerprint: movedJob.inputFingerprint,
  recommendations: [],
});
assert.deepEqual(completed, ["latest"], "only the latest matching generation completes");
assert.deepEqual(failed, []);
assert(secondWorker.terminated, "a completed worker releases its fit cache and heap");

client.request(firstInput, callbacks("disposed"));
await Promise.resolve();
const disposableWorker = workers[2];
client.dispose();
assert(disposableWorker.terminated, "unmount disposal terminates active recommendation work");

let releaseProjection: (() => void) | undefined;
const deferredWorkers: FakeRecommendationWorker[] = [];
const deferredClient = createMechanismRecommendationWorkerClient(
  () => {
    const worker = new FakeRecommendationWorker();
    deferredWorkers.push(worker);
    return worker;
  },
  async (input, shouldContinue) => {
    await new Promise<void>((resolve) => {
      releaseProjection = resolve;
    });
    if (!shouldContinue()) throw new DOMException("superseded", "AbortError");
    return { ...input, project: recommendationProjectSnapshot(input.project) };
  },
);
deferredClient.request(firstInput, callbacks("projected-after-cancel"));
deferredClient.cancel();
releaseProjection?.();
await Promise.resolve();
await Promise.resolve();
assert.equal(
  deferredWorkers.length,
  0,
  "cancelling chunked projection creates no worker or structured clone",
);

const componentSource = readFileSync(
  join(
    process.cwd(),
    "components/stages/path/MechanismRecommendationSheet.tsx",
  ),
  "utf8",
);
const designWorkflowSource = readFileSync(
  join(
    process.cwd(),
    "components/stages/mechanism/DesignWorkflowPanel.tsx",
  ),
  "utf8",
);
const openMount = componentSource.indexOf(
  "return <OpenMechanismRecommendationSheet",
);
assert(
  openMount >= 0 && componentSource.includes("if (!props.isOpen) return null;"),
  "the closed sheet does not mount the component that prepares recommendation input",
);
assert(
  !componentSource.includes("buildMechanismRecommendations("),
  "the React sheet never invokes recommendation fitting on the main thread",
);
assert(
  componentSource.includes("workerClient.cancel()") &&
    designWorkflowSource.includes("workerClient.dispose()") &&
    designWorkflowSource.includes('data-recommendation-worker="on-demand"'),
  "the sheet cancels stale work while its Design owner releases on-demand workers on unmount",
);

const workerSource = readFileSync(
  join(process.cwd(), "workers/mechanismRecommendationWorker.ts"),
  "utf8",
);
assert(workerSource.includes("runMechanismRecommendationJob(data.input)"));
assert(!workerSource.includes('type === "warm"'));
assert(!workerSource.includes('type: "ready"'));
assert(
  workerSource.includes("await import("),
  "the worker entry stays small and loads the recommendation job after it owns the request",
);
assert(workerSource.includes("generationId: data.generationId"));
assert(workerSource.includes("requestFingerprint: data.input.requestFingerprint"));
assert(workerSource.includes("inputFingerprint: result.inputFingerprint"));

console.log("mechanism recommendation worker contract ok");
