import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createMechanismRecommendationJobInput,
  createRecommendationRandom,
  type MechanismRecommendationWorkerResponse,
} from "../runtime/recommendations/mechanismRecommendationJob";
import {
  createMechanismRecommendationWorkerClient,
  prepareMechanismRecommendationWorker,
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
  firstInput.project.parts[selectedPart.id].textureUrl,
  undefined,
  "worker snapshots omit retained part texture bytes",
);
assert.equal(
  firstInput.project.parts[selectedPart.id].maskUrl,
  undefined,
  "worker snapshots omit retained part mask bytes",
);
assert.equal(firstInput.project.lastExport, undefined);
assert.equal(firstInput.project.lastFoundryExport, undefined);
assert.equal(firstInput.project.characterPackage, undefined);
assert.doesNotThrow(
  () => structuredClone(firstInput),
  "recommendation input is serializable with structured clone",
);
assert.equal(
  repeatedInput.inputFingerprint,
  firstInput.inputFingerprint,
  "identical recommendation domain inputs keep one stable fingerprint",
);
assert.equal(
  repeatedInput.seed,
  firstInput.seed,
  "identical recommendation domain inputs keep one stable RNG seed",
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
  movedInput.inputFingerprint,
  firstInput.inputFingerprint,
  "path edits create a new worker generation fingerprint",
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

const warmWorker = new FakeRecommendationWorker();
const warmComplete = prepareMechanismRecommendationWorker(() => warmWorker);
assert.deepEqual(
  warmWorker.posted,
  [{ type: "warm" }],
  "Design preparation asks only for the tiny worker bootstrap",
);
assert.equal(
  warmWorker.terminated,
  false,
  "the bootstrap remains owned until its ready acknowledgement",
);
warmWorker.respond({ type: "ready" });
await warmComplete;
assert.equal(
  warmWorker.terminated,
  true,
  "the prepared worker releases immediately without loading a fit job",
);

const workers: FakeRecommendationWorker[] = [];
const completed: string[] = [];
const failed: string[] = [];
const client = createMechanismRecommendationWorkerClient(() => {
  const worker = new FakeRecommendationWorker();
  workers.push(worker);
  return worker;
});
const callbacks = (label: string) => ({
  complete: () => completed.push(label),
  failed: (error: Error) => failed.push(error.message),
});

const firstGeneration = client.request(firstInput, callbacks("stale"));
const firstWorker = workers[0];
const staleHandler = firstWorker.onmessage;
const secondGeneration = client.request(movedInput, callbacks("latest"));
const secondWorker = workers[1];
assert(firstWorker.terminated, "superseding input terminates the active fit worker");
assert(secondGeneration > firstGeneration, "request generations increase monotonically");

staleHandler?.({
  data: {
    type: "result",
    generationId: firstGeneration,
    inputFingerprint: firstInput.inputFingerprint,
    recommendations: [],
  },
} as unknown as MessageEvent<MechanismRecommendationWorkerResponse>);
assert.deepEqual(completed, [], "a terminated stale generation cannot update UI state");

secondWorker.respond({
  type: "result",
  generationId: secondGeneration,
  inputFingerprint: firstInput.inputFingerprint,
  recommendations: [],
});
assert.deepEqual(completed, [], "a mismatched input fingerprint is ignored");
assert.equal(secondWorker.terminated, false, "ignored messages do not release the current job");

secondWorker.respond({
  type: "result",
  generationId: secondGeneration,
  inputFingerprint: movedInput.inputFingerprint,
  recommendations: [],
});
assert.deepEqual(completed, ["latest"], "only the latest matching generation completes");
assert.deepEqual(failed, []);
assert(secondWorker.terminated, "a completed worker releases its fit cache and heap");

client.request(firstInput, callbacks("disposed"));
const disposableWorker = workers[2];
client.dispose();
assert(disposableWorker.terminated, "unmount disposal terminates active recommendation work");

const componentSource = readFileSync(
  join(
    process.cwd(),
    "components/stages/path/MechanismRecommendationSheet.tsx",
  ),
  "utf8",
);
const closedGuard = componentSource.indexOf("if (!isOpen) return null;");
const openMount = componentSource.indexOf(
  "return <OpenMechanismRecommendationSheet",
);
assert(closedGuard >= 0 && openMount > closedGuard);
assert(
  !componentSource.includes("buildMechanismRecommendations("),
  "the React sheet never invokes recommendation fitting on the main thread",
);
assert(
  componentSource.includes("workerClient.dispose()"),
  "the open sheet releases its dedicated worker on unmount",
);

const workerSource = readFileSync(
  join(process.cwd(), "workers/mechanismRecommendationWorker.ts"),
  "utf8",
);
assert(workerSource.includes("runMechanismRecommendationJob(data.input)"));
assert(workerSource.includes('data?.type === "warm"'));
assert(workerSource.includes('postMessage({ type: "ready" })'));
assert(
  workerSource.includes("await import("),
  "the worker entry stays small and loads the recommendation job after it owns the request",
);
assert(workerSource.includes("generationId: data.generationId"));
assert(workerSource.includes("inputFingerprint: data.input.inputFingerprint"));

console.log("mechanism recommendation worker contract ok");
