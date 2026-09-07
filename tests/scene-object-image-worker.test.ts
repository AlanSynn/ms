import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertLocalSceneObjectSvg,
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
import { runSceneObjectImageJob } from "../runtime/import/sceneObjectImageJob";
import { createDefaultSceneObject, createEmptyProject } from "../utils/project";
import { createPortableProjectBlob } from "../runtime/persistence/projectDownloadJob";
import { runProjectImportJob } from "../runtime/import/projectImportJob";

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
  /2048 px or 4 megapixel classroom limit/,
);
assert.deepEqual(
  validateSceneObjectImageDimensions({ width: 2_000, height: 2_000 }),
  { width: 2_000, height: 2_000 },
);
assert.throws(
  () => validateSceneObjectImageDimensions({ width: 8_192, height: 8_192 }),
  /2048 px or 4 megapixel classroom limit/,
  "a tiny compressed 8192 by 8192 header is rejected before image decode",
);
assert.equal(SCENE_OBJECT_IMAGE_LIMITS.maxSourceEdge, 2_048);
assert.equal(SCENE_OBJECT_IMAGE_LIMITS.maxSourcePixels, 4_000_000);
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
assert.throws(
  () => assertLocalSceneObjectSvg(
    '<svg width="1" height="1"><image href="data:image/png;base64,AAAA"/></svg>',
  ),
  /local artwork only/,
  "embedded raster images cannot bypass decoded-pixel limits through SVG",
);
assert.throws(
  () => assertLocalSceneObjectSvg(
    '<svg width="1" height="1"><feImage href="data:image/png;base64,AAAA"/></svg>',
  ),
  /local artwork only/,
  "SVG filter images cannot allocate an unbudgeted raster surface",
);
assert.throws(
  () => assertLocalSceneObjectSvg(
    '<svg><defs><path id="shape"/></defs><use href="external.svg#shape"/></svg>',
  ),
  /local artwork only/,
  "relative SVG references cannot load an unvalidated app resource",
);
assert.throws(
  () => assertLocalSceneObjectSvg(
    '<svg><use href="h&#116;tps://example.com/art.svg#shape"/></svg>',
  ),
  /local artwork only/,
  "XML character references cannot hide a remote SVG resource",
);
assert.doesNotThrow(
  () => assertLocalSceneObjectSvg(
    '<svg><defs><path id="shape"/><linearGradient id="paint"/></defs><use href="#shape" fill="url(#paint)"/></svg>',
  ),
  "self-contained fragment references remain compatible",
);
const decodeSvgDataUrl = (dataUrl: string) =>
  Buffer.from(dataUrl.split(",")[1], "base64").toString("utf8");
const originalSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">\n  <path d="M0 0H1024V768H0Z" fill="#2389da"/>\n</svg>';
const originalFile = new File([originalSvg], 'original.svg', { type: 'image/svg+xml' });
const empty = createEmptyProject();
const originalObject = await runSceneObjectImageJob(originalFile, 'original-image', empty);
assert.equal(originalObject.fabrication, 'decoration', 'image import explicitly records its Scene decoration role until the student chooses Cuttable prop');
assert.equal(decodeSvgDataUrl(originalObject.textureUrl!), originalSvg, 'the original SVG bytes and dimensions remain unchanged');
assert.deepEqual(originalObject.bounds, { width: 118, height: 88.5 }, 'original-byte retention preserves existing physical object dimensions');
const originalProject = { ...empty, sceneObjects: { [originalObject.id]: originalObject }, sceneObjectOrder: [originalObject.id] };
const portable = createPortableProjectBlob(originalProject);
const reopened = (await runProjectImportJob({ kind: 'project', file: new File([portable], 'original.motionsmith') })).project;
assert.equal(reopened.sceneObjects[originalObject.id].textureUrl, originalObject.textureUrl, 'Save/Open preserves the exact original source');
const largeSource = (color: string) => `data:image/svg+xml;base64,${Buffer.from(`<svg width="2000" height="2000"><rect width="2000" height="2000" fill="${color}"/></svg>`).toString('base64')}`;
const crowdedProject = { ...empty, sceneObjects: {
  first: { ...createDefaultSceneObject('block', 'first'), textureUrl: largeSource('#ff0000') },
  second: { ...createDefaultSceneObject('block', 'second'), textureUrl: largeSource('#0000ff') },
}, sceneObjectOrder: ['first', 'second'] };
await assert.rejects(() => runSceneObjectImageJob(originalFile, 'over-budget', crowdedProject), /8 megapixel|8 MP|combined|aggregate/i,
  'keeping native originals cannot commit a project that exceeds the existing aggregate source budget');
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

