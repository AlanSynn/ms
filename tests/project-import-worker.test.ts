import assert from "node:assert/strict";

import {
  PROJECT_IMPORT_LIMITS,
  validateCharacterPackageFiles,
  validateProjectImportFile,
} from "../runtime/import/projectImportPolicy";
import {
  runProjectImportJob,
  type ProjectImportWorkerResponse,
} from "../runtime/import/projectImportJob";
import {
  createProjectImportWorkerClient,
  type ProjectImportFrameScheduler,
  type ProjectImportWorkerPort,
} from "../runtime/import/projectImportWorkerClient";
import { createSampleProject } from "../utils/project";

assert.throws(
  () => validateProjectImportFile({
    name: "large.motionsmith.json",
    size: PROJECT_IMPORT_LIMITS.projectBytes + 1,
  }),
  /24 MB classroom limit/,
);
assert.throws(
  () => validateCharacterPackageFiles([{
    name: "body.png",
    size: PROJECT_IMPORT_LIMITS.packageAssetBytes + 1,
  }]),
  /6 MB image limit/,
);
assert.throws(
  () => validateCharacterPackageFiles(Array.from(
    { length: PROJECT_IMPORT_LIMITS.packageFileCount + 1 },
    (_, index) => ({ name: `${index}.txt`, size: 1 }),
  )),
  /more than 128 files/,
);
assert.throws(
  () => validateCharacterPackageFiles([{
    name: "notes.txt",
    size: PROJECT_IMPORT_LIMITS.packageTotalBytes + 1,
  }]),
  /32 MB classroom limit/,
);

const sample = createSampleProject();
const imported = await runProjectImportJob({
  kind: "project",
  file: new File([JSON.stringify(sample)], "sample.motionsmith.json", {
    type: "application/json",
  }),
});
assert.equal(imported.sourceName, "sample.motionsmith.json");
assert.equal(imported.project.partOrder.length, sample.partOrder.length);
assert.equal(imported.project.mechanisms.length, sample.mechanisms.length);

class FakeWorker implements ProjectImportWorkerPort {
  onmessage: ((event: MessageEvent<ProjectImportWorkerResponse>) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const scheduler: ProjectImportFrameScheduler = {
  requestFrame(callback) {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  },
  cancelFrame(handle) {
    frames.delete(handle);
  },
};
const flushFrame = () => {
  const entry = frames.entries().next().value as
    | [number, FrameRequestCallback]
    | undefined;
  if (!entry) throw new Error("Expected a scheduled import frame");
  frames.delete(entry[0]);
  entry[1](performance.now());
};

const workers: FakeWorker[] = [];
const client = createProjectImportWorkerClient(() => {
  const worker = new FakeWorker();
  workers.push(worker);
  return worker;
}, scheduler);
const completions: string[] = [];
const failures: string[] = [];
const callbacks = {
  complete: (result: Extract<ProjectImportWorkerResponse, { type: "result" }>) =>
    completions.push(result.sourceName),
  failed: (error: Error) => failures.push(error.message),
};

const firstGeneration = client.requestProject(
  new File(["{}"], "first.json"),
  callbacks,
);
assert.equal(workers.length, 0, "import worker waits for two paints");
flushFrame();
flushFrame();
assert.equal(workers.length, 1);
assert.equal(workers[0].posted.length, 1);
const staleHandler = workers[0].onmessage;

const secondGeneration = client.requestCharacterPackage(
  [new File(["{}"], "parts_info.json")],
  callbacks,
);
assert.equal(workers[0].terminated, true, "new import terminates the superseded worker");
flushFrame();
flushFrame();
assert.equal(workers.length, 2);
staleHandler?.({
  data: {
    type: "result",
    generationId: firstGeneration,
    project: sample,
    sourceName: "stale.json",
  },
} as MessageEvent<ProjectImportWorkerResponse>);
assert.deepEqual(completions, [], "superseded results cannot reach app state");

workers[1].onmessage?.({
  data: {
    type: "result",
    generationId: secondGeneration,
    project: sample,
    sourceName: "Character package",
  },
} as MessageEvent<ProjectImportWorkerResponse>);
assert.deepEqual(completions, ["Character package"]);
assert.deepEqual(failures, []);
assert.equal(workers[1].terminated, true, "completed import releases its worker");

client.dispose();
console.log("project import worker and classroom limits ok");
