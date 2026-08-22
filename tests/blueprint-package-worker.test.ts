import assert from "node:assert/strict";

import {
  runBlueprintCustomPartsStlJob,
  runBlueprintPackageJob,
} from "../runtime/blueprint/blueprintPackageJob";
import {
  createBlueprintPackageWorkerClient,
  type BlueprintPackageFrameScheduler,
  type BlueprintPackageWorkerPort,
} from "../runtime/blueprint/blueprintPackageWorkerClient";
import type {
  BlueprintPackageWorkerRequest,
  BlueprintPackageWorkerResponse,
} from "../runtime/blueprint/blueprintPackageJob";
import { blueprintPackageWithoutSceneArtwork } from "../runtime/blueprint/blueprintPackageTransfer";
import { createFabricationReadyFourBarProject } from "./fixtures/fabricationProject";
import {
  CUSTOM_PARTS_STL_LIMITS,
  makeCustomPartsStl,
} from "../utils/fabricationCustomParts";
import { createDefaultSceneObject } from "../utils/project";

const project = createFabricationReadyFourBarProject();
const pkg = runBlueprintPackageJob(project);
assert(pkg.svg.startsWith("<svg"));
assert.equal(pkg.customPartsStl, "", "ordinary package work omits the optional STL");
const rasterObject = {
  ...createDefaultSceneObject("block", "large-export-raster"),
  textureUrl:
    `data:image/png;base64,export-raster-marker-${"a".repeat(4 * 1024 * 1024)}`,
};
const rasterProject = {
  ...project,
  sceneObjects: { [rasterObject.id]: rasterObject },
  sceneObjectOrder: [rasterObject.id],
};
const rasterPackage = runBlueprintPackageJob(rasterProject);
const rasterMetadata = JSON.parse(rasterPackage.metadataJson) as {
  sceneSnapshot: { sceneObjects: Record<string, { textureUrl?: string }> };
};
assert.equal(
  rasterMetadata.sceneSnapshot.sceneObjects[rasterObject.id].textureUrl,
  undefined,
  "reduced metadata omits scene artwork bytes",
);
assert.equal(
  rasterPackage.sceneSnapshot.sceneObjects[rasterObject.id].textureUrl,
  rasterObject.textureUrl,
  "the full package snapshot retains scene artwork for round trip",
);
const rasterPackageJson = JSON.stringify(rasterPackage);
assert.equal(
  rasterPackageJson.split("export-raster-marker-").length - 1,
  1,
  "the worker result carries a large scene raster exactly once",
);
assert(
  Buffer.byteLength(rasterPackage.metadataJson) < 512 * 1024,
  "reduced metadata stays independent of a 4 MB scene raster",
);
const rasterTransferPackage = blueprintPackageWithoutSceneArtwork(rasterPackage);
assert.equal(
  JSON.stringify(rasterTransferPackage).includes("export-raster-marker-"),
  false,
  "the worker response does not clone canonical scene artwork back to main",
);
assert(
  Buffer.byteLength(JSON.stringify(rasterTransferPackage)) < 1024 * 1024,
  "worker response size stays independent of a 4 MB scene raster",
);
assert(
  Buffer.byteLength(rasterPackageJson) < 5 * 1024 * 1024,
  "a 4 MB scene raster keeps the complete worker package below 5 MB",
);
const customPartsStl = runBlueprintCustomPartsStlJob(project);
assert(customPartsStl.startsWith("solid motionsmith_custom_parts"));
assert(Buffer.byteLength(customPartsStl) <= CUSTOM_PARTS_STL_LIMITS.maxBytes);
const firstPartId = project.partOrder[0];
const oversizedPart = {
  ...project.parts[firstPartId],
  bounds: { x: -2_000, y: -2_000, width: 4_000, height: 4_000 },
  contourPoints: [
    { x: -2_000, y: -2_000 },
    { x: 2_000, y: -2_000 },
    { x: 2_000, y: 2_000 },
    { x: -2_000, y: 2_000 },
  ],
};
assert.throws(
  () => makeCustomPartsStl({
    ...project,
    parts: { ...project.parts, [firstPartId]: oversizedPart },
    partOrder: [firstPartId],
  }),
  /100,000-cell classroom limit/,
  "STL rejects oversized grids before allocating the occupancy set",
);
assert.throws(
  () => makeCustomPartsStl({
    ...project,
    partOrder: [...project.partOrder, ...project.partOrder],
  }),
  /1\.3 MB classroom limit/,
  "STL rejects output before retaining an oversized facet string array",
);

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
const completedPackages: typeof rasterPackage[] = [];
const stlCompletions: number[] = [];
const stlFailures: string[] = [];
const failures: string[] = [];
const callbacks = {
  complete: (
    result: Extract<BlueprintPackageWorkerResponse, { type: "result" }>,
  ) => {
    completions.push(result.fabricationPackage.id);
    completedPackages.push(result.fabricationPackage);
  },
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

const secondGeneration = client.request(rasterProject, callbacks);
assert.equal(workers[0].terminated, true, "new package request cancels the old worker");
flushFrame();
flushFrame();
assert.equal(workers.length, 2);
assert.equal(
  workers[1].posted[0].project.sceneObjects[rasterObject.id].textureUrl,
  undefined,
  "canonical scene artwork stays on main instead of entering the package worker clone",
);
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
    fabricationPackage: rasterTransferPackage,
  },
} as MessageEvent<BlueprintPackageWorkerResponse>);
assert.deepEqual(completions, [rasterPackage.id]);
assert.equal(
  completedPackages[0].sceneSnapshot.sceneObjects[rasterObject.id].textureUrl,
  rasterObject.textureUrl,
  "the client restores the full package snapshot from canonical references",
);
assert.equal(
  JSON.stringify(completedPackages[0]).split("export-raster-marker-").length - 1,
  1,
  "restored package round trip retains exactly one canonical scene raster",
);
assert.deepEqual(failures, []);
assert.equal(workers[1].terminated, true, "completed package work releases its worker");

const stlInput = {
  ...project,
  parts: {
    ...project.parts,
    [firstPartId]: {
      ...project.parts[firstPartId],
      textureUrl: "data:image/png;base64,large-source",
      maskUrl: "data:image/png;base64,large-mask",
      originalSvgPath: "large-original-svg",
      enhancedSvgPath: "large-enhanced-svg",
    },
  },
  lastExport: pkg,
};
const stlGeneration = client.requestCustomPartsStl(stlInput, {
  complete: (result) => stlCompletions.push(result.customPartsStl.length),
  failed: (error) => stlFailures.push(error.message),
});
flushFrame();
flushFrame();
assert.equal(workers[2].posted[0].type, "create-custom-parts-stl");
assert.equal(workers[2].posted[0].project.lastExport, undefined);
assert.equal(workers[2].posted[0].project.parts[firstPartId].textureUrl, undefined);
assert.equal(workers[2].posted[0].project.parts[firstPartId].maskUrl, undefined);
assert.equal(workers[2].posted[0].project.parts[firstPartId].originalSvgPath, undefined);
assert.equal(workers[2].posted[0].project.parts[firstPartId].enhancedSvgPath, undefined);
workers[2].onmessage?.({
  data: {
    type: "stl-result",
    generationId: stlGeneration,
    customPartsStl,
  },
} as MessageEvent<BlueprintPackageWorkerResponse>);
assert.deepEqual(stlCompletions, [customPartsStl.length]);
assert.deepEqual(stlFailures, []);
assert.equal(workers[2].terminated, true, "completed STL work releases its worker");

client.dispose();
console.log("Blueprint package worker contract ok");
