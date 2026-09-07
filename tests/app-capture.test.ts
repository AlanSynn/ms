import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  boundedCaptureSize, canvasHasVisibleContent, CAPTURE_MAX_BYTES, CAPTURE_MAX_PIXELS, CAPTURE_MAX_SIDE,
} from '../utils/appCapture';
import { registerCanvasCapture, renderCanvasForCapture } from '../utils/canvasCapture';
import { stripPngExif } from '../utils/appCapturePng';
import { validateScreenshotPng } from '../workers/feedback/png';

for (const [width, height] of [[1366, 768], [1920, 1080], [8000, 6000], [100, 100_000]]) {
  const size = boundedCaptureSize(width, height);
  assert(size.width <= CAPTURE_MAX_SIDE && size.height <= CAPTURE_MAX_SIDE);
  assert(size.width * size.height <= CAPTURE_MAX_PIXELS);
  assert(size.width > 0 && size.height > 0);
}
assert.deepEqual(boundedCaptureSize(1366, 768), { width: 1366, height: 768 });
for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => boundedCaptureSize(bad, 100));
assert.equal(CAPTURE_MAX_BYTES, 1_500_000);

assert.equal(canvasHasVisibleContent(new Uint8ClampedArray(16)), false, 'transparent buffers are not evidence');
assert.equal(canvasHasVisibleContent(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255])), false, 'black buffers fail');
assert.equal(canvasHasVisibleContent(new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255])), false, 'empty white buffers fail');
assert.equal(canvasHasVisibleContent(new Uint8ClampedArray([255, 255, 255, 255, 50, 80, 130, 255])), true);

let renders = 0;
const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
assert.throws(() => renderCanvasForCapture(canvas), 'unregistered WebGL is rejected');
const releaseOld = registerCanvasCapture(canvas, () => { renders++; });
renderCanvasForCapture(canvas);
assert.equal(renders, 1, 'redraw is synchronous');
const releaseCurrent = registerCanvasCapture(canvas, () => { renders += 10; });
releaseOld();
renderCanvasForCapture(canvas);
assert.equal(renders, 11, 'a stale lease cannot unregister a pooled canvas current renderer');
releaseCurrent();
assert.throws(() => renderCanvasForCapture(canvas));
const releaseLost = registerCanvasCapture(canvas, () => { throw new Error('Context lost'); });
assert.throws(() => renderCanvasForCapture(canvas), /Context lost/);
releaseLost();
assert.doesNotThrow(() => renderCanvasForCapture({ getContext: () => ({}) } as unknown as HTMLCanvasElement));

for (const file of ['components/ThreePuppetPreview.tsx', 'components/stages/foundry/ThreeFoundryPreview.tsx']) {
  const source = readFileSync(file, 'utf8');
  assert.match(source, /registerCanvasCapture\(renderer\.domElement/);
  assert.match(source, /unregisterCapture\(\)/);
  assert.doesNotMatch(source, /preserveDrawingBuffer:\s*true/);
}

// Actual WebKit canvas.toBlob output: four opaque red/green/blue/yellow pixels.
// Its 68-byte native eXIf payload is incompatible with the strict relay boundary.
const webkitPng = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAgAAAADtGLyqAAAAFElEQVQIHWP4z8DwHwSZGME0AwMAPu0F/rdOxzYAAAAASUVORK5CYII=', 'base64',
));
const expectedPng = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAABRJREFUCB1j+M/A8B8EmRjBNAMDAD7tBf63Tsc2AAAAAElFTkSuQmCC', 'base64',
));
const originalBytes = webkitPng.slice();
const cleanPng = stripPngExif(webkitPng);
assert.deepEqual(cleanPng, expectedPng, 'every non-EXIF byte, including pixel data and CRCs, survives');
assert.deepEqual(webkitPng, originalBytes, 'normalization does not mutate the browser output');
assert.equal(webkitPng.length - cleanPng.length, 80, 'only the 68-byte payload and its chunk header/CRC are removed');
assert.equal(stripPngExif(cleanPng), cleanPng, 'PNG without EXIF needs no extra copy');
await assert.rejects(validateScreenshotPng(webkitPng));
await validateScreenshotPng(cleanPng);
const padded = new Uint8Array(webkitPng.length + 11); padded.set(webkitPng, 5);
assert.deepEqual(stripPngExif(padded.subarray(5, 5 + webkitPng.length)), expectedPng, 'byte offsets are respected');
const oversizedChunk = webkitPng.slice(); new DataView(oversizedChunk.buffer).setUint32(46, 0xffffffff);
for (const invalid of [new Uint8Array(8), webkitPng.subarray(0, 60), webkitPng.subarray(0, -1), oversizedChunk]) {
  assert.throws(() => stripPngExif(invalid), /capture PNG/, 'malformed chunks cannot be silently truncated');
}
console.log('App capture bounds, canvas leases, lossless PNG cleanup, and relay compatibility passed.');