const firstGeneration = client.request(file, "first", callbacks, originalProject);
assert.equal(workers.length, 0, "object image worker waits for two paints");
flushFrame();
flushFrame();
assert.equal(workers[0].posted[0].project?.sceneObjects[originalObject.id].textureUrl, originalObject.textureUrl,
  'the worker checks import against the captured original-source aggregate');
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
// Original SVG bytes are retained, so the pre-decode budget must use root
// intrinsic dimensions, not a numeric prefix or a child shape's width.
assert.deepEqual(sceneObjectSvgDimensions('<svg width="1in" height="72pt"/>'), { width: 96, height: 96 });
assert.deepEqual(sceneObjectSvgDimensions('<svg width="6pc" height="101.6Q"/>'), { width: 96, height: 96 });
assert.deepEqual(sceneObjectSvgDimensions('<svg width="2.54cm" height="25.4mm"/>'), { width: 96, height: 96 });
assert.deepEqual(sceneObjectSvgDimensions('<svg width="+1.5e2px" height="96"/>'), { width: 150, height: 96 });
assert.deepEqual(sceneObjectSvgDimensions('<svg width="96" viewBox="0 0 2 1"><rect width="9000" height="9000"/></svg>'), { width: 96, height: 48 });
assert.deepEqual(sceneObjectSvgDimensions('<svg viewBox="0 0 96 120"><rect width="8" height="9"/></svg>'), { width: 96, height: 120 });
assert.deepEqual(sceneObjectSvgDimensions('<!-- <svg width="1" height="1"> --><svg viewBox="0 0 96 120"/>'), { width: 96, height: 120 });
assert.throws(() => validateSceneObjectImageDimensions(sceneObjectSvgDimensions('<svg width="100cm" height="100cm"/>')), /2048 px or 4 megapixel/);
for (const markup of [
  '<svg width="100%" height="100%" viewBox="0 0 96 120"/>',
  '<svg width="1em" height="12"/>', '<svg width="100junk" height="12"/>',
  '<svg width="1e99px" height="1e999px"/>', '<svg width="0" height="12"/>',
  '<svg WIDTH="1" HEIGHT="1"/>', '<svg viewbox="0 0 1 1"/>',
  '<svg width="12" height="12" style="width:100cm"/>',
  '<svg width="12" height="12"><style>svg { width: 100cm }</style></svg>',
  '<svg width="12" height="12"><style>svg { w/**/idth: 100cm }</style></svg>',
  '<svg width="12" height="12"><style>svg { \\77 idth: 100cm }</style></svg>',
  '<svg width="12" height="12" style="&#119;idth:100cm"/>',
  '<svg width="12" height="12"><animate attributeName="width" to="100cm"/></svg>',
  '<svg viewBox="0 0 NaN 12"/>', '<svg viewBox="0 0 -1 12"/>', '<svg viewBox="0 0 0x10 12"/>',
  '<svg width="12" width="9000" height="12"/>',
  '<!DOCTYPE svg [<!ENTITY wide "9000">]><svg width="&wide;" height="12"/>',
]) assert.throws(() => sceneObjectSvgDimensions(markup), /fixed width and height or a viewBox/);
console.log("scene object image worker and memory policy ok");
