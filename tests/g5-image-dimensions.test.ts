import assert from "node:assert/strict";
import { boundedImageSize, encodedImageSize, WEB_IMAGE_LIMITS } from "../utils/imageDimensions";
import { foregroundMaskFromRgba } from "../utils/webOnnxPreprocess";

const png = new Uint8Array(24);
png.set([0x89, 0x50, 0x4e, 0x47]);
new DataView(png.buffer).setUint32(16, 4_000);
new DataView(png.buffer).setUint32(20, 3_000);

const jpeg = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
  0x0b, 0xb8, 0x0f, 0xa0, 0x03, 0x01, 0x11, 0x00,
  0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
]);

const webp = new Uint8Array(30);
webp.set(new TextEncoder().encode("RIFF"), 0);
webp.set(new TextEncoder().encode("WEBP"), 8);
webp.set(new TextEncoder().encode("VP8X"), 12);
webp.set([0x9f, 0x0f, 0x00, 0xb7, 0x0b, 0x00], 24);

assert.deepEqual(await encodedImageSize(new File([png], "large.png", { type: "image/png" })), { width: 4_000, height: 3_000 });
assert.deepEqual(await encodedImageSize(new File([jpeg], "large.jpg", { type: "image/jpeg" })), { width: 4_000, height: 3_000 });
assert.deepEqual(await encodedImageSize(new File([webp], "large.webp", { type: "image/webp" })), { width: 4_000, height: 3_000 });

const { readImage } = await import("../utils/webOnnxImagePipeline");
const originalCreateImageBitmap = globalThis.createImageBitmap;
let decodeCalls = 0;
Object.defineProperty(globalThis, "createImageBitmap", {
  configurable: true,
  value: async () => {
    decodeCalls += 1;
    throw new Error("decode should not run for an unknown image format");
  },
});
await assert.rejects(
  readImage(new File([new TextEncoder().encode("not-an-image")], "unknown.bin")),
  /unsupported-image-format/,
);
assert.equal(decodeCalls, 0, "unknown image formats are rejected before unbounded decode");
Object.defineProperty(globalThis, "createImageBitmap", {
  configurable: true,
  value: originalCreateImageBitmap,
});

const bounded = boundedImageSize(4_000, 3_000, WEB_IMAGE_LIMITS.maxWorkingEdge, WEB_IMAGE_LIMITS.maxWorkingPixels);
assert(bounded.width * bounded.height <= WEB_IMAGE_LIMITS.maxWorkingPixels);
assert(Math.max(bounded.width, bounded.height) <= WEB_IMAGE_LIMITS.maxWorkingEdge);
assert.throws(() => boundedImageSize(0, 1, 1024, 1_000_000), /invalid/i);

const noisyWidth = 800;
const noisyHeight = 800;
const noisyRgba = new Uint8Array(noisyWidth * noisyHeight * 4);
noisyRgba.fill(255);
for (let y = 0; y < noisyHeight; y += 2) {
  for (let x = 0; x < noisyWidth; x += 2) {
    const offset = (y * noisyWidth + x) * 4;
    noisyRgba[offset] = 0;
    noisyRgba[offset + 1] = 0;
    noisyRgba[offset + 2] = 0;
    noisyRgba[offset + 3] = 255;
  }
}
const noisyMask = foregroundMaskFromRgba(noisyRgba, noisyWidth, noisyHeight);
assert(noisyMask.data.some(Boolean), "many disconnected foreground components remain recoverable under the pixel bound");
assert.deepEqual(noisyMask.bbox, { x: 0, y: 0, width: noisyWidth - 1, height: noisyHeight - 1 });
console.log(JSON.stringify({ bounded, limits: WEB_IMAGE_LIMITS }));
