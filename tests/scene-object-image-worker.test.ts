import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertLocalSceneObjectSvg,
  boundedSceneObjectSvgDataUrl,
  fitSceneObjectImageDimensions,
  rasterImageDimensions,
  SCENE_OBJECT_IMAGE_LIMITS,
  sceneObjectSvgDimensions,
  validateSceneObjectImageDimensions,
  validateSceneObjectImageFile,
} from "../runtime/import/sceneObjectImagePolicy";
import {
  createSceneObjectImageWorkerClient,
  type SceneObjectImageFrameScheduler,
  type SceneObjectImageWorkerPort,
} from "../runtime/import/sceneObjectImageWorkerClient";
import type {
  SceneObjectImageWorkerRequest,
  SceneObjectImageWorkerResponse,
} from "../runtime/import/sceneObjectImageJob";
import { createDefaultSceneObject } from "../utils/project";

assert.equal(
  validateSceneObjectImageFile({ name: "prop.png", type: "", size: 100 }),
  "image/png",
);
assert.throws(
  () => validateSceneObjectImageFile({
    name: "huge.png",
    type: "image/png",
    size: SCENE_OBJECT_IMAGE_LIMITS.compressedBytes + 1,
  }),
  /12 MB classroom limit/,
);
assert.throws(
  () => validateSceneObjectImageFile({
    name: "huge.svg",
    type: "image/svg+xml",
    size: SCENE_OBJECT_IMAGE_LIMITS.svgBytes + 1,
  }),
  /512 KB classroom limit/,
);
assert.throws(
  () => validateSceneObjectImageDimensions({ width: 8_000, height: 8_000 }),
  /16 megapixel classroom limit/,
);
assert.deepEqual(
  fitSceneObjectImageDimensions({ width: 4_000, height: 2_000 }, 512),
  { width: 512, height: 256 },
);
assert.deepEqual(
  sceneObjectSvgDimensions('<svg viewBox="0 0 96 120"></svg>'),
  { width: 96, height: 120 },
);
assert.throws(
  () => assertLocalSceneObjectSvg('<svg><image href="https://example.com/a.png"/></svg>'),
  /local artwork only/,
);
const decodeSvgDataUrl = (dataUrl: string) =>
  Buffer.from(dataUrl.split(",")[1], "base64").toString("utf8");
const boundedSvg = decodeSvgDataUrl(
  boundedSceneObjectSvgDataUrl(
    '<svg width="4000" height="2000" viewBox="0 0 4000 2000"></svg>',
    { width: 512, height: 256 },
  ),
);
assert.match(boundedSvg, /width="512" height="256"/);
assert.doesNotMatch(boundedSvg, /width="4000"|height="2000"/);
const unquotedBoundedSvg = decodeSvgDataUrl(
  boundedSceneObjectSvgDataUrl(
    '<svg width=4000 height=2000 viewBox="0 0 4000 2000"></svg>',
    { width: 512, height: 256 },
  ),
);
assert.match(unquotedBoundedSvg, /width="512" height="256"/);
assert.doesNotMatch(unquotedBoundedSvg, /width=4000|height=2000/);
const fixturePng = readFileSync(join(
  process.cwd(),
  "tests/fixtures/package/body.png",
));
assert.deepEqual(
  rasterImageDimensions(fixturePng, "image/png"),
  { width: 160, height: 220 },
);

class FakeWorker implements SceneObjectImageWorkerPort {
  onmessage: ((event: MessageEvent<SceneObjectImageWorkerResponse>) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: SceneObjectImageWorkerRequest[] = [];
  terminated = false;

  postMessage(message: SceneObjectImageWorkerRequest) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const scheduler: SceneObjectImageFrameScheduler = {
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
  if (!entry) throw new Error("Expected a scheduled image frame");
  frames.delete(entry[0]);
  entry[1](performance.now());
};

const workers: FakeWorker[] = [];
const completions: string[] = [];
const callbacks = {
  complete: (result: Extract<SceneObjectImageWorkerResponse, { type: "result" }>) =>
    completions.push(result.object.id),
  failed: (error: Error) => { throw error; },
};
const client = createSceneObjectImageWorkerClient(() => {
  const worker = new FakeWorker();
  workers.push(worker);
  return worker;
}, scheduler);
const file = new File([fixturePng], "body.png", { type: "image/png" });

const firstGeneration = client.request(file, "first", callbacks);
assert.equal(workers.length, 0, "object image worker waits for two paints");
flushFrame();
flushFrame();
const staleHandler = workers[0].onmessage;
const secondGeneration = client.request(file, "second", callbacks);
assert.equal(workers[0].terminated, true);
flushFrame();
flushFrame();
staleHandler?.({
  data: {
    type: "result",
    generationId: firstGeneration,
    object: createDefaultSceneObject("block", "first"),
  },
} as MessageEvent<SceneObjectImageWorkerResponse>);
assert.deepEqual(completions, []);
workers[1].onmessage?.({
  data: {
    type: "result",
    generationId: secondGeneration,
    object: createDefaultSceneObject("block", "second"),
  },
} as MessageEvent<SceneObjectImageWorkerResponse>);
assert.deepEqual(completions, ["second"]);
assert.equal(workers[1].terminated, true);

client.dispose();
console.log("scene object image worker and memory policy ok");
