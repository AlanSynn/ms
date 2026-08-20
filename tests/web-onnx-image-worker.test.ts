import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildWebOnnxPartPlans,
  buildWebOnnxSkeleton,
  createWebOnnxMask,
  fitWebOnnxImageDimensions,
  WEB_ONNX_IMAGE_MAX_EDGE,
  type WebOnnxKeypoint,
} from '../runtime/ai/webOnnxImageGeometry';
import {
  readWebOnnxImageMetadata,
  WEB_ONNX_IMAGE_MAX_COMPRESSED_BYTES,
} from '../runtime/ai/webOnnxImageDecodePolicy';

assert.deepEqual(
  fitWebOnnxImageDimensions(4_000, 3_000),
  { width: 1_280, height: 960 },
  'AI raster work is capped before pixel masks and component queues are allocated',
);
assert.equal(WEB_ONNX_IMAGE_MAX_EDGE, 1_280);
assert.equal(WEB_ONNX_IMAGE_MAX_COMPRESSED_BYTES, 32 * 1024 * 1024);

const pngHeader = new Uint8Array(24);
pngHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
pngHeader.set([0x49, 0x48, 0x44, 0x52], 12);
new DataView(pngHeader.buffer).setUint32(16, 4_000);
new DataView(pngHeader.buffer).setUint32(20, 3_000);
assert.deepEqual(readWebOnnxImageMetadata(pngHeader), {
  type: 'image/png',
  width: 4_000,
  height: 3_000,
});

const jpegHeader = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0xb8, 0x0f, 0xa0,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
]);
assert.deepEqual(readWebOnnxImageMetadata(jpegHeader), {
  type: 'image/jpeg',
  width: 4_000,
  height: 3_000,
});

const webpHeader = new Uint8Array(30);
webpHeader.set(Array.from('RIFF', character => character.charCodeAt(0)), 0);
webpHeader.set(Array.from('WEBPVP8X', character => character.charCodeAt(0)), 8);
new DataView(webpHeader.buffer).setUint32(16, 10, true);
webpHeader.set([0x9f, 0x0f, 0x00], 24);
webpHeader.set([0xb7, 0x0b, 0x00], 27);
assert.deepEqual(readWebOnnxImageMetadata(webpHeader), {
  type: 'image/webp',
  width: 4_000,
  height: 3_000,
});

const width = 160;
const height = 220;
const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
for (let y = 20; y < 210; y += 1) {
  for (let x = 45; x < 115; x += 1) {
    const offset = (y * width + x) * 4;
    pixels[offset] = 20;
    pixels[offset + 1] = 30;
    pixels[offset + 2] = 40;
  }
}
const mask = createWebOnnxMask(pixels, width, height);
assert(mask.data.some(Boolean));
assert(mask.bbox.width <= width && mask.bbox.height <= height);

const point = (name: string, x: number, y: number): WebOnnxKeypoint => ({
  name,
  x,
  y,
  confidence: 1,
});
const keypoints = [
  point('nose', 80, 30),
  point('left_shoulder', 60, 70), point('right_shoulder', 100, 70),
  point('left_elbow', 45, 105), point('right_elbow', 115, 105),
  point('left_wrist', 35, 140), point('right_wrist', 125, 140),
  point('left_hip', 65, 130), point('right_hip', 95, 130),
  point('left_knee', 60, 170), point('right_knee', 100, 170),
  point('left_ankle', 55, 205), point('right_ankle', 105, 205),
];
const skeleton = buildWebOnnxSkeleton(
  keypoints,
  width,
  height,
  mask,
  '/onnx/pose_model.onnx',
);
const plans = buildWebOnnxPartPlans(skeleton, mask);
assert.equal(plans.length, 10, 'worker-side segmentation keeps the complete editable part set');
assert(plans.every((plan) => plan.crop.width > 0 && plan.crop.height > 0));

const mainSource = readFileSync(join(process.cwd(), 'utils/webOnnx.ts'), 'utf8');
const workerSource = readFileSync(
  join(process.cwd(), 'workers/webOnnxInferenceWorker.ts'),
  'utf8',
);
const rasterSource = readFileSync(
  join(process.cwd(), 'runtime/ai/webOnnxImageRaster.ts'),
  'utf8',
);
const cacheWorkerSource = readFileSync(
  join(process.cwd(), 'workers/webOnnxCacheWorker.ts'),
  'utf8',
);
assert(!mainSource.includes('getImageData('));
assert(!mainSource.includes('new Int32Array('));
assert(!mainSource.includes('response.body.getReader()'));
assert(!mainSource.includes('modelBuffer'));
assert(mainSource.includes('webOnnxModelJobCoordinator.runInference('));
assert(workerSource.includes('prepareWebOnnxImage(request.file)'));
assert(workerSource.includes('finishWebOnnxImage(prepared, skeleton)'));
assert(workerSource.includes('new TransformStream<Uint8Array, Uint8Array>'));
assert(workerSource.includes('releaseWithoutThrowing'));
assert(!workerSource.includes('creatingSession'));
assert(rasterSource.includes('readWebOnnxImageMetadata(header)'));
assert(rasterSource.includes('data: file.stream()'));
assert(rasterSource.includes('desiredWidth: dimensions.width'));
assert(rasterSource.includes('desiredHeight: dimensions.height'));
assert(rasterSource.includes('cannot safely decode images above 1280px'));
assert(!workerSource.includes('const chunks:'));
assert(!cacheWorkerSource.includes('const chunks:'));
assert(
  !cacheWorkerSource.includes('.arrayBuffer()'),
  'explicit model warm streams directly into Cache Storage without retaining a full worker-side model copy',
);
assert(!cacheWorkerSource.includes('buffer.slice(0)'));
assert(cacheWorkerSource.includes("if (!hasCacheApi())"));
assert(cacheWorkerSource.includes('the AI model was not retained'));

console.log('web ONNX image worker contract ok');
