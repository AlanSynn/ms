import assert from "node:assert/strict";

import { runBlueprintPackageJob } from "../runtime/blueprint/blueprintPackageJob";
import {
  createBlueprintPackageWorkerClient,
  type BlueprintPackageFrameScheduler,
  type BlueprintPackageWorkerPort,
} from "../runtime/blueprint/blueprintPackageWorkerClient";
import type {
  BlueprintPackageWorkerRequest,
  BlueprintPackageWorkerResponse,
} from "../runtime/blueprint/blueprintPackageJob";
import { createFabricationReadyFourBarProject } from "./fixtures/fabricationProject";

const project = createFabricationReadyFourBarProject();
const pkg = runBlueprintPackageJob(project);
assert(pkg.svg.startsWith("<svg"));
assert(pkg.customPartsStl.startsWith("solid motionsmith_custom_parts"));
assert(Buffer.byteLength(pkg.customPartsStl) < 1_300_000);

class FakeWorker implements BlueprintPackageWorkerPort {
  onmessage: ((event: MessageEvent<BlueprintPackageWorkerResponse>) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: BlueprintPackageWorkerRequest[] = [];
  terminated = false;

  postMessage(message: BlueprintPackageWorkerRequest) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const scheduler: BlueprintPackageFrameScheduler = {
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
  if (!entry) throw new Error("Expected a scheduled Blueprint frame");
  frames.delete(entry[0]);
  entry[1](performance.now());
};

const workers: FakeWorker[] = [];
const completions: string[] = [];
const failures: string[] = [];
const callbacks = {
  complete: (
    result: Extract<BlueprintPackageWorkerResponse, { type: "result" }>,
  ) => completions.push(result.fabricationPackage.id),
  failed: (error: Error) => failures.push(error.message),
};
const client = createBlueprintPackageWorkerClient(() => {
  const worker = new FakeWorker();
  workers.push(worker);
  return worker;
}, scheduler);

const firstGeneration = client.request(
  { ...project, lastExport: pkg },
  callbacks,
);
assert.equal(workers.length, 0, "Blueprint worker waits for two paints");
flushFrame();
flushFrame();
assert.equal(workers.length, 1);
assert.equal(workers[0].posted[0].project.lastExport, undefined);
const staleHandler = workers[0].onmessage;

const secondGeneration = client.request(project, callbacks);
assert.equal(workers[0].terminated, true, "new package request cancels the old worker");
flushFrame();
flushFrame();
assert.equal(workers.length, 2);
staleHandler?.({
  data: {
    type: "result",
    generationId: firstGeneration,
    fabricationPackage: pkg,
  },
} as MessageEvent<BlueprintPackageWorkerResponse>);
assert.deepEqual(completions, [], "superseded Blueprint results stay out of app state");

workers[1].onmessage?.({
  data: {
    type: "result",
    generationId: secondGeneration,
    fabricationPackage: pkg,
  },
} as MessageEvent<BlueprintPackageWorkerResponse>);
assert.deepEqual(completions, [pkg.id]);
assert.deepEqual(failures, []);
assert.equal(workers[1].terminated, true, "completed package work releases its worker");

client.dispose();
console.log("Blueprint package worker contract ok");
